// Schemas de validação compartilhados entre frontend (formulários) e backend (API).
import { z } from 'zod';
import { ROLES } from '../rbac.ts';

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
  role: z.enum(ROLES),
  password: passwordSchema,
});
export type UserCreateInput = z.input<typeof userCreateSchema>;

// E-mail não muda (é o login). Senha vazia mantém a atual.
export const userUpdateSchema = z.object({
  name: requiredText(160, 'Informe o nome'),
  role: z.enum(ROLES),
  active: z.boolean(),
  password: z
    .union([z.literal(''), passwordSchema])
    .nullish()
    .transform((value) => value || null),
});
export type UserUpdateInput = z.input<typeof userUpdateSchema>;

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

export const customerSchema = z.object({
  name: requiredText(160, 'Informe o nome'),
  document: optionalText(30),
  phone: optionalText(30),
  email: optionalEmail,
  address: optionalText(255),
});
export type CustomerInput = z.input<typeof customerSchema>;

export const supplierSchema = z.object({
  name: requiredText(160, 'Informe o nome'),
  contact: optionalText(160),
  phone: optionalText(30),
  email: optionalEmail,
});
export type SupplierInput = z.input<typeof supplierSchema>;

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

export const QUOTE_STATUSES = ['draft', 'sent', 'approved', 'rejected'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

// Criação e edição (só em rascunho) usam o mesmo formato; o status muda por ações próprias.
export const quoteSchema = z.object({
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

export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });
