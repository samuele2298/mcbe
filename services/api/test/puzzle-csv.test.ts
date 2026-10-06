import { describe, expect, it } from 'vitest';
import { keepPuzzle, parsePuzzleLine, toCopyLine } from '../src/lib/puzzle-csv.js';

const line =
  '00008,r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24,f2g3 e6e7 b2b1 b3c1 b1c1 h6c1,1913,76,95,8016,crushing hangingPiece long middlegame,https://lichess.org/787zsVup/black#47,';

describe('parsePuzzleLine', () => {
  it('legge una riga del dump', () => {
    const p = parsePuzzleLine(line)!;
    expect(p.id).toBe('00008');
    expect(p.moves).toEqual(['f2g3', 'e6e7', 'b2b1', 'b3c1', 'b1c1', 'h6c1']);
    expect(p.rating).toBe(1913);
    expect(p.popularity).toBe(95);
    expect(p.nbPlays).toBe(8016);
    expect(p.themes).toEqual(['crushing', 'hangingPiece', 'long', 'middlegame']);
    expect(p.openingTags).toEqual([]);
  });

  it('ignora colonne aggiunte in coda (DailyDate)', () => {
    const p = parsePuzzleLine(line + ',2024-01-01')!;
    expect(p.id).toBe('00008');
    expect(p.openingTags).toEqual([]);
  });

  it('ignora header e righe malformate', () => {
    expect(parsePuzzleLine('PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags')).toBeNull();
    expect(parsePuzzleLine('')).toBeNull();
    expect(parsePuzzleLine('a,b,c')).toBeNull();
  });
});

describe('keepPuzzle', () => {
  it('filtra per popolarità e partite giocate', () => {
    const p = parsePuzzleLine(line)!;
    expect(keepPuzzle(p, { minPopularity: 0, minPlays: 20 })).toBe(true);
    expect(keepPuzzle(p, { minPopularity: 96, minPlays: 20 })).toBe(false);
    expect(keepPuzzle(p, { minPopularity: 0, minPlays: 10_000 })).toBe(false);
  });
});

describe('toCopyLine', () => {
  it('produce una riga COPY con array e NULL', () => {
    const cols = toCopyLine(parsePuzzleLine(line)!).trimEnd().split('\t');
    expect(cols).toHaveLength(10);
    expect(cols[2]).toBe('{f2g3,e6e7,b2b1,b3c1,b1c1,h6c1}');
    expect(cols[7]).toBe('{crushing,hangingPiece,long,middlegame}');
    expect(cols[8]).toBe('\\N');
  });

  it('mantiene i tag apertura', () => {
    const withTags = line.replace(/,$/, ',Sicilian_Defense Sicilian_Defense_Najdorf_Variation');
    const cols = toCopyLine(parsePuzzleLine(withTags)!).trimEnd().split('\t');
    expect(cols[8]).toBe('{Sicilian_Defense,Sicilian_Defense_Najdorf_Variation}');
  });
});
