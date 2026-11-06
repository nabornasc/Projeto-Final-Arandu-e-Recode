import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { diffFields, diffItems, initialFields } from '../lib/changes.ts';
import { addMember, type Client, createApp, PASSWORD, signupCompany, today } from './helpers.ts';

let app: FastifyInstance;
let owner: Client;
let seller: Client;
let accountant: Client;
let productA: number;
let productB: number;
let customerId: number;
let otherCustomerId: number;

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
  customerId = (await owner.post('/customers', { name: 'Ana' })).body.id;
  otherCustomerId = (await owner.post('/customers', { name: 'Bia' })).body.id;
  productA = (await owner.post('/products', { name: 'Caneca', type: 'product', price: 30, stock: 100 })).body
    .id;
  productB = (await owner.post('/products', { name: 'Arte', type: 'service', price: 100 })).body.id;
});
afterAll(() => app.close());

const newQuote = async (client: Client = seller) =>
  (await client.post('/quotes', { customerId, items: [{ productId: productA, quantity: 1 }] })).body;

const historyOf = async (type: 'quote' | 'order', id: number) =>
  (await owner.get(`/history/${type}/${id}`)).body as { id: number; summary: string; reason: string }[];

const latestEntry = async (type: 'quote' | 'order', id: number) => {
  const [line] = await historyOf(type, id);
  return (await owner.get(`/history/entry/${line?.id}`)).body;
};

describe('comparação de antes e depois', () => {
  it('ignora campos iguais e trata vazio e nulo como a mesma coisa', () => {
    expect(diffFields({ a: 1, b: '', c: 'x' }, { a: 1, b: null, c: 'y' })).toEqual([
      { field: 'c', from: 'x', to: 'y' },
    ]);
    expect(initialFields({ discount: 0, notes: null, total: 10 })).toEqual([
      { field: 'total', from: null, to: 10 },
    ]);
  });

  it('compara itens por produto, inclusive repetidos, e ignora a ordem', () => {
    const line = (productId: number, quantity: number, unitPrice = 10) => ({
      productId,
      name: `P${productId}`,
      quantity,
      unitPrice,
    });
    expect(diffItems([line(1, 1), line(2, 1)], [line(2, 1), line(1, 1)])).toEqual([]);
    expect(diffItems([line(1, 1), line(1, 2)], [line(1, 1), line(1, 3)])).toEqual([
      expect.objectContaining({ change: 'changed', fromQuantity: 2, quantity: 3 }),
    ]);
    expect(diffItems([line(1, 1)], [line(2, 1)]).map((item) => item.change)).toEqual(['added', 'removed']);
  });
});

