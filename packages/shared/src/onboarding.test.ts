import { describe, expect, it } from 'vitest';
import {
  onboardingBodySchema,
  profileSchema,
  quizBankIssues,
  quizCoverageIssues,
  quizQuerySchema,
  quizResponseSchema,
  type Quiz,
  type Taxonomy,
} from './index';

const skill = (id: string, roles: string[] = ['dev']) => ({ id, name: id, description: 'x', roles });
const taxonomy = (skills = [skill('a'), skill('b')]): Taxonomy => ({
  version: 1,
  levels: [0, 1, 2, 3, 4].map((level) => ({ level, label: `L${level}`, description: 'd' })),
  domains: [{ id: 'd1', name: 'D1', skills }],
}) as Taxonomy;

const q = (id: string, skillId: string, levels: number[], texts?: string[]) => ({
  id,
  skill_id: skillId,
  situation: 's',
  options: levels.map((level, i) => ({ text: texts?.[i] ?? `${id} opt ${i}`, level })),
});
const bank = (...questions: ReturnType<typeof q>[]) => ({ version: 1, questions }) as Quiz;
const valid = () => [q('a-1', 'a', [2, 0, 4, 1]), q('a-2', 'a', [3, 1, 0, 4, 2])];

describe('quizBankIssues', () => {
  it('accepts a valid bank', () => {
    expect(quizBankIssues(bank(...valid()), taxonomy())).toEqual([]);
  });

  const cases: [string, ReturnType<typeof q>[], string, string][] = [
    ['duplicate id', [...valid(), q('a-1', 'a', [2, 0, 4, 1])], 'a-1', 'duplicate question id'],
    ['bad id pattern', [...valid(), q('x1', 'a', [2, 0, 4, 1])], 'x1', 'id must be'],
    ['unknown skill', [...valid(), q('z-1', 'z', [2, 0, 4, 1])], 'z-1', 'unknown skill_id'],
    ['single question skill', [...valid(), q('b-1', 'b', [2, 0, 4, 1])], 'b', 'at least 2 questions'],
    [
      'duplicate option text',
      [valid()[0]!, q('a-2', 'a', [3, 1, 0, 4], ['Same', 'same', 'x', 'y'])],
      'a-2',
      'duplicate option text',
    ],
    ['fewer than 3 distinct levels', [valid()[0]!, q('a-2', 'a', [1, 1, 2, 2])], 'a-2', 'distinct'],
    ['span under 2', [valid()[0]!, q('a-2', 'a', [1, 2, 1, 2])], 'a-2', 'span'],
    ['ascending', [valid()[0]!, q('a-2', 'a', [0, 1, 2, 3])], 'a-2', 'sorted'],
    ['descending', [valid()[0]!, q('a-2', 'a', [4, 3, 2, 1])], 'a-2', 'sorted'],
    ['non-strict ascending', [valid()[0]!, q('a-2', 'a', [0, 0, 2, 4])], 'a-2', 'sorted'],
    [
      'self-rating word',
      [valid()[0]!, q('a-2', 'a', [3, 1, 0, 4], ['I am an expert', 'Beginner', 'p', 'r'])],
      'a-2',
      'self-rating',
    ],
  ];
  it.each(cases)('flags %s', (_name, questions, id, fragment) => {
    const issues = quizBankIssues(bank(...questions), taxonomy());
    const hit = issues.filter((i) => i.includes(fragment));
    expect(hit.length).toBeGreaterThan(0);
    expect(hit.every((i) => i.includes(id))).toBe(true);
  });
});

describe('quizCoverageIssues', () => {
  it('lists role skills without a question', () => {
    expect(quizCoverageIssues(bank(...valid()), taxonomy(), 'dev')).toEqual(['b: no quiz questions']);
  });
  it('returns [] when covered', () => {
    const full = bank(...valid(), q('b-1', 'b', [2, 0, 4, 1]), q('b-2', 'b', [3, 1, 0, 4]));
    expect(quizCoverageIssues(full, taxonomy(), 'dev')).toEqual([]);
  });
  it('ignores skills of other roles', () => {
    expect(quizCoverageIssues(bank(...valid()), taxonomy([skill('a'), skill('b', ['pm'])]), 'dev')).toEqual([]);
  });
});

