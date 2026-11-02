import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useOutletContext } from 'react-router';
import { EmptyState } from '../components/EmptyState.tsx';
import { useAccountOptions } from '../components/FormModal.tsx';
import { Modal } from '../components/Modal.tsx';
import { useToast } from '../components/Toast.tsx';
import { api } from '../lib/api.ts';
import { can, type Profile } from '../lib/auth.ts';
import { formatCode, formatDate, formatMoney } from '../lib/format.ts';

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
  const profile = useOutletContext<Profile>();
  const notify = useToast();
  const client = useQueryClient();
  const [settling, setSettling] = useState<Receivable | null>(null);
  const canSettle = can(profile, 'receivables.settle');
  const list = useQuery({ queryKey: ['/receivables'], queryFn: () => api<Receivable[]>('/receivables') });
  const total = (list.data ?? []).reduce((sum, item) => sum + item.total, 0);

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

      <div className="panel table-panel">
        {list.isPending ? (
          <div className="loading">Carregando...</div>
        ) : list.isError ? (
          <EmptyState text={list.error.message} />
        ) : list.data.length ? (
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
                {list.data.map((item) => {
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
          <EmptyState text="Nenhum valor a receber. Tudo em dia!" />
        )}
      </div>

      {settling && (
        <SettleForm
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

interface SettleFormProps {
  receivable: Receivable;
  onClose: () => void;
  onSettled: () => void;
}

function SettleForm({ receivable, onClose, onSettled }: SettleFormProps) {
  const accounts = useAccountOptions();
  const [bankAccountId, setBankAccountId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const settle = useMutation({
    mutationFn: (body: unknown) => api(`/receivables/${receivable.id}/settle`, { method: 'POST', body }),
    onSuccess: onSettled,
    onError: (err) => setError(err.message),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    settle.mutate({ bankAccountId: bankAccountId ? Number(bankAccountId) : null });
  }

  return (
    <Modal
      eyebrow="FINANCEIRO"
      title={`Dar baixa no pedido ${formatCode(receivable.number)}`}
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate>
        <p className="read-only-note">
          {receivable.customerName ?? 'Cliente não informado'} · {formatMoney(receivable.total)}
        </p>
        <div className="form-grid">
          <label className="full-row">
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
          <button className="button primary" type="submit" disabled={settle.isPending}>
            {settle.isPending ? 'Registrando...' : 'Confirmar recebimento'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
