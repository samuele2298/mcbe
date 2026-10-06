import type { Color } from 'chess.js';
import { colorName, load, NAME_IT, other, pieceLabel } from './board.js';
import { kpk, rookPawn, type EndgameFacts } from './endgame.js';
import { endgameType, material, materialSignature, phase, type EndgameType, type Material, type Phase } from './material.js';
import { classifyStructure, files, pawnInfo, type FileInfo, type PawnInfo, type Structure } from './pawns.js';
import {
  backRankWeak,
  forks,
  hangingPieces,
  mateThreats,
  matesInOne,
  pins,
  skewers,
  type Fork,
  type Hanging,
  type LineTactic,
} from './tactics.js';

// Tutti i fatti deterministici su una posizione. È lo "strato 2" della specifica:
// il coach può affermare solo cose che stanno qui, nel motore o nella knowledge base.

export interface PositionFacts {
  fen: string;
  sideToMove: Color;
  inCheck: boolean;
  phase: Phase;
  material: Material;
  signature: string;
  endgameType: EndgameType | null;
  pawns: { w: PawnInfo; b: PawnInfo };
  structures: Structure[];
  files: FileInfo;
  tactics: {
    hanging: { w: Hanging[]; b: Hanging[] };
    forks: { w: Fork[]; b: Fork[] };
    pins: { w: LineTactic[]; b: LineTactic[] };
    skewers: { w: LineTactic[]; b: LineTactic[] };
    backRankWeak: { w: boolean; b: boolean };
    matesInOne: string[];
    mateThreat: string[];
  };
  endgame: EndgameFacts | null;
  /** frasi brevi in italiano, una per fatto rilevante */
  summary: string[];
  /** chiavi per il retrieval e il profilo */
  tags: { structures: string[]; themes: string[]; phase: Phase; endgameType: EndgameType | null };
}

const STRUCTURE_IT: Record<string, string> = {
  iqp: 'pedone isolato di donna',
  hanging_pawns: 'pedoni sospesi',
  carlsbad: 'struttura Carlsbad',
  maroczy: 'Maroczy bind',
  french: 'catena di pedoni francese',
  kings_indian: 'catena di pedoni Est-Indiana',
  stonewall: 'Stonewall',
  open_center: 'centro aperto',
  closed_center: 'centro chiuso',
};

