// Dados de demonstração. APAGA o banco de desenvolvimento antes de inserir.
// Usa os próprios serviços, então os dados respeitam as mesmas regras da aplicação.
import { sql as rawSql } from 'drizzle-orm';
import { config } from '../config.ts';
import type { Ctx } from '../lib/context.ts';
import { listAccessGroups } from '../services/accessGroups.ts';
import { register } from '../services/auth.ts';
import { createBankAccount } from '../services/bankAccounts.ts';
import { updateCompanySettings } from '../services/company.ts';
import { createCustomer } from '../services/customers.ts';
import { createExpense } from '../services/expenses.ts';
import { addInteraction, createLead, moveLead } from '../services/leads.ts';
import { createOrder } from '../services/orders.ts';
import { createProduct } from '../services/products.ts';
import { createUser } from '../services/users.ts';
import { db, sql } from './client.ts';

if (config.NODE_ENV === 'production') throw new Error('Seed não pode rodar em produção.');

export const DEMO_PASSWORD = 'senha-demo-123';

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

async function truncateAll() {
  await db.execute(rawSql`
    TRUNCATE companies, users, sessions, customers, suppliers, products, leads, interactions,
             quotes, quote_items, orders, order_items, bank_accounts, expenses, cash_transactions,
             audit_logs, events, access_groups, access_group_permissions RESTART IDENTITY CASCADE`);
}

// Convida pelo mesmo serviço da tela de usuários, usando um dos grupos padrão da empresa.
async function addUser(owner: Ctx, name: string, email: string, groupName: 'Vendedor' | 'Contador') {
  const group = (await listAccessGroups(owner)).find((item) => item.name === groupName);
  if (!group) throw new Error(`Grupo padrão "${groupName}" não encontrado.`);
  await createUser(owner, { name, email, groupId: group.id, password: DEMO_PASSWORD });
}

async function seedCompany(companyName: string, prefix: string) {
  const { ctx: owner } = await register({
    companyName,
    name: `Dona ${companyName}`,
    email: `dono@${prefix}.test`,
    password: DEMO_PASSWORD,
  });
  // Valor só de demonstração: cada empresa informa o limite vigente em Configurações.
  await updateCompanySettings(owner, { name: companyName, meiAnnualLimit: 81000 });
  await addUser(owner, `Vendedor ${companyName}`, `vendedor@${prefix}.test`, 'Vendedor');
  await addUser(owner, `Contador ${companyName}`, `contador@${prefix}.test`, 'Contador');

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
  // Funil de vendas com leads em etapas diferentes.
  const padaria = await createLead(owner, {
    name: 'Padaria Pão Quente',
    source: 'Indicação',
    phone: '(11) 97777-3333',
    nextAction: 'Enviar catálogo de kits para eventos',
    nextActionAt: daysAgo(-2),
  });
  await addInteraction(owner, padaria.id, {
    channel: 'whatsapp',
    description: 'Pediu catálogo para eventos.',
  });
  await moveLead(owner, padaria.id, { stage: 'negotiation' });
  await createLead(owner, {
    name: 'Escola Aprender',
    source: 'Instagram',
    nextAction: 'Ligar para entender a demanda',
    nextActionAt: daysAgo(1),
  });
  const feira = await createLead(owner, { name: 'Loja da Feira', source: 'Feira' });
  await moveLead(owner, feira.id, { stage: 'lost', lostReason: 'Preço' });

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
