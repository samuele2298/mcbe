import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';

// Runner minimale: applica in ordine i file .sql di db/migrations non ancora registrati.
// Ogni file gira in una transazione propria.

export const defaultMigrationsDir = path.resolve(
  import.meta.dirname,
  '../../../../db/migrations',
);

export async function migrate(
  pool: pg.Pool,
  dir = process.env.MIGRATIONS_DIR ?? defaultMigrationsDir,
  log: (msg: string) => void = console.log,
): Promise<string[]> {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    // un solo migratore alla volta (es. più container che partono insieme)
    await client.query('SELECT pg_advisory_lock(72656967)');

    const done = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(
        (r) => r.name,
      ),
    );
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    const applied: string[] = [];

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migrazione ${file} fallita: ${(err as Error).message}`);
      }
      log(`migrazione applicata: ${file}`);
      applied.push(file);
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock(72656967)').catch(() => {});
    client.release();
  }
}
