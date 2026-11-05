import { formatAddress, formatDocument } from '@arandue/shared/br';
import { asc, eq } from 'drizzle-orm';
import type { DbOrTx } from '../db/client.ts';
import { companies, people, products, quoteItems, users } from '../db/schema.ts';
import { notFound } from '../lib/errors.ts';

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
