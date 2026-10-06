import { randomUUID } from 'node:crypto';
import type { Db } from '../../db/index.js';
import { load } from '../../chess/detectors/board.js';
import { analyzePosition } from '../../chess/detectors/index.js';
import { classifyLoss, moveAccuracy, whitePovCp, winPercent, type EngineLine } from '../../chess/eval.js';
import { review } from '../../lib/srs.js';
import type { EngineClient } from '../engine/client.js';
import { getRating, recordResult, type StatKey } from '../profile/stats.js';
import { diagnose } from './diagnose.js';

// Analisi completa di una partita finita ("Learn from play"):
// motore su ogni posizione -> classificazione delle mosse -> diagnosi degli errori ->
// profilo (weakness_stats, mistakes) -> puzzle personali in ripasso.

const NODES = Number(process.env.ANALYSIS_NODES ?? 400_000);

interface Ply {
  ply: number;
  fenBefore: string;
  uci: string;
  san: string;
  byUser: boolean;
}

export class GameAnalyzer {
  constructor(
    private readonly db: Db,
    private readonly engine: EngineClient,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  async analyzeGame(gameId: string): Promise<void> {
    const game = await this.db.selectFrom('games').selectAll().where('id', '=', gameId).executeTakeFirst();
    if (!game) return;
    if (game.analysis_status === 'done') return;
    await this.db.updateTable('games').set({ analysis_status: 'running' }).where('id', '=', gameId).execute();
    try {
      await this.run(game);
      await this.db.updateTable('games').set({ analysis_status: 'done' }).where('id', '=', gameId).execute();
    } catch (err) {
      await this.db.updateTable('games').set({ analysis_status: 'failed' }).where('id', '=', gameId).execute();
      throw err;
    }
  }

  private async run(game: { id: string; user_id: string; start_fen: string; moves: string[]; user_color: 'white' | 'black' }) {
    const userWhite = game.user_color === 'white';
    const c = load(game.start_fen);
    const plies: Ply[] = [];
    for (const [i, uci] of game.moves.entries()) {
      const fenBefore = c.fen();
      const whiteMoves = c.turn() === 'w';
      const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      plies.push({ ply: i + 1, fenBefore, uci, san: m.san, byUser: whiteMoves === userWhite });
    }
    const finalFen = c.fen();
    const finalOver = c.isGameOver();

    // una analisi per posizione: la valutazione dopo la mossa i è quella prima della i+1
    const fens = [...plies.map((p) => p.fenBefore), finalFen];
    const lines: Array<EngineLine | null> = [];
    const bests: Array<string | null> = [];
    for (const [i, fen] of fens.entries()) {
      if (i === fens.length - 1 && finalOver) {
        lines.push(null);
        bests.push(null);
        continue;
      }
      const r = await this.engine.analyse(fen, { nodes: NODES, multipv: 1, priority: 'low' });
      lines.push(r.lines[0] ?? null);
      bests.push(r.bestmove);
    }
    const evalOf = (i: number): number => {
      const l = lines[i];
      if (l) return whitePovCp(l, fens[i]!.split(' ')[1] === 'w');
      // posizione finale senza analisi: matto o patta
      const fc = load(fens[i]!);
      if (fc.isCheckmate()) return fc.turn() === 'w' ? -10_000 : 10_000;
      return 0;
    };

    const userGlobal = (await getRating(this.db, game.user_id, 'global', 'all'))?.rating ?? 1500;
    const accuracies: number[] = [];
    const contextCounters = new Map<string, { key: StatKey; attempts: number; ok: number }>();
    let mistakesFound = 0;

    await this.db.deleteFrom('game_moves').where('game_id', '=', game.id).execute();
    await this.db.deleteFrom('mistakes').where('game_id', '=', game.id).execute();

    for (const [i, p] of plies.entries()) {
      const before = evalOf(i);
      const after = evalOf(i + 1);
      const moverWhite = p.fenBefore.split(' ')[1] === 'w';
      const sign = moverWhite ? 1 : -1;
      const loss = Math.max(0, winPercent(sign * before) - winPercent(sign * after));
      const best = bests[i] ?? null;
      const cls = classifyLoss(loss, best === p.uci);
      await this.db
        .insertInto('game_moves')
        .values({
          game_id: game.id,
          ply: p.ply,
          fen_before: p.fenBefore,
          uci: p.uci,
          san: p.san,
          by_user: p.byUser,
          eval_before: Math.round(before),
          eval_after: Math.round(after),
          best_uci: best,
          best_pv: lines[i]?.pv.slice(0, 8) ?? null,
          win_pct_loss: Math.round(loss * 10) / 10,
          classification: cls,
        })
        .execute();
      if (!p.byUser) continue;

      accuracies.push(moveAccuracy(loss));
      const bad = cls === 'mistake' || cls === 'blunder';

      // contesto della mossa: per le percentuali di successo su strutture e finali
      const facts = analyzePosition(p.fenBefore);
      const ctx: StatKey[] = [
        ...facts.tags.structures.map((s) => ({ dimension: 'structure', key: s })),
        ...(facts.endgameType ? [{ dimension: 'endgame_type', key: facts.endgameType }] : []),
      ];
      for (const k of ctx) {
        const id = `${k.dimension}:${k.key}`;
        const e = contextCounters.get(id) ?? { key: k, attempts: 0, ok: 0 };
        e.attempts++;
        if (!bad) e.ok++;
        contextCounters.set(id, e);
      }
      if (!bad) continue;

      mistakesFound++;
      const d = diagnose({
        fenBefore: p.fenBefore,
        played: p.uci,
        best,
        bestLine: lines[i] ?? null,
        replyLine: lines[i + 1] ?? null,
        ply: p.ply,
      });
      const puzzleId = await this.createOwnPuzzle(game.user_id, plies, i, best, lines[i] ?? null, d.motif, d.phase, userGlobal);
      await this.db
        .insertInto('mistakes')
        .values({
          user_id: game.user_id,
          game_id: game.id,
          ply: p.ply,
          fen: p.fenBefore,
          played_uci: p.uci,
          best_uci: best,
          phase: d.phase,
          category: d.category,
          motif: d.motif,
          structure: d.structure,
          eco: null,
          severity: cls,
          explanation: JSON.stringify({ reasons: d.reasons, winPctLoss: loss }) as never,
          puzzle_id: puzzleId,
        })
        .execute();

      await recordResult(this.db, game.user_id, [{ dimension: 'mistake', key: d.category }], false, null);
      // una tattica mancata in partita conta come un puzzle sbagliato del tema, al proprio livello
      const tacticalMotif = ['fork', 'pin', 'skewer', 'hangingPiece', 'mate'].includes(d.motif ?? '');
      if (tacticalMotif && d.category !== 'hanging_piece') {
        await recordResult(this.db, game.user_id, [{ dimension: 'theme', key: d.motif! }], false, {
          rating: userGlobal,
          rd: 150,
        });
      }
    }

    for (const e of contextCounters.values()) {
      await this.bumpContext(game.user_id, e.key, e.attempts, e.ok);
    }

    const accuracy = accuracies.length ? accuracies.reduce((a, b) => a + b, 0) / accuracies.length : null;
    await this.db.updateTable('games').set({ accuracy }).where('id', '=', game.id).execute();
    this.log(`partita ${game.id} analizzata: ${plies.length} semimosse, ${mistakesFound} errori`);
  }

  private async bumpContext(userId: string, key: StatKey, attempts: number, ok: number) {
    await this.db
      .insertInto('weakness_stats')
      .values({ user_id: userId, dimension: key.dimension, key: key.key, attempts, successes: ok })
      .onConflict((oc) =>
        oc.columns(['user_id', 'dimension', 'key']).doUpdateSet((eb) => ({
          attempts: eb('weakness_stats.attempts', '+', attempts),
          successes: eb('weakness_stats.successes', '+', ok),
          updated_at: new Date(),
        })),
      )
      .execute();
  }

  /**
   * Puzzle personale dall'errore: si parte dalla posizione prima della mossa avversaria
   * precedente (come i puzzle Lichess) e la soluzione è la linea migliore del motore.
   */
  private async createOwnPuzzle(
    userId: string,
    plies: Ply[],
    i: number,
    best: string | null,
    line: EngineLine | null,
    motif: string | null,
    phase: string,
    rating: number,
  ): Promise<string | null> {
    if (i === 0 || !best || !line) return null;
    const prev = plies[i - 1]!;
    const pv = line.pv[0] === best ? line.pv : [best];
    // soluzione: mossa avversaria, mossa migliore, e al massimo un altro scambio della linea
    const moves = [prev.uci, ...pv.slice(0, pv.length >= 3 ? 3 : 1)];
    const id = `own:${randomUUID()}`;
    await this.db
      .insertInto('puzzles')
      .values({
        id,
        fen: prev.fenBefore,
        moves,
        rating: Math.round(rating),
        rating_dev: 200,
        popularity: null,
        nb_plays: 0,
        themes: [...(motif && !['rook', 'pawn', 'minor', 'queen', 'mixed', 'rook_pawn'].includes(motif) ? [motif] : []), phase],
        opening_tags: null,
        game_url: null,
        source: 'own_game',
      })
      .execute();
    // subito disponibile in ripasso
    const card = { ...review(null, false), due_at: new Date() };
    await this.db
      .insertInto('srs_cards')
      .values({ user_id: userId, item_type: 'puzzle', item_id: id, ...card })
      .onConflict((oc) => oc.doNothing())
      .execute();
    return id;
  }
}
