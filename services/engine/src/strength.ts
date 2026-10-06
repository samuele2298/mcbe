import type { SearchResult } from './uci.js';

// Forza del computer. Stockfish limita da sé l'Elo solo da 1320 in su: sotto si usa
// Skill Level 0 e si sceglie a volte una mossa peggiore tra le multipv, con probabilità
// crescente al calare dell'Elo.

export const MIN_UCI_ELO = 1320;

export function strengthOptions(elo: number | undefined): Record<string, string | number | boolean> {
  if (elo === undefined || elo >= 3000) {
    return { UCI_LimitStrength: false, 'Skill Level': 20 };
  }
  if (elo >= MIN_UCI_ELO) {
    return { UCI_LimitStrength: true, UCI_Elo: Math.round(elo), 'Skill Level': 20 };
  }
  return { UCI_LimitStrength: false, 'Skill Level': 0 };
}

/** Per Elo sotto 1320: probabilità di giocare una mossa non migliore. */
export function blunderChance(elo: number | undefined): number {
  if (elo === undefined || elo >= MIN_UCI_ELO) return 0;
  return Math.min(0.6, (MIN_UCI_ELO - elo) / 1300);
}

export function pickMove(result: SearchResult, elo: number | undefined, rnd = Math.random): string | null {
  const best = result.bestmove;
  const lines = result.lines.filter((l) => l.pv.length > 0);
  if (lines.length <= 1 || rnd() >= blunderChance(elo)) return best;
  // tra le alternative, niente che regali il matto o perda più di ~4 pedoni
  const top = lines[0]!;
  const score = (l: (typeof lines)[number]) => (l.mate !== null ? (l.mate > 0 ? 10_000 : -10_000) : (l.cp ?? 0));
  const ok = lines.slice(1).filter((l) => score(top) - score(l) <= 400 && !(l.mate !== null && l.mate < 0));
  if (!ok.length) return best;
  return ok[Math.floor(rnd() * ok.length)]!.pv[0] ?? best;
}
