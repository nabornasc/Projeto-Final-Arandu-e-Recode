import { areaInSquareMeters, type MeasureUnit } from '@arandue/shared/schemas';
import { Plus, Trash2 } from 'lucide-react';
import { type Dispatch, type SetStateAction, useId } from 'react';

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
  groupName: string;
  width: string;
  length: string;
  // Vazio em item novo: usa a unidade atual da empresa. Item salvo mantém a unidade em que foi digitado.
  measureUnit: MeasureUnit | '';
}

let lineKey = 0;
export const newLine = (initial?: {
  productId: number;
  quantity: number;
  unitPrice: number;
  groupName?: string | null;
  width?: number | null;
  length?: number | null;
  measureUnit?: MeasureUnit | null;
}): Line => ({
  key: ++lineKey,
  productId: initial ? String(initial.productId) : '',
  quantity: initial ? String(initial.quantity) : '1',
  unitPrice: initial ? String(initial.unitPrice) : '0',
  groupName: initial?.groupName ?? '',
  width: initial?.width ? String(initial.width) : '',
  length: initial?.length ? String(initial.length) : '',
  measureUnit: initial?.width ? (initial.measureUnit ?? 'm') : '',
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

export const linesToQuoteItems = (lines: Line[], defaultUnit: MeasureUnit) =>
  lines
    .filter((line) => line.productId)
    .map((line) => ({
      productId: Number(line.productId),
      quantity: Number(line.quantity),
      unitPrice: Number(line.unitPrice),
      groupName: line.groupName,
      width: line.width ? Number(line.width) : null,
      length: line.length ? Number(line.length) : null,
      measureUnit: line.width || line.length ? line.measureUnit || defaultUnit : null,
    }));

const area = (width: string, length: string, unit: MeasureUnit) =>
  width && length ? String(areaInSquareMeters(Number(width), Number(length), unit)) : null;

interface Props {
  lines: Line[];
  setLines: Dispatch<SetStateAction<Line[]>>;
  products: Product[] | undefined;
  // Mínimo de linhas (0 quando a lista pode ficar vazia, como nos itens de interesse).
  minLines?: number;
  // Só no orçamento: grupo em cada item e, se a empresa usa, largura e comprimento.
  groups?: boolean;
  measures?: boolean;
  measureUnit?: MeasureUnit;
}

// Itens com produto, quantidade e preço (pedidos e orçamentos). Escolher o produto preenche o preço.
export function ItemLines({
  lines,
  setLines,
  products,
  minLines = 1,
  groups = false,
  measures = false,
  measureUnit = 'm',
}: Props) {
  const groupListId = useId();
  const groupNames = [...new Set(lines.map((line) => line.groupName.trim()).filter(Boolean))];
  const productById = new Map(products?.map((product) => [String(product.id), product]));
  const updateLine = (key: number, patch: Partial<Line>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  return (
    <>
      {groups && (
        <datalist id={groupListId}>
          {groupNames.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      )}
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
              readOnly={Boolean(line.width && line.length)}
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
          {groups && (
            <div className="order-line-details">
              <label>
                Grupo (opcional)
                <input
                  type="text"
                  list={groupListId}
                  maxLength={80}
                  placeholder="Ex.: cozinha, etapa 1, kit"
                  name={`items.${index}.groupName`}
                  value={line.groupName}
                  onChange={(event) => updateLine(line.key, { groupName: event.target.value })}
                />
              </label>
              {measures && (
                <>
                  <label>
                    Largura ({line.measureUnit || measureUnit})
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      step="0.01"
                      name={`items.${index}.width`}
                      value={line.width}
                      onChange={(event) =>
                        updateLine(line.key, {
                          width: event.target.value,
                          quantity:
                            area(event.target.value, line.length, line.measureUnit || measureUnit) ??
                            line.quantity,
                        })
                      }
                    />
                  </label>
                  <label>
                    Comprimento ({line.measureUnit || measureUnit})
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      step="0.01"
                      name={`items.${index}.length`}
                      value={line.length}
                      onChange={(event) =>
                        updateLine(line.key, {
                          length: event.target.value,
                          quantity:
                            area(line.width, event.target.value, line.measureUnit || measureUnit) ??
                            line.quantity,
                        })
                      }
                    />
                  </label>
                </>
              )}
            </div>
          )}
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
