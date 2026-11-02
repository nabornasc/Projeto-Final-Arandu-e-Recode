import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.ts';

export const PASSWORD = 'senha-de-teste-123';

export async function createApp(): Promise<FastifyInstance> {
  const app = await buildApp();
  await app.ready();
  return app;
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface Client {
  cookie: string;
  companyId: number;
  request(method: Method, url: string, body?: unknown): Promise<{ status: number; body: any }>;
  get(url: string): Promise<{ status: number; body: any }>;
  post(url: string, body?: unknown): Promise<{ status: number; body: any }>;
  put(url: string, body?: unknown): Promise<{ status: number; body: any }>;
  del(url: string): Promise<{ status: number; body: any }>;
}

function cookieFrom(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const cookie = header?.split(';')[0];
  if (!cookie) throw new Error('Resposta sem cookie de sessão.');
  return cookie;
}

function client(app: FastifyInstance, cookie: string, companyId: number): Client {
  const request = async (method: Method, url: string, body?: unknown) => {
    const response = await app.inject({
      method,
      url: `/api${url}`,
      headers: { cookie, origin: 'http://localhost:5173' },
      ...(body === undefined ? {} : { payload: body as object }),
    });
    return { status: response.statusCode, body: response.body ? response.json() : null };
  };
  return {
    cookie,
    companyId,
    request,
    get: (url) => request('GET', url),
    post: (url, body) => request('POST', url, body ?? {}),
    put: (url, body) => request('PUT', url, body ?? {}),
    del: (url) => request('DELETE', url),
  };
}

export async function login(app: FastifyInstance, email: string, password = PASSWORD) {
  return app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
}

// Cria uma empresa nova (com e-mails únicos) e devolve o cliente HTTP do proprietário.
export async function signupCompany(app: FastifyInstance): Promise<Client> {
  const email = `dono-${randomUUID()}@teste.test`;
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { companyName: 'Empresa de teste', name: 'Dono', email, password: PASSWORD },
  });
  if (response.statusCode !== 201) throw new Error(`Cadastro falhou: ${response.body}`);
  return client(app, cookieFrom(response.headers['set-cookie']), response.json().company.id);
}

// Convida um membro pela gestão de usuários do proprietário e devolve o cliente HTTP já logado.
export async function addMember(
  app: FastifyInstance,
  owner: Client,
  role: 'owner' | 'seller' | 'accountant',
) {
  const email = `${role}-${randomUUID()}@teste.test`;
  const created = await owner.post('/users', { name: role, email, role, password: PASSWORD });
  if (created.status !== 201) throw new Error(`Convite falhou: ${JSON.stringify(created.body)}`);
  const response = await login(app, email);
  return Object.assign(client(app, cookieFrom(response.headers['set-cookie']), owner.companyId), {
    userId: created.body.id as number,
  });
}

export const today = () => new Date().toISOString().slice(0, 10);
