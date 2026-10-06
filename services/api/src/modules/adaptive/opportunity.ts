import type { Color } from 'chess.js';
import { load, other, VALUE } from '../../chess/detectors/board.js';
import { forks, hangingPieces, matesInOne, pins, skewers } from '../../chess/detectors/tactics.js';

// Livello C della modalità adattiva: dato un motivo tattico, quali mosse dell'utente lo
// realizzano nella posizione? Serve sia per scegliere la mossa "didattica" del computer
// sia per verificare se l'utente ha colto l'occasione.

export const SUPPORTED_MOTIFS = ['fork', 'pin', 'skewer', 'hangingPiece', 'mate'] as const;
export type Motif = (typeof SUPPORTED_MOTIFS)[number];

export function normalizeMotif(key: string): Motif | null {
  if (key === 'mateIn1' || key === 'mateIn2' || key === 'backRankMate' || key === 'mate') return 'mate';
  return (SUPPORTED_MOTIFS as readonly string[]).includes(key) ? (key as Motif) : null;
}

const uciOf = (m: { from: string; to: string; promotion?: string }) => m.from + m.to + (m.promotion ?? '');

/** Mosse del lato al tratto che realizzano il motivo. */
export function opportunityMoves(fen: string, motif: Motif): string[] {
  const c = load(fen);
  const me: Color = c.turn();
  const opp = other(me);
  if (motif === 'mate') return matesInOne(fen);

  if (motif === 'hangingPiece') {
    const targets = new Map(hangingPieces(c, opp).map((h) => [h.piece.square as string, VALUE[h.piece.type]]));
    return c
      .moves({ verbose: true })
      .filter((m) => m.captured && targets.has(m.to) && (targets.get(m.to)! >= 3))
      .map(uciOf);
  }

  const out: string[] = [];
  for (const m of c.moves({ verbose: true })) {
    c.move(m);
    const dest = m.to;
    // il pezzo che crea il motivo non deve essere semplicemente perso
    const safe = !hangingPieces(c, me).some((h) => h.piece.square === dest);
    let hit = false;
    if (motif === 'fork') {
      hit = forks(c, me).some(
        (f) => f.attacker.square === dest && f.targets.some((t) => t.type === 'k' || t.type === 'q' || VALUE[t.type] > VALUE[f.attacker.type]),
      );
    } else if (motif === 'pin') {
      hit = pins(c, opp).some((p) => p.by.square === dest && (p.absolute || VALUE[p.front.type] >= 3));
    } else if (motif === 'skewer') {
      hit = skewers(c, opp).some((s) => s.by.square === dest);
    }
    c.undo();
    if (hit && safe) out.push(uciOf(m));
  }
  return out;
}
