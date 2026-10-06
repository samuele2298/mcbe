import { sql } from 'kysely';
import type { Db } from '../../db/index.js';
import { defaultGlicko, updateGlicko, type Glicko } from '../../lib/glicko2.js';

// Aggiornamento delle statistiche per dimensione (weakness_stats).
// Usato da puzzle, analisi partite e modalità adattiva.

export interface StatKey {
  dimension: string;
  key: string;
}

export interface StatChange extends StatKey {
  before: number;
  after: number;
}

/**
 * Registra un risultato contro un "avversario" (puzzle o errore) su più chiavi.
 * Se `opponent` è null aggiorna solo i conteggi.
 */
export async function recordResult(
  db: Db,
  userId: string,
  keys: StatKey[],
  success: boolean,
  opponent: { rating: number; rd: number } | null,
): Promise<StatChange[]> {
  if (keys.length === 0) return [];
  const existing = await db
    .selectFrom('weakness_stats')
    .selectAll()
    .where('user_id', '=', userId)
    .where((eb) =>
      eb.or(keys.map((k) => eb.and([eb('dimension', '=', k.dimension), eb('key', '=', k.key)]))),
    )
    .execute();

  const changes: StatChange[] = [];
  for (const k of keys) {
    const row = existing.find((r) => r.dimension === k.dimension && r.key === k.key);
    const current: Glicko = row ? { rating: row.rating, rd: row.rd, vol: row.vol } : defaultGlicko();
    const next = opponent ? updateGlicko(current, opponent, success ? 1 : 0) : current;
    await db
      .insertInto('weakness_stats')
      .values({
        user_id: userId,
        dimension: k.dimension,
        key: k.key,
        attempts: 1,
        successes: success ? 1 : 0,
        rating: next.rating,
        rd: next.rd,
        vol: next.vol,
      })
      .onConflict((oc) =>
        oc.columns(['user_id', 'dimension', 'key']).doUpdateSet({
          attempts: sql`weakness_stats.attempts + 1`,
          successes: sql`weakness_stats.successes + ${success ? 1 : 0}`,
          rating: next.rating,
          rd: next.rd,
          vol: next.vol,
          updated_at: new Date(),
        }),
      )
      .execute();
    changes.push({ ...k, before: Math.round(current.rating), after: Math.round(next.rating) });
  }
  return changes;
}

/** Incrementa solo i contatori (es. errori diagnosticati nelle partite). */
export async function bumpCounters(
  db: Db,
  userId: string,
  keys: StatKey[],
  success: boolean,
): Promise<void> {
  await recordResult(db, userId, keys, success, null);
}

export async function getRating(
  db: Db,
  userId: string,
  dimension: string,
  key: string,
): Promise<Glicko | null> {
  const row = await db
    .selectFrom('weakness_stats')
    .select(['rating', 'rd', 'vol'])
    .where('user_id', '=', userId)
    .where('dimension', '=', dimension)
    .where('key', '=', key)
    .executeTakeFirst();
  return row ?? null;
}
