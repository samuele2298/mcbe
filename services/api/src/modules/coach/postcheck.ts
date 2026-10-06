import { load } from '../../chess/detectors/board.js';

// Post-check (SPEC 9): ogni mossa citata dal coach deve appartenere alle linee del motore.

export interface LineInfo {
  /** mosse UCI della linea */
  pv: string[];
  /** SAN inglese e italiano per ogni semimossa */
  san: string[];
  sanIt: string[];
}

const IT: Record<string, string> = { K: 'R', Q: 'D', R: 'T', B: 'A', N: 'C' };

export function sanToItalian(san: string): string {
  return san.replace(/^[KQRBN]/, (p) => IT[p]!).replace(/=([QRBN])/, (_, p: string) => `=${IT[p]}`);
}

export function lineInfo(fen: string, pv: string[], max = 10): LineInfo {
  const c = load(fen);
  const san: string[] = [];
  const moves: string[] = [];
  for (const uci of pv.slice(0, max)) {
    try {
      san.push(c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san);
      moves.push(uci);
    } catch {
      break;
    }
  }
  return { pv: moves, san, sanIt: san.map(sanToItalian) };
}

// Mosse di pezzo in notazione inglese o italiana (Nf3, Cf3, Txe1, O-O); non le case semplici ("e5").
const MOVE_RE = /\b(?:[KQRBNCATD][a-h1-8]?x?[a-h][1-8](?:=[QRBNDTAC])?[+#]?|O-O(?:-O)?|0-0(?:-0)?)(?![\w])/g;

/** Mosse scritte nel testo che non compaiono in nessuna linea fornita. */
export function unknownMovesInText(text: string, lines: LineInfo[]): string[] {
  const allowed = new Set<string>();
  for (const l of lines) {
    for (const s of [...l.san, ...l.sanIt]) {
      allowed.add(s.replace(/[+#]$/, ''));
      if (s.startsWith('O-O')) allowed.add(s.replace(/O/g, '0').replace(/[+#]$/, ''));
    }
  }
  const found = text.match(MOVE_RE) ?? [];
  return [...new Set(found.map((m) => m.replace(/[+#]$/, '')).filter((m) => !allowed.has(m)))];
}
