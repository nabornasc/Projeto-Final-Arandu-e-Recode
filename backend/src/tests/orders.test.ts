import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Client, createApp, PASSWORD, signupCompany, today } from './helpers.ts';

let app: FastifyInstance;
let owner: Client;
let accountId: number;

beforeAll(async () => {
  app = await createApp();
  owner = await signupCompany(app);
  accountId = (
    await owner.post('/bank-accounts', {
      bankName: 'Banco',
      accountName: 'Conta',
      accountType: 'checking',
      initialBalance: 0,
    })
  ).body.id;
});
afterAll(() => app.close());

const newProduct = async (stock: number, price = 100) =>
  (
    await owner.post('/products', {
      name: `Produto ${stock}-${Math.random()}`,
      type: 'product',
      price,
      stock,
    })
  ).body.id as number;
const stockOf = async (id: number) => (await owner.get(`/products/${id}`)).body.stock as number;
const incomeFor = async (orderId: number) =>
  (await owner.get('/transactions')).body.filter((t: { orderId: number | null }) => t.orderId === orderId);

describe('pedidos, estoque e caixa', () => {
  it('baixa o estoque, calcula o total e devolve datas no formato AAAA-MM-DD', async () => {
    const productId = await newProduct(10, 25.5);
    const created = await owner.post('/orders', {
      orderDate: '2026-11-02',
      discount: 1,
      items: [{ productId, quantity: 3 }],
    });
    expect(created.status).toBe(201);
    expect(created.body.total).toBe(75.5);
    expect(created.body.orderDate).toBe('2026-11-02');
    expect(created.body.items).toHaveLength(1);
    expect(await stockOf(productId)).toBe(7);
  });

  it('recusa estoque insuficiente sem deixar alteração parcial', async () => {
    const ok = await newProduct(5);
    const low = await newProduct(1);
    const response = await owner.post('/orders', {
      orderDate: today(),
      items: [
        { productId: ok, quantity: 2 },
        { productId: low, quantity: 2 },
      ],
    });
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/Estoque insuficiente/);
    expect(await stockOf(ok)).toBe(5);
    expect(await stockOf(low)).toBe(1);
  });

  it('não vende a mesma unidade duas vezes em pedidos simultâneos', async () => {
    const productId = await newProduct(1);
    const attempt = () => owner.post('/orders', { orderDate: today(), items: [{ productId, quantity: 1 }] });
    const results = await Promise.all([attempt(), attempt(), attempt()]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 400)).toHaveLength(2);
    expect(await stockOf(productId)).toBe(0);
  });

  it('cancelar devolve o estoque; reativar sem saldo é recusado', async () => {
    const productId = await newProduct(2);
    const order = (await owner.post('/orders', { orderDate: today(), items: [{ productId, quantity: 2 }] }))
      .body;
    expect(await stockOf(productId)).toBe(0);

    expect((await owner.put(`/orders/${order.id}`, { status: 'cancelled', reason: 'Desistiu' })).status).toBe(
      200,
    );
    expect(await stockOf(productId)).toBe(2);

    // Outra venda consome o estoque devolvido; reativar o pedido cancelado não pode deixar estoque negativo.
    await owner.post('/orders', { orderDate: today(), items: [{ productId, quantity: 1 }] });
    const reactivate = await owner.put(`/orders/${order.id}`, { status: 'pending' });
    expect(reactivate.status).toBe(400);
    expect((await owner.get(`/orders/${order.id}`)).body.status).toBe('cancelled');
    expect(await stockOf(productId)).toBe(1);
  });

  it('pedido pago gera uma entrada no caixa; voltar a pendente remove; excluir devolve estoque', async () => {
    const productId = await newProduct(3, 40);
    const order = (
      await owner.post('/orders', {
        orderDate: today(),
        status: 'paid',
        bankAccountId: accountId,
        items: [{ productId, quantity: 1 }],
      })
    ).body;
    const [income] = await incomeFor(order.id);
    expect(income).toMatchObject({ type: 'income', amount: 40, bankAccountId: accountId });

    // A movimentação automática não pode ser editada nem excluída diretamente.
    expect((await owner.put(`/transactions/${income.id}`, { ...income, amount: 1 })).status).toBe(409);
    expect((await owner.del(`/transactions/${income.id}`)).status).toBe(409);

    // Desconto altera o total e a entrada acompanha.
    await owner.put(`/orders/${order.id}`, { discount: 10 });
    expect((await incomeFor(order.id))[0].amount).toBe(30);

    await owner.post(`/orders/${order.id}/undo-payments`, {
      action: 'pending',
      reason: 'Pagamento não compensado',
      password: PASSWORD,
    });
    expect(await incomeFor(order.id)).toHaveLength(0);

    expect((await owner.del(`/orders/${order.id}`)).status).toBe(204);
    expect(await stockOf(productId)).toBe(3);
  });

  it('valida a entrada', async () => {
    expect((await owner.post('/orders', { orderDate: today(), items: [] })).status).toBe(400);
    expect(
      (await owner.post('/orders', { orderDate: '02/11/2026', items: [{ productId: 1, quantity: 1 }] }))
        .status,
    ).toBe(400);
    expect((await owner.put('/orders/1', { status: 'enviado' })).status).toBe(400);
  });
});
