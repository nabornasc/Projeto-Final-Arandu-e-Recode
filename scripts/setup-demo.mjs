// Prepara o banco da demonstração no Supabase: migrações, dados padrão, usuário da aplicação, proteção e
// restauração a cada 12 horas. Uso: npm run demo:setup, com a conexão do session pooler em SUPABASE_DB_URL.
// APAGA os dados do banco. Se já houver empresas, só continua com --recriar.
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

// 00h e 12h em Cuiabá (UTC-4).
const SCHEDULE = '0 4,16 * * *';

const raw = process.env.SUPABASE_DB_URL;
if (!raw) {
  console.error('Defina SUPABASE_DB_URL com a conexão do session pooler (Supabase > Connect).');
  process.exit(1);
}
const url = new URL(raw);
if (!url.searchParams.has('sslmode') && !process.env.DEMO_SETUP_LOCAL)
  url.searchParams.set('sslmode', 'require');
const env = { ...process.env, DATABASE_URL: url.href, NODE_ENV: 'development' };
const run = (command) => execSync(command, { stdio: 'inherit', env });

const sql = postgres(url.href, { max: 1, onnotice: () => {} });

const [{ exists }] = await sql`SELECT to_regclass('public.companies') IS NOT NULL AS exists`;
if (exists) {
  const [{ total }] = await sql`SELECT count(*)::int AS total FROM public.companies`;
  if (total && !process.argv.includes('--recriar')) {
    console.error(`O banco já tem ${total} empresas. Para apagar tudo e recriar, use --recriar.`);
    await sql.end();
    process.exit(1);
  }
}

console.log(`\nBanco: ${url.host}\n\n1/5 Migrações`);
run('node backend/src/db/migrate.ts');

console.log('\n2/5 Dados padrão');
run('node backend/src/db/seed.ts');

console.log('\n3/5 Usuário da aplicação');
const password = randomBytes(24).toString('base64url');
const [{ role }] = await sql`SELECT count(*)::int AS role FROM pg_roles WHERE rolname = 'arandue_app'`;
await sql.unsafe(`${role ? 'ALTER' : 'CREATE'} ROLE arandue_app LOGIN NOINHERIT PASSWORD '${password}'`);

console.log('\n4/5 Proteção do banco');
await sql.unsafe(readFileSync('scripts/supabase-seguranca.sql', 'utf8'));

console.log('\n5/5 Restauração a cada 12 horas');
await sql.unsafe(readFileSync('scripts/supabase-demo.sql', 'utf8'));
await sql`SELECT demo.capture()`;
if (!process.env.DEMO_SETUP_LOCAL) {
  await sql`CREATE EXTENSION IF NOT EXISTS pg_cron`;
  await sql`SELECT cron.schedule('arandue-demo-reset', ${SCHEDULE}, 'SELECT demo.reset()')`;
}
await sql.end();

const [user] = decodeURIComponent(url.username).split('.').slice(1);
const appUrl = new URL(url.href);
appUrl.username = user ? `arandue_app.${user}` : 'arandue_app';
appUrl.password = password;
appUrl.port = '6543';

console.log(`
Pronto. Cadastre na Vercel, em Environment Variables:

  NODE_ENV=production
  VITE_DEMO_MODE=true
  ALLOWED_ORIGINS=<endereço público da aplicação>
  DATABASE_URL=${appUrl.href}

Esta senha não fica salva. Rodar o script de novo gera outra.
`);
