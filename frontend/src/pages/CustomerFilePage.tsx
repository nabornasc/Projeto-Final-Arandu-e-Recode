import { formatDocument } from '@arandue/shared/br';
import { ACTIVITY_KINDS, interactionSchema } from '@arandue/shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Link } from 'react-router';
import { EmptyState } from '../components/EmptyState.tsx';
import { useToast } from '../components/Toast.tsx';
import { api } from '../lib/api.ts';
import { can, useProfile } from '../lib/auth.ts';
import { formatCode, formatDate, formatDateTime, formatMoney, label } from '../lib/format.ts';
import { useTab, useTabTitle } from '../workspace/tab.ts';

interface CustomerOpportunity {
  id: number;
  title: string;
  status: string;
  stageName: string;
  estimatedValue: number | null;
  ownerName: string | null;
  nextAction: string | null;
  nextActionAt: string | null;
}
interface Activity {
  id: number;
  opportunityId: number;
  opportunityTitle: string;
  kind: string;
  channel: string;
  description: string;
  occurredAt: string;
  userName: string | null;
}
interface CustomerQuote {
  id: number;
  number: number;
  status: string;
  total: number;
  validUntil: string | null;
  createdAt: string;
  sellerName: string | null;
}
interface CustomerOrder {
  id: number;
  number: number;
  status: string;
  total: number;
  orderDate: string;
  sellerName: string | null;
  paidAmount: number;
}
interface Summary {
  months: { month: string; total: number }[];
  purchaseEveryDays: number | null;
  daysSinceLastSale: number | null;
  lastSale: { number: number; date: string; total: number } | null;
  products: {
    productId: number;
    name: string;
    quantity: number;
    total: number;
    lastSale: string;
    averagePrice: number;
  }[];
}
interface OpenTitle {
  id: number;
  orderId: number;
  number: number;
  position: number;
  titleCount: number;
  dueDate: string;
  amount: number;
  balance: number;
  overdue: boolean;
}
interface Finance {
  debt: number;
  overdue: number;
  toDue: number;
  creditLimit: number | null;
  creditAvailable: number | null;
  periodFrom: string;
  periodTo: string;
  paid: number;
  paidOnTime: number;
  paidLate: number;
  punctuality: number | null;
  averageDelayDays: number;
  longestDelayDays: number;
  usualMethod: { method: string; share: number } | null;
  openTitles: OpenTitle[];
}
interface CustomerFile {
  customer: {
    id: number;
    name: string;
    legalName: string | null;
    document: string | null;
    email: string | null;
    phone: string | null;
    mobile: string | null;
    city: string | null;
    state: string | null;
    sellerName: string | null;
    active: boolean;
  };
  opportunities: CustomerOpportunity[] | null;
  activities: Activity[] | null;
  quotes: CustomerQuote[] | null;
  orders: CustomerOrder[] | null;
  summary: Summary | null;
  finance: Finance | null;
}

const TABS = [
  ['history', 'Histórico'],
  ['summary', 'Resumo'],
  ['opportunities', 'Oportunidades'],
  ['quotes', 'Orçamentos'],
  ['orders', 'Pedidos'],
  ['finance', 'Financeiro'],
] as const;
type TabKey = (typeof TABS)[number][0];

const monthName = new Intl.DateTimeFormat('pt-BR', { month: 'short', year: 'numeric', timeZone: 'UTC' });

// Ficha do cliente: atendimentos e oportunidades do CRM, documentos e situação financeira em um lugar.
export default function CustomerFilePage() {
  const { params } = useTab();
  const id = Number(params.id);
  const file = useQuery({
    queryKey: ['/customers', id, 'file'],
    queryFn: () => api<CustomerFile>(`/customers/${id}/file`),
  });
  useTabTitle(file.data ? `Ficha: ${file.data.customer.name}` : null);

  if (file.isPending) return <div className="loading">Carregando ficha...</div>;
  if (file.isError) return <EmptyState text={file.error.message} />;
  return <CustomerFileView file={file.data} />;
}

