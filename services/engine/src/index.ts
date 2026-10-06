import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { PriorityQueue } from './queue.js';
import { pickMove, strengthOptions } from './strength.js';
import { UciEngine } from './uci.js';

// Servizio HTTP interno (rete del compose, non esposto): una sola istanza di Stockfish
// dietro una coda a priorità.
//
//   POST /analyse { fen, depth?, nodes?, movetime?, multipv?, priority? }
//   POST /move    { fen, elo?, movetime? }
//   GET  /health

const path = process.env.STOCKFISH_PATH ?? 'stockfish';
const port = Number(process.env.ENGINE_PORT ?? 4000);
const baseOptions = {
  Hash: Number(process.env.STOCKFISH_HASH_MB ?? 64),
  Threads: Number(process.env.STOCKFISH_THREADS ?? 1),
};
const MAX_DEPTH = 24;
const MAX_MOVETIME = 5000;
const MAX_NODES = 5_000_000;

const engine = new UciEngine(path);
engine.onExit((code) => {
  console.error(`stockfish terminato (code ${code})`);
  process.exit(1);
});
const name = await engine.init(baseOptions);
const queue = new PriorityQueue();

const FEN_RE = /^[1-8pnbrqkPNBRQK/]+ [wb] (-|[KQkq]{1,4}) (-|[a-h][36]) \d+ \d+$/;

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 10_000) throw new Error('body troppo grande');
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const num = (v: unknown, max: number) =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(Math.round(v), max) : undefined;

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      return send(res, 200, { status: 'ok', engine: name, queue: queue.size });
    }
    if (req.method !== 'POST') return send(res, 404, { error: 'not_found' });
    const body = await readJson(req);
    const fen = typeof body.fen === 'string' ? body.fen.trim() : '';
    if (!FEN_RE.test(fen)) return send(res, 400, { error: 'invalid_fen' });

    if (req.url === '/analyse') {
      const limits = {
        depth: num(body.depth, MAX_DEPTH),
        nodes: num(body.nodes, MAX_NODES),
        movetime: num(body.movetime, MAX_MOVETIME),
      };
      if (!limits.depth && !limits.nodes && !limits.movetime) limits.depth = 18;
      const multipv = num(body.multipv, 5) ?? 1;
      const priority = body.priority === 'low' ? 'low' : 'high';
      const result = await queue.run(async () => {
        await engine.setOptions(strengthOptions(undefined));
        return engine.search(fen, limits, multipv);
      }, priority);
      return send(res, 200, result);
    }

    if (req.url === '/move') {
      const elo = num(body.elo, 3190);
      const movetime = num(body.movetime, MAX_MOVETIME) ?? 300;
      const result = await queue.run(async () => {
        await engine.setOptions(strengthOptions(elo));
        // sotto i 1320 Elo servono alternative tra cui "sbagliare"
        const multipv = elo !== undefined && elo < 1320 ? 4 : 1;
        return engine.search(fen, { movetime }, multipv);
      });
      return send(res, 200, { bestmove: pickMove(result, elo), lines: result.lines });
    }

    return send(res, 404, { error: 'not_found' });
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: (err as Error).message });
  }
});

server.listen(port, process.env.ENGINE_HOST ?? '0.0.0.0', () => {
  console.log(`engine pronto: ${name} su :${port} (hash ${baseOptions.Hash} MB, threads ${baseOptions.Threads})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close();
    engine.quit();
    process.exit(0);
  });
}
