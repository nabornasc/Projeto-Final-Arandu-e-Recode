import { can } from '@arandue/shared/permissions';
import { and, asc, desc, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm';
import { db } from '../db/client.ts';
import {
  interactions,
  opportunities,
  orderItems,
  orders,
  pipelineStages,
  products,
  quotes,
  receivablePayments,
  receivables,
  users,
} from '../db/schema.ts';
import { authorize, type Ctx, ownScope } from '../lib/context.ts';
import { notFound } from '../lib/errors.ts';
import { round2 } from '../lib/money.ts';
import { todayInBrazil } from './orders.ts';
import { getPerson } from './people.ts';

const LIST_LIMIT = 100;
const DAY = 86_400_000;
const toTime = (date: string) => Date.parse(`${date}T00:00:00Z`);
const daysBetween = (from: string, to: string) => Math.round((toTime(to) - toTime(from)) / DAY);
const shiftDate = (date: string, months: number) => {
  const value = new Date(toTime(date));
  value.setUTCMonth(value.getUTCMonth() + months);
  return value.toISOString().slice(0, 10);
};

// Oportunidades e atendimentos do cliente, os mesmos do CRM, com o mesmo escopo.
async function crmOf(ctx: Ctx, customerId: number) {
  const mine = and(
    eq(opportunities.customerId, customerId),
    eq(opportunities.companyId, ctx.companyId),
    ownScope(ctx, opportunities.ownerId),
  );
  const [list, activities] = await Promise.all([
    db
      .select({
        id: opportunities.id,
        title: opportunities.title,
        status: opportunities.status,
        stageName: pipelineStages.name,
        estimatedValue: opportunities.estimatedValue,
        ownerName: users.name,
        nextAction: opportunities.nextAction,
        nextActionAt: opportunities.nextActionAt,
      })
      .from(opportunities)
      .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
      .leftJoin(users, eq(users.id, opportunities.ownerId))
      .where(mine)
      .orderBy(desc(opportunities.updatedAt), desc(opportunities.id))
      .limit(LIST_LIMIT),
    db
      .select({
        id: interactions.id,
        opportunityId: interactions.opportunityId,
        opportunityTitle: opportunities.title,
        kind: interactions.kind,
        channel: interactions.channel,
        description: interactions.description,
        occurredAt: interactions.occurredAt,
        userName: users.name,
      })
      .from(interactions)
      .innerJoin(opportunities, eq(opportunities.id, interactions.opportunityId))
      .leftJoin(users, eq(users.id, interactions.userId))
      .where(mine)
      .orderBy(desc(interactions.occurredAt), desc(interactions.id))
      .limit(LIST_LIMIT),
  ]);
  return { opportunities: list, activities };
}

function quotesOf(ctx: Ctx, customerId: number) {
  return db
    .select({
      id: quotes.id,
      number: quotes.number,
      status: quotes.status,
      total: quotes.total,
      validUntil: quotes.validUntil,
      createdAt: quotes.createdAt,
      opportunityId: quotes.opportunityId,
      sellerName: users.name,
    })
    .from(quotes)
    .leftJoin(users, eq(users.id, quotes.createdBy))
    .where(
      and(
        eq(quotes.customerId, customerId),
        eq(quotes.companyId, ctx.companyId),
        ownScope(ctx, quotes.createdBy),
      ),
    )
    .orderBy(desc(quotes.id))
    .limit(LIST_LIMIT);
}

// Pedidos e o que o cliente compra. Pedido cancelado não conta como venda.
async function salesOf(ctx: Ctx, customerId: number, today: string) {
  const mine = and(
    eq(orders.customerId, customerId),
    eq(orders.companyId, ctx.companyId),
    ownScope(ctx, orders.createdBy),
  );
  const sold = and(mine, ne(orders.status, 'cancelled'));
  const month = sql<string>`to_char(${orders.orderDate}, 'YYYY-MM')`;
  const [list, months, dates, items, [latest]] = await Promise.all([
    db
      .select({
        id: orders.id,
        number: orders.number,
        status: orders.status,
        total: orders.total,
        orderDate: orders.orderDate,
        opportunityId: orders.opportunityId,
        sellerName: users.name,
        paidAmount: sql<number>`coalesce((
          select sum(r.paid_amount) from receivables r where r.order_id = ${orders.id}
        ), 0)`.mapWith(Number),
      })
      .from(orders)
      .leftJoin(users, eq(users.id, orders.createdBy))
      .where(mine)
      .orderBy(desc(orders.orderDate), desc(orders.id))
      .limit(LIST_LIMIT),
    db
      .select({ month, total: sql<number>`sum(${orders.total})`.mapWith(Number) })
      .from(orders)
      .where(and(sold, gte(orders.orderDate, `${shiftDate(today, -11).slice(0, 7)}-01`)))
      .groupBy(month)
      .orderBy(month),
    db
      .selectDistinct({ orderDate: orders.orderDate })
      .from(orders)
      .where(sold)
      .orderBy(asc(orders.orderDate)),
    db
      .select({
        productId: products.id,
        name: products.name,
        quantity: sql<number>`sum(${orderItems.quantity})`.mapWith(Number),
        total: sql<number>`sum(${orderItems.subtotal})`.mapWith(Number),
        lastSale: sql<string>`max(${orders.orderDate})`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .innerJoin(products, eq(products.id, orderItems.productId))
      .where(sold)
      .groupBy(products.id, products.name)
      .orderBy(desc(sql`sum(${orderItems.subtotal})`))
      .limit(20),
    // Fora da lista: ela tem limite e inclui os cancelados.
    db
      .select({ number: orders.number, date: orders.orderDate, total: orders.total })
      .from(orders)
      .where(sold)
      .orderBy(desc(orders.orderDate), desc(orders.id))
      .limit(1),
  ]);

  const first = dates[0]?.orderDate;
  const last = dates.at(-1)?.orderDate ?? null;
  // Média de dias entre as datas de compra: precisa de ao menos duas.
  const purchaseEveryDays =
    first && last && dates.length > 1 ? Math.round(daysBetween(first, last) / (dates.length - 1)) : null;
  return {
    orders: list,
    summary: {
      months,
      purchaseEveryDays,
      daysSinceLastSale: last ? daysBetween(last, today) : null,
      lastSale: latest ?? null,
      products: items.map((item) => ({
        ...item,
        averagePrice: item.quantity ? round2(item.total / item.quantity) : 0,
      })),
    },
  };
}

// Dívida e pontualidade. Como em contas a receber, vale para quem cuida do financeiro em toda a empresa.
async function financeOf(ctx: Ctx, customerId: number, creditLimit: number | null, today: string) {
  const company = and(eq(orders.customerId, customerId), eq(orders.companyId, ctx.companyId));
  const [titles, payments] = await Promise.all([
    db
      .select({
        id: receivables.id,
        orderId: receivables.orderId,
        number: orders.number,
        position: receivables.position,
        titleCount: sql<number>`(count(*) OVER (PARTITION BY ${receivables.orderId}))::int`,
        dueDate: receivables.dueDate,
        amount: receivables.amount,
        paidAmount: receivables.paidAmount,
        status: receivables.status,
      })
      .from(receivables)
      .innerJoin(orders, eq(orders.id, receivables.orderId))
      .where(and(company, inArray(receivables.status, ['open', 'settled'])))
      .orderBy(asc(receivables.dueDate), asc(receivables.id)),
    db
      .select({
        paidOn: receivablePayments.paidOn,
        received: receivablePayments.received,
        method: receivablePayments.method,
        dueDate: receivables.dueDate,
      })
      .from(receivablePayments)
      .innerJoin(receivables, eq(receivables.id, receivablePayments.receivableId))
      .innerJoin(orders, eq(orders.id, receivablePayments.orderId))
      .where(
        and(
          company,
          isNull(receivablePayments.reversedAt),
          gte(receivablePayments.paidOn, shiftDate(today, -12)),
        ),
      ),
  ]);

  const open = titles
    .filter((title) => title.status === 'open')
    .map(({ status: _, ...title }) => ({
      ...title,
      balance: round2(title.amount - title.paidAmount),
      overdue: title.dueDate < today,
    }));
  const sum = (values: number[]) => round2(values.reduce((total, value) => total + value, 0));
  const debt = sum(open.map((title) => title.balance));
  const overdue = sum(open.filter((title) => title.overdue).map((title) => title.balance));

  const paid = sum(payments.map((payment) => payment.received));
  const delays = payments.map((payment) => Math.max(0, daysBetween(payment.dueDate, payment.paidOn)));
  const late = delays.filter((days) => days > 0);
  const paidOnTime = sum(payments.filter((_, index) => !delays[index]).map((payment) => payment.received));

  const methodCount = new Map<string, number>();
  for (const { method } of payments) {
    if (method) methodCount.set(method, (methodCount.get(method) ?? 0) + 1);
  }
  const [topMethod] = [...methodCount].sort((a, b) => b[1] - a[1]);

  return {
    debt,
    overdue,
    toDue: round2(debt - overdue),
    creditLimit,
    creditAvailable: creditLimit === null ? null : round2(creditLimit - debt),
    periodFrom: shiftDate(today, -12),
    periodTo: today,
    paid,
    paidOnTime,
    paidLate: round2(paid - paidOnTime),
    punctuality: paid > 0 ? Math.round((paidOnTime / paid) * 10000) / 100 : null,
    averageDelayDays: late.length
      ? Math.round(late.reduce((total, days) => total + days, 0) / late.length)
      : 0,
    longestDelayDays: late.length ? Math.max(...late) : 0,
    usualMethod: topMethod
      ? { method: topMethod[0], share: Math.round((topMethod[1] / payments.length) * 100) }
      : null,
    openTitles: open,
  };
}

// Ficha do cliente: cada parte só aparece para quem pode ver aquela área, com o escopo dela.
export async function getCustomerFile(ctx: Ctx, id: number) {
  authorize(ctx, 'customers.read');
  const person = await getPerson(ctx, id);
  if (!person.isCustomer) throw notFound('Cliente não encontrado.');
  const today = todayInBrazil();
  const allowed = (permission: Parameters<typeof can>[1]) => can(ctx.permissions, permission);

  const [crm, customerQuotes, sales, finance] = await Promise.all([
    allowed('opportunities.read') ? crmOf(ctx, id) : null,
    allowed('quotes.read') ? quotesOf(ctx, id) : null,
    allowed('orders.read') ? salesOf(ctx, id, today) : null,
    allowed('receivables.read') ? financeOf(ctx, id, person.creditLimit, today) : null,
  ]);
  return {
    customer: {
      id: person.id,
      name: person.name,
      legalName: person.legalName,
      kind: person.kind,
      document: person.document,
      email: person.email,
      phone: person.phone,
      mobile: person.mobile,
      city: person.city,
      state: person.state,
      sellerName: person.sellerName,
      active: person.active,
    },
    opportunities: crm?.opportunities ?? null,
    activities: crm?.activities ?? null,
    quotes: customerQuotes,
    orders: sales?.orders ?? null,
    summary: sales?.summary ?? null,
    finance,
  };
}
