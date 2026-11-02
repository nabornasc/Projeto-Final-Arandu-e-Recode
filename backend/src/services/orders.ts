import {
  type OrderCreateInput,
  type OrderStatus,
  type OrderUpdateInput,
  orderCreateSchema,
  orderUpdateSchema,
} from '@arandue/shared/schemas';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, type Transaction } from '../db/client.ts';
import { bankAccounts, cashTransactions, customers, orderItems, orders, products } from '../db/schema.ts';
import { authorize, type Ctx } from '../lib/context.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { round2 } from '../lib/money.ts';
import { parse } from '../lib/validate.ts';
import { audit } from './audit.ts';
import { nextNumber } from './numbering.ts';
import { assertActiveAccount, assertCustomer } from './ownership.ts';

type Order = typeof orders.$inferSelect;

// Status em que o dinheiro já entrou no caixa.
const RECEIVED: readonly OrderStatus[] = ['paid', 'completed'];
const isReceived = (status: OrderStatus) => RECEIVED.includes(status);

const scoped = (ctx: Ctx, id: number) => and(eq(orders.id, id), eq(orders.companyId, ctx.companyId));

// Baixa (ou devolve, com sign = -1) o estoque dos itens. As linhas de produto são travadas
// com FOR UPDATE em ordem de id, então vendas simultâneas não vendem a mesma unidade duas vezes.
async function moveStock(
  tx: Transaction,
  ctx: Ctx,
  items: { productId: number; quantity: number }[],
  sign: 1 | -1,
): Promise<void> {
  const totals = new Map<number, number>();
  for (const item of items) totals.set(item.productId, (totals.get(item.productId) ?? 0) + item.quantity);
  const ids = [...totals.keys()].sort((a, b) => a - b);
  if (!ids.length) return;

  const locked = await tx
    .select({ id: products.id, name: products.name, type: products.type, stock: products.stock })
    .from(products)
    .where(and(inArray(products.id, ids), eq(products.companyId, ctx.companyId)))
    .orderBy(asc(products.id))
    .for('update');

  for (const product of locked) {
    if (product.type !== 'product' || product.stock === null) continue;
    const quantity = totals.get(product.id) ?? 0;
    if (sign === 1 && product.stock < quantity) {
      throw badRequest(
        `Estoque insuficiente para "${product.name}". Disponível: ${product.stock}, solicitado: ${quantity}.`,
      );
    }
    await tx
      .update(products)
      .set({ stock: sql`${products.stock} - ${sign * quantity}` })
      .where(eq(products.id, product.id));
  }
}

async function defaultAccountId(tx: Transaction, ctx: Ctx): Promise<number | null> {
  const [row] = await tx
    .select({ id: bankAccounts.id })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.companyId, ctx.companyId), eq(bankAccounts.active, true)))
    .orderBy(asc(bankAccounts.id))
    .limit(1);
  return row?.id ?? null;
}

// Pedido recebido com total > 0 tem exatamente uma entrada no caixa; nos demais casos, nenhuma.
async function syncCash(tx: Transaction, ctx: Ctx, order: Order, requestedAccountId?: number | null) {
  if (!isReceived(order.status) || order.total <= 0) {
    await tx.delete(cashTransactions).where(eq(cashTransactions.orderId, order.id));
    return;
  }

  const [existing] = await tx
    .select({ bankAccountId: cashTransactions.bankAccountId })
    .from(cashTransactions)
    .where(eq(cashTransactions.orderId, order.id));

  let accountId = requestedAccountId ?? existing?.bankAccountId ?? null;
  if (requestedAccountId) await assertActiveAccount(tx, ctx, requestedAccountId);
  accountId ??= await defaultAccountId(tx, ctx);
  if (!accountId) throw badRequest('Cadastre uma conta bancária para registrar o recebimento.');

  const values = {
    bankAccountId: accountId,
    amount: order.total,
    transactionDate: order.orderDate,
    description: `Recebimento do pedido #${String(order.number).padStart(3, '0')}`,
  };
  await tx
    .insert(cashTransactions)
    .values({ ...values, companyId: ctx.companyId, type: 'income', category: 'Vendas', orderId: order.id })
    .onConflictDoUpdate({ target: cashTransactions.orderId, set: values });
}