describe('histórico do documento', () => {
  it('registra quem alterou, quando e o que mudou, campo a campo e item a item', async () => {
    const quote = await newQuote();
    const edited = await seller.put(`/quotes/${quote.id}`, {
      customerId: otherCustomerId,
      discount: 5,
      items: [
        { productId: productA, quantity: 2 },
        { productId: productB, quantity: 1 },
      ],
    });
    expect(edited.status).toBe(200);

    const lines = await historyOf('quote', quote.id);
    expect(lines).toHaveLength(2);
    expect(lines[1]?.summary).toBe('Criou o orçamento');
    expect(lines[0]?.summary).toBe('Alterou cliente, desconto e itens');

    const entry = await latestEntry('quote', quote.id);
    expect(entry).toMatchObject({
      actorName: 'Membro',
      type: 'quote',
      documentExists: true,
      documentNumber: quote.number,
    });
    expect(Number.isNaN(Date.parse(entry.createdAt))).toBe(false);
    expect(entry.changes).toEqual(
      expect.arrayContaining([
        { field: 'customer', label: 'Cliente', kind: 'text', from: 'Ana', to: 'Bia' },
        { field: 'discount', label: 'Desconto', kind: 'money', from: 0, to: 5 },
        { field: 'total', label: 'Total', kind: 'money', from: 30, to: 155 },
      ]),
    );
    expect(entry.items).toEqual([
      expect.objectContaining({ change: 'changed', name: 'Caneca', fromQuantity: 1, quantity: 2 }),
      expect.objectContaining({ change: 'added', name: 'Arte', quantity: 1 }),
    ]);
  });

  it('salvar sem mudar nada não cria registro', async () => {
    const quote = await newQuote();
    await seller.put(`/quotes/${quote.id}`, { customerId, items: [{ productId: productA, quantity: 1 }] });
    expect(await historyOf('quote', quote.id)).toHaveLength(1);
  });

  it('mantém o nome da data da ação se o usuário mudar de nome', async () => {
    const quote = await newQuote(owner);
    const me = (await owner.get('/auth/me')).body;
    const renamed = await owner.put(`/users/${me.id}`, {
      name: 'Dono Renomeado',
      groupId: me.group.id,
      active: true,
    });
    expect(renamed.status).toBe(200);
    expect((await latestEntry('quote', quote.id)).actorName).toBe('Dono');
  });

  it('registra o caminho do pedido: baixa, cancelamento com motivo e reativação', async () => {
    const order = (
      await seller.post('/orders', {
        orderDate: today(),
        customerId,
        items: [{ productId: productA, quantity: 1 }],
      })
    ).body;

    await owner.post(`/orders/${order.id}/settle`);
    const settled = await latestEntry('order', order.id);
    expect(settled.summary).toBe('Deu baixa no recebimento');
    expect(settled.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'status', from: 'pending', to: 'paid' }),
        expect.objectContaining({ field: 'bankAccount', from: null, to: 'Banco — Conta' }),
      ]),
    );

    const noReason = await owner.put(`/orders/${order.id}`, { status: 'cancelled' });
    expect(noReason.status).toBe(400);
    expect((await owner.get(`/orders/${order.id}`)).body.status).toBe('paid');

    await owner.post(`/orders/${order.id}/undo-payments`, {
      action: 'cancel',
      reason: 'Cliente desistiu',
      password: PASSWORD,
    });
    expect(await latestEntry('order', order.id)).toMatchObject({
      summary: 'Cancelou',
      reason: 'Cliente desistiu',
    });

    await owner.put(`/orders/${order.id}`, { status: 'pending' });
    expect((await latestEntry('order', order.id)).summary).toBe('Reativou');
  });

  it('guarda uma cópia do pedido excluído, ainda consultável', async () => {
    const order = (
      await owner.post('/orders', {
        orderDate: today(),
        customerId,
        discount: 2,
        items: [{ productId: productA, quantity: 1 }],
      })
    ).body;
    expect((await owner.del(`/orders/${order.id}`)).status).toBe(204);
    expect((await owner.get(`/orders/${order.id}`)).status).toBe(404);

    const lines = await historyOf('order', order.id);
    expect(lines.map((line) => line.summary)).toEqual(['Excluiu o pedido', 'Criou o pedido']);

    const deleted = await latestEntry('order', order.id);
    expect(deleted).toMatchObject({ documentExists: false, documentNumber: order.number });
    expect(deleted.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'customer', from: 'Ana', to: null }),
        expect.objectContaining({ field: 'discount', from: 2, to: null }),
        expect.objectContaining({ field: 'total', from: 28, to: null }),
      ]),
    );
    expect(deleted.items).toEqual([expect.objectContaining({ change: 'removed', name: 'Caneca' })]);
  });

  it('documento que nunca existiu não tem histórico', async () => {
    expect((await owner.get('/history/order/999999')).status).toBe(404);
    expect((await owner.get('/history/opportunity/1')).status).toBe(400);
  });
});

