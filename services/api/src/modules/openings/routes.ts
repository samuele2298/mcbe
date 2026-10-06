import { sql } from 'kysely';
import { Type } from 'typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { Db } from '../../db/index.js';
import { load } from '../../chess/detectors/board.js';
import { analyzePosition } from '../../chess/detectors/index.js';
import { fenToEpd } from '../../lib/openings.js';
import { review, type SrsRow } from '../../lib/srs.js';
import type { KnowledgeRetriever } from '../knowledge/retrieval.js';
import { explore } from './explorer.js';

// Studio delle aperture: albero (libro + explorer + struttura + teoria), repertorio
// personale e allenamento delle linee con ripetizione spaziata.

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const UciList = Type.Array(Type.String({ pattern: '^[a-h][1-8][a-h][1-8][qrbn]?$' }), { maxItems: 60 });

function play(moves: string[]): { fen: string; sans: string[] } | null {
  const c = load(START);
  try {
    for (const m of moves) c.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
  } catch {
    return null;
  }
  return { fen: c.fen(), sans: c.history() };
}

export const openingRoutes: FastifyPluginAsyncTypebox<{ db: Db; retriever: KnowledgeRetriever }> = async (
  app,
  { db, retriever },
) => {
  app.addHook('onRequest', app.authenticate);

  app.post(
    '/openings/tree',
    { schema: { tags: ['openings'], body: Type.Object({ moves: UciList, source: Type.Optional(Type.Union([Type.Literal('lichess'), Type.Literal('masters')])) }) } },
    async (req, reply) => {
      const p = play(req.body.moves);
      if (!p) return reply.code(400).send({ error: 'illegal_move' });
      const epd = fenToEpd(p.fen);
      // nome dell'apertura: la posizione più profonda della linea presente nell'albero ECO
      const epds = [fenToEpd(START)];
      {
        const c = load(START);
        for (const m of req.body.moves) {
          c.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
          epds.push(fenToEpd(c.fen()));
        }
      }
      const named = await db
        .selectFrom('openings')
        .select(['eco', 'name', 'ply'])
        .where('epd', 'in', epds)
        .orderBy('ply', 'desc')
        .limit(1)
        .executeTakeFirst();
      // mosse di libro: posizioni dell'albero ECO raggiungibili con una mossa
      const c = load(p.fen);
      const book: Array<{ uci: string; san: string; eco: string; name: string }> = [];
      const children = c.moves({ verbose: true }).map((m) => {
        const after = load(p.fen);
        after.move(m);
        return { uci: m.from + m.to + (m.promotion ?? ''), san: m.san, epd: fenToEpd(after.fen()) };
      });
      if (children.length) {
        const rows = await db
          .selectFrom('openings')
          .select(['eco', 'name', 'epd', 'ply'])
          .where('epd', 'in', children.map((x) => x.epd))
          .orderBy('ply')
          .execute();
        for (const ch of children) {
          const r = rows.find((x) => x.epd === ch.epd);
          if (r) book.push({ uci: ch.uci, san: ch.san, eco: r.eco, name: r.name });
        }
        // ordine per "popolarità": quante varianti dell'albero ECO continuano da quella mossa
        const prefix = req.body.moves.join(' ');
        const counts = await Promise.all(
          book.map((b) =>
            db
              .selectFrom('openings')
              .select((eb) => eb.fn.countAll<string>().as('n'))
              .where('uci', 'like', `${prefix ? `${prefix} ` : ''}${b.uci}%`)
              .executeTakeFirstOrThrow()
              .then((r) => Number(r.n)),
          ),
        );
        const order = book.map((b, i) => ({ b, n: counts[i]! })).sort((x, y) => y.n - x.n);
        book.splice(0, book.length, ...order.map((o) => o.b));
      }
      const facts = analyzePosition(p.fen);
      const explorer = await explore(db, p.fen, req.body.source ?? 'lichess');
      const theory = await retriever.retrieve({
        structures: facts.tags.structures,
        eco: named ? [named.eco] : [],
        themes: facts.tags.themes.filter((t) => ['minority_attack', 'bishop_pair', 'open_file'].includes(t)),
        phase: facts.tags.phase,
        fen: p.fen,
        limit: 3,
      });
      return {
        fen: p.fen,
        epd,
        sans: p.sans,
        opening: named ? { eco: named.eco, name: named.name } : null,
        book,
        explorer: 'error' in explorer ? null : explorer,
        explorerError: 'error' in explorer ? explorer.error : null,
        structures: facts.tags.structures,
        facts: facts.summary,
        theory: theory.map((t) => ({ id: t.id, heading: t.heading, docTitle: t.docTitle, content: t.content, verified: t.verified })),
      };
    },
  );

  app.get('/repertoire', { schema: { tags: ['openings'] } }, async (req) => {
    const rows = await db
      .selectFrom('repertoire_lines as r')
      .leftJoin('srs_cards as s', (j) =>
        j.onRef('s.item_id', '=', sql`r.id::text`).on('s.item_type', '=', 'opening_line').onRef('s.user_id', '=', 'r.user_id'),
      )
      .select(['r.id', 'r.name', 'r.color', 'r.moves', 'r.eco', 's.due_at', 's.reps', 's.lapses'])
      .where('r.user_id', '=', req.user.sub)
      .orderBy('r.color')
      .orderBy('r.name')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      moves: r.moves,
      sans: play(r.moves)?.sans ?? [],
      eco: r.eco,
      dueAt: r.due_at ? new Date(r.due_at).toISOString() : null,
      due: !r.due_at || new Date(r.due_at) <= new Date(),
      reps: r.reps ?? 0,
      lapses: r.lapses ?? 0,
    }));
  });

  app.post(
    '/repertoire',
    {
      schema: {
        tags: ['openings'],
        body: Type.Object({
          name: Type.String({ minLength: 1, maxLength: 80 }),
          color: Type.Union([Type.Literal('white'), Type.Literal('black')]),
          moves: Type.Array(Type.String({ pattern: '^[a-h][1-8][a-h][1-8][qrbn]?$' }), { minItems: 1, maxItems: 40 }),
        }),
      },
    },
    async (req, reply) => {
      const p = play(req.body.moves);
      if (!p) return reply.code(400).send({ error: 'illegal_move' });
      const named = await db
        .selectFrom('openings')
        .select('eco')
        .where('epd', '=', fenToEpd(p.fen))
        .executeTakeFirst();
      const row = await db
        .insertInto('repertoire_lines')
        .values({ user_id: req.user.sub, name: req.body.name, color: req.body.color, moves: req.body.moves, eco: named?.eco ?? null })
        .onConflict((oc) => oc.columns(['user_id', 'color', 'moves']).doUpdateSet({ name: req.body.name }))
        .returning('id')
        .executeTakeFirstOrThrow();
      return reply.code(201).send({ id: row.id });
    },
  );

  app.delete(
    '/repertoire/:id',
    { schema: { tags: ['openings'], params: Type.Object({ id: Type.String({ format: 'uuid' }) }) } },
    async (req, reply) => {
      await db.deleteFrom('repertoire_lines').where('id', '=', req.params.id).where('user_id', '=', req.user.sub).execute();
      await db
        .deleteFrom('srs_cards')
        .where('user_id', '=', req.user.sub)
        .where('item_type', '=', 'opening_line')
        .where('item_id', '=', req.params.id)
        .execute();
      return reply.code(204).send(null);
    },
  );

  /** Esito di un allenamento della linea: aggiorna la carta FSRS. */
  app.post(
    '/repertoire/:id/review',
    {
      schema: {
        tags: ['openings'],
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: Type.Object({ success: Type.Boolean() }),
      },
    },
    async (req, reply) => {
      const line = await db
        .selectFrom('repertoire_lines')
        .select('id')
        .where('id', '=', req.params.id)
        .where('user_id', '=', req.user.sub)
        .executeTakeFirst();
      if (!line) return reply.code(404).send({ error: 'not_found' });
      const existing = await db
        .selectFrom('srs_cards')
        .selectAll()
        .where('user_id', '=', req.user.sub)
        .where('item_type', '=', 'opening_line')
        .where('item_id', '=', line.id)
        .executeTakeFirst();
      const next = review(existing ? (existing as unknown as SrsRow) : null, req.body.success);
      await db
        .insertInto('srs_cards')
        .values({ user_id: req.user.sub, item_type: 'opening_line', item_id: line.id, ...next })
        .onConflict((oc) => oc.columns(['user_id', 'item_type', 'item_id']).doUpdateSet(next))
        .execute();
      return { dueAt: next.due_at.toISOString() };
    },
  );
};
