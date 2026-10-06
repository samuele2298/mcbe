import { createDb, createPool } from '../db/index.js';
import { migrate } from '../db/migrate.js';
import { createEmbedder } from '../lib/embedder.js';
import { indexKnowledge } from '../modules/knowledge/indexer.js';

// Indicizza knowledge/content nel database (solo i file cambiati).
//   pnpm kb:index            incrementale
//   pnpm kb:index --rebuild  reindicizza tutto

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL mancante');
const pool = createPool(url, 2);
const db = createDb(pool);
try {
  await migrate(pool, undefined, () => {});
  const embedder = createEmbedder();
  if (!embedder) console.log('VOYAGE_API_KEY assente: niente embedding, la ricerca userà il full-text');
  const r = await indexKnowledge(db, embedder, { rebuild: process.argv.includes('--rebuild'), log: console.log });
  console.log(
    `documenti indicizzati: ${r.indexed.length}, invariati: ${r.unchanged}, rimossi: ${r.removed.length}, ` +
      `chunk: ${r.chunks}, embedding calcolati: ${r.embedded}`,
  );
} finally {
  await db.destroy();
}
