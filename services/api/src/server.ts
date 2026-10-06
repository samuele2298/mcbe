import { buildApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createDb, createPool } from './db/index.js';
import { migrate } from './db/migrate.js';

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const db = createDb(pool);

await migrate(pool);

const app = await buildApp(config, db, {
  logger: process.env.NODE_ENV === 'production' ? true : { transport: { target: 'pino-pretty' } },
  trustProxy: true,
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    await db.destroy();
    process.exit(0);
  });
}

await app.listen({ port: config.port, host: '0.0.0.0' });
