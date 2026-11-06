import { can, type Permission } from '@arandue/shared/permissions';
import {
  areaInSquareMeters,
  type DocumentReasonInput,
  documentReasonSchema,
  type QuoteConvertInput,
  type QuoteInput,
  type QuoteInstallment,
  type QuoteStatus,
  quoteConvertSchema,
  quoteSchema,
} from '@arandue/shared/schemas';
import { and, asc, desc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { db, type Transaction } from '../db/client.ts';
import { opportunities, orders, people, products, quoteItems, quotes, users } from '../db/schema.ts';
import { diffFields, diffItems, initialFields, removedFields } from '../lib/changes.ts';
import { authorize, type Ctx, ownScope } from '../lib/context.ts';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.ts';
import { round2 } from '../lib/money.ts';
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
import {
  buildMirrorSnapshot,
  computeMargin,
  hideCustomerDetails,
  type MirrorSnapshot,
  summarizeByType,
} from './quoteMirror.ts';

const scoped = (ctx: Ctx, id: number) =>
  and(eq(quotes.id, id), eq(quotes.companyId, ctx.companyId), ownScope(ctx, quotes.createdBy));

// Campos do orçamento que o histórico acompanha além dos valores principais.
const extraFields = (quote: {
  freight: number;
  otherCharges: number;
  internalNotes: string | null;
  siteDescription: string | null;
  siteContact: string | null;
  siteAddress: string | null;
}) => ({
  freight: quote.freight,
  otherCharges: quote.otherCharges,
  internalNotes: quote.internalNotes,
  siteDescription: quote.siteDescription,
  siteContact: quote.siteContact,
  siteAddress: quote.siteAddress,
});

const moneyText = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Texto para o histórico: parcelas e grupos não têm colunas próprias na comparação de campos.
const installmentsText = (list: QuoteInstallment[]) =>
  list
    .map(({ dueDate, amount, method }) =>
      [dueDate.split('-').reverse().join('/'), moneyText(amount), method].filter(Boolean).join(' - '),
    )
    .join('; ') || null;

type Composed = {
  name: string;
  groupName?: string | null;
  width?: number | null;
  length?: number | null;
  measureUnit?: string | null;
};
const compositionText = (lines: Composed[]) =>
  lines
    .filter((line) => line.groupName || line.width)
    .map((line) => {
      const measures = line.width ? ` (${line.width} × ${line.length} ${line.measureUnit ?? 'm'})` : '';
      return `${line.groupName ? `${line.groupName}: ` : ''}${line.name}${measures}`;
    })
    .join('; ') || null;

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
      freight: quotes.freight,
      otherCharges: quotes.otherCharges,
      total: quotes.total,
      validUntil: quotes.validUntil,
      notes: quotes.notes,
      internalNotes: quotes.internalNotes,
      siteDescription: quotes.siteDescription,
      siteContact: quotes.siteContact,
      siteAddress: quotes.siteAddress,
      installments: quotes.installments,
      sellerName: users.name,
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
    .leftJoin(users, eq(users.id, quotes.createdBy))
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
      groupName: quoteItems.groupName,
      width: quoteItems.width,
      length: quoteItems.length,
      measureUnit: quoteItems.measureUnit,
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
      groupName: quoteItems.groupName,
      width: quoteItems.width,
      length: quoteItems.length,
      measureUnit: quoteItems.measureUnit,
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

// Dados do espelho do cliente. Sem custos nem observação interna. CPF, contatos e endereço do
// cliente só aparecem para quem pode ver o cadastro de clientes.
export async function getQuoteMirror(ctx: Ctx, id: number) {
  const quote = await getQuote(ctx, id);
  const [row] = await db
    .select({ snapshot: quotes.mirrorSnapshot, createdBy: quotes.createdBy })
    .from(quotes)
    .where(scoped(ctx, id));
  if (!row) throw notFound('Orçamento não encontrado.');
  // Rascunho e orçamentos enviados antes desta versão usam os dados atuais.
  const snapshot =
    (row.snapshot as MirrorSnapshot | null) ??
    (await buildMirrorSnapshot(db, ctx.companyId, {
      id,
      customerId: quote.customerId,
      createdBy: row.createdBy,
    }));
  return {
    number: quote.number,
    status: quote.status,
    createdAt: quote.createdAt,
    sentAt: quote.sentAt,
    validUntil: quote.validUntil,
    discount: quote.discount,
    freight: quote.freight,
    otherCharges: quote.otherCharges,
    total: quote.total,
    notes: quote.notes,
    siteDescription: quote.siteDescription,
    siteContact: quote.siteContact,
    siteAddress: quote.siteAddress,
    installments: quote.installments,
    ...snapshot,
    customer: can(ctx.permissions, 'customers.read')
      ? snapshot.customer
      : hideCustomerDetails(snapshot.customer),
  };
}

// Espelho interno: o mesmo documento do cliente, mais observação interna, custos e margem.
export async function getQuoteInternalMirror(ctx: Ctx, id: number) {
  authorize(ctx, 'costs.read');
  const mirror = await getQuoteMirror(ctx, id);
  const [row] = await db.select({ internalNotes: quotes.internalNotes }).from(quotes).where(scoped(ctx, id));
  if (!row) throw notFound('Orçamento não encontrado.');
  const costs = await db
    .select({
      type: products.type,
      quantity: quoteItems.quantity,
      subtotal: quoteItems.subtotal,
      sentCost: quoteItems.unitCost,
      currentCost: products.cost,
    })
    .from(quoteItems)
    .innerJoin(products, eq(products.id, quoteItems.productId))
    .where(eq(quoteItems.quoteId, id))
    .orderBy(asc(quoteItems.id));
  // Depois do envio, o custo fica fixo: mudar o cadastro não muda a margem do que já foi enviado.
  const lines = costs.map(({ sentCost, currentCost, ...line }) => ({
    ...line,
    unitCost: mirror.status === 'draft' ? currentCost : sentCost,
  }));
  return {
    ...mirror,
    internalNotes: row.internalNotes,
    // Mesma ordem do espelho do cliente, que mantém o nome do produto na data do envio.
    items: mirror.items.map((item, index) => ({
      ...item,
      type: lines[index]?.type ?? 'product',
      unitCost: lines[index]?.unitCost ?? null,
    })),
    summary: summarizeByType(lines),
    margin: computeMargin(lines, mirror.discount),
  };
}

// Orçamento não mexe em estoque nem no caixa: isso só acontece ao converter em pedido.
type QuoteData = ReturnType<typeof quoteSchema.parse>;

// Linhas do orçamento: com medidas, a quantidade é a área, e as parcelas precisam fechar com o total.
async function buildQuoteLines(tx: Transaction, ctx: Ctx, data: QuoteData) {
  const items = data.items.map((item) =>
    item.width && item.length
      ? { ...item, quantity: areaInSquareMeters(item.width, item.length, item.measureUnit ?? 'm') }
      : item,
  );
  const { lines, total } = await buildLines(tx, ctx, items, data.discount, data.freight + data.otherCharges);
  if (data.installments.length) {
    const sum = round2(data.installments.reduce((value, item) => value + item.amount, 0));
    if (sum !== total) {
      throw badRequest(
        `A soma das parcelas (${moneyText(sum)}) precisa ser igual ao total do orçamento (${moneyText(total)}).`,
      );
    }
  }
  return {
    total,
    lines: lines.map((line, index) => ({
      ...line,
      groupName: items[index]?.groupName ?? null,
      width: items[index]?.width ?? null,
      length: items[index]?.length ?? null,
      measureUnit: items[index]?.width ? (items[index]?.measureUnit ?? 'm') : null,
    })),
  };
}

// Junta o nome do produto às linhas novas, para o texto do histórico.
const namedComposition = (lines: Omit<Composed, 'name'>[], named: { name: string }[]) =>
  compositionText(lines.map((line, index) => ({ ...line, name: named[index]?.name ?? '' })));

// Cria o rascunho dentro de uma transação já aberta (orçamento novo, duplicado ou copiado de pedido).
export async function insertQuote(tx: Transaction, ctx: Ctx, data: QuoteData, link: DocumentLink = {}) {
  await lockOpportunity(tx, link.opportunityId);
  // data.opportunityId vem do usuário (é conferida); link.opportunityId é herdada de outro documento.
  const customerId = data.opportunityId
    ? await prepareDocumentLink(tx, ctx, data.opportunityId, data.customerId)
    : data.customerId;
  const opportunityId = link.opportunityId ?? data.opportunityId ?? null;
  if (customerId) await assertCustomer(tx, ctx, customerId);
  const { lines, total } = await buildQuoteLines(tx, ctx, data);
  const named = await namedLines(tx, lines);
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
      ...extraFields(data),
      installments: data.installments,
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
      ...extraFields(data),
      installments: installmentsText(data.installments),
      composition: namedComposition(lines, named),
    }),
    items: diffItems([], named),
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
    const { lines, total } = await buildQuoteLines(tx, ctx, data);
    const named = await namedLines(tx, lines);
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
        ...extraFields(data),
        installments: data.installments,
      })
      .where(scoped(ctx, id));
    const changes = diffFields(
      {
        customer: await personName(tx, quote.customerId),
        validUntil: quote.validUntil,
        discount: quote.discount,
        total: quote.total,
        notes: quote.notes,
        ...extraFields(quote),
        installments: installmentsText(quote.installments),
        composition: compositionText(previousItems),
      },
      {
        customer: await personName(tx, data.customerId),
        validUntil: data.validUntil,
        discount: data.discount,
        total,
        notes: data.notes,
        ...extraFields(data),
        installments: installmentsText(data.installments),
        composition: namedComposition(lines, named),
      },
    );
    const items = diffItems(previousItems, named);
    // Salvar sem mudar nada não vira registro.
    if (changes.length || items.length) {
      await audit(tx, ctx, 'update', 'quote', id, { number: quote.number, total, changes, items });
    }
  });

  return getQuote(ctx, id);
}

