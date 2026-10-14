import type { Quiz } from '@attn/shared';

type L = 0 | 1 | 2 | 3 | 4;

function q(id: string, skill_id: string, levels: L[]): Quiz['questions'][number] {
  return {
    id,
    skill_id,
    situation: `Situation ${id}`,
    options: levels.map((level, i) => ({ text: `${id} option ${i}`, level })),
  };
}

/** Test bank; deliberately not run through quizBankIssues (ids do not follow the real pattern). */
export const fixtureQuiz: Quiz = {
  version: 7,
  questions: [
    q('ce-1', 'context-engineering', [2, 0, 4, 1, 3]),
    q('ce-2', 'context-engineering', [3, 1, 0, 4, 2]),
    q('ch-1', 'cc-hooks', [1, 3, 0, 2]),
    q('ch-2', 'cc-hooks', [2, 0, 3, 4]),
  ],
};
