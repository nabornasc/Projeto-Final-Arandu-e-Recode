import {
  type UserCreateInput,
  type UserUpdateInput,
  userCreateSchema,
  userUpdateSchema,
} from '@arandue/shared/schemas';
import { hash } from '@node-rs/argon2';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { sessions, users } from '../db/schema.ts';
import { authorize, type Ctx } from '../lib/context.ts';
import { badRequest, conflict, notFound } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import { audit } from './audit.ts';

// Nunca devolve o hash da senha.
const columns = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  active: users.active,
  createdAt: users.createdAt,
};

const scoped = (ctx: Ctx, id: number) => and(eq(users.id, id), eq(users.companyId, ctx.companyId));

export async function listUsers(ctx: Ctx) {
  authorize(ctx, 'users', 'read');
  return db.select(columns).from(users).where(eq(users.companyId, ctx.companyId)).orderBy(asc(users.name));
}

export async function getUser(ctx: Ctx, id: number) {
  authorize(ctx, 'users', 'read');
  const [row] = await db.select(columns).from(users).where(scoped(ctx, id));
  if (!row) throw notFound('Usuário não encontrado.');
  return row;
}

// Convite com senha inicial: o proprietário repassa a senha e a pessoa entra com o próprio e-mail.
export async function createUser(ctx: Ctx, input: UserCreateInput) {
  authorize(ctx, 'users', 'create');
  const data = parse(userCreateSchema, input);
  const passwordHash = await hash(data.password);
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(sql`lower(${users.email})`, data.email));
    if (existing) throw conflict('Já existe uma conta com este e-mail.');

    const [row] = await tx
      .insert(users)
      .values({ companyId: ctx.companyId, name: data.name, email: data.email, role: data.role, passwordHash })
      .returning(columns);
    if (!row) throw new Error('Falha ao criar usuário.');
    await audit(tx, ctx, 'create', 'user', row.id, { role: row.role });
    return row;
  });
}

// Usuários não são excluídos (preserva a auditoria): são desativados, o que encerra as sessões.
export async function updateUser(ctx: Ctx, id: number, input: UserUpdateInput) {
  authorize(ctx, 'users', 'update');
  const data = parse(userUpdateSchema, input);
  const passwordHash = data.password ? await hash(data.password) : null;

  return db.transaction(async (tx) => {
    const [previous] = await tx.select().from(users).where(scoped(ctx, id)).for('update');
    if (!previous) throw notFound('Usuário não encontrado.');

    const losesOwnerAccess = previous.role === 'owner' && (data.role !== 'owner' || !data.active);
    if (id === ctx.userId && (losesOwnerAccess || !data.active)) {
      throw badRequest('Você não pode remover o seu próprio acesso. Peça a outro proprietário.');
    }
    if (losesOwnerAccess) {
      const [{ owners } = { owners: 0 }] = await tx
        .select({ owners: sql<number>`count(*)::int` })
        .from(users)
        .where(
          and(
            eq(users.companyId, ctx.companyId),
            eq(users.role, 'owner'),
            eq(users.active, true),
            ne(users.id, id),
          ),
        );
      if (!owners) throw badRequest('A empresa precisa de pelo menos um proprietário ativo.');
    }

    const [row] = await tx
      .update(users)
      .set({ name: data.name, role: data.role, active: data.active, ...(passwordHash && { passwordHash }) })
      .where(scoped(ctx, id))
      .returning(columns);
    if (!row) throw notFound('Usuário não encontrado.');

    // Desativar ou trocar a senha de outra pessoa derruba as sessões abertas dela.
    if (id !== ctx.userId && (!data.active || passwordHash)) {
      await tx.delete(sessions).where(eq(sessions.userId, id));
    }
    await audit(tx, ctx, 'update', 'user', id, {
      role: row.role,
      active: row.active,
      passwordChanged: Boolean(passwordHash),
    });
    return row;
  });
}
