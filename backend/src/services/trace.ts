import { can } from '@arandue/shared/permissions';
import { type DocumentLinkInput, documentLinkSchema } from '@arandue/shared/schemas';
import { and, eq, inArray, or } from 'drizzle-orm';
import { type DbOrTx, db, type Transaction } from '../db/client.ts';
import { cashTransactions, opportunities, orders, people, pipelineStages, quotes } from '../db/schema.ts';
import { authorize, type Ctx, ownScope } from '../lib/context.ts';
import { conflict, notFound } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import { audit } from './audit.ts';
import { formatCode } from './numbering.ts';
import {
  advanceToMilestone,
  getOpportunity,
  noteDocumentValue,
  prepareDocumentLink,
  recordDocumentEvent,
  winFromDocument,
} from './opportunities.ts';
import { entryStage, loadStages } from './pipeline.ts';

// Rastreio comercial: cada orçamento e pedido tem no máximo uma origem, então a cadeia é uma árvore.

export type DocType = 'quote' | 'order';
const LABEL: Record<DocType, string> = { quote: 'Orçamento', order: 'Pedido' };
const RECEIVED = ['paid', 'completed'];
// Dia no fuso do Brasil: à noite, o dia em UTC já é o seguinte.
const localDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' });

const common = (table: typeof quotes | typeof orders) => ({
  id: table.id,
  number: table.number,
  status: table.status,
  total: table.total,
  customerId: table.customerId,
  opportunityId: table.opportunityId,
  originQuoteId: table.originQuoteId,
  originOrderId: table.originOrderId,
  originKind: table.originKind,
  createdBy: table.createdBy,
});
const quoteColumns = { ...common(quotes), createdAt: quotes.createdAt };
const orderColumns = { ...common(orders), orderDate: orders.orderDate };

// Registros ligados às listas de ids: eles mesmos e os que nasceram deles.
function relatedTo(
  table: typeof quotes | typeof orders,
  ownIds: number[],
  quoteIds: number[],
  orderIds: number[],
) {
  return or(
    ownIds.length ? inArray(table.id, ownIds) : undefined,
    quoteIds.length ? inArray(table.originQuoteId, quoteIds) : undefined,
    orderIds.length ? inArray(table.originOrderId, orderIds) : undefined,
  );
}

// Parentes de um conjunto de documentos: pais e filhos, repetindo até não aparecer ninguém novo.
async function closure(tx: DbOrTx, ctx: Ctx, seedQuotes: number[], seedOrders: number[]) {
  const seenQuotes = new Set(seedQuotes);
  const seenOrders = new Set(seedOrders);
  const foundQuotes = new Map<number, QuoteRow>();
  const foundOrders = new Map<number, OrderRow>();
  let quoteIds = seedQuotes;
  let orderIds = seedOrders;

  while (quoteIds.length || orderIds.length) {
    const quoteRows = await tx
      .select(quoteColumns)
      .from(quotes)
      .where(and(eq(quotes.companyId, ctx.companyId), relatedTo(quotes, quoteIds, quoteIds, orderIds)));
    const orderRows = await tx
      .select(orderColumns)
      .from(orders)
      .where(and(eq(orders.companyId, ctx.companyId), relatedTo(orders, orderIds, quoteIds, orderIds)));

    const nextQuotes: number[] = [];
    const nextOrders: number[] = [];
    const addQuote = (id: number | null) => {
      if (id && !seenQuotes.has(id)) {
        seenQuotes.add(id);
        nextQuotes.push(id);
      }
    };
    const addOrder = (id: number | null) => {
      if (id && !seenOrders.has(id)) {
        seenOrders.add(id);
        nextOrders.push(id);
      }
    };
    for (const row of quoteRows) {
      foundQuotes.set(row.id, row);
      addQuote(row.id);
      addQuote(row.originQuoteId);
      addOrder(row.originOrderId);
    }
    for (const row of orderRows) {
      foundOrders.set(row.id, row);
      addOrder(row.id);
      addQuote(row.originQuoteId);
      addOrder(row.originOrderId);
    }
    quoteIds = nextQuotes;
    orderIds = nextOrders;
  }
  return { quotes: [...foundQuotes.values()], orders: [...foundOrders.values()] };
}

type QuoteRow = Pick<
  typeof quotes.$inferSelect,
  | 'id'
  | 'number'
  | 'status'
  | 'total'
  | 'customerId'
  | 'opportunityId'
  | 'originQuoteId'
  | 'originOrderId'
  | 'originKind'
  | 'createdBy'
  | 'createdAt'
