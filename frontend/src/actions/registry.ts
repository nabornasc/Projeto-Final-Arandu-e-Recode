import { can, type Permission } from '@arandue/shared/permissions';
import {
  Ban,
  CheckCircle2,
  ClipboardList,
  Copy,
  CopyPlus,
  FileInput,
  FileOutput,
  FilePlus2,
  FileText,
  HandCoins,
  Handshake,
  Link2,
  Link2Off,
  type LucideIcon,
  PackageCheck,
  Printer,
  RotateCcw,
  Send,
  ThumbsDown,
  Trash2,
  Trophy,
  Undo2,
  UserPlus,
  XCircle,
} from 'lucide-react';
import { canReopenQuote, type Opportunity, type Order, type Quote } from '../lib/documents.ts';
import { formatCode } from '../lib/format.ts';
import type { PersonSummary } from '../lib/people.ts';
import type { ReasonRequest } from './ReasonModal.tsx';

// Registro central de ações. Cada ação é definida uma vez e aparece onde fizer sentido: menu ⋯ das
// listas e dos documentos, busca rápida, atalhos e acesso rápido do dashboard. O backend decide de
// verdade (403); aqui só se esconde o que não se aplica ao registro ou ao grupo do usuário.

export interface ActionKit {
  open(path: string): void;
  request<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T>;
  // Recarrega os dados afetados e mostra a mensagem de sucesso.
  done(message: string): void;
  convert(quote: Quote): void;
  loseOpportunity(opportunity: Opportunity): void;
  // Pergunta se a cópia fica na mesma oportunidade (quando o documento tem vínculo).
  duplicate(type: 'quote' | 'order', document: Quote | Order): void;
  linkOpportunity(type: 'quote' | 'order', document: Quote | Order): void;
  settle(order: Order): void;
  // Pede o motivo antes de recusar ou cancelar.
  askReason(request: ReasonRequest): void;
  today(): string;
}

export type ActionGroup = 'open' | 'actions' | 'trace' | 'link' | 'danger';
export const GROUP_LABELS: Record<ActionGroup, string | null> = {
  open: null,
  actions: 'Ações',
  trace: 'Rastrear',
  link: 'Oportunidade',
  danger: null,
};
export const GROUP_ORDER: ActionGroup[] = ['open', 'actions', 'trace', 'link', 'danger'];

export interface RecordAction<T> {
  id: string;
  group?: ActionGroup;
  label: string | ((record: T) => string);
  icon: LucideIcon;
  // Todas são exigidas. Função quando depende do registro (ex.: cancelar pedido já pago).
  permissions: Permission[] | ((record: T) => Permission[]);
  when?: (record: T) => boolean;
  // Além das permissões: nenhum grupo pode receber esta ação, só o Proprietário.
  ownerOnly?: (record: T) => boolean;
  confirm?: (record: T) => string;
  danger?: boolean;
  run(record: T, kit: ActionKit): void | Promise<void>;
}

export interface GlobalAction {
  id: string;
  label: string;
  icon: LucideIcon;
  permissions: Permission[];
  run(kit: ActionKit): void;
}

export function availableActions<T>(
  actions: RecordAction<T>[],
  record: T,
  granted: readonly string[],
  isOwner: boolean,
): RecordAction<T>[] {
  return actions.filter((action) => {
    if (!isOwner && action.ownerOnly?.(record)) return false;
    const required =
      typeof action.permissions === 'function' ? action.permissions(record) : action.permissions;
    return required.every((permission) => can(granted, permission)) && (action.when?.(record) ?? true);
  });
}

export const labelOf = <T>(action: RecordAction<T>, record: T) =>
  typeof action.label === 'function' ? action.label(record) : action.label;

const RECEIVED = ['paid', 'completed'];

// ---------- Orçamentos ----------

const transition = (quote: Quote, kit: ActionKit, name: 'send' | 'approve', message: string) =>
  kit.request(`/quotes/${quote.id}/${name}`, { method: 'POST' }).then(() => kit.done(message));

const QUOTE_REASONS = [
  'Preço',
  'Prazo de entrega',
  'Escolheu concorrente',
  'Sem retorno',
  'Desistiu da compra',
];

