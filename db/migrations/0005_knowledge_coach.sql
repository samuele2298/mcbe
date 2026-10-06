-- Fase 4-5: knowledge base (indice ricostruibile da knowledge/content) e coach

CREATE TABLE knowledge_docs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  path         text NOT NULL UNIQUE,            -- percorso relativo in knowledge/content
  title        text NOT NULL,
  source_type  text NOT NULL DEFAULT 'note',    -- book | article | pgn | note | wikibooks
  source_ref   text,
  license      text,
  verified     bool NOT NULL DEFAULT false,
  content_hash text NOT NULL,
  indexed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE knowledge_chunks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id       uuid NOT NULL REFERENCES knowledge_docs(id) ON DELETE CASCADE,
  position     int NOT NULL,
  heading      text NOT NULL,
  content      text NOT NULL,
  token_count  int NOT NULL,
  eco          text[] NOT NULL DEFAULT '{}',
  structures   text[] NOT NULL DEFAULT '{}',
  themes       text[] NOT NULL DEFAULT '{}',
  phase        text,
  endgame_type text,
  fen          text,                            -- EPD, per i commenti dei PGN
  min_level    int,
  max_level    int,
  verified     bool NOT NULL DEFAULT false,
  embedding    vector(1024),
  tsv          tsvector GENERATED ALWAYS AS (to_tsvector('italian', heading || ' ' || content)) STORED
);
CREATE INDEX ON knowledge_chunks (doc_id);
CREATE INDEX ON knowledge_chunks USING gin (structures);
CREATE INDEX ON knowledge_chunks USING gin (eco);
CREATE INDEX ON knowledge_chunks USING gin (themes);
CREATE INDEX ON knowledge_chunks USING gin (tsv);
CREATE INDEX ON knowledge_chunks (fen) WHERE fen IS NOT NULL;
-- niente HNSW: con poche migliaia di chunk la scansione esatta è veloce e non perde
-- risultati quando si filtra per tag (vedi SPEC 7.3)

CREATE TABLE coach_explanations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fen           text NOT NULL,
  question      text,
  facts         jsonb NOT NULL,
  chunk_ids     uuid[] NOT NULL DEFAULT '{}',
  response      jsonb NOT NULL,
  model         text,
  input_tokens  int,
  output_tokens int,
  feedback      text CHECK (feedback IN ('wrong', 'useful')),
  feedback_note text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON coach_explanations (user_id, created_at DESC);
CREATE INDEX ON coach_explanations (feedback) WHERE feedback IS NOT NULL;

CREATE TABLE profile_notes (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content    text NOT NULL,
  based_on   jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON profile_notes (user_id, created_at DESC);
