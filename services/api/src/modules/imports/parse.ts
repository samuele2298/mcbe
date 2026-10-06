import { Chess } from 'chess.js';

// Normalizzazione delle partite importate in un formato unico.

export interface ImportedGame {
  externalId: string;
  pgn: string;
  startFen: string;
  moves: string[];
  userColor: 'white' | 'black';
  result: '1-0' | '0-1' | '1/2-1/2';
  termination: string;
  opponentName: string;
  opponentElo: number | null;
  playedAt: Date;
}

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** SAN separati da spazi -> UCI (null se una mossa non è valida). */
export function sanMovesToUci(startFen: string, sans: string[]): string[] | null {
  const c = new Chess(startFen);
  const out: string[] = [];
  for (const san of sans) {
    try {
      const m = c.move(san);
      out.push(m.from + m.to + (m.promotion ?? ''));
    } catch {
      return null;
    }
  }
  return out;
}

/** Partita dall'API ndjson di Lichess (/api/games/user). */
export function parseLichessGame(j: Record<string, unknown>, username: string): ImportedGame | null {
  if (j.variant !== 'standard' || typeof j.moves !== 'string' || !j.moves) return null;
  const players = j.players as Record<'white' | 'black', { user?: { name: string }; rating?: number; aiLevel?: number }>;
  const whiteName = players.white.user?.name ?? (players.white.aiLevel ? `Stockfish ${players.white.aiLevel}` : '?');
  const blackName = players.black.user?.name ?? (players.black.aiLevel ? `Stockfish ${players.black.aiLevel}` : '?');
  const me = username.toLowerCase();
  const userColor = whiteName.toLowerCase() === me ? 'white' : blackName.toLowerCase() === me ? 'black' : null;
  if (!userColor) return null;
  const status = String(j.status ?? '');
  if (['created', 'started', 'aborted', 'noStart', 'unknownFinish'].includes(status)) return null;
  const startFen = typeof j.initialFen === 'string' ? j.initialFen : START_FEN;
  const moves = sanMovesToUci(startFen, j.moves.split(' '));
  if (!moves || moves.length < 2) return null;
  const winner = j.winner as 'white' | 'black' | undefined;
  const opp = userColor === 'white' ? players.black : players.white;
  return {
    externalId: String(j.id),
    pgn: typeof j.pgn === 'string' ? j.pgn : '',
    startFen,
    moves,
    userColor,
    result: winner === 'white' ? '1-0' : winner === 'black' ? '0-1' : '1/2-1/2',
    termination: status,
    opponentName: userColor === 'white' ? blackName : whiteName,
    opponentElo: opp.rating ?? null,
    playedAt: new Date(Number(j.createdAt ?? Date.now())),
  };
}

/** Partita dall'API pubblica di Chess.com (archivi mensili). */
export function parseChesscomGame(j: Record<string, unknown>, username: string): ImportedGame | null {
  if (j.rules !== 'chess' || typeof j.pgn !== 'string') return null;
  const white = j.white as { username: string; rating?: number; result: string };
  const black = j.black as { username: string; rating?: number; result: string };
  const me = username.toLowerCase();
  const userColor = white.username.toLowerCase() === me ? 'white' : black.username.toLowerCase() === me ? 'black' : null;
  if (!userColor) return null;
  const c = new Chess();
  try {
    c.loadPgn(j.pgn);
  } catch {
    return null;
  }
  const header = c.getHeaders();
  const startFen = header.FEN ?? START_FEN;
  const history = c.history({ verbose: true });
  if (history.length < 2) return null;
  const result = white.result === 'win' ? '1-0' : black.result === 'win' ? '0-1' : '1/2-1/2';
  const loser = white.result === 'win' ? black.result : black.result === 'win' ? white.result : white.result;
  const opp = userColor === 'white' ? black : white;
  const url = String(j.url ?? '');
  return {
    externalId: url.split('/').pop() || String(j.uuid ?? url),
    pgn: j.pgn,
    startFen,
    moves: history.map((m) => m.from + m.to + (m.promotion ?? '')),
    userColor,
    result,
    termination: loser,
    opponentName: opp.username,
    opponentElo: opp.rating ?? null,
    playedAt: new Date(Number(j.end_time ?? 0) * 1000),
  };
}
