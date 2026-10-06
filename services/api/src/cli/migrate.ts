import { createPool } from '../db/index.js';
import { migrate } from '../db/migrate.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL mancante');
const pool = createPool(url, 1);
try {
  const applied = await migrate(pool);
  console.log(applied.length ? `${applied.length} migrazioni applicate` : 'DB già aggiornato');
} finally {
  await pool.end();
}
