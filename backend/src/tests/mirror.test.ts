import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, type Client, createApp, signupCompany, today } from './helpers.ts';

let app: FastifyInstance;
let owner: Client;
let other: Client;
let customerId: number;
let productId: number;

const COMPANY = {
  name: 'Ateliê do Teste',
  meiAnnualLimit: 81000,
  legalName: 'Ateliê do Teste MEI',
  address: 'Rua A, 10',
  phone: '(65) 3000-0000',
  email: 'contato@atelie.test',
  quoteTerms: 'Validade conforme o orçamento.',
};
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

beforeAll(async () => {
  app = await createApp();
  owner = await signupCompany(app);
  other = await signupCompany(app);
  expect((await owner.put('/company', COMPANY)).status).toBe(200);
  customerId = (
    await owner.post('/customers', {
      name: 'Cliente Espelho',
      document: '529.982.247-25',
      phone: '(65) 3333-4444',
      street: 'Rua do Cliente',
      number: '55',
      city: 'Cuiabá',
      state: 'MT',
    })
  ).body.id;
  productId = (await owner.post('/products', { name: 'Serviço', type: 'service', price: 100 })).body.id;
});
afterAll(() => app.close());

const newQuote = async (extra: Record<string, unknown> = {}) => {
  const response = await owner.post('/quotes', {
    customerId,
    discount: 10,
    freight: 25,
    otherCharges: 5,
    internalNotes: 'Margem apertada',
    siteDescription: 'Loja do centro',
    siteContact: 'Maria - 65 99999-0000',
    siteAddress: 'Rua da Loja, 1',
    items: [{ productId, quantity: 2 }],
    ...extra,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body as { id: number; total: number };
};

describe('frete e outras despesas', () => {
  it('entram no total do orçamento e seguem ao editar e duplicar', async () => {
    const quote = await newQuote();
    expect(quote.total).toBe(220);

    const edited = await owner.put(`/quotes/${quote.id}`, {
      customerId,
      freight: 50,
      items: [{ productId, quantity: 1 }],
    });
    expect(edited.body.total).toBe(150);

    const copy = await owner.post(`/quotes/${quote.id}/duplicate`, {});
    expect(copy.body).toMatchObject({ freight: 50, otherCharges: 0, total: 150 });
  });

  it('o pedido gerado cobra o mesmo total, mesmo depois de editado', async () => {
    const quote = await newQuote();
    await owner.post(`/quotes/${quote.id}/send`);
    await owner.post(`/quotes/${quote.id}/approve`);
    const order = await owner.post(`/quotes/${quote.id}/convert`, { orderDate: today() });
    expect(order.body).toMatchObject({ freight: 25, otherCharges: 5, discount: 10, total: 220 });

    const edited = await owner.put(`/orders/${order.body.id}`, { discount: 20 });
    expect(edited.body.total).toBe(210);

    const back = await owner.post(`/orders/${order.body.id}/copy-to-quote`, {});
    expect(back.body).toMatchObject({ freight: 25, otherCharges: 5, total: 210 });
  });
});

describe('espelho do cliente', () => {
  it('traz os dados do documento, sem a observação interna', async () => {
    const quote = await newQuote({ notes: 'Entrega em 5 dias' });
    const { status, body } = await owner.get(`/quotes/${quote.id}/mirror`);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      discount: 10,
      freight: 25,
      otherCharges: 5,
      total: 220,
      notes: 'Entrega em 5 dias',
      siteDescription: 'Loja do centro',
      issuer: { name: COMPANY.name, legalName: COMPANY.legalName, terms: COMPANY.quoteTerms },
      customer: {
        name: 'Cliente Espelho',
        document: '529.982.247-25',
        address: 'Rua do Cliente, 55 - Cuiabá/MT',
      },
    });
    expect(body.items).toEqual([
      {
        name: 'Serviço',
        quantity: 2,
        unitPrice: 100,
        subtotal: 200,
        groupName: null,
        width: null,
        length: null,
        measureUnit: null,
      },
    ]);
    expect(JSON.stringify(body)).not.toContain('Margem apertada');
  });

  it('depois de enviado, mostra o que o cliente recebeu mesmo que os cadastros mudem', async () => {
    const quote = await newQuote();
    await owner.post(`/quotes/${quote.id}/send`);
    await owner.put('/company', { ...COMPANY, name: 'Outro Nome', logo: PNG });
    await owner.put(`/customers/${customerId}`, { name: 'Cliente Renomeado' });
    await owner.put(`/products/${productId}`, { name: 'Serviço Novo', type: 'service', price: 999 });

    const sent = (await owner.get(`/quotes/${quote.id}/mirror`)).body;
    expect(sent.issuer).toMatchObject({ name: COMPANY.name, logo: null });
    expect(sent.customer.name).toBe('Cliente Espelho');
    expect(sent.items[0].name).toBe('Serviço');

    // Rascunho ainda não saiu da empresa: acompanha os cadastros.
    const draft = await newQuote();
    const current = (await owner.get(`/quotes/${draft.id}/mirror`)).body;
    expect(current.issuer).toMatchObject({ name: 'Outro Nome', logo: PNG });
    expect(current.customer.name).toBe('Cliente Renomeado');

    await owner.put('/company', COMPANY);
    await owner.put(`/customers/${customerId}`, {
      name: 'Cliente Espelho',
      document: '529.982.247-25',
      phone: '(65) 3333-4444',
      street: 'Rua do Cliente',
      number: '55',
      city: 'Cuiabá',
      state: 'MT',
    });
    await owner.put(`/products/${productId}`, { name: 'Serviço', type: 'service', price: 100 });
  });

  it('sem acesso ao cadastro de clientes, mostra só o nome do cliente', async () => {
    const group = await owner.post('/access-groups', { name: 'Só orçamentos', permissions: ['quotes.read'] });
    const member = await addMember(app, owner, group.body.id);
    const quote = await newQuote();

    for (const reload of [false, true]) {
      if (reload) await owner.post(`/quotes/${quote.id}/send`);
      const { customer } = (await member.get(`/quotes/${quote.id}/mirror`)).body;
      expect(customer).toEqual({
        name: 'Cliente Espelho',
        legalName: null,
        document: null,
        email: null,
        phones: null,
        address: null,
      });
    }
  });

  it('respeita a empresa, a permissão e o escopo "só os próprios"', async () => {
    const quote = await newQuote();
    expect((await other.get(`/quotes/${quote.id}/mirror`)).status).toBe(404);

    const noAccess = await owner.post('/access-groups', { name: 'Sem orçamentos', permissions: [] });
    const blocked = await addMember(app, owner, noAccess.body.id);
    expect((await blocked.get(`/quotes/${quote.id}/mirror`)).status).toBe(403);

    const own = await owner.post('/access-groups', {
      name: 'Só os próprios',
      permissions: ['quotes.read'],
      ownOnly: true,
    });
    const scoped = await addMember(app, owner, own.body.id);
    expect((await scoped.get(`/quotes/${quote.id}/mirror`)).status).toBe(404);
  });
});

