import { ACTIVITY_KINDS, CHANNELS, interactionSchema, opportunitySchema } from '@arandue/shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FilePlus2, Save } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ActionMenu } from '../actions/ActionMenu.tsx';
import { opportunityActions } from '../actions/registry.ts';
import { CustomerSelect } from '../components/DocumentParts.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import { ItemLines, type Line, linesToItems, newLine, type Product } from '../components/ItemLines.tsx';
import { useToast } from '../components/Toast.tsx';
import { api } from '../lib/api.ts';
import { can, useProfile } from '../lib/auth.ts';
import { type OpportunityDetail, useOpportunity, useStages } from '../lib/documents.ts';
import { formatCode, formatDate, formatMoney, label, todayIso } from '../lib/format.ts';
import { useTab, useTabDirty, useTabTitle } from '../workspace/tab.ts';

const SOURCES = ['Indicação', 'Instagram', 'WhatsApp', 'Site', 'Feira', 'Loja física', 'Outro'];
const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

// Tela da oportunidade: etapas, resumo de valores, dados, atividades e documentos vinculados.
export default function OpportunityDocumentPage() {
  const { params } = useTab();
  const id = params.id ? Number(params.id) : null;
  const opportunity = useOpportunity(id);
  useTabTitle(id === null ? 'Nova oportunidade' : opportunity.data?.title);

  if (id !== null && opportunity.isPending) return <div className="loading">Carregando oportunidade...</div>;
  if (opportunity.isError) return <EmptyState text={opportunity.error.message} />;
  return (
    <OpportunityEditor
      key={opportunity.data?.id ?? 'nova'}
      opportunity={opportunity.data ?? null}
      initialStageId={params.stageId ? Number(params.stageId) : null}
    />
  );
}

