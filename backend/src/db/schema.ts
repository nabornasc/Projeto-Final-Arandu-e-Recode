// Schema v2 (multiempresa). Toda tabela de negócio tem company_id e índice começando por ele.
// Colunas em camelCase aqui viram snake_case no banco (casing: 'snake_case').
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

const money = () => numeric({ precision: 12, scale: 2, mode: 'number' });
const quantity = () => numeric({ precision: 12, scale: 2, mode: 'number' });
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const companyId = () =>
  integer()
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' });

export const productTypeEnum = pgEnum('product_type', ['product', 'service']);
export const accountTypeEnum = pgEnum('account_type', ['checking', 'savings', 'cash']);
export const orderStatusEnum = pgEnum('order_status', ['pending', 'paid', 'completed', 'cancelled']);
export const quoteStatusEnum = pgEnum('quote_status', ['draft', 'sent', 'approved', 'rejected']);
export const expenseStatusEnum = pgEnum('expense_status', ['pending', 'paid']);
export const transactionTypeEnum = pgEnum('transaction_type', ['income', 'outcome']);
export const leadStageEnum = pgEnum('lead_stage', [
  'new',
  'contacted',
  'quote_sent',
  'negotiation',
  'won',
  'lost',
]);
export const channelEnum = pgEnum('channel', ['web', 'telegram', 'whatsapp', 'phone', 'in_person']);
export const actorEnum = pgEnum('actor', ['web', 'telegram', 'assistant', 'system']);

// ---------- Empresas, usuários e sessões ----------

export const companies = pgTable('companies', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 160 }).notNull(),
  cnpj: varchar({ length: 18 }),
  // Limite anual do MEI: cada empresa informa o valor vigente nas configurações (muda por lei).
  meiAnnualLimit: money(),
  // Contadores da numeração por empresa (#001, #002...), para o número não revelar o volume de outras.
  orderSeq: integer().notNull().default(0),
  quoteSeq: integer().notNull().default(0),
  createdAt: createdAt(),
});

// Grupos de acesso da empresa. As permissões do grupo Proprietário (isOwner) não ficam na tabela:
// ele tem sempre todas, inclusive as que forem criadas no futuro.
export const accessGroups = pgTable(
  'access_groups',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    companyId: companyId(),
    name: varchar({ length: 80 }).notNull(),
    description: varchar({ length: 255 }),
    // true = em orçamentos e pedidos, o grupo só vê os registros que o próprio usuário criou.
    ownOnly: boolean().notNull().default(false),
    isOwner: boolean().notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.companyId, t.name)],
);

export const accessGroupPermissions = pgTable(
  'access_group_permissions',
  {
    groupId: integer()
      .notNull()
      .references(() => accessGroups.id, { onDelete: 'cascade' }),
    permission: varchar({ length: 60 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.permission] })],
);

export const users = pgTable(
  'users',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    companyId: companyId(),
    name: varchar({ length: 160 }).notNull(),
    email: varchar({ length: 160 }).notNull(),
    passwordHash: text().notNull(),
    groupId: integer()
      .notNull()
      .references(() => accessGroups.id, { onDelete: 'restrict' }),
    active: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('users_email_unique').on(sql`lower(${t.email})`),
    index().on(t.companyId),
    index().on(t.groupId),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    // Guardamos só o hash SHA-256 do token; o token em si fica apenas no cookie.
    id: varchar({ length: 64 }).primaryKey(),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userId), index().on(t.expiresAt)],
);

// ---------- Cadastros ----------

export const customers = pgTable(
  'customers',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    companyId: companyId(),
    name: varchar({ length: 160 }).notNull(),
    document: varchar({ length: 30 }),
    phone: varchar({ length: 30 }),
    email: varchar({ length: 160 }),
    address: varchar({ length: 255 }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.companyId, t.name), index().on(t.companyId, t.createdAt)],
);

export const suppliers = pgTable(
  'suppliers',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    companyId: companyId(),
    name: varchar({ length: 160 }).notNull(),
    contact: varchar({ length: 160 }),
    phone: varchar({ length: 30 }),
    email: varchar({ length: 160 }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.companyId, t.name)],
);

export const products = pgTable(
  'products',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    companyId: companyId(),
    name: varchar({ length: 120 }).notNull(),
    type: productTypeEnum().notNull().default('product'),
    price: money().notNull().default(0),
    cost: money(),
    // NULL = não controla estoque (serviços).
    stock: quantity(),
    active: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index().on(t.companyId, t.active, t.name)],
);

// ---------- CRM ----------

export const leads = pgTable(
  'leads',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    companyId: companyId(),
    name: varchar({ length: 160 }).notNull(),
    phone: varchar({ length: 30 }),
    email: varchar({ length: 160 }),
    source: varchar({ length: 60 }).notNull(),
    stage: leadStageEnum().notNull().default('new'),
    ownerId: integer().references(() => users.id, { onDelete: 'set null' }),
    lostReason: varchar({ length: 255 }),
    nextAction: varchar({ length: 255 }),
    nextActionAt: date({ mode: 'string' }),
    customerId: integer().references(() => customers.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index().on(t.companyId, t.stage), index().on(t.companyId, t.source)],
);

