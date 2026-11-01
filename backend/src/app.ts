import Fastify, { type FastifyInstance } from 'fastify';
import { config, isProduction } from './config.ts';
import { registerAuth } from './plugins/auth.ts';
import { registerErrorHandler } from './plugins/errorHandler.ts';
import { registerSecurity } from './plugins/security.ts';
import { apiRoutes } from './routes/index.ts';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : { level: isProduction ? 'info' : 'debug' },
    // Atrás do proxy da Vercel o IP real vem em X-Forwarded-For; localmente, não confiamos no cabeçalho.
    trustProxy: isProduction,
    bodyLimit: 1024 * 1024,
  });

  registerErrorHandler(app);
  await registerSecurity(app);
  await registerAuth(app);
  await app.register(apiRoutes, { prefix: '/api' });
  return app;
}
