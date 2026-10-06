import { Chess } from 'chess.js';

// Righe dei file a.tsv..e.tsv di github.com/lichess-org/chess-openings: eco \t name \t pgn

export interface OpeningRow {
  eco: string;
  name: string;
  pgn: string;
  uci: string;
  epd: string;
  ply: number;
}

/** EPD = i primi 4 campi della FEN (senza contatori di mosse). */
export function fenToEpd(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

export function parseOpeningLine(line: string): OpeningRow | null {
  const [eco, name, pgn] = line.split('\t');
  if (!eco || !name || !pgn || eco === 'eco') return null;
  const chess = new Chess();
  chess.loadPgn(pgn);
  const history = chess.history({ verbose: true });
  return {
    eco,
    name,
    pgn,
    uci: history.map((m) => m.from + m.to + (m.promotion ?? '')).join(' '),
    epd: fenToEpd(chess.fen()),
    ply: history.length,
  };
}
