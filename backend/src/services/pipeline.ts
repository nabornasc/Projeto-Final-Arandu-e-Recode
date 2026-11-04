import {
  type PipelineOrderInput,
  type PipelineStageInput,
  pipelineOrderSchema,
  pipelineStageSchema,
  type StageMilestone,
} from '@arandue/shared/schemas';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { DbOrTx, Transaction } from '../db/client.ts';
import { db } from '../db/client.ts';
import { opportunities, pipelineStages } from '../db/schema.ts';
import { diffFields, initialFields, pick, removedFields } from '../lib/changes.ts';
import { authorize, type Ctx } from '../lib/context.ts';
import { badRequest, conflict, notFound } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import { audit } from './audit.ts';

const scoped = (ctx: Ctx, id: number) =>
  and(eq(pipelineStages.id, id), eq(pipelineStages.companyId, ctx.companyId));

const DEFAULT_STAGES: { name: string; color: string; milestone: StageMilestone | null }[] = [
  { name: 'Novo', color: '#6d4fd6', milestone: 'start' },
  { name: 'Em contato', color: '#3567c4', milestone: null },
  { name: 'Orçamento enviado', color: '#b6801d', milestone: 'quote_sent' },
  { name: 'Negociação', color: '#1c6e4c', milestone: 'negotiation' },
];

export async function createDefaultStages(tx: Transaction, companyId: number): Promise<void> {
  await tx
    .insert(pipelineStages)
    .values(DEFAULT_STAGES.map((stage, index) => ({ ...stage, companyId, position: index + 1 })));
}

export async function listStages(ctx: Ctx) {
  authorize(ctx, 'opportunities.read');
  return loadStages(db, ctx);
}

export const loadStages = (tx: DbOrTx, ctx: Ctx) =>
  tx
    .select()
    .from(pipelineStages)
    .where(eq(pipelineStages.companyId, ctx.companyId))
    .orderBy(asc(pipelineStages.position), asc(pipelineStages.id));

// Onde a oportunidade nasce: a etapa com o marco de início ou, sem ele, a primeira do funil.
export const entryStage = <T extends { milestone: StageMilestone | null }>(stages: T[]) =>
  stages.find((stage) => stage.milestone === 'start') ?? stages[0];

// Etapa da empresa (id veio do cliente: 400 se não existir).
export async function loadStage(tx: DbOrTx, ctx: Ctx, id: number) {
  const [stage] = await tx.select().from(pipelineStages).where(scoped(ctx, id));
  if (!stage) throw badRequest('Etapa do funil não encontrada.');
  return stage;
}

// Cada marco fica em no máximo uma etapa: é ele que a automação procura.
async function assertMilestoneFree(
  tx: DbOrTx,
  ctx: Ctx,
  milestone: StageMilestone | null,
  exceptId?: number,
) {
  if (!milestone) return;
  const [taken] = await tx
    .select({ name: pipelineStages.name })
    .from(pipelineStages)
    .where(
      and(
        eq(pipelineStages.companyId, ctx.companyId),
        eq(pipelineStages.milestone, milestone),
        exceptId ? ne(pipelineStages.id, exceptId) : undefined,
      ),
    );
  if (taken) throw conflict(`Este marco já está na etapa "${taken.name}".`);
}

async function assertNameFree(tx: DbOrTx, ctx: Ctx, name: string, exceptId?: number) {
  const [taken] = await tx
    .select({ id: pipelineStages.id })
    .from(pipelineStages)
    .where(
      and(
        eq(pipelineStages.companyId, ctx.companyId),
        eq(sql`lower(${pipelineStages.name})`, name.toLowerCase()),
        exceptId ? ne(pipelineStages.id, exceptId) : undefined,
      ),
    );
  if (taken) throw conflict('Já existe uma etapa com este nome.');
}

const TRACKED = ['name', 'color', 'milestone'] as const;

