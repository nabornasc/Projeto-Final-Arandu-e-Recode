import { Printer } from 'lucide-react';
import type { QuoteMirror } from '../lib/documents.ts';
import { formatCode, formatDate, formatMoney } from '../lib/format.ts';

// Só enviado e aprovado estão em vigor: os demais saem com um aviso, para não circular por engano.
const STATUS_NOTICE: Partial<Record<QuoteMirror['status'], string>> = {
  draft: 'Rascunho: ainda não enviado ao cliente.',
  rejected: 'Orçamento recusado: sem validade.',
  cancelled: 'Orçamento cancelado: sem validade.',
};

// Campo com rótulo que some quando está vazio, para não imprimir "()" nem linhas em branco.
function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="mirror-field">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function MirrorToolbar() {
  return (
    <div className="mirror-toolbar">
      <button type="button" className="button primary" onClick={() => window.print()}>
        <Printer size={16} /> Imprimir / Salvar PDF
      </button>
    </div>
  );
}

export function MirrorHeader({ quote }: { quote: QuoteMirror }) {
  const { issuer } = quote;
  return (
    <header className="mirror-header">
      <div className="mirror-issuer">
        {issuer.logo && <img src={issuer.logo} alt={`Logo de ${issuer.name}`} />}
        <div>
          <strong>{issuer.name}</strong>
          {issuer.legalName && <p>{issuer.legalName}</p>}
          {issuer.cnpj && <p>CNPJ {issuer.cnpj}</p>}
          {issuer.address && <p>{issuer.address}</p>}
          {(issuer.phone || issuer.email) && (
            <p>{[issuer.phone, issuer.email].filter(Boolean).join(' - ')}</p>
          )}
        </div>
      </div>
      <div className="mirror-title">
        <h1>Orçamento {formatCode(quote.number)}</h1>
        <dl>
          <Field
            label="Emissão"
            value={formatDate((quote.status !== 'draft' && quote.sentAt) || quote.createdAt)}
          />
          <Field label="Validade" value={quote.validUntil && formatDate(quote.validUntil)} />
          <Field label="Vendedor" value={quote.sellerName} />
        </dl>
      </div>
    </header>
  );
}

export function MirrorStatusNotice({ status }: { status: QuoteMirror['status'] }) {
  const notice = STATUS_NOTICE[status];
  if (!notice) return null;
  return (
    <p className="mirror-notice" role="status">
      {notice}
    </p>
  );
}

export function MirrorParties({ quote }: { quote: QuoteMirror }) {
  const { customer } = quote;
  const hasSite = quote.siteDescription || quote.siteContact || quote.siteAddress;
  if (!customer && !hasSite) return null;
  return (
    <div className="mirror-parties">
      {customer && (
        <section>
          <h2>Cliente</h2>
          <dl>
            <Field label="Nome" value={customer.name} />
            <Field label="Razão social" value={customer.legalName} />
            <Field label="CPF/CNPJ" value={customer.document} />
            <Field label="Telefone" value={customer.phones} />
            <Field label="E-mail" value={customer.email} />
            <Field label="Endereço" value={customer.address} />
          </dl>
        </section>
      )}
      {hasSite && (
        <section>
          <h2>Local de entrega ou serviço</h2>
          <dl>
            <Field label="Descrição" value={quote.siteDescription} />
            <Field label="Contato" value={quote.siteContact} />
            <Field label="Endereço" value={quote.siteAddress} />
          </dl>
        </section>
      )}
    </div>
  );
}

type MirrorItem = QuoteMirror['items'][number];

// Agrupa pelo nome, na ordem em que cada grupo aparece, mesmo com itens intercalados.
export function groupItems<T extends MirrorItem>(items: T[]) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = item.groupName ?? '';
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups].map(([name, list]) => ({
    name,
    items: list,
    subtotal: list.reduce((sum, item) => sum + item.subtotal, 0),
  }));
}

export const quantityLabel = (item: MirrorItem) =>
  `${item.quantity.toLocaleString('pt-BR')}${item.width ? ' m²' : ''}`;

export function ItemName({ item }: { item: MirrorItem }) {
  return (
    <>
      {item.name}
      {item.width && item.length && (
        <small className="mirror-measures">
          {item.width.toLocaleString('pt-BR')} × {item.length.toLocaleString('pt-BR')}{' '}
          {item.measureUnit ?? 'm'}
        </small>
      )}
    </>
  );
}

export function MirrorInstallments({ installments }: { installments: QuoteMirror['installments'] }) {
  if (!installments.length) return null;
  const hasMethod = installments.some((item) => item.method);
  return (
    <section className="mirror-text">
      <h2>Condição de pagamento</h2>
      <table className="mirror-items">
        <thead>
          <tr>
            <th>Parcela</th>
            <th>Vencimento</th>
            {hasMethod && <th>Forma</th>}
            <th>Valor</th>
          </tr>
        </thead>
        <tbody>
          {installments.map((item, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lista fixa, e as parcelas podem ser iguais.
            <tr key={index}>
              <td>{index + 1}</td>
              <td>{formatDate(item.dueDate)}</td>
              {hasMethod && <td>{item.method}</td>}
              <td>{formatMoney(item.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
