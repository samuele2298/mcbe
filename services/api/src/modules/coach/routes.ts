import { Type } from 'typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { Db } from '../../db/index.js';
import { EngineUnavailable } from '../engine/client.js';
import { CoachUnavailable, type CoachService } from './service.js';

export const coachRoutes: FastifyPluginAsyncTypebox<{ coach: CoachService; db: Db }> = async (app, { coach, db }) => {
  app.addHook('onRequest', app.authenticate);

  app.post(
    '/coach/explain',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['coach'],
        body: Type.Object({
          fen: Type.String({ maxLength: 100 }),
          moves: Type.Optional(Type.Array(Type.String({ pattern: '^[a-h][1-8][a-h][1-8][qrbn]?$' }), { maxItems: 400 })),
          question: Type.Optional(Type.String({ maxLength: 500 })),
          context: Type.Optional(Type.String({ maxLength: 300 })),
        }),
      },
    },
    async (req, reply) => {
      try {
        return await coach.explain(req.user.sub, req.body);
      } catch (err) {
        if (err instanceof CoachUnavailable) return reply.code(400).send({ error: err.message });
        if (err instanceof EngineUnavailable) return reply.code(503).send({ error: 'engine_unavailable' });
        throw err;
      }
    },
  );

  app.post(
    '/coach/:id/feedback',
    {
      schema: {
        tags: ['coach'],
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: Type.Object({
          feedback: Type.Union([Type.Literal('wrong'), Type.Literal('useful')]),
          note: Type.Optional(Type.String({ maxLength: 1000 })),
        }),
        response: { 204: Type.Null(), 404: Type.Object({ error: Type.String() }) },
      },
    },
    async (req, reply) => {
      const ok = await coach.feedback(req.user.sub, req.params.id, req.body.feedback, req.body.note);
      return ok ? reply.code(204).send(null) : reply.code(404).send({ error: 'not_found' });
    },
  );

  // dataset del feedback per correggere detector, chunk e prompt (solo admin)
  app.get(
    '/coach/feedback',
    { onRequest: [app.requireAdmin], schema: { tags: ['coach'], querystring: Type.Object({ limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })) }) } },
    async (req) => {
      const rows = await db
        .selectFrom('coach_explanations')
        .select(['id', 'fen', 'question', 'feedback', 'feedback_note', 'chunk_ids', 'response', 'facts', 'model', 'created_at'])
        .where('feedback', '=', 'wrong')
        .orderBy('created_at', 'desc')
        .limit(req.query.limit ?? 50)
        .execute();
      return rows;
    },
  );
};
