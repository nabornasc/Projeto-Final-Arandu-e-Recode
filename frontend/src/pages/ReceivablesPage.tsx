import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { SettleModal } from '../actions/SettleModal.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import { ListFilters, ListTotals } from '../components/ListFilters.tsx';
import { useToast } from '../components/Toast.tsx';
import { api } from '../lib/api.ts';
import { can, useProfile } from '../lib/auth.ts';
import { formatCode, formatDate, formatMoney } from '../lib/format.ts';
import { applyListFilters, useListFilters } from '../lib/listFilters.ts';

interface Receivable {
  id: number;
  number: number;
  customerName: string | null;
  orderDate: string;
  total: number;
  items: { id: number; productName: string; quantity: number }[];
}

// Pedidos pendentes de toda a empresa. Dar baixa marca como pago e lança a entrada no caixa.
export default function ReceivablesPage() {
  const profile = useProfile();
  const notify = useToast();
  const client = useQueryClient();
  const [settling, setSettling] = useState<Receivable | null>(null);
  const canSettle = can(profile, 'receivables.settle');
  const list = useQuery({ queryKey: ['/receivables'], queryFn: () => api<Receivable[]>('/receivables') });
  const total = (list.data ?? []).reduce((sum, item) => sum + item.total, 0);
  const control = useListFilters();
  const loaded = list.data?.length ?? 0;
  const visible = applyListFilters(list.data ?? [], control.filters, {
    date: (item) => item.orderDate,
    text: (item) => [item.customerName, formatCode(item.number), item.number],
  });

  return (
    <section>
      <div className="section-heading page-heading">
        <div>
          <span className="welcome-label">FINANCEIRO</span>
          <h2>Contas a receber</h2>
          <p>Pedidos aguardando pagamento. Ao dar baixa, o valor entra no caixa.</p>
        </div>
        {list.data?.length ? (
          <span className="read-only-note">
            {list.data.length} {list.data.length === 1 ? 'pedido' : 'pedidos'} · {formatMoney(total)}
          </span>
        ) : null}
      </div>

      {loaded > 0 && (
        <ListFilters control={control} dateLabel="Data do pedido" textLabel="Cliente ou número" />
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
                  <th>Cliente</th>
                  <th>Data</th>
                  <th>Itens</th>
                  <th>Valor</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => {
                  const summary = item.items
                    .map((line) => `${line.quantity}x ${line.productName}`)
                    .join(', ');
                  return (
                    <tr key={item.id}>
                      <td>
                        <strong>{formatCode(item.number)}</strong>
                      </td>
                      <td>{item.customerName ?? 'Cliente não informado'}</td>
                      <td>{formatDate(item.orderDate)}</td>
                      <td title={summary} className="truncate">
                        {summary}
                      </td>
                      <td>
                        <strong>{formatMoney(item.total)}</strong>
                      </td>
                      <td className="actions">
                        {canSettle && (
                          <button type="button" onClick={() => setSettling(item)}>
                            Dar baixa
                          </button>
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
            text={loaded ? 'Nenhum registro com esses filtros.' : 'Nenhum valor a receber. Tudo em dia!'}
          />
        )}
      </div>

      {loaded > 0 && (
        <ListTotals
          count={visible.length}
          loaded={loaded}
          totals={[{ label: 'Valor total', value: visible.reduce((sum, item) => sum + item.total, 0) }]}
        />
      )}

      {settling && (
        <SettleModal
          receivable={settling}
          onClose={() => setSettling(null)}
          onSettled={() => {
            setSettling(null);
            void client.invalidateQueries();
            notify(`Baixa do pedido ${formatCode(settling.number)} registrada no caixa.`);
          }}
        />
      )}
    </section>
  );
}
