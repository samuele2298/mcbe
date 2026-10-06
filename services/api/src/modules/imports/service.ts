import type { Db } from '../../db/index.js';
import { parseChesscomGame, parseLichessGame, type ImportedGame } from './parse.js';

// Import delle partite reali dell'utente: sono il quadro più fedele delle sue debolezze.
// Le partite nuove vanno in coda per l'analisi (Learn from play).

const UA = 'chess-mentor (uso personale)';

async function fetchLichess(username: string, max: number): Promise<ImportedGame[]> {
  const url = new URL(`https://lichess.org/api/games/user/${encodeURIComponent(username)}`);
  url.searchParams.set('max', String(max));
  url.searchParams.set('moves', 'true');
  url.searchParams.set('pgnInJson', 'true');
  url.searchParams.set('perfType', 'bullet,blitz,rapid,classical,correspondence');
  const headers: Record<string, string> = { accept: 'application/x-ndjson', 'user-agent': UA };
  if (process.env.LICHESS_TOKEN) headers.authorization = `Bearer ${process.env.LICHESS_TOKEN}`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) });
  if (res.status === 404) throw new ImportError('user_not_found');
  if (res.status === 429) throw new ImportError('rate_limited');
  if (!res.ok) throw new ImportError(`lichess_${res.status}`);
  const text = await res.text();
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => parseLichessGame(JSON.parse(l) as Record<string, unknown>, username))
    .filter((g): g is ImportedGame => g !== null);
}

async function fetchChesscom(username: string, max: number): Promise<ImportedGame[]> {
  const base = `https://api.chess.com/pub/player/${encodeURIComponent(username.toLowerCase())}`;
  const res = await fetch(`${base}/games/archives`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20_000) });
  if (res.status === 404) throw new ImportError('user_not_found');
  if (!res.ok) throw new ImportError(`chesscom_${res.status}`);
  const archives = ((await res.json()) as { archives: string[] }).archives;
  const out: ImportedGame[] = [];
  for (const archive of [...archives].reverse()) {
    const r = await fetch(archive, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30_000) });
    if (!r.ok) continue;
    const games = ((await r.json()) as { games: Array<Record<string, unknown>> }).games;
    for (const g of [...games].reverse()) {
      const parsed = parseChesscomGame(g, username);
      if (parsed) out.push(parsed);
      if (out.length >= max) return out;
    }
  }
  return out;
}

export class ImportError extends Error {}

export async function importGames(
  db: Db,
  userId: string,
  source: 'lichess' | 'chesscom',
  username: string,
  max: number,
  enqueue: (gameId: string) => Promise<void>,
): Promise<{ fetched: number; inserted: number }> {
  const games = source === 'lichess' ? await fetchLichess(username, max) : await fetchChesscom(username, max);
  let inserted = 0;
  for (const g of games) {
    const row = await db
      .insertInto('games')
      .values({
        user_id: userId,
        source,
        mode: 'normal',
        external_id: g.externalId,
        start_fen: g.startFen,
        moves: g.moves,
        pgn: g.pgn,
        user_color: g.userColor,
        result: g.result,
        termination: g.termination,
        opponent_name: g.opponentName,
        opponent_elo: g.opponentElo,
        analysis_status: 'queued',
        played_at: g.playedAt,
        finished_at: g.playedAt,
      })
      .onConflict((oc) => oc.columns(['user_id', 'source', 'external_id']).doNothing())
      .returning('id')
      .executeTakeFirst();
    if (row) {
      inserted++;
      await enqueue(row.id);
    }
  }
  await db
    .updateTable('users')
    .set(source === 'lichess' ? { lichess_username: username } : { chesscom_username: username })
    .where('id', '=', userId)
    .execute();
  return { fetched: games.length, inserted };
}
