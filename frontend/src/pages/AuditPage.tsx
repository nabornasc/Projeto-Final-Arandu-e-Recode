import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { EmptyState } from '../components/EmptyState.tsx';
import { api } from '../lib/api.ts';
import { formatDateTime } from '../lib/format.ts';
import type { HistoryOptions, HistoryPage } from '../lib/history.ts';

const ACTIONS = [
  ['create', 'Criou'],
  ['update', 'Alterou'],
  ['status', 'Mudou o status'],
  ['convert', 'Converteu'],
  ['archive', 'Arquivou'],
  ['delete', 'Excluiu'],
  ['login', 'Entrou no sistema'],
] as const;

const EMPTY = { userId: '', module: '', action: '', from: '', to: '' };

// O período é escolhido em dias no fuso de quem consulta; a API recebe os instantes correspondentes.
function queryOf(filters: typeof EMPTY, page: number) {
  const query = new URLSearchParams({ page: String(page) });
  if (filters.userId) query.set('userId', filters.userId);
  if (filters.module) query.set('module', filters.module);
  if (filters.action) query.set('action', filters.action);
  if (filters.from) query.set('from', new Date(`${filters.from}T00:00:00`).toISOString());
  if (filters.to) query.set('to', new Date(`${filters.to}T23:59:59.999`).toISOString());
  return query.toString();
}

// Tela geral de auditoria: quem fez o quê e quando, em todos os módulos da empresa.
export default function AuditPage() {
  const [filters, setFilters] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const options = useQuery({
    queryKey: ['/history/options'],
    queryFn: () => api<HistoryOptions>('/history/options'),
  });
  const query = queryOf(filters, page);
  const history = useQuery({
    queryKey: ['/history', query],
    queryFn: () => api<HistoryPage>(`/history?${query}`),
    placeholderData: keepPreviousData,
  });

  const set = (key: keyof typeof EMPTY) => (event: { target: { value: string } }) => {
    setFilters((current) => ({ ...current, [key]: event.target.value }));
    setPage(1);
  };
  const lastPage = history.data ? Math.max(1, Math.ceil(history.data.total / history.data.pageSize)) : 1;

  return (
    <section>
      <div className="section-heading page-heading">
        <div>
          <span className="welcome-label">EQUIPE</span>
          <h2>Auditoria</h2>
          <p>Quem fez o quê e quando, em todos os módulos. Clique em uma linha para ver o que mudou.</p>
        </div>
      </div>

      <form className="panel audit-filters" aria-label="Filtros da auditoria">
        <div className="form-grid">
          <label>
            Usuário
            <select name="userId" value={filters.userId} onChange={set('userId')}>
              <option value="">Todos</option>
              {options.data?.actors.map((actor) => (
                <option key={actor.id} value={actor.id}>
                  {actor.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Módulo
            <select name="module" value={filters.module} onChange={set('module')}>
              <option value="">Todos</option>
              {options.data?.modules.map((module) => (
                <option key={module} value={module}>
                  {module}
                </option>
              ))}
            </select>
          </label>
          <label>
            Ação
            <select name="action" value={filters.action} onChange={set('action')}>
              <option value="">Todas</option>
              {ACTIONS.map(([value, name]) => (
                <option key={value} value={value}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            De
            <input name="from" type="date" value={filters.from} onChange={set('from')} />
          </label>
          <label>
            Até
            <input name="to" type="date" value={filters.to} onChange={set('to')} />
          </label>
        </div>
      </form>

      <div className="panel table-panel">
        {history.isPending ? (
          <div className="loading">Carregando registros...</div>
        ) : history.isError ? (
          <EmptyState text={history.error.message} />
        ) : history.data.rows.length ? (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Data e hora</th>
                    <th scope="col">Usuário</th>
                    <th scope="col">Módulo</th>
                    <th scope="col">Ação</th>
                    <th scope="col">Registro</th>
                  </tr>
                </thead>
                <tbody>
                  {history.data.rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <time dateTime={row.createdAt}>{formatDateTime(row.createdAt, true)}</time>
                      </td>
                      <td>{row.actorName}</td>
                      <td>{row.module}</td>
                      <td>
                        <Link className="link-cell" to={`/historico/${row.id}`}>
                          {row.summary}
                        </Link>
                        {row.reason && <small className="muted history-note">Motivo: {row.reason}</small>}
                      </td>
                      <td>{row.label ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="audit-pager">
              <span className="muted">
                {history.data.total} {history.data.total === 1 ? 'registro' : 'registros'} · página {page} de{' '}
                {lastPage}
              </span>
              <button
                type="button"
                className="button secondary"
                disabled={page <= 1}
                onClick={() => setPage((current) => current - 1)}
              >
                Anterior
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={page >= lastPage}
                onClick={() => setPage((current) => current + 1)}
              >
                Próxima
              </button>
            </div>
          </>
        ) : (
          <EmptyState text="Nenhum registro com esses filtros." />
        )}
      </div>
    </section>
  );
}
