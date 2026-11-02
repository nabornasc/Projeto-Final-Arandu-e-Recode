import {
  DEFAULT_GROUPS,
  isPermission,
  OWNER_GROUP_NAME,
  PERMISSIONS,
  type Permission,
  withRequirements,
} from '@arandue/shared/permissions';
import { type AccessGroupInput, accessGroupSchema } from '@arandue/shared/schemas';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { DbOrTx, Transaction } from '../db/client.ts';
import { db } from '../db/client.ts';
import { accessGroupPermissions, accessGroups, users } from '../db/schema.ts';
import { authorize, authorizeAny, type Ctx } from '../lib/context.ts';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import { audit } from './audit.ts';

type GroupRow = typeof accessGroups.$inferSelect;
export interface Group extends GroupRow {
  permissions: Permission[];
}

const scoped = (ctx: Ctx, id: number) =>
  and(eq(accessGroups.id, id), eq(accessGroups.companyId, ctx.companyId));

// Permissões efetivas: o Proprietário tem todas, inclusive as que forem criadas no futuro.
const effective = (group: GroupRow, stored: string[]): Permission[] =>
  group.isOwner ? PERMISSIONS : withRequirements(stored.filter(isPermission));

async function withPermissions(tx: DbOrTx, rows: GroupRow[]): Promise<Group[]> {
  if (!rows.length) return [];
  const stored = await tx
    .select()
    .from(accessGroupPermissions)
    .where(
      inArray(
        accessGroupPermissions.groupId,
        rows.map((row) => row.id),
      ),
    );
  const byGroup = Map.groupBy(stored, (row) => row.groupId);
  return rows.map((row) => ({
    ...row,
    permissions: effective(
      row,
      (byGroup.get(row.id) ?? []).map((item) => item.permission),
    ),
  }));
}

// Cria os grupos padrão de uma empresa nova e devolve o id do grupo Proprietário.
export async function createDefaultGroups(tx: Transaction, companyId: number): Promise<number> {
  const [owner] = await tx
    .insert(accessGroups)
    .values({
      companyId,
      name: OWNER_GROUP_NAME,
      description: 'Acesso total. Não pode ser alterado.',
      isOwner: true,
    })
    .returning({ id: accessGroups.id });
  if (!owner) throw new Error('Falha ao criar o grupo Proprietário.');

  for (const preset of DEFAULT_GROUPS) {
    const [group] = await tx
      .insert(accessGroups)
      .values({ companyId, name: preset.name, description: preset.description })
      .returning({ id: accessGroups.id });
    if (!group) throw new Error(`Falha ao criar o grupo ${preset.name}.`);
    await tx
      .insert(accessGroupPermissions)
      .values(preset.permissions.map((permission) => ({ groupId: group.id, permission })));
  }
  return owner.id;
}

// Grupo da empresa (para atribuir a um usuário). 400 se não existir: o id veio do cliente.
export async function loadGroup(tx: DbOrTx, ctx: Ctx, id: number): Promise<Group> {
  const [row] = await tx.select().from(accessGroups).where(scoped(ctx, id));
  if (!row) throw badRequest('Grupo de acesso não encontrado.');
  const [group] = await withPermissions(tx, [row]);
  if (!group) throw badRequest('Grupo de acesso não encontrado.');
  return group;
}

// Sem escalada: só um proprietário lida com o grupo Proprietário, e os demais só atribuem
// grupos cujas permissões eles próprios têm.
export function assertCanGrant(ctx: Ctx, group: Group): void {
  if (ctx.isOwner) return;
  if (group.isOwner) throw forbidden('Só um proprietário pode atribuir o grupo Proprietário.');
  if (group.permissions.some((permission) => !ctx.permissions.has(permission))) {
    throw forbidden('Você não pode atribuir um grupo com acessos que você não tem.');
  }
}

export async function listAccessGroups(ctx: Ctx) {
  authorizeAny(ctx, ['access.manage', 'users.read']);
  const rows = await db
    .select()
    .from(accessGroups)
    .where(eq(accessGroups.companyId, ctx.companyId))
    .orderBy(sql`${accessGroups.isOwner} DESC`, asc(accessGroups.name));
  const counts = await db
    .select({ groupId: users.groupId, count: sql<number>`count(*)::int` })
    .from(users)
    .where(eq(users.companyId, ctx.companyId))
    .groupBy(users.groupId);
  const countOf = new Map(counts.map((row) => [row.groupId, row.count]));
  return (await withPermissions(db, rows)).map((group) => ({
    ...group,
    userCount: countOf.get(group.id) ?? 0,
  }));
}

