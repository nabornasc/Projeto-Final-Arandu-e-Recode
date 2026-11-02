import { can } from '@arandue/shared/rbac';
import { companySettingsSchema } from '@arandue/shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useOutletContext } from 'react-router';
import { EmptyState } from '../components/EmptyState.tsx';
import { useToast } from '../components/Toast.tsx';
import { api } from '../lib/api.ts';
import type { Profile } from '../lib/auth.ts';

interface CompanySettings {
  name: string;
  cnpj: string | null;
  meiAnnualLimit: number | null;
}

export default function SettingsPage() {
  const profile = useOutletContext<Profile>();
  const query = useQuery({ queryKey: ['/company'], queryFn: () => api<CompanySettings>('/company') });

  return (
    <section>
      <div className="section-heading page-heading">
        <div>
          <span className="welcome-label">EMPRESA</span>
          <h2>Configurações da empresa</h2>
          <p>Dados do negócio usados como referência em todo o sistema.</p>
        </div>
        {!can(profile.role, 'settings', 'update') && <span className="read-only-note">Somente leitura</span>}
      </div>

      <div className="panel">
        {query.isPending ? (
          <div className="loading">Carregando...</div>
        ) : query.isError ? (
          <EmptyState text={query.error.message} />
        ) : (
          <SettingsForm initial={query.data} readOnly={!can(profile.role, 'settings', 'update')} />
        )}
      </div>
    </section>
  );
}

function SettingsForm({ initial, readOnly }: { initial: CompanySettings; readOnly: boolean }) {
  const notify = useToast();
  const client = useQueryClient();
  const [name, setName] = useState(initial.name);
  const [cnpj, setCnpj] = useState(initial.cnpj ?? '');
  const [limit, setLimit] = useState(initial.meiAnnualLimit === null ? '' : String(initial.meiAnnualLimit));
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: unknown) => api('/company', { method: 'PUT', body }),
    // Recarrega o perfil também: é ele que libera o acesso quando o limite é preenchido.
    onSuccess: () => {
      void client.invalidateQueries();
      notify('Configurações salvas.');
    },
    onError: (err) => setError(err.message),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const payload = { name, cnpj, meiAnnualLimit: limit === '' ? undefined : Number(limit) };
    const parsed = companySettingsSchema.safeParse(payload);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Verifique os campos.');
    setError(null);
    save.mutate(payload);
  }

  return (
    <form onSubmit={submit} noValidate>
      {initial.meiAnnualLimit === null && (
        <p className="notice" role="status">
          Informe o limite anual de faturamento do MEI vigente para continuar. O sistema usa esse valor para
          acompanhar quanto do limite a empresa já atingiu no ano.
        </p>
      )}
      <fieldset className="form-grid" disabled={readOnly}>
        <label>
          Nome da empresa
          <input name="name" required value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          CNPJ
          <input name="cnpj" value={cnpj} onChange={(event) => setCnpj(event.target.value)} />
        </label>
        <label>
          Limite anual do MEI (R$) *
          <input
            name="meiAnnualLimit"
            required
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
          />
        </label>
      </fieldset>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {!readOnly && (
        <div className="modal-actions">
          <button className="button primary" type="submit" disabled={save.isPending}>
            {save.isPending ? 'Salvando...' : 'Salvar configurações'}
          </button>
        </div>
      )}
    </form>
  );
}
