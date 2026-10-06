import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/index.js';
import { opportunityMoves } from '../src/modules/adaptive/opportunity.js';
import { sanLineToUci } from '../src/modules/adaptive/planner.js';
import { fakeEngine } from './fake-engine.js';
import { registerUser, resetUsers, seedPuzzles, setupTestApp, testDbUrl } from './helpers.js';

describe('occasioni tattiche (livello C)', () => {
  it('forchetta di cavallo', () => {
    expect(opportunityMoves('r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1', 'fork')).toEqual(['b5c7']);
  });
  it('matto in una', () => {
    expect(opportunityMoves('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 'mate')).toEqual(['a1a8']);
  });
  it('pezzo in presa', () => {
    expect(opportunityMoves('4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1', 'hangingPiece')).toEqual(['d1d5']);
  });
  it('inchiodatura', () => {
    expect(opportunityMoves('4k3/4n3/8/8/8/8/8/R6K w - - 0 1', 'pin')).toContain('a1e1');
  });
  it('linee d\'apertura per le strutture', () => {
    expect(sanLineToUci('d4 d5 c4 e6 Nc3 Nf6 cxd5 exd5')).toHaveLength(8);
    expect(sanLineToUci('e4 e5 Ke3')).toBeNull();
  });
});

describe.skipIf(!testDbUrl)('modalità adattiva', () => {
  let app: Awaited<ReturnType<typeof setupTestApp>>['app'];
  let db: Db;
  let auth: { authorization: string };
  let userId: string;

  beforeAll(async () => {
    ({ app, db } = await setupTestApp({}, { engine: fakeEngine(() => ({ cp: 20 })) }));
    await seedPuzzles(db);
  });
  beforeEach(async () => {
    await resetUsers(db);
    const u = await registerUser(app);
    userId = u.userId;
    auth = { authorization: `Bearer ${u.token}` };
  });
  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  it('livello B: struttura debole -> partita dall\'apertura corrispondente', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/play/adaptive',
      headers: auth,
      payload: { color: 'white', target: 'structure:carlsbad' },
    });
    expect(r.statusCode).toBe(200);
    const { state, plan } = r.json();
    expect(plan.level).toBe('B');
    expect(state.moves).toHaveLength(12);
    expect(state.mode).toBe('adaptive');
    expect(state.turn).toBe('white');
  });

  it('livello A: tema tattico -> partenza da un puzzle del tema', async () => {
    const r = (await app.inject({ method: 'POST', url: '/play/adaptive', headers: auth, payload: { color: 'random', target: 'theme:fork' } })).json();
    expect(r.plan.level).toBe('C');
    // le fixture hanno tutte la stessa posizione: dopo f2g3 tocca al Bianco
    expect(r.state.startFen).toContain(' w ');
    expect(r.state.userColor).toBe('white');
  });

  it('occasione concessa: colta o mancata aggiorna il tema', async () => {
    const { state } = (
      await app.inject({ method: 'POST', url: '/play/adaptive', headers: auth, payload: { color: 'white', target: 'structure:carlsbad' } })
    ).json();
    await db
      .updateTable('games')
      .set({ adaptive_motif: 'fork', adaptive_events: JSON.stringify([{ ply: 13, motif: 'fork', expected: ['f1d3'], found: null }]) })
      .where('id', '=', state.id)
      .execute();
    const r = (await app.inject({ method: 'POST', url: `/play/${state.id}/move`, headers: auth, payload: { uci: 'f1d3' } })).json();
    expect(r.opportunity).toMatchObject({ motif: 'fork', found: true, expectedSan: ['Bd3'] });
    const stat = await db
      .selectFrom('weakness_stats')
      .selectAll()
      .where('user_id', '=', userId)
      .where('dimension', '=', 'theme')
      .where('key', '=', 'fork')
      .executeTakeFirstOrThrow();
    expect(stat.successes).toBe(1);
  });
});

describe.skipIf(!testDbUrl)('repertorio e piano', () => {
  let app: Awaited<ReturnType<typeof setupTestApp>>['app'];
  let db: Db;
  let auth: { authorization: string };

  beforeAll(async () => {
    ({ app, db } = await setupTestApp({}, { engine: fakeEngine(() => ({ cp: 20 })), embedder: null }));
  });
  beforeEach(async () => {
    await resetUsers(db);
    auth = { authorization: `Bearer ${(await registerUser(app, 'rep@example.com')).token}` };
  });
  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  it('linea di repertorio: salvataggio, scadenza, ripasso', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/repertoire',
      headers: auth,
      payload: { name: 'Gambetto di donna', color: 'white', moves: ['d2d4', 'd7d5', 'c2c4'] },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    let list = (await app.inject({ url: '/repertoire', headers: auth })).json();
    expect(list[0]).toMatchObject({ name: 'Gambetto di donna', sans: ['d4', 'd5', 'c4'], due: true });

    const r = await app.inject({ method: 'POST', url: `/repertoire/${id}/review`, headers: auth, payload: { success: true } });
    expect(r.statusCode).toBe(200);
    list = (await app.inject({ url: '/repertoire', headers: auth })).json();
    expect(list[0].reps).toBe(1);

    const bad = await app.inject({ method: 'POST', url: '/repertoire', headers: auth, payload: { name: 'x', color: 'white', moves: ['e2e5'] } });
    expect(bad.statusCode).toBe(400);
  });

  it('albero delle aperture: mosse di libro e struttura anche senza explorer', async () => {
    const t = (await app.inject({ method: 'POST', url: '/openings/tree', headers: auth, payload: { moves: [] } })).json();
    expect(t.sans).toEqual([]);
    expect(Array.isArray(t.book)).toBe(true);
  });

  it('piano settimanale di 7 giorni', async () => {
    const plan = (await app.inject({ url: '/me/plan', headers: auth })).json();
    expect(plan.days).toHaveLength(7);
    expect(plan.days[0].tasks.length).toBeGreaterThan(0);
    expect(plan.focus.length).toBeGreaterThan(0);
  });
});
