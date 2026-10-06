import { Type } from 'typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { THEMES } from '../../chess/themes.js';
import type { PuzzleService } from './service.js';

export const PuzzleSchema = Type.Object({
  id: Type.String(),
  fen: Type.String(),
  moves: Type.Array(Type.String()),
  rating: Type.Integer(),
  themes: Type.Array(Type.String()),
  openingTags: Type.Array(Type.String()),
  source: Type.String(),
});

const Mode = Type.Union([
  Type.Literal('theme'),
  Type.Literal('mix'),
  Type.Literal('review'),
  Type.Literal('weakness'),
  Type.Literal('adaptive'),
]);

const StatChange = Type.Object({
  dimension: Type.String(),
  key: Type.String(),
  before: Type.Integer(),
  after: Type.Integer(),
});

export const puzzleRoutes: FastifyPluginAsyncTypebox<{ puzzles: PuzzleService }> = async (
  app,
  { puzzles },
) => {
  app.addHook('onRequest', app.authenticate);

  app.get(
    '/puzzles/themes',
    {
      schema: {
        tags: ['puzzles'],
        response: {
          200: Type.Array(Type.Object({ key: Type.String(), label: Type.String(), group: Type.String() })),
        },
      },
    },
    async () =>
      Object.entries(THEMES)
        .filter(([, t]) => t.group !== 'meta')
        .map(([key, t]) => ({ key, label: t.label, group: t.group })),
  );

  app.get(
    '/puzzles/next',
    {
      schema: {
        tags: ['puzzles'],
        querystring: Type.Object({
          mode: Type.Optional(Mode),
          theme: Type.Optional(Type.String({ maxLength: 40 })),
          exclude: Type.Optional(Type.String({ maxLength: 2000 })),
        }),
        response: {
          200: Type.Object({
            puzzle: PuzzleSchema,
            mode: Mode,
            theme: Type.Union([Type.String(), Type.Null()]),
            targetRating: Type.Integer(),
            reviewDue: Type.Integer(),
          }),
          404: Type.Object({ error: Type.String() }),
        },
      },
    },
    async (req, reply) => {
      const exclude = req.query.exclude?.split(',').filter(Boolean).slice(0, 100);
      const next = await puzzles.next(req.user.sub, {
        mode: req.query.mode ?? 'mix',
        ...(req.query.theme ? { theme: req.query.theme } : {}),
        ...(exclude ? { exclude } : {}),
      });
      if (!next) return reply.code(404).send({ error: 'no_puzzle' });
      return next;
    },
  );

  app.get(
    '/puzzles/:id',
    {
      schema: {
        tags: ['puzzles'],
        params: Type.Object({ id: Type.String() }),
        response: { 200: PuzzleSchema, 404: Type.Object({ error: Type.String() }) },
      },
    },
    async (req, reply) => {
      const p = await puzzles.get(req.params.id);
      return p ?? reply.code(404).send({ error: 'not_found' });
    },
  );

  app.post(
    '/puzzles/:id/attempt',
    {
      schema: {
        tags: ['puzzles'],
        params: Type.Object({ id: Type.String() }),
        body: Type.Object({
          solved: Type.Boolean(),
          timeMs: Type.Optional(Type.Integer({ minimum: 0 })),
          mode: Mode,
        }),
        response: {
          200: Type.Object({
            ratingBefore: Type.Integer(),
            ratingAfter: Type.Integer(),
            changes: Type.Array(StatChange),
          }),
          404: Type.Object({ error: Type.String() }),
        },
      },
    },
    async (req, reply) => {
      const res = await puzzles.attempt(req.user.sub, req.params.id, {
        solved: req.body.solved,
        mode: req.body.mode,
        ...(req.body.timeMs !== undefined ? { timeMs: req.body.timeMs } : {}),
      });
      return res ?? reply.code(404).send({ error: 'not_found' });
    },
  );
};
