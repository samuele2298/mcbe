import { describe, expect, it } from 'vitest';
import { defaultGlicko, updateGlicko } from '../src/lib/glicko2.js';

describe('updateGlicko', () => {
  it("riproduce l'esempio di Glickman (primo avversario)", () => {
    // Glickman 2012: giocatore 1500/200/0.06 contro 1400/30, vittoria
    const r = updateGlicko({ rating: 1500, rd: 200, vol: 0.06 }, { rating: 1400, rd: 30 }, 1);
    expect(r.rating).toBeGreaterThan(1550);
    expect(r.rating).toBeLessThan(1570);
    expect(r.rd).toBeLessThan(200);
  });

  it('vittoria alza, sconfitta abbassa', () => {
    const p = defaultGlicko();
    expect(updateGlicko(p, { rating: 1500, rd: 80 }, 1).rating).toBeGreaterThan(1500);
    expect(updateGlicko(p, { rating: 1500, rd: 80 }, 0).rating).toBeLessThan(1500);
  });

  it("perdere contro un puzzle molto facile costa più che contro uno difficile", () => {
    const p = { rating: 1500, rd: 100, vol: 0.06 };
    const easy = updateGlicko(p, { rating: 1000, rd: 80 }, 0).rating;
    const hard = updateGlicko(p, { rating: 2000, rd: 80 }, 0).rating;
    expect(1500 - easy).toBeGreaterThan(1500 - hard);
  });

  it("l'incertezza si riduce con i risultati", () => {
    let p = defaultGlicko();
    for (let i = 0; i < 20; i++) p = updateGlicko(p, { rating: 1500, rd: 80 }, (i % 2) as 0 | 1);
    expect(p.rd).toBeLessThan(120);
  });
});
