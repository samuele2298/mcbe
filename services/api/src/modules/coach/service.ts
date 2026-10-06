import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { sql } from 'kysely';
import type { Db } from '../../db/index.js';
import { colorName, load } from '../../chess/detectors/board.js';
import { analyzePosition, type PositionFacts } from '../../chess/detectors/index.js';
import { formatEval, whitePovCp } from '../../chess/eval.js';
import { themeLabel } from '../../chess/themes.js';
import { claude, claudeConfigured, claudeModels, coachEffort, isFrontierModel } from '../../lib/claude.js';
import { fenToEpd } from '../../lib/openings.js';
import type { EngineClient } from '../engine/client.js';
import type { TablebaseClient, TablebaseResult } from '../engine/tablebase.js';
import type { KnowledgeRetriever, RetrievedChunk } from '../knowledge/retrieval.js';
import { labelFor } from '../profile/labels.js';
import { lineInfo, unknownMovesInText, type LineInfo } from './postcheck.js';
import { COACH_SYSTEM, CoachAnswer } from './prompt.js';

// Pipeline del coach (SPEC 9): fatti dagli strati deterministici -> Claude come narratore
// -> post-check delle mosse -> salvataggio per il feedback.

export interface ExplainInput {
  fen: string;
  /** mosse UCI dalla posizione iniziale standard fino a `fen` (per riconoscere l'apertura) */
  moves?: string[];
  question?: string;
  context?: string;
}

export interface CoachLine {
  pv: string[];
  san: string[];
  evalWhite: number;
  evalText: string;
}

export interface ExplainResult {
  id: string;
  fen: string;
  ai: boolean;
  model: string | null;
  concept: string;
  explanation: Array<{ text: string; sources: string[]; move: { line: number; ply: number; uci: string[]; san: string } | null }>;
  plan: string | null;
  missingKnowledge: string | null;
  usesUnverified: boolean;
  notice: string | null;
  lines: CoachLine[];
  tablebase: { category: string; dtz: number | null } | null;
  facts: string[];
  opening: { eco: string; name: string } | null;
  sources: Array<{ id: string; title: string; heading: string; verified: boolean }>;
}

export class CoachUnavailable extends Error {}

export class CoachService {
  constructor(
    private readonly db: Db,
    private readonly engine: EngineClient,
    private readonly tablebase: TablebaseClient,
    private readonly retriever: KnowledgeRetriever,
  ) {}

