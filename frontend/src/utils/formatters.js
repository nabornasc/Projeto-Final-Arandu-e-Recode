export const moneyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export const dateFormatter = new Intl.DateTimeFormat('pt-BR');

export function formatMoney(val) {
  return moneyFormatter.format(Number(val || 0));
}

export function formatDate(val) {
  if (!val) return '—';
  const parsed = new Date(String(val).length === 10 ? `${val}T12:00:00` : val);
  return Number.isNaN(parsed.getTime()) ? '—' : dateFormatter.format(parsed);
}

export function getTodayFormatted() {
  const now = new Date();
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(now).toUpperCase();
}

const statusLabels = {
  product: 'Produto',
  service: 'Serviço',
  income: 'Entrada',
  outcome: 'Saída',
  pending: 'Pendente',
  paid: 'Pago',
  cancelled: 'Cancelado',
  checking: 'Corrente',
  savings: 'Poupança',
  cash: 'Caixa físico',
};

export function formatCell(key, value) {
  if (['price', 'cost', 'amount', 'initial_balance', 'total'].includes(key)) {
    return formatMoney(value);
  }
  if (key.includes('date') && value) {
    return formatDate(value);
  }
  return statusLabels[value] || value || '—';
}

