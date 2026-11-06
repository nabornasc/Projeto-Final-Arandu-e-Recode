import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, type Client, createApp, signupCompany, today } from './helpers.ts';

let app: FastifyInstance;
let owner: Client;
let customerId: number;
let productId: number;
let stockId: number;

beforeAll(async () => {
  app = await createApp();
  owner = await signupCompany(app);
  customerId = (await owner.post('/customers', { name: 'Cliente' })).body.id;
  productId = (await owner.post('/products', { name: 'Serviço', type: 'service', price: 100 })).body.id;
  stockId = (await owner.post('/products', { name: 'Pedra', type: 'product', price: 50, stock: 100 })).body
    .id;
});
afterAll(() => app.close());

const quote = (extra: Record<string, unknown> = {}) =>
  owner.post('/quotes', { customerId, items: [{ productId, quantity: 1 }], ...extra });
const installment = (amount: number, dueDate = today(), method: string | null = 'Pix') => ({
  dueDate,
  amount,
  method,
});

describe('parcelas', () => {
  it('fecham com o total, considerando desconto, frete e outras despesas', async () => {
    const created = await quote({
      discount: 10,
      freight: 20,
      otherCharges: 5,
      installments: [installment(57.5), installment(57.5)],
    });
    expect(created.status).toBe(201);
    expect(created.body.total).toBe(115);
    expect(created.body.installments).toHaveLength(2);

    const mirror = await owner.get(`/quotes/${created.body.id}/mirror`);
    expect(mirror.body.installments[0]).toMatchObject({ amount: 57.5, method: 'Pix' });
  });

  it('soma diferente do total é recusada, também ao editar', async () => {
    const wrong = await quote({ installments: [installment(40), installment(40)] });
    expect(wrong.status).toBe(400);
    expect(wrong.body.message ?? JSON.stringify(wrong.body)).toContain('soma das parcelas');

    const created = await quote({ installments: [installment(100)] });
    const changedTotal = await owner.put(`/quotes/${created.body.id}`, {
      customerId,
      discount: 10,
      items: [{ productId, quantity: 1 }],
      installments: [installment(100)],
    });
    expect(changedTotal.status).toBe(400);
    expect((await owner.get(`/quotes/${created.body.id}`)).body.total).toBe(100);
  });

  it('são opcionais, e a cópia nasce sem elas', async () => {
    expect((await quote()).body.installments).toEqual([]);
    const created = await quote({ installments: [installment(100)] });
    const copy = await owner.post(`/quotes/${created.body.id}/duplicate`, {});
    expect(copy.body.installments).toEqual([]);
  });

  it('ficam no histórico', async () => {
    const created = await quote();
    await owner.put(`/quotes/${created.body.id}`, {
      customerId,
      items: [{ productId, quantity: 1 }],
      installments: [installment(100, '2030-01-15')],
    });
    const lines = (await owner.get(`/history/quote/${created.body.id}`)).body as { id: number }[];
    const entry = lines[0];
    if (!entry) throw new Error('Sem histórico.');
    const { body } = await owner.get(`/history/entry/${entry.id}`);
    const change = (body.changes as { field: string; to: string }[]).find(
      (item) => item.field === 'installments',
    );
    expect(change?.to).toContain('15/01/2030');
  });
});

