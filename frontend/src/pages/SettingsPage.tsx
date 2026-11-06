import { companySettingsSchema, LOGO_MAX_BYTES, type MeasureUnit } from '@arandue/shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ChangeEvent, type FormEvent, useState } from 'react';
import { EmptyState } from '../components/EmptyState.tsx';
import { useToast } from '../components/Toast.tsx';
import { api } from '../lib/api.ts';
import { can, useProfile } from '../lib/auth.ts';

interface CompanySettings {
  name: string;
  cnpj: string | null;
  legalName: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  logo: string | null;
  quoteTerms: string | null;
  meiAnnualLimit: number | null;
  useMeasures: boolean;
  measureUnit: MeasureUnit;
}

export default function SettingsPage() {
  const profile = useProfile();
  const query = useQuery({ queryKey: ['/company'], queryFn: () => api<CompanySettings>('/company') });

  return (
    <section>
      <div className="section-heading page-heading">
        <div>
          <span className="welcome-label">EMPRESA</span>
          <h2>Configurações da empresa</h2>
          <p>Dados do negócio usados como referência em todo o sistema.</p>
        </div>
        {!can(profile, 'settings.update') && <span className="read-only-note">Somente leitura</span>}
      </div>

      <div className="panel">
        {query.isPending ? (
          <div className="loading">Carregando...</div>
        ) : query.isError ? (
          <EmptyState text={query.error.message} />
        ) : (
          <SettingsForm initial={query.data} readOnly={!can(profile, 'settings.update')} />
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
  const [legalName, setLegalName] = useState(initial.legalName ?? '');
  const [address, setAddress] = useState(initial.address ?? '');
  const [phone, setPhone] = useState(initial.phone ?? '');
  const [email, setEmail] = useState(initial.email ?? '');
  const [logo, setLogo] = useState(initial.logo);
  const [quoteTerms, setQuoteTerms] = useState(initial.quoteTerms ?? '');
  const [limit, setLimit] = useState(initial.meiAnnualLimit === null ? '' : String(initial.meiAnnualLimit));
  const [useMeasures, setUseMeasures] = useState(initial.useMeasures);
  const [measureUnit, setMeasureUnit] = useState(initial.measureUnit);
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

  function chooseLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > LOGO_MAX_BYTES) return setError('O logo deve ter no máximo 150 KB.');
    const reader = new FileReader();
    reader.onload = () => {
      setError(null);
      setLogo(String(reader.result));
    };
    reader.onerror = () => setError('Não foi possível ler o arquivo do logo.');
    reader.readAsDataURL(file);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const payload = {
      name,
      cnpj,
      legalName,
      address,
      phone,
      email,
      logo,
      quoteTerms,
      meiAnnualLimit: limit === '' ? undefined : Number(limit),
      useMeasures,
      measureUnit,
    };
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
          Razão social
          <input
            name="legalName"
            maxLength={160}
            value={legalName}
            onChange={(event) => setLegalName(event.target.value)}
          />
        </label>
        <label>
          Telefone
          <input
            name="phone"
            maxLength={30}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </label>
        <label>
          E-mail
          <input
            name="email"
            type="email"
            maxLength={160}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          Endereço
          <input
            name="address"
            maxLength={255}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
        </label>
        <div className="full-row company-logo">
          <label>
            Logo (PNG, JPEG ou WebP, até 150 KB)
            <input name="logo" type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseLogo} />
          </label>
          {logo && (
            <div className="company-logo-preview">
              <img src={logo} alt="Logo atual da empresa" />
              <button type="button" className="button" onClick={() => setLogo(null)}>
                Remover logo
              </button>
            </div>
          )}
        </div>
        <label className="full-row">
          Condições do orçamento (saem no espelho do cliente)
          <textarea
            name="quoteTerms"
            rows={4}
            maxLength={2000}
            placeholder="Ex.: prazo de entrega, forma de pagamento e garantia"
            value={quoteTerms}
            onChange={(event) => setQuoteTerms(event.target.value)}
          />
        </label>
        <label className="full-row checkbox">
          <input
            name="useMeasures"
            type="checkbox"
            checked={useMeasures}
            onChange={(event) => setUseMeasures(event.target.checked)}
          />
          Usar largura e comprimento nos itens do orçamento (a quantidade vira m²)
        </label>
        {useMeasures && (
          <label>
            Digitar as medidas em
            <select
              name="measureUnit"
              value={measureUnit}
              onChange={(event) => setMeasureUnit(event.target.value as MeasureUnit)}
            >
              <option value="mm">Milímetros (mm)</option>
              <option value="cm">Centímetros (cm)</option>
              <option value="m">Metros (m)</option>
            </select>
          </label>
        )}
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
