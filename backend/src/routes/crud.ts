import { idParamSchema } from '@arandue/shared/schemas';
import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../lib/context.ts';
import { ctxOf } from '../plugins/auth.ts';

// Rotas REST padrão para um recurso. Validação, permissão e empresa são verificadas no serviço.
export interface CrudService {
  list(ctx: Ctx): Promise<unknown>;
  get(ctx: Ctx, id: number): Promise<unknown>;
  create(ctx: Ctx, input: never): Promise<unknown>;
  update(ctx: Ctx, id: number, input: never): Promise<unknown>;
  remove(ctx: Ctx, id: number): Promise<void>;
}

export function crudRoutes(app: FastifyInstance, path: string, service: CrudService): void {
  app.get(path, (request) => service.list(ctxOf(request)));
  app.get(`${path}/:id`, (request) => service.get(ctxOf(request), idParamSchema.parse(request.params).id));
  app.post(path, async (request, reply) => {
    reply.status(201);
    return service.create(ctxOf(request), request.body as never);
  });
  app.put(`${path}/:id`, (request) =>
    service.update(ctxOf(request), idParamSchema.parse(request.params).id, request.body as never),
  );
  app.delete(`${path}/:id`, async (request, reply) => {
    await service.remove(ctxOf(request), idParamSchema.parse(request.params).id);
    return reply.status(204).send();
  });
}
