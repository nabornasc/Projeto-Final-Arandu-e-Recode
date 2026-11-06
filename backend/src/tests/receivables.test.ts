import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, type Client, createApp, PASSWORD, signupCompany, today } from './helpers.ts';

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
const undo = (orderId: number, action: string, reason = 'Desistiu') =>
  owner.post(`/orders/${orderId}/undo-payments`, { action, reason, password: PASSWORD });
const reverse = (client: Client, paymentId: number, reason = 'Pix devolvido', password = PASSWORD) =>
  client.post(`/receivable-payments/${paymentId}/reverse`, { reason, password });
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

    await undo(order.id, 'cancel');
    expect(await movementsOf(order.id)).toHaveLength(0);
    expect(await titlesOf(order.id)).toHaveLength(0);

    await owner.put(`/orders/${order.id}`, { status: 'pending' });
    const titles = await titlesOf(order.id);
    expect(titles.map((item) => item.status)).toEqual(['open', 'open', 'open']);
  });

  it('voltar de pago para pendente reabre tudo e tira do caixa', async () => {
    const order = await newOrder({ status: 'paid', bankAccountId: accountId });
    await undo(order.id, 'pending', 'Pagamento não compensado');
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
    expect((await undo(order.id, 'delete', 'Lançado por engano')).status).toBe(200);
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

describe('baixa parcial, em lote, com juros e desconto, e estorno', () => {
  const settle = (items: unknown[], extra: Record<string, unknown> = {}) =>
    owner.post('/receivables/settle', { bankAccountId: accountId, items, ...extra });
  const cashOf = async (orderId: number) =>
    (await movementsOf(orderId)).reduce((sum, item) => sum + item.amount, 0);

  it('parcial mantém a conta aberta com o saldo; o segundo pagamento quita', async () => {
    const order = await newOrder({ installments: THREE });
    const [first] = order.receivables;
    expect((await settle([{ receivableId: first?.id, received: 40 }])).status).toBe(200);
    expect((await titlesOf(order.id))[0]).toMatchObject({ status: 'open', paidAmount: 40, received: 40 });
    expect(await cashOf(order.id)).toBe(40);

    expect((await settle([{ receivableId: first?.id, received: 60.01 }])).status).toBe(400);
    expect((await settle([{ receivableId: first?.id, received: 60 }])).status).toBe(200);
    expect((await titlesOf(order.id))[0]).toMatchObject({ status: 'settled', paidAmount: 100 });
    expect(await movementsOf(order.id)).toHaveLength(2);
    expect((await owner.get(`/orders/${order.id}`)).body.status).toBe('pending');
  });

  it('baixa do pedido quita só o saldo de uma conta parcial', async () => {
    const order = await newOrder({ installments: THREE });
    await settle([{ receivableId: order.receivables[0]?.id, received: 40 }]);
    await owner.post(`/orders/${order.id}/settle`, { bankAccountId: accountId });
    expect(await cashOf(order.id)).toBe(300);
  });

  it('baixa em várias contas de pedidos diferentes é tudo ou nada', async () => {
    const a = await newOrder();
    const b = await newOrder();
    const ids = [a.receivables[0]?.id, b.receivables[0]?.id];
    const refused = await settle([{ receivableId: ids[0] }, { receivableId: ids[1], received: 999 }]);
    expect(refused.status).toBe(400);
    expect(await movementsOf(a.id)).toHaveLength(0);

    const repeated = await settle([{ receivableId: ids[0] }, { receivableId: ids[0] }]);
    expect(repeated.status).toBe(400);

    expect((await settle(ids.map((receivableId) => ({ receivableId })))).status).toBe(200);
    expect((await owner.get(`/orders/${a.id}`)).body.status).toBe('paid');
    expect((await owner.get(`/orders/${b.id}`)).body.status).toBe('paid');
  });

  it('juros e desconto mudam o caixa e o faturamento, não o saldo abatido', async () => {
    const before = (await owner.get('/dashboard')).body;
    const order = await newOrder();
    const receivableId = order.receivables[0]?.id;
    expect(
      (
        await settle([{ receivableId, interest: 12.5, discount: 2.5 }], {
          method: 'Pix',
          notes: 'Pago com atraso',
          settledOn: '2030-04-01',
        })
      ).status,
    ).toBe(200);
    expect((await titlesOf(order.id))[0]).toMatchObject({
      status: 'settled',
      paidAmount: 300,
      received: 310,
    });
    expect(await cashOf(order.id)).toBe(310);
    const { body } = await owner.get(`/orders/${order.id}`);
    expect(body.status).toBe('paid');
    expect(body.payments[0]).toMatchObject({
      principal: 300,
      interest: 12.5,
      discount: 2.5,
      received: 310,
      method: 'Pix',
      notes: 'Pago com atraso',
      paidOn: '2030-04-01',
      reversedAt: null,
    });
    expect((await owner.get('/dashboard')).body.revenueYear).toBe(before.revenueYear + 310);
  });

  it('desconto pode quitar sem dinheiro, e valor que não abate é recusado', async () => {
    const order = await newOrder();
    const receivableId = order.receivables[0]?.id;
    expect((await settle([{ receivableId, received: 5, interest: 5 }])).status).toBe(400);
    expect((await settle([{ receivableId, discount: 301 }])).status).toBe(400);
    expect((await settle([{ receivableId, received: 1.234 }])).status).toBe(400);
    expect((await settle([{ receivableId, received: 0, discount: 300 }])).status).toBe(200);
    expect(await movementsOf(order.id)).toHaveLength(0);
    expect((await owner.get(`/orders/${order.id}`)).body.status).toBe('paid');
  });

  it('mudar o total exige estorno quando a baixa não é simples', async () => {
    const partial = await newOrder();
    await settle([{ receivableId: partial.receivables[0]?.id, received: 40 }]);
    expect((await owner.put(`/orders/${partial.id}`, { discount: 10 })).status).toBe(409);

    const withInterest = await newOrder();
    await settle([{ receivableId: withInterest.receivables[0]?.id, interest: 5 }]);
    expect((await owner.put(`/orders/${withInterest.id}`, { discount: 10 })).status).toBe(409);
  });

  it('estorno exige motivo, tira do caixa, reabre o saldo e não repete', async () => {
    const order = await newOrder({ installments: THREE });
    await settle([{ receivableId: order.receivables[0]?.id, received: 40 }]);
    const paymentId = (await owner.get(`/orders/${order.id}`)).body.payments[0].id;

    expect((await owner.post(`/receivable-payments/${paymentId}/reverse`, {})).status).toBe(400);
    expect(
      (await owner.post(`/receivable-payments/${paymentId}/reverse`, { password: PASSWORD })).status,
    ).toBe(400);
    const wrong = await reverse(owner, paymentId, 'Pix devolvido', 'senha-errada');
    expect(wrong.status).toBe(403);
    expect(wrong.body.message).toBe('Senha incorreta.');
    expect(await movementsOf(order.id)).toHaveLength(1);
    const reversed = await reverse(owner, paymentId);
    expect(reversed.status).toBe(200);
    expect(reversed.body.payments[0]).toMatchObject({ reversalReason: 'Pix devolvido' });
    expect(reversed.body.payments[0].reversedAt).not.toBeNull();
    expect((await titlesOf(order.id))[0]).toMatchObject({ status: 'open', paidAmount: 0, received: 0 });
    expect(await movementsOf(order.id)).toHaveLength(0);
    expect((await reverse(owner, paymentId, 'De novo')).status).toBe(409);
  });

  it('estornar uma baixa de pedido pago volta para pendente e mantém as outras', async () => {
    const before = (await owner.get('/dashboard')).body;
    const order = await newOrder({ installments: THREE });
    const [first, second, third] = order.receivables;
    await settle([first, second, third].map((item) => ({ receivableId: item?.id })));
    const paid = (await owner.get(`/orders/${order.id}`)).body;
    expect(paid.status).toBe('paid');

    const reversed = await reverse(owner, paid.payments[1].id, 'Cheque sem fundo');
    expect(reversed.body.status).toBe('pending');
    expect(await cashOf(order.id)).toBe(200);
    expect((await titlesOf(order.id)).map((item) => item.status)).toEqual(['settled', 'open', 'settled']);
    expect((await owner.get('/dashboard')).body.revenueYear).toBe(before.revenueYear);

    const history = (await owner.get(`/history/order/${order.id}`)).body;
    expect(JSON.stringify(history)).toContain('Cheque sem fundo');
    expect(JSON.stringify(history)).toContain('Estornou a baixa');
  });

  it('cancelar estorna as baixas com o motivo; excluir o pedido remove tudo', async () => {
    const order = await newOrder({ installments: THREE });
    await settle([{ receivableId: order.receivables[0]?.id, received: 40 }]);
    await undo(order.id, 'cancel');
    const { body } = await owner.get(`/orders/${order.id}`);
    expect(body.payments[0].reversalReason).toBe('Desistiu');
    expect(await movementsOf(order.id)).toHaveLength(0);

    await owner.put(`/orders/${order.id}`, { status: 'pending' });
    const reopened = (await owner.get(`/orders/${order.id}`)).body;
    expect(reopened.receivables[0]).toMatchObject({ status: 'open', paidAmount: 0 });
    expect((await owner.del(`/orders/${order.id}`)).status).toBe(204);
  });

  it('com baixa, cancelar, voltar para pendente e excluir só valem com senha e motivo', async () => {
    const order = await newOrder({ status: 'paid', bankAccountId: accountId });
    const url = `/orders/${order.id}`;
    expect((await owner.put(url, { status: 'cancelled', reason: 'Teste' })).status).toBe(409);
    expect((await owner.put(url, { status: 'pending' })).status).toBe(409);
    expect((await owner.del(url)).status).toBe(409);

    const refused = { action: 'cancel', reason: 'Teste', password: 'senha-errada' };
    expect((await owner.post(`${url}/undo-payments`, refused)).status).toBe(403);
    expect((await owner.post(`${url}/undo-payments`, { action: 'cancel', password: PASSWORD })).status).toBe(
      400,
    );
    expect((await owner.get(url)).body.status).toBe('paid');
    expect(await cashOf(order.id)).toBe(300);

    const cancelled = await undo(order.id, 'cancel', 'Cliente desistiu');
    expect(cancelled.body.status).toBe('cancelled');
    expect(JSON.stringify((await owner.get(`/history/order/${order.id}`)).body)).toContain(
      'Cliente desistiu',
    );
    expect(JSON.stringify((await owner.get(`/history/order/${order.id}`)).body)).not.toContain(PASSWORD);
  });

  it('estorno respeita a empresa e a permissão própria', async () => {
    const order = await newOrder();
    await settle([{ receivableId: order.receivables[0]?.id }]);
    const paymentId = (await owner.get(`/orders/${order.id}`)).body.payments[0].id;
    const body = { reason: 'Teste', password: PASSWORD };
    expect((await reverse(other, paymentId)).status).toBe(404);
    expect(
      (await other.post(`/orders/${order.id}/undo-payments`, { ...body, action: 'cancel' })).status,
    ).toBe(404);
    expect(
      (await other.post('/receivables/settle', { items: [{ receivableId: order.receivables[0]?.id }] }))
        .status,
    ).toBe(404);

    const group = await owner.post('/access-groups', {
      name: 'Só baixa',
      permissions: ['receivables.settle'],
    });
    const settler = await addMember(app, owner, group.body.id);
    expect((await settler.post(`/receivable-payments/${paymentId}/reverse`, body)).status).toBe(403);
    const reversalGroup = await owner.post('/access-groups', {
      name: 'Estorna',
      permissions: ['receivables.reverse'],
    });
    const reverser = await addMember(app, owner, reversalGroup.body.id);
    expect((await reverser.post(`/receivable-payments/${paymentId}/reverse`, body)).status).toBe(200);
  });

  it('cancelar, voltar para pendente ou excluir com baixa também exige a permissão de estorno', async () => {
    const group = await owner.post('/access-groups', {
      name: 'Sem estorno',
      permissions: ['orders.cancel', 'orders.delete', 'receivables.settle'],
    });
    const member = await addMember(app, owner, group.body.id);
    const cancel = { status: 'cancelled', reason: 'Teste' };

    const partial = await newOrder({ installments: THREE });
    await settle([{ receivableId: partial.receivables[0]?.id, received: 40 }]);
    expect((await member.put(`/orders/${partial.id}`, cancel)).status).toBe(403);
    expect((await member.del(`/orders/${partial.id}`)).status).toBe(403);
    const attempt = { action: 'cancel', reason: 'Teste', password: PASSWORD };
    expect((await member.post(`/orders/${partial.id}/undo-payments`, attempt)).status).toBe(403);

    const paid = await newOrder({ status: 'paid', bankAccountId: accountId });
    expect((await member.put(`/orders/${paid.id}`, { status: 'pending' })).status).toBe(403);
    expect(await cashOf(paid.id)).toBe(300);

    const open = await newOrder();
    expect((await member.put(`/orders/${open.id}`, cancel)).status).toBe(200);
  });

  it('o histórico registra a baixa parcial e o estorno', async () => {
    const order = await newOrder();
    await settle([{ receivableId: order.receivables[0]?.id, received: 40, interest: 5 }], {
      settledOn: '2030-01-09',
    });
    const paymentId = (await owner.get(`/orders/${order.id}`)).body.payments[0].id;
    await reverse(owner, paymentId);
    const text = JSON.stringify((await owner.get(`/history/order/${order.id}`)).body);
    const [, baixa] = (await owner.get(`/history/order/${order.id}`)).body as { id: number }[];
    const detail = await owner.get(`/history/entry/${baixa?.id}`);
    expect(JSON.stringify(detail.body)).toContain(
      'Parcela 1/1: 40.00 em 2030-01-09 (juros 5.00, saldo 265.00)',
    );
    expect(text).toContain('Estornou a baixa');
    expect(text).toContain('Pix devolvido');
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
