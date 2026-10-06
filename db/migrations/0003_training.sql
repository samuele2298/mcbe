-- Fase 1: tentativi, rating per dimensione (Glicko-2), Storm, ripetizione spaziata (FSRS)

CREATE TABLE puzzle_attempts (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  puzzle_id  text NOT NULL REFERENCES puzzles(id) ON DELETE CASCADE,
  solved     bool NOT NULL,
  time_ms    int,
  mode       text NOT NULL CHECK (mode IN ('theme', 'storm', 'review', 'adaptive', 'mix')),
  rating_before int,
  rating_after  int,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON puzzle_attempts (user_id, puzzle_id);
CREATE INDEX ON puzzle_attempts (user_id, created_at DESC);

-- dimension: 'global' | 'theme' | 'phase' | 'structure' | 'opening' | 'endgame_type' | 'mistake'
CREATE TABLE weakness_stats (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dimension  text NOT NULL,
  key        text NOT NULL,
  attempts   int NOT NULL DEFAULT 0,
  successes  int NOT NULL DEFAULT 0,
  rating     real NOT NULL DEFAULT 1500,
  rd         real NOT NULL DEFAULT 350,
  vol        real NOT NULL DEFAULT 0.06,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, dimension, key)
);

CREATE TABLE storm_runs (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  puzzle_ids  text[] NOT NULL,
  score       int,
  solved      int,
  errors      int,
  best_combo  int,
  duration_s  int,
  finished_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON storm_runs (user_id, score DESC);

-- item_type: 'puzzle' | 'opening_line'
CREATE TABLE srs_cards (
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type      text NOT NULL,
  item_id        text NOT NULL,
  due_at         timestamptz NOT NULL,
  stability      real NOT NULL,
  difficulty     real NOT NULL,
  scheduled_days int NOT NULL DEFAULT 0,
  learning_steps int NOT NULL DEFAULT 0,
  state          smallint NOT NULL,
  reps           int NOT NULL DEFAULT 0,
  lapses         int NOT NULL DEFAULT 0,
  last_review    timestamptz,
  PRIMARY KEY (user_id, item_type, item_id)
);
CREATE INDEX ON srs_cards (user_id, item_type, due_at);
