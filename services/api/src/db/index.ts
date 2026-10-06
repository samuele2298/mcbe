import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from './types.js';

export type Db = Kysely<Database>;

export function createPool(databaseUrl: string, max = 10): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl, max });
}

export function createDb(pool: pg.Pool): Db {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
