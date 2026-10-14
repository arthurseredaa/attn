import { describe, expect, it } from 'vitest';
import { fixtureQuiz } from './fixtures';
import { lowerMedian, QuizAnswerError, scoreQuiz, scoreSkill, type QuizAnswer } from './quiz';

const p = (first: number, second: number) => ({ first, second });

describe('lowerMedian', () => {
  it('picks the lower median', () => {
    expect(lowerMedian([3])).toBe(3);
    expect(lowerMedian([1, 3])).toBe(1);
    expect(lowerMedian([4, 0, 2])).toBe(2);
    expect(lowerMedian([0, 4, 2, 3])).toBe(2);
    expect(lowerMedian([5, 1, 1, 5])).toBe(1);
  });
  it('does not mutate and throws on empty', () => {
    const v = [3, 1, 2];
    lowerMedian(v);
    expect(v).toEqual([3, 1, 2]);
    expect(() => lowerMedian([])).toThrow(RangeError);
  });
});

describe('scoreSkill', () => {
  it('level is the lower median of first choices', () => {
    expect(scoreSkill([p(2, 0), p(3, 0)], 1.5).level).toBe(2);
    expect(scoreSkill([p(4, 3), p(4, 3)], 1.5).level).toBe(4);
    expect(scoreSkill([p(0, 1), p(0, 1)], 1.5).level).toBe(0);
    expect(scoreSkill([p(3, 1)], 1.5).level).toBe(3);
  });
  it('uncertain when mean spread >= threshold', () => {
    expect(scoreSkill([p(2, 0), p(3, 0)], 1.5).uncertain).toBe(true);
    expect(scoreSkill([p(4, 3), p(4, 3)], 1.5).uncertain).toBe(false);
    expect(scoreSkill([p(3, 0), p(1, 1)], 1.5).uncertain).toBe(true);
    expect(scoreSkill([p(2, 0), p(1, 1)], 1.5).uncertain).toBe(false);
    expect(scoreSkill([p(1, 3), p(1, 3)], 1.5).uncertain).toBe(true);
    expect(scoreSkill([p(2, 2), p(3, 3)], 1.5).uncertain).toBe(false);
  });
});

describe('scoreQuiz', () => {
  const a = (questionId: string, first: number, second: number): QuizAnswer => ({ questionId, first, second });
  it('scores a skill', () => {
    expect(scoreQuiz(fixtureQuiz, [a('ce-1', 0, 1), a('ce-2', 0, 2)], 1.5)).toEqual([
      { skillId: 'context-engineering', level: 2, uncertain: true },
    ]);
    expect(scoreQuiz(fixtureQuiz, [a('ce-1', 2, 4), a('ce-2', 3, 0)], 1.5)).toEqual([
      { skillId: 'context-engineering', level: 4, uncertain: false },
    ]);
  });
  it('returns several skills sorted by skillId', () => {
    const r = scoreQuiz(
      fixtureQuiz,
      [a('ce-1', 2, 4), a('ce-2', 3, 0), a('ch-1', 1, 3), a('ch-2', 2, 3)],
      1.5,
    );
    expect(r.map((x) => x.skillId)).toEqual(['cc-hooks', 'context-engineering']);
    expect(r[0]).toEqual({ skillId: 'cc-hooks', level: 3, uncertain: false });
  });
  it('returns [] for no answers', () => expect(scoreQuiz(fixtureQuiz, [], 1.5)).toEqual([]));
  it.each([
    ['unknown_question', [a('nope', 0, 1)]],
    ['duplicate_question', [a('ce-1', 0, 1), a('ce-1', 0, 1)]],
    ['option_out_of_range', [a('ce-1', 9, 1)]],
    ['option_out_of_range', [a('ce-1', 0, 5)]],
    ['same_option', [a('ce-1', 1, 1)]],
    ['incomplete_skill', [a('ce-1', 0, 1)]],
  ])('throws %s', (code, answers) => {
    let err: unknown;
    try {
      scoreQuiz(fixtureQuiz, answers as QuizAnswer[], 1.5);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(QuizAnswerError);
    expect((err as QuizAnswerError).code).toBe(code);
  });
});
