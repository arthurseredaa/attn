import { z } from 'zod';
import { levelSchema } from './enums';
import type { Taxonomy } from './taxonomy';

export const quizQuestionSchema = z.object({
  id: z.string().min(1),
  skill_id: z.string().min(1),
  situation: z.string().min(1),
  options: z.array(z.object({ text: z.string().min(1), level: levelSchema })).min(4).max(6),
});

export const quizSchema = z.object({
  version: z.number(),
  questions: z.array(quizQuestionSchema),
});
export type Quiz = z.infer<typeof quizSchema>;

const SELF_RATING = /\b(beginner|intermediate|expert|novice)\b/i;

/** Structural problems of a question bank against the taxonomy. Empty array = valid. */
export function quizBankIssues(quiz: Quiz, taxonomy: Taxonomy): string[] {
  const issues: string[] = [];
  const skills = new Set(taxonomy.domains.flatMap((d) => d.skills.map((s) => s.id)));
  const seen = new Set<string>();
  const perSkill = new Map<string, number>();
  for (const q of quiz.questions) {
    if (seen.has(q.id)) issues.push(`${q.id}: duplicate question id`);
    seen.add(q.id);
    if (!skills.has(q.skill_id)) issues.push(`${q.id}: unknown skill_id ${q.skill_id}`);
    if (!new RegExp(`^${q.skill_id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+$`).test(q.id)) {
      issues.push(`${q.id}: id must be <skill_id>-<n> (skill_id ${q.skill_id})`);
    }
    perSkill.set(q.skill_id, (perSkill.get(q.skill_id) ?? 0) + 1);
    const levels = q.options.map((o) => o.level);
    const distinct = new Set(levels);
    if (distinct.size < 3) issues.push(`${q.id}: needs at least 3 distinct option levels`);
    if (Math.max(...levels) - Math.min(...levels) < 2) issues.push(`${q.id}: option levels must span at least 2`);
    const asc = levels.every((l, i) => i === 0 || (levels[i - 1] ?? 0) <= l);
    const desc = levels.every((l, i) => i === 0 || (levels[i - 1] ?? 0) >= l);
    if (asc || desc) issues.push(`${q.id}: options are sorted by level; scramble their order`);
    const texts = new Set<string>();
    for (const o of q.options) {
      const key = o.text.trim().toLowerCase();
      if (texts.has(key)) issues.push(`${q.id}: duplicate option text "${o.text}"`);
      texts.add(key);
      if (SELF_RATING.test(o.text)) issues.push(`${q.id}: option reads like a self-rating: "${o.text}"`);
    }
  }
  for (const [skill, n] of perSkill) {
    if (n < 2) issues.push(`${skill}: needs at least 2 questions, has ${n}`);
  }
  return issues;
}

/** Skills of `role` that have no question in the bank. */
export function quizCoverageIssues(quiz: Quiz, taxonomy: Taxonomy, role: string): string[] {
  const covered = new Set(quiz.questions.map((q) => q.skill_id));
  return taxonomy.domains
    .flatMap((d) => d.skills)
    .filter((s) => s.roles.includes(role) && !covered.has(s.id))
    .map((s) => `${s.id}: no quiz questions`);
}
