// Schemas de validação compartilhados entre frontend (formulários) e backend (API).
import { z } from 'zod';
import { isValidCnpj, isValidCpf, onlyDigits, STATES } from '../br.ts';
import { isPermission, type Permission } from '../permissions.ts';

// Campo de texto opcional: string vazia vira null (o banco guarda NULL, não '').
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

// E-mail opcional: aceita vazio (vira null) ou um endereço válido.
const optionalEmail = z
  .union([z.literal(''), z.email('E-mail inválido').max(160)])
  .nullish()
  .transform((value) => (value ? value.toLowerCase() : null));

const requiredText = (max: number, message: string) => z.string().trim().min(1, message).max(max);

const money = z
  .number({ error: 'Informe um valor numérico' })
  .nonnegative('O valor não pode ser negativo')
  .max(1e10);
const isoDate = z.iso.date({ error: 'Data inválida (use AAAA-MM-DD)' });
const id = z.number().int().positive();

// ---------- Autenticação e usuários ----------

export const passwordSchema = z
  .string()
  .min(10, 'A senha deve ter pelo menos 10 caracteres')
  .max(128, 'A senha deve ter no máximo 128 caracteres');

export const registerSchema = z.object({
  companyName: requiredText(160, 'Informe o nome da empresa'),
  cnpj: optionalText(18),
  name: requiredText(160, 'Informe seu nome'),
  email: z.email('E-mail inválido').trim().toLowerCase().max(160),
  password: passwordSchema,
});
export type RegisterInput = z.input<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.email('E-mail inválido').trim().toLowerCase(),
  password: z.string().min(1, 'Informe a senha').max(128),
});
export type LoginInput = z.input<typeof loginSchema>;

export const userCreateSchema = z.object({
  name: requiredText(160, 'Informe o nome'),
  email: z.email('E-mail inválido').trim().toLowerCase().max(160),
  groupId: id,
  password: passwordSchema,
});
export type UserCreateInput = z.input<typeof userCreateSchema>;

// E-mail não muda (é o login). Senha vazia mantém a atual.
export const userUpdateSchema = z.object({
  name: requiredText(160, 'Informe o nome'),
  groupId: id,
  active: z.boolean(),
  password: z
    .union([z.literal(''), passwordSchema])
    .nullish()
    .transform((value) => value || null),
});
export type UserUpdateInput = z.input<typeof userUpdateSchema>;

// ---------- Grupos de acesso ----------

export const accessGroupSchema = z.object({
  name: requiredText(80, 'Informe o nome do grupo'),
  description: optionalText(255),
  ownOnly: z.boolean().default(false),
  permissions: z
    .array(
      z.custom<Permission>(
        (value) => typeof value === 'string' && isPermission(value),
        'Permissão desconhecida',
      ),
    )
    .max(200),
});
export type AccessGroupInput = z.input<typeof accessGroupSchema>;

// ---------- Empresa ----------

export const companySettingsSchema = z.object({
  name: requiredText(160, 'Informe o nome da empresa'),
  cnpj: optionalText(18),
  // Obrigatório: é a referência do sistema para o acompanhamento do faturamento anual.
  meiAnnualLimit: z
    .number({ error: 'Informe o limite anual do MEI' })
    .positive('O limite anual do MEI deve ser maior que zero')
    .max(1e10),
});
export type CompanySettingsInput = z.input<typeof companySettingsSchema>;

// ---------- Cadastros ----------

// ---------- Pessoas (clientes, fornecedores, transportadoras, representantes) ----------

export const PERSON_KINDS = ['individual', 'company'] as const;
export const TAXPAYER_TYPES = ['contributor', 'exempt', 'non_contributor'] as const;
export const TAX_REGIMES = ['mei', 'simples', 'presumido', 'real'] as const;
export const FREIGHT_TYPES = ['sender', 'recipient', 'none'] as const;
export const ADDRESS_KINDS = ['delivery', 'billing'] as const;
export const PERSON_ROLES = ['customer', 'supplier', 'carrier', 'sales_rep'] as const;
export type PersonRole = (typeof PERSON_ROLES)[number];

const digitsOnly = (max: number) =>
  z
    .string()
    .nullish()
    .transform((value) => onlyDigits(value).slice(0, max) || null);

const state = z
  .union([z.literal(''), z.enum(STATES)])
  .nullish()
  .transform((value) => value || null);

const addressFields = {
  zip: digitsOnly(8),
  street: optionalText(160),
  number: optionalText(20),
  complement: optionalText(80),
  district: optionalText(80),
  city: optionalText(80),
  state,
};

export const personContactSchema = z.object({
  name: requiredText(120, 'Informe o nome do contato'),
  role: optionalText(80),
  phone: optionalText(30),
  email: optionalEmail,
});

export const personAddressSchema = z.object({ kind: z.enum(ADDRESS_KINDS), ...addressFields });

