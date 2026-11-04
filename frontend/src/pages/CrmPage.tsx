import { OPPORTUNITY_STATUSES, type OpportunityStatus, STAGE_MILESTONES } from '@arandue/shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Settings2, Trash2 } from 'lucide-react';
import { type FormEvent, useDeferredValue, useState } from 'react';
import { useNavigate } from 'react-router';
import { ActionMenu } from '../actions/ActionMenu.tsx';
import { opportunityActions } from '../actions/registry.ts';
import { EmptyState } from '../components/EmptyState.tsx';
import { Modal } from '../components/Modal.tsx';
import { useToast } from '../components/Toast.tsx';
import { api } from '../lib/api.ts';
import { can, useProfile } from '../lib/auth.ts';
import { type Opportunity, type OpportunityTotals, type PipelineStage, useStages } from '../lib/documents.ts';
import { formatDate, formatMoney, label, todayIso } from '../lib/format.ts';

type ListResult = { items: Opportunity[]; totals: OpportunityTotals };

const isOverdue = (opportunity: Opportunity, today: string) =>
  opportunity.status === 'open' && opportunity.nextActionAt !== null && opportunity.nextActionAt < today;

// Funil de vendas: kanban das oportunidades em andamento e lista com filtros e totais.
export default function CrmPage() {
  const profile = useProfile();
  const navigate = useNavigate();
  const [view, setView] = useState<'kanban' | 'list'>('kanban');
  const [configuring, setConfiguring] = useState(false);

  return (
    <section>
      <div className="section-heading page-heading">
        <div>
          <span className="welcome-label">CRM</span>
          <h2>Funil de vendas</h2>
          <p>
            Acompanhe cada negócio até virar venda.
            {profile.ownOnly && ' Você vê as oportunidades de que é responsável.'}
          </p>
        </div>
        <div className="document-actions">
          {can(profile, 'opportunities.configure') && (
            <button type="button" className="button secondary" onClick={() => setConfiguring(true)}>
              <Settings2 size={16} /> Etapas
            </button>
          )}
          {can(profile, 'opportunities.create') && (
            <button type="button" className="button primary" onClick={() => navigate('/crm/novo')}>
              <Plus size={17} /> Nova oportunidade
            </button>
          )}
        </div>
      </div>

      <fieldset className="role-chips view-switch">
        <legend className="sr-only">Visualização</legend>
        {(
          [
            ['kanban', 'Funil'],
            ['list', 'Lista'],
          ] as const
        ).map(([key, text]) => (
          <button
            key={key}
            type="button"
            className={view === key ? 'chip active' : 'chip'}
            aria-pressed={view === key}
            onClick={() => setView(key)}
          >
            {text}
          </button>
        ))}
      </fieldset>

      {view === 'kanban' ? <Kanban /> : <OpportunityList />}
      {configuring && <StagesModal onClose={() => setConfiguring(false)} />}
    </section>
  );
}

