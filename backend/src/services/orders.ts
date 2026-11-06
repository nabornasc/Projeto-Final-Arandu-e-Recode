import { can, type Permission } from '@arandue/shared/permissions';
import {
  type OrderCreateInput,
  type OrderStatus,
  type OrderUpdateInput,
  orderCreateSchema,
  orderUndoPaymentsSchema,
  orderUpdateSchema,
  passwordConfirmationSchema,
  type ReceivableSettleInput,
  type ReceivablesSettleInput,
  receivableSettleSchema,
  receivablesSettleSchema,
} from '@arandue/shared/schemas';
import { and, asc, desc, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm';
import { db, type Transaction } from '../db/client.ts';
import {
  bankAccounts,
  cashTransactions,
  opportunities,
  orderItems,
  orders,
  people,
  products,
  receivablePayments,
  receivables,
} from '../db/schema.ts';
import { diffFields, diffItems, type FieldChange, initialFields, removedFields } from '../lib/changes.ts';
import { authorize, authorizeAny, type Ctx, ownScope } from '../lib/context.ts';
import { badRequest, conflict, notFound } from '../lib/errors.ts';
import { round2 } from '../lib/money.ts';
import { parse } from '../lib/validate.ts';
import { accountName, audit, namedLines, personName } from './audit.ts';
import { confirmPassword } from './auth.ts';
import { formatCode, nextNumber } from './numbering.ts';
import {
  advanceToMilestone,
  lockOpportunity,
  noteDocumentValue,
  prepareDocumentLink,
  recordDocumentEvent,
  winFromDocument,
} from './opportunities.ts';
import { assertActiveAccount, assertCustomer } from './ownership.ts';

type Order = typeof orders.$inferSelect;

// Status em que o dinheiro já entrou no caixa.
const RECEIVED: readonly OrderStatus[] = ['paid', 'completed'];
const isReceived = (status: OrderStatus) => RECEIVED.includes(status);

// Grupos restritos aos próprios registros não alcançam (nem para ler) os pedidos de outros usuários.
const scoped = (ctx: Ctx, id: number) =>
  and(eq(orders.id, id), eq(orders.companyId, ctx.companyId), ownScope(ctx, orders.createdBy));

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

// Data de hoje no Brasil, para a baixa sem data informada: o servidor roda em UTC.
export const todayInBrazil = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

type Installment = { dueDate: string; amount: number; method: string | null };

// Cada pedido nasce com as suas contas a receber. Sem parcelas, é uma só, com vencimento na data da venda.
async function createReceivables(tx: Transaction, ctx: Ctx, order: Order, installments: Installment[]) {
  if (installments.length) {
    if (order.status !== 'pending') throw badRequest('Pedido já pago não tem parcelas.');
    const sum = round2(installments.reduce((value, item) => value + item.amount, 0));
    if (sum !== order.total) {
      throw badRequest(
        `A soma das parcelas (${sum.toFixed(2)}) precisa ser igual ao total do pedido (${order.total.toFixed(2)}).`,
      );
    }
  }
  const list = installments.length
    ? installments
    : [{ dueDate: order.orderDate, amount: order.total, method: null }];
  await tx.insert(receivables).values(
    list.map((item, index) => ({
      companyId: ctx.companyId,
      orderId: order.id,
      position: index + 1,
      dueDate: item.dueDate,
      amount: item.amount,
      method: item.method,
    })),
  );
}

type Title = typeof receivables.$inferSelect;
type Payment = {
  accountId: number | null;
  paidOn: string;
  principal: number;
  interest: number;
  discount: number;
  received: number;
  method?: string | null;
  notes?: string | null;
};

// Registra a baixa e abate o saldo. O valor recebido, se houver, entra no caixa com a data informada.
// Retorna o status da conta depois da baixa.
async function recordPayment(
  tx: Transaction,
  ctx: Ctx,
  order: Order,
  title: Title,
  titleCount: number,
  payment: Payment,
) {
  if (payment.received > 0 && !payment.accountId) {
    throw badRequest('Cadastre uma conta bancária para registrar o recebimento.');
  }
  const paidAmount = round2(title.paidAmount + payment.principal);
  const status = paidAmount >= title.amount ? ('settled' as const) : ('open' as const);
  await tx.update(receivables).set({ status, paidAmount }).where(eq(receivables.id, title.id));
  const [row] = await tx
    .insert(receivablePayments)
    .values({
      companyId: ctx.companyId,
      orderId: order.id,
      receivableId: title.id,
      bankAccountId: payment.accountId,
      paidOn: payment.paidOn,
      principal: payment.principal,
      interest: payment.interest,
      discount: payment.discount,
      received: payment.received,
      method: payment.method ?? title.method,
      notes: payment.notes ?? null,
      createdBy: ctx.userId,
    })
    .returning({ id: receivablePayments.id });
  if (row && payment.received > 0 && payment.accountId) {
    const part = titleCount > 1 ? ` (parcela ${title.position}/${titleCount})` : '';
    await tx.insert(cashTransactions).values({
      companyId: ctx.companyId,
      type: 'income',
      category: 'Vendas',
      orderId: order.id,
      paymentId: row.id,
      bankAccountId: payment.accountId,
      amount: payment.received,
      transactionDate: payment.paidOn,
      description: `Recebimento do pedido ${formatCode(order.number)}${part}`,
    });
  }
  return status;
}

// Quita o saldo da conta. Conta sem saldo, como a de um pedido de valor zero, não gera baixa.
async function settleTitle(
  tx: Transaction,
  ctx: Ctx,
  order: Order,
  title: Title,
  titleCount: number,
  accountId: number | null,
  settledOn: string,
) {
  const balance = round2(title.amount - title.paidAmount);
  if (balance <= 0) {
    await tx.update(receivables).set({ status: 'settled' }).where(eq(receivables.id, title.id));
    return;
  }
  await recordPayment(tx, ctx, order, title, titleCount, {
    accountId,
    paidOn: settledOn,
    principal: balance,
    interest: 0,
    discount: 0,
    received: balance,
  });
}

// Estorna todas as baixas do pedido, ao cancelar ou voltar para pendente. O motivo fica em cada baixa.
async function reverseAllPayments(tx: Transaction, ctx: Ctx, orderId: number, reason: string) {
  await tx.delete(cashTransactions).where(eq(cashTransactions.orderId, orderId));
  await tx
    .update(receivablePayments)
    .set({ reversedAt: new Date(), reversedBy: ctx.userId, reversalReason: reason })
    .where(and(eq(receivablePayments.orderId, orderId), isNull(receivablePayments.reversedAt)));
}

async function resolveAccount(tx: Transaction, ctx: Ctx, orderId: number, requested?: number | null) {
  if (requested) {
    await assertActiveAccount(tx, ctx, requested);
    return requested;
  }
  const [existing] = await tx
    .select({ bankAccountId: cashTransactions.bankAccountId })
    .from(cashTransactions)
    .where(eq(cashTransactions.orderId, orderId));
  return existing?.bankAccountId ?? (await defaultAccountId(tx, ctx));
}

// Mantém contas a receber e caixa de acordo com o pedido. Cancelado não tem entrada no caixa; voltar
// de recebido ou de cancelado reabre as contas; pedido recebido tem todas as contas quitadas.
// A conta única acompanha o total só com uma baixa simples: com parcial, juros ou desconto, é preciso estornar.
async function syncReceivables(
  tx: Transaction,
  ctx: Ctx,
  order: Order,
  options: { previous?: Order; accountId?: number | null; settledOn?: string; reason?: string | null } = {},
) {
  const { previous, accountId: requested, settledOn = order.orderDate, reason } = options;
  const whereOrder = eq(receivables.orderId, order.id);
  const cashOfOrder = eq(cashTransactions.orderId, order.id);
  const activePayments = and(eq(receivablePayments.orderId, order.id), isNull(receivablePayments.reversedAt));

  if (order.status === 'cancelled') {
    await reverseAllPayments(tx, ctx, order.id, reason ?? 'Pedido cancelado');
    await tx.update(receivables).set({ status: 'cancelled', paidAmount: 0 }).where(whereOrder);
    return;
  }
  const reopen =
    previous &&
    (previous.status === 'cancelled' || (isReceived(previous.status) && !isReceived(order.status)));
  if (reopen) {
    await reverseAllPayments(tx, ctx, order.id, reason ?? 'Pedido voltou para pendente');
    await tx.update(receivables).set({ status: 'open', paidAmount: 0 }).where(whereOrder);
  }

  let titles = await tx
    .select()
    .from(receivables)
    .where(whereOrder)
    .orderBy(asc(receivables.position))
    .for('update');
  const sum = round2(titles.reduce((value, title) => value + title.amount, 0));
  if (sum !== order.total) {
    const [only] = titles;
    if (titles.length !== 1 || !only) {
      throw conflict('Este pedido tem parcelas: o total não pode mudar depois de criado.');
    }
    const payments = await tx.select().from(receivablePayments).where(activePayments);
    const [payment] = payments;
    const simple =
      only.status === 'settled' && payments.length === 1 && !payment?.interest && !payment?.discount;
    if (payments.length && !simple) {
      throw conflict(
        'Este pedido tem baixa parcial, juros ou desconto: estorne a baixa antes de mudar o total.',
      );
    }
    // Quitada sem baixa era de valor zero. Com valor novo, volta a ter saldo e recebe a baixa abaixo.
    const owes = only.status === 'settled' && !payment && order.total > 0;
    const paidAmount = only.status === 'settled' && !owes ? order.total : 0;
    const status = owes ? ('open' as const) : only.status;
    await tx
      .update(receivables)
      .set({ amount: order.total, paidAmount, status })
      .where(eq(receivables.id, only.id));
    if (payment && order.total > 0) {
      await tx
        .update(receivablePayments)
        .set({ principal: order.total, received: order.total })
        .where(eq(receivablePayments.id, payment.id));
      await tx
        .update(cashTransactions)
        .set({ amount: order.total })
        .where(eq(cashTransactions.paymentId, payment.id));
    } else if (payment) {
      await tx.delete(receivablePayments).where(eq(receivablePayments.id, payment.id));
    }
    titles = [{ ...only, amount: order.total, paidAmount, status }];
  }

  if (previous && previous.orderDate !== order.orderDate) {
    // Só acompanha a venda a entrada lançada na própria data da venda.
    await tx
      .update(cashTransactions)
      .set({ transactionDate: order.orderDate })
      .where(and(cashOfOrder, eq(cashTransactions.transactionDate, previous.orderDate)));
    await tx
      .update(receivablePayments)
      .set({ paidOn: order.orderDate })
      .where(and(activePayments, eq(receivablePayments.paidOn, previous.orderDate)));
  }

  if (!isReceived(order.status)) return;
  const accountId = await resolveAccount(tx, ctx, order.id, requested);
  for (const title of titles) {
    if (title.status === 'open') {
      await settleTitle(tx, ctx, order, title, titles.length, accountId, settledOn);
    }
  }
  // Trocar a conta só em pedido já recebido: dar baixa no restante não move o que entrou em outra conta.
  if (requested && previous && isReceived(previous.status)) {
    await tx.update(cashTransactions).set({ bankAccountId: requested }).where(cashOfOrder);
    await tx.update(receivablePayments).set({ bankAccountId: requested }).where(activePayments);
  }
}

// Cancelar, excluir ou voltar para pendente também desfaz as baixas. Exige o mesmo do estorno: a
// permissão, a senha e o motivo, que só chegam por undoOrderPayments.
async function authorizeUndoPayments(tx: Transaction, ctx: Ctx, orderId: number, confirmed: boolean) {
  const [active] = await tx
    .select({ id: receivablePayments.id })
    .from(receivablePayments)
    .where(and(eq(receivablePayments.orderId, orderId), isNull(receivablePayments.reversedAt)))
    .limit(1);
  if (!active) return;
  authorize(ctx, 'receivables.reverse');
  if (!confirmed)
    throw conflict('Este pedido tem baixa registrada: confirme com a sua senha e informe o motivo.');
}

// Conta em que o pedido entrou no caixa, para o histórico.
async function cashAccountName(tx: Transaction, orderId: number): Promise<string | null> {
  const [row] = await tx
    .select({ bankName: bankAccounts.bankName, accountName: bankAccounts.accountName })
    .from(cashTransactions)
    .innerJoin(bankAccounts, eq(bankAccounts.id, cashTransactions.bankAccountId))
    .where(eq(cashTransactions.orderId, orderId));
  return row ? `${row.bankName} — ${row.accountName}` : null;
}

async function loadOrders(ctx: Ctx, where: SQL | undefined) {
  const rows = await db
    .select({
      id: orders.id,
      number: orders.number,
      customerId: orders.customerId,
      customerName: people.name,
      quoteId: orders.quoteId,
      opportunityId: orders.opportunityId,
      opportunityTitle: opportunities.title,
      originQuoteId: orders.originQuoteId,
      originOrderId: orders.originOrderId,
      originKind: orders.originKind,
      orderDate: orders.orderDate,
      status: orders.status,
      discount: orders.discount,
      freight: orders.freight,
      otherCharges: orders.otherCharges,
      total: orders.total,
      notes: orders.notes,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .leftJoin(people, eq(people.id, orders.customerId))
    .leftJoin(opportunities, eq(opportunities.id, orders.opportunityId))
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

  const titles = await db
    .select({
      id: receivables.id,
      orderId: receivables.orderId,
      position: receivables.position,
      dueDate: receivables.dueDate,
      amount: receivables.amount,
      paidAmount: receivables.paidAmount,
      method: receivables.method,
      status: receivables.status,
    })
    .from(receivables)
    .where(
      inArray(
        receivables.orderId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(receivables.position));
  const titlesByOrder = Map.groupBy(titles, (title) => title.orderId);

  const payments = await db
    .select({
      id: receivablePayments.id,
      orderId: receivablePayments.orderId,
      receivableId: receivablePayments.receivableId,
      paidOn: receivablePayments.paidOn,
      principal: receivablePayments.principal,
      interest: receivablePayments.interest,
      discount: receivablePayments.discount,
      received: receivablePayments.received,
      method: receivablePayments.method,
      notes: receivablePayments.notes,
      bankName: bankAccounts.bankName,
      accountName: bankAccounts.accountName,
      reversedAt: receivablePayments.reversedAt,
      reversalReason: receivablePayments.reversalReason,
    })
    .from(receivablePayments)
    .leftJoin(bankAccounts, eq(bankAccounts.id, receivablePayments.bankAccountId))
    .where(
      inArray(
        receivablePayments.orderId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(receivablePayments.id));
  const paymentsByOrder = Map.groupBy(payments, (payment) => payment.orderId);

  const byOrder = Map.groupBy(items, (item) => item.orderId);
  // O título da oportunidade só aparece para quem pode ver o CRM.
  const showOpportunity = can(ctx.permissions, 'opportunities.read');
  return rows.map((row) => ({
    ...row,
    opportunityTitle: showOpportunity ? row.opportunityTitle : null,
    items: byOrder.get(row.id) ?? [],
    receivables: titlesByOrder.get(row.id) ?? [],
    payments: paymentsByOrder.get(row.id) ?? [],
  }));
}

export async function listOrders(ctx: Ctx) {
  authorize(ctx, 'orders.read');
  return loadOrders(ctx, and(eq(orders.companyId, ctx.companyId), ownScope(ctx, orders.createdBy)));
}

export async function getOrder(ctx: Ctx, id: number) {
  authorize(ctx, 'orders.read');
  const [row] = await loadOrders(ctx, scoped(ctx, id));
  if (!row) throw notFound('Pedido não encontrado.');
  return row;
}

type OrderData = ReturnType<typeof orderCreateSchema.parse>;
type ItemInput = OrderData['items'][number];

// Confere os produtos (ativos e da empresa) e calcula subtotais e total. Sem preço informado,
// usa o preço de cadastro. Compartilhado por pedidos e orçamentos.
// charges = frete e outras despesas, somados ao total.
export async function buildLines(
  tx: Transaction,
  ctx: Ctx,
  items: ItemInput[],
  discount: number,
  charges: number,
) {
  const productIds = [...new Set(items.map((item) => item.productId))];
  const catalog = await tx
    .select({ id: products.id, price: products.price })
    .from(products)
    .where(
      and(inArray(products.id, productIds), eq(products.companyId, ctx.companyId), eq(products.active, true)),
    );
  if (catalog.length !== productIds.length) throw badRequest('Produto não encontrado ou arquivado.');
  const priceOf = new Map(catalog.map((product) => [product.id, product.price]));

  const lines = items.map((item) => {
    const unitPrice = item.unitPrice ?? priceOf.get(item.productId) ?? 0;
    return {
      productId: item.productId,
      quantity: item.quantity,
      unitPrice,
      subtotal: round2(item.quantity * unitPrice),
    };
  });
  const subtotal = round2(lines.reduce((sum, line) => sum + line.subtotal, 0));
  return { lines, total: Math.max(0, round2(subtotal - discount + charges)) };
}

// Cria o pedido dentro de uma transação já aberta. Usado na venda direta e na conversão de orçamento.
// Quem chama confere as permissões (pedido já pago exige também receivables.settle).
// data.opportunityId vem do usuário (é conferida); link.opportunityId é herdada de outro documento.
export interface DocumentLink {
  quoteId?: number | null;
  opportunityId?: number | null;
  originQuoteId?: number | null;
  originOrderId?: number | null;
  originKind?: 'converted' | 'duplicated' | 'copied' | null;
}

export async function insertOrder(tx: Transaction, ctx: Ctx, data: OrderData, link: DocumentLink = {}) {
  await lockOpportunity(tx, link.opportunityId);
  const customerId = data.opportunityId
    ? await prepareDocumentLink(tx, ctx, data.opportunityId, data.customerId)
    : data.customerId;
  const opportunityId = link.opportunityId ?? data.opportunityId ?? null;
  if (customerId) await assertCustomer(tx, ctx, customerId);
  const { lines, total } = await buildLines(
    tx,
    ctx,
    data.items,
    data.discount,
    data.freight + data.otherCharges,
  );

  // Estoque antes da numeração: a ordem dos bloqueios (produtos, depois empresa) é sempre a mesma.
  await moveStock(tx, ctx, data.items, 1);

  const [order] = await tx
    .insert(orders)
    .values({
      companyId: ctx.companyId,
      number: await nextNumber(tx, ctx, 'order'),
      customerId: customerId ?? null,
      quoteId: link.quoteId ?? null,
      opportunityId,
      originQuoteId: link.originQuoteId ?? null,
      originOrderId: link.originOrderId ?? null,
      originKind: link.originKind ?? null,
      orderDate: data.orderDate,
      status: data.status,
      discount: data.discount,
      freight: data.freight,
      otherCharges: data.otherCharges,
      total,
      notes: data.notes,
      createdBy: ctx.userId,
    })
    .returning();
  if (!order) throw new Error('Falha ao criar pedido.');

  await tx.insert(orderItems).values(lines.map((line) => ({ ...line, orderId: order.id })));
  await createReceivables(tx, ctx, order, data.installments);
  await syncReceivables(tx, ctx, order, { accountId: data.bankAccountId });
  await audit(tx, ctx, 'create', 'order', order.id, {
    number: order.number,
    originKind: link.originKind,
    changes: initialFields({
      status: order.status,
      customer: await personName(tx, customerId),
      orderDate: order.orderDate,
      discount: order.discount,
      freight: order.freight,
      otherCharges: order.otherCharges,
      total,
      notes: order.notes,
      bankAccount: await cashAccountName(tx, order.id),
    }),
    items: diffItems([], await namedLines(tx, lines)),
    status: order.status,
    total,
    quoteId: order.quoteId,
    opportunityId,
  });
  if (opportunityId) {
    await noteDocumentValue(tx, opportunityId, total);
    await advanceToMilestone(
      tx,
      ctx,
      opportunityId,
      'negotiation',
      `Pedido ${formatCode(order.number)} gerado`,
    );
    if (isReceived(order.status)) {
      await winFromDocument(
        tx,
        ctx,
        opportunityId,
        order.customerId,
        `Pedido ${formatCode(order.number)} recebido`,
      );
    }
  }
  return order;
}

export async function createOrder(ctx: Ctx, input: OrderCreateInput) {
  authorize(ctx, 'orders.create');
  const data = parse(orderCreateSchema, input);
  if (isReceived(data.status)) authorize(ctx, 'receivables.settle');
  const order = await db.transaction((tx) => insertOrder(tx, ctx, data));
  return getOrder(ctx, order.id);
}

type OrderUpdateData = ReturnType<typeof orderUpdateSchema.parse>;

// Cada parte da alteração exige a sua permissão: editar dados, cancelar/reativar e mexer no
// recebimento (pago, concluído, conta ou valor de um pedido já recebido) são separados.
function permissionsForUpdate(previous: Order, data: OrderUpdateData): Permission[] {
  const required = new Set<Permission>();
  const status = data.status ?? previous.status;
  const edits = [data.customerId, data.orderDate, data.discount, data.notes].some(
    (value) => value !== undefined,
  );
  if (edits) required.add('orders.update');
  if (status !== previous.status) {
    if (status === 'cancelled' || previous.status === 'cancelled') required.add('orders.cancel');
    if (isReceived(status) || isReceived(previous.status)) required.add('receivables.settle');
  }
  if (isReceived(status) && (data.bankAccountId || data.discount !== undefined))
    required.add('receivables.settle');
  if (!required.size) required.add('orders.update');
  return [...required];
}

export async function updateOrder(ctx: Ctx, id: number, input: OrderUpdateInput, confirmed = false) {
  authorizeAny(ctx, ['orders.update', 'orders.cancel', 'receivables.settle']);
  const data = parse(orderUpdateSchema, input);

  await db.transaction(async (tx) => {
    const [previous] = await tx.select().from(orders).where(scoped(ctx, id)).for('update');
    if (!previous) throw notFound('Pedido não encontrado.');
    for (const permission of permissionsForUpdate(previous, data)) authorize(ctx, permission);
    if (data.status === 'cancelled' && previous.status !== 'cancelled' && !data.reason) {
      throw badRequest('Informe o motivo do cancelamento.');
    }
    const nextStatus = data.status ?? previous.status;
    if (nextStatus === 'cancelled' || (isReceived(previous.status) && !isReceived(nextStatus))) {
      await authorizeUndoPayments(tx, ctx, id, confirmed);
    }
    await lockOpportunity(tx, previous.opportunityId);
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
    const previousAccount = await cashAccountName(tx, id);

    const [order] = await tx
      .update(orders)
      .set({
        status,
        discount,
        total: Math.max(0, round2(subtotal - discount + previous.freight + previous.otherCharges)),
        orderDate: data.orderDate ?? previous.orderDate,
        customerId: data.customerId === undefined ? previous.customerId : data.customerId,
        notes: data.notes === undefined ? previous.notes : data.notes,
      })
      .where(scoped(ctx, id))
      .returning();
    if (!order) throw notFound('Pedido não encontrado.');

    await syncReceivables(tx, ctx, order, { previous, accountId: data.bankAccountId, reason: data.reason });
    const changes = diffFields(
      {
        status: previous.status,
        customer: await personName(tx, previous.customerId),
        orderDate: previous.orderDate,
        discount: previous.discount,
        total: previous.total,
        notes: previous.notes,
        bankAccount: previousAccount,
      },
      {
        status,
        customer: await personName(tx, order.customerId),
        orderDate: order.orderDate,
        discount: order.discount,
        total: order.total,
        notes: order.notes,
        bankAccount: await cashAccountName(tx, id),
      },
    );
    // Salvar sem mudar nada não vira registro.
    if (changes.length) {
      await audit(
        tx,
        ctx,
        status !== previous.status ? 'status' : 'update',
        'order',
        id,
        { number: order.number, from: previous.status, to: status, changes },
        data.reason,
      );
    }
    if (order.opportunityId && status !== previous.status) {
      if (isReceived(status) && !isReceived(previous.status)) {
        await winFromDocument(
          tx,
          ctx,
          order.opportunityId,
          order.customerId,
          `Pedido ${formatCode(order.number)} recebido`,
        );
      } else if (status === 'cancelled') {
        await recordDocumentEvent(
          tx,
          ctx,
          order.opportunityId,
          `Pedido ${formatCode(order.number)} cancelado: ${data.reason}`,
        );
      }
    }
  });

  return getOrder(ctx, id);
}

// Itens e entrada no caixa são removidos em cascata; o estoque volta se o pedido não estava cancelado.
export async function deleteOrder(ctx: Ctx, id: number, confirmation?: { reason: string }) {
  authorize(ctx, 'orders.delete');
  await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(scoped(ctx, id)).for('update');
    if (!order) throw notFound('Pedido não encontrado.');
    await authorizeUndoPayments(tx, ctx, id, Boolean(confirmation));
    await lockOpportunity(tx, order.opportunityId);

    const items = await tx
      .select({
        productId: orderItems.productId,
        quantity: orderItems.quantity,
        unitPrice: orderItems.unitPrice,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, id))
      .orderBy(asc(orderItems.id));
    if (order.status !== 'cancelled') await moveStock(tx, ctx, items, -1);

    // Lê antes de excluir: a entrada no caixa sai em cascata.
    const customer = await personName(tx, order.customerId);
    const bankAccount = await cashAccountName(tx, id);
    await tx.delete(orders).where(scoped(ctx, id));
    // Cópia do que foi excluído: o documento deixa de existir, o registro não.
    await audit(
      tx,
      ctx,
      'delete',
      'order',
      id,
      {
        number: order.number,
        createdBy: order.createdBy,
        status: order.status,
        total: order.total,
        changes: removedFields({
          status: order.status,
          customer,
          orderDate: order.orderDate,
          discount: order.discount,
          total: order.total,
          notes: order.notes,
          bankAccount,
        }),
        items: diffItems(await namedLines(tx, items), []),
      },
      confirmation?.reason,
    );
    if (order.opportunityId) {
      await recordDocumentEvent(tx, ctx, order.opportunityId, `Pedido ${formatCode(order.number)} excluído.`);
    }
  });
}

// ---------- Contas a receber ----------

// Contas de pedidos não cancelados, de toda a empresa: quem cuida do financeiro dá baixa em todas.
export async function listReceivables(ctx: Ctx) {
  authorize(ctx, 'receivables.read');
  return db
    .select({
      id: receivables.id,
      orderId: receivables.orderId,
      number: orders.number,
      customerName: people.name,
      orderDate: orders.orderDate,
      position: receivables.position,
      titleCount: sql<number>`(count(*) OVER (PARTITION BY ${receivables.orderId}))::int`,
      dueDate: receivables.dueDate,
      amount: receivables.amount,
      paidAmount: receivables.paidAmount,
      received: sql<number>`coalesce((
        select sum(p.received) from receivable_payments p
        where p.receivable_id = ${receivables.id} and p.reversed_at is null
      ), 0)`.mapWith(Number),
      method: receivables.method,
      status: receivables.status,
    })
    .from(receivables)
    .innerJoin(orders, eq(orders.id, receivables.orderId))
    .leftJoin(people, eq(people.id, orders.customerId))
    .where(and(eq(receivables.companyId, ctx.companyId), inArray(receivables.status, ['open', 'settled'])))
    .orderBy(asc(receivables.dueDate), asc(receivables.id))
    .limit(500);
}

// Com a última conta paga, o pedido vira "pago" e pode ganhar a oportunidade.
async function markOrderPaid(tx: Transaction, ctx: Ctx, previous: Order, changes: FieldChange[]) {
  const companyOrder = and(eq(orders.id, previous.id), eq(orders.companyId, ctx.companyId));
  const [order] = await tx.update(orders).set({ status: 'paid' }).where(companyOrder).returning();
  if (!order) throw notFound('Pedido não encontrado.');
  await audit(tx, ctx, 'status', 'order', order.id, {
    number: order.number,
    from: 'pending',
    to: 'paid',
    via: 'receivables',
    changes,
  });
  if (order.opportunityId) {
    await winFromDocument(
      tx,
      ctx,
      order.opportunityId,
      order.customerId,
      `Pedido ${formatCode(order.number)} recebido`,
    );
  }
  return order;
}

// Baixa de todas as contas em aberto do pedido.
export async function settleOrder(ctx: Ctx, id: number, input?: ReceivableSettleInput) {
  authorize(ctx, 'receivables.settle');
  const data = parse(receivableSettleSchema, input ?? {});
  const companyOrder = and(eq(orders.id, id), eq(orders.companyId, ctx.companyId));

  await db.transaction(async (tx) => {
    const [previous] = await tx.select().from(orders).where(companyOrder).for('update');
    if (!previous) throw notFound('Pedido não encontrado.');
    if (previous.status !== 'pending') throw conflict('Só pedidos pendentes podem receber baixa.');
    const settledOn = data.settledOn ?? todayInBrazil();
    await syncReceivables(
      tx,
      ctx,
      { ...previous, status: 'paid' },
      { accountId: data.bankAccountId, settledOn },
    );
    await markOrderPaid(
      tx,
      ctx,
      previous,
      diffFields(
        { status: 'pending', bankAccount: null },
        { status: 'paid', bankAccount: await cashAccountName(tx, id) },
      ),
    );
  });

  const [row] = await loadOrders(ctx, companyOrder);
  return row;
}

const titleLabel = (title: Title, count: number) => `Parcela ${title.position}/${count}`;

type SettleItem = ReturnType<typeof receivablesSettleSchema.parse>['items'][number];

// Valores da baixa: principal é o que sai do saldo. Sem valor recebido, quita o que falta.
function paymentValues(title: Title, count: number, item: SettleItem) {
  const { interest, discount } = item;
  const balance = round2(title.amount - title.paidAmount);
  const received = item.received ?? round2(balance + interest - discount);
  const principal = round2(received - interest + discount);
  const name = titleLabel(title, count);
  if (received < 0) throw badRequest(`${name}: o desconto é maior que o saldo.`);
  if (principal <= 0) throw badRequest(`${name}: o valor informado não abate o saldo.`);
  if (principal > balance) {
    throw badRequest(
      `${name}: o valor abatido (${principal.toFixed(2)}) passa do saldo (${balance.toFixed(2)}).`,
    );
  }
  return { principal, interest, discount, received };
}

// Baixa em uma ou mais contas, de um ou mais pedidos. Trava os pedidos em ordem de id, antes das contas.
export async function settleReceivables(ctx: Ctx, input: ReceivablesSettleInput) {
  authorize(ctx, 'receivables.settle');
  const data = parse(receivablesSettleSchema, input);
  const itemOf = new Map(data.items.map((item) => [item.receivableId, item]));

  await db.transaction(async (tx) => {
    const found = await tx
      .select({ orderId: receivables.orderId })
      .from(receivables)
      .where(and(inArray(receivables.id, [...itemOf.keys()]), eq(receivables.companyId, ctx.companyId)));
    if (found.length !== itemOf.size) throw notFound('Conta a receber não encontrada.');
    const locked = await tx
      .select()
      .from(orders)
      .where(
        inArray(
          orders.id,
          found.map((row) => row.orderId),
        ),
      )
      .orderBy(asc(orders.id))
      .for('update');
    const paidOn = data.settledOn ?? todayInBrazil();

    for (const order of locked) {
      const titles = await tx
        .select()
        .from(receivables)
        .where(eq(receivables.orderId, order.id))
        .orderBy(asc(receivables.position))
        .for('update');
      const accountId = await resolveAccount(tx, ctx, order.id, data.bankAccountId);
      const notes: string[] = [];
      const settled = new Set(titles.filter((title) => title.status === 'settled').map((title) => title.id));

      for (const title of titles) {
        const item = itemOf.get(title.id);
        if (!item) continue;
        if (order.status !== 'pending' || title.status !== 'open') {
          throw conflict('Só contas em aberto de pedidos pendentes podem receber baixa.');
        }
        const name = titleLabel(title, titles.length);
        if (round2(title.amount - title.paidAmount) <= 0) {
          await settleTitle(tx, ctx, order, title, titles.length, accountId, paidOn);
          settled.add(title.id);
          notes.push(`${name}: 0.00 em ${paidOn}`);
          continue;
        }
        const values = paymentValues(title, titles.length, item);
        const status = await recordPayment(tx, ctx, order, title, titles.length, {
          ...values,
          accountId,
          paidOn,
          method: data.method,
          notes: data.notes,
        });
        if (status === 'settled') settled.add(title.id);
        const extras = [
          values.interest ? `juros ${values.interest.toFixed(2)}` : '',
          values.discount ? `desconto ${values.discount.toFixed(2)}` : '',
          status === 'open'
            ? `saldo ${round2(title.amount - title.paidAmount - values.principal).toFixed(2)}`
            : '',
        ].filter(Boolean);
        notes.push(
          `${name}: ${values.received.toFixed(2)} em ${paidOn}${extras.length ? ` (${extras.join(', ')})` : ''}`,
        );
      }

      const changes = diffFields(
        { receivable: null, bankAccount: null },
        { receivable: notes.join('; '), bankAccount: await accountName(tx, accountId) },
      );
      if (settled.size === titles.length) {
        await markOrderPaid(tx, ctx, order, [
          ...diffFields({ status: 'pending' }, { status: 'paid' }),
          ...changes,
        ]);
      } else {
        await audit(tx, ctx, 'update', 'order', order.id, { number: order.number, changes });
      }
    }
  });
  return { settled: data.items.length };
}

// Baixa de uma conta, pelo saldo total.
export async function settleReceivable(ctx: Ctx, id: number, input?: ReceivableSettleInput) {
  const data = parse(receivableSettleSchema, input ?? {});
  await settleReceivables(ctx, { ...data, items: [{ receivableId: id }] });
  const [row] = await db
    .select({ status: receivables.status, paidAmount: receivables.paidAmount, orderId: receivables.orderId })
    .from(receivables)
    .where(and(eq(receivables.id, id), eq(receivables.companyId, ctx.companyId)));
  return row;
}

// Cancelar, voltar para pendente ou excluir um pedido com baixa, depois de confirmar a senha.
export async function undoOrderPayments(ctx: Ctx, id: number, input: unknown) {
  authorize(ctx, 'receivables.reverse');
  const { action, password, reason } = parse(orderUndoPaymentsSchema, input);
  await confirmPassword(ctx, password);
  if (action === 'delete') {
    await deleteOrder(ctx, id, { reason });
    return { deleted: true };
  }
  return updateOrder(ctx, id, { status: action === 'cancel' ? 'cancelled' : 'pending', reason }, true);
}

// Estorno: reabre o saldo da conta e tira a entrada do caixa. A baixa continua registrada, com o motivo.
// Pedido já recebido volta para pendente.
export async function reversePayment(ctx: Ctx, id: number, input: unknown) {
  authorize(ctx, 'receivables.reverse');
  const { password, reason } = parse(passwordConfirmationSchema, input);
  await confirmPassword(ctx, password);
  const companyPayment = and(eq(receivablePayments.id, id), eq(receivablePayments.companyId, ctx.companyId));

  const orderId = await db.transaction(async (tx) => {
    const [found] = await tx
      .select({ orderId: receivablePayments.orderId })
      .from(receivablePayments)
      .where(companyPayment);
    if (!found) throw notFound('Baixa não encontrada.');
    const [order] = await tx.select().from(orders).where(eq(orders.id, found.orderId)).for('update');
    if (!order) throw notFound('Pedido não encontrado.');
    const titles = await tx
      .select()
      .from(receivables)
      .where(eq(receivables.orderId, order.id))
      .orderBy(asc(receivables.position))
      .for('update');
    const [payment] = await tx.select().from(receivablePayments).where(companyPayment).for('update');
    const title = titles.find((item) => item.id === payment?.receivableId);
    if (!payment || !title) throw notFound('Baixa não encontrada.');
    if (payment.reversedAt) throw conflict('Esta baixa já foi estornada.');

    await tx.delete(cashTransactions).where(eq(cashTransactions.paymentId, id));
    await tx
      .update(receivablePayments)
      .set({ reversedAt: new Date(), reversedBy: ctx.userId, reversalReason: reason })
      .where(eq(receivablePayments.id, id));
    await tx
      .update(receivables)
      .set({ status: 'open', paidAmount: round2(title.paidAmount - payment.principal) })
      .where(eq(receivables.id, title.id));

    const changes = diffFields(
      { reversal: null },
      {
        reversal: `${titleLabel(title, titles.length)}: ${payment.received.toFixed(2)} de ${payment.paidOn}`,
      },
    );
    if (isReceived(order.status)) {
      await tx.update(orders).set({ status: 'pending' }).where(eq(orders.id, order.id));
      await audit(
        tx,
        ctx,
        'status',
        'order',
        order.id,
        {
          number: order.number,
          from: order.status,
          to: 'pending',
          via: 'reversal',
          changes: [...diffFields({ status: order.status }, { status: 'pending' }), ...changes],
        },
        reason,
      );
    } else {
      await audit(tx, ctx, 'update', 'order', order.id, { number: order.number, changes }, reason);
    }
    if (order.opportunityId) {
      await recordDocumentEvent(
        tx,
        ctx,
        order.opportunityId,
        `Baixa do pedido ${formatCode(order.number)} estornada: ${reason}`,
      );
    }
    return order.id;
  });

  const [row] = await loadOrders(ctx, and(eq(orders.id, orderId), eq(orders.companyId, ctx.companyId)));
  return row;
}
