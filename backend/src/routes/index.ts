import { idParamSchema, opportunityFilterSchema, PERSON_ROLES, TRACE_TYPES } from '@arandue/shared/schemas';
import { sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.ts';
import { ctxOf, requireAuth } from '../plugins/auth.ts';
import * as accessGroups from '../services/accessGroups.ts';
import * as bankAccounts from '../services/bankAccounts.ts';
import * as company from '../services/company.ts';
import * as copies from '../services/copies.ts';
import * as customers from '../services/customers.ts';
import { getDashboard } from '../services/dashboard.ts';
import * as expenses from '../services/expenses.ts';
import * as history from '../services/history.ts';
import * as lookup from '../services/lookup.ts';
import * as opportunities from '../services/opportunities.ts';
import * as orders from '../services/orders.ts';
import * as people from '../services/people.ts';
import * as pipeline from '../services/pipeline.ts';
import * as products from '../services/products.ts';
import * as quotes from '../services/quotes.ts';
import * as suppliers from '../services/suppliers.ts';
import * as trace from '../services/trace.ts';
import * as transactions from '../services/transactions.ts';
import * as users from '../services/users.ts';
import { authRoutes } from './auth.ts';
import { crudRoutes } from './crud.ts';

export async function apiRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => {
    await db.execute(sql`SELECT 1`);
    return { status: 'ok' };
  });

  await app.register(authRoutes);

  // Tudo abaixo exige sessão válida.
  await app.register(async (protectedApp) => {
    protectedApp.addHook('preHandler', requireAuth);

    // Respostas 201 para rotas que criam registros a partir de um id na URL.
    const created =
      (handler: (request: FastifyRequest, id: number) => Promise<unknown>) =>
      async (request: FastifyRequest, reply: FastifyReply) => {
        reply.status(201);
        return handler(request, idParamSchema.parse(request.params).id);
      };

    // Cadastro único de pessoas; /customers e /suppliers são atalhos por papel.
    const peopleQuery = z.object({
      role: z.enum(PERSON_ROLES).optional(),
      q: z.string().trim().max(100).optional(),
    });
    protectedApp.get('/people', (request) =>
      people.listPeople(ctxOf(request), peopleQuery.parse(request.query)),
    );
    protectedApp.get('/people/sellers', (request) => people.listSellerOptions(ctxOf(request)));
    protectedApp.get('/people/:id', (request) =>
      people.getPerson(ctxOf(request), idParamSchema.parse(request.params).id),
    );
    protectedApp.post('/people', async (request, reply) => {
      reply.status(201);
      return people.createPerson(ctxOf(request), request.body as never);
    });
    protectedApp.put('/people/:id', (request) =>
      people.updatePerson(ctxOf(request), idParamSchema.parse(request.params).id, request.body as never),
    );
    protectedApp.delete('/people/:id', async (request, reply) => {
      await people.deletePerson(ctxOf(request), idParamSchema.parse(request.params).id);
      return reply.status(204).send();
    });
    // Consultas externas: limite próprio por usuário para não abusar dos serviços públicos.
    const lookupLimit = { rateLimit: { max: 20, timeWindow: '1 minute' } };
    protectedApp.get('/lookup/cnpj/:cnpj', { config: lookupLimit }, (request) =>
      lookup.lookupCnpj(ctxOf(request), (request.params as { cnpj: string }).cnpj),
    );
    protectedApp.get('/lookup/cep/:cep', { config: lookupLimit }, (request) =>
      lookup.lookupZip(ctxOf(request), (request.params as { cep: string }).cep),
    );
    crudRoutes(protectedApp, '/customers', {
      list: customers.listCustomers,
      get: customers.getCustomer,
      create: customers.createCustomer,
      update: customers.updateCustomer,
      remove: customers.deleteCustomer,
    });
    crudRoutes(protectedApp, '/suppliers', {
      list: suppliers.listSuppliers,
      get: suppliers.getSupplier,
      create: suppliers.createSupplier,
      update: suppliers.updateSupplier,
      remove: suppliers.deleteSupplier,
    });
    crudRoutes(protectedApp, '/products', {
      list: products.listProducts,
      get: products.getProduct,
      create: products.createProduct,
      update: products.updateProduct,
      remove: products.deleteProduct,
    });
    protectedApp.get('/bank-accounts/options', (request) =>
      bankAccounts.listBankAccountOptions(ctxOf(request)),
    );
    crudRoutes(protectedApp, '/bank-accounts', {
      list: bankAccounts.listBankAccounts,
      get: bankAccounts.getBankAccount,
      create: bankAccounts.createBankAccount,
      update: bankAccounts.updateBankAccount,
      remove: bankAccounts.deleteBankAccount,
    });
    crudRoutes(protectedApp, '/expenses', {
      list: expenses.listExpenses,
      get: expenses.getExpense,
      create: expenses.createExpense,
      update: expenses.updateExpense,
      remove: expenses.deleteExpense,
    });
    crudRoutes(protectedApp, '/transactions', {
      list: transactions.listTransactions,
      get: transactions.getTransaction,
      create: transactions.createTransaction,
      update: transactions.updateTransaction,
      remove: transactions.deleteTransaction,
    });
    crudRoutes(protectedApp, '/orders', {
      list: orders.listOrders,
      get: orders.getOrder,
      create: orders.createOrder,
      update: orders.updateOrder,
      remove: orders.deleteOrder,
    });
    crudRoutes(protectedApp, '/quotes', {
      list: quotes.listQuotes,
      get: quotes.getQuote,
      create: quotes.createQuote,
      update: quotes.updateQuote,
      remove: quotes.deleteQuote,
    });
    for (const name of ['send', 'approve', 'reject', 'cancel'] as const) {
      protectedApp.post(`/quotes/:id/${name}`, (request) =>
        quotes.transitionQuote(
          ctxOf(request),
          idParamSchema.parse(request.params).id,
          name,
          request.body as never,
        ),
      );
    }
    // Duplicar e copiar entre orçamento e pedido (menu de ações).
    protectedApp.post(
      '/quotes/:id/duplicate',
      created((r, id) => copies.duplicateQuote(ctxOf(r), id, r.body as never)),
    );
    protectedApp.post(
      '/quotes/:id/copy-to-order',
      created((r, id) => copies.copyQuoteToOrder(ctxOf(r), id, r.body as never)),
    );
    protectedApp.post(
      '/orders/:id/duplicate',
      created((r, id) => copies.duplicateOrder(ctxOf(r), id, r.body as never)),
    );
    protectedApp.post(
      '/orders/:id/copy-to-quote',
      created((r, id) => copies.copyOrderToQuote(ctxOf(r), id, r.body as never)),
    );

    protectedApp.post('/quotes/:id/convert', async (request, reply) => {
      reply.status(201);
      return quotes.convertQuote(
        ctxOf(request),
        idParamSchema.parse(request.params).id,
        request.body as never,
      );
    });

    protectedApp.get('/receivables', (request) => orders.listReceivables(ctxOf(request)));
    protectedApp.post('/receivables/:id/settle', (request) =>
      orders.settleReceivable(ctxOf(request), idParamSchema.parse(request.params).id, request.body as never),
    );

    crudRoutes(protectedApp, '/access-groups', {
      list: accessGroups.listAccessGroups,
      get: accessGroups.getAccessGroup,
      create: accessGroups.createAccessGroup,
      update: accessGroups.updateAccessGroup,
      remove: accessGroups.deleteAccessGroup,
    });

    // CRM: oportunidades, etapas do funil e atividades.
    protectedApp.get('/opportunities', (request) =>
      opportunities.listOpportunities(ctxOf(request), opportunityFilterSchema.parse(request.query)),
    );
    protectedApp.get('/opportunities/owners', (request) => opportunities.listOwnerOptions(ctxOf(request)));
    protectedApp.get('/opportunities/:id', (request) =>
      opportunities.getOpportunity(ctxOf(request), idParamSchema.parse(request.params).id),
    );
    protectedApp.post('/opportunities', async (request, reply) => {
      reply.status(201);
      return opportunities.createOpportunity(ctxOf(request), request.body as never);
    });
    protectedApp.put('/opportunities/:id', (request) =>
      opportunities.updateOpportunity(
        ctxOf(request),
        idParamSchema.parse(request.params).id,
        request.body as never,
      ),
    );
    protectedApp.delete('/opportunities/:id', async (request, reply) => {
      await opportunities.deleteOpportunity(ctxOf(request), idParamSchema.parse(request.params).id);
      return reply.status(204).send();
    });
    protectedApp.post('/opportunities/:id/stage', (request) =>
      opportunities.moveToStage(
        ctxOf(request),
        idParamSchema.parse(request.params).id,
        request.body as never,
      ),
    );
    protectedApp.post('/opportunities/:id/status', (request) =>
      opportunities.setStatus(ctxOf(request), idParamSchema.parse(request.params).id, request.body as never),
    );
    protectedApp.post(
      '/opportunities/:id/interactions',
      created((r, id) => opportunities.addInteraction(ctxOf(r), id, r.body as never)),
    );

    protectedApp.get('/pipeline-stages', (request) => pipeline.listStages(ctxOf(request)));
    protectedApp.post('/pipeline-stages', async (request, reply) => {
      reply.status(201);
      return pipeline.createStage(ctxOf(request), request.body as never);
    });
    protectedApp.put('/pipeline-stages/order', (request) =>
      pipeline.reorderStages(ctxOf(request), request.body as never),
    );
    protectedApp.put('/pipeline-stages/:id', (request) =>
      pipeline.updateStage(ctxOf(request), idParamSchema.parse(request.params).id, request.body as never),
    );
    protectedApp.delete('/pipeline-stages/:id', async (request, reply) => {
      await pipeline.deleteStage(ctxOf(request), idParamSchema.parse(request.params).id);
      return reply.status(204).send();
    });

    // Rastreio: cadeia de documentos, vincular/desvincular e criar oportunidade a partir de documento.
    const traceParams = z.object({ type: z.enum(TRACE_TYPES), id: z.coerce.number().int().positive() });
    protectedApp.get('/trace/:type/:id', (request) => {
      const { type, id } = traceParams.parse(request.params);
      return trace.getTrace(ctxOf(request), type, id);
    });
    // Histórico de alterações: lista do documento e detalhe de um registro.
    protectedApp.get('/history/entry/:id', (request) =>
      history.getHistoryEntry(ctxOf(request), idParamSchema.parse(request.params).id),
    );
    const historyParams = z.object({
      type: z.enum(['quote', 'order']),
      id: z.coerce.number().int().positive(),
    });
    protectedApp.get('/history/:type/:id', (request) => {
      const { type, id } = historyParams.parse(request.params);
      return history.listDocumentHistory(ctxOf(request), type, id);
    });
    for (const [path, type] of [
      ['quotes', 'quote'],
      ['orders', 'order'],
    ] as const) {
      protectedApp.post(`/${path}/:id/link`, async (request) => {
        const { id } = idParamSchema.parse(request.params);
        await trace.linkDocument(ctxOf(request), type, id, request.body as never);
        return trace.getTrace(ctxOf(request), type, id);
      });
      protectedApp.post(
        `/${path}/:id/opportunity`,
        created((r, id) => trace.createFromDocument(ctxOf(r), type, id)),
      );
    }

    // Usuários não têm DELETE: são desativados (preserva a auditoria).
    protectedApp.get('/users', (request) => users.listUsers(ctxOf(request)));
    protectedApp.get('/users/:id', (request) =>
      users.getUser(ctxOf(request), idParamSchema.parse(request.params).id),
    );
    protectedApp.post('/users', async (request, reply) => {
      reply.status(201);
      return users.createUser(ctxOf(request), request.body as never);
    });
    protectedApp.put('/users/:id', (request) =>
      users.updateUser(ctxOf(request), idParamSchema.parse(request.params).id, request.body as never),
    );

    protectedApp.get('/dashboard', (request) => getDashboard(ctxOf(request)));
    protectedApp.get('/company', (request) => company.getCompanySettings(ctxOf(request)));
    protectedApp.put('/company', (request) =>
      company.updateCompanySettings(ctxOf(request), request.body as never),
    );
  });
}
