import { UciEngine } from './uci.js';

// Fase 0: verifica che Stockfish parta e resti disponibile.
// La coda di analisi (pg-boss) arriva nella Fase 2.

const path = process.env.STOCKFISH_PATH ?? 'stockfish';
const options = {
  Hash: Number(process.env.STOCKFISH_HASH_MB ?? 64),
  Threads: Number(process.env.STOCKFISH_THREADS ?? 1),
};

const engine = new UciEngine(path);
engine.onExit((code) => {
  console.error(`stockfish terminato (code ${code})`);
  process.exit(1);
});

const name = await engine.init(options);
console.log(`engine pronto: ${name} (hash ${options.Hash} MB, threads ${options.Threads})`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    engine.quit();
    process.exit(0);
  });
}

// mantiene vivo il processo finché non arriva la coda di job
setInterval(() => {}, 1 << 30);