function CustomerFileView({ file }: { file: CustomerFile }) {
  const { customer } = file;
  const available = TABS.filter(([key]) => {
    if (key === 'history' || key === 'opportunities') return file.opportunities !== null;
    if (key === 'summary') return file.summary !== null;
    return file[key] !== null;
  });
  const [chosen, setChosen] = useState<TabKey | null>(null);
  const active = chosen ?? available[0]?.[0] ?? null;
  const location = [customer.city, customer.state].filter(Boolean).join(' - ');

  return (
    <section className="document">
      <div className="section-heading page-heading">
        <div>
          <span className="welcome-label">FICHA DO CLIENTE</span>
          <h2>{customer.name}</h2>
          <p>
            {customer.legalName ?? 'Tudo o que aconteceu com este cliente.'}
            {!customer.active && ' · arquivado'}
          </p>
        </div>
        <div className="document-actions">
          <Link className="button secondary" to={`/pessoas/${customer.id}`}>
            Abrir cadastro
          </Link>
        </div>
      </div>

      <div className="customer-file">
        <div className="customer-file-main">
          <div className="section-tabs" role="tablist" aria-label="Seções da ficha">
            {available.map(([key, name]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active === key}
                className={active === key ? 'active' : undefined}
                onClick={() => setChosen(key)}
              >
                {name}
              </button>
            ))}
          </div>
          <div className="panel">
            {active === null && <EmptyState text="Seu grupo não tem acesso às informações deste cliente." />}
            {active === 'history' && <HistoryTab file={file} />}
            {active === 'summary' && file.summary && (
              <SummaryTab summary={file.summary} finance={file.finance} />
            )}
            {active === 'opportunities' && <OpportunitiesTab file={file} />}
            {active === 'quotes' && <QuotesTab file={file} />}
            {active === 'orders' && <OrdersTab file={file} />}
            {active === 'finance' && file.finance && <FinanceTab finance={file.finance} />}
          </div>
        </div>
        <aside className="panel customer-file-side" aria-label="Dados do cliente">
          <h3>Dados</h3>
          <Facts
            rows={[
              ['CPF ou CNPJ', customer.document ? formatDocument(customer.document) : '—'],
              ['E-mail', customer.email ?? '—'],
              ['Telefone', customer.mobile ?? customer.phone ?? '—'],
              ['Cidade', location || '—'],
              ['Vendedor', customer.sellerName ?? '—'],
            ]}
          />
        </aside>
      </div>
    </section>
  );
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="file-facts">
      {rows.map(([name, value]) => (
        <div key={name}>
          <dt>{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function TabHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="panel-heading file-heading">
      <h3>{title}</h3>
      {action}
    </div>
  );
}

function NewLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link className="button primary" to={to}>
      <Plus size={15} /> {children}
    </Link>
  );
}

function Status({ value }: { value: string }) {
  return <span className={`status ${value}`}>{label(value)}</span>;
}