function Kanban() {
  const profile = useProfile();
  const navigate = useNavigate();
  const stages = useStages();
  const list = useQuery({
    queryKey: ['/opportunities', 'open'],
    queryFn: () => api<ListResult>('/opportunities?status=open'),
  });
  const today = todayIso();
  const canCreate = can(profile, 'opportunities.create');

  if (list.isPending || stages.isPending) return <div className="loading">Carregando funil...</div>;
  if (list.isError) return <EmptyState text={list.error.message} />;
  if (stages.isError) return <EmptyState text={stages.error.message} />;

  const open = list.data.items;
  return (
    <>
      <p className="kanban-total">
        <strong>{formatMoney(list.data.totals.open.value)}</strong> em {list.data.totals.open.count}{' '}
        {list.data.totals.open.count === 1 ? 'oportunidade' : 'oportunidades'} em andamento
      </p>
      <div className="kanban">
        {stages.data.map((stage) => {
          const column = open.filter((opportunity) => opportunity.stageId === stage.id);
          const value = column.reduce((sum, opportunity) => sum + (opportunity.estimatedValue ?? 0), 0);
          return (
            <section key={stage.id} className="kanban-column" aria-label={stage.name}>
              <h3 style={{ borderColor: stage.color }}>
                <span>{stage.name}</span>
                <span className="kanban-count">{column.length}</span>
              </h3>
              <div className="kanban-sum">
                <small>{formatMoney(value)}</small>
                {canCreate && (
                  <button
                    type="button"
                    className="kanban-add"
                    aria-label={`Nova oportunidade em ${stage.name}`}
                    onClick={() => navigate(`/crm/novo/${stage.id}`)}
                  >
                    <Plus size={14} />
                  </button>
                )}
              </div>
              {column.map((opportunity) => (
                <article key={opportunity.id} className="opportunity-card">
                  <div className="opportunity-card-head">
                    <button
                      type="button"
                      className="link-cell"
                      onClick={() => navigate(`/crm/${opportunity.id}`)}
                    >
                      {opportunity.title}
                    </button>
                    <ActionMenu actions={opportunityActions} record={opportunity} label={opportunity.title} />
                  </div>
                  <small className="muted">
                    {opportunity.customerName ?? opportunity.contactName ?? opportunity.source}
                    {opportunity.ownerName && ` · ${opportunity.ownerName}`}
                  </small>
                  {opportunity.estimatedValue !== null && (
                    <strong>{formatMoney(opportunity.estimatedValue)}</strong>
                  )}
                  {opportunity.nextAction && (
                    <small className={isOverdue(opportunity, today) ? 'overdue' : 'muted'}>
                      {isOverdue(opportunity, today) ? 'Atrasado: ' : 'Próximo: '}
                      {opportunity.nextAction}
                      {opportunity.nextActionAt && ` (${formatDate(opportunity.nextActionAt)})`}
                    </small>
                  )}
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}

function OpportunityList() {
  const navigate = useNavigate();
  const stages = useStages();
  const owners = useQuery({
    queryKey: ['/opportunities/owners'],
    queryFn: () => api<{ id: number; name: string }[]>('/opportunities/owners'),
  });
  const [filters, setFilters] = useState({
    status: '' as OpportunityStatus | '',
    stageId: '',
    ownerId: '',
    source: '',
    lostReason: '',
    from: '',
    to: '',
    q: '',
  });
  const deferred = useDeferredValue(filters);
  const query = new URLSearchParams(Object.entries(deferred).filter(([, value]) => value)).toString();
  const list = useQuery({
    queryKey: ['/opportunities', query],
    queryFn: () => api<ListResult>(`/opportunities${query ? `?${query}` : ''}`),
  });
  const set = (key: keyof typeof filters) => (event: { target: { value: string } }) =>
    setFilters((current) => ({ ...current, [key]: event.target.value }));

  const totals = list.data?.totals;
  return (
    <>
      <div className="panel filter-grid">
        <label>
          Busca
          <input name="q" placeholder="Título, contato ou cliente" value={filters.q} onChange={set('q')} />
        </label>
        <label>
          Situação
          <select name="status" value={filters.status} onChange={set('status')}>
            <option value="">Todas</option>
            {OPPORTUNITY_STATUSES.map((status) => (
              <option key={status} value={status}>
                {label(status)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Etapa
          <select name="stageId" value={filters.stageId} onChange={set('stageId')}>
            <option value="">Todas</option>
            {stages.data?.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Responsável
          <select name="ownerId" value={filters.ownerId} onChange={set('ownerId')}>
            <option value="">Todos</option>
            {owners.data?.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Origem
          <input name="source" value={filters.source} onChange={set('source')} />
        </label>
        <label>
          Motivo da perda
          <input name="lostReason" value={filters.lostReason} onChange={set('lostReason')} />
        </label>
        <label>
          Previsão de
          <input name="from" type="date" value={filters.from} onChange={set('from')} />
        </label>
        <label>
          até
          <input name="to" type="date" value={filters.to} onChange={set('to')} />
        </label>
      </div>

      <div className="panel table-panel">
        {list.isPending ? (
          <div className="loading">Carregando...</div>
        ) : list.isError ? (
          <EmptyState text={list.error.message} />
        ) : list.data.items.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Título</th>
                  <th>Cliente</th>
                  <th>Etapa</th>
                  <th>Situação</th>
                  <th>Previsão</th>
                  <th>Origem</th>
                  <th>Responsável</th>
                  <th>Valor</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((opportunity) => (
                  <tr key={opportunity.id}>
                    <td>
                      <button
                        type="button"
                        className="link-cell"
                        onClick={() => navigate(`/crm/${opportunity.id}`)}
                      >
                        {opportunity.title}
                      </button>
                      {opportunity.status === 'lost' && opportunity.lostReason && (
                        <small className="muted block">Motivo: {opportunity.lostReason}</small>
                      )}
                    </td>
                    <td>{opportunity.customerName ?? opportunity.contactName ?? '—'}</td>
                    <td>{opportunity.stageName}</td>
                    <td>
                      <span className={`status ${opportunity.status}`}>{label(opportunity.status)}</span>
                    </td>
                    <td>{formatDate(opportunity.expectedCloseDate)}</td>
                    <td>{opportunity.source}</td>
                    <td>{opportunity.ownerName ?? '—'}</td>
                    <td>
                      <strong>{formatMoney(opportunity.estimatedValue)}</strong>
                    </td>
                    <td className="actions">
                      <ActionMenu
                        actions={opportunityActions}
                        record={opportunity}
                        label={opportunity.title}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState text="Nenhuma oportunidade com esses filtros." />
        )}
      </div>

      {totals && (
        <dl className="value-summary list-totals">
          <div>
            <dt>Perdidas ({totals.lost.count})</dt>
            <dd>{formatMoney(totals.lost.value)}</dd>
          </div>
          <div>
            <dt>Em andamento ({totals.open.count})</dt>
            <dd>{formatMoney(totals.open.value)}</dd>
          </div>
          <div>
            <dt>Ganhas ({totals.won.count})</dt>
            <dd className="positive">{formatMoney(totals.won.value)}</dd>
          </div>
          <div>
            <dt>Total ({totals.all.count})</dt>
            <dd>{formatMoney(totals.all.value)}</dd>
          </div>
        </dl>
      )}
    </>
  );
}

function StagesModal({ onClose }: { onClose: () => void }) {
  const notify = useToast();
  const client = useQueryClient();
  const stages = useStages();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');

  const refresh = () => {
    setError(null);
    void client.invalidateQueries();
  };
  const failed = (err: Error) => setError(err.message);

  const update = useMutation({
    mutationFn: ({ id, ...body }: Pick<PipelineStage, 'id' | 'name' | 'color' | 'milestone'>) =>
      api(`/pipeline-stages/${id}`, { method: 'PUT', body }),
    onSuccess: refresh,
    onError: failed,
  });
  const reorder = useMutation({
    mutationFn: (ids: number[]) => api('/pipeline-stages/order', { method: 'PUT', body: { ids } }),
    onSuccess: refresh,
    onError: failed,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api(`/pipeline-stages/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      refresh();
      notify('Etapa excluída.');
    },
    onError: failed,
  });
  const create = useMutation({
    mutationFn: (body: { name: string }) => api('/pipeline-stages', { method: 'POST', body }),
    onSuccess: () => {
      setName('');
      refresh();
    },
    onError: failed,
  });

  const move = (index: number, delta: number) => {
    const ids = (stages.data ?? []).map((stage) => stage.id);
    const [id] = ids.splice(index, 1);
    if (id === undefined) return;
    ids.splice(index + delta, 0, id);
    reorder.mutate(ids);
  };

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setError('Informe o nome da etapa.');
    create.mutate({ name });
  }

  return (
    <Modal eyebrow="CRM" title="Etapas do funil" onClose={onClose}>
      <p className="read-only-note">
        O marco diz à automação qual etapa corresponde a "orçamento enviado" e "negociação". Cada marco fica
        em uma etapa só.
      </p>
      <ul className="stage-list">
        {stages.data?.map((stage, index) => (
          <li key={`${stage.id}-${stage.name}-${stage.color}`}>
            <input
              type="color"
              aria-label={`Cor de ${stage.name}`}
              defaultValue={stage.color}
              onBlur={(event) =>
                event.target.value !== stage.color && update.mutate({ ...stage, color: event.target.value })
              }
            />
            <input
              aria-label={`Nome da etapa ${stage.name}`}
              defaultValue={stage.name}
              maxLength={60}
              onBlur={(event) =>
                event.target.value.trim() &&
                event.target.value !== stage.name &&
                update.mutate({ ...stage, name: event.target.value })
              }
            />
            <select
              aria-label={`Marco de ${stage.name}`}
              value={stage.milestone ?? ''}
              onChange={(event) =>
                update.mutate({
                  ...stage,
                  milestone: (event.target.value || null) as PipelineStage['milestone'],
                })
              }
            >
              <option value="">Sem marco</option>
              {STAGE_MILESTONES.map((milestone) => (
                <option key={milestone} value={milestone}>
                  {label(milestone)}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label={`Subir ${stage.name}`}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              <ArrowUp size={14} />
            </button>
            <button
              type="button"
              aria-label={`Descer ${stage.name}`}
              disabled={index === (stages.data?.length ?? 0) - 1}
              onClick={() => move(index, 1)}
            >
              <ArrowDown size={14} />
            </button>
            <button
              type="button"
              aria-label={`Excluir ${stage.name}`}
              onClick={() => remove.mutate(stage.id)}
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
      <form className="stage-new" onSubmit={submit} noValidate>
        <input
          aria-label="Nome da nova etapa"
          placeholder="Nova etapa"
          maxLength={60}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button type="submit" className="button secondary" disabled={create.isPending}>
          <Plus size={14} /> Adicionar
        </button>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button type="button" className="button primary" onClick={onClose}>
          Concluir
        </button>
      </div>
    </Modal>
  );
}
