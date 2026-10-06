import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { claudeConfigured } from '../lib/claude.js';
import { serializeDocument, type ChunkTags, type KbDocument } from '../modules/knowledge/format.js';
import { defaultKnowledgeDir } from '../modules/knowledge/indexer.js';
import { extractSource } from '../modules/knowledge/sources.js';
import { claudeTags, heuristicTags } from '../modules/knowledge/tagger.js';

// Converte una sorgente (PDF, markdown, testo, HTML, PGN commentato o URL) in un file
// markdown taggato in knowledge/content/, da rivedere (diff git) prima di `pnpm kb:index`.
//
//   pnpm kb:ingest ../../knowledge/sources/finali.pdf --title "Manuale dei finali" --license "uso personale"
//   pnpm kb:ingest https://it.wikibooks.org/wiki/... --source wikibooks --license "CC BY-SA 4.0"
//   opzioni: --out <percorso relativo .md>  --no-claude  --force

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    title: { type: 'string' },
    source: { type: 'string' },
    license: { type: 'string' },
    out: { type: 'string' },
    'no-claude': { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
  },
});

const input = positionals[0];
if (!input) {
  console.error('uso: pnpm kb:ingest <file|url> [--title ...] [--source ...] [--license ...] [--out ...]');
  process.exit(1);
}

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

const extracted = await extractSource(input);
const title = args.title ?? extracted.title;
console.log(`${extracted.sections.length} sezioni estratte da ${input}`);

// tagging: euristica sempre, Claude se configurato (a gruppi di 15 sezioni)
const useClaude = !args['no-claude'] && claudeConfigured();
const tags: ChunkTags[] = extracted.sections.map((s) => heuristicTags(s));
if (useClaude) {
  for (let i = 0; i < extracted.sections.length; i += 15) {
    const group = extracted.sections.slice(i, i + 15);
    const proposed = await claudeTags(group);
    if (!proposed) {
      console.warn(`tagging Claude non riuscito per le sezioni ${i}-${i + group.length - 1}: uso l'euristica`);
      continue;
    }
    proposed.forEach((t, j) => {
      const h = tags[i + j]!;
      tags[i + j] = {
        ...t,
        // i tag strutturali già presenti nel file (es. fen dei PGN) restano
        fen: extracted.sections[i + j]!.tags.fen ?? null,
        themes: [...new Set([...(t.themes ?? []), ...(h.themes ?? [])])],
        structures: [...new Set([...(t.structures ?? []), ...(h.structures ?? [])])],
      };
    });
    console.log(`tag proposti da Claude: ${Math.min(i + 15, extracted.sections.length)}/${extracted.sections.length}`);
  }
}

const doc: KbDocument = {
  title,
  sourceType: extracted.sourceType,
  source: args.source ?? input,
  license: args.license ?? null,
  verified: false,
  defaults: {},
  sections: extracted.sections.map((s, i) => ({ ...s, tags: { ...tags[i]!, fen: s.tags.fen ?? tags[i]!.fen ?? null } })),
};

const contentDir = path.join(process.env.KNOWLEDGE_DIR ?? defaultKnowledgeDir, 'content');
const rel = args.out ?? path.join(extracted.sourceType === 'book' ? 'books' : extracted.sourceType === 'pgn' ? 'games' : 'articles', `${slug(title)}.md`);
const target = path.join(contentDir, rel);
if (!args.force && (await access(target).then(() => true, () => false))) {
  console.error(`${rel} esiste già: usa --force per sovrascrivere o --out per un altro nome`);
  process.exit(1);
}
await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, serializeDocument(doc));
console.log(`scritto knowledge/content/${rel} (tag ${useClaude ? 'Claude + euristica' : 'euristici'})`);
console.log('rivedi i tag nel file, imposta verified: true se il contenuto è affidabile, poi: pnpm kb:index');
