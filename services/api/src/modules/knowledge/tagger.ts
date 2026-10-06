import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { claude, claudeModels } from '../../lib/claude.js';
import type { ChunkTags, Section } from './format.js';

// Proposta dei tag per le sezioni della knowledge base.
// - euristica a parole chiave (sempre disponibile, zero costi)
// - Claude (modello economico) se configurato: più preciso; l'admin rivede comunque il diff

export const THEME_VOCAB = [
  // concetti di finale
  'lucena', 'philidor', 'opposition', 'square_rule', 'key_squares', 'triangulation', 'outside_passed_pawn',
  'rook_behind_passed_pawn', 'cut_off_king', 'wrong_bishop',
  // strategia
  'minority_attack', 'outpost', 'bishop_pair', 'open_file', 'pawn_break', 'king_safety', 'development', 'center_control',
  // tattica (chiavi dei temi Lichess)
  'fork', 'pin', 'skewer', 'discoveredAttack', 'doubleCheck', 'hangingPiece', 'deflection', 'attraction',
  'clearance', 'interference', 'intermezzo', 'sacrifice', 'trappedPiece', 'backRankMate', 'smotheredMate', 'mate',
  'promotion', 'zugzwang', 'rookEndgame', 'pawnEndgame', 'bishopEndgame', 'knightEndgame', 'queenEndgame',
] as const;

export const STRUCTURE_VOCAB = [
  'iqp', 'hanging_pawns', 'carlsbad', 'maroczy', 'french', 'kings_indian', 'stonewall', 'open_center', 'closed_center',
] as const;

