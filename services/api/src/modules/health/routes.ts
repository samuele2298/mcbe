import { sql } from 'kysely';
import { Type } from 'typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { Db } from '../../db/index.js';

export const healthRoutes: FastifyPluginAsyncTypebox<{ db: Db }> = async (app, { db }) => {
  app.get(
    '/health',
    {
      schema: {
        tags: ['system'],
        response: { 200: Type.Object({ status: Type.Literal('ok'), db: Type.Boolean() }) },
      },
    },
    async () => {
      await sql`SELECT 1`.execute(db);
      return { status: 'ok' as const, db: true };
    },
  );
};
