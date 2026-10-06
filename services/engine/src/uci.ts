import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

// Processo UCI singolo. Le ricerche sono serializzate dalla coda in queue.ts.

export interface Line {
  multipv: number;
  depth: number;
  /** centipedoni dal punto di vista del lato al tratto (null se matto) */
  cp: number | null;
  /** matto in N dal punto di vista del lato al tratto (negativo = subisce matto) */
  mate: number | null;
  pv: string[];
}

export interface SearchResult {
  bestmove: string | null;
  lines: Line[];
}

export interface SearchLimits {
  depth?: number;
  nodes?: number;
  movetime?: number;
}

export class UciEngine {
  private proc: ChildProcessWithoutNullStreams;
  private listeners = new Set<(line: string) => void>();
  private options = new Map<string, string>();

  constructor(path: string) {
    this.proc = spawn(path, [], { stdio: 'pipe' });
    createInterface({ input: this.proc.stdout }).on('line', (line) => {
      for (const l of this.listeners) l(line);
    });
  }

  send(cmd: string): void {
    this.proc.stdin.write(cmd + '\n');
  }

  /** Invia un comando e raccoglie le righe fino a quella che soddisfa `done`. */
  request(cmd: string, done: (line: string) => boolean, timeoutMs = 10_000): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const lines: string[] = [];
      const timer = setTimeout(() => {
        this.listeners.delete(onLine);
        if (cmd.startsWith('go')) this.send('stop');
        reject(new Error(`timeout UCI su "${cmd}"`));
      }, timeoutMs);
      const onLine = (line: string) => {
        lines.push(line);
        if (done(line)) {
          clearTimeout(timer);
          this.listeners.delete(onLine);
          resolve(lines);
        }
      };
      this.listeners.add(onLine);
      this.send(cmd);
    });
  }

  async init(options: Record<string, string | number>): Promise<string> {
    const lines = await this.request('uci', (l) => l === 'uciok');
    await this.setOptions(options);
    return lines.find((l) => l.startsWith('id name '))?.slice(8) ?? 'unknown';
  }

  /** Imposta solo le opzioni cambiate rispetto all'ultima ricerca. */
  async setOptions(options: Record<string, string | number | boolean>): Promise<void> {
    let changed = false;
    for (const [name, raw] of Object.entries(options)) {
      const value = String(raw);
      if (this.options.get(name) === value) continue;
      this.send(`setoption name ${name} value ${value}`);
      this.options.set(name, value);
      changed = true;
    }
    if (changed) await this.request('isready', (l) => l === 'readyok');
  }

  async search(fen: string, limits: SearchLimits, multipv = 1): Promise<SearchResult> {
    await this.setOptions({ MultiPV: multipv });
    this.send(`position fen ${fen}`);
    const go = [
      'go',
      limits.depth ? `depth ${limits.depth}` : '',
      limits.nodes ? `nodes ${limits.nodes}` : '',
      limits.movetime ? `movetime ${limits.movetime}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    const timeout = Math.max(15_000, (limits.movetime ?? 0) * 3);
    const out = await this.request(go, (l) => l.startsWith('bestmove'), timeout);
    return parseSearch(out);
  }

  onExit(cb: (code: number | null) => void): void {
    this.proc.on('exit', cb);
  }

  quit(): void {
    this.send('quit');
  }
}

/** Estrae per ogni multipv l'ultima riga `info` completa e la bestmove. */
export function parseSearch(lines: string[]): SearchResult {
  const byPv = new Map<number, Line>();
  let bestmove: string | null = null;
  for (const l of lines) {
    if (l.startsWith('bestmove')) {
      const m = l.split(' ')[1];
      bestmove = m && m !== '(none)' ? m : null;
      continue;
    }
    if (!l.startsWith('info ') || !l.includes(' pv ') || l.includes(' lowerbound') || l.includes(' upperbound')) {
      continue;
    }
    const tok = l.split(' ');
    const at = (k: string) => tok.indexOf(k);
    const depth = Number(tok[at('depth') + 1]);
    const multipv = at('multipv') >= 0 ? Number(tok[at('multipv') + 1]) : 1;
    const scoreType = tok[at('score') + 1];
    const scoreVal = Number(tok[at('score') + 2]);
    const pv = tok.slice(at('pv') + 1);
    byPv.set(multipv, {
      multipv,
      depth,
      cp: scoreType === 'cp' ? scoreVal : null,
      mate: scoreType === 'mate' ? scoreVal : null,
      pv,
    });
  }
  return { bestmove, lines: [...byPv.values()].sort((a, b) => a.multipv - b.multipv) };
}
