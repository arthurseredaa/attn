import { z } from 'zod';
import { levelSchema } from './enums';

export const MAX_FOCUS = 5;

// ---- quiz (levels are intentionally absent; strict schemas keep them out) ----
export const quizOptionDtoSchema = z.strictObject({ id: z.number().int().min(0), text: z.string() });
export type QuizOptionDto = z.infer<typeof quizOptionDtoSchema>;

export const quizQuestionDtoSchema = z.strictObject({
  id: z.string(),
  skillId: z.string(),
  situation: z.string(),
  options: z.array(quizOptionDtoSchema).min(4).max(6),
});
export type QuizQuestionDto = z.infer<typeof quizQuestionDtoSchema>;

export const quizResponseSchema = z.strictObject({
  version: z.number(),
  questions: z.array(quizQuestionDtoSchema),
  /** Requested role skills that have no questions in the bank. */
  unavailable: z.array(z.string()),
});
export type QuizResponse = z.infer<typeof quizResponseSchema>;

export const quizQuerySchema = z.object({
  skills: z
    .string()
    .transform((s) => [...new Set(s.split(',').map((x) => x.trim()).filter(Boolean))])
    .pipe(z.array(z.string()).min(1).max(64)),
});

// ---- onboarding / focus ------------------------------------------------------
export const quizAnswerSchema = z.strictObject({
  questionId: z.string().min(1),
  first: z.number().int().min(0),
  second: z.number().int().min(0),
});
export type QuizAnswerInput = z.infer<typeof quizAnswerSchema>;

export const focusSchema = z
  .array(z.string().min(1))
  .min(1)
  .max(MAX_FOCUS)
  .refine((a) => new Set(a).size === a.length, 'focus skills must be unique');

export const onboardingBodySchema = z.strictObject({
  focus: focusSchema.optional(),
  answers: z.array(quizAnswerSchema).max(200),
});
export type OnboardingBody = z.infer<typeof onboardingBodySchema>;

export const focusBodySchema = z.strictObject({ focus: focusSchema });
export type FocusBody = z.infer<typeof focusBodySchema>;

// ---- profile -----------------------------------------------------------------
export const profileSkillSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  /** null = no quiz result and no read-based level-up yet. */
  level: levelSchema.nullable(),
  /** `level ?? 1`: the level every other part of the system uses. */
  effectiveLevel: levelSchema,
  assessed: z.boolean(),
  /** True when the user has quiz answers for this skill; drives "Take quiz" (a read-based level-up does not set it). */
  quizzed: z.boolean(),
  /** Unassessed skills are always uncertain. */
  uncertain: z.boolean(),
  points: z.number().int().min(0),
  /** points_per_level, or null at level 4 (no next level). */
  pointsNeeded: z.number().int().positive().nullable(),
  focusRank: z.number().int().min(1).max(MAX_FOCUS).nullable(),
});
export type ProfileSkill = z.infer<typeof profileSkillSchema>;

export const profileDomainSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  skills: z.array(profileSkillSchema),
});
export type ProfileDomain = z.infer<typeof profileDomainSchema>;

export const focusEntrySchema = z.strictObject({
  rank: z.number().int().min(1).max(MAX_FOCUS),
  skillId: z.string(),
  name: z.string(),
});
export type FocusEntry = z.infer<typeof focusEntrySchema>;

export const historyItemSchema = z.strictObject({
  articleId: z.number().int(),
  title: z.string(),
  url: z.url({ protocol: /^https?$/ }),
  sourceName: z.string(),
  readAt: z.iso.datetime(),
});
export type HistoryItem = z.infer<typeof historyItemSchema>;

export const profileSchema = z.strictObject({
  onboarded: z.boolean(),
  role: z.string(),
  focus: z.array(focusEntrySchema),
  domains: z.array(profileDomainSchema),
  history: z.strictObject({ items: z.array(historyItemSchema), total: z.number().int().min(0) }),
  likes: z.strictObject({
    read: z.number().int().min(0),
    liked: z.number().int().min(0),
    /** liked / read among articles the user read; null when nothing was read. */
    share: z.number().min(0).max(1).nullable(),
  }),
});
export type Profile = z.infer<typeof profileSchema>;
