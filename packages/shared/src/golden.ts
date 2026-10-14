import { z } from 'zod';
import { articleTypeSchema, levelSchema } from './enums';

export const goldenItemSchema = z.object({
  url: z.string().url(),
  primary_skill: z.string().min(1),
  secondary_skills: z.array(z.string().min(1)).max(3).default([]),
  difficulty: levelSchema,
  type: articleTypeSchema,
  quality: levelSchema,
});
export type GoldenItem = z.infer<typeof goldenItemSchema>;

export const goldenSchema = z.array(goldenItemSchema);
export type Golden = z.infer<typeof goldenSchema>;
