import { sql } from 'kysely';
import type { Db } from '../../db/index.js';
import { toDto, type PuzzleDto, type PuzzleRow, type PuzzleService } from '../puzzles/service.js';

// Storm: batch di puzzle brevi a rating crescente, risolti tutti lato app. Zero token.

const STEPS = 20;
const PER_STEP = 5;
const START = 800;
const STEP_SIZE = 90;

export interface StormResult {
  puzzleId: string;
  solved: boolean;
  timeMs?: number;
}

export class StormService {
  constructor(
    private readonly db: Db,
    private readonly puzzles: PuzzleService,
  ) {}

  async start(userId: string): Promise<{ runId: string; puzzles: PuzzleDto[] }> {
    // Un rating esatto casuale per ogni slot: con l'indice (rating, rnd) ogni lookup è
    // un singolo accesso all'indice, invece di ordinare un'intera fascia di rating.
    const rows = await sql<PuzzleRow>`
      SELECT p.id, p.fen, p.moves, p.rating, p.themes, p.opening_tags, p.source
      FROM (
        SELECT g, ${START} + (g / ${PER_STEP}) * ${STEP_SIZE} + floor(random() * ${STEP_SIZE})::int AS r,
               random() * 0.95 AS x
        FROM generate_series(0, ${STEPS * PER_STEP - 1}) AS g
      ) t
      CROSS JOIN LATERAL (
        SELECT * FROM puzzles
        WHERE rating = t.r AND rnd >= t.x AND cardinality(moves) <= 4 AND source = 'lichess'
        ORDER BY rnd
        LIMIT 1
      ) p
      ORDER BY p.rating`.execute(this.db);
    const seen = new Set<string>();
    const batch = rows.rows.filter((r) => !seen.has(r.id) && seen.add(r.id)).map(toDto);
    const run = await this.db
      .insertInto('storm_runs')
      .values({ user_id: userId, puzzle_ids: batch.map((p) => p.id) })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { runId: String(run.id), puzzles: batch };
  }

  async finish(
    userId: string,
    runId: string,
    input: { results: StormResult[]; durationS: number; bestCombo: number },
  ): Promise<{ score: number; best: number; rank: number } | null> {
    const run = await this.db
      .selectFrom('storm_runs')
      .select(['id', 'puzzle_ids', 'finished_at'])
      .where('id', '=', runId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!run || run.finished_at) return null;

    // solo i puzzle che appartengono davvero alla run
    const allowed = new Set(run.puzzle_ids);
    const results = input.results.filter((r) => allowed.has(r.puzzleId));
    const solved = results.filter((r) => r.solved).length;
    const errors = results.length - solved;

    await this.db
      .updateTable('storm_runs')
      .set({
        score: solved,
        solved,
        errors,
        best_combo: input.bestCombo,
        duration_s: input.durationS,
        finished_at: new Date(),
      })
      .where('id', '=', runId)
      .execute();

    if (results.length) {
      await this.db
        .insertInto('puzzle_attempts')
        .values(
          results.map((r) => ({
            user_id: userId,
            puzzle_id: r.puzzleId,
            solved: r.solved,
            time_ms: r.timeMs ?? null,
            mode: 'storm' as const,
            rating_before: null,
            rating_after: null,
          })),
        )
        .execute();
    }
    // i puzzle sbagliati entrano in ripasso
    for (const r of results.filter((x) => !x.solved)) {
      await this.puzzles.updateSrs(userId, r.puzzleId, false, false);
    }

    const best = await this.db
      .selectFrom('storm_runs')
      .select((eb) => eb.fn.max('score').as('best'))
      .where('user_id', '=', userId)
      .executeTakeFirstOrThrow();
    const rank = await this.db
      .selectFrom('storm_runs')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('user_id', '=', userId)
      .where('score', '>', solved)
      .executeTakeFirstOrThrow();
    return { score: solved, best: Number(best.best ?? solved), rank: Number(rank.n) + 1 };
  }

  async history(userId: string, limit = 20) {
    const rows = await this.db
      .selectFrom('storm_runs')
      .select(['id', 'score', 'errors', 'best_combo', 'duration_s', 'finished_at'])
      .where('user_id', '=', userId)
      .where('finished_at', 'is not', null)
      .orderBy('finished_at', 'desc')
      .limit(limit)
      .execute();
    return rows.map((r) => ({
      id: String(r.id),
      score: r.score ?? 0,
      errors: r.errors ?? 0,
      bestCombo: r.best_combo ?? 0,
      durationS: r.duration_s ?? 0,
      finishedAt: new Date(r.finished_at!).toISOString(),
    }));
  }
}
