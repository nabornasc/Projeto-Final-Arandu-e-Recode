import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { Modal } from '../components/Modal.tsx';

export interface ReasonRequest {
  eyebrow: string;
  title: string;
  description?: string;
  confirmLabel: string;
  suggestions: string[];
  // Operação sensível: também pede a senha de quem está logado.
  withPassword?: boolean;
  submit: (reason: string, password: string) => Promise<unknown>;
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
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => request.submit(reason.trim(), password),
    onSuccess: onDone,
    onError: (err) => setError(err.message),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!reason.trim()) return setError('Informe o motivo.');
    if (request.withPassword && !password) return setError('Informe a sua senha.');
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
          {request.withPassword && (
            <label className="full-row">
              Sua senha de login
              <input
                type="password"
                name="confirmPassword"
                autoComplete="current-password"
                maxLength={128}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
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
