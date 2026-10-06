import type { Chess, Color, Square } from 'chess.js';
import {
  attackersOf,
  attacksFrom,
  cheapest,
  fileOf,
  flipTurn,
  load,
  onBoard,
  other,
  pieces,
  rankOf,
  slideDirs,
  sq,
  VALUE,
  type BoardPiece,
} from './board.js';

export interface Hanging {
  piece: BoardPiece;
  /** 'undefended' = nessun difensore; 'cheaper_attacker' = attaccato da un pezzo di valore minore */
  reason: 'undefended' | 'cheaper_attacker';
  attackers: Square[];
}

/** Pezzi di `color` che si possono catturare con guadagno. */
export function hangingPieces(chess: Chess, color: Color): Hanging[] {
  const out: Hanging[] = [];
  for (const p of pieces(chess, color)) {
    if (p.type === 'k') continue;
    const attackers = attackersOf(chess, p.square, other(color));
    if (!attackers.length) continue;
    const defenders = attackersOf(chess, p.square, color);
    const low = cheapest(attackers)!;
    if (!defenders.length) {
      out.push({ piece: p, reason: 'undefended', attackers: attackers.map((a) => a.square) });
    } else if (VALUE[low.type] < VALUE[p.type]) {
      out.push({ piece: p, reason: 'cheaper_attacker', attackers: attackers.map((a) => a.square) });
    }
  }
  return out;
}

export interface Fork {
  attacker: BoardPiece;
  targets: BoardPiece[];
}

/** Forchette di `color`: un pezzo che attacca almeno due bersagli che valgono la pena. */
export function forks(chess: Chess, color: Color): Fork[] {
  const out: Fork[] = [];
  const enemy = pieces(chess, other(color));
  for (const p of pieces(chess, color)) {
    if (p.type === 'k') continue;
    const attacked = new Set(attacksFrom(chess, p));
    const targets = enemy.filter((e) => {
      if (!attacked.has(e.square)) return false;
      if (e.type === 'k') return true;
      if (VALUE[e.type] > VALUE[p.type]) return true;
      return attackersOf(chess, e.square, other(color)).length === 0 && e.type !== 'p';
    });
    if (targets.length >= 2) out.push({ attacker: p, targets });
  }
  return out;
}

export interface LineTactic {
  /** pezzo a lungo raggio che crea il motivo */
  by: BoardPiece;
  /** primo pezzo sulla linea */
  front: BoardPiece;
  /** pezzo dietro */
  behind: BoardPiece;
  absolute: boolean;
}

function lineTactics(chess: Chess, victim: Color) {
  const pins: LineTactic[] = [];
  const skewers: LineTactic[] = [];
  for (const s of pieces(chess, other(victim))) {
    for (const [df, dr] of slideDirs(s.type)) {
      let x = fileOf(s.square) + df;
      let y = rankOf(s.square) + dr;
      let front: BoardPiece | null = null;
      while (onBoard(x, y)) {
        const at = chess.get(sq(x, y));
        if (at) {
          const bp: BoardPiece = { square: sq(x, y), type: at.type, color: at.color };
          if (bp.color !== victim) break;
          if (!front) {
            front = bp;
          } else {
            if (front.type !== 'k' && (bp.type === 'k' || VALUE[bp.type] > VALUE[front.type])) {
              pins.push({ by: s, front, behind: bp, absolute: bp.type === 'k' });
            } else if (
              (front.type === 'k' || VALUE[front.type] > VALUE[bp.type]) &&
              (front.type === 'k' || VALUE[front.type] >= VALUE.r) &&
              bp.type !== 'p' &&
              VALUE[s.type] < VALUE[front.type]
            ) {
              skewers.push({ by: s, front, behind: bp, absolute: front.type === 'k' });
            }
            break;
          }
        }
        x += df;
        y += dr;
      }
    }
  }
  return { pins, skewers };
}

/** Inchiodature subite da `victim`. */
export function pins(chess: Chess, victim: Color): LineTactic[] {
  return lineTactics(chess, victim).pins;
}

/** Infilate subite da `victim` (pezzo di valore davanti, altro pezzo dietro). */
export function skewers(chess: Chess, victim: Color): LineTactic[] {
  return lineTactics(chess, victim).skewers;
}

/** Traversa debole: re sulla prima traversa senza case di fuga e avversario con pezzi pesanti. */
export function backRankWeak(chess: Chess, color: Color): boolean {
  const king = pieces(chess, color).find((p) => p.type === 'k');
  if (!king) return false;
  const back = color === 'w' ? 0 : 7;
  if (rankOf(king.square) !== back) return false;
  const enemyHeavy = pieces(chess, other(color)).some((p) => p.type === 'r' || p.type === 'q');
  if (!enemyHeavy) return false;
  const fwd = color === 'w' ? 1 : -1;
  const f = fileOf(king.square);
  for (const df of [-1, 0, 1]) {
    if (!onBoard(f + df, back + fwd)) continue;
    const s = sq(f + df, back + fwd);
    const occ = chess.get(s);
    if (occ && occ.color === color) continue;
    if (attackersOf(chess, s, other(color)).length) continue;
    return false;
  }
  return true;
}

/** Mosse che danno matto in una per il lato al tratto. */
export function matesInOne(fen: string): string[] {
  const chess = load(fen);
  const out: string[] = [];
  for (const m of chess.moves({ verbose: true })) {
    chess.move(m);
    if (chess.isCheckmate()) out.push(m.from + m.to + (m.promotion ?? ''));
    chess.undo();
  }
  return out;
}

/** Matti in una che `attacker` avrebbe se toccasse a lui (minaccia). */
export function mateThreats(fen: string, attacker: Color): string[] {
  const chess = load(fen);
  if (chess.turn() === attacker) return matesInOne(fen);
  if (chess.inCheck()) return [];
  return matesInOne(flipTurn(fen));
}
