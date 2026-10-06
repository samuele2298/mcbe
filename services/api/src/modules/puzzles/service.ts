import { sql } from 'kysely';
import type { Db } from '../../db/index.js';
import { CORE_THEMES, themeDimension } from '../../chess/themes.js';
import { review, type SrsRow } from '../../lib/srs.js';
import { getRating, recordResult, type StatChange, type StatKey } from '../profile/stats.js';

export type PuzzleMode = 'theme' | 'mix' | 'review' | 'weakness' | 'adaptive';

export interface PuzzleDto {
  id: string;
  fen: string;
  moves: string[];
  rating: number;
  themes: string[];
  openingTags: string[];
  source: string;
}

export interface NextPuzzle {
  puzzle: PuzzleDto;
  mode: PuzzleMode;
  theme: string | null;
  targetRating: number;
  reviewDue: number;
}

const puzzleColumns = ['id', 'fen', 'moves', 'rating', 'themes', 'opening_tags', 'source'] as const;

export type PuzzleRow = {
  id: string;
  fen: string;
  moves: string[];
  rating: number;
  themes: string[];
  opening_tags: string[] | null;
  source: string;
};

export function toDto(p: PuzzleRow): PuzzleDto {
  return {
    id: p.id,
    fen: p.fen,
    moves: p.moves,
    rating: p.rating,
    themes: p.themes,
    openingTags: p.opening_tags ?? [],
    source: p.source,
  };
}

export class PuzzleService {
  constructor(private readonly db: Db) {}

  async dueReviews(userId: string): Promise<number> {
    const r = await this.db
      .selectFrom('srs_cards')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('user_id', '=', userId)
      .where('item_type', '=', 'puzzle')
      .where('due_at', '<=', new Date())
      .executeTakeFirstOrThrow();
    return Number(r.n);
  }

  /** Tema più debole: rating basso tra i temi con abbastanza tentativi. */
  async weakestTheme(userId: string): Promise<string> {
    const rows = await this.db
      .selectFrom('weakness_stats')
      .select(['key', 'rating', 'rd'])
      .where('user_id', '=', userId)
      .where('dimension', '=', 'theme')
      .where('attempts', '>=', 3)
      .orderBy(sql`rating + rd * 0.5`)
      .limit(3)
      .execute();
    // un po' di varietà tra i tre più deboli; senza dati, un tema di base a caso
    const pool = rows.length ? rows.map((r) => r.key) : CORE_THEMES;
    return pool[Math.floor(Math.random() * pool.length)]!;
  }

  async next(
    userId: string,
    opts: { mode: PuzzleMode; theme?: string; exclude?: string[] },
  ): Promise<NextPuzzle | null> {
    const reviewDue = await this.dueReviews(userId);

    if (opts.mode === 'review') {
      const card = await this.db
        .selectFrom('srs_cards')
        .innerJoin('puzzles', 'puzzles.id', 'srs_cards.item_id')
        .select(puzzleColumns.map((c) => `puzzles.${c}` as const))
        .where('srs_cards.user_id', '=', userId)
        .where('srs_cards.item_type', '=', 'puzzle')
        .where('srs_cards.due_at', '<=', new Date())
        .$if(!!opts.exclude?.length, (q) => q.where('puzzles.id', 'not in', opts.exclude!))
        .orderBy('srs_cards.due_at')
        .executeTakeFirst();
      if (!card) return null;
      return { puzzle: toDto(card), mode: 'review', theme: null, targetRating: card.rating, reviewDue };
    }

    const theme =
      opts.mode === 'weakness' || opts.mode === 'adaptive'
        ? (opts.theme ?? (await this.weakestTheme(userId)))
        : opts.mode === 'theme'
          ? (opts.theme ?? null)
          : null;

    const stat =
      (theme ? await getRating(this.db, userId, 'theme', theme) : null) ??
      (await getRating(this.db, userId, 'global', 'all'));
    // leggero stimolo verso l'alto in modalità adattiva
    const target = Math.round((stat?.rating ?? 1500) + (opts.mode === 'adaptive' ? 50 : 0));

    for (const band of [75, 150, 300, 600, 1500]) {
      const puzzle = await this.pick(userId, target - band, target + band, theme, opts.exclude);
      if (puzzle) return { puzzle, mode: opts.mode, theme, targetRating: target, reviewDue };
    }
    return null;
  }

