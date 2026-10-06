import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/index.js';
import { registerUser, resetUsers, seedPuzzles, setupTestApp, testDbUrl } from './helpers.js';

describe.skipIf(!testDbUrl)('puzzle e storm', () => {
  let app: Awaited<ReturnType<typeof setupTestApp>>['app'];
  let db: Db;
  let auth: { authorization: string };

  beforeAll(async () => {
    ({ app, db } = await setupTestApp());
    await seedPuzzles(db);
  });
  beforeEach(async () => {
    await resetUsers(db);
    auth = { authorization: `Bearer ${(await registerUser(app)).token}` };
  });
  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  it('restituisce un puzzle del tema richiesto vicino al rating', async () => {
    const res = await app.inject({ url: '/puzzles/next?mode=theme&theme=fork', headers: auth });
    expect(res.statusCode).toBe(200);
    const { puzzle, targetRating } = res.json();
    expect(puzzle.themes).toContain('fork');
    expect(targetRating).toBe(1500);
    expect(Math.abs(puzzle.rating - 1500)).toBeLessThanOrEqual(300);
  });

  it('un tentativo aggiorna rating globale, tema e fase; un errore va in ripasso', async () => {
    const { puzzle } = (await app.inject({ url: '/puzzles/next?mode=theme&theme=pin', headers: auth })).json();
    const res = await app.inject({
      method: 'POST',
      url: `/puzzles/${puzzle.id}/attempt`,
      headers: auth,
      payload: { solved: false, mode: 'theme', timeMs: 12000 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ratingAfter).toBeLessThan(body.ratingBefore);
    const keys = body.changes.map((c: { dimension: string; key: string }) => `${c.dimension}:${c.key}`);
    expect(keys).toEqual(expect.arrayContaining(['global:all', 'theme:pin', 'phase:endgame']));
    expect(keys).not.toContain('meta:short');

    const stats = (await app.inject({ url: '/me/stats', headers: auth })).json();
    expect(stats.puzzlesFailed).toBe(1);

    const weak = (await app.inject({ url: '/me/weaknesses', headers: auth })).json();
    expect(weak.map((w: { key: string }) => w.key)).toContain('pin');
  });

  it('non ripropone un puzzle già tentato', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const { puzzle } = (await app.inject({ url: '/puzzles/next?mode=theme&theme=fork', headers: auth })).json();
      expect(seen.has(puzzle.id)).toBe(false);
      seen.add(puzzle.id);
      await app.inject({
        method: 'POST',
        url: `/puzzles/${puzzle.id}/attempt`,
        headers: auth,
        payload: { solved: true, mode: 'theme' },
      });
    }
  });

  it('storm: batch crescente, salvataggio e ripasso degli errori', async () => {
    const start = (await app.inject({ method: 'POST', url: '/storm/start', headers: auth })).json();
    expect(start.puzzles.length).toBeGreaterThan(0);
    const ratings = start.puzzles.map((p: { rating: number }) => p.rating);
    expect(ratings).toEqual([...ratings].sort((a, b) => a - b));

    const [a, b, c] = start.puzzles;
    const fin = await app.inject({
      method: 'POST',
      url: `/storm/${start.runId}/finish`,
      headers: auth,
      payload: {
        durationS: 180,
        bestCombo: 2,
        results: [
          { puzzleId: a.id, solved: true },
          { puzzleId: b.id, solved: true },
          { puzzleId: c.id, solved: false },
          { puzzleId: 'NON_DELLA_RUN', solved: true },
        ],
      },
    });
    expect(fin.json()).toEqual({ score: 2, best: 2, rank: 1 });

    // la run non si chiude due volte
    const again = await app.inject({
      method: 'POST',
      url: `/storm/${start.runId}/finish`,
      headers: auth,
      payload: { durationS: 1, bestCombo: 0, results: [] },
    });
    expect(again.statusCode).toBe(404);

    // il puzzle sbagliato è in ripasso (scadenza a breve)
    const cards = await db.selectFrom('srs_cards').selectAll().execute();
    expect(cards.map((x) => x.item_id)).toEqual([c.id]);
  });
});
