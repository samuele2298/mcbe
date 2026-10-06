import type { Db } from '../../db/index.js';

// Tablebase Syzygy via API Lichess (≤7 pezzi), con cache in Postgres.

export interface TablebaseResult {
  category: 'win' | 'loss' | 'draw' | 'cursed-win' | 'blessed-loss' | 'maybe-win' | 'maybe-loss' | 'unknown';
  dtz: number | null;
  dtm: number | null;
  checkmate: boolean;
  stalemate: boolean;
  bestMove: string | null;
  moves: Array<{ uci: string; san: string; category: string; dtz: number | null; dtm: number | null }>;
}

const API = 'https://tablebase.lichess.ovh/standard';

export function pieceCount(fen: string): number {
  return (fen.split(' ')[0]!.match(/[pnbrqk]/gi) ?? []).length;
}

export class TablebaseClient {
  constructor(private readonly db: Db) {}

  async probe(fen: string): Promise<TablebaseResult | null> {
    if (pieceCount(fen) > 7) return null;
    const key = fen.split(' ').slice(0, 4).join(' ');
    const cached = await this.db
      .selectFrom('tablebase_cache')
      .select('result')
      .where('fen', '=', key)
      .executeTakeFirst();
    if (cached) return cached.result as unknown as TablebaseResult;

    let json: Record<string, unknown>;
    try {
      const res = await fetch(`${API}?fen=${encodeURIComponent(fen)}`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null; // 429 rate limit o errore: il coach semplicemente non ha il dato
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
    const moves = (json.moves as Array<Record<string, unknown>> | undefined) ?? [];
    const result: TablebaseResult = {
      category: (json.category as TablebaseResult['category']) ?? 'unknown',
      dtz: (json.dtz as number | null) ?? null,
      dtm: (json.dtm as number | null) ?? null,
      checkmate: Boolean(json.checkmate),
      stalemate: Boolean(json.stalemate),
      bestMove: (moves[0]?.uci as string | undefined) ?? null,
      moves: moves.slice(0, 5).map((m) => ({
        uci: m.uci as string,
        san: m.san as string,
        // la categoria della mossa è dal punto di vista dell'avversario dopo la mossa
        category: m.category as string,
        dtz: (m.dtz as number | null) ?? null,
        dtm: (m.dtm as number | null) ?? null,
      })),
    };
    await this.db
      .insertInto('tablebase_cache')
      .values({ fen: key, result: JSON.stringify(result) as never })
      .onConflict((oc) => oc.column('fen').doNothing())
      .execute();
    return result;
  }
}
