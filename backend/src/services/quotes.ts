import { can, type Permission } from '@arandue/shared/permissions';
import {
  type DocumentReasonInput,
  documentReasonSchema,
  type QuoteConvertInput,
  type QuoteInput,
  type QuoteStatus,
  quoteConvertSchema,
  quoteSchema,
} from '@arandue/shared/schemas';
import { and, asc, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { db, type Transaction } from '../db/client.ts';
import { opportunities, orders, people, products, quoteItems, quotes } from '../db/schema.ts';
import { diffFields, diffItems, initialFields, removedFields } from '../lib/changes.ts';
import { authorize, type Ctx, ownScope } from '../lib/context.ts';
import { conflict, notFound } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import { audit, namedLines, personName } from './audit.ts';
import { formatCode, nextNumber } from './numbering.ts';
import {
  advanceToMilestone,
  lockOpportunity,
  noteDocumentValue,
  prepareDocumentLink,
  recordDocumentEvent,
} from './opportunities.ts';
import { buildLines, type DocumentLink, getOrder, insertOrder } from './orders.ts';
import { assertCustomer } from './ownership.ts';

const scoped = (ctx: Ctx, id: number) =>
  and(eq(quotes.id, id), eq(quotes.companyId, ctx.companyId), ownScope(ctx, quotes.createdBy));

const STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: 'em rascunho',
  sent: 'enviado',
  approved: 'aprovado',
  rejected: 'recusado',
  cancelled: 'cancelado',
};

async function loadQuotes(ctx: Ctx, where: SQL | undefined) {
  const rows = await db
    .select({
      id: quotes.id,
      number: quotes.number,
      customerId: quotes.customerId,
      customerName: people.name,
      opportunityId: quotes.opportunityId,
      opportunityTitle: opportunities.title,
      originQuoteId: quotes.originQuoteId,
      originOrderId: quotes.originOrderId,
      originKind: quotes.originKind,
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
    .leftJoin(opportunities, eq(opportunities.id, quotes.opportunityId))
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
  // O título da oportunidade só aparece para quem pode ver o CRM.
  const showOpportunity = can(ctx.permissions, 'opportunities.read');
  return rows.map((row) => ({
    ...row,
    opportunityTitle: showOpportunity ? row.opportunityTitle : null,
    items: byQuote.get(row.id) ?? [],
  }));
}

const lineItems = (tx: Transaction, id: number) =>
  tx
    .select({
      productId: quoteItems.productId,
      name: products.name,
      quantity: quoteItems.quantity,
      unitPrice: quoteItems.unitPrice,
    })
    .from(quoteItems)
    .innerJoin(products, eq(products.id, quoteItems.productId))
    .where(eq(quoteItems.quoteId, id))
    .orderBy(asc(quoteItems.id));

async function lockQuote(tx: Transaction, ctx: Ctx, id: number) {
  const [quote] = await tx.select().from(quotes).where(scoped(ctx, id)).for('update');
  if (!quote) throw notFound('Orçamento não encontrado.');
  return quote;
}

export async function listQuotes(ctx: Ctx) {
  authorize(ctx, 'quotes.read');
  return loadQuotes(ctx, and(eq(quotes.companyId, ctx.companyId), ownScope(ctx, quotes.createdBy)));
}

export async function getQuote(ctx: Ctx, id: number) {
  authorize(ctx, 'quotes.read');
  const [row] = await loadQuotes(ctx, scoped(ctx, id));
  if (!row) throw notFound('Orçamento não encontrado.');
  return row;
}

// Orçamento não mexe em estoque nem no caixa: isso só acontece ao converter em pedido.
type QuoteData = ReturnType<typeof quoteSchema.parse>;

// Cria o rascunho dentro de uma transação já aberta (orçamento novo, duplicado ou copiado de pedido).
export async function insertQuote(tx: Transaction, ctx: Ctx, data: QuoteData, link: DocumentLink = {}) {
  await lockOpportunity(tx, link.opportunityId);
  // data.opportunityId vem do usuário (é conferida); link.opportunityId é herdada de outro documento.
  const customerId = data.opportunityId
    ? await prepareDocumentLink(tx, ctx, data.opportunityId, data.customerId)
    : data.customerId;
  const opportunityId = link.opportunityId ?? data.opportunityId ?? null;
  if (customerId) await assertCustomer(tx, ctx, customerId);
  const { lines, total } = await buildLines(tx, ctx, data.items, data.discount);
  const number = await nextNumber(tx, ctx, 'quote');

  const [quote] = await tx
    .insert(quotes)
    .values({
      companyId: ctx.companyId,
      number,
      customerId: customerId ?? null,
      opportunityId,
      originQuoteId: link.originQuoteId ?? null,
      originOrderId: link.originOrderId ?? null,
      originKind: link.originKind ?? null,
      validUntil: data.validUntil ?? null,
      discount: data.discount,
      total,
      notes: data.notes,
      createdBy: ctx.userId,
    })
    .returning({ id: quotes.id });
  if (!quote) throw new Error('Falha ao criar orçamento.');

  await tx.insert(quoteItems).values(lines.map((line) => ({ ...line, quoteId: quote.id })));
  await audit(tx, ctx, 'create', 'quote', quote.id, {
    number,
    changes: initialFields({
      customer: await personName(tx, customerId),
      validUntil: data.validUntil,
      discount: data.discount,
      total,
      notes: data.notes,
    }),
    items: diffItems([], await namedLines(tx, lines)),
    total,
    opportunityId,
    originQuoteId: link.originQuoteId,
    originOrderId: link.originOrderId,
    originKind: link.originKind,
  });
  if (opportunityId) {
    await noteDocumentValue(tx, opportunityId, total);
    await recordDocumentEvent(tx, ctx, opportunityId, `Orçamento ${formatCode(number)} criado.`);
  }
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
    const previousItems = await lineItems(tx, id);

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
    const changes = diffFields(
      {
        customer: await personName(tx, quote.customerId),
        validUntil: quote.validUntil,
        discount: quote.discount,
        total: quote.total,
        notes: quote.notes,
      },
      {
        customer: await personName(tx, data.customerId),
        validUntil: data.validUntil,
        discount: data.discount,
        total,
        notes: data.notes,
      },
    );
    const items = diffItems(previousItems, await namedLines(tx, lines));
    // Salvar sem mudar nada não vira registro.
    if (changes.length || items.length) {
      await audit(tx, ctx, 'update', 'quote', id, { number: quote.number, total, changes, items });
    }
  });

  return getQuote(ctx, id);
}

