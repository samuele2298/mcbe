import type { Chess } from 'chess.js';
import type { Db } from '../../db/index.js';
import { load } from '../../chess/detectors/board.js';
import { whitePovCp } from '../../chess/eval.js';
import type { AdaptiveEvent } from '../../db/types.js';
import { opportunityMoves, type Motif } from '../adaptive/opportunity.js';
import { getRating, recordResult } from '../profile/stats.js';
import { diagnose, type Diagnosis } from '../analysis/diagnose.js';
import { evaluateMove, type MoveEvaluation } from '../analysis/move-eval.js';
import type { EngineClient } from '../engine/client.js';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export type GameMode = 'normal' | 'training' | 'adaptive';

export interface MoveFeedback {
  uci: string;
  san: string;
  classification: MoveEvaluation['classification'];
  winPctLoss: number;
  evalBefore: number;
  evalAfter: number;
  bestUci: string | null;
  bestSan: string | null;
  diagnosis: Diagnosis | null;
}

export interface GameState {
  id: string;
  startFen: string;
  fen: string;
  moves: string[];
  sans: string[];
  userColor: 'white' | 'black';
  mode: GameMode;
  opponentElo: number | null;
  result: string | null;
  termination: string | null;
  turn: 'white' | 'black';
  analysisStatus: string;
  adaptiveTarget: string | null;
  /** in allenamento, dopo un errore si aspetta la scelta dell'utente: riprovare o continuare */
  awaitingDecision: boolean;
}

export interface Opportunity {
  motif: string;
  found: boolean;
  expected: string[];
  expectedSan: string[];
}

export class GameError extends Error {
  constructor(public readonly code: 'not_found' | 'illegal_move' | 'not_your_turn' | 'game_over' | 'nothing_to_undo') {
    super(code);
  }
}

/** Movetime del computer in funzione dell'Elo (più forte = pensa di più). */
export function computerMovetime(elo: number | null): number {
  if (!elo) return 800;
  if (elo < 1200) return 100;
  if (elo < 1800) return 250;
  if (elo < 2400) return 500;
  return 900;
}

function replayGame(startFen: string, moves: string[]): Chess {
  const c = load(startFen);
  for (const m of moves) c.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
  return c;
}

function outcome(c: Chess): { result: string; termination: string } | null {
  if (c.isCheckmate()) return { result: c.turn() === 'w' ? '0-1' : '1-0', termination: 'checkmate' };
  if (c.isStalemate()) return { result: '1/2-1/2', termination: 'stalemate' };
  if (c.isInsufficientMaterial()) return { result: '1/2-1/2', termination: 'insufficient_material' };
  if (c.isThreefoldRepetition()) return { result: '1/2-1/2', termination: 'threefold_repetition' };
  if (c.isDraw()) return { result: '1/2-1/2', termination: 'fifty_moves' };
  return null;
}

type GameRow = {
  id: string;
  start_fen: string;
  moves: string[];
  user_color: 'white' | 'black';
  mode: GameMode;
  opponent_elo: number | null;
  result: string | null;
  termination: string | null;
  analysis_status: string;
  adaptive_target: string | null;
  adaptive_motif: string | null;
  adaptive_events: AdaptiveEvent[];
};

export class PlayService {
  /** partite in allenamento in attesa di decisione dopo un errore (in memoria: stato effimero) */
  private pending = new Set<string>();

  constructor(
    private readonly db: Db,
    private readonly engine: EngineClient,
    private readonly onFinished: (gameId: string) => Promise<void> = async () => {},
  ) {}

  private toState(g: GameRow): GameState {
    const c = replayGame(g.start_fen, g.moves);
    const sans = c.history();
    return {
      id: g.id,
      startFen: g.start_fen,
      fen: c.fen(),
      moves: g.moves,
      sans,
      userColor: g.user_color,
      mode: g.mode,
      opponentElo: g.opponent_elo,
      result: g.result,
      termination: g.termination,
      turn: c.turn() === 'w' ? 'white' : 'black',
      analysisStatus: g.analysis_status,
      adaptiveTarget: g.adaptive_target,
      awaitingDecision: this.pending.has(g.id),
    };
  }

  private async row(userId: string, id: string): Promise<GameRow> {
    const g = await this.db
      .selectFrom('games')
      .select(['id', 'start_fen', 'moves', 'user_color', 'mode', 'opponent_elo', 'result', 'termination', 'analysis_status', 'adaptive_target', 'adaptive_motif', 'adaptive_events'])
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .where('source', 'in', ['play', 'adaptive'])
      .executeTakeFirst();
    if (!g) throw new GameError('not_found');
    return g;
  }

  async get(userId: string, id: string): Promise<GameState> {
    return this.toState(await this.row(userId, id));
  }

