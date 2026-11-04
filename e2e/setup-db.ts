// Recria o banco dos testes ponta a ponta, aplica as migrações e carrega os dados de demonstração.
import { execSync } from 'node:child_process';
import postgres from 'postgres';

const url = process.env.DATABASE_URL ?? '';
const name = new URL(url).pathname.slice(1);
// Este script apaga o banco inteiro: nunca pode alcançar o de desenvolvimento ou o de produção.
if (!/^[a-z_]*e2e$/.test(name)) throw new Error(`Recusando recriar um banco que não é de e2e: ${name}`);

const maintenance = new URL(url);
maintenance.pathname = '/postgres';
const sql = postgres(maintenance.href, { max: 1, onnotice: () => {} });
await sql.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
await sql.unsafe(`CREATE DATABASE ${name}`);
await sql.end();

execSync('npm run db:migrate -w backend', { stdio: 'inherit' });
execSync('npm run db:seed -w backend', { stdio: 'inherit' });