// Papéis ausentes no corpo = mantêm os atuais (na edição) ou ficam desligados (no cadastro).
export const personSchema = z
  .object({
    kind: z.enum(PERSON_KINDS).default('individual'),
    document: digitsOnly(14),
    name: requiredText(160, 'Informe o nome'),
    legalName: optionalText(160),
    isCustomer: z.boolean().optional(),
    isSupplier: z.boolean().optional(),
    isCarrier: z.boolean().optional(),
    isSalesRep: z.boolean().optional(),
    email: optionalEmail,
    phone: optionalText(30),
    mobile: optionalText(30),
    stateRegistration: optionalText(20),
    taxpayer: z.enum(TAXPAYER_TYPES).default('non_contributor'),
    finalConsumer: z.boolean().default(true),
    taxRegime: z
      .union([z.literal(''), z.enum(TAX_REGIMES)])
      .nullish()
      .transform((value) => value || null),
    ...addressFields,
    country: optionalText(60),
    // Comercial
    paymentMethod: optionalText(60),
    paymentTerms: optionalText(120),
    freightType: z
      .union([z.literal(''), z.enum(FREIGHT_TYPES)])
      .nullish()
      .transform((value) => value || null),
    carrierId: id.nullish(),
    category: optionalText(60),
    region: optionalText(60),
    sellerId: id.nullish(),
    creditLimit: money.nullish(),
    notes: optionalText(1000),
    contacts: z.array(personContactSchema).max(30).optional(),
    addresses: z.array(personAddressSchema).max(10).optional(),
  })
  .superRefine((data, issue) => {
    if (!data.document) return;
    const valid = data.kind === 'company' ? isValidCnpj(data.document) : isValidCpf(data.document);
    if (!valid) {
      issue.addIssue({
        code: 'custom',
        path: ['document'],
        message: data.kind === 'company' ? 'CNPJ inválido' : 'CPF inválido',
      });
    }
  });
export type PersonInput = z.input<typeof personSchema>;

export const PRODUCT_TYPES = ['product', 'service'] as const;

export const productSchema = z.object({
  name: requiredText(120, 'Informe o nome'),
  type: z.enum(PRODUCT_TYPES),
  price: money,
  cost: money.nullish(),
  stock: z.number().nonnegative('O estoque não pode ser negativo').max(1e9).nullish(),
});
export type ProductInput = z.input<typeof productSchema>;

// ---------- Financeiro ----------

export const ACCOUNT_TYPES = ['checking', 'savings', 'cash'] as const;

export const bankAccountSchema = z.object({
  bankName: requiredText(100, 'Informe a instituição'),
  accountName: requiredText(120, 'Informe o nome da conta'),
  accountType: z.enum(ACCOUNT_TYPES),
  initialBalance: z.number().min(-1e10).max(1e10),
});
export type BankAccountInput = z.input<typeof bankAccountSchema>;

export const EXPENSE_STATUSES = ['pending', 'paid'] as const;

export const expenseSchema = z.object({
  description: requiredText(180, 'Informe a descrição'),
  category: requiredText(80, 'Informe a categoria'),
  amount: money,
  expenseDate: isoDate,
  status: z.enum(EXPENSE_STATUSES),
  bankAccountId: id.nullish(),
});
export type ExpenseInput = z.input<typeof expenseSchema>;

export const TRANSACTION_TYPES = ['income', 'outcome'] as const;

export const transactionSchema = z.object({
  type: z.enum(TRANSACTION_TYPES),
  category: requiredText(80, 'Informe a categoria'),
  description: requiredText(180, 'Informe a descrição'),
  amount: money,
  transactionDate: isoDate,
  bankAccountId: id.nullish(),
});
export type TransactionInput = z.input<typeof transactionSchema>;

// ---------- Vendas ----------

