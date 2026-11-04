import { quoteSchema } from '@arandue/shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { ActionMenu } from '../actions/ActionMenu.tsx';
import { quoteActions } from '../actions/registry.ts';
import { CustomerSelect, ItemsTable, Totals } from '../components/DocumentParts.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import {
  ItemLines,
  type Line,
  linesSubtotal,
  linesToItems,
  newLine,
  type Product,
} from '../components/ItemLines.tsx';
import { useToast } from '../components/Toast.tsx';
import { TracePanel } from '../components/TracePanel.tsx';
import { api } from '../lib/api.ts';
import { can, useProfile } from '../lib/auth.ts';
import { type OpportunityDetail, type Quote, useOpportunity, useQuote } from '../lib/documents.ts';
import { formatCode, label } from '../lib/format.ts';
import { useTab, useTabDirty, useTabTitle } from '../workspace/tab.ts';

// Tela do orçamento (novo ou existente), aberta numa aba. Só rascunho é editável.
export default function QuoteDocumentPage() {
  const { params } = useTab();
  const id = params.id ? Number(params.id) : null;
  // Aberto a partir de uma oportunidade: já vem com cliente, itens de interesse e vínculo.
  const opportunityId = params.opportunityId ? Number(params.opportunityId) : null;
  const quote = useQuote(id);
  const opportunity = useOpportunity(opportunityId);
  useTabTitle(
    id === null ? 'Novo orçamento' : quote.data ? `Orçamento ${formatCode(quote.data.number)}` : null,
  );

  if (id !== null && quote.isPending) return <div className="loading">Carregando orçamento...</div>;
  if (quote.isError) return <EmptyState text={quote.error.message} />;
  if (opportunityId !== null && opportunity.isPending)
    return <div className="loading">Carregando oportunidade...</div>;
  if (opportunity.isError) return <EmptyState text={opportunity.error.message} />;
  return (
    <QuoteEditor
      key={quote.data?.id ?? 'novo'}
      quote={quote.data ?? null}
      opportunity={opportunity.data ?? null}
    />
  );
}

function QuoteEditor({ quote, opportunity }: { quote: Quote | null; opportunity: OpportunityDetail | null }) {
  const profile = useProfile();
  const tab = useTab();
  const notify = useToast();
  const client = useQueryClient();
  const formId = useId();
  const products = useQuery({ queryKey: ['/products'], queryFn: () => api<Product[]>('/products') });
  const editable = quote
    ? quote.status === 'draft' && can(profile, 'quotes.update')
    : can(profile, 'quotes.create');

  const seedCustomer = quote?.customerId ?? opportunity?.customerId;
  const [customerId, setCustomerId] = useState(seedCustomer ? String(seedCustomer) : '');
  const [validUntil, setValidUntil] = useState(quote?.validUntil ?? '');
  const [discount, setDiscount] = useState(String(quote?.discount ?? 0));
  const [notes, setNotes] = useState(quote?.notes ?? '');
  const [lines, setLines] = useState<Line[]>(() =>
    quote
      ? quote.items.map((item) => newLine(item))
      : opportunity?.items.length
        ? opportunity.items.map((item) =>
            newLine({ ...item, unitPrice: item.unitPrice ?? item.catalogPrice }),
          )
        : [newLine()],
  );
  const [error, setError] = useState<string | null>(null);

  const payload = {
    opportunityId: quote ? undefined : (opportunity?.id ?? null),
    customerId: customerId ? Number(customerId) : null,
    validUntil: validUntil || null,
    discount: Number(discount || 0),
    notes,
    items: linesToItems(lines),
  };
  // Compara com o último estado salvo para marcar a aba com alterações pendentes.
  const [baseline, setBaseline] = useState(() => JSON.stringify(payload));
  useTabDirty(editable && JSON.stringify(payload) !== baseline);

  const save = useMutation({
    mutationFn: (body: unknown) =>
      quote
        ? api<Quote>(`/quotes/${quote.id}`, { method: 'PUT', body })
        : api<Quote>('/quotes', { method: 'POST', body }),
    onSuccess: (saved) => {
      setBaseline(JSON.stringify(payload));
      void client.invalidateQueries();
      notify(quote ? 'Orçamento salvo.' : `Orçamento ${formatCode(saved.number)} criado como rascunho.`);
      if (!quote) tab.replaceWith(`/orcamentos/${saved.id}`);
    },
    onError: (err) => setError(err.message),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = quoteSchema.safeParse(payload);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Verifique os campos.');
    setError(null);
    save.mutate(payload);
  }

  const title = quote ? `Orçamento ${formatCode(quote.number)}` : 'Novo orçamento';

  return (
    <section className="document">
      <div className="section-heading page-heading">
        <div>
          <span className="welcome-label">ORÇAMENTO</span>
          <h2>
            {title} {quote && <span className={`status ${quote.status}`}>{label(quote.status)}</span>}
          </h2>
          <p>
            {editable
              ? 'Rascunho: escolha os itens e salve. Depois, envie ao cliente pelo menu de ações.'
              : 'Somente rascunhos podem ser editados. Use o menu de ações para os próximos passos.'}
          </p>
        </div>
        <div className="document-actions">
          {editable && (
            <button type="submit" form={formId} className="button primary" disabled={save.isPending}>
              <Save size={16} /> {save.isPending ? 'Salvando...' : 'Salvar'}
            </button>
          )}
          {quote && (
            <ActionMenu
              actions={quoteActions}
              record={quote}
              label={`orçamento ${title}`}
              exclude={['quote.open']}
            />
          )}
        </div>
      </div>

      <form id={formId} className="panel" onSubmit={submit} noValidate>
        <div className="form-grid">
          <CustomerSelect value={customerId} onChange={setCustomerId} disabled={!editable} />
          <label>
            Válido até
            <input
              name="validUntil"
              type="date"
              disabled={!editable}
              value={validUntil}
              onChange={(event) => setValidUntil(event.target.value)}
            />
          </label>

          {editable ? (
            <ItemLines lines={lines} setLines={setLines} products={products.data} />
          ) : (
            quote && <ItemsTable items={quote.items} />
          )}

          <label>
            Desconto (R$)
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              name="discount"
              disabled={!editable}
              value={discount}
              onChange={(event) => setDiscount(event.target.value)}
            />
          </label>
          <label>
            Observações
            <input
              type="text"
              maxLength={500}
              placeholder="Ex.: prazo de entrega de 5 dias"
              name="notes"
              disabled={!editable}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
        </div>

        <Totals subtotal={linesSubtotal(lines)} discount={Number(discount || 0)} label="Total do orçamento" />

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
      {quote && <TracePanel type="quote" id={quote.id} />}
    </section>
  );
}
