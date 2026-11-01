import { can } from '@arandue/shared/rbac';
import { type BankAccountInput, bankAccountSchema } from '@arandue/shared/schemas';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { bankAccounts, cashTransactions, expenses } from '../db/schema.ts';
import type { Ctx } from '../lib/context.ts';
import { authorize } from '../lib/context.ts';
import { forbidden, notFound } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import { audit } from './audit.ts';

const scoped = (ctx: Ctx, id: number) =>
  and(eq(bankAccounts.id, id), eq(bankAccounts.companyId, ctx.companyId), eq(bankAccounts.active, true));

export async function listBankAccounts(ctx: Ctx) {
  authorize(ctx, 'finance', 'read');
  return db
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.companyId, ctx.companyId), eq(bankAccounts.active, true)))
    .orderBy(asc(bankAccounts.accountName));
}

// Lista mínima (sem saldos) para quem registra vendas escolher a conta de recebimento.
export async function listBankAccountOptions(ctx: Ctx) {
  if (!can(ctx.role, 'finance', 'read') && !can(ctx.role, 'sales', 'create')) throw forbidden();
  return db
    .select({ id: bankAccounts.id, bankName: bankAccounts.bankName, accountName: bankAccounts.accountName })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.companyId, ctx.companyId), eq(bankAccounts.active, true)))
    .orderBy(asc(bankAccounts.accountName));
}

export async function getBankAccount(ctx: Ctx, id: number) {
  authorize(ctx, 'finance', 'read');
  const [row] = await db.select().from(bankAccounts).where(scoped(ctx, id));
  if (!row) throw notFound();
  return row;
}

export async function createBankAccount(ctx: Ctx, input: BankAccountInput) {
  authorize(ctx, 'finance', 'create');
  const data = parse(bankAccountSchema, input);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(bankAccounts)
      .values({ ...data, companyId: ctx.companyId })
      .returning();
    if (!row) throw new Error('Falha ao criar conta.');
    await audit(tx, ctx, 'create', 'bank_account', row.id);
    return row;
  });
}

export async function updateBankAccount(ctx: Ctx, id: number, input: BankAccountInput) {
  authorize(ctx, 'finance', 'update');
  const data = parse(bankAccountSchema, input);
  return db.transaction(async (tx) => {
    const [row] = await tx.update(bankAccounts).set(data).where(scoped(ctx, id)).returning();
    if (!row) throw notFound();
    await audit(tx, ctx, 'update', 'bank_account', id);
    return row;
  });
}

// Conta com movimentações ou despesas é desativada (preserva o histórico); senão, é excluída.
export async function deleteBankAccount(ctx: Ctx, id: number) {
  authorize(ctx, 'finance', 'delete');
  await db.transaction(async (tx) => {
    const [account] = await tx.select({ id: bankAccounts.id }).from(bankAccounts).where(scoped(ctx, id));
    if (!account) throw notFound();

    const [{ used } = { used: false }] = await tx.execute<{ used: boolean }>(sql`
      SELECT EXISTS (SELECT 1 FROM ${cashTransactions} WHERE ${cashTransactions.bankAccountId} = ${id})
          OR EXISTS (SELECT 1 FROM ${expenses} WHERE ${expenses.bankAccountId} = ${id}) AS used`);

    if (used) {
      await tx.update(bankAccounts).set({ active: false }).where(scoped(ctx, id));
      await audit(tx, ctx, 'archive', 'bank_account', id);
    } else {
      await tx.delete(bankAccounts).where(scoped(ctx, id));
      await audit(tx, ctx, 'delete', 'bank_account', id);
    }
  });
}
