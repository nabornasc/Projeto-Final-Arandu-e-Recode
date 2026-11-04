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
  await owner.post('/bank-accounts', {
    bankName: 'B',
    accountName: 'C',
    accountType: 'cash',
    initialBalance: 0,
  });
  productId = (await owner.post('/products', { name: 'Vaso', type: 'product', price: 40, stock: 500 })).body
    .id;
  customerId = (await owner.post('/customers', { name: 'Cliente' })).body.id;
});
afterAll(() => app.close());

const newOpportunity = async (client: Client = owner, extra: Record<string, unknown> = {}) =>
  (
    await client.post('/opportunities', {
      title: 'Negócio',
      contactName: 'Contato',
      source: 'Site',
      ...extra,
    })
  ).body;
const items = [{ productId: 0, quantity: 1 }];
const quoteBody = (extra: Record<string, unknown> = {}) => ({
  customerId,
  items: items.map((item) => ({ ...item, productId })),
  ...extra,
});
const opportunityOf = async (id: number) => (await owner.get(`/opportunities/${id}`)).body;
const events = (opp: { interactions: { kind: string; description: string }[] }) =>
  opp.interactions.filter((item) => item.kind === 'event').map((item) => item.description);

describe('o ciclo oportunidade → orçamento → pedido → recebimento', () => {
  it('a etapa anda sozinha, o vínculo acompanha e a baixa do financeiro ganha a oportunidade', async () => {
    const finance = await addMember(
      app,
      owner,
      (await owner.post('/access-groups', { name: 'Financeiro', permissions: ['receivables.settle'] })).body
        .id,
    );
    const opp = await newOpportunity();
    expect(opp.stageName).toBe('Novo');

    const quote = (await owner.post('/quotes', quoteBody({ opportunityId: opp.id }))).body;
    expect(quote).toMatchObject({ opportunityId: opp.id, opportunityTitle: 'Negócio' });
    expect((await opportunityOf(opp.id)).estimatedValue).toBe(40);

    await owner.post(`/quotes/${quote.id}/send`);
    expect((await opportunityOf(opp.id)).stageName).toBe('Orçamento enviado');
    await owner.post(`/quotes/${quote.id}/approve`);
    expect((await opportunityOf(opp.id)).stageName).toBe('Negociação');

    const order = (await owner.post(`/quotes/${quote.id}/convert`, { orderDate: today() })).body;
    expect(order).toMatchObject({ opportunityId: opp.id, originQuoteId: quote.id, originKind: 'converted' });

    // Quem dá baixa não tem permissão no CRM nem em clientes: o efeito é do sistema.
    expect((await finance.post(`/receivables/${order.id}/settle`, {})).status).toBe(200);
    const won = await opportunityOf(opp.id);
    expect(won).toMatchObject({ status: 'won', stageName: 'Negociação', customerId });
    expect(won.values).toMatchObject({ estimated: 40, inQuotes: 0, inOrders: 40, received: 40 });
    expect(events(won).join(' | ')).toMatch(/recebido → ganha/);
    expect(events(won).join(' | ')).toMatch(/enviado → etapa "Orçamento enviado"/);
  });

  it('a etapa nunca volta sozinha', async () => {
    const stages = (await owner.get('/pipeline-stages')).body as { id: number; milestone: string | null }[];
    const negotiation = stages.find((stage) => stage.milestone === 'negotiation');
    const opp = await newOpportunity();
    await owner.post(`/opportunities/${opp.id}/stage`, { stageId: negotiation?.id });
    const quote = (await owner.post('/quotes', quoteBody({ opportunityId: opp.id }))).body;
    await owner.post(`/quotes/${quote.id}/send`);
    expect((await opportunityOf(opp.id)).stageName).toBe('Negociação');
  });

  it('orçamento a partir de oportunidade sem cliente cadastra o contato, sem duplicar', async () => {
    const before = (await owner.get('/customers')).body.length;
    const opp = await newOpportunity(owner, { contactName: 'Nova Cliente', contactEmail: 'nova@x.test' });
    const quote = (await owner.post('/quotes', { items: quoteBody().items, opportunityId: opp.id })).body;
    const updated = await opportunityOf(opp.id);
    expect(updated.customerId).not.toBeNull();
    expect(quote.customerId).toBe(updated.customerId);
    expect((await owner.get('/customers')).body).toHaveLength(before + 1);

    const twin = await newOpportunity(owner, { contactName: 'Mesma', contactEmail: 'nova@x.test' });
    await owner.post('/quotes', { items: quoteBody().items, opportunityId: twin.id });
    expect((await opportunityOf(twin.id)).customerId).toBe(updated.customerId);
    expect((await owner.get('/customers')).body).toHaveLength(before + 1);
  });
});