>;
type OrderRow = Pick<
  typeof orders.$inferSelect,
  | 'id'
  | 'number'
  | 'status'
  | 'total'
  | 'customerId'
  | 'opportunityId'
  | 'originQuoteId'
  | 'originOrderId'
  | 'originKind'
  | 'createdBy'
  | 'orderDate'
>;

export interface TraceNode {
  type: DocType;
  id: number;
  number: number;
  status: string;
  total: number;
  // Como este documento nasceu do pai.
  kind: 'converted' | 'duplicated' | 'copied' | null;
  date: string;
  receivedAt: string | null;
  children: TraceNode[];
}

const visible = (ctx: Ctx, type: DocType, createdBy: number | null) =>
  can(ctx.permissions, type === 'quote' ? 'quotes.read' : 'orders.read') &&
  (!ctx.ownOnly || createdBy === ctx.userId);

// Cadeia completa de um documento ou de uma oportunidade. Mostra só o que o grupo pode ver:
// um documento cujo pai está oculto aparece como início da cadeia.
export async function getTrace(ctx: Ctx, type: DocType | 'opportunity', id: number) {
  let opportunityId: number | null;
  const seedQuotes: number[] = [];
  const seedOrders: number[] = [];

  if (type === 'opportunity') {
    authorize(ctx, 'opportunities.read');
    opportunityId = id;
    const [own] = await db
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(
        and(
          eq(opportunities.id, id),
          eq(opportunities.companyId, ctx.companyId),
          ownScope(ctx, opportunities.ownerId),
        ),
      );
    if (!own) throw notFound('Oportunidade não encontrada.');
  } else {
    const table = type === 'quote' ? quotes : orders;
    authorize(ctx, type === 'quote' ? 'quotes.read' : 'orders.read');
    const [doc] = await db
      .select({ opportunityId: table.opportunityId })
      .from(table)
      .where(and(eq(table.id, id), eq(table.companyId, ctx.companyId), ownScope(ctx, table.createdBy)));
    if (!doc) throw notFound(`${LABEL[type]} não encontrado.`);
    opportunityId = doc.opportunityId;
    (type === 'quote' ? seedQuotes : seedOrders).push(id);
  }

  if (opportunityId) {
    const inQuotes = await db
      .select({ id: quotes.id })
      .from(quotes)
      .where(and(eq(quotes.opportunityId, opportunityId), eq(quotes.companyId, ctx.companyId)));
    const inOrders = await db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.opportunityId, opportunityId), eq(orders.companyId, ctx.companyId)));
    seedQuotes.push(...inQuotes.map((row) => row.id).filter((quoteId) => !seedQuotes.includes(quoteId)));
    seedOrders.push(...inOrders.map((row) => row.id).filter((orderId) => !seedOrders.includes(orderId)));
  }

  const docs = await closure(db, ctx, seedQuotes, seedOrders);
  const orderIds = docs.orders.map((row) => row.id);
  const receipts = orderIds.length
    ? await db
        .select({ orderId: cashTransactions.orderId, date: cashTransactions.transactionDate })
        .from(cashTransactions)
        .where(inArray(cashTransactions.orderId, orderIds))
    : [];
  const receivedAt = new Map(receipts.map((row) => [row.orderId, row.date]));

  const nodes = new Map<string, TraceNode & { parent: string | null }>();
  const parentKey = (row: { originQuoteId: number | null; originOrderId: number | null }) =>
    row.originQuoteId
      ? `quote:${row.originQuoteId}`
      : row.originOrderId
        ? `order:${row.originOrderId}`
        : null;
  for (const row of docs.quotes) {
    if (!visible(ctx, 'quote', row.createdBy)) continue;
    nodes.set(`quote:${row.id}`, {
      type: 'quote',
      id: row.id,
      number: row.number,
      status: row.status,
      total: row.total,
      kind: row.originKind,
      date: localDay.format(row.createdAt),
      receivedAt: null,
      children: [],
      parent: parentKey(row),
    });
  }
  for (const row of docs.orders) {
    if (!visible(ctx, 'order', row.createdBy)) continue;
    nodes.set(`order:${row.id}`, {
      type: 'order',
      id: row.id,
      number: row.number,
      status: row.status,
      total: row.total,
      kind: row.originKind,
      date: row.orderDate,
      receivedAt: receivedAt.get(row.id) ?? null,
      children: [],
      parent: parentKey(row),
    });
  }

  const roots: TraceNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parent ? nodes.get(node.parent) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const byDate = (a: TraceNode, b: TraceNode) => a.date.localeCompare(b.date) || a.number - b.number;
  for (const node of nodes.values()) node.children.sort(byDate);
  roots.sort(byDate);

  let opportunity = null;
  if (opportunityId && can(ctx.permissions, 'opportunities.read')) {
    const [row] = await db
      .select({
        id: opportunities.id,
        title: opportunities.title,
        status: opportunities.status,
        stageName: pipelineStages.name,
      })
      .from(opportunities)
      .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
      .where(
        and(
          eq(opportunities.id, opportunityId),
          eq(opportunities.companyId, ctx.companyId),
          ownScope(ctx, opportunities.ownerId),
        ),
      );
    opportunity = row ?? null;
  }
  return { opportunity, roots: roots.map(stripParent) };
}

