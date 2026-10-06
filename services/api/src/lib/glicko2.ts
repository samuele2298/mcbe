// Glicko-2 (Glickman, 2012) per un singolo risultato: utente contro puzzle.
// Il puzzle fa da "avversario" con il suo rating e la sua deviazione.

export interface Glicko {
  rating: number;
  rd: number;
  vol: number;
}

const SCALE = 173.7178;
const TAU = 0.5;
const EPS = 1e-6;
export const MIN_RD = 45;
export const MAX_RD = 350;

export function defaultGlicko(): Glicko {
  return { rating: 1500, rd: MAX_RD, vol: 0.06 };
}

/** score: 1 vittoria (puzzle risolto), 0 sconfitta. */
export function updateGlicko(
  player: Glicko,
  opponent: { rating: number; rd: number },
  score: 0 | 1,
): Glicko {
  const mu = (player.rating - 1500) / SCALE;
  const phi = player.rd / SCALE;
  const muJ = (opponent.rating - 1500) / SCALE;
  const phiJ = opponent.rd / SCALE;

  const g = 1 / Math.sqrt(1 + (3 * phiJ * phiJ) / (Math.PI * Math.PI));
  const e = 1 / (1 + Math.exp(-g * (mu - muJ)));
  const v = 1 / (g * g * e * (1 - e));
  const delta = v * g * (score - e);

  // nuova volatilità (algoritmo di Illinois)
  const a = Math.log(player.vol * player.vol);
  const f = (x: number) => {
    const ex = Math.exp(x);
    return (
      (ex * (delta * delta - phi * phi - v - ex)) / (2 * (phi * phi + v + ex) ** 2) -
      (x - a) / (TAU * TAU)
    );
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }
  let fA = f(A);
  let fB = f(B);
  for (let i = 0; i < 100 && Math.abs(B - A) > EPS; i++) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }
  const vol = Math.exp(A / 2);

  const phiStar = Math.sqrt(phi * phi + vol * vol);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * g * (score - e);

  return {
    rating: newMu * SCALE + 1500,
    rd: Math.min(MAX_RD, Math.max(MIN_RD, newPhi * SCALE)),
    vol,
  };
}
