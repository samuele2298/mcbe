# mcbe — backend Chess Mentor

Specifica completa in [SPEC.md](SPEC.md). Frontend in [mcfe](https://github.com/samuele2298/mcfe).

## Cosa fa

| Area | Endpoint principali |
|---|---|
| Autenticazione | `POST /auth/register` · `/auth/login` · `/auth/refresh` · `/auth/logout` · `GET/PUT /me` |
| Puzzle e Storm | `GET /puzzles/next?mode=mix\|theme\|weakness\|review` · `POST /puzzles/:id/attempt` · `POST /storm/start` · `/storm/:id/finish` |
| Gioco | `POST /play/start` (normale/allenamento) · `POST /play/adaptive` · `/play/:id/move` · `/takeback` · `/continue` · `/resign` |
| Partite | `GET /games` · `GET /games/:id/review` · `POST /games/:id/analyze` · `POST /games/import` (Lichess, Chess.com) |
| Analisi e coach | `POST /analysis` · `POST /coach/explain` · `POST /coach/:id/feedback` · `GET /coach/feedback` (admin) |
| Aperture | `POST /openings/tree` · `GET/POST /repertoire` · `POST /repertoire/:id/review` · `DELETE /repertoire/:id` |
| Profilo | `GET /me/stats` · `/me/weaknesses` · `/me/mistakes` · `/me/profile` · `POST /me/profile/refresh` · `GET /me/plan` |
| Knowledge base | `GET /knowledge/search` · `/knowledge/stats` (admin); ingestione solo da CLI |

Documentazione OpenAPI interattiva su `/docs`.

## Struttura

```
services/api      API Node + TypeScript (Fastify, Kysely, pg-boss per i lavori in background)
  src/chess/        detector deterministici (fen -> fatti), valutazioni, temi
  src/modules/      auth, puzzles, storm, play, adaptive, analysis, games, imports,
                    openings, engine, knowledge, coach, profile
  src/cli/          migrate, seed-puzzles, seed-openings, kb-ingest, kb-index
services/engine   servizio HTTP interno con Stockfish 19 (coda a priorità, forza regolabile)
db/migrations     migrazioni SQL, applicate in ordine all'avvio dell'API
knowledge/        knowledge base: content/ in git (fonte di verità), sources/ esclusa
deploy/           esempio di configurazione nginx
```

## Sviluppo locale

Tutti i comandi si lanciano dentro `mcbe/`. Requisiti: Node 24 (`nvm use`), pnpm, Docker, `zstd`.

```bash
cp .env.example .env          # impostare password e JWT_SECRET (ADMIN_EMAILS per l'admin)
docker compose up -d db engine
pnpm install
pnpm db:migrate
pnpm seed:openings            # ~3.900 aperture da lichess-org/chess-openings
pnpm seed:puzzles             # dump puzzle Lichess (~300 MB compresso), ~20 minuti
pnpm kb:index                 # indicizza knowledge/content
pnpm --filter @cm/api dev     # API su http://localhost:3000
```

Opzioni di `seed:puzzles`: `--file <percorso .csv.zst>`, `--min-popularity N` (default 0),
`--min-plays N` (default 20). È ripetibile: aggiorna i puzzle esistenti.

Test (i test di integrazione usano un DB dedicato, che viene svuotato; il motore è simulato):

```bash
docker compose exec db psql -U chessmentor -c "CREATE DATABASE chessmentor_test"
TEST_DATABASE_URL=postgres://chessmentor:<pw>@localhost:5433/chessmentor_test pnpm test
```

## Servizi esterni (tutti facoltativi)

| Variabile | Senza | Con |
|---|---|---|
| `ANTHROPIC_API_KEY` | il coach mostra solo i fatti verificati; tagging KB a parole chiave | spiegazioni di Claude (`CLAUDE_MODEL_COACH`, default `claude-opus-5-5`), tagging e note di profilo con `CLAUDE_MODEL_CHEAP` (default `claude-haiku-4-5`) |
| `VOYAGE_API_KEY` | ricerca nella KB per tag + full-text di Postgres | ordinamento per somiglianza semantica (embedding 1024 dim) |
| `LICHESS_TOKEN` | opening explorer non disponibile (Lichess lo richiede): si usano le mosse di libro | statistiche delle mosse Lichess/maestri; import partite con limiti più alti |

Tablebase (≤7 pezzi) e import partite usano le API pubbliche di Lichess e Chess.com, con cache.

## Knowledge base

Vedi [knowledge/README.md](knowledge/README.md):

```bash
pnpm kb:ingest knowledge/sources/libro.pdf --title "..." --license "uso personale"
# rivedere i tag nel markdown generato, poi
pnpm kb:index
```

## Deploy sul VPS

```bash
docker compose up -d --build                          # db, api, engine con limiti di memoria
docker compose exec api node dist/cli/seed-openings.js
docker compose exec api node dist/cli/seed-puzzles.js
docker compose exec api node dist/cli/kb-index.js
```

L'API ascolta solo su `127.0.0.1:3000`; nginx sul host fa da reverse proxy e serve il
frontend (vedi `deploy/nginx.conf.example`). Budget RAM: db 640 MB, api 256 MB, engine 448 MB.
Fare backup periodici del DB (`pg_dump`): il profilo degli utenti non è ricostruibile.
