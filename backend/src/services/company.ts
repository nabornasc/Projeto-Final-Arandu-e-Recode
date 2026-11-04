import { type CompanySettingsInput, companySettingsSchema } from '@arandue/shared/schemas';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { companies } from '../db/schema.ts';
import { diffFields } from '../lib/changes.ts';
import { authorize, type Ctx } from '../lib/context.ts';
import { notFound } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import { audit } from './audit.ts';

const columns = { name: companies.name, cnpj: companies.cnpj, meiAnnualLimit: companies.meiAnnualLimit };

export async function getCompanySettings(ctx: Ctx) {
  authorize(ctx, 'settings.read');
  const [row] = await db.select(columns).from(companies).where(eq(companies.id, ctx.companyId));
  if (!row) throw notFound();
  return row;
}

export async function updateCompanySettings(ctx: Ctx, input: CompanySettingsInput) {
  authorize(ctx, 'settings.update');
  const data = parse(companySettingsSchema, input);
  return db.transaction(async (tx) => {
    const [previous] = await tx.select(columns).from(companies).where(eq(companies.id, ctx.companyId));
    if (!previous) throw notFound();
    const [row] = await tx
      .update(companies)
      .set(data)
      .where(eq(companies.id, ctx.companyId))
      .returning(columns);
    if (!row) throw notFound();
    const changes = diffFields(previous, row);
    if (changes.length) {
      await audit(tx, ctx, 'update', 'company', ctx.companyId, { label: row.name, changes });
    }
    return row;
  });
}
