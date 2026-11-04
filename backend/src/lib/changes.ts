// Comparação de antes e depois usada no histórico. Grava só o que mudou, com valores já legíveis
// (nome do cliente em vez do id), para o registro continuar correto se o cadastro mudar depois.

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface ItemLine {
  productId: number;
  name: string;
  quantity: number;
  unitPrice: number;
}

export type ItemChange =
  | { change: 'added' | 'removed'; name: string; quantity: number; unitPrice: number }
  | {
      change: 'changed';
      name: string;
      quantity: number;
      unitPrice: number;
      fromQuantity: number;
      fromUnitPrice: number;
    };

type Values = Record<string, unknown>;

const isBlank = (value: unknown) => value === null || value === undefined || value === '';

export function diffFields(before: Values, after: Values): FieldChange[] {
  return Object.keys({ ...before, ...after }).flatMap((field) => {
    const from = before[field];
    const to = after[field];
    if (from === to || (isBlank(from) && isBlank(to))) return [];
    return [{ field, from: from ?? null, to: to ?? null }];
  });
}

// Na criação e na exclusão, só os campos preenchidos: desconto zero e vazios não dizem nada.
const filled = (values: Values) =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => !isBlank(value) && value !== 0));

export const initialFields = (values: Values) => diffFields({}, filled(values));
export const removedFields = (values: Values) => diffFields(filled(values), {});

// Compara por produto, na ordem das linhas: o mesmo produto pode aparecer mais de uma vez no documento.
// Mudar a ordem das linhas não conta como alteração.
export function diffItems(before: ItemLine[], after: ItemLine[]): ItemChange[] {
  const remaining = [...before];
  const changes: ItemChange[] = [];
  for (const line of after) {
    const { name, quantity, unitPrice } = line;
    const index = remaining.findIndex((item) => item.productId === line.productId);
    const previous = index === -1 ? undefined : remaining.splice(index, 1)[0];
    if (!previous) changes.push({ change: 'added', name, quantity, unitPrice });
    else if (previous.quantity !== quantity || previous.unitPrice !== unitPrice) {
      changes.push({
        change: 'changed',
        name,
        quantity,
        unitPrice,
        fromQuantity: previous.quantity,
        fromUnitPrice: previous.unitPrice,
      });
    }
  }
  for (const { name, quantity, unitPrice } of remaining) {
    changes.push({ change: 'removed', name, quantity, unitPrice });
  }
  return changes;
}