const KEYWORDS: Array<[RegExp, Partial<ChunkTags>]> = [
  [/lucena/i, { themes: ['lucena', 'rookEndgame'], endgame_type: 'rook_pawn', phase: 'endgame' }],
  [/philidor/i, { themes: ['philidor', 'rookEndgame'], endgame_type: 'rook_pawn', phase: 'endgame' }],
  [/opposizione|opposition/i, { themes: ['opposition', 'pawnEndgame'], phase: 'endgame' }],
  [/regola del quadrato|rule of the square/i, { themes: ['square_rule', 'pawnEndgame'], endgame_type: 'pawn', phase: 'endgame' }],
  [/case? chiave|key squares?/i, { themes: ['key_squares', 'pawnEndgame'], phase: 'endgame' }],
  [/triangolazione|triangulation/i, { themes: ['triangulation', 'zugzwang'], phase: 'endgame' }],
  [/passato esterno|outside passed/i, { themes: ['outside_passed_pawn'], phase: 'endgame' }],
  [/tarrasch|dietro (al|il) pedone passato|behind the passed pawn/i, { themes: ['rook_behind_passed_pawn', 'rookEndgame'] }],
  [/carlsbad/i, { structures: ['carlsbad'] }],
  [/attacco di minoranza|minority attack/i, { themes: ['minority_attack'], structures: ['carlsbad'] }],
  [/pedone isolato|isolani|\biqp\b|isolated queen'?s? pawn/i, { structures: ['iqp'] }],
  [/pedoni sospesi|hanging pawns/i, { structures: ['hanging_pawns'] }],
  [/maroczy/i, { structures: ['maroczy'] }],
  [/catena (di pedoni )?francese|french (defen[cs]e|chain)/i, { structures: ['french'] }],
  [/est-?indiana|king'?s indian/i, { structures: ['kings_indian'] }],
  [/stonewall/i, { structures: ['stonewall'] }],
  [/forchetta|\bfork/i, { themes: ['fork'] }],
  [/inchiodatura|inchiodat|\bpin(ned|s)?\b/i, { themes: ['pin'] }],
  [/infilata|skewer/i, { themes: ['skewer'] }],
  [/attacco di scoperta|scacco di scoperta|discovered/i, { themes: ['discoveredAttack'] }],
  [/deviazione|deflection/i, { themes: ['deflection'] }],
  [/adescamento|attraction|decoy/i, { themes: ['attraction'] }],
  [/traversa|back rank/i, { themes: ['backRankMate'] }],
  [/matto affogato|smothered/i, { themes: ['smotheredMate'] }],
  [/zugzwang/i, { themes: ['zugzwang'] }],
  [/avamposto|outpost/i, { themes: ['outpost'] }],
  [/coppia degli alfieri|bishop pair/i, { themes: ['bishop_pair'] }],
  [/colonna aperta|open file/i, { themes: ['open_file'] }],
  [/alfiere sbagliato|wrong bishop|wrong.colou?red bishop/i, { themes: ['wrong_bishop'], phase: 'endgame' }],
  [/finale di torre|rook endgame/i, { themes: ['rookEndgame'], phase: 'endgame', endgame_type: 'rook' }],
  [/finale di pedoni|pawn endgame|king and pawn/i, { themes: ['pawnEndgame'], phase: 'endgame', endgame_type: 'pawn' }],
  [/\bapertura\b|\bopening\b/i, { phase: 'opening' }],
  [/mediogioco|middlegame/i, { phase: 'middlegame' }],
];

export function heuristicTags(section: Pick<Section, 'heading' | 'body'>): ChunkTags {
  const text = `${section.heading}\n${section.body}`;
  const themes = new Set<string>();
  const structures = new Set<string>();
  let phase: string | null = null;
  let endgame: string | null = null;
  for (const [re, t] of KEYWORDS) {
    if (!re.test(text)) continue;
    t.themes?.forEach((x) => themes.add(x));
    t.structures?.forEach((x) => structures.add(x));
    // la fase più specifica vince: finale > apertura/mediogioco
    if (t.phase && (phase === null || t.phase === 'endgame')) phase = t.phase;
    if (t.endgame_type && !endgame) endgame = t.endgame_type;
  }
  const eco = [...new Set(text.match(/\b[A-E][0-9]{2}\b/g) ?? [])];
  return { phase, endgame_type: endgame, themes: [...themes], structures: [...structures], eco };
}

const SectionTags = z.object({
  index: z.number().int(),
  phase: z.enum(['opening', 'middlegame', 'endgame', 'any']),
  endgame_type: z.enum(['pawn', 'rook', 'rook_pawn', 'minor', 'queen', 'mixed', 'none']),
  themes: z.array(z.string()),
  structures: z.array(z.string()),
  eco: z.array(z.string()),
  level_min: z.number().int(),
  level_max: z.number().int(),
});
const TagResponse = z.object({ sections: z.array(SectionTags) });

const SYSTEM = `Classifichi sezioni di teoria scacchistica per un sistema di retrieval.
Per ogni sezione restituisci:
- phase: fase di gioco trattata (any se generale)
- endgame_type: tipo di finale, none se non è un finale (rook_pawn = torre e pedone contro torre)
- themes: SOLO chiavi da questo elenco: ${THEME_VOCAB.join(', ')}
- structures: SOLO chiavi da questo elenco: ${STRUCTURE_VOCAB.join(', ')}
- eco: codici ECO citati o chiaramente trattati (es. D35), altrimenti vuoto
- level_min, level_max: fascia di rating Elo a cui il testo è adatto (es. 1000-1800)
Non inventare: se un tag non è chiaramente pertinente, lascialo fuori.`;

/** Tag proposti da Claude per un gruppo di sezioni (null in caso di errore: si usa l'euristica). */
export async function claudeTags(sections: Section[]): Promise<ChunkTags[] | null> {
  const list = sections
    .map((s, i) => `### Sezione ${i}: ${s.heading}\n${s.body.slice(0, 3000)}`)
    .join('\n\n');
  try {
    const res = await claude().beta.messages.parse({
      model: claudeModels.cheap,
      max_tokens: 8000,
      system: SYSTEM,
      messages: [{ role: 'user', content: list }],
      output_config: { format: betaZodOutputFormat(TagResponse) },
    });
    if (res.stop_reason === 'refusal' || !res.parsed_output) return null;
    const themeSet = new Set<string>(THEME_VOCAB);
    const structSet = new Set<string>(STRUCTURE_VOCAB);
    return sections.map((_, i) => {
      const t = res.parsed_output!.sections.find((x) => x.index === i);
      if (!t) return {};
      return {
        phase: t.phase === 'any' ? null : t.phase,
        endgame_type: t.endgame_type === 'none' ? null : t.endgame_type,
        themes: t.themes.filter((x) => themeSet.has(x)),
        structures: t.structures.filter((x) => structSet.has(x)),
        eco: t.eco.filter((e) => /^[A-E][0-9]{2}$/.test(e)),
        level: t.level_min < t.level_max ? [t.level_min, t.level_max] : null,
      };
    });
  } catch {
    return null;
  }
}
