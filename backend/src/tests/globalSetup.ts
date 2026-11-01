// Recria o schema do banco de teste do zero e aplica as migrações antes da suíte.
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://arandue:arandue@127.0.0.1:5432/arandue_test';
  if (!url.includes('test')) throw new Error(`Recusando limpar um banco que não parece de teste: ${url}`);

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql`DROP SCHEMA IF EXISTS public CASCADE`;
  await sql`DROP SCHEMA IF EXISTS drizzle CASCADE`;
  await sql`CREATE SCHEMA public`;
  await migrate(drizzle(sql), { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname });
  await sql.end();
}