export type QuoteTransition = 'send' | 'approve' | 'reject' | 'cancel' | 'reopen';

// Fluxo: rascunho → enviado → aprovado ou recusado. Enviado ou aprovado ainda pode ser cancelado;
// rascunho é excluído. Enviado, aprovado ou recusado pode voltar a rascunho para ser alterado, e aí
// passa de novo por envio e aprovação. Cada passo tem a sua permissão; recusar, cancelar e reabrir
// exigem o motivo.
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
  reopen: {
    from: ['sent', 'approved', 'rejected'],
    to: 'draft',
    permission: 'quotes.update',
    verb: 'reabrir',
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
    if (name === 'cancel' || name === 'reopen') {
      const [order] = await tx.select({ id: orders.id }).from(orders).where(eq(orders.quoteId, id));
      if (order) {
        const done = name === 'cancel' ? 'cancelado' : 'reaberto';
        throw conflict(`Orçamento convertido em pedido não pode ser ${done}.`);
      }
    }
    const now = new Date();
    if (name === 'send') {
      await tx
        .update(quoteItems)
        .set({
          unitCost: sql`(SELECT ${products.cost} FROM ${products} WHERE ${products.id} = ${quoteItems.productId})`,
        })
        .where(eq(quoteItems.quoteId, id));
    }
    await tx
      .update(quotes)
      .set({
        status: step.to,
        ...(name === 'send'
          ? { sentAt: now, mirrorSnapshot: await buildMirrorSnapshot(tx, ctx.companyId, quote) }
          : name === 'reopen'
            ? // Volta a acompanhar os cadastros; a cópia nova nasce no próximo envio.
              // sentAt fica: é o que marca que o documento já saiu da empresa, e bloqueia a exclusão.
              { decidedAt: null, mirrorSnapshot: null }
            : { decidedAt: now }),
      })
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
        const verb = { reject: 'recusado', cancel: 'cancelado', reopen: 'reaberto' }[name];
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
        freight: quote.freight,
        otherCharges: quote.otherCharges,
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
    // Reaberto já saiu da empresa: só o Proprietário decide apagar. Não é uma permissão do catálogo
    // porque nenhum outro grupo pode recebê-la.
    if (quote.sentAt && !ctx.isOwner) {
      throw forbidden('Este orçamento já foi enviado ao cliente. Só o Proprietário pode excluí-lo.');
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
        ...extraFields(quote),
        installments: installmentsText(quote.installments),
        composition: compositionText(items),
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