describe('duplicar e copiar mantêm o rastreio', () => {
  it('duplicado guarda a origem e fica na oportunidade, salvo se desmarcar', async () => {
    const opp = await newOpportunity();
    const quote = (await owner.post('/quotes', quoteBody({ opportunityId: opp.id }))).body;

    const kept = (await owner.post(`/quotes/${quote.id}/duplicate`)).body;
    expect(kept).toMatchObject({ opportunityId: opp.id, originQuoteId: quote.id, originKind: 'duplicated' });

    const loose = (await owner.post(`/quotes/${quote.id}/duplicate`, { keepOpportunity: false })).body;
    expect(loose).toMatchObject({ opportunityId: null, originQuoteId: quote.id, originKind: 'duplicated' });

    const order = (await owner.post(`/quotes/${quote.id}/copy-to-order`, { orderDate: today() })).body;
    expect(order).toMatchObject({
      opportunityId: opp.id,
      originQuoteId: quote.id,
      originKind: 'copied',
      quoteId: null,
    });
    const back = (await owner.post(`/orders/${order.id}/copy-to-quote`)).body;
    expect(back).toMatchObject({ opportunityId: opp.id, originOrderId: order.id, originKind: 'copied' });
    const twin = (await owner.post(`/orders/${order.id}/duplicate`, { orderDate: today() })).body;
    expect(twin).toMatchObject({ opportunityId: opp.id, originOrderId: order.id, originKind: 'duplicated' });

    // A cadeia completa aparece a partir de qualquer ponto, inclusive do duplicado avulso.
    const trace = (await owner.get(`/trace/quote/${loose.id}`)).body;
    expect(trace.opportunity).toBeNull();
    expect(trace.roots).toHaveLength(1);
    expect(trace.roots[0]).toMatchObject({ type: 'quote', id: quote.id });
    const children = trace.roots[0].children;
    expect(children.map((c: { kind: string }) => c.kind).sort()).toEqual([
      'copied',
      'duplicated',
      'duplicated',
    ]);
    const copied = children.find((c: { type: string }) => c.type === 'order');
    expect(copied.children.map((c: { type: string }) => c.type).sort()).toEqual(['order', 'quote']);

    const fromOpportunity = (await owner.get(`/trace/opportunity/${opp.id}`)).body;
    expect(fromOpportunity.opportunity).toMatchObject({ id: opp.id, title: 'Negócio' });
    expect(fromOpportunity.roots[0].id).toBe(quote.id);
  });

  it('orçamento copiado em pedido não conta em dobro; cancelado o pedido, volta a contar', async () => {
    const opp = await newOpportunity();
    const quote = (await owner.post('/quotes', quoteBody({ opportunityId: opp.id }))).body;
    expect((await opportunityOf(opp.id)).values).toMatchObject({ inQuotes: 40, inOrders: 0 });

    const order = (await owner.post(`/quotes/${quote.id}/copy-to-order`, { orderDate: today() })).body;
    expect(order.opportunityId).toBe(opp.id);
    expect((await opportunityOf(opp.id)).values).toMatchObject({ inQuotes: 0, inOrders: 40 });

    expect((await owner.put(`/orders/${order.id}`, { status: 'cancelled', reason: 'Desistiu' })).status).toBe(
      200,
    );
    expect((await opportunityOf(opp.id)).values).toMatchObject({ inQuotes: 40, inOrders: 0 });
  });

  it('o rastreio informa a data do recebimento', async () => {
    const order = (
      await owner.post('/orders', { orderDate: today(), status: 'paid', items: quoteBody().items })
    ).body;
    const trace = (await owner.get(`/trace/order/${order.id}`)).body;
    expect(trace.roots[0]).toMatchObject({ type: 'order', receivedAt: today() });
  });
});

