import { PgBoss } from 'pg-boss';
import type { Db } from '../db/index.js';
import type { GameAnalyzer } from '../modules/analysis/game-analysis.js';
import { generateProfileNote, usersNeedingNotes } from '../modules/profile/notes.js';

// Coda dei lavori in background (su Postgres): analisi partite, import, note di profilo.

export const ANALYZE_GAME = 'analyze-game';
export const PROFILE_NOTES = 'profile-notes';

export interface JobQueue {
  analyzeGame(gameId: string): Promise<void>;
  stop(): Promise<void>;
}

export async function startQueue(
  databaseUrl: string,
  db: Db,
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
  // note di profilo: ogni notte per gli utenti attivi
  await boss.createQueue(PROFILE_NOTES);
  await boss.schedule(PROFILE_NOTES, '30 4 * * *');
  await boss.work(PROFILE_NOTES, async () => {
    for (const userId of await usersNeedingNotes(db)) {
      await generateProfileNote(db, userId);
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
