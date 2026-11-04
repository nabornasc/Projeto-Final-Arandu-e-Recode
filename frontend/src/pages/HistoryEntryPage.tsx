import { FileText } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState } from '../components/EmptyState.tsx';
import { formatDate, formatDateTime, formatMoney, label } from '../lib/format.ts';
import { type HistoryChange, type HistoryItemChange, useHistoryEntry } from '../lib/history.ts';
import { useTab, useTabTitle } from '../workspace/tab.ts';

const quantity = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });

function formatValue(kind: HistoryChange['kind'], value: HistoryChange['from']) {
  if (value === null || value === '') return '—';
  if (kind === 'boolean') return value ? 'Sim' : 'Não';
  if (kind === 'number') return quantity.format(Number(value));
  if (kind === 'money') return formatMoney(Number(value));
  if (kind === 'date') return formatDate(String(value));
  if (kind === 'status') return label(String(value));
  return String(value);
}

const ITEM_LABEL: Record<HistoryItemChange['change'], string> = {
  added: 'Item incluído',
  removed: 'Item removido',
  changed: 'Item alterado',
};

// Item de interesse da oportunidade pode não ter preço.
const formatLine = (qty: number, price: number | null | undefined) =>
  price === null || price === undefined
    ? quantity.format(qty)
    : `${quantity.format(qty)} × ${formatMoney(price)}`;

function itemFrom(item: HistoryItemChange) {
  if (item.change === 'added') return '—';
  if (item.change === 'removed') return formatLine(item.quantity, item.unitPrice);
  return formatLine(item.fromQuantity ?? item.quantity, item.fromUnitPrice);
}

const itemTo = (item: HistoryItemChange) =>
  item.change === 'removed' ? '—' : formatLine(item.quantity, item.unitPrice);

// Detalhe de um registro do histórico: o que mudou, com os valores de antes e depois.
export default function HistoryEntryPage() {
  const { params } = useTab();
  const entry = useHistoryEntry(Number(params.id));
  useTabTitle(entry.data ? `Alteração: ${entry.data.label ?? entry.data.module}` : null);

  if (entry.isPending) return <div className="loading">Carregando alteração...</div>;
  if (entry.isError) return <EmptyState text={entry.error.message} />;
  const { data } = entry;
  const isDocument = data.type === 'quote' || data.type === 'order';
  const hasDetail = data.changes.length > 0 || data.items.length > 0;

  return (
    <section className="document">
      <div className="section-heading page-heading">
        <div>
          <span className="welcome-label">HISTÓRICO · {data.module.toUpperCase()}</span>
          <h2>
            {data.summary}
            {data.label && `: ${data.label}`}
          </h2>
          <p>
            Por <strong>{data.actorName}</strong> em{' '}
            <time dateTime={data.createdAt}>{formatDateTime(data.createdAt, true)}</time>
          </p>
        </div>
        <div className="document-actions">
          {data.path ? (
            <Link className="button secondary" to={data.path}>
              <FileText size={16} /> {data.openLabel}
            </Link>
          ) : (
            !data.documentExists && (
              <span className="muted">{isDocument ? 'Documento excluído' : 'Registro excluído'}</span>
            )
          )}
        </div>
      </div>

      {data.reason && (
        <section className="panel history-reason">
          <strong>Motivo</strong>
          <p>{data.reason}</p>
        </section>
      )}

      <section className="panel">
        {hasDetail ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">O que mudou</th>
                  <th scope="col">Antes</th>
                  <th scope="col">Depois</th>
                </tr>
              </thead>
              <tbody>
                {data.changes.map((change) => (
                  <tr key={change.field}>
                    <td>{change.label}</td>
                    {change.masked ? (
                      <td colSpan={2} className="muted">
                        Alterado (valor protegido)
                      </td>
                    ) : (
                      <>
                        <td>{formatValue(change.kind, change.from)}</td>
                        <td>{formatValue(change.kind, change.to)}</td>
                      </>
                    )}
                  </tr>
                ))}
                {data.items.map((item, index) => (
                  // Registro imutável: a posição identifica a linha.
                  // biome-ignore lint/suspicious/noArrayIndexKey: a lista nunca muda
                  <tr key={index}>
                    <td>
                      {ITEM_LABEL[item.change]}: {item.name}
                    </td>
                    <td>{itemFrom(item)}</td>
                    <td>{itemTo(item)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Este registro não guarda o detalhe dos valores alterados.</p>
        )}
      </section>
    </section>
  );
}
