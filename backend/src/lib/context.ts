import { can, canAny, type Permission } from '@arandue/shared/permissions';
import { type Column, eq, type SQL } from 'drizzle-orm';
import { forbidden } from './errors.ts';

// Quem está agindo. Vem da sessão (web) ou, futuramente, do vínculo do Telegram.
// As permissões são as do grupo de acesso do usuário, lidas do banco a cada requisição.
export interface Ctx {
  userId: number;
  companyId: number;
  groupId: number;
  isOwner: boolean;
  // Em orçamentos e pedidos, o grupo só vê os registros que o próprio usuário criou.
  ownOnly: boolean;
  permissions: ReadonlySet<Permission>;
  actor: 'web' | 'telegram' | 'assistant' | 'system';
}

export function authorize(ctx: Ctx, permission: Permission): void {
  if (!can(ctx.permissions, permission)) throw forbidden();
}

export function authorizeAny(ctx: Ctx, permissions: Permission[]): void {
  if (!canAny(ctx.permissions, permissions)) throw forbidden();
}

// Condição extra para grupos restritos aos próprios registros (undefined = sem restrição).
export const ownScope = (ctx: Ctx, createdBy: Column): SQL | undefined =>
  ctx.ownOnly ? eq(createdBy, ctx.userId) : undefined;
