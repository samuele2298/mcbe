-- Fase 2-3: cache del motore e delle tablebase, partite, mosse analizzate, errori

CREATE TABLE engine_cache (
  fen        text NOT NULL,                     -- EPD (senza contatori): stessa posizione = stessa analisi
  depth      int NOT NULL,
  multipv    int NOT NULL,
  result     jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fen, depth, multipv)
);

CREATE TABLE tablebase_cache (
  fen        text PRIMARY KEY,
  result     jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE games (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source          text NOT NULL CHECK (source IN ('play', 'adaptive', 'lichess', 'chesscom')),
  mode            text NOT NULL DEFAULT 'normal' CHECK (mode IN ('normal', 'training', 'adaptive')),
  external_id     text,
  start_fen       text NOT NULL,
  moves           text[] NOT NULL DEFAULT '{}',  -- UCI
  pgn             text,
  user_color      text NOT NULL CHECK (user_color IN ('white', 'black')),
  result          text,                          -- '1-0' | '0-1' | '1/2-1/2' | null (in corso)
  termination     text,
  opponent_elo    int,
  opponent_name   text,
  adaptive_target text,
  analysis_status text NOT NULL DEFAULT 'none' CHECK (analysis_status IN ('none', 'queued', 'running', 'done', 'failed')),
  accuracy        real,
  played_at       timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  UNIQUE (user_id, source, external_id)
);
CREATE INDEX ON games (user_id, played_at DESC);

CREATE TABLE game_moves (
  game_id        uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  ply            int NOT NULL,                  -- 1 = prima mossa
  fen_before     text NOT NULL,
  uci            text NOT NULL,
  san            text NOT NULL,
  by_user        bool NOT NULL,
  eval_before    int,                           -- cp, punto di vista del Bianco (matto = ±10000)
  eval_after     int,
  best_uci       text,
  best_pv        text[],
  win_pct_loss   real,
  classification text CHECK (classification IN ('best', 'ok', 'inaccuracy', 'mistake', 'blunder')),
  PRIMARY KEY (game_id, ply)
);

CREATE TABLE mistakes (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id    uuid REFERENCES games(id) ON DELETE CASCADE,
  ply        int,
  fen        text NOT NULL,
  played_uci text NOT NULL,
  best_uci   text,
  phase      text,
  category   text NOT NULL,                     -- missed_tactic | hanging_piece | missed_mate | allowed_tactic | endgame_technique | positional | opening_deviation
  motif      text,                              -- fork | pin | skewer | ...
  structure  text,
  eco        text,
  severity   text NOT NULL,
  explanation jsonb,                            -- fatti dei detector usati per la diagnosi
  puzzle_id  text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON mistakes (user_id, created_at DESC);
CREATE INDEX ON mistakes (user_id, category);
