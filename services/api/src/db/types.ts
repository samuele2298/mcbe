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
  created_at: Timestamp;
}

export interface RefreshTokensTable {
  id: Generated<string>;
  user_id: string;
  token_hash: string;
  expires_at: Timestamp;
  revoked_at: Timestamp | null;
  created_at: Timestamp;
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
  created_at: Timestamp;
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
  updated_at: Timestamp;
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
  created_at: Timestamp;
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

export interface EngineCacheTable {
  fen: string;
  depth: number;
  multipv: number;
  result: unknown;
  created_at: Timestamp;
}

export interface TablebaseCacheTable {
  fen: string;
  result: unknown;
  created_at: Timestamp;
}

export interface GamesTable {
  id: Generated<string>;
  user_id: string;
  source: 'play' | 'adaptive' | 'lichess' | 'chesscom';
  mode: Generated<'normal' | 'training' | 'adaptive'>;
  external_id: string | null;
  start_fen: string;
  moves: Generated<string[]>;
  pgn: string | null;
  user_color: 'white' | 'black';
  result: string | null;
  termination: string | null;
  opponent_elo: number | null;
  opponent_name: string | null;
  adaptive_target: string | null;
  analysis_status: Generated<'none' | 'queued' | 'running' | 'done' | 'failed'>;
  accuracy: number | null;
  played_at: Timestamp;
  finished_at: Timestamp | null;
}

export interface GameMovesTable {
  game_id: string;
  ply: number;
  fen_before: string;
  uci: string;
  san: string;
  by_user: boolean;
  eval_before: number | null;
  eval_after: number | null;
  best_uci: string | null;
  best_pv: string[] | null;
  win_pct_loss: number | null;
  classification: 'best' | 'ok' | 'inaccuracy' | 'mistake' | 'blunder' | null;
}

export interface MistakesTable {
  id: Generated<string>;
  user_id: string;
  game_id: string | null;
  ply: number | null;
  fen: string;
  played_uci: string;
  best_uci: string | null;
  phase: string | null;
  category: string;
  motif: string | null;
  structure: string | null;
  eco: string | null;
  severity: string;
  explanation: unknown;
  puzzle_id: string | null;
  created_at: Timestamp;
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
  engine_cache: EngineCacheTable;
  tablebase_cache: TablebaseCacheTable;
  games: GamesTable;
  game_moves: GameMovesTable;
  mistakes: MistakesTable;
}
