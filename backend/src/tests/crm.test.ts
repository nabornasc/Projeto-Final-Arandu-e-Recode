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

const lead = (overrides: Record<string, unknown> = {}) => ({
  name: 'Maria Souza',
  source: 'Instagram',
  ...overrides,
});

describe('CRM', () => {
  it('cadastra lead com responsável padrão, registra atendimento e percorre o funil', async () => {
    const created = await seller.post(
      '/leads',
      lead({ phone: '(66) 99999-0000', nextActionAt: '2026-11-10' }),
    );
    expect(created.status).toBe(201);
    const sellerId = (await seller.get('/auth/me')).body.id;
    expect(created.body).toMatchObject({ stage: 'new', ownerId: sellerId, customerId: null });

    const id = created.body.id;
    const contacted = await seller.post(`/leads/${id}/interactions`, {
      channel: 'whatsapp',
      description: 'Pediu orçamento de 50 cadernos.',
    });
    expect(contacted.status).toBe(201);
    expect(contacted.body.interactions[0]).toMatchObject({ channel: 'whatsapp', userName: 'Membro' });

    expect((await seller.post(`/leads/${id}/stage`, { stage: 'negotiation' })).body.stage).toBe(
      'negotiation',
    );
    expect((await seller.post(`/leads/${id}/stage`, { stage: 'lost' })).status).toBe(400);
    const lost = await seller.post(`/leads/${id}/stage`, { stage: 'lost', lostReason: 'Preço' });
    expect(lost.body).toMatchObject({ stage: 'lost', lostReason: 'Preço' });
  });

  it('lead ganho vira cliente uma única vez e reaproveita cliente com mesmo e-mail ou telefone', async () => {
    const before = (await owner.get('/customers')).body.length;
    const won = (await owner.post('/leads', lead({ name: 'João', email: 'JOAO@x.test' }))).body;
    const moved = await owner.post(`/leads/${won.id}/stage`, { stage: 'won' });
    expect(moved.body.customerId).not.toBeNull();
    expect((await owner.get('/customers')).body).toHaveLength(before + 1);

    // Voltar e ganhar de novo não duplica.
    await owner.post(`/leads/${won.id}/stage`, { stage: 'negotiation' });
    await owner.post(`/leads/${won.id}/stage`, { stage: 'won' });
    expect((await owner.get('/customers')).body).toHaveLength(before + 1);

    // Outro lead com o mesmo e-mail é vinculado ao cliente existente.
    const twin = (await owner.post('/leads', lead({ name: 'João S.', email: 'joao@x.test' }))).body;
    const linked = await owner.post(`/leads/${twin.id}/stage`, { stage: 'won' });
    expect(linked.body.customerId).toBe(moved.body.customerId);
    expect((await owner.get('/customers')).body).toHaveLength(before + 1);
  });

  it('escopo "só os próprios" usa o responsável; contador não acessa o CRM', async () => {
    const groups: { id: number; name: string }[] = (await owner.get('/access-groups')).body;
    const restricted = (
      await owner.post('/access-groups', {
        name: 'SDR',
        ownOnly: true,
        permissions: ['leads.create', 'leads.update'],
      })
    ).body;
    const ana = await addMember(app, owner, restricted.id);
    const bia = await addMember(app, owner, restricted.id);
    const anaLead = (await ana.post('/leads', lead({ name: 'Lead da Ana' }))).body;

    expect((await bia.get('/leads')).body).toEqual([]);
    expect((await bia.get(`/leads/${anaLead.id}`)).status).toBe(404);
    expect((await bia.post(`/leads/${anaLead.id}/stage`, { stage: 'won' })).status).toBe(404);
    // Não pode passar o lead para outra pessoa nem criar em nome de outra.
    const ownerId = (await owner.get('/auth/me')).body.id;
    expect((await ana.post('/leads', lead({ ownerId }))).status).toBe(400);
    expect((await bia.get('/leads/owners')).body).toHaveLength(1);
    // Sem customers.create, ganhar um lead sem cliente correspondente é recusado.
    expect((await ana.post(`/leads/${anaLead.id}/stage`, { stage: 'won' })).status).toBe(403);
    // O proprietário vê todos.
    expect((await owner.get('/leads')).body.map((l: { id: number }) => l.id)).toContain(anaLead.id);

    const accountant = await addMember(app, owner, 'accountant');
    expect((await accountant.get('/leads')).status).toBe(403);
    expect(groups.length).toBeGreaterThan(0);
  });

  it('leads de outra empresa ficam invisíveis', async () => {
    const mine = (await owner.post('/leads', lead())).body;
    const other = await signupCompany(app);
    expect((await other.get(`/leads/${mine.id}`)).status).toBe(404);
    expect(
      (await other.post(`/leads/${mine.id}/interactions`, { channel: 'phone', description: 'x' })).status,
    ).toBe(404);
    expect((await other.del(`/leads/${mine.id}`)).status).toBe(404);
  });
});
