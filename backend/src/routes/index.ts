import { idParamSchema } from '@arandue/shared/schemas';
import { sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '../db/client.ts';
import { ctxOf, requireAuth } from '../plugins/auth.ts';
import * as accessGroups from '../services/accessGroups.ts';
import * as bankAccounts from '../services/bankAccounts.ts';
import * as company from '../services/company.ts';
import * as copies from '../services/copies.ts';
import * as customers from '../services/customers.ts';
import { getDashboard } from '../services/dashboard.ts';
import * as expenses from '../services/expenses.ts';
import * as leads from '../services/leads.ts';
import * as orders from '../services/orders.ts';
import * as products from '../services/products.ts';
import * as quotes from '../services/quotes.ts';
import * as suppliers from '../services/suppliers.ts';
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
    for (const name of ['send', 'approve', 'reject'] as const) {
      protectedApp.post(`/quotes/:id/${name}`, (request) =>
        quotes.transitionQuote(ctxOf(request), idParamSchema.parse(request.params).id, name),
      );
    }
    // Duplicar e copiar entre orçamento e pedido (menu de ações).
    const created =
      (handler: (request: FastifyRequest, id: number) => Promise<unknown>) =>
      async (request: FastifyRequest, reply: FastifyReply) => {
        reply.status(201);
        return handler(request, idParamSchema.parse(request.params).id);
      };
    protectedApp.post(
      '/quotes/:id/duplicate',
      created((r, id) => copies.duplicateQuote(ctxOf(r), id)),
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
      created((r, id) => copies.copyOrderToQuote(ctxOf(r), id)),
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

    // CRM: leads (funil) e atendimentos.
    protectedApp.get('/leads/owners', (request) => leads.listOwnerOptions(ctxOf(request)));
    crudRoutes(protectedApp, '/leads', {
      list: leads.listLeads,
      get: leads.getLead,
      create: leads.createLead,
      update: leads.updateLead,
      remove: leads.deleteLead,
    });
    protectedApp.post('/leads/:id/stage', (request) =>
      leads.moveLead(ctxOf(request), idParamSchema.parse(request.params).id, request.body as never),
    );
    protectedApp.post(
      '/leads/:id/interactions',
      created((r, id) => leads.addInteraction(ctxOf(r), id, r.body as never)),
    );

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
