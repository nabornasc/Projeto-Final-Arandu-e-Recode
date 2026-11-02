import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.ts';
import { ctxOf, requireAuth } from '../plugins/auth.ts';
import * as bankAccounts from '../services/bankAccounts.ts';
import * as company from '../services/company.ts';
import * as customers from '../services/customers.ts';
import { getDashboard } from '../services/dashboard.ts';
import * as expenses from '../services/expenses.ts';
import * as orders from '../services/orders.ts';
import * as products from '../services/products.ts';
import * as transactions from '../services/transactions.ts';
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
    protectedApp.get('/dashboard', (request) => getDashboard(ctxOf(request)));
    protectedApp.get('/company', (request) => company.getCompanySettings(ctxOf(request)));
    protectedApp.put('/company', (request) =>
      company.updateCompanySettings(ctxOf(request), request.body as never),
    );
  });
}
