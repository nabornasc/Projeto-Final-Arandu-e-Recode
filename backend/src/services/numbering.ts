import { eq, sql } from 'drizzle-orm';
import type { Transaction } from '../db/client.ts';
import { companies } from '../db/schema.ts';
import type { Ctx } from '../lib/context.ts';

// Próximo número da empresa (#001, #002...). O UPDATE trava a linha da empresa até o fim da
// transação, então duas vendas simultâneas nunca recebem o mesmo número.
export async function nextNumber(tx: Transaction, ctx: Ctx, kind: 'order' | 'quote'): Promise<number> {
  const set =
    kind === 'order'
      ? { orderSeq: sql`${companies.orderSeq} + 1` }
      : { quoteSeq: sql`${companies.quoteSeq} + 1` };
  const [row] = await tx
    .update(companies)
    .set(set)
    .where(eq(companies.id, ctx.companyId))
    .returning({ orderSeq: companies.orderSeq, quoteSeq: companies.quoteSeq });
  if (!row) throw new Error('Empresa não encontrada ao numerar.');
  return kind === 'order' ? row.orderSeq : row.quoteSeq;
}