const baseQuoteActions: RecordAction<Quote>[] = [
  {
    id: 'quote.open',
    group: 'open',
    label: (q) => (q.status === 'draft' ? 'Abrir e editar' : 'Abrir'),
    icon: FileText,
    permissions: ['quotes.read'],
    run: (q, kit) => kit.open(`/orcamentos/${q.id}`),
  },
  {
    id: 'quote.mirror',
    group: 'open',
    label: 'Espelho do cliente',
    icon: Printer,
    permissions: ['quotes.read'],
    // Em outra guia, sem o menu do sistema, para imprimir ou salvar em PDF.
    run: (q) => void window.open(`/espelho/orcamento/${q.id}`, '_blank'),
  },
  {
    id: 'quote.internalMirror',
    group: 'open',
    label: 'Espelho interno',
    icon: Printer,
    permissions: ['quotes.read', 'costs.read'],
    run: (q) => void window.open(`/espelho/orcamento/${q.id}/interno`, '_blank'),
  },
  {
    id: 'quote.send',
    label: 'Enviar ao cliente',
    icon: Send,
    permissions: ['quotes.send'],
    when: (q) => q.status === 'draft',
    run: (q, kit) => transition(q, kit, 'send', `Orçamento ${formatCode(q.number)} enviado.`),
  },
  {
    id: 'quote.approve',
    label: 'Aprovar',
    icon: CheckCircle2,
    permissions: ['quotes.approve'],
    when: (q) => q.status === 'sent',
    run: (q, kit) => transition(q, kit, 'approve', `Orçamento ${formatCode(q.number)} aprovado.`),
  },
  {
    id: 'quote.reject',
    label: 'Recusar',
    icon: XCircle,
    permissions: ['quotes.approve'],
    when: (q) => q.status === 'sent',
    run: async (q, kit) =>
      kit.askReason({
        eyebrow: 'ORÇAMENTO',
        title: `Recusar o orçamento ${formatCode(q.number)}`,
        confirmLabel: 'Recusar orçamento',
        suggestions: QUOTE_REASONS,
        submit: (reason) => kit.request(`/quotes/${q.id}/reject`, { method: 'POST', body: { reason } }),
        message: `Orçamento ${formatCode(q.number)} recusado.`,
      }),
  },
  {
    id: 'quote.reopen',
    label: 'Reabrir para alterar',
    icon: Undo2,
    permissions: ['quotes.update'],
    when: canReopenQuote,
    run: async (q, kit) =>
      kit.askReason({
        eyebrow: 'ORÇAMENTO',
        title: `Reabrir o orçamento ${formatCode(q.number)}`,
        description:
          'O orçamento volta para rascunho e precisa ser enviado de novo. Se estava aprovado, a aprovação deixa de valer.',
        confirmLabel: 'Reabrir orçamento',
        suggestions: ['Cliente pediu alteração', 'Erro no orçamento', 'Ajuste de preço ou prazo'],
        submit: (reason) => kit.request(`/quotes/${q.id}/reopen`, { method: 'POST', body: { reason } }),
        message: `Orçamento ${formatCode(q.number)} reaberto.`,
      }),
  },
  {
    id: 'quote.cancel',
    label: 'Cancelar orçamento',
    icon: Ban,
    danger: true,
    permissions: ['quotes.cancel'],
    when: (q) => (q.status === 'sent' || q.status === 'approved') && q.orderId === null,
    run: async (q, kit) =>
      kit.askReason({
        eyebrow: 'ORÇAMENTO',
        title: `Cancelar o orçamento ${formatCode(q.number)}`,
        description: 'O cancelamento é definitivo. Para retomar a venda, duplique o orçamento.',
        confirmLabel: 'Cancelar orçamento',
        suggestions: ['Pedido do cliente', 'Erro no orçamento', 'Substituído por outro orçamento'],
        submit: (reason) => kit.request(`/quotes/${q.id}/cancel`, { method: 'POST', body: { reason } }),
        message: `Orçamento ${formatCode(q.number)} cancelado.`,
      }),
  },
  {
    id: 'quote.convert',
    label: 'Converter em pedido',
    icon: PackageCheck,
    permissions: ['quotes.convert'],
    when: (q) => q.status === 'approved' && q.orderId === null,
    run: (q, kit) => kit.convert(q),
  },
  {
    id: 'quote.openOrder',
    group: 'trace',
    label: (q) => `Abrir pedido ${formatCode(q.orderNumber ?? 0)}`,
    icon: ClipboardList,
    permissions: ['orders.read'],
    when: (q) => q.orderId !== null,
    run: (q, kit) => kit.open(`/pedidos/${q.orderId}`),
  },
  {
    id: 'quote.duplicate',
    label: 'Duplicar',
    icon: CopyPlus,
    permissions: ['quotes.create'],
    run: (q, kit) => kit.duplicate('quote', q),
  },
  {
    id: 'quote.copyToOrder',
    label: 'Copiar para novo pedido',
    icon: FileOutput,
    permissions: ['orders.create'],
    confirm: (q) =>
      `Criar um pedido com os itens do orçamento ${formatCode(q.number)}? O estoque será baixado.`,
    run: async (q, kit) => {
      const order = await kit.request<Order>(`/quotes/${q.id}/copy-to-order`, {
        method: 'POST',
        body: { orderDate: kit.today() },
      });
      kit.done(`Pedido ${formatCode(order.number)} criado a partir do orçamento ${formatCode(q.number)}.`);
      kit.open(`/pedidos/${order.id}`);
    },
  },
  {
    id: 'quote.delete',
    group: 'danger',
    label: 'Excluir',
    icon: Trash2,
    danger: true,
    permissions: ['quotes.delete'],
    // Só rascunho: o que já saiu da empresa é cancelado, com motivo.
    when: (q) => q.status === 'draft',
    // Rascunho reaberto já foi enviado: só o Proprietário pode desbloquear a exclusão.
    ownerOnly: (q) => q.sentAt !== null,
    confirm: (q) =>
      q.sentAt
        ? `O orçamento ${formatCode(q.number)} já foi enviado ao cliente. Excluir mesmo assim? O registro continua no histórico.`
        : `Excluir o orçamento ${formatCode(q.number)}?`,
    run: (q, kit) =>
      kit
        .request(`/quotes/${q.id}`, { method: 'DELETE' })
        .then(() => kit.done(`Orçamento ${formatCode(q.number)} excluído.`)),
  },
];

