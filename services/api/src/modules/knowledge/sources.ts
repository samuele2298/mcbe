import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Chess } from 'chess.js';
import { extractText, getDocumentProxy } from 'unpdf';
import { fenToEpd } from '../../lib/openings.js';
import { parseDocument, splitBody, type Section } from './format.js';

// Estrazione del testo dalle sorgenti in sezioni (titolo + corpo), prima del tagging.

export interface Extracted {
  title: string;
  sourceType: string;
  sections: Section[];
}

function groupParagraphs(text: string, headingPrefix: string): Section[] {
  return splitBody(text.replace(/[ \t]+\n/g, '\n').trim(), 450).map((body, i) => ({
    heading: `${headingPrefix} (${i + 1})`,
    body,
    tags: {},
  }));
}

export async function fromMarkdown(file: string): Promise<Extracted> {
  const text = await readFile(file, 'utf8');
  const doc = parseDocument(text, path.basename(file, path.extname(file)));
  return { title: doc.title, sourceType: doc.sourceType, sections: doc.sections };
}

export async function fromText(file: string): Promise<Extracted> {
  const title = path.basename(file, path.extname(file));
  return { title, sourceType: 'note', sections: groupParagraphs(await readFile(file, 'utf8'), title) };
}

export async function fromPdf(file: string): Promise<Extracted> {
  const pdf = await getDocumentProxy(new Uint8Array(await readFile(file)));
  const { text } = await extractText(pdf, { mergePages: false });
  const title = path.basename(file, '.pdf');
  const sections: Section[] = [];
  // le pagine vengono unite a gruppi e spezzate per paragrafi; il titolo riporta la pagina
  for (const [i, page] of (text as string[]).entries()) {
    const clean = page.replace(/-\n(\w)/g, '$1').trim();
    if (clean.length < 80) continue;
    for (const s of groupParagraphs(clean, `${title}, p. ${i + 1}`)) sections.push(s);
  }
  return { title, sourceType: 'book', sections };
}

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

/** Estrazione semplice da HTML: titoli h2/h3 come sezioni, paragrafi come testo. */
export function htmlToSections(html: string, fallbackTitle: string): Extracted {
  const title = decode(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? fallbackTitle);
  let body = html;
  const main = /<div[^>]+id="mw-content-text"[\s\S]*$/i.exec(body) ?? /<main[\s\S]*?<\/main>/i.exec(body) ?? /<article[\s\S]*?<\/article>/i.exec(body);
  if (main) body = main[0];
  body = body
    .replace(/<(script|style|nav|footer|header|aside|table|figure)[\s\S]*?<\/\1>/gi, '')
    .replace(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi, (_, h) => `\n\n## ${h.replace(/<[^>]+>/g, '').trim()}\n\n`)
    .replace(/<(p|li|br|div)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  const md = decode(body).replace(/\[edit\]|\[modifica[^\]]*\]/gi, '').replace(/\n{3,}/g, '\n\n');
  const doc = parseDocument(`# ${title}\n\n${md}`, title);
  return {
    title,
    sourceType: 'article',
    sections: doc.sections.flatMap((s) =>
      splitBody(s.body, 500).map((b, i, all) => ({ heading: all.length > 1 ? `${s.heading} (${i + 1})` : s.heading, body: b, tags: {} })),
    ),
  };
}

export async function fromUrl(url: string): Promise<Extracted> {
  const res = await fetch(url, { headers: { 'user-agent': 'chess-mentor-kb/0.1' }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`download ${url}: ${res.status}`);
  return htmlToSections(await res.text(), url);
}

/** PGN commentato: ogni commento diventa una sezione legata alla posizione (EPD). */
export function pgnToSections(pgn: string, fallbackTitle: string): Extracted {
  const games = pgn.split(/\n\s*\n(?=\[Event )/);
  const sections: Section[] = [];
  let title = fallbackTitle;
  for (const g of games) {
    const chess = new Chess();
    chess.loadPgn(g);
    const headers = chess.getHeaders();
    const name = [headers.White, headers.Black].filter(Boolean).join(' - ') || headers.Event || fallbackTitle;
    if (games.length === 1) title = name;
    const history = chess.history({ verbose: true });
    const sanByFen = new Map<string, string>();
    for (const [i, m] of history.entries()) {
      const no = Math.floor(i / 2) + 1;
      sanByFen.set(fenToEpd(m.after), `${no}${m.color === 'w' ? '.' : '...'} ${m.san}`);
    }
    for (const c of chess.getComments()) {
      const text = c.comment.replace(/\[%[^\]]*\]/g, '').trim();
      if (text.length < 20) continue;
      const epd = fenToEpd(c.fen);
      sections.push({
        heading: `${name}: dopo ${sanByFen.get(epd) ?? 'posizione iniziale'}`,
        body: text,
        tags: { fen: epd },
      });
    }
  }
  return { title, sourceType: 'pgn', sections };
}

export async function extractSource(input: string): Promise<Extracted> {
  if (/^https?:\/\//.test(input)) return fromUrl(input);
  const ext = path.extname(input).toLowerCase();
  if (ext === '.md') return fromMarkdown(input);
  if (ext === '.pdf') return fromPdf(input);
  if (ext === '.pgn') return pgnToSections(await readFile(input, 'utf8'), path.basename(input, ext));
  if (ext === '.html' || ext === '.htm') return htmlToSections(await readFile(input, 'utf8'), path.basename(input, ext));
  return fromText(input);
}