  private async pick(
    userId: string,
    lo: number,
    hi: number,
    theme: string | null,
    exclude: string[] = [],
  ): Promise<PuzzleDto | null> {
    // Prima prova: rating esatti casuali nella fascia. Con l'indice (rating, rnd) ogni
    // tentativo è un accesso puntuale; serve una fascia ampia solo per temi rari.
    for (let i = 0; i < 6; i++) {
      const rating = lo + Math.floor(Math.random() * (hi - lo + 1));
      const row = await this.candidates(userId, theme, exclude)
        .where('p.rating', '=', rating)
        .where('p.rnd', '>=', Math.random())
        .orderBy('p.rnd')
        .limit(1)
        .executeTakeFirst();
      if (row) return toDto(row);
    }
    const r = Math.random();
    for (const [op, dir] of [['>=', 'asc'], ['<', 'desc']] as const) {
      const row = await this.candidates(userId, theme, exclude)
        .where('p.rating', '>=', lo)
        .where('p.rating', '<=', hi)
        .where('p.rnd', op, r)
        .orderBy('p.rnd', dir)
        .limit(1)
        .executeTakeFirst();
      if (row) return toDto(row);
    }
    return null;
  }

  private candidates(userId: string, theme: string | null, exclude: string[]) {
    return this.db
      .selectFrom('puzzles as p')
      .select(puzzleColumns.map((c) => `p.${c}` as const))
      .where('p.source', '=', 'lichess')
      .$if(!!theme, (q) => q.where(sql<boolean>`p.themes @> ARRAY[${theme}]::text[]`))
      .$if(exclude.length > 0, (q) => q.where('p.id', 'not in', exclude))
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('puzzle_attempts as a')
              .select(sql`1`.as('x'))
              .whereRef('a.puzzle_id', '=', 'p.id')
              .where('a.user_id', '=', userId),
          ),
        ),
      );
  }

  async get(id: string): Promise<PuzzleDto | null> {
    const row = await this.db
      .selectFrom('puzzles')
      .select(puzzleColumns)
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? toDto(row) : null;
  }

  async attempt(
    userId: string,
    puzzleId: string,
    input: { solved: boolean; timeMs?: number; mode: PuzzleMode },
  ): Promise<{ ratingBefore: number; ratingAfter: number; changes: StatChange[] } | null> {
    const puzzle = await this.db
      .selectFrom('puzzles')
      .select(['id', 'rating', 'rating_dev', 'themes'])
      .where('id', '=', puzzleId)
      .executeTakeFirst();
    if (!puzzle) return null;

    const isReview = input.mode === 'review';
    const keys: StatKey[] = [];
    // il ripasso non tocca il rating: è un puzzle già visto
    if (!isReview) {
      keys.push({ dimension: 'global', key: 'all' });
      for (const t of puzzle.themes) {
        const dim = themeDimension(t);
        if (dim !== 'meta') keys.push({ dimension: dim, key: t });
      }
    }
    const changes = await recordResult(this.db, userId, keys, input.solved, {
      rating: puzzle.rating,
      rd: Math.max(puzzle.rating_dev ?? 80, 60),
    });
    const global = changes.find((c) => c.dimension === 'global');
    const ratingBefore = global?.before ?? 0;
    const ratingAfter = global?.after ?? 0;

    await this.db
      .insertInto('puzzle_attempts')
      .values({
        user_id: userId,
        puzzle_id: puzzleId,
        solved: input.solved,
        time_ms: input.timeMs ?? null,
        mode: input.mode === 'weakness' ? 'theme' : input.mode,
        rating_before: global ? ratingBefore : null,
        rating_after: global ? ratingAfter : null,
      })
      .execute();

    if (global) {
      await this.db
        .updateTable('users')
        .set({ rating_puzzle: ratingAfter })
        .where('id', '=', userId)
        .execute();
    }

    await this.updateSrs(userId, puzzleId, input.solved, isReview);
    return { ratingBefore, ratingAfter, changes };
  }

  /**
   * Errore -> il puzzle entra in ripasso. In ripasso ogni esito aggiorna la carta.
   * Fuori dal ripasso un successo su un puzzle mai sbagliato non crea carte.
   */
  async updateSrs(userId: string, puzzleId: string, solved: boolean, isReview: boolean) {
    const existing = await this.db
      .selectFrom('srs_cards')
      .selectAll()
      .where('user_id', '=', userId)
      .where('item_type', '=', 'puzzle')
      .where('item_id', '=', puzzleId)
      .executeTakeFirst();
    if (!existing && solved) return;
    if (existing && !isReview && solved) return;

    const next = review(existing ? (existing as unknown as SrsRow) : null, solved);
    await this.db
      .insertInto('srs_cards')
      .values({ user_id: userId, item_type: 'puzzle', item_id: puzzleId, ...next })
      .onConflict((oc) => oc.columns(['user_id', 'item_type', 'item_id']).doUpdateSet(next))
      .execute();
  }
}
