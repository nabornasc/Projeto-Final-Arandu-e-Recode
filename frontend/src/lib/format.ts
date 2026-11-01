const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const date = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' });

export const formatMoney = (value: number | null | undefined) => money.format(Number(value ?? 0));

// A API devolve datas como 'AAAA-MM-DD'; tratamos como UTC para não mudar o dia pelo fuso.
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(parsed.getTime()) ? '—' : date.format(parsed);
}

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
  checking: 'Corrente',
  savings: 'Poupança',
  cash: 'Caixa físico',
};

export const label = (value: string | null | undefined) => (value ? (LABELS[value] ?? value) : '—');
