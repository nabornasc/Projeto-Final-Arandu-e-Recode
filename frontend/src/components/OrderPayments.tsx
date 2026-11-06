import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ReasonModal, type ReasonRequest } from '../actions/ReasonModal.tsx';
import { api } from '../lib/api.ts';
import { can, useProfile } from '../lib/auth.ts';
import type { Order, OrderPayment } from '../lib/documents.ts';
import { formatDate, formatMoney } from '../lib/format.ts';
import { useToast } from './Toast.tsx';

// Baixas do pedido. A estornada continua na lista, com o motivo.
export function OrderPayments({ order }: { order: Order }) {
  const profile = useProfile();
  const notify = useToast();
  const client = useQueryClient();
  const [request, setRequest] = useState<ReasonRequest | null>(null);
  const canReverse = can(profile, 'receivables.reverse');
  if (!order.payments.length) return null;

  const partOf = (payment: OrderPayment) => {
    const title = order.receivables.find((item) => item.id === payment.receivableId);
    return title ? `${title.position}/${order.receivables.length}` : '—';
  };
  const ask = (payment: OrderPayment) =>
    setRequest({
      eyebrow: 'FINANCEIRO',
      title: `Estornar baixa da parcela ${partOf(payment)}`,
      description:
        'O valor sai do caixa e volta para o saldo da conta. A baixa fica registrada com o motivo.',
      confirmLabel: 'Estornar baixa',
      suggestions: ['Pagamento não compensado', 'Lançado por engano', 'Valor incorreto'],
      withPassword: true,
      submit: (reason, password) =>
        api(`/receivable-payments/${payment.id}/reverse`, {
          method: 'POST',
          body: { reason, password },
        }),
      message: 'Baixa estornada.',
    });

  return (
    <div className="panel table-panel order-payments">
      <div className="table-wrap">
        <table className="items-table" aria-label="Baixas do pedido">
          <thead>
            <tr>
              <th>Parcela</th>
              <th>Data</th>
              <th>Conta</th>
              <th>Forma</th>
              <th>Juros</th>
              <th>Desconto</th>
              <th>Recebido</th>
              <th>Situação</th>
              <th aria-label="Ações" />
            </tr>
          </thead>
          <tbody>
            {order.payments.map((payment) => (
              <tr key={payment.id}>
                <td>{partOf(payment)}</td>
                <td>{formatDate(payment.paidOn)}</td>
                <td>{payment.accountName ? `${payment.bankName} — ${payment.accountName}` : '—'}</td>
                <td>{payment.method ?? '—'}</td>
                <td>{formatMoney(payment.interest)}</td>
                <td>{formatMoney(payment.discount)}</td>
                <td>{formatMoney(payment.received)}</td>
                <td>
                  {payment.reversedAt ? `Estornada: ${payment.reversalReason ?? 'sem motivo'}` : 'Ativa'}
                  {payment.notes && <small className="muted settle-customer">{payment.notes}</small>}
                </td>
                <td className="actions">
                  {canReverse && !payment.reversedAt && (
                    <button
                      type="button"
                      aria-label={`Estornar baixa da parcela ${partOf(payment)}`}
                      onClick={() => ask(payment)}
                    >
                      Estornar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {request && (
        <ReasonModal
          request={request}
          onClose={() => setRequest(null)}
          onDone={() => {
            setRequest(null);
            void client.invalidateQueries();
            notify(request.message);
          }}
        />
      )}
    </div>
  );
}
