import { QUOTE_STATUSES } from '@arandue/shared/schemas';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router';
import { ActionMenu } from '../actions/ActionMenu.tsx';
import { quoteActions } from '../actions/registry.ts';
import { EmptyState } from '../components/EmptyState.tsx';
import { ListFilters, ListTotals } from '../components/ListFilters.tsx';
import { api } from '../lib/api.ts';
import { can, useProfile } from '../lib/auth.ts';
import type { Quote } from '../lib/documents.ts';
import { formatCode, formatDate, formatMoney, label } from '../lib/format.ts';
import { applyListFilters, useListFilters } from '../lib/listFilters.ts';

const STATUSES = QUOTE_STATUSES.map((status) => [status, label(status)] as const);

export default function QuotesPage() {
  const profile = useProfile();
  const navigate = useNavigate();
  const canCreate = can(profile, 'quotes.create');
  const quotes = useQuery({ queryKey: ['/quotes'], queryFn: () => api<Quote[]>('/quotes') });
  const control = useListFilters();
  const loaded = quotes.data?.length ?? 0;
  const visible = applyListFilters(quotes.data ?? [], control.filters, {
    date: (quote) => quote.createdAt,
    status: (quote) => quote.status,
    text: (quote) => [quote.customerName, formatCode(quote.number), quote.number],
  });
  // O que foi recusado ou cancelado não está mais em negociação.
  const inPlay = visible.filter((quote) => quote.status !== 'rejected' && quote.status !== 'cancelled');

  return (
    <section>
      <div className="section-heading page-heading">
        <div>
          <span className="welcome-label">VENDAS</span>
          <h2>Orçamentos</h2>
          <p>Monte a proposta, envie ao cliente e, aprovada, transforme em pedido.</p>
        </div>
        {canCreate && (
          <button type="button" className="button primary" onClick={() => navigate('/orcamentos/novo')}>
            <Plus size={17} /> Novo orçamento
          </button>
        )}
      </div>

      {loaded > 0 && (
        <ListFilters
          control={control}
          dateLabel="Data do orçamento"
          textLabel="Cliente ou número"
          statuses={STATUSES}
        />
      )}

      <div className="panel table-panel">
        {quotes.isPending ? (
          <div className="loading">Carregando orçamentos...</div>
        ) : quotes.isError ? (
          <EmptyState text={quotes.error.message} />
        ) : visible.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Orçamento</th>
                  <th>Cliente</th>
                  <th>Validade</th>
                  <th>Itens</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {visible.map((quote) => {
                  const code = formatCode(quote.number);
                  const summary = quote.items
                    .map((item) => `${item.quantity}x ${item.productName}`)
                    .join(', ');
                  return (
                    <tr key={quote.id}>
                      <td>
                        <button
                          type="button"
                          className="link-cell"
                          onClick={() => navigate(`/orcamentos/${quote.id}`)}
                        >
                          {code}
                        </button>
                      </td>
                      <td>{quote.customerName ?? 'Cliente não informado'}</td>
                      <td>{formatDate(quote.validUntil)}</td>
                      <td title={summary} className="truncate">
                        {summary}
                      </td>
                      <td>
                        <span className={`status ${quote.status}`}>{label(quote.status)}</span>
                        {quote.orderNumber !== null && (
                          <small className="muted"> · pedido {formatCode(quote.orderNumber)}</small>
                        )}
                      </td>
                      <td>
                        <strong>{formatMoney(quote.total)}</strong>
                      </td>
                      <td className="actions">
                        <ActionMenu actions={quoteActions} record={quote} label={`orçamento ${code}`} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            text={loaded ? 'Nenhum registro com esses filtros.' : 'Nenhum orçamento ainda.'}
            action={canCreate && !loaded ? 'Criar primeiro orçamento' : undefined}
            onClick={() => navigate('/orcamentos/novo')}
          />
        )}
      </div>

      {loaded > 0 && (
        <ListTotals
          count={visible.length}
          loaded={loaded}
          totals={[{ label: 'Valor total', value: inPlay.reduce((sum, quote) => sum + quote.total, 0) }]}
        />
      )}
    </section>
  );
}
