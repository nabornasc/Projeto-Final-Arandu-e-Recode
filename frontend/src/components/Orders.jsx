import { useEffect, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { request } from '../services/api';
import { formatCell, formatMoney } from '../utils/formatters';
import { EmptyState } from './EmptyState';

export function Orders({ notify }) {
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [modal, setModal] = useState(false);
  const [loading, setLoading] = useState(true);

  // Estado do formulário de criação de pedido para cálculos em tempo real
  const [formCustomer, setFormCustomer] = useState('');
  const [formDate, setFormDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formProductId, setFormProductId] = useState('');
  const [formQuantity, setFormQuantity] = useState(1);
  const [formUnitPrice, setFormUnitPrice] = useState(0);
  const [formDiscount, setFormDiscount] = useState(0);
  const [formStatus, setFormStatus] = useState('pending');
  const [formAccountId, setFormAccountId] = useState('');
  const [formNotes, setFormNotes] = useState('');

  const load = () => {
    setLoading(true);
    request('/orders')
      .then(setOrders)
      .catch((e) => notify(e.message, 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    request('/products').then(setProducts).catch(() => {});
    request('/customers').then(setCustomers).catch(() => {});
    request('/bankAccounts').then(setAccounts).catch(() => {});
  }, []);

  function openModal() {
    const firstProduct = products[0];
    setFormCustomer('');
    setFormDate(new Date().toISOString().slice(0, 10));
    setFormProductId(firstProduct ? String(firstProduct.id) : '');
    setFormQuantity(1);
    setFormUnitPrice(firstProduct ? Number(firstProduct.price) : 0);
    setFormDiscount(0);
    setFormStatus('pending');
    setFormAccountId(accounts[0] ? String(accounts[0].id) : '');
    setFormNotes('');
    setModal(true);
  }

  function handleProductChange(productIdStr) {
    setFormProductId(productIdStr);
    const prod = products.find((p) => String(p.id) === String(productIdStr));
    if (prod) {
      setFormUnitPrice(Number(prod.price || 0));
    }
  }

  const liveSubtotal = Number(formQuantity || 0) * Number(formUnitPrice || 0);
  const liveTotal = Math.max(0, liveSubtotal - Number(formDiscount || 0));

  async function submit(event) {
    event.preventDefault();
    if (!formProductId) {
      notify('Selecione um produto ou serviço.', 'error');
      return;
    }

    try {
      await request('/orders', {
        method: 'POST',
        body: JSON.stringify({
          customer_id: formCustomer ? Number(formCustomer) : null,
          order_date: formDate,
          status: formStatus,
          discount: Number(formDiscount) || 0,
          notes: formNotes || null,
          bank_account_id: formStatus === 'paid' && formAccountId ? Number(formAccountId) : null,
          items: [
            {
              product_id: Number(formProductId),
              quantity: Number(formQuantity),
              unit_price: Number(formUnitPrice),
            },
          ],
        }),
      });

      setModal(false);
      notify('Pedido criado com sucesso!');
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
  }

  async function updateStatus(orderId, newStatus) {
    try {
      await request(`/orders/${orderId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus }),
      });
      notify(`Status do pedido atualizado para ${formatCell('status', newStatus)}.`);
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
  }

  async function removeOrder(orderId) {
    if (!window.confirm('Excluir este pedido? O estoque reservado será devolvido.')) return;
    try {
      await request(`/orders/${orderId}`, { method: 'DELETE' });
      notify('Pedido excluído com sucesso.');
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
  }

  return (
    <section>
      <div className="section-heading page-heading">
        <div>
          <span className="welcome-label">VENDAS</span>
          <h2>Vendas e pedidos</h2>
          <p>Registre cada oportunidade e acompanhe o recebimento e o estoque.</p>
        </div>
        <button className="button primary" onClick={openModal}>
          <Plus size={17} /> Novo pedido
        </button>
      </div>

      <div className="panel table-panel">
        {loading ? (
          <div className="loading">Carregando pedidos...</div>
        ) : orders.length ? (
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
                  <th>Alterar status</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {orders.map((row) => {
                  const itemsSummary = row.items?.length
                    ? row.items.map((i) => `${i.quantity}x ${i.product_name || 'Item'}`).join(', ')
                    : 'Sem itens';

                  return (
                    <tr key={row.id}>
                      <td>
                        <strong>#{String(row.id).padStart(3, '0')}</strong>
                      </td>
                      <td>{row.customer_name || 'Cliente não informado'}</td>
                      <td>{formatCell('order_date', row.order_date)}</td>
                      <td title={itemsSummary} style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {itemsSummary}
                      </td>
                      <td>
                        <span className={`status ${row.status}`}>{formatCell('status', row.status)}</span>
                      </td>
                      <td>
                        <strong>{formatMoney(row.total)}</strong>
                      </td>
                      <td>
                        <select
                          className="status-select"
                          value={row.status}
                          onChange={(e) => updateStatus(row.id, e.target.value)}
                        >
                          <option value="pending">Pendente</option>
                          <option value="paid">Pago</option>
                          <option value="cancelled">Cancelado</option>
                        </select>
                      </td>
                      <td className="actions">
                        <button
                          className="delete"
                          title="Excluir pedido"
                          onClick={() => removeOrder(row.id)}
                        >
                          <Trash2 size={16} />
                        </button>
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
            action="Criar primeiro pedido"
            onClick={openModal}
          />
        )}
      </div>

      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => e.target === e.currentTarget && setModal(false)}
        >
          <div className="modal">
            <div className="modal-header">
              <div>
                <span className="welcome-label">VENDAS</span>
                <h3>Novo pedido</h3>
              </div>
              <button onClick={() => setModal(false)} aria-label="Fechar janela">
                <X size={19} />
              </button>
            </div>

            <form onSubmit={submit}>
              <div className="form-grid">
                <label>
                  Cliente
                  <select
                    value={formCustomer}
                    onChange={(e) => setFormCustomer(e.target.value)}
                  >
                    <option value="">Não informado (venda avulsa)</option>
                    {customers.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Data da venda
                  <input
                    required
                    type="date"
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                  />
                </label>

                <label>
                  Produto ou serviço
                  <select
                    required
                    value={formProductId}
                    onChange={(e) => handleProductChange(e.target.value)}
                  >
                    <option value="">Selecione um item</option>
                    {products.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} {item.stock !== null ? `(Estoque: ${item.stock})` : '(Serviço)'} — {formatMoney(item.price)}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Quantidade
                  <input
                    required
                    min="0.01"
                    step="0.01"
                    type="number"
                    value={formQuantity}
                    onChange={(e) => setFormQuantity(Number(e.target.value))}
                  />
                </label>

                <label>
                  Preço unitário (R$)
                  <input
                    required
                    min="0"
                    step="0.01"
                    type="number"
                    value={formUnitPrice}
                    onChange={(e) => setFormUnitPrice(Number(e.target.value))}
                  />
                </label>

                <label>
                  Desconto (R$)
                  <input
                    min="0"
                    step="0.01"
                    type="number"
                    value={formDiscount}
                    onChange={(e) => setFormDiscount(Number(e.target.value))}
                  />
                </label>

                <label>
                  Status do pedido
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value)}
                  >
                    <option value="pending">Pendente (a receber)</option>
                    <option value="paid">Pago (baixa imediata)</option>
                  </select>
                </label>

                {formStatus === 'paid' && (
                  <label>
                    Conta de recebimento
                    <select
                      value={formAccountId}
                      onChange={(e) => setFormAccountId(e.target.value)}
                    >
                      <option value="">Conta padrão ativa</option>
                      {accounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.bank_name} — {acc.account_name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <label style={{ gridColumn: 'span 2' }}>
                  Observações adicionais
                  <input
                    type="text"
                    placeholder="Ex: Entregar até sexta-feira, embalagem para presente..."
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                  />
                </label>
              </div>

              <div className="order-summary-box">
                <div>
                  <span>Subtotal:</span> <strong>{formatMoney(liveSubtotal)}</strong>
                </div>
                {Number(formDiscount) > 0 && (
                  <div>
                    <span>Desconto:</span> <strong>- {formatMoney(formDiscount)}</strong>
                  </div>
                )}
                <div className="order-total-highlight">
                  <span>Total do Pedido:</span> <strong>{formatMoney(liveTotal)}</strong>
                </div>
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setModal(false)}
                >
                  Cancelar
                </button>
                <button className="button primary" type="submit">
                  Criar pedido
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

