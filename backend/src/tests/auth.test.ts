import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, login, PASSWORD } from './helpers.ts';

let app: FastifyInstance;
beforeAll(async () => {
  app = await createApp();
});
afterAll(() => app.close());

const register = (email: string, password = PASSWORD) =>
  app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { companyName: 'Loja', name: 'Maria', email, password },
  });

describe('autenticação', () => {
  it('cadastra empresa, cria sessão com cookie seguro e encerra no logout', async () => {
    const created = await register('maria@auth.test');
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      email: 'maria@auth.test',
      group: { name: 'Proprietário', isOwner: true },
    });

    const setCookie = String(created.headers['set-cookie']);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    const cookie = setCookie.split(';')[0] ?? '';

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);

    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect(out.statusCode).toBe(204);

    // O token antigo não vale mais, mesmo que alguém o tenha guardado.
    const after = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(after.statusCode).toBe(401);
  });

  it('não armazena a senha em texto puro e aceita login com e-mail em maiúsculas', async () => {
    await register('joao@auth.test');
    const ok = await login(app, 'JOAO@AUTH.TEST');
    expect(ok.statusCode).toBe(200);
  });

  it('recusa senha errada e e-mail inexistente com a mesma mensagem', async () => {
    await register('ana@auth.test');
    const wrong = await login(app, 'ana@auth.test', 'senha-errada-000');
    const missing = await login(app, 'ninguem@auth.test');
    expect(wrong.statusCode).toBe(401);
    expect(missing.statusCode).toBe(401);
    expect(wrong.json().message).toBe(missing.json().message);
  });

  it('recusa e-mail duplicado e senha curta', async () => {
    await register('dup@auth.test');
    expect((await register('DUP@auth.test')).statusCode).toBe(409);
    expect((await register('curta@auth.test', '123')).statusCode).toBe(400);
  });

  it('bloqueia rotas protegidas sem sessão', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/customers' });
    expect(response.statusCode).toBe(401);
  });
});
