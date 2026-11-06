import { formatAddress, formatDocument } from '@arandue/shared/br';
import { asc, eq } from 'drizzle-orm';
import type { DbOrTx } from '../db/client.ts';
import { companies, people, products, quoteItems, users } from '../db/schema.ts';
import { notFound } from '../lib/errors.ts';
import { round2 } from '../lib/money.ts';

// Monta os dados do espelho do cliente que vêm de outros cadastros. A API decide o que cada um vê.
export async function buildMirrorSnapshot(
  db: DbOrTx,
  companyId: number,
  quote: { id: number; customerId: number | null; createdBy: number | null },
) {
  const [company] = await db
    .select({
      name: companies.name,
      legalName: companies.legalName,
      cnpj: companies.cnpj,
      address: companies.address,
      phone: companies.phone,
      email: companies.email,
      logo: companies.logo,
      terms: companies.quoteTerms,
    })
    .from(companies)
    .where(eq(companies.id, companyId));
  if (!company) throw notFound();

  const [person] = quote.customerId
    ? await db.select().from(people).where(eq(people.id, quote.customerId))
    : [];
  const [seller] = quote.createdBy
    ? await db.select({ name: users.name }).from(users).where(eq(users.id, quote.createdBy))
    : [];
  const items = await db
    .select({
      name: products.name,
      quantity: quoteItems.quantity,
      unitPrice: quoteItems.unitPrice,
      subtotal: quoteItems.subtotal,
    })
    .from(quoteItems)
    .innerJoin(products, eq(products.id, quoteItems.productId))
    .where(eq(quoteItems.quoteId, quote.id))
    .orderBy(asc(quoteItems.id));

  return {
    issuer: { ...company, cnpj: company.cnpj ? formatDocument(company.cnpj) : null },
    sellerName: seller?.name ?? null,
    customer: person
      ? {
          name: person.name,
          legalName: person.legalName,
          document: person.document ? formatDocument(person.document) : null,
          email: person.email,
          phones: [person.phone, person.mobile].filter(Boolean).join(' / ') || null,
          address: formatAddress(person) || null,
        }
      : null,
    items,
  };
}

export type MirrorSnapshot = Awaited<ReturnType<typeof buildMirrorSnapshot>>;

export const hideCustomerDetails = (customer: MirrorSnapshot['customer']) =>
  customer && {
    name: customer.name,
    legalName: null,
    document: null,
    email: null,
    phones: null,
    address: null,
  };

interface CostedLine {
  type: 'product' | 'service';
  subtotal: number;
  unitCost: number | null;
  quantity: number;
}

const percentOf = (result: number, revenue: number) =>
  revenue > 0 ? round2((result / revenue) * 100) : null;

// Soma com custo desconhecido não é um número real: sem o custo de todos os itens, a resposta é "não sei".
function sumCosts(lines: CostedLine[]) {
  if (lines.some((line) => line.unitCost === null)) return null;
  return round2(lines.reduce((sum, line) => sum + (line.unitCost ?? 0) * line.quantity, 0));
}

// Margem do orçamento. A base é o valor dos itens menos o desconto: frete e outras despesas são
// repasses sem custo cadastrado, e contá-los como venda inflaria o resultado.
export function computeMargin(lines: CostedLine[], discount: number) {
  const revenue = round2(lines.reduce((sum, line) => sum + line.subtotal, 0) - discount);
  const cost = sumCosts(lines);
  const result = cost === null ? null : round2(revenue - cost);
  return {
    revenue,
    cost,
    result,
    percent: result === null ? null : percentOf(result, revenue),
    missingCost: lines.filter((line) => line.unitCost === null).length,
  };
}

// Resumo por tipo, antes do desconto do documento.
export function summarizeByType(lines: CostedLine[]) {
  return (['product', 'service'] as const).flatMap((type) => {
    const ofType = lines.filter((line) => line.type === type);
    if (!ofType.length) return [];
    const revenue = round2(ofType.reduce((sum, line) => sum + line.subtotal, 0));
    const cost = sumCosts(ofType);
    const result = cost === null ? null : round2(revenue - cost);
    return [{ type, revenue, cost, result, percent: result === null ? null : percentOf(result, revenue) }];
  });
}
