import { sql } from 'kysely';
import { Type } from 'typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { Db } from '../../db/index.js';
import { themeLabel } from '../../chess/themes.js';
import { labelFor } from './labels.js';
import { generateProfileNote } from './notes.js';

const Weakness = Type.Object({
  dimension: Type.String(),
  key: Type.String(),
  label: Type.String(),
  rating: Type.Integer(),
  rd: Type.Integer(),
  attempts: Type.Integer(),
  successRate: Type.Number(),
  confident: Type.Boolean(),
});

export const profileRoutes: FastifyPluginAsyncTypebox<{ db: Db }> = async (app, { db }) => {
  app.addHook('onRequest', app.authenticate);

  app.get(
    '/me/weaknesses',
    {
      schema: {
        tags: ['profile'],
        querystring: Type.Object({ dimension: Type.Optional(Type.String()) }),
        response: { 200: Type.Array(Weakness) },
      },
    },
    async (req) => {
      const rows = await db
        .selectFrom('weakness_stats')
        .selectAll()
        .where('user_id', '=', req.user.sub)
        .where('dimension', '!=', 'global')
        .$if(!!req.query.dimension, (q) => q.where('dimension', '=', req.query.dimension!))
        .where('attempts', '>=', 1)
        .execute();
      const global = await db
        .selectFrom('weakness_stats')
        .select('rating')
        .where('user_id', '=', req.user.sub)
        .where('dimension', '=', 'global')
        .executeTakeFirst();
      const base = global?.rating ?? 1500;
      return rows
        .map((r) => ({
          dimension: r.dimension,
          key: r.key,
          label: r.dimension === 'theme' || r.dimension === 'phase' ? themeLabel(r.key) : labelFor(r.dimension, r.key),
          rating: Math.round(r.rating),
          rd: Math.round(r.rd),
          attempts: r.attempts,
          successRate: r.attempts ? r.successes / r.attempts : 0,
          confident: r.rd < 150 || r.attempts >= 8,
          // gravità: distanza sotto il rating globale, pesata dalla confidenza
          severity: (base - r.rating) * (r.rd < 150 ? 1 : 0.6) + (r.dimension === 'mistake' ? r.attempts * 15 : 0),
        }))
        .sort((a, b) => b.severity - a.severity)
        .map(({ severity: _s, ...w }) => w);
    },
  );

  app.get(
    '/me/stats',
    {
      schema: {
        tags: ['profile'],
        response: {
          200: Type.Object({
            ratingPuzzle: Type.Integer(),
            ratingRd: Type.Integer(),
            puzzlesSolved: Type.Integer(),
            puzzlesFailed: Type.Integer(),
            stormBest: Type.Integer(),
            reviewDue: Type.Integer(),
            history: Type.Array(Type.Object({ day: Type.String(), rating: Type.Integer(), attempts: Type.Integer() })),
          }),
        },
      },
    },
    async (req) => {
      const userId = req.user.sub;
      const global = await db
        .selectFrom('weakness_stats')
        .select(['rating', 'rd'])
        .where('user_id', '=', userId)
        .where('dimension', '=', 'global')
        .executeTakeFirst();
      const counts = await db
        .selectFrom('puzzle_attempts')
        .select([
          sql<string>`count(*) FILTER (WHERE solved)`.as('ok'),
          sql<string>`count(*) FILTER (WHERE NOT solved)`.as('ko'),
        ])
        .where('user_id', '=', userId)
        .executeTakeFirstOrThrow();
      const storm = await db
        .selectFrom('storm_runs')
        .select((eb) => eb.fn.max('score').as('best'))
        .where('user_id', '=', userId)
        .executeTakeFirstOrThrow();
      const due = await db
        .selectFrom('srs_cards')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('user_id', '=', userId)
        .where('due_at', '<=', new Date())
        .executeTakeFirstOrThrow();
      const history = await sql<{ day: string; rating: number; attempts: string }>`
        SELECT to_char(day, 'YYYY-MM-DD') AS day, rating, attempts FROM (
          SELECT date_trunc('day', created_at) AS day,
                 (array_agg(rating_after ORDER BY created_at DESC))[1] AS rating,
                 count(*) AS attempts
          FROM puzzle_attempts
          WHERE user_id = ${userId} AND rating_after IS NOT NULL
            AND created_at > now() - interval '90 days'
          GROUP BY 1) d
        ORDER BY day`.execute(db);
      return {
        ratingPuzzle: Math.round(global?.rating ?? 1500),
        ratingRd: Math.round(global?.rd ?? 350),
        puzzlesSolved: Number(counts.ok),
        puzzlesFailed: Number(counts.ko),
        stormBest: Number(storm.best ?? 0),
        reviewDue: Number(due.n),
        history: history.rows.map((h) => ({ day: h.day, rating: h.rating, attempts: Number(h.attempts) })),
      };
    },
  );

  app.get('/me/profile', { schema: { tags: ['profile'] } }, async (req) => {
    const note = await db
      .selectFrom('profile_notes')
      .select(['content', 'created_at'])
      .where('user_id', '=', req.user.sub)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    return { note: note ? { content: note.content, createdAt: new Date(note.created_at).toISOString() } : null };
  });

  app.post(
    '/me/profile/refresh',
    { config: { rateLimit: { max: 3, timeWindow: '1 hour' } }, schema: { tags: ['profile'] } },
    async (req) => ({ note: await generateProfileNote(db, req.user.sub) }),
  );
};