  async start(
    userId: string,
    opts: {
      color: 'white' | 'black' | 'random';
      elo: number;
      mode: GameMode;
      startFen?: string;
      adaptiveTarget?: string;
      adaptiveMotif?: Motif | null;
      openingMoves?: string[];
    },
  ): Promise<GameState> {
    const startFen = opts.startFen ?? START_FEN;
    const startPos = load(startFen); // valida
    for (const m of opts.openingMoves ?? []) startPos.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
    // da una posizione "a metà" l'utente gioca il lato al tratto, salvo scelta esplicita
    const color =
      opts.color === 'random'
        ? opts.startFen && !opts.openingMoves?.length
          ? startPos.turn() === 'w' ? 'white' : 'black'
          : Math.random() < 0.5 ? 'white' : 'black'
        : opts.color;
    const g = await this.db
      .insertInto('games')
      .values({
        user_id: userId,
        source: opts.mode === 'adaptive' ? 'adaptive' : 'play',
        mode: opts.mode,
        start_fen: startFen,
        user_color: color,
        opponent_elo: opts.elo,
        opponent_name: `Stockfish ${opts.elo}`,
        adaptive_target: opts.adaptiveTarget ?? null,
        adaptive_motif: opts.adaptiveMotif ?? null,
        moves: opts.openingMoves ?? [],
      })
      .returning(['id', 'start_fen', 'moves', 'user_color', 'mode', 'opponent_elo', 'result', 'termination', 'analysis_status', 'adaptive_target', 'adaptive_motif', 'adaptive_events'])
      .executeTakeFirstOrThrow();
    const userIsWhite = color === 'white';
    const whiteToMove = startPos.turn() === 'w';
    if (userIsWhite !== whiteToMove) return this.computerMove(userId, g);
    return this.toState(g);
  }

  private async save(g: GameRow, moves: string[], c: Chess): Promise<GameRow> {
    const end = outcome(c);
    const updated = await this.db
      .updateTable('games')
      .set({
        moves,
        ...(end ? { result: end.result, termination: end.termination, finished_at: new Date() } : {}),
      })
      .where('id', '=', g.id)
      .returning(['id', 'start_fen', 'moves', 'user_color', 'mode', 'opponent_elo', 'result', 'termination', 'analysis_status', 'adaptive_target', 'adaptive_motif', 'adaptive_events'])
      .executeTakeFirstOrThrow();
    if (end) await this.finished(updated.id);
    return updated;
  }

  private async finished(id: string) {
    await this.db.updateTable('games').set({ analysis_status: 'queued' }).where('id', '=', id).execute();
    await this.onFinished(id);
  }

  private async computerMove(userId: string, g: GameRow): Promise<GameState> {
    const c = replayGame(g.start_fen, g.moves);
    if (outcome(c)) return this.toState(g);
    const didactic = g.mode === 'adaptive' && g.adaptive_motif ? await this.didacticMove(g, c.fen()) : null;
    const uci = didactic?.uci ?? (await this.engine.move(c.fen(), g.opponent_elo ?? undefined, computerMovetime(g.opponent_elo)));
    if (!uci) return this.toState(g);
    c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    if (didactic) {
      const events: AdaptiveEvent[] = [
        ...g.adaptive_events,
        { ply: g.moves.length + 2, motif: g.adaptive_motif!, expected: didactic.expected, found: null },
      ];
      await this.db.updateTable('games').set({ adaptive_events: JSON.stringify(events) }).where('id', '=', g.id).execute();
      g = { ...g, adaptive_events: events };
    }
    return this.toState(await this.save(g, [...g.moves, uci], c));
  }

