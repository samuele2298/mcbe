import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, createPool } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { analyzePosition } from '../src/chess/detectors/index.js';
import { parseDocument, serializeDocument, splitBody } from '../src/modules/knowledge/format.js';
import { indexKnowledge } from '../src/modules/knowledge/indexer.js';
import { KnowledgeRetriever } from '../src/modules/knowledge/retrieval.js';
import { htmlToSections, pgnToSections } from '../src/modules/knowledge/sources.js';
import { heuristicTags } from '../src/modules/knowledge/tagger.js';
import { testDbUrl } from './helpers.js';

describe('formato knowledge base', () => {
  const md = `---
title: Prova
source_type: note
verified: true
tags: phase=endgame
---

# Prova

## Lucena
<!-- tags: endgame_type=rook_pawn; themes=lucena; level=1300-2200 -->
Costruire il ponte.

## Senza tag
Testo libero.
`;

  it('legge frontmatter, sezioni e tag', () => {
    const d = parseDocument(md, 'x');
    expect(d.title).toBe('Prova');
    expect(d.verified).toBe(true);
    expect(d.defaults.phase).toBe('endgame');
    expect(d.sections).toHaveLength(2);
    expect(d.sections[0]).toMatchObject({ heading: 'Lucena', tags: { endgame_type: 'rook_pawn', themes: ['lucena'], level: [1300, 2200] } });
  });

  it('serializza e rilegge senza perdite', () => {
    const d = parseDocument(md, 'x');
    expect(parseDocument(serializeDocument(d), 'x')).toEqual(d);
  });

  it('spezza i testi lunghi lungo i paragrafi', () => {
    const long = Array.from({ length: 20 }, (_, i) => `Paragrafo ${i} `.repeat(40)).join('\n\n');
    const parts = splitBody(long, 300);
    expect(parts.length).toBeGreaterThan(3);
    expect(parts.every((p) => p.length / 4 <= 450)).toBe(true);
  });
});

describe('sorgenti e tagging euristico', () => {
  it('riconosce concetti in italiano', () => {
    const t = heuristicTags({ heading: 'Attacco di minoranza', body: 'Nella struttura Carlsbad (D35) il Bianco spinge b4-b5.' });
    expect(t.structures).toContain('carlsbad');
    expect(t.themes).toContain('minority_attack');
    expect(t.eco).toEqual(['D35']);
  });

  it('PGN commentato: un chunk per commento con la posizione', () => {
    const r = pgnToSections('[White "A"]\n[Black "B"]\n\n1. e4 e5 2. Nf3 {Il cavallo attacca subito il pedone e5 e sviluppa un pezzo.} Nc6 *', 'x');
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0]!.heading).toContain('2. Nf3');
    expect(r.sections[0]!.tags.fen).toBe('rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq -');
  });

  it('HTML: titoli h2 come sezioni', () => {
    const r = htmlToSections('<title>T</title><main><h2>Idea</h2><p>Primo paragrafo &amp; altro.</p><script>x</script></main>', 'x');
    expect(r.sections.map((s) => s.heading)).toEqual(['Idea']);
    expect(r.sections[0]!.body).toBe('Primo paragrafo & altro.');
  });
});

describe.skipIf(!testDbUrl)('indicizzazione e retrieval', () => {
  const pool = createPool(testDbUrl ?? '', 2);
  const db = createDb(pool);

  beforeAll(async () => {
    await migrate(pool, undefined, () => {});
    await indexKnowledge(db, null, { rebuild: true });
  });
  afterAll(async () => {
    await db.destroy();
  });

  it('una posizione di Lucena recupera la teoria della Lucena per prima', async () => {
    const facts = analyzePosition('3K4/3P1k2/8/8/8/8/1r6/4R3 w - - 0 1');
    const r = await new KnowledgeRetriever(db, null).retrieve({
      themes: facts.tags.themes,
      structures: facts.tags.structures,
      phase: facts.tags.phase,
      endgameType: facts.tags.endgameType,
      question: 'come vinco?',
      limit: 5,
    });
    expect(r[0]!.heading).toBe('Posizione di Lucena');
    expect(r.every((c) => c.match === 'tags')).toBe(true);
  });

  it('una Carlsbad recupera l\'attacco di minoranza', async () => {
    const facts = analyzePosition('r1bqkb1r/pp3ppp/2p2n2/3p4/3P4/2N1P3/PP3PPP/R1BQKBNR w KQkq - 0 7');
    const r = await new KnowledgeRetriever(db, null).retrieve({ ...facts.tags, structures: facts.tags.structures, limit: 3 });
    expect(r[0]!.heading).toContain('Carlsbad');
  });

  it('senza tag usa il full-text sulla domanda', async () => {
    const r = await new KnowledgeRetriever(db, null).retrieve({ question: 'regola del quadrato', limit: 3 });
    expect(r[0]!.heading).toBe('Regola del quadrato');
    expect(r[0]!.match).toBe('text');
  });

  it('una seconda indicizzazione senza modifiche non tocca nulla', async () => {
    const rep = await indexKnowledge(db, null);
    expect(rep.indexed).toEqual([]);
    expect(rep.unchanged).toBeGreaterThan(0);
  });
});
