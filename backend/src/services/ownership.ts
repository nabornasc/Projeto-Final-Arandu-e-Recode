import { and, eq } from 'drizzle-orm';
import type { DbOrTx } from '../db/client.ts';
import { bankAccounts, people } from '../db/schema.ts';
import type { Ctx } from '../lib/context.ts';
import { badRequest } from '../lib/errors.ts';

// Garante que um ID recebido do cliente pertence à empresa de quem está agindo.
export async function assertCustomer(tx: DbOrTx, ctx: Ctx, customerId: number): Promise<void> {
  const [row] = await tx
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.id, customerId), eq(people.companyId, ctx.companyId), eq(people.isCustomer, true)));
  if (!row) throw badRequest('Cliente não encontrado.');
}

export async function assertActiveAccount(tx: DbOrTx, ctx: Ctx, accountId: number): Promise<void> {
  const [row] = await tx
    .select({ id: bankAccounts.id })
    .from(bankAccounts)
    .where(
      and(
        eq(bankAccounts.id, accountId),
        eq(bankAccounts.companyId, ctx.companyId),
        eq(bankAccounts.active, true),
      ),
    );
  if (!row) throw badRequest('Conta bancária não encontrada ou inativa.');
}
