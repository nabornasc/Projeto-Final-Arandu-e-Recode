import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isProduction } from '../config.ts';
import type { Ctx } from '../lib/context.ts';
import { unauthorized } from '../lib/errors.ts';
import { resolveSession, type SessionResult } from '../services/auth.ts';

declare module 'fastify' {
  interface FastifyRequest {
    ctx: Ctx | null;
  }
}

// O prefixo __Host- exige HTTPS e impede que subdomínios sobrescrevam o cookie.
export const SESSION_COOKIE = isProduction ? '__Host-sid' : 'sid';

export function setSessionCookie(reply: FastifyReply, session: SessionResult): void {
  reply.setCookie(SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    expires: session.expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  await app.register(cookie);
  app.decorateRequest('ctx', null);

  app.addHook('onRequest', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return;
    const session = await resolveSession(token);
    if (!session) {
      clearSessionCookie(reply);
      return;
    }
    request.ctx = session.ctx;
    if (session.renewed) setSessionCookie(reply, session.renewed);
  });
}

// Usado como preHandler nas rotas protegidas.
export async function requireAuth(request: FastifyRequest): Promise<void> {
  if (!request.ctx) throw unauthorized();
}

export function ctxOf(request: FastifyRequest): Ctx {
  if (!request.ctx) throw unauthorized();
  return request.ctx;
}
