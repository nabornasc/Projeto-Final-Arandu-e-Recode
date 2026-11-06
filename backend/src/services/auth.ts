import { createHash, randomBytes } from 'node:crypto';
import { isPermission, PERMISSIONS, withRequirements } from '@arandue/shared/permissions';
import type { LoginInput, RegisterInput } from '@arandue/shared/schemas';
import { loginSchema, registerSchema } from '@arandue/shared/schemas';
import { hash, verify } from '@node-rs/argon2';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { accessGroupPermissions, accessGroups, companies, sessions, users } from '../db/schema.ts';
import type { Ctx } from '../lib/context.ts';
import { conflict, forbidden, unauthorized } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import { createDefaultGroups } from './accessGroups.ts';
import { audit } from './audit.ts';
import { createDefaultStages } from './pipeline.ts';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_RENEW_BEFORE_MS = 15 * 24 * 60 * 60 * 1000;

// Hash usado quando o e-mail não existe, para o tempo de resposta não revelar quais e-mails têm conta.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => {
  dummyHash ??= hash('senha-inexistente-para-comparacao');
  return dummyHash;
};

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export interface SessionResult {
  token: string;
  expiresAt: Date;
}

export interface AuthResult {
  session: SessionResult;
  ctx: Ctx;
}

// Colunas que montam o contexto de quem age: usuário, grupo e as permissões do grupo.
const ctxColumns = {
  userId: users.id,
  companyId: users.companyId,
  groupId: accessGroups.id,
  isOwner: accessGroups.isOwner,
  ownOnly: accessGroups.ownOnly,
  permissions: sql<string[]>`coalesce((
    SELECT array_agg(${accessGroupPermissions.permission}) FROM ${accessGroupPermissions}
    WHERE ${accessGroupPermissions.groupId} = ${accessGroups.id}), '{}')`,
};

type CtxRow = {
  userId: number;
  companyId: number;
  groupId: number;
  isOwner: boolean;
  ownOnly: boolean;
  permissions: string[];
};

function toCtx(row: CtxRow): Ctx {
  return {
    userId: row.userId,
    companyId: row.companyId,
    groupId: row.groupId,
    isOwner: row.isOwner,
    // O Proprietário tem todas as permissões e nunca fica restrito aos próprios registros.
    ownOnly: !row.isOwner && row.ownOnly,
    permissions: new Set(row.isOwner ? PERMISSIONS : withRequirements(row.permissions.filter(isPermission))),
    actor: 'web',
  };
}

async function createSession(userId: number): Promise<SessionResult> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });
  return { token, expiresAt };
}

export async function register(input: RegisterInput): Promise<AuthResult> {
  const data = parse(registerSchema, input);
  const passwordHash = await hash(data.password);

  const ctx = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(sql`lower(${users.email})`, data.email));
    if (existing) throw conflict('Já existe uma conta com este e-mail.');

    const [company] = await tx
      .insert(companies)
      .values({ name: data.companyName, cnpj: data.cnpj })
      .returning({ id: companies.id });
    if (!company) throw new Error('Falha ao criar empresa.');

    const ownerGroupId = await createDefaultGroups(tx, company.id);
    await createDefaultStages(tx, company.id);
    const [user] = await tx
      .insert(users)
      .values({
        companyId: company.id,
        name: data.name,
        email: data.email,
        passwordHash,
        groupId: ownerGroupId,
      })
      .returning({ id: users.id });
    if (!user) throw new Error('Falha ao criar usuário.');

    const ctx = toCtx({
      userId: user.id,
      companyId: company.id,
      groupId: ownerGroupId,
      isOwner: true,
      ownOnly: false,
      permissions: [],
    });
    await audit(tx, ctx, 'create', 'company', company.id, { label: data.companyName });
    return ctx;
  });

  return { session: await createSession(ctx.userId), ctx };
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const data = parse(loginSchema, input);
  const [user] = await db
    .select({ ...ctxColumns, passwordHash: users.passwordHash, active: users.active })
    .from(users)
    .innerJoin(accessGroups, eq(accessGroups.id, users.groupId))
    .where(eq(sql`lower(${users.email})`, data.email));

  const valid = await verify(user?.passwordHash ?? (await getDummyHash()), data.password);
  if (!user || !valid || !user.active) throw unauthorized('E-mail ou senha incorretos.');

  // Limpeza oportunista das sessões vencidas deste usuário.
  await db.delete(sessions).where(and(eq(sessions.userId, user.userId), lt(sessions.expiresAt, new Date())));
  const ctx = toCtx(user);
  await audit(db, ctx, 'login', 'user', user.userId);
  return { session: await createSession(user.userId), ctx };
}

// Confirma a senha de quem está logado antes de uma operação sensível.
export async function confirmPassword(ctx: Ctx, password: string): Promise<void> {
  const [user] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, ctx.userId));
  if (!user || !(await verify(user.passwordHash, password))) throw forbidden('Senha incorreta.');
}

export async function logout(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

export interface SessionInfo {
  ctx: Ctx;
  renewed: SessionResult | null;
}

// Valida o token do cookie. Renova a validade quando falta menos da metade (sessão deslizante).
export async function resolveSession(token: string): Promise<SessionInfo | null> {
  const id = hashToken(token);
  const [row] = await db
    .select({ ...ctxColumns, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(accessGroups, eq(accessGroups.id, users.groupId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date()), eq(users.active, true)));
  if (!row) return null;

  let renewed: SessionResult | null = null;
  if (row.expiresAt.getTime() - Date.now() < SESSION_RENEW_BEFORE_MS) {
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id));
    renewed = { token, expiresAt };
  }

  return { ctx: toCtx(row), renewed };
}

export async function getProfile(ctx: Ctx) {
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      group: { id: accessGroups.id, name: accessGroups.name, isOwner: accessGroups.isOwner },
      company: {
        id: companies.id,
        name: companies.name,
        cnpj: companies.cnpj,
        meiAnnualLimit: companies.meiAnnualLimit,
        useMeasures: companies.useMeasures,
        measureUnit: companies.measureUnit,
      },
    })
    .from(users)
    .innerJoin(companies, eq(companies.id, users.companyId))
    .innerJoin(accessGroups, eq(accessGroups.id, users.groupId))
    .where(eq(users.id, ctx.userId));
  if (!row) throw unauthorized();
  // O frontend usa a lista só para esconder menus e botões; o backend confere de novo.
  return { ...row, ownOnly: ctx.ownOnly, permissions: [...ctx.permissions] };
}