function OpportunityEditor({
  opportunity,
  initialStageId,
}: {
  opportunity: OpportunityDetail | null;
  initialStageId: number | null;
}) {
  const profile = useProfile();
  const tab = useTab();
  const notify = useToast();
  const client = useQueryClient();
  const navigate = useNavigate();
  const formId = useId();
  const editable = can(profile, opportunity ? 'opportunities.update' : 'opportunities.create');
  const stages = useStages();
  const products = useQuery({
    queryKey: ['/products'],
    queryFn: () => api<Product[]>('/products'),
    enabled: editable,
  });
  const owners = useQuery({
    queryKey: ['/opportunities/owners'],
    queryFn: () => api<{ id: number; name: string }[]>('/opportunities/owners'),
  });

  const [form, setForm] = useState({
    title: opportunity?.title ?? '',
    contactName: opportunity?.contactName ?? '',
    contactPhone: opportunity?.contactPhone ?? '',
    contactEmail: opportunity?.contactEmail ?? '',
    source: opportunity?.source ?? '',
    ownerId: String(opportunity?.ownerId ?? profile.id),
    estimatedValue:
      opportunity?.estimatedValue === null || !opportunity ? '' : String(opportunity.estimatedValue),
    expectedCloseDate: opportunity?.expectedCloseDate ?? '',
    nextAction: opportunity?.nextAction ?? '',
    nextActionAt: opportunity?.nextActionAt ?? '',
  });
  const [customerId, setCustomerId] = useState(
    opportunity?.customerId ? String(opportunity.customerId) : (tab.params.customerId ?? ''),
  );
  const [lines, setLines] = useState<Line[]>(() =>
    opportunity?.items.length
      ? opportunity.items.map((item) => newLine({ ...item, unitPrice: item.unitPrice ?? item.catalogPrice }))
      : [],
  );
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const payload = {
    ...form,
    customerId: customerId ? Number(customerId) : null,
    ownerId: Number(form.ownerId) || null,
    estimatedValue: form.estimatedValue === '' ? null : Number(form.estimatedValue),
    expectedCloseDate: form.expectedCloseDate || null,
    nextActionAt: form.nextActionAt || null,
    stageId: opportunity ? undefined : initialStageId,
    items: linesToItems(lines),
  };
  const [baseline, setBaseline] = useState(() => JSON.stringify(payload));
  useTabDirty(editable && JSON.stringify(payload) !== baseline);

  // Cliente e valor também mudam pela automação (documento vinculado, ganho). O formulário acompanha,
  // salvo se o usuário tiver alterado o campo, para salvar não apagar o que o servidor definiu.
  const fromServer = {
    customerId: opportunity?.customerId ?? null,
    estimatedValue: opportunity?.estimatedValue ?? null,
  };
  const [seen, setSeen] = useState(fromServer);
  if (seen.customerId !== fromServer.customerId || seen.estimatedValue !== fromServer.estimatedValue) {
    setSeen(fromServer);
    if (customerId === String(seen.customerId ?? '')) setCustomerId(String(fromServer.customerId ?? ''));
    if (form.estimatedValue === String(seen.estimatedValue ?? '')) {
      setForm((current) => ({ ...current, estimatedValue: String(fromServer.estimatedValue ?? '') }));
    }
    setBaseline((current) => JSON.stringify({ ...JSON.parse(current), ...fromServer }));
  }

  const save = useMutation({
    mutationFn: (body: unknown) =>
      opportunity
        ? api<OpportunityDetail>(`/opportunities/${opportunity.id}`, { method: 'PUT', body })
        : api<OpportunityDetail>('/opportunities', { method: 'POST', body }),
    onSuccess: (saved) => {
      setBaseline(JSON.stringify(payload));
      void client.invalidateQueries();
      notify(opportunity ? 'Oportunidade salva.' : `Oportunidade ${saved.title} cadastrada.`);
      if (!opportunity) tab.replaceWith(`/crm/${saved.id}`);
    },
    onError: (err) => setError(err.message),
  });

  const moveStage = useMutation({
    mutationFn: (stageId: number) =>
      api(`/opportunities/${opportunity?.id}/stage`, { method: 'POST', body: { stageId } }),
    onSuccess: () => void client.invalidateQueries(),
    onError: (err) => notify(err.message, 'error'),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = opportunitySchema.safeParse(payload);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Verifique os campos.');
    setError(null);
    save.mutate(payload);
  }

  // Item já registrado continua na lista mesmo depois de o produto ser arquivado.
  const productOptions = products.data && [
    ...products.data,
    ...(opportunity?.items ?? [])
      .filter((item) => !products.data.some((product) => product.id === item.productId))
      .map((item) => ({
        id: item.productId,
        name: `${item.productName} (arquivado)`,
        price: item.catalogPrice,
        stock: null,
      })),
  ];

  const isOpen = opportunity?.status === 'open';
  const currentPosition = stages.data?.findIndex((stage) => stage.id === opportunity?.stageId) ?? -1;
  const overdue =
    isOpen && opportunity?.expectedCloseDate && opportunity.expectedCloseDate < todayIso()
      ? opportunity.expectedCloseDate
      : null;

  return (
    <section className="document">
      <div className="section-heading page-heading">
        <div>
          <span className="welcome-label">CRM · OPORTUNIDADE</span>
          <h2>
            {opportunity?.title ?? 'Nova oportunidade'}{' '}
            {opportunity && (
              <span className={`status ${opportunity.status}`}>{label(opportunity.status)}</span>
            )}
          </h2>
          <p>
            {opportunity?.status === 'lost' && opportunity.lostReason
              ? `Perdida na etapa "${opportunity.stageName}": ${opportunity.lostReason}.`
              : opportunity?.status === 'won'
                ? `Ganha na etapa "${opportunity.stageName}".`
                : 'Registre cada contato e a próxima ação; os orçamentos e pedidos vinculados movem a etapa sozinhos.'}
          </p>
        </div>
        <div className="document-actions">
          {opportunity && isOpen && can(profile, 'quotes.create') && (
            <button
              type="button"
              className="button secondary"
              onClick={() => navigate(`/crm/${opportunity.id}/orcamento`)}
            >
              <FilePlus2 size={16} /> Novo orçamento
            </button>
          )}
          {editable && (
            <button type="submit" form={formId} className="button primary" disabled={save.isPending}>
              <Save size={16} /> {save.isPending ? 'Salvando...' : 'Salvar'}
            </button>
          )}
          {opportunity && (
            <ActionMenu
              actions={opportunityActions}
              record={opportunity}
              label={`oportunidade ${opportunity.title}`}
              exclude={['opportunity.open']}
            />
          )}
        </div>
      </div>

      {opportunity && (
        <>
          <ol className="stage-bar" aria-label="Etapas do funil">
            {stages.data?.map((stage, index) => {
              const reached = index <= currentPosition;
              return (
                <li
                  key={stage.id}
                  className={reached ? 'reached' : undefined}
                  style={{ '--stage': stage.color } as never}
                >
                  {isOpen && can(profile, 'opportunities.update') && stage.id !== opportunity.stageId ? (
                    <button
                      type="button"
                      disabled={moveStage.isPending}
                      onClick={() => moveStage.mutate(stage.id)}
                    >
                      {stage.name}
                    </button>
                  ) : (
                    <span aria-current={stage.id === opportunity.stageId ? 'step' : undefined}>
                      {stage.name}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>

          <dl className="value-summary">
            <div>
              <dt>Estimado</dt>
              <dd>{formatMoney(opportunity.values.estimated)}</dd>
            </div>
            <div>
              <dt>Em orçamentos</dt>
              <dd>{formatMoney(opportunity.values.inQuotes)}</dd>
            </div>
            <div>
              <dt>Em pedidos</dt>
              <dd>{formatMoney(opportunity.values.inOrders)}</dd>
            </div>
            <div>
              <dt>Recebido</dt>
              <dd className="positive">{formatMoney(opportunity.values.received)}</dd>
            </div>
          </dl>
          {overdue && (
            <p className="notice" role="status">
              Atrasada desde {formatDate(overdue)}.
            </p>
          )}
        </>
      )}

      <form id={formId} className="panel" onSubmit={submit} noValidate>
        <fieldset className="form-grid" disabled={!editable}>
          <label className="full-row">
            Título
            <input name="title" required maxLength={160} value={form.title} onChange={set('title')} />
          </label>
          <CustomerSelect
            value={customerId}
            onChange={setCustomerId}
            disabled={!editable}
            emptyLabel="Ainda não é cliente"
          />
          {opportunity?.customerId && can(profile, 'customers.read') && (
            <p className="full-row file-link">
              <Link to={`/clientes/${opportunity.customerId}/ficha`}>Ver ficha do cliente</Link>
            </p>
          )}
          <label>
            Origem
            <input
              name="source"
              list="opportunity-sources"
              required
              maxLength={60}
              value={form.source}
              onChange={set('source')}
            />
            <datalist id="opportunity-sources">
              {SOURCES.map((source) => (
                <option key={source} value={source} />
              ))}
            </datalist>
          </label>
          <label>
            Nome do contato
            <input
              name="contactName"
              maxLength={160}
              value={form.contactName}
              onChange={set('contactName')}
            />
          </label>
          <label>
            Telefone / WhatsApp
            <input
              name="contactPhone"
              maxLength={30}
              value={form.contactPhone}
              onChange={set('contactPhone')}
            />
          </label>
          <label>
            E-mail
            <input
              name="contactEmail"
              type="email"
              maxLength={160}
              value={form.contactEmail}
              onChange={set('contactEmail')}
            />
          </label>
          <label>
            Responsável
            <select name="ownerId" value={form.ownerId} onChange={set('ownerId')}>
              {owners.data?.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Valor estimado (R$)
            <input
              name="estimatedValue"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={form.estimatedValue}
              onChange={set('estimatedValue')}
            />
          </label>
          <label>
            Previsão de fechamento
            <input
              name="expectedCloseDate"
              type="date"
              value={form.expectedCloseDate}
              onChange={set('expectedCloseDate')}
            />
          </label>
          <label>
            Próxima ação
            <input
              name="nextAction"
              maxLength={255}
              placeholder="Ex.: ligar para apresentar o orçamento"
              value={form.nextAction}
              onChange={set('nextAction')}
            />
          </label>
          <label>
            Data da próxima ação
            <input name="nextActionAt" type="date" value={form.nextActionAt} onChange={set('nextActionAt')} />
          </label>

          <h3 className="full-row form-subtitle">Itens de interesse</h3>
          {lines.length > 0 ? (
            <ItemLines lines={lines} setLines={setLines} products={productOptions} minLines={0} />
          ) : (
            <div className="full-row">
              <button type="button" className="button secondary" onClick={() => setLines([newLine()])}>
                Adicionar item de interesse
              </button>
            </div>
          )}
        </fieldset>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>

      {opportunity && <LinkedDocuments opportunity={opportunity} />}
      {opportunity && <Activities opportunity={opportunity} canAdd={can(profile, 'opportunities.update')} />}
    </section>
  );
}

function LinkedDocuments({ opportunity }: { opportunity: OpportunityDetail }) {
  if (!opportunity.quotes.length && !opportunity.orders.length) return null;
  return (
    <div className="panel linked-docs">
      <h3>Documentos vinculados</h3>
      <div className="linked-columns">
        <section aria-label="Orçamentos">
          <h4>Orçamentos</h4>
          {opportunity.quotes.length ? (
            <ul>
              {opportunity.quotes.map((quote) => (
                <li key={quote.id}>
                  <Link to={`/orcamentos/${quote.id}`}>{formatCode(quote.number)}</Link>
                  <span className={`status ${quote.status}`}>{label(quote.status)}</span>
                  <strong>{formatMoney(quote.total)}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Nenhum.</p>
          )}
        </section>
        <section aria-label="Pedidos">
          <h4>Pedidos</h4>
          {opportunity.orders.length ? (
            <ul>
              {opportunity.orders.map((order) => (
                <li key={order.id}>
                  <Link to={`/pedidos/${order.id}`}>{formatCode(order.number)}</Link>
                  <span className={`status ${order.status}`}>{label(order.status)}</span>
                  <strong>{formatMoney(order.total)}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Nenhum.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function Activities({ opportunity, canAdd }: { opportunity: OpportunityDetail; canAdd: boolean }) {
  const client = useQueryClient();
  const notify = useToast();
  const [kind, setKind] = useState<(typeof ACTIVITY_KINDS)[number]>('comment');
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>('whatsapp');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: (body: unknown) =>
      api(`/opportunities/${opportunity.id}/interactions`, { method: 'POST', body }),
    onSuccess: () => {
      setDescription('');
      void client.invalidateQueries();
      notify('Atividade registrada.');
    },
    onError: (err) => setError(err.message),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const payload = { kind, channel, description };
    const parsed = interactionSchema.safeParse(payload);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Verifique os campos.');
    setError(null);
    add.mutate(payload);
  }

  return (
    <div className="panel interactions">
      <h3>Histórico</h3>
      {canAdd && (
        <form className="interaction-form" onSubmit={submit} noValidate>
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
          <select
            name="channel"
            aria-label="Canal"
            value={channel}
            onChange={(event) => setChannel(event.target.value as (typeof CHANNELS)[number])}
          >
            {CHANNELS.map((item) => (
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
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {opportunity.interactions.length ? (
        <ol className="timeline">
          {opportunity.interactions.map((item) => (
            <li key={item.id} className={item.kind === 'event' ? 'timeline-event' : undefined}>
              <strong>{label(item.kind)}</strong>
              <small className="muted">
                {dateTime.format(new Date(item.occurredAt))}
                {item.userName && ` · ${item.userName}`}
                {item.kind !== 'event' && ` · ${label(item.channel)}`}
              </small>
              <p>{item.description}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">Nenhuma atividade registrada ainda.</p>
      )}
    </div>
  );
}
