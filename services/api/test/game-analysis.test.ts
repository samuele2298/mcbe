import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/index.js';
import { GameAnalyzer } from '../src/modules/analysis/game-analysis.js';
import { START_FEN } from '../src/modules/play/service.js';
import { fakeEngine } from './fake-engine.js';
import { registerUser, resetUsers, setupTestApp, testDbUrl } from './helpers.js';

// Matto del barbiere: il Nero (utente) gioca 3...Cf6?? e subisce Dxf7#
const MOVES = ['e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g8f6', 'h5f7'];
const AFTER_NF6 = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';

describe.skipIf(!testDbUrl)('analisi partita (Learn from play)', () => {
  let app: Awaited<ReturnType<typeof setupTestApp>>['app'];
  let db: Db;
  let userId: string;
  let token: string;
  const engine = fakeEngine((fen) => (fen === AFTER_NF6 ? { mate: 1, best: 'h5f7' } : { cp: 0 }));

  beforeAll(async () => {
    ({ app, db } = await setupTestApp({}, { engine }));
  });
  beforeEach(async () => {
    await resetUsers(db);
    ({ userId, token } = await registerUser(app));
  });
  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  it('classifica le mosse, diagnostica l\'errore, aggiorna il profilo e crea un puzzle personale', async () => {
    const game = await db
      .insertInto('games')
      .values({
        user_id: userId,
        source: 'play',
        start_fen: START_FEN,
        moves: MOVES,
        user_color: 'black',
        result: '1-0',
        termination: 'checkmate',
        analysis_status: 'queued',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await new GameAnalyzer(db, engine).analyzeGame(game.id);

    const review = (
      await app.inject({ url: `/games/${game.id}/review`, headers: { authorization: `Bearer ${token}` } })
    ).json();
    expect(review.analysisStatus).toBe('done');
    expect(review.moves).toHaveLength(7);
    const nf6 = review.moves.find((m: { ply: number }) => m.ply === 6);
    expect(nf6.classification).toBe('blunder');
    expect(review.keyMoments).toEqual([6]);
    expect(review.mistakes[0]).toMatchObject({ ply: 6, category: 'allowed_tactic', motif: 'mate' });

    const puzzleId = review.mistakes[0].puzzleId as string;
    expect(puzzleId).toMatch(/^own:/);
    const puzzle = await db.selectFrom('puzzles').selectAll().where('id', '=', puzzleId).executeTakeFirstOrThrow();
    expect(puzzle.moves[0]).toBe('f1c4');
    expect(puzzle.source).toBe('own_game');
    const card = await db.selectFrom('srs_cards').selectAll().where('item_id', '=', puzzleId).executeTakeFirst();
    expect(card?.user_id).toBe(userId);

    const stats = await db.selectFrom('weakness_stats').selectAll().where('user_id', '=', userId).execute();
    expect(stats.find((s) => s.dimension === 'mistake' && s.key === 'allowed_tactic')?.attempts).toBe(1);

    // il puzzle personale arriva in ripasso
    const next = (
      await app.inject({ url: '/puzzles/next?mode=review', headers: { authorization: `Bearer ${token}` } })
    ).json();
    expect(next.puzzle.id).toBe(puzzleId);
  });
});