// ---------- Pedidos ----------

const setOrderStatus = (order: Order, kit: ActionKit, status: string, message: string) =>
  kit.request(`/orders/${order.id}`, { method: 'PUT', body: { status } }).then(() => kit.done(message));

const baseOrderActions: RecordAction<Order>[] = [
  {
    id: 'order.open',
    group: 'open',
    label: 'Abrir',
    icon: FileText,
    permissions: ['orders.read'],
    run: (o, kit) => kit.open(`/pedidos/${o.id}`),
  },
  {
    id: 'order.settle',
    label: 'Dar baixa (recebido)',
    icon: HandCoins,
    permissions: ['receivables.settle'],
    when: (o) => o.status === 'pending',
    run: (o, kit) => kit.settle(o),
  },
  {
    id: 'order.complete',
    label: 'Marcar como concluído',
    icon: PackageCheck,
    permissions: ['receivables.settle'],
    when: (o) => o.status === 'paid',
    run: (o, kit) => setOrderStatus(o, kit, 'completed', `Pedido ${formatCode(o.number)} concluído.`),
  },
  {
    id: 'order.cancel',
    label: 'Cancelar pedido',
    icon: XCircle,
    danger: true,
    // Cancelar um pedido já recebido também mexe no caixa.
    permissions: (o) =>
      RECEIVED.includes(o.status) ? ['orders.cancel', 'receivables.settle'] : ['orders.cancel'],
    when: (o) => o.status !== 'cancelled',
    run: async (o, kit) =>
      kit.askReason({
        eyebrow: 'PEDIDO',
        title: `Cancelar o pedido ${formatCode(o.number)}`,
        description: 'O estoque será devolvido.',
        confirmLabel: 'Cancelar pedido',
        suggestions: ['Pedido do cliente', 'Falta de estoque', 'Erro no pedido', 'Pagamento não realizado'],
        submit: (reason) =>
          kit.request(`/orders/${o.id}`, { method: 'PUT', body: { status: 'cancelled', reason } }),
        message: `Pedido ${formatCode(o.number)} cancelado.`,
      }),
  },
  {
    id: 'order.reactivate',
    label: 'Reativar pedido',
    icon: RotateCcw,
    permissions: ['orders.cancel'],
    when: (o) => o.status === 'cancelled',
    run: (o, kit) => setOrderStatus(o, kit, 'pending', `Pedido ${formatCode(o.number)} reativado.`),
  },
  {
    id: 'order.openQuote',
    group: 'trace',
    label: 'Abrir orçamento de origem',
    icon: FileText,
    permissions: ['quotes.read'],
    when: (o) => o.quoteId !== null,
    run: (o, kit) => kit.open(`/orcamentos/${o.quoteId}`),
  },
  {
    id: 'order.duplicate',
    label: 'Duplicar',
    icon: Copy,
    permissions: ['orders.create'],
    run: (o, kit) => kit.duplicate('order', o),
  },
  {
    id: 'order.copyToQuote',
    label: 'Copiar para novo orçamento',
    icon: FileInput,
    permissions: ['quotes.create'],
    run: async (o, kit) => {
      const quote = await kit.request<Quote>(`/orders/${o.id}/copy-to-quote`, { method: 'POST' });
      kit.done(`Orçamento ${formatCode(quote.number)} criado a partir do pedido ${formatCode(o.number)}.`);
      kit.open(`/orcamentos/${quote.id}`);
    },
  },
  {
    id: 'order.delete',
    group: 'danger',
    label: 'Excluir',
    icon: Trash2,
    danger: true,
    permissions: ['orders.delete'],
    confirm: (o) => `Excluir o pedido ${formatCode(o.number)}? O estoque será devolvido.`,
    run: (o, kit) =>
      kit
        .request(`/orders/${o.id}`, { method: 'DELETE' })
        .then(() => kit.done(`Pedido ${formatCode(o.number)} excluído.`)),
  },
];

