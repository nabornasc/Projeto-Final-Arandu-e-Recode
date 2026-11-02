import {
  type InteractionInput,
  interactionSchema,
  type LeadInput,
  type LeadStageInput,
  leadSchema,
  leadStageSchema,
} from '@arandue/shared/schemas';
import { and, asc, desc, eq } from 'drizzle-orm';
import { db, type Transaction } from '../db/client.ts';
import { interactions, leads, users } from '../db/schema.ts';
import { authorize, type Ctx, ownScope } from '../lib/context.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import { audit } from './audit.ts';
import { ensureCustomer } from './people.ts';

// No CRM, "só os próprios" significa os leads de que o usuário é o responsável.
const scoped = (ctx: Ctx, id: number) =>
  and(eq(leads.id, id), eq(leads.companyId, ctx.companyId), ownScope(ctx, leads.ownerId));

const columns = {
  id: leads.id,
  name: leads.name,
  phone: leads.phone,
  email: leads.email,
  source: leads.source,
  stage: leads.stage,
  ownerId: leads.ownerId,
  ownerName: users.name,
  lostReason: leads.lostReason,
  nextAction: leads.nextAction,
  nextActionAt: leads.nextActionAt,
  customerId: leads.customerId,
  createdAt: leads.createdAt,
  updatedAt: leads.updatedAt,
};

const selectLeads = () => db.select(columns).from(leads).leftJoin(users, eq(users.id, leads.ownerId));

// Responsável precisa ser usuário ativo da empresa. Grupo restrito aos próprios só atribui a si mesmo.
async function resolveOwner(tx: Transaction, ctx: Ctx, ownerId: number | null | undefined): Promise<number> {
  const target = ownerId ?? ctx.userId;
  if (ctx.ownOnly && target !== ctx.userId)
    throw badRequest('Você só pode ser o responsável pelos seus leads.');
  const [user] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, target), eq(users.companyId, ctx.companyId), eq(users.active, true)));
  if (!user) throw badRequest('Responsável não encontrado.');
  return target;
}

export async function listLeads(ctx: Ctx) {
  authorize(ctx, 'leads.read');
  return selectLeads()
    .where(and(eq(leads.companyId, ctx.companyId), ownScope(ctx, leads.ownerId)))
    .orderBy(asc(leads.nextActionAt), desc(leads.updatedAt))
    .limit(1000);
}

export async function getLead(ctx: Ctx, id: number) {
  authorize(ctx, 'leads.read');
  const [lead] = await selectLeads().where(scoped(ctx, id));
  if (!lead) throw notFound('Lead não encontrado.');
  const history = await db
    .select({
      id: interactions.id,
      channel: interactions.channel,
      description: interactions.description,
      occurredAt: interactions.occurredAt,
      userName: users.name,
    })
    .from(interactions)
    .leftJoin(users, eq(users.id, interactions.userId))
    .where(eq(interactions.leadId, id))
    .orderBy(desc(interactions.occurredAt), desc(interactions.id));
  return { ...lead, interactions: history };
}

export async function createLead(ctx: Ctx, input: LeadInput) {
  authorize(ctx, 'leads.create');
  const data = parse(leadSchema, input);
  const id = await db.transaction(async (tx) => {
    const ownerId = await resolveOwner(tx, ctx, data.ownerId);
    const [lead] = await tx
      .insert(leads)
      .values({ ...data, ownerId, companyId: ctx.companyId })
      .returning({ id: leads.id });
    if (!lead) throw new Error('Falha ao criar lead.');
    await audit(tx, ctx, 'create', 'lead', lead.id, { source: data.source });
    return lead.id;
  });
  return getLead(ctx, id);
}

export async function updateLead(ctx: Ctx, id: number, input: LeadInput) {
  authorize(ctx, 'leads.update');
  const data = parse(leadSchema, input);
  await db.transaction(async (tx) => {
    const [previous] = await tx.select().from(leads).where(scoped(ctx, id)).for('update');
    if (!previous) throw notFound('Lead não encontrado.');
    const ownerId = await resolveOwner(tx, ctx, data.ownerId ?? previous.ownerId);
    await tx
      .update(leads)
      .set({ ...data, ownerId })
      .where(scoped(ctx, id));
    await audit(tx, ctx, 'update', 'lead', id, ownerId !== previous.ownerId ? { ownerId } : undefined);
  });
  return getLead(ctx, id);
}

// Lead ganho vira cliente (reaproveita cadastro com o mesmo e-mail ou telefone; ver ensureCustomer).
async function customerForWonLead(tx: Transaction, ctx: Ctx, lead: typeof leads.$inferSelect) {
  if (lead.customerId) return lead.customerId;
  return ensureCustomer(tx, ctx, {
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    sellerId: lead.ownerId,
  });
}

export async function moveLead(ctx: Ctx, id: number, input: LeadStageInput) {
  authorize(ctx, 'leads.update');
  const data = parse(leadStageSchema, input);
  await db.transaction(async (tx) => {
    const [lead] = await tx.select().from(leads).where(scoped(ctx, id)).for('update');
    if (!lead) throw notFound('Lead não encontrado.');
    const customerId = data.stage === 'won' ? await customerForWonLead(tx, ctx, lead) : lead.customerId;
    await tx
      .update(leads)
      .set({
        stage: data.stage,
        customerId,
        lostReason: data.stage === 'lost' ? data.lostReason : null,
      })
      .where(scoped(ctx, id));
    await audit(tx, ctx, 'status', 'lead', id, { from: lead.stage, to: data.stage, customerId });
  });
  return getLead(ctx, id);
}

export async function addInteraction(ctx: Ctx, id: number, input: InteractionInput) {
  authorize(ctx, 'leads.update');
  const data = parse(interactionSchema, input);
  await db.transaction(async (tx) => {
    const [lead] = await tx.select({ id: leads.id }).from(leads).where(scoped(ctx, id));
    if (!lead) throw notFound('Lead não encontrado.');
    const [row] = await tx
      .insert(interactions)
      .values({ ...data, leadId: id, companyId: ctx.companyId, userId: ctx.userId })
      .returning({ id: interactions.id });
    // Registrar atendimento também atualiza o lead (aparece como movimentado recentemente).
    await tx.update(leads).set({ updatedAt: new Date() }).where(eq(leads.id, id));
    await audit(tx, ctx, 'create', 'interaction', row?.id ?? null, { leadId: id, channel: data.channel });
  });
  return getLead(ctx, id);
}

export async function deleteLead(ctx: Ctx, id: number) {
  authorize(ctx, 'leads.delete');
  await db.transaction(async (tx) => {
    const [row] = await tx.delete(leads).where(scoped(ctx, id)).returning({ id: leads.id });
    if (!row) throw notFound('Lead não encontrado.');
    await audit(tx, ctx, 'delete', 'lead', id);
  });
}

// Lista mínima de pessoas para escolher o responsável de um lead.
export async function listOwnerOptions(ctx: Ctx) {
  authorize(ctx, 'leads.read');
  return db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.companyId, ctx.companyId), eq(users.active, true), ownScope(ctx, users.id)))
    .orderBy(asc(users.name));
}
