import { Type } from 'typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { Db } from '../../db/index.js';
import { labelFor } from '../profile/labels.js';

// Archivio partite e revisione: mosse classificate, momenti chiave, errori diagnosticati.

const Err = Type.Object({ error: Type.String() });

export const gamesRoutes: FastifyPluginAsyncTypebox<{ db: Db; requeue: (id: string) => Promise<void> }> = async (
  app,
  { db, requeue },
) => {
  app.addHook('onRequest', app.authenticate);

  app.get(
    '/games',
    {
      schema: {
        tags: ['games'],
        querystring: Type.Object({ limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }),
      },
    },
    async (req) => {
      const rows = await db
        .selectFrom('games')
        .select(['id', 'source', 'mode', 'user_color', 'result', 'termination', 'opponent_name', 'opponent_elo', 'analysis_status', 'accuracy', 'played_at', 'moves'])
        .where('user_id', '=', req.user.sub)
        .orderBy('played_at', 'desc')
        .limit(req.query.limit ?? 30)
        .execute();
      return rows.map((g) => ({
        id: g.id,
        source: g.source,
        mode: g.mode,
        userColor: g.user_color,
        result: g.result,
        termination: g.termination,
        opponent: g.opponent_name,
        opponentElo: g.opponent_elo,
        analysisStatus: g.analysis_status,
        accuracy: g.accuracy === null ? null : Math.round(g.accuracy),
        plies: g.moves.length,
        playedAt: new Date(g.played_at).toISOString(),
      }));
    },
  );

  app.get(
    '/games/:id/review',
    { schema: { tags: ['games'], params: Type.Object({ id: Type.String({ format: 'uuid' }) }) } },
    async (req, reply) => {
      const g = await db
        .selectFrom('games')
        .selectAll()
        .where('id', '=', req.params.id)
        .where('user_id', '=', req.user.sub)
        .executeTakeFirst();
      if (!g) return reply.code(404).send({ error: 'not_found' });
      const moves = await db
        .selectFrom('game_moves')
        .selectAll()
        .where('game_id', '=', g.id)
        .orderBy('ply')
        .execute();
      const mistakes = await db
        .selectFrom('mistakes')
        .selectAll()
        .where('game_id', '=', g.id)
        .orderBy('ply')
        .execute();
      const keyMoments = moves
        .filter((m) => m.by_user && (m.classification === 'mistake' || m.classification === 'blunder'))
        .sort((a, b) => (b.win_pct_loss ?? 0) - (a.win_pct_loss ?? 0))
        .slice(0, 3)
        .map((m) => m.ply)
        .sort((a, b) => a - b);
      return {
        id: g.id,
        startFen: g.start_fen,
        userColor: g.user_color,
        result: g.result,
        termination: g.termination,
        opponent: g.opponent_name,
        accuracy: g.accuracy === null ? null : Math.round(g.accuracy),
        analysisStatus: g.analysis_status,
        moves: moves.map((m) => ({
          ply: m.ply,
          fenBefore: m.fen_before,
          uci: m.uci,
          san: m.san,
          byUser: m.by_user,
          evalBefore: m.eval_before,
          evalAfter: m.eval_after,
          bestUci: m.best_uci,
          bestPv: m.best_pv,
          winPctLoss: m.win_pct_loss,
          classification: m.classification,
        })),
        // partita non ancora analizzata: solo le mosse
        rawMoves: g.moves,
        keyMoments,
        mistakes: mistakes.map((x) => ({
          ply: x.ply,
          category: x.category,
          categoryLabel: labelFor('mistake', x.category),
          motif: x.motif,
          severity: x.severity,
          bestUci: x.best_uci,
          reasons: ((x.explanation as { reasons?: string[] } | null)?.reasons ?? []),
          puzzleId: x.puzzle_id,
        })),
      };
    },
  );

  app.post(
    '/games/:id/analyze',
    { schema: { tags: ['games'], params: Type.Object({ id: Type.String({ format: 'uuid' }) }), response: { 202: Type.Object({ status: Type.String() }), 404: Err } } },
    async (req, reply) => {
      const g = await db
        .updateTable('games')
        .set({ analysis_status: 'queued' })
        .where('id', '=', req.params.id)
        .where('user_id', '=', req.user.sub)
        .where('result', 'is not', null)
        .returning('id')
        .executeTakeFirst();
      if (!g) return reply.code(404).send({ error: 'not_found' });
      await requeue(g.id);
      return reply.code(202).send({ status: 'queued' });
    },
  );

  app.get(
    '/me/mistakes',
    { schema: { tags: ['profile'], querystring: Type.Object({ limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }) } },
    async (req) => {
      const rows = await db
        .selectFrom('mistakes')
        .select(['id', 'game_id', 'ply', 'fen', 'played_uci', 'best_uci', 'category', 'motif', 'phase', 'severity', 'puzzle_id', 'created_at'])
        .where('user_id', '=', req.user.sub)
        .orderBy('created_at', 'desc')
        .limit(req.query.limit ?? 30)
        .execute();
      return rows.map((m) => ({
        id: String(m.id),
        gameId: m.game_id,
        ply: m.ply,
        fen: m.fen,
        playedUci: m.played_uci,
        bestUci: m.best_uci,
        category: m.category,
        categoryLabel: labelFor('mistake', m.category),
        motif: m.motif,
        phase: m.phase,
        severity: m.severity,
        puzzleId: m.puzzle_id,
        createdAt: new Date(m.created_at).toISOString(),
      }));
    },
  );
};