function stripParent(node: TraceNode & { parent?: string | null }): TraceNode {
  const { parent: _parent, children, ...rest } = node;
  return { ...rest, children: children.map(stripParent) };
}

// ---------- Vincular e desvincular ----------

async function lockDocument(tx: Transaction, ctx: Ctx, type: DocType, id: number) {
  const table = type === 'quote' ? quotes : orders;
  const [doc] = await tx
    .select(common(table))
    .from(table)
    .where(and(eq(table.id, id), eq(table.companyId, ctx.companyId), ownScope(ctx, table.createdBy)))
    .for('update');
  if (!doc) throw notFound(`${LABEL[type]} não encontrado.`);
  return doc;
}

// Documentos que nasceram deste (filhos, netos...), para o vínculo descer pela cadeia.
// Com "só os próprios", a cadeia para no documento de outro usuário: esse não é alterado.
async function descendants(tx: Transaction, ctx: Ctx, type: DocType, id: number) {
  const seenQuotes = new Set(type === 'quote' ? [id] : []);
  const seenOrders = new Set(type === 'order' ? [id] : []);
  const result: { type: DocType; row: Awaited<ReturnType<typeof lockDocument>> }[] = [];
  let quoteIds = [...seenQuotes];
  let orderIds = [...seenOrders];
  while (quoteIds.length || orderIds.length) {
    const childQuotes = await tx
      .select(common(quotes))
      .from(quotes)
      .where(
        and(
          eq(quotes.companyId, ctx.companyId),
          ownScope(ctx, quotes.createdBy),
          relatedTo(quotes, [], quoteIds, orderIds),
        ),
      );
    const childOrders = await tx
      .select(common(orders))
      .from(orders)
      .where(
        and(
          eq(orders.companyId, ctx.companyId),
          ownScope(ctx, orders.createdBy),
          relatedTo(orders, [], quoteIds, orderIds),
        ),
      );
    quoteIds = childQuotes.filter((row) => !seenQuotes.has(row.id)).map((row) => row.id);
    orderIds = childOrders.filter((row) => !seenOrders.has(row.id)).map((row) => row.id);
    for (const row of childQuotes) {
      if (quoteIds.includes(row.id)) result.push({ type: 'quote', row });
      seenQuotes.add(row.id);
    }
    for (const row of childOrders) {
      if (orderIds.includes(row.id)) result.push({ type: 'order', row });
      seenOrders.add(row.id);
    }
  }
  return result;
}

const setOpportunity = (tx: Transaction, type: DocType, id: number, opportunityId: number | null) =>
  type === 'quote'
    ? tx.update(quotes).set({ opportunityId }).where(eq(quotes.id, id))
    : tx.update(orders).set({ opportunityId }).where(eq(orders.id, id));

// A etapa acompanha o documento vinculado: pedido recebido ganha; pedido ou orçamento aprovado leva
// à negociação; orçamento enviado, à etapa correspondente. Nunca volta.
async function applyProgress(
  tx: Transaction,
  ctx: Ctx,
  opportunityId: number,
  docs: { type: DocType; row: Awaited<ReturnType<typeof lockDocument>> }[],
  reason: string,
) {
  const received = docs.find((doc) => doc.type === 'order' && RECEIVED.includes(doc.row.status));
  if (received) {
    await winFromDocument(tx, ctx, opportunityId, received.row.customerId, reason);
  } else if (
    docs.some(
      (doc) => (doc.type === 'order' && doc.row.status !== 'cancelled') || doc.row.status === 'approved',
    )
  ) {
    await advanceToMilestone(tx, ctx, opportunityId, 'negotiation', reason);
  } else if (docs.some((doc) => doc.row.status === 'sent')) {
    await advanceToMilestone(tx, ctx, opportunityId, 'quote_sent', reason);
  } else {
    await recordDocumentEvent(tx, ctx, opportunityId, `${reason}.`);
  }
}

