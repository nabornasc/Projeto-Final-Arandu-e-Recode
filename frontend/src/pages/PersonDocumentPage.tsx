import { formatDocument, formatZip, onlyDigits, STATES } from '@arandue/shared/br';
import { personSchema } from '@arandue/shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Plus, Save, Search, Trash2 } from 'lucide-react';
import { type ChangeEvent, type FormEvent, useId, useState } from 'react';
import { ActionMenu } from '../actions/ActionMenu.tsx';
import { personActions } from '../actions/registry.ts';
import { EmptyState } from '../components/EmptyState.tsx';
import { useToast } from '../components/Toast.tsx';
import { api } from '../lib/api.ts';
import { can, useProfile } from '../lib/auth.ts';
import {
  type Person,
  type PersonAddress,
  type PersonContact,
  permissionFor,
  ROLE_CONFIG,
  ROLE_LIST,
  roleFromPath,
  usePeople,
  usePerson,
} from '../lib/people.ts';
import { useTab, useTabDirty, useTabTitle } from '../workspace/tab.ts';

const PAYMENT_METHODS = [
  'PIX',
  'Boleto',
  'Cartão de crédito',
  'Cartão de débito',
  'Dinheiro',
  'Transferência',
];
const PAYMENT_TERMS = [
  'À vista',
  '30 dias',
  '30/60 dias',
  'Entrada + 30 dias',
  'Entrada 50% + contra-entrega',
];
const SECTIONS = [
  ['id', 'Identificação'],
  ['commercial', 'Comercial'],
  ['contacts', 'Contatos e endereços'],
] as const;

// Cadastro de pessoa (cliente, fornecedor, transportadora, representante) em abas.
export default function PersonDocumentPage() {
  const { params, path } = useTab();
  const id = params.id ? Number(params.id) : null;
  const person = usePerson(id);
  const role = roleFromPath(path);
  useTabTitle(id === null ? `Novo ${ROLE_CONFIG[role].singular}` : person.data?.name);

  if (id !== null && person.isPending) return <div className="loading">Carregando cadastro...</div>;
  if (person.isError) return <EmptyState text={person.error.message} />;
  return <PersonEditor key={person.data?.id ?? 'novo'} person={person.data ?? null} newRole={role} />;
}

type Form = ReturnType<typeof toForm>;
// Campos que a busca de CEP devolve.
type ZipFields = Partial<
  Pick<PersonAddress, 'zip' | 'street' | 'complement' | 'district' | 'city' | 'state'>
>;

function toForm(person: Person | null, newRole: keyof typeof ROLE_CONFIG, userId: number) {
  const text = (value: string | number | null | undefined) =>
    value === null || value === undefined ? '' : String(value);
  return {
    kind: person?.kind ?? (newRole === 'customer' ? 'individual' : 'company'),
    document: formatDocument(person?.document),
    name: text(person?.name),
    legalName: text(person?.legalName),
    isCustomer: person?.isCustomer ?? newRole === 'customer',
    isSupplier: person?.isSupplier ?? newRole === 'supplier',
    isCarrier: person?.isCarrier ?? newRole === 'carrier',
    isSalesRep: person?.isSalesRep ?? newRole === 'sales_rep',
    email: text(person?.email),
    phone: text(person?.phone),
    mobile: text(person?.mobile),
    stateRegistration: text(person?.stateRegistration),
    taxpayer: person?.taxpayer ?? 'non_contributor',
    finalConsumer: person?.finalConsumer ?? true,
    taxRegime: text(person?.taxRegime),
    zip: formatZip(person?.zip),
    street: text(person?.street),
    number: text(person?.number),
    complement: text(person?.complement),
    district: text(person?.district),
    city: text(person?.city),
    state: text(person?.state),
    country: person?.country ?? 'Brasil',
    paymentMethod: text(person?.paymentMethod),
    paymentTerms: text(person?.paymentTerms),
    freightType: text(person?.freightType),
    carrierId: text(person?.carrierId),
    category: text(person?.category),
    region: text(person?.region),
    sellerId: person ? text(person.sellerId) : newRole === 'customer' ? String(userId) : '',
    creditLimit: text(person?.creditLimit),
    notes: text(person?.notes),
  };
}

function toPayload(form: Form, contacts: PersonContact[], addresses: PersonAddress[]) {
  return {
    ...form,
    carrierId: form.carrierId ? Number(form.carrierId) : null,
    sellerId: form.sellerId ? Number(form.sellerId) : null,
    creditLimit: form.creditLimit === '' ? null : Number(form.creditLimit),
    contacts: contacts.map(({ id: _, ...contact }) => contact),
    addresses: addresses.map(({ id: _, ...address }) => address),
  };
}

