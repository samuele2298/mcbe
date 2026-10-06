import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/index.js';
import { lineInfo, sanToItalian, unknownMovesInText } from '../src/modules/coach/postcheck.js';
import { checkAnswer, sanitize } from '../src/modules/coach/service.js';
import { indexKnowledge } from '../src/modules/knowledge/indexer.js';
import { fakeEngine } from './fake-engine.js';
import { registerUser, resetUsers, setupTestApp, testDbUrl } from './helpers.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('post-check delle mosse', () => {
  const lines = [lineInfo(START, ['g1f3', 'g8f6', 'c2c4'])];

  it('notazione italiana', () => {
    expect(sanToItalian('Nf3')).toBe('Cf3');
    expect(sanToItalian('Qxd8+')).toBe('Dxd8+');
    expect(sanToItalian('e8=Q')).toBe('e8=D');
  });

  it('accetta mosse delle linee (inglese e italiano) e le case semplici', () => {
    expect(unknownMovesInText('Il cavallo va in f3 con Nf3, poi Cf6 e la casa e5 resta debole.', lines)).toEqual([]);
  });

  it('segnala mosse inventate', () => {
    expect(unknownMovesInText('Meglio Qh5 oppure Ab5.', lines)).toEqual(['Qh5', 'Ab5']);
  });

  it('checkAnswer e sanitize su riferimenti non validi', () => {
    const answer = {
      concept: 'Sviluppo',
      explanation: [
        { text: 'Sviluppa il cavallo.', chunk_ids: [], move: { line: 0, ply: 0 } },
        { text: 'Poi Qh5 vince.', chunk_ids: ['x'], move: { line: 3, ply: 0 } },
      ],
      plan: null,
      missing_knowledge: null,
      uses_unverified: false,
    };
    expect(checkAnswer(answer, lines, []).length).toBe(3);
    const clean = sanitize(answer, lines, []);
    expect(clean.explanation).toHaveLength(1);
    expect(checkAnswer(clean, lines, [])).toEqual([]);
  });
});

describe.skipIf(!testDbUrl)('coach senza chiave AI', () => {
  let app: Awaited<ReturnType<typeof setupTestApp>>['app'];
  let db: Db;
  let auth: { authorization: string };
  const savedKey = process.env.ANTHROPIC_API_KEY;

  beforeAll(async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    ({ app, db } = await setupTestApp({}, { engine: fakeEngine(() => ({ cp: 60 })), embedder: null }));
    await indexKnowledge(db, null, { rebuild: true });
    await db.deleteFrom('openings').where('name', '=', 'Test QGD').execute();
    await db
      .insertInto('openings')
      .values({
        eco: 'D35',
        name: 'Test QGD',
        pgn: '1. d4 d5 2. c4 e6 3. Nc3 Nf6',
        uci: 'd2d4 d7d5 c2c4 e7e6 b1c3 g8f6',
        epd: 'rnbqkb1r/ppp2ppp/4pn2/3p4/2PP4/2N5/PP2PPPP/R1BQKBNR w KQkq -',
        ply: 6,
      })
      .execute();
  });
  beforeEach(async () => {
    await resetUsers(db);
    auth = { authorization: `Bearer ${(await registerUser(app)).token}` };
  });
  afterAll(async () => {
    if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;
    await app.close();
    await db.destroy();
  });

  it('restituisce fatti, linee, teoria e apertura; salva la spiegazione; accetta il feedback', async () => {
    // Gambetto di donna rifiutato, cambio: struttura Carlsbad
    const moves = ['d2d4', 'd7d5', 'c2c4', 'e7e6', 'b1c3', 'g8f6', 'c4d5', 'e6d5', 'c1g5', 'c7c6', 'e2e3', 'b8d7'];
    const res = await app.inject({
      method: 'POST',
      url: '/coach/explain',
      headers: auth,
      payload: { fen: 'r1bqkb1r/pp1n1ppp/2p2n2/3p2B1/3P4/2N1P3/PP3PPP/R2QKBNR w KQkq - 1 7', moves },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ai).toBe(false);
    expect(body.notice).toContain('non configurato');
    expect(body.opening.eco).toMatch(/^D3/);
    expect(body.facts.join(' ')).toContain('Carlsbad');
    expect(body.sources[0].heading).toContain('Carlsbad');
    expect(body.lines[0].san.length).toBeGreaterThan(0);

    const fb = await app.inject({
      method: 'POST',
      url: `/coach/${body.id}/feedback`,
      headers: auth,
      payload: { feedback: 'wrong', note: 'manca il piano' },
    });
    expect(fb.statusCode).toBe(204);
    const row = await db.selectFrom('coach_explanations').selectAll().where('id', '=', body.id).executeTakeFirstOrThrow();
    expect(row.feedback).toBe('wrong');
    expect(row.chunk_ids.length).toBeGreaterThan(0);
  });

  it('FEN non valida', async () => {
    const res = await app.inject({ method: 'POST', url: '/coach/explain', headers: auth, payload: { fen: 'xx' } });
    expect(res.statusCode).toBe(400);
  });
});
