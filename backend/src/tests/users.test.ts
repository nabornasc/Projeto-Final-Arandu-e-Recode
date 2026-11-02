import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  type Client,
  createApp,
  type DefaultRole,
  groupIds,
  login,
  PASSWORD,
  signupCompany,
} from './helpers.ts';

let app: FastifyInstance;
let owner: Client;
let ownerId: number;
let G: Record<DefaultRole, number>;

beforeAll(async () => {
  app = await createApp();
  owner = await signupCompany(app);
  ownerId = (await owner.get('/auth/me')).body.id;
  G = await groupIds(owner);
});
afterAll(() => app.close());

describe('gestão de usuários', () => {
  it('proprietário convida com senha inicial; a pessoa entra e não vê a gestão', async () => {
    const seller = await addMember(app, owner, 'seller');
    expect((await seller.get('/auth/me')).body.group.name).toBe('Vendedor');
    expect((await seller.get('/users')).status).toBe(403);
    expect(
      (await seller.post('/users', { name: 'X', email: 'x@x.test', groupId: G.owner, password: PASSWORD }))
        .status,
    ).toBe(403);

    const list = (await owner.get('/users')).body;
    expect(list).toHaveLength(2);
    expect(list[0]).not.toHaveProperty('passwordHash');
  });

  it('recusa e-mail repetido e senha curta', async () => {
    const email = (await owner.get('/auth/me')).body.email;
    expect(
      (await owner.post('/users', { name: 'Y', email, groupId: G.seller, password: PASSWORD })).status,
    ).toBe(409);
    expect(
      (await owner.post('/users', { name: 'Y', email: 'y@y.test', groupId: G.seller, password: 'curta' }))
        .status,
    ).toBe(400);
  });

  it('desativar encerra a sessão e impede o login; trocar o grupo vale na hora', async () => {
    const member = await addMember(app, owner, 'seller');
    const promoted = await owner.put(`/users/${member.userId}`, {
      name: 'Membro',
      groupId: G.accountant,
      active: true,
    });
    expect(promoted.body.groupName).toBe('Contador');
    expect((await member.get('/auth/me')).body.group.name).toBe('Contador');

    await owner.put(`/users/${member.userId}`, { name: 'Membro', groupId: G.accountant, active: false });
    expect((await member.get('/auth/me')).status).toBe(401);
    const email = (await owner.get(`/users/${member.userId}`)).body.email;
    expect((await login(app, email)).statusCode).toBe(401);
  });

  it('nova senha definida pelo proprietário substitui a anterior e encerra as sessões', async () => {
    const member = await addMember(app, owner, 'seller');
    const email = (await owner.get(`/users/${member.userId}`)).body.email;
    const changed = await owner.put(`/users/${member.userId}`, {
      name: 'Membro',
      groupId: G.seller,
      active: true,
      password: 'senha-nova-123456',
    });
    expect(changed.status).toBe(200);
    expect((await member.get('/auth/me')).status).toBe(401);
    expect((await login(app, email)).statusCode).toBe(401);
    expect((await login(app, email, 'senha-nova-123456')).statusCode).toBe(200);
  });

  it('proprietário não remove o próprio acesso e a empresa mantém um proprietário ativo', async () => {
    const self = await owner.put(`/users/${ownerId}`, { name: 'Dono', groupId: G.seller, active: true });
    expect(self.status).toBe(400);
    expect(
      (await owner.put(`/users/${ownerId}`, { name: 'Dono', groupId: G.owner, active: false })).status,
    ).toBe(400);
    // Renomear a si mesmo continua permitido.
    expect(
      (await owner.put(`/users/${ownerId}`, { name: 'Dono Renomeado', groupId: G.owner, active: true }))
        .status,
    ).toBe(200);

    // Um segundo proprietário pode rebaixar o primeiro, mas não se ele for o último.
    const second = await addMember(app, owner, 'owner');
    expect(
      (await second.put(`/users/${ownerId}`, { name: 'Dono', groupId: G.seller, active: true })).status,
    ).toBe(200);
    expect((await owner.get('/users')).status).toBe(403);
  });
});
