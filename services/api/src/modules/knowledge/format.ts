import { createHash } from 'node:crypto';

// Formato dei file della knowledge base (knowledge/content/**/*.md):
//
//   ---
//   title: Finali di torre
//   source_type: note
//   source: Note personali
//   license: propria
//   verified: false
//   tags: phase=endgame          <- tag di default per tutte le sezioni (facoltativo)
//   ---
//
//   ## Posizione di Lucena
//   <!-- tags: endgame_type=rook_pawn; themes=lucena,rookEndgame; level=1300-2200 -->
//   Testo della sezione...
//
// Ogni sezione "## " è un chunk (sezioni lunghe vengono spezzate all'indicizzazione).
// I tag stanno in un commento HTML: invisibili in anteprima, facili da correggere nel diff.

export interface ChunkTags {
  phase?: string | null;
  endgame_type?: string | null;
  themes?: string[];
  structures?: string[];
  eco?: string[];
  fen?: string | null;
  level?: [number, number] | null;
}

export interface Section {
  heading: string;
  body: string;
  tags: ChunkTags;
}

export interface KbDocument {
  title: string;
  sourceType: string;
  source: string | null;
  license: string | null;
  verified: boolean;
  defaults: ChunkTags;
  sections: Section[];
}

export function parseTags(raw: string): ChunkTags {
  const tags: ChunkTags = {};
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.split('=');
    const key = k?.trim();
    const value = rest.join('=').trim();
    if (!key) continue;
    const list = value ? value.split(',').map((x) => x.trim()).filter(Boolean) : [];
    switch (key) {
      case 'phase':
        tags.phase = value || null;
        break;
      case 'endgame_type':
        tags.endgame_type = value || null;
        break;
      case 'themes':
        tags.themes = list;
        break;
      case 'structures':
        tags.structures = list;
        break;
      case 'eco':
        tags.eco = list.map((e) => e.toUpperCase());
        break;
      case 'fen':
        tags.fen = value || null;
        break;
      case 'level': {
        const m = /^(\d+)\s*-\s*(\d+)$/.exec(value);
        tags.level = m ? [Number(m[1]), Number(m[2])] : null;
        break;
      }
    }
  }
  return tags;
}

export function formatTags(t: ChunkTags): string {
  const parts: string[] = [];
  if (t.phase) parts.push(`phase=${t.phase}`);
  if (t.endgame_type) parts.push(`endgame_type=${t.endgame_type}`);
  if (t.themes?.length) parts.push(`themes=${t.themes.join(',')}`);
  if (t.structures?.length) parts.push(`structures=${t.structures.join(',')}`);
  if (t.eco?.length) parts.push(`eco=${t.eco.join(',')}`);
  if (t.fen) parts.push(`fen=${t.fen}`);
  if (t.level) parts.push(`level=${t.level[0]}-${t.level[1]}`);
  return parts.join('; ');
}

export function mergeTags(defaults: ChunkTags, own: ChunkTags): ChunkTags {
  const uniq = (a?: string[], b?: string[]) => [...new Set([...(a ?? []), ...(b ?? [])])];
  return {
    phase: own.phase ?? defaults.phase ?? null,
    endgame_type: own.endgame_type ?? defaults.endgame_type ?? null,
    themes: uniq(defaults.themes, own.themes),
    structures: uniq(defaults.structures, own.structures),
    eco: uniq(defaults.eco, own.eco),
    fen: own.fen ?? null,
    level: own.level ?? defaults.level ?? null,
  };
}

export function parseDocument(text: string, fallbackTitle: string): KbDocument {
  let body = text.replace(/\r\n/g, '\n');
  const meta: Record<string, string> = {};
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(body);
  if (fm) {
    for (const line of fm[1]!.split('\n')) {
      const i = line.indexOf(':');
      if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
    body = body.slice(fm[0].length);
  }
  const sections: Section[] = [];
  const parts = body.split(/^## +/m);
  const intro = parts.shift()!.replace(/^# .*$/m, '').trim();
  if (intro) sections.push({ heading: meta.title ?? fallbackTitle, body: intro, tags: {} });
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const heading = (nl < 0 ? part : part.slice(0, nl)).trim();
    let rest = nl < 0 ? '' : part.slice(nl + 1);
    let tags: ChunkTags = {};
    const tm = /^\s*<!--\s*tags:([\s\S]*?)-->\s*\n?/.exec(rest);
    if (tm) {
      tags = parseTags(tm[1]!);
      rest = rest.slice(tm[0].length);
    }
    const clean = rest.trim();
    if (clean) sections.push({ heading, body: clean, tags });
  }
  return {
    title: meta.title ?? fallbackTitle,
    sourceType: meta.source_type ?? 'note',
    source: meta.source ?? null,
    license: meta.license ?? null,
    verified: meta.verified === 'true',
    defaults: meta.tags ? parseTags(meta.tags) : {},
    sections,
  };
}

export function serializeDocument(doc: KbDocument): string {
  const lines = [
    '---',
    `title: ${doc.title}`,
    `source_type: ${doc.sourceType}`,
    ...(doc.source ? [`source: ${doc.source}`] : []),
    ...(doc.license ? [`license: ${doc.license}`] : []),
    `verified: ${doc.verified}`,
    ...(formatTags(doc.defaults) ? [`tags: ${formatTags(doc.defaults)}`] : []),
    '---',
    '',
    `# ${doc.title}`,
    '',
  ];
  for (const s of doc.sections) {
    lines.push(`## ${s.heading}`);
    const t = formatTags(s.tags);
    if (t) lines.push(`<!-- tags: ${t} -->`);
    lines.push('', s.body.trim(), '');
  }
  return lines.join('\n');
}

/** Stima dei token (circa 4 caratteri per token per testo latino). */
export const estimateTokens = (s: string) => Math.ceil(s.length / 4);

export const hashText = (s: string) => createHash('sha256').update(s).digest('hex');

/** Spezza una sezione lunga in pezzi da ~maxTokens lungo i paragrafi. */
export function splitBody(body: string, maxTokens = 550): string[] {
  if (estimateTokens(body) <= maxTokens) return [body];
  const paras = body.split(/\n\s*\n/);
  const out: string[] = [];
  let cur = '';
  for (const p of paras) {
    if (cur && estimateTokens(cur + '\n\n' + p) > maxTokens) {
      out.push(cur);
      cur = p;
    } else {
      cur = cur ? `${cur}\n\n${p}` : p;
    }
  }
  if (cur) out.push(cur);
  // paragrafi singoli enormi: taglio per frasi
  return out.flatMap((c) => {
    if (estimateTokens(c) <= maxTokens * 1.5) return [c];
    const sentences = c.split(/(?<=[.!?])\s+/);
    const pieces: string[] = [];
    let buf = '';
    for (const s of sentences) {
      if (buf && estimateTokens(buf + ' ' + s) > maxTokens) {
        pieces.push(buf);
        buf = s;
      } else buf = buf ? `${buf} ${s}` : s;
    }
    if (buf) pieces.push(buf);
    return pieces;
  });
}
