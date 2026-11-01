import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Client, createApp, signupCompany, today } from './helpers.ts';

let app: FastifyInstance;
let owner: Client;

beforeAll(async () => {
  app = await createApp();
  owner = await signupCompany(app);
});
afterAll(() => app.close());

const account = async (initialBalance: number) =>
  (
    await owner.post('/bank-accounts', {
      bankName: 'Banco',
      accountName: `Conta ${initialBalance}`,
      accountType: 'checking',
      initialBalance,
    })
  ).body.id as number;

const expense = (bankAccountId: number, status: 'paid' | 'pending', amount = 100) => ({
  description: 'Aluguel',
  category: 'Fixas',
  amount,
  expenseDate: today(),
  status,
  bankAccountId,
});

describe('despesas, movimentações e saldo', () => {
  it('despesa paga gera saída no caixa; editar acompanha; voltar a pendente remove', async () => {
    const accountId = await account(0);
    const created = (await owner.post('/expenses', expense(accountId, 'paid'))).body;
    const outflows = async () =>
      (await owner.get('/transactions')).body.filter(
        (t: { expenseId: number | null }) => t.expenseId === created.id,
      );

    expect(await outflows()).toMatchObject([{ type: 'outcome', amount: 100 }]);
    await owner.put(`/expenses/${created.id}`, expense(accountId, 'paid', 150));
    expect(await outflows()).toMatchObject([{ amount: 150 }]);
    await owner.put(`/expenses/${created.id}`, expense(accountId, 'pending', 150));
    expect(await outflows()).toHaveLength(0);
  });

  it('saldo considera só contas ativas, nos dois termos', async () => {
    const before = (await owner.get('/dashboard')).body.balance as number;
    const active = await account(1000);
    const archived = await account(500);
    await owner.post('/transactions', {
      type: 'income',
      category: 'Outros',
      description: 'Aporte',
      amount: 200,
      transactionDate: today(),
      bankAccountId: archived,
    });
    await owner.post('/transactions', {
      type: 'income',
      category: 'Outros',
      description: 'Aporte',
      amount: 50,
      transactionDate: today(),
      bankAccountId: active,
    });
    // Conta com movimentação é arquivada (não excluída) e sai da lista.
    expect((await owner.del(`/bank-accounts/${archived}`)).status).toBe(204);
    expect((await owner.get('/bank-accounts')).body.map((a: { id: number }) => a.id)).not.toContain(archived);

    const after = (await owner.get('/dashboard')).body.balance as number;
    expect(after - before).toBe(1050);
  });

  it('movimentação manual pode ser editada e excluída', async () => {
    const accountId = await account(0);
    const tx = (
      await owner.post('/transactions', {
        type: 'outcome',
        category: 'Outros',
        description: 'Taxa',
        amount: 5,
        transactionDate: today(),
        bankAccountId: accountId,
      })
    ).body;
    expect((await owner.put(`/transactions/${tx.id}`, { ...tx, amount: 7 })).body.amount).toBe(7);
    expect((await owner.del(`/transactions/${tx.id}`)).status).toBe(204);
  });
});
