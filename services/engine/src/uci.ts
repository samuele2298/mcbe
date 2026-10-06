import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

// Wrapper minimale di un processo UCI. Nella Fase 2 diventa il pool con coda di analisi.

export class UciEngine {
  private proc: ChildProcessWithoutNullStreams;
  private listeners = new Set<(line: string) => void>();

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
    for (const [name, value] of Object.entries(options)) {
      this.send(`setoption name ${name} value ${value}`);
    }
    await this.request('isready', (l) => l === 'readyok');
    return lines.find((l) => l.startsWith('id name '))?.slice(8) ?? 'unknown';
  }

  onExit(cb: (code: number | null) => void): void {
    this.proc.on('exit', cb);
  }

  quit(): void {
    this.send('quit');
  }
}
