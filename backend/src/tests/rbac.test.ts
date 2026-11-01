import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, type Client, createApp, signupCompany, today } from './helpers.ts';

let app: FastifyInstance;
let owner: Client;
let seller: Client;
let accountant: Client;
let customerId: number;
let productId: number;

beforeAll(async () => {
  app = await createApp();
  owner = await signupCompany(app);
  seller = await addMember(app, owner, 'seller');
  accountant = await addMember(app, owner, 'accountant');
  customerId = (await owner.post('/customers', { name: 'Cliente' })).body.id;
  productId = (await owner.post('/products', { name: 'Serviço', type: 'service', price: 50 })).body.id;
  await owner.post('/bank-accounts', {
    bankName: 'B',
    accountName: 'C',
    accountType: 'cash',
    initialBalance: 0,
  });
});
afterAll(() => app.close());

describe('RBAC', () => {
  it('contador só lê: vê clientes, pedidos e análise, mas não grava', async () => {
    expect((await accountant.get('/customers')).status).toBe(200);
    expect((await accountant.get('/orders')).status).toBe(200);
    expect((await accountant.get('/dashboard')).status).toBe(200);
    expect((await accountant.get('/bank-accounts')).status).toBe(200);
    expect((await accountant.post('/customers', { name: 'Novo' })).status).toBe(403);
    expect((await accountant.put(`/customers/${customerId}`, { name: 'X' })).status).toBe(403);
    expect(
      (await accountant.post('/orders', { orderDate: today(), items: [{ productId, quantity: 1 }] })).status,
    ).toBe(403);
  });

  it('vendedor vende e cadastra clientes, mas não exclui nem vê o financeiro', async () => {
    expect((await seller.post('/customers', { name: 'Cliente do vendedor' })).status).toBe(201);
    expect(
      (
        await seller.post('/orders', {
          orderDate: today(),
          status: 'paid',
          items: [{ productId, quantity: 1 }],
        })
      ).status,
    ).toBe(201);
    expect((await seller.get('/bank-accounts/options')).status).toBe(200);

    expect((await seller.del(`/customers/${customerId}`)).status).toBe(403);
    expect((await seller.get('/dashboard')).status).toBe(403);
    expect((await seller.get('/bank-accounts')).status).toBe(403);
    expect((await seller.get('/expenses')).status).toBe(403);
    expect((await seller.post('/products', { name: 'P', type: 'service', price: 1 })).status).toBe(403);
  });

  it('proprietário pode excluir', async () => {
    expect((await owner.del(`/customers/${customerId}`)).status).toBe(204);
  });
});
