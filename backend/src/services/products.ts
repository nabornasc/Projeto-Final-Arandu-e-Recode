import { can } from '@arandue/shared/permissions';
import { type ProductInput, productSchema } from '@arandue/shared/schemas';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { opportunityItems, orderItems, products, quoteItems } from '../db/schema.ts';
import { diffFields, initialFields, pick, removedFields } from '../lib/changes.ts';
import { authorize, type Ctx } from '../lib/context.ts';
import { notFound } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import { audit } from './audit.ts';

const scoped = (ctx: Ctx, id: number) => and(eq(products.id, id), eq(products.companyId, ctx.companyId));

const TRACKED = ['name', 'type', 'price', 'cost', 'stock'] as const;

// Serviço não controla estoque.
const normalize = (data: ReturnType<typeof productSchema.parse>) => ({
  ...data,
  stock: data.type === 'service' ? null : (data.stock ?? null),
});

// O custo só sai da API para quem pode vê-lo.
const showCost = <T extends { cost: number | null }>(ctx: Ctx, row: T): T =>
  can(ctx.permissions, 'costs.read') ? row : { ...row, cost: null };

export async function listProducts(ctx: Ctx) {
  authorize(ctx, 'products.read');
  const rows = await db
    .select()
    .from(products)
    .where(and(eq(products.companyId, ctx.companyId), eq(products.active, true)))
    .orderBy(asc(products.name));
  return rows.map((row) => showCost(ctx, row));
}

export async function getProduct(ctx: Ctx, id: number) {
  authorize(ctx, 'products.read');
  const [row] = await db
    .select()
    .from(products)
    .where(and(scoped(ctx, id), eq(products.active, true)));
  if (!row) throw notFound();
  return showCost(ctx, row);
}

export async function createProduct(ctx: Ctx, input: ProductInput) {
  authorize(ctx, 'products.create');
  const data = normalize(parse(productSchema, input));
  // Quem não vê o custo também não o informa.
  const cost = can(ctx.permissions, 'costs.read') ? data.cost : null;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(products)
      .values({ ...data, cost, companyId: ctx.companyId })
      .returning();
    if (!row) throw new Error('Falha ao criar produto.');
    await audit(tx, ctx, 'create', 'product', row.id, {
      label: row.name,
      changes: initialFields(pick(row, TRACKED)),
    });
    return showCost(ctx, row);
  });
}

export async function updateProduct(ctx: Ctx, id: number, input: ProductInput) {
  authorize(ctx, 'products.update');
  const data = normalize(parse(productSchema, input));
  return db.transaction(async (tx) => {
    const [previous] = await tx
      .select()
      .from(products)
      .where(and(scoped(ctx, id), eq(products.active, true)))
      .for('update');
    if (!previous) throw notFound();
    // Quem não vê o custo edita o resto do cadastro sem apagá-lo.
    const cost = can(ctx.permissions, 'costs.read') ? data.cost : previous.cost;
    const [row] = await tx
      .update(products)
      .set({ ...data, cost })
      .where(and(scoped(ctx, id), eq(products.active, true)))
      .returning();
    if (!row) throw notFound();
    const changes = diffFields(pick(previous, TRACKED), pick(row, TRACKED));
    if (changes.length) await audit(tx, ctx, 'update', 'product', id, { label: row.name, changes });
    return showCost(ctx, row);
  });
}

// Produto já usado em pedido, orçamento ou oportunidade é arquivado (preserva o histórico); senão, é excluído.
export async function deleteProduct(ctx: Ctx, id: number) {
  authorize(ctx, 'products.delete');
  await db.transaction(async (tx) => {
    const [product] = await tx.select().from(products).where(scoped(ctx, id));
    if (!product) throw notFound();

    const [{ used } = { used: false }] = await tx.execute<{ used: boolean }>(sql`
      SELECT EXISTS (SELECT 1 FROM ${orderItems} WHERE ${orderItems.productId} = ${id})
          OR EXISTS (SELECT 1 FROM ${quoteItems} WHERE ${quoteItems.productId} = ${id})
          OR EXISTS (SELECT 1 FROM ${opportunityItems} WHERE ${opportunityItems.productId} = ${id}) AS used`);

    if (used) {
      await tx.update(products).set({ active: false }).where(scoped(ctx, id));
      await audit(tx, ctx, 'archive', 'product', id, {
        label: product.name,
        changes: diffFields({ active: true }, { active: false }),
      });
    } else {
      await tx.delete(products).where(scoped(ctx, id));
      await audit(tx, ctx, 'delete', 'product', id, {
        label: product.name,
        changes: removedFields(pick(product, TRACKED)),
      });
    }
  });
}
