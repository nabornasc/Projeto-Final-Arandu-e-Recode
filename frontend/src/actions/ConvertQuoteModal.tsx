import { quoteConvertSchema } from '@arandue/shared/schemas';
import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useAccountOptions } from '../components/FormModal.tsx';
import { Modal } from '../components/Modal.tsx';
import { api } from '../lib/api.ts';
import type { Quote } from '../lib/documents.ts';
import { formatCode, formatMoney, todayIso } from '../lib/format.ts';

interface Props {
  quote: Quote;
  // Sem permissão de baixa, o pedido nasce pendente e o financeiro recebe depois.
  canSettle: boolean;
  onClose: () => void;
  onConverted: (order: { id: number; number: number }) => void;
}

// A conversão baixa o estoque; se o pedido já nasce pago, também lança a entrada no caixa.
export function ConvertQuoteModal({ quote, canSettle, onClose, onConverted }: Props) {
  const accounts = useAccountOptions();
  const [orderDate, setOrderDate] = useState(todayIso);
  const [status, setStatus] = useState<'pending' | 'paid'>('pending');
  const [bankAccountId, setBankAccountId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const convert = useMutation({
    mutationFn: (body: unknown) =>
      api<{ id: number; number: number }>(`/quotes/${quote.id}/convert`, { method: 'POST', body }),
    onSuccess: onConverted,
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
