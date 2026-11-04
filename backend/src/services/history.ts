import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { auditLogs, orders, quotes } from '../db/schema.ts';
import type { FieldChange, ItemChange } from '../lib/changes.ts';
import { authorize, type Ctx } from '../lib/context.ts';
import { notFound } from '../lib/errors.ts';
import { formatCode } from './numbering.ts';

// Leitura do histórico de orçamentos e pedidos. Quem pode ver o documento vê o histórico dele,
// respeitando o escopo "só os próprios".
type DocType = 'quote' | 'order';
type AuditRow = typeof auditLogs.$inferSelect;
type AuditData = {
  changes?: FieldChange[];
  items?: ItemChange[];
  from?: string;
  to?: string;
  via?: string;
  number?: number;
  createdBy?: number | null;
  orderNumber?: number;
  originKind?: string | null;
  quoteId?: number | null;
  opportunity?: unknown;
};

const NOUN: Record<DocType, string> = { quote: 'o orçamento', order: 'o pedido' };
const READ = { quote: 'quotes.read', order: 'orders.read' } as const;
const isDocType = (entity: string): entity is DocType => entity === 'quote' || entity === 'order';

const FIELDS: Record<string, { label: string; kind: 'text' | 'money' | 'date' | 'status' }> = {
  customer: { label: 'Cliente', kind: 'text' },
  validUntil: { label: 'Validade', kind: 'date' },
  orderDate: { label: 'Data da venda', kind: 'date' },
  discount: { label: 'Desconto', kind: 'money' },
  total: { label: 'Total', kind: 'money' },
  notes: { label: 'Observações', kind: 'text' },
  status: { label: 'Status', kind: 'status' },
  bankAccount: { label: 'Conta de recebimento', kind: 'text' },
};

const QUOTE_STATUS_SUMMARY: Record<string, string> = {
  sent: 'Enviou ao cliente',
  approved: 'Aprovou',
  rejected: 'Recusou',
  cancelled: 'Cancelou',
};

function orderStatusSummary({ from, to, via }: AuditData) {
  if (via === 'receivables') return 'Deu baixa no recebimento';
  if (to === 'paid') return 'Marcou como pago';
  if (to === 'completed') return 'Concluiu';
  if (to === 'cancelled') return 'Cancelou';
  return from === 'cancelled' ? 'Reativou' : 'Voltou para pendente';
}

const listFormat = new Intl.ListFormat('pt-BR');

function updateSummary(data: AuditData) {
  if (data.opportunity !== undefined) return 'Alterou o vínculo com a oportunidade';
  // O total é consequência das outras mudanças: só aparece se for a única.
  const fields = (data.changes ?? []).map((change) => change.field);
  const main = fields.filter((field) => field !== 'total');
  const names = (main.length ? main : fields).map((field) => FIELDS[field]?.label.toLowerCase() ?? field);
  if (data.items?.length) names.push('itens');
  return names.length ? `Alterou ${listFormat.format(names)}` : 'Alterou o documento';
}

function createSummary(type: DocType, data: AuditData) {
  if (data.originKind === 'duplicated') return `Duplicou ${NOUN[type]}`;
  if (data.originKind === 'copied') return `Criou ${NOUN[type]} por cópia`;
  if (data.originKind === 'converted' || data.quoteId) return 'Criou o pedido a partir do orçamento';
  return `Criou ${NOUN[type]}`;
}

function summarize(row: AuditRow, type: DocType, data: AuditData) {
  switch (row.action) {
    case 'create':
      return createSummary(type, data);
    case 'update':
      return updateSummary(data);
    case 'status':
      return type === 'quote'
        ? (QUOTE_STATUS_SUMMARY[data.to ?? ''] ?? 'Alterou o status')
        : orderStatusSummary(data);
    case 'convert':
      return data.orderNumber ? `Converteu no pedido ${formatCode(data.orderNumber)}` : 'Converteu em pedido';
    case 'delete':
      return `Excluiu ${NOUN[type]}`;
    default:
      return 'Alterou o documento';
  }
}

const summaryOf = (row: AuditRow, type: DocType) => ({
  id: row.id,
  // Registros antigos podem não ter o nome, e o usuário pode ter sido removido.
  actorName: row.actorName ?? 'Usuário não identificado',
  summary: summarize(row, type, (row.data ?? {}) as AuditData),
  reason: row.reason,
  createdAt: row.createdAt,
});

const ofDocument = (ctx: Ctx, type: DocType, id: number) =>
  and(eq(auditLogs.companyId, ctx.companyId), eq(auditLogs.entity, type), eq(auditLogs.entityId, id));

// Confere se quem consulta alcança o documento. Excluído, ele continua consultável pelo registro da
// exclusão, que guarda o número e quem o criou. Devolve null se não existe ou está fora do escopo.
async function reachDocument(ctx: Ctx, type: DocType, id: number) {
  const table = type === 'quote' ? quotes : orders;
  const [row] = await db
    .select({ number: table.number, createdBy: table.createdBy })
    .from(table)
    .where(and(eq(table.id, id), eq(table.companyId, ctx.companyId)));

  let document: { exists: boolean; number: number | null; createdBy: number | null | undefined } | null = row
    ? { ...row, exists: true }
    : null;
  if (!document) {
    const [deletion] = await db
      .select({ data: auditLogs.data })
      .from(auditLogs)
      .where(and(ofDocument(ctx, type, id), eq(auditLogs.action, 'delete')));
    if (!deletion) return null;
    const data = (deletion.data ?? {}) as AuditData;
    document = { exists: false, number: data.number ?? null, createdBy: data.createdBy };
  }
  return !ctx.ownOnly || document.createdBy === ctx.userId ? document : null;
}

export async function listDocumentHistory(ctx: Ctx, type: DocType, id: number) {
  authorize(ctx, READ[type]);
  if (!(await reachDocument(ctx, type, id))) throw notFound('Documento não encontrado.');

  const rows = await db
    .select()
    .from(auditLogs)
    .where(ofDocument(ctx, type, id))
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(200);
  return rows.map((row) => summaryOf(row, type));
}

export async function getHistoryEntry(ctx: Ctx, entryId: number) {
  const [row] = await db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.id, entryId), eq(auditLogs.companyId, ctx.companyId)));
  if (!row || !isDocType(row.entity) || row.entityId === null) throw notFound('Registro não encontrado.');
  const type = row.entity;
  authorize(ctx, READ[type]);

  const document = await reachDocument(ctx, type, row.entityId);
  if (!document) throw notFound('Registro não encontrado.');

  const data = (row.data ?? {}) as AuditData;

  // Registros anteriores ao detalhamento guardam só de onde e para onde o status foi.
  const changes =
    data.changes ??
    (row.action === 'status' && data.from && data.to
      ? [{ field: 'status', from: data.from, to: data.to }]
      : []);

  return {
    ...summaryOf(row, type),
    type,
    documentId: row.entityId,
    documentNumber: document.number ?? data.number ?? null,
    documentExists: document.exists,
    changes: changes.map((change) => ({
      ...change,
      label: FIELDS[change.field]?.label ?? change.field,
      kind: FIELDS[change.field]?.kind ?? 'text',
    })),
    items: data.items ?? [],
  };
}
