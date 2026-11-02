import type { OrderStatus, QuoteStatus } from '@arandue/shared/schemas';
import { useQuery } from '@tanstack/react-query';
import { api } from './api.ts';

// Formatos de orçamento e pedido devolvidos pela API (com itens), usados por listas, telas e ações.
export interface DocumentItem {
  id: number;
  productId: number;
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface Quote {
  id: number;
  number: number;
  customerId: number | null;
  customerName: string | null;
  status: QuoteStatus;
  discount: number;
  total: number;
  validUntil: string | null;
  notes: string | null;
  orderId: number | null;
  orderNumber: number | null;
  items: DocumentItem[];
}

export interface Order {
  id: number;
  number: number;
  customerId: number | null;
  customerName: string | null;
  quoteId: number | null;
  orderDate: string;
  status: OrderStatus;
  discount: number;
  total: number;
  notes: string | null;
  items: DocumentItem[];
}

export interface Customer {
  id: number;
  name: string;
}

export const useQuote = (id: number | null) =>
  useQuery({ queryKey: ['/quotes', id], queryFn: () => api<Quote>(`/quotes/${id}`), enabled: id !== null });

export const useOrder = (id: number | null) =>
  useQuery({ queryKey: ['/orders', id], queryFn: () => api<Order>(`/orders/${id}`), enabled: id !== null });