// ---------- CRM ----------

export const opportunityActions: RecordAction<Opportunity>[] = [
  {
    id: 'opportunity.open',
    group: 'open',
    label: 'Abrir',
    icon: FileText,
    permissions: ['opportunities.read'],
    run: (opportunity, kit) => kit.open(`/crm/${opportunity.id}`),
  },
  {
    id: 'opportunity.quote',
    label: 'Criar orçamento',
    icon: FilePlus2,
    permissions: ['quotes.create'],
    when: (opportunity) => opportunity.status === 'open',
    run: (opportunity, kit) => kit.open(`/crm/${opportunity.id}/orcamento`),
  },
  {
    id: 'opportunity.won',
    label: 'Marcar como ganha (vira cliente)',
    icon: Trophy,
    permissions: ['opportunities.update'],
    when: (opportunity) => opportunity.status === 'open',
    run: (opportunity, kit) =>
      kit
        .request(`/opportunities/${opportunity.id}/status`, { method: 'POST', body: { status: 'won' } })
        .then(() => kit.done(`${opportunity.title}: ganha.`)),
  },
  {
    id: 'opportunity.lost',
    label: 'Marcar como perdida',
    icon: ThumbsDown,
    permissions: ['opportunities.update'],
    when: (opportunity) => opportunity.status === 'open',
    run: (opportunity, kit) => kit.loseOpportunity(opportunity),
  },
  {
    id: 'opportunity.reopen',
    label: 'Reabrir',
    icon: Undo2,
    permissions: ['opportunities.update'],
    when: (opportunity) => opportunity.status !== 'open',
    run: (opportunity, kit) =>
      kit
        .request(`/opportunities/${opportunity.id}/status`, { method: 'POST', body: { status: 'open' } })
        .then(() => kit.done(`${opportunity.title}: reaberta.`)),
  },
  {
    id: 'opportunity.delete',
    group: 'danger',
    label: 'Excluir',
    icon: Trash2,
    danger: true,
    permissions: ['opportunities.delete'],
    confirm: (opportunity) =>
      `Excluir a oportunidade ${opportunity.title} e o histórico? Orçamentos e pedidos vinculados continuam existindo.`,
    run: (opportunity, kit) =>
      kit
        .request(`/opportunities/${opportunity.id}`, { method: 'DELETE' })
        .then(() => kit.done(`${opportunity.title}: excluída.`)),
  },
];

// ---------- Vínculo com oportunidade (orçamentos e pedidos) ----------

