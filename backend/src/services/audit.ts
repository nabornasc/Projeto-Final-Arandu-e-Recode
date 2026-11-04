import { eq, inArray, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client.ts';
import { auditLogs, people, products, users } from '../db/schema.ts';
import type { ItemLine } from '../lib/changes.ts';
import type { Ctx } from '../lib/context.ts';

// Registra quem fez o quê. Chamado dentro da mesma transação da alteração.
// O nome do usuário é copiado para o registro continuar legível se o cadastro mudar.
export async function audit(
  tx: DbOrTx,
  ctx: Ctx,
  action: 'create' | 'update' | 'delete' | 'archive' | 'login' | 'status' | 'convert',
  entity: string,
  entityId: number | null,
  data?: Record<string, unknown>,
  reason?: string | null,
): Promise<void> {
  await tx.insert(auditLogs).values({
    companyId: ctx.companyId,
    userId: ctx.userId,
    actorName: sql`(SELECT ${users.name} FROM ${users} WHERE ${users.id} = ${ctx.userId})`,
    actor: ctx.actor,
    action,
    entity,
    entityId,
    data: data ?? null,
    reason: reason || null,
  });
}

// Linhas de documento com o nome do produto, para o histórico.
export async function namedLines(
  tx: DbOrTx,
  lines: { productId: number; quantity: number; unitPrice: number }[],
): Promise<ItemLine[]> {
  const ids = [...new Set(lines.map((line) => line.productId))];
  const rows = await tx
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(inArray(products.id, ids));
  const names = new Map(rows.map((row) => [row.id, row.name]));
  return lines.map(({ productId, quantity, unitPrice }) => ({
    productId,
    name: names.get(productId) ?? 'Produto removido',
    quantity,
    unitPrice,
  }));
}

export async function personName(tx: DbOrTx, id: number | null | undefined): Promise<string | null> {
  if (!id) return null;
  const [row] = await tx.select({ name: people.name }).from(people).where(eq(people.id, id));
  return row?.name ?? null;
}
