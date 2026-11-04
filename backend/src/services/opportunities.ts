import { can } from '@arandue/shared/permissions';
import {
  type InteractionInput,
  interactionSchema,
  type OpportunityFilter,
  type OpportunityInput,
  type OpportunityStageInput,
  type OpportunityStatusInput,
  opportunitySchema,
  opportunityStageSchema,
  opportunityStatusSchema,
  type StageMilestone,
} from '@arandue/shared/schemas';
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import { type DbOrTx, db, type Transaction } from '../db/client.ts';
import {
  interactions,
  opportunities,
  opportunityItems,
  orders,
  people,
  pipelineStages,
  products,
  quotes,
  users,
} from '../db/schema.ts';
import { authorize, type Ctx, ownScope } from '../lib/context.ts';
import { badRequest, conflict, notFound } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import { audit } from './audit.ts';
import { assertCustomer } from './ownership.ts';
import { ensureCustomer } from './people.ts';
import { entryStage, loadStage, loadStages } from './pipeline.ts';

type Opportunity = typeof opportunities.$inferSelect;

// No CRM, "só os próprios" significa as oportunidades de que o usuário é o responsável.
const scoped = (ctx: Ctx, id: number) =>
  and(
    eq(opportunities.id, id),
    eq(opportunities.companyId, ctx.companyId),
    ownScope(ctx, opportunities.ownerId),
  );

const columns = {
  id: opportunities.id,
  title: opportunities.title,
  customerId: opportunities.customerId,
  customerName: people.name,
  contactName: opportunities.contactName,
  contactPhone: opportunities.contactPhone,
  contactEmail: opportunities.contactEmail,
  source: opportunities.source,
  stageId: opportunities.stageId,
  stageName: pipelineStages.name,
  stageColor: pipelineStages.color,
  status: opportunities.status,
  estimatedValue: opportunities.estimatedValue,
  expectedCloseDate: opportunities.expectedCloseDate,
  ownerId: opportunities.ownerId,
  ownerName: users.name,
  lostReason: opportunities.lostReason,
  nextAction: opportunities.nextAction,
  nextActionAt: opportunities.nextActionAt,
  closedAt: opportunities.closedAt,
  createdAt: opportunities.createdAt,
  updatedAt: opportunities.updatedAt,
};

const selectOpportunities = () =>
  db
    .select(columns)
    .from(opportunities)
    .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
    .leftJoin(people, eq(people.id, opportunities.customerId))
    .leftJoin(users, eq(users.id, opportunities.ownerId));

// Responsável precisa ser usuário ativo da empresa. Grupo restrito aos próprios só atribui a si mesmo.
async function resolveOwner(tx: Transaction, ctx: Ctx, ownerId: number | null | undefined): Promise<number> {
  const target = ownerId ?? ctx.userId;
  if (ctx.ownOnly && target !== ctx.userId) {
    throw badRequest('Você só pode ser o responsável pelas suas oportunidades.');
  }
  const [user] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, target), eq(users.companyId, ctx.companyId), eq(users.active, true)));
  if (!user) throw badRequest('Responsável não encontrado.');
  return target;
}

type Item = NonNullable<ReturnType<typeof opportunitySchema.parse>['items']>[number];

async function replaceItems(tx: Transaction, ctx: Ctx, opportunityId: number, items: Item[] | undefined) {
  if (!items) return;
  // Só o que entrou agora precisa estar ativo: item já registrado não trava a edição se for arquivado.
  const current = await tx
    .select({ productId: opportunityItems.productId })
    .from(opportunityItems)
    .where(eq(opportunityItems.opportunityId, opportunityId));
  const kept = new Set(current.map((item) => item.productId));
  const added = [...new Set(items.map((item) => item.productId))].filter((id) => !kept.has(id));
  if (added.length) {
    const found = await tx
      .select({ id: products.id })
      .from(products)
      .where(
        and(inArray(products.id, added), eq(products.companyId, ctx.companyId), eq(products.active, true)),
      );
    if (found.length !== added.length) throw badRequest('Produto não encontrado ou arquivado.');
  }
  await tx.delete(opportunityItems).where(eq(opportunityItems.opportunityId, opportunityId));
  if (items.length) {
    await tx.insert(opportunityItems).values(items.map((item) => ({ ...item, opportunityId })));
  }
}

