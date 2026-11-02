import { type QuoteStatus, quoteConvertSchema, quoteSchema } from '@arandue/shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link, useOutletContext } from 'react-router';
import { EmptyState } from '../components/EmptyState.tsx';
import { useAccountOptions } from '../components/FormModal.tsx';
import {
  ItemLines,
  type Line,
  linesSubtotal,
  linesToItems,
  newLine,
  type Product,
} from '../components/ItemLines.tsx';
import { Modal } from '../components/Modal.tsx';
import { useToast } from '../components/Toast.tsx';
import { api } from '../lib/api.ts';
import { can, type Profile } from '../lib/auth.ts';
import { formatCode, formatDate, formatMoney, label, todayIso } from '../lib/format.ts';

interface Quote {
  id: number;
  number: number;
  customerId: number | null;
  customerName: string | null;
  status: QuoteStatus;
  discount: number;
  total: number;
  validUntil: string | null;
  notes: string | null;
  orderNumber: number | null;
  items: { id: number; productId: number; productName: string; quantity: number; unitPrice: number }[];
}
interface Customer {
  id: number;
  name: string;
}

type Transition = 'send' | 'approve' | 'reject';
const DONE: Record<Transition, string> = {
  send: 'Orçamento enviado.',
  approve: 'Orçamento aprovado. Já pode virar pedido.',
  reject: 'Orçamento recusado.',
};

