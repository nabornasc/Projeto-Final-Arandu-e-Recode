import type { FastifyInstance } from 'fastify';
import { clearSessionCookie, ctxOf, requireAuth, SESSION_COOKIE, setSessionCookie } from '../plugins/auth.ts';
import { getProfile, login, logout, register } from '../services/auth.ts';

// Limite mais rígido nas rotas de credenciais (força bruta).
const strictLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/register', { config: strictLimit }, async (request, reply) => {
    const { session, ctx } = await register(request.body as never);
    setSessionCookie(reply, session);
    reply.status(201);
    return getProfile(ctx);
  });

  app.post('/auth/login', { config: strictLimit }, async (request, reply) => {
    const { session, ctx } = await login(request.body as never);
    setSessionCookie(reply, session);
    return getProfile(ctx);
  });

  app.post('/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await logout(token);
    clearSessionCookie(reply);
    return reply.status(204).send();
  });

  app.get('/auth/me', { preHandler: requireAuth }, (request) => getProfile(ctxOf(request)));
}