  /**
   * Livello C: tra le mosse buone del computer (entro una tolleranza) ne sceglie una che lascia
   * all'utente un'occasione nel motivo debole. Non sempre: al massimo una ogni 8 semimosse.
   */
  private async didacticMove(g: GameRow, fen: string): Promise<{ uci: string; expected: string[] } | null> {
    const last = g.adaptive_events.at(-1)?.ply ?? 0;
    if (g.moves.length < 6 || g.moves.length + 2 - last < 8 || Math.random() > 0.6) return null;
    const whiteToMove = fen.split(' ')[1] === 'w';
    const an = await this.engine.analyse(fen, { depth: 12, multipv: 4 });
    if (!an.lines.length) return null;
    const score = (l: (typeof an.lines)[number]) => (whiteToMove ? 1 : -1) * whitePovCp(l, whiteToMove);
    const best = score(an.lines[0]!);
    // partita già decisa: niente regali
    if (Math.abs(best) > 400) return null;
    for (const l of an.lines) {
      const move = l.pv[0];
      if (!move || best - score(l) > 250) continue;
      const after = load(fen);
      after.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] });
      if (after.isGameOver()) continue;
      const expected = opportunityMoves(after.fen(), g.adaptive_motif as Motif);
      if (expected.length) return { uci: move, expected };
    }
    return null;
  }

  /** Verifica se la mossa dell'utente coglie l'occasione concessa (e aggiorna il profilo). */
  private async checkOpportunity(userId: string, g: GameRow, fenBefore: string, uci: string): Promise<Opportunity | null> {
    const idx = g.adaptive_events.findIndex((e) => e.found === null && e.ply === g.moves.length + 1);
    if (idx < 0) return null;
    const ev = g.adaptive_events[idx]!;
    const found = ev.expected.includes(uci);
    const events = g.adaptive_events.map((e, i) => (i === idx ? { ...e, found } : e));
    await this.db.updateTable('games').set({ adaptive_events: JSON.stringify(events) }).where('id', '=', g.id).execute();
    const rating = (await getRating(this.db, userId, 'global', 'all'))?.rating ?? 1500;
    await recordResult(this.db, userId, [{ dimension: 'theme', key: ev.motif }], found, { rating, rd: 150 });
    return {
      motif: ev.motif,
      found,
      expected: ev.expected,
      expectedSan: ev.expected.map((m) => sanOf(fenBefore, m) ?? m),
    };
  }

  async move(
    userId: string,
    id: string,
    uci: string,
  ): Promise<{ state: GameState; feedback: MoveFeedback | null; opportunity: Opportunity | null }> {
    const g = await this.row(userId, id);
    if (g.result) throw new GameError('game_over');
    if (this.pending.has(id)) throw new GameError('not_your_turn');
    const c = replayGame(g.start_fen, g.moves);
    if ((c.turn() === 'w') !== (g.user_color === 'white')) throw new GameError('not_your_turn');
    const fenBefore = c.fen();
    let san: string;
    try {
      san = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
    } catch {
      throw new GameError('illegal_move');
    }
    const played = c.history({ verbose: true }).at(-1)!;
    const normalized = played.from + played.to + (played.promotion ?? '');
    const opportunity = g.mode === 'adaptive' ? await this.checkOpportunity(userId, g, fenBefore, normalized) : null;

    let feedback: MoveFeedback | null = null;
    if (g.mode === 'training') {
      const ev = await evaluateMove(this.engine, fenBefore, normalized, { depth: 14 });
      const bad = ev.classification === 'mistake' || ev.classification === 'blunder';
      feedback = {
        uci: normalized,
        san,
        classification: ev.classification,
        winPctLoss: Math.round(ev.winPctLoss * 10) / 10,
        evalBefore: ev.evalBefore,
        evalAfter: ev.evalAfter,
        bestUci: ev.bestUci,
        bestSan: ev.bestUci ? sanOf(fenBefore, ev.bestUci) : null,
        diagnosis: bad
          ? diagnose({ fenBefore, played: normalized, best: ev.bestUci, bestLine: ev.bestLine, replyLine: ev.replyLine, ply: g.moves.length + 1 })
          : null,
      };
      if (bad) {
        const saved = await this.save(g, [...g.moves, normalized], c);
        if (!saved.result) this.pending.add(id);
        return { state: this.toState(saved), feedback, opportunity };
      }
    }

    const saved = await this.save(g, [...g.moves, normalized], c);
    if (saved.result) return { state: this.toState(saved), feedback, opportunity };
    return { state: await this.computerMove(userId, saved), feedback, opportunity };
  }

  /** Allenamento: ritira l'ultima mossa dell'utente (dopo un errore) per riprovare. */
  async takeback(userId: string, id: string): Promise<GameState> {
    const g = await this.row(userId, id);
    if (g.result) throw new GameError('game_over');
    const c = replayGame(g.start_fen, g.moves);
    const userTurn = (c.turn() === 'w') === (g.user_color === 'white');
    // se tocca all'utente si ritira anche la risposta del computer
    const drop = userTurn ? 2 : 1;
    if (g.moves.length < drop) throw new GameError('nothing_to_undo');
    this.pending.delete(id);
    const moves = g.moves.slice(0, -drop);
    const updated = await this.db
      .updateTable('games')
      .set({ moves })
      .where('id', '=', id)
      .returning(['id', 'start_fen', 'moves', 'user_color', 'mode', 'opponent_elo', 'result', 'termination', 'analysis_status', 'adaptive_target', 'adaptive_motif', 'adaptive_events'])
      .executeTakeFirstOrThrow();
    return this.toState(updated);
  }

  /** Allenamento: dopo un errore si accetta la mossa e il computer risponde. */
  async continueGame(userId: string, id: string): Promise<GameState> {
    const g = await this.row(userId, id);
    this.pending.delete(id);
    return this.computerMove(userId, g);
  }

  async resign(userId: string, id: string): Promise<GameState> {
    const g = await this.row(userId, id);
    if (g.result) throw new GameError('game_over');
    this.pending.delete(id);
    const updated = await this.db
      .updateTable('games')
      .set({ result: g.user_color === 'white' ? '0-1' : '1-0', termination: 'resign', finished_at: new Date() })
      .where('id', '=', id)
      .returning(['id', 'start_fen', 'moves', 'user_color', 'mode', 'opponent_elo', 'result', 'termination', 'analysis_status', 'adaptive_target', 'adaptive_motif', 'adaptive_events'])
      .executeTakeFirstOrThrow();
    if (updated.moves.length >= 4) await this.finished(id);
    return this.toState({ ...updated, analysis_status: updated.moves.length >= 4 ? 'queued' : updated.analysis_status });
  }
}

export function sanOf(fen: string, uci: string): string | null {
  try {
    return load(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return null;
  }
}
