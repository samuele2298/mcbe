import { describe, expect, it } from 'vitest';
import { PriorityQueue } from '../src/queue.js';
import { blunderChance, pickMove, strengthOptions } from '../src/strength.js';
import { parseSearch } from '../src/uci.js';

describe('parseSearch', () => {
  it('prende l\'ultima riga per multipv e la bestmove', () => {
    const r = parseSearch([
      'info depth 1 seldepth 1 multipv 1 score cp 20 nodes 20 pv e2e4',
      'info depth 10 seldepth 14 multipv 1 score cp 35 nodes 9000 pv e2e4 e7e5 g1f3',
      'info depth 10 seldepth 12 multipv 2 score cp 28 nodes 9000 pv d2d4 d7d5',
      'info depth 11 seldepth 15 multipv 1 score cp 40 lowerbound nodes 10000 pv e2e4',
      'bestmove e2e4 ponder e7e5',
    ]);
    expect(r.bestmove).toBe('e2e4');
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toMatchObject({ depth: 10, cp: 35, mate: null, pv: ['e2e4', 'e7e5', 'g1f3'] });
  });

  it('gestisce matto e assenza di mosse', () => {
    const r = parseSearch(['info depth 5 multipv 1 score mate -2 pv h7h8', 'bestmove (none)']);
    expect(r.bestmove).toBeNull();
    expect(r.lines[0]!.mate).toBe(-2);
  });
});

describe('strength', () => {
  it('usa UCI_Elo da 1320 in su e Skill Level 0 sotto', () => {
    expect(strengthOptions(1600)).toMatchObject({ UCI_LimitStrength: true, UCI_Elo: 1600 });
    expect(strengthOptions(800)).toMatchObject({ UCI_LimitStrength: false, 'Skill Level': 0 });
    expect(strengthOptions(undefined)).toMatchObject({ UCI_LimitStrength: false });
    expect(blunderChance(1500)).toBe(0);
    expect(blunderChance(600)).toBeGreaterThan(0.4);
  });

  it('a Elo basso può scegliere un\'alternativa, ma mai una che subisce matto', () => {
    const result = {
      bestmove: 'a',
      lines: [
        { multipv: 1, depth: 10, cp: 100, mate: null, pv: ['a'] },
        { multipv: 2, depth: 10, cp: 20, mate: null, pv: ['b'] },
        { multipv: 3, depth: 10, cp: null, mate: -3, pv: ['c'] },
      ],
    };
    expect(pickMove(result, 600, () => 0)).toBe('b');
    expect(pickMove(result, 2000, () => 0)).toBe('a');
  });
});

describe('PriorityQueue', () => {
  it('esegue le richieste alte prima delle basse in attesa', async () => {
    const q = new PriorityQueue();
    const order: string[] = [];
    const wait = (id: string) => async () => {
      await new Promise((r) => setTimeout(r, 5));
      order.push(id);
    };
    const all = [q.run(wait('low1'), 'low'), q.run(wait('low2'), 'low'), q.run(wait('high'), 'high')];
    await Promise.all(all);
    expect(order).toEqual(['low1', 'high', 'low2']);
  });
});
