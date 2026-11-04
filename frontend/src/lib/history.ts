import { useQuery } from '@tanstack/react-query';
import { api } from './api.ts';

// Histórico de alterações de orçamentos e pedidos, como a API devolve.
export interface HistoryLine {
  id: number;
  actorName: string;
  summary: string;
  reason: string | null;
  createdAt: string;
  module: string;
  label: string | null;
}

export interface HistoryChange {
  field: string;
  label: string;
  kind: 'text' | 'money' | 'date' | 'status' | 'number' | 'boolean';
  from: string | number | boolean | null;
  to: string | number | boolean | null;
  masked?: boolean;
}

export interface HistoryItemChange {
  change: 'added' | 'removed' | 'changed';
  name: string;
  quantity: number;
  unitPrice: number | null;
  fromQuantity?: number;
  fromUnitPrice?: number | null;
}

export interface HistoryEntry extends HistoryLine {
  type: string;
  documentId: number | null;
  documentNumber: number | null;
  documentExists: boolean;
  path: string | null;
  openLabel: string;
  changes: HistoryChange[];
  items: HistoryItemChange[];
}

export interface HistoryPage {
  rows: HistoryLine[];
  total: number;
  page: number;
  pageSize: number;
}

export interface HistoryOptions {
  actors: { id: number; name: string }[];
  modules: string[];
}

export const useDocumentHistory = (type: 'quote' | 'order', id: number) =>
  useQuery({
    queryKey: ['/history', type, id],
    queryFn: () => api<HistoryLine[]>(`/history/${type}/${id}`),
  });

export const useHistoryEntry = (id: number) =>
  useQuery({
    queryKey: ['/history/entry', id],
    queryFn: () => api<HistoryEntry>(`/history/entry/${id}`),
    // Um registro nunca muda depois de gravado.
    staleTime: Number.POSITIVE_INFINITY,
  });
