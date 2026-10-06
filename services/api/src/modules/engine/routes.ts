import { Type } from 'typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { whitePovCp } from '../../chess/eval.js';
import { analyzePosition } from '../../chess/detectors/index.js';
import { load } from '../../chess/detectors/board.js';
import { EngineUnavailable, type EngineClient } from './client.js';
import type { TablebaseClient } from './tablebase.js';

// Analisi di una posizione qualsiasi: motore, tablebase e detector (strati 1-2).

export const analysisRoutes: FastifyPluginAsyncTypebox<{ engine: EngineClient; tablebase: TablebaseClient }> = async (
  app,
  { engine, tablebase },
) => {
  app.addHook('onRequest', app.authenticate);

  app.post(
    '/analysis',
    {
      schema: {
        tags: ['analysis'],
        body: Type.Object({
          fen: Type.String({ maxLength: 100 }),
          depth: Type.Optional(Type.Integer({ minimum: 6, maximum: 22 })),
          multipv: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })),
        }),
      },
    },
    async (req, reply) => {
      let fen: string;
      try {
        fen = load(req.body.fen).fen();
      } catch {
        return reply.code(400).send({ error: 'invalid_fen' });
      }
      const whiteToMove = fen.split(' ')[1] === 'w';
      const facts = analyzePosition(fen);
      try {
        const [an, tb] = await Promise.all([
          engine.analyse(fen, { depth: req.body.depth ?? 18, multipv: req.body.multipv ?? 3 }),
          tablebase.probe(fen),
        ]);
        return {
          fen,
          lines: an.lines.map((l) => ({ ...l, evalWhite: whitePovCp(l, whiteToMove) })),
          tablebase: tb,
          facts: { summary: facts.summary, tags: facts.tags, phase: facts.phase },
        };
      } catch (err) {
        if (err instanceof EngineUnavailable) return reply.code(503).send({ error: 'engine_unavailable' });
        throw err;
      }
    },
  );
};
