import { Type } from 'typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { PuzzleSchema } from '../puzzles/routes.js';
import type { StormService } from './service.js';

export const stormRoutes: FastifyPluginAsyncTypebox<{ storm: StormService }> = async (
  app,
  { storm },
) => {
  app.addHook('onRequest', app.authenticate);

  app.post(
    '/storm/start',
    {
      schema: {
        tags: ['storm'],
        response: { 200: Type.Object({ runId: Type.String(), puzzles: Type.Array(PuzzleSchema) }) },
      },
    },
    async (req) => storm.start(req.user.sub),
  );

  app.post(
    '/storm/:id/finish',
    {
      schema: {
        tags: ['storm'],
        params: Type.Object({ id: Type.String({ pattern: '^[0-9]+$' }) }),
        body: Type.Object({
          results: Type.Array(
            Type.Object({
              puzzleId: Type.String(),
              solved: Type.Boolean(),
              timeMs: Type.Optional(Type.Integer({ minimum: 0 })),
            }),
            { maxItems: 200 },
          ),
          durationS: Type.Integer({ minimum: 0, maximum: 3600 }),
          bestCombo: Type.Integer({ minimum: 0 }),
        }),
        response: {
          200: Type.Object({ score: Type.Integer(), best: Type.Integer(), rank: Type.Integer() }),
          404: Type.Object({ error: Type.String() }),
        },
      },
    },
    async (req, reply) => {
      const res = await storm.finish(req.user.sub, req.params.id, req.body);
      return res ?? reply.code(404).send({ error: 'not_found' });
    },
  );

  app.get(
    '/storm/history',
    {
      schema: {
        tags: ['storm'],
        response: {
          200: Type.Array(
            Type.Object({
              id: Type.String(),
              score: Type.Integer(),
              errors: Type.Integer(),
              bestCombo: Type.Integer(),
              durationS: Type.Integer(),
              finishedAt: Type.String(),
            }),
          ),
        },
      },
    },
    async (req) => storm.history(req.user.sub),
  );
};