// Os atendimentos ficam na oportunidade, então o registro aqui também aparece no CRM.
function HistoryTab({ file }: { file: CustomerFile }) {
  const profile = useProfile();
  const notify = useToast();
  const client = useQueryClient();
  const list = file.opportunities ?? [];
  const canAdd = can(profile, 'opportunities.update');
  const open = list.filter((item) => item.status === 'open');
  const [opportunityId, setOpportunityId] = useState('');
  const [kind, setKind] = useState<(typeof ACTIVITY_KINDS)[number]>('comment');
  const [description, setDescription] = useState('');
  const [showEvents, setShowEvents] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const target = opportunityId || String(open[0]?.id ?? list[0]?.id ?? '');
  const activities = (file.activities ?? []).filter((item) => showEvents || item.kind !== 'event');

  const add = useMutation({
    mutationFn: (body: unknown) => api(`/opportunities/${target}/interactions`, { method: 'POST', body }),
    onSuccess: () => {
      setDescription('');
      void client.invalidateQueries();
      notify('Atendimento registrado no CRM.');
    },
    onError: (err) => setError(err.message),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const body = { kind, description };
    const parsed = interactionSchema.safeParse(body);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Verifique os campos.');
    setError(null);
    add.mutate(body);
  }

  return (
    <>
      <TabHeader
        title="Histórico de atendimento"
        action={
          can(profile, 'opportunities.create') && (
            <NewLink to={`/crm/novo/cliente/${file.customer.id}`}>Nova oportunidade</NewLink>
          )
        }
      />
      {canAdd &&
        (list.length ? (
          <form className="interaction-form" onSubmit={submit} noValidate>
            <select
              name="opportunityId"
              aria-label="Oportunidade do atendimento"
              value={target}
              onChange={(event) => setOpportunityId(event.target.value)}
            >
              {list.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
            <select
              name="kind"
              aria-label="Tipo de atividade"
              value={kind}
              onChange={(event) => setKind(event.target.value as (typeof ACTIVITY_KINDS)[number])}
            >
              {ACTIVITY_KINDS.map((item) => (
                <option key={item} value={item}>
                  {label(item)}
                </option>
              ))}
            </select>
            <input
              name="description"
              aria-label="O que aconteceu"
              placeholder="O que aconteceu?"
              maxLength={2000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
            <button type="submit" className="button primary" disabled={add.isPending}>
              Registrar
            </button>
          </form>
        ) : (
          <p className="muted">
            Para registrar um atendimento, crie antes uma oportunidade para este cliente.
          </p>
        ))}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <label className="checkbox file-toggle">
        <input
          type="checkbox"
          checked={showEvents}
          onChange={(event) => setShowEvents(event.target.checked)}
        />
        Exibir operações automáticas
      </label>
      {activities.length ? (
        <ol className="timeline">
          {activities.map((item) => (
            <li key={item.id} className={item.kind === 'event' ? 'timeline-event' : undefined}>
              <strong>{label(item.kind)}</strong>
              <small className="muted">
                {formatDateTime(item.occurredAt)}
                {item.userName && ` · ${item.userName}`} ·{' '}
                <Link to={`/crm/${item.opportunityId}`}>{item.opportunityTitle}</Link>
              </small>
              <p>{item.description}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">Nenhum atendimento registrado ainda.</p>
      )}
    </>
  );
}

function SummaryTab({ summary, finance }: { summary: Summary; finance: Finance | null }) {
  const { purchaseEveryDays, daysSinceLastSale, lastSale } = summary;
  const nextPurchase =
    purchaseEveryDays !== null && daysSinceLastSale !== null
      ? Math.max(0, purchaseEveryDays - daysSinceLastSale)
      : null;
  return (
    <>
      <TabHeader title="Resumo de vendas" />
      <Facts
        rows={[
          [
            'Periodicidade de compra',
            purchaseEveryDays === null
              ? 'Ainda sem duas compras em datas diferentes'
              : `${purchaseEveryDays} dias · próxima compra em ${nextPurchase} dias`,
          ],
          [
            'Última venda',
            lastSale
              ? `${formatDate(lastSale.date)} · pedido ${formatCode(lastSale.number)} · ${formatMoney(lastSale.total)}`
              : 'Nenhuma venda',
          ],
          ...(finance
            ? ([
                [
                  'Como costuma pagar',
                  finance.usualMethod
                    ? `${finance.usualMethod.method} (${finance.usualMethod.share}% das baixas em 12 meses)`
                    : 'Sem pagamentos em 12 meses',
                ],
              ] as [string, ReactNode][])
            : []),
        ]}
      />

      <h4 className="file-subtitle">Vendas dos últimos 12 meses</h4>
      {summary.months.length ? (
        <div className="table-wrap">
          <table className="items-table" aria-label="Vendas por mês">
            <thead>
              <tr>
                <th>Mês</th>
                <th>Valor</th>
              </tr>
            </thead>
            <tbody>
              {summary.months.map((row) => (
                <tr key={row.month}>
                  <td>{monthName.format(new Date(`${row.month}-01T00:00:00Z`))}</td>
                  <td>{formatMoney(row.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">Nenhuma venda nos últimos 12 meses.</p>
      )}

      <h4 className="file-subtitle">O que o cliente compra</h4>
      {summary.products.length ? (
        <div className="table-wrap">
          <table className="items-table" aria-label="O que o cliente compra">
            <thead>
              <tr>
                <th>Item</th>
                <th>Quantidade</th>
                <th>Valor total</th>
                <th>Última venda</th>
                <th>Preço médio</th>
              </tr>
            </thead>
            <tbody>
              {summary.products.map((item) => (
                <tr key={item.productId}>
                  <td>{item.name}</td>
                  <td>{item.quantity}</td>
                  <td>{formatMoney(item.total)}</td>
                  <td>{formatDate(item.lastSale)}</td>
                  <td>{formatMoney(item.averagePrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">Nenhum item vendido ainda.</p>
      )}
    </>
  );
}

function OpportunitiesTab({ file }: { file: CustomerFile }) {
  const profile = useProfile();
  const list = file.opportunities ?? [];
  return (
    <>
      <TabHeader
        title={`Oportunidades (${list.length})`}
        action={
          can(profile, 'opportunities.create') && (
            <NewLink to={`/crm/novo/cliente/${file.customer.id}`}>Nova oportunidade</NewLink>
          )
        }
      />
      {list.length ? (
        <div className="table-wrap">
          <table className="items-table" aria-label="Oportunidades do cliente">
            <thead>
              <tr>
                <th>Título</th>
                <th>Etapa</th>
                <th>Status</th>
                <th>Responsável</th>
                <th>Valor estimado</th>
                <th>Próxima ação</th>
              </tr>
            </thead>
            <tbody>
              {list.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Link className="link-cell" to={`/crm/${item.id}`}>
                      {item.title}
                    </Link>
                  </td>
                  <td>{item.stageName}</td>
                  <td>
                    <Status value={item.status} />
                  </td>
                  <td>{item.ownerName ?? '—'}</td>
                  <td>{item.estimatedValue === null ? '—' : formatMoney(item.estimatedValue)}</td>
                  <td>
                    {item.nextAction ?? '—'}
                    {item.nextActionAt && ` · ${formatDate(item.nextActionAt)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">Este cliente ainda não tem oportunidades.</p>
      )}
    </>
  );
}

function DocumentGroup({
  title,
  empty,
  count,
  children,
}: {
  title: string;
  empty: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <>
      <h4 className="file-subtitle">
        {title} ({count})
      </h4>
      {count ? <div className="table-wrap">{children}</div> : <p className="muted">{empty}</p>}
    </>
  );
}

function QuotesTab({ file }: { file: CustomerFile }) {
  const profile = useProfile();
  const list = file.quotes ?? [];
  const table = (name: string, rows: CustomerQuote[]) => (
    <table className="items-table" aria-label={name}>
      <thead>
        <tr>
          <th>Número</th>
          <th>Emissão</th>
          <th>Validade</th>
          <th>Vendedor</th>
          <th>Status</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((quote) => (
          <tr key={quote.id}>
            <td>
              <Link className="link-cell" to={`/orcamentos/${quote.id}`}>
                {formatCode(quote.number)}
              </Link>
            </td>
            <td>{formatDate(quote.createdAt)}</td>
            <td>{formatDate(quote.validUntil)}</td>
            <td>{quote.sellerName ?? '—'}</td>
            <td>
              <Status value={quote.status} />
            </td>
            <td>{formatMoney(quote.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  const sent = list.filter((quote) => quote.status === 'sent');
  const drafts = list.filter((quote) => quote.status === 'draft');
  const done = list.filter((quote) => quote.status !== 'sent' && quote.status !== 'draft');
  return (
    <>
      <TabHeader
        title="Orçamentos"
        action={
          can(profile, 'quotes.create') && (
            <NewLink to={`/orcamentos/novo/cliente/${file.customer.id}`}>Novo orçamento</NewLink>
          )
        }
      />
      <DocumentGroup title="Em aprovação" empty="Nenhum orçamento aguardando o cliente." count={sent.length}>
        {table('Orçamentos em aprovação', sent)}
      </DocumentGroup>
      <DocumentGroup title="Rascunhos" empty="Nenhum rascunho." count={drafts.length}>
        {table('Rascunhos', drafts)}
      </DocumentGroup>
      <DocumentGroup title="Finalizados" empty="Nenhum orçamento finalizado." count={done.length}>
        {table('Orçamentos finalizados', done)}
      </DocumentGroup>
    </>
  );
}

function OrdersTab({ file }: { file: CustomerFile }) {
  const profile = useProfile();
  const list = file.orders ?? [];
  const table = (name: string, rows: CustomerOrder[], withBalance: boolean) => (
    <table className="items-table" aria-label={name}>
      <thead>
        <tr>
          <th>Número</th>
          <th>Data</th>
          <th>Vendedor</th>
          <th>Status</th>
          <th>Total</th>
          {withBalance && <th>Saldo em aberto</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((order) => (
          <tr key={order.id}>
            <td>
              <Link className="link-cell" to={`/pedidos/${order.id}`}>
                {formatCode(order.number)}
              </Link>
            </td>
            <td>{formatDate(order.orderDate)}</td>
            <td>{order.sellerName ?? '—'}</td>
            <td>
              <Status value={order.status} />
            </td>
            <td>{formatMoney(order.total)}</td>
            {withBalance && <td>{formatMoney(order.total - order.paidAmount)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
  const pending = list.filter((order) => order.status === 'pending');
  const received = list.filter((order) => order.status === 'paid' || order.status === 'completed');
  const cancelled = list.filter((order) => order.status === 'cancelled');
  return (
    <>
      <TabHeader
        title="Pedidos"
        action={
          can(profile, 'orders.create') && (
            <NewLink to={`/pedidos/novo/cliente/${file.customer.id}`}>Novo pedido</NewLink>
          )
        }
      />
      <DocumentGroup title="Em aberto" empty="Nenhum pedido em aberto." count={pending.length}>
        {table('Pedidos em aberto', pending, true)}
      </DocumentGroup>
      <DocumentGroup title="Recebidos" empty="Nenhum pedido recebido." count={received.length}>
        {table('Pedidos recebidos', received, false)}
      </DocumentGroup>
      {cancelled.length > 0 && (
        <DocumentGroup title="Cancelados" empty="" count={cancelled.length}>
          {table('Pedidos cancelados', cancelled, false)}
        </DocumentGroup>
      )}
    </>
  );
}

function FinanceTab({ finance }: { finance: Finance }) {
  const days = (value: number) => `${value} ${value === 1 ? 'dia' : 'dias'}`;
  return (
    <>
      <TabHeader title="Resumo financeiro" />
      <div className="file-columns">
        <div>
          <h4 className="file-subtitle">Situação atual</h4>
          <Facts
            rows={[
              ['Dívida em aberto', formatMoney(finance.debt)],
              ['Vencido', formatMoney(finance.overdue)],
              ['A vencer', formatMoney(finance.toDue)],
              ['Limite de crédito', finance.creditLimit === null ? '—' : formatMoney(finance.creditLimit)],
              [
                'Limite disponível',
                finance.creditAvailable === null ? '—' : formatMoney(finance.creditAvailable),
              ],
            ]}
          />
        </div>
        <div>
          <h4 className="file-subtitle">
            Histórico de {formatDate(finance.periodFrom)} até {formatDate(finance.periodTo)}
          </h4>
          <Facts
            rows={[
              ['Recebido no período', formatMoney(finance.paid)],
              ['Pago até o vencimento', formatMoney(finance.paidOnTime)],
              ['Pago em atraso', formatMoney(finance.paidLate)],
              ['Pontualidade', finance.punctuality === null ? '—' : `${finance.punctuality}%`],
              ['Média de atraso, só nos atrasados', days(finance.averageDelayDays)],
              ['Maior atraso', days(finance.longestDelayDays)],
            ]}
          />
        </div>
      </div>

      <h4 className="file-subtitle">Contas em aberto ({finance.openTitles.length})</h4>
      {finance.openTitles.length ? (
        <div className="table-wrap">
          <table className="items-table" aria-label="Contas em aberto do cliente">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Parcela</th>
                <th>Vencimento</th>
                <th>Valor</th>
                <th>Saldo</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {finance.openTitles.map((title) => (
                <tr key={title.id}>
                  <td>
                    <Link className="link-cell" to={`/pedidos/${title.orderId}`}>
                      {formatCode(title.number)}
                    </Link>
                  </td>
                  <td>
                    {title.position}/{title.titleCount}
                  </td>
                  <td>{formatDate(title.dueDate)}</td>
                  <td>{formatMoney(title.amount)}</td>
                  <td>{formatMoney(title.balance)}</td>
                  <td>
                    {title.overdue ? (
                      <span className="status cancelled">Vencida</span>
                    ) : (
                      <span className="status pending">A vencer</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">Nenhuma conta em aberto.</p>
      )}
      <p>
        <Link to="/contas-a-receber">Dar baixa em contas a receber</Link>
      </p>
    </>
  );
}
