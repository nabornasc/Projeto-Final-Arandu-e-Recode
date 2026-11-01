// Dados de demonstração. APAGA o banco de desenvolvimento antes de inserir.
// Usa os próprios serviços, então os dados respeitam as mesmas regras da aplicação.
import { hash } from '@node-rs/argon2';
import { sql as rawSql } from 'drizzle-orm';
import { config } from '../config.ts';
import type { Ctx } from '../lib/context.ts';
import { register } from '../services/auth.ts';
import { createBankAccount } from '../services/bankAccounts.ts';
import { createCustomer } from '../services/customers.ts';
import { createExpense } from '../services/expenses.ts';
import { createOrder } from '../services/orders.ts';
import { createProduct } from '../services/products.ts';
import { db, sql } from './client.ts';
import { users } from './schema.ts';

if (config.NODE_ENV === 'production') throw new Error('Seed não pode rodar em produção.');

export const DEMO_PASSWORD = 'senha-demo-123';

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

async function truncateAll() {
  await db.execute(rawSql`
    TRUNCATE companies, users, sessions, customers, suppliers, products, leads, interactions,
             quotes, quote_items, orders, order_items, bank_accounts, expenses, cash_transactions,
             audit_logs, events RESTART IDENTITY CASCADE`);
}

async function addUser(owner: Ctx, name: string, email: string, role: 'seller' | 'accountant') {
  await db.insert(users).values({
    companyId: owner.companyId,
    name,
    email,
    role,
    passwordHash: await hash(DEMO_PASSWORD),
  });
}

async function seedCompany(companyName: string, prefix: string) {
  const { ctx: owner } = await register({
    companyName,
    name: `Dona ${companyName}`,
    email: `dono@${prefix}.test`,
    password: DEMO_PASSWORD,
  });
  await addUser(owner, `Vendedor ${companyName}`, `vendedor@${prefix}.test`, 'seller');
  await addUser(owner, `Contador ${companyName}`, `contador@${prefix}.test`, 'accountant');

  const service = await createProduct(owner, {
    name: 'Identidade visual',
    type: 'service',
    price: 850,
    cost: 220,
  });
  const kit = await createProduct(owner, {
    name: 'Kit papelaria artesanal',
    type: 'product',
    price: 120,
    cost: 48,
    stock: 14,
  });
  await createProduct(owner, { name: 'Consultoria financeira', type: 'service', price: 260, cost: 60 });

  const market = await createCustomer(owner, {
    name: 'Mercadinho da Praça',
    document: '12.345.678/0001-90',
    phone: '(11) 99999-1111',
    email: 'contato@mercadinho.test',
  });
  const ana = await createCustomer(owner, {
    name: 'Ana Souza',
    phone: '(11) 98888-2222',
    email: 'ana@exemplo.test',
  });

  await createBankAccount(owner, {
    bankName: 'Caixa físico',
    accountName: 'Caixa da loja',
    accountType: 'cash',
    initialBalance: 450,
  });
  const main = await createBankAccount(owner, {
    bankName: 'Banco comunitário',
    accountName: 'Conta principal',
    accountType: 'checking',
    initialBalance: 1250,
  });

  await createOrder(owner, {
    customerId: market.id,
    orderDate: daysAgo(2),
    status: 'paid',
    bankAccountId: main.id,
    notes: 'Entrega realizada',
    items: [{ productId: service.id, quantity: 1 }],
  });
  await createOrder(owner, {
    customerId: ana.id,
    orderDate: daysAgo(1),
    discount: 10,
    notes: 'Aguardando confirmação',
    items: [{ productId: kit.id, quantity: 2 }],
  });

  await createExpense(owner, {
    description: 'Compra de materiais',
    category: 'Insumos',
    amount: 180,
    expenseDate: daysAgo(3),
    status: 'paid',
    bankAccountId: main.id,
  });
  await createExpense(owner, {
    description: 'Internet do negócio',
    category: 'Operacional',
    amount: 89.9,
    expenseDate: daysAgo(1),
    status: 'pending',
    bankAccountId: main.id,
  });
}

await truncateAll();
await seedCompany('Ateliê Aranduê', 'atelie');
await seedCompany('Doces da Vila', 'doces');
await sql.end();

console.log(`Seed concluído. Usuários (senha "${DEMO_PASSWORD}"):`);
for (const prefix of ['atelie', 'doces']) {
  console.log(`  dono@${prefix}.test · vendedor@${prefix}.test · contador@${prefix}.test`);
}
