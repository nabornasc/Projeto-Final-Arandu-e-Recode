import { type ComponentType, type LazyExoticComponent, lazy } from 'react';
import { matchPath } from 'react-router';
import { navigation } from '../config/navigation.ts';

// Telas que podem ser abertas em abas. Cada uma é carregada só quando aberta pela primeira vez.
interface PageDefinition {
  pattern: string;
  title: string;
  Component: LazyExoticComponent<ComponentType>;
}

const resourcePage = (name: keyof typeof import('../pages/ResourcePages.tsx')) =>
  lazy(async () => ({ default: (await import('../pages/ResourcePages.tsx'))[name] }));

const titleOf = (path: string) => navigation.find((item) => item.path === path)?.label ?? 'Aranduê';

const PeopleList = lazy(() => import('../pages/PeopleListPage.tsx'));
const PersonDocument = lazy(() => import('../pages/PersonDocumentPage.tsx'));
const OpportunityDocument = lazy(() => import('../pages/OpportunityDocumentPage.tsx'));
const QuoteDocument = lazy(() => import('../pages/QuoteDocumentPage.tsx'));
const OrderDocument = lazy(() => import('../pages/OrderDocumentPage.tsx'));

const PAGES: PageDefinition[] = [
  { pattern: '/', title: titleOf('/'), Component: lazy(() => import('../pages/DashboardPage.tsx')) },
  { pattern: '/crm', title: titleOf('/crm'), Component: lazy(() => import('../pages/CrmPage.tsx')) },
  { pattern: '/crm/novo', title: 'Nova oportunidade', Component: OpportunityDocument },
  { pattern: '/crm/novo/:stageId', title: 'Nova oportunidade', Component: OpportunityDocument },
  { pattern: '/crm/:opportunityId/orcamento', title: 'Novo orçamento', Component: QuoteDocument },
  { pattern: '/crm/:id', title: 'Oportunidade', Component: OpportunityDocument },
  {
    pattern: '/orcamentos',
    title: titleOf('/orcamentos'),
    Component: lazy(() => import('../pages/QuotesPage.tsx')),
  },
  { pattern: '/orcamentos/novo', title: 'Novo orçamento', Component: QuoteDocument },
  { pattern: '/orcamentos/:id', title: 'Orçamento', Component: QuoteDocument },
  {
    pattern: '/pedidos',
    title: titleOf('/pedidos'),
    Component: lazy(() => import('../pages/OrdersPage.tsx')),
  },
  { pattern: '/pedidos/novo', title: 'Novo pedido', Component: OrderDocument },
  { pattern: '/pedidos/:id', title: 'Pedido', Component: OrderDocument },
  {
    pattern: '/historico/:id',
    title: 'Alteração',
    Component: lazy(() => import('../pages/HistoryEntryPage.tsx')),
  },
  {
    pattern: '/contas-a-receber',
    title: titleOf('/contas-a-receber'),
    Component: lazy(() => import('../pages/ReceivablesPage.tsx')),
  },
  { pattern: '/produtos', title: titleOf('/produtos'), Component: resourcePage('ProductsPage') },
  // Cadastro único de pessoas: as listas filtram por papel; o cadastro abre em /pessoas/:id.
  { pattern: '/clientes', title: titleOf('/clientes'), Component: PeopleList },
  { pattern: '/fornecedores', title: titleOf('/fornecedores'), Component: PeopleList },
  { pattern: '/transportadoras', title: titleOf('/transportadoras'), Component: PeopleList },
  { pattern: '/representantes', title: 'Representantes', Component: PeopleList },
  { pattern: '/clientes/novo', title: 'Novo cliente', Component: PersonDocument },
  { pattern: '/fornecedores/novo', title: 'Novo fornecedor', Component: PersonDocument },
  { pattern: '/transportadoras/novo', title: 'Nova transportadora', Component: PersonDocument },
  { pattern: '/representantes/novo', title: 'Novo representante', Component: PersonDocument },
  { pattern: '/pessoas/:id', title: 'Cadastro', Component: PersonDocument },
  { pattern: '/despesas', title: titleOf('/despesas'), Component: resourcePage('ExpensesPage') },
  { pattern: '/contas', title: titleOf('/contas'), Component: resourcePage('AccountsPage') },
  {
    pattern: '/movimentacoes',
    title: titleOf('/movimentacoes'),
    Component: resourcePage('TransactionsPage'),
  },
  {
    pattern: '/usuarios',
    title: titleOf('/usuarios'),
    Component: lazy(() => import('../pages/UsersPage.tsx')),
  },
  {
    pattern: '/grupos',
    title: titleOf('/grupos'),
    Component: lazy(() => import('../pages/AccessGroupsPage.tsx')),
  },
  {
    pattern: '/configuracoes',
    title: titleOf('/configuracoes'),
    Component: lazy(() => import('../pages/SettingsPage.tsx')),
  },
];

const NotFound = lazy(() => import('../pages/NotFoundPage.tsx'));

export interface ResolvedPage {
  title: string;
  Component: LazyExoticComponent<ComponentType>;
  params: Record<string, string | undefined>;
  found: boolean;
}

export function resolvePage(path: string): ResolvedPage {
  for (const page of PAGES) {
    const match = matchPath({ path: page.pattern, end: true }, path);
    if (match) return { title: page.title, Component: page.Component, params: match.params, found: true };
  }
  return { title: 'Página não encontrada', Component: NotFound, params: {}, found: false };
}
