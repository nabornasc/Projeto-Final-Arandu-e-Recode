import { type ProductInput, productSchema } from '@arandue/shared/schemas';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { orderItems, products, quoteItems } from '../db/schema.ts';
import { authorize, type Ctx } from '../lib/context.ts';
import { notFound } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import { audit } from './audit.ts';

const scoped = (ctx: Ctx, id: number) => and(eq(products.id, id), eq(products.companyId, ctx.companyId));

// Serviço não controla estoque.
const normalize = (data: ReturnType<typeof productSchema.parse>) => ({
  ...data,
  stock: data.type === 'service' ? null : (data.stock ?? null),
});

export async function listProducts(ctx: Ctx) {
  authorize(ctx, 'products', 'read');
  return db
    .select()
    .from(products)
    .where(and(eq(products.companyId, ctx.companyId), eq(products.active, true)))
    .orderBy(asc(products.name));
}

export async function getProduct(ctx: Ctx, id: number) {
  authorize(ctx, 'products', 'read');
  const [row] = await db
    .select()
    .from(products)
    .where(and(scoped(ctx, id), eq(products.active, true)));
  if (!row) throw notFound();
  return row;
}

export async function createProduct(ctx: Ctx, input: ProductInput) {
  authorize(ctx, 'products', 'create');
  const data = normalize(parse(productSchema, input));
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(products)
      .values({ ...data, companyId: ctx.companyId })
      .returning();
    if (!row) throw new Error('Falha ao criar produto.');
    await audit(tx, ctx, 'create', 'product', row.id);
    return row;
  });
}

export async function updateProduct(ctx: Ctx, id: number, input: ProductInput) {
  authorize(ctx, 'products', 'update');
  const data = normalize(parse(productSchema, input));
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(products)
      .set(data)
      .where(and(scoped(ctx, id), eq(products.active, true)))
      .returning();
    if (!row) throw notFound();
    await audit(tx, ctx, 'update', 'product', id);
    return row;
  });
}

// Produto já usado em pedido ou orçamento é arquivado (preserva o histórico); senão, é excluído.
export async function deleteProduct(ctx: Ctx, id: number) {
  authorize(ctx, 'products', 'delete');
  await db.transaction(async (tx) => {
    const [product] = await tx.select({ id: products.id }).from(products).where(scoped(ctx, id));
    if (!product) throw notFound();

    const [{ used } = { used: false }] = await tx.execute<{ used: boolean }>(sql`
      SELECT EXISTS (SELECT 1 FROM ${orderItems} WHERE ${orderItems.productId} = ${id})
          OR EXISTS (SELECT 1 FROM ${quoteItems} WHERE ${quoteItems.productId} = ${id}) AS used`);

    if (used) {
      await tx.update(products).set({ active: false }).where(scoped(ctx, id));
      await audit(tx, ctx, 'archive', 'product', id);
    } else {
      await tx.delete(products).where(scoped(ctx, id));
      await audit(tx, ctx, 'delete', 'product', id);
    }
  });
}
