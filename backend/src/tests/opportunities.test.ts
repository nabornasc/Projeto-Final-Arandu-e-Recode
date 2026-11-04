import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, type Client, createApp, signupCompany } from './helpers.ts';

let app: FastifyInstance;
let owner: Client;
let seller: Client;

beforeAll(async () => {
  app = await createApp();
  owner = await signupCompany(app);
  seller = await addMember(app, owner, 'seller');
});
afterAll(() => app.close());

const opportunity = (overrides: Record<string, unknown> = {}) => ({
  title: 'Kits para eventos',
  contactName: 'Maria Souza',
  source: 'Instagram',
  ...overrides,
});
const stagesOf = async (client: Client) =>
  (await client.get('/pipeline-stages')).body as { id: number; name: string; milestone: string | null }[];

describe('oportunidades', () => {
  it('nasce na primeira etapa, com o responsável padrão; atividades ficam no histórico', async () => {
    const created = await seller.post(
      '/opportunities',
      opportunity({ contactPhone: '(66) 99999-0000', estimatedValue: 500 }),
    );
    expect(created.status).toBe(201);
    const sellerId = (await seller.get('/auth/me')).body.id;
    expect(created.body).toMatchObject({
      status: 'open',
      stageName: 'Novo',
      ownerId: sellerId,
      customerId: null,
      estimatedValue: 500,
    });

    const withCall = await seller.post(`/opportunities/${created.body.id}/interactions`, {
      kind: 'call',
      channel: 'phone',
      description: 'Pediu orçamento de 50 cadernos.',
    });
    expect(withCall.status).toBe(201);
    expect(withCall.body.interactions[0]).toMatchObject({
      kind: 'call',
      channel: 'phone',
      userName: 'Membro',
    });
  });

  it('situação é separada da etapa: perdida guarda onde parou e só muda de etapa se reabrir', async () => {
    const stages = await stagesOf(owner);
    const negotiation = stages.find((stage) => stage.milestone === 'negotiation');
    const { id } = (await owner.post('/opportunities', opportunity())).body;
    expect(
      (await owner.post(`/opportunities/${id}/stage`, { stageId: negotiation?.id })).body.stageName,
    ).toBe('Negociação');
    // A mudança manual vale em qualquer direção.
    expect((await owner.post(`/opportunities/${id}/stage`, { stageId: stages[1]?.id })).body.stageName).toBe(
      'Em contato',
    );

    expect((await owner.post(`/opportunities/${id}/status`, { status: 'lost' })).status).toBe(400);
    const lost = await owner.post(`/opportunities/${id}/status`, { status: 'lost', lostReason: 'Preço' });
    expect(lost.body).toMatchObject({ status: 'lost', stageName: 'Em contato', lostReason: 'Preço' });
    expect(lost.body.closedAt).not.toBeNull();
    expect((await owner.post(`/opportunities/${id}/stage`, { stageId: stages[0]?.id })).status).toBe(409);

    const reopened = await owner.post(`/opportunities/${id}/status`, { status: 'open' });
    expect(reopened.body).toMatchObject({ status: 'open', lostReason: null, closedAt: null });
  });

  it('ganha vira cliente uma única vez e reaproveita cadastro com mesmo e-mail ou telefone', async () => {
    const before = (await owner.get('/customers')).body.length;
    const first = (
      await owner.post('/opportunities', opportunity({ contactName: 'João', contactEmail: 'JOAO@x.test' }))
    ).body;
    const won = await owner.post(`/opportunities/${first.id}/status`, { status: 'won' });
    expect(won.body.customerId).not.toBeNull();
    expect((await owner.get('/customers')).body).toHaveLength(before + 1);

    await owner.post(`/opportunities/${first.id}/status`, { status: 'open' });
    await owner.post(`/opportunities/${first.id}/status`, { status: 'won' });
    expect((await owner.get('/customers')).body).toHaveLength(before + 1);

    const twin = (
      await owner.post('/opportunities', opportunity({ contactName: 'João S.', contactEmail: 'joao@x.test' }))
    ).body;
    const linked = await owner.post(`/opportunities/${twin.id}/status`, { status: 'won' });
    expect(linked.body.customerId).toBe(won.body.customerId);
    expect((await owner.get('/customers')).body).toHaveLength(before + 1);
  });

  it('itens de interesse são guardados e conferidos contra a empresa', async () => {
    const productId = (
      await owner.post('/products', { name: 'Caderno', type: 'product', price: 20, stock: 5 })
    ).body.id;
    const { id, items } = (
      await owner.post('/opportunities', opportunity({ items: [{ productId, quantity: 50 }] }))
    ).body;
    expect(items[0]).toMatchObject({ productName: 'Caderno', quantity: 50 });
    const other = await signupCompany(app);
    expect(
      (await other.post('/opportunities', opportunity({ items: [{ productId, quantity: 1 }] }))).status,
    ).toBe(400);
    // Sem a lista no corpo, os itens ficam como estavam.
    const kept = await owner.put(`/opportunities/${id}`, opportunity({ title: 'Novo título' }));
    expect(kept.body).toMatchObject({ title: 'Novo título' });
    expect(kept.body.items).toHaveLength(1);
  });

  it('produto arquivado continua como item de interesse, mas não entra em item novo', async () => {
    const product = (await owner.post('/products', { name: 'Brinde', type: 'product', price: 5, stock: 10 }))
      .body;
    const items = [{ productId: product.id, quantity: 2 }];
    const { id } = (await owner.post('/opportunities', opportunity({ items }))).body;

    // Em uso numa oportunidade: arquiva em vez de excluir.
    expect((await owner.del(`/products/${product.id}`)).status).toBe(204);
    const archived = (await owner.get('/products')).body as { id: number }[];
    expect(archived.some((row) => row.id === product.id)).toBe(false);

    const edited = await owner.put(`/opportunities/${id}`, opportunity({ items, nextAction: 'Ligar' }));
    expect(edited.status).toBe(200);
    expect(edited.body.items[0].productId).toBe(product.id);
    expect((await owner.post('/opportunities', opportunity({ items }))).status).toBe(400);
  });

  it('mudar a situação exige o estado certo: encerrada precisa ser reaberta antes', async () => {
    const { id } = (await owner.post('/opportunities', opportunity())).body;
    const status = (body: Record<string, unknown>) => owner.post(`/opportunities/${id}/status`, body);
    expect((await status({ status: 'open' })).status).toBe(409);
    expect((await status({ status: 'won' })).status).toBe(200);
    expect((await status({ status: 'won' })).status).toBe(409);
    expect((await status({ status: 'lost', lostReason: 'Preço' })).status).toBe(409);
    expect((await status({ status: 'open' })).status).toBe(200);
    expect((await status({ status: 'lost', lostReason: 'Preço' })).status).toBe(200);
  });

  it('lista filtra e soma os totais por situação', async () => {
    const company = await signupCompany(app);
    const make = async (estimatedValue: number, extra = {}) =>
      (await company.post('/opportunities', opportunity({ estimatedValue, ...extra }))).body.id;
    await make(100, { source: 'Feira' });
    const wonId = await make(200, { source: 'Feira' });
    const lostId = await make(50, { source: 'Site', title: 'Outro negócio' });
    await company.post(`/opportunities/${wonId}/status`, { status: 'won' });
    await company.post(`/opportunities/${lostId}/status`, { status: 'lost', lostReason: 'Prazo de entrega' });

    const all = (await company.get('/opportunities')).body;
    expect(all.items).toHaveLength(3);
    expect(all.totals).toEqual({
      open: { count: 1, value: 100 },
      won: { count: 1, value: 200 },
      lost: { count: 1, value: 50 },
      all: { count: 3, value: 350 },
    });
    expect((await company.get('/opportunities?status=open')).body.items).toHaveLength(1);
    // A situação filtra a lista, mas o rodapé continua mostrando as três.
    expect((await company.get('/opportunities?status=open')).body.totals.all.count).toBe(3);
    expect((await company.get('/opportunities?source=feira')).body.totals.all).toEqual({
      count: 2,
      value: 300,
    });
    expect((await company.get('/opportunities?lostReason=prazo')).body.items).toHaveLength(1);
    expect((await company.get('/opportunities?q=outro')).body.items[0].id).toBe(lostId);
  });

  it('escopo "só os próprios" usa o responsável; contador não acessa; outra empresa não vê', async () => {
    const restricted = (
      await owner.post('/access-groups', {
        name: 'SDR',
        ownOnly: true,
        permissions: ['opportunities.create', 'opportunities.update'],
      })
    ).body;
    const ana = await addMember(app, owner, restricted.id);
    const bia = await addMember(app, owner, restricted.id);
    const mine = (await ana.post('/opportunities', opportunity({ contactName: 'Sem cliente ainda' }))).body;

    expect((await bia.get('/opportunities')).body.items).toEqual([]);
    expect((await bia.get(`/opportunities/${mine.id}`)).status).toBe(404);
    expect((await bia.post(`/opportunities/${mine.id}/status`, { status: 'won' })).status).toBe(404);
    const ownerId = (await owner.get('/auth/me')).body.id;
    expect((await ana.post('/opportunities', opportunity({ ownerId }))).status).toBe(400);
    expect((await bia.get('/opportunities/owners')).body).toHaveLength(1);
    // Sem customers.create, ganhar manualmente sem cliente correspondente é recusado.
    expect((await ana.post(`/opportunities/${mine.id}/status`, { status: 'won' })).status).toBe(403);
    expect((await owner.get('/opportunities')).body.items.map((o: { id: number }) => o.id)).toContain(
      mine.id,
    );

    const accountant = await addMember(app, owner, 'accountant');
    expect((await accountant.get('/opportunities')).status).toBe(403);

    const other = await signupCompany(app);
    expect((await other.get(`/opportunities/${mine.id}`)).status).toBe(404);
    expect((await other.del(`/opportunities/${mine.id}`)).status).toBe(404);
    expect((await other.post(`/opportunities/${mine.id}/interactions`, { description: 'x' })).status).toBe(
      404,
    );
  });
});

