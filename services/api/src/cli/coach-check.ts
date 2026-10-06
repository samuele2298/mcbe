import { randomUUID } from 'node:crypto';
import { createDb, createPool } from '../db/index.js';
import { createEmbedder } from '../lib/embedder.js';
import { claudeConfigured, claudeModels } from '../lib/claude.js';
import { CoachService } from '../modules/coach/service.js';
import { EngineClient } from '../modules/engine/client.js';
import { TablebaseClient } from '../modules/engine/tablebase.js';
import { KnowledgeRetriever } from '../modules/knowledge/retrieval.js';

// Verifica della pipeline del coach su una posizione, senza utente e senza salvataggi.
//   node --env-file=... dist/cli/coach-check.js "<FEN>" ["domanda"]

const fen = process.argv[2] ?? '3K4/3P1k2/8/8/8/8/1r6/4R3 w - - 0 1';
const question = process.argv[3];
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL mancante');
const pool = createPool(url, 2);
const db = createDb(pool);
try {
  console.log(`Claude configurato: ${claudeConfigured()} (modello ${claudeModels.coach})`);
  const coach = new CoachService(
    db,
    new EngineClient(process.env.ENGINE_URL ?? 'http://localhost:4000', db),
    new TablebaseClient(db),
    new KnowledgeRetriever(db, createEmbedder()),
  );
  const started = Date.now();
  const r = await coach.explain(randomUUID(), { fen, ...(question ? { question } : {}) }, { dryRun: true });
  console.log(JSON.stringify({ ai: r.ai, model: r.model, notice: r.notice, concept: r.concept, explanation: r.explanation, plan: r.plan, missingKnowledge: r.missingKnowledge, usesUnverified: r.usesUnverified, sources: r.sources.map((s) => s.heading) }, null, 2));
  console.log(`tempo: ${((Date.now() - started) / 1000).toFixed(1)} s`);
} finally {
  await db.destroy();
}
