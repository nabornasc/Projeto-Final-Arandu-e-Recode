import {
  type UserCreateInput,
  type UserUpdateInput,
  userCreateSchema,
  userUpdateSchema,
} from '@arandue/shared/schemas';
import { hash } from '@node-rs/argon2';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { accessGroups, sessions, users } from '../db/schema.ts';
import { diffFields, initialFields } from '../lib/changes.ts';
import { authorize, type Ctx } from '../lib/context.ts';
import { badRequest, conflict, notFound } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import { assertCanGrant, loadGroup } from './accessGroups.ts';
import { audit, groupName } from './audit.ts';

// Nunca devolve o hash da senha.
const columns = {
  id: users.id,
  name: users.name,
  email: users.email,
  groupId: users.groupId,
  groupName: accessGroups.name,
  active: users.active,
  createdAt: users.createdAt,
};

const scoped = (ctx: Ctx, id: number) => and(eq(users.id, id), eq(users.companyId, ctx.companyId));

const selectUsers = () =>
  db.select(columns).from(users).innerJoin(accessGroups, eq(accessGroups.id, users.groupId));

export async function listUsers(ctx: Ctx) {
  authorize(ctx, 'users.read');
  return selectUsers().where(eq(users.companyId, ctx.companyId)).orderBy(asc(users.name));
}

export async function getUser(ctx: Ctx, id: number) {
  authorize(ctx, 'users.read');
  const [row] = await selectUsers().where(scoped(ctx, id));
  if (!row) throw notFound('Usuário não encontrado.');
  return row;
}

// Convite com senha inicial: o administrador repassa a senha e a pessoa entra com o próprio e-mail.
export async function createUser(ctx: Ctx, input: UserCreateInput) {
  authorize(ctx, 'users.manage');
  const data = parse(userCreateSchema, input);
  const passwordHash = await hash(data.password);
  const id = await db.transaction(async (tx) => {
    assertCanGrant(ctx, await loadGroup(tx, ctx, data.groupId));
    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(sql`lower(${users.email})`, data.email));
    if (existing) throw conflict('Já existe uma conta com este e-mail.');

    const [row] = await tx
      .insert(users)
      .values({
        companyId: ctx.companyId,
        name: data.name,
        email: data.email,
        groupId: data.groupId,
        passwordHash,
      })
      .returning({ id: users.id });
    if (!row) throw new Error('Falha ao criar usuário.');
    await audit(tx, ctx, 'create', 'user', row.id, {
      label: data.name,
      changes: initialFields({
        name: data.name,
        email: data.email,
        group: await groupName(tx, data.groupId),
      }),
    });
    return row.id;
  });
  return getUser(ctx, id);
}

// Usuários não são excluídos (preserva a auditoria): são desativados, o que encerra as sessões.
export async function updateUser(ctx: Ctx, id: number, input: UserUpdateInput) {
  authorize(ctx, 'users.manage');
  const data = parse(userUpdateSchema, input);
  const passwordHash = data.password ? await hash(data.password) : null;

  await db.transaction(async (tx) => {
    const [previous] = await tx.select().from(users).where(scoped(ctx, id)).for('update');
    if (!previous) throw notFound('Usuário não encontrado.');

    // Ninguém administra quem tem mais acesso do que ele, nem dá a alguém mais acesso do que tem.
    const before = await loadGroup(tx, ctx, previous.groupId);
    const after = data.groupId === previous.groupId ? before : await loadGroup(tx, ctx, data.groupId);
    assertCanGrant(ctx, before);
    assertCanGrant(ctx, after);

    if (id === ctx.userId && (data.groupId !== previous.groupId || !data.active)) {
      throw badRequest(
        'Você não pode mudar o seu próprio grupo nem se desativar. Peça a outro administrador.',
      );
    }
    const losesOwnerAccess = before.isOwner && (!after.isOwner || !data.active);
    if (losesOwnerAccess) {
      const [{ owners } = { owners: 0 }] = await tx
        .select({ owners: sql<number>`count(*)::int` })
        .from(users)
        .innerJoin(accessGroups, eq(accessGroups.id, users.groupId))
        .where(
          and(
            eq(users.companyId, ctx.companyId),
            eq(accessGroups.isOwner, true),
            eq(users.active, true),
            ne(users.id, id),
          ),
        );
      if (!owners) throw badRequest('A empresa precisa de pelo menos um proprietário ativo.');
    }

    await tx
      .update(users)
      .set({
        name: data.name,
        groupId: data.groupId,
        active: data.active,
        ...(passwordHash && { passwordHash }),
      })
      .where(scoped(ctx, id));

    // Desativar ou trocar a senha de outra pessoa derruba as sessões abertas dela.
    if (id !== ctx.userId && (!data.active || passwordHash)) {
      await tx.delete(sessions).where(eq(sessions.userId, id));
    }
    const changes = diffFields(
      {
        name: previous.name,
        group: await groupName(tx, previous.groupId),
        active: previous.active,
        password: 'mantida',
      },
      {
        name: data.name,
        group: await groupName(tx, data.groupId),
        active: data.active,
        password: passwordHash ? 'alterada' : 'mantida',
      },
    );
    if (changes.length) await audit(tx, ctx, 'update', 'user', id, { label: data.name, changes });
  });
  return getUser(ctx, id);
}
