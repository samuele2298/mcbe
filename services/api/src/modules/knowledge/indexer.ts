import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { sql } from 'kysely';
import type { Db } from '../../db/index.js';
import { toPgVector, type Embedder } from '../../lib/embedder.js';
import { estimateTokens, hashText, mergeTags, parseDocument, splitBody } from './format.js';

// Indicizzazione: knowledge/content (fonte di verità in git) -> knowledge_docs/knowledge_chunks.
// Solo i file cambiati vengono reindicizzati (hash del contenuto).

export const defaultKnowledgeDir = path.resolve(import.meta.dirname, '../../../../../knowledge');

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.name.endsWith('.md') && e.name.toLowerCase() !== 'readme.md') out.push(p);
  }
  return out;
}

export interface IndexReport {
  indexed: string[];
  unchanged: number;
  removed: string[];
  chunks: number;
  embedded: number;
}

export async function indexKnowledge(
  db: Db,
  embedder: Embedder | null,
  opts: { dir?: string; rebuild?: boolean; log?: (m: string) => void } = {},
): Promise<IndexReport> {
  const contentDir = path.join(opts.dir ?? process.env.KNOWLEDGE_DIR ?? defaultKnowledgeDir, 'content');
  const log = opts.log ?? (() => {});
  const files = await walk(contentDir);
  const report: IndexReport = { indexed: [], unchanged: 0, removed: [], chunks: 0, embedded: 0 };
  const seen = new Set<string>();

  for (const file of files) {
    const rel = path.relative(contentDir, file);
    seen.add(rel);
    const text = await readFile(file, 'utf8');
    const hash = hashText(text);
    const existing = await db.selectFrom('knowledge_docs').select(['id', 'content_hash']).where('path', '=', rel).executeTakeFirst();
    if (existing && existing.content_hash === hash && !opts.rebuild) {
      report.unchanged++;
      continue;
    }
    const doc = parseDocument(text, path.basename(rel, '.md'));
    await db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('knowledge_docs')
        .values({
          path: rel,
          title: doc.title,
          source_type: doc.sourceType,
          source_ref: doc.source,
          license: doc.license,
          verified: doc.verified,
          content_hash: hash,
        })
        .onConflict((oc) =>
          oc.column('path').doUpdateSet({
            title: doc.title,
            source_type: doc.sourceType,
            source_ref: doc.source,
            license: doc.license,
            verified: doc.verified,
            content_hash: hash,
            indexed_at: new Date(),
          }),
        )
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx.deleteFrom('knowledge_chunks').where('doc_id', '=', row.id).execute();
      let position = 0;
      for (const s of doc.sections) {
        const tags = mergeTags(doc.defaults, s.tags);
        const pieces = splitBody(s.body);
        for (const [i, body] of pieces.entries()) {
          await trx
            .insertInto('knowledge_chunks')
            .values({
              doc_id: row.id,
              position: position++,
              heading: pieces.length > 1 ? `${s.heading} (${i + 1}/${pieces.length})` : s.heading,
              content: body,
              token_count: estimateTokens(body),
              eco: tags.eco ?? [],
              structures: tags.structures ?? [],
              themes: tags.themes ?? [],
              phase: tags.phase ?? null,
              endgame_type: tags.endgame_type ?? null,
              fen: tags.fen ?? null,
              min_level: tags.level?.[0] ?? null,
              max_level: tags.level?.[1] ?? null,
              verified: doc.verified,
              embedding: null,
            })
            .execute();
          report.chunks++;
        }
      }
    });
    report.indexed.push(rel);
    log(`indicizzato ${rel}`);
  }

  // documenti cancellati dalla cartella
  const all = await db.selectFrom('knowledge_docs').select(['id', 'path']).execute();
  for (const d of all) {
    if (!seen.has(d.path)) {
      await db.deleteFrom('knowledge_docs').where('id', '=', d.id).execute();
      report.removed.push(d.path);
      log(`rimosso ${d.path}`);
    }
  }

  // embedding dei chunk che non lo hanno (anche dopo aver aggiunto la chiave in seguito)
  if (embedder) {
    for (;;) {
      const missing = await db
        .selectFrom('knowledge_chunks')
        .select(['id', 'heading', 'content'])
        .where('embedding', 'is', null)
        .limit(64)
        .execute();
      if (!missing.length) break;
      const vectors = await embedder.embed(missing.map((c) => `${c.heading}\n${c.content}`), 'document');
      for (const [i, c] of missing.entries()) {
        await db
          .updateTable('knowledge_chunks')
          .set({ embedding: sql`${toPgVector(vectors[i]!)}::vector` as never })
          .where('id', '=', c.id)
          .execute();
      }
      report.embedded += missing.length;
      log(`embedding: ${report.embedded}`);
    }
  }
  return report;
}
