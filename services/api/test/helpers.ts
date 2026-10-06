import { sql } from 'kysely';
import { buildApp, type AppDeps } from '../src/app.js';
import type { Config } from '../src/config/env.js';
import { createDb, createPool, type Db } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';

// Integrazione: richiede TEST_DATABASE_URL (DB dedicato, viene svuotato).
export const testDbUrl = process.env.TEST_DATABASE_URL;

export const testConfig: Config = {
  databaseUrl: testDbUrl ?? '',
  port: 0,
  jwtSecret: 'x'.repeat(32),
  accessTokenTtl: '15m',
  refreshTokenTtlDays: 30,
  adminEmails: ['admin@example.com'],
  corsOrigins: [],
  engineUrl: process.env.TEST_ENGINE_URL ?? 'http://localhost:4000',
};

export async function setupTestApp(overrides: Partial<Config> = {}, deps: AppDeps = {}) {
  const pool = createPool(testDbUrl!, 3);
  const db = createDb(pool);
  await migrate(pool, undefined, () => {});
  const app = await buildApp({ ...testConfig, ...overrides }, db, {}, deps);
  return { app, db };
}

export async function resetUsers(db: Db) {
  await sql`TRUNCATE users CASCADE`.execute(db);
}

export async function registerUser(
  app: Awaited<ReturnType<typeof setupTestApp>>['app'],
  email = 'u@example.com',
) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password: 'password123' },
  });
  const body = res.json();
  return { token: body.accessToken as string, userId: body.user.id as string };
}

/** Puzzle di fixture (FEN/mosse reali dal dump Lichess). */
export async function seedPuzzles(db: Db) {
  await sql`DELETE FROM puzzles WHERE id LIKE 'T%'`.execute(db);
  const base = {
    fen: 'r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24',
    moves: ['f2g3', 'e6e7', 'b2b1', 'b3c1'],
    rating_dev: 75,
    popularity: 90,
    nb_plays: 1000,
    opening_tags: null,
    game_url: null,
  };
  const rows = [];
  for (let i = 0; i < 1800; i++) {
    rows.push({
      ...base,
      id: `T${String(i).padStart(4, '0')}`,
      rating: 800 + i,
      themes: i % 2 ? ['fork', 'middlegame', 'short'] : ['pin', 'endgame', 'short'],
    });
  }
  for (let i = 0; i < rows.length; i += 500) {
    await db.insertInto('puzzles').values(rows.slice(i, i + 500)).execute();
  }
}
