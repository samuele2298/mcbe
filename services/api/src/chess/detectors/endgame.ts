import type { Chess, Color, Square } from 'chess.js';
import { fileOf, kingDistance, other, pieces, rankOf, sq } from './board.js';

export interface KpkFacts {
  type: 'kpk';
  attacker: Color;
  pawn: Square;
  promotion: Square;
  rookPawn: boolean;
  /** il re difensore rientra nel quadrato del pedone (tenendo conto del tratto) */
  defenderInSquare: boolean;
  /** lato che ha l'opposizione (diretta o a distanza), se i re sono in opposizione */
  opposition: Color | null;
  oppositionKind: 'direct' | 'distant' | null;
  /** il re attaccante occupa una casa chiave del pedone */
  attackerOnKeySquare: boolean;
  keySquares: Square[];
}

export interface RookPawnFacts {
  type: 'rook_pawn';
  attacker: Color;
  pawn: Square;
  pawnRelRank: number;
  lucena: boolean;
  philidor: boolean;
  defenderKingCutOff: number;
  rookBehindPawn: boolean;
}

export type EndgameFacts = KpkFacts | RookPawnFacts;

/** Traversa relativa (1..8) dal punto di vista del colore. */
const relRank = (s: string, c: Color) => (c === 'w' ? rankOf(s) + 1 : 8 - rankOf(s));

function kingOf(chess: Chess, c: Color): Square {
  return pieces(chess, c).find((p) => p.type === 'k')!.square;
}

/** Re contro re e pedone. */
export function kpk(chess: Chess): KpkFacts | null {
  const all = pieces(chess).filter((p) => p.type !== 'k');
  if (all.length !== 1 || all[0]!.type !== 'p') return null;
  const pawn = all[0]!;
  const attacker = pawn.color;
  const defender = other(attacker);
  const f = fileOf(pawn.square);
  const promotion = sq(f, attacker === 'w' ? 7 : 0);
  const aKing = kingOf(chess, attacker);
  const dKing = kingOf(chess, defender);
  const toMove = chess.turn();

  // regola del quadrato
  let pawnDist = 8 - relRank(pawn.square, attacker);
  if (relRank(pawn.square, attacker) === 2) pawnDist--; // doppio passo
  const kDist = kingDistance(dKing, promotion) - (toMove === defender ? 1 : 0);
  const defenderInSquare = kDist <= pawnDist;

  // opposizione: re sulla stessa colonna/traversa con un numero dispari di case in mezzo
  let opposition: Color | null = null;
  let oppositionKind: KpkFacts['oppositionKind'] = null;
  const df = Math.abs(fileOf(aKing) - fileOf(dKing));
  const dr = Math.abs(rankOf(aKing) - rankOf(dKing));
  const gap = df === 0 ? dr : dr === 0 ? df : 0;
  if (gap >= 2 && gap % 2 === 0) {
    opposition = other(toMove); // ha l'opposizione chi NON deve muovere
    oppositionKind = gap === 2 ? 'direct' : 'distant';
  }

  // case chiave
  const rookPawn = f === 0 || f === 7;
  const r = relRank(pawn.square, attacker);
  const toAbs = (rel: number) => (attacker === 'w' ? rel - 1 : 8 - rel);
  const keySquares: Square[] = [];
  if (rookPawn) {
    const nf = f === 0 ? 1 : 6;
    keySquares.push(sq(nf, toAbs(7)), sq(nf, toAbs(8)));
  } else {
    const rows = r <= 4 ? [r + 2] : [Math.min(r + 1, 8), Math.min(r + 2, 8)];
    for (const row of new Set(rows)) {
      for (const x of [f - 1, f, f + 1]) if (x >= 0 && x < 8) keySquares.push(sq(x, toAbs(row)));
    }
  }
  return {
    type: 'kpk',
    attacker,
    pawn: pawn.square,
    promotion,
    rookPawn,
    defenderInSquare,
    opposition,
    oppositionKind,
    attackerOnKeySquare: keySquares.includes(aKing),
    keySquares,
  };
}

/** Torre e pedone contro torre: Lucena, Philidor, re tagliato. */
export function rookPawn(chess: Chess): RookPawnFacts | null {
  const nonKing = pieces(chess).filter((p) => p.type !== 'k');
  const pawns = nonKing.filter((p) => p.type === 'p');
  const rooks = nonKing.filter((p) => p.type === 'r');
  if (pawns.length !== 1 || rooks.length !== 2 || nonKing.length !== 3) return null;
  if (rooks[0]!.color === rooks[1]!.color) return null;
  const pawn = pawns[0]!;
  const attacker = pawn.color;
  const defender = other(attacker);
  const aKing = kingOf(chess, attacker);
  const dKing = kingOf(chess, defender);
  const aRook = rooks.find((r) => r.color === attacker)!;
  const dRook = rooks.find((r) => r.color === defender)!;
  const pf = fileOf(pawn.square);
  const pr = relRank(pawn.square, attacker);

  const defenderKingCutOff = Math.abs(fileOf(dKing) - pf) - 1;
  // Lucena: pedone in 7ª, re attaccante davanti al pedone, re difensore tagliato di almeno una colonna
  const lucena =
    pr === 7 && fileOf(aKing) === pf && relRank(aKing, attacker) === 8 && defenderKingCutOff >= 1;
  // Philidor: re difensore davanti al pedone, torre difensore sulla 6ª traversa (relativa all'attaccante),
  // pedone non oltre la 5ª
  const philidor =
    pr <= 5 &&
    Math.abs(fileOf(dKing) - pf) <= 1 &&
    relRank(dKing, attacker) > pr &&
    relRank(dRook.square, attacker) === 6;
  const rookBehindPawn = fileOf(aRook.square) === pf && relRank(aRook.square, attacker) < pr;

  return {
    type: 'rook_pawn',
    attacker,
    pawn: pawn.square,
    pawnRelRank: pr,
    lucena,
    philidor,
    defenderKingCutOff: Math.max(0, defenderKingCutOff),
    rookBehindPawn,
  };
}
