import { type CopyToOrderInput, copyToOrderSchema } from '@arandue/shared/schemas';
import { db } from '../db/client.ts';
import { authorize, type Ctx } from '../lib/context.ts';
import { parse } from '../lib/validate.ts';
import { getOrder, insertOrder } from './orders.ts';
import { getQuote, insertQuote } from './quotes.ts';

// Duplicar = novo documento do mesmo tipo; copiar = para o outro tipo. Usam os itens e preços da
// origem (ler a origem exige a permissão de leitura dela, com o escopo do grupo). Pedido gerado
// por cópia baixa o estoque como qualquer pedido e nasce pendente.

const itemsOf = (doc: { items: { productId: number; quantity: number; unitPrice: number }[] }) =>
  doc.items.map(({ productId, quantity, unitPrice }) => ({ productId, quantity, unitPrice }));

export async function duplicateQuote(ctx: Ctx, id: number) {
  authorize(ctx, 'quotes.create');
  const source = await getQuote(ctx, id);
  const newId = await db.transaction((tx) =>
    insertQuote(
      tx,
      ctx,
      {
        customerId: source.customerId,
        validUntil: null,
        discount: source.discount,
        notes: source.notes,
        items: itemsOf(source),
      },
      { duplicatedFrom: { quote: id } },
    ),
  );
  return getQuote(ctx, newId);
}

// Orçamento → pedido direto, sem passar pela aprovação (quem pode criar pedido já poderia digitá-lo).
export async function copyQuoteToOrder(ctx: Ctx, id: number, input: CopyToOrderInput) {
  authorize(ctx, 'orders.create');
  const data = parse(copyToOrderSchema, input);
  const source = await getQuote(ctx, id);
  const order = await db.transaction((tx) =>
    insertOrder(tx, ctx, {
      customerId: source.customerId,
      orderDate: data.orderDate,
      status: 'pending',
      discount: source.discount,
      notes: source.notes,
      bankAccountId: null,
      items: itemsOf(source),
    }),
  );
  return getOrder(ctx, order.id);
}

export async function duplicateOrder(ctx: Ctx, id: number, input: CopyToOrderInput) {
  authorize(ctx, 'orders.create');
  const data = parse(copyToOrderSchema, input);
  const source = await getOrder(ctx, id);
  const order = await db.transaction((tx) =>
    insertOrder(tx, ctx, {
      customerId: source.customerId,
      orderDate: data.orderDate,
      status: 'pending',
      discount: source.discount,
      notes: source.notes,
      bankAccountId: null,
      items: itemsOf(source),
    }),
  );
  return getOrder(ctx, order.id);
}

export async function copyOrderToQuote(ctx: Ctx, id: number) {
  authorize(ctx, 'quotes.create');
  const source = await getOrder(ctx, id);
  const newId = await db.transaction((tx) =>
    insertQuote(
      tx,
      ctx,
      {
        customerId: source.customerId,
        validUntil: null,
        discount: source.discount,
        notes: source.notes,
        items: itemsOf(source),
      },
      { copiedFrom: { order: id } },
    ),
  );
  return getQuote(ctx, newId);
}
