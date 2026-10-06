import type { Chess, Color, PieceSymbol } from 'chess.js';
import { pieces, VALUE } from './board.js';

export type Phase = 'opening' | 'middlegame' | 'endgame';
export type EndgameType = 'pawn' | 'rook' | 'rook_pawn' | 'minor' | 'queen' | 'mixed';

export type Count = Record<Exclude<PieceSymbol, 'k'>, number>;

export interface Material {
  white: Count;
  black: Count;
  /** materiale senza pedoni e re, per lato */
  nonPawn: { w: number; b: number };
  /** differenza in pedoni (positiva = Bianco avanti) */
  balance: number;
  bishopPair: Color | null;
}

const empty = (): Count => ({ p: 0, n: 0, b: 0, r: 0, q: 0 });

export function material(chess: Chess): Material {
  const white = empty();
  const black = empty();
  const bishopsSquareColor: Record<Color, Set<number>> = { w: new Set(), b: new Set() };
  for (const p of pieces(chess)) {
    if (p.type === 'k') continue;
    (p.color === 'w' ? white : black)[p.type]++;
    if (p.type === 'b') {
      bishopsSquareColor[p.color].add((p.square.charCodeAt(0) + Number(p.square[1])) % 2);
    }
  }
  const sum = (c: Count, withPawns: boolean) =>
    (withPawns ? c.p : 0) + c.n * VALUE.n + c.b * VALUE.b + c.r * VALUE.r + c.q * VALUE.q;
  const hasPair = (c: Color) => bishopsSquareColor[c].size === 2;
  return {
    white,
    black,
    nonPawn: { w: sum(white, false), b: sum(black, false) },
    balance: sum(white, true) - sum(black, true),
    bishopPair: hasPair('w') && !hasPair('b') ? 'w' : hasPair('b') && !hasPair('w') ? 'b' : null,
  };
}

/** Fase: finale con poco materiale pesante, apertura nelle prime mosse a materiale pieno. */
export function phase(m: Material, fullmove: number): Phase {
  const npm = m.nonPawn.w + m.nonPawn.b;
  const queens = m.white.q + m.black.q;
  if (npm <= 20 || (queens === 0 && npm <= 26)) return 'endgame';
  if (fullmove <= 10 && npm >= 54) return 'opening';
  return 'middlegame';
}

export function endgameType(m: Material): EndgameType | null {
  const w = m.white;
  const b = m.black;
  const only = (keys: Array<keyof Count>) =>
    (['n', 'b', 'r', 'q'] as const).every((k) => keys.includes(k) || (w[k] === 0 && b[k] === 0));
  const npm = m.nonPawn.w + m.nonPawn.b;
  if (npm === 0) return 'pawn';
  if (only(['r'])) return w.r === 1 && b.r === 1 && w.p + b.p === 1 ? 'rook_pawn' : 'rook';
  if (only(['n', 'b'])) return 'minor';
  if (only(['q'])) return 'queen';
  return 'mixed';
}

export function materialSignature(m: Material): string {
  const side = (c: Count) =>
    'K' + 'Q'.repeat(c.q) + 'R'.repeat(c.r) + 'B'.repeat(c.b) + 'N'.repeat(c.n) + 'P'.repeat(c.p);
  return `${side(m.white)}v${side(m.black)}`;
}
