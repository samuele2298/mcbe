import type { ColumnType, Generated } from 'kysely';

// Tipi scritti a mano: crescono insieme alle migrazioni in db/migrations.

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export interface UsersTable {
  id: Generated<string>;
  email: string;
  password_hash: string;
  role: ColumnType<'user' | 'admin', 'user' | 'admin' | undefined, 'user' | 'admin'>;
  display_name: string | null;
  lichess_username: string | null;
  chesscom_username: string | null;
  rating_puzzle: Generated<number>;
  created_at: Generated<Timestamp>;
}

export interface RefreshTokensTable {
  id: Generated<string>;
  user_id: string;
  token_hash: string;
  expires_at: Timestamp;
  revoked_at: Timestamp | null;
  created_at: Generated<Timestamp>;
}

export interface PuzzlesTable {
  id: string;
  fen: string;
  moves: string[];
  rating: number;
  rating_dev: number | null;
  popularity: number | null;
  nb_plays: number | null;
  themes: string[];
  opening_tags: string[] | null;
  game_url: string | null;
  source: Generated<'lichess' | 'own_game'>;
  rnd: Generated<number>;
}

export interface PawnStructuresTable {
  id: string;
  name: string;
  description: string | null;
}

export interface OpeningsTable {
  id: Generated<string>;
  eco: string;
  name: string;
  pgn: string;
  uci: string;
  epd: string;
  ply: number;
  structure_id: string | null;
}

export interface PuzzleAttemptsTable {
  id: Generated<string>;
  user_id: string;
  puzzle_id: string;
  solved: boolean;
  time_ms: number | null;
  mode: 'theme' | 'storm' | 'review' | 'adaptive' | 'mix';
  rating_before: number | null;
  rating_after: number | null;
  created_at: Generated<Timestamp>;
}

export interface WeaknessStatsTable {
  user_id: string;
  dimension: string;
  key: string;
  attempts: Generated<number>;
  successes: Generated<number>;
  rating: Generated<number>;
  rd: Generated<number>;
  vol: Generated<number>;
  updated_at: Generated<Timestamp>;
}

export interface StormRunsTable {
  id: Generated<string>;
  user_id: string;
  puzzle_ids: string[];
  score: number | null;
  solved: number | null;
  errors: number | null;
  best_combo: number | null;
  duration_s: number | null;
  finished_at: Timestamp | null;
  created_at: Generated<Timestamp>;
}

export interface SrsCardsTable {
  user_id: string;
  item_type: string;
  item_id: string;
  due_at: Timestamp;
  stability: number;
  difficulty: number;
  scheduled_days: number;
  learning_steps: number;
  state: number;
  reps: number;
  lapses: number;
  last_review: Timestamp | null;
}

export interface Database {
  users: UsersTable;
  refresh_tokens: RefreshTokensTable;
  puzzles: PuzzlesTable;
  pawn_structures: PawnStructuresTable;
  openings: OpeningsTable;
  puzzle_attempts: PuzzleAttemptsTable;
  weakness_stats: WeaknessStatsTable;
  storm_runs: StormRunsTable;
  srs_cards: SrsCardsTable;
}