function linkActions<T extends Quote | Order>(type: 'quote' | 'order', label: string): RecordAction<T>[] {
  const path = type === 'quote' ? 'quotes' : 'orders';
  const update = type === 'quote' ? 'quotes.update' : 'orders.update';
  return [
    {
      id: `${type}.openOpportunity`,
      group: 'trace',
      label: (doc) => `Abrir oportunidade${doc.opportunityTitle ? `: ${doc.opportunityTitle}` : ''}`,
      icon: Handshake,
      permissions: ['opportunities.read'],
      when: (doc) => doc.opportunityId !== null,
      run: (doc, kit) => kit.open(`/crm/${doc.opportunityId}`),
    },
    {
      id: `${type}.link`,
      group: 'link',
      label: (doc) => (doc.opportunityId ? 'Mover para outra oportunidade' : 'Vincular a uma oportunidade'),
      icon: Link2,
      permissions: [update, 'opportunities.read'],
      run: (doc, kit) => kit.linkOpportunity(type, doc),
    },
    {
      id: `${type}.createOpportunity`,
      group: 'link',
      label: 'Criar oportunidade a partir deste documento',
      icon: Handshake,
      permissions: [update, 'opportunities.create'],
      when: (doc) => doc.opportunityId === null,
      run: async (doc, kit) => {
        const created = await kit.request<Opportunity>(`/${path}/${doc.id}/opportunity`, { method: 'POST' });
        kit.done(`Oportunidade criada a partir do ${label} ${formatCode(doc.number)}.`);
        kit.open(`/crm/${created.id}`);
      },
    },
    {
      id: `${type}.unlink`,
      group: 'link',
      label: 'Desvincular da oportunidade',
      icon: Link2Off,
      permissions: [update],
      when: (doc) => doc.opportunityId !== null,
      confirm: (doc) =>
        `Desvincular o ${label} ${formatCode(doc.number)} da oportunidade? Os documentos que nasceram dele também saem; a origem continua registrada.`,
      run: (doc, kit) =>
        kit
          .request(`/${path}/${doc.id}/link`, { method: 'POST', body: { opportunityId: null } })
          .then(() => kit.done(`${label} ${formatCode(doc.number)} desvinculado.`)),
    },
  ];
}

export const quoteActions: RecordAction<Quote>[] = [
  ...baseQuoteActions,
  ...linkActions<Quote>('quote', 'orçamento'),
];
export const orderActions: RecordAction<Order>[] = [
  ...baseOrderActions,
  ...linkActions<Order>('order', 'pedido'),
];

// ---------- Pessoas ----------

// Excluir exige a permissão de todos os papéis da pessoa (cliente → customers; demais → suppliers).
const peopleAreas = (person: PersonSummary) => [
  ...(person.isCustomer ? (['customers'] as const) : []),
  ...(person.isSupplier || person.isCarrier || person.isSalesRep ? (['suppliers'] as const) : []),
];

export const personActions: RecordAction<PersonSummary>[] = [
  {
    id: 'person.open',
    group: 'open',
    label: 'Abrir cadastro',
    icon: FileText,
    permissions: (person) =>
      peopleAreas(person)
        .slice(0, 1)
        .map((area) => `${area}.read` as const),
    run: (person, kit) => kit.open(`/pessoas/${person.id}`),
  },
  {
    id: 'person.delete',
    group: 'danger',
    label: 'Excluir (ou arquivar, se já foi usado)',
    icon: Trash2,
    danger: true,
    permissions: (person) => peopleAreas(person).map((area) => `${area}.delete` as const),
    confirm: (person) =>
      `Excluir ${person.name}? Se já tiver orçamentos, pedidos ou oportunidades, o cadastro é arquivado em vez de excluído.`,
    run: (person, kit) =>
      kit
        .request(`/people/${person.id}`, { method: 'DELETE' })
        .then(() => kit.done(`${person.name} removido da lista.`)),
  },
];

// ---------- Ações gerais (busca rápida, atalhos e acesso rápido) ----------

export const globalActions: GlobalAction[] = [
  {
    id: 'customer.new',
    label: 'Novo cliente',
    icon: UserPlus,
    permissions: ['customers.create'],
    run: (kit) => kit.open('/clientes/novo'),
  },
  {
    id: 'opportunity.new',
    label: 'Nova oportunidade',
    icon: UserPlus,
    permissions: ['opportunities.create'],
    run: (kit) => kit.open('/crm/novo'),
  },
  {
    id: 'quote.new',
    label: 'Novo orçamento',
    icon: FilePlus2,
    permissions: ['quotes.create'],
    run: (kit) => kit.open('/orcamentos/novo'),
  },
  {
    id: 'order.new',
    label: 'Novo pedido',
    icon: FilePlus2,
    permissions: ['orders.create'],
    run: (kit) => kit.open('/pedidos/novo'),
  },
];