async function linkInTransaction(
  tx: Transaction,
  ctx: Ctx,
  type: DocType,
  doc: Awaited<ReturnType<typeof lockDocument>>,
  opportunityId: number,
) {
  // O vínculo desce para os documentos sem vínculo, ou que estavam na mesma oportunidade anterior.
  const chain = (await descendants(tx, ctx, type, doc.id)).filter(
    ({ row }) => row.opportunityId === null || row.opportunityId === doc.opportunityId,
  );
  await setOpportunity(tx, type, doc.id, opportunityId);
  for (const child of chain) await setOpportunity(tx, child.type, child.row.id, opportunityId);
  await noteDocumentValue(tx, opportunityId, doc.total);
  const code = `${LABEL[type]} ${formatCode(doc.number)}`;
  await applyProgress(tx, ctx, opportunityId, [{ type, row: doc }, ...chain], `${code} vinculado`);
  await audit(tx, ctx, 'update', type, doc.id, {
    opportunity: { from: doc.opportunityId, to: opportunityId },
    alsoLinked: chain.map((child) => `${child.type}:${child.row.id}`),
  });
}

export async function linkDocument(ctx: Ctx, type: DocType, id: number, input: DocumentLinkInput) {
  authorize(ctx, type === 'quote' ? 'quotes.update' : 'orders.update');
  const { opportunityId } = parse(documentLinkSchema, input);

  await db.transaction(async (tx) => {
    const doc = await lockDocument(tx, ctx, type, id);
    if (doc.opportunityId === opportunityId) return;
    const code = `${LABEL[type]} ${formatCode(doc.number)}`;

    if (opportunityId === null) {
      // Desvincular tira também os documentos que nasceram dele e estavam na mesma oportunidade.
      const chain = (await descendants(tx, ctx, type, id)).filter(
        ({ row }) => row.opportunityId === doc.opportunityId,
      );
      await setOpportunity(tx, type, id, null);
      for (const child of chain) await setOpportunity(tx, child.type, child.row.id, null);
      if (doc.opportunityId) await recordDocumentEvent(tx, ctx, doc.opportunityId, `${code} desvinculado.`);
      await audit(tx, ctx, 'update', type, id, {
        opportunity: { from: doc.opportunityId, to: null },
        alsoUnlinked: chain.map((child) => `${child.type}:${child.row.id}`),
      });
      return;
    }

    // Confere a oportunidade (visível para quem vincula); o vínculo não cria cliente novo.
    await prepareDocumentLink(tx, ctx, opportunityId, doc.customerId, { createCustomer: false });
    if (doc.opportunityId)
      await recordDocumentEvent(tx, ctx, doc.opportunityId, `${code} movido para outra oportunidade.`);
    await linkInTransaction(tx, ctx, type, doc, opportunityId);
  });
}

// Orçamento ou pedido avulso gera a oportunidade: já vem com cliente, valor e etapa correspondente.
export async function createFromDocument(ctx: Ctx, type: DocType, id: number) {
  authorize(ctx, 'opportunities.create');
  authorize(ctx, type === 'quote' ? 'quotes.update' : 'orders.update');

  const opportunityId = await db.transaction(async (tx) => {
    const doc = await lockDocument(tx, ctx, type, id);
    if (doc.opportunityId) throw conflict('Este documento já está vinculado a uma oportunidade.');
    const [customer] = doc.customerId
      ? await tx.select({ name: people.name }).from(people).where(eq(people.id, doc.customerId))
      : [];
    const firstStage = entryStage(await loadStages(tx, ctx));
    if (!firstStage) throw conflict('Cadastre ao menos uma etapa no funil.');
    const code = `${LABEL[type]} ${formatCode(doc.number)}`;
    const [opportunity] = await tx
      .insert(opportunities)
      .values({
        companyId: ctx.companyId,
        title: (customer ? `${code} — ${customer.name}` : code).slice(0, 160),
        customerId: doc.customerId,
        contactName: customer?.name,
        source: LABEL[type],
        stageId: firstStage.id,
        estimatedValue: doc.total,
        ownerId: ctx.userId,
      })
      .returning({ id: opportunities.id });
    if (!opportunity) throw new Error('Falha ao criar oportunidade.');
    await audit(tx, ctx, 'create', 'opportunity', opportunity.id, { from: `${type}:${id}` });
    await linkInTransaction(tx, ctx, type, doc, opportunity.id);
    return opportunity.id;
  });
  return getOpportunity(ctx, opportunityId);
}
