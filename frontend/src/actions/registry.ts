import { can, type Permission } from '@arandue/shared/permissions';
import {
  ArrowRightCircle,
  CheckCircle2,
  ClipboardList,
  Copy,
  CopyPlus,
  FileInput,
  FileOutput,
  FilePlus2,
  FileText,
  HandCoins,
  type LucideIcon,
  PackageCheck,
  RotateCcw,
  Send,
  ThumbsDown,
  Trash2,
  Trophy,
  Undo2,
  UserPlus,
  XCircle,
} from 'lucide-react';
import type { Lead, Order, Quote } from '../lib/documents.ts';
import { formatCode, label } from '../lib/format.ts';
import type { PersonSummary } from '../lib/people.ts';

// Registro central de ações. Cada ação é definida uma vez e aparece onde fizer sentido: menu ⋯ das
// listas e dos documentos, busca rápida, atalhos e acesso rápido do dashboard. O backend decide de
// verdade (403); aqui só se esconde o que não se aplica ao registro ou ao grupo do usuário.

export interface ActionKit {
  open(path: string): void;
  request<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T>;
  // Recarrega os dados afetados e mostra a mensagem de sucesso.
  done(message: string): void;
  convert(quote: Quote): void;
  loseLead(lead: Lead): void;
  settle(order: Order): void;
  today(): string;
}

export interface RecordAction<T> {
  id: string;
  label: string | ((record: T) => string);
  icon: LucideIcon;
  // Todas são exigidas. Função quando depende do registro (ex.: cancelar pedido já pago).
  permissions: Permission[] | ((record: T) => Permission[]);
  when?: (record: T) => boolean;
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
): RecordAction<T>[] {
  return actions.filter((action) => {
    const required =
      typeof action.permissions === 'function' ? action.permissions(record) : action.permissions;
    return required.every((permission) => can(granted, permission)) && (action.when?.(record) ?? true);
  });
}

export const labelOf = <T>(action: RecordAction<T>, record: T) =>
  typeof action.label === 'function' ? action.label(record) : action.label;

const RECEIVED = ['paid', 'completed'];

// ---------- Orçamentos ----------

const transition = (quote: Quote, kit: ActionKit, name: 'send' | 'approve' | 'reject', message: string) =>
  kit.request(`/quotes/${quote.id}/${name}`, { method: 'POST' }).then(() => kit.done(message));

export const quoteActions: RecordAction<Quote>[] = [
  {
    id: 'quote.open',
    label: (q) => (q.status === 'draft' ? 'Abrir e editar' : 'Abrir'),
    icon: FileText,
    permissions: ['quotes.read'],
    run: (q, kit) => kit.open(`/orcamentos/${q.id}`),
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
    confirm: (q) => `Recusar o orçamento ${formatCode(q.number)}?`,
    run: (q, kit) => transition(q, kit, 'reject', `Orçamento ${formatCode(q.number)} recusado.`),
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
    run: async (q, kit) => {
      const copy = await kit.request<Quote>(`/quotes/${q.id}/duplicate`, { method: 'POST' });
      kit.done(`Orçamento ${formatCode(copy.number)} criado a partir do ${formatCode(q.number)}.`);
      kit.open(`/orcamentos/${copy.id}`);
    },
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
    label: 'Excluir',
    icon: Trash2,
    danger: true,
    permissions: ['quotes.delete'],
    when: (q) => q.orderId === null,
    confirm: (q) => `Excluir o orçamento ${formatCode(q.number)}?`,
    run: (q, kit) =>
      kit
        .request(`/quotes/${q.id}`, { method: 'DELETE' })
        .then(() => kit.done(`Orçamento ${formatCode(q.number)} excluído.`)),
  },
];

// ---------- Pedidos ----------

const setOrderStatus = (order: Order, kit: ActionKit, status: string, message: string) =>
  kit.request(`/orders/${order.id}`, { method: 'PUT', body: { status } }).then(() => kit.done(message));

