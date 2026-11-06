import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, type Client, createApp, signupCompany, today } from './helpers.ts';

let app: FastifyInstance;
let owner: Client;
let other: Client;
let customerId: number;
let otherCustomer: number;
let productId: number;
let accountId: number;
let opportunityId: number;

const dayOffset = (days: number) =>
  new Date(Date.parse(`${today()}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  app = await createApp();
  owner = await signupCompany(app);
  other = await signupCompany(app);
  customerId = (await owner.post('/customers', { name: 'Cliente da ficha', creditLimit: 500 })).body.id;
  otherCustomer = (await owner.post('/customers', { name: 'Outro cliente' })).body.id;
  productId = (await owner.post('/products', { name: 'Serviço', type: 'service', price: 100 })).body.id;
  accountId = (
    await owner.post('/bank-accounts', {
      bankName: 'Banco',
      accountName: 'Principal',
      accountType: 'checking',
      initialBalance: 0,
    })
  ).body.id;
  opportunityId = (
    await owner.post('/opportunities', { title: 'Reforma', source: 'Site', customerId, estimatedValue: 300 })
  ).body.id;
  await owner.post(`/opportunities/${opportunityId}/interactions`, {
    kind: 'call',
    description: 'Ligou pedindo orçamento',
  });
  await owner.post('/quotes', { customerId, items: [{ productId, quantity: 1 }] });
  await owner.post('/quotes', { customerId: otherCustomer, items: [{ productId, quantity: 1 }] });

  // Pago em dia, pago com atraso de 5 dias e uma conta vencida com pagamento parcial.
  const order = async (orderDate: string, dueDate: string) =>
    (
      await owner.post('/orders', {
        customerId,
        orderDate,
        items: [{ productId, quantity: 2 }],
        installments: [{ dueDate, amount: 200, method: 'Pix' }],
      })
    ).body;
  const settle = (receivableId: number, settledOn: string, received?: number) =>
    owner.post('/receivables/settle', {
      bankAccountId: accountId,
      settledOn,
      items: [{ receivableId, received }],
    });
  const onTime = await order(dayOffset(-40), dayOffset(-30));
  await settle(onTime.receivables[0].id, dayOffset(-30));
  const late = await order(dayOffset(-20), dayOffset(-15));
  await settle(late.receivables[0].id, dayOffset(-10));
  const partial = await order(dayOffset(-5), dayOffset(-2));
  await settle(partial.receivables[0].id, dayOffset(-3), 50);
  await owner.post('/orders', {
    customerId: otherCustomer,
    orderDate: today(),
    items: [{ productId, quantity: 9 }],
  });
});
afterAll(() => app.close());

describe('ficha do cliente', () => {
  it('reúne CRM, documentos e financeiro só deste cliente', async () => {
    const { status, body } = await owner.get(`/customers/${customerId}/file`);
    expect(status).toBe(200);
    expect(body.customer.name).toBe('Cliente da ficha');
    expect(body.opportunities).toHaveLength(1);
    expect(body.opportunities[0]).toMatchObject({ id: opportunityId, title: 'Reforma', estimatedValue: 300 });
    expect(body.activities.map((item: { description: string }) => item.description)).toContain(
      'Ligou pedindo orçamento',
    );
    expect(body.quotes).toHaveLength(1);
    expect(body.orders).toHaveLength(3);
  });

  it('um atendimento registrado aparece na ficha e na oportunidade do CRM', async () => {
    await owner.post(`/opportunities/${opportunityId}/interactions`, {
      kind: 'visit',
      description: 'Visitou a loja',
    });
    const file = (await owner.get(`/customers/${customerId}/file`)).body;
    expect(file.activities[0]).toMatchObject({
      kind: 'visit',
      opportunityId,
      opportunityTitle: 'Reforma',
    });
    const opportunity = (await owner.get(`/opportunities/${opportunityId}`)).body;
    expect(opportunity.interactions[0].description).toBe('Visitou a loja');
  });

  it('calcula dívida, limite e pontualidade', async () => {
    const { finance } = (await owner.get(`/customers/${customerId}/file`)).body;
    expect(finance).toMatchObject({
      debt: 150,
      overdue: 150,
      toDue: 0,
      creditLimit: 500,
      creditAvailable: 350,
      paid: 450,
      paidOnTime: 250,
      paidLate: 200,
      punctuality: 55.56,
      averageDelayDays: 5,
      longestDelayDays: 5,
      usualMethod: { method: 'Pix', share: 100 },
    });
    expect(finance.openTitles).toHaveLength(1);
    expect(finance.openTitles[0]).toMatchObject({ balance: 150, overdue: true });
  });

  it('calcula periodicidade, última venda e o que o cliente compra', async () => {
    const { summary } = (await owner.get(`/customers/${customerId}/file`)).body;
    expect(summary.purchaseEveryDays).toBe(18);
    expect(summary.daysSinceLastSale).toBe(5);
    expect(summary.lastSale).toMatchObject({ date: dayOffset(-5), total: 200 });
    expect(summary.products).toEqual([
      expect.objectContaining({ productId, quantity: 6, total: 600, averagePrice: 100 }),
    ]);
    expect(summary.months.reduce((sum: number, row: { total: number }) => sum + row.total, 0)).toBe(600);
  });

  it('pedido cancelado não conta como venda, e baixa estornada sai da pontualidade', async () => {
    const customer = (await owner.post('/customers', { name: 'Só cancelado' })).body.id;
    const order = (
      await owner.post('/orders', {
        customerId: customer,
        orderDate: today(),
        items: [{ productId, quantity: 1 }],
      })
    ).body;
    await owner.put(`/orders/${order.id}`, { status: 'cancelled', reason: 'Desistiu' });
    const { body } = await owner.get(`/customers/${customer}/file`);
    expect(body.orders).toHaveLength(1);
    expect(body.summary).toMatchObject({ lastSale: null, purchaseEveryDays: null, months: [], products: [] });
    expect(body.finance).toMatchObject({ debt: 0, paid: 0, punctuality: null, usualMethod: null });
  });

  it('não abre cliente de outra empresa nem quem não é cliente', async () => {
    expect((await other.get(`/customers/${customerId}/file`)).status).toBe(404);
    const supplier = (await owner.post('/suppliers', { name: 'Fornecedor' })).body.id;
    expect((await owner.get(`/customers/${supplier}/file`)).status).toBe(404);
  });

  it('só mostra as partes que o grupo pode ver', async () => {
    const onlyCustomers = await owner.post('/access-groups', {
      name: 'Só clientes',
      permissions: ['customers.read'],
    });
    const member = await addMember(app, owner, onlyCustomers.body.id);
    const { status, body } = await member.get(`/customers/${customerId}/file`);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      opportunities: null,
      activities: null,
      quotes: null,
      orders: null,
      summary: null,
      finance: null,
    });

    const noAccess = await owner.post('/access-groups', {
      name: 'Sem clientes',
      permissions: ['products.read'],
    });
    const outsider = await addMember(app, owner, noAccess.body.id);
    expect((await outsider.get(`/customers/${customerId}/file`)).status).toBe(403);
  });

  it('grupo restrito aos próprios registros não vê documentos de outros usuários', async () => {
    const group = await owner.post('/access-groups', {
      name: 'Próprios',
      ownOnly: true,
      permissions: ['customers.read', 'quotes.read', 'orders.read', 'opportunities.read'],
    });
    expect(group.status).toBe(201);
    const member = await addMember(app, owner, group.body.id);
    const { body } = await member.get(`/customers/${customerId}/file`);
    expect(body).toMatchObject({ opportunities: [], activities: [], quotes: [], orders: [], finance: null });
    expect(body.summary).toMatchObject({ lastSale: null, products: [], months: [] });
  });
});

describe('auditoria por módulo', () => {
  it('módulo inexistente devolve lista vazia em vez de erro', async () => {
    const { status, body } = await owner.get('/history?module=Inexistente');
    expect(status).toBe(200);
    expect(body).toMatchObject({ rows: [], total: 0 });
  });
});
