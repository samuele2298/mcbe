import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { Readable, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { from as copyFrom } from 'pg-copy-streams';
import { createPool } from '../db/index.js';
import {
  isSupportedHeader,
  keepPuzzle,
  parsePuzzleLine,
  PUZZLE_CSV_HEADER,
  toCopyLine,
} from '../lib/puzzle-csv.js';

// Import del dump puzzle Lichess (CC0) in streaming:
// download/lettura -> zstd (CLI) -> righe CSV -> filtro -> COPY in tabella di staging -> upsert.
// Ripetibile: i puzzle esistenti vengono aggiornati (rating, popolarità, temi...).
//
//   pnpm seed:puzzles                              # scarica da database.lichess.org
//   pnpm seed:puzzles --file data/lichess_db_puzzle.csv.zst
//   pnpm seed:puzzles --min-popularity 50 --min-plays 100

const DEFAULT_URL = 'https://database.lichess.org/lichess_db_puzzle.csv.zst';

const { values: args } = parseArgs({
  options: {
    file: { type: 'string' },
    url: { type: 'string', default: DEFAULT_URL },
    'min-popularity': { type: 'string', default: '0' },
    'min-plays': { type: 'string', default: '20' },
  },
});

const filter = {
  minPopularity: Number(args['min-popularity']),
  minPlays: Number(args['min-plays']),
};

async function openSource(): Promise<Readable> {
  let raw: Readable;
  if (args.file) {
    raw = createReadStream(args.file);
  } else {
    console.log(`download ${args.url}`);
    const res = await fetch(args.url!);
    if (!res.ok || !res.body) throw new Error(`Download fallito: ${res.status}`);
    raw = Readable.fromWeb(res.body);
  }
  if (!(args.file ?? args.url!).endsWith('.zst')) return raw;

  // Il dump è in formato zstd "seekable" (frame skippable in testa e in coda) che lo zstd
  // di node:zlib non accetta: si usa la CLI `zstd`.
  const zstd = spawn('zstd', ['-dc'], { stdio: ['pipe', 'pipe', 'inherit'] });
  zstd.on('error', (err) =>
    zstd.stdout.destroy(new Error(`impossibile avviare zstd (installarlo): ${err.message}`)),
  );
  pipeline(raw, zstd.stdin).catch((err) => zstd.stdout.destroy(err));
  zstd.on('exit', (code) => {
    if (code) zstd.stdout.destroy(new Error(`zstd terminato con codice ${code}`));
  });
  return zstd.stdout;
}

async function* copyLines(source: Readable, stats: { read: number; kept: number }) {
  const lines = createInterface({ input: source, crlfDelay: Infinity });
  let first = true;
  for await (const line of lines) {
    if (first) {
      first = false;
      if (!isSupportedHeader(line)) {
        throw new Error(`header CSV inatteso: "${line}" (atteso "${PUZZLE_CSV_HEADER}...")`);
      }
      continue;
    }
    stats.read++;
    const p = parsePuzzleLine(line);
    if (p && keepPuzzle(p, filter)) {
      stats.kept++;
      yield toCopyLine(p);
    }
    if (stats.read % 500_000 === 0) {
      console.log(`  lette ${stats.read.toLocaleString()} righe, tenute ${stats.kept.toLocaleString()}`);
    }
  }
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL mancante');
const pool = createPool(url, 1);
const client = await pool.connect();
const started = Date.now();

try {
  await client.query(`
    CREATE UNLOGGED TABLE IF NOT EXISTS puzzles_import (
      id text, fen text, moves text[], rating int, rating_dev int, popularity int,
      nb_plays int, themes text[], opening_tags text[], game_url text)`);
  await client.query('TRUNCATE puzzles_import');

  const stats = { read: 0, kept: 0 };
  const copy = client.query(
    copyFrom(`COPY puzzles_import (id, fen, moves, rating, rating_dev, popularity, nb_plays,
      themes, opening_tags, game_url) FROM STDIN`),
  ) as unknown as Writable;
  await pipeline(Readable.from(copyLines(await openSource(), stats)), copy);
  console.log(`staging completato: ${stats.kept.toLocaleString()} puzzle su ${stats.read.toLocaleString()}`);

  // Primo import su tabella vuota: senza indici l'inserimento è molto più veloce.
  const empty = (await client.query('SELECT NOT EXISTS (SELECT 1 FROM puzzles) AS empty')).rows[0]
    .empty as boolean;

  await client.query('BEGIN');
  if (empty) {
    await client.query('DROP INDEX IF EXISTS puzzles_themes_idx');
    await client.query('DROP INDEX IF EXISTS puzzles_rating_rnd_idx');
  }
  const res = await client.query(`
    INSERT INTO puzzles AS p (id, fen, moves, rating, rating_dev, popularity, nb_plays,
                              themes, opening_tags, game_url, source)
    SELECT DISTINCT ON (id) id, fen, moves, rating, rating_dev, popularity, nb_plays,
           themes, opening_tags, game_url, 'lichess'
    FROM puzzles_import
    ON CONFLICT (id) DO UPDATE SET
      rating = EXCLUDED.rating, rating_dev = EXCLUDED.rating_dev,
      popularity = EXCLUDED.popularity, nb_plays = EXCLUDED.nb_plays,
      themes = EXCLUDED.themes, opening_tags = EXCLUDED.opening_tags`);
  if (empty) {
    console.log('creazione indici...');
    await client.query('CREATE INDEX puzzles_themes_idx ON puzzles USING gin (themes)');
    await client.query('CREATE INDEX puzzles_rating_rnd_idx ON puzzles (rating, rnd)');
  }
  await client.query('COMMIT');
  await client.query('DROP TABLE puzzles_import');

  // Ordina fisicamente la tabella per rating: la selezione "tema + fascia di rating" legge
  // pagine contigue invece di saltare su tutto il disco (a freddo: da ~20 s a <1 s).
  // Blocca la tabella per qualche minuto: va bene in fase di seed.
  console.log('CLUSTER per rating...');
  await client.query("SET maintenance_work_mem = '256MB'");
  await client.query('CLUSTER puzzles USING puzzles_rating_rnd_idx');
  await client.query('ANALYZE puzzles');

  console.log(
    `puzzle inseriti/aggiornati: ${res.rowCount?.toLocaleString()} in ${Math.round((Date.now() - started) / 1000)}s`,
  );
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  throw err;
} finally {
  client.release();
  await pool.end();
}
