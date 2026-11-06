import { ACTION_LABELS, AREAS, type Area, can, type Permission } from '@arandue/shared/permissions';
import { type HistoryFilterInput, historyFilterSchema } from '@arandue/shared/schemas';
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { auditLogs, orders, quotes, users } from '../db/schema.ts';
import type { FieldChange, ItemChange } from '../lib/changes.ts';
import { authorize, type Ctx } from '../lib/context.ts';
import { notFound } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import { formatCode } from './numbering.ts';

// Leitura do histórico. Em orçamentos e pedidos, quem pode ver o documento vê o histórico dele,
// respeitando o escopo "só os próprios". A tela geral e os demais módulos exigem audit.read.
type DocType = 'quote' | 'order';
type AuditRow = typeof auditLogs.$inferSelect;
type AuditData = {
  changes?: FieldChange[];
  items?: ItemChange[];
  from?: string | number;
  to?: string | number;
  via?: string;
  number?: number;
  label?: string;
  createdBy?: number | null;
  opportunityId?: number;
  orderNumber?: number;
  originKind?: string | null;
  quoteId?: number | null;
  opportunity?: unknown;
  order?: unknown;
};

const READ = { quote: 'quotes.read', order: 'orders.read' } as const;
const isDocType = (entity: string): entity is DocType => entity === 'quote' || entity === 'order';

interface EntityInfo {
  noun: string;
  module: string;
  // Onde abrir o registro. Sem id: a lista do módulo, que não tem tela própria por registro.
  path: (id: number | null, data: AuditData) => string | null;
  open: string;
}

const listPath = (path: string) => () => path;

const ENTITIES: Record<string, EntityInfo> = {
  quote: {
    noun: 'o orçamento',
    module: 'Orçamentos',
    path: (id) => `/orcamentos/${id}`,
    open: 'Abrir orçamento',
  },
  order: { noun: 'o pedido', module: 'Pedidos', path: (id) => `/pedidos/${id}`, open: 'Abrir pedido' },
  opportunity: {
    noun: 'a oportunidade',
    module: 'CRM',
    path: (id) => `/crm/${id}`,
    open: 'Abrir oportunidade',
  },
  interaction: {
    noun: 'a atividade',
    module: 'CRM',
    path: (_id, data) => (data.opportunityId ? `/crm/${data.opportunityId}` : null),
    open: 'Abrir oportunidade',
  },
  pipeline_stage: {
    noun: 'a etapa do funil',
    module: 'CRM',
    path: listPath('/crm'),
    open: 'Abrir CRM',
  },
  person: { noun: 'o cadastro', module: 'Pessoas', path: (id) => `/pessoas/${id}`, open: 'Abrir cadastro' },
  product: {
    noun: 'o produto',
    module: 'Produtos e serviços',
    path: listPath('/produtos'),
    open: 'Abrir produtos e serviços',
  },
  expense: {
    noun: 'a despesa',
    module: 'Contas a pagar',
    path: listPath('/despesas'),
    open: 'Abrir contas a pagar',
  },
  cash_transaction: {
    noun: 'a movimentação',
    module: 'Movimentações',
    path: listPath('/movimentacoes'),
    open: 'Abrir movimentações',
  },
  bank_account: {
    noun: 'a conta bancária',
    module: 'Contas bancárias',
    path: listPath('/contas'),
    open: 'Abrir contas bancárias',
  },
  user: { noun: 'o usuário', module: 'Usuários', path: listPath('/usuarios'), open: 'Abrir usuários' },
  access_group: {
    noun: 'o grupo de acesso',
    module: 'Grupos de acesso',
    path: listPath('/grupos'),
    open: 'Abrir grupos de acesso',
  },
  company: {
    noun: 'a empresa',
    module: 'Configurações',
    path: listPath('/configuracoes'),
    open: 'Abrir configurações',
  },
};

const FALLBACK: EntityInfo = { noun: 'o registro', module: 'Outros', path: () => null, open: 'Abrir' };
const infoOf = (entity: string) => ENTITIES[entity] ?? FALLBACK;

