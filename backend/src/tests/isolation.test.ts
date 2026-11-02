import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Client, createApp, signupCompany, today } from './helpers.ts';

let app: FastifyInstance;
let a: Client;
let b: Client;
let customerA: number;
let productA: number;
let accountA: number;
let orderA: number;

beforeAll(async () => {
  app = await createApp();
  a = await signupCompany(app);
  b = await signupCompany(app);
  customerA = (await a.post('/customers', { name: 'Cliente da A' })).body.id;
  productA = (await a.post('/products', { name: 'Produto A', type: 'product', price: 10, stock: 5 })).body.id;
  accountA = (
    await a.post('/bank-accounts', {
      bankName: 'Banco',
      accountName: 'Conta A',
      accountType: 'checking',
      initialBalance: 0,
    })
  ).body.id;
  orderA = (await a.post('/orders', { orderDate: today(), items: [{ productId: productA, quantity: 1 }] }))
    .body.id;
});
afterAll(() => app.close());

describe('isolamento entre empresas', () => {
  it('listas da empresa B não mostram dados da empresa A', async () => {
    for (const path of [
      '/customers',
      '/products',
      '/bank-accounts',
      '/orders',
      '/expenses',
      '/transactions',
      '/suppliers',
      '/quotes',
    ]) {
      const response = await b.get(path);
      expect(response.status, path).toBe(200);
      expect(response.body, path).toEqual([]);
    }
  });

  it('a empresa B recebe 404 ao ler, alterar ou excluir registros da A', async () => {
    expect((await b.get(`/customers/${customerA}`)).status).toBe(404);
    expect((await b.put(`/customers/${customerA}`, { name: 'Invadido' })).status).toBe(404);
    expect((await b.del(`/customers/${customerA}`)).status).toBe(404);
    expect((await b.get(`/orders/${orderA}`)).status).toBe(404);
    expect((await b.put(`/orders/${orderA}`, { status: 'cancelled' })).status).toBe(404);
    expect((await b.del(`/products/${productA}`)).status).toBe(404);
    const supplierA = (await a.post('/suppliers', { name: 'Fornecedor A' })).body.id;
    const quoteA = (await a.post('/quotes', { items: [{ productId: productA, quantity: 1 }] })).body.id;
    expect((await b.get(`/suppliers/${supplierA}`)).status).toBe(404);
    expect((await b.get(`/quotes/${quoteA}`)).status).toBe(404);
    expect((await b.post(`/quotes/${quoteA}/send`)).status).toBe(404);
    expect((await b.post(`/quotes/${quoteA}/convert`, { orderDate: today() })).status).toBe(404);
    const userA = (await a.get('/users')).body[0].id;
    expect((await b.get(`/users/${userA}`)).status).toBe(404);
    expect((await b.put(`/users/${userA}`, { name: 'X', groupId: 1, active: false })).status).toBe(404);
    expect((await b.get('/users')).body).toHaveLength(1);
    // O registro da A continua intacto.
    expect((await a.get(`/customers/${customerA}`)).body.name).toBe('Cliente da A');
  });

  it('a empresa B não consegue usar IDs da A dentro dos próprios registros', async () => {
    const order = await b.post('/orders', {
      orderDate: today(),
      items: [{ productId: productA, quantity: 1 }],
    });
    expect(order.status).toBe(400);
    const withCustomer = await b.post('/orders', {
      orderDate: today(),
      customerId: customerA,
      items: [{ productId: productA, quantity: 1 }],
    });
    expect(withCustomer.status).toBe(400);
    const expense = await b.post('/expenses', {
      description: 'x',
      category: 'y',
      amount: 1,
      expenseDate: today(),
      status: 'paid',
      bankAccountId: accountA,
    });
    expect(expense.status).toBe(400);
  });
});
