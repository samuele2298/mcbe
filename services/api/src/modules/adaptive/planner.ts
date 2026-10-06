import { sql } from 'kysely';
import type { Db } from '../../db/index.js';
import { load } from '../../chess/detectors/board.js';
import { themeLabel } from '../../chess/themes.js';
import { labelFor } from '../profile/labels.js';
import { normalizeMotif, type Motif } from './opportunity.js';

// Modalità adattiva (SPEC 8.4): sceglie su quale debolezza lavorare e come.
//  A: partenza da una posizione reale (puzzle Lichess) del tema o finale debole
//  B: apertura che porta alla struttura pedonale debole
//  C: durante la partita il computer concede occasioni nel motivo tattico debole

export interface AdaptivePlan {
  target: string;
  targetLabel: string;
  level: 'A' | 'B' | 'C';
  startFen: string | null;
  /** mosse dalla posizione iniziale per arrivare alla struttura (livello B) */
  openingMoves: string[] | null;
  motif: Motif | null;
  description: string;
}

/** Linee d'apertura che portano alle strutture tipiche (verificate con chess.js al momento dell'uso). */
const STRUCTURE_LINES: Record<string, { name: string; san: string }> = {
  carlsbad: { name: 'Gambetto di donna rifiutato, variante di cambio', san: 'd4 d5 c4 e6 Nc3 Nf6 cxd5 exd5 Bg5 c6 e3 Be7' },
  iqp: { name: 'Gambetto di donna, difesa Tarrasch', san: 'd4 d5 c4 e6 Nc3 c5 cxd5 exd5 Nf3 Nc6 g3 Nf6 Bg2 Be7 O-O O-O' },
  hanging_pawns: { name: 'Gambetto di donna rifiutato, Tartakower', san: 'd4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 h6 Bh4 b6 cxd5 Nxd5 Bxe7 Qxe7 Nxd5 exd5 Rc1 Be6' },
  french: { name: 'Difesa francese, variante di spinta', san: 'e4 e6 d4 d5 e5 c5 c3 Nc6 Nf3 Qb6' },
  kings_indian: { name: 'Est-Indiana classica', san: 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 d5 Ne7' },
  maroczy: { name: 'Siciliana dragone accelerato, Maroczy', san: 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6 c4 Bg7 Be3 Nf6 Nc3 O-O' },
  stonewall: { name: 'Olandese Stonewall', san: 'd4 f5 c4 Nf6 g3 e6 Bg2 d5 Nf3 c6 O-O Bd6' },
  closed_center: { name: 'Difesa francese, variante di spinta', san: 'e4 e6 d4 d5 e5 c5 c3 Nc6 Nf3 Qb6' },
  open_center: { name: 'Partita scozzese', san: 'e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nxc6 bxc6 e5 Qe7' },
};

const ENDGAME_THEMES: Record<string, string> = {
  rook: 'rookEndgame',
  rook_pawn: 'rookEndgame',
  pawn: 'pawnEndgame',
  minor: 'bishopEndgame',
  queen: 'queenEndgame',
  mixed: 'endgame',
};

export function sanLineToUci(san: string): string[] | null {
  const c = load('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const out: string[] = [];
  for (const s of san.split(/\s+/)) {
    try {
      const m = c.move(s);
      out.push(m.from + m.to + (m.promotion ?? ''));
    } catch {
      return null;
    }
  }
  return out;
}

interface Weak {
  dimension: string;
  key: string;
}

async function pickWeakness(db: Db, userId: string): Promise<Weak | null> {
  const global = await db
    .selectFrom('weakness_stats')
    .select('rating')
    .where('user_id', '=', userId)
    .where('dimension', '=', 'global')
    .executeTakeFirst();
  const base = global?.rating ?? 1500;
  const rows = await db
    .selectFrom('weakness_stats')
    .select(['dimension', 'key', 'rating', 'rd', 'attempts', 'successes'])
    .where('user_id', '=', userId)
    .where('dimension', 'in', ['theme', 'structure', 'endgame_type', 'mistake'])
    .where('attempts', '>=', 3)
    .execute();
  const scored = rows
    .map((r) => {
      const rate = r.successes / Math.max(1, r.attempts);
      // gravità: rating sotto il proprio livello e/o bassa percentuale di riuscita
      const sev =
        r.dimension === 'mistake'
          ? r.attempts * 20
          : r.dimension === 'theme'
            ? (base - r.rating) * (r.rd < 150 ? 1 : 0.6)
            : (1 - rate) * 300;
      return { ...r, sev };
    })
    .filter((r) => r.sev > 0)
    .sort((a, b) => b.sev - a.sev);
  // un po' di varietà tra le tre debolezze principali
  const top = scored.slice(0, 3);
  return top.length ? top[Math.floor(Math.random() * top.length)]! : null;
}

async function puzzleStart(db: Db, theme: string, rating: number): Promise<string | null> {
  for (const band of [150, 400, 1000]) {
    const row = await db
      .selectFrom('puzzles')
      .select(['fen', 'moves'])
      .where('source', '=', 'lichess')
      .where(sql<boolean>`themes @> ARRAY[${theme}]::text[]`)
      .where('rating', '>=', rating - band)
      .where('rating', '<=', rating + band)
      .where('rnd', '>=', Math.random() * 0.9)
      .orderBy('rnd')
      .limit(1)
      .executeTakeFirst();
    if (row) {
      // posizione dopo la mossa avversaria: tocca all'utente, con il tema "in aria"
      const c = load(row.fen);
      const m = row.moves[0]!;
      c.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
      return c.fen();
    }
  }
  return null;
}

async function mostFrequentMotif(db: Db, userId: string, category: string): Promise<Motif | null> {
  const row = await db
    .selectFrom('mistakes')
    .select(['motif', (eb) => eb.fn.countAll<string>().as('n')])
    .where('user_id', '=', userId)
    .where('category', '=', category)
    .where('motif', 'is not', null)
    .groupBy('motif')
    .orderBy('n', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row?.motif ? normalizeMotif(row.motif) : null;
}

export async function planAdaptive(db: Db, userId: string, rating: number, forced?: { dimension: string; key: string }): Promise<AdaptivePlan> {
  const w = forced ?? (await pickWeakness(db, userId));
  if (!w) {
    return {
      target: 'theme:fork',
      targetLabel: 'Forchetta',
      level: 'C',
      startFen: null,
      openingMoves: null,
      motif: 'fork',
      description: 'Ancora pochi dati sul tuo profilo: il computer ti concederà qualche occasione di forchetta.',
    };
  }
  const target = `${w.dimension}:${w.key}`;

  if (w.dimension === 'structure' && STRUCTURE_LINES[w.key]) {
    const line = STRUCTURE_LINES[w.key]!;
    const moves = sanLineToUci(line.san);
    if (moves) {
      return {
        target,
        targetLabel: labelFor('structure', w.key),
        level: 'B',
        startFen: null,
        openingMoves: moves,
        motif: null,
        description: `Partita dalla ${line.name}: ti alleni nella struttura ${labelFor('structure', w.key)}.`,
      };
    }
  }

  if (w.dimension === 'endgame_type' || (w.dimension === 'mistake' && w.key === 'endgame_technique')) {
    const theme = w.dimension === 'endgame_type' ? (ENDGAME_THEMES[w.key] ?? 'endgame') : 'endgame';
    const fen = await puzzleStart(db, theme, rating);
    return {
      target,
      targetLabel: w.dimension === 'endgame_type' ? labelFor('endgame_type', w.key) : labelFor('mistake', w.key),
      level: 'A',
      startFen: fen,
      openingMoves: null,
      motif: null,
      description: 'Partenza da un finale reale del tipo in cui sbagli più spesso: portalo a termine contro il computer.',
    };
  }

  let motif: Motif | null = null;
  let theme: string | null = null;
  let label = '';
  if (w.dimension === 'theme') {
    motif = normalizeMotif(w.key);
    theme = w.key;
    label = themeLabel(w.key);
  } else if (w.dimension === 'mistake') {
    label = labelFor('mistake', w.key);
    motif =
      w.key === 'hanging_piece'
        ? 'hangingPiece'
        : w.key === 'missed_mate'
          ? 'mate'
          : await mostFrequentMotif(db, userId, w.key);
    theme = motif;
  }

  if (theme && ['rookEndgame', 'pawnEndgame', 'bishopEndgame', 'knightEndgame', 'queenEndgame', 'endgame'].includes(theme)) {
    return {
      target,
      targetLabel: label,
      level: 'A',
      startFen: await puzzleStart(db, theme, rating),
      openingMoves: null,
      motif: null,
      description: `Partenza da un finale reale: ${label}.`,
    };
  }

  // tema tattico: partenza da una posizione con il tema (A) e, se supportato, occasioni in partita (C)
  const startFen = theme ? await puzzleStart(db, theme, rating) : null;
  return {
    target,
    targetLabel: label,
    level: motif ? 'C' : 'A',
    startFen,
    openingMoves: null,
    motif,
    description: motif
      ? `Si parte da una posizione con il tema "${label}"; durante la partita il computer ti lascerà altre occasioni dello stesso tipo.`
      : `Si parte da una posizione reale con il tema "${label}".`,
  };
}
