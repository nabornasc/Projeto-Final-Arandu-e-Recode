import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, type Client, createApp, signupCompany, today } from './helpers.ts';

let app: FastifyInstance;
let owner: Client;
let seller: Client;
let accountant: Client;
let products: number[];
let customerId: number;

beforeAll(async () => {
  app = await createApp();
  owner = await signupCompany(app);
  seller = await addMember(app, owner, 'seller');
  accountant = await addMember(app, owner, 'accountant');
  await owner.post('/bank-accounts', {
    bankName: 'Banco',
    accountName: 'Conta',
    accountType: 'checking',
    initialBalance: 0,
  });
  customerId = (await owner.post('/customers', { name: 'Cliente' })).body.id;
  products = [];
  for (const [name, price, stock] of [
    ['Caneca', 30, 10],
    ['Caderno', 20, 5],
  ] as const) {
    products.push((await owner.post('/products', { name, type: 'product', price, stock })).body.id);
  }
  products.push((await owner.post('/products', { name: 'Arte', type: 'service', price: 100 })).body.id);
});
afterAll(() => app.close());

const stockOf = async (id: number) => (await owner.get(`/products/${id}`)).body.stock as number;

const threeItems = () => ({
  customerId,
  validUntil: '2026-12-31',
  discount: 10,
  items: [
    { productId: products[0], quantity: 2 },
    { productId: products[1], quantity: 1, unitPrice: 25 },
    { productId: products[2], quantity: 1 },
  ],
});

describe('orçamento → pedido → estoque → caixa', () => {
  it('vendedor monta 3 itens, proprietário aprova, o pedido nasce e o estoque baixa', async () => {
    const created = await seller.post('/quotes', threeItems());
    expect(created.status).toBe(201);
    const quote = created.body;
    expect(quote).toMatchObject({ number: 1, status: 'draft', total: 175 });
    expect(quote.items).toHaveLength(3);
    // Orçamento não reserva estoque.
    expect(await stockOf(products[0] as number)).toBe(10);

    // Rascunho pode ser editado; enviado não.
    const edited = await seller.put(`/quotes/${quote.id}`, { ...threeItems(), discount: 0 });
    expect(edited.body.total).toBe(185);
    expect((await seller.post(`/quotes/${quote.id}/send`)).body.status).toBe('sent');
    expect((await seller.put(`/quotes/${quote.id}`, threeItems())).status).toBe(409);

    // Só o proprietário decide.
    expect((await seller.post(`/quotes/${quote.id}/approve`)).status).toBe(403);
    expect((await accountant.post(`/quotes/${quote.id}/approve`)).status).toBe(403);
    expect((await seller.post(`/quotes/${quote.id}/convert`, { orderDate: today() })).status).toBe(409);
    expect((await owner.post(`/quotes/${quote.id}/approve`)).body.status).toBe('approved');

    const converted = await seller.post(`/quotes/${quote.id}/convert`, {
      orderDate: today(),
      status: 'paid',
    });
    expect(converted.status).toBe(201);
    expect(converted.body).toMatchObject({ quoteId: quote.id, status: 'paid', total: 185, number: 1 });
    expect(converted.body.items).toHaveLength(3);
    expect(await stockOf(products[0] as number)).toBe(8);
    expect(await stockOf(products[1] as number)).toBe(4);

    // Pedido pago entrou no caixa.
    const income = (await owner.get('/transactions')).body.filter(
      (t: { orderId: number }) => t.orderId === converted.body.id,
    );
    expect(income).toHaveLength(1);
    expect(income[0].amount).toBe(185);

    // Não converte duas vezes nem exclui orçamento convertido.
    const again = await owner.post(`/quotes/${quote.id}/convert`, { orderDate: today() });
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/#001/);
    expect((await owner.del(`/quotes/${quote.id}`)).status).toBe(409);
    expect((await owner.get(`/quotes/${quote.id}`)).body).toMatchObject({ orderNumber: 1 });
  });

  it('orçamento recusado não vira pedido e estoque insuficiente na conversão não altera nada', async () => {
    const rejected = (await seller.post('/quotes', threeItems())).body;
    await seller.post(`/quotes/${rejected.id}/send`);
    expect((await owner.post(`/quotes/${rejected.id}/reject`)).status).toBe(400);
    expect((await owner.post(`/quotes/${rejected.id}/reject`, { reason: 'Preço' })).body.status).toBe(
      'rejected',
    );
    expect((await owner.post(`/quotes/${rejected.id}/approve`)).status).toBe(409);
    expect((await owner.post(`/quotes/${rejected.id}/convert`, { orderDate: today() })).status).toBe(409);

    const big = (await seller.post('/quotes', { items: [{ productId: products[1], quantity: 50 }] })).body;
    expect(big.number).toBe(3);
    await seller.post(`/quotes/${big.id}/send`);
    await owner.post(`/quotes/${big.id}/approve`);
    const response = await owner.post(`/quotes/${big.id}/convert`, { orderDate: today() });
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/Estoque insuficiente/);
    expect(await stockOf(products[1] as number)).toBe(4);
    expect((await owner.get(`/quotes/${big.id}`)).body.orderId).toBeNull();
  });

  it('valida itens e permissões básicas', async () => {
    expect((await seller.post('/quotes', { items: [] })).status).toBe(400);
    expect((await accountant.post('/quotes', threeItems())).status).toBe(403);
    expect((await accountant.get('/quotes')).status).toBe(200);
    const draft = (await seller.post('/quotes', threeItems())).body;
    expect((await seller.del(`/quotes/${draft.id}`)).status).toBe(403);
    expect((await owner.del(`/quotes/${draft.id}`)).status).toBe(204);
  });
});