function PersonEditor({ person, newRole }: { person: Person | null; newRole: keyof typeof ROLE_CONFIG }) {
  const profile = useProfile();
  const tab = useTab();
  const notify = useToast();
  const client = useQueryClient();
  const formId = useId();
  const [section, setSection] = useState<(typeof SECTIONS)[number][0]>('id');
  const [form, setForm] = useState(() => toForm(person, newRole, profile.id));
  const [contacts, setContacts] = useState<PersonContact[]>(person?.contacts ?? []);
  const [addresses, setAddresses] = useState<PersonAddress[]>(person?.addresses ?? []);
  const [error, setError] = useState<string | null>(null);
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);

  const action = person ? 'update' : 'create';
  const editable = ROLE_LIST.some(
    (role) =>
      (person ? person[ROLE_CONFIG[role].flag] : role === newRole) &&
      can(profile, permissionFor(role, action)),
  );
  const canAssign = can(profile, 'customers.assign');
  const canSeeCarriers = can(profile, 'suppliers.read');
  const sellers = useQuery({
    queryKey: ['/people/sellers'],
    queryFn: () => api<{ id: number; name: string }[]>('/people/sellers'),
  });
  const carriers = usePeople('carrier', '', canSeeCarriers);

  const payload = toPayload(form, contacts, addresses);
  const [baseline, setBaseline] = useState(() => JSON.stringify(payload));
  useTabDirty(editable && JSON.stringify(payload) !== baseline);

  const set =
    (key: keyof Form) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const target = event.target;
      const value =
        target instanceof HTMLInputElement && target.type === 'checkbox' ? target.checked : target.value;
      setForm((current) => ({ ...current, [key]: value }));
    };

  const save = useMutation({
    mutationFn: (body: unknown) =>
      person
        ? api<Person>(`/people/${person.id}`, { method: 'PUT', body })
        : api<Person>('/people', { method: 'POST', body }),
    onSuccess: (saved) => {
      setBaseline(JSON.stringify(payload));
      void client.invalidateQueries();
      notify(person ? 'Cadastro salvo.' : `${saved.name} cadastrado.`);
      if (!person) tab.replaceWith(`/pessoas/${saved.id}`);
    },
    onError: (err) => setError(err.message),
  });

  const lookupCnpj = useMutation({
    mutationFn: () => api<Partial<Form>>(`/lookup/cnpj/${onlyDigits(form.document)}`),
    onSuccess: (found) => {
      const filled = Object.fromEntries(
        Object.entries(found).filter(([, value]) => value !== null && value !== undefined && value !== ''),
      );
      setForm((current) => ({ ...current, ...filled, zip: formatZip(found.zip ?? current.zip) }));
      setLookupMessage('Dados da Receita Federal preenchidos. Confira antes de salvar.');
    },
    onError: (err) => setLookupMessage(err.message),
  });

  const lookupZip = async (zip: string) => {
    const data = await api<ZipFields>(`/lookup/cep/${onlyDigits(zip)}`);
    return Object.fromEntries(Object.entries(data).filter(([, value]) => value)) as ZipFields;
  };
  const lookupMainZip = useMutation({
    mutationFn: () => lookupZip(form.zip),
    onSuccess: (found) => {
      setForm((current) => ({
        ...current,
        street: found.street ?? current.street,
        complement: found.complement ?? current.complement,
        district: found.district ?? current.district,
        city: found.city ?? current.city,
        state: found.state ?? current.state,
        zip: formatZip(found.zip ?? current.zip),
      }));
      setLookupMessage(null);
    },
    onError: (err) => setLookupMessage(err.message),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = personSchema.safeParse(payload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      if (issue?.path[0] === 'contacts' || issue?.path[0] === 'addresses') setSection('contacts');
      else if (['paymentMethod', 'paymentTerms', 'creditLimit', 'notes'].includes(String(issue?.path[0])))
        setSection('commercial');
      else setSection('id');
      return setError(issue?.message ?? 'Verifique os campos.');
    }
    setError(null);
    save.mutate(payload);
  }

  const title = person?.name ?? `Novo ${ROLE_CONFIG[newRole].singular}`;
  const isCompany = form.kind === 'company';

  return (
    <section className="document">
      <div className="section-heading page-heading">
        <div>
          <span className="welcome-label">CADASTRO</span>
          <h2>{title}</h2>
          <p>
            {ROLE_LIST.filter((role) => form[ROLE_CONFIG[role].flag])
              .map((role) => ROLE_CONFIG[role].singular)
              .join(' · ') || 'Marque ao menos um papel.'}
            {person && !person.active && ' · arquivado'}
          </p>
        </div>
        <div className="document-actions">
          {editable && (
            <button type="submit" form={formId} className="button primary" disabled={save.isPending}>
              <Save size={16} /> {save.isPending ? 'Salvando...' : 'Salvar'}
            </button>
          )}
          {person && (
            <ActionMenu
              actions={personActions}
              record={person}
              label={person.name}
              exclude={['person.open']}
            />
          )}
        </div>
      </div>

      <div className="section-tabs" role="tablist" aria-label="Seções do cadastro">
        {SECTIONS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={section === key}
            className={section === key ? 'active' : undefined}
            onClick={() => setSection(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <form id={formId} className="panel" onSubmit={submit} noValidate>
        <fieldset disabled={!editable} className="plain-fieldset">
          <div className="form-grid" hidden={section !== 'id'}>
            <label>
              Tipo
              <select name="kind" value={form.kind} onChange={set('kind')}>
                <option value="individual">Pessoa física</option>
                <option value="company">Pessoa jurídica</option>
              </select>
            </label>
            <label>
              {isCompany ? 'CNPJ' : 'CPF'}
              <span className="input-with-button">
                <input
                  name="document"
                  inputMode="numeric"
                  maxLength={18}
                  value={form.document}
                  onChange={set('document')}
                />
                {isCompany && (
                  <button
                    type="button"
                    className="button secondary"
                    title="Buscar dados na Receita Federal"
                    disabled={onlyDigits(form.document).length !== 14 || lookupCnpj.isPending}
                    onClick={() => lookupCnpj.mutate()}
                  >
                    <Search size={14} /> {lookupCnpj.isPending ? 'Buscando...' : 'Buscar'}
                  </button>
                )}
              </span>
            </label>
            {lookupMessage && (
              <p className="notice full-row" role="status">
                {lookupMessage}
              </p>
            )}
            <label>
              {isCompany ? 'Nome fantasia' : 'Nome'}
              <input name="name" required maxLength={160} value={form.name} onChange={set('name')} />
            </label>
            {isCompany && (
              <label>
                Razão social
                <input name="legalName" maxLength={160} value={form.legalName} onChange={set('legalName')} />
              </label>
            )}
            <fieldset className="full-row role-checks">
              <legend className="sr-only">Papéis</legend>
              {ROLE_LIST.map((role) => (
                <label key={role} className="checkbox">
                  <input
                    type="checkbox"
                    name={ROLE_CONFIG[role].flag}
                    checked={form[ROLE_CONFIG[role].flag]}
                    disabled={!can(profile, permissionFor(role, action))}
                    onChange={set(ROLE_CONFIG[role].flag)}
                  />
                  {ROLE_CONFIG[role].singular[0]?.toUpperCase()}
                  {ROLE_CONFIG[role].singular.slice(1)}
                </label>
              ))}
            </fieldset>
            <label>
              E-mail
              <input name="email" type="email" maxLength={160} value={form.email} onChange={set('email')} />
            </label>
            <label>
              Telefone
              <input name="phone" maxLength={30} value={form.phone} onChange={set('phone')} />
            </label>
            <label>
              Celular / WhatsApp
              <input name="mobile" maxLength={30} value={form.mobile} onChange={set('mobile')} />
            </label>
            {isCompany && (
              <>
                <label>
                  Inscrição estadual
                  <input
                    name="stateRegistration"
                    maxLength={20}
                    value={form.stateRegistration}
                    onChange={set('stateRegistration')}
                  />
                </label>
                <label>
                  Contribuinte do ICMS
                  <select name="taxpayer" value={form.taxpayer} onChange={set('taxpayer')}>
                    <option value="non_contributor">Não contribuinte</option>
                    <option value="contributor">Contribuinte</option>
                    <option value="exempt">Isento</option>
                  </select>
                </label>
                <label>
                  Regime tributário
                  <select name="taxRegime" value={form.taxRegime} onChange={set('taxRegime')}>
                    <option value="">Não informado</option>
                    <option value="mei">MEI</option>
                    <option value="simples">Simples Nacional</option>
                    <option value="presumido">Lucro presumido</option>
                    <option value="real">Lucro real</option>
                  </select>
                </label>
              </>
            )}
            <label className="checkbox">
              <input
                type="checkbox"
                name="finalConsumer"
                checked={form.finalConsumer}
                onChange={set('finalConsumer')}
              />
              Consumidor final
            </label>

            <h3 className="full-row form-subtitle">Endereço principal</h3>
            <label>
              CEP
              <span className="input-with-button">
                <input name="zip" inputMode="numeric" maxLength={9} value={form.zip} onChange={set('zip')} />
                <button
                  type="button"
                  className="button secondary"
                  title="Buscar endereço pelo CEP"
                  disabled={onlyDigits(form.zip).length !== 8 || lookupMainZip.isPending}
                  onClick={() => lookupMainZip.mutate()}
                >
                  <Search size={14} /> Buscar
                </button>
              </span>
            </label>
            <label>
              Logradouro
              <input name="street" maxLength={160} value={form.street} onChange={set('street')} />
            </label>
            <label>
              Número
              <input name="number" maxLength={20} value={form.number} onChange={set('number')} />
            </label>
            <label>
              Complemento
              <input name="complement" maxLength={80} value={form.complement} onChange={set('complement')} />
            </label>
            <label>
              Bairro
              <input name="district" maxLength={80} value={form.district} onChange={set('district')} />
            </label>
            <label>
              Cidade
              <input name="city" maxLength={80} value={form.city} onChange={set('city')} />
            </label>
            <label>
              UF
              <select name="state" value={form.state} onChange={set('state')}>
                <option value="">—</option>
                {STATES.map((uf) => (
                  <option key={uf} value={uf}>
                    {uf}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="form-grid" hidden={section !== 'commercial'}>
            <label>
              Forma de pagamento padrão
              <input
                name="paymentMethod"
                list="payment-methods"
                maxLength={60}
                value={form.paymentMethod}
                onChange={set('paymentMethod')}
              />
              <datalist id="payment-methods">
                {PAYMENT_METHODS.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </label>
            <label>
              Condição de pagamento padrão
              <input
                name="paymentTerms"
                list="payment-terms"
                maxLength={120}
                value={form.paymentTerms}
                onChange={set('paymentTerms')}
              />
              <datalist id="payment-terms">
                {PAYMENT_TERMS.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </label>
            <label>
              Frete
              <select name="freightType" value={form.freightType} onChange={set('freightType')}>
                <option value="">Não informado</option>
                <option value="sender">Por conta do remetente (CIF)</option>
                <option value="recipient">Por conta do destinatário (FOB)</option>
                <option value="none">Sem frete</option>
              </select>
            </label>
            <label>
              Transportadora padrão
              <select
                name="carrierId"
                value={form.carrierId}
                onChange={set('carrierId')}
                disabled={!canSeeCarriers}
              >
                <option value="">Nenhuma</option>
                {carriers.data
                  ?.filter((carrier) => carrier.id !== person?.id)
                  .map((carrier) => (
                    <option key={carrier.id} value={carrier.id}>
                      {carrier.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Categoria
              <input
                name="category"
                maxLength={60}
                placeholder="Ex.: varejo, atacado, construtora"
                value={form.category}
                onChange={set('category')}
              />
            </label>
            <label>
              Região
              <input name="region" maxLength={60} value={form.region} onChange={set('region')} />
            </label>
            <label>
              <span>
                Vendedor da carteira{' '}
                {!canAssign && (
                  <Lock size={12} aria-label="Só quem pode definir a carteira altera este campo" />
                )}
              </span>
              <select name="sellerId" value={form.sellerId} onChange={set('sellerId')} disabled={!canAssign}>
                <option value="">Sem vendedor</option>
                {sellers.data?.map((seller) => (
                  <option key={seller.id} value={seller.id}>
                    {seller.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Limite de crédito (R$)
              <input
                name="creditLimit"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={form.creditLimit}
                onChange={set('creditLimit')}
              />
            </label>
            <label className="full-row">
              Observações
              <textarea name="notes" maxLength={1000} rows={4} value={form.notes} onChange={set('notes')} />
            </label>
          </div>

          <div hidden={section !== 'contacts'}>
            <ContactsEditor contacts={contacts} onChange={setContacts} />
            <AddressesEditor addresses={addresses} onChange={setAddresses} lookupZip={lookupZip} />
          </div>
        </fieldset>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}

function ContactsEditor({
  contacts,
  onChange,
}: {
  contacts: PersonContact[];
  onChange: (next: PersonContact[]) => void;
}) {
  const update = (index: number, patch: Partial<PersonContact>) =>
    onChange(contacts.map((contact, i) => (i === index ? { ...contact, ...patch } : contact)));
  return (
    <div className="sub-list">
      <h3 className="form-subtitle">Contatos</h3>
      {contacts.map((contact, index) => (
        <div key={contact.id ?? `novo-${index}`} className="sub-row">
          <input
            aria-label="Nome do contato"
            placeholder="Nome"
            value={contact.name}
            onChange={(event) => update(index, { name: event.target.value })}
          />
          <input
            aria-label="Cargo"
            placeholder="Cargo"
            value={contact.role ?? ''}
            onChange={(event) => update(index, { role: event.target.value })}
          />
          <input
            aria-label="Telefone do contato"
            placeholder="Telefone"
            value={contact.phone ?? ''}
            onChange={(event) => update(index, { phone: event.target.value })}
          />
          <input
            aria-label="E-mail do contato"
            placeholder="E-mail"
            value={contact.email ?? ''}
            onChange={(event) => update(index, { email: event.target.value })}
          />
          <button
            type="button"
            className="button secondary"
            aria-label={`Remover contato ${index + 1}`}
            onClick={() => onChange(contacts.filter((_, i) => i !== index))}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="button secondary"
        onClick={() => onChange([...contacts, { name: '', role: null, phone: null, email: null }])}
      >
        <Plus size={14} /> Adicionar contato
      </button>
    </div>
  );
}

function AddressesEditor({
  addresses,
  onChange,
  lookupZip,
}: {
  addresses: PersonAddress[];
  onChange: (next: PersonAddress[]) => void;
  lookupZip: (zip: string) => Promise<ZipFields>;
}) {
  const notify = useToast();
  const update = (index: number, patch: Partial<PersonAddress>) =>
    onChange(addresses.map((address, i) => (i === index ? { ...address, ...patch } : address)));
  const empty: PersonAddress = {
    kind: 'delivery',
    zip: null,
    street: null,
    number: null,
    complement: null,
    district: null,
    city: null,
    state: null,
  };
  return (
    <div className="sub-list">
      <h3 className="form-subtitle">Endereços de entrega e cobrança</h3>
      {addresses.map((address, index) => (
        <div key={address.id ?? `novo-${index}`} className="sub-row address-row">
          <select
            aria-label="Tipo de endereço"
            value={address.kind}
            onChange={(event) => update(index, { kind: event.target.value as PersonAddress['kind'] })}
          >
            <option value="delivery">Entrega</option>
            <option value="billing">Cobrança</option>
          </select>
          <span className="input-with-button">
            <input
              aria-label="CEP"
              placeholder="CEP"
              value={formatZip(address.zip)}
              onChange={(event) => update(index, { zip: event.target.value })}
            />
            <button
              type="button"
              className="button secondary"
              aria-label="Buscar CEP"
              disabled={onlyDigits(address.zip).length !== 8}
              onClick={() =>
                lookupZip(address.zip ?? '')
                  .then((found) => update(index, found))
                  .catch((err: Error) => notify(err.message, 'error'))
              }
            >
              <Search size={14} />
            </button>
          </span>
          <input
            aria-label="Logradouro"
            placeholder="Logradouro"
            value={address.street ?? ''}
            onChange={(event) => update(index, { street: event.target.value })}
          />
          <input
            aria-label="Número"
            placeholder="Nº"
            value={address.number ?? ''}
            onChange={(event) => update(index, { number: event.target.value })}
          />
          <input
            aria-label="Bairro"
            placeholder="Bairro"
            value={address.district ?? ''}
            onChange={(event) => update(index, { district: event.target.value })}
          />
          <input
            aria-label="Cidade"
            placeholder="Cidade"
            value={address.city ?? ''}
            onChange={(event) => update(index, { city: event.target.value })}
          />
          <select
            aria-label="UF"
            value={address.state ?? ''}
            onChange={(event) => update(index, { state: event.target.value || null })}
          >
            <option value="">UF</option>
            {STATES.map((uf) => (
              <option key={uf} value={uf}>
                {uf}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="button secondary"
            aria-label={`Remover endereço ${index + 1}`}
            onClick={() => onChange(addresses.filter((_, i) => i !== index))}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button type="button" className="button secondary" onClick={() => onChange([...addresses, empty])}>
        <Plus size={14} /> Adicionar endereço
      </button>
    </div>
  );
}
