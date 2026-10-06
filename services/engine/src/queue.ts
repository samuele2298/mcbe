// Coda a due priorità per l'unica istanza di Stockfish: le richieste interattive
// (gioco, coach) passano davanti all'analisi in background.

type Task<T> = () => Promise<T>;

export class PriorityQueue {
  private high: Array<() => Promise<void>> = [];
  private low: Array<() => Promise<void>> = [];
  private running = false;

  get size(): number {
    return this.high.length + this.low.length + (this.running ? 1 : 0);
  }

  run<T>(task: Task<T>, priority: 'high' | 'low' = 'high'): Promise<T> {
    return new Promise((resolve, reject) => {
      const job = () => task().then(resolve, reject);
      (priority === 'high' ? this.high : this.low).push(job);
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const job = this.high.shift() ?? this.low.shift();
        if (!job) break;
        await job();
      }
    } finally {
      this.running = false;
    }
  }
}
