import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, type Client, createApp, signupCompany, today } from './helpers.ts';

let app: FastifyInstance;
let owner: Client;
let productId: number;
let customerId: number;

beforeAll(async () => {
  app = await createApp();
  owner = await signupCompany(app);
  productId = (await owner.post('/products', { name: 'Vaso', type: 'product', price: 40, stock: 10 })).body
    .id;
  customerId = (await owner.post('/customers', { name: 'Cliente' })).body.id;
});
afterAll(() => app.close());

const stock = async () => (await owner.get(`/products/${productId}`)).body.stock as number;

describe('duplicar e copiar documentos', () => {
  it('duplica orçamento como rascunho novo, com os mesmos itens e preços', async () => {
    const quote = (
      await owner.post('/quotes', {
        customerId,
        discount: 5,
        items: [{ productId, quantity: 2, unitPrice: 35 }],
      })
    ).body;
    await owner.post(`/quotes/${quote.id}/send`);
    const copy = await owner.post(`/quotes/${quote.id}/duplicate`);
    expect(copy.status).toBe(201);
    expect(copy.body).toMatchObject({ status: 'draft', customerId, discount: 5, total: 65 });
    expect(copy.body.number).toBe(quote.number + 1);
    expect(copy.body.items[0]).toMatchObject({ quantity: 2, unitPrice: 35 });
  });

  it('copia orçamento direto para pedido (sem aprovação) e pedido de volta para orçamento', async () => {
    const quote = (await owner.post('/quotes', { items: [{ productId, quantity: 3 }] })).body;
    const before = await stock();
    const order = await owner.post(`/quotes/${quote.id}/copy-to-order`, { orderDate: today() });
    expect(order.status).toBe(201);
    expect(order.body).toMatchObject({ status: 'pending', total: 120, quoteId: null });
    expect(await stock()).toBe(before - 3);
    // O orçamento de origem continua como estava.
    expect((await owner.get(`/quotes/${quote.id}`)).body.status).toBe('draft');

    const back = await owner.post(`/orders/${order.body.id}/copy-to-quote`);
    expect(back.status).toBe(201);
    expect(back.body).toMatchObject({ status: 'draft', total: 120 });

    const dup = await owner.post(`/orders/${order.body.id}/duplicate`, { orderDate: today() });
    expect(dup.body).toMatchObject({ status: 'pending', total: 120 });
    expect(await stock()).toBe(before - 6);
  });

  it('respeita permissões, escopo e estoque', async () => {
    const quote = (await owner.post('/quotes', { items: [{ productId, quantity: 1 }] })).body;
    const accountant = await addMember(app, owner, 'accountant');
    expect((await accountant.post(`/quotes/${quote.id}/duplicate`)).status).toBe(403);
    expect((await accountant.post(`/quotes/${quote.id}/copy-to-order`, { orderDate: today() })).status).toBe(
      403,
    );

    const other = await signupCompany(app);
    expect((await other.post(`/quotes/${quote.id}/duplicate`)).status).toBe(404);

    const big = (await owner.post('/quotes', { items: [{ productId, quantity: 999 }] })).body;
    const response = await owner.post(`/quotes/${big.id}/copy-to-order`, { orderDate: today() });
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/Estoque insuficiente/);
    expect((await owner.post(`/quotes/${quote.id}/copy-to-order`, {})).status).toBe(400);
  });
});