  private async opening(moves: string[] | undefined): Promise<{ eco: string; name: string } | null> {
    if (!moves?.length) return null;
    const c = load('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    const epds: string[] = [];
    for (const m of moves.slice(0, 40)) {
      try {
        c.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
      } catch {
        return null;
      }
      epds.push(fenToEpd(c.fen()));
    }
    // l'ultima posizione della partita che compare nell'albero delle aperture
    const row = await this.db
      .selectFrom('openings')
      .select(['eco', 'name', 'ply'])
      .where('epd', 'in', epds)
      .orderBy('ply', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row ? { eco: row.eco, name: row.name } : null;
  }

  private async profile(userId: string, facts: PositionFacts) {
    const global = await this.db
      .selectFrom('weakness_stats')
      .select(['rating', 'rd'])
      .where('user_id', '=', userId)
      .where('dimension', '=', 'global')
      .executeTakeFirst();
    const weak = await this.db
      .selectFrom('weakness_stats')
      .select(['dimension', 'key', 'rating', 'attempts', 'successes'])
      .where('user_id', '=', userId)
      .where('dimension', 'in', ['theme', 'mistake', 'structure', 'endgame_type'])
      .where('attempts', '>=', 3)
      .orderBy(sql`successes::float / attempts`)
      .limit(4)
      .execute();
    const motifs = facts.tags.themes;
    const similar = motifs.length
      ? await this.db
          .selectFrom('mistakes')
          .select(['category', 'motif', 'created_at'])
          .where('user_id', '=', userId)
          .where('motif', 'in', motifs)
          .orderBy('created_at', 'desc')
          .limit(1)
          .executeTakeFirst()
      : undefined;
    const note = await this.db
      .selectFrom('profile_notes')
      .select('content')
      .where('user_id', '=', userId)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    return {
      rating: Math.round(global?.rating ?? 1500),
      weaknesses: weak.map((w) => ({
        label: w.dimension === 'theme' ? themeLabel(w.key) : labelFor(w.dimension, w.key),
        rate: Math.round((100 * w.successes) / Math.max(1, w.attempts)),
        attempts: w.attempts,
      })),
      similarMistake: similar
        ? `${labelFor('mistake', similar.category)}${similar.motif ? ` (${themeLabel(similar.motif)})` : ''} il ${new Date(similar.created_at).toLocaleDateString('it-IT')}`
        : null,
      note: note?.content ?? null,
    };
  }

  /** `dryRun`: niente salvataggio (verifica della pipeline da CLI, senza utente). */
  async explain(userId: string, input: ExplainInput, opts: { dryRun?: boolean } = {}): Promise<ExplainResult> {
    // 1. validazione
    let fen: string;
    try {
      fen = load(input.fen).fen();
    } catch {
      throw new CoachUnavailable('invalid_fen');
    }
    const whiteToMove = fen.split(' ')[1] === 'w';
    const c = load(fen);
    const over = c.isGameOver();

    // 2-4. motore, tablebase, detector
    const facts = analyzePosition(fen);
    const [analysis, tb, opening] = await Promise.all([
      over ? Promise.resolve({ bestmove: null, lines: [] }) : this.engine.analyse(fen, { depth: 18, multipv: 3 }),
      this.tablebase.probe(fen),
      this.opening(input.moves),
    ]);
    const infos: LineInfo[] = analysis.lines.map((l) => lineInfo(fen, l.pv));
    const lines: CoachLine[] = analysis.lines.map((l, i) => {
      const ev = whitePovCp(l, whiteToMove);
      return { pv: infos[i]!.pv, san: infos[i]!.san, evalWhite: ev, evalText: formatEval(ev) };
    });

    // 5-6. profilo e conoscenza
    const profile = await this.profile(userId, facts);
    const chunks = await this.retriever.retrieve({
      question: input.question ?? null,
      fen,
      structures: facts.tags.structures,
      eco: opening ? [opening.eco] : [],
      themes: facts.tags.themes,
      phase: facts.tags.phase,
      endgameType: facts.tags.endgameType,
      level: profile.rating,
      limit: 6,
    });
    // tetto di ~3500 token di teoria nel prompt
    let budget = 3500;
    const used = chunks.filter((ch) => (budget -= ch.tokenCount) >= 0 || ch === chunks[0]);

    const base = {
      fen,
      lines,
      tablebase: tb ? { category: tb.category, dtz: tb.dtz } : null,
      facts: facts.summary,
      opening,
      sources: used.map((u) => ({ id: u.id, title: u.docTitle, heading: u.heading, verified: u.verified })),
    };

    // 7-8. Claude + post-check (senza chiave: solo fatti)
    let answer: CoachAnswer | null = null;
    let notice: string | null = null;
    let model: string | null = null;
    let usage: { input: number; output: number } | null = null;
    if (!claudeConfigured()) {
      notice = 'Coach AI non configurato: sono mostrati solo i fatti verificati.';
    } else {
      const prompt = buildPrompt({ fen, facts, lines, infos, tb, opening, chunks: used, profile, input });
      try {
        const res = await this.ask(prompt, infos, used);
        answer = res.answer;
        model = res.model;
        usage = res.usage;
        if (!answer) notice = res.notice;
      } catch (err) {
        notice = err instanceof Anthropic.RateLimitError
          ? 'Coach AI momentaneamente occupato: sono mostrati solo i fatti verificati.'
          : 'Coach AI non disponibile: sono mostrati solo i fatti verificati.';
      }
    }

    const result = answer
      ? this.fromAnswer(answer, infos, used)
      : this.factsOnly(facts, lines, tb, used);

    // 9. salvataggio
    if (opts.dryRun) {
      return { id: 'dry-run', ai: Boolean(answer), model, notice, ...base, ...result };
    }
    const saved = await this.db
      .insertInto('coach_explanations')
      .values({
        user_id: userId,
        fen,
        question: input.question ?? null,
        facts: JSON.stringify({ summary: facts.summary, tags: facts.tags, lines, tablebase: base.tablebase, opening, context: input.context ?? null }) as never,
        chunk_ids: used.map((u) => u.id),
        response: JSON.stringify(result) as never,
        model,
        input_tokens: usage?.input ?? null,
        output_tokens: usage?.output ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    return { id: saved.id, ai: Boolean(answer), model, notice, ...base, ...result };
  }

  /** Chiamata a Claude con output strutturato; una rigenerazione se il post-check fallisce. */
  private async ask(prompt: string, infos: LineInfo[], chunks: RetrievedChunk[]) {
    const m = claudeModels.coach;
    // ogni tentativo è una richiesta a turno singolo: la correzione va nel prompt, senza
    // rimandare il turno precedente (niente cronologia modificata da gestire)
    let userPrompt = prompt;
    let totalIn = 0;
    let totalOut = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await claude().beta.messages.parse({
        model: m,
        max_tokens: 16000,
        system: [{ type: 'text', text: COACH_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userPrompt }],
        output_config: {
          format: betaZodOutputFormat(CoachAnswer),
          ...(isFrontierModel(m) ? { effort: coachEffort } : {}),
        },
        // in caso di rifiuto dei classificatori, il server riprova con il modello consigliato
        ...(isFrontierModel(m) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      });
      totalIn += res.usage.input_tokens;
      totalOut += res.usage.output_tokens;
      if (res.stop_reason === 'refusal') {
        return { answer: null, model: res.model, usage: { input: totalIn, output: totalOut }, notice: 'Il coach non ha potuto rispondere: sono mostrati i fatti verificati.' };
      }
      const answer = res.parsed_output;
      if (!answer) break;
      const problems = checkAnswer(answer, infos, chunks);
      if (!problems.length) return { answer, model: res.model, usage: { input: totalIn, output: totalOut }, notice: null };
      if (attempt === 0) {
        userPrompt = `${prompt}\n\n## Attenzione\nUna bozza precedente violava le regole: ${problems.join('; ')}. Cita mosse solo tramite "move" con indici delle linee fornite e usa solo id di estratti forniti.`;
        continue;
      }
      // secondo tentativo ancora non valido: si eliminano le parti non verificabili
      return { answer: sanitize(answer, infos, chunks), model: res.model, usage: { input: totalIn, output: totalOut }, notice: null };
    }
    return { answer: null, model: m, usage: { input: totalIn, output: totalOut }, notice: 'Risposta del coach non valida: sono mostrati i fatti verificati.' };
  }

  private fromAnswer(a: CoachAnswer, infos: LineInfo[], chunks: RetrievedChunk[]) {
    const ids = new Set(chunks.map((c) => c.id));
    return {
      concept: a.concept,
      explanation: a.explanation.map((e) => ({
        text: e.text,
        sources: e.chunk_ids.filter((id) => ids.has(id)),
        move: e.move && infos[e.move.line] && e.move.ply < infos[e.move.line]!.pv.length
          ? {
              line: e.move.line,
              ply: e.move.ply,
              uci: infos[e.move.line]!.pv.slice(0, e.move.ply + 1),
              san: infos[e.move.line]!.san[e.move.ply]!,
            }
          : null,
      })),
      plan: a.plan,
      missingKnowledge: a.missing_knowledge,
      usesUnverified: a.uses_unverified || a.explanation.some((e) => e.chunk_ids.some((id) => chunks.find((c) => c.id === id && !c.verified))),
    };
  }

  /** Risposta senza AI: i fatti dei detector e il titolo della teoria pertinente. */
  private factsOnly(facts: PositionFacts, lines: CoachLine[], tb: TablebaseResult | null, chunks: RetrievedChunk[]) {
    const best = lines[0];
    const explanation: ExplainResult['explanation'] = facts.summary.slice(0, 6).map((t) => ({ text: t, sources: [], move: null }));
    if (tb && tb.category !== 'unknown') {
      explanation.unshift({ text: `Tablebase: per chi muove la posizione è ${tbLabel(tb.category)}.`, sources: [], move: null });
    }
    if (best?.pv.length) {
      explanation.push({
        text: `Valutazione del motore: ${best.evalText}. Mossa migliore:`,
        sources: [],
        move: { line: 0, ply: 0, uci: best.pv.slice(0, 1), san: best.san[0]! },
      });
    }
    for (const c of chunks.slice(0, 3)) {
      explanation.push({ text: `Teoria pertinente: ${c.heading} (${c.docTitle}).`, sources: [c.id], move: null });
    }
    return {
      concept: chunks[0]?.heading ?? facts.summary[0] ?? 'Posizione',
      explanation,
      plan: null,
      missingKnowledge: chunks.length ? null : 'Nessun estratto di teoria pertinente nella knowledge base.',
      usesUnverified: chunks.some((c) => !c.verified),
    };
  }

  async feedback(userId: string, id: string, feedback: 'wrong' | 'useful', note?: string): Promise<boolean> {
    const r = await this.db
      .updateTable('coach_explanations')
      .set({ feedback, feedback_note: note ?? null })
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    return r.numUpdatedRows > 0n;
  }
}

function tbLabel(c: string): string {
  return (
    { win: 'vinta', loss: 'persa', draw: 'patta', 'cursed-win': 'vinta ma patta per la regola delle 50 mosse', 'blessed-loss': 'persa ma salvata dalla regola delle 50 mosse', 'maybe-win': 'probabilmente vinta', 'maybe-loss': 'probabilmente persa' } as Record<string, string>
  )[c] ?? c;
}

export function checkAnswer(a: CoachAnswer, infos: LineInfo[], chunks: RetrievedChunk[]): string[] {
  const problems: string[] = [];
  const ids = new Set(chunks.map((c) => c.id));
  for (const e of a.explanation) {
    if (e.move && !(infos[e.move.line] && e.move.ply >= 0 && e.move.ply < infos[e.move.line]!.pv.length)) {
      problems.push(`riferimento a mossa inesistente (linea ${e.move.line}, semimossa ${e.move.ply})`);
    }
    for (const id of e.chunk_ids) if (!ids.has(id)) problems.push(`estratto inesistente ${id}`);
    const unknown = unknownMovesInText(e.text, infos);
    if (unknown.length) problems.push(`mosse nel testo non presenti nelle linee: ${unknown.join(', ')}`);
  }
  for (const t of [a.plan, a.concept]) {
    const unknown = t ? unknownMovesInText(t, infos) : [];
    if (unknown.length) problems.push(`mosse nel testo non presenti nelle linee: ${unknown.join(', ')}`);
  }
  return problems;
}

/** Elimina le frasi con mosse non verificabili e i riferimenti non validi. */
export function sanitize(a: CoachAnswer, infos: LineInfo[], chunks: RetrievedChunk[]): CoachAnswer {
  const ids = new Set(chunks.map((c) => c.id));
  return {
    ...a,
    concept: unknownMovesInText(a.concept, infos).length ? 'Idea chiave della posizione' : a.concept,
    plan: a.plan && unknownMovesInText(a.plan, infos).length ? null : a.plan,
    explanation: a.explanation
      .filter((e) => !unknownMovesInText(e.text, infos).length)
      .map((e) => ({
        ...e,
        chunk_ids: e.chunk_ids.filter((id) => ids.has(id)),
        move: e.move && infos[e.move.line] && e.move.ply < infos[e.move.line]!.pv.length ? e.move : null,
      })),
  };
}

function buildPrompt(p: {
  fen: string;
  facts: PositionFacts;
  lines: CoachLine[];
  infos: LineInfo[];
  tb: TablebaseResult | null;
  opening: { eco: string; name: string } | null;
  chunks: RetrievedChunk[];
  profile: Awaited<ReturnType<CoachService['profile']>>;
  input: ExplainInput;
}): string {
  const stm = colorName(p.facts.sideToMove);
  const parts: string[] = [];
  parts.push(`## Posizione\nFEN: ${p.fen}\nTratto al ${stm}. Fase: ${p.facts.phase}.${p.input.context ? `\nContesto: ${p.input.context}` : ''}`);
  if (p.opening) parts.push(`## Apertura\n${p.opening.eco} ${p.opening.name}`);
  parts.push(
    `## Linee del motore (Stockfish, valutazione dal punto di vista del Bianco)\n` +
      (p.lines.length
        ? p.lines
            .map((l, i) => `Linea ${i} [${l.evalText}]: ${p.infos[i]!.san.map((s, j) => `(${j}) ${s}`).join(' ')}`)
            .join('\n')
        : 'Partita finita: nessuna linea.'),
  );
  if (p.tb && p.tb.category !== 'unknown') {
    parts.push(`## Tablebase\nPer il ${stm}: ${tbLabel(p.tb.category)}${p.tb.dtz !== null ? ` (DTZ ${p.tb.dtz})` : ''}.`);
  }
  parts.push(`## Fatti dei detector\n${p.facts.summary.map((s) => `- ${s}`).join('\n')}`);
  parts.push(
    `## Estratti di teoria\n` +
      (p.chunks.length
        ? p.chunks
            .map((c) => `[id: ${c.id}] ${c.docTitle} > ${c.heading}${c.verified ? '' : ' (da confermare)'}\n${c.content}`)
            .join('\n\n')
        : 'Nessun estratto pertinente.'),
  );
  const w = p.profile.weaknesses.map((x) => `${x.label} (${x.rate}% su ${x.attempts})`).join(', ');
  parts.push(
    `## Profilo del giocatore\nRating puzzle circa ${p.profile.rating}.` +
      (w ? `\nPunti deboli: ${w}.` : '') +
      (p.profile.similarMistake ? `\nUltimo errore simile: ${p.profile.similarMistake}.` : '') +
      (p.profile.note ? `\nNota del coach: ${p.profile.note}` : ''),
  );
  parts.push(`## Domanda\n${p.input.question?.trim() || 'Spiegami questa posizione: qual è l\'idea chiave e cosa devo fare?'}`);
  return parts.join('\n\n');
}
