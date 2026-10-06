import { createDb, createPool } from '../db/index.js';
import { parseOpeningLine, type OpeningRow } from '../lib/openings.js';

// Importa l'albero aperture da github.com/lichess-org/chess-openings (CC0).
// Ripetibile: le righe esistenti vengono aggiornate.

const BASE = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL mancante');
const pool = createPool(url, 2);
const db = createDb(pool);

try {
  const rows: OpeningRow[] = [];
  for (const file of ['a', 'b', 'c', 'd', 'e']) {
    const res = await fetch(`${BASE}/${file}.tsv`);
    if (!res.ok) throw new Error(`Download ${file}.tsv fallito: ${res.status}`);
    for (const line of (await res.text()).split('\n')) {
      const row = parseOpeningLine(line);
      if (row) rows.push(row);
    }
  }

  for (let i = 0; i < rows.length; i += 1000) {
    await db
      .insertInto('openings')
      .values(rows.slice(i, i + 1000))
      .onConflict((oc) =>
        oc.columns(['eco', 'name', 'pgn']).doUpdateSet((eb) => ({
          uci: eb.ref('excluded.uci'),
          epd: eb.ref('excluded.epd'),
          ply: eb.ref('excluded.ply'),
        })),
      )
      .execute();
  }
  console.log(`aperture importate: ${rows.length}`);
} finally {
  await db.destroy();
}
