import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { SettleModal } from '../actions/SettleModal.tsx';
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
const sum = (rows: Receivable[], value: (row: Receivable) => number) =>
  rows.reduce((total, row) => total + value(row), 0);

// Contas de pedidos não cancelados. Cada parcela recebe a sua baixa, e o valor entra no caixa.
export default function ReceivablesPage() {
  const profile = useProfile();
  const notify = useToast();
  const client = useQueryClient();
  const [settling, setSettling] = useState<Receivable | null>(null);
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
                    <td>
                      <strong>{formatCode(item.number)}</strong>
                    </td>
                    <td>{partLabel(item)}</td>
                    <td>{item.customerName ?? 'Cliente não informado'}</td>
                    <td>{formatDate(item.dueDate)}</td>
                    <td>{item.method ?? '—'}</td>
                    <td>{formatMoney(item.amount)}</td>
                    <td>
                      <strong>{formatMoney(item.amount - item.paidAmount)}</strong>
                    </td>
                    <td>
                      {item.status === 'settled' ? (
                        <span className="status paid">Recebida</span>
                      ) : isOverdue(item) ? (
                        <span className="status cancelled">Vencida</span>
                      ) : (
                        <span className="status pending">Em aberto</span>
                      )}
                    </td>
                    <td className="actions">
                      {canSettle && item.status === 'open' && (
                        <button
                          type="button"
                          aria-label={`Dar baixa: ${titleOf(item)}`}
                          onClick={() => setSettling(item)}
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
            { label: 'Recebido', value: sum(visible, (row) => row.paidAmount) },
            { label: 'Em aberto', value: sum(open, (row) => row.amount - row.paidAmount) },
            {
              label: 'Vencido',
              value: sum(open.filter(isOverdue), (row) => row.amount - row.paidAmount),
            },
          ]}
        />
      )}

      {settling && (
        <SettleModal
          title={`Dar baixa: ${titleOf(settling)}`}
          customerName={settling.customerName}
          amount={settling.amount - settling.paidAmount}
          endpoint={`/receivables/${settling.id}/settle`}
          onClose={() => setSettling(null)}
          onSettled={() => {
            setSettling(null);
            void client.invalidateQueries();
            notify(`Baixa do ${titleOf(settling)} registrada no caixa.`);
          }}
        />
      )}
    </section>
  );
}