export const orderActions: RecordAction<Order>[] = [
  {
    id: 'order.open',
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
    confirm: (o) => `Cancelar o pedido ${formatCode(o.number)}? O estoque será devolvido.`,
    run: (o, kit) => setOrderStatus(o, kit, 'cancelled', `Pedido ${formatCode(o.number)} cancelado.`),
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
    confirm: (o) => `Criar um pedido igual ao ${formatCode(o.number)}? O estoque será baixado.`,
    run: async (o, kit) => {
      const copy = await kit.request<Order>(`/orders/${o.id}/duplicate`, {
        method: 'POST',
        body: { orderDate: kit.today() },
      });
      kit.done(`Pedido ${formatCode(copy.number)} criado a partir do ${formatCode(o.number)}.`);
      kit.open(`/pedidos/${copy.id}`);
    },
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

// Etapas abertas do funil, na ordem; ganho e perdido são decididos por ações próprias.
export const OPEN_STAGES = ['new', 'contacted', 'quote_sent', 'negotiation'] as const;

const moveLead = (lead: Lead, kit: ActionKit, stage: string, message: string) =>
  kit.request(`/leads/${lead.id}/stage`, { method: 'POST', body: { stage } }).then(() => kit.done(message));

const nextStage = (lead: Lead) => {
  const index = OPEN_STAGES.indexOf(lead.stage as (typeof OPEN_STAGES)[number]);
  return index >= 0 && index < OPEN_STAGES.length - 1 ? OPEN_STAGES[index + 1] : null;
};

export const leadActions: RecordAction<Lead>[] = [
  {
    id: 'lead.open',
    label: 'Abrir',
    icon: FileText,
    permissions: ['leads.read'],
    run: (lead, kit) => kit.open(`/crm/${lead.id}`),
  },
  {
    id: 'lead.advance',
    label: (lead) => `Avançar para "${label(nextStage(lead))}"`,
    icon: ArrowRightCircle,
    permissions: ['leads.update'],
    when: (lead) => nextStage(lead) !== null,
    run: (lead, kit) => {
      const stage = nextStage(lead);
      if (stage) return moveLead(lead, kit, stage, `${lead.name}: ${label(stage)}.`);
    },
  },
  {
    id: 'lead.won',
    label: 'Marcar como ganho (vira cliente)',
    icon: Trophy,
    permissions: ['leads.update'],
    when: (lead) => lead.stage !== 'won',
    run: (lead, kit) => moveLead(lead, kit, 'won', `${lead.name} ganho e vinculado como cliente.`),
  },
  {
    id: 'lead.lost',
    label: 'Marcar como perdido',
    icon: ThumbsDown,
    danger: true,
    permissions: ['leads.update'],
    when: (lead) => lead.stage !== 'lost',
    run: (lead, kit) => kit.loseLead(lead),
  },
  {
    id: 'lead.reopen',
    label: 'Reabrir negociação',
    icon: Undo2,
    permissions: ['leads.update'],
    when: (lead) => lead.stage === 'won' || lead.stage === 'lost',
    run: (lead, kit) => moveLead(lead, kit, 'negotiation', `${lead.name} voltou para negociação.`),
  },
  {
    id: 'lead.delete',
    label: 'Excluir',
    icon: Trash2,
    danger: true,
    permissions: ['leads.delete'],
    confirm: (lead) => `Excluir o lead ${lead.name} e o histórico de atendimentos?`,
    run: (lead, kit) =>
      kit
        .request(`/leads/${lead.id}`, { method: 'DELETE' })
        .then(() => kit.done(`Lead ${lead.name} excluído.`)),
  },
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
    label: 'Excluir (ou arquivar, se já foi usado)',
    icon: Trash2,
    danger: true,
    permissions: (person) => peopleAreas(person).map((area) => `${area}.delete` as const),
    confirm: (person) =>
      `Excluir ${person.name}? Se já tiver orçamentos, pedidos ou leads, o cadastro é arquivado em vez de excluído.`,
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
    id: 'lead.new',
    label: 'Novo lead',
    icon: UserPlus,
    permissions: ['leads.create'],
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
