import { createHash } from 'node:crypto';
import { quizResponseSchema, type Quiz } from '@attn/shared';
import { describe, expect, it } from 'vitest';
import { loadQuiz, loadTaxonomy } from '../data';
import { fixtureQuiz } from './fixtures';
import { isMonotone, presentQuiz } from './present';
import { roleSkillIds } from './role';

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

describe('isMonotone', () => {
  it('detects non-decreasing and non-increasing sequences', () => {
    expect(isMonotone([0, 1, 2, 4])).toBe(true);
    expect(isMonotone([3, 3, 2, 1])).toBe(true);
    expect(isMonotone([1, 1, 1, 1])).toBe(true);
    expect(isMonotone([2, 0, 4, 1])).toBe(false);
    expect(isMonotone([0, 1, 1, 0])).toBe(false);
  });
});

/** The unsalted sha256 order (the original presentation), to build questions that would come out monotone. */
function unsaltedOrder(questionId: string, n: number): number[] {
  const key = (i: number) => createHash('sha256').update(`${questionId}:${i}`).digest('hex');
  return Array.from({ length: n }, (_, i) => i).sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

/** A question whose unsalted presented order shows exactly `presented` levels. */
function forcedQuestion(id: string, presented: (0 | 1 | 2 | 3 | 4)[]): Quiz['questions'][number] {
  const order = unsaltedOrder(id, presented.length);
  const levels: (0 | 1 | 2 | 3 | 4)[] = new Array(presented.length);
  order.forEach((bankIndex, pos) => (levels[bankIndex] = presented[pos]!));
  return { id, skill_id: 'mono', situation: 's', options: levels.map((level, i) => ({ text: `${id} o${i}`, level })) };
}

describe('presentQuiz never shows options in level order', () => {
  const cases: [string, (0 | 1 | 2 | 3 | 4)[]][] = [
    ['mono-1', [0, 1, 2, 3, 4]],
    ['mono-2', [4, 3, 2, 1, 0]],
    ['mono-3', [3, 3, 2, 1]],
    ['mono-4', [0, 1, 2, 4]],
    ['mono-5', [0, 0, 1, 2, 3, 4]],
  ];
  const bank: Quiz = { version: 1, questions: cases.map(([id, p]) => forcedQuestion(id, p)) };
  const levelOf = (qid: string, optionId: number) => bank.questions.find((q) => q.id === qid)!.options[optionId]!.level;

  it('the forced questions really are monotone in the unsalted order', () => {
    for (const q of bank.questions) {
      const order = unsaltedOrder(q.id, q.options.length);
      expect(isMonotone(order.map((i) => q.options[i]!.level))).toBe(true);
    }
  });

  it('re-salts deterministically until the order is not monotone', () => {
    const out = presentQuiz(bank, ['mono']);
    expect(out.questions).toHaveLength(cases.length);
    for (const q of out.questions) {
      expect(isMonotone(q.options.map((o) => levelOf(q.id, o.id)))).toBe(false);
      expect(q.options.map((o) => o.id).sort()).toEqual(q.options.map((_, i) => i));
    }
    expect(presentQuiz(bank, ['mono'])).toEqual(out);
  });

  it('terminates when every order is monotone (all levels equal)', () => {
    const flat: Quiz = {
      version: 1,
      questions: [{ id: 'flat-1', skill_id: 'flat', situation: 's', options: [0, 1, 2, 3].map((i) => ({ text: `o${i}`, level: 2 as const })) }],
    };
    expect(presentQuiz(flat, ['flat']).questions[0]!.options).toHaveLength(4);
  });
});

describe('presentQuiz over the real bank', () => {
  const bank = loadQuiz();
  const skills = roleSkillIds(loadTaxonomy(), 'dev');
  const presented = presentQuiz(bank, skills);
  const levelsOf = (q: (typeof presented.questions)[number]) => {
    const b = bank.questions.find((x) => x.id === q.id)!;
    return q.options.map((o) => b.options[o.id]!.level);
  };

  it('presents all 64 questions', () => {
    expect(presented.questions).toHaveLength(64);
    expect(presented.unavailable).toEqual([]);
  });

  it('never presents a question in non-decreasing or non-increasing level order', () => {
    const monotone = presented.questions.filter((q) => isMonotone(levelsOf(q))).map((q) => q.id);
    expect(monotone).toEqual([]);
  });

  it('keeps the mean position-level correlation near zero', () => {
    const rs = presented.questions.map((q) => pearson(q.options.map((_, i) => i), levelsOf(q)));
    const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
    expect(Math.abs(mean)).toBeLessThan(0.15);
  });
});

function pearson(x: number[], y: number[]): number {
  const mx = x.reduce((a, b) => a + b, 0) / x.length;
  const my = y.reduce((a, b) => a + b, 0) / y.length;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i]! - mx) * (y[i]! - my);
    sxx += (x[i]! - mx) ** 2;
    syy += (y[i]! - my) ** 2;
  }
  return sxx === 0 || syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
}
