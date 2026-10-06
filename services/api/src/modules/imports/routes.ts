import { Type } from 'typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { Db } from '../../db/index.js';
import { ImportError, importGames } from './service.js';

export const importRoutes: FastifyPluginAsyncTypebox<{ db: Db; enqueue: (gameId: string) => Promise<void> }> = async (
  app,
  { db, enqueue },
) => {
  app.addHook('onRequest', app.authenticate);

  app.post(
    '/games/import',
    {
      config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
      schema: {
        tags: ['games'],
        body: Type.Object({
          source: Type.Union([Type.Literal('lichess'), Type.Literal('chesscom')]),
          username: Type.String({ minLength: 2, maxLength: 40, pattern: '^[A-Za-z0-9_-]+$' }),
          max: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
        }),
        response: {
          200: Type.Object({ fetched: Type.Integer(), inserted: Type.Integer() }),
          400: Type.Object({ error: Type.String() }),
          502: Type.Object({ error: Type.String() }),
        },
      },
    },
    async (req, reply) => {
      try {
        return await importGames(db, req.user.sub, req.body.source, req.body.username, req.body.max ?? 20, enqueue);
      } catch (err) {
        if (err instanceof ImportError) {
          return reply.code(err.message === 'user_not_found' ? 400 : 502).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.put(
    '/me',
    {
      schema: {
        tags: ['profile'],
        body: Type.Object({
          displayName: Type.Optional(Type.String({ maxLength: 60 })),
          lichessUsername: Type.Optional(Type.Union([Type.String({ maxLength: 40 }), Type.Null()])),
          chesscomUsername: Type.Optional(Type.Union([Type.String({ maxLength: 40 }), Type.Null()])),
        }),
        response: { 204: Type.Null() },
      },
    },
    async (req, reply) => {
      const b = req.body;
      const set = {
        ...(b.displayName !== undefined ? { display_name: b.displayName } : {}),
        ...(b.lichessUsername !== undefined ? { lichess_username: b.lichessUsername } : {}),
        ...(b.chesscomUsername !== undefined ? { chesscom_username: b.chesscomUsername } : {}),
      };
      if (Object.keys(set).length) await db.updateTable('users').set(set).where('id', '=', req.user.sub).execute();
      return reply.code(204).send(null);
    },
  );
};
