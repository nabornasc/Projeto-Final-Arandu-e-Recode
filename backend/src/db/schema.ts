// Schema v2 (multiempresa). Toda tabela de negócio tem company_id e índice começando por ele.
// Colunas em camelCase aqui viram snake_case no banco (casing: 'snake_case').
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
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
export const quoteStatusEnum = pgEnum('quote_status', ['draft', 'sent', 'approved', 'rejected', 'cancelled']);
export const expenseStatusEnum = pgEnum('expense_status', ['pending', 'paid']);
export const transactionTypeEnum = pgEnum('transaction_type', ['income', 'outcome']);
export const channelEnum = pgEnum('channel', ['web', 'telegram', 'whatsapp', 'phone', 'in_person']);
export const actorEnum = pgEnum('actor', ['web', 'telegram', 'assistant', 'system']);

// ---------- Empresas, usuários e sessões ----------

export const companies = pgTable('companies', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 160 }).notNull(),
  cnpj: varchar({ length: 18 }),
  // Dados impressos no cabeçalho dos documentos enviados ao cliente.
  legalName: varchar({ length: 160 }),
  address: varchar({ length: 255 }),
  phone: varchar({ length: 30 }),
  email: varchar({ length: 160 }),
  logo: text(),
  quoteTerms: varchar({ length: 2000 }),
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

// ---------- Pessoas ----------

export const personKindEnum = pgEnum('person_kind', ['individual', 'company']);
export const taxpayerEnum = pgEnum('taxpayer_type', ['contributor', 'exempt', 'non_contributor']);
export const taxRegimeEnum = pgEnum('tax_regime', ['mei', 'simples', 'presumido', 'real']);
export const freightTypeEnum = pgEnum('freight_type', ['sender', 'recipient', 'none']);
export const addressKindEnum = pgEnum('address_kind', ['delivery', 'billing']);

const addressColumns = () => ({
  zip: varchar({ length: 8 }),
  street: varchar({ length: 160 }),
  number: varchar({ length: 20 }),
  complement: varchar({ length: 80 }),
  district: varchar({ length: 80 }),
  city: varchar({ length: 80 }),
  state: varchar({ length: 2 }),
});

// Cadastro único com papéis: a mesma pessoa pode ser cliente, fornecedor, transportadora e
// representante. Documento só com dígitos, único por empresa quando informado.
export const people = pgTable(
  'people',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    companyId: companyId(),
    kind: personKindEnum().notNull().default('individual'),
    document: varchar({ length: 14 }),
    name: varchar({ length: 160 }).notNull(),
    legalName: varchar({ length: 160 }),
    isCustomer: boolean().notNull().default(false),
    isSupplier: boolean().notNull().default(false),
    isCarrier: boolean().notNull().default(false),
    isSalesRep: boolean().notNull().default(false),
    email: varchar({ length: 160 }),
    phone: varchar({ length: 30 }),
    mobile: varchar({ length: 30 }),
    stateRegistration: varchar({ length: 20 }),
    taxpayer: taxpayerEnum().notNull().default('non_contributor'),
    finalConsumer: boolean().notNull().default(true),
    taxRegime: taxRegimeEnum(),
    ...addressColumns(),
    country: varchar({ length: 60 }).default('Brasil'),
    // Comercial
    paymentMethod: varchar({ length: 60 }),
    paymentTerms: varchar({ length: 120 }),
    freightType: freightTypeEnum(),
    carrierId: integer().references((): AnyPgColumn => people.id, { onDelete: 'set null' }),
    category: varchar({ length: 60 }),
    region: varchar({ length: 60 }),
    // Vendedor fixo da carteira (usuário do sistema).
    sellerId: integer().references(() => users.id, { onDelete: 'set null' }),
    creditLimit: money(),
    notes: varchar({ length: 1000 }),
    active: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index().on(t.companyId, t.name),
    index().on(t.companyId, t.city),
    uniqueIndex().on(t.companyId, t.document).where(sql`${t.document} IS NOT NULL`),
  ],
);

export const personContacts = pgTable(
  'person_contacts',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    personId: integer()
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    name: varchar({ length: 120 }).notNull(),
    role: varchar({ length: 80 }),
    phone: varchar({ length: 30 }),
    email: varchar({ length: 160 }),
  },
  (t) => [index().on(t.personId)],
);

export const personAddresses = pgTable(
  'person_addresses',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    personId: integer()
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    kind: addressKindEnum().notNull(),
    ...addressColumns(),
  },
  (t) => [index().on(t.personId)],
);

// ---------- CRM ----------

export const opportunityStatusEnum = pgEnum('opportunity_status', ['open', 'won', 'lost']);
// Marcos fixos usados pela automação; cada empresa liga as próprias etapas a eles.
export const stageMilestoneEnum = pgEnum('stage_milestone', ['start', 'quote_sent', 'negotiation']);
export const activityKindEnum = pgEnum('activity_kind', [
  'comment',
  'call',
  'visit',
  'meeting',
  'proposal',
  'email',
  'event',
]);
export const originKindEnum = pgEnum('origin_kind', ['converted', 'duplicated', 'copied']);

// Etapas do funil de cada empresa.
export const pipelineStages = pgTable(
  'pipeline_stages',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    companyId: companyId(),
    name: varchar({ length: 60 }).notNull(),
    position: integer().notNull(),
    color: varchar({ length: 7 }).notNull().default('#6d4fd6'),
    milestone: stageMilestoneEnum(),
  },
  (t) => [
    index().on(t.companyId, t.position),
    uniqueIndex().on(t.companyId, t.name),
    // No máximo uma etapa por marco em cada empresa.
    uniqueIndex().on(t.companyId, t.milestone).where(sql`${t.milestone} IS NOT NULL`),
  ],
);

