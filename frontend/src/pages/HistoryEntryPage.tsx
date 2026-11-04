import { FileText } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState } from '../components/EmptyState.tsx';
import { formatCode, formatDate, formatDateTime, formatMoney, label } from '../lib/format.ts';
import { type HistoryChange, type HistoryItemChange, useHistoryEntry } from '../lib/history.ts';
import { useTab, useTabTitle } from '../workspace/tab.ts';

const quantity = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });

function formatValue(kind: HistoryChange['kind'], value: HistoryChange['from']) {
  if (value === null || value === '') return '—';
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

function itemFrom(item: HistoryItemChange) {
  if (item.change === 'added') return '—';
  const qty = item.fromQuantity ?? item.quantity;
  return `${quantity.format(qty)} × ${formatMoney(item.fromUnitPrice ?? item.unitPrice)}`;
}

const itemTo = (item: HistoryItemChange) =>
  item.change === 'removed' ? '—' : `${quantity.format(item.quantity)} × ${formatMoney(item.unitPrice)}`;

// Detalhe de um registro do histórico: o que mudou, com os valores de antes e depois.
export default function HistoryEntryPage() {
  const { params } = useTab();
  const entry = useHistoryEntry(Number(params.id));
  const noun = entry.data?.type === 'order' ? 'Pedido' : 'Orçamento';
  const code = entry.data?.documentNumber ? formatCode(entry.data.documentNumber) : '';
  useTabTitle(entry.data ? `Alteração: ${noun} ${code}`.trim() : null);

  if (entry.isPending) return <div className="loading">Carregando alteração...</div>;
  if (entry.isError) return <EmptyState text={entry.error.message} />;
  const { data } = entry;
  const path = `/${data.type === 'quote' ? 'orcamentos' : 'pedidos'}/${data.documentId}`;
  const hasDetail = data.changes.length > 0 || data.items.length > 0;

  return (
    <section className="document">
      <div className="section-heading page-heading">
        <div>
          <span className="welcome-label">HISTÓRICO</span>
          <h2>
            {data.summary}: {noun} {code}
          </h2>
          <p>
            Por <strong>{data.actorName}</strong> em{' '}
            <time dateTime={data.createdAt}>{formatDateTime(data.createdAt, true)}</time>
          </p>
        </div>
        <div className="document-actions">
          {data.documentExists ? (
            <Link className="button secondary" to={path}>
              <FileText size={16} /> Abrir {noun.toLowerCase()}
            </Link>
          ) : (
            <span className="muted">Documento excluído</span>
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
                    <td>{formatValue(change.kind, change.from)}</td>
                    <td>{formatValue(change.kind, change.to)}</td>
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
