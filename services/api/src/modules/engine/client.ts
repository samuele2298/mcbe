import { sql } from 'kysely';
import type { Db } from '../../db/index.js';
import type { EngineLine } from '../../chess/eval.js';
import { fenToEpd } from '../../lib/openings.js';

export interface AnalysisResult {
  bestmove: string | null;
  lines: EngineLine[];
}

export class EngineUnavailable extends Error {}

/** Client del servizio Stockfish (services/engine) con cache in Postgres per posizione. */
export class EngineClient {
  constructor(
    private readonly url: string,
    private readonly db: Db,
  ) {}

  private async post<T>(path: string, body: unknown, timeoutMs = 30_000): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.url}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new EngineUnavailable(`engine non raggiungibile: ${(err as Error).message}`);
    }
    if (!res.ok) throw new EngineUnavailable(`engine ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
  }

  async analyse(
    fen: string,
    opts: { depth?: number; nodes?: number; multipv?: number; priority?: 'high' | 'low' } = {},
  ): Promise<AnalysisResult> {
    const multipv = opts.multipv ?? 1;
    // la cache è per profondità; per le ricerche a nodi si usa una "profondità" negativa convenzionale
    const depthKey = opts.depth ?? -(opts.nodes ?? 0);
    const epd = fenToEpd(fen);
    const cached = await this.db
      .selectFrom('engine_cache')
      .select('result')
      .where('fen', '=', epd)
      .where('multipv', '>=', multipv)
      .where((eb) => (depthKey > 0 ? eb('depth', '>=', depthKey) : eb('depth', '=', depthKey)))
      .orderBy('depth', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (cached) {
      const r = cached.result as unknown as AnalysisResult;
      return { ...r, lines: r.lines.slice(0, multipv) };
    }
    const result = await this.post<AnalysisResult>('/analyse', {
      fen,
      depth: opts.depth,
      nodes: opts.nodes,
      multipv,
      priority: opts.priority ?? 'high',
    });
    if (result.lines.length) {
      await this.db
        .insertInto('engine_cache')
        .values({ fen: epd, depth: depthKey, multipv, result: JSON.stringify(result) as never })
        .onConflict((oc) =>
          oc.columns(['fen', 'depth', 'multipv']).doUpdateSet({ result: sql`excluded.result`, created_at: new Date() }),
        )
        .execute();
    }
    return result;
  }

  async move(fen: string, elo: number | undefined, movetime: number): Promise<string | null> {
    const r = await this.post<{ bestmove: string | null }>('/move', { fen, elo, movetime });
    return r.bestmove;
  }
}
