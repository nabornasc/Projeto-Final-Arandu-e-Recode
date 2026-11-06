import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, type Client, createApp, signupCompany, today } from './helpers.ts';

let app: FastifyInstance;
let owner: Client;
let other: Client;
let customerId: number;
let productId: number;
let accountId: number;
let otherAccount: number;

interface Title {
  id: number;
  orderId: number;
  position: number;
  titleCount: number;
  dueDate: string;
  amount: number;
  paidAmount: number;
  status: string;
}
interface Movement {
  orderId: number | null;
  amount: number;
  description: string;
  transactionDate: string;
  bankAccountId: number;
}

beforeAll(async () => {
  app = await createApp();
  owner = await signupCompany(app);
  other = await signupCompany(app);
  customerId = (await owner.post('/customers', { name: 'Cliente' })).body.id;
  productId = (await owner.post('/products', { name: 'Serviço', type: 'service', price: 100 })).body.id;
  accountId = (
    await owner.post('/bank-accounts', {
      bankName: 'Banco',
      accountName: 'Principal',
      accountType: 'checking',
      initialBalance: 0,
    })
  ).body.id;
  otherAccount = (
    await owner.post('/bank-accounts', {
      bankName: 'Banco',
      accountName: 'Reserva',
      accountType: 'checking',
      initialBalance: 0,
    })
  ).body.id;
});
afterAll(() => app.close());

const THREE = [
  { dueDate: '2030-01-10', amount: 100, method: 'Pix' },
  { dueDate: '2030-02-10', amount: 100, method: 'Pix' },
  { dueDate: '2030-03-10', amount: 100, method: 'Pix' },
];
const newOrder = async (extra: Record<string, unknown> = {}) => {
  const { status, body } = await owner.post('/orders', {
    customerId,
    orderDate: today(),
    items: [{ productId, quantity: 3 }],
    ...extra,
  });
  expect(status, JSON.stringify(body)).toBe(201);
  return body as { id: number; status: string; total: number; receivables: Title[] };
};
const movementsOf = async (orderId: number) =>
  ((await owner.get('/transactions')).body as Movement[]).filter((item) => item.orderId === orderId);
const titlesOf = async (orderId: number) =>
  ((await owner.get('/receivables')).body as Title[]).filter((item) => item.orderId === orderId);

