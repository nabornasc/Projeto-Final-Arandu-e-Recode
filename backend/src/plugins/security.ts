import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import { forbidden } from '../lib/errors.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function registerSecurity(app: FastifyInstance): Promise<void> {
  await app.register(helmet);

  // Em testes o limite fica desligado para não interferir nos cenários.
  if (config.NODE_ENV !== 'test') {
    await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  }

  // Proteção contra CSRF, junto com o cookie SameSite=Lax:
  // 1) só aceitamos corpo JSON (formulários de outros sites não conseguem enviar JSON sem CORS);
  app.removeContentTypeParser('text/plain');
  // 2) requisições que alteram dados precisam vir de uma origem autorizada.
  app.addHook('onRequest', async (request) => {
    if (SAFE_METHODS.has(request.method)) return;
    const origin = request.headers.origin;
    if (origin && !config.ALLOWED_ORIGINS.includes(origin)) throw forbidden('Origem não autorizada.');
    if (!origin && request.headers['sec-fetch-site'] === 'cross-site')
      throw forbidden('Origem não autorizada.');
  });
}
