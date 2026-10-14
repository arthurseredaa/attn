import { z } from 'zod';
import { levelSchema } from './enums';

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
