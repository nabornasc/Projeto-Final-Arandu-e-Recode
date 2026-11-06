import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { orders, people } from '../db/schema.ts';
import { authorize, type Ctx } from '../lib/context.ts';

interface Summary extends Record<string, unknown> {
  revenue_month: string;
  expenses_month: string;
  balance: string;
  pending_orders: number;
  revenue_year: string;
  mei_annual_limit: string | null;
}

// Juros e descontos dados na baixa mudam o valor faturado dos pedidos quitados.
const settlementAdjustment = (companyId: number, period: 'month' | 'year') => sql`
  COALESCE((SELECT SUM(p.interest - p.discount)
            FROM receivable_payments p JOIN orders o ON o.id = p.order_id
            WHERE p.company_id = ${companyId} AND p.reversed_at IS NULL
              AND o.status IN ('paid', 'completed')
              AND o.order_date >= date_trunc(${period}, CURRENT_DATE)), 0)`;

// Resumo do mês corrente. Os KPIs completos (ticket médio, conversão, funil) chegam na semana 3.
export async function getDashboard(ctx: Ctx) {
  authorize(ctx, 'analytics.read');
  const companyId = ctx.companyId;

  const [summary] = await db.execute<Summary>(sql`
    SELECT
      COALESCE((SELECT SUM(total) FROM orders
                WHERE company_id = ${companyId} AND status IN ('paid', 'completed')
                  AND order_date >= date_trunc('month', CURRENT_DATE)), 0)
      + ${settlementAdjustment(companyId, 'month')} AS revenue_month,
      COALESCE((SELECT SUM(amount) FROM expenses
                WHERE company_id = ${companyId} AND status = 'paid'
                  AND expense_date >= date_trunc('month', CURRENT_DATE)), 0) AS expenses_month,
      -- Saldo = saldo inicial + movimentações, considerando só contas ativas (nos dois termos).
      COALESCE((SELECT SUM(initial_balance) FROM bank_accounts
                WHERE company_id = ${companyId} AND active), 0)
      + COALESCE((SELECT SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE -t.amount END)
                  FROM cash_transactions t JOIN bank_accounts a ON a.id = t.bank_account_id
                  WHERE t.company_id = ${companyId} AND a.active), 0) AS balance,
      (SELECT COUNT(*)::int FROM orders WHERE company_id = ${companyId} AND status = 'pending') AS pending_orders,
      COALESCE((SELECT SUM(total) FROM orders
                WHERE company_id = ${companyId} AND status IN ('paid', 'completed')
                  AND order_date >= date_trunc('year', CURRENT_DATE)), 0)
      + ${settlementAdjustment(companyId, 'year')} AS revenue_year,
      (SELECT mei_annual_limit FROM companies WHERE id = ${companyId}) AS mei_annual_limit
  `);

  const recentOrders = await db
    .select({
      id: orders.id,
      number: orders.number,
      orderDate: orders.orderDate,
      total: orders.total,
      status: orders.status,
      customerName: people.name,
    })
    .from(orders)
    .leftJoin(people, and(eq(people.id, orders.customerId)))
    .where(eq(orders.companyId, companyId))
    .orderBy(desc(orders.orderDate), desc(orders.id))
    .limit(5);

  return {
    revenueMonth: Number(summary?.revenue_month ?? 0),
    expensesMonth: Number(summary?.expenses_month ?? 0),
    balance: Number(summary?.balance ?? 0),
    pendingOrders: summary?.pending_orders ?? 0,
    // Faturamento do ano comparado ao limite informado pela empresa (null enquanto não configurado).
    revenueYear: Number(summary?.revenue_year ?? 0),
    meiAnnualLimit: summary?.mei_annual_limit == null ? null : Number(summary.mei_annual_limit),
    recentOrders,
  };
}
