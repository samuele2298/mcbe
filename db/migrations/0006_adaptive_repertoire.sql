-- Fase 6: occasioni della modalità adattiva, repertorio di aperture, cache dell'explorer

-- occasioni create dal computer in modalità adattiva (livello C):
-- [{ "ply": 23, "motif": "fork", "expected": ["c3d5"], "found": null|true|false }]
ALTER TABLE games ADD COLUMN adaptive_events jsonb NOT NULL DEFAULT '[]';
ALTER TABLE games ADD COLUMN adaptive_motif text;

CREATE TABLE repertoire_lines (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  color      text NOT NULL CHECK (color IN ('white', 'black')),
  moves      text[] NOT NULL,                   -- UCI dalla posizione iniziale
  eco        text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, color, moves)
);
CREATE INDEX ON repertoire_lines (user_id);

CREATE TABLE explorer_cache (
  key        text PRIMARY KEY,                  -- db + EPD
  result     jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
