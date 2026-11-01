import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config.ts';
import * as schema from './schema.ts';

// prepare: false mantém compatibilidade com o pooler do Supabase em modo transação.
export const sql = postgres(config.DATABASE_URL, {
  max: config.NODE_ENV === 'production' ? 5 : 10,
  prepare: false,
  onnotice: () => {},
});

export const db = drizzle(sql, { schema, casing: 'snake_case' });

export type Database = typeof db;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbOrTx = Database | Transaction;
