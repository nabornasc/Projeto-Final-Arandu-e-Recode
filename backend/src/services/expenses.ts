import { type ExpenseInput, expenseSchema } from '@arandue/shared/schemas';
import { and, desc, eq, getTableColumns } from 'drizzle-orm';
import { db, type Transaction } from '../db/client.ts';
import { cashTransactions, expenses, people } from '../db/schema.ts';
import { diffFields, initialFields, pick, removedFields } from '../lib/changes.ts';
import { authorize, type Ctx } from '../lib/context.ts';
import { notFound } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import { accountName, audit, personName } from './audit.ts';
import { assertActiveAccount, assertSupplier } from './ownership.ts';

const scoped = (ctx: Ctx, id: number) => and(eq(expenses.id, id), eq(expenses.companyId, ctx.companyId));

const TRACKED = ['description', 'category', 'amount', 'expenseDate', 'status'] as const;
const tracked = async (tx: Transaction, row: typeof expenses.$inferSelect) => ({
  ...pick(row, TRACKED),
  bankAccount: await accountName(tx, row.bankAccountId),
  supplier: await personName(tx, row.supplierId),
});

type Expense = typeof expenses.$inferSelect;

// Despesa paga com conta vinculada gera exatamente uma saída no caixa; caso contrário, a saída é removida.
async function syncCash(tx: Transaction, ctx: Ctx, expense: Expense): Promise<void> {
  if (expense.status === 'paid' && expense.bankAccountId) {
    const values = {
      bankAccountId: expense.bankAccountId,
      category: expense.category,
      description: expense.description,
      amount: expense.amount,
      transactionDate: expense.expenseDate,
    };
    await tx
      .insert(cashTransactions)
      .values({ ...values, companyId: ctx.companyId, type: 'outcome', expenseId: expense.id })
      .onConflictDoUpdate({ target: cashTransactions.expenseId, set: values });
  } else {
    await tx.delete(cashTransactions).where(eq(cashTransactions.expenseId, expense.id));
  }
}

export async function listExpenses(ctx: Ctx) {
  authorize(ctx, 'payables.read');
  return db
    .select({ ...getTableColumns(expenses), supplierName: people.name })
    .from(expenses)
    .leftJoin(people, eq(people.id, expenses.supplierId))
    .where(eq(expenses.companyId, ctx.companyId))
    .orderBy(desc(expenses.expenseDate), desc(expenses.id))
    .limit(500);
}

export async function getExpense(ctx: Ctx, id: number) {
  authorize(ctx, 'payables.read');
  const [row] = await db.select().from(expenses).where(scoped(ctx, id));
  if (!row) throw notFound();
  return row;
}

export async function createExpense(ctx: Ctx, input: ExpenseInput) {
  authorize(ctx, 'payables.create');
  const data = parse(expenseSchema, input);
  if (data.status === 'paid') authorize(ctx, 'payables.pay');
  return db.transaction(async (tx) => {
    if (data.bankAccountId) await assertActiveAccount(tx, ctx, data.bankAccountId);
    if (data.supplierId) await assertSupplier(tx, ctx, data.supplierId);
    const [row] = await tx
      .insert(expenses)
      .values({ ...data, companyId: ctx.companyId })
      .returning();
    if (!row) throw new Error('Falha ao criar despesa.');
    await syncCash(tx, ctx, row);
    await audit(tx, ctx, 'create', 'expense', row.id, {
      label: row.description,
      changes: initialFields(await tracked(tx, row)),
    });
    return row;
  });
}

export async function updateExpense(ctx: Ctx, id: number, input: ExpenseInput) {
  authorize(ctx, 'payables.update');
  const data = parse(expenseSchema, input);
  return db.transaction(async (tx) => {
    const [previous] = await tx.select().from(expenses).where(scoped(ctx, id)).for('update');
    if (!previous) throw notFound();
    // Pagar (ou desfazer o pagamento) mexe no caixa e tem permissão própria.
    if (previous.status !== data.status) authorize(ctx, 'payables.pay');
    if (data.bankAccountId) await assertActiveAccount(tx, ctx, data.bankAccountId);
    if (data.supplierId) await assertSupplier(tx, ctx, data.supplierId);
    const [row] = await tx.update(expenses).set(data).where(scoped(ctx, id)).returning();
    if (!row) throw notFound();
    await syncCash(tx, ctx, row);
    const changes = diffFields(await tracked(tx, previous), await tracked(tx, row));
    if (changes.length) await audit(tx, ctx, 'update', 'expense', id, { label: row.description, changes });
    return row;
  });
}

// A saída de caixa vinculada é removida em cascata (FK expense_id).
export async function deleteExpense(ctx: Ctx, id: number) {
  authorize(ctx, 'payables.delete');
  await db.transaction(async (tx) => {
    const [row] = await tx.delete(expenses).where(scoped(ctx, id)).returning();
    if (!row) throw notFound();
    await audit(tx, ctx, 'delete', 'expense', id, {
      label: row.description,
      changes: removedFields(await tracked(tx, row)),
    });
  });
}