// ---------- Leitura ----------

export async function listOpportunities(ctx: Ctx, filter: OpportunityFilter = {}) {
  authorize(ctx, 'opportunities.read');
  const term = filter.q;
  const where = and(
    eq(opportunities.companyId, ctx.companyId),
    ownScope(ctx, opportunities.ownerId),
    filter.stageId ? eq(opportunities.stageId, filter.stageId) : undefined,
    filter.ownerId ? eq(opportunities.ownerId, filter.ownerId) : undefined,
    filter.source ? ilike(opportunities.source, `%${filter.source}%`) : undefined,
    filter.lostReason ? ilike(opportunities.lostReason, `%${filter.lostReason}%`) : undefined,
    filter.from ? gte(opportunities.expectedCloseDate, filter.from) : undefined,
    filter.to ? lte(opportunities.expectedCloseDate, filter.to) : undefined,
    term
      ? or(
          ilike(opportunities.title, `%${term}%`),
          ilike(opportunities.contactName, `%${term}%`),
          ilike(people.name, `%${term}%`),
        )
      : undefined,
  );

  const items = await selectOpportunities()
    .where(and(where, filter.status ? eq(opportunities.status, filter.status) : undefined))
    .orderBy(asc(opportunities.nextActionAt), desc(opportunities.updatedAt))
    .limit(1000);

  // Totais por situação sobre os mesmos filtros, para o rodapé da lista (a situação não filtra aqui).
  const groups = await db
    .select({
      status: opportunities.status,
      count: sql<number>`count(*)::int`,
      value: sql<string>`coalesce(sum(${opportunities.estimatedValue}), 0)`,
    })
    .from(opportunities)
    .leftJoin(people, eq(people.id, opportunities.customerId))
    .where(where)
    .groupBy(opportunities.status);
  const totalOf = (status: Opportunity['status']) => {
    const group = groups.find((row) => row.status === status);
    return { count: group?.count ?? 0, value: Number(group?.value ?? 0) };
  };
  const open = totalOf('open');
  const won = totalOf('won');
  const lost = totalOf('lost');
  return {
    items,
    totals: {
      open,
      won,
      lost,
      all: { count: open.count + won.count + lost.count, value: open.value + won.value + lost.value },
    },
  };
}

const RECEIVED = ['paid', 'completed'];

export async function getOpportunity(ctx: Ctx, id: number) {
  authorize(ctx, 'opportunities.read');
  const [opportunity] = await selectOpportunities().where(scoped(ctx, id));
  if (!opportunity) throw notFound('Oportunidade não encontrada.');

  const [history, items] = await Promise.all([
    db
      .select({
        id: interactions.id,
        kind: interactions.kind,
        channel: interactions.channel,
        description: interactions.description,
        occurredAt: interactions.occurredAt,
        userName: users.name,
      })
      .from(interactions)
      .leftJoin(users, eq(users.id, interactions.userId))
      .where(eq(interactions.opportunityId, id))
      .orderBy(desc(interactions.occurredAt), desc(interactions.id)),
    db
      .select({
        id: opportunityItems.id,
        productId: opportunityItems.productId,
        productName: products.name,
        quantity: opportunityItems.quantity,
        unitPrice: opportunityItems.unitPrice,
        catalogPrice: products.price,
      })
      .from(opportunityItems)
      .innerJoin(products, eq(products.id, opportunityItems.productId))
      .where(eq(opportunityItems.opportunityId, id))
      .orderBy(asc(opportunityItems.id)),
  ]);

  // Documentos vinculados, só os que o grupo pode ver (com o escopo de cada um).
  const linkedQuotes = can(ctx.permissions, 'quotes.read')
    ? await db
        .select({ id: quotes.id, number: quotes.number, status: quotes.status, total: quotes.total })
        .from(quotes)
        .where(
          and(
            eq(quotes.opportunityId, id),
            eq(quotes.companyId, ctx.companyId),
            ownScope(ctx, quotes.createdBy),
          ),
        )
        .orderBy(desc(quotes.id))
    : [];
  const linkedOrders = can(ctx.permissions, 'orders.read')
    ? await db
        .select({
          id: orders.id,
          number: orders.number,
          status: orders.status,
          total: orders.total,
          orderDate: orders.orderDate,
          quoteId: orders.quoteId,
          originQuoteId: orders.originQuoteId,
        })
        .from(orders)
        .where(
          and(
            eq(orders.opportunityId, id),
            eq(orders.companyId, ctx.companyId),
            ownScope(ctx, orders.createdBy),
          ),
        )
        .orderBy(desc(orders.id))
    : [];

  const sum = (rows: { total: number }[]) => rows.reduce((total, row) => total + row.total, 0);
  // Convertido não volta a ser orçamento; copiado volta a contar se o pedido da cópia for cancelado.
  const converted = new Set(
    linkedOrders.flatMap((order) => [
      order.quoteId,
      order.status === 'cancelled' ? null : order.originQuoteId,
    ]),
  );
  return {
    ...opportunity,
    interactions: history,
    items,
    quotes: linkedQuotes,
    orders: linkedOrders,
    values: {
      estimated: opportunity.estimatedValue ?? 0,
      // Em orçamentos: os ainda abertos (recusados, cancelados e já convertidos não contam).
      inQuotes: sum(
        linkedQuotes.filter(
          (quote) => quote.status !== 'rejected' && quote.status !== 'cancelled' && !converted.has(quote.id),
        ),
      ),
      inOrders: sum(linkedOrders.filter((order) => order.status !== 'cancelled')),
      received: sum(linkedOrders.filter((order) => RECEIVED.includes(order.status))),
    },
  };
}

