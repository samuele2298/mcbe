import { sql } from 'kysely';
import type { Db } from '../../db/index.js';
import { toPgVector, type Embedder } from '../../lib/embedder.js';
import { fenToEpd } from '../../lib/openings.js';

// Retrieval ibrido (SPEC 7.3): prima il filtro sui tag deterministici (struttura, ECO,
// temi, tipo di finale, posizione esatta), poi l'ordinamento per somiglianza con la domanda.
// Se i tag non bastano a riempire i posti, si completa con la sola ricerca testuale.

export interface RetrievalQuery {
  question?: string | null;
  fen?: string | null;
  structures?: string[];
  eco?: string[];
  themes?: string[];
  phase?: string | null;
  endgameType?: string | null;
  level?: number | null;
  limit?: number;
}

export interface RetrievedChunk {
  id: string;
  docTitle: string;
  source: string | null;
  heading: string;
  content: string;
  verified: boolean;
  tokenCount: number;
  tags: { structures: string[]; eco: string[]; themes: string[]; phase: string | null; endgameType: string | null };
  match: 'tags' | 'text';
  score: number;
}

type Row = {
  id: string;
  title: string;
  source_ref: string | null;
  heading: string;
  content: string;
  verified: boolean;
  token_count: number;
  structures: string[];
  eco: string[];
  themes: string[];
  phase: string | null;
  endgame_type: string | null;
  score: number;
};

export class KnowledgeRetriever {
  constructor(
    private readonly db: Db,
    private readonly embedder: Embedder | null,
  ) {}

  async retrieve(q: RetrievalQuery): Promise<RetrievedChunk[]> {
    const limit = q.limit ?? 6;
    const structures = q.structures ?? [];
    const eco = q.eco ?? [];
    const themes = q.themes ?? [];
    const epd = q.fen ? fenToEpd(q.fen) : null;
    const level = q.level ?? null;
    const question = q.question?.trim() || null;

    // vettore della domanda (o, in sua assenza, dei tag come testo)
    let qvec: string | null = null;
    const queryText = question ?? [...structures, ...themes, q.endgameType ?? '', q.phase ?? ''].join(' ').trim();
    if (this.embedder && queryText) {
      try {
        qvec = toPgVector((await this.embedder.embed([queryText], 'query'))[0]!);
      } catch {
        qvec = null; // servizio di embedding non disponibile: si ripiega sul full-text
      }
    }

    const tagScore = sql<number>`(
      3 * (c.structures && ${sql.val(structures)}::text[])::int +
      3 * (c.eco && ${sql.val(eco)}::text[])::int +
      2 * cardinality(ARRAY(SELECT unnest(c.themes) INTERSECT SELECT unnest(${sql.val(themes)}::text[]))) +
      2 * (c.endgame_type IS NOT NULL AND c.endgame_type = ${q.endgameType ?? null})::int +
      1 * (c.phase IS NOT NULL AND c.phase = ${q.phase ?? null})::int +
      6 * (c.fen IS NOT NULL AND c.fen = ${epd})::int)`;
    const similarity = qvec
      ? sql<number>`(1 - (c.embedding <=> ${qvec}::vector))`
      : question
        ? sql<number>`ts_rank(c.tsv, plainto_tsquery('italian', ${question}))`
        : sql<number>`0`;
    const levelOk = level
      ? sql<boolean>`(c.min_level IS NULL OR c.min_level <= ${level + 300}) AND (c.max_level IS NULL OR c.max_level >= ${level - 300})`
      : sql<boolean>`true`;

    const tagged = await sql<Row>`
      SELECT c.id, d.title, d.source_ref, c.heading, c.content, c.verified, c.token_count,
             c.structures, c.eco, c.themes, c.phase, c.endgame_type,
             (${tagScore} + 2 * coalesce(${similarity}, 0))::float AS score
      FROM knowledge_chunks c JOIN knowledge_docs d ON d.id = c.doc_id
      WHERE ${tagScore} >= 2 AND ${levelOk}
      ORDER BY score DESC
      LIMIT ${limit}`.execute(this.db);

    const out: RetrievedChunk[] = tagged.rows.map((r) => this.map(r, 'tags'));
    if (out.length < limit && question) {
      const exclude = out.map((r) => r.id);
      const textMatch = qvec
        ? sql<boolean>`c.embedding IS NOT NULL AND (1 - (c.embedding <=> ${qvec}::vector)) > 0.35`
        : sql<boolean>`c.tsv @@ plainto_tsquery('italian', ${question})`;
      const more = await sql<Row>`
        SELECT c.id, d.title, d.source_ref, c.heading, c.content, c.verified, c.token_count,
               c.structures, c.eco, c.themes, c.phase, c.endgame_type, (${similarity})::float AS score
        FROM knowledge_chunks c JOIN knowledge_docs d ON d.id = c.doc_id
        WHERE ${textMatch} AND ${levelOk}
          ${exclude.length ? sql`AND c.id <> ALL(${sql.val(exclude)}::uuid[])` : sql``}
        ORDER BY score DESC
        LIMIT ${limit - out.length}`.execute(this.db);
      out.push(...more.rows.map((r) => this.map(r, 'text')));
    }
    return out;
  }

  private map(r: Row, match: 'tags' | 'text'): RetrievedChunk {
    return {
      id: r.id,
      docTitle: r.title,
      source: r.source_ref,
      heading: r.heading,
      content: r.content,
      verified: r.verified,
      tokenCount: r.token_count,
      tags: { structures: r.structures, eco: r.eco, themes: r.themes, phase: r.phase, endgameType: r.endgame_type },
      match,
      score: Math.round(r.score * 100) / 100,
    };
  }
}
