import { buildApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createDb, createPool } from './db/index.js';
import { migrate } from './db/migrate.js';
import { startQueue } from './jobs/queue.js';
import { GameAnalyzer } from './modules/analysis/game-analysis.js';
import { EngineClient } from './modules/engine/client.js';

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const db = createDb(pool);

await migrate(pool);

const engine = new EngineClient(config.engineUrl, db);
// il logger della coda è quello di Fastify, creato dopo: si passa tramite un rimando
let log: { info: (m: string) => void; error: (o: unknown, m: string) => void } = console;
const analyzer = new GameAnalyzer(db, engine, (m) => log.info(m));
const queue = await startQueue(config.databaseUrl, analyzer, {
  info: (m) => log.info(m),
  error: (o, m) => log.error(o, m),
});

const app = await buildApp(
  config,
  db,
  {
    logger: process.env.NODE_ENV === 'production' ? true : { transport: { target: 'pino-pretty' } },
    trustProxy: true,
  },
  { engine, onGameFinished: (id) => queue.analyzeGame(id) },
);
log = { info: (m) => app.log.info(m), error: (o, m) => app.log.error(o, m) };

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    await queue.stop();
    await db.destroy();
    process.exit(0);
  });
}

await app.listen({ port: config.port, host: '0.0.0.0' });
