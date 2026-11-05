import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import type { Customer, DocumentItem } from '../lib/documents.ts';
import { formatMoney } from '../lib/format.ts';

// Peças comuns às telas de orçamento e pedido.

export function CustomerSelect({
  value,
  onChange,
  disabled,
  emptyLabel = 'Não informado',
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  emptyLabel?: string;
}) {
  // Só pessoas com o papel de cliente (cadastro único).
  const customers = useQuery({
    queryKey: ['/people', 'customer', ''],
    queryFn: () => api<Customer[]>('/people?role=customer'),
  });
  return (
    <label>
      Cliente
      <select
        name="customerId"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{emptyLabel}</option>
        {customers.data?.map((customer) => (
          <option key={customer.id} value={customer.id}>
            {customer.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ItemsTable({ items }: { items: DocumentItem[] }) {
  return (
    <div className="table-wrap full-row">
      <table className="items-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Qtd.</th>
            <th>Preço</th>
            <th>Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.productName}</td>
              <td>{item.quantity}</td>
              <td>{formatMoney(item.unitPrice)}</td>
              <td>{formatMoney(item.subtotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Totals({
  subtotal,
  discount,
  freight = 0,
  otherCharges = 0,
  label,
}: {
  subtotal: number;
  discount: number;
  freight?: number;
  otherCharges?: number;
  label: string;
}) {
  return (
    <div className="order-summary-box">
      <div>
        <span>Subtotal:</span> <strong>{formatMoney(subtotal)}</strong>
      </div>
      {discount > 0 && (
        <div>
          <span>Desconto:</span> <strong>− {formatMoney(discount)}</strong>
        </div>
      )}
      {freight > 0 && (
        <div>
          <span>Frete:</span> <strong>{formatMoney(freight)}</strong>
        </div>
      )}
      {otherCharges > 0 && (
        <div>
          <span>Outras despesas:</span> <strong>{formatMoney(otherCharges)}</strong>
        </div>
      )}
      <div className="order-total-highlight">
        <span>{label}:</span>{' '}
        <strong>{formatMoney(Math.max(0, subtotal - discount + freight + otherCharges))}</strong>
      </div>
    </div>
  );
}
