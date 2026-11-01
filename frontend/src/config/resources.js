import {
  Banknote,
  Boxes,
  CircleDollarSign,
  ClipboardList,
  LayoutDashboard,
  Receipt,
  Users,
} from 'lucide-react';

export const navigation = [
  { key: 'dashboard', label: 'Visão geral', icon: LayoutDashboard },
  { key: 'orders', label: 'Vendas e pedidos', icon: ClipboardList },
  { key: 'products', label: 'Produtos e serviços', icon: Boxes },
  { key: 'customers', label: 'Clientes', icon: Users },
  { key: 'expenses', label: 'Despesas', icon: Receipt },
  { key: 'accounts', label: 'Contas bancárias', icon: Banknote },
  { key: 'transactions', label: 'Movimentações', icon: CircleDollarSign },
];

export const resourceConfig = {
  products: {
    title: 'Produtos e serviços',
    endpoint: 'products',
    icon: Boxes,
    fields: [
      ['name', 'Nome', 'text'],
      ['type', 'Tipo', 'select', [['product', 'Produto'], ['service', 'Serviço']]],
      ['price', 'Preço de venda', 'number'],
      ['cost', 'Custo unitário', 'number'],
      ['stock', 'Estoque (deixe vazio para serviço)', 'number'],
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
    endpoint: 'customers',
    icon: Users,
    fields: [
      ['name', 'Nome completo / Razão social', 'text'],
      ['document', 'CPF ou CNPJ', 'text'],
      ['phone', 'Telefone / WhatsApp', 'text'],
      ['email', 'E-mail', 'email'],
      ['address', 'Endereço', 'text'],
    ],
    columns: [
      ['name', 'Nome'],
      ['document', 'Documento'],
      ['phone', 'Telefone'],
      ['email', 'E-mail'],
    ],
  },
  expenses: {
    title: 'Despesas',
    endpoint: 'expenses',
    icon: Receipt,
    fields: [
      ['description', 'Descrição da despesa', 'text'],
      ['category', 'Categoria (ex: Fornecedores, Aluguel)', 'text'],
      ['amount', 'Valor da despesa (R$)', 'number'],
      ['expense_date', 'Data de vencimento / pagamento', 'date'],
      ['status', 'Status de pagamento', 'select', [['pending', 'Pendente'], ['paid', 'Pago']]],
      ['bank_account_id', 'Conta de débito', 'account'],
    ],
    columns: [
      ['description', 'Descrição'],
      ['category', 'Categoria'],
      ['amount', 'Valor'],
      ['expense_date', 'Data'],
      ['status', 'Status'],
    ],
  },
  accounts: {
    title: 'Contas bancárias',
    endpoint: 'bankAccounts',
    icon: Banknote,
    fields: [
      ['bank_name', 'Instituição bancária / Carteira', 'text'],
      ['account_name', 'Nome identificador da conta', 'text'],
      ['account_type', 'Tipo de conta', 'select', [['checking', 'Corrente'], ['savings', 'Poupança'], ['cash', 'Caixa físico']]],
      ['initial_balance', 'Saldo inicial (R$)', 'number'],
    ],
    columns: [
      ['account_name', 'Conta'],
      ['bank_name', 'Instituição'],
      ['account_type', 'Tipo'],
      ['initial_balance', 'Saldo inicial'],
    ],
  },
  transactions: {
    title: 'Movimentações de caixa',
    endpoint: 'transactions',
    icon: CircleDollarSign,
    fields: [
      ['type', 'Tipo de movimentação', 'select', [['income', 'Entrada'], ['outcome', 'Saída']]],
      ['category', 'Categoria', 'text'],
      ['description', 'Descrição', 'text'],
      ['amount', 'Valor (R$)', 'number'],
      ['transaction_date', 'Data da movimentação', 'date'],
      ['bank_account_id', 'Conta bancária afetada', 'account'],
    ],
    columns: [
      ['description', 'Descrição'],
      ['type', 'Tipo'],
      ['amount', 'Valor'],
      ['transaction_date', 'Data'],
    ],
  },
};

