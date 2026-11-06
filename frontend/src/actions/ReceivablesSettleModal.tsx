import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useAccountOptions } from '../components/FormModal.tsx';
import { METHODS } from '../components/InstallmentsEditor.tsx';
import { Modal } from '../components/Modal.tsx';
import { api } from '../lib/api.ts';
import { formatMoney, todayIso } from '../lib/format.ts';

export interface SettleTarget {
  id: number;
  label: string;
  customerName: string | null;
  balance: number;
}

interface Row {
  // Sem valor digitado, o recebido acompanha o saldo, os juros e o desconto.
  received: string | null;
  interest: string;
  discount: string;
}

interface Props {
  targets: SettleTarget[];
  onClose: () => void;
  onSettled: () => void;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

function valuesOf(target: SettleTarget, row: Row) {
  const interest = Number(row.interest || 0);
  const discount = Number(row.discount || 0);
  const received =
    row.received === null ? round2(target.balance + interest - discount) : Number(row.received || 0);
  return { interest, discount, received, left: round2(target.balance - received + interest - discount) };
}

// Baixa em uma ou mais contas: cada uma pode ser parcial, com juros ou com desconto.
export function ReceivablesSettleModal({ targets, onClose, onSettled }: Props) {
  const accounts = useAccountOptions();
  const [bankAccountId, setBankAccountId] = useState('');
  const [settledOn, setSettledOn] = useState(todayIso);
  const [method, setMethod] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<Record<number, Row>>({});
  const [error, setError] = useState<string | null>(null);

  const rowOf = (id: number): Row => rows[id] ?? { received: null, interest: '', discount: '' };
  const change = (id: number, values: Partial<Row>) =>
    setRows((current) => ({ ...current, [id]: { ...rowOf(id), ...values } }));
  const total = round2(targets.reduce((sum, target) => sum + valuesOf(target, rowOf(target.id)).received, 0));

  const settle = useMutation({
    mutationFn: (body: unknown) => api('/receivables/settle', { method: 'POST', body }),
    onSuccess: onSettled,
    onError: (err) => setError(err.message),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    settle.mutate({
      bankAccountId: bankAccountId ? Number(bankAccountId) : null,
      settledOn,
      method,
      notes,
      items: targets.map((target) => {
        const { received, interest, discount } = valuesOf(target, rowOf(target.id));
        return { receivableId: target.id, received, interest, discount };
      }),
    });
  }

  return (
    <Modal
      wide
      eyebrow="FINANCEIRO"
      title={
        targets.length === 1 ? `Dar baixa: ${targets[0]?.label}` : `Dar baixa em ${targets.length} contas`
      }
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <label>
            Data do recebimento
            <input
              type="date"
              name="settledOn"
              required
              value={settledOn}
              onChange={(event) => setSettledOn(event.target.value)}
            />
          </label>
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
          <label>
            Forma de pagamento
            <select name="method" value={method} onChange={(event) => setMethod(event.target.value)}>
              <option value="">Forma prevista na conta</option>
              {METHODS.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            Observação
            <input
              name="notes"
              maxLength={255}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
        </div>

        <div className="table-wrap settle-table">
          <table className="items-table" aria-label="Contas da baixa">
            <thead>
              <tr>
                <th>Conta</th>
                <th>Saldo</th>
                <th>Juros</th>
                <th>Desconto</th>
                <th>Valor recebido</th>
                <th>Saldo final</th>
              </tr>
            </thead>
            <tbody>
              {targets.map((target) => {
                const row = rowOf(target.id);
                const values = valuesOf(target, row);
                return (
                  <tr key={target.id}>
                    <td>
                      {target.label}
                      <small className="muted settle-customer">
                        {target.customerName ?? 'Cliente não informado'}
                      </small>
                    </td>
                    <td>{formatMoney(target.balance)}</td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        aria-label={`Juros: ${target.label}`}
                        value={row.interest}
                        onChange={(event) => change(target.id, { interest: event.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        aria-label={`Desconto: ${target.label}`}
                        value={row.discount}
                        onChange={(event) => change(target.id, { discount: event.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        aria-label={`Valor recebido: ${target.label}`}
                        value={row.received ?? values.received}
                        onChange={(event) => change(target.id, { received: event.target.value })}
                      />
                    </td>
                    <td>
                      <strong>{formatMoney(values.left)}</strong>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="read-only-note">Total recebido: {formatMoney(total)}</p>

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
