import type { Permission } from '@arandue/shared/permissions';
import {
  type QuoteConvertInput,
  type QuoteInput,
  type QuoteStatus,
  quoteConvertSchema,
  quoteSchema,
} from '@arandue/shared/schemas';
import { and, asc, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { db, type Transaction } from '../db/client.ts';
import { orders, people, products, quoteItems, quotes } from '../db/schema.ts';
import { authorize, type Ctx, ownScope } from '../lib/context.ts';
import { conflict, notFound } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import { audit } from './audit.ts';
import { nextNumber } from './numbering.ts';
import { buildLines, getOrder, insertOrder } from './orders.ts';
import { assertCustomer } from './ownership.ts';

const scoped = (ctx: Ctx, id: number) =>
  and(eq(quotes.id, id), eq(quotes.companyId, ctx.companyId), ownScope(ctx, quotes.createdBy));

const STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: 'em rascunho',
  sent: 'enviado',
  approved: 'aprovado',
  rejected: 'recusado',
};

async function loadQuotes(where: SQL | undefined) {
  const rows = await db
    .select({
      id: quotes.id,
      number: quotes.number,
      customerId: quotes.customerId,
      customerName: people.name,
      status: quotes.status,
      discount: quotes.discount,
      total: quotes.total,
      validUntil: quotes.validUntil,
      notes: quotes.notes,
      sentAt: quotes.sentAt,
      decidedAt: quotes.decidedAt,
      createdAt: quotes.createdAt,
      // Pedido gerado na conversão (no máximo um por orçamento).
      orderId: orders.id,
      orderNumber: orders.number,
    })
    .from(quotes)
    .leftJoin(people, eq(people.id, quotes.customerId))
    .leftJoin(orders, eq(orders.quoteId, quotes.id))
    .where(where)
    .orderBy(desc(quotes.createdAt), desc(quotes.id))
    .limit(500);
  if (!rows.length) return [];

  const items = await db
    .select({
      id: quoteItems.id,
      quoteId: quoteItems.quoteId,
      productId: quoteItems.productId,
      productName: products.name,
      quantity: quoteItems.quantity,
      unitPrice: quoteItems.unitPrice,
      subtotal: quoteItems.subtotal,
    })
    .from(quoteItems)
    .innerJoin(products, eq(products.id, quoteItems.productId))
    .where(
      inArray(
        quoteItems.quoteId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(quoteItems.id));

  const byQuote = Map.groupBy(items, (item) => item.quoteId);
  return rows.map((row) => ({ ...row, items: byQuote.get(row.id) ?? [] }));
}

async function lockQuote(tx: Transaction, ctx: Ctx, id: number) {
  const [quote] = await tx.select().from(quotes).where(scoped(ctx, id)).for('update');
  if (!quote) throw notFound('Orçamento não encontrado.');
  return quote;
}

export async function listQuotes(ctx: Ctx) {
  authorize(ctx, 'quotes.read');
  return loadQuotes(and(eq(quotes.companyId, ctx.companyId), ownScope(ctx, quotes.createdBy)));
}

export async function getQuote(ctx: Ctx, id: number) {
  authorize(ctx, 'quotes.read');
  const [row] = await loadQuotes(scoped(ctx, id));
  if (!row) throw notFound('Orçamento não encontrado.');
  return row;
}

// Orçamento não mexe em estoque nem no caixa: isso só acontece ao converter em pedido.
type QuoteData = ReturnType<typeof quoteSchema.parse>;

// Cria o rascunho dentro de uma transação já aberta (orçamento novo, duplicado ou copiado de pedido).
export async function insertQuote(
  tx: Transaction,
  ctx: Ctx,
  data: QuoteData,
  origin?: Record<string, unknown>,
) {
  if (data.customerId) await assertCustomer(tx, ctx, data.customerId);
  const { lines, total } = await buildLines(tx, ctx, data.items, data.discount);

  const [quote] = await tx
    .insert(quotes)
    .values({
      companyId: ctx.companyId,
      number: await nextNumber(tx, ctx, 'quote'),
      customerId: data.customerId ?? null,
      validUntil: data.validUntil ?? null,
      discount: data.discount,
      total,
      notes: data.notes,
      createdBy: ctx.userId,
    })
    .returning({ id: quotes.id });
  if (!quote) throw new Error('Falha ao criar orçamento.');

  await tx.insert(quoteItems).values(lines.map((line) => ({ ...line, quoteId: quote.id })));
  await audit(tx, ctx, 'create', 'quote', quote.id, { total, ...origin });
  return quote.id;
}

export async function createQuote(ctx: Ctx, input: QuoteInput) {
  authorize(ctx, 'quotes.create');
  const data = parse(quoteSchema, input);
  const id = await db.transaction((tx) => insertQuote(tx, ctx, data));
  return getQuote(ctx, id);
}

export async function updateQuote(ctx: Ctx, id: number, input: QuoteInput) {
  authorize(ctx, 'quotes.update');
  const data = parse(quoteSchema, input);

  await db.transaction(async (tx) => {
    const quote = await lockQuote(tx, ctx, id);
    if (quote.status !== 'draft') throw conflict('Só orçamentos em rascunho podem ser editados.');
    if (data.customerId) await assertCustomer(tx, ctx, data.customerId);
    const { lines, total } = await buildLines(tx, ctx, data.items, data.discount);

    await tx.delete(quoteItems).where(eq(quoteItems.quoteId, id));
    await tx.insert(quoteItems).values(lines.map((line) => ({ ...line, quoteId: id })));
    await tx
      .update(quotes)
      .set({
        customerId: data.customerId ?? null,
        validUntil: data.validUntil ?? null,
        discount: data.discount,
        total,
        notes: data.notes,
      })
      .where(scoped(ctx, id));
    await audit(tx, ctx, 'update', 'quote', id, { total });
  });

  return getQuote(ctx, id);
}

// Fluxo: rascunho → enviado → aprovado ou recusado. Cada passo tem a sua permissão.
const TRANSITIONS = {
  send: { from: 'draft', to: 'sent', permission: 'quotes.send', verb: 'enviar' },
  approve: { from: 'sent', to: 'approved', permission: 'quotes.approve', verb: 'aprovar' },
  reject: { from: 'sent', to: 'rejected', permission: 'quotes.approve', verb: 'recusar' },
} as const satisfies Record<
  string,
  { from: QuoteStatus; to: QuoteStatus; permission: Permission; verb: string }
>;

export type QuoteTransition = keyof typeof TRANSITIONS;

export async function transitionQuote(ctx: Ctx, id: number, name: QuoteTransition) {
  const step = TRANSITIONS[name];
  authorize(ctx, step.permission);

  await db.transaction(async (tx) => {
    const quote = await lockQuote(tx, ctx, id);
    if (quote.status !== step.from) {
      throw conflict(`Não é possível ${step.verb} um orçamento ${STATUS_LABEL[quote.status]}.`);
    }
    const now = new Date();
    await tx
      .update(quotes)
      .set({ status: step.to, ...(name === 'send' ? { sentAt: now } : { decidedAt: now }) })
      .where(scoped(ctx, id));
    await audit(tx, ctx, 'status', 'quote', id, { from: quote.status, to: step.to });
  });

  return getQuote(ctx, id);
}

// Orçamento aprovado vira pedido numa única transação: itens, baixa de estoque e caixa (se pago).
export async function convertQuote(ctx: Ctx, id: number, input: QuoteConvertInput) {
  authorize(ctx, 'quotes.convert');
  const data = parse(quoteConvertSchema, input);
  // Converter já como pago é também uma baixa no contas a receber.
  if (data.status === 'paid') authorize(ctx, 'receivables.settle');

  const orderId = await db.transaction(async (tx) => {
    const quote = await lockQuote(tx, ctx, id);
    if (quote.status !== 'approved') throw conflict('Só orçamentos aprovados podem virar pedido.');

    const [existing] = await tx.select({ number: orders.number }).from(orders).where(eq(orders.quoteId, id));
    if (existing) {
      throw conflict(
        `Este orçamento já foi convertido no pedido #${String(existing.number).padStart(3, '0')}.`,
      );
    }

    const items = await tx
      .select({
        productId: quoteItems.productId,
        quantity: quoteItems.quantity,
        unitPrice: quoteItems.unitPrice,
      })
      .from(quoteItems)
      .where(eq(quoteItems.quoteId, id))
      .orderBy(asc(quoteItems.id));

    const order = await insertOrder(
      tx,
      ctx,
      {
        customerId: quote.customerId,
        orderDate: data.orderDate,
        status: data.status,
        discount: quote.discount,
        notes: quote.notes,
        bankAccountId: data.bankAccountId,
        items,
      },
      id,
    );
    await audit(tx, ctx, 'convert', 'quote', id, { orderId: order.id });
    return order.id;
  });

  return getOrder(ctx, orderId);
}

export async function deleteQuote(ctx: Ctx, id: number) {
  authorize(ctx, 'quotes.delete');
  await db.transaction(async (tx) => {
    const quote = await lockQuote(tx, ctx, id);
    const [order] = await tx.select({ id: orders.id }).from(orders).where(eq(orders.quoteId, id));
    if (order) throw conflict('Orçamento convertido em pedido não pode ser excluído.');
    await tx.delete(quotes).where(scoped(ctx, id));
    await audit(tx, ctx, 'delete', 'quote', id, { status: quote.status });
  });
}
