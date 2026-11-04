import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Modal } from '../components/Modal.tsx';
import { api } from '../lib/api.ts';
import type { Order, Quote } from '../lib/documents.ts';
import { formatCode, todayIso } from '../lib/format.ts';

interface Props {
  type: 'quote' | 'order';
  document: Quote | Order;
  onClose: () => void;
  onDuplicated: (path: string, message: string) => void;
}

// Duplicar: a cópia sempre registra de onde veio; ficar na mesma oportunidade é opcional.
export function DuplicateModal({ type, document, onClose, onDuplicated }: Props) {
  const [keepOpportunity, setKeepOpportunity] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isQuote = type === 'quote';
  const label = isQuote ? 'orçamento' : 'pedido';

  const duplicate = useMutation({
    mutationFn: () =>
      api<{ id: number; number: number }>(`/${isQuote ? 'quotes' : 'orders'}/${document.id}/duplicate`, {
        method: 'POST',
        body: isQuote ? { keepOpportunity } : { keepOpportunity, orderDate: todayIso() },
      }),
    onSuccess: (copy) =>
      onDuplicated(
        `/${isQuote ? 'orcamentos' : 'pedidos'}/${copy.id}`,
        `${isQuote ? 'Orçamento' : 'Pedido'} ${formatCode(copy.number)} criado a partir do ${formatCode(document.number)}.`,
      ),
    onError: (err) => setError(err.message),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    duplicate.mutate();
  }

  return (
    <Modal eyebrow="DUPLICAR" title={`Duplicar ${label} ${formatCode(document.number)}`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <p className="read-only-note">
          {isQuote
            ? 'Será criado um novo rascunho com os mesmos itens e preços.'
            : 'Será criado um novo pedido pendente com os mesmos itens e preços. O estoque será baixado.'}
        </p>
        {document.opportunityId !== null && (
          <label className="checkbox duplicate-keep">
            <input
              type="checkbox"
              name="keepOpportunity"
              checked={keepOpportunity}
              onChange={(event) => setKeepOpportunity(event.target.checked)}
            />
            Manter na mesma oportunidade{document.opportunityTitle ? ` (${document.opportunityTitle})` : ''}
          </label>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancelar
          </button>
          <button className="button primary" type="submit" disabled={duplicate.isPending}>
            {duplicate.isPending ? 'Duplicando...' : 'Duplicar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
