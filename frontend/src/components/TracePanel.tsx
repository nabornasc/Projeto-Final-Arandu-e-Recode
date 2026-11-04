import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { type TraceNode, useTrace } from '../lib/documents.ts';
import { formatCode, formatDate, formatMoney, label } from '../lib/format.ts';

const pathOf = (node: TraceNode) => `/${node.type === 'quote' ? 'orcamentos' : 'pedidos'}/${node.id}`;

function Node({ node, current }: { node: TraceNode; current: string }) {
  const isCurrent = `${node.type}:${node.id}` === current;
  const name = `${node.type === 'quote' ? 'Orçamento' : 'Pedido'} ${formatCode(node.number)}`;
  return (
    <li>
      <div className="trace-node">
        {node.kind && <small className="muted">{label(node.kind)}</small>}
        {isCurrent ? <strong>{name}</strong> : <Link to={pathOf(node)}>{name}</Link>}
        <span className={`status ${node.status}`}>{label(node.status)}</span>
        <span>{formatMoney(node.total)}</span>
        <small className="muted">{formatDate(node.date)}</small>
        {node.receivedAt && <small className="positive">Recebido em {formatDate(node.receivedAt)}</small>}
      </div>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <Node key={`${child.type}:${child.id}`} node={child} current={current} />
          ))}
        </ul>
      )}
    </li>
  );
}

// Cadeia do documento: oportunidade, de onde nasceu e o que nasceu dele.
export function TracePanel({ type, id }: { type: 'quote' | 'order'; id: number }) {
  const trace = useTrace(type, id);
  if (trace.isPending) return null;
  if (trace.isError) return <p className="form-error">{trace.error.message}</p>;
  const { opportunity, roots } = trace.data;
  const alone = !opportunity && roots.length === 1 && roots[0]?.children.length === 0;
  if (alone) return null;
  return (
    <section className="panel trace-panel" aria-label="Rastreio">
      <h3>Rastreio</h3>
      {opportunity && (
        <p className="trace-opportunity">
          <ChevronRight size={14} aria-hidden="true" />
          Oportunidade <Link to={`/crm/${opportunity.id}`}>{opportunity.title}</Link>
          <span className={`status ${opportunity.status}`}>{label(opportunity.status)}</span>
          <small className="muted">{opportunity.stageName}</small>
        </p>
      )}
      <ul className="trace-tree">
        {roots.map((root) => (
          <Node key={`${root.type}:${root.id}`} node={root} current={`${type}:${id}`} />
        ))}
      </ul>
    </section>
  );
}
