import type { Permission } from '@arandue/shared/permissions';
import {
  Banknote,
  Boxes,
  CircleDollarSign,
  ClipboardList,
  FileText,
  HandCoins,
  LayoutDashboard,
  type LucideIcon,
  Receipt,
  Settings,
  ShieldCheck,
  Truck,
  UserCog,
  Users,
} from 'lucide-react';

// Fica separado de resources.ts para o menu não puxar os schemas (zod) para o pacote inicial.
export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  // Permissão necessária para ver o item.
  permission: Permission;
}

// O menu mostra só os itens que o grupo do usuário pode ver (o backend é quem garante).
export const navigation: NavItem[] = [
  { path: '/', label: 'Visão geral', icon: LayoutDashboard, permission: 'analytics.read' },
  { path: '/orcamentos', label: 'Orçamentos', icon: FileText, permission: 'quotes.read' },
  { path: '/pedidos', label: 'Vendas e pedidos', icon: ClipboardList, permission: 'orders.read' },
  { path: '/contas-a-receber', label: 'Contas a receber', icon: HandCoins, permission: 'receivables.read' },
  { path: '/produtos', label: 'Produtos e serviços', icon: Boxes, permission: 'products.read' },
  { path: '/clientes', label: 'Clientes', icon: Users, permission: 'customers.read' },
  { path: '/fornecedores', label: 'Fornecedores', icon: Truck, permission: 'suppliers.read' },
  { path: '/despesas', label: 'Contas a pagar', icon: Receipt, permission: 'payables.read' },
  { path: '/contas', label: 'Contas bancárias', icon: Banknote, permission: 'bank_accounts.read' },
  { path: '/movimentacoes', label: 'Movimentações', icon: CircleDollarSign, permission: 'cash.read' },
  { path: '/usuarios', label: 'Usuários', icon: UserCog, permission: 'users.read' },
  { path: '/grupos', label: 'Grupos de acesso', icon: ShieldCheck, permission: 'access.manage' },
  { path: '/configuracoes', label: 'Configurações', icon: Settings, permission: 'settings.read' },
];

export const SETTINGS_PATH = '/configuracoes';
