# Knowledge base

- `content/` — **fonte di verità**, markdown in git. Il database è un indice ricostruibile da qui.
- `sources/` — originali (PDF, pagine salvate, PGN): esclusa da git.

## Flusso

```bash
pnpm kb:ingest knowledge/sources/libro.pdf --title "..." --license "uso personale"   # -> content/books/<slug>.md
# rivedere i tag nel file (git diff), correggere, impostare verified: true se affidabile
pnpm kb:index            # indicizza solo i file cambiati (con VOYAGE_API_KEY calcola anche gli embedding)
pnpm kb:index --rebuild  # reindicizza tutto
```

## Formato

```markdown
---
title: Finali di torre
source_type: note          # book | article | pgn | note | wikibooks
source: Note personali
license: propria
verified: false
tags: phase=endgame        # tag di default per tutte le sezioni (facoltativo)
---

## Posizione di Lucena
<!-- tags: endgame_type=rook_pawn; themes=lucena,rookEndgame; level=1300-2200 -->
Testo...
```

Chiavi dei tag:

| tag | valori |
|---|---|
| `phase` | `opening`, `middlegame`, `endgame` |
| `endgame_type` | `pawn`, `rook`, `rook_pawn`, `minor`, `queen`, `mixed` |
| `structures` | `iqp`, `hanging_pawns`, `carlsbad`, `maroczy`, `french`, `kings_indian`, `stonewall`, `open_center`, `closed_center` |
| `themes` | temi Lichess (`fork`, `pin`, `skewer`, ...) e concetti (`lucena`, `philidor`, `opposition`, `square_rule`, `key_squares`, `minority_attack`, `outpost`, `bishop_pair`, `open_file`, ...) — elenco completo in `services/api/src/modules/knowledge/tagger.ts` |
| `eco` | codici ECO, es. `D35,D36` |
| `level` | fascia Elo, es. `1200-1800` |
| `fen` | EPD della posizione (usato per i commenti dei PGN) |

I contenuti iniziali in `content/` sono note di base scritte per il progetto (`verified: false`):
il coach li segnala come "da confermare" finché non vengono rivisti.
