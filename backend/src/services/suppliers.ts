import { type SupplierInput, supplierSchema } from '@arandue/shared/schemas';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { suppliers } from '../db/schema.ts';
import { authorize, type Ctx } from '../lib/context.ts';
import { notFound } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import { audit } from './audit.ts';

const scoped = (ctx: Ctx, id: number) => and(eq(suppliers.id, id), eq(suppliers.companyId, ctx.companyId));

export async function listSuppliers(ctx: Ctx) {
  authorize(ctx, 'suppliers.read');
  return db
    .select()
    .from(suppliers)
    .where(eq(suppliers.companyId, ctx.companyId))
    .orderBy(asc(suppliers.name));
}

export async function getSupplier(ctx: Ctx, id: number) {
  authorize(ctx, 'suppliers.read');
  const [row] = await db.select().from(suppliers).where(scoped(ctx, id));
  if (!row) throw notFound();
  return row;
}

export async function createSupplier(ctx: Ctx, input: SupplierInput) {
  authorize(ctx, 'suppliers.create');
  const data = parse(supplierSchema, input);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(suppliers)
      .values({ ...data, companyId: ctx.companyId })
      .returning();
    if (!row) throw new Error('Falha ao criar fornecedor.');
    await audit(tx, ctx, 'create', 'supplier', row.id);
    return row;
  });
}

export async function updateSupplier(ctx: Ctx, id: number, input: SupplierInput) {
  authorize(ctx, 'suppliers.update');
  const data = parse(supplierSchema, input);
  return db.transaction(async (tx) => {
    const [row] = await tx.update(suppliers).set(data).where(scoped(ctx, id)).returning();
    if (!row) throw notFound();
    await audit(tx, ctx, 'update', 'supplier', id);
    return row;
  });
}

export async function deleteSupplier(ctx: Ctx, id: number) {
  authorize(ctx, 'suppliers.delete');
  await db.transaction(async (tx) => {
    const [row] = await tx.delete(suppliers).where(scoped(ctx, id)).returning({ id: suppliers.id });
    if (!row) throw notFound();
    await audit(tx, ctx, 'delete', 'supplier', id);
  });
}
