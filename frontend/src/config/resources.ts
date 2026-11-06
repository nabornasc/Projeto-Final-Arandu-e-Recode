import type { Area, Permission } from '@arandue/shared/permissions';
import { bankAccountSchema, expenseSchema, productSchema, transactionSchema } from '@arandue/shared/schemas';
import type { z } from 'zod';

export type FieldType = 'text' | 'email' | 'number' | 'date' | 'select' | 'account';

export interface Field {
  key: string;
  label: string;
  type: FieldType;
  options?: [string, string][];
  required?: boolean;
  // Campo que só aparece para quem tem esta permissão.
  permission?: Permission;
}

export interface ResourceConfig {
  title: string;
  endpoint: string;
  // Área de permissões com ver, criar, editar e excluir.
  area: Extract<Area, 'products' | 'payables' | 'bank_accounts' | 'cash'>;
  schema: z.ZodType;
  fields: Field[];
  columns: [string, string][];
  // Registros gerados automaticamente não podem ser editados nesta tela.
  isLocked?: (row: Record<string, unknown>) => boolean;
  // Filtros e totais da lista, nas telas com lançamentos por data.
  list?: {
    dateKey: string;
    dateLabel: string;
    textKeys: string[];
    textLabel: string;
    statusKey?: string;
    statuses?: readonly (readonly [string, string])[];
    totals: (rows: Record<string, unknown>[]) => { label: string; value: number }[];
  };
}

const sumAmount = (
  rows: Record<string, unknown>[],
  keep: (row: Record<string, unknown>) => boolean = () => true,
) => rows.filter(keep).reduce((sum, row) => sum + Number(row.amount), 0);

export const resources = {
  products: {
    title: 'Produtos e serviços',
    endpoint: '/products',
    area: 'products',
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
      { key: 'cost', label: 'Custo unitário (R$)', type: 'number', permission: 'costs.read' },
      { key: 'stock', label: 'Estoque (vazio para serviço)', type: 'number' },
    ],
    columns: [
      ['name', 'Nome'],
      ['type', 'Tipo'],
      ['price', 'Preço'],
      ['stock', 'Estoque'],
    ],
  },
  expenses: {
    title: 'Contas a pagar (despesas)',
    endpoint: '/expenses',
    area: 'payables',
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
    list: {
      dateKey: 'expenseDate',
      dateLabel: 'Vencimento ou pagamento',
      textKeys: ['description', 'category'],
      textLabel: 'Descrição ou categoria',
      statusKey: 'status',
      statuses: [
        ['pending', 'Pendente'],
        ['paid', 'Pago'],
      ],
      totals: (rows) => [
        { label: 'Valor total', value: sumAmount(rows) },
        { label: 'Pago', value: sumAmount(rows, (row) => row.status === 'paid') },
        { label: 'Em aberto', value: sumAmount(rows, (row) => row.status === 'pending') },
      ],
    },
  },
  accounts: {
    title: 'Contas bancárias',
    endpoint: '/bank-accounts',
    area: 'bank_accounts',
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
    area: 'cash',
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
    list: {
      dateKey: 'transactionDate',
      dateLabel: 'Data da movimentação',
      textKeys: ['description', 'category'],
      textLabel: 'Descrição ou categoria',
      statusKey: 'type',
      statuses: [
        ['income', 'Entrada'],
        ['outcome', 'Saída'],
      ],
      totals: (rows) => {
        const income = sumAmount(rows, (row) => row.type === 'income');
        const outcome = sumAmount(rows, (row) => row.type === 'outcome');
        return [
          { label: 'Entradas', value: income },
          { label: 'Saídas', value: outcome },
          { label: 'Saldo', value: income - outcome },
        ];
      },
    },
    isLocked: (row) => Boolean(row.orderId || row.expenseId),
  },
} satisfies Record<string, ResourceConfig>;

export type ResourceKey = keyof typeof resources;

export const MONEY_COLUMNS = new Set(['price', 'cost', 'amount', 'initialBalance', 'total']);
