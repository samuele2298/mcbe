import { describe, expect, it } from 'vitest';
import { parseChesscomGame, parseLichessGame, sanMovesToUci, START_FEN } from '../src/modules/imports/parse.js';

describe('import partite', () => {
  it('Lichess: colore, risultato, mosse in UCI', () => {
    const g = parseLichessGame(
      {
        id: 'abc',
        variant: 'standard',
        status: 'mate',
        winner: 'black',
        createdAt: 1700000000000,
        moves: 'f3 e5 g4 Qh4#',
        players: { white: { user: { name: 'Sam' }, rating: 1500 }, black: { user: { name: 'Opp' }, rating: 1600 } },
      },
      'sam',
    )!;
    expect(g).toMatchObject({ externalId: 'abc', userColor: 'white', result: '0-1', opponentName: 'Opp', opponentElo: 1600 });
    expect(g.moves).toEqual(['f2f3', 'e7e5', 'g2g4', 'd8h4']);
  });

  it('Lichess: ignora varianti, partite di altri e in corso', () => {
    const base = { id: 'x', moves: 'e4 e5', players: { white: { user: { name: 'A' } }, black: { user: { name: 'B' } } } };
    expect(parseLichessGame({ ...base, variant: 'chess960', status: 'mate' }, 'A')).toBeNull();
    expect(parseLichessGame({ ...base, variant: 'standard', status: 'mate' }, 'C')).toBeNull();
    expect(parseLichessGame({ ...base, variant: 'standard', status: 'started' }, 'A')).toBeNull();
  });

  it('Chess.com: PGN, risultato e terminazione', () => {
    const g = parseChesscomGame(
      {
        rules: 'chess',
        url: 'https://www.chess.com/game/live/123',
        end_time: 1700000000,
        pgn: '[Event "Live"]\n[White "sam"]\n[Black "opp"]\n[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0',
        white: { username: 'Sam', rating: 1400, result: 'win' },
        black: { username: 'opp', rating: 1450, result: 'checkmated' },
      },
      'sam',
    )!;
    expect(g).toMatchObject({ externalId: '123', userColor: 'white', result: '1-0', termination: 'checkmated', opponentElo: 1450 });
    expect(g.moves).toHaveLength(7);
  });

  it('SAN non valide', () => {
    expect(sanMovesToUci(START_FEN, ['e4', 'Ke3'])).toBeNull();
  });
});