describe('dados da empresa', () => {
  it('aceita só logo em PNG, JPEG ou WebP, dentro do limite', async () => {
    const put = (logo: string) => owner.put('/company', { ...COMPANY, logo });
    expect((await put(PNG)).body.logo).toBe(PNG);
    expect((await put('data:image/svg+xml;base64,PHN2Zz4=')).status).toBe(400);
    expect((await put('javascript:alert(1)')).status).toBe(400);
    expect((await put(`data:image/png;base64,${'A'.repeat(300_000)}`)).status).toBe(400);
    expect((await owner.put('/company', COMPANY)).body.logo).toBeNull();
  });

  it('o logo não entra no perfil carregado em toda tela', async () => {
    await owner.put('/company', { ...COMPANY, logo: PNG });
    const me = await owner.get('/auth/me');
    expect(JSON.stringify(me.body)).not.toContain('base64');
    await owner.put('/company', COMPANY);
  });
});

describe('histórico', () => {
  it('registra frete e observação interna; contato, endereço e logo aparecem só como alterados', async () => {
    const quote = await newQuote();
    await owner.put(`/quotes/${quote.id}`, {
      customerId,
      freight: 40,
      internalNotes: 'Revisado',
      siteContact: 'João - 65 98888-0000',
      siteAddress: 'Rua Nova, 2',
      items: [{ productId, quantity: 2 }],
    });
    const lines = (await owner.get(`/history/quote/${quote.id}`)).body as { id: number; summary: string }[];
    const update = lines.find((line) => line.summary.startsWith('Alterou'));
    const entry = await owner.get(`/history/entry/${update?.id}`);
    const text = JSON.stringify(entry.body);
    expect(text).toContain('Frete');
    expect(text).toContain('Revisado');
    expect(text).toContain('Endereço do local');
    for (const secret of ['98888', 'Rua Nova', '99999', 'Rua da Loja']) expect(text).not.toContain(secret);

    await owner.put('/company', { ...COMPANY, address: 'Rua Secreta, 9', logo: PNG });
    const company = await owner.get(`/history?module=${encodeURIComponent('Configurações')}`);
    const companyLine = company.body.rows[0] as { id: number };
    const companyEntry = JSON.stringify((await owner.get(`/history/entry/${companyLine.id}`)).body);
    expect(companyEntry).not.toContain('Rua Secreta');
    expect(companyEntry).not.toContain('base64');
    await owner.put('/company', COMPANY);
  });
});