describe('recusa, cancelamento e exclusão de orçamentos', () => {
  const sent = async () => {
    const quote = await newQuote();
    await seller.post(`/quotes/${quote.id}/send`);
    return quote;
  };

  it('recusar exige o motivo, que fica no histórico', async () => {
    const quote = await sent();
    expect((await owner.post(`/quotes/${quote.id}/reject`, { reason: '  ' })).status).toBe(400);
    expect((await owner.post(`/quotes/${quote.id}/reject`, { reason: 'Achou caro' })).status).toBe(200);
    expect(await latestEntry('quote', quote.id)).toMatchObject({
      summary: 'Recusou',
      reason: 'Achou caro',
    });
  });

  it('cancela enviado ou aprovado com motivo e permissão', async () => {
    const quote = await sent();
    expect((await seller.post(`/quotes/${quote.id}/cancel`)).status).toBe(400);
    expect((await accountant.post(`/quotes/${quote.id}/cancel`, { reason: 'x' })).status).toBe(403);
    const cancelled = await seller.post(`/quotes/${quote.id}/cancel`, { reason: 'Pediu para cancelar' });
    expect(cancelled.body.status).toBe('cancelled');
    expect(await latestEntry('quote', quote.id)).toMatchObject({
      summary: 'Cancelou',
      reason: 'Pediu para cancelar',
    });
    // Cancelado é definitivo: para retomar, duplica-se o orçamento.
    expect((await seller.post(`/quotes/${quote.id}/cancel`, { reason: 'x' })).status).toBe(409);
    expect((await owner.post(`/quotes/${quote.id}/approve`)).status).toBe(409);
    expect((await owner.post(`/quotes/${quote.id}/convert`, { orderDate: today() })).status).toBe(409);

    const approved = await sent();
    await owner.post(`/quotes/${approved.id}/approve`);
    expect((await owner.post(`/quotes/${approved.id}/cancel`, { reason: 'x' })).status).toBe(200);
  });

  it('rascunho não é cancelado e orçamento convertido não pode ser cancelado', async () => {
    const draft = await newQuote();
    expect((await owner.post(`/quotes/${draft.id}/cancel`, { reason: 'x' })).status).toBe(409);

    const quote = await sent();
    await owner.post(`/quotes/${quote.id}/approve`);
    await owner.post(`/quotes/${quote.id}/convert`, { orderDate: today() });
    const response = await owner.post(`/quotes/${quote.id}/cancel`, { reason: 'x' });
    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/convertido/);
  });

  it('só rascunho pode ser excluído, e a exclusão guarda o conteúdo', async () => {
    const quote = await sent();
    expect((await owner.del(`/quotes/${quote.id}`)).status).toBe(409);

    const draft = await newQuote(owner);
    expect((await owner.del(`/quotes/${draft.id}`)).status).toBe(204);
    expect((await owner.get(`/quotes/${draft.id}`)).status).toBe(404);

    const deleted = await latestEntry('quote', draft.id);
    expect(deleted).toMatchObject({ summary: 'Excluiu o orçamento', documentExists: false });
    expect(deleted.items).toEqual([expect.objectContaining({ change: 'removed', name: 'Caneca' })]);
  });
});

describe('quem pode ver o histórico', () => {
  it('outra empresa não vê lista nem registro', async () => {
    const quote = await newQuote();
    const [line] = await historyOf('quote', quote.id);
    const other = await signupCompany(app);
    expect((await other.get(`/history/quote/${quote.id}`)).status).toBe(404);
    expect((await other.get(`/history/entry/${line?.id}`)).status).toBe(404);
  });

  it('grupo restrito aos próprios só vê o histórico dos seus documentos', async () => {
    const group = (
      await owner.post('/access-groups', {
        name: 'Só os próprios',
        ownOnly: true,
        permissions: ['quotes.create', 'quotes.update', 'quotes.delete'],
      })
    ).body;
    const ana = await addMember(app, owner, group.id);
    const bia = await addMember(app, owner, group.id);
    const quote = await newQuote(ana);
    const [line] = (await ana.get(`/history/quote/${quote.id}`)).body;
    expect(line.summary).toBe('Criou o orçamento');

    expect((await bia.get(`/history/quote/${quote.id}`)).status).toBe(404);
    expect((await bia.get(`/history/entry/${line.id}`)).status).toBe(404);

    // Vale também depois de excluído: o dono vem da cópia guardada.
    expect((await ana.del(`/quotes/${quote.id}`)).status).toBe(204);
    expect((await ana.get(`/history/entry/${line.id}`)).status).toBe(200);
    expect((await ana.get(`/history/quote/${quote.id}`)).body).toHaveLength(2);
    expect((await bia.get(`/history/entry/${line.id}`)).status).toBe(404);
    expect((await bia.get(`/history/quote/${quote.id}`)).status).toBe(404);
  });

  it('sem permissão de ver o documento, não vê o histórico', async () => {
    const group = (await owner.post('/access-groups', { name: 'Só caixa', permissions: ['cash.read'] })).body;
    const caixa = await addMember(app, owner, group.id);
    const quote = await newQuote();
    const [line] = await historyOf('quote', quote.id);
    expect((await caixa.get(`/history/quote/${quote.id}`)).status).toBe(403);
    expect((await caixa.get(`/history/entry/${line?.id}`)).status).toBe(403);
  });

  it('não expõe registros de outras áreas nem dados de login', async () => {
    const companyEntry = await owner.get('/history/entry/1');
    expect([403, 404]).toContain(companyEntry.status);
    expect(JSON.stringify(await historyOf('quote', (await newQuote()).id))).not.toMatch(
      /password|hash|token/i,
    );
  });
});