// ---------- Escrita ----------

const withoutDerived = ({
  items: _i,
  stageId: _s,
  ownerId: _o,
  ...data
}: ReturnType<typeof opportunitySchema.parse>) => data;

export async function createOpportunity(ctx: Ctx, input: OpportunityInput) {
  authorize(ctx, 'opportunities.create');
  const data = parse(opportunitySchema, input);
  const id = await db.transaction(async (tx) => {
    const ownerId = await resolveOwner(tx, ctx, data.ownerId);
    if (data.customerId) await assertCustomer(tx, ctx, data.customerId);
    const stages = await loadStages(tx, ctx);
    const stage = data.stageId ? await loadStage(tx, ctx, data.stageId) : entryStage(stages);
    if (!stage) throw badRequest('Cadastre ao menos uma etapa no funil.');
    const [opportunity] = await tx
      .insert(opportunities)
      .values({ ...withoutDerived(data), ownerId, stageId: stage.id, companyId: ctx.companyId })
      .returning({ id: opportunities.id });
    if (!opportunity) throw new Error('Falha ao criar oportunidade.');
    await replaceItems(tx, ctx, opportunity.id, data.items);
    await audit(tx, ctx, 'create', 'opportunity', opportunity.id, { source: data.source });
    return opportunity.id;
  });
  return getOpportunity(ctx, id);
}

export async function updateOpportunity(ctx: Ctx, id: number, input: OpportunityInput) {
  authorize(ctx, 'opportunities.update');
  const data = parse(opportunitySchema, input);
  await db.transaction(async (tx) => {
    const [previous] = await tx.select().from(opportunities).where(scoped(ctx, id)).for('update');
    if (!previous) throw notFound('Oportunidade não encontrada.');
    const ownerId = await resolveOwner(tx, ctx, data.ownerId ?? previous.ownerId);
    if (data.customerId) await assertCustomer(tx, ctx, data.customerId);
    await tx
      .update(opportunities)
      .set({ ...withoutDerived(data), ownerId })
      .where(eq(opportunities.id, id));
    await replaceItems(tx, ctx, id, data.items);
    await audit(tx, ctx, 'update', 'opportunity', id, ownerId !== previous.ownerId ? { ownerId } : undefined);
  });
  return getOpportunity(ctx, id);
}

export async function deleteOpportunity(ctx: Ctx, id: number) {
  authorize(ctx, 'opportunities.delete');
  await db.transaction(async (tx) => {
    // Orçamentos e pedidos vinculados continuam existindo, só perdem o vínculo.
    const [row] = await tx.delete(opportunities).where(scoped(ctx, id)).returning({ id: opportunities.id });
    if (!row) throw notFound('Oportunidade não encontrada.');
    await audit(tx, ctx, 'delete', 'opportunity', id);
  });
}

