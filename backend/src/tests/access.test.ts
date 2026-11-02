import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, type Client, createApp, groupIds, signupCompany, today } from './helpers.ts';

let app: FastifyInstance;
let owner: Client;
let productId: number;

beforeAll(async () => {
  app = await createApp();
  owner = await signupCompany(app);
  await owner.post('/bank-accounts', {
    bankName: 'Banco',
    accountName: 'Conta',
    accountType: 'checking',
    initialBalance: 0,
  });
  productId = (await owner.post('/products', { name: 'Caneca', type: 'product', price: 50, stock: 10 })).body
    .id;
});
afterAll(() => app.close());

const createGroup = async (body: Record<string, unknown>) => {
  const response = await owner.post('/access-groups', body);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body as { id: number; permissions: string[] };
};

describe('grupos de acesso', () => {
  it('empresa nova tem os grupos padrão e o Proprietário tem todas as permissões', async () => {
    const groups = (await owner.get('/access-groups')).body;
    expect(groups.map((g: { name: string }) => g.name)).toEqual(['Proprietário', 'Contador', 'Vendedor']);
    expect(groups[0].permissions).toContain('access.manage');
    expect(groups[0].userCount).toBe(1);
    expect((await owner.get('/auth/me')).body.permissions).toContain('payables.pay');
  });

  it('completa os pré-requisitos das permissões', async () => {
    const group = await createGroup({ name: 'Só aprova', permissions: ['quotes.approve', 'quotes.convert'] });
    expect(group.permissions).toEqual(
      expect.arrayContaining([
        'quotes.read',
        'quotes.approve',
        'quotes.convert',
        'orders.read',
        'orders.create',
      ]),
    );
    expect((await owner.post('/access-groups', { name: 'X', permissions: ['inventada.read'] })).status).toBe(
      400,
    );
  });

  it('vendedor sênior aprova e converte só os próprios orçamentos; só o financeiro dá baixa', async () => {
    const senior = await createGroup({
      name: 'Vendedor sênior',
      ownOnly: true,
      permissions: ['quotes.create', 'quotes.update', 'quotes.send', 'quotes.approve', 'quotes.convert'],
    });
    const finance = await createGroup({
      name: 'Financeiro',
      permissions: ['receivables.settle', 'payables.pay', 'cash.read'],
    });
    const ana = await addMember(app, owner, senior.id);
    const bia = await addMember(app, owner, senior.id);
    const caixa = await addMember(app, owner, finance.id);

    const quote = (await ana.post('/quotes', { items: [{ productId, quantity: 2 }] })).body;
    expect((await ana.post(`/quotes/${quote.id}/send`)).status).toBe(200);
    expect((await ana.post(`/quotes/${quote.id}/approve`)).status).toBe(200);

    // A colega do mesmo grupo não vê nem mexe no orçamento da Ana.
    expect((await bia.get('/quotes')).body).toEqual([]);
    expect((await bia.get(`/quotes/${quote.id}`)).status).toBe(404);
    expect((await bia.post(`/quotes/${quote.id}/convert`, { orderDate: today() })).status).toBe(404);

    // Converter já como pago seria uma baixa: o grupo não tem essa permissão.
    expect(
      (await ana.post(`/quotes/${quote.id}/convert`, { orderDate: today(), status: 'paid' })).status,
    ).toBe(403);
    const order = (await ana.post(`/quotes/${quote.id}/convert`, { orderDate: today() })).body;
    expect(order).toMatchObject({ status: 'pending', total: 100 });
    expect((await ana.put(`/orders/${order.id}`, { status: 'paid' })).status).toBe(403);
    expect((await bia.get(`/orders/${order.id}`)).status).toBe(404);

    // O financeiro não vê pedidos nem orçamentos, mas vê e baixa o contas a receber.
    expect((await caixa.get('/orders')).status).toBe(403);
    expect((await caixa.get('/quotes')).status).toBe(403);
    const pending = (await caixa.get('/receivables')).body;
    expect(pending.map((o: { id: number }) => o.id)).toContain(order.id);
    expect((await ana.get('/receivables')).status).toBe(403);

    const settled = await caixa.post(`/receivables/${order.id}/settle`, {});
    expect(settled.status).toBe(200);
    expect(settled.body.status).toBe('paid');
    expect((await caixa.post(`/receivables/${order.id}/settle`, {})).status).toBe(409);
    const income = (await caixa.get('/transactions')).body.filter(
      (t: { orderId: number }) => t.orderId === order.id,
    );
    expect(income).toHaveLength(1);
  });

  it('contas a pagar: editar não é pagar', async () => {
    const clerk = await addMember(
      app,
      owner,
      (await createGroup({ name: 'Auxiliar', permissions: ['payables.create', 'payables.update'] })).id,
    );
    const expense = {
      description: 'Luz',
      category: 'Operacional',
      amount: 80,
      expenseDate: today(),
      status: 'pending',
    };
    expect((await clerk.post('/expenses', { ...expense, status: 'paid' })).status).toBe(403);
    const created = (await clerk.post('/expenses', expense)).body;
    expect((await clerk.put(`/expenses/${created.id}`, { ...expense, amount: 90 })).status).toBe(200);
    expect((await clerk.put(`/expenses/${created.id}`, { ...expense, status: 'paid' })).status).toBe(403);
    expect((await owner.put(`/expenses/${created.id}`, { ...expense, status: 'paid' })).status).toBe(200);
  });

  it('mudança de permissão vale na hora, sem novo login', async () => {
    const group = await createGroup({ name: 'Consulta', permissions: ['quotes.read'] });
    const member = await addMember(app, owner, group.id);
    expect((await member.get('/quotes')).status).toBe(200);
    await owner.put(`/access-groups/${group.id}`, { name: 'Consulta', permissions: ['customers.read'] });
    expect((await member.get('/quotes')).status).toBe(403);
    expect((await member.get('/customers')).status).toBe(200);
  });
});