describe('contas a receber do pedido', () => {
  it('sem parcelas, o pedido tem uma conta que vence na data da venda', async () => {
    const order = await newOrder();
    expect(order.receivables).toHaveLength(1);
    expect(order.receivables[0]).toMatchObject({
      amount: 300,
      paidAmount: 0,
      status: 'open',
      dueDate: today(),
    });
    expect(await movementsOf(order.id)).toHaveLength(0);
  });

  it('pedido já pago nasce com a conta quitada e a entrada na data da venda', async () => {
    const order = await newOrder({ status: 'paid', bankAccountId: accountId });
    expect(order.receivables[0]).toMatchObject({ status: 'settled', paidAmount: 300 });
    const [movement] = await movementsOf(order.id);
    expect(movement).toMatchObject({ amount: 300, transactionDate: today(), bankAccountId: accountId });
  });

  it('parcelas precisam fechar com o total e não valem em pedido pago', async () => {
    const wrong = await owner.post('/orders', {
      customerId,
      orderDate: today(),
      items: [{ productId, quantity: 3 }],
      installments: THREE.slice(0, 2),
    });
    expect(wrong.status).toBe(400);
    const paid = await owner.post('/orders', {
      customerId,
      orderDate: today(),
      status: 'paid',
      items: [{ productId, quantity: 3 }],
      installments: THREE,
    });
    expect(paid.status).toBe(400);
  });

  it('baixa por parcela: entrada própria, pedido só fica pago na última', async () => {
    const order = await newOrder({ installments: THREE });
    expect(order.receivables.map((item) => item.dueDate)).toEqual(THREE.map((item) => item.dueDate));
    const [first, second, third] = await titlesOf(order.id);
    if (!first || !second || !third) throw new Error('Faltam parcelas.');
    expect(first.titleCount).toBe(3);

    const settled = await owner.post(`/receivables/${first.id}/settle`, {
      bankAccountId: accountId,
      settledOn: '2030-01-09',
    });
    expect(settled.status).toBe(200);
    expect((await owner.get(`/orders/${order.id}`)).body.status).toBe('pending');
    const [movement] = await movementsOf(order.id);
    expect(movement).toMatchObject({
      amount: 100,
      transactionDate: '2030-01-09',
      description: expect.stringContaining('parcela 1/3'),
    });

    // A mesma parcela não recebe baixa duas vezes.
    expect((await owner.post(`/receivables/${first.id}/settle`, {})).status).toBe(409);

    await owner.post(`/receivables/${second.id}/settle`, {});
    await owner.post(`/receivables/${third.id}/settle`, {});
    expect((await owner.get(`/orders/${order.id}`)).body.status).toBe('paid');
    expect(await movementsOf(order.id)).toHaveLength(3);
  });

  it('baixa do pedido quita o que falta, sem repetir o que já foi pago', async () => {
    const order = await newOrder({ installments: THREE });
    const [first] = await titlesOf(order.id);
    await owner.post(`/receivables/${first?.id}/settle`, { bankAccountId: accountId });
    const settled = await owner.post(`/orders/${order.id}/settle`, { bankAccountId: accountId });
    expect(settled.body.status).toBe('paid');
    const movements = await movementsOf(order.id);
    expect(movements).toHaveLength(3);
    expect(movements.reduce((sum, item) => sum + item.amount, 0)).toBe(300);
  });

  it('baixa do restante em outra conta mantém a conta do que já entrou', async () => {
    const order = await newOrder({ installments: THREE });
    const [first] = await titlesOf(order.id);
    await owner.post(`/receivables/${first?.id}/settle`, { bankAccountId: accountId });
    await owner.post(`/orders/${order.id}/settle`, { bankAccountId: otherAccount });
    const accounts = (await movementsOf(order.id)).map((item) => item.bankAccountId).sort();
    expect(accounts).toEqual([accountId, otherAccount, otherAccount].sort());
  });

  it('cancelar tira do caixa e da lista; reativar reabre as contas', async () => {
    const order = await newOrder({ installments: THREE });
    const [first] = await titlesOf(order.id);
    await owner.post(`/receivables/${first?.id}/settle`, { bankAccountId: accountId });

    await owner.put(`/orders/${order.id}`, { status: 'cancelled', reason: 'Desistiu' });
    expect(await movementsOf(order.id)).toHaveLength(0);
    expect(await titlesOf(order.id)).toHaveLength(0);

    await owner.put(`/orders/${order.id}`, { status: 'pending' });
    const titles = await titlesOf(order.id);
    expect(titles.map((item) => item.status)).toEqual(['open', 'open', 'open']);
  });

  it('voltar de pago para pendente reabre tudo e tira do caixa', async () => {
    const order = await newOrder({ status: 'paid', bankAccountId: accountId });
    await owner.put(`/orders/${order.id}`, { status: 'pending' });
    expect(await movementsOf(order.id)).toHaveLength(0);
    expect((await titlesOf(order.id))[0]).toMatchObject({ status: 'open', paidAmount: 0 });
  });

  it('desconto muda a conta única e o caixa, mas não pedido com parcelas', async () => {
    const single = await newOrder({ status: 'paid', bankAccountId: accountId });
    await owner.put(`/orders/${single.id}`, { discount: 50 });
    expect((await titlesOf(single.id))[0]).toMatchObject({ amount: 250, paidAmount: 250 });
    expect((await movementsOf(single.id))[0]?.amount).toBe(250);

    const parts = await newOrder({ installments: THREE });
    const refused = await owner.put(`/orders/${parts.id}`, { discount: 10 });
    expect(refused.status).toBe(409);
    expect((await owner.get(`/orders/${parts.id}`)).body.discount).toBe(0);
  });

  it('mudar a conta de um pedido pago move a entrada, e a data acompanha a venda', async () => {
    const order = await newOrder({ status: 'paid', bankAccountId: accountId });
    await owner.put(`/orders/${order.id}`, { bankAccountId: otherAccount, orderDate: '2030-05-05' });
    expect((await movementsOf(order.id))[0]).toMatchObject({
      bankAccountId: otherAccount,
      transactionDate: '2030-05-05',
    });
  });

  it('excluir o pedido remove contas e entradas', async () => {
    const order = await newOrder({ installments: THREE });
    const [first] = await titlesOf(order.id);
    await owner.post(`/receivables/${first?.id}/settle`, { bankAccountId: accountId });
    expect((await owner.del(`/orders/${order.id}`)).status).toBe(204);
    expect(await titlesOf(order.id)).toHaveLength(0);
    expect(await movementsOf(order.id)).toHaveLength(0);
  });

  it('orçamento com parcelas gera as contas ao converter; pago ou cópia ficam com uma só', async () => {
    const quote = async () => {
      const { body } = await owner.post('/quotes', {
        customerId,
        items: [{ productId, quantity: 3 }],
        installments: THREE,
      });
      await owner.post(`/quotes/${body.id}/send`);
      await owner.post(`/quotes/${body.id}/approve`);
      return body.id as number;
    };
    const pending = await owner.post(`/quotes/${await quote()}/convert`, { orderDate: today() });
    expect(pending.body.receivables).toHaveLength(3);

    const paid = await owner.post(`/quotes/${await quote()}/convert`, {
      orderDate: today(),
      status: 'paid',
      bankAccountId: accountId,
    });
    expect(paid.body.receivables).toHaveLength(1);
    expect(paid.body.receivables[0].status).toBe('settled');

    const copy = await owner.post(`/quotes/${await quote()}/copy-to-order`, { orderDate: today() });
    expect(copy.body.receivables).toHaveLength(1);
  });

  it('respeita a empresa e a permissão de baixa', async () => {
    const order = await newOrder();
    const [title] = await titlesOf(order.id);
    expect((await other.post(`/receivables/${title?.id}/settle`, {})).status).toBe(404);
    expect(await titlesOf(order.id)).toHaveLength(1);

    const group = await owner.post('/access-groups', { name: 'Só vê', permissions: ['receivables.read'] });
    const reader = await addMember(app, owner, group.body.id);
    expect((await reader.get('/receivables')).status).toBe(200);
    expect((await reader.post(`/receivables/${title?.id}/settle`, {})).status).toBe(403);
    expect((await reader.post(`/orders/${order.id}/settle`, {})).status).toBe(403);
  });

  it('faturamento segue a data do pedido e só conta pedido quitado', async () => {
    const before = (await owner.get('/dashboard')).body;
    const order = await newOrder({ installments: THREE });
    const [first] = await titlesOf(order.id);
    await owner.post(`/receivables/${first?.id}/settle`, {
      bankAccountId: accountId,
      settledOn: '2030-01-09',
    });
    const partial = (await owner.get('/dashboard')).body;
    expect(partial.revenueYear).toBe(before.revenueYear);

    await owner.post(`/orders/${order.id}/settle`, { bankAccountId: accountId, settledOn: '2030-02-09' });
    const paid = (await owner.get('/dashboard')).body;
    expect(paid.revenueYear).toBe(before.revenueYear + 300);
  });
});

