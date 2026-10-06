import { describe, expect, it } from 'vitest';
import { review } from '../src/lib/srs.js';

describe('review (FSRS)', () => {
  it('una carta sbagliata torna presto, una risolta più tardi', () => {
    const now = new Date('2026-10-01T10:00:00Z');
    const failed = review(null, false, now);
    expect(failed.reps).toBe(1);
    const later = new Date(failed.due_at.getTime() + 60_000);
    const ok1 = review(failed, true, later);
    const ok2 = review(ok1, true, new Date(ok1.due_at.getTime() + 60_000));
    expect(ok2.due_at.getTime()).toBeGreaterThan(ok1.due_at.getTime());
    expect(ok2.reps).toBe(3);
  });
});