export const interactions = pgTable(
  'interactions',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    companyId: companyId(),
    leadId: integer()
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    userId: integer().references(() => users.id, { onDelete: 'set null' }),
    channel: channelEnum().notNull().default('web'),
    description: text().notNull(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.companyId, t.leadId)],
);

// ---------- Vendas ----------

export const quotes = pgTable(
  'quotes',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    companyId: companyId(),
    number: integer().notNull(),
    customerId: integer().references(() => customers.id, { onDelete: 'set null' }),
    leadId: integer().references(() => leads.id, { onDelete: 'set null' }),
    status: quoteStatusEnum().notNull().default('draft'),
    discount: money().notNull().default(0),
    total: money().notNull().default(0),
    validUntil: date({ mode: 'string' }),
    notes: varchar({ length: 500 }),
    createdBy: integer().references(() => users.id, { onDelete: 'set null' }),
    sentAt: timestamp({ withTimezone: true }),
    decidedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.companyId, t.status),
    index().on(t.companyId, t.createdAt),
    uniqueIndex().on(t.companyId, t.number),
  ],
);

export const quoteItems = pgTable(
  'quote_items',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    quoteId: integer()
      .notNull()
      .references(() => quotes.id, { onDelete: 'cascade' }),
    productId: integer()
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    quantity: quantity().notNull(),
    unitPrice: money().notNull(),
    subtotal: money().notNull(),
  },
  (t) => [index().on(t.quoteId)],
);

export const orders = pgTable(
  'orders',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    companyId: companyId(),
    number: integer().notNull(),
    customerId: integer().references(() => customers.id, { onDelete: 'set null' }),
    quoteId: integer().references(() => quotes.id, { onDelete: 'set null' }),
    orderDate: date({ mode: 'string' }).notNull(),
    status: orderStatusEnum().notNull().default('pending'),
    discount: money().notNull().default(0),
    total: money().notNull().default(0),
    notes: varchar({ length: 500 }),
    createdBy: integer().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.companyId, t.orderDate),
    index().on(t.companyId, t.status),
    uniqueIndex().on(t.quoteId),
    uniqueIndex().on(t.companyId, t.number),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    orderId: integer()
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: integer()
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    quantity: quantity().notNull(),
    unitPrice: money().notNull(),
    subtotal: money().notNull(),
  },
  (t) => [index().on(t.orderId), index().on(t.productId)],
);

// ---------- Financeiro ----------

export const bankAccounts = pgTable(
  'bank_accounts',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    companyId: companyId(),
    bankName: varchar({ length: 100 }).notNull(),
    accountName: varchar({ length: 120 }).notNull(),
    accountType: accountTypeEnum().notNull().default('checking'),
    initialBalance: money().notNull().default(0),
    active: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.companyId, t.active)],
);

export const expenses = pgTable(
  'expenses',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    companyId: companyId(),
    description: varchar({ length: 180 }).notNull(),
    category: varchar({ length: 80 }).notNull(),
    amount: money().notNull(),
    expenseDate: date({ mode: 'string' }).notNull(),
    status: expenseStatusEnum().notNull().default('pending'),
    bankAccountId: integer().references(() => bankAccounts.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.companyId, t.expenseDate), index().on(t.bankAccountId)],
);

export const cashTransactions = pgTable(
  'cash_transactions',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    companyId: companyId(),
    bankAccountId: integer().references(() => bankAccounts.id, { onDelete: 'set null' }),
    type: transactionTypeEnum().notNull(),
    category: varchar({ length: 80 }).notNull(),
    description: varchar({ length: 180 }).notNull(),
    amount: money().notNull(),
    transactionDate: date({ mode: 'string' }).notNull(),
    // Preenchidos quando a movimentação é gerada automaticamente (no máximo uma por pedido/despesa).
    orderId: integer().references(() => orders.id, { onDelete: 'cascade' }),
    expenseId: integer().references(() => expenses.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.companyId, t.transactionDate),
    index().on(t.bankAccountId),
    uniqueIndex().on(t.orderId),
    uniqueIndex().on(t.expenseId),
  ],
);

// ---------- Auditoria e eventos ----------

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    companyId: companyId(),
    userId: integer().references(() => users.id, { onDelete: 'set null' }),
    actor: actorEnum().notNull().default('web'),
    action: varchar({ length: 40 }).notNull(),
    entity: varchar({ length: 40 }).notNull(),
    entityId: integer(),
    data: jsonb(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.companyId, t.createdAt)],
);

export const events = pgTable(
  'events',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    companyId: companyId(),
    type: varchar({ length: 40 }).notNull(),
    refId: integer(),
    createdAt: createdAt(),
    readAt: timestamp({ withTimezone: true }),
  },
  (t) => [index().on(t.companyId, t.readAt), uniqueIndex().on(t.companyId, t.type, t.refId)],
);
