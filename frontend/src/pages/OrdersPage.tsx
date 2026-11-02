import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router';
import { ActionMenu } from '../actions/ActionMenu.tsx';
import { orderActions } from '../actions/registry.ts';
import { EmptyState } from '../components/EmptyState.tsx';
import { api } from '../lib/api.ts';
import { can, useProfile } from '../lib/auth.ts';
import type { Order } from '../lib/documents.ts';
import { formatCode, formatDate, formatMoney, label } from '../lib/format.ts';

export default function OrdersPage() {
  const profile = useProfile();
  const navigate = useNavigate();
  const canCreate = can(profile, 'orders.create');
  const orders = useQuery({ queryKey: ['/orders'], queryFn: () => api<Order[]>('/orders') });

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

      <div className="panel table-panel">
        {orders.isPending ? (
          <div className="loading">Carregando pedidos...</div>
        ) : orders.isError ? (
          <EmptyState text={orders.error.message} />
        ) : orders.data.length ? (
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
                {orders.data.map((order) => {
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
            text="Nenhum pedido cadastrado ainda."
            action={canCreate ? 'Criar primeiro pedido' : undefined}
            onClick={() => navigate('/pedidos/novo')}
          />
        )}
      </div>
    </section>
  );
}
