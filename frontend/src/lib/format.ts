const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const date = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' });

export const formatMoney = (value: number | null | undefined) => money.format(Number(value ?? 0));

// A API devolve datas como 'AAAA-MM-DD'; tratamos como UTC para não mudar o dia pelo fuso.
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(parsed.getTime()) ? '—' : date.format(parsed);
}

// Número sequencial da empresa exibido como #001.
export const formatCode = (value: number) => `#${String(value).padStart(3, '0')}`;

export const todayIso = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

export function formatToday(): string {
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
    .format(new Date())
    .toUpperCase();
}

export const LABELS: Record<string, string> = {
  product: 'Produto',
  service: 'Serviço',
  income: 'Entrada',
  outcome: 'Saída',
  pending: 'Pendente',
  paid: 'Pago',
  completed: 'Concluído',
  cancelled: 'Cancelado',
  draft: 'Rascunho',
  sent: 'Enviado',
  approved: 'Aprovado',
  rejected: 'Recusado',
  // CRM: situação, marcos, atividades e canais.
  open: 'Em andamento',
  won: 'Ganha',
  lost: 'Perdida',
  start: 'Início',
  quote_sent: 'Orçamento enviado',
  negotiation: 'Negociação',
  comment: 'Comentário',
  call: 'Ligação',
  visit: 'Visita',
  meeting: 'Reunião',
  proposal: 'Proposta',
  email: 'E-mail',
  event: 'Automático',
  converted: 'Convertido',
  duplicated: 'Duplicado',
  copied: 'Copiado',
  web: 'Sistema / site',
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  phone: 'Telefone',
  in_person: 'Presencial',
  checking: 'Corrente',
  savings: 'Poupança',
  cash: 'Caixa físico',
};

export const label = (value: string | null | undefined) => (value ? (LABELS[value] ?? value) : '—');
