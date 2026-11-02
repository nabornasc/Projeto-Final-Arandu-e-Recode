import { CHANNELS, interactionSchema, leadSchema } from '@arandue/shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { ActionMenu } from '../actions/ActionMenu.tsx';
import { leadActions } from '../actions/registry.ts';
import { EmptyState } from '../components/EmptyState.tsx';
import { useToast } from '../components/Toast.tsx';
import { api } from '../lib/api.ts';
import { can, useProfile } from '../lib/auth.ts';
import { type LeadDetail, useLead } from '../lib/documents.ts';
import { label } from '../lib/format.ts';
import { useTab, useTabDirty, useTabTitle } from '../workspace/tab.ts';

const SOURCES = ['Indicação', 'Instagram', 'WhatsApp', 'Site', 'Feira', 'Loja física', 'Outro'];
const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

// Tela do lead: dados, responsável, próxima ação e histórico de atendimentos.
export default function LeadDocumentPage() {
  const { params } = useTab();
  const id = params.id ? Number(params.id) : null;
  const lead = useLead(id);
  useTabTitle(id === null ? 'Novo lead' : lead.data?.name);

  if (id !== null && lead.isPending) return <div className="loading">Carregando lead...</div>;
  if (lead.isError) return <EmptyState text={lead.error.message} />;
  return <LeadEditor key={lead.data?.id ?? 'novo'} lead={lead.data ?? null} />;
}

function LeadEditor({ lead }: { lead: LeadDetail | null }) {
  const profile = useProfile();
  const tab = useTab();
  const notify = useToast();
  const client = useQueryClient();
  const formId = useId();
  const editable = can(profile, lead ? 'leads.update' : 'leads.create');
  const owners = useQuery({
    queryKey: ['/leads/owners'],
    queryFn: () => api<{ id: number; name: string }[]>('/leads/owners'),
  });

  const [form, setForm] = useState({
    name: lead?.name ?? '',
    phone: lead?.phone ?? '',
    email: lead?.email ?? '',
    source: lead?.source ?? '',
    ownerId: String(lead?.ownerId ?? profile.id),
    nextAction: lead?.nextAction ?? '',
    nextActionAt: lead?.nextActionAt ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const payload = { ...form, ownerId: Number(form.ownerId) || null, nextActionAt: form.nextActionAt || null };
  const [baseline, setBaseline] = useState(() => JSON.stringify(payload));
  useTabDirty(editable && JSON.stringify(payload) !== baseline);

  const save = useMutation({
    mutationFn: (body: unknown) =>
      lead
        ? api<LeadDetail>(`/leads/${lead.id}`, { method: 'PUT', body })
        : api<LeadDetail>('/leads', { method: 'POST', body }),
    onSuccess: (saved) => {
      setBaseline(JSON.stringify(payload));
      void client.invalidateQueries();
      notify(lead ? 'Lead salvo.' : `Lead ${saved.name} cadastrado.`);
      if (!lead) tab.replaceWith(`/crm/${saved.id}`);
    },
    onError: (err) => setError(err.message),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = leadSchema.safeParse(payload);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Verifique os campos.');
    setError(null);
    save.mutate(payload);
  }

  return (
    <section className="document">
      <div className="section-heading page-heading">
        <div>
          <span className="welcome-label">CRM · LEAD</span>
          <h2>
            {lead?.name ?? 'Novo lead'}{' '}
            {lead && <span className={`status stage-${lead.stage}`}>{label(lead.stage)}</span>}
          </h2>
          <p>
            {lead?.stage === 'lost' && lead.lostReason
              ? `Perdido: ${lead.lostReason}.`
              : 'Registre cada contato e a próxima ação para não perder o timing da venda.'}
          </p>
        </div>
        <div className="document-actions">
          {editable && (
            <button type="submit" form={formId} className="button primary" disabled={save.isPending}>
              <Save size={16} /> {save.isPending ? 'Salvando...' : 'Salvar'}
            </button>
          )}
          {lead && (
            <ActionMenu
              actions={leadActions}
              record={lead}
              label={`lead ${lead.name}`}
              exclude={['lead.open']}
            />
          )}
        </div>
      </div>

      <form id={formId} className="panel" onSubmit={submit} noValidate>
        <fieldset className="form-grid" disabled={!editable}>
          <label>
            Nome
            <input name="name" required maxLength={160} value={form.name} onChange={set('name')} />
          </label>
          <label>
            Origem
            <input
              name="source"
              list="lead-sources"
              required
              maxLength={60}
              value={form.source}
              onChange={set('source')}
            />
            <datalist id="lead-sources">
              {SOURCES.map((source) => (
                <option key={source} value={source} />
              ))}
            </datalist>
          </label>
          <label>
            Telefone / WhatsApp
            <input name="phone" maxLength={30} value={form.phone} onChange={set('phone')} />
          </label>
          <label>
            E-mail
            <input name="email" type="email" maxLength={160} value={form.email} onChange={set('email')} />
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
            Data da próxima ação
            <input name="nextActionAt" type="date" value={form.nextActionAt} onChange={set('nextActionAt')} />
          </label>
          <label className="full-row">
            Próxima ação
            <input
              name="nextAction"
              maxLength={255}
              placeholder="Ex.: ligar para apresentar o orçamento"
              value={form.nextAction}
              onChange={set('nextAction')}
            />
          </label>
        </fieldset>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>

      {lead && <Interactions lead={lead} canAdd={can(profile, 'leads.update')} />}
    </section>
  );
}

function Interactions({ lead, canAdd }: { lead: LeadDetail; canAdd: boolean }) {
  const client = useQueryClient();
  const notify = useToast();
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>('whatsapp');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: (body: unknown) => api(`/leads/${lead.id}/interactions`, { method: 'POST', body }),
    onSuccess: () => {
      setDescription('');
      void client.invalidateQueries();
      notify('Atendimento registrado.');
    },
    onError: (err) => setError(err.message),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const payload = { channel, description };
    const parsed = interactionSchema.safeParse(payload);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Verifique os campos.');
    setError(null);
    add.mutate(payload);
  }

  return (
    <div className="panel interactions">
      <h3>Histórico de atendimentos</h3>
      {canAdd && (
        <form className="interaction-form" onSubmit={submit} noValidate>
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
            aria-label="O que foi conversado"
            placeholder="O que foi conversado?"
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
      {lead.interactions.length ? (
        <ol className="timeline">
          {lead.interactions.map((item) => (
            <li key={item.id}>
              <strong>{label(item.channel)}</strong>
              <small className="muted">
                {dateTime.format(new Date(item.occurredAt))}
                {item.userName && ` · ${item.userName}`}
              </small>
              <p>{item.description}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">Nenhum atendimento registrado ainda.</p>
      )}
    </div>
  );
}
