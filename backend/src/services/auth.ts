import { createHash, randomBytes } from 'node:crypto';
import type { LoginInput, RegisterInput } from '@arandue/shared/schemas';
import { loginSchema, registerSchema } from '@arandue/shared/schemas';
import { hash, verify } from '@node-rs/argon2';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { companies, sessions, users } from '../db/schema.ts';
import type { Ctx } from '../lib/context.ts';
import { conflict, unauthorized } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import { audit } from './audit.ts';

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

    const [user] = await tx
      .insert(users)
      .values({ companyId: company.id, name: data.name, email: data.email, passwordHash, role: 'owner' })
      .returning({ id: users.id });
    if (!user) throw new Error('Falha ao criar usuário.');

    const ctx: Ctx = { userId: user.id, companyId: company.id, role: 'owner', actor: 'web' };
    await audit(tx, ctx, 'create', 'company', company.id);
    return ctx;
  });

  return { session: await createSession(ctx.userId), ctx };
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const data = parse(loginSchema, input);
  const [user] = await db
    .select({
      id: users.id,
      companyId: users.companyId,
      role: users.role,
      passwordHash: users.passwordHash,
      active: users.active,
    })
    .from(users)
    .where(eq(sql`lower(${users.email})`, data.email));

  const valid = await verify(user?.passwordHash ?? (await getDummyHash()), data.password);
  if (!user || !valid || !user.active) throw unauthorized('E-mail ou senha incorretos.');

  // Limpeza oportunista das sessões vencidas deste usuário.
  await db.delete(sessions).where(and(eq(sessions.userId, user.id), lt(sessions.expiresAt, new Date())));
  const ctx: Ctx = { userId: user.id, companyId: user.companyId, role: user.role, actor: 'web' };
  await audit(db, ctx, 'login', 'user', user.id);
  return { session: await createSession(user.id), ctx };
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
    .select({
      userId: users.id,
      companyId: users.companyId,
      role: users.role,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date()), eq(users.active, true)));
  if (!row) return null;

  let renewed: SessionResult | null = null;
  if (row.expiresAt.getTime() - Date.now() < SESSION_RENEW_BEFORE_MS) {
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id));
    renewed = { token, expiresAt };
  }

  return {
    ctx: { userId: row.userId, companyId: row.companyId, role: row.role, actor: 'web' },
    renewed,
  };
}

export async function getProfile(ctx: Ctx) {
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      company: {
        id: companies.id,
        name: companies.name,
        cnpj: companies.cnpj,
        meiAnnualLimit: companies.meiAnnualLimit,
      },
    })
    .from(users)
    .innerJoin(companies, eq(companies.id, users.companyId))
    .where(eq(users.id, ctx.userId));
  if (!row) throw unauthorized();
  return row;
}
