import { classifyLoss, whitePovCp, winPercent, type EngineLine, type MoveClass } from '../../chess/eval.js';
import { load } from '../../chess/detectors/board.js';
import type { EngineClient } from '../engine/client.js';

// Valutazione di una singola mossa: motore prima e dopo, perdita di probabilità di vittoria.

export interface MoveEvaluation {
  evalBefore: number;
  evalAfter: number;
  winPctLoss: number;
  classification: MoveClass;
  bestUci: string | null;
  bestLine: EngineLine | null;
  replyLine: EngineLine | null;
}

export function fenAfter(fen: string, uci: string): string {
  const c = load(fen);
  c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  return c.fen();
}

export async function evaluateMove(
  engine: EngineClient,
  fenBefore: string,
  uci: string,
  opts: { depth?: number; nodes?: number; priority?: 'high' | 'low' } = {},
): Promise<MoveEvaluation> {
  const limits = opts.depth || opts.nodes ? opts : { depth: 14 };
  const whiteToMove = fenBefore.split(' ')[1] === 'w';
  const before = await engine.analyse(fenBefore, { ...limits, multipv: 1 });
  const after = fenAfter(fenBefore, uci);
  const afterChess = load(after);
  const bestLine = before.lines[0] ?? null;
  const evalBefore = bestLine ? whitePovCp(bestLine, whiteToMove) : 0;

  let evalAfter: number;
  let replyLine: EngineLine | null = null;
  if (afterChess.isCheckmate()) {
    evalAfter = whiteToMove ? 10_000 : -10_000;
  } else if (afterChess.isDraw() || afterChess.isStalemate()) {
    evalAfter = 0;
  } else {
    const r = await engine.analyse(after, { ...limits, multipv: 1 });
    replyLine = r.lines[0] ?? null;
    evalAfter = replyLine ? whitePovCp(replyLine, !whiteToMove) : evalBefore;
  }

  const sign = whiteToMove ? 1 : -1;
  const winPctLoss = Math.max(0, winPercent(sign * evalBefore) - winPercent(sign * evalAfter));
  const bestUci = before.bestmove;
  const isBest = bestUci === uci;
  return {
    evalBefore,
    evalAfter,
    winPctLoss,
    classification: classifyLoss(winPctLoss, isBest),
    bestUci,
    bestLine,
    replyLine,
  };
}
