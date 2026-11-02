import { can } from '@arandue/shared/rbac';
import { type OrderStatus, orderCreateSchema } from '@arandue/shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useOutletContext } from 'react-router';
import { EmptyState } from '../components/EmptyState.tsx';
import { useAccountOptions } from '../components/FormModal.tsx';
import { Modal } from '../components/Modal.tsx';
import { useToast } from '../components/Toast.tsx';
import { api } from '../lib/api.ts';
import type { Profile } from '../lib/auth.ts';
import { formatCode, formatDate, formatMoney, label, todayIso } from '../lib/format.ts';

interface Order {
  id: number;
  number: number;
  customerName: string | null;
  orderDate: string;
  status: OrderStatus;
  total: number;
  items: { id: number; productName: string; quantity: number }[];
}
interface Product {
  id: number;
  name: string;
  price: number;
  stock: number | null;
}
interface Customer {
  id: number;
  name: string;
}
interface Line {
  key: number;
  productId: string;
  quantity: string;
  unitPrice: string;
}

const STATUS_OPTIONS: [OrderStatus, string][] = [
  ['pending', 'Pendente'],
  ['paid', 'Pago'],
  ['completed', 'Concluído'],
  ['cancelled', 'Cancelado'],
];

export default function OrdersPage() {
  const profile = useOutletContext<Profile>();
  const notify = useToast();
  const client = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const canCreate = can(profile.role, 'sales', 'create');
  const canUpdate = can(profile.role, 'sales', 'update');
  const canDelete = can(profile.role, 'sales', 'delete');

  const orders = useQuery({ queryKey: ['/orders'], queryFn: () => api<Order[]>('/orders') });

  const changed = (message: string) => {
    void client.invalidateQueries();
    notify(message);
  };

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: OrderStatus }) =>
      api(`/orders/${id}`, { method: 'PUT', body: { status } }),
    onSuccess: (_data, { status }) => changed(`Status do pedido atualizado para ${label(status)}.`),
    onError: (error) => notify(error.message, 'error'),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api(`/orders/${id}`, { method: 'DELETE' }),
    onSuccess: () => changed('Pedido excluído. O estoque foi devolvido.'),
    onError: (error) => notify(error.message, 'error'),
  });

  return (
    <section>
      <div className="section-heading page-heading">
        <div>
          <span className="welcome-label">VENDAS</span>
          <h2>Vendas e pedidos</h2>
          <p>Registre cada venda e acompanhe o recebimento e o estoque.</p>
        </div>
        {canCreate && (
          <button type="button" className="button primary" onClick={() => setModalOpen(true)}>
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
                  const summary = order.items
                    .map((item) => `${item.quantity}x ${item.productName}`)
                    .join(', ');
                  return (
                    <tr key={order.id}>
                      <td>
                        <strong>{formatCode(order.number)}</strong>
                      </td>
                      <td>{order.customerName ?? 'Cliente não informado'}</td>
                      <td>{formatDate(order.orderDate)}</td>
                      <td title={summary} className="truncate">
                        {summary || 'Sem itens'}
                      </td>
                      <td>
                        {canUpdate ? (
                          <select
                            className="status-select"
                            name={`status-${order.id}`}
                            aria-label={`Status do pedido ${formatCode(order.number)}`}
                            value={order.status}
                            disabled={updateStatus.isPending}
                            onChange={(event) =>
                              updateStatus.mutate({ id: order.id, status: event.target.value as OrderStatus })
                            }
                          >
                            {STATUS_OPTIONS.map(([value, text]) => (
                              <option key={value} value={value}>
                                {text}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className={`status ${order.status}`}>{label(order.status)}</span>
                        )}
                      </td>
                      <td>
                        <strong>{formatMoney(order.total)}</strong>
                      </td>
                      <td className="actions">
                        {canDelete && (
                          <button
                            type="button"
                            className="delete"
                            aria-label={`Excluir pedido ${formatCode(order.number)}`}
                            disabled={remove.isPending}
                            onClick={() =>
                              window.confirm('Excluir este pedido? O estoque será devolvido.') &&
                              remove.mutate(order.id)
                            }
                          >
                            <Trash2 size={16} />
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
            text="Nenhum pedido cadastrado ainda."
            action={canCreate ? 'Criar primeiro pedido' : undefined}
            onClick={() => setModalOpen(true)}
          />
        )}
      </div>

      {modalOpen && (
        <OrderForm
          onClose={() => setModalOpen(false)}
          onCreated={() => {
            setModalOpen(false);
            changed('Pedido criado com sucesso!');
          }}
        />
      )}
    </section>
  );
}

let lineKey = 0;
const newLine = (product?: Product): Line => ({
  key: ++lineKey,
  productId: product ? String(product.id) : '',
  quantity: '1',
  unitPrice: product ? String(product.price) : '0',
});

function OrderForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const products = useQuery({ queryKey: ['/products'], queryFn: () => api<Product[]>('/products') });
  const customers = useQuery({ queryKey: ['/customers'], queryFn: () => api<Customer[]>('/customers') });
  const accounts = useAccountOptions();

  const [customerId, setCustomerId] = useState('');
  const [orderDate, setOrderDate] = useState(todayIso);
  const [status, setStatus] = useState<'pending' | 'paid'>('pending');
  const [bankAccountId, setBankAccountId] = useState('');
  const [discount, setDiscount] = useState('0');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: unknown) => api('/orders', { method: 'POST', body }),
    onSuccess: onCreated,
    onError: (err) => setError(err.message),
  });

  const productById = new Map(products.data?.map((product) => [String(product.id), product]));
  const subtotal = lines.reduce(
    (sum, line) => sum + Number(line.quantity || 0) * Number(line.unitPrice || 0),
    0,
  );
  const total = Math.max(0, subtotal - Number(discount || 0));

  const updateLine = (key: number, patch: Partial<Line>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  function submit(event: FormEvent) {
    event.preventDefault();
    const payload = {
      customerId: customerId ? Number(customerId) : null,
      orderDate,
      status,
      discount: Number(discount || 0),
      notes,
      bankAccountId: status === 'paid' && bankAccountId ? Number(bankAccountId) : null,
      items: lines
        .filter((line) => line.productId)
        .map((line) => ({
          productId: Number(line.productId),
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
        })),
    };
    const parsed = orderCreateSchema.safeParse(payload);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Verifique os campos.');
    setError(null);
    create.mutate(payload);
  }

  return (
    <Modal eyebrow="VENDAS" title={'Novo pedido'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <label>
            Cliente
            <select
              name="customerId"
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
            >
              <option value="">Não informado (venda avulsa)</option>
              {customers.data?.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Data da venda
            <input
              name="orderDate"
              required
              type="date"
              value={orderDate}
              onChange={(event) => setOrderDate(event.target.value)}
            />
          </label>

          {lines.map((line, index) => (
            <div key={line.key} className="order-line">
              <label>
                {`Item ${index + 1}`}
                <select
                  name={`items.${index}.productId`}
                  value={line.productId}
                  onChange={(event) => {
                    const product = productById.get(event.target.value);
                    updateLine(line.key, {
                      productId: event.target.value,
                      unitPrice: String(product?.price ?? 0),
                    });
                  }}
                >
                  <option value="">Selecione</option>
                  {products.data?.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} {product.stock === null ? '(serviço)' : `(estoque: ${product.stock})`}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Qtd.
                <input
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  name={`items.${index}.quantity`}
                  value={line.quantity}
                  onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                />
              </label>
              <label>
                Preço (R$)
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  name={`items.${index}.unitPrice`}
                  value={line.unitPrice}
                  onChange={(event) => updateLine(line.key, { unitPrice: event.target.value })}
                />
              </label>
              <button
                type="button"
                className="button secondary"
                aria-label={`Remover item ${index + 1}`}
                disabled={lines.length === 1}
                onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <div className="full-row">
            <button
              type="button"
              className="button secondary"
              onClick={() => setLines((current) => [...current, newLine()])}
            >
              <Plus size={14} /> Adicionar item
            </button>
          </div>

          <label>
            Desconto (R$)
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              name="discount"
              value={discount}
              onChange={(event) => setDiscount(event.target.value)}
            />
          </label>
          <label>
            Status
            <select
              name="status"
              value={status}
              onChange={(event) => setStatus(event.target.value as 'pending' | 'paid')}
            >
              <option value="pending">Pendente (a receber)</option>
              <option value="paid">Pago (entra no caixa)</option>
            </select>
          </label>
          {status === 'paid' && (
            <label>
              Conta de recebimento
              <select
                name="bankAccountId"
                value={bankAccountId}
                onChange={(event) => setBankAccountId(event.target.value)}
              >
                <option value="">Conta padrão</option>
                {accounts.data?.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.bankName} — {account.accountName}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="full-row">
            Observações
            <input
              type="text"
              maxLength={500}
              placeholder="Ex.: entregar até sexta-feira"
              name="notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
        </div>

        <div className="order-summary-box">
          <div>
            <span>Subtotal:</span> <strong>{formatMoney(subtotal)}</strong>
          </div>
          {Number(discount) > 0 && (
            <div>
              <span>Desconto:</span> <strong>− {formatMoney(Number(discount))}</strong>
            </div>
          )}
          <div className="order-total-highlight">
            <span>Total do pedido:</span> <strong>{formatMoney(total)}</strong>
          </div>
        </div>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancelar
          </button>
          <button className="button primary" type="submit" disabled={create.isPending}>
            {create.isPending ? 'Salvando...' : 'Criar pedido'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