describe('etapas do funil por empresa', () => {
  it('empresa nova tem o funil padrão; dá para criar, renomear e reordenar', async () => {
    const company = await signupCompany(app);
    const stages = await stagesOf(company);
    expect(stages.map((stage) => stage.name)).toEqual([
      'Novo',
      'Em contato',
      'Orçamento enviado',
      'Negociação',
    ]);

    const visit = await company.post('/pipeline-stages', { name: 'Visita técnica', color: '#112233' });
    expect(visit.status).toBe(201);
    expect((await company.post('/pipeline-stages', { name: 'visita técnica' })).status).toBe(409);
    expect((await company.post('/pipeline-stages', { name: 'Cor ruim', color: 'azul' })).status).toBe(400);

    const renamed = await company.put(`/pipeline-stages/${visit.body.id}`, {
      name: 'Medição',
      color: '#112233',
    });
    expect(renamed.body.name).toBe('Medição');

    const ids = [visit.body.id, ...stages.map((stage) => stage.id)];
    const reordered = await company.put('/pipeline-stages/order', { ids });
    expect(reordered.body[0].name).toBe('Medição');
    expect((await company.put('/pipeline-stages/order', { ids: ids.slice(1) })).status).toBe(400);
    // A nova oportunidade nasce na etapa com o marco de início; sem o marco, na primeira da ordem.
    expect((await company.post('/opportunities', opportunity())).body.stageName).toBe('Novo');
    await company.put(`/pipeline-stages/${stages[0]?.id}`, {
      name: 'Novo',
      color: '#112233',
      milestone: null,
    });
    expect((await company.post('/opportunities', opportunity())).body.stageName).toBe('Medição');
  });

  it('cada marco fica em uma etapa só; etapa em uso e a última etapa não são excluídas', async () => {
    const company = await signupCompany(app);
    const stages = await stagesOf(company);
    const taken = await company.post('/pipeline-stages', { name: 'Outra', milestone: 'quote_sent' });
    expect(taken.status).toBe(409);
    expect(taken.body.message).toMatch(/Orçamento enviado/);

    const used = (await company.post('/opportunities', opportunity())).body;
    expect((await company.del(`/pipeline-stages/${used.stageId}`)).status).toBe(409);
    const free = stages.filter((stage) => stage.id !== used.stageId);
    for (const stage of free) expect((await company.del(`/pipeline-stages/${stage.id}`)).status).toBe(204);
    await company.del(`/opportunities/${used.id}`);
    expect((await company.del(`/pipeline-stages/${used.stageId}`)).status).toBe(400);
  });

  it('configurar exige permissão própria e fica restrito à empresa', async () => {
    const stage = (await stagesOf(owner))[0];
    expect((await seller.get('/pipeline-stages')).status).toBe(200);
    expect((await seller.post('/pipeline-stages', { name: 'X' })).status).toBe(403);
    const other = await signupCompany(app);
    expect((await other.put(`/pipeline-stages/${stage?.id}`, { name: 'Invadido' })).status).toBe(404);
    expect((await other.post('/opportunities', opportunity({ stageId: stage?.id }))).status).toBe(400);
  });
});
