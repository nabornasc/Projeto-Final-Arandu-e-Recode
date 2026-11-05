import {
  type CopyToOrderInput,
  copyToOrderSchema,
  type DuplicateQuoteInput,
  duplicateQuoteSchema,
} from '@arandue/shared/schemas';
import { db } from '../db/client.ts';
import { authorize, type Ctx } from '../lib/context.ts';
import { parse } from '../lib/validate.ts';
import { getOrder, insertOrder } from './orders.ts';
import { getQuote, insertQuote } from './quotes.ts';

// Duplicar = novo documento do mesmo tipo; copiar = para o outro tipo. Usam os itens e preços da
// origem (ler a origem exige a permissão de leitura dela, com o escopo do grupo). Pedido gerado
// por cópia baixa o estoque como qualquer pedido e nasce pendente.
// Rastreio: a cópia sempre guarda de onde veio; a oportunidade acompanha, salvo se o usuário
// desmarcar "manter na mesma oportunidade".

type Source = {
  customerId: number | null;
  discount: number;
  freight: number;
  otherCharges: number;
  notes: string | null;
  // Só o orçamento tem estes campos.
  internalNotes?: string | null;
  siteDescription?: string | null;
  siteContact?: string | null;
  siteAddress?: string | null;
  items: { productId: number; quantity: number; unitPrice: number }[];
};

const itemsOf = (doc: Source) =>
  doc.items.map(({ productId, quantity, unitPrice }) => ({ productId, quantity, unitPrice }));

const quoteFrom = (source: Source) => ({
  customerId: source.customerId,
  validUntil: null,
  discount: source.discount,
  freight: source.freight,
  otherCharges: source.otherCharges,
  notes: source.notes,
  internalNotes: source.internalNotes ?? null,
  siteDescription: source.siteDescription ?? null,
  siteContact: source.siteContact ?? null,
  siteAddress: source.siteAddress ?? null,
  items: itemsOf(source),
});

const orderFrom = (source: Source, orderDate: string) => ({
  customerId: source.customerId,
  orderDate,
  status: 'pending' as const,
  discount: source.discount,
  freight: source.freight,
  otherCharges: source.otherCharges,
  notes: source.notes,
  bankAccountId: null,
  items: itemsOf(source),
});

export async function duplicateQuote(ctx: Ctx, id: number, input?: DuplicateQuoteInput) {
  authorize(ctx, 'quotes.create');
  const { keepOpportunity } = parse(duplicateQuoteSchema, input ?? {});
  const source = await getQuote(ctx, id);
  const newId = await db.transaction((tx) =>
    insertQuote(tx, ctx, quoteFrom(source), {
      opportunityId: keepOpportunity ? source.opportunityId : null,
      originQuoteId: id,
      originKind: 'duplicated',
    }),
  );
  return getQuote(ctx, newId);
}

// Orçamento → pedido direto, sem passar pela aprovação (quem pode criar pedido já poderia digitá-lo).
export async function copyQuoteToOrder(ctx: Ctx, id: number, input: CopyToOrderInput) {
  authorize(ctx, 'orders.create');
  const data = parse(copyToOrderSchema, input);
  const source = await getQuote(ctx, id);
  const order = await db.transaction((tx) =>
    insertOrder(tx, ctx, orderFrom(source, data.orderDate), {
      opportunityId: data.keepOpportunity ? source.opportunityId : null,
      originQuoteId: id,
      originKind: 'copied',
    }),
  );
  return getOrder(ctx, order.id);
}

export async function duplicateOrder(ctx: Ctx, id: number, input: CopyToOrderInput) {
  authorize(ctx, 'orders.create');
  const data = parse(copyToOrderSchema, input);
  const source = await getOrder(ctx, id);
  const order = await db.transaction((tx) =>
    insertOrder(tx, ctx, orderFrom(source, data.orderDate), {
      opportunityId: data.keepOpportunity ? source.opportunityId : null,
      originOrderId: id,
      originKind: 'duplicated',
    }),
  );
  return getOrder(ctx, order.id);
}

export async function copyOrderToQuote(ctx: Ctx, id: number, input?: DuplicateQuoteInput) {
  authorize(ctx, 'quotes.create');
  const { keepOpportunity } = parse(duplicateQuoteSchema, input ?? {});
  const source = await getOrder(ctx, id);
  const newId = await db.transaction((tx) =>
    insertQuote(tx, ctx, quoteFrom(source), {
      opportunityId: keepOpportunity ? source.opportunityId : null,
      originOrderId: id,
      originKind: 'copied',
    }),
  );
  return getQuote(ctx, newId);
}
