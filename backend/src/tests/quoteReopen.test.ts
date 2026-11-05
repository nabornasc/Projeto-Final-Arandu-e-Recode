import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, type Client, createApp, signupCompany, today } from './helpers.ts';

let app: FastifyInstance;
let owner: Client;
let other: Client;
let customerId: number;
let productId: number;

const REASON = { reason: 'Cliente pediu alteração' };

beforeAll(async () => {
  app = await createApp();
  owner = await signupCompany(app);
  other = await signupCompany(app);
  customerId = (await owner.post('/customers', { name: 'Cliente' })).body.id;
  productId = (await owner.post('/products', { name: 'Serviço', type: 'service', price: 100 })).body.id;
});
afterAll(() => app.close());

const items = (quantity: number) => [{ productId, quantity }];
const newQuote = async (...steps: string[]) => {
  const { body } = await owner.post('/quotes', { customerId, items: items(1) });
  for (const step of steps) await owner.post(`/quotes/${body.id}/${step}`, { reason: 'Motivo' });
  return body.id as number;
};

describe('reabrir orçamento', () => {
  it('aprovado volta para rascunho, aceita alteração e passa de novo pelo fluxo', async () => {
    const id = await newQuote('send', 'approve');
    expect((await owner.put(`/quotes/${id}`, { customerId, items: items(2) })).status).toBe(409);

    const reopened = await owner.post(`/quotes/${id}/reopen`, REASON);
    expect(reopened.status).toBe(200);
    expect(reopened.body).toMatchObject({ status: 'draft', decidedAt: null });

    const edited = await owner.put(`/quotes/${id}`, { customerId, items: items(2) });
    expect(edited.body.total).toBe(200);
    // Sem novo envio e nova aprovação, não vira pedido.
    expect((await owner.post(`/quotes/${id}/convert`, { orderDate: today() })).status).toBe(409);

    await owner.post(`/quotes/${id}/send`);
    await owner.post(`/quotes/${id}/approve`);
    const order = await owner.post(`/quotes/${id}/convert`, { orderDate: today() });
    expect(order.body.total).toBe(200);
  });

  it('enviado e recusado também reabrem', async () => {
    for (const steps of [['send'], ['send', 'reject']]) {
      const id = await newQuote(...steps);
      const { body } = await owner.post(`/quotes/${id}/reopen`, REASON);
      expect(body.status).toBe('draft');
    }
  });

  it('o espelho deixa de usar a cópia do envio anterior e o próximo envio grava outra', async () => {
    const id = await newQuote('send');
    await owner.put(`/products/${productId}`, { name: 'Serviço Novo', type: 'service', price: 100 });
    expect((await owner.get(`/quotes/${id}/mirror`)).body.items[0].name).toBe('Serviço');

    await owner.post(`/quotes/${id}/reopen`, REASON);
    expect((await owner.get(`/quotes/${id}/mirror`)).body.items[0].name).toBe('Serviço Novo');

    await owner.post(`/quotes/${id}/send`);
    await owner.put(`/products/${productId}`, { name: 'Serviço', type: 'service', price: 100 });
    expect((await owner.get(`/quotes/${id}/mirror`)).body.items[0].name).toBe('Serviço Novo');
  });

  it('exige motivo, e ele fica no histórico', async () => {
    const id = await newQuote('send');
    expect((await owner.post(`/quotes/${id}/reopen`, {})).status).toBe(400);
    expect((await owner.get(`/quotes/${id}`)).body.status).toBe('sent');

    await owner.post(`/quotes/${id}/reopen`, REASON);
    const lines = (await owner.get(`/history/quote/${id}`)).body as { summary: string; reason: string }[];
    expect(lines.find((line) => line.summary === 'Reabriu para alterar')?.reason).toBe(REASON.reason);
  });

  it('rascunho, cancelado e convertido em pedido não reabrem', async () => {
    const draft = await newQuote();
    expect((await owner.post(`/quotes/${draft}/reopen`, REASON)).status).toBe(409);

    const cancelled = await newQuote('send', 'cancel');
    expect((await owner.post(`/quotes/${cancelled}/reopen`, REASON)).status).toBe(409);

    const converted = await newQuote('send', 'approve');
    await owner.post(`/quotes/${converted}/convert`, { orderDate: today() });
    expect((await owner.post(`/quotes/${converted}/reopen`, REASON)).status).toBe(409);
    expect((await owner.get(`/quotes/${converted}`)).body.status).toBe('approved');
  });

  it('depois de enviado, só o Proprietário exclui; rascunho nunca enviado segue a permissão', async () => {
    const group = await owner.post('/access-groups', {
      name: 'Pode excluir',
      permissions: ['quotes.read', 'quotes.delete'],
    });
    const member = await addMember(app, owner, group.body.id);

    const reopened = await newQuote('send');
    await owner.post(`/quotes/${reopened}/reopen`, REASON);
    const blocked = await member.del(`/quotes/${reopened}`);
    expect(blocked.status).toBe(403);
    expect((await owner.get(`/quotes/${reopened}`)).status).toBe(200);

    // Ao enviar e reabrir de novo, o bloqueio continua.
    await owner.post(`/quotes/${reopened}/send`);
    await owner.post(`/quotes/${reopened}/reopen`, REASON);
    expect((await member.del(`/quotes/${reopened}`)).status).toBe(403);

    expect((await owner.del(`/quotes/${reopened}`)).status).toBe(204);
    expect((await owner.get(`/quotes/${reopened}`)).status).toBe(404);

    const neverSent = await newQuote();
    expect((await member.del(`/quotes/${neverSent}`)).status).toBe(204);
  });

  it('a cópia do orçamento reaberto nasce sem o bloqueio', async () => {
    const id = await newQuote('send');
    await owner.post(`/quotes/${id}/reopen`, REASON);
    const copy = await owner.post(`/quotes/${id}/duplicate`, {});
    expect(copy.body.sentAt).toBeNull();
  });

  it('respeita a empresa, a permissão de editar e o escopo "só os próprios"', async () => {
    const id = await newQuote('send');
    expect((await other.post(`/quotes/${id}/reopen`, REASON)).status).toBe(404);

    const readOnly = await owner.post('/access-groups', { name: 'Só leitura', permissions: ['quotes.read'] });
    const reader = await addMember(app, owner, readOnly.body.id);
    expect((await reader.post(`/quotes/${id}/reopen`, REASON)).status).toBe(403);

    const own = await owner.post('/access-groups', {
      name: 'Só os próprios',
      permissions: ['quotes.read', 'quotes.update'],
      ownOnly: true,
    });
    const scoped = await addMember(app, owner, own.body.id);
    expect((await scoped.post(`/quotes/${id}/reopen`, REASON)).status).toBe(404);
  });
});
