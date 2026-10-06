# mcbe — backend Chess Mentor

Mentore di scacchi: puzzle, Storm, gioco contro il computer con analisi, coach AI basato su
fatti verificati. Specifica completa in [SPEC.md](SPEC.md).

## Struttura

```
services/api      API Node + TypeScript (Fastify, Kysely)
services/engine   worker Stockfish (UCI)
db/migrations     migrazioni SQL, applicate in ordine all'avvio dell'API
knowledge/        knowledge base (content/ in git, sources/ esclusa)
deploy/           esempio di configurazione nginx
```

## Sviluppo locale

Tutti i comandi si lanciano dentro `mcbe/`. Requisiti: Node 24 (`nvm use`), pnpm, Docker, `zstd` (per l'import dei puzzle).

```bash
cp .env.example .env          # impostare password e JWT_SECRET
docker compose up -d db
pnpm install
pnpm db:migrate
pnpm seed:openings            # ~3.900 aperture da lichess-org/chess-openings
pnpm seed:puzzles             # dump puzzle Lichess (~300 MB compresso), in streaming
pnpm --filter @cm/api dev     # API su http://localhost:3000, docs su /docs
```

Opzioni di `seed:puzzles`: `--file <percorso .csv.zst>`, `--min-popularity N` (default 0),
`--min-plays N` (default 20). È ripetibile: aggiorna i puzzle esistenti.

Test (i test di integrazione richiedono un DB dedicato, che viene svuotato):

```bash
docker compose exec db psql -U chessmentor -c "CREATE DATABASE chessmentor_test"
TEST_DATABASE_URL=postgres://chessmentor:<pw>@localhost:5433/chessmentor_test pnpm test
```

## Deploy sul VPS

```bash
docker compose up -d --build                         # db, api, engine con limiti di memoria
docker compose exec api node dist/cli/seed-openings.js
docker compose exec api node dist/cli/seed-puzzles.js
```

L'API ascolta solo su `127.0.0.1:3000`; nginx sul host fa da reverse proxy
(vedi `deploy/nginx.conf.example`). Budget RAM: db 640 MB, api 256 MB, engine 256 MB.
