import { useQuery } from '@tanstack/react-query';
import { api } from './api.ts';

// Histórico de alterações de orçamentos e pedidos, como a API devolve.
export interface HistoryLine {
  id: number;
  actorName: string;
  summary: string;
  reason: string | null;
  createdAt: string;
}

export interface HistoryChange {
  field: string;
  label: string;
  kind: 'text' | 'money' | 'date' | 'status';
  from: string | number | null;
  to: string | number | null;
}

export interface HistoryItemChange {
  change: 'added' | 'removed' | 'changed';
  name: string;
  quantity: number;
  unitPrice: number;
  fromQuantity?: number;
  fromUnitPrice?: number;
}

export interface HistoryEntry extends HistoryLine {
  type: 'quote' | 'order';
  documentId: number;
  documentNumber: number | null;
  documentExists: boolean;
  changes: HistoryChange[];
  items: HistoryItemChange[];
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