export function analyzePosition(fen: string): PositionFacts {
  const chess = load(fen);
  const stm = chess.turn();
  const mat = material(chess);
  const fullmove = Number(fen.split(' ')[5] ?? 1);
  const ph = phase(mat, fullmove);
  const egType = ph === 'endgame' ? endgameType(mat) : null;
  const structures = classifyStructure(chess);
  const pw = { w: pawnInfo(chess, 'w'), b: pawnInfo(chess, 'b') };
  const fi = files(chess);
  const tactics = {
    hanging: { w: hangingPieces(chess, 'w'), b: hangingPieces(chess, 'b') },
    forks: { w: forks(chess, 'w'), b: forks(chess, 'b') },
    pins: { w: pins(chess, 'w'), b: pins(chess, 'b') },
    skewers: { w: skewers(chess, 'w'), b: skewers(chess, 'b') },
    backRankWeak: { w: backRankWeak(chess, 'w'), b: backRankWeak(chess, 'b') },
    matesInOne: matesInOne(fen),
    mateThreat: mateThreats(fen, other(stm)),
  };
  const endgame = kpk(chess) ?? rookPawn(chess);

  const s: string[] = [];
  const themes = new Set<string>();
  if (mat.balance !== 0) {
    s.push(`Materiale: ${mat.balance > 0 ? 'Bianco' : 'Nero'} avanti di ${Math.abs(mat.balance)} (${materialSignature(mat)}).`);
  } else {
    s.push(`Materiale pari (${materialSignature(mat)}).`);
  }
  if (mat.bishopPair) s.push(`Il ${colorName(mat.bishopPair)} ha la coppia degli alfieri.`);
  for (const st of structures) {
    s.push(`Struttura: ${STRUCTURE_IT[st.key]}${st.side ? ` (${colorName(st.side)})` : ''}.`);
  }
  for (const c of ['w', 'b'] as const) {
    if (pw[c].passed.length) s.push(`Pedoni passati del ${colorName(c)}: ${pw[c].passed.join(', ')}.`);
    if (pw[c].isolated.length) s.push(`Pedoni isolati del ${colorName(c)}: ${pw[c].isolated.join(', ')}.`);
    if (pw[c].doubled.length) s.push(`Pedoni doppiati del ${colorName(c)}: ${pw[c].doubled.join(', ')}.`);
  }
  if (fi.open.length) s.push(`Colonne aperte: ${fi.open.join(', ')}.`);
  if (tactics.matesInOne.length) {
    s.push(`Il ${colorName(stm)} ha matto in una.`);
    themes.add('mateIn1');
  }
  if (tactics.mateThreat.length) {
    s.push(`Il ${colorName(other(stm))} minaccia matto in una.`);
    themes.add('mate');
  }
  for (const c of ['w', 'b'] as const) {
    for (const h of tactics.hanging[c]) {
      s.push(`Il ${pieceLabel(h.piece)} del ${colorName(c)} è ${h.reason === 'undefended' ? 'indifeso e attaccato' : 'attaccato da un pezzo di valore minore'}.`);
      themes.add('hangingPiece');
    }
    for (const f of tactics.forks[c]) {
      s.push(`Forchetta del ${colorName(c)}: ${pieceLabel(f.attacker)} attacca ${f.targets.map(pieceLabel).join(' e ')}.`);
      themes.add('fork');
    }
    for (const p of tactics.pins[c]) {
      s.push(`Inchiodatura${p.absolute ? ' assoluta' : ''}: il ${pieceLabel(p.front)} del ${colorName(c)} è inchiodato da ${NAME_IT[p.by.type]} in ${p.by.square} sul ${pieceLabel(p.behind)}.`);
      themes.add('pin');
    }
    for (const k of tactics.skewers[c]) {
      s.push(`Infilata: ${NAME_IT[k.by.type]} in ${k.by.square} attacca il ${pieceLabel(k.front)} del ${colorName(c)} con dietro il ${pieceLabel(k.behind)}.`);
      themes.add('skewer');
    }
    if (tactics.backRankWeak[c]) {
      s.push(`La traversa del ${colorName(c)} è debole (re senza case di fuga).`);
      themes.add('backRankMate');
    }
  }
  if (endgame?.type === 'kpk') {
    s.push(`Finale re e pedone contro re (pedone ${endgame.pawn}${endgame.rookPawn ? ', pedone di torre' : ''}).`);
    s.push(endgame.defenderInSquare
      ? 'Il re difensore è dentro il quadrato del pedone.'
      : 'Il re difensore è fuori dal quadrato: il pedone promuove da solo.');
    if (endgame.opposition) s.push(`Il ${colorName(endgame.opposition)} ha l'opposizione ${endgame.oppositionKind === 'direct' ? 'diretta' : 'a distanza'}.`);
    if (endgame.attackerOnKeySquare) s.push('Il re attaccante occupa una casa chiave del pedone.');
    themes.add('pawnEndgame');
  }
  if (endgame?.type === 'rook_pawn') {
    if (endgame.lucena) s.push('Posizione di Lucena: il lato forte vince costruendo il ponte.');
    if (endgame.philidor) s.push('Posizione di Philidor: il difensore tiene la patta con la torre sulla terza traversa.');
    if (endgame.defenderKingCutOff >= 1) s.push(`Il re difensore è tagliato fuori di ${endgame.defenderKingCutOff} colonna/e.`);
    if (endgame.rookBehindPawn) s.push('La torre attaccante è dietro il pedone passato.');
    themes.add('rookEndgame');
  }
  if (egType === 'rook') themes.add('rookEndgame');
  if (egType === 'pawn') themes.add('pawnEndgame');

  return {
    fen,
    sideToMove: stm,
    inCheck: chess.inCheck(),
    phase: ph,
    material: mat,
    signature: materialSignature(mat),
    endgameType: egType,
    pawns: pw,
    structures,
    files: fi,
    tactics,
    endgame,
    summary: s,
    tags: {
      structures: [...new Set(structures.map((x) => x.key))],
      themes: [...themes],
      phase: ph,
      endgameType: egType,
    },
  };
}