export async function getAccessGroup(ctx: Ctx, id: number) {
  authorizeAny(ctx, ['access.manage', 'users.read']);
  const [row] = await db.select().from(accessGroups).where(scoped(ctx, id));
  if (!row) throw notFound('Grupo de acesso não encontrado.');
  const [group] = await withPermissions(db, [row]);
  return group;
}

// Quem gerencia grupos não concede o que não tem; o que já estava no grupo pode ser mantido.
function assertNoEscalation(ctx: Ctx, next: Permission[], previous: Permission[] = []) {
  if (ctx.isOwner) return;
  const kept = new Set(previous);
  const beyond = next.filter((permission) => !ctx.permissions.has(permission) && !kept.has(permission));
  if (beyond.length) throw forbidden('Você não pode conceder acessos que você mesmo não tem.');
}

async function replacePermissions(tx: Transaction, groupId: number, permissions: Permission[]) {
  await tx.delete(accessGroupPermissions).where(eq(accessGroupPermissions.groupId, groupId));
  if (permissions.length) {
    await tx
      .insert(accessGroupPermissions)
      .values(permissions.map((permission) => ({ groupId, permission })));
  }
}

export async function createAccessGroup(ctx: Ctx, input: AccessGroupInput) {
  authorize(ctx, 'access.manage');
  const data = parse(accessGroupSchema, input);
  const permissions = withRequirements(data.permissions);
  assertNoEscalation(ctx, permissions);

  const id = await db.transaction(async (tx) => {
    const [group] = await tx
      .insert(accessGroups)
      .values({
        companyId: ctx.companyId,
        name: data.name,
        description: data.description,
        ownOnly: data.ownOnly,
      })
      .returning({ id: accessGroups.id });
    if (!group) throw new Error('Falha ao criar grupo.');
    await replacePermissions(tx, group.id, permissions);
    await audit(tx, ctx, 'create', 'access_group', group.id, { permissions, ownOnly: data.ownOnly });
    return group.id;
  });
  return getAccessGroup(ctx, id);
}

// Permissões que ninguém pode tirar do próprio grupo (evita perder o acesso à administração).
const SELF_LOCKED: Permission[] = ['access.manage', 'users.manage'];

export async function updateAccessGroup(ctx: Ctx, id: number, input: AccessGroupInput) {
  authorize(ctx, 'access.manage');
  const data = parse(accessGroupSchema, input);
  const permissions = withRequirements(data.permissions);

  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(accessGroups).where(scoped(ctx, id)).for('update');
    if (!row) throw notFound('Grupo de acesso não encontrado.');
    if (row.isOwner) throw badRequest('O grupo Proprietário tem acesso total e não pode ser alterado.');
    const [previous] = await withPermissions(tx, [row]);
    const before = previous?.permissions ?? [];
    assertNoEscalation(ctx, permissions, before);

    if (id === ctx.groupId) {
      const lost = SELF_LOCKED.filter((p) => before.includes(p) && !permissions.includes(p));
      if (lost.length) {
        throw badRequest('Você não pode tirar do seu próprio grupo o acesso à gestão de usuários e grupos.');
      }
    }

    await tx
      .update(accessGroups)
      .set({ name: data.name, description: data.description, ownOnly: data.ownOnly })
      .where(scoped(ctx, id));
    await replacePermissions(tx, id, permissions);
    await audit(tx, ctx, 'update', 'access_group', id, {
      added: permissions.filter((p) => !before.includes(p)),
      removed: before.filter((p) => !permissions.includes(p)),
      ownOnly: { from: row.ownOnly, to: data.ownOnly },
    });
  });
  return getAccessGroup(ctx, id);
}

export async function deleteAccessGroup(ctx: Ctx, id: number) {
  authorize(ctx, 'access.manage');
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(accessGroups).where(scoped(ctx, id)).for('update');
    if (!row) throw notFound('Grupo de acesso não encontrado.');
    if (row.isOwner) throw badRequest('O grupo Proprietário não pode ser excluído.');
    const [{ count } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(eq(users.groupId, id));
    if (count) throw conflict('Mova os usuários deste grupo para outro antes de excluí-lo.');
    await tx.delete(accessGroups).where(scoped(ctx, id));
    await audit(tx, ctx, 'delete', 'access_group', id, { name: row.name });
  });
}
