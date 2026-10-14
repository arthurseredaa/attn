import { createHash } from 'node:crypto';
import type { Quiz, QuizResponse } from '@attn/shared';

/** Bounded so a question whose every order is monotone (all levels equal) still terminates. */
const MAX_SALT = 64;

function shuffleKey(questionId: string, index: number, salt: number): string {
  const seed = salt === 0 ? `${questionId}:${index}` : `${questionId}:${index}:${salt}`;
  return createHash('sha256').update(seed).digest('hex');
}

/** True when the sequence is non-decreasing or non-increasing. */
export function isMonotone(xs: readonly number[]): boolean {
  const asc = xs.every((x, i) => i === 0 || xs[i - 1]! <= x);
  const desc = xs.every((x, i) => i === 0 || xs[i - 1]! >= x);
  return asc || desc;
}

/**
 * Deterministic shuffle of a question's option indexes (sha256 of `id:index`). An order whose levels are
 * sorted (either way) would give the levels away, so it is re-salted (`id:index:n`) until it is not.
 */
function presentedOrder(q: Quiz['questions'][number]): number[] {
  const indexes = q.options.map((_, i) => i);
  let order = indexes;
  for (let salt = 0; salt < MAX_SALT; salt++) {
    const keys = indexes.map((i) => shuffleKey(q.id, i, salt));
    order = [...indexes].sort((a, b) => (keys[a]! < keys[b]! ? -1 : keys[a]! > keys[b]! ? 1 : 0));
    if (!isMonotone(order.map((i) => q.options[i]!.level))) return order;
  }
  return order;
}

/** Questions for the skills in the given order; option ids are bank indexes, levels are stripped. */
export function presentQuiz(bank: Quiz, skillIds: string[]): QuizResponse {
  const skills = [...new Set(skillIds)];
  const questions: QuizResponse['questions'] = [];
  const unavailable: string[] = [];
  for (const skillId of skills) {
    const qs = bank.questions.filter((q) => q.skill_id === skillId);
    if (qs.length === 0) unavailable.push(skillId);
    for (const q of qs) {
      const options = presentedOrder(q).map((i) => ({ id: i, text: q.options[i]!.text }));
      questions.push({ id: q.id, skillId: q.skill_id, situation: q.situation, options });
    }
  }
  return { version: bank.version, questions, unavailable };
}