type FieldKind = 'text' | 'money' | 'date' | 'status' | 'number' | 'boolean';

const FIELDS: Record<string, { label: string; kind: FieldKind }> = {
  customer: { label: 'Cliente', kind: 'text' },
  validUntil: { label: 'Validade', kind: 'date' },
  orderDate: { label: 'Data da venda', kind: 'date' },
  discount: { label: 'Desconto', kind: 'money' },
  freight: { label: 'Frete', kind: 'money' },
  otherCharges: { label: 'Outras despesas', kind: 'money' },
  total: { label: 'Total', kind: 'money' },
  notes: { label: 'Observações', kind: 'text' },
  internalNotes: { label: 'Observação interna', kind: 'text' },
  siteDescription: { label: 'Local de entrega ou serviço', kind: 'text' },
  siteContact: { label: 'Contato no local', kind: 'text' },
  siteAddress: { label: 'Endereço do local', kind: 'text' },
  installments: { label: 'Parcelas', kind: 'text' },
  composition: { label: 'Grupos e medidas', kind: 'text' },
  // Empresa.
  address: { label: 'Endereço', kind: 'text' },
  logo: { label: 'Logo', kind: 'text' },
  quoteTerms: { label: 'Condições do orçamento', kind: 'text' },
  useMeasures: { label: 'Usar medidas nos orçamentos', kind: 'boolean' },
  measureUnit: { label: 'Unidade das medidas', kind: 'text' },
  status: { label: 'Status', kind: 'status' },
  bankAccount: { label: 'Conta', kind: 'text' },
  receivable: { label: 'Baixa de parcela', kind: 'text' },
  reversal: { label: 'Estorno de baixa', kind: 'text' },
  supplier: { label: 'Fornecedor', kind: 'text' },
  // Produtos.
  name: { label: 'Nome', kind: 'text' },
  type: { label: 'Tipo', kind: 'status' },
  price: { label: 'Preço', kind: 'money' },
  cost: { label: 'Custo', kind: 'money' },
  stock: { label: 'Estoque', kind: 'number' },
  active: { label: 'Ativo', kind: 'boolean' },
  // Financeiro.
  description: { label: 'Descrição', kind: 'text' },
  category: { label: 'Categoria', kind: 'text' },
  amount: { label: 'Valor', kind: 'money' },
  expenseDate: { label: 'Data', kind: 'date' },
  transactionDate: { label: 'Data', kind: 'date' },
  bankName: { label: 'Banco', kind: 'text' },
  accountName: { label: 'Nome da conta', kind: 'text' },
  accountType: { label: 'Tipo de conta', kind: 'status' },
  initialBalance: { label: 'Saldo inicial', kind: 'money' },
  // Pessoas.
  kind: { label: 'Tipo', kind: 'status' },
  document: { label: 'CPF/CNPJ', kind: 'text' },
  legalName: { label: 'Razão social', kind: 'text' },
  roles: { label: 'Papéis', kind: 'text' },
  isCustomer: { label: 'Cliente', kind: 'boolean' },
  email: { label: 'E-mail', kind: 'text' },
  phone: { label: 'Telefone', kind: 'text' },
  mobile: { label: 'Celular', kind: 'text' },
  stateRegistration: { label: 'Inscrição estadual', kind: 'text' },
  taxpayer: { label: 'Contribuinte', kind: 'status' },
  finalConsumer: { label: 'Consumidor final', kind: 'boolean' },
  taxRegime: { label: 'Regime tributário', kind: 'status' },
  zip: { label: 'CEP', kind: 'text' },
  street: { label: 'Endereço', kind: 'text' },
  number: { label: 'Número', kind: 'text' },
  complement: { label: 'Complemento', kind: 'text' },
  district: { label: 'Bairro', kind: 'text' },
  city: { label: 'Cidade', kind: 'text' },
  state: { label: 'UF', kind: 'text' },
  country: { label: 'País', kind: 'text' },
  paymentMethod: { label: 'Forma de pagamento', kind: 'text' },
  paymentTerms: { label: 'Condição de pagamento', kind: 'text' },
  freightType: { label: 'Frete', kind: 'status' },
  carrier: { label: 'Transportadora', kind: 'text' },
  region: { label: 'Região', kind: 'text' },
  seller: { label: 'Vendedor da carteira', kind: 'text' },
  creditLimit: { label: 'Limite de crédito', kind: 'money' },
  contacts: { label: 'Contatos', kind: 'text' },
  addresses: { label: 'Endereços adicionais', kind: 'text' },
  // Oportunidades.
  title: { label: 'Título', kind: 'text' },
  contactName: { label: 'Nome do contato', kind: 'text' },
  contactPhone: { label: 'Telefone do contato', kind: 'text' },
  contactEmail: { label: 'E-mail do contato', kind: 'text' },
  source: { label: 'Origem', kind: 'text' },
  stage: { label: 'Etapa', kind: 'text' },
  estimatedValue: { label: 'Valor estimado', kind: 'money' },
  expectedCloseDate: { label: 'Previsão de fechamento', kind: 'date' },
  owner: { label: 'Responsável', kind: 'text' },
  nextAction: { label: 'Próxima ação', kind: 'text' },
  nextActionAt: { label: 'Data da próxima ação', kind: 'date' },
  channel: { label: 'Canal', kind: 'status' },
  color: { label: 'Cor', kind: 'text' },
  milestone: { label: 'Marco', kind: 'status' },
  order: { label: 'Ordem das etapas', kind: 'text' },
  // Usuários, grupos e empresa.
  group: { label: 'Grupo de acesso', kind: 'text' },
  password: { label: 'Senha', kind: 'text' },
  ownOnly: { label: 'Só os próprios registros', kind: 'boolean' },
  permissionsAdded: { label: 'Permissões concedidas', kind: 'text' },
  permissionsRemoved: { label: 'Permissões retiradas', kind: 'text' },
  cnpj: { label: 'CNPJ', kind: 'text' },
  meiAnnualLimit: { label: 'Limite anual do MEI', kind: 'money' },
};