export type QuoteTransition = 'send' | 'approve' | 'reject' | 'cancel';

// Fluxo: rascunho → enviado → aprovado ou recusado. Enviado ou aprovado ainda pode ser cancelado;
// rascunho é excluído. Cada passo tem a sua permissão; recusar e cancelar exigem o motivo.
const TRANSITIONS: Record<
  QuoteTransition,
  { from: QuoteStatus[]; to: QuoteStatus; permission: Permission; verb: string; needsReason?: boolean }
> = {
  send: { from: ['draft'], to: 'sent', permission: 'quotes.send', verb: 'enviar' },
  approve: { from: ['sent'], to: 'approved', permission: 'quotes.approve', verb: 'aprovar' },
  reject: {
    from: ['sent'],
    to: 'rejected',
    permission: 'quotes.approve',
    verb: 'recusar',
    needsReason: true,
  },
  cancel: {
    from: ['sent', 'approved'],
    to: 'cancelled',
    permission: 'quotes.cancel',
    verb: 'cancelar',
    needsReason: true,
  },
};

export async function transitionQuote(
  ctx: Ctx,
  id: number,
  name: QuoteTransition,
  input?: DocumentReasonInput,
) {
  const step = TRANSITIONS[name];
  authorize(ctx, step.permission);
  const reason = step.needsReason ? parse(documentReasonSchema, input).reason : null;

  await db.transaction(async (tx) => {
    const quote = await lockQuote(tx, ctx, id);
    if (!step.from.includes(quote.status)) {
      throw conflict(`Não é possível ${step.verb} um orçamento ${STATUS_LABEL[quote.status]}.`);
    }
    if (name === 'cancel') {
      const [order] = await tx.select({ id: orders.id }).from(orders).where(eq(orders.quoteId, id));
      if (order) throw conflict('Orçamento convertido em pedido não pode ser cancelado.');
    }
    const now = new Date();
    await tx
      .update(quotes)
      .set({ status: step.to, ...(name === 'send' ? { sentAt: now } : { decidedAt: now }) })
      .where(scoped(ctx, id));
    await audit(
      tx,
      ctx,
      'status',
      'quote',
      id,
      {
        number: quote.number,
        from: quote.status,
        to: step.to,
        changes: diffFields({ status: quote.status }, { status: step.to }),
      },
      reason,
    );
    if (quote.opportunityId) {
      const code = formatCode(quote.number);
      if (name === 'send')
        await advanceToMilestone(tx, ctx, quote.opportunityId, 'quote_sent', `Orçamento ${code} enviado`);
      else if (name === 'approve')
        await advanceToMilestone(tx, ctx, quote.opportunityId, 'negotiation', `Orçamento ${code} aprovado`);
      else {
        const verb = name === 'reject' ? 'recusado' : 'cancelado';
        await recordDocumentEvent(tx, ctx, quote.opportunityId, `Orçamento ${code} ${verb}: ${reason}`);
      }
    }
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
      throw conflict(`Este orçamento já foi convertido no pedido ${formatCode(existing.number)}.`);
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
      { quoteId: id, opportunityId: quote.opportunityId, originQuoteId: id, originKind: 'converted' },
    );
    await audit(tx, ctx, 'convert', 'quote', id, {
      number: quote.number,
      orderId: order.id,
      orderNumber: order.number,
    });
    return order.id;
  });

  return getOrder(ctx, orderId);
}

export async function deleteQuote(ctx: Ctx, id: number) {
  authorize(ctx, 'quotes.delete');
  await db.transaction(async (tx) => {
    const quote = await lockQuote(tx, ctx, id);
    // Enviado já saiu da empresa: cancela-se, com motivo, para o documento não sumir.
    if (quote.status !== 'draft') {
      throw conflict('Só rascunhos podem ser excluídos. Use "Cancelar" para encerrar o orçamento.');
    }
    const items = await lineItems(tx, id);
    const customer = await personName(tx, quote.customerId);
    await tx.delete(quotes).where(scoped(ctx, id));
    // Cópia do que foi excluído: o documento deixa de existir, o registro não.
    await audit(tx, ctx, 'delete', 'quote', id, {
      number: quote.number,
      createdBy: quote.createdBy,
      status: quote.status,
      changes: removedFields({
        status: quote.status,
        customer,
        validUntil: quote.validUntil,
        discount: quote.discount,
        total: quote.total,
        notes: quote.notes,
      }),
      items: diffItems(items, []),
    });
    if (quote.opportunityId) {
      await recordDocumentEvent(
        tx,
        ctx,
        quote.opportunityId,
        `Orçamento ${formatCode(quote.number)} excluído.`,
      );
    }
  });
}
