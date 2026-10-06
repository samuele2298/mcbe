import type { Chess, Color, Square } from 'chess.js';
import { fileOf, FILES, pieces, rankOf } from './board.js';

export interface PawnInfo {
  isolated: Square[];
  doubled: Square[];
  passed: Square[];
  islands: number;
}

export type StructureKey =
  | 'iqp'
  | 'hanging_pawns'
  | 'carlsbad'
  | 'maroczy'
  | 'french'
  | 'kings_indian'
  | 'stonewall'
  | 'open_center'
  | 'closed_center';

export interface Structure {
  key: StructureKey;
  /** lato che "possiede" la struttura (es. chi ha l'IQP), se ha senso */
  side: Color | null;
}

function pawnSquares(chess: Chess, color: Color): Square[] {
  return pieces(chess, color)
    .filter((p) => p.type === 'p')
    .map((p) => p.square);
}

const has = (list: Square[], s: string) => list.includes(s as Square);
const onFile = (list: Square[], f: number) => list.filter((s) => fileOf(s) === f);

export function pawnInfo(chess: Chess, color: Color): PawnInfo {
  const own = pawnSquares(chess, color);
  const enemy = pawnSquares(chess, color === 'w' ? 'b' : 'w');
  const isolated = own.filter((s) => {
    const f = fileOf(s);
    return onFile(own, f - 1).length === 0 && onFile(own, f + 1).length === 0;
  });
  const doubled = own.filter((s) => onFile(own, fileOf(s)).length > 1);
  const passed = own.filter((s) => {
    const f = fileOf(s);
    const r = rankOf(s);
    return !enemy.some(
      (e) => Math.abs(fileOf(e) - f) <= 1 && (color === 'w' ? rankOf(e) > r : rankOf(e) < r),
    );
  });
  let islands = 0;
  let inIsland = false;
  for (let f = 0; f < 8; f++) {
    const present = onFile(own, f).length > 0;
    if (present && !inIsland) islands++;
    inIsland = present;
  }
  return { isolated, doubled, passed, islands };
}

/** Riconosce le strutture pedonali tipiche (anche più di una). */
export function classifyStructure(chess: Chess): Structure[] {
  const w = pawnSquares(chess, 'w');
  const b = pawnSquares(chess, 'b');
  const out: Structure[] = [];
  const file = (list: Square[], f: string) => onFile(list, FILES.indexOf(f));

  // IQP: pedone d isolato (senza pedoni c ed e dello stesso colore); ha senso solo con
  // abbastanza pedoni sulla scacchiera, non nei finali con un pedone solo
  for (const [side, own] of [['w', w], ['b', b]] as const) {
    if (own.length < 4) continue;
    if (file(own, 'd').length === 1 && !file(own, 'c').length && !file(own, 'e').length) {
      out.push({ key: 'iqp', side });
    }
    // pedoni sospesi: c e d affiancati, senza pedoni b ed e
    const c = file(own, 'c')[0];
    const d = file(own, 'd')[0];
    if (c && d && rankOf(c) === rankOf(d) && !file(own, 'b').length && !file(own, 'e').length) {
      out.push({ key: 'hanging_pawns', side });
    }
  }

  // Carlsbad: Bianco d4 senza pedone c (con pedone b), Nero c6+d5 senza pedone e (o speculare)
  if (has(w, 'd4') && !file(w, 'c').length && file(w, 'b').length && has(b, 'c6') && has(b, 'd5') && !file(b, 'e').length) {
    out.push({ key: 'carlsbad', side: 'w' });
  }
  if (has(b, 'd5') && !file(b, 'c').length && file(b, 'b').length && has(w, 'c3') && has(w, 'd4') && !file(w, 'e').length) {
    out.push({ key: 'carlsbad', side: 'b' });
  }

  // Maroczy: Bianco c4+e4 senza pedone d, Nero senza pedone c
  if (has(w, 'c4') && has(w, 'e4') && !file(w, 'd').length && !file(b, 'c').length) {
    out.push({ key: 'maroczy', side: 'w' });
  }
  if (has(b, 'c5') && has(b, 'e5') && !file(b, 'd').length && !file(w, 'c').length) {
    out.push({ key: 'maroczy', side: 'b' });
  }

  // catene centrali
  if (has(w, 'e5') && has(w, 'd4') && has(b, 'e6') && has(b, 'd5')) out.push({ key: 'french', side: null });
  if (has(w, 'd5') && has(w, 'e4') && has(b, 'd6') && has(b, 'e5')) out.push({ key: 'kings_indian', side: null });

  // Stonewall
  if (has(w, 'd4') && has(w, 'e3') && has(w, 'f4') && has(w, 'c3')) out.push({ key: 'stonewall', side: 'w' });
  if (has(b, 'd5') && has(b, 'e6') && has(b, 'f5') && has(b, 'c6')) out.push({ key: 'stonewall', side: 'b' });

  // centro aperto / chiuso
  const central = [...file(w, 'd'), ...file(w, 'e'), ...file(b, 'd'), ...file(b, 'e')].length;
  const blocked = [...file(w, 'd'), ...file(w, 'e')].filter((s) =>
    has(b, `${s[0]}${Number(s[1]) + 1}`),
  ).length;
  if (central <= 1 && w.length + b.length >= 8) out.push({ key: 'open_center', side: null });
  else if (blocked >= 2 && !out.some((s) => s.key === 'french' || s.key === 'kings_indian')) {
    out.push({ key: 'closed_center', side: null });
  }
  return out;
}

export interface FileInfo {
  open: string[];
  halfOpen: { w: string[]; b: string[] };
}

export function files(chess: Chess): FileInfo {
  const w = pawnSquares(chess, 'w');
  const b = pawnSquares(chess, 'b');
  const open: string[] = [];
  const halfOpen = { w: [] as string[], b: [] as string[] };
  for (let f = 0; f < 8; f++) {
    const hw = onFile(w, f).length > 0;
    const hb = onFile(b, f).length > 0;
    if (!hw && !hb) open.push(FILES[f]!);
    else if (!hw) halfOpen.w.push(FILES[f]!);
    else if (!hb) halfOpen.b.push(FILES[f]!);
  }
  return { open, halfOpen };
}
