import { type CustomerInput, customerSchema } from '@arandue/shared/schemas';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { customers } from '../db/schema.ts';
import { authorize, type Ctx } from '../lib/context.ts';
import { notFound } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import { audit } from './audit.ts';

const scoped = (ctx: Ctx, id: number) => and(eq(customers.id, id), eq(customers.companyId, ctx.companyId));

export async function listCustomers(ctx: Ctx) {
  authorize(ctx, 'customers', 'read');
  return db
    .select()
    .from(customers)
    .where(eq(customers.companyId, ctx.companyId))
    .orderBy(asc(customers.name));
}

export async function getCustomer(ctx: Ctx, id: number) {
  authorize(ctx, 'customers', 'read');
  const [row] = await db.select().from(customers).where(scoped(ctx, id));
  if (!row) throw notFound();
  return row;
}

export async function createCustomer(ctx: Ctx, input: CustomerInput) {
  authorize(ctx, 'customers', 'create');
  const data = parse(customerSchema, input);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(customers)
      .values({ ...data, companyId: ctx.companyId })
      .returning();
    if (!row) throw new Error('Falha ao criar cliente.');
    await audit(tx, ctx, 'create', 'customer', row.id);
    return row;
  });
}

export async function updateCustomer(ctx: Ctx, id: number, input: CustomerInput) {
  authorize(ctx, 'customers', 'update');
  const data = parse(customerSchema, input);
  return db.transaction(async (tx) => {
    const [row] = await tx.update(customers).set(data).where(scoped(ctx, id)).returning();
    if (!row) throw notFound();
    await audit(tx, ctx, 'update', 'customer', id);
    return row;
  });
}

export async function deleteCustomer(ctx: Ctx, id: number) {
  authorize(ctx, 'customers', 'delete');
  await db.transaction(async (tx) => {
    const [row] = await tx.delete(customers).where(scoped(ctx, id)).returning({ id: customers.id });
    if (!row) throw notFound();
    await audit(tx, ctx, 'delete', 'customer', id);
  });
}
