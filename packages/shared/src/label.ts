import { z } from 'zod';
import { articleTypeSchema, levelSchema, type ArticleType } from './enums';
import type { Taxonomy } from './taxonomy';

export interface LabelOutput {
  primary_skill: string;
  secondary_skills: string[];
  difficulty: number;
  type: ArticleType;
  quality: number;
}

export function taxonomySkillIds(taxonomy: Taxonomy): [string, ...string[]] {
  const ids = taxonomy.domains.flatMap((d) => d.skills.map((s) => s.id));
  const [first, ...rest] = ids;
  if (first === undefined) throw new Error('taxonomy has no skills');
  return [first, ...rest];
}

export function buildLabelOutputSchema(skillIds: readonly [string, ...string[]]) {
  const skill = z.enum(skillIds);
  return z.object({
    primary_skill: skill,
    secondary_skills: z.array(skill).max(3),
    difficulty: levelSchema,
    type: articleTypeSchema,
    quality: levelSchema,
  });
}

export function normalizeLabel(label: LabelOutput): LabelOutput {
  const seen = new Set<string>([label.primary_skill]);
  const secondary_skills: string[] = [];
  for (const s of label.secondary_skills) {
    if (seen.has(s)) continue;
    seen.add(s);
    secondary_skills.push(s);
  }
  return { ...label, secondary_skills };
}
