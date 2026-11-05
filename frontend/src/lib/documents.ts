import type { OpportunityStatus, OrderStatus, QuoteStatus, StageMilestone } from '@arandue/shared/schemas';
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
  opportunityId: number | null;
  opportunityTitle: string | null;
  originQuoteId: number | null;
  originOrderId: number | null;
  originKind: 'converted' | 'duplicated' | 'copied' | null;
  status: QuoteStatus;
  discount: number;
  freight: number;
  otherCharges: number;
  total: number;
  validUntil: string | null;
  notes: string | null;
  internalNotes: string | null;
  siteDescription: string | null;
  siteContact: string | null;
  siteAddress: string | null;
  sellerName: string | null;
  orderId: number | null;
  orderNumber: number | null;
  items: DocumentItem[];
}

// Espelho do cliente: o que vai para o cliente, sem custos nem observação interna.
export interface QuoteMirror {
  number: number;
  status: QuoteStatus;
  createdAt: string;
  sentAt: string | null;
  validUntil: string | null;
  discount: number;
  freight: number;
  otherCharges: number;
  total: number;
  notes: string | null;
  siteDescription: string | null;
  siteContact: string | null;
  siteAddress: string | null;
  sellerName: string | null;
  issuer: {
    name: string;
    legalName: string | null;
    cnpj: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    logo: string | null;
    terms: string | null;
  };
  customer: {
    name: string;
    legalName: string | null;
    document: string | null;
    email: string | null;
    phones: string | null;
    address: string | null;
  } | null;
  items: { name: string; quantity: number; unitPrice: number; subtotal: number }[];
}

export interface Order {
  id: number;
  number: number;
  customerId: number | null;
  customerName: string | null;
  quoteId: number | null;
  opportunityId: number | null;
  opportunityTitle: string | null;
  originQuoteId: number | null;
  originOrderId: number | null;
  originKind: 'converted' | 'duplicated' | 'copied' | null;
  orderDate: string;
  status: OrderStatus;
  discount: number;
  freight: number;
  otherCharges: number;
  total: number;
  notes: string | null;
  items: DocumentItem[];
}

export interface Customer {
  id: number;
  name: string;
}

export interface PipelineStage {
  id: number;
  name: string;
  position: number;
  color: string;
  milestone: StageMilestone | null;
}

export interface Opportunity {
  id: number;
  title: string;
  customerId: number | null;
  customerName: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  source: string;
  stageId: number;
  stageName: string;
  stageColor: string;
  status: OpportunityStatus;
  estimatedValue: number | null;
  expectedCloseDate: string | null;
  ownerId: number | null;
  ownerName: string | null;
  lostReason: string | null;
  nextAction: string | null;
  nextActionAt: string | null;
  updatedAt: string;
}

export interface OpportunityTotals {
  open: { count: number; value: number };
  won: { count: number; value: number };
  lost: { count: number; value: number };
  all: { count: number; value: number };
}

export interface OpportunityDetail extends Opportunity {
  interactions: {
    id: number;
    kind: string;
    channel: string;
    description: string;
    occurredAt: string;
    userName: string | null;
  }[];
  items: {
    id: number;
    productId: number;
    productName: string;
    quantity: number;
    unitPrice: number | null;
    catalogPrice: number;
  }[];
  quotes: { id: number; number: number; status: string; total: number }[];
  orders: { id: number; number: number; status: string; total: number; orderDate: string }[];
  values: { estimated: number; inQuotes: number; inOrders: number; received: number };
}

export interface TraceNode {
  type: 'quote' | 'order';
  id: number;
  number: number;
  status: string;
  total: number;
  kind: 'converted' | 'duplicated' | 'copied' | null;
  date: string;
  receivedAt: string | null;
  children: TraceNode[];
}

export interface Trace {
  opportunity: { id: number; title: string; status: OpportunityStatus; stageName: string } | null;
  roots: TraceNode[];
}

export const useOpportunity = (id: number | null) =>
  useQuery({
    queryKey: ['/opportunities', id],
    queryFn: () => api<OpportunityDetail>(`/opportunities/${id}`),
    enabled: id !== null,
  });

export const useStages = () =>
  useQuery({ queryKey: ['/pipeline-stages'], queryFn: () => api<PipelineStage[]>('/pipeline-stages') });

export const useTrace = (type: 'quote' | 'order', id: number | null) =>
  useQuery({
    queryKey: ['/trace', type, id],
    queryFn: () => api<Trace>(`/trace/${type}/${id}`),
    enabled: id !== null,
  });

export const useQuote = (id: number | null) =>
  useQuery({ queryKey: ['/quotes', id], queryFn: () => api<Quote>(`/quotes/${id}`), enabled: id !== null });

export const useOrder = (id: number | null) =>
  useQuery({ queryKey: ['/orders', id], queryFn: () => api<Order>(`/orders/${id}`), enabled: id !== null });