describe('grupos de itens', () => {
  // Função: os ids só existem depois do beforeAll.
  const groupedItems = () => [
    { productId, quantity: 1, groupName: 'Cozinha' },
    { productId: stockId, quantity: 2, groupName: 'Banheiro' },
    { productId, quantity: 3 },
  ];

  it('aparecem nos espelhos e na duplicação, e o pedido mantém os itens', async () => {
    const created = await quote({ items: groupedItems() });
    expect(created.body.items.map((item: { groupName: string }) => item.groupName)).toEqual([
      'Cozinha',
      'Banheiro',
      null,
    ]);
    const internal = await owner.get(`/quotes/${created.body.id}/internal-mirror`);
    expect(internal.body.items[0].groupName).toBe('Cozinha');

    const copy = await owner.post(`/quotes/${created.body.id}/duplicate`, {});
    expect(copy.body.items[1].groupName).toBe('Banheiro');

    await owner.post(`/quotes/${created.body.id}/send`);
    const sent = await owner.get(`/quotes/${created.body.id}/mirror`);
    expect(sent.body.items[0].groupName).toBe('Cozinha');
    await owner.post(`/quotes/${created.body.id}/approve`);
    const order = await owner.post(`/quotes/${created.body.id}/convert`, { orderDate: today() });
    expect(order.status).toBe(201);
    expect(order.body.items).toHaveLength(3);
  });

  it('mudança de grupo fica no histórico', async () => {
    const created = await quote({ items: groupedItems() });
    await owner.put(`/quotes/${created.body.id}`, {
      customerId,
      items: groupedItems().map((item) => ({ ...item, groupName: 'Sala' })),
    });
    const lines = (await owner.get(`/history/quote/${created.body.id}`)).body as { id: number }[];
    const entry = lines[0];
    if (!entry) throw new Error('Sem histórico.');
    const { body } = await owner.get(`/history/entry/${entry.id}`);
    const fields = (body.changes as { field: string }[]).map((item) => item.field);
    expect(fields).toContain('composition');
  });
});

describe('medidas', () => {
  it('largura × comprimento vira a quantidade, mesmo que outra seja informada', async () => {
    const created = await quote({
      items: [{ productId: stockId, quantity: 99, width: 2.5, length: 1.5 }],
    });
    expect(created.status).toBe(201);
    expect(created.body.items[0]).toMatchObject({ quantity: 3.75, width: 2.5, length: 1.5, subtotal: 187.5 });
    expect(created.body.total).toBe(187.5);
    const mirror = await owner.get(`/quotes/${created.body.id}/mirror`);
    expect(mirror.body.items[0]).toMatchObject({ width: 2.5, length: 1.5 });
  });

  it('converte a unidade digitada para m² e guarda como foi digitado', async () => {
    for (const [unit, width, length] of [
      ['cm', 250, 150],
      ['mm', 2500, 1500],
      ['m', 2.5, 1.5],
    ] as const) {
      const created = await quote({
        items: [{ productId: stockId, quantity: 1, width, length, measureUnit: unit }],
      });
      expect(created.body.items[0]).toMatchObject({ quantity: 3.75, width, length, measureUnit: unit });
      const copy = await owner.post(`/quotes/${created.body.id}/duplicate`, {});
      expect(copy.body.items[0]).toMatchObject({ quantity: 3.75, width, measureUnit: unit });
    }
    const invalid = await quote({
      items: [{ productId, quantity: 1, width: 1, length: 1, measureUnit: 'km' }],
    });
    expect(invalid.status).toBe(400);
  });

  it('exige as duas medidas e recusa área pequena demais', async () => {
    const partial = await quote({ items: [{ productId, quantity: 1, width: 2 }] });
    expect(partial.status).toBe(400);
    const tiny = await quote({ items: [{ productId, quantity: 1, width: 0.01, length: 0.01 }] });
    expect(tiny.status).toBe(400);
  });

  it('a opção da empresa chega ao perfil de quem não vê as configurações', async () => {
    const group = await owner.post('/access-groups', { name: 'Só orçamentos', permissions: ['quotes.read'] });
    const member = await addMember(app, owner, group.body.id);
    expect((await member.get('/auth/me')).body.company.useMeasures).toBe(false);
    expect((await member.get('/company')).status).toBe(403);

    const company = (await owner.get('/company')).body;
    const saved = await owner.put('/company', {
      ...company,
      meiAnnualLimit: 81000,
      useMeasures: true,
      measureUnit: 'cm',
    });
    expect(saved.body).toMatchObject({ useMeasures: true, measureUnit: 'cm' });
    expect((await member.get('/auth/me')).body.company).toMatchObject({
      useMeasures: true,
      measureUnit: 'cm',
    });
  });
});
