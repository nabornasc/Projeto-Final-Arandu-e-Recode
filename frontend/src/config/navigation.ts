import type { Module } from '@arandue/shared/rbac';
import {
  Banknote,
  Boxes,
  CircleDollarSign,
  ClipboardList,
  LayoutDashboard,
  type LucideIcon,
  Receipt,
  Users,
} from 'lucide-react';

// Fica separado de resources.ts para o menu não puxar os schemas (zod) para o pacote inicial.
export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  module: Module;
}

// O menu mostra só os itens que o papel do usuário pode ler (o backend é quem garante).
export const navigation: NavItem[] = [
  { path: '/', label: 'Visão geral', icon: LayoutDashboard, module: 'analytics' },
  { path: '/pedidos', label: 'Vendas e pedidos', icon: ClipboardList, module: 'sales' },
  { path: '/produtos', label: 'Produtos e serviços', icon: Boxes, module: 'products' },
  { path: '/clientes', label: 'Clientes', icon: Users, module: 'customers' },
  { path: '/despesas', label: 'Despesas', icon: Receipt, module: 'finance' },
  { path: '/contas', label: 'Contas bancárias', icon: Banknote, module: 'finance' },
  { path: '/movimentacoes', label: 'Movimentações', icon: CircleDollarSign, module: 'finance' },
];
