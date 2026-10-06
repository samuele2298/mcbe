// Temi dei puzzle Lichess: a quale dimensione del profilo appartengono ed etichetta italiana.

export type ThemeDimension = 'theme' | 'phase' | 'meta';

interface ThemeInfo {
  label: string;
  group: 'tattica' | 'matto' | 'finale' | 'fase' | 'strategia' | 'meta';
}

export const THEMES: Record<string, ThemeInfo> = {
  // tattica
  fork: { label: 'Forchetta', group: 'tattica' },
  pin: { label: 'Inchiodatura', group: 'tattica' },
  skewer: { label: 'Infilata', group: 'tattica' },
  discoveredAttack: { label: 'Attacco di scoperta', group: 'tattica' },
  doubleCheck: { label: 'Scacco doppio', group: 'tattica' },
  hangingPiece: { label: 'Pezzo in presa', group: 'tattica' },
  trappedPiece: { label: 'Pezzo intrappolato', group: 'tattica' },
  deflection: { label: 'Deviazione', group: 'tattica' },
  attraction: { label: 'Adescamento', group: 'tattica' },
  clearance: { label: 'Sgombero', group: 'tattica' },
  interference: { label: 'Interferenza', group: 'tattica' },
  intermezzo: { label: 'Mossa intermedia', group: 'tattica' },
  capturingDefender: { label: 'Eliminazione del difensore', group: 'tattica' },
  xRayAttack: { label: 'Attacco a raggi X', group: 'tattica' },
  sacrifice: { label: 'Sacrificio', group: 'tattica' },
  quietMove: { label: 'Mossa tranquilla', group: 'tattica' },
  defensiveMove: { label: 'Mossa difensiva', group: 'tattica' },
  zugzwang: { label: 'Zugzwang', group: 'tattica' },
  advancedPawn: { label: 'Pedone avanzato', group: 'tattica' },
  promotion: { label: 'Promozione', group: 'tattica' },
  underPromotion: { label: 'Sottopromozione', group: 'tattica' },
  enPassant: { label: 'En passant', group: 'tattica' },
  castling: { label: 'Arrocco', group: 'tattica' },
  attackingF2F7: { label: 'Attacco a f2/f7', group: 'strategia' },
  exposedKing: { label: 'Re esposto', group: 'strategia' },
  kingsideAttack: { label: "Attacco sull'ala di re", group: 'strategia' },
  queensideAttack: { label: "Attacco sull'ala di donna", group: 'strategia' },
  // matti
  mate: { label: 'Matto', group: 'matto' },
  mateIn1: { label: 'Matto in 1', group: 'matto' },
  mateIn2: { label: 'Matto in 2', group: 'matto' },
  mateIn3: { label: 'Matto in 3', group: 'matto' },
  mateIn4: { label: 'Matto in 4', group: 'matto' },
  mateIn5: { label: 'Matto in 5+', group: 'matto' },
  backRankMate: { label: 'Matto sulla traversa', group: 'matto' },
  smotheredMate: { label: 'Matto affogato', group: 'matto' },
  anastasiaMate: { label: 'Matto di Anastasia', group: 'matto' },
  arabianMate: { label: 'Matto arabo', group: 'matto' },
  bodenMate: { label: 'Matto di Boden', group: 'matto' },
  doubleBishopMate: { label: 'Matto dei due alfieri', group: 'matto' },
  dovetailMate: { label: 'Matto a coda di rondine', group: 'matto' },
  hookMate: { label: 'Matto ad uncino', group: 'matto' },
  killBoxMate: { label: 'Matto a scatola', group: 'matto' },
  vukovicMate: { label: 'Matto di Vukovic', group: 'matto' },
  // finali
  pawnEndgame: { label: 'Finale di pedoni', group: 'finale' },
  rookEndgame: { label: 'Finale di torre', group: 'finale' },
  bishopEndgame: { label: "Finale d'alfiere", group: 'finale' },
  knightEndgame: { label: 'Finale di cavallo', group: 'finale' },
  queenEndgame: { label: 'Finale di donna', group: 'finale' },
  queenRookEndgame: { label: 'Finale di donna e torre', group: 'finale' },
  // fasi
  opening: { label: 'Apertura', group: 'fase' },
  middlegame: { label: 'Mediogioco', group: 'fase' },
  endgame: { label: 'Finale', group: 'fase' },
  // meta (lunghezza, esito, origine): non sono debolezze
  oneMove: { label: 'Una mossa', group: 'meta' },
  short: { label: 'Corto', group: 'meta' },
  long: { label: 'Lungo', group: 'meta' },
  veryLong: { label: 'Molto lungo', group: 'meta' },
  crushing: { label: 'Vantaggio decisivo', group: 'meta' },
  advantage: { label: 'Vantaggio', group: 'meta' },
  equality: { label: 'Parità', group: 'meta' },
  master: { label: 'Partita di maestri', group: 'meta' },
  masterVsMaster: { label: 'Maestro contro maestro', group: 'meta' },
  superGM: { label: 'Super GM', group: 'meta' },
};

const PHASES = new Set(['opening', 'middlegame', 'endgame']);

export function themeDimension(theme: string): ThemeDimension {
  if (PHASES.has(theme)) return 'phase';
  const info = THEMES[theme];
  if (!info || info.group === 'meta') return 'meta';
  return 'theme';
}

export function themeLabel(key: string): string {
  return THEMES[key]?.label ?? key;
}

/** Temi proposti di default in modalità "punti deboli" quando non ci sono ancora dati. */
export const CORE_THEMES = [
  'fork', 'pin', 'skewer', 'discoveredAttack', 'hangingPiece', 'deflection', 'attraction',
  'backRankMate', 'mateIn2', 'rookEndgame', 'pawnEndgame', 'trappedPiece', 'sacrifice',
];
