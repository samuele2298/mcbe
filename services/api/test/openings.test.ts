import { describe, expect, it } from 'vitest';
import { fenToEpd, parseOpeningLine } from '../src/lib/openings.js';

describe('parseOpeningLine', () => {
  it('calcola UCI ed EPD dal PGN', () => {
    const o = parseOpeningLine("D35\tQueen's Gambit Declined: Exchange Variation\t1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. cxd5")!;
    expect(o.uci).toBe('d2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c4d5');
    expect(o.ply).toBe(7);
    expect(o.epd).toBe('rnbqkb1r/ppp2ppp/4pn2/3P4/3P4/2N5/PP2PPPP/R1BQKBNR b KQkq -');
  });

  it('ignora header', () => {
    expect(parseOpeningLine('eco\tname\tpgn')).toBeNull();
  });
});

describe('fenToEpd', () => {
  it('toglie i contatori', () => {
    expect(fenToEpd('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1')).toBe(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -',
    );
  });
});
