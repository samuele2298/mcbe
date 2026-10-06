import { sql } from 'kysely';
import type { Db } from '../../db/index.js';
import { themeLabel } from '../../chess/themes.js';
import { claude, claudeConfigured, claudeModels } from '../../lib/claude.js';
import { labelFor } from './labels.js';

// Note di profilo: un riassunto periodico dei punti deboli, usato dal coach come memoria.
// Il riassunto descrive solo dati presenti nelle tabelle.

interface ProfileData {
  rating: number;
  attempts7d: number;
  weakest: Array<{ label: string; rate: number; attempts: number }>;
  mistakes30d: Array<{ label: string; n: number }>;
  games30d: number;
  accuracy: number | null;
}

async function collect(db: Db, userId: string): Promise<ProfileData> {
  const g = await db.selectFrom('weakness_stats').select('rating').where('user_id', '=', userId).where('dimension', '=', 'global').executeTakeFirst();
  const attempts = await db
    .selectFrom('puzzle_attempts')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('user_id', '=', userId)
    .where('created_at', '>', sql<Date>`now() - interval '7 days'`)
    .executeTakeFirstOrThrow();
  const weak = await db
    .selectFrom('weakness_stats')
    .select(['dimension', 'key', 'attempts', 'successes'])
    .where('user_id', '=', userId)
    .where('dimension', 'in', ['theme', 'structure', 'endgame_type', 'phase'])
    .where('attempts', '>=', 5)
    .orderBy(sql`successes::float / attempts`)
    .limit(5)
    .execute();
  const mistakes = await db
    .selectFrom('mistakes')
    .select(['category', (eb) => eb.fn.countAll<string>().as('n')])
    .where('user_id', '=', userId)
    .where('created_at', '>', sql<Date>`now() - interval '30 days'`)
    .groupBy('category')
    .orderBy('n', 'desc')
    .execute();
  const games = await db
    .selectFrom('games')
    .select([(eb) => eb.fn.countAll<string>().as('n'), (eb) => eb.fn.avg<number>('accuracy').as('acc')])
    .where('user_id', '=', userId)
    .where('played_at', '>', sql<Date>`now() - interval '30 days'`)
    .executeTakeFirstOrThrow();
  return {
    rating: Math.round(g?.rating ?? 1500),
    attempts7d: Number(attempts.n),
    weakest: weak.map((w) => ({
      label: w.dimension === 'theme' || w.dimension === 'phase' ? themeLabel(w.key) : labelFor(w.dimension, w.key),
      rate: Math.round((100 * w.successes) / w.attempts),
      attempts: w.attempts,
    })),
    mistakes30d: mistakes.map((m) => ({ label: labelFor('mistake', m.category), n: Number(m.n) })),
    games30d: Number(games.n),
    accuracy: games.acc === null ? null : Math.round(Number(games.acc)),
  };
}

function deterministicNote(d: ProfileData): string {
  const parts = [`Rating puzzle circa ${d.rating}.`];
  if (d.weakest.length) parts.push(`Temi più deboli: ${d.weakest.slice(0, 3).map((w) => `${w.label} (${w.rate}%)`).join(', ')}.`);
  if (d.mistakes30d.length) parts.push(`Errori più frequenti nelle partite: ${d.mistakes30d.slice(0, 3).map((m) => `${m.label} (${m.n})`).join(', ')}.`);
  if (d.games30d) parts.push(`${d.games30d} partite negli ultimi 30 giorni${d.accuracy !== null ? `, precisione media ${d.accuracy}%` : ''}.`);
  return parts.join(' ');
}

export async function generateProfileNote(db: Db, userId: string): Promise<string | null> {
  const d = await collect(db, userId);
  if (!d.weakest.length && !d.mistakes30d.length) return null;
  let content = deterministicNote(d);
  if (claudeConfigured()) {
    try {
      const res = await claude().messages.create({
        model: claudeModels.cheap,
        max_tokens: 600,
        system:
          'Scrivi in italiano una nota di 2-3 frasi per un allenatore di scacchi che riassume i punti deboli di uno studente. ' +
          'Usa SOLO i dati forniti, senza aggiungere consigli generici o dati inventati. Niente elenchi, niente notazione.',
        messages: [{ role: 'user', content: JSON.stringify(d) }],
      });
      const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim();
      if (res.stop_reason !== 'refusal' && text) content = text;
    } catch {
      // si tiene la nota deterministica
    }
  }
  await db.insertInto('profile_notes').values({ user_id: userId, content, based_on: JSON.stringify(d) as never }).execute();
  return content;
}

/** Utenti attivi nell'ultima settimana senza una nota recente. */
export async function usersNeedingNotes(db: Db): Promise<string[]> {
  const rows = await sql<{ id: string }>`
    SELECT u.id FROM users u
    WHERE (EXISTS (SELECT 1 FROM puzzle_attempts a WHERE a.user_id = u.id AND a.created_at > now() - interval '7 days')
        OR EXISTS (SELECT 1 FROM games g WHERE g.user_id = u.id AND g.played_at > now() - interval '7 days'))
      AND NOT EXISTS (SELECT 1 FROM profile_notes n WHERE n.user_id = u.id AND n.created_at > now() - interval '6 days')`.execute(db);
  return rows.rows.map((r) => r.id);
}
