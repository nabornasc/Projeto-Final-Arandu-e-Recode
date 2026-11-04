import { Plus, Trash2 } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';

export interface Product {
  id: number;
  name: string;
  price: number;
  stock: number | null;
}

export interface Line {
  key: number;
  productId: string;
  quantity: string;
  unitPrice: string;
}

let lineKey = 0;
export const newLine = (initial?: { productId: number; quantity: number; unitPrice: number }): Line => ({
  key: ++lineKey,
  productId: initial ? String(initial.productId) : '',
  quantity: initial ? String(initial.quantity) : '1',
  unitPrice: initial ? String(initial.unitPrice) : '0',
});

export const linesSubtotal = (lines: Line[]) =>
  lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitPrice || 0), 0);

export const linesToItems = (lines: Line[]) =>
  lines
    .filter((line) => line.productId)
    .map((line) => ({
      productId: Number(line.productId),
      quantity: Number(line.quantity),
      unitPrice: Number(line.unitPrice),
    }));

interface Props {
  lines: Line[];
  setLines: Dispatch<SetStateAction<Line[]>>;
  products: Product[] | undefined;
  // Mínimo de linhas (0 quando a lista pode ficar vazia, como nos itens de interesse).
  minLines?: number;
}

// Itens com produto, quantidade e preço (pedidos e orçamentos). Escolher o produto preenche o preço.
export function ItemLines({ lines, setLines, products, minLines = 1 }: Props) {
  const productById = new Map(products?.map((product) => [String(product.id), product]));
  const updateLine = (key: number, patch: Partial<Line>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  return (
    <>
      {lines.map((line, index) => (
        <div key={line.key} className="order-line">
          <label>
            {`Item ${index + 1}`}
            <select
              name={`items.${index}.productId`}
              value={line.productId}
              onChange={(event) => {
                const product = productById.get(event.target.value);
                updateLine(line.key, {
                  productId: event.target.value,
                  unitPrice: String(product?.price ?? 0),
                });
              }}
            >
              <option value="">Selecione</option>
              {products?.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} {product.stock === null ? '(serviço)' : `(estoque: ${product.stock})`}
                </option>
              ))}
            </select>
          </label>
          <label>
            Qtd.
            <input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              name={`items.${index}.quantity`}
              value={line.quantity}
              onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
            />
          </label>
          <label>
            Preço (R$)
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              name={`items.${index}.unitPrice`}
              value={line.unitPrice}
              onChange={(event) => updateLine(line.key, { unitPrice: event.target.value })}
            />
          </label>
          <button
            type="button"
            className="button secondary"
            aria-label={`Remover item ${index + 1}`}
            disabled={lines.length <= minLines}
            onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <div className="full-row">
        <button
          type="button"
          className="button secondary"
          onClick={() => setLines((current) => [...current, newLine()])}
        >
          <Plus size={14} /> Adicionar item
        </button>
      </div>
    </>
  );
}
