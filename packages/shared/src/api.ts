import { z } from 'zod';
import { articleTypeSchema, levelSchema } from './enums';

// ---- errors ---------------------------------------------------------------
export const errorBodySchema = z.looseObject({ error: z.string(), message: z.string() });
export type ErrorBody = z.infer<typeof errorBodySchema>;

// ---- auth -----------------------------------------------------------------
export const meSchema = z.object({
  id: z.uuid(),
  login: z.string(),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  role: z.string(),
});
export type Me = z.infer<typeof meSchema>;

export const AUTH_ERROR_CODES = ['not_configured', 'access_denied', 'state_mismatch', 'oauth_failed'] as const;
export const authErrorCodeSchema = z.enum(AUTH_ERROR_CODES);
export type AuthErrorCode = z.infer<typeof authErrorCodeSchema>;

export const AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  not_configured: 'Sign-in with GitHub is not configured on this server.',
  access_denied: 'GitHub sign-in was cancelled. You can try again any time.',
  state_mismatch: 'The sign-in attempt expired or did not start here. Please try again.',
  oauth_failed: 'Could not complete sign-in with GitHub. Please try again in a moment.',
};

/** Fixed message for a known `auth_error` code; null for anything else (never echo user input). */
export function authErrorMessage(code: string | undefined): string | null {
  const parsed = authErrorCodeSchema.safeParse(code);
  return parsed.success ? AUTH_ERROR_MESSAGES[parsed.data] : null;
}

// ---- sources --------------------------------------------------------------
export const sourceSummarySchema = z.object({ id: z.string(), name: z.string() });
export type SourceSummary = z.infer<typeof sourceSummarySchema>;
export const sourcesResponseSchema = z.array(sourceSummarySchema);

// ---- articles -------------------------------------------------------------
export const articleSkillSchema = z.object({ id: z.string(), name: z.string(), isPrimary: z.boolean() });

export const articleCardSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  // Rendered as a link by the web: allow http(s) only (defence in depth against javascript: URLs).
  url: z.url({ protocol: /^https?$/ }),
  sourceId: z.string(),
  sourceName: z.string(),
  publishedAt: z.iso.datetime(),
  wordCount: z.number().int().nullable(),
  difficulty: levelSchema,
  type: articleTypeSchema,
  quality: levelSchema,
  skills: z.array(articleSkillSchema),
});
export type ArticleCard = z.infer<typeof articleCardSchema>;

export const articlesPageSchema = z.object({
  items: z.array(articleCardSchema),
  nextCursor: z.string().nullable(),
});
export type ArticlesPage = z.infer<typeof articlesPageSchema>;

export const ARTICLES_MAX_LIMIT = 50;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/** `YYYY-MM-DD` (a real calendar day) or an ISO 8601 datetime with an explicit timezone. */
export function isDateBound(s: string): boolean {
  if (DATE_ONLY.test(s)) {
    const d = new Date(`${s}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }
  return DATE_TIME.test(s) && !Number.isNaN(Date.parse(s));
}

/** `from` is inclusive; `toExclusive` is exclusive. Date-only values cover the whole UTC day. */
export function resolveDateRange(q: { from?: string; to?: string }): { from?: Date; toExclusive?: Date } {
  const out: { from?: Date; toExclusive?: Date } = {};
  if (q.from !== undefined) {
    out.from = new Date(DATE_ONLY.test(q.from) ? `${q.from}T00:00:00.000Z` : q.from);
  }
  if (q.to !== undefined) {
    out.toExclusive = DATE_ONLY.test(q.to)
      ? new Date(new Date(`${q.to}T00:00:00.000Z`).getTime() + 86_400_000)
      : new Date(new Date(q.to).getTime() + 1);
  }
  return out;
}

const dateBound = z.string().refine(isDateBound, 'must be YYYY-MM-DD or an ISO 8601 datetime with timezone');

export const articlesQuerySchema = z
  .object({
    source: z.string().min(1).optional(),
    skill: z.string().min(1).optional(),
    from: dateBound.optional(),
    to: dateBound.optional(),
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(ARTICLES_MAX_LIMIT).optional(),
  })
  .superRefine((q, ctx) => {
    const { from, toExclusive } = resolveDateRange(q);
    if (from && toExclusive && from.getTime() >= toExclusive.getTime()) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'to must not be before from' });
    }
  });
export type ArticlesQuery = z.infer<typeof articlesQuerySchema>;
