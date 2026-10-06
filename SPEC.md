# Chess Mentor AI — Specifica tecnica

Flutter · Node.js · PostgreSQL · Stockfish · Claude API
Versione 2.1 · ottobre 2026 · brief per Claude Code

> Cosa cambia rispetto alla v1: memoria/profilo utente, partita contro il computer con
> "Learn from play", modalità adattiva, knowledge base gestita solo lato backend,
> output del coach strutturato, correzioni allo schema DB, roadmap riordinata.
> v2.1: multiutente base, solo Flutter web, VPS condiviso con ~2 GB liberi
> (embedding esterni, una sola istanza Stockfish), analisi live solo in modalità allenamento.

> **Stato (ottobre 2026): fasi 0-6 implementate.** Scostamenti dalla specifica decisi in
> corso d'opera, con il motivo:
> - **Scacchiera:** `chessground`/`dartchess` usano interi a 64 bit e non compilano in
>   JavaScript per Flutter web: scacchiera propria con la logica del pacchetto `chess`
>   (port di chess.js).
> - **Motore:** il worker è un servizio HTTP interno con coda a priorità (gioco e coach
>   davanti all'analisi in background); pg-boss è usato per i lavori asincroni dell'API
>   (analisi partite, note di profilo notturne). Stockfish 19 ufficiale.
> - **Opening explorer:** Lichess ora lo riserva agli utenti autenticati: serve
>   `LICHESS_TOKEN`; senza, l'albero usa le mosse di libro del database ECO.
> - **Import partite:** sincrono nella richiesta (fino a 100 partite), analisi in coda.
> - **Tagging della KB:** chiamate dirette al modello economico invece della Batch API
>   (volumi piccoli, risultato immediato da rivedere nel diff).
> - **Coach:** con Claude Opus 5.5 e fallback lato server sui rifiuti dei classificatori;
>   senza chiave risponde con i soli fatti verificati.

---

## 1. Obiettivo

Mentore di scacchi personale che combina:

- puzzle tematici in grande quantità e modalità Storm;
- partite contro il computer con analisi di ogni mossa (**Learn from play**);
- **modalità adattiva** che crea apposta posizioni sui tuoi punti deboli;
- studio di aperture e finali;
- coach AI che spiega le posizioni usando fatti verificati e teoria curata, e che conosce
  il tuo profilo (memoria).

Multiutente ma con funzioni base (registrazione, login, dati separati per utente, ruolo
admin). Qualità da strumento di studio serio.

### Vincoli di deploy

- **Piattaforma:** solo web per ora (Flutter web). Le app mobile e desktop restano possibili
  in seguito con lo stesso codice.
- **Server:** VPS esistente condiviso con altri progetti, **~2 GB di RAM liberi**. Ogni scelta
  privilegia il basso consumo di memoria; i container hanno limiti di risorse espliciti.

## 2. Principio architetturale (non negoziabile)

Gli LLM non calcolano in modo affidabile. Ogni affermazione scacchistica proviene da uno
strato deterministico; l'LLM fa solo da narratore dei fatti che riceve.

| Strato | Responsabilità | Strumento |
|---|---|---|
| 1. Verità | Valutazioni, mosse migliori, legalità, risultato teorico dei finali | Stockfish (UCI, sul VPS), chess.js, Syzygy (API Lichess con cache; ≤5 pezzi in locale se c'è disco) |
| 2. Detector | Riconoscere i "tasselli": struttura pedonale, opposizione, quadrato, colonne aperte, case forti, coppia degli alfieri, pezzi in presa, motivi tattici, tipo di finale | Funzioni Node pure `fen -> risultato` |
| 3. Conoscenza | Teoria: piani, idee, errori tipici, trappole, regole dei finali | Knowledge base in Postgres + pgvector (sez. 7) |
| 4. Memoria | Profilo utente: punti deboli, errori ricorrenti, progressi | Tabelle di statistica in Postgres (sez. 6) |
| 5. Linguaggio | Spiegare in italiano al livello dell'utente | Claude API, prompt vincolato, output strutturato |

**Regola d'oro:** se un'informazione non arriva dagli strati 1-4, il coach non la afferma.
Se manca, lo dice.

**Il modello non impara nulla.** Ciò che "impara" è il sistema: il DB accumula il profilo
dell'utente e la knowledge base; a ogni richiesta un estratto pertinente entra nel prompt.
Niente fine-tuning.

## 3. Stack e struttura del repository

- **App:** Flutter **web** (renderer CanvasKit). Scacchiera `chessground` + logica
  `dartchess` (librerie dell'app ufficiale Lichess, licenza GPL-3).
- **Engine nel browser (opzionale, Fase 2b):** Stockfish WASM (build "lite", single-thread)
  in un Web Worker, collegato via `dart:js_interop`. Serve solo come avversario nel gioco, per
  scaricare il VPS. Si adotta se non rallenta l'app; altrimenti tutto resta sul backend.
- **API:** Node.js + TypeScript strict, Fastify + TypeBox, schema OpenAPI generato →
  client Dart generato per l'app.
- **DB access:** Kysely (SQL tipizzato) + migrazioni SQL esplicite.
- **Coda job:** pg-boss (coda su Postgres, niente Redis).
- **Engine worker:** (Fase 2: sostituire lo Stockfish 15.1 di Debian con il binario
  ufficiale più recente) processo Node con **una** istanza Stockfish (hash 64-128 MB, 1-2 thread),
  job serializzati dalla coda. Analisi in background a nodi limitati e bassa priorità.
- **Embedding:** servizio esterno (Voyage AI, modello multilingue, 1024 dim) chiamato dal
  backend. Nessun modello in locale per via della RAM. Il costo per una KB personale è
  trascurabile; il provider resta intercambiabile dietro un'interfaccia `Embedder`.
- **DB:** PostgreSQL 16+ con pgvector ≥ 0.8.
- **Hosting:** VPS esistente, progetto Docker Compose separato con `mem_limit` per servizio,
  dietro il reverse proxy già presente sul server. Postgres dedicato con configurazione a
  bassa memoria (`shared_buffers` ~256 MB).
- **AI:** Claude API, modelli configurabili via env (economico per tagging/riassunti,
  più capace per il coach).

```
mentorchess/
  SPEC.md
  mcfe/                          # frontend Flutter (target web)
  mcbe/                          # backend
    services/
      api/                       # Node + TS
        src/
          modules/auth/
          modules/puzzles/       # selezione, storm, rating per tema
          modules/play/          # partita vs computer, modalità adattiva
          modules/analysis/      # analisi mosse, classificazione errori
          modules/profile/       # memoria utente, punti deboli
          modules/openings/      # repertorio, studio, SRS
          modules/coach/         # pipeline spiegazioni
          modules/knowledge/     # retrieval (l'ingestione è solo CLI)
          chess/detectors/       # funzioni pure fen -> risultato, con test
          cli/                   # migrate, seed-puzzles, seed-openings, kb-ingest, kb-index
      engine/                    # worker Stockfish (pool UCI)
    db/migrations/
    knowledge/
      sources/                   # PDF/originali (fuori da git)
      content/                   # markdown curati: la fonte di verità, in git
    deploy/                      # esempio nginx
    docker-compose.yml
```

## 4. Fonti dati

| Fonte | Contenuto | Uso |
|---|---|---|
| database.lichess.org (puzzle, CC0) | ~5-6 M puzzle CSV: FEN, mosse, rating, temi, aperture, popolarità | Tabella `puzzles`, base di Storm, training e modalità adattiva |
| github.com/lichess-org/chess-openings | Nomi aperture, ECO, mosse (TSV) | Albero aperture, riconoscimento ECO |
| API Lichess opening explorer | Statistiche mosse | Studio aperture (con cache DB; verificare rate limit e necessità di token) |
| API Lichess tablebase | Finali a 6-7 pezzi | Verità nei finali (con cache); ≤5 pezzi in locale |
| API Lichess / Chess.com | PGN delle proprie partite | Analisi errori, puzzle personali |
| Libri, articoli, Wikibooks, note proprie | Teoria | Knowledge base (sez. 7) |

Import puzzle: comando `pnpm seed:puzzles`, eseguito una volta e rilanciabile per
aggiornare (upsert). Download del `.csv.zst`, decompressione e parsing **in streaming**,
insert a batch, scarto dei puzzle a popolarità molto bassa. Il dump è zstd "seekable"
(frame skippable) che `node:zlib` non decodifica: si usa la CLI `zstd`. Lichess aggiunge
colonne in coda nel tempo (es. `DailyDate`): il parser verifica l'header e ignora le extra.

## 5. Schema PostgreSQL (v2)

```sql
CREATE EXTENSION IF NOT EXISTS vector;

-- PUZZLE
CREATE TABLE puzzles (
  id           text PRIMARY KEY,               -- PuzzleId Lichess o 'own:<uuid>'
  fen          text NOT NULL,
  moves        text[] NOT NULL,                -- UCI; la prima è la mossa avversaria
  rating       int NOT NULL,
  popularity   int,
  nb_plays     int,
  themes       text[] NOT NULL,
  opening_tags text[],
  source       text NOT NULL DEFAULT 'lichess', -- 'lichess' | 'own_game'
  rnd          real NOT NULL DEFAULT random()  -- selezione casuale veloce
);
CREATE INDEX ON puzzles USING gin (themes);
CREATE INDEX ON puzzles (rating, rnd);

-- APERTURE
CREATE TABLE pawn_structures (id text PRIMARY KEY, name text, description text);
CREATE TABLE openings (
  id bigserial PRIMARY KEY,
  eco text, name text, pgn text, uci text, epd text NOT NULL,
  structure_id text REFERENCES pawn_structures(id)
);
CREATE INDEX ON openings (epd);                -- non unico: esistono trasposizioni

-- UTENTE
CREATE TABLE users (
  id uuid PRIMARY KEY, email text UNIQUE, password_hash text,
  lichess_username text, chesscom_username text,
  role text NOT NULL DEFAULT 'user',            -- 'user' | 'admin'
  display_name text,
  rating_puzzle int DEFAULT 1500, created_at timestamptz DEFAULT now()
);
CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY, user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL, expires_at timestamptz NOT NULL, revoked bool DEFAULT false
);

-- ALLENAMENTO
CREATE TABLE puzzle_attempts (
  id bigserial PRIMARY KEY, user_id uuid REFERENCES users(id), puzzle_id text,
  solved bool, time_ms int, mode text,          -- 'theme'|'storm'|'review'|'adaptive'
  created_at timestamptz DEFAULT now()
);
CREATE INDEX ON puzzle_attempts (user_id, puzzle_id);
CREATE TABLE storm_runs (
  id bigserial PRIMARY KEY, user_id uuid REFERENCES users(id), score int, solved int,
  errors int, duration_s int, created_at timestamptz DEFAULT now()
);
CREATE TABLE srs_cards (                         -- campi FSRS (ts-fsrs)
  user_id uuid REFERENCES users(id), item_type text, item_id text,
  due_at timestamptz, stability real, difficulty real,
  state smallint, reps int, lapses int, last_review timestamptz,
  PRIMARY KEY (user_id, item_type, item_id)
);

-- PARTITE (vs computer e importate)
CREATE TABLE games (
  id uuid PRIMARY KEY, user_id uuid REFERENCES users(id),
  source text,                                   -- 'play'|'adaptive'|'lichess'|'chesscom'
  external_id text, pgn text, user_color text, result text,
  opponent_elo int, adaptive_target text,        -- debolezza mirata, se modalità adattiva
  analyzed bool DEFAULT false, played_at timestamptz
);
CREATE TABLE game_moves (
  game_id uuid REFERENCES games(id) ON DELETE CASCADE, ply int,
  fen_before text, uci text, san text, by_user bool,
  eval_cp int, best_uci text, win_pct_loss real,
  classification text,                           -- 'ok'|'inaccuracy'|'mistake'|'blunder'
  PRIMARY KEY (game_id, ply)
);

-- MEMORIA / PROFILO
CREATE TABLE mistakes (                          -- un errore diagnosticato
  id bigserial PRIMARY KEY, user_id uuid REFERENCES users(id),
  game_id uuid, ply int, fen text, phase text,
  category text,                                 -- 'missed_tactic'|'hanging_piece'|'structure'|'endgame_technique'|...
  motif text,                                    -- 'fork'|'pin'|'opposition'|...
  structure text, eco text, severity text,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE weakness_stats (                    -- sostituisce theme_stats
  user_id uuid REFERENCES users(id),
  dimension text,                                -- 'theme'|'phase'|'structure'|'opening'|'endgame_type'
  key text,                                      -- es. 'fork', 'endgame', 'iqp', 'D35', 'rook_pawn'
  attempts int DEFAULT 0, successes int DEFAULT 0,
  rating real, rd real, vol real,                -- Glicko-2
  updated_at timestamptz,
  PRIMARY KEY (user_id, dimension, key)
);
CREATE TABLE profile_notes (                     -- riassunti periodici generati dal coach
  id bigserial PRIMARY KEY, user_id uuid REFERENCES users(id),
  content text, based_on jsonb, created_at timestamptz DEFAULT now()
);

-- CACHE
CREATE TABLE engine_cache (
  fen text, depth int, multipv int, lines jsonb, created_at timestamptz DEFAULT now(),
  PRIMARY KEY (fen, depth, multipv)
);
CREATE TABLE tablebase_cache (fen text PRIMARY KEY, result jsonb);

-- KNOWLEDGE BASE (popolata solo da CLI)
CREATE TABLE knowledge_docs (
  id uuid PRIMARY KEY, path text UNIQUE,         -- percorso in knowledge/content
  title text, source_type text,                  -- 'book'|'article'|'pgn'|'note'|'wikibooks'
  source_ref text, license text, content_hash text,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE knowledge_chunks (
  id uuid PRIMARY KEY, doc_id uuid REFERENCES knowledge_docs(id) ON DELETE CASCADE,
  heading text, content text NOT NULL, token_count int,
  eco text[], structures text[], themes text[], phase text, endgame_type text,
  fen text,                                      -- per commenti di PGN legati a una posizione
  min_level int, max_level int, verified bool DEFAULT false,
  embedding vector(1024)
);
CREATE INDEX ON knowledge_chunks USING gin (structures);
CREATE INDEX ON knowledge_chunks USING gin (eco);
CREATE INDEX ON knowledge_chunks USING gin (themes);
-- Nessun indice HNSW all'inizio: con poche migliaia di chunk la scansione esatta
-- è veloce e non perde risultati col filtro sui tag.

-- COACH
CREATE TABLE coach_explanations (
  id uuid PRIMARY KEY, user_id uuid, fen text, question text,
  facts jsonb, chunk_ids uuid[], response jsonb, model text,
  feedback text,                                 -- null | 'wrong' | 'useful'
  feedback_note text, created_at timestamptz DEFAULT now()
);
```

## 6. Memoria e profilo utente

Il sistema costruisce automaticamente un profilo da tutte le attività.

| Segnale | Origine | Dove finisce |
|---|---|---|
| Rendimento per tema tattico | Puzzle, Storm, adattiva | `weakness_stats` (dimension = theme) |
| Errori per fase | Analisi partite | `mistakes`, `weakness_stats` (phase) |
| Strutture pedonali problematiche | Detector sulle partite | `weakness_stats` (structure) |
| Linee di repertorio dimenticate | SRS aperture | `srs_cards` |
| Errori ricorrenti specifici | Raggruppamento di `mistakes` | `profile_notes` |

- I rating per dimensione usano **Glicko-2**: il rating misura il livello, l'RD l'incertezza.
- Un job periodico (settimanale o dopo N partite) chiede a Claude di riassumere `mistakes` e
  `weakness_stats` in una nota breve (`profile_notes`). Il riassunto descrive solo dati
  presenti nelle tabelle.
- `GET /me/weaknesses` restituisce le debolezze ordinate per gravità e affidabilità
  (rating basso con RD basso = debolezza certa).
- Nel prompt del coach entra un estratto compatto: rating, le 3-5 debolezze principali,
  l'ultimo errore simile alla posizione corrente.

## 7. Knowledge base (solo backend)

L'utente dell'app **non carica nulla**. La knowledge base si gestisce lato backend
dall'admin con due comandi CLI. La cartella `knowledge/content/` (markdown in git) è la fonte
di verità; il DB è un indice ricostruibile da essa.

### 7.1 Cosa si può inserire

- **Utilissimo:** note sul repertorio (idee, piani di entrambi i lati, trappole, errori
  tipici), guide alle strutture pedonali, regole dei finali, spiegazioni dei motivi tattici,
  partite commentate in PGN, appunti personali.
- **Utile da verificare:** libri in PDF (meglio per capitoli), articoli web, Wikibooks.
- **Da non inserire:** database di partite senza commenti, valutazioni e varianti (le
  fornisce Stockfish).

### 7.2 Flusso

```
1. kb:ingest   knowledge/sources/finali.pdf  (oppure URL, .md, .pgn)
               -> estrazione testo
               -> divisione per sezione/titolo (un chunk = un concetto, ~300-600 token)
               -> Claude propone i tag (API batch)
               -> scrive knowledge/content/books/finali/*.md con frontmatter:
                    ---
                    source: "Titolo libro, cap. 4"
                    phase: endgame
                    endgame_type: rook_pawn_vs_rook
                    themes: [lucena, bridge]
                    level: [1400, 2000]
                    verified: false
                    ---
2. revisione   l'admin controlla e corregge i tag nei file (diff git) e imposta verified: true
3. kb:index    legge knowledge/content, calcola embedding dei soli file cambiati
               (content_hash), aggiorna knowledge_docs / knowledge_chunks
```

PGN commentati: ogni commento diventa un chunk con la `fen` della posizione in cui compare,
così è recuperabile per somiglianza di posizione oltre che per tag.

### 7.3 Retrieval a ogni richiesta (ibrido)

```
1. Detector sulla posizione (+ mosse precedenti per l'ECO)
     -> { eco: 'D35', structure: 'carlsbad', phase: 'middlegame',
          themes: ['minorityAttack'], endgame_type: null, level: 1650 }
2. Filtro SQL sui tag:  structures && '{carlsbad}' OR eco && '{D35}' OR themes && ...
3. Ordinamento per similarità vettoriale con la domanda (scansione esatta)
4. Top 5-8 chunk (~2-4k token) -> prompt del coach
```

Il filtro sui tag viene prima della ricerca semantica: una Carlsbad viene spiegata con la
teoria della Carlsbad, non con qualcosa di "simile".

### 7.4 Esempio: un libro sui finali

All'import il libro diventa centinaia di chunk etichettati (Lucena, Philidor, quadrato,
opposizione…). Durante un finale R+T+P vs R+T i detector riconoscono la Lucena, la tablebase
dà il risultato esatto, Stockfish la linea, il retrieval pesca i chunk del libro sulla Lucena
e Claude li collega. Se il libro non tratta quel finale, il coach lo dice.

## 8. Funzionalità

### 8.1 Puzzle per tema

Selezione intelligente, senza generazione AI: tema scelto o debolezza rilevata, rating
vicino al rating dell'utente nel tema, progressione di difficoltà, esclusione dei puzzle già
visti (salvo ripasso SRS). Selezione casuale con `rating BETWEEN … AND rnd >= random()`,
mai `ORDER BY random()`.

### 8.2 Storm

Interamente lato app e API, zero token. Timer, rating crescente, bonus per combo, penalità
per errore. Batch di puzzle precaricato all'inizio della run. I puzzle sbagliati entrano in
ripasso.

### 8.3 Partita contro il computer + Learn from play

- Forza regolabile: `UCI_LimitStrength` + `UCI_Elo` di Stockfish, oppure limite di nodi.
- Mosse del computer calcolate dal worker sul VPS.
- **Analisi di ogni mossa dell'utente** (durante o a fine partita, configurabile):
  1. Stockfish valuta la posizione prima e dopo la mossa.
  2. Perdita in probabilità di vittoria (formula Lichess:
     `win% = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)`).
     Soglie: imprecisione ≥10, errore ≥20, blunder ≥30 punti percentuali.
  3. Per errori e blunder i detector diagnosticano la causa: tattica mancata (con motivo),
     pezzo lasciato in presa, struttura compromessa, tecnica di finale.
  4. Scrittura in `mistakes` e aggiornamento di `weakness_stats`.
  5. Le posizioni con errore grave diventano puzzle personali (`source = 'own_game'`) con SRS.
- **Quando avviene l'analisi:**
  - *Partita normale:* nessun suggerimento durante il gioco; analisi completa a fine partita.
  - *Modalità allenamento* (scelta all'avvio): dopo ogni mossa l'app segnala subito
    imprecisione/errore/blunder, mostra la mossa migliore e permette di riprovare o chiedere
    il perché al coach. Più carico sul motore: analisi a profondità ridotta durante il
    gioco, approfondita solo sugli errori.
- **Revisione a fine partita:** il coach commenta i 2-3 momenti chiave.
- Le partite importate da Lichess/Chess.com passano per la stessa pipeline in background.
  Motivo dell'import: sono le partite *reali* dell'utente (cadenze vere, avversari umani) e
  danno un quadro delle debolezze più fedele delle sole partite contro il computer. Arriva
  nella Fase 6.

### 8.4 Modalità adattiva

Il computer crea occasioni sui punti deboli dell'utente (dalla sez. 6).

- **Livello A, posizioni di partenza:** la partita parte da una posizione reale (puzzle o
  partita) della categoria debole, per esempio un finale di torre o un mediogioco con IQP.
- **Livello B, aperture:** il computer sceglie aperture e linee che portano alle strutture
  deboli.
- **Livello C, mosse "didattiche"** (dopo A e B): tra le mosse multipv di Stockfish entro una
  perdita di valutazione tollerata, il sistema sceglie quella che lascia all'utente
  un'occasione nel tema debole (verificata coi detector sulla posizione risultante). Mossa
  trovata → successo nel tema; mossa mancata → errore registrato e puzzle personale.

Ogni partita adattiva registra `adaptive_target` per misurare se la debolezza migliora.

### 8.5 Studio aperture

Albero del repertorio personale con statistiche dell'explorer; per ogni nodo chiave
struttura, piani ed errori tipici dalla KB; allenamento delle linee con SRS; fuori libro
Stockfish giudica e il coach spiega.

### 8.6 Finali

Tablebase per il risultato esatto, detector per il tassello (opposizione, quadrato, Lucena,
Philidor…), KB per la regola in parole, LLM per collegarli.

## 9. Pipeline del coach

```
POST /coach/explain   { fen, moves?, lastMove?, question?, gameId? }

1. chess.js       valida FEN e mosse
2. engine         Stockfish multipv=3, depth 18-22 (cache per FEN)
3. tablebase      se ≤7 pezzi -> risultato teorico (API + cache, locale ≤5 opzionale)
4. detectors      struttura, motivi tattici, pezzi in presa, tipo di finale, ECO
5. knowledge      retrieval ibrido (7.3) -> 5-8 chunk
6. profile        estratto del profilo + ultimo errore simile
7. prompt         system (cacheable) + fatti 2-6 + domanda
8. Claude         output strutturato JSON (vedi 9.2)
9. post-check     ogni mossa citata deve appartenere alle linee fornite; altrimenti rigenera
10. salvataggio   coach_explanations (fatti, chunk usati, risposta) per il feedback
```

### 9.1 Regole del system prompt

- Usa SOLO mosse presenti nelle linee del motore fornite. Non calcolare varianti nuove.
- La teoria deve venire dai chunk forniti; se manca, dillo esplicitamente.
- Prima il concetto (il tassello), poi la variante concreta.
- Adatta il linguaggio al livello dell'utente; massimo 2-3 idee per spiegazione.
- Collega la posizione alle debolezze del profilo quando è pertinente.
- Segnala quando usi un chunk non verificato.
- Rispondi in italiano.

### 9.2 Output strutturato

Claude non scrive mosse in testo libero (evita l'ambiguità della notazione italiana:
R = Re / R = Rook). Risponde in JSON, con le mosse referenziate in UCI; l'app rende il
testo con le figurine.

```json
{
  "concept": "Posizione di Lucena: costruire il ponte",
  "explanation": [
    { "text": "Il re nero è tagliato fuori, quindi...", "chunk_ids": ["…"] },
    { "text": "La mossa chiave è", "move": { "line": 0, "ply": 0, "uci": "f1f4" } }
  ],
  "unverified_sources": false,
  "missing_knowledge": null
}
```

Il post-check verifica ogni `move` rispetto alle linee fornite.

### 9.3 Feedback

Pulsanti "spiegazione sbagliata" / "utile" nell'app, con nota opzionale. Salvati in
`coach_explanations`: è il dataset per correggere detector, chunk e prompt.

## 10. Endpoint REST (prima versione)

| Endpoint | Descrizione |
|---|---|
| `POST /auth/register` | Registrazione (email + password, hash argon2) |
| `POST /auth/login` · `POST /auth/refresh` · `POST /auth/logout` | JWT di accesso breve + refresh token |
| `GET /puzzles/next?theme=&mode=` | Prossimo puzzle (tema, ripasso, adattivo) |
| `POST /puzzles/:id/attempt` | Esito tentativo; aggiorna Glicko per tema e SRS |
| `POST /storm/start` · `POST /storm/:id/finish` | Batch per la run; salvataggio punteggio |
| `POST /play/start` | Nuova partita (forza, colore, modalità normale/allenamento/adattiva) |
| `POST /play/:id/move` | Mossa utente → risposta del computer (+ analisi se attiva) |
| `POST /play/:id/finish` | Fine partita, avvia l'analisi completa |
| `GET /games/:id/review` | Momenti chiave, errori classificati, commento del coach |
| `POST /games/import` | Import partite Lichess/Chess.com e analisi in background |
| `GET /openings/tree?fen=` | Nodo del repertorio con mosse, statistiche e struttura |
| `POST /coach/explain` | Pipeline sez. 9 |
| `POST /coach/:id/feedback` | Feedback su una spiegazione |
| `GET /me/weaknesses` | Debolezze ordinate |
| `GET /me/profile` | Profilo completo e note |
| `GET /knowledge/search?q=&tags=` | Debug del retrieval (solo admin) |

Nessun endpoint di caricamento della knowledge base: l'ingestione è solo da CLI.

## 11. Roadmap

| Fase | Contenuto | Risultato |
|---|---|---|
| 0. Setup | Monorepo, Docker Compose (Postgres+pgvector, API, engine), migrazioni, auth, import puzzle e aperture | DB pronto con i puzzle |
| 1. Puzzle + Storm | Scacchiera Flutter, puzzle per tema, Storm, Glicko per tema | App utile ogni giorno, costo AI zero |
| 2. Engine + detector + gioco | Worker Stockfish, cache, tablebase, primi detector, partita vs computer (motore sul backend) | Fatti verificati, si gioca |
| 2b. Engine nel browser | Stockfish WASM come avversario lato web, se le prestazioni sono buone | Meno carico sul VPS |
| 3. Learn from play | Analisi mosse, classificazione e diagnosi errori, `mistakes`, profilo, puzzle personali | Il sistema conosce le tue debolezze |
| 4. Knowledge base | CLI ingest/index, chunking, tagging, embedding, retrieval; scrittura KB del repertorio | Teoria interrogabile |
| 5. Coach | Pipeline sez. 9, output strutturato, post-check, feedback, note di profilo | Spiegazioni affidabili e personalizzate |
| 6. Adattiva + import | Modalità adattiva A/B (poi C), import partite, SRS aperture, piano settimanale | Mentore vero e proprio |

## 12. Costi

- Puzzle, Storm, gioco, motore, tablebase, retrieval: zero token (solo VPS).
- Coach: circa 3-5k token di input + 500 di output a spiegazione; il prompt caching del
  system prompt riduce il costo dell'input. Prezzi da verificare su claude.com/pricing.
- Tagging della KB e note di profilo: API batch (sconto 50%).
- Embedding: Voyage a consumo, costo trascurabile per una KB personale.
- VPS (budget ~2 GB RAM): Postgres ~512 MB, API ~200 MB, engine worker + Stockfish ~250 MB.
  Disco: ~5-6 GB per i puzzle con indici (filtrabili per popolarità/nb_plays per ridurre).
- Il limite reale è la CPU di una sola istanza Stockfish: con molti utenti contemporanei le
  analisi vanno in coda. Per questo l'avversario nel browser (Fase 2b) e la cache per FEN
  sono importanti.

## 13. Istruzioni per Claude Code

- Partire dalla Fase 0 e fermarsi a fine fase per la revisione; non anticipare il coach AI.
- TypeScript strict; ogni detector è una funzione pura testata con FEN di riferimento.
- Import puzzle in streaming a batch, mai il CSV in memoria.
- Chiavi e modelli Claude solo da variabili d'ambiente.
- `knowledge/content/` è la fonte versionata; il DB è un indice ricostruibile.
- Nessuna affermazione scacchistica generata dall'LLM senza fatti di supporto (sez. 2).
- Ogni chiamata esterna (explorer, tablebase, Claude, embedding) passa da cache e gestisce il
  rate limit.
- Ogni query sui dati utente filtra per `user_id` dal token; gli endpoint admin controllano
  il ruolo.
- Rispettare il budget di RAM (sez. 1): `mem_limit` su ogni container, nessun servizio
  pesante in più senza discuterne.
- Le tablebase Syzygy locali (≤5 pezzi, ~1 GB di disco) sono opzionali: valutare lo spazio
  su disco del VPS, altrimenti solo API Lichess con cache.
