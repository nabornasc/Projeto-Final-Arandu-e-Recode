import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useParams } from 'react-router';
import {
  MirrorHeader,
  MirrorParties,
  MirrorStatusNotice,
  MirrorToolbar,
} from '../components/MirrorParts.tsx';
import { api } from '../lib/api.ts';
import type { QuoteInternalMirror } from '../lib/documents.ts';
import { formatCode, formatDateTime, formatMoney } from '../lib/format.ts';
import './quoteMirror.css';

const WARNING = 'Uso interno: não enviar ao cliente';
const TYPE_LABEL = { product: 'Produtos', service: 'Serviços' };

const moneyOrDash = (value: number | null) => (value === null ? '—' : formatMoney(value));
const percent = (value: number | null) =>
  value === null ? '—' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

export default function QuoteInternalMirrorPage() {
  const { id } = useParams();
  const mirror = useQuery({
    queryKey: ['/quotes', id, 'internal-mirror'],
    queryFn: () => api<QuoteInternalMirror>(`/quotes/${id}/internal-mirror`),
    retry: false,
  });

  const code = mirror.data ? formatCode(mirror.data.number) : null;
  // O título vira o nome sugerido do arquivo ao salvar em PDF: deixa claro que é o documento interno.
  useEffect(() => {
    if (code) document.title = `USO INTERNO - Orçamento ${code}`;
  }, [code]);

  if (mirror.isPending) return <div className="page-loading">Carregando...</div>;
  if (mirror.isError) {
    return (
      <main className="mirror-page">
        <p role="alert">{mirror.error.message}</p>
      </main>
    );
  }

  const quote = mirror.data;
  const { margin } = quote;
  const charges = quote.freight + quote.otherCharges;

  return (
    <main className="mirror-page">
      <MirrorToolbar />

      <article className="mirror-sheet">
        <p className="mirror-internal-warning" role="note">
          {WARNING}
        </p>
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
                <th>Custo un.</th>
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
                  <td>{moneyOrDash(item.unitCost)}</td>
                  <td>{formatMoney(item.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h2>Resumo por tipo</h2>
          <table className="mirror-items">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Venda</th>
                <th>Custo</th>
                <th>Resultado</th>
                <th>Margem</th>
              </tr>
            </thead>
            <tbody>
              {quote.summary.map((line) => (
                <tr key={line.type}>
                  <td>{TYPE_LABEL[line.type]}</td>
                  <td>{formatMoney(line.revenue)}</td>
                  <td>{moneyOrDash(line.cost)}</td>
                  <td>{moneyOrDash(line.result)}</td>
                  <td>{percent(line.percent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {margin.missingCost > 0 && (
          <p className="mirror-notice" role="status">
            {margin.missingCost === 1 ? '1 item está' : `${margin.missingCost} itens estão`} sem custo:
            informe no cadastro do produto para calcular a margem.
          </p>
        )}

        <dl className="mirror-totals">
          <div>
            <dt>Itens menos desconto</dt>
            <dd>{formatMoney(margin.revenue)}</dd>
          </div>
          <div>
            <dt>Custo dos itens</dt>
            <dd>{moneyOrDash(margin.cost)}</dd>
          </div>
          <div>
            <dt>Resultado</dt>
            <dd>{moneyOrDash(margin.result)}</dd>
          </div>
          <div className="mirror-total">
            <dt>Margem</dt>
            <dd>{percent(margin.percent)}</dd>
          </div>
        </dl>

        <dl className="mirror-totals">
          {charges > 0 && (
            <div>
              <dt>Frete e outras despesas (fora da margem)</dt>
              <dd>{formatMoney(charges)}</dd>
            </div>
          )}
          <div>
            <dt>Total do orçamento</dt>
            <dd>{formatMoney(quote.total)}</dd>
          </div>
        </dl>

        {quote.internalNotes && (
          <section className="mirror-text">
            <h2>Observação interna</h2>
            <p>{quote.internalNotes}</p>
          </section>
        )}

        <footer className="mirror-footer">
          {WARNING}. Impresso em {formatDateTime(new Date().toISOString())}
        </footer>
      </article>
    </main>
  );
}