describe('travas de segurança', () => {
  it('o grupo Proprietário não é alterado nem excluído; grupo com usuários não é excluído', async () => {
    const ids = await groupIds(owner);
    expect((await owner.put(`/access-groups/${ids.owner}`, { name: 'X', permissions: [] })).status).toBe(400);
    expect((await owner.del(`/access-groups/${ids.owner}`)).status).toBe(400);
    await addMember(app, owner, 'seller');
    expect((await owner.del(`/access-groups/${ids.seller}`)).status).toBe(409);
    const empty = await createGroup({ name: 'Vazio', permissions: [] });
    expect((await owner.del(`/access-groups/${empty.id}`)).status).toBe(204);
  });

  it('gerente não concede o que não tem, não promove a Proprietário e não perde o próprio acesso', async () => {
    const ids = await groupIds(owner);
    const managers = await createGroup({
      name: 'Gerente',
      permissions: ['access.manage', 'users.manage', 'quotes.read'],
    });
    const manager = await addMember(app, owner, managers.id);

    // Cria grupos só com o que ele mesmo tem.
    expect((await manager.post('/access-groups', { name: 'A', permissions: ['quotes.read'] })).status).toBe(
      201,
    );
    expect((await manager.post('/access-groups', { name: 'B', permissions: ['payables.read'] })).status).toBe(
      403,
    );

    // Não atribui grupos com mais acesso que o dele nem mexe em quem tem mais acesso.
    const invite = (groupId: number) =>
      manager.post('/users', {
        name: 'N',
        email: `n-${groupId}@t.test`,
        groupId,
        password: 'senha-de-teste-123',
      });
    expect((await invite(ids.owner)).status).toBe(403);
    expect((await invite(ids.accountant)).status).toBe(403);
    const ownerId = (await owner.get('/auth/me')).body.id;
    expect(
      (await manager.put(`/users/${ownerId}`, { name: 'X', groupId: managers.id, active: false })).status,
    ).toBe(403);

    // Não tira do próprio grupo a gestão de usuários e grupos.
    const selfLock = await manager.put(`/access-groups/${managers.id}`, {
      name: 'Gerente',
      permissions: ['users.manage', 'quotes.read'],
    });
    expect(selfLock.status).toBe(400);
  });

  it('grupos de outra empresa não podem ser lidos nem atribuídos', async () => {
    const other = await signupCompany(app);
    const theirs = await groupIds(other);
    expect((await owner.get(`/access-groups/${theirs.seller}`)).status).toBe(404);
    const response = await owner.post('/users', {
      name: 'Z',
      email: 'z@outra.test',
      groupId: theirs.seller,
      password: 'senha-de-teste-123',
    });
    expect(response.status).toBe(400);
  });
});
