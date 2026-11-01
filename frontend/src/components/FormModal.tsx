import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import type { ResourceConfig } from '../config/resources.ts';
import { api } from '../lib/api.ts';
import { todayIso } from '../lib/format.ts';
import { Modal } from './Modal.tsx';

export interface AccountOption {
  id: number;
  bankName: string;
  accountName: string;
}

export function useAccountOptions(enabled = true) {
  return useQuery({
    queryKey: ['bank-accounts', 'options'],
    queryFn: () => api<AccountOption[]>('/bank-accounts/options'),
    enabled,
  });
}

type Row = Record<string, unknown>;
type FormState = Record<string, string>;

function toFormState(config: ResourceConfig, initial: Row | null): FormState {
  return Object.fromEntries(
    config.fields.map((field) => {
      const value = initial?.[field.key];
      if (value !== null && value !== undefined) return [field.key, String(value)];
      if (field.type === 'date') return [field.key, todayIso()];
      if (field.type === 'select' && field.options) return [field.key, field.options[0]?.[0] ?? ''];
      return [field.key, ''];
    }),
  );
}

// Converte o texto dos campos para os tipos que a API espera (números, null para vazio).
function toPayload(config: ResourceConfig, form: FormState): Row {
  return Object.fromEntries(
    config.fields.map((field) => {
      const raw = form[field.key] ?? '';
      if (field.type === 'number' || field.type === 'account')
        return [field.key, raw === '' ? null : Number(raw)];
      return [field.key, raw];
    }),
  );
}

interface Props {
  config: ResourceConfig;
  initial: Row | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (payload: Row) => void;
}

export function FormModal({ config, initial, saving, onClose, onSubmit }: Props) {
  const [form, setForm] = useState(() => toFormState(config, initial));
  const [error, setError] = useState<string | null>(null);
  const formId = useId();
  const accounts = useAccountOptions(config.fields.some((field) => field.type === 'account'));

  function submit(event: FormEvent) {
    event.preventDefault();
    const payload = toPayload(config, form);
    // Mesma validação do servidor, antes de enviar.
    const result = config.schema.safeParse(payload);
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? 'Verifique os campos.');
      return;
    }
    setError(null);
    onSubmit(payload);
  }

  const set = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));

  return (
    <Modal eyebrow="CADASTRO" title={initial ? 'Editar registro' : 'Novo registro'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          {config.fields.map((field) => (
            <label key={field.key} htmlFor={`${formId}-${field.key}`}>
              {field.label}
              {field.type === 'account' ? (
                <select
                  id={`${formId}-${field.key}`}
                  name={field.key}
                  value={form[field.key]}
                  onChange={(event) => set(field.key, event.target.value)}
                >
                  <option value="">Sem conta vinculada</option>
                  {accounts.data?.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.bankName} — {account.accountName}
                    </option>
                  ))}
                </select>
              ) : field.type === 'select' ? (
                <select
                  id={`${formId}-${field.key}`}
                  name={field.key}
                  required={field.required}
                  value={form[field.key]}
                  onChange={(event) => set(field.key, event.target.value)}
                >
                  {field.options?.map(([value, text]) => (
                    <option key={value} value={value}>
                      {text}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={`${formId}-${field.key}`}
                  name={field.key}
                  required={field.required}
                  type={field.type}
                  inputMode={field.type === 'number' ? 'decimal' : undefined}
                  step={field.type === 'number' ? '0.01' : undefined}
                  value={form[field.key]}
                  onChange={(event) => set(field.key, event.target.value)}
                />
              )}
            </label>
          ))}
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
          <button className="button primary" type="submit" disabled={saving}>
            {saving ? 'Salvando...' : initial ? 'Salvar alterações' : 'Criar registro'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