// Nome legível de uma permissão, como aparece na matriz dos grupos.
export function permissionName(permission: Permission) {
  const [area, action] = permission.split('.') as [Area, keyof typeof ACTION_LABELS];
  return `${AREAS[area].label}: ${ACTION_LABELS[action]}`;
}

const QUOTE_STATUS_SUMMARY: Record<string, string> = {
  sent: 'Enviou ao cliente',
  approved: 'Aprovou',
  rejected: 'Recusou',
  cancelled: 'Cancelou',
  draft: 'Reabriu para alterar',
};

const OPPORTUNITY_STATUS_SUMMARY: Record<string, string> = {
  won: 'Marcou como ganha',
  lost: 'Marcou como perdida',
  open: 'Reabriu',
};

function orderStatusSummary({ from, to, via }: AuditData) {
  if (via === 'receivables') return 'Deu baixa no recebimento';
  if (via === 'reversal') return 'Estornou a baixa';
  if (to === 'paid') return 'Marcou como pago';
  if (to === 'completed') return 'Concluiu';
  if (to === 'cancelled') return 'Cancelou';
  return from === 'cancelled' ? 'Reativou' : 'Voltou para pendente';
}

function statusSummary(entity: string, data: AuditData) {
  const to = String(data.to ?? '');
  if (entity === 'quote') return QUOTE_STATUS_SUMMARY[to] ?? 'Alterou o status';
  if (entity === 'order') return orderStatusSummary(data);
  if (entity === 'opportunity') {
    if (data.changes?.some((change) => change.field === 'stage') || typeof data.to === 'number') {
      return 'Mudou a etapa';
    }
    return OPPORTUNITY_STATUS_SUMMARY[to] ?? 'Alterou o status';
  }
  return 'Alterou o status';
}

const listFormat = new Intl.ListFormat('pt-BR');

