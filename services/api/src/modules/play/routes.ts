import { Type } from 'typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { EngineUnavailable } from '../engine/client.js';
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

const Err = Type.Object({ error: Type.String() });
const Id = Type.Object({ id: Type.String({ format: 'uuid' }) });

export const playRoutes: FastifyPluginAsyncTypebox<{ play: PlayService }> = async (app, { play }) => {
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
          200: Type.Object({ state: GameStateSchema, feedback: Type.Union([Feedback, Type.Null()]) }),
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
