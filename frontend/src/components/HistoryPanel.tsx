import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { formatDateTime } from '../lib/format.ts';
import { useDocumentHistory } from '../lib/history.ts';

// Lista enxuta: quem, o quê e quando. O clique abre o detalhe da alteração em outra aba.
export function HistoryPanel({ type, id }: { type: 'quote' | 'order'; id: number }) {
  const history = useDocumentHistory(type, id);
  return (
    <section className="panel" aria-label="Histórico de alterações">
      {history.isPending && <div className="loading">Carregando histórico...</div>}
      {history.isError && <p className="form-error">{history.error.message}</p>}
      {history.data?.length === 0 && <p className="muted">Nenhuma alteração registrada.</p>}
      {history.data && history.data.length > 0 && (
        <ul className="history-list">
          {history.data.map((line) => (
            <li key={line.id} className="history-row">
              <Link to={`/historico/${line.id}`}>
                <strong>{line.actorName}</strong>
                <span>
                  {line.summary}
                  {line.reason && <small className="muted history-note">Motivo: {line.reason}</small>}
                </span>
                <time dateTime={line.createdAt}>{formatDateTime(line.createdAt)}</time>
                <ChevronRight size={15} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