export default function QuotesPage() {
  const profile = useOutletContext<Profile>();
  const notify = useToast();
  const client = useQueryClient();
  const [form, setForm] = useState<{ quote: Quote | null } | null>(null);
  const [converting, setConverting] = useState<Quote | null>(null);
  const allowed = {
    create: can(profile, 'quotes.create'),
    update: can(profile, 'quotes.update'),
    send: can(profile, 'quotes.send'),
    approve: can(profile, 'quotes.approve'),
    convert: can(profile, 'quotes.convert'),
    settle: can(profile, 'receivables.settle'),
    delete: can(profile, 'quotes.delete'),
  };

  const quotes = useQuery({ queryKey: ['/quotes'], queryFn: () => api<Quote[]>('/quotes') });

  const changed = (message: string) => {
    void client.invalidateQueries();
    notify(message);
  };

  const transition = useMutation({
    mutationFn: ({ id, name }: { id: number; name: Transition }) =>
      api(`/quotes/${id}/${name}`, { method: 'POST' }),
    onSuccess: (_data, { name }) => changed(DONE[name]),
    onError: (error) => notify(error.message, 'error'),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api(`/quotes/${id}`, { method: 'DELETE' }),
    onSuccess: () => changed('Orçamento excluído.'),
    onError: (error) => notify(error.message, 'error'),
  });

  const busy = transition.isPending || remove.isPending;

  return (
    <section>
      <div className="section-heading page-heading">
        <div>
          <span className="welcome-label">VENDAS</span>
          <h2>Orçamentos</h2>
          <p>Monte a proposta, envie ao cliente e, aprovada, transforme em pedido.</p>
        </div>
        {allowed.create && (
          <button type="button" className="button primary" onClick={() => setForm({ quote: null })}>
            <Plus size={17} /> Novo orçamento
          </button>
        )}
      </div>

      <div className="panel table-panel">
        {quotes.isPending ? (
          <div className="loading">Carregando orçamentos...</div>
        ) : quotes.isError ? (
          <EmptyState text={quotes.error.message} />
        ) : quotes.data.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Orçamento</th>
                  <th>Cliente</th>
                  <th>Validade</th>
                  <th>Itens</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {quotes.data.map((quote) => {
                  const code = formatCode(quote.number);
                  const summary = quote.items
                    .map((item) => `${item.quantity}x ${item.productName}`)
                    .join(', ');
                  return (
                    <tr key={quote.id}>
                      <td>
                        <strong>{code}</strong>
                      </td>
                      <td>{quote.customerName ?? 'Cliente não informado'}</td>
                      <td>{formatDate(quote.validUntil)}</td>
                      <td title={summary} className="truncate">
                        {summary}
                      </td>
                      <td>
                        <span className={`status ${quote.status}`}>{label(quote.status)}</span>
                      </td>
                      <td>
                        <strong>{formatMoney(quote.total)}</strong>
                      </td>
                      <td className="actions">
                        {quote.status === 'draft' && (
                          <>
                            {allowed.update && (
                              <button type="button" disabled={busy} onClick={() => setForm({ quote })}>
                                Editar
                              </button>
                            )}
                            {allowed.send && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => transition.mutate({ id: quote.id, name: 'send' })}
                              >
                                Enviar
                              </button>
                            )}
                          </>
                        )}
                        {quote.status === 'sent' && allowed.approve && (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => transition.mutate({ id: quote.id, name: 'approve' })}
                            >
                              Aprovar
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                window.confirm(`Recusar o orçamento ${code}?`) &&
                                transition.mutate({ id: quote.id, name: 'reject' })
                              }
                            >
                              Recusar
                            </button>
                          </>
                        )}
                        {quote.status === 'sent' && !allowed.approve && (
                          <span className="read-only-note">Aguardando aprovação</span>
                        )}
                        {quote.orderNumber !== null ? (
                          <Link className="link-button" to="/pedidos">
                            Pedido {formatCode(quote.orderNumber)}
                          </Link>
                        ) : (
                          <>
                            {quote.status === 'approved' && allowed.convert && (
                              <button type="button" disabled={busy} onClick={() => setConverting(quote)}>
                                Converter em pedido
                              </button>
                            )}
                            {allowed.delete && (
                              <button
                                type="button"
                                className="delete"
                                aria-label={`Excluir orçamento ${code}`}
                                disabled={busy}
                                onClick={() =>
                                  window.confirm(`Excluir o orçamento ${code}?`) && remove.mutate(quote.id)
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
            text="Nenhum orçamento ainda."
            action={allowed.create ? 'Criar primeiro orçamento' : undefined}
            onClick={() => setForm({ quote: null })}
          />
        )}
      </div>

      {form && (
        <QuoteForm
          quote={form.quote}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            changed(form.quote ? 'Orçamento atualizado.' : 'Orçamento criado como rascunho.');
          }}
        />
      )}
      {converting && (
        <ConvertForm
          quote={converting}
          canSettle={allowed.settle}
          onClose={() => setConverting(null)}
          onConverted={(orderNumber) => {
            setConverting(null);
            changed(`Pedido ${formatCode(orderNumber)} criado e estoque atualizado.`);
          }}
        />
      )}
    </section>
  );
}

interface QuoteFormProps {
  quote: Quote | null;
  onClose: () => void;
  onSaved: () => void;
}

function QuoteForm({ quote, onClose, onSaved }: QuoteFormProps) {
  const products = useQuery({ queryKey: ['/products'], queryFn: () => api<Product[]>('/products') });
  const customers = useQuery({ queryKey: ['/customers'], queryFn: () => api<Customer[]>('/customers') });

  const [customerId, setCustomerId] = useState(quote?.customerId ? String(quote.customerId) : '');
  const [validUntil, setValidUntil] = useState(quote?.validUntil ?? '');
  const [discount, setDiscount] = useState(String(quote?.discount ?? 0));
  const [notes, setNotes] = useState(quote?.notes ?? '');
  const [lines, setLines] = useState<Line[]>(() =>
    quote ? quote.items.map((item) => newLine(item)) : [newLine()],
  );
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: unknown) =>
      quote ? api(`/quotes/${quote.id}`, { method: 'PUT', body }) : api('/quotes', { method: 'POST', body }),
    onSuccess: onSaved,
    onError: (err) => setError(err.message),
  });

  const subtotal = linesSubtotal(lines);
  const total = Math.max(0, subtotal - Number(discount || 0));

  function submit(event: FormEvent) {
    event.preventDefault();
    const payload = {
      customerId: customerId ? Number(customerId) : null,
      validUntil: validUntil || null,
      discount: Number(discount || 0),
      notes,
      items: linesToItems(lines),
    };
    const parsed = quoteSchema.safeParse(payload);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Verifique os campos.');
    setError(null);
    save.mutate(payload);
  }

  return (
    <Modal
      eyebrow="VENDAS"
      title={quote ? `Editar orçamento ${formatCode(quote.number)}` : 'Novo orçamento'}
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <label>
            Cliente
            <select
              name="customerId"
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
            >
              <option value="">Não informado</option>
              {customers.data?.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Válido até
            <input
              name="validUntil"
              type="date"
              value={validUntil}
              onChange={(event) => setValidUntil(event.target.value)}
            />
          </label>

          <ItemLines lines={lines} setLines={setLines} products={products.data} />

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
            Observações
            <input
              type="text"
              maxLength={500}
              placeholder="Ex.: prazo de entrega de 5 dias"
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
            <span>Total do orçamento:</span> <strong>{formatMoney(total)}</strong>
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
          <button className="button primary" type="submit" disabled={save.isPending}>
            {save.isPending ? 'Salvando...' : quote ? 'Salvar alterações' : 'Criar rascunho'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface ConvertFormProps {
  quote: Quote;
  // Sem permissão de baixa, o pedido nasce pendente e o financeiro recebe depois.
  canSettle: boolean;
  onClose: () => void;
  onConverted: (orderNumber: number) => void;
}

// A conversão baixa o estoque; se o pedido já nasce pago, também lança a entrada no caixa.
function ConvertForm({ quote, canSettle, onClose, onConverted }: ConvertFormProps) {
  const accounts = useAccountOptions();
  const [orderDate, setOrderDate] = useState(todayIso);
  const [status, setStatus] = useState<'pending' | 'paid'>('pending');
  const [bankAccountId, setBankAccountId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const convert = useMutation({
    mutationFn: (body: unknown) =>
      api<{ number: number }>(`/quotes/${quote.id}/convert`, { method: 'POST', body }),
    onSuccess: (order) => onConverted(order.number),
    onError: (err) => setError(err.message),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const payload = {
      orderDate,
      status,
      bankAccountId: status === 'paid' && bankAccountId ? Number(bankAccountId) : null,
    };
    const parsed = quoteConvertSchema.safeParse(payload);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Verifique os campos.');
    setError(null);
    convert.mutate(payload);
  }

  return (
    <Modal eyebrow="VENDAS" title={`Converter orçamento ${formatCode(quote.number)}`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <p className="read-only-note">
          {quote.items.length} {quote.items.length === 1 ? 'item' : 'itens'} · {formatMoney(quote.total)}. O
          estoque dos produtos é baixado agora.
        </p>
        <div className="form-grid">
          <label>
            Data da venda
            <input
              name="orderDate"
              type="date"
              required
              value={orderDate}
              onChange={(event) => setOrderDate(event.target.value)}
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
              {canSettle && <option value="paid">Pago (entra no caixa)</option>}
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
          <button className="button primary" type="submit" disabled={convert.isPending}>
            {convert.isPending ? 'Convertendo...' : 'Criar pedido'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
