import type { DbOrTx } from '../db/client.ts';
import { auditLogs } from '../db/schema.ts';
import type { Ctx } from '../lib/context.ts';

// Registra quem fez o quê. Chamado dentro da mesma transação da alteração.
export async function audit(
  tx: DbOrTx,
  ctx: Ctx,
  action: 'create' | 'update' | 'delete' | 'archive' | 'login' | 'status',
  entity: string,
  entityId: number | null,
  data?: Record<string, unknown>,
): Promise<void> {
  await tx.insert(auditLogs).values({
    companyId: ctx.companyId,
    userId: ctx.userId,
    actor: ctx.actor,
    action,
    entity,
    entityId,
    data: data ?? null,
  });
}
