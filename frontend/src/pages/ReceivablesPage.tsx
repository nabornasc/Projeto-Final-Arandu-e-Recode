import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { ReceivablesSettleModal, type SettleTarget } from '../actions/ReceivablesSettleModal.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import { ListFilters, ListTotals } from '../components/ListFilters.tsx';
import { useToast } from '../components/Toast.tsx';
import { api } from '../lib/api.ts';
import { can, useProfile } from '../lib/auth.ts';
import { formatCode, formatDate, formatMoney, todayIso } from '../lib/format.ts';
import { applyListFilters, useListFilters } from '../lib/listFilters.ts';

interface Receivable {
  id: number;
  orderId: number;
  number: number;
  customerName: string | null;
  position: number;
  titleCount: number;
  dueDate: string;
  amount: number;
  paidAmount: number;
  received: number;
  method: string | null;
  status: 'open' | 'settled';
}

const STATUSES = [
  ['open', 'Em aberto'],
  ['settled', 'Recebida'],
] as const;

const partLabel = (item: Receivable) =>
  item.titleCount > 1 ? `${item.position}/${item.titleCount}` : 'Única';
const titleOf = (item: Receivable) =>
  `pedido ${formatCode(item.number)}${item.titleCount > 1 ? `, parcela ${partLabel(item)}` : ''}`;
const balanceOf = (row: Receivable) => Math.round((row.amount - row.paidAmount) * 100) / 100;
const sum = (rows: Receivable[], value: (row: Receivable) => number) =>
  rows.reduce((total, row) => total + value(row), 0);

// Contas de pedidos não cancelados. Cada parcela recebe a sua baixa, e o valor entra no caixa.
export default function ReceivablesPage() {
  const profile = useProfile();
  const notify = useToast();
  const client = useQueryClient();
  const [settling, setSettling] = useState<Receivable[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(new Set());
  const canSettle = can(profile, 'receivables.settle');
  const list = useQuery({ queryKey: ['/receivables'], queryFn: () => api<Receivable[]>('/receivables') });
  const control = useListFilters({ status: 'open' });
  const loaded = list.data?.length ?? 0;
  const visible = applyListFilters(list.data ?? [], control.filters, {
    date: (item) => item.dueDate,
    status: (item) => item.status,
    text: (item) => [item.customerName, formatCode(item.number), item.number, item.method],
  });
  const today = todayIso();
  const isOverdue = (item: Receivable) => item.status === 'open' && item.dueDate < today;
  const open = visible.filter((item) => item.status === 'open');
  const selected = open.filter((item) => selectedIds.has(item.id));
  const toggle = (ids: number[], on: boolean) =>
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  const targets: SettleTarget[] = (settling ?? []).map((item) => ({
    id: item.id,
    label: titleOf(item),
    customerName: item.customerName,
    balance: balanceOf(item),
  }));

  return (
    <section>
      <div className="section-heading page-heading">
        <div>
          <span className="welcome-label">FINANCEIRO</span>
          <h2>Contas a receber</h2>
          <p>Parcelas e pedidos aguardando pagamento. Ao dar baixa, o valor entra no caixa.</p>
        </div>
      </div>

      {loaded > 0 && (
        <ListFilters
          control={control}
          dateLabel="Vencimento"
          textLabel="Cliente ou número"
          statuses={STATUSES}
        />
      )}

      {canSettle && selected.length > 0 && (
        <div className="list-selection">
          <span>
            {selected.length} selecionada{selected.length > 1 ? 's' : ''} ·{' '}
            <strong>{formatMoney(sum(selected, balanceOf))}</strong>
          </span>
          <button type="button" className="button primary" onClick={() => setSettling(selected)}>
            Dar baixa nas selecionadas
          </button>
        </div>
      )}

      <div className="panel table-panel">
        {list.isPending ? (
          <div className="loading">Carregando...</div>
        ) : list.isError ? (
          <EmptyState text={list.error.message} />
        ) : visible.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {canSettle && (
                    <th className="select-cell">
                      <input
                        type="checkbox"
                        aria-label="Selecionar todas as contas em aberto"
                        disabled={!open.length}
                        checked={open.length > 0 && selected.length === open.length}
                        onChange={(event) =>
                          toggle(
                            open.map((item) => item.id),
                            event.target.checked,
                          )
                        }
                      />
                    </th>
                  )}
                  <th>Pedido</th>
                  <th>Parcela</th>
                  <th>Cliente</th>
                  <th>Vencimento</th>
                  <th>Forma</th>
                  <th>Valor</th>
                  <th>Saldo</th>
                  <th>Status</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => (
                  <tr key={item.id}>
                    {canSettle && (
                      <td className="select-cell">
                        {item.status === 'open' && (
                          <input
                            type="checkbox"
                            aria-label={`Selecionar ${titleOf(item)}`}
                            checked={selectedIds.has(item.id)}
                            onChange={(event) => toggle([item.id], event.target.checked)}
                          />
                        )}
                      </td>
                    )}
                    <td>
                      <Link className="link-cell" to={`/pedidos/${item.orderId}`}>
                        <strong>{formatCode(item.number)}</strong>
                      </Link>
                    </td>
                    <td>{partLabel(item)}</td>
                    <td>{item.customerName ?? 'Cliente não informado'}</td>
                    <td>{formatDate(item.dueDate)}</td>
                    <td>{item.method ?? '—'}</td>
                    <td>{formatMoney(item.amount)}</td>
                    <td>
                      <strong>{formatMoney(balanceOf(item))}</strong>
                    </td>
                    <td>
                      {item.status === 'settled' ? (
                        <span className="status paid">Recebida</span>
                      ) : isOverdue(item) ? (
                        <span className="status cancelled">Vencida</span>
                      ) : (
                        <span className="status pending">
                          {item.paidAmount > 0 ? 'Parcial' : 'Em aberto'}
                        </span>
                      )}
                      {isOverdue(item) && item.paidAmount > 0 && <small className="muted"> · parcial</small>}
                    </td>
                    <td className="actions">
                      {canSettle && item.status === 'open' && (
                        <button
                          type="button"
                          aria-label={`Dar baixa: ${titleOf(item)}`}
                          onClick={() => setSettling([item])}
                        >
                          Dar baixa
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            text={
              control.active ? 'Nenhum registro com esses filtros.' : 'Nenhum valor a receber. Tudo em dia!'
            }
          />
        )}
      </div>

      {loaded > 0 && (
        <ListTotals
          count={visible.length}
          loaded={loaded}
          totals={[
            { label: 'Valor total', value: sum(visible, (row) => row.amount) },
            { label: 'Recebido', value: sum(visible, (row) => row.received) },
            { label: 'Em aberto', value: sum(open, balanceOf) },
            { label: 'Vencido', value: sum(open.filter(isOverdue), balanceOf) },
          ]}
        />
      )}

      {settling && (
        <ReceivablesSettleModal
          targets={targets}
          onClose={() => setSettling(null)}
          onSettled={() => {
            const [first] = settling;
            notify(
              settling.length === 1 && first
                ? `Baixa do ${titleOf(first)} registrada no caixa.`
                : `Baixa de ${settling.length} contas registrada no caixa.`,
            );
            setSettling(null);
            toggle(
              settling.map((item) => item.id),
              false,
            );
            void client.invalidateQueries();
          }}
        />
      )}
    </section>
  );
}
