import { Type } from 'typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { EngineUnavailable } from '../engine/client.js';
import type { Db } from '../../db/index.js';
import { planAdaptive } from '../adaptive/planner.js';
import { getRating } from '../profile/stats.js';
import { GameError, type PlayService } from './service.js';

export const GameStateSchema = Type.Object({
  id: Type.String(),
  startFen: Type.String(),
  fen: Type.String(),
  moves: Type.Array(Type.String()),
  sans: Type.Array(Type.String()),
  userColor: Type.Union([Type.Literal('white'), Type.Literal('black')]),
  mode: Type.String(),
  opponentElo: Type.Union([Type.Integer(), Type.Null()]),
  result: Type.Union([Type.String(), Type.Null()]),
  termination: Type.Union([Type.String(), Type.Null()]),
  turn: Type.String(),
  analysisStatus: Type.String(),
  adaptiveTarget: Type.Union([Type.String(), Type.Null()]),
  awaitingDecision: Type.Boolean(),
});

const Feedback = Type.Object({
  uci: Type.String(),
  san: Type.String(),
  classification: Type.String(),
  winPctLoss: Type.Number(),
  evalBefore: Type.Integer(),
  evalAfter: Type.Integer(),
  bestUci: Type.Union([Type.String(), Type.Null()]),
  bestSan: Type.Union([Type.String(), Type.Null()]),
  diagnosis: Type.Union([
    Type.Object({
      category: Type.String(),
      motif: Type.Union([Type.String(), Type.Null()]),
      phase: Type.String(),
      structure: Type.Union([Type.String(), Type.Null()]),
      endgameType: Type.Union([Type.String(), Type.Null()]),
      reasons: Type.Array(Type.String()),
    }),
    Type.Null(),
  ]),
});

const Opportunity = Type.Object({
  motif: Type.String(),
  found: Type.Boolean(),
  expected: Type.Array(Type.String()),
  expectedSan: Type.Array(Type.String()),
});

const Err = Type.Object({ error: Type.String() });
const Id = Type.Object({ id: Type.String({ format: 'uuid' }) });

export const playRoutes: FastifyPluginAsyncTypebox<{ play: PlayService; db: Db }> = async (app, { play, db }) => {
  app.addHook('onRequest', app.authenticate);
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof GameError) {
      return reply.code(err.code === 'not_found' ? 404 : 409).send({ error: err.code });
    }
    if (err instanceof EngineUnavailable) return reply.code(503).send({ error: 'engine_unavailable' });
    throw err;
  });

  app.post(
    '/play/start',
    {
      schema: {
        tags: ['play'],
        body: Type.Object({
          color: Type.Union([Type.Literal('white'), Type.Literal('black'), Type.Literal('random')]),
          elo: Type.Integer({ minimum: 400, maximum: 3200 }),
          mode: Type.Union([Type.Literal('normal'), Type.Literal('training')]),
          startFen: Type.Optional(Type.String({ maxLength: 100 })),
        }),
        response: { 200: GameStateSchema, 503: Err },
      },
    },
    async (req) =>
      play.start(req.user.sub, {
        color: req.body.color,
        elo: req.body.elo,
        mode: req.body.mode,
        ...(req.body.startFen ? { startFen: req.body.startFen } : {}),
      }),
  );

  app.post(
    '/play/adaptive',
    {
      schema: {
        tags: ['play'],
        body: Type.Object({
          color: Type.Union([Type.Literal('white'), Type.Literal('black'), Type.Literal('random')]),
          elo: Type.Optional(Type.Integer({ minimum: 400, maximum: 3200 })),
          /** per forzare una debolezza specifica, es. "theme:fork" o "structure:iqp" */
          target: Type.Optional(Type.String({ pattern: '^[a-z_]+:[A-Za-z_0-9]+$' })),
        }),
        response: {
          200: Type.Object({
            state: GameStateSchema,
            plan: Type.Object({
              target: Type.String(),
              targetLabel: Type.String(),
              level: Type.String(),
              description: Type.String(),
            }),
          }),
          503: Err,
        },
      },
    },
    async (req) => {
      const rating = (await getRating(db, req.user.sub, 'global', 'all'))?.rating ?? 1500;
      const forced = req.body.target
        ? { dimension: req.body.target.split(':')[0]!, key: req.body.target.split(':')[1]! }
        : undefined;
      const plan = await planAdaptive(db, req.user.sub, rating, forced);
      // il computer gioca un po' sotto il livello del giocatore: si allena il tema, non si soffre
      const elo = req.body.elo ?? Math.max(800, Math.min(2600, Math.round(rating - 100)));
      const state = await play.start(req.user.sub, {
        color: plan.startFen && req.body.color === 'random' ? 'random' : req.body.color,
        elo,
        mode: 'adaptive',
        adaptiveTarget: plan.target,
        adaptiveMotif: plan.motif,
        ...(plan.startFen ? { startFen: plan.startFen } : {}),
        ...(plan.openingMoves ? { openingMoves: plan.openingMoves } : {}),
      });
      return {
        state,
        plan: { target: plan.target, targetLabel: plan.targetLabel, level: plan.level, description: plan.description },
      };
    },
  );

  app.get(
    '/play/:id',
    { schema: { tags: ['play'], params: Id, response: { 200: GameStateSchema, 404: Err } } },
    async (req) => play.get(req.user.sub, req.params.id),
  );

  app.post(
    '/play/:id/move',
    {
      schema: {
        tags: ['play'],
        params: Id,
        body: Type.Object({ uci: Type.String({ pattern: '^[a-h][1-8][a-h][1-8][qrbn]?$' }) }),
        response: {
          200: Type.Object({
            state: GameStateSchema,
            feedback: Type.Union([Feedback, Type.Null()]),
            opportunity: Type.Union([Opportunity, Type.Null()]),
          }),
          404: Err,
          409: Err,
          503: Err,
        },
      },
    },
    async (req) => play.move(req.user.sub, req.params.id, req.body.uci),
  );

  app.post(
    '/play/:id/takeback',
    { schema: { tags: ['play'], params: Id, response: { 200: GameStateSchema, 404: Err, 409: Err } } },
    async (req) => play.takeback(req.user.sub, req.params.id),
  );

  app.post(
    '/play/:id/continue',
    { schema: { tags: ['play'], params: Id, response: { 200: GameStateSchema, 404: Err, 503: Err } } },
    async (req) => play.continueGame(req.user.sub, req.params.id),
  );

  app.post(
    '/play/:id/resign',
    { schema: { tags: ['play'], params: Id, response: { 200: GameStateSchema, 404: Err, 409: Err } } },
    async (req) => play.resign(req.user.sub, req.params.id),
  );
};
