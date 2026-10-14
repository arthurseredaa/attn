import { createHash } from 'node:crypto';
import type { Quiz, QuizResponse } from '@attn/shared';

function shuffleKey(questionId: string, index: number): string {
  return createHash('sha256').update(`${questionId}:${index}`).digest('hex');
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
      const options = q.options
        .map((o, i) => ({ id: i, text: o.text }))
        .sort((a, b) => {
          const ka = shuffleKey(q.id, a.id);
          const kb = shuffleKey(q.id, b.id);
          return ka < kb ? -1 : ka > kb ? 1 : 0;
        });
      questions.push({ id: q.id, skillId: q.skill_id, situation: q.situation, options });
    }
  }
  return { version: bank.version, questions, unavailable };
}