// Oportunidade = um negócio. A situação é separada da etapa: uma perdida mostra onde parou.
export const opportunities = pgTable(
  'opportunities',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    companyId: companyId(),
    title: varchar({ length: 160 }).notNull(),
    customerId: integer().references(() => people.id, { onDelete: 'set null' }),
    // Contato de quem ainda não é cliente.
    contactName: varchar({ length: 160 }),
    contactPhone: varchar({ length: 30 }),
    contactEmail: varchar({ length: 160 }),
    source: varchar({ length: 60 }).notNull(),
    stageId: integer()
      .notNull()
      .references(() => pipelineStages.id, { onDelete: 'restrict' }),
    status: opportunityStatusEnum().notNull().default('open'),
    estimatedValue: money(),
    expectedCloseDate: date({ mode: 'string' }),
    ownerId: integer().references(() => users.id, { onDelete: 'set null' }),
    lostReason: varchar({ length: 255 }),
    nextAction: varchar({ length: 255 }),
    nextActionAt: date({ mode: 'string' }),
    closedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index().on(t.companyId, t.status, t.stageId),
    index().on(t.companyId, t.source),
    index().on(t.companyId, t.ownerId),
    index().on(t.customerId),
  ],
);

// Itens de interesse: viram o primeiro orçamento da oportunidade.
export const opportunityItems = pgTable(
  'opportunity_items',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    opportunityId: integer()
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    productId: integer()
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    quantity: quantity().notNull(),
    unitPrice: money(),
  },
  (t) => [index().on(t.opportunityId)],
);

export const interactions = pgTable(
  'interactions',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    companyId: companyId(),
    userId: integer().references(() => users.id, { onDelete: 'set null' }),
    opportunityId: integer()
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    kind: activityKindEnum().notNull().default('comment'),
    channel: channelEnum().notNull().default('web'),
    description: text().notNull(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.companyId, t.opportunityId)],
);

// ---------- Vendas ----------

export const quotes = pgTable(
  'quotes',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    companyId: companyId(),
    number: integer().notNull(),
    customerId: integer().references(() => people.id, { onDelete: 'set null' }),
    // Rastreio: a oportunidade do documento e o documento de onde ele nasceu (no máximo um).
    opportunityId: integer().references(() => opportunities.id, { onDelete: 'set null' }),
    originQuoteId: integer().references((): AnyPgColumn => quotes.id, { onDelete: 'set null' }),
    originOrderId: integer().references((): AnyPgColumn => orders.id, { onDelete: 'set null' }),
    originKind: originKindEnum(),
    status: quoteStatusEnum().notNull().default('draft'),
    discount: money().notNull().default(0),
    freight: money().notNull().default(0),
    otherCharges: money().notNull().default(0),
    total: money().notNull().default(0),
    validUntil: date({ mode: 'string' }),
    notes: varchar({ length: 500 }),
    // Fica só no sistema: nunca sai no espelho do cliente.
    internalNotes: varchar({ length: 500 }),
    // Local de entrega ou do serviço.
    siteDescription: varchar({ length: 160 }),
    siteContact: varchar({ length: 160 }),
    siteAddress: varchar({ length: 255 }),
    // Cópia feita ao enviar: reimprimir mostra o que o cliente recebeu, mesmo que o cadastro mude.
    mirrorSnapshot: jsonb(),
    createdBy: integer().references(() => users.id, { onDelete: 'set null' }),
    sentAt: timestamp({ withTimezone: true }),
    decidedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.companyId, t.status),
    index().on(t.companyId, t.createdAt),
    uniqueIndex().on(t.companyId, t.number),
    index().on(t.opportunityId),
    index().on(t.originQuoteId),
    index().on(t.originOrderId),
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
    customerId: integer().references(() => people.id, { onDelete: 'set null' }),
    quoteId: integer().references(() => quotes.id, { onDelete: 'set null' }),
    // Rastreio: mesma ideia do orçamento. quoteId continua marcando a conversão (única por orçamento).
    opportunityId: integer().references(() => opportunities.id, { onDelete: 'set null' }),
    originQuoteId: integer().references((): AnyPgColumn => quotes.id, { onDelete: 'set null' }),
    originOrderId: integer().references((): AnyPgColumn => orders.id, { onDelete: 'set null' }),
    originKind: originKindEnum(),
    orderDate: date({ mode: 'string' }).notNull(),
    status: orderStatusEnum().notNull().default('pending'),
    discount: money().notNull().default(0),
    freight: money().notNull().default(0),
    otherCharges: money().notNull().default(0),
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
    index().on(t.opportunityId),
    index().on(t.originQuoteId),
    index().on(t.originOrderId),
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
    // Nome na data da ação: o registro continua legível se o usuário mudar ou for removido.
    actorName: varchar({ length: 160 }),
    actor: actorEnum().notNull().default('web'),
    action: varchar({ length: 40 }).notNull(),
    entity: varchar({ length: 40 }).notNull(),
    entityId: integer(),
    data: jsonb(),
    // Motivo informado ao recusar ou cancelar.
    reason: varchar({ length: 255 }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.companyId, t.createdAt), index().on(t.companyId, t.entity, t.entityId, t.createdAt)],
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
