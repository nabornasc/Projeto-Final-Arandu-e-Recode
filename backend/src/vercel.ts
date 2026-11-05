// Ponto de entrada da API na Vercel: a função recebe cada requisição e entrega ao Fastify.
// A instância é criada uma vez e reaproveitada enquanto a função estiver ativa.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';

let ready: Promise<FastifyInstance> | undefined;

export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  ready ??= buildApp().then(async (app) => {
    await app.ready();
    return app;
  });
  const app = await ready;
  app.server.emit('request', request, response);
}
