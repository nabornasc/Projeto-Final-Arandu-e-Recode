import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { Modal } from '../components/Modal.tsx';

export interface ReasonRequest {
  eyebrow: string;
  title: string;
  description?: string;
  confirmLabel: string;
  suggestions: string[];
  submit: (reason: string) => Promise<unknown>;
  message: string;
}

interface Props {
  request: ReasonRequest;
  onClose: () => void;
  onDone: () => void;
}

// Recusar e cancelar exigem o motivo, que fica registrado no histórico do documento.
export function ReasonModal({ request, onClose, onDone }: Props) {
  const listId = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => request.submit(reason.trim()),
    onSuccess: onDone,
    onError: (err) => setError(err.message),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!reason.trim()) return setError('Informe o motivo.');
    setError(null);
    save.mutate();
  }

  return (
    <Modal eyebrow={request.eyebrow} title={request.title} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        {request.description && <p className="muted">{request.description}</p>}
        <div className="form-grid">
          <label className="full-row">
            Motivo
            <input
              name="reason"
              list={listId}
              maxLength={255}
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <datalist id={listId}>
              {request.suggestions.map((item) => (
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
            Voltar
          </button>
          <button className="button primary" type="submit" disabled={save.isPending}>
            {save.isPending ? 'Salvando...' : request.confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