describe('vincular, desvincular e criar a partir do documento', () => {
  it('documento avulso entra na oportunidade, o vínculo desce pela cadeia e a etapa acompanha', async () => {
    const quote = (await owner.post('/quotes', quoteBody())).body;
    await owner.post(`/quotes/${quote.id}/send`);
    await owner.post(`/quotes/${quote.id}/approve`);
    const order = (await owner.post(`/quotes/${quote.id}/convert`, { orderDate: today() })).body;
    const copy = (await owner.post(`/quotes/${quote.id}/duplicate`)).body;
    const other = await newOpportunity();
    const elsewhere = (await owner.post(`/quotes/${quote.id}/duplicate`)).body;
    await owner.post(`/quotes/${elsewhere.id}/link`, { opportunityId: other.id });

    const opp = await newOpportunity();
    const linked = await owner.post(`/quotes/${quote.id}/link`, { opportunityId: opp.id });
    expect(linked.status).toBe(200);
    expect((await owner.get(`/orders/${order.id}`)).body.opportunityId).toBe(opp.id);
    expect((await owner.get(`/quotes/${copy.id}`)).body.opportunityId).toBe(opp.id);
    // O que já está em outra oportunidade não é arrastado.
    expect((await owner.get(`/quotes/${elsewhere.id}`)).body.opportunityId).toBe(other.id);
    const current = await opportunityOf(opp.id);
    expect(current).toMatchObject({ stageName: 'Negociação', customerId, estimatedValue: 40 });
    expect(events(current).join(' | ')).toMatch(/vinculado/);

    // Desvincular tira o documento e os filhos da mesma oportunidade; a origem continua registrada.
    expect((await owner.post(`/quotes/${quote.id}/link`, { opportunityId: null })).status).toBe(200);
    expect((await owner.get(`/orders/${order.id}`)).body).toMatchObject({
      opportunityId: null,
      originQuoteId: quote.id,
    });
    expect(events(await opportunityOf(opp.id)).join(' | ')).toMatch(/desvinculado/);
  });

  it('cria a oportunidade a partir do documento; vínculo pago vira ganho', async () => {
    const quote = (await owner.post('/quotes', quoteBody())).body;
    await owner.post(`/quotes/${quote.id}/send`);
    const created = await owner.post(`/quotes/${quote.id}/opportunity`);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      source: 'Orçamento',
      customerId,
      estimatedValue: 40,
      stageName: 'Orçamento enviado',
    });
    expect((await owner.post(`/quotes/${quote.id}/opportunity`)).status).toBe(409);

    const paid = (
      await owner.post('/orders', {
        orderDate: today(),
        status: 'paid',
        customerId,
        items: quoteBody().items,
      })
    ).body;
    const fromOrder = (await owner.post(`/orders/${paid.id}/opportunity`)).body;
    expect(fromOrder).toMatchObject({ status: 'won', source: 'Pedido' });
  });

  it('respeita permissões, escopo e empresa', async () => {
    const seller = await addMember(app, owner, 'seller');
    const accountant = await addMember(app, owner, 'accountant');
    const opp = await newOpportunity();
    const quote = (await owner.post('/quotes', quoteBody())).body;

    expect((await accountant.post(`/quotes/${quote.id}/link`, { opportunityId: opp.id })).status).toBe(403);
    expect((await accountant.post(`/quotes/${quote.id}/opportunity`)).status).toBe(403);
    // O contador lê orçamentos, mas não o CRM: vê o documento sem o título da oportunidade.
    await owner.post(`/quotes/${quote.id}/link`, { opportunityId: opp.id });
    const seen = (await accountant.get(`/quotes/${quote.id}`)).body;
    expect(seen).toMatchObject({ opportunityId: opp.id, opportunityTitle: null });
    expect((await accountant.get(`/trace/quote/${quote.id}`)).body.opportunity).toBeNull();
    expect((await accountant.post('/quotes', quoteBody({ opportunityId: opp.id }))).status).toBe(403);

    // Vendedor sem CRM do outro responsável segue enviando; a automação é do sistema.
    expect((await seller.post(`/quotes/${quote.id}/send`)).status).toBe(200);

    const other = await signupCompany(app);
    expect((await other.get(`/trace/quote/${quote.id}`)).status).toBe(404);
    expect((await other.get(`/trace/opportunity/${opp.id}`)).status).toBe(404);
    expect((await other.post(`/quotes/${quote.id}/link`, { opportunityId: null })).status).toBe(404);
    const theirQuote = await (async () => {
      const product = (await other.post('/products', { name: 'P', type: 'service', price: 1 })).body.id;
      return (await other.post('/quotes', { items: [{ productId: product, quantity: 1 }] })).body;
    })();
    expect((await other.post(`/quotes/${theirQuote.id}/link`, { opportunityId: opp.id })).status).toBe(400);
  });

  it('título gerado do documento respeita o limite, mesmo com nome de cliente longo', async () => {
    const longName = (await owner.post('/customers', { name: 'N'.repeat(160) })).body;
    const quote = (await owner.post('/quotes', quoteBody({ customerId: longName.id }))).body;
    const created = await owner.post(`/quotes/${quote.id}/opportunity`);
    expect(created.status).toBe(201);
    expect(created.body.title).toHaveLength(160);
  });

  it('"só os próprios": o vínculo não desce para documento de outro usuário', async () => {
    const permissions = ['quotes.create', 'quotes.read', 'quotes.update', 'opportunities.read'];
    const group = (await owner.post('/access-groups', { name: 'Vínculo', ownOnly: true, permissions })).body;
    const bia = await addMember(app, owner, group.id);
    const biaId = (await bia.get('/auth/me')).body.id;
    const hers = (await bia.post('/quotes', quoteBody())).body;
    const ownersCopy = (await owner.post(`/quotes/${hers.id}/duplicate`)).body;
    const opp = await newOpportunity(owner, { ownerId: biaId });

    expect((await bia.post(`/quotes/${hers.id}/link`, { opportunityId: opp.id })).status).toBe(200);
    expect((await owner.get(`/quotes/${hers.id}`)).body.opportunityId).toBe(opp.id);
    expect((await owner.get(`/quotes/${ownersCopy.id}`)).body.opportunityId).toBeNull();
  });

  it('grupo "só os próprios" vê no rastreio apenas os documentos que criou', async () => {
    const group = (
      await owner.post('/access-groups', {
        name: 'Só meus',
        ownOnly: false,
        permissions: ['quotes.create', 'quotes.read', 'orders.read'],
      })
    ).body;
    const restrict = (ownOnly: boolean) =>
      owner.put(`/access-groups/${group.id}`, {
        name: 'Só meus',
        ownOnly,
        permissions: ['quotes.create', 'quotes.read', 'orders.read'],
      });
    const ana = await addMember(app, owner, group.id);

    // Ana duplica um orçamento alheio enquanto ainda pode vê-lo; depois o grupo é restrito.
    const hers = (await owner.post('/quotes', quoteBody())).body;
    const child = (await ana.post(`/quotes/${hers.id}/duplicate`)).body;
    const own = (await ana.post('/quotes', quoteBody())).body;
    const ownersCopy = (await owner.post(`/quotes/${own.id}/duplicate`)).body;
    await restrict(true);

    expect((await ana.get(`/trace/quote/${hers.id}`)).status).toBe(404);
    // Pai oculto: o filho aparece como início da cadeia, sem revelar de quem veio.
    const fromChild = (await ana.get(`/trace/quote/${child.id}`)).body;
    expect(fromChild.roots.map((root: { id: number }) => root.id)).toEqual([child.id]);
    // Filho oculto: a cópia feita por outra pessoa não aparece.
    const fromOwn = (await ana.get(`/trace/quote/${own.id}`)).body;
    expect(fromOwn.roots[0].children).toEqual([]);
    expect(ownersCopy.originQuoteId).toBe(own.id);
    // Quem não tem escopo restrito vê a cadeia inteira.
    const full = (await owner.get(`/trace/quote/${child.id}`)).body;
    expect(full.roots[0].id).toBe(hers.id);
    expect(full.roots[0].children[0].id).toBe(child.id);
  });
});
