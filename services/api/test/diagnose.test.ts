import { describe, expect, it } from 'vitest';
import { diagnose } from '../src/modules/analysis/diagnose.js';

const line = (pv: string[], cp: number | null = 0, mate: number | null = null) => ({ multipv: 1, depth: 14, cp, mate, pv });

describe('diagnose', () => {
  it('matto mancato', () => {
    const d = diagnose({
      fenBefore: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',
      played: 'a1a2',
      best: 'a1a8',
      bestLine: line(['a1a8'], null, 1),
      replyLine: null,
      ply: 40,
    });
    expect(d.category).toBe('missed_mate');
  });

  it('forchetta mancata', () => {
    // Cc7+ forchetta re e torre
    const d = diagnose({
      fenBefore: 'r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1',
      played: 'e1e2',
      best: 'b5c7',
      bestLine: line(['b5c7', 'e8d7', 'c7a8'], 500),
      replyLine: line(['e8d7'], 0),
      ply: 30,
    });
    expect(d).toMatchObject({ category: 'missed_tactic', motif: 'fork' });
  });

  it('pezzo lasciato in presa', () => {
    // il Bianco gioca Cd5?? dove la donna nera lo cattura gratis
    const d = diagnose({
      fenBefore: '3qk3/8/8/8/8/2N5/8/4K3 w - - 0 1',
      played: 'c3d5',
      best: 'e1e2',
      bestLine: line(['e1e2'], -600),
      replyLine: line(['d8d5'], 900),
      ply: 30,
    });
    expect(d.category).toBe('hanging_piece');
  });
});