async function logEvent(tx: DbOrTx, ctx: Ctx, opportunityId: number, description: string) {
  await tx.insert(interactions).values({
    companyId: ctx.companyId,
    opportunityId,
    userId: ctx.userId,
    kind: 'event',
    description,
  });
}

// Mudança manual de etapa: vale em qualquer direção, mas só com a oportunidade em andamento.
export async function moveToStage(ctx: Ctx, id: number, input: OpportunityStageInput) {
  authorize(ctx, 'opportunities.update');
  const { stageId } = parse(opportunityStageSchema, input);
  await db.transaction(async (tx) => {
    const [opportunity] = await tx.select().from(opportunities).where(scoped(ctx, id)).for('update');
    if (!opportunity) throw notFound('Oportunidade não encontrada.');
    if (opportunity.status !== 'open') throw conflict('Reabra a oportunidade para mudar a etapa.');
    const stage = await loadStage(tx, ctx, stageId);
    await tx.update(opportunities).set({ stageId }).where(eq(opportunities.id, id));
    await logEvent(tx, ctx, id, `Movida para a etapa "${stage.name}".`);
    await audit(tx, ctx, 'status', 'opportunity', id, { from: opportunity.stageId, to: stageId });
  });
  return getOpportunity(ctx, id);
}

// Ganha, perdida ou de volta para em andamento. A etapa não muda: fica registrado onde parou.
export async function setStatus(ctx: Ctx, id: number, input: OpportunityStatusInput) {
  authorize(ctx, 'opportunities.update');
  const data = parse(opportunityStatusSchema, input);
  await db.transaction(async (tx) => {
    const [opportunity] = await tx.select().from(opportunities).where(scoped(ctx, id)).for('update');
    if (!opportunity) throw notFound('Oportunidade não encontrada.');
    if (data.status === 'open' && opportunity.status === 'open') {
      throw conflict('A oportunidade já está em andamento.');
    }
    if (data.status !== 'open' && opportunity.status !== 'open') {
      throw conflict('Reabra a oportunidade para mudar a situação.');
    }
    const customerId =
      data.status === 'won' && !opportunity.customerId
        ? await ensureCustomer(tx, ctx, contactOf(opportunity))
        : opportunity.customerId;
    await tx
      .update(opportunities)
      .set({
        status: data.status,
        customerId,
        lostReason: data.status === 'lost' ? data.lostReason : null,
        closedAt: data.status === 'open' ? null : new Date(),
      })
      .where(eq(opportunities.id, id));
    const label = { open: 'Reaberta', won: 'Ganha', lost: `Perdida: ${data.lostReason}` }[data.status];
    await logEvent(tx, ctx, id, `${label}.`);
    await audit(tx, ctx, 'status', 'opportunity', id, {
      from: opportunity.status,
      to: data.status,
      customerId,
    });
  });
  return getOpportunity(ctx, id);
}

const contactOf = (opportunity: Opportunity) => ({
  name: opportunity.contactName ?? opportunity.title,
  email: opportunity.contactEmail,
  phone: opportunity.contactPhone,
  sellerId: opportunity.ownerId,
});

export async function addInteraction(ctx: Ctx, id: number, input: InteractionInput) {
  authorize(ctx, 'opportunities.update');
  const data = parse(interactionSchema, input);
  await db.transaction(async (tx) => {
    const [opportunity] = await tx
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(scoped(ctx, id));
    if (!opportunity) throw notFound('Oportunidade não encontrada.');
    const [row] = await tx
      .insert(interactions)
      .values({ ...data, opportunityId: id, companyId: ctx.companyId, userId: ctx.userId })
      .returning({ id: interactions.id });
    // Registrar atividade também atualiza a oportunidade (aparece como movimentada recentemente).
    await tx.update(opportunities).set({ updatedAt: new Date() }).where(eq(opportunities.id, id));
    await audit(tx, ctx, 'create', 'interaction', row?.id ?? null, { opportunityId: id, kind: data.kind });
  });
  return getOpportunity(ctx, id);
}

// Lista mínima de pessoas para escolher o responsável.
export async function listOwnerOptions(ctx: Ctx) {
  authorize(ctx, 'opportunities.read');
  return db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.companyId, ctx.companyId), eq(users.active, true), ownScope(ctx, users.id)))
    .orderBy(asc(users.name));
}

