CREATE TABLE puzzles (
  id           text PRIMARY KEY,                -- PuzzleId Lichess o 'own:<uuid>'
  fen          text NOT NULL,
  moves        text[] NOT NULL,                 -- UCI; la prima è la mossa avversaria
  rating       int NOT NULL,
  rating_dev   int,
  popularity   int,
  nb_plays     int,
  themes       text[] NOT NULL,
  opening_tags text[],
  game_url     text,
  source       text NOT NULL DEFAULT 'lichess' CHECK (source IN ('lichess', 'own_game')),
  rnd          real NOT NULL DEFAULT random()   -- selezione casuale senza ORDER BY random()
);
CREATE INDEX puzzles_themes_idx ON puzzles USING gin (themes);
CREATE INDEX puzzles_rating_rnd_idx ON puzzles (rating, rnd);

CREATE TABLE pawn_structures (
  id          text PRIMARY KEY,                 -- 'carlsbad', 'iqp', 'maroczy', ...
  name        text NOT NULL,
  description text
);

CREATE TABLE openings (
  id           bigserial PRIMARY KEY,
  eco          text NOT NULL,
  name         text NOT NULL,
  pgn          text NOT NULL,
  uci          text NOT NULL,
  epd          text NOT NULL,                   -- non unico: esistono trasposizioni
  ply          int NOT NULL,
  structure_id text REFERENCES pawn_structures(id),
  UNIQUE (eco, name, pgn)
);
CREATE INDEX openings_epd_idx ON openings (epd);
