import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js';

// Geometria di base indipendente dal tratto: attacchi per pezzo, linee, distanze.

export interface BoardPiece {
  square: Square;
  type: PieceSymbol;
  color: Color;
}

export const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
export const NAME_IT: Record<PieceSymbol, string> = {
  p: 'pedone',
  n: 'cavallo',
  b: 'alfiere',
  r: 'torre',
  q: 'donna',
  k: 're',
};
export const FILES = 'abcdefgh';

export function load(fen: string): Chess {
  return new Chess(fen, { skipValidation: true });
}

export const fileOf = (sq: string) => sq.charCodeAt(0) - 97;
export const rankOf = (sq: string) => Number(sq[1]) - 1;
export const sq = (f: number, r: number) => `${FILES[f]}${r + 1}` as Square;
export const onBoard = (f: number, r: number) => f >= 0 && f < 8 && r >= 0 && r < 8;
export const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');
export const colorName = (c: Color) => (c === 'w' ? 'Bianco' : 'Nero');

/** Distanza di Chebyshev (mosse di re). */
export function kingDistance(a: string, b: string): number {
  return Math.max(Math.abs(fileOf(a) - fileOf(b)), Math.abs(rankOf(a) - rankOf(b)));
}

export function pieces(chess: Chess, color?: Color): BoardPiece[] {
  const out: BoardPiece[] = [];
  for (const row of chess.board()) {
    for (const p of row) {
      if (p && (!color || p.color === color)) out.push({ square: p.square, type: p.type, color: p.color });
    }
  }
  return out;
}

const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]] as const;
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const;
export const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
export const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

export function slideDirs(type: PieceSymbol): ReadonlyArray<readonly [number, number]> {
  if (type === 'r') return ORTHO;
  if (type === 'b') return DIAG;
  if (type === 'q') return [...ORTHO, ...DIAG];
  return [];
}

/** Case attaccate da un pezzo (pseudo-legali, ignora inchiodature). */
export function attacksFrom(chess: Chess, p: BoardPiece): Square[] {
  const f = fileOf(p.square);
  const r = rankOf(p.square);
  const out: Square[] = [];
  if (p.type === 'p') {
    const dir = p.color === 'w' ? 1 : -1;
    for (const df of [-1, 1]) if (onBoard(f + df, r + dir)) out.push(sq(f + df, r + dir));
    return out;
  }
  if (p.type === 'n' || p.type === 'k') {
    for (const [df, dr] of p.type === 'n' ? KNIGHT : KING) {
      if (onBoard(f + df, r + dr)) out.push(sq(f + df, r + dr));
    }
    return out;
  }
  for (const [df, dr] of slideDirs(p.type)) {
    let x = f + df;
    let y = r + dr;
    while (onBoard(x, y)) {
      const s = sq(x, y);
      out.push(s);
      if (chess.get(s)) break;
      x += df;
      y += dr;
    }
  }
  return out;
}

/** Pezzi di `by` che attaccano la casa. */
export function attackersOf(chess: Chess, target: string, by: Color): BoardPiece[] {
  return pieces(chess, by).filter((p) => attacksFrom(chess, p).includes(target as Square));
}

/** Pezzo più leggero tra gli attaccanti (per lo scambio). */
export function cheapest(list: BoardPiece[]): BoardPiece | undefined {
  return [...list].sort((a, b) => VALUE[a.type] - VALUE[b.type])[0];
}

/** FEN con il tratto invertito (per chiedersi "cosa minaccia l'avversario"). */
export function flipTurn(fen: string): string {
  const parts = fen.split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  return parts.join(' ');
}

export function pieceLabel(p: BoardPiece): string {
  return `${NAME_IT[p.type]} in ${p.square}`;
}