export async function createStage(ctx: Ctx, input: PipelineStageInput) {
  authorize(ctx, 'opportunities.configure');
  const data = parse(pipelineStageSchema, input);
  return db.transaction(async (tx) => {
    await assertNameFree(tx, ctx, data.name);
    await assertMilestoneFree(tx, ctx, data.milestone);
    const [{ last } = { last: 0 }] = await tx
      .select({ last: sql<number>`coalesce(max(${pipelineStages.position}), 0)::int` })
      .from(pipelineStages)
      .where(eq(pipelineStages.companyId, ctx.companyId));
    const [stage] = await tx
      .insert(pipelineStages)
      .values({ ...data, companyId: ctx.companyId, position: last + 1 })
      .returning();
    if (!stage) throw new Error('Falha ao criar etapa.');
    await audit(tx, ctx, 'create', 'pipeline_stage', stage.id, {
      label: stage.name,
      changes: initialFields(pick(stage, TRACKED)),
    });
    return stage;
  });
}

export async function updateStage(ctx: Ctx, id: number, input: PipelineStageInput) {
  authorize(ctx, 'opportunities.configure');
  const data = parse(pipelineStageSchema, input);
  return db.transaction(async (tx) => {
    await assertNameFree(tx, ctx, data.name, id);
    await assertMilestoneFree(tx, ctx, data.milestone, id);
    const [previous] = await tx.select().from(pipelineStages).where(scoped(ctx, id)).for('update');
    if (!previous) throw notFound('Etapa do funil não encontrada.');
    const [stage] = await tx.update(pipelineStages).set(data).where(scoped(ctx, id)).returning();
    if (!stage) throw notFound('Etapa do funil não encontrada.');
    const changes = diffFields(pick(previous, TRACKED), pick(stage, TRACKED));
    if (changes.length) {
      await audit(tx, ctx, 'update', 'pipeline_stage', id, { label: stage.name, changes });
    }
    return stage;
  });
}

// A nova ordem precisa listar todas as etapas da empresa, sem faltar nem sobrar.
export async function reorderStages(ctx: Ctx, input: PipelineOrderInput) {
  authorize(ctx, 'opportunities.configure');
  const { ids } = parse(pipelineOrderSchema, input);
  return db.transaction(async (tx) => {
    const current = await loadStages(tx, ctx);
    const known = new Set(current.map((stage) => stage.id));
    if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
      throw badRequest('A nova ordem precisa incluir todas as etapas do funil.');
    }
    for (const [index, id] of ids.entries()) {
      await tx
        .update(pipelineStages)
        .set({ position: index + 1 })
        .where(scoped(ctx, id));
    }
    const nameOf = (id: number) => current.find((stage) => stage.id === id)?.name ?? '';
    const changes = diffFields(
      { order: current.map((stage) => stage.name).join(', ') },
      { order: ids.map(nameOf).join(', ') },
    );
    if (changes.length) {
      await audit(tx, ctx, 'update', 'pipeline_stage', null, {
        label: 'Ordem do funil',
        order: ids,
        changes,
      });
    }
    return loadStages(tx, ctx);
  });
}

// Etapa com oportunidades (inclusive ganhas e perdidas, que guardam onde pararam) não é excluída.
export async function deleteStage(ctx: Ctx, id: number) {
  authorize(ctx, 'opportunities.configure');
  await db.transaction(async (tx) => {
    const [stage] = await tx.select().from(pipelineStages).where(scoped(ctx, id)).for('update');
    if (!stage) throw notFound('Etapa do funil não encontrada.');
    const [{ used } = { used: 0 }] = await tx
      .select({ used: sql<number>`count(*)::int` })
      .from(opportunities)
      .where(eq(opportunities.stageId, id));
    if (used) throw conflict('Mova as oportunidades desta etapa para outra antes de excluí-la.');
    const [{ total } = { total: 0 }] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(pipelineStages)
      .where(eq(pipelineStages.companyId, ctx.companyId));
    if (total <= 1) throw badRequest('O funil precisa de ao menos uma etapa.');
    await tx.delete(pipelineStages).where(scoped(ctx, id));
    await audit(tx, ctx, 'delete', 'pipeline_stage', id, {
      label: stage.name,
      changes: removedFields(pick(stage, TRACKED)),
    });
  });
}
