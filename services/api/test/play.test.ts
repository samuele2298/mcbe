import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/index.js';
import { fakeEngine } from './fake-engine.js';
import { registerUser, resetUsers, setupTestApp, testDbUrl } from './helpers.js';

describe.skipIf(!testDbUrl)('partita contro il computer', () => {
  let app: Awaited<ReturnType<typeof setupTestApp>>['app'];
  let db: Db;
  let auth: { authorization: string };
  const finished: string[] = [];

  beforeAll(async () => {
    // valutazione finta: dopo 1.f3 il Bianco "perde" (per testare la modalità allenamento)
    const engine = fakeEngine((fen) =>
      fen.startsWith('rnbqkbnr/pppppppp/8/8/8/5P2/') ? { cp: 900 } : fen.split(' ')[1] === 'w' ? { cp: 30 } : { cp: -30 },
    );
    ({ app, db } = await setupTestApp({}, { engine, onGameFinished: async (id) => void finished.push(id) }));
  });
  beforeEach(async () => {
    await resetUsers(db);
    auth = { authorization: `Bearer ${(await registerUser(app)).token}` };
  });
  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  const start = (payload: object) =>
    app.inject({ method: 'POST', url: '/play/start', headers: auth, payload });

  it('il computer risponde alle mosse e rifiuta quelle illegali', async () => {
    const s = (await start({ color: 'white', elo: 1500, mode: 'normal' })).json();
    expect(s.moves).toEqual([]);
    const r = await app.inject({ method: 'POST', url: `/play/${s.id}/move`, headers: auth, payload: { uci: 'e2e4' } });
    expect(r.statusCode).toBe(200);
    expect(r.json().state.moves).toHaveLength(2);
    expect(r.json().feedback).toBeNull();

    const bad = await app.inject({ method: 'POST', url: `/play/${s.id}/move`, headers: auth, payload: { uci: 'e4e6' } });
    expect(bad.json()).toEqual({ error: 'illegal_move' });
  });

  it('con il Nero il computer muove per primo', async () => {
    const s = (await start({ color: 'black', elo: 1500, mode: 'normal' })).json();
    expect(s.moves).toHaveLength(1);
    expect(s.turn).toBe('black');
  });

  it('allenamento: segnala l\'errore, permette di ritirare la mossa', async () => {
    const s = (await start({ color: 'white', elo: 1500, mode: 'training' })).json();
    const r = (await app.inject({ method: 'POST', url: `/play/${s.id}/move`, headers: auth, payload: { uci: 'f2f3' } })).json();
    expect(r.feedback.classification).toBe('blunder');
    expect(r.feedback.diagnosis).not.toBeNull();
    expect(r.state.awaitingDecision).toBe(true);
    expect(r.state.moves).toEqual(['f2f3']);

    const back = (await app.inject({ method: 'POST', url: `/play/${s.id}/takeback`, headers: auth })).json();
    expect(back.moves).toEqual([]);
    expect(back.awaitingDecision).toBe(false);
  });

  it('abbandono chiude la partita e mette in coda l\'analisi', async () => {
    const s = (await start({ color: 'white', elo: 1500, mode: 'normal' })).json();
    for (const uci of ['e2e4', 'd2d4']) {
      await app.inject({ method: 'POST', url: `/play/${s.id}/move`, headers: auth, payload: { uci } });
    }
    const r = (await app.inject({ method: 'POST', url: `/play/${s.id}/resign`, headers: auth })).json();
    expect(r.result).toBe('0-1');
    expect(finished).toContain(s.id);
  });

  it('non si accede alle partite di altri', async () => {
    const s = (await start({ color: 'white', elo: 1500, mode: 'normal' })).json();
    const other = { authorization: `Bearer ${(await registerUser(app, 'x@example.com')).token}` };
    expect((await app.inject({ url: `/play/${s.id}`, headers: other })).statusCode).toBe(404);
  });
});
