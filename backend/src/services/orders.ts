import { can, type Permission } from '@arandue/shared/permissions';
import {
  type OrderCreateInput,
  type OrderStatus,
  type OrderUpdateInput,
  orderCreateSchema,
  orderUpdateSchema,
  type ReceivableSettleInput,
  receivableSettleSchema,
} from '@arandue/shared/schemas';
import { and, asc, desc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { db, type Transaction } from '../db/client.ts';
import {
  bankAccounts,
  cashTransactions,
  opportunities,
  orderItems,
  orders,
  people,
  products,
  receivables,
} from '../db/schema.ts';
import { diffFields, diffItems, type FieldChange, initialFields, removedFields } from '../lib/changes.ts';
import { authorize, authorizeAny, type Ctx, ownScope } from '../lib/context.ts';
import { badRequest, conflict, notFound } from '../lib/errors.ts';
import { round2 } from '../lib/money.ts';
import { parse } from '../lib/validate.ts';
import { accountName, audit, namedLines, personName } from './audit.ts';
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
const todayInBrazil = () =>
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

// Baixa de uma conta: valor pago e, se houver valor, uma entrada no caixa com a data informada.
async function settleTitle(
  tx: Transaction,
  ctx: Ctx,
  order: Order,
  title: typeof receivables.$inferSelect,
  titleCount: number,
  accountId: number | null,
  settledOn: string,
) {
  await tx
    .update(receivables)
    .set({ status: 'settled', paidAmount: title.amount })
    .where(eq(receivables.id, title.id));
  if (title.amount <= 0) return;
  if (!accountId) throw badRequest('Cadastre uma conta bancária para registrar o recebimento.');
  const part = titleCount > 1 ? ` (parcela ${title.position}/${titleCount})` : '';
  await tx.insert(cashTransactions).values({
    companyId: ctx.companyId,
    type: 'income',
    category: 'Vendas',
    orderId: order.id,
    receivableId: title.id,
    bankAccountId: accountId,
    amount: title.amount,
    transactionDate: settledOn,
    description: `Recebimento do pedido ${formatCode(order.number)}${part}`,
  });
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
async function syncReceivables(
  tx: Transaction,
  ctx: Ctx,
  order: Order,
  options: { previous?: Order; accountId?: number | null; settledOn?: string } = {},
) {
  const { previous, accountId: requested, settledOn = order.orderDate } = options;
  const whereOrder = eq(receivables.orderId, order.id);
  const cashOfOrder = eq(cashTransactions.orderId, order.id);

  if (order.status === 'cancelled') {
    await tx.delete(cashTransactions).where(cashOfOrder);
    await tx.update(receivables).set({ status: 'cancelled', paidAmount: 0 }).where(whereOrder);
    return;
  }
  const reopen =
    previous &&
    (previous.status === 'cancelled' || (isReceived(previous.status) && !isReceived(order.status)));
  if (reopen) {
    await tx.delete(cashTransactions).where(cashOfOrder);
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
    await tx
      .update(receivables)
      .set({ amount: order.total, paidAmount: only.status === 'settled' ? order.total : 0 })
      .where(eq(receivables.id, only.id));
    if (only.status === 'settled') {
      if (order.total > 0) {
        await tx
          .update(cashTransactions)
          .set({ amount: order.total })
          .where(eq(cashTransactions.receivableId, only.id));
      } else {
        await tx.delete(cashTransactions).where(eq(cashTransactions.receivableId, only.id));
      }
    }
    titles = [{ ...only, amount: order.total }];
  }

  if (previous && previous.orderDate !== order.orderDate) {
    // Só acompanha a venda a entrada lançada na própria data da venda.
    await tx
      .update(cashTransactions)
      .set({ transactionDate: order.orderDate })
      .where(and(cashOfOrder, eq(cashTransactions.transactionDate, previous.orderDate)));
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
  }
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

  const byOrder = Map.groupBy(items, (item) => item.orderId);
  // O título da oportunidade só aparece para quem pode ver o CRM.
  const showOpportunity = can(ctx.permissions, 'opportunities.read');
  return rows.map((row) => ({
    ...row,
    opportunityTitle: showOpportunity ? row.opportunityTitle : null,
    items: byOrder.get(row.id) ?? [],
    receivables: titlesByOrder.get(row.id) ?? [],
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

export async function updateOrder(ctx: Ctx, id: number, input: OrderUpdateInput) {
  authorizeAny(ctx, ['orders.update', 'orders.cancel', 'receivables.settle']);
  const data = parse(orderUpdateSchema, input);

  await db.transaction(async (tx) => {
    const [previous] = await tx.select().from(orders).where(scoped(ctx, id)).for('update');
    if (!previous) throw notFound('Pedido não encontrado.');
    for (const permission of permissionsForUpdate(previous, data)) authorize(ctx, permission);
    if (data.status === 'cancelled' && previous.status !== 'cancelled' && !data.reason) {
      throw badRequest('Informe o motivo do cancelamento.');
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

    await syncReceivables(tx, ctx, order, { previous, accountId: data.bankAccountId });
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
export async function deleteOrder(ctx: Ctx, id: number) {
  authorize(ctx, 'orders.delete');
  await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(scoped(ctx, id)).for('update');
    if (!order) throw notFound('Pedido não encontrado.');
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
    await audit(tx, ctx, 'delete', 'order', id, {
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
    });
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

// Baixa de uma conta. Trava o pedido primeiro, na mesma ordem das demais operações.
export async function settleReceivable(ctx: Ctx, id: number, input?: ReceivableSettleInput) {
  authorize(ctx, 'receivables.settle');
  const data = parse(receivableSettleSchema, input ?? {});
  const companyTitle = and(eq(receivables.id, id), eq(receivables.companyId, ctx.companyId));

  await db.transaction(async (tx) => {
    const [found] = await tx.select({ orderId: receivables.orderId }).from(receivables).where(companyTitle);
    if (!found) throw notFound('Conta a receber não encontrada.');
    const [order] = await tx.select().from(orders).where(eq(orders.id, found.orderId)).for('update');
    if (!order) throw notFound('Pedido não encontrado.');
    const titles = await tx
      .select()
      .from(receivables)
      .where(eq(receivables.orderId, order.id))
      .orderBy(asc(receivables.position))
      .for('update');
    const title = titles.find((item) => item.id === id);
    if (!title) throw notFound('Conta a receber não encontrada.');
    if (order.status !== 'pending' || title.status !== 'open') {
      throw conflict('Só contas em aberto de pedidos pendentes podem receber baixa.');
    }

    const accountId = await resolveAccount(tx, ctx, order.id, data.bankAccountId);
    const settledOn = data.settledOn ?? todayInBrazil();
    await settleTitle(tx, ctx, order, title, titles.length, accountId, settledOn);
    const changes = diffFields(
      { receivable: null, bankAccount: null },
      {
        receivable: `Parcela ${title.position}/${titles.length}: ${title.amount.toFixed(2)} em ${settledOn}`,
        bankAccount: await accountName(tx, accountId),
      },
    );
    if (titles.every((item) => item.id === id || item.status === 'settled')) {
      await markOrderPaid(tx, ctx, order, [
        ...diffFields({ status: 'pending' }, { status: 'paid' }),
        ...changes,
      ]);
    } else {
      await audit(tx, ctx, 'update', 'order', order.id, { number: order.number, changes });
    }
  });

  const [row] = await db
    .select({ status: receivables.status, paidAmount: receivables.paidAmount, orderId: receivables.orderId })
    .from(receivables)
    .where(companyTitle);
  return row;
}