function updateSummary(data: AuditData) {
  if (data.opportunity !== undefined) return 'Alterou o vínculo com a oportunidade';
  // O total é consequência das outras mudanças: só aparece se for a única.
  const fields = (data.changes ?? []).map((change) => change.field);
  if (fields.includes('reversal')) return 'Estornou a baixa';
  const main = fields.filter((field) => field !== 'total');
  const names = (main.length ? main : fields).map((field) => FIELDS[field]?.label.toLowerCase() ?? field);
  if (data.items?.length) names.push('itens');
  if (!names.length) return 'Alterou o registro';
  // Cadastro grande: a lista completa fica no detalhe.
  if (names.length > 4) return `Alterou ${names.slice(0, 3).join(', ')} e mais ${names.length - 3} campos`;
  return `Alterou ${listFormat.format(names)}`;
}

function createSummary(entity: string, data: AuditData) {
  const noun = infoOf(entity).noun;
  if (data.originKind === 'duplicated') return `Duplicou ${noun}`;
  if (data.originKind === 'copied') return `Criou ${noun} por cópia`;
  if (entity === 'order' && (data.originKind === 'converted' || data.quoteId)) {
    return 'Criou o pedido a partir do orçamento';
  }
  return `Criou ${noun}`;
}

function summarize(row: AuditRow, data: AuditData) {
  switch (row.action) {
    case 'create':
      return createSummary(row.entity, data);
    case 'update':
      return updateSummary(data);
    case 'status':
      return statusSummary(row.entity, data);
    case 'convert':
      return data.orderNumber ? `Converteu no pedido ${formatCode(data.orderNumber)}` : 'Converteu em pedido';
    case 'archive':
      return `Arquivou ${infoOf(row.entity).noun}`;
    case 'delete':
      return `Excluiu ${infoOf(row.entity).noun}`;
    case 'login':
      return 'Entrou no sistema';
    default:
      return 'Alterou o registro';
  }
}

function labelOf(row: AuditRow, data: AuditData) {
  if (row.entity === 'quote' && data.number) return `Orçamento ${formatCode(data.number)}`;
  if (row.entity === 'order' && data.number) return `Pedido ${formatCode(data.number)}`;
  if (data.label) return data.label;
  if (row.action === 'login') return null;
  return row.entityId ? `Registro ${row.entityId}` : null;
}

const summaryOf = (row: AuditRow) => {
  const data = (row.data ?? {}) as AuditData;
  return {
    id: row.id,
    // Registros antigos podem não ter o nome, e o usuário pode ter sido removido.
    actorName: row.actorName ?? 'Usuário não identificado',
    summary: summarize(row, data),
    reason: row.reason,
    createdAt: row.createdAt,
    module: infoOf(row.entity).module,
    label: labelOf(row, data),
  };
};

const ofRecord = (ctx: Ctx, entity: string, id: number) =>
  and(eq(auditLogs.companyId, ctx.companyId), eq(auditLogs.entity, entity), eq(auditLogs.entityId, id));

async function findDeletion(ctx: Ctx, entity: string, id: number) {
  const [deletion] = await db
    .select({ data: auditLogs.data })
    .from(auditLogs)
    .where(and(ofRecord(ctx, entity, id), eq(auditLogs.action, 'delete')));
  return deletion ? ((deletion.data ?? {}) as AuditData) : null;
}

// Confere se quem consulta alcança o documento. Excluído, ele continua consultável pelo registro da
// exclusão, que guarda o número e quem o criou. Devolve null se não existe ou está fora do escopo.
async function reachDocument(ctx: Ctx, type: DocType, id: number, ignoreScope = false) {
  const table = type === 'quote' ? quotes : orders;
  const [row] = await db
    .select({ number: table.number, createdBy: table.createdBy })
    .from(table)
    .where(and(eq(table.id, id), eq(table.companyId, ctx.companyId)));

  let document: { exists: boolean; number: number | null; createdBy: number | null | undefined } | null = row
    ? { ...row, exists: true }
    : null;
  if (!document) {
    const deletion = await findDeletion(ctx, type, id);
    if (!deletion) return null;
    document = { exists: false, number: deletion.number ?? null, createdBy: deletion.createdBy };
  }
  return ignoreScope || !ctx.ownOnly || document.createdBy === ctx.userId ? document : null;
}

