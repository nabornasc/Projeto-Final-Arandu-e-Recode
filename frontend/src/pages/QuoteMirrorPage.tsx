import { useQuery } from '@tanstack/react-query';
import { Fragment, useEffect } from 'react';
import { useParams } from 'react-router';
import {
  groupItems,
  ItemName,
  MirrorHeader,
  MirrorInstallments,
  MirrorParties,
  MirrorStatusNotice,
  MirrorToolbar,
  quantityLabel,
} from '../components/MirrorParts.tsx';
import { api } from '../lib/api.ts';
import type { QuoteMirror } from '../lib/documents.ts';
import { formatCode, formatDateTime, formatMoney } from '../lib/format.ts';
import './quoteMirror.css';

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
  const { issuer } = quote;
  const subtotal = quote.items.reduce((sum, item) => sum + item.subtotal, 0);

  return (
    <main className="mirror-page">
      <MirrorToolbar />

      <article className="mirror-sheet">
        <MirrorHeader quote={quote} />
        <MirrorStatusNotice status={quote.status} />
        <MirrorParties quote={quote} />

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
              {groupItems(quote.items).map((group) => (
                <Fragment key={group.name}>
                  {group.name && (
                    <tr className="mirror-group">
                      <td colSpan={4}>{group.name}</td>
                    </tr>
                  )}
                  {group.items.map((item, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: lista fixa, e o mesmo produto pode se repetir.
                    <tr key={index}>
                      <td>
                        <ItemName item={item} />
                      </td>
                      <td>{quantityLabel(item)}</td>
                      <td>{formatMoney(item.unitPrice)}</td>
                      <td>{formatMoney(item.subtotal)}</td>
                    </tr>
                  ))}
                  {group.name && (
                    <tr className="mirror-group-total">
                      <td colSpan={3}>Subtotal de {group.name}</td>
                      <td>{formatMoney(group.subtotal)}</td>
                    </tr>
                  )}
                </Fragment>
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

        <MirrorInstallments installments={quote.installments} />

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
