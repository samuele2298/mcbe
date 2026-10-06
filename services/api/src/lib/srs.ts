import { createEmptyCard, fsrs, Rating, type Card, type Grade } from 'ts-fsrs';

// Ripetizione spaziata FSRS: conversione tra riga di srs_cards e Card di ts-fsrs.

export interface SrsRow {
  due_at: Date;
  stability: number;
  difficulty: number;
  scheduled_days: number;
  learning_steps: number;
  state: number;
  reps: number;
  lapses: number;
  last_review: Date | null;
}

const scheduler = fsrs({ enable_fuzz: true });

function toCard(row: SrsRow): Card {
  return {
    due: new Date(row.due_at),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: 0,
    scheduled_days: row.scheduled_days,
    learning_steps: row.learning_steps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    ...(row.last_review ? { last_review: new Date(row.last_review) } : {}),
  };
}

function toRow(card: Card): SrsRow {
  return {
    due_at: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    state: card.state,
    reps: card.reps,
    lapses: card.lapses,
    last_review: card.last_review ?? null,
  };
}

/** Applica una revisione. `row` null = carta nuova. */
export function review(row: SrsRow | null, success: boolean, now = new Date()): SrsRow {
  const card = row ? toCard(row) : createEmptyCard(now);
  const grade: Grade = success ? Rating.Good : Rating.Again;
  return toRow(scheduler.next(card, now, grade).card);
}
