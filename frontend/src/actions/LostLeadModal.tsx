import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Modal } from '../components/Modal.tsx';
import { api } from '../lib/api.ts';
import type { Lead } from '../lib/documents.ts';

// Perder um lead exige o motivo (alimenta a análise de perdas do CRM).
const SUGGESTIONS = [
  'Preço',
  'Prazo de entrega',
  'Escolheu concorrente',
  'Sem retorno',
  'Desistiu da compra',
];

interface Props {
  lead: Lead;
  onClose: () => void;
  onLost: () => void;
}

export function LostLeadModal({ lead, onClose, onLost }: Props) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const lose = useMutation({
    mutationFn: () =>
      api(`/leads/${lead.id}/stage`, { method: 'POST', body: { stage: 'lost', lostReason: reason } }),
    onSuccess: onLost,
    onError: (err) => setError(err.message),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!reason.trim()) return setError('Informe o motivo da perda.');
    setError(null);
    lose.mutate();
  }

  return (
    <Modal eyebrow="CRM" title={`Marcar ${lead.name} como perdido`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <label className="full-row">
            Motivo da perda
            <input
              name="lostReason"
              list="lost-reasons"
              maxLength={255}
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <datalist id="lost-reasons">
              {SUGGESTIONS.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
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
          <button className="button primary" type="submit" disabled={lose.isPending}>
            {lose.isPending ? 'Salvando...' : 'Marcar como perdido'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
