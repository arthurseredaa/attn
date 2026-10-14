import type { Level, Quiz } from '@attn/shared';

export interface QuizAnswer {
  questionId: string;
  first: number;
  second: number;
}

export interface SkillQuizResult {
  skillId: string;
  level: Level;
  uncertain: boolean;
}

export class QuizAnswerError extends Error {
  constructor(
    public readonly code:
      | 'unknown_question'
      | 'duplicate_question'
      | 'option_out_of_range'
      | 'same_option'
      | 'incomplete_skill',
    message: string,
  ) {
    super(message);
    this.name = 'QuizAnswerError';
  }
}

export function lowerMedian(values: number[]): number {
  if (values.length === 0) throw new RangeError('lowerMedian of an empty list');
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] as number;
}

/** `pairs` hold option LEVELS (not option ids). */
export function scoreSkill(
  pairs: { first: number; second: number }[],
  uncertainSpread: number,
): { level: Level; uncertain: boolean } {
  const level = lowerMedian(pairs.map((p) => p.first)) as Level;
  const spread = pairs.reduce((sum, p) => sum + Math.abs(p.first - p.second), 0) / pairs.length;
  return { level, uncertain: spread >= uncertainSpread };
}

export function scoreQuiz(bank: Quiz, answers: QuizAnswer[], uncertainSpread: number): SkillQuizResult[] {
  const byId = new Map(bank.questions.map((q) => [q.id, q]));
  const seen = new Set<string>();
  const perSkill = new Map<string, { first: number; second: number }[]>();

  for (const a of answers) {
    const q = byId.get(a.questionId);
    if (!q) throw new QuizAnswerError('unknown_question', `Unknown question: ${a.questionId}`);
    if (seen.has(a.questionId)) {
      throw new QuizAnswerError('duplicate_question', `Question answered twice: ${a.questionId}`);
    }
    seen.add(a.questionId);
    const n = q.options.length;
    for (const o of [a.first, a.second]) {
      if (!Number.isInteger(o) || o < 0 || o >= n) {
        throw new QuizAnswerError('option_out_of_range', `Option out of range for ${a.questionId}`);
      }
    }
    if (a.first === a.second) {
      throw new QuizAnswerError('same_option', `Second choice must differ from first for ${a.questionId}`);
    }
    const pairs = perSkill.get(q.skill_id) ?? [];
    pairs.push({
      first: (q.options[a.first] as { level: number }).level,
      second: (q.options[a.second] as { level: number }).level,
    });
    perSkill.set(q.skill_id, pairs);
  }

  for (const [skillId, pairs] of perSkill) {
    const required = bank.questions.filter((q) => q.skill_id === skillId).length;
    if (pairs.length !== required) {
      throw new QuizAnswerError('incomplete_skill', `Skill ${skillId} needs all ${required} questions answered`);
    }
  }

  return [...perSkill.entries()]
    .map(([skillId, pairs]) => ({ skillId, ...scoreSkill(pairs, uncertainSpread) }))
    .sort((a, b) => (a.skillId < b.skillId ? -1 : a.skillId > b.skillId ? 1 : 0));
}
