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

export interface Database {
  users: UsersTable;
  refresh_tokens: RefreshTokensTable;
  puzzles: PuzzlesTable;
  pawn_structures: PawnStructuresTable;
  openings: OpeningsTable;
}
