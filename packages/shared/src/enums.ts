import { z } from 'zod';

export const levelSchema = z.number().int().min(0).max(4);
export type Level = z.infer<typeof levelSchema>;

export const articleTypeSchema = z.enum(['release', 'tutorial', 'deep_dive', 'news', 'research']);
export type ArticleType = z.infer<typeof articleTypeSchema>;

export const eventKindSchema = z.enum(['read', 'like', 'too_easy', 'too_hard', 'not_interested']);
export type EventKind = z.infer<typeof eventKindSchema>;

export const labelStatusSchema = z.enum(['pending', 'labeled', 'failed']);
export type LabelStatus = z.infer<typeof labelStatusSchema>;
