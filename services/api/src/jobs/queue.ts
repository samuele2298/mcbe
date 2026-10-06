import { PgBoss } from 'pg-boss';
import type { GameAnalyzer } from '../modules/analysis/game-analysis.js';

// Coda dei lavori in background (su Postgres): analisi partite, import, note di profilo.

export const ANALYZE_GAME = 'analyze-game';

export interface JobQueue {
  analyzeGame(gameId: string): Promise<void>;
  stop(): Promise<void>;
}

export async function startQueue(
  databaseUrl: string,
  analyzer: GameAnalyzer,
  log: { info: (m: string) => void; error: (o: unknown, m: string) => void },
  extraWorkers: (boss: PgBoss) => Promise<void> = async () => {},
): Promise<JobQueue & { boss: PgBoss }> {
  const boss = new PgBoss({ connectionString: databaseUrl, max: 3 });
  boss.on('error', (err) => log.error(err, 'pg-boss'));
  await boss.start();
  await boss.createQueue(ANALYZE_GAME, { retryLimit: 2, retryDelay: 30 });
  await boss.work<{ gameId: string }>(ANALYZE_GAME, async (jobs) => {
    for (const job of jobs) {
      log.info(`analisi partita ${job.data.gameId}`);
      await analyzer.analyzeGame(job.data.gameId);
    }
  });
  await extraWorkers(boss);
  return {
    boss,
    async analyzeGame(gameId) {
      await boss.send(ANALYZE_GAME, { gameId }, { singletonKey: gameId });
    },
    async stop() {
      await boss.stop({ graceful: true, timeout: 10_000 });
    },
  };
}
