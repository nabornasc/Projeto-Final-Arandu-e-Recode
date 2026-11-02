import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useAccountOptions } from '../components/FormModal.tsx';
import { Modal } from '../components/Modal.tsx';
import { api } from '../lib/api.ts';
import { formatCode, formatMoney } from '../lib/format.ts';

// Baixa de um pedido pendente: vira "pago" e o valor entra no caixa.
interface Props {
  receivable: { id: number; number: number; customerName: string | null; total: number };
  onClose: () => void;
  onSettled: () => void;
}

export function SettleModal({ receivable, onClose, onSettled }: Props) {
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
