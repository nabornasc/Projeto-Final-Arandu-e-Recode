import { ORDER_STATUSES } from '@arandue/shared/schemas';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router';
import { ActionMenu } from '../actions/ActionMenu.tsx';
import { orderActions } from '../actions/registry.ts';
import { EmptyState } from '../components/EmptyState.tsx';
import { ListFilters, ListTotals } from '../components/ListFilters.tsx';
import { api } from '../lib/api.ts';
import { can, useProfile } from '../lib/auth.ts';
import type { Order } from '../lib/documents.ts';
import { formatCode, formatDate, formatMoney, label } from '../lib/format.ts';
import { applyListFilters, useListFilters } from '../lib/listFilters.ts';

const STATUSES = ORDER_STATUSES.map((status) => [status, label(status)] as const);

export default function OrdersPage() {
  const profile = useProfile();
  const navigate = useNavigate();
  const canCreate = can(profile, 'orders.create');
  const orders = useQuery({ queryKey: ['/orders'], queryFn: () => api<Order[]>('/orders') });
  const control = useListFilters();
  const loaded = orders.data?.length ?? 0;
  const visible = applyListFilters(orders.data ?? [], control.filters, {
    date: (order) => order.orderDate,
    status: (order) => order.status,
    text: (order) => [order.customerName, formatCode(order.number), order.number],
  });
  // Pedido cancelado não é venda.
  const sold = visible.filter((order) => order.status !== 'cancelled');

  return (
    <section>
      <div className="section-heading page-heading">
        <div>
          <span className="welcome-label">VENDAS</span>
          <h2>Vendas e pedidos</h2>
          <p>Registre cada venda e acompanhe o recebimento e o estoque.</p>
        </div>
        {canCreate && (
          <button type="button" className="button primary" onClick={() => navigate('/pedidos/novo')}>
            <Plus size={17} /> Novo pedido
          </button>
        )}
      </div>

      {loaded > 0 && (
        <ListFilters
          control={control}
          dateLabel="Data do pedido"
          textLabel="Cliente ou número"
          statuses={STATUSES}
        />
      )}

      <div className="panel table-panel">
        {orders.isPending ? (
          <div className="loading">Carregando pedidos...</div>
        ) : orders.isError ? (
          <EmptyState text={orders.error.message} />
        ) : visible.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Cliente</th>
                  <th>Data</th>
                  <th>Itens</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {visible.map((order) => {
                  const code = formatCode(order.number);
                  const summary = order.items
                    .map((item) => `${item.quantity}x ${item.productName}`)
                    .join(', ');
                  return (
                    <tr key={order.id}>
                      <td>
                        <button
                          type="button"
                          className="link-cell"
                          onClick={() => navigate(`/pedidos/${order.id}`)}
                        >
                          {code}
                        </button>
                      </td>
                      <td>{order.customerName ?? 'Cliente não informado'}</td>
                      <td>{formatDate(order.orderDate)}</td>
                      <td title={summary} className="truncate">
                        {summary}
                      </td>
                      <td>
                        <span className={`status ${order.status}`}>{label(order.status)}</span>
                        {order.status === 'pending' &&
                          order.receivables.some((item) => item.paidAmount > 0) && (
                            <small className="muted"> · parcial</small>
                          )}
                      </td>
                      <td>
                        <strong>{formatMoney(order.total)}</strong>
                      </td>
                      <td className="actions">
                        <ActionMenu actions={orderActions} record={order} label={`pedido ${code}`} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            text={loaded ? 'Nenhum registro com esses filtros.' : 'Nenhum pedido cadastrado ainda.'}
            action={canCreate && !loaded ? 'Criar primeiro pedido' : undefined}
            onClick={() => navigate('/pedidos/novo')}
          />
        )}
      </div>

      {loaded > 0 && (
        <ListTotals
          count={visible.length}
          loaded={loaded}
          totals={[
            { label: 'Valor total', value: sold.reduce((sum, order) => sum + order.total, 0) },
            {
              label: 'Em aberto',
              value: sold
                .filter((order) => order.status === 'pending')
                .reduce((sum, order) => sum + order.total, 0),
            },
          ]}
        />
      )}
    </section>
  );
}
