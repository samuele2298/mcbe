import type { Color, Square } from 'chess.js';
import { load, other, VALUE } from '../../chess/detectors/board.js';
import { analyzePosition, type PositionFacts } from '../../chess/detectors/index.js';
import { forks, hangingPieces, mateThreats, pins, skewers } from '../../chess/detectors/tactics.js';
import type { EngineLine } from '../../chess/eval.js';

// Diagnosi deterministica di un errore: confronta la mossa giocata con la migliore usando
// i detector. Il risultato alimenta il profilo (mistakes / weakness_stats) e il coach.

export type MistakeCategory =
  | 'missed_mate'
  | 'missed_tactic'
  | 'hanging_piece'
  | 'allowed_tactic'
  | 'endgame_technique'
  | 'opening_deviation'
  | 'positional';

export interface Diagnosis {
  category: MistakeCategory;
  motif: string | null;
  phase: PositionFacts['phase'];
  structure: string | null;
  endgameType: string | null;
  /** frasi in italiano che giustificano la diagnosi (solo fatti dei detector) */
  reasons: string[];
}

function play(fen: string, uci: string): string | null {
  const c = load(fen);
  try {
    c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return c.fen();
  } catch {
    return null;
  }
}

const capturedValue = (fen: string, uci: string) => {
  const p = load(fen).get(uci.slice(2, 4) as Square);
  return p ? VALUE[p.type] : 0;
};

export function diagnose(input: {
  fenBefore: string;
  played: string;
  best: string | null;
  bestLine: EngineLine | null;
  replyLine: EngineLine | null;
  ply: number;
}): Diagnosis {
  const before = analyzePosition(input.fenBefore);
  const me: Color = before.sideToMove;
  const opp = other(me);
  const base = {
    phase: before.phase,
    structure: before.tags.structures[0] ?? null,
    endgameType: before.endgameType,
  };
  const reasons: string[] = [];

  // 1. matto mancato
  if (input.bestLine?.mate && input.bestLine.mate > 0) {
    reasons.push(`C'era un matto in ${input.bestLine.mate}.`);
    return { ...base, category: 'missed_mate', motif: 'mate', reasons };
  }

  const afterPlayed = play(input.fenBefore, input.played);
  const afterBest = input.best ? play(input.fenBefore, input.best) : null;

  // 2. pezzo lasciato in presa: la risposta migliore dell'avversario cattura un nostro pezzo indifeso
  if (afterPlayed) {
    const reply = input.replyLine?.pv[0];
    const hanging = hangingPieces(load(afterPlayed), me);
    if (reply && hanging.some((h) => h.piece.square === reply.slice(2, 4))) {
      const h = hanging.find((x) => x.piece.square === reply.slice(2, 4))!;
      reasons.push(`Dopo la mossa il pezzo in ${h.piece.square} resta ${h.reason === 'undefended' ? 'indifeso' : 'attaccato da un pezzo di valore minore'}.`);
      return { ...base, category: 'hanging_piece', motif: 'hangingPiece', reasons };
    }
    // 3. tattica concessa: minaccia di matto o forchetta/infilata disponibili per l'avversario
    const threats = mateThreats(afterPlayed, opp);
    if (threats.length) {
      reasons.push("La mossa permette all'avversario un matto in una.");
      return { ...base, category: 'allowed_tactic', motif: 'mate', reasons };
    }
    if (reply) {
      const afterReply = play(afterPlayed, reply);
      if (afterReply) {
        const c = load(afterReply);
        const target = reply.slice(2, 4);
        if (forks(c, opp).some((f) => f.attacker.square === target)) {
          reasons.push(`La risposta ${reply} crea una forchetta.`);
          return { ...base, category: 'allowed_tactic', motif: 'fork', reasons };
        }
        if (skewers(c, me).some((s) => s.by.square === target)) {
          reasons.push(`La risposta ${reply} crea un'infilata.`);
          return { ...base, category: 'allowed_tactic', motif: 'skewer', reasons };
        }
        if (pins(c, me).some((p) => p.by.square === target)) {
          reasons.push(`La risposta ${reply} crea un'inchiodatura.`);
          return { ...base, category: 'allowed_tactic', motif: 'pin', reasons };
        }
      }
    }
  }

  // 4. tattica mancata: la mossa migliore crea un motivo riconoscibile
  if (input.best && afterBest) {
    const c = load(afterBest);
    const dest = input.best.slice(2, 4);
    const gain = capturedValue(input.fenBefore, input.best);
    if (forks(c, me).some((f) => f.attacker.square === dest)) {
      reasons.push(`La mossa migliore ${input.best} creava una forchetta.`);
      return { ...base, category: 'missed_tactic', motif: 'fork', reasons };
    }
    if (pins(c, opp).some((p) => p.by.square === dest)) {
      reasons.push(`La mossa migliore ${input.best} creava un'inchiodatura.`);
      return { ...base, category: 'missed_tactic', motif: 'pin', reasons };
    }
    if (skewers(c, opp).some((s) => s.by.square === dest)) {
      reasons.push(`La mossa migliore ${input.best} creava un'infilata.`);
      return { ...base, category: 'missed_tactic', motif: 'skewer', reasons };
    }
    const hangingBefore = hangingPieces(load(input.fenBefore), opp);
    if (gain > 0 && hangingBefore.some((h) => h.piece.square === dest)) {
      reasons.push(`Il pezzo avversario in ${dest} era catturabile con guadagno.`);
      return { ...base, category: 'missed_tactic', motif: 'hangingPiece', reasons };
    }
  }

  // 5. finale, apertura, posizionale
  if (before.phase === 'endgame') {
    reasons.push(...before.summary.filter((s) => /finale|Lucena|Philidor|opposizione|quadrato|chiave/i.test(s)));
    return { ...base, category: 'endgame_technique', motif: before.endgameType, reasons };
  }
  if (before.phase === 'opening' && input.ply <= 20) {
    return { ...base, category: 'opening_deviation', motif: null, reasons };
  }
  return { ...base, category: 'positional', motif: null, reasons };
}
