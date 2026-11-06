import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, type Client, createApp, signupCompany } from './helpers.ts';

let app: FastifyInstance;
let owner: Client;
let other: Client;
let seller: Client;
let accountant: Client;
let customerId: number;
let productId: number;
let serviceId: number;

const PRODUCT = { name: 'Produto', type: 'product', price: 100, cost: 60, stock: 50 };
const SERVICE = { name: 'Serviço', type: 'service', price: 200, cost: 50 };

const groupId = async (name: string) => {
  const groups = (await owner.get('/access-groups')).body as { id: number; name: string }[];
  const group = groups.find((item) => item.name === name);
  if (!group) throw new Error(`Grupo ${name} não encontrado.`);
  return group.id;
};

beforeAll(async () => {
  app = await createApp();
  owner = await signupCompany(app);
  other = await signupCompany(app);
  seller = await addMember(app, owner, await groupId('Vendedor'));
  accountant = await addMember(app, owner, await groupId('Contador'));
  customerId = (await owner.post('/customers', { name: 'Cliente' })).body.id;
  productId = (await owner.post('/products', PRODUCT)).body.id;
  serviceId = (await owner.post('/products', SERVICE)).body.id;
});
afterAll(() => app.close());

const newQuote = async (extra: Record<string, unknown> = {}) => {
  const { body } = await owner.post('/quotes', {
    customerId,
    items: [
      { productId, quantity: 2 },
      { productId: serviceId, quantity: 1 },
    ],
    ...extra,
  });
  return body.id as number;
};
const internal = (id: number, client = owner) => client.get(`/quotes/${id}/internal-mirror`);
const setCost = (cost: number | null) => owner.put(`/products/${productId}`, { ...PRODUCT, cost });

describe('espelho interno', () => {
  it('calcula a margem sobre os itens menos o desconto, sem contar frete e outras despesas', async () => {
    const id = await newQuote({
      discount: 40,
      freight: 30,
      otherCharges: 10,
      internalNotes: 'Só para a empresa',
    });
    const { status, body } = await internal(id);
    expect(status).toBe(200);
    expect(body.total).toBe(400);
    // Venda 400 - 40 de desconto = 360; custo 2 x 60 + 50 = 170.
    expect(body.margin).toEqual({ revenue: 360, cost: 170, result: 190, percent: 52.78, missingCost: 0 });
    expect(body.summary).toEqual([
      { type: 'product', revenue: 200, cost: 120, result: 80, percent: 40 },
      { type: 'service', revenue: 200, cost: 50, result: 150, percent: 75 },
    ]);
    expect(body.items[0]).toMatchObject({ name: 'Produto', type: 'product', unitCost: 60 });
    expect(body.internalNotes).toBe('Só para a empresa');
  });

  it('não inventa margem quando falta o custo de um item', async () => {
    const noCost = (await owner.post('/products', { name: 'Sem custo', type: 'service', price: 50 })).body.id;
    const id = await newQuote({
      items: [
        { productId, quantity: 1 },
        { productId: noCost, quantity: 1 },
      ],
    });
    const { body } = await internal(id);
    expect(body.margin).toMatchObject({
      revenue: 150,
      cost: null,
      result: null,
      percent: null,
      missingCost: 1,
    });
    expect(body.summary).toEqual([
      { type: 'product', revenue: 100, cost: 60, result: 40, percent: 40 },
      { type: 'service', revenue: 50, cost: null, result: null, percent: null },
    ]);
  });

  it('custo acompanha o cadastro no rascunho, fica fixo no envio e volta a acompanhar ao reabrir', async () => {
    const id = await newQuote();
    await setCost(70);
    expect((await internal(id)).body.items[0].unitCost).toBe(70);

    await owner.post(`/quotes/${id}/send`);
    await setCost(90);
    expect((await internal(id)).body.items[0].unitCost).toBe(70);

    await owner.post(`/quotes/${id}/reopen`, { reason: 'Ajuste' });
    expect((await internal(id)).body.items[0].unitCost).toBe(90);
    await setCost(PRODUCT.cost);
  });

  it('só abre com costs.read, na empresa e no escopo de quem pede', async () => {
    const id = await newQuote();
    expect((await internal(id, seller)).status).toBe(403);
    expect((await internal(id, accountant)).status).toBe(200);
    expect((await internal(id, other)).status).toBe(403 + 1);

    const scopedGroup = await owner.post('/access-groups', {
      name: 'Custos só dos próprios',
      permissions: ['quotes.read', 'costs.read', 'products.read'],
      ownOnly: true,
    });
    const scoped = await addMember(app, owner, scopedGroup.body.id);
    expect((await internal(id, scoped)).status).toBe(404);
  });

  it('custo não vaza no orçamento nem no espelho do cliente', async () => {
    const id = await newQuote();
    await owner.post(`/quotes/${id}/send`);
    for (const path of [`/quotes/${id}`, `/quotes/${id}/mirror`, '/quotes']) {
      const text = JSON.stringify((await seller.get(path)).body);
      expect(text).not.toMatch(/unitCost|unit_cost|"cost"/);
    }
  });
});

describe('custo no cadastro de produtos', () => {
  it('fica oculto para quem não tem costs.read', async () => {
    expect((await seller.get(`/products/${productId}`)).body.cost).toBeNull();
    const list = (await seller.get('/products')).body as { id: number; cost: number | null }[];
    expect(list.every((product) => product.cost === null)).toBe(true);
    expect((await accountant.get(`/products/${productId}`)).body.cost).toBe(PRODUCT.cost);
  });

  it('quem não vê o custo edita o produto sem apagar nem definir o custo', async () => {
    const group = await owner.post('/access-groups', {
      name: 'Edita produtos',
      permissions: ['products.read', 'products.create', 'products.update'],
    });
    const editor = await addMember(app, owner, group.body.id);

    const edited = await editor.put(`/products/${productId}`, { ...PRODUCT, cost: 1, price: 110 });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ price: 110, cost: null });
    expect((await owner.get(`/products/${productId}`)).body).toMatchObject({
      price: 110,
      cost: PRODUCT.cost,
    });
    await owner.put(`/products/${productId}`, PRODUCT);

    const created = await editor.post('/products', { name: 'Novo', type: 'service', price: 10, cost: 5 });
    expect((await owner.get(`/products/${created.body.id}`)).body.cost).toBeNull();
  });

  it('o histórico esconde a mudança de custo de quem audita sem costs.read', async () => {
    const group = await owner.post('/access-groups', { name: 'Auditor', permissions: ['audit.read'] });
    const auditor = await addMember(app, owner, group.body.id);

    await setCost(65);
    const { body } = await owner.get(`/history?module=${encodeURIComponent('Produtos e serviços')}`);
    const entry = body.rows[0] as { id: number } | undefined;
    if (!entry) throw new Error('Sem histórico.');
    const fields = async (client: Client) =>
      ((await client.get(`/history/entry/${entry.id}`)).body.changes as { field: string }[]).map(
        (change) => change.field,
      );
    expect(await fields(owner)).toContain('cost');
    expect(await fields(auditor)).not.toContain('cost');
    await setCost(PRODUCT.cost);
  });
});
