import { Type } from 'typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { Db } from '../../db/index.js';
import { analyzePosition } from '../../chess/detectors/index.js';
import type { KnowledgeRetriever } from './retrieval.js';

// Debug del retrieval e stato della knowledge base (solo admin). L'ingestione è solo da CLI.

const list = (s?: string) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : []);

export const knowledgeRoutes: FastifyPluginAsyncTypebox<{ db: Db; retriever: KnowledgeRetriever }> = async (
  app,
  { db, retriever },
) => {
  app.addHook('onRequest', app.requireAdmin);

  app.get(
    '/knowledge/search',
    {
      schema: {
        tags: ['knowledge'],
        querystring: Type.Object({
          q: Type.Optional(Type.String({ maxLength: 500 })),
          fen: Type.Optional(Type.String({ maxLength: 100 })),
          structures: Type.Optional(Type.String()),
          eco: Type.Optional(Type.String()),
          themes: Type.Optional(Type.String()),
          phase: Type.Optional(Type.String()),
          endgameType: Type.Optional(Type.String()),
          level: Type.Optional(Type.Integer()),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
        }),
      },
    },
    async (req) => {
      const q = req.query;
      // con una FEN i tag arrivano dai detector, come nel coach
      const facts = q.fen ? analyzePosition(q.fen) : null;
      const query = {
        question: q.q ?? null,
        fen: q.fen ?? null,
        structures: [...list(q.structures), ...(facts?.tags.structures ?? [])],
        eco: list(q.eco),
        themes: [...list(q.themes), ...(facts?.tags.themes ?? [])],
        phase: q.phase ?? facts?.tags.phase ?? null,
        endgameType: q.endgameType ?? facts?.tags.endgameType ?? null,
        level: q.level ?? null,
        limit: q.limit ?? 8,
      };
      return { query, results: await retriever.retrieve(query) };
    },
  );

  app.get('/knowledge/stats', { schema: { tags: ['knowledge'] } }, async () => {
    const docs = await db
      .selectFrom('knowledge_docs')
      .leftJoin('knowledge_chunks', 'knowledge_chunks.doc_id', 'knowledge_docs.id')
      .select((eb) => [
        'knowledge_docs.path',
        'knowledge_docs.title',
        'knowledge_docs.verified',
        eb.fn.count<string>('knowledge_chunks.id').as('chunks'),
        eb.fn.count<string>('knowledge_chunks.embedding').as('embedded'),
      ])
      .groupBy(['knowledge_docs.path', 'knowledge_docs.title', 'knowledge_docs.verified'])
      .orderBy('knowledge_docs.path')
      .execute();
    return docs.map((d) => ({ ...d, chunks: Number(d.chunks), embedded: Number(d.embedded) }));
  });
};
