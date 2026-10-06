import { describe, expect, it } from 'vitest';
import { load } from '../src/chess/detectors/board.js';
import { kpk, rookPawn } from '../src/chess/detectors/endgame.js';
import { analyzePosition } from '../src/chess/detectors/index.js';
import { endgameType, material, phase } from '../src/chess/detectors/material.js';
import { classifyStructure, pawnInfo } from '../src/chess/detectors/pawns.js';
import {
  backRankWeak,
  forks,
  hangingPieces,
  mateThreats,
  matesInOne,
  pins,
  skewers,
} from '../src/chess/detectors/tactics.js';

const keys = (fen: string) => classifyStructure(load(fen)).map((s) => `${s.key}:${s.side}`);

describe('materiale e fase', () => {
  it('posizione iniziale: apertura, materiale pari', () => {
    const m = material(load('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'));
    expect(m.balance).toBe(0);
    expect(phase(m, 1)).toBe('opening');
  });

  it('finale di torre e pedone', () => {
    const m = material(load('8/8/8/4k3/8/4P3/4K3/r6R w - - 0 50'));
    expect(phase(m, 50)).toBe('endgame');
    expect(endgameType(m)).toBe('rook_pawn');
  });

  it('coppia degli alfieri', () => {
    expect(material(load('4k3/8/8/8/8/8/8/2B1KB2 w - - 0 1')).bishopPair).toBe('w');
  });
});

describe('strutture pedonali', () => {
  it('Carlsbad (scambio del Gambetto di donna)', () => {
    // 1.d4 d5 2.c4 e6 3.Nc3 Nf6 4.cxd5 exd5
    expect(keys('rnbqkb1r/ppp2ppp/5n2/3p4/3P4/2N5/PP2PPPP/R1BQKBNR w KQkq - 0 5')).not.toContain('carlsbad:w');
    expect(keys('r1bqkb1r/pp3ppp/2p2n2/3p4/3P4/2N1P3/PP3PPP/R1BQKBNR w KQkq - 0 7')).toContain('carlsbad:w');
  });

  it('IQP', () => {
    expect(keys('r1bq1rk1/pp2bppp/2n2n2/3p4/3P4/2N2N2/PP2BPPP/R1BQ1RK1 w - - 0 10')).toContain('iqp:w');
  });

  it('catena francese', () => {
    expect(keys('rnbqkbnr/pp3ppp/4p3/2ppP3/3P4/8/PPP2PPP/RNBQKBNR w KQkq - 0 4')).toContain('french:null');
  });

  it('pedoni isolati, doppiati e passati', () => {
    const info = pawnInfo(load('4k3/8/8/3P4/8/2P5/2P5/4K3 w - - 0 1'), 'w');
    expect(info.doubled.sort()).toEqual(['c2', 'c3']);
    expect(info.passed).toContain('d5');
  });
});

describe('tattica', () => {
  it('pezzo indifeso attaccato', () => {
    const h = hangingPieces(load('4k3/8/8/3n4/8/8/8/3RK3 b - - 0 1'), 'b');
    expect(h.map((x) => x.piece.square)).toEqual(['d5']);
  });

  it('pezzo difeso attaccato da un pezzo minore', () => {
    const h = hangingPieces(load('4k3/8/2p5/3q4/4P3/8/8/4K3 b - - 0 1'), 'b');
    expect(h.map((x) => `${x.piece.square}:${x.reason}`)).toEqual(['d5:cheaper_attacker']);
  });

  it('forchetta di cavallo su re e donna', () => {
    const f = forks(load('q3k3/2N5/8/8/8/8/8/4K3 b - - 0 1'), 'w');
    expect(f).toHaveLength(1);
    expect(f[0]!.targets.map((t) => t.type).sort()).toEqual(['k', 'q']);
  });

  it('inchiodatura assoluta e infilata', () => {
    expect(pins(load('4k3/4n3/8/8/8/8/8/4RK2 b - - 0 1'), 'b')[0]).toMatchObject({ absolute: true, front: { square: 'e7' } });
    const sk = skewers(load('4k3/8/8/8/4q3/8/8/B3K3 b - - 0 1'), 'b');
    expect(sk).toHaveLength(0); // donna non sulla diagonale dell'alfiere con il re
    const sk2 = skewers(load('6k1/8/8/8/8/2q5/8/B3K3 b - - 0 1'), 'b');
    expect(sk2).toHaveLength(0);
    const sk3 = skewers(load('7r/8/8/8/3k4/8/1B6/4K3 b - - 0 1'), 'b');
    expect(sk3[0]).toMatchObject({ front: { type: 'k' }, behind: { square: 'h8' } });
  });

  it('matto in una e minaccia di matto sulla traversa', () => {
    const fen = '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1';
    expect(matesInOne(fen)).toEqual(['a1a8']);
    expect(backRankWeak(load(fen), 'b')).toBe(true);
    expect(mateThreats('6k1/5ppp/8/8/8/8/8/R5K1 b - - 0 1', 'w')).toEqual(['a1a8']);
  });
});

describe('finali', () => {
  it('regola del quadrato', () => {
    // pedone a5, re nero in e5: con il Bianco al tratto il re è fuori dal quadrato
    expect(kpk(load('8/8/8/P3k3/8/8/8/K7 w - - 0 1'))!.defenderInSquare).toBe(false);
    expect(kpk(load('8/8/8/P2k4/8/8/8/K7 w - - 0 1'))!.defenderInSquare).toBe(true);
  });

  it('opposizione e case chiave', () => {
    const f = kpk(load('8/8/4k3/8/4K3/4P3/8/8 b - - 0 1'))!;
    expect(f.opposition).toBe('w');
    expect(f.oppositionKind).toBe('direct');
    expect(f.keySquares).toEqual(expect.arrayContaining(['d5', 'e5', 'f5']));
  });

  it('Lucena e Philidor', () => {
    expect(rookPawn(load('3K4/3P1k2/8/8/8/8/1r6/4R3 w - - 0 1'))!.lucena).toBe(true);
    expect(rookPawn(load('3k4/7r/8/3PK3/8/8/8/R7 b - - 0 1'))).toMatchObject({ philidor: false });
    expect(rookPawn(load('3k4/8/7r/3PK3/8/8/8/R7 b - - 0 1'))).toMatchObject({ philidor: true });
  });
});

describe('analyzePosition', () => {
  it('riassume i fatti in italiano con i tag', () => {
    const f = analyzePosition('3K4/3P1k2/8/8/8/8/1r6/4R3 w - - 0 1');
    expect(f.phase).toBe('endgame');
    expect(f.tags.themes).toContain('rookEndgame');
    expect(f.summary.join(' ')).toContain('Lucena');
    expect(f.tags.structures).toEqual([]);
  });
});