// ---------- Automação a partir dos documentos ----------
// Efeitos de sistema: quem envia um orçamento ou dá baixa não precisa de permissão no CRM. A etapa
// só anda para frente, e tudo vira evento no histórico.

// Oportunidade informada ao criar um documento: precisa ser visível para quem cria.
export async function prepareDocumentLink(
  tx: Transaction,
  ctx: Ctx,
  opportunityId: number,
  customerId: number | null | undefined,
  { createCustomer = true }: { createCustomer?: boolean } = {},
): Promise<number | null> {
  authorize(ctx, 'opportunities.read');
  const [opportunity] = await tx.select().from(opportunities).where(scoped(ctx, opportunityId)).for('update');
  if (!opportunity) throw badRequest('Oportunidade não encontrada.');
  if (customerId) {
    if (!opportunity.customerId) {
      await tx.update(opportunities).set({ customerId }).where(eq(opportunities.id, opportunityId));
    }
    return customerId;
  }
  if (opportunity.customerId) return opportunity.customerId;
  // Sem cliente ainda: cadastra pelo contato (sem duplicar), se o grupo puder cadastrar clientes.
  if (!createCustomer || !can(ctx.permissions, 'customers.create')) return null;
  const created = await ensureCustomer(tx, ctx, contactOf(opportunity));
  await tx.update(opportunities).set({ customerId: created }).where(eq(opportunities.id, opportunityId));
  return created;
}

// Ordem única de bloqueio: documento, oportunidade, produtos, empresa. Quem vai mexer em estoque ou
// numeração com documento vinculado trava a oportunidade antes, para não haver deadlock.
export async function lockOpportunity(tx: Transaction, opportunityId: number | null | undefined) {
  if (!opportunityId) return;
  await tx
    .select({ id: opportunities.id })
    .from(opportunities)
    .where(eq(opportunities.id, opportunityId))
    .for('update');
}

// Sem valor estimado, a oportunidade assume o valor do primeiro documento.
export async function noteDocumentValue(tx: Transaction, opportunityId: number, total: number) {
  await tx
    .update(opportunities)
    .set({ estimatedValue: total })
    .where(and(eq(opportunities.id, opportunityId), sql`coalesce(${opportunities.estimatedValue}, 0) = 0`));
}

export async function recordDocumentEvent(
  tx: Transaction,
  ctx: Ctx,
  opportunityId: number,
  description: string,
) {
  await logEvent(tx, ctx, opportunityId, description);
}

export async function advanceToMilestone(
  tx: Transaction,
  ctx: Ctx,
  opportunityId: number,
  milestone: StageMilestone,
  reason: string,
) {
  const [opportunity] = await tx
    .select({ status: opportunities.status, stageId: opportunities.stageId })
    .from(opportunities)
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.companyId, ctx.companyId)))
    .for('update');
  if (!opportunity) return;
  const stages = await loadStages(tx, ctx);
  const target = stages.find((stage) => stage.milestone === milestone);
  const current = stages.find((stage) => stage.id === opportunity.stageId);
  if (opportunity.status === 'open' && target && current && target.position > current.position) {
    await tx.update(opportunities).set({ stageId: target.id }).where(eq(opportunities.id, opportunityId));
    await logEvent(tx, ctx, opportunityId, `${reason} → etapa "${target.name}".`);
    return;
  }
  await logEvent(tx, ctx, opportunityId, `${reason}.`);
}

// Pedido recebido: a oportunidade em andamento é ganha e fica ligada ao cliente do pedido.
export async function winFromDocument(
  tx: Transaction,
  ctx: Ctx,
  opportunityId: number,
  customerId: number | null,
  reason: string,
) {
  const [opportunity] = await tx
    .select()
    .from(opportunities)
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.companyId, ctx.companyId)))
    .for('update');
  if (!opportunity) return;
  if (opportunity.status !== 'open') {
    await logEvent(tx, ctx, opportunityId, `${reason}.`);
    return;
  }
  const finalCustomer =
    opportunity.customerId ??
    customerId ??
    (await ensureCustomer(tx, ctx, contactOf(opportunity), { system: true }));
  await tx
    .update(opportunities)
    .set({ status: 'won', customerId: finalCustomer, closedAt: new Date() })
    .where(eq(opportunities.id, opportunityId));
  await logEvent(tx, ctx, opportunityId, `${reason} → ganha.`);
}
