import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, type Client, createApp, signupCompany, today } from './helpers.ts';

let app: FastifyInstance;
let owner: Client;
let other: Client;

beforeAll(async () => {
  app = await createApp();
  owner = await signupCompany(app);
  other = await signupCompany(app);
});
afterAll(() => app.close());

const service = async (client: Client) =>
  (await client.post('/products', { name: 'Serviço', type: 'service', price: 10 })).body.id as number;

describe('numeração por empresa', () => {
  it('cada empresa começa no #1 e números simultâneos não se repetem', async () => {
    const mine = await service(owner);
    const theirs = await service(other);
    const order = (client: Client, productId: number) =>
      client.post('/orders', { orderDate: today(), items: [{ productId, quantity: 1 }] });

    expect((await order(other, theirs)).body.number).toBe(1);
    const results = await Promise.all([1, 2, 3].map(() => order(owner, mine)));
    expect(results.map((r) => r.body.number).sort()).toEqual([1, 2, 3]);
    expect((await order(other, theirs)).body.number).toBe(2);
  });
});

describe('configurações da empresa e limite do MEI', () => {
  it('empresa nova começa sem limite e o proprietário precisa informá-lo', async () => {
    expect((await owner.get('/auth/me')).body.company.meiAnnualLimit).toBeNull();
    expect((await owner.get('/dashboard')).body.meiAnnualLimit).toBeNull();

    const missing = await owner.put('/company', { name: 'Empresa' });
    expect(missing.status).toBe(400);
    expect(missing.body.message).toMatch(/limite anual do MEI/);
    expect((await owner.put('/company', { name: 'Empresa', meiAnnualLimit: 0 })).status).toBe(400);

    const saved = await owner.put('/company', { name: 'Empresa Nova', cnpj: '', meiAnnualLimit: 90000 });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ name: 'Empresa Nova', cnpj: null, meiAnnualLimit: 90000 });
    expect((await owner.get('/auth/me')).body.company.meiAnnualLimit).toBe(90000);
  });

  it('o dashboard compara o faturamento do ano com o limite da própria empresa', async () => {
    const dashboard = (await owner.get('/dashboard')).body;
    expect(dashboard.meiAnnualLimit).toBe(90000);
    expect(dashboard.revenueYear).toBe(0); // os pedidos do teste anterior estão pendentes
    expect((await other.get('/dashboard')).body.meiAnnualLimit).toBeNull();
  });

  it('contador só consulta; vendedor não acessa', async () => {
    const accountant = await addMember(app, owner, 'accountant');
    const seller = await addMember(app, owner, 'seller');
    expect((await accountant.get('/company')).status).toBe(200);
    expect((await accountant.put('/company', { name: 'X', meiAnnualLimit: 1 })).status).toBe(403);
    expect((await seller.get('/company')).status).toBe(403);
  });
});
