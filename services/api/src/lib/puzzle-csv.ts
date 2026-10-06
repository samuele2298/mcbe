// Parser del dump puzzle di Lichess (database.lichess.org).
// Header: PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags[,...]
// Le colonne aggiunte in coda da Lichess nel tempo (es. DailyDate) vengono ignorate.

export interface PuzzleRow {
  id: string;
  fen: string;
  moves: string[];
  rating: number;
  ratingDev: number;
  popularity: number;
  nbPlays: number;
  themes: string[];
  gameUrl: string;
  openingTags: string[];
}

export const PUZZLE_CSV_HEADER =
  'PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags';

export function isSupportedHeader(line: string): boolean {
  return line.startsWith(PUZZLE_CSV_HEADER);
}

const words = (s: string | undefined) => (s ? s.split(' ').filter(Boolean) : []);

/** Restituisce null per righe malformate (o per l'header). */
export function parsePuzzleLine(line: string): PuzzleRow | null {
  const f = line.split(',');
  if (f.length < 10 || f[0] === 'PuzzleId') return null;
  const [id, fen, moves, rating, ratingDev, popularity, nbPlays, themes, gameUrl, openingTags] =
    f as [string, string, string, string, string, string, string, string, string, string];
  const row: PuzzleRow = {
    id,
    fen,
    moves: words(moves),
    rating: Number(rating),
    ratingDev: Number(ratingDev),
    popularity: Number(popularity),
    nbPlays: Number(nbPlays),
    themes: words(themes),
    gameUrl,
    openingTags: words(openingTags),
  };
  if (!id || !fen || row.moves.length < 2 || !Number.isFinite(row.rating)) return null;
  return row;
}

export interface PuzzleFilter {
  minPopularity: number;
  minPlays: number;
}

export function keepPuzzle(p: PuzzleRow, filter: PuzzleFilter): boolean {
  return p.popularity >= filter.minPopularity && p.nbPlays >= filter.minPlays;
}

// --- formato testo di COPY ---

function escapeCopy(value: string): string {
  return value.replace(/[\\\t\n\r]/g, (c) =>
    c === '\\' ? '\\\\' : c === '\t' ? '\\t' : c === '\n' ? '\\n' : '\\r',
  );
}

function arrayLiteral(items: string[]): string {
  // gli elementi (mosse UCI, temi, tag) sono alfanumerici/underscore: niente quoting
  return `{${items.map((i) => i.replace(/[{},"\\\s]/g, '')).join(',')}}`;
}

/** Colonne: id, fen, moves, rating, rating_dev, popularity, nb_plays, themes, opening_tags, game_url */
export function toCopyLine(p: PuzzleRow): string {
  return (
    [
      escapeCopy(p.id),
      escapeCopy(p.fen),
      escapeCopy(arrayLiteral(p.moves)),
      String(p.rating),
      String(p.ratingDev),
      String(p.popularity),
      String(p.nbPlays),
      escapeCopy(arrayLiteral(p.themes)),
      p.openingTags.length ? escapeCopy(arrayLiteral(p.openingTags)) : '\\N',
      p.gameUrl ? escapeCopy(p.gameUrl) : '\\N',
    ].join('\t') + '\n'
  );
}
