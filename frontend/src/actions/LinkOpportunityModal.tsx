import { useMutation, useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Modal } from '../components/Modal.tsx';
import { api } from '../lib/api.ts';
import type { Opportunity, Order, Quote } from '../lib/documents.ts';
import { formatCode } from '../lib/format.ts';

interface Props {
  type: 'quote' | 'order';
  document: Quote | Order;
  onClose: () => void;
  onLinked: () => void;
}

// Vincula um documento a uma oportunidade em andamento; o vínculo desce para o que nasceu dele.
export function LinkOpportunityModal({ type, document, onClose, onLinked }: Props) {
  const options = useQuery({
    queryKey: ['/opportunities', 'open'],
    queryFn: () => api<{ items: Opportunity[] }>('/opportunities?status=open'),
  });
  const [opportunityId, setOpportunityId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const label = type === 'quote' ? 'orçamento' : 'pedido';

  const link = useMutation({
    mutationFn: () =>
      api(`/${type === 'quote' ? 'quotes' : 'orders'}/${document.id}/link`, {
        method: 'POST',
        body: { opportunityId: Number(opportunityId) },
      }),
    onSuccess: onLinked,
    onError: (err) => setError(err.message),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!opportunityId) return setError('Escolha a oportunidade.');
    setError(null);
    link.mutate();
  }

  const choices = (options.data?.items ?? []).filter((item) => item.id !== document.opportunityId);

  return (
    <Modal eyebrow="RASTREIO" title={`Vincular ${label} ${formatCode(document.number)}`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <label className="full-row">
            Oportunidade em andamento
            <select
              name="opportunityId"
              value={opportunityId}
              onChange={(event) => setOpportunityId(event.target.value)}
            >
              <option value="">Selecione</option>
              {choices.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                  {item.customerName ? ` — ${item.customerName}` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="read-only-note">
          Os documentos que nasceram deste entram junto, se não estiverem em outra oportunidade.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancelar
          </button>
          <button className="button primary" type="submit" disabled={link.isPending}>
            {link.isPending ? 'Vinculando...' : 'Vincular'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
