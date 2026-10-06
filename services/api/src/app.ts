import Fastify, { type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { Config } from './config/env.js';
import type { Db } from './db/index.js';
import { authPlugin } from './modules/auth/plugin.js';
import { authRoutes } from './modules/auth/routes.js';
import { AuthService } from './modules/auth/service.js';
import { healthRoutes } from './modules/health/routes.js';
import { EngineClient } from './modules/engine/client.js';
import { analysisRoutes } from './modules/engine/routes.js';
import { TablebaseClient } from './modules/engine/tablebase.js';
import { gamesRoutes } from './modules/games/routes.js';
import { playRoutes } from './modules/play/routes.js';
import { PlayService } from './modules/play/service.js';
import { profileRoutes } from './modules/profile/routes.js';
import { puzzleRoutes } from './modules/puzzles/routes.js';
import { PuzzleService } from './modules/puzzles/service.js';
import { stormRoutes } from './modules/storm/routes.js';
import { StormService } from './modules/storm/service.js';

export interface AppDeps {
  engine?: EngineClient;
  onGameFinished?: (gameId: string) => Promise<void>;
}

export async function buildApp(
  config: Config,
  db: Db,
  opts: FastifyServerOptions = {},
  deps: AppDeps = {},
) {
  const app = Fastify({ ...opts, ajv: { customOptions: { allErrors: false } } })
    .withTypeProvider<TypeBoxTypeProvider>();

  await app.register(cors, { origin: config.corsOrigins.length ? config.corsOrigins : false });
  await app.register(rateLimit, { global: false });
  await app.register(swagger, {
    openapi: {
      info: { title: 'Chess Mentor API', version: '0.1.0' },
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
  await app.register(authPlugin, {
    secret: config.jwtSecret,
    accessTokenTtl: config.accessTokenTtl,
  });

  const auth = new AuthService(db, {
    adminEmails: config.adminEmails,
    refreshTokenTtlDays: config.refreshTokenTtlDays,
  });

  await app.register(healthRoutes, { db });
  await app.register(authRoutes, { auth });

  const puzzles = new PuzzleService(db);
  await app.register(puzzleRoutes, { puzzles });
  await app.register(stormRoutes, { storm: new StormService(db, puzzles) });
  await app.register(profileRoutes, { db });

  const engine = deps.engine ?? new EngineClient(config.engineUrl, db);
  const tablebase = new TablebaseClient(db);
  await app.register(analysisRoutes, { engine, tablebase });
  const onGameFinished = deps.onGameFinished ?? (async () => {});
  const play = new PlayService(db, engine, onGameFinished);
  await app.register(playRoutes, { play });
  await app.register(gamesRoutes, { db, requeue: onGameFinished });

  return app;
}
