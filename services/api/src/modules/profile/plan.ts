import { sql } from 'kysely';
import type { Db } from '../../db/index.js';
import { CORE_THEMES, themeLabel } from '../../chess/themes.js';
import { labelFor } from './labels.js';

// Piano di studio settimanale: deterministico, costruito sul profilo (debolezze, ripassi
// in scadenza, repertorio). Ogni attività è un link a una sezione dell'app.

export interface PlanTask {
  kind: 'review' | 'theme' | 'storm' | 'adaptive' | 'openings' | 'games' | 'endgame';
  label: string;
  detail: string;
  link: string;
}

export interface WeeklyPlan {
  focus: string[];
  days: Array<{ date: string; weekday: string; tasks: PlanTask[] }>;
}

const WEEKDAYS = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];

export async function weeklyPlan(db: Db, userId: string, today = new Date()): Promise<WeeklyPlan> {
  const themes = await db
    .selectFrom('weakness_stats')
    .select(['key', 'rating', 'attempts', 'successes'])
    .where('user_id', '=', userId)
    .where('dimension', '=', 'theme')
    .where('attempts', '>=', 3)
    .orderBy(sql`successes::float / attempts`)
    .limit(3)
    .execute();
  const other = await db
    .selectFrom('weakness_stats')
    .select(['dimension', 'key', 'attempts', 'successes'])
    .where('user_id', '=', userId)
    .where('dimension', 'in', ['structure', 'endgame_type', 'mistake'])
    .where('attempts', '>=', 3)
    .orderBy(sql`successes::float / attempts`)
    .limit(2)
    .execute();
  const due = await db
    .selectFrom('srs_cards')
    .select(['item_type', (eb) => eb.fn.countAll<string>().as('n')])
    .where('user_id', '=', userId)
    .where('due_at', '<=', sql<Date>`now() + interval '1 day'`)
    .groupBy('item_type')
    .execute();
  const repertoire = await db
    .selectFrom('repertoire_lines')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('user_id', '=', userId)
    .executeTakeFirstOrThrow();
  const unreviewed = await db
    .selectFrom('mistakes')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('user_id', '=', userId)
    .where('created_at', '>', sql<Date>`now() - interval '7 days'`)
    .executeTakeFirstOrThrow();

  const themeKeys = themes.length ? themes.map((t) => t.key) : CORE_THEMES.slice(0, 3);
  const puzzleDue = Number(due.find((d) => d.item_type === 'puzzle')?.n ?? 0);
  const lineDue = Number(due.find((d) => d.item_type === 'opening_line')?.n ?? 0);
  const hasRepertoire = Number(repertoire.n) > 0;
  const endgameWeak = other.find((o) => o.dimension === 'endgame_type' || (o.dimension === 'mistake' && o.key === 'endgame_technique'));
  const structureWeak = other.find((o) => o.dimension === 'structure');

  const focus = [
    ...themeKeys.map(themeLabel),
    ...other.map((o) => labelFor(o.dimension, o.key)),
  ].slice(0, 4);

  const themeTask = (key: string): PlanTask => ({
    kind: 'theme',
    label: `15 puzzle: ${themeLabel(key)}`,
    detail: 'Al tuo livello nel tema, senza fretta: capisci il motivo prima di muovere.',
    link: `/puzzles?mode=theme&theme=${key}`,
  });
  const rotation: PlanTask[][] = [
    [themeTask(themeKeys[0]!), { kind: 'storm', label: 'Una Storm', detail: 'Riconoscimento rapido dei motivi.', link: '/storm' }],
    [
      {
        kind: 'adaptive',
        label: 'Partita adattiva',
        detail: structureWeak ? `Sulla struttura: ${labelFor('structure', structureWeak.key)}.` : 'Il computer ti mette davanti ai tuoi punti deboli.',
        link: '/play?adaptive=1',
      },
    ],
    [themeTask(themeKeys[1] ?? themeKeys[0]!), ...(hasRepertoire ? [{ kind: 'openings' as const, label: 'Allenamento aperture', detail: 'Ripassa le linee del repertorio.', link: '/openings' }] : [])],
    [
      endgameWeak
        ? { kind: 'endgame', label: 'Studio dei finali', detail: `${labelFor(endgameWeak.dimension, endgameWeak.key)}: rivedi la teoria con il coach e gioca una partita adattiva.`, link: '/play?adaptive=1' }
        : themeTask('rookEndgame'),
    ],
    [themeTask(themeKeys[2] ?? themeKeys[0]!), { kind: 'storm', label: 'Una Storm', detail: 'Prova a battere il record.', link: '/storm' }],
    [{ kind: 'adaptive', label: 'Partita adattiva', detail: 'Applica in partita quello che hai allenato.', link: '/play?adaptive=1' }],
    [
      {
        kind: 'games',
        label: 'Rivedi le partite della settimana',
        detail: Number(unreviewed.n) ? `${unreviewed.n} errori diagnosticati da rivedere.` : 'Gioca o importa partite: l\'analisi trova i tuoi errori ricorrenti.',
        link: '/games',
      },
    ],
  ];

  const days: WeeklyPlan['days'] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today.getTime() + i * 86_400_000);
    const tasks: PlanTask[] = [];
    if (i === 0 && puzzleDue > 0) {
      tasks.push({ kind: 'review', label: `Ripasso: ${puzzleDue} puzzle`, detail: 'Puzzle sbagliati in passato, a intervalli crescenti.', link: '/puzzles?mode=review' });
    } else if (i > 0) {
      tasks.push({ kind: 'review', label: 'Ripasso dei puzzle in scadenza', detail: 'Pochi minuti al giorno fissano i motivi.', link: '/puzzles?mode=review' });
    }
    if (i === 0 && lineDue > 0) {
      tasks.push({ kind: 'openings', label: `Ripasso: ${lineDue} linee d'apertura`, detail: 'Linee del repertorio in scadenza.', link: '/openings' });
    }
    tasks.push(...rotation[i % rotation.length]!);
    days.push({ date: d.toISOString().slice(0, 10), weekday: WEEKDAYS[d.getDay()]!, tasks });
  }
  return { focus, days };
}
