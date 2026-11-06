import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useAccountOptions } from '../components/FormModal.tsx';
import { Modal } from '../components/Modal.tsx';
import { api } from '../lib/api.ts';
import { formatMoney, todayIso } from '../lib/format.ts';

// Baixa de uma parcela ou de tudo o que falta em um pedido: o valor entra no caixa na data informada.
interface Props {
  title: string;
  customerName: string | null;
  amount: number;
  endpoint: string;
  onClose: () => void;
  onSettled: () => void;
}

export function SettleModal({ title, customerName, amount, endpoint, onClose, onSettled }: Props) {
  const accounts = useAccountOptions();
  const [bankAccountId, setBankAccountId] = useState('');
  const [settledOn, setSettledOn] = useState(todayIso);
  const [error, setError] = useState<string | null>(null);

  const settle = useMutation({
    mutationFn: (body: unknown) => api(endpoint, { method: 'POST', body }),
    onSuccess: onSettled,
    onError: (err) => setError(err.message),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    settle.mutate({ bankAccountId: bankAccountId ? Number(bankAccountId) : null, settledOn });
  }

  return (
    <Modal eyebrow="FINANCEIRO" title={title} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <p className="read-only-note">
          {customerName ?? 'Cliente não informado'} · {formatMoney(amount)}
        </p>
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
