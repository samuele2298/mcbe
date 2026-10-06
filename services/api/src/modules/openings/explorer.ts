import type { Db } from '../../db/index.js';
import { fenToEpd } from '../../lib/openings.js';

// Opening explorer di Lichess (statistiche delle mosse), con cache in Postgres.
// Se l'API non è raggiungibile o richiede autenticazione, si torna null: l'albero
// usa comunque le mosse di libro dal database delle aperture.

export interface ExplorerMove {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
  averageRating: number | null;
}

export interface ExplorerResult {
  white: number;
  draws: number;
  black: number;
  moves: ExplorerMove[];
  opening: { eco: string; name: string } | null;
}

const TTL_DAYS = 30;

export async function explore(db: Db, fen: string, source: 'lichess' | 'masters' = 'lichess'): Promise<ExplorerResult | { error: string }> {
  const key = `${source}:${fenToEpd(fen)}`;
  const cached = await db
    .selectFrom('explorer_cache')
    .select(['result', 'created_at'])
    .where('key', '=', key)
    .executeTakeFirst();
  if (cached && Date.now() - new Date(cached.created_at).getTime() < TTL_DAYS * 86_400_000) {
    return cached.result as ExplorerResult;
  }
  const url = new URL(`https://explorer.lichess.ovh/${source}`);
  url.searchParams.set('fen', fen);
  url.searchParams.set('moves', '8');
  url.searchParams.set('topGames', '0');
  url.searchParams.set('recentGames', '0');
  if (source === 'lichess') {
    url.searchParams.set('speeds', 'blitz,rapid,classical');
    url.searchParams.set('ratings', '1600,1800,2000,2200,2500');
  }
  const headers: Record<string, string> = { 'user-agent': 'chess-mentor (uso personale)' };
  if (process.env.LICHESS_TOKEN) headers.authorization = `Bearer ${process.env.LICHESS_TOKEN}`;
  let res: Response;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  } catch {
    return { error: 'explorer_unreachable' };
  }
  if (res.status === 401 || res.status === 403) return { error: 'explorer_requires_token' };
  if (res.status === 429) return { error: 'explorer_rate_limited' };
  if (!res.ok) return { error: `explorer_${res.status}` };
  const j = (await res.json()) as {
    white: number;
    draws: number;
    black: number;
    moves: Array<{ uci: string; san: string; white: number; draws: number; black: number; averageRating?: number }>;
    opening?: { eco: string; name: string } | null;
  };
  const result: ExplorerResult = {
    white: j.white,
    draws: j.draws,
    black: j.black,
    moves: j.moves.map((m) => ({
      uci: m.uci,
      san: m.san,
      white: m.white,
      draws: m.draws,
      black: m.black,
      averageRating: m.averageRating ?? null,
    })),
    opening: j.opening ?? null,
  };
  await db
    .insertInto('explorer_cache')
    .values({ key, result: JSON.stringify(result) as never })
    .onConflict((oc) => oc.column('key').doUpdateSet({ result: JSON.stringify(result) as never, created_at: new Date() }))
    .execute();
  return result;
}