export async function listDocumentHistory(ctx: Ctx, type: DocType, id: number) {
  authorize(ctx, READ[type]);
  if (!(await reachDocument(ctx, type, id))) throw notFound('Documento não encontrado.');

  const rows = await db
    .select()
    .from(auditLogs)
    .where(ofRecord(ctx, type, id))
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(200);
  return rows.map(summaryOf);
}

export async function getHistoryEntry(ctx: Ctx, entryId: number) {
  const [row] = await db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.id, entryId), eq(auditLogs.companyId, ctx.companyId)));
  if (!row) throw notFound('Registro não encontrado.');

  const data = (row.data ?? {}) as AuditData;
  const canAudit = can(ctx.permissions, 'audit.read');
  let exists = true;
  let number: number | null = data.number ?? null;

  if (isDocType(row.entity) && row.entityId !== null) {
    if (!canAudit) authorize(ctx, READ[row.entity]);
    const document = await reachDocument(ctx, row.entity, row.entityId, canAudit);
    if (!document) throw notFound('Registro não encontrado.');
    exists = document.exists;
    number = document.number ?? number;
  } else {
    authorize(ctx, 'audit.read');
    if (row.entityId !== null) exists = !(await findDeletion(ctx, row.entity, row.entityId));
  }

  // Registros anteriores ao detalhamento guardam só de onde e para onde o status foi.
  const changes =
    data.changes ??
    (row.action === 'status' && typeof data.from === 'string' && typeof data.to === 'string'
      ? [{ field: 'status', from: data.from, to: data.to }]
      : []);

  const info = infoOf(row.entity);
  const list = summaryOf(row);
  return {
    ...list,
    label: labelOf(row, { ...data, number: number ?? undefined }),
    type: row.entity,
    documentId: row.entityId,
    documentNumber: number,
    documentExists: exists,
    path: exists ? info.path(row.entityId, data) : null,
    openLabel: info.open,
    changes: changes
      .filter((change) => change.field !== 'cost' || can(ctx.permissions, 'costs.read'))
      .map((change) => ({
        ...change,
        label: FIELDS[change.field]?.label ?? change.field,
        kind: FIELDS[change.field]?.kind ?? 'text',
      })),
    items: data.items ?? [],
  };
}

const PAGE_SIZE = 50;

// Tela geral de auditoria: todos os módulos, com filtros e paginação.
export async function listHistory(ctx: Ctx, input: HistoryFilterInput) {
  authorize(ctx, 'audit.read');
  const filter = parse(historyFilterSchema, input);
  const entities = filter.module
    ? Object.entries(ENTITIES)
        .filter(([, info]) => info.module === filter.module)
        .map(([entity]) => entity)
    : null;
  const where = and(
    eq(auditLogs.companyId, ctx.companyId),
    filter.userId ? eq(auditLogs.userId, filter.userId) : undefined,
    filter.action ? eq(auditLogs.action, filter.action) : undefined,
    entities
      ? sql`${auditLogs.entity} IN (${sql.join(
          entities.map((entity) => sql`${entity}`),
          sql`, `,
        )})`
      : undefined,
    filter.from ? gte(auditLogs.createdAt, filter.from) : undefined,
    filter.to ? lte(auditLogs.createdAt, filter.to) : undefined,
  );
  const [{ total } = { total: 0 }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(where);
  const rows = await db
    .select()
    .from(auditLogs)
    .where(where)
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(PAGE_SIZE)
    .offset((filter.page - 1) * PAGE_SIZE);
  return { rows: rows.map(summaryOf), total, page: filter.page, pageSize: PAGE_SIZE };
}

// Opções dos filtros: todos os usuários da empresa, inclusive desativados, e os módulos.
export async function historyFilterOptions(ctx: Ctx) {
  authorize(ctx, 'audit.read');
  const actors = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.companyId, ctx.companyId))
    .orderBy(asc(users.name));
  return { actors, modules: [...new Set(Object.values(ENTITIES).map((info) => info.module))] };
}
