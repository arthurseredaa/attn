import { quizResponseSchema } from '@attn/shared';
import { describe, expect, it } from 'vitest';
import { fixtureQuiz } from './fixtures';
import { presentQuiz } from './present';

describe('presentQuiz', () => {
  const skills = ['cc-hooks', 'context-engineering'];
  const result = presentQuiz(fixtureQuiz, skills);

  it('orders questions by requested skills then bank order', () => {
    expect(result.questions.map((q) => q.id)).toEqual(['ch-1', 'ch-2', 'ce-1', 'ce-2']);
    expect(result.version).toBe(7);
    expect(result.unavailable).toEqual([]);
  });
  it('option ids are bank indexes', () => {
    for (const q of result.questions) {
      const bank = fixtureQuiz.questions.find((b) => b.id === q.id)!;
      expect(q.options.map((o) => o.id).sort()).toEqual(bank.options.map((_, i) => i));
      for (const o of q.options) expect(o.text).toBe(bank.options[o.id]!.text);
    }
  });
  it('is deterministic and actually shuffles', () => {
    expect(presentQuiz(fixtureQuiz, skills)).toEqual(result);
    const shuffled = result.questions.some((q) => q.options.some((o, i) => o.id !== i));
    expect(shuffled).toBe(true);
  });
  it('passes the strict schema and leaks no level', () => {
    expect(() => quizResponseSchema.parse(result)).not.toThrow();
    expect(JSON.stringify(result)).not.toContain('"level"');
  });
  it('reports unavailable skills and dedupes', () => {
    expect(presentQuiz(fixtureQuiz, ['evals'])).toMatchObject({ questions: [], unavailable: ['evals'] });
    const mixed = presentQuiz(fixtureQuiz, ['evals', 'cc-hooks', 'cc-hooks']);
    expect(mixed.questions.map((q) => q.id)).toEqual(['ch-1', 'ch-2']);
    expect(mixed.unavailable).toEqual(['evals']);
  });
});
