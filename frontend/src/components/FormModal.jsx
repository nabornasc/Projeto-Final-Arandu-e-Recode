import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { request } from '../services/api';

export function FormModal({ config, initial, onClose, onSaved, onError }) {
  const [form, setForm] = useState(() => {
    const base = Object.fromEntries(
      config.fields.map(([key]) => [
        key,
        initial?.[key] ?? (key.includes('date') ? new Date().toISOString().slice(0, 10) : ''),
      ])
    );
    // Preserva o status active original se estiver editando
    if (initial?.active !== undefined) {
      base.active = initial.active;
    }
    return base;
  });

  const [accounts, setAccounts] = useState([]);
  const hasAccountField = config.fields.some(([, , type]) => type === 'account');

  useEffect(() => {
    if (!hasAccountField) return;
    request('/bankAccounts')
      .then(setAccounts)
      .catch((error) => onError(error));
  }, [hasAccountField]);

  async function submit(event) {
    event.preventDefault();
    try {
      await request(`/${config.endpoint}${initial ? `/${initial.id}` : ''}`, {
        method: initial ? 'PUT' : 'POST',
        body: JSON.stringify(form),
      });
      onSaved();
    } catch (error) {
      onError(error);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="modal">
        <div className="modal-header">
          <div>
            <span className="welcome-label">CADASTRO</span>
            <h3>{initial ? 'Editar registro' : 'Novo registro'}</h3>
          </div>
          <button onClick={onClose} aria-label="Fechar janela">
            <X size={19} />
          </button>
        </div>

        <form onSubmit={submit}>
          <div className="form-grid">
            {config.fields.map(([key, label, type, options]) => {
              const isRequired = [
                'name',
                'description',
                'category',
                'amount',
                'expense_date',
                'transaction_date',
                'bank_name',
                'account_name',
                'price',
                'type',
              ].includes(key);

              return (
                <label key={key}>
                  {label}
                  {type === 'account' ? (
                    <select
                      value={form[key] || ''}
                      onChange={(event) => setForm({ ...form, [key]: event.target.value ? Number(event.target.value) : '' })}
                    >
                      <option value="">Sem conta vinculada</option>
                      {accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.bank_name} — {account.account_name}
                        </option>
                      ))}
                    </select>
                  ) : type === 'select' ? (
                    <select
                      required={isRequired}
                      value={form[key] || ''}
                      onChange={(event) => setForm({ ...form, [key]: event.target.value })}
                    >
                      <option value="">Selecione</option>
                      {options.map(([value, text]) => (
                        <option key={value} value={value}>
                          {text}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      required={isRequired}
                      type={type}
                      step={type === 'number' ? '0.01' : undefined}
                      min={type === 'number' ? '0' : undefined}
                      value={form[key] ?? ''}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          [key]: type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value,
                        })
                      }
                    />
                  )}
                </label>
              );
            })}
          </div>

          <div className="modal-actions">
            <button type="button" className="button secondary" onClick={onClose}>
              Cancelar
            </button>
            <button className="button primary" type="submit">
              {initial ? 'Salvar alterações' : 'Criar registro'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

