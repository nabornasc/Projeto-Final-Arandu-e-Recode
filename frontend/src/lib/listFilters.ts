import { useState } from 'react';
import { todayIso } from './format.ts';

// Filtros das telas de lista. A API devolve os 500 registros mais recentes e a tela filtra sobre eles.
export const LIST_LIMIT = 500;

export const PERIODS = [
  ['all', 'Todos'],
  ['yesterday', 'Ontem'],
  ['today', 'Hoje'],
  ['tomorrow', 'Amanhã'],
  ['thisWeek', 'Esta semana'],
  ['nextWeek', 'Semana que vem'],
  ['lastWeek', 'Semana passada'],
  ['thisMonth', 'Este mês'],
  ['nextMonth', 'Mês que vem'],
  ['lastMonth', 'Mês passado'],
  ['thisYear', 'Este ano'],
  ['nextYear', 'Ano que vem'],
  ['lastYear', 'Ano passado'],
  ['custom', 'Personalizado'],
] as const;
export type PeriodKey = (typeof PERIODS)[number][0];

const iso = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);

// A semana vai de segunda a domingo. "Personalizado" mantém as datas digitadas.
export function periodRange(key: Exclude<PeriodKey, 'custom'>, today = todayIso()) {
  if (key === 'all') return { from: '', to: '' };
  const [year = 0, month = 1, day = 1] = today.split('-').map(Number);
  const m = month - 1;
  const days = (offset: number) => iso(year, m, day + offset);
  const week = (offset: number) => {
    const fromMonday = (new Date(Date.UTC(year, m, day)).getUTCDay() + 6) % 7;
    const monday = day - fromMonday + offset * 7;
    return { from: iso(year, m, monday), to: iso(year, m, monday + 6) };
  };
  const monthOf = (offset: number) => ({ from: iso(year, m + offset, 1), to: iso(year, m + offset + 1, 0) });
  const yearOf = (offset: number) => ({ from: iso(year + offset, 0, 1), to: iso(year + offset, 11, 31) });
  switch (key) {
    case 'yesterday':
      return { from: days(-1), to: days(-1) };
    case 'today':
      return { from: days(0), to: days(0) };
    case 'tomorrow':
      return { from: days(1), to: days(1) };
    case 'thisWeek':
      return week(0);
    case 'nextWeek':
      return week(1);
    case 'lastWeek':
      return week(-1);
    case 'thisMonth':
      return monthOf(0);
    case 'nextMonth':
      return monthOf(1);
    case 'lastMonth':
      return monthOf(-1);
    case 'thisYear':
      return yearOf(0);
    case 'nextYear':
      return yearOf(1);
    case 'lastYear':
      return yearOf(-1);
  }
}

export interface ListFilterState {
  period: PeriodKey;
  from: string;
  to: string;
  status: string;
  text: string;
}

const EMPTY: ListFilterState = { period: 'all', from: '', to: '', status: '', text: '' };

// "initial" define o que a tela mostra ao abrir e ao limpar os filtros.
export function useListFilters(initial: Partial<ListFilterState> = {}) {
  const start = { ...EMPTY, ...initial };
  const [filters, setFilters] = useState(start);
  return {
    filters,
    setFilters,
    clear: () => setFilters(start),
    active: JSON.stringify(filters) !== JSON.stringify(start),
  };
}

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

// Data no fuso do navegador: um momento vira o dia em que aconteceu para quem está vendo.
function dayOf(value: string) {
  if (value.length === 10) return value;
  const parsed = new Date(value);
  return new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export interface ListFilterFields<T> {
  date: (row: T) => string | null | undefined;
  status?: (row: T) => string;
  text: (row: T) => (string | number | null | undefined)[];
}

export function applyListFilters<T>(rows: T[], filters: ListFilterState, fields: ListFilterFields<T>) {
  const search = normalize(filters.text);
  return rows.filter((row) => {
    if (filters.status && fields.status?.(row) !== filters.status) return false;
    if (filters.from || filters.to) {
      const value = fields.date(row);
      if (!value) return false;
      const day = dayOf(value);
      if ((filters.from && day < filters.from) || (filters.to && day > filters.to)) return false;
    }
    if (!search) return true;
    return fields.text(row).some((value) => value != null && normalize(String(value)).includes(search));
  });
}