async function loadOrders(ctx: Ctx, where = eq(orders.companyId, ctx.companyId)) {
  const rows = await db
    .select({
      id: orders.id,
      number: orders.number,
      customerId: orders.customerId,
      customerName: customers.name,
      quoteId: orders.quoteId,
      orderDate: orders.orderDate,
      status: orders.status,
      discount: orders.discount,
      total: orders.total,
      notes: orders.notes,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .leftJoin(customers, eq(customers.id, orders.customerId))
    .where(where)
    .orderBy(desc(orders.orderDate), desc(orders.id))
    .limit(500);
  if (!rows.length) return [];

  // Uma consulta para os itens de todos os pedidos (evita N+1).
  const items = await db
    .select({
      id: orderItems.id,
      orderId: orderItems.orderId,
      productId: orderItems.productId,
      productName: products.name,
      quantity: orderItems.quantity,
      unitPrice: orderItems.unitPrice,
      subtotal: orderItems.subtotal,
    })
    .from(orderItems)
    .innerJoin(products, eq(products.id, orderItems.productId))
    .where(
      inArray(
        orderItems.orderId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(orderItems.id));

  const byOrder = Map.groupBy(items, (item) => item.orderId);
  return rows.map((row) => ({ ...row, items: byOrder.get(row.id) ?? [] }));
}

export async function listOrders(ctx: Ctx) {
  authorize(ctx, 'sales', 'read');
  return loadOrders(ctx);
}

export async function getOrder(ctx: Ctx, id: number) {
  authorize(ctx, 'sales', 'read');
  const [row] = await loadOrders(ctx, scoped(ctx, id));
  if (!row) throw notFound('Pedido não encontrado.');
  return row;
}

type OrderData = ReturnType<typeof orderCreateSchema.parse>;

// Cria o pedido dentro de uma transação já aberta. Usado na venda direta e na conversão de orçamento.
export async function insertOrder(tx: Transaction, ctx: Ctx, data: OrderData, quoteId: number | null = null) {
  if (data.customerId) await assertCustomer(tx, ctx, data.customerId);

  const productIds = [...new Set(data.items.map((item) => item.productId))];
  const catalog = await tx
    .select({ id: products.id, price: products.price })
    .from(products)
    .where(
      and(inArray(products.id, productIds), eq(products.companyId, ctx.companyId), eq(products.active, true)),
    );
  if (catalog.length !== productIds.length) throw badRequest('Produto do pedido não encontrado.');
  const priceOf = new Map(catalog.map((product) => [product.id, product.price]));

  // Estoque antes da numeração: a ordem dos bloqueios (produtos, depois empresa) é sempre a mesma.
  await moveStock(tx, ctx, data.items, 1);

  const lines = data.items.map((item) => {
    const unitPrice = item.unitPrice ?? priceOf.get(item.productId) ?? 0;
    return { ...item, unitPrice, subtotal: round2(item.quantity * unitPrice) };
  });
  const subtotal = round2(lines.reduce((sum, line) => sum + line.subtotal, 0));
  const total = Math.max(0, round2(subtotal - data.discount));

  const [order] = await tx
    .insert(orders)
    .values({
      companyId: ctx.companyId,
      number: await nextNumber(tx, ctx, 'order'),
      customerId: data.customerId ?? null,
      quoteId,
      orderDate: data.orderDate,
      status: data.status,
      discount: data.discount,
      total,
      notes: data.notes,
      createdBy: ctx.userId,
    })
    .returning();
  if (!order) throw new Error('Falha ao criar pedido.');

  await tx.insert(orderItems).values(lines.map((line) => ({ ...line, orderId: order.id })));
  await syncCash(tx, ctx, order, data.bankAccountId);
  await audit(tx, ctx, 'create', 'order', order.id, { status: order.status, total, quoteId });
  return order;
}

export async function createOrder(ctx: Ctx, input: OrderCreateInput) {
  authorize(ctx, 'sales', 'create');
  const data = parse(orderCreateSchema, input);
  const order = await db.transaction((tx) => insertOrder(tx, ctx, data));
  return getOrder(ctx, order.id);
}

export async function updateOrder(ctx: Ctx, id: number, input: OrderUpdateInput) {
  authorize(ctx, 'sales', 'update');
  const data = parse(orderUpdateSchema, input);

  await db.transaction(async (tx) => {
    const [previous] = await tx.select().from(orders).where(scoped(ctx, id)).for('update');
    if (!previous) throw notFound('Pedido não encontrado.');
    if (data.customerId) await assertCustomer(tx, ctx, data.customerId);

    const items = await tx
      .select({
        productId: orderItems.productId,
        quantity: orderItems.quantity,
        subtotal: orderItems.subtotal,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, id));

    const status = data.status ?? previous.status;
    // Reativar um pedido cancelado consome o estoque de novo (validando saldo); cancelar devolve.
    if (previous.status === 'cancelled' && status !== 'cancelled') await moveStock(tx, ctx, items, 1);
    if (previous.status !== 'cancelled' && status === 'cancelled') await moveStock(tx, ctx, items, -1);

    const discount = data.discount ?? previous.discount;
    const subtotal = round2(items.reduce((sum, item) => sum + item.subtotal, 0));

    const [order] = await tx
      .update(orders)
      .set({
        status,
        discount,
        total: Math.max(0, round2(subtotal - discount)),
        orderDate: data.orderDate ?? previous.orderDate,
        customerId: data.customerId === undefined ? previous.customerId : data.customerId,
        notes: data.notes === undefined ? previous.notes : data.notes,
      })
      .where(scoped(ctx, id))
      .returning();
    if (!order) throw notFound('Pedido não encontrado.');

    await syncCash(tx, ctx, order, data.bankAccountId);
    await audit(tx, ctx, status !== previous.status ? 'status' : 'update', 'order', id, {
      from: previous.status,
      to: status,
    });
  });

  return getOrder(ctx, id);
}

// Itens e entrada no caixa são removidos em cascata; o estoque volta se o pedido não estava cancelado.
export async function deleteOrder(ctx: Ctx, id: number) {
  authorize(ctx, 'sales', 'delete');
  await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(scoped(ctx, id)).for('update');
    if (!order) throw notFound('Pedido não encontrado.');

    if (order.status !== 'cancelled') {
      const items = await tx
        .select({ productId: orderItems.productId, quantity: orderItems.quantity })
        .from(orderItems)
        .where(eq(orderItems.orderId, id));
      await moveStock(tx, ctx, items, -1);
    }

    await tx.delete(orders).where(scoped(ctx, id));
    await audit(tx, ctx, 'delete', 'order', id, { status: order.status, total: order.total });
  });
}
