import type { Module } from '@arandue/shared/rbac';
import {
  bankAccountSchema,
  customerSchema,
  expenseSchema,
  productSchema,
  supplierSchema,
  transactionSchema,
} from '@arandue/shared/schemas';
import type { z } from 'zod';

export type FieldType = 'text' | 'email' | 'number' | 'date' | 'select' | 'account';

export interface Field {
  key: string;
  label: string;
  type: FieldType;
  options?: [string, string][];
  required?: boolean;
}

export interface ResourceConfig {
  title: string;
  endpoint: string;
  module: Module;
  schema: z.ZodType;
  fields: Field[];
  columns: [string, string][];
  // Registros gerados automaticamente não podem ser editados nesta tela.
  isLocked?: (row: Record<string, unknown>) => boolean;
}

export const resources = {
  products: {
    title: 'Produtos e serviços',
    endpoint: '/products',
    module: 'products',
    schema: productSchema,
    fields: [
      { key: 'name', label: 'Nome', type: 'text', required: true },
      {
        key: 'type',
        label: 'Tipo',
        type: 'select',
        options: [
          ['product', 'Produto'],
          ['service', 'Serviço'],
        ],
        required: true,
      },
      { key: 'price', label: 'Preço de venda (R$)', type: 'number', required: true },
      { key: 'cost', label: 'Custo unitário (R$)', type: 'number' },
      { key: 'stock', label: 'Estoque (vazio para serviço)', type: 'number' },
    ],
    columns: [
      ['name', 'Nome'],
      ['type', 'Tipo'],
      ['price', 'Preço'],
      ['stock', 'Estoque'],
    ],
  },
  customers: {
    title: 'Clientes',
    endpoint: '/customers',
    module: 'customers',
    schema: customerSchema,
    fields: [
      { key: 'name', label: 'Nome completo / Razão social', type: 'text', required: true },
      { key: 'document', label: 'CPF ou CNPJ', type: 'text' },
      { key: 'phone', label: 'Telefone / WhatsApp', type: 'text' },
      { key: 'email', label: 'E-mail', type: 'email' },
      { key: 'address', label: 'Endereço', type: 'text' },
    ],
    columns: [
      ['name', 'Nome'],
      ['document', 'Documento'],
      ['phone', 'Telefone'],
      ['email', 'E-mail'],
    ],
  },
  suppliers: {
    title: 'Fornecedores',
    endpoint: '/suppliers',
    module: 'suppliers',
    schema: supplierSchema,
    fields: [
      { key: 'name', label: 'Nome / Razão social', type: 'text', required: true },
      { key: 'contact', label: 'Pessoa de contato', type: 'text' },
      { key: 'phone', label: 'Telefone / WhatsApp', type: 'text' },
      { key: 'email', label: 'E-mail', type: 'email' },
    ],
    columns: [
      ['name', 'Nome'],
      ['contact', 'Contato'],
      ['phone', 'Telefone'],
      ['email', 'E-mail'],
    ],
  },
  expenses: {
    title: 'Despesas',
    endpoint: '/expenses',
    module: 'finance',
    schema: expenseSchema,
    fields: [
      { key: 'description', label: 'Descrição', type: 'text', required: true },
      { key: 'category', label: 'Categoria (ex.: Aluguel)', type: 'text', required: true },
      { key: 'amount', label: 'Valor (R$)', type: 'number', required: true },
      { key: 'expenseDate', label: 'Vencimento / pagamento', type: 'date', required: true },
      {
        key: 'status',
        label: 'Status',
        type: 'select',
        options: [
          ['pending', 'Pendente'],
          ['paid', 'Pago'],
        ],
        required: true,
      },
      { key: 'bankAccountId', label: 'Conta de débito', type: 'account' },
    ],
    columns: [
      ['description', 'Descrição'],
      ['category', 'Categoria'],
      ['amount', 'Valor'],
      ['expenseDate', 'Data'],
      ['status', 'Status'],
    ],
  },
  accounts: {
    title: 'Contas bancárias',
    endpoint: '/bank-accounts',
    module: 'finance',
    schema: bankAccountSchema,
    fields: [
      { key: 'bankName', label: 'Instituição / carteira', type: 'text', required: true },
      { key: 'accountName', label: 'Nome da conta', type: 'text', required: true },
      {
        key: 'accountType',
        label: 'Tipo de conta',
        type: 'select',
        options: [
          ['checking', 'Corrente'],
          ['savings', 'Poupança'],
          ['cash', 'Caixa físico'],
        ],
        required: true,
      },
      { key: 'initialBalance', label: 'Saldo inicial (R$)', type: 'number', required: true },
    ],
    columns: [
      ['accountName', 'Conta'],
      ['bankName', 'Instituição'],
      ['accountType', 'Tipo'],
      ['initialBalance', 'Saldo inicial'],
    ],
  },
  transactions: {
    title: 'Movimentações de caixa',
    endpoint: '/transactions',
    module: 'finance',
    schema: transactionSchema,
    fields: [
      {
        key: 'type',
        label: 'Tipo',
        type: 'select',
        options: [
          ['income', 'Entrada'],
          ['outcome', 'Saída'],
        ],
        required: true,
      },
      { key: 'category', label: 'Categoria', type: 'text', required: true },
      { key: 'description', label: 'Descrição', type: 'text', required: true },
      { key: 'amount', label: 'Valor (R$)', type: 'number', required: true },
      { key: 'transactionDate', label: 'Data', type: 'date', required: true },
      { key: 'bankAccountId', label: 'Conta bancária', type: 'account' },
    ],
    columns: [
      ['description', 'Descrição'],
      ['type', 'Tipo'],
      ['amount', 'Valor'],
      ['transactionDate', 'Data'],
    ],
    isLocked: (row) => Boolean(row.orderId || row.expenseId),
  },
} satisfies Record<string, ResourceConfig>;

export type ResourceKey = keyof typeof resources;

export const MONEY_COLUMNS = new Set(['price', 'cost', 'amount', 'initialBalance', 'total']);
