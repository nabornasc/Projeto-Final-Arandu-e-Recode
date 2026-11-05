import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useEffect } from 'react';
import { useParams } from 'react-router';
import { api } from '../lib/api.ts';
import type { QuoteMirror } from '../lib/documents.ts';
import { formatCode, formatDate, formatDateTime, formatMoney } from '../lib/format.ts';
import './quoteMirror.css';

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

export default function QuoteMirrorPage() {
  const { id } = useParams();
  const mirror = useQuery({
    queryKey: ['/quotes', id, 'mirror'],
    queryFn: () => api<QuoteMirror>(`/quotes/${id}/mirror`),
    retry: false,
  });

  const code = mirror.data ? formatCode(mirror.data.number) : null;
  const company = mirror.data?.issuer.name;
  // O título vira o nome sugerido do arquivo ao salvar em PDF.
  useEffect(() => {
    if (code) document.title = `Orçamento ${code} - ${company}`;
  }, [code, company]);

  if (mirror.isPending) return <div className="page-loading">Carregando...</div>;
  if (mirror.isError) {
    return (
      <main className="mirror-page">
        <p role="alert">{mirror.error.message}</p>
      </main>
    );
  }

  const quote = mirror.data;
  const { issuer, customer } = quote;
  const subtotal = quote.items.reduce((sum, item) => sum + item.subtotal, 0);
  const notice = STATUS_NOTICE[quote.status];
  const hasSite = quote.siteDescription || quote.siteContact || quote.siteAddress;

  return (
    <main className="mirror-page">
      <div className="mirror-toolbar">
        <button type="button" className="button primary" onClick={() => window.print()}>
          <Printer size={16} /> Imprimir / Salvar PDF
        </button>
      </div>

      <article className="mirror-sheet">
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
            <h1>Orçamento {code}</h1>
            <dl>
              <Field label="Emissão" value={formatDate(quote.sentAt ?? quote.createdAt)} />
              <Field label="Validade" value={quote.validUntil && formatDate(quote.validUntil)} />
              <Field label="Vendedor" value={quote.sellerName} />
            </dl>
          </div>
        </header>

        {notice && (
          <p className="mirror-notice" role="status">
            {notice}
          </p>
        )}

        {(customer || hasSite) && (
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
        )}

        <section>
          <h2>Itens</h2>
          <table className="mirror-items">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qtd.</th>
                <th>Preço</th>
                <th>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {quote.items.map((item, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: lista fixa, e o mesmo produto pode se repetir.
                <tr key={index}>
                  <td>{item.name}</td>
                  <td>{item.quantity.toLocaleString('pt-BR')}</td>
                  <td>{formatMoney(item.unitPrice)}</td>
                  <td>{formatMoney(item.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <dl className="mirror-totals">
          <div>
            <dt>Total dos itens</dt>
            <dd>{formatMoney(subtotal)}</dd>
          </div>
          {quote.discount > 0 && (
            <div>
              <dt>Desconto</dt>
              <dd>− {formatMoney(quote.discount)}</dd>
            </div>
          )}
          {quote.freight > 0 && (
            <div>
              <dt>Frete</dt>
              <dd>{formatMoney(quote.freight)}</dd>
            </div>
          )}
          {quote.otherCharges > 0 && (
            <div>
              <dt>Outras despesas</dt>
              <dd>{formatMoney(quote.otherCharges)}</dd>
            </div>
          )}
          <div className="mirror-total">
            <dt>Total do orçamento</dt>
            <dd>{formatMoney(quote.total)}</dd>
          </div>
        </dl>

        {quote.notes && (
          <section className="mirror-text">
            <h2>Observações</h2>
            <p>{quote.notes}</p>
          </section>
        )}
        {issuer.terms && (
          <section className="mirror-text">
            <h2>Condições</h2>
            <p>{issuer.terms}</p>
          </section>
        )}

        <footer className="mirror-footer">Impresso em {formatDateTime(new Date().toISOString())}</footer>
      </article>
    </main>
  );
}
