import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { MONEY_COLUMNS, type ResourceConfig } from '../config/resources.ts';
import { api } from '../lib/api.ts';
import { can, useProfile } from '../lib/auth.ts';
import { formatDate, formatMoney, label } from '../lib/format.ts';
import { applyListFilters, useListFilters } from '../lib/listFilters.ts';
import { EmptyState } from './EmptyState.tsx';
import { FormModal } from './FormModal.tsx';
import { ListFilters, ListTotals } from './ListFilters.tsx';
import { useToast } from './Toast.tsx';

type Row = Record<string, unknown> & { id: number };

function formatCell(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (MONEY_COLUMNS.has(key)) return formatMoney(Number(value));
  if (key.toLowerCase().endsWith('date')) return formatDate(String(value));
  return label(String(value));
}

export function ResourcePage({ config }: { config: ResourceConfig }) {
  const profile = useProfile();
  const notify = useToast();
  const client = useQueryClient();
  const [editing, setEditing] = useState<Row | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const allowed = {
    create: can(profile, `${config.area}.create`),
    update: can(profile, `${config.area}.update`),
    delete: can(profile, `${config.area}.delete`),
  };

  const list = useQuery({ queryKey: [config.endpoint], queryFn: () => api<Row[]>(config.endpoint) });
  const control = useListFilters();
  const listConfig = config.list;
  const loaded = list.data?.length ?? 0;
  const visible = listConfig
    ? applyListFilters(list.data ?? [], control.filters, {
        date: (row) => row[listConfig.dateKey] as string | null,
        status: (row) => String(row[listConfig.statusKey ?? ''] ?? ''),
        text: (row) => listConfig.textKeys.map((key) => row[key] as string | null),
      })
    : (list.data ?? []);

  // Alterar um registro pode mexer em outras telas (ex.: despesa paga cria movimentação),
  // então invalidamos tudo; só a tela visível é buscada de novo.
  const onChanged = (message: string) => {
    void client.invalidateQueries();
    notify(message);
  };

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editing
        ? api(`${config.endpoint}/${editing.id}`, { method: 'PUT', body: payload })
        : api(config.endpoint, { method: 'POST', body: payload }),
    onSuccess: () => {
      setModalOpen(false);
      onChanged(editing ? 'Registro atualizado com sucesso.' : 'Registro criado com sucesso.');
    },
    onError: (error) => notify(error.message, 'error'),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api(`${config.endpoint}/${id}`, { method: 'DELETE' }),
    onSuccess: () => onChanged('Registro excluído com sucesso.'),
    onError: (error) => notify(error.message, 'error'),
  });

  const openForm = (row: Row | null) => {
    setEditing(row);
    setModalOpen(true);
  };

  return (
    <section>
      <div className="section-heading page-heading">
        <div>
          <span className="welcome-label">GESTÃO DO NEGÓCIO</span>
          <h2>{config.title}</h2>
          <p>Cadastre e acompanhe informações essenciais da sua rotina.</p>
        </div>
        {allowed.create ? (
          <button type="button" className="button primary" onClick={() => openForm(null)}>
            <Plus size={17} /> Novo registro
          </button>
        ) : (
          <span className="read-only-note">Somente leitura</span>
        )}
      </div>

      {listConfig && loaded > 0 && (
        <ListFilters
          control={control}
          dateLabel={listConfig.dateLabel}
          textLabel={listConfig.textLabel}
          statuses={listConfig.statuses}
        />
      )}

      <div className="panel table-panel">
        {list.isPending ? (
          <div className="loading">Carregando dados...</div>
        ) : list.isError ? (
          <EmptyState text={list.error.message} />
        ) : visible.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {config.columns.map(([key, title]) => (
                    <th key={key}>{title}</th>
                  ))}
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const locked = config.isLocked?.(row) ?? false;
                  return (
                    <tr key={row.id}>
                      {config.columns.map(([key]) => (
                        <td key={key}>{formatCell(key, row[key])}</td>
                      ))}
                      <td className="actions">
                        {locked ? (
                          <span title="Gerada automaticamente por um pedido ou despesa">
                            <Lock size={14} aria-label="Automática" />
                          </span>
                        ) : (
                          <>
                            {allowed.update && (
                              <button type="button" onClick={() => openForm(row)}>
                                Editar
                              </button>
                            )}
                            {allowed.delete && (
                              <button
                                type="button"
                                className="delete"
                                title="Excluir registro"
                                aria-label="Excluir registro"
                                disabled={remove.isPending}
                                onClick={() =>
                                  window.confirm('Excluir este registro?') && remove.mutate(row.id)
                                }
                              >
                                <Trash2 size={16} />
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            text={
              loaded
                ? 'Nenhum registro com esses filtros.'
                : 'Ainda não há registros cadastrados nesta seção.'
            }
            action={allowed.create && !loaded ? 'Adicionar primeiro' : undefined}
            onClick={() => openForm(null)}
          />
        )}
      </div>

      {listConfig && loaded > 0 && (
        <ListTotals count={visible.length} loaded={loaded} totals={listConfig.totals(visible)} />
      )}

      {modalOpen && (
        <FormModal
          config={config}
          initial={editing}
          saving={save.isPending}
          onClose={() => setModalOpen(false)}
          onSubmit={(payload) => save.mutate(payload)}
        />
      )}
    </section>
  );
}
