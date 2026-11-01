import { type TransactionInput, transactionSchema } from '@arandue/shared/schemas';
import { and, desc, eq } from 'drizzle-orm';
import { db, type Transaction } from '../db/client.ts';
import { cashTransactions } from '../db/schema.ts';
import { authorize, type Ctx } from '../lib/context.ts';
import { conflict, notFound } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import { audit } from './audit.ts';
import { assertActiveAccount } from './ownership.ts';

const scoped = (ctx: Ctx, id: number) =>
  and(eq(cashTransactions.id, id), eq(cashTransactions.companyId, ctx.companyId));

// Movimentações geradas por pedido ou despesa só mudam pela origem, para o caixa não dessincronizar.
async function getManual(tx: Transaction, ctx: Ctx, id: number) {
  const [row] = await tx.select().from(cashTransactions).where(scoped(ctx, id)).for('update');
  if (!row) throw notFound();
  if (row.orderId || row.expenseId) {
    throw conflict('Esta movimentação foi gerada automaticamente. Altere o pedido ou a despesa de origem.');
  }
  return row;
}

export async function listTransactions(ctx: Ctx) {
  authorize(ctx, 'finance', 'read');
  return db
    .select()
    .from(cashTransactions)
    .where(eq(cashTransactions.companyId, ctx.companyId))
    .orderBy(desc(cashTransactions.transactionDate), desc(cashTransactions.id))
    .limit(500);
}

export async function getTransaction(ctx: Ctx, id: number) {
  authorize(ctx, 'finance', 'read');
  const [row] = await db.select().from(cashTransactions).where(scoped(ctx, id));
  if (!row) throw notFound();
  return row;
}

export async function createTransaction(ctx: Ctx, input: TransactionInput) {
  authorize(ctx, 'finance', 'create');
  const data = parse(transactionSchema, input);
  return db.transaction(async (tx) => {
    if (data.bankAccountId) await assertActiveAccount(tx, ctx, data.bankAccountId);
    const [row] = await tx
      .insert(cashTransactions)
      .values({ ...data, companyId: ctx.companyId })
      .returning();
    if (!row) throw new Error('Falha ao criar movimentação.');
    await audit(tx, ctx, 'create', 'cash_transaction', row.id);
    return row;
  });
}

export async function updateTransaction(ctx: Ctx, id: number, input: TransactionInput) {
  authorize(ctx, 'finance', 'update');
  const data = parse(transactionSchema, input);
  return db.transaction(async (tx) => {
    await getManual(tx, ctx, id);
    if (data.bankAccountId) await assertActiveAccount(tx, ctx, data.bankAccountId);
    const [row] = await tx.update(cashTransactions).set(data).where(scoped(ctx, id)).returning();
    await audit(tx, ctx, 'update', 'cash_transaction', id);
    return row;
  });
}

export async function deleteTransaction(ctx: Ctx, id: number) {
  authorize(ctx, 'finance', 'delete');
  await db.transaction(async (tx) => {
    await getManual(tx, ctx, id);
    await tx.delete(cashTransactions).where(scoped(ctx, id));
    await audit(tx, ctx, 'delete', 'cash_transaction', id);
  });
}