describe('fornecedor na despesa', () => {
  const expense = { description: 'Compra', category: 'Mercadorias', amount: 10, status: 'pending' };

  it('aparece na lista e no histórico, e editar sem o campo o mantém', async () => {
    const supplierId = (await owner.post('/suppliers', { name: 'Distribuidora' })).body.id;
    const created = await owner.post('/expenses', { ...expense, expenseDate: today(), supplierId });
    expect(created.status).toBe(201);
    const find = async () =>
      (
        (await owner.get('/expenses')).body as { id: number; supplierId: number; supplierName: string }[]
      ).find((item) => item.id === created.body.id);
    expect(await find()).toMatchObject({ supplierId, supplierName: 'Distribuidora' });

    await owner.put(`/expenses/${created.body.id}`, { ...expense, amount: 20, expenseDate: today() });
    expect((await find())?.supplierId).toBe(supplierId);
  });

  it('recusa fornecedor de outra empresa e cliente que não é fornecedor', async () => {
    const foreign = (await other.post('/suppliers', { name: 'De fora' })).body.id;
    const a = await owner.post('/expenses', { ...expense, expenseDate: today(), supplierId: foreign });
    expect(a.status).toBe(400);
    const b = await owner.post('/expenses', { ...expense, expenseDate: today(), supplierId: customerId });
    expect(b.status).toBe(400);
  });
});