describe('quizQuerySchema', () => {
  it('trims and de-duplicates', () => {
    expect(quizQuerySchema.parse({ skills: ' a, b ,a,,' })).toEqual({ skills: ['a', 'b'] });
  });
  it('rejects empty and missing', () => {
    expect(() => quizQuerySchema.parse({ skills: '' })).toThrow();
    expect(() => quizQuerySchema.parse({ skills: ',' })).toThrow();
    expect(() => quizQuerySchema.parse({})).toThrow();
  });
});

describe('onboardingBodySchema', () => {
  const ok = (v: unknown) => onboardingBodySchema.safeParse(v).success;
  const ans = { questionId: 'a-1', first: 0, second: 1 };
  it('accepts with and without focus', () => {
    expect(ok({ focus: ['a'], answers: [] })).toBe(true);
    expect(ok({ answers: [] })).toBe(true);
    expect(ok({ answers: [ans] })).toBe(true);
  });
  it('rejects invalid bodies', () => {
    expect(ok({ focus: ['a'] })).toBe(false);
    expect(ok({ focus: [], answers: [] })).toBe(false);
    expect(ok({ focus: ['a', 'b', 'c', 'd', 'e', 'f'], answers: [] })).toBe(false);
    expect(ok({ focus: ['a', 'a'], answers: [] })).toBe(false);
    expect(ok({ answers: [{ ...ans, first: -1 }] })).toBe(false);
    expect(ok({ answers: [{ ...ans, second: 1.5 }] })).toBe(false);
    expect(ok({ answers: [{ ...ans, level: 3 }] })).toBe(false);
    expect(ok({ answers: [], extra: 1 })).toBe(false);
  });
});

describe('quizResponseSchema', () => {
  const question = { id: 'a-1', skillId: 'a', situation: 's', options: [0, 1, 2, 3].map((id) => ({ id, text: `t${id}` })) };
  it('parses a valid response', () => {
    expect(quizResponseSchema.safeParse({ version: 1, questions: [question], unavailable: [] }).success).toBe(true);
  });
  it('rejects an option carrying a level', () => {
    const leaky = { ...question, options: question.options.map((o) => ({ ...o, level: 2 })) };
    expect(quizResponseSchema.safeParse({ version: 1, questions: [leaky], unavailable: [] }).success).toBe(false);
  });
});

describe('profileSchema', () => {
  const base = {
    onboarded: false,
    role: 'dev',
    focus: [],
    domains: [],
    history: { items: [], total: 0 },
    likes: { read: 0, liked: 0, share: null },
  };
  const pskill = {
    id: 'a', name: 'A', description: 'd', level: null, effectiveLevel: 1, assessed: false, quizzed: false,
    uncertain: true, points: 0, pointsNeeded: 5, focusRank: null,
  };
  it('parses a minimal profile', () => {
    expect(profileSchema.safeParse(base).success).toBe(true);
  });
  it('rejects focusRank 6', () => {
    const p = { ...base, domains: [{ id: 'd', name: 'D', skills: [{ ...pskill, focusRank: 6 }] }] };
    expect(profileSchema.safeParse(p).success).toBe(false);
    expect(profileSchema.safeParse({ ...p, domains: [{ id: 'd', name: 'D', skills: [pskill] }] }).success).toBe(true);
  });
  it('rejects a javascript: history url', () => {
    const item = { articleId: 1, title: 't', url: 'javascript:alert(1)', sourceName: 's', readAt: '2026-10-14T00:00:00Z' };
    expect(profileSchema.safeParse({ ...base, history: { items: [item], total: 1 } }).success).toBe(false);
  });
});