export const ORDER_STATUSES = ['pending', 'paid', 'completed', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const orderItemSchema = z.object({
  productId: id,
  quantity: z.number().positive('A quantidade deve ser maior que zero').max(1e6),
  unitPrice: money.optional(),
});

export const orderCreateSchema = z.object({
  opportunityId: id.nullish(),
  customerId: id.nullish(),
  orderDate: isoDate,
  status: z.enum(['pending', 'paid']).default('pending'),
  discount: money.default(0),
  notes: optionalText(500),
  bankAccountId: id.nullish(),
  items: z.array(orderItemSchema).min(1, 'Inclua ao menos um item').max(100),
});
export type OrderCreateInput = z.input<typeof orderCreateSchema>;

export const orderUpdateSchema = z.object({
  customerId: id.nullish(),
  orderDate: isoDate.optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  discount: money.optional(),
  notes: optionalText(500).optional(),
  bankAccountId: id.nullish(),
});
export type OrderUpdateInput = z.input<typeof orderUpdateSchema>;

// Baixa de um pedido pendente pelo contas a receber (vira "pago" e entra no caixa).
export const receivableSettleSchema = z.object({ bankAccountId: id.nullish() });
export type ReceivableSettleInput = z.input<typeof receivableSettleSchema>;

export const QUOTE_STATUSES = ['draft', 'sent', 'approved', 'rejected'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

// Criação e edição (só em rascunho) usam o mesmo formato; o status muda por ações próprias.
export const quoteSchema = z.object({
  // Só no cadastro; depois, o vínculo muda pelas rotas de vincular e desvincular.
  opportunityId: id.nullish(),
  customerId: id.nullish(),
  validUntil: isoDate.nullish(),
  discount: money.default(0),
  notes: optionalText(500),
  items: z.array(orderItemSchema).min(1, 'Inclua ao menos um item').max(100),
});
export type QuoteInput = z.input<typeof quoteSchema>;

export const quoteConvertSchema = z.object({
  orderDate: isoDate,
  status: z.enum(['pending', 'paid']).default('pending'),
  bankAccountId: id.nullish(),
});
export type QuoteConvertInput = z.input<typeof quoteConvertSchema>;

// Duplicar ou copiar para pedido: o pedido novo precisa da data da venda.
export const copyToOrderSchema = z.object({ orderDate: isoDate, keepOpportunity: z.boolean().default(true) });
export type CopyToOrderInput = z.input<typeof copyToOrderSchema>;

// ---------- CRM ----------

export const OPPORTUNITY_STATUSES = ['open', 'won', 'lost'] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];
export const STAGE_MILESTONES = ['start', 'quote_sent', 'negotiation'] as const;
export type StageMilestone = (typeof STAGE_MILESTONES)[number];
export const CHANNELS = ['web', 'telegram', 'whatsapp', 'phone', 'in_person'] as const;
// "event" é só para registros automáticos; o usuário escolhe entre estes.
export const ACTIVITY_KINDS = ['comment', 'call', 'visit', 'meeting', 'proposal', 'email'] as const;

export const opportunityItemSchema = z.object({
  productId: id,
  quantity: z.number().positive('A quantidade deve ser maior que zero').max(1e6),
  unitPrice: money.nullish(),
});

export const opportunitySchema = z.object({
  title: requiredText(160, 'Informe o título da oportunidade'),
  customerId: id.nullish(),
  contactName: optionalText(160),
  contactPhone: optionalText(30),
  contactEmail: optionalEmail,
  source: requiredText(60, 'Informe a origem (ex.: Indicação, Instagram)'),
  // Só no cadastro; depois, a etapa muda pela rota própria.
  stageId: id.nullish(),
  estimatedValue: money.nullish(),
  expectedCloseDate: isoDate.nullish(),
  // Responsável; vazio = quem cadastrou.
  ownerId: id.nullish(),
  nextAction: optionalText(255),
  nextActionAt: isoDate.nullish(),
  items: z.array(opportunityItemSchema).max(100).optional(),
});
export type OpportunityInput = z.input<typeof opportunitySchema>;

export const opportunityStageSchema = z.object({ stageId: id });
export type OpportunityStageInput = z.input<typeof opportunityStageSchema>;

export const opportunityStatusSchema = z
  .object({ status: z.enum(OPPORTUNITY_STATUSES), lostReason: optionalText(255) })
  .refine((data) => data.status !== 'lost' || data.lostReason, {
    message: 'Informe o motivo da perda',
    path: ['lostReason'],
  });
export type OpportunityStatusInput = z.input<typeof opportunityStatusSchema>;

export const interactionSchema = z.object({
  kind: z.enum(ACTIVITY_KINDS).default('comment'),
  channel: z.enum(CHANNELS).default('web'),
  description: requiredText(2000, 'Descreva o atendimento'),
});
export type InteractionInput = z.input<typeof interactionSchema>;

export const opportunityFilterSchema = z.object({
  status: z.enum(OPPORTUNITY_STATUSES).optional(),
  stageId: z.coerce.number().int().positive().optional(),
  ownerId: z.coerce.number().int().positive().optional(),
  source: z.string().trim().max(60).optional(),
  lostReason: z.string().trim().max(100).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  q: z.string().trim().max(100).optional(),
});
export type OpportunityFilter = z.output<typeof opportunityFilterSchema>;

export const pipelineStageSchema = z.object({
  name: requiredText(60, 'Informe o nome da etapa'),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida')
    .default('#6d4fd6'),
  milestone: z
    .union([z.literal(''), z.enum(STAGE_MILESTONES)])
    .nullish()
    .transform((value) => value || null),
});
export type PipelineStageInput = z.input<typeof pipelineStageSchema>;

export const pipelineOrderSchema = z.object({ ids: z.array(id).min(1).max(50) });
export type PipelineOrderInput = z.input<typeof pipelineOrderSchema>;

// Vincular um documento a uma oportunidade (null desvincula).
export const documentLinkSchema = z.object({ opportunityId: id.nullable() });
export type DocumentLinkInput = z.input<typeof documentLinkSchema>;

export const duplicateQuoteSchema = z.object({ keepOpportunity: z.boolean().default(true) });
export type DuplicateQuoteInput = z.input<typeof duplicateQuoteSchema>;

export const TRACE_TYPES = ['opportunity', 'quote', 'order'] as const;

export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });
