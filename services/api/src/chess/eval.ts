// Valutazioni: punto di vista, probabilità di vittoria e classificazione delle mosse.

export interface EngineLine {
  multipv: number;
  depth: number;
  cp: number | null;
  mate: number | null;
  pv: string[];
}

export const MATE_CP = 10_000;

/** Converte cp/matto (dal lato al tratto) in centipedoni dal punto di vista del Bianco. */
export function whitePovCp(line: Pick<EngineLine, 'cp' | 'mate'>, whiteToMove: boolean): number {
  const raw =
    line.mate !== null
      ? line.mate === 0
        ? -MATE_CP
        : Math.sign(line.mate) * (MATE_CP - Math.abs(line.mate))
      : (line.cp ?? 0);
  return whiteToMove ? raw : -raw;
}

/** Formula Lichess: probabilità di vittoria (0-100) per centipedoni. */
export function winPercent(cp: number): number {
  if (Math.abs(cp) >= MATE_CP - 1000) return cp > 0 ? 100 : 0;
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

export type MoveClass = 'best' | 'ok' | 'inaccuracy' | 'mistake' | 'blunder';

/** Soglie Lichess sulla perdita di probabilità di vittoria del giocatore che muove. */
export function classifyLoss(winPctLoss: number, isBest: boolean): MoveClass {
  if (isBest) return 'best';
  if (winPctLoss >= 30) return 'blunder';
  if (winPctLoss >= 20) return 'mistake';
  if (winPctLoss >= 10) return 'inaccuracy';
  return 'ok';
}

/** Precisione di partita (formula Lichess semplificata, media sulle mosse). */
export function moveAccuracy(winPctLoss: number): number {
  const a = 103.1668 * Math.exp(-0.04354 * Math.max(0, winPctLoss)) - 3.1669;
  return Math.max(0, Math.min(100, a));
}

export function formatEval(cpWhite: number): string {
  if (Math.abs(cpWhite) >= MATE_CP - 1000) {
    const n = MATE_CP - Math.abs(cpWhite);
    return `${cpWhite > 0 ? '' : '-'}M${n}`;
  }
  const v = cpWhite / 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
}
