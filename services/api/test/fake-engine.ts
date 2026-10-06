import { load } from '../src/chess/detectors/board.js';
import type { AnalysisResult, EngineClient } from '../src/modules/engine/client.js';

/**
 * Motore finto per i test: la mossa del computer è la prima legale; la valutazione
 * è data da una funzione sulla FEN (default: 0).
 */
export function fakeEngine(evalFn: (fen: string) => { cp?: number; mate?: number; best?: string } = () => ({})) {
  return {
    async analyse(fen: string): Promise<AnalysisResult> {
      const c = load(fen);
      const moves = c.moves({ verbose: true });
      const e = evalFn(fen);
      const best = e.best ?? (moves[0] ? moves[0].from + moves[0].to + (moves[0].promotion ?? '') : null);
      return {
        bestmove: best,
        lines: best
          ? [{ multipv: 1, depth: 14, cp: e.mate !== undefined ? null : (e.cp ?? 0), mate: e.mate ?? null, pv: [best] }]
          : [],
      };
    },
    async move(fen: string): Promise<string | null> {
      const m = load(fen).moves({ verbose: true })[0];
      return m ? m.from + m.to + (m.promotion ?? '') : null;
    },
  } as unknown as EngineClient;
}
