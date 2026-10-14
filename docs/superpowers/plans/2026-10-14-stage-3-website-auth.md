# ATTN Stage 3: Website + Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A visitor can open the ATTN landing page, sign in with GitHub, and browse the public "All" list of labeled articles with source, skill and date filters and cursor pagination; the api owns auth (session cookie, `GET /me`) and all request/response shapes are zod schemas in `packages/shared`.

**Architecture:** `apps/api` gains an `auth` module (hand-written GitHub OAuth with a `state` cookie, hashed-token sessions, `SessionGuard`, `GET /me`), an `articles` module (`GET /articles`, keyset pagination on `(published_at, id)`), a tiny `meta` module (`GET /sources`, `GET /taxonomy`) and a global JSON exception filter. `apps/web` is a Next.js app-router site (server components, Tailwind) that rewrites `/api/*` to the api, so the browser sees one origin; it is frontend only and reads data through a typed server-side API client built on the shared zod schemas. Docker files and compose services are added but cannot be built in this environment.

**Tech Stack:** Node 24, pnpm workspaces, TypeScript 6.0.3 (pinned by `^6.0.3` at the root; do not upgrade to 7), vitest 5, zod 4, NestJS 12.1.x (+ `@types/express`), Drizzle + postgres.js, Next.js 16.4 (`next@latest` on 2026-10-14), React 19.3, Tailwind CSS 4.3, Postgres 17.

**Spec:** `docs/superpowers/specs/2026-10-14-attn-design.md` (binding). Stage 3 = spec §9 item 3, with §2, §6.2, §6.4, §6.5, §6.6, §7, §8. Earlier plans for conventions: `docs/superpowers/plans/2026-10-14-stage-1-foundation-collect.md`, `docs/superpowers/plans/2026-10-14-stage-2-label-eval.md`.

## Global Constraints

Every task's requirements implicitly include this section. Values are copied from the spec or the environment.

- **Auth (spec §6.5):** NestJS owns auth. GitHub OAuth flow in `apps/api`; on success it upserts the user (name and avatar from the profile), inserts a `sessions` row whose `id` is the sha256 of the random cookie token, and sets an httpOnly, Secure, SameSite=Lax cookie with that token. Logout deletes the row. Next.js proxies `/api/*`, so the cookie is first-party and no CORS is needed. A failed OAuth returns to the landing page with a message.
- **Public articles (spec §6.2):** All = `labeled` articles only, newest first; filters by source, skill and date range; cursor pagination on `published_at`. No feedback buttons. No login needed.
- **API (spec §6.6):** prefix `/api`. In scope here: `GET /auth/github`, `GET /auth/github/callback`, `POST /auth/logout`, `GET /me`, `GET /articles?source=&skill=&from=&to=&cursor=`, plus `GET /taxonomy` (listed by the spec). Errors are JSON `{ error, message }`. Request and response shapes are zod schemas in `packages/shared`.
- **Landing (spec §6.4):** what ATTN does (ranking by skill priority and level), "Sign in with GitHub", link to All.
- **Privacy invariant (spec §2):** nothing in auth or articles touches `label/`: no file under `apps/api/src/auth/` or `apps/api/src/articles/` may reference `Labeler`, `createGeminiLabeler`, `labelPending` or the `LABELER` token (Task 4 has a scan test). Auth data (user ids, sessions) never flows into the LLM path.
- **Secrets (spec §7):** only in env. `.env.example` keeps exactly the active keys `DATABASE_URL, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GOOGLE_GENERATIVE_AI_API_KEY, LABEL_MODEL, APP_URL`; new optional settings are added as commented lines.
- **Testing (spec §8):** vitest. api e2e covers the session guard and the main endpoints with GitHub OAuth faked by a local HTTP server (the `startServer` pattern in `packages/core/src/test/server.ts`); **never mock global `fetch`**. Web: typecheck and lint only. Everything runs from the root `pnpm lint`, `pnpm typecheck`, `pnpm test` and in CI (`.github/workflows/ci.yml` already runs those three; no CI change is needed).
- **NestJS under vitest/tsx:** esbuild does not emit decorator metadata, so every constructor parameter of an injectable uses an explicit `@Inject(TOKEN_OR_CLASS)`; tokens live in `apps/api/src/tokens.ts`. Do not use `ValidationPipe`/class-validator (they need metadata); validate with zod (`parseWith`, Task 2).
- **Environment:** native Postgres 17 on `localhost:5432` (Docker image pulls are broken locally); tests use the `attn_test` database (`TEST_DATABASE_URL`). No GitHub OAuth credentials exist here; real OAuth cannot be exercised. Dockerfiles and compose services are written but **cannot be built or run locally**: say so in the final report and verify them only by `docker compose config` (or a YAML parse) if available.
- **TypeScript is pinned to 6.0.3** (root `^6.0.3`). Next.js 16.4 supports TypeScript >= 5.1, so 6.0.3 is accepted; verify with the web build in Task 7. `pnpm lint`, `pnpm typecheck`, `pnpm test` must be green after every task.
- **Working style:** change only what the task asks; commit per task with the attribution trailers the session requires; do not claim success without running the verify command and reading its output. Other agents were finishing Stage 2 (`apps/api` daily-job module, README, `data/golden/draft.yml`) while this plan was written: **re-read `apps/api/src/app.module.ts`, `apps/api/src/config/env.ts`, `README.md`, `.env.example` and `docker-compose.yml` as they are on the branch before editing them**; the code below shows only what changes. `apps/api/src/jobs/*.test.ts` (`pipeline.scheduler.test.ts`, `pipeline.steps.test.ts`, `pipeline.job.test.ts`) build full `Env` literals; Stage 2's final review may still land small fixes in `apps/api/src/jobs`, so **Task 2's implementer must re-read those test files (and `git log` for them) immediately before editing** and keep any fix that landed. Find literals with `grep -rn "scheduleEnabled" apps/api/src`.

## Decisions

Points the spec leaves open or the environment forced (binding for this plan):

- **Hand-written OAuth, no passport.** `GithubClient` (`fetch` to `${githubOauthBaseUrl}/login/oauth/access_token`, then `GET ${githubApiBaseUrl}/user`). Both base URLs are env-injectable (`GITHUB_OAUTH_BASE_URL`, `GITHUB_API_BASE_URL`, defaults `https://github.com` and `https://api.github.com`) so e2e runs against a local fake GitHub. No scope is requested (public profile only).
- **Redirect URI** is `${APP_URL}/api/auth/github/callback` (through the Next proxy, one origin). README documents this as the OAuth app's callback URL.
- **CSRF:** `GET /auth/github` sets cookie `attn_oauth_state` (random 32 bytes base64url, httpOnly, SameSite=Lax, `Path=/api/auth`, 10 minutes, Secure per setting) and sends the same value as `state`. The callback compares with `timingSafeEqual`, clears the cookie, and never creates a user or session on mismatch.
- **Session cookie** `attn_session`: 32 random bytes base64url, `Path=/`, httpOnly, SameSite=Lax, Secure per setting, 30 days (constant `SESSION_TTL_MS`, not in `config.yml`: spec §7 does not list it). `sessions.id` = sha256 hex of the token; the raw token exists only in the cookie. Expired rows are deleted opportunistically on each login (no cron, no `expires_at` index: fine at MVP scale). No sliding renewal. A login first destroys the session named by any existing `attn_session` cookie (no session fixation or stale sessions left behind). The callback and `/me` responses carry `Cache-Control: no-store`, and the callback also `Referrer-Policy: no-referrer` (its URL carries `code` and `state`).
- **Cookie `Secure` is ON by default, always (spec §6.5 says "httpOnly, Secure, SameSite=Lax"; coordinator ruling).** `cookieSecure` is `true` unless `COOKIE_SECURE` is explicitly `false` or `0`; the `APP_URL` scheme no longer matters. Local plain-http dev must set `COOKIE_SECURE=false` in `.env` (browsers treat `http://localhost` as a secure context for `Secure` cookies in Chrome/Firefox, but Safari and curl do not, so the escape hatch stays). When it is disabled the api logs a startup warning (`describeInsecureCookies(env)` in `env.ts`, printed from `main.ts`). `.env.example` carries a commented `COOKIE_SECURE=false` for dev and the README explains it.
- **Failed OAuth:** the api redirects (302) to `${APP_URL}/?auth_error=<code>`, `code` in `not_configured | access_denied | state_mismatch | oauth_failed` (`AUTH_ERROR_CODES` in shared). The web maps codes to fixed messages (`AUTH_ERROR_MESSAGES`); it never prints query text. Missing `GITHUB_CLIENT_ID/SECRET` gives `not_configured`, not a 500.
- **After a successful login** the api redirects to `${APP_URL}/all` (Stage 4 will change this to onboarding). Web route for the All page is `/all`.
- **`GET /me`** returns `{ id, login, name, avatarUrl, role }` (`meSchema`); 401 `{ error: 'unauthorized', message }` without a valid session. `POST /auth/logout` returns 204 and is idempotent (no cookie is fine); it always clears the cookie. SameSite=Lax blocks cross-site POSTs carrying the cookie, which is the CSRF defence for logout.
- **Error filter:** `AllExceptionsFilter` renders every error as `{ error, message }` where `error` is a snake_case code from the status (`bad_request`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `unprocessable_entity`, `too_many_requests`, `service_unavailable`, `internal_error`). Extra keys of an object-shaped `HttpException` body (other than `statusCode`, `error`, `message`) are kept, so the existing health 503 body keeps `"db":"down"`. Unknown errors become 500 with the fixed message `Internal server error` (details logged, never returned).
- **`GET /articles` details:** query `source`, `skill`, `from`, `to`, `cursor`, `limit` (1..50, default `page_size` from `config.yml`, 20). `skill` matches an article if the skill is its primary **or** secondary skill. `from`/`to` accept `YYYY-MM-DD` (UTC day, both bounds inclusive of the whole day) or an ISO 8601 datetime with timezone (`from` inclusive, `to` inclusive to the millisecond). Ordering `published_at desc, id desc`; cursor is opaque base64url JSON `{ t: ISO string, id }` of the last item; next page = rows strictly "before" `(published_at, id)` (keyset, row comparison). The service fetches `limit + 1` rows, so `nextCursor` is `null` exactly when no more rows exist. Timestamps in `published_at` come from JS `Date` (millisecond precision, written by `collect`), so the ISO cursor is lossless. Response `{ items: ArticleCard[], nextCursor: string | null }`. `ArticleCard` is also the card shape Stage 5's `Ranker` returns.
- **`ArticleCard`** = `{ id, title, url, sourceId, sourceName, publishedAt (ISO), wordCount (number|null), difficulty, type, quality, skills: [{ id, name, isPrimary }] }`; primary first. Skill ids missing from the current taxonomy (orphans) are returned with `name = id`; source ids missing from `sources.yml` with `sourceName = sourceId`. No label internals (`label_model`, attempts) are exposed.
- **Extra endpoint `GET /sources`** (`[{ id, name }]`, public) is not in spec §6.6; the All page needs source names for its filter and the web is frontend only (cannot read YAML). `GET /taxonomy` (spec-listed) returns the whole taxonomy (`taxonomySchema` shape) publicly; Stage 4 may add role filtering.
- **Reading time** = `max(1, ceil(word_count / 200))` minutes (`readingMinutes` in shared, `null` when `word_count` is null or 0).
- **Web stack:** Next.js 16.4.0 app router, React 19.3, Tailwind 4 via `@tailwindcss/postcss`, system font stack (no Google font fetch, so builds work offline). Server components fetch the api directly at `API_URL` (default `http://localhost:3001`); the browser reaches the api only through the `/api/*` rewrite (sign-in link, sign-out fetch). `next.config.ts` evaluates `API_URL` at build time for the rewrite, so Docker passes it as a build arg. Filters and "load more" on All are plain GET forms/links (`?source=&skill=&from=&to=&cursor=`): no client state, works without JS. Only `SignOutButton` is a client component.
- **Web lint:** `eslint-config-next` is not used (its plugin set is not verified against ESLint 10); the root flat config adds `@next/eslint-plugin-next` rules and the two `react-hooks` rules for `apps/web/**`. Task 7 decides, before Task 8, whether each plugin loads under ESLint 10. If `@next/eslint-plugin-next` is dropped, Task 8 must not contain the `// eslint-disable-next-line @next/next/no-img-element` comment (an unknown rule name in a disable comment is an error); if it is kept, the comment stays. Record the outcome in the Task 7 commit message.
- **Shell extensibility (Stages 4-5):** nav items come from one list, `NAV_ITEMS` (`apps/web/src/lib/nav-items.ts`), each with `auth: 'any' | 'user'`; a Stage adds its page folder under `src/app/` plus one list entry. All api calls go through `apps/web/src/lib/api.ts`. `AuthModule` exports `SessionService` and `SessionGuard`; a later feature module imports `AuthModule` and uses `@UseGuards(SessionGuard)` and `@CurrentUser()`.

## Review Focus

Inputs and conditions a happy-path suite would miss. Each has a test in the named task.

1. OAuth callback with a forged, missing or replayed `state`, a GitHub `error=access_denied`, a bad `code`, or an unreachable/erroring GitHub: always a redirect to the landing page with an `auth_error` code, never a 500, never a user or session row (Task 4).
2. Session cookie that is garbage, expired, belongs to a deleted session, or is reused after logout; logging out twice or without a cookie; the database must hold only the hash (Task 3).
3. Pagination when many articles share one `published_at`, when the item count equals `limit` exactly, when filters are combined with a cursor, and when the cursor is malformed (Task 5).
4. Public list must never leak `pending`/`failed` articles, must survive `word_count = null` and skill ids no longer in the taxonomy, and rejects bad `limit`, dates and `from > to` with a JSON 400 (Task 5).
5. The landing page must not reflect arbitrary `?auth_error=` text and the web must not crash when the api answers 400 for a hand-edited filter URL (Tasks 1, 9, 10; checked by the shared unit test and the manual smoke steps).

## File Structure

```
packages/shared/src/api.ts            DTO zod schemas, date-range helper, auth error codes/messages
packages/shared/src/reading.ts        readingMinutes
packages/core/src/test/server.ts      (modify) capture request bodies, pass body to route functions
apps/api/src/config/env.ts            (modify) appUrl, github*, cookieSecure
apps/api/src/common/                  all-exceptions.filter.ts, zod.ts (parseWith)
apps/api/src/test/                    app.ts (startTestApp), fake-github.ts, seed.ts   (test helpers)
apps/api/src/auth/                    session.ts, session.service.ts, session.guard.ts, current-user.ts,
                                      users.service.ts, github.client.ts, auth.controller.ts, me.controller.ts, auth.module.ts
apps/api/src/articles/                cursor.ts, articles.service.ts, articles.controller.ts, articles.module.ts
apps/api/src/meta/                    meta.controller.ts, meta.module.ts
apps/web/                             Next.js app (see Task 7-10)
apps/api/Dockerfile, apps/web/Dockerfile, .dockerignore, docker-compose.yml
```

---

### Task 1: Shared API DTOs, date helper, auth messages, reading time

**Files:**
- Create: `packages/shared/src/api.ts`
- Create: `packages/shared/src/reading.ts`
- Create: `packages/shared/src/api.test.ts`
- Modify: `packages/shared/src/index.ts` (add two exports)

**Interfaces:**
- Consumes: `levelSchema`, `articleTypeSchema` from `packages/shared/src/enums.ts`.
- Produces (all exported from `@attn/shared`):
  - `errorBodySchema`, `type ErrorBody` = `{ error: string; message: string }` (loose: extra keys allowed)
  - `meSchema`, `type Me` = `{ id: string; login: string; name: string | null; avatarUrl: string | null; role: string }`
  - `sourceSummarySchema`, `type SourceSummary` = `{ id: string; name: string }`; `sourcesResponseSchema` = array of it
  - `articleSkillSchema` = `{ id: string; name: string; isPrimary: boolean }`
  - `articleCardSchema`, `type ArticleCard`; `articlesPageSchema`, `type ArticlesPage` = `{ items: ArticleCard[]; nextCursor: string | null }`
  - `ARTICLES_MAX_LIMIT = 50`
  - `articlesQuerySchema`, `type ArticlesQuery` = `{ source?: string; skill?: string; from?: string; to?: string; cursor?: string; limit?: number }`
  - `isDateBound(s: string): boolean`; `resolveDateRange(q: { from?: string; to?: string }): { from?: Date; toExclusive?: Date }`
  - `AUTH_ERROR_CODES` (`readonly ['not_configured','access_denied','state_mismatch','oauth_failed']`), `authErrorCodeSchema`, `type AuthErrorCode`, `AUTH_ERROR_MESSAGES: Record<AuthErrorCode,string>`, `authErrorMessage(code: string | undefined): string | null`
  - `WORDS_PER_MINUTE = 200`, `readingMinutes(wordCount: number | null | undefined): number | null`

- [ ] **Step 1: Write the failing test** `packages/shared/src/api.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import {
  AUTH_ERROR_CODES,
  articleCardSchema,
  articlesPageSchema,
  articlesQuerySchema,
  authErrorMessage,
  errorBodySchema,
  isDateBound,
  meSchema,
  readingMinutes,
  resolveDateRange,
} from './index';

const card = {
  id: 1,
  title: 'T',
  url: 'https://example.com/a',
  sourceId: 's',
  sourceName: 'Source',
  publishedAt: '2026-03-01T10:00:00.000Z',
  wordCount: 1200,
  difficulty: 2,
  type: 'tutorial',
  quality: 3,
  skills: [{ id: 'x', name: 'X', isPrimary: true }],
};

describe('articlesQuerySchema', () => {
  it('accepts an empty query and coerces limit', () => {
    expect(articlesQuerySchema.parse({})).toEqual({});
    expect(articlesQuerySchema.parse({ limit: '10' })).toEqual({ limit: 10 });
  });

  it.each([{ limit: '0' }, { limit: '51' }, { limit: 'abc' }, { limit: '1.5' }])('rejects limit %j', (q) => {
    expect(articlesQuerySchema.safeParse(q).success).toBe(false);
  });

  it('rejects empty strings and unknown shapes for text params', () => {
    expect(articlesQuerySchema.safeParse({ source: '' }).success).toBe(false);
    expect(articlesQuerySchema.safeParse({ cursor: '' }).success).toBe(false);
    expect(articlesQuerySchema.safeParse({ skill: ['a', 'b'] }).success).toBe(false);
  });

  it('validates date bounds and ordering', () => {
    expect(articlesQuerySchema.safeParse({ from: '2026-03-01', to: '2026-03-01' }).success).toBe(true);
    expect(articlesQuerySchema.safeParse({ from: '2026-03-02', to: '2026-03-01' }).success).toBe(false);
    expect(articlesQuerySchema.safeParse({ from: 'yesterday' }).success).toBe(false);
    expect(articlesQuerySchema.safeParse({ from: '2026-02-31' }).success).toBe(false);
    expect(articlesQuerySchema.safeParse({ from: '2026-03-01T10:00:00' }).success).toBe(false); // no timezone
    expect(articlesQuerySchema.safeParse({ from: '2026-03-01T10:00:00Z' }).success).toBe(true);
  });
});

describe('date helpers', () => {
  it('isDateBound', () => {
    expect(isDateBound('2026-03-01')).toBe(true);
    expect(isDateBound('2026-03-01T10:00:00.123+02:00')).toBe(true);
    expect(isDateBound('2026-13-01')).toBe(false);
    expect(isDateBound('')).toBe(false);
  });

  it('resolveDateRange: date-only covers whole UTC days, datetimes are exact', () => {
    const r = resolveDateRange({ from: '2026-03-01', to: '2026-03-02' });
    expect(r.from?.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(r.toExclusive?.toISOString()).toBe('2026-03-03T00:00:00.000Z');
    const t = resolveDateRange({ from: '2026-03-01T10:00:00Z', to: '2026-03-01T12:00:00Z' });
    expect(t.from?.toISOString()).toBe('2026-03-01T10:00:00.000Z');
    expect(t.toExclusive?.toISOString()).toBe('2026-03-01T12:00:00.001Z');
    expect(resolveDateRange({})).toEqual({});
  });
});

describe('response schemas', () => {
  it('parse valid payloads and reject malformed ones', () => {
    expect(articleCardSchema.parse(card)).toEqual(card);
    expect(articleCardSchema.safeParse({ ...card, difficulty: 5 }).success).toBe(false);
    expect(articleCardSchema.safeParse({ ...card, url: 'javascript:alert(1)' }).success).toBe(false);
    expect(articleCardSchema.safeParse({ ...card, url: 'data:text/html,x' }).success).toBe(false);
    expect(articlesPageSchema.parse({ items: [card], nextCursor: null }).nextCursor).toBeNull();
    expect(meSchema.safeParse({ id: 'nope', login: 'a', name: null, avatarUrl: null, role: 'dev' }).success).toBe(false);
    expect(errorBodySchema.parse({ error: 'bad_request', message: 'm', db: 'down' }).error).toBe('bad_request');
  });
});

describe('authErrorMessage', () => {
  it('maps known codes to fixed messages and ignores anything else', () => {
    for (const code of AUTH_ERROR_CODES) expect(authErrorMessage(code)).toMatch(/\w/);
    expect(authErrorMessage('<script>alert(1)</script>')).toBeNull();
    expect(authErrorMessage(undefined)).toBeNull();
    expect(authErrorMessage('')).toBeNull();
  });
});

describe('readingMinutes', () => {
  it('rounds up with a floor of one minute', () => {
    expect(readingMinutes(1)).toBe(1);
    expect(readingMinutes(200)).toBe(1);
    expect(readingMinutes(201)).toBe(2);
    expect(readingMinutes(1500)).toBe(8);
  });
  it('is null when unknown', () => {
    expect(readingMinutes(null)).toBeNull();
    expect(readingMinutes(undefined)).toBeNull();
    expect(readingMinutes(0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run packages/shared/src/api.test.ts`
Expected: FAIL (exports missing).

- [ ] **Step 3: Implement** `packages/shared/src/reading.ts`

```ts
export const WORDS_PER_MINUTE = 200;

/** Reading time in whole minutes, derived from word_count (no AI). Null when the count is unknown. */
export function readingMinutes(wordCount: number | null | undefined): number | null {
  if (!wordCount || wordCount <= 0) return null;
  return Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE));
}
```

`packages/shared/src/api.ts`

```ts
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
```

Append to `packages/shared/src/index.ts`:

```ts
export * from './api';
export * from './reading';
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run packages/shared && pnpm typecheck && pnpm lint`
Expected: all PASS. (`z.coerce.number()` turns `undefined` into `NaN` only when the key is present; absent keys stay absent because of `.optional()` wrapping order. If `articlesQuerySchema.parse({})` returns `{ limit: NaN }` or fails, use `z.preprocess((v) => (v === undefined ? undefined : Number(v)), z.number().int().min(1).max(ARTICLES_MAX_LIMIT).optional())` instead and keep the tests unchanged.)

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): API DTO schemas, date-range helper, auth error messages, reading time"
```

---

### Task 2: Env, JSON error filter, zod parsing helper, API test helpers

**Files:**
- Modify: `apps/api/src/config/env.ts`, `apps/api/src/config/env.test.ts`
- Modify: `apps/api/src/app.setup.ts` (register the filter)
- Modify: `apps/api/src/health/health.e2e.test.ts` (use `testEnv`/`startTestApp`)
- Modify: `apps/api/src/jobs/pipeline.scheduler.test.ts`, `apps/api/src/jobs/pipeline.steps.test.ts`, `apps/api/src/jobs/pipeline.job.test.ts` (their `Env` literals; **re-read each file right before editing, Stage 2 review fixes may have landed**; build the value as `testEnv({ scheduleEnabled })` or `{ ...testEnv(), <their overrides> }` instead of listing every field, so `pnpm typecheck` stays green)
- Modify: `apps/api/src/main.ts` (log the insecure-cookie warning)
- Modify: `apps/api/package.json` (add `@types/express` dev dependency)
- Modify: `packages/core/src/test/server.ts` (capture request bodies)
- Create: `apps/api/src/common/all-exceptions.filter.ts`, `apps/api/src/common/all-exceptions.filter.test.ts`
- Create: `apps/api/src/common/zod.ts`
- Create: `apps/api/src/test/app.ts`, `apps/api/src/test/fake-github.ts`, `apps/api/src/test/seed.ts`

**Interfaces:**
- Consumes: `Env`, `loadEnv` (current `env.ts`: fields `databaseUrl, port, labelModel, googleApiKey, scheduleEnabled`); `configureApp(app)`; tokens `ENV`, `DB`, `SOURCES`, `TAXONOMY`, `APP_CONFIG` from `apps/api/src/tokens.ts`; `startServer`, `TestServer`, `Route` from `packages/core/src/test/server.ts`; `TEST_DATABASE_URL`, `resetDb`, `testDb` from `@attn/core/testing`; `articles`, `articleSkills`, `users`, `Db` from `@attn/core`.
- Produces:
  - `describeInsecureCookies(env: Env): string | null` in `env.ts` (a warning sentence when `cookieSecure` is false, else `null`).
  - `Env` gains: `appUrl: string` (no trailing slash, `http:`/`https:` only), `githubClientId: string | undefined`, `githubClientSecret: string | undefined`, `githubOauthBaseUrl: string`, `githubApiBaseUrl: string`, `cookieSecure: boolean`.
  - `AllExceptionsFilter` (`@Catch()`), `errorCodeForStatus(status: number): string`.
  - `parseWith<T>(schema: { safeParse(i: unknown): ... }, input: unknown): T` throwing `BadRequestException` with the zod issues joined.
  - `testEnv(overrides?: Partial<Env>): Env`; `startTestApp(overrides?: Partial<Env>): Promise<TestApp>` with `TestApp = { app: INestApplication; moduleRef: TestingModule; base: string; db: Db; close(): Promise<void> }`.
  - `startFakeGithub(users: Record<string, GithubFixtureUser>): Promise<FakeGithub>`; constants `GITHUB_TEST_CLIENT_ID = 'test-client'`, `GITHUB_TEST_CLIENT_SECRET = 'test-secret'`; `type GithubFixtureUser = { id: number; login: string; name: string | null; avatar_url: string | null }`; `FakeGithub = TestServer` (its `baseUrl` serves both the OAuth and API paths).
  - `seedUser(db, over?)`, `seedArticle(db, o?)`, `skillIds(n): string[]` (first n real taxonomy skill ids) in `seed.ts`.
  - `TestServer.requests[i].body: string`, and route functions may take `(req, body)`.

- [ ] **Step 1: Add dependency and extend the core test server**

Run: `cd apps/api && pnpm add -D @types/express` (pick the major matching the installed `express`; check with `pnpm why express`, Nest 12 uses Express 5, so `@types/express@^5`).

In `packages/core/src/test/server.ts`: add `body: string` to the `requests` element type, change `Route`'s function form to `(req: IncomingMessage, body: string) => RouteResponse`, and read the body before routing:

```ts
export type Route = RouteResponse | ((req: IncomingMessage, body: string) => RouteResponse);
// requests: { method: string; path: string; headers: IncomingMessage['headers']; body: string }[]

const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    requests.push({ method: req.method ?? 'GET', path, headers: req.headers, body });
    const route = routes.get(path);
    if (!route) {
      res.writeHead(404).end('not found');
      return;
    }
    const r = typeof route === 'function' ? route(req, body) : route;
    const send = () => {
      if (res.destroyed) return;
      res.writeHead(r.status ?? 200, r.headers ?? {});
      res.end(r.body ?? '');
    };
    if (r.delayMs) setTimeout(send, r.delayMs);
    else send();
  });
});
```

Run: `pnpm test` (all existing core tests that use `startServer` must still pass; if one does `toEqual` on whole `requests` entries, add `body: ''`/`expect.any(String)`).

- [ ] **Step 2: Write failing tests**

`apps/api/src/config/env.test.ts`: update the two `toEqual` expectations to include the new keys with defaults `appUrl: 'http://localhost:3000'`, `githubClientId: undefined`, `githubClientSecret: undefined`, `githubOauthBaseUrl: 'https://github.com'`, `githubApiBaseUrl: 'https://api.github.com'`, `cookieSecure: true` (secure by default), and add:

```ts
describe('loadEnv auth settings', () => {
  const base = { DATABASE_URL: 'postgres://x' };

  it('cookieSecure is true by default, whatever the APP_URL scheme', () => {
    expect(loadEnv(base).cookieSecure).toBe(true);
    expect(loadEnv({ ...base, APP_URL: 'http://localhost:3000' }).cookieSecure).toBe(true);
    expect(loadEnv({ ...base, APP_URL: 'https://attn.example' }).cookieSecure).toBe(true);
    expect(loadEnv({ ...base, COOKIE_SECURE: '' }).cookieSecure).toBe(true);
  });

  it('only an explicit COOKIE_SECURE=false/0 disables it', () => {
    expect(loadEnv({ ...base, COOKIE_SECURE: 'false' }).cookieSecure).toBe(false);
    expect(loadEnv({ ...base, COOKIE_SECURE: '0' }).cookieSecure).toBe(false);
    expect(loadEnv({ ...base, COOKIE_SECURE: 'true' }).cookieSecure).toBe(true);
    expect(() => loadEnv({ ...base, COOKIE_SECURE: 'maybe' })).toThrow(/COOKIE_SECURE/);
  });

  it('describeInsecureCookies warns only when Secure is off', () => {
    expect(describeInsecureCookies(loadEnv(base))).toBeNull();
    expect(describeInsecureCookies(loadEnv({ ...base, COOKIE_SECURE: 'false' }))).toMatch(/COOKIE_SECURE=false/);
  });

  it('strips trailing slashes and rejects a non-http(s) APP_URL', () => {
    expect(loadEnv({ ...base, APP_URL: 'https://attn.example///' }).appUrl).toBe('https://attn.example');
    expect(() => loadEnv({ ...base, APP_URL: 'not a url' })).toThrow(/APP_URL/);
    expect(() => loadEnv({ ...base, APP_URL: 'localhost:3000' })).toThrow(/APP_URL/); // parses as scheme "localhost:"
    expect(() => loadEnv({ ...base, APP_URL: 'ftp://attn.example' })).toThrow(/APP_URL/);
  });

  it('reads GitHub settings and treats blanks as unset', () => {
    const env = loadEnv({
      ...base,
      GITHUB_CLIENT_ID: 'id',
      GITHUB_CLIENT_SECRET: '',
      GITHUB_OAUTH_BASE_URL: 'http://127.0.0.1:9/',
      GITHUB_API_BASE_URL: 'http://127.0.0.1:9',
    });
    expect(env.githubClientId).toBe('id');
    expect(env.githubClientSecret).toBeUndefined();
    expect(env.githubOauthBaseUrl).toBe('http://127.0.0.1:9');
    expect(env.githubApiBaseUrl).toBe('http://127.0.0.1:9');
  });
});
```

`apps/api/src/common/all-exceptions.filter.test.ts`:

```ts
import { Controller, Get, HttpException, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import { configureApp } from '../app.setup';
import { errorCodeForStatus } from './all-exceptions.filter';

@Controller('boom')
class BoomController {
  @Get('plain') plain(): never { throw new Error('secret internals'); }
  @Get('teapot') teapot(): never { throw new HttpException('short and stout', 418); }
  @Get('extra') extra(): never { throw new HttpException({ message: 'down', db: 'down' }, 503); }
}
@Module({ controllers: [BoomController] })
class BoomModule {}

let app: INestApplication | undefined;
afterEach(async () => { await app?.close(); app = undefined; });

async function start(): Promise<string> {
  const ref = await Test.createTestingModule({ imports: [BoomModule] }).compile();
  app = ref.createNestApplication();
  configureApp(app);
  await app.listen(0);
  return app.getUrl();
}

describe('AllExceptionsFilter', () => {
  it('maps statuses to snake_case codes', () => {
    expect(errorCodeForStatus(400)).toBe('bad_request');
    expect(errorCodeForStatus(401)).toBe('unauthorized');
    expect(errorCodeForStatus(404)).toBe('not_found');
    expect(errorCodeForStatus(503)).toBe('service_unavailable');
    expect(errorCodeForStatus(500)).toBe('internal_error');
    expect(errorCodeForStatus(418)).toBe('error');
  });

  it('renders unknown routes as JSON { error, message }', async () => {
    const base = await start();
    const res = await fetch(`${base}/api/nope`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ error: 'not_found', message: expect.any(String) });
  });

  it('hides the message of unexpected errors', async () => {
    const base = await start();
    const res = await fetch(`${base}/api/boom/plain`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'internal_error', message: 'Internal server error' });
  });

  it('keeps string messages and extra keys of HttpExceptions', async () => {
    const base = await start();
    expect(await (await fetch(`${base}/api/boom/teapot`)).json()).toEqual({ error: 'error', message: 'short and stout' });
    expect(await (await fetch(`${base}/api/boom/extra`)).json()).toEqual({
      error: 'service_unavailable',
      message: 'down',
      db: 'down',
    });
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm vitest run apps/api/src/config apps/api/src/common`
Expected: FAIL.

- [ ] **Step 4: Implement**

`env.ts` (extend the existing file; keep existing fields and helpers):

```ts
// additions to interface Env
appUrl: string;
githubClientId: string | undefined;
githubClientSecret: string | undefined;
githubOauthBaseUrl: string;
githubApiBaseUrl: string;
cookieSecure: boolean;

// helper
const stripSlashes = (s: string) => s.replace(/\/+$/, '');
const urlString = (def: string) =>
  z.preprocess(
    blankToUndefined,
    z
      .string()
      .default(def)
      .refine((v) => URL.canParse(v) && ['http:', 'https:'].includes(new URL(v).protocol), 'must be an http(s) URL')
      .transform(stripSlashes),
  );

// additions to envSchema
APP_URL: urlString('http://localhost:3000'),
GITHUB_CLIENT_ID: optionalString,
GITHUB_CLIENT_SECRET: optionalString,
GITHUB_OAUTH_BASE_URL: urlString('https://github.com'),
GITHUB_API_BASE_URL: urlString('https://api.github.com'),
COOKIE_SECURE: z.preprocess(blankToUndefined, z.enum(['true', 'false', '1', '0']).optional()),

// in the returned object
appUrl: e.APP_URL,
githubClientId: e.GITHUB_CLIENT_ID,
githubClientSecret: e.GITHUB_CLIENT_SECRET,
githubOauthBaseUrl: e.GITHUB_OAUTH_BASE_URL,
githubApiBaseUrl: e.GITHUB_API_BASE_URL,
// Secure by default (spec §6.5); only an explicit false/0 turns it off.
cookieSecure: !(e.COOKIE_SECURE === 'false' || e.COOKIE_SECURE === '0'),

// exported next to loadEnv
export function describeInsecureCookies(env: Env): string | null {
  return env.cookieSecure
    ? null
    : 'COOKIE_SECURE=false: session cookies are sent without the Secure flag. Use this for local http development only.';
}
```

`apps/api/src/common/all-exceptions.filter.ts`:

```ts
import { Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

const CODES: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  422: 'unprocessable_entity',
  429: 'too_many_requests',
  503: 'service_unavailable',
};

export function errorCodeForStatus(status: number): string {
  return CODES[status] ?? (status >= 500 ? 'internal_error' : 'error');
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      const obj = typeof raw === 'string' ? { message: raw } : (raw as Record<string, unknown>);
      const { statusCode: _s, error: _e, message, ...extra } = obj;
      const text = Array.isArray(message) ? message.join('; ') : typeof message === 'string' ? message : exception.message;
      res.status(status).json({ error: errorCodeForStatus(status), message: text, ...extra });
      return;
    }
    this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    res.status(500).json({ error: 'internal_error', message: 'Internal server error' });
  }
}
```

`main.ts`: after `loadEnv()` add `const warning = describeInsecureCookies(env); if (warning) new Logger('Bootstrap').warn(warning);` (import `Logger` from `@nestjs/common` and `describeInsecureCookies` from `./config/env`).

`app.setup.ts`: add `app.useGlobalFilters(new AllExceptionsFilter());` after `setGlobalPrefix`.

`apps/api/src/common/zod.ts`:

```ts
import { BadRequestException } from '@nestjs/common';

interface Parser<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
}

export function parseWith<T>(schema: Parser<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  throw new BadRequestException(r.error.issues.map((i) => `${i.path.map(String).join('.') || 'query'}: ${i.message}`).join('; '));
}
```

`apps/api/src/test/app.ts`:

```ts
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Db } from '@attn/core';
import { TEST_DATABASE_URL } from '@attn/core/testing';
import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import type { Env } from '../config/env';
import { DB, ENV } from '../tokens';

export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    databaseUrl: TEST_DATABASE_URL,
    port: 0,
    labelModel: undefined,
    googleApiKey: undefined,
    scheduleEnabled: false,
    appUrl: 'http://localhost:3000',
    githubClientId: undefined,
    githubClientSecret: undefined,
    githubOauthBaseUrl: 'http://127.0.0.1:1',
    githubApiBaseUrl: 'http://127.0.0.1:1',
    cookieSecure: false, // explicit: tests run over plain http (production default is true)
    ...overrides,
  };
}

export interface TestApp {
  app: INestApplication;
  moduleRef: TestingModule;
  base: string;
  db: Db;
  close(): Promise<void>;
}

export async function startTestApp(overrides: Partial<Env> = {}): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENV)
    .useValue(testEnv(overrides))
    .compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.listen(0);
  return {
    app,
    moduleRef,
    base: await app.getUrl(),
    db: moduleRef.get<Db>(DB, { strict: false }),
    close: () => app.close(),
  };
}
```

`apps/api/src/test/fake-github.ts`:

```ts
import { startServer, type TestServer } from '@attn/core/testing';

export const GITHUB_TEST_CLIENT_ID = 'test-client';
export const GITHUB_TEST_CLIENT_SECRET = 'test-secret';

export interface GithubFixtureUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}
export type FakeGithub = TestServer;

/** Local fake of github.com (token exchange) and api.github.com (/user). `users` is keyed by OAuth `code`. */
export async function startFakeGithub(users: Record<string, GithubFixtureUser>): Promise<FakeGithub> {
  const json = (body: unknown, status = 200) => ({
    status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return startServer({
    '/login/oauth/access_token': (_req, body) => {
      let p: Record<string, unknown> = {};
      try { p = JSON.parse(body) as Record<string, unknown>; } catch { /* leave empty */ }
      const code = typeof p.code === 'string' ? p.code : '';
      if (p.client_id !== GITHUB_TEST_CLIENT_ID || p.client_secret !== GITHUB_TEST_CLIENT_SECRET || !(code in users)) {
        return json({ error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' });
      }
      return json({ access_token: `tok-${code}`, token_type: 'bearer', scope: '' });
    },
    '/user': (req) => {
      const code = /^Bearer tok-(.+)$/.exec(String(req.headers.authorization ?? ''))?.[1];
      const user = code === undefined ? undefined : users[code];
      return user ? json(user) : json({ message: 'Bad credentials' }, 401);
    },
  });
}
```

`apps/api/src/test/seed.ts`:

```ts
import { articleSkills, articles, loadTaxonomy, users, type Db } from '@attn/core';
import { taxonomySkillIds, type ArticleType, type LabelStatus } from '@attn/shared';

let counter = 0;

export function skillIds(n: number): string[] {
  const ids = taxonomySkillIds(loadTaxonomy());
  if (ids.length < n) throw new Error(`taxonomy has fewer than ${n} skills`);
  return ids.slice(0, n);
}

export async function seedUser(db: Db, over: Partial<typeof users.$inferInsert> = {}) {
  counter += 1;
  const [row] = await db
    .insert(users)
    .values({ githubId: 1000 + counter, login: `user${counter}`, name: `User ${counter}`, avatarUrl: null, ...over })
    .returning();
  if (!row) throw new Error('seedUser failed');
  return row;
}

export interface SeedArticle {
  sourceId?: string;
  title?: string;
  url?: string;
  publishedAt?: Date;
  status?: LabelStatus;
  primary?: string;
  secondary?: string[];
  wordCount?: number | null;
  difficulty?: number;
  type?: ArticleType;
  quality?: number;
}

/** Inserts a labeled article (status override allowed) with its skills; returns the article id. */
export async function seedArticle(db: Db, o: SeedArticle = {}): Promise<number> {
  counter += 1;
  const url = o.url ?? `https://example.com/a/${counter}`;
  const title = o.title ?? `Article ${counter}`;
  const labeled = (o.status ?? 'labeled') === 'labeled';
  const [row] = await db
    .insert(articles)
    .values({
      sourceId: o.sourceId ?? 'src',
      url,
      guid: url,
      title,
      titleHash: `hash-${counter}`,
      publishedAt: o.publishedAt ?? new Date('2026-03-01T00:00:00.000Z'),
      wordCount: o.wordCount === undefined ? 800 : o.wordCount,
      labelStatus: o.status ?? 'labeled',
      difficulty: labeled ? (o.difficulty ?? 2) : null,
      type: labeled ? (o.type ?? 'tutorial') : null,
      quality: labeled ? (o.quality ?? 3) : null,
    })
    .returning({ id: articles.id });
  if (!row) throw new Error('seedArticle failed');
  if (labeled) {
    const primary = o.primary ?? 'orphan-skill';
    await db.insert(articleSkills).values([
      { articleId: row.id, skillId: primary, isPrimary: true },
      ...(o.secondary ?? []).map((s) => ({ articleId: row.id, skillId: s, isPrimary: false })),
    ]);
  }
  return row.id;
}
```

Rewrite `health.e2e.test.ts` to use `startTestApp`/`testEnv` (keep all five test cases and assertions; the unreachable-db case becomes `startTestApp({ databaseUrl: 'postgres://attn:attn@127.0.0.1:1/none' })`; the injection test uses `moduleRef.get(DB, { strict: false })`/`APP_CONFIG`). The 503 test must still assert `"db":"down"`.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all PASS (existing health tests included).

- [ ] **Step 6: Commit**

```bash
git add -A apps/api packages/core/src/test/server.ts pnpm-lock.yaml
git commit -m "feat(api): auth env settings, JSON error filter, zod parse helper, e2e test helpers"
```

---

### Task 3: Sessions, SessionGuard, GET /me, logout

**Files:**
- Create: `apps/api/src/auth/session.ts`, `session.test.ts`, `session.service.ts`, `session.guard.ts`, `current-user.ts`, `auth.controller.ts` (logout only for now), `me.controller.ts`, `auth.module.ts`, `session.e2e.test.ts`
- Modify: `apps/api/src/app.module.ts` (import `AuthModule`; keep the other modules)

**Interfaces:**
- Consumes: `sessions`, `users`, `Db` from `@attn/core`; `DB`, `ENV` tokens; `Env` (Task 2); `Me`, `meSchema` (Task 1); `startTestApp`, `seedUser` (Task 2).
- Produces (from `apps/api/src/auth/`):
  - `session.ts`: `SESSION_COOKIE = 'attn_session'`, `SESSION_TTL_MS`, `generateToken(): string`, `hashToken(token: string): string`, `parseCookies(header: string | undefined): Record<string, string>`, `sessionCookieOptions(env: Env): CookieOptions` (`{ httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: SESSION_TTL_MS }`), `type AuthUser = Me`, `type AuthedRequest = Request & { user?: AuthUser }`.
  - `SessionService`: `create(userId: string): Promise<{ token: string; expiresAt: Date }>`, `findUser(token: string): Promise<AuthUser | null>`, `destroy(token: string): Promise<void>`, `purgeExpired(): Promise<number>`.
  - `SessionGuard` (`CanActivate`; sets `req.user`; throws `UnauthorizedException('Sign in required')`), `CurrentUser` param decorator (`@CurrentUser() user: AuthUser`).
  - `AuthModule` exports `SessionService`, `SessionGuard`.
  - Routes: `GET /api/me` (guarded), `POST /api/auth/logout` (204).

- [ ] **Step 1: Write failing tests**

`session.test.ts` (unit):

```ts
import { describe, expect, it } from 'vitest';
import { generateToken, hashToken, parseCookies, sessionCookieOptions } from './session';
import { testEnv } from '../test/app';

describe('session helpers', () => {
  it('hashToken is sha256 hex', () => {
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('generateToken is url-safe, 43 chars and unique', () => {
    const a = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(a);
  });
  it('parseCookies handles several cookies, decoding and junk', () => {
    expect(parseCookies('a=1; attn_session=abc%20d; b=')).toEqual({ a: '1', attn_session: 'abc d', b: '' });
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('novalue; =x; ok=1')).toEqual({ ok: '1' });
    expect(parseCookies('bad=%E0%A4%A')).toEqual({ bad: '%E0%A4%A' });
  });
  it('sessionCookieOptions follows env.cookieSecure', () => {
    expect(sessionCookieOptions(testEnv({ cookieSecure: true }))).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    expect(sessionCookieOptions(testEnv({ cookieSecure: false })).secure).toBe(false);
  });
});
```

`session.e2e.test.ts` (use `beforeEach(resetDb)` via `resetDb(ctx.db)`; start the app once per test with `startTestApp()`; get the service with `ctx.moduleRef.get(SessionService, { strict: false })`):

1. `GET /api/me` without cookie: 401, body `{ error: 'unauthorized', message: 'Sign in required' }`.
2. With a valid session cookie (`seedUser`, `sessions.create(user.id)`, header `cookie: attn_session=<token>`): 200 and body parses with `meSchema` and equals `{ id, login, name, avatarUrl, role: 'dev' }`; the response has `Cache-Control: no-store`.
3. Garbage cookie value, and a cookie whose token was never issued: 401.
4. Expired session (insert a `sessions` row directly with `id: hashToken(t)`, `expiresAt` one minute ago): 401.
5. DB holds only the hash: after `create`, `select id from sessions` equals `[hashToken(token)]` and does not equal `token`; `expiresAt` is about now + `SESSION_TTL_MS` (within 5 s).
6. `POST /api/auth/logout` with a valid cookie: 204, the row is gone, `set-cookie` contains `attn_session=;` (cleared; `Max-Age=0` or an `Expires` in 1970) and `Path=/`; a following `GET /api/me` with the old cookie is 401.
7. Logout twice and logout without a cookie both return 204.
8. Logout removes only that user's current session: a second session of the same user (another token) still authorizes `/me`.
9. `purgeExpired()` deletes expired rows only and returns the count.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run apps/api/src/auth`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

`session.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions, Request } from 'express';
import type { Me } from '@attn/shared';
import type { Env } from '../config/env';

export const SESSION_COOKIE = 'attn_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type AuthUser = Me;
export type AuthedRequest = Request & { user?: AuthUser };

export const generateToken = (): string => randomBytes(32).toString('base64url');
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const name = part.slice(0, i).trim();
    if (!name) continue;
    const raw = part.slice(i + 1).trim();
    try {
      out[name] = decodeURIComponent(raw);
    } catch {
      out[name] = raw;
    }
  }
  return out;
}

export function sessionCookieOptions(env: Env): CookieOptions {
  return { httpOnly: true, secure: env.cookieSecure, sameSite: 'lax', path: '/', maxAge: SESSION_TTL_MS };
}
```

`session.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { sessions, users, type Db } from '@attn/core';
import { and, eq, gt, lt } from 'drizzle-orm';
import { DB } from '../tokens';
import { SESSION_TTL_MS, generateToken, hashToken, type AuthUser } from './session';

@Injectable()
export class SessionService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async create(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });
    return { token, expiresAt };
  }

  async findUser(token: string): Promise<AuthUser | null> {
    const [row] = await this.db
      .select({ id: users.id, login: users.login, name: users.name, avatarUrl: users.avatarUrl, role: users.role })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date())))
      .limit(1);
    return row ?? null;
  }

  async destroy(token: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.id, hashToken(token)));
  }

  async purgeExpired(): Promise<number> {
    const rows = await this.db.delete(sessions).where(lt(sessions.expiresAt, new Date())).returning({ id: sessions.id });
    return rows.length;
  }
}
```

`session.guard.ts` and `current-user.ts`:

```ts
// session.guard.ts
import { Inject, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { SESSION_COOKIE, parseCookies, type AuthedRequest } from './session';
import { SessionService } from './session.service';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const user = token ? await this.sessions.findUser(token) : null;
    if (!user) throw new UnauthorizedException('Sign in required');
    req.user = user;
    return true;
  }
}

// current-user.ts
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthUser, AuthedRequest } from './session';

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
  if (!user) throw new Error('CurrentUser used on a route without SessionGuard');
  return user;
});
```

`me.controller.ts`:

```ts
import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import type { Me } from '@attn/shared';
import { CurrentUser } from './current-user';
import type { AuthUser } from './session';
import { SessionGuard } from './session.guard';

@Controller('me')
export class MeController {
  @Get()
  @UseGuards(SessionGuard)
  me(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response): Me {
    res.setHeader('Cache-Control', 'no-store');
    return user;
  }
}
```

`auth.controller.ts` (logout now; Task 4 adds the OAuth routes to this same class and constructor):

```ts
import { Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { Env } from '../config/env';
import { ENV } from '../tokens';
import { SESSION_COOKIE, parseCookies, sessionCookieOptions, type AuthedRequest } from './session';
import { SessionService } from './session.service';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) await this.sessions.destroy(token);
    const { maxAge: _maxAge, ...clear } = sessionCookieOptions(this.env);
    res.clearCookie(SESSION_COOKIE, clear);
  }
}
```

`auth.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { MeController } from './me.controller';
import { SessionGuard } from './session.guard';
import { SessionService } from './session.service';

@Module({
  controllers: [AuthController, MeController],
  providers: [SessionService, SessionGuard],
  exports: [SessionService, SessionGuard],
})
export class AuthModule {}
```

Add `AuthModule` to `AppModule.imports` (keep the other agents' modules).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run apps/api/src/auth && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): hashed-token sessions, SessionGuard, GET /me, logout"
```

---

### Task 4: GitHub OAuth (authorize redirect, callback, user upsert)

**Files:**
- Create: `apps/api/src/auth/github.client.ts`, `users.service.ts`, `oauth.e2e.test.ts`, `privacy.test.ts`
- Modify: `apps/api/src/auth/auth.controller.ts`, `apps/api/src/auth/auth.module.ts`

**Interfaces:**
- Consumes: `Env` (appUrl, github*, cookieSecure), `SessionService.create/purgeExpired`, `sessionCookieOptions`, `SESSION_COOKIE`, `generateToken` (Task 3); `users`, `Db` from `@attn/core`; `AuthErrorCode` (Task 1); `startTestApp`, `startFakeGithub`, `GITHUB_TEST_CLIENT_ID`, `GITHUB_TEST_CLIENT_SECRET`, `seedUser` (Task 2).
- Produces:
  - `GithubClient` (injectable): `isConfigured(): boolean`, `redirectUri(): string` (= `${appUrl}/api/auth/github/callback`), `authorizeUrl(state: string): string`, `exchangeCode(code: string): Promise<string>`, `fetchUser(accessToken: string): Promise<GithubProfile>`; throws `GithubError` on any failure. `GithubProfile = { id: number; login: string; name: string | null; avatarUrl: string | null }`.
  - `UsersService.upsertGithubUser(p: GithubProfile): Promise<{ id: string }>`.
  - `OAUTH_STATE_COOKIE = 'attn_oauth_state'`.
  - Routes `GET /api/auth/github`, `GET /api/auth/github/callback`.

- [ ] **Step 1: Write failing tests** `oauth.e2e.test.ts`

Setup: `fake = await startFakeGithub({ 'good-code': { id: 4242, login: 'octocat', name: 'The Octocat', avatar_url: 'https://avatars.example/o.png' } })`; app via `startTestApp({ githubClientId: GITHUB_TEST_CLIENT_ID, githubClientSecret: GITHUB_TEST_CLIENT_SECRET, githubOauthBaseUrl: fake.baseUrl, githubApiBaseUrl: fake.baseUrl })`; `beforeEach(() => resetDb(db))`; `afterEach` closes app and fake. Helper `begin()` calls `fetch(base + '/api/auth/github', { redirect: 'manual' })` and returns `{ state, stateCookie }` (state parsed from the `Location` query, cookie from `getSetCookie()`); helper `callback(query, cookieHeader)` calls `fetch(base + '/api/auth/github/callback?' + query, { redirect: 'manual', headers: { cookie } })`. All assertions use `res.status === 302` and `res.headers.get('location')`.

1. Authorize redirect: 302 to `${fake.baseUrl}/login/oauth/authorize` with `client_id=test-client`, `redirect_uri=http://localhost:3000/api/auth/github/callback`, a `state` of 43 url-safe chars; no `scope`; `Set-Cookie: attn_oauth_state=<same state>` with `HttpOnly`, `SameSite=Lax`, `Path=/api/auth`, `Max-Age=600`, and no `Secure` (cookieSecure false).
2. Not configured (separate app with `githubClientId: undefined`): 302 to `http://localhost:3000/?auth_error=not_configured`; no non-empty `attn_oauth_state` is set (a clearing `attn_oauth_state=; Expires=1970...` header is allowed); no `attn_session`.
3. Happy path: `begin()`, then `callback('code=good-code&state=<state>', 'attn_oauth_state=<state>')` returns 302 to `http://localhost:3000/all`; `set-cookie` includes `attn_session=<token>` with `HttpOnly; SameSite=Lax; Path=/` and no `Secure`, and a cleared `attn_oauth_state`; DB has one `users` row `{ githubId: 4242, login: 'octocat', name: 'The Octocat', avatarUrl: 'https://avatars.example/o.png', role: 'dev' }`; one `sessions` row with `id === hashToken(token)` for that user; `GET /api/me` with that cookie returns login `octocat`. The callback response has `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. The fake recorded one POST `/login/oauth/access_token` whose JSON body has `client_id`, `client_secret`, `code: 'good-code'`, `redirect_uri` equal to the callback URL, and one GET `/user` with `Authorization: Bearer tok-good-code` and a non-empty `user-agent`.
4. Secure flag: app with `appUrl: 'https://attn.example'`, `cookieSecure: true` (the production default; reuse the same fake): the authorize `redirect_uri` is `https://attn.example/api/auth/github/callback`, both `attn_oauth_state` and `attn_session` Set-Cookie headers contain `Secure`, and the success redirect is `https://attn.example/all`.
5. Re-login with changed profile (change the fake route `/user` via `fake.setRoute` to new login/name/avatar for the same id): still one `users` row with updated `login`, `name`, `avatarUrl`; two `sessions` rows.
6. State mismatch: cookie value differs from the `state` query -> 302 `http://localhost:3000/?auth_error=state_mismatch`; zero users and sessions; `fake.hits('/login/oauth/access_token') === 0`.
7. Missing state cookie, and missing `state` query -> `state_mismatch` (same assertions).
7b. Session fixation: a browser that already holds a valid `attn_session` (created with `SessionService.create` for another user) completes a successful callback sending both cookies: the old session row is deleted, exactly one new session exists for the new user, and the old token no longer authorizes `GET /api/me`. An invalid or garbage old `attn_session` value does not break the login.
8. Replay: after a successful callback, calling the callback again with the same state but without the (cleared) cookie -> `state_mismatch`, no second user/session.
9. `error=access_denied&state=<state>` (cookie valid) -> `auth_error=access_denied`; state cookie is cleared; token endpoint not hit.
10. Unknown code (`code=bad&state=...`): fake answers 200 `{ error: 'bad_verification_code' }` -> `auth_error=oauth_failed`; no user/session.
11. Missing `code` with valid state -> `oauth_failed`.
12. GitHub `/user` returns 500 (`fake.setRoute('/user', { status: 500, body: 'x' })`) -> `oauth_failed`; no user/session.
13. GitHub token endpoint returns non-JSON garbage (`setRoute` with body `<html>`) -> `oauth_failed`.
14. GitHub unreachable (`githubOauthBaseUrl: 'http://127.0.0.1:1'`) -> `oauth_failed`, response arrives quickly (< 5 s) and is not a 500.
15. Every error redirect clears `attn_oauth_state` and never sets `attn_session`.

`privacy.test.ts`: read every `.ts` file under `apps/api/src/auth` and `apps/api/src/articles` (`fs.readdirSync` recursive, skip `*.test.ts`), assert none matches `/Labeler|createGeminiLabeler|labelPending|LABELER/`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run apps/api/src/auth`
Expected: FAIL.

- [ ] **Step 3: Implement**

`github.client.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { Env } from '../config/env';
import { ENV } from '../tokens';

export interface GithubProfile {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export class GithubError extends Error {}

const tokenSchema = z.object({ access_token: z.string().min(1) });
const userSchema = z.object({
  id: z.number().int(),
  login: z.string().min(1),
  name: z.string().nullish(),
  avatar_url: z.string().nullish(),
});

const TIMEOUT_MS = 10_000;

@Injectable()
export class GithubClient {
  constructor(@Inject(ENV) private readonly env: Env) {}

  isConfigured(): boolean {
    return Boolean(this.env.githubClientId && this.env.githubClientSecret);
  }

  redirectUri(): string {
    return `${this.env.appUrl}/api/auth/github/callback`;
  }

  authorizeUrl(state: string): string {
    const u = new URL(`${this.env.githubOauthBaseUrl}/login/oauth/authorize`);
    u.searchParams.set('client_id', this.env.githubClientId ?? '');
    u.searchParams.set('redirect_uri', this.redirectUri());
    u.searchParams.set('state', state);
    return u.toString();
  }

  async exchangeCode(code: string): Promise<string> {
    const json = await this.request(`${this.env.githubOauthBaseUrl}/login/oauth/access_token`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'attn' },
      body: JSON.stringify({
        client_id: this.env.githubClientId,
        client_secret: this.env.githubClientSecret,
        code,
        redirect_uri: this.redirectUri(),
      }),
    });
    const parsed = tokenSchema.safeParse(json);
    if (!parsed.success) throw new GithubError('token exchange did not return an access_token');
    return parsed.data.access_token;
  }

  async fetchUser(accessToken: string): Promise<GithubProfile> {
    const json = await this.request(`${this.env.githubApiBaseUrl}/user`, {
      headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${accessToken}`, 'user-agent': 'attn' },
    });
    const parsed = userSchema.safeParse(json);
    if (!parsed.success) throw new GithubError('unexpected /user response');
    const u = parsed.data;
    return { id: u.id, login: u.login, name: u.name ?? null, avatarUrl: u.avatar_url ?? null };
  }

  private async request(url: string, init: RequestInit): Promise<unknown> {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new GithubError(`GitHub answered ${res.status}`);
      return (await res.json()) as unknown;
    } catch (e) {
      throw e instanceof GithubError ? e : new GithubError(e instanceof Error ? e.message : String(e));
    }
  }
}
```

`users.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { users, type Db } from '@attn/core';
import { DB } from '../tokens';
import type { GithubProfile } from './github.client';

@Injectable()
export class UsersService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Insert on first login; refresh login, name and avatar on later ones. Role keeps its default ('dev'). */
  async upsertGithubUser(p: GithubProfile): Promise<{ id: string }> {
    const [row] = await this.db
      .insert(users)
      .values({ githubId: p.id, login: p.login, name: p.name, avatarUrl: p.avatarUrl })
      .onConflictDoUpdate({ target: users.githubId, set: { login: p.login, name: p.name, avatarUrl: p.avatarUrl } })
      .returning({ id: users.id });
    if (!row) throw new Error('user upsert returned no row');
    return row;
  }
}
```

`auth.controller.ts`: merge the following into the existing file. Imports and the module-level constant/function go at the top level; the constructor gains `@Inject(GithubClient) private readonly github: GithubClient` and `@Inject(UsersService) private readonly users: UsersService` (keep `env` and `sessions`); the methods go inside `AuthController` next to `logout`.

```ts
// ---- module scope (top of file) ----
import { timingSafeEqual } from 'node:crypto';
import { Get, Query } from '@nestjs/common';
import type { AuthErrorCode } from '@attn/shared';
import { GithubClient } from './github.client';
import { UsersService } from './users.service';
// also extend the './session' import with generateToken

export const OAUTH_STATE_COOKIE = 'attn_oauth_state';
const STATE_TTL_MS = 10 * 60 * 1000;

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// ---- inside class AuthController ----
private stateCookieOptions() {
  return { httpOnly: true, secure: this.env.cookieSecure, sameSite: 'lax' as const, path: '/api/auth' };
}
private fail(res: Response, code: AuthErrorCode): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.clearCookie(OAUTH_STATE_COOKIE, this.stateCookieOptions());
  res.redirect(302, `${this.env.appUrl}/?auth_error=${code}`);
}

@Get('github')
start(@Res() res: Response): void {
  if (!this.github.isConfigured()) return this.fail(res, 'not_configured');
  const state = generateToken();
  res.cookie(OAUTH_STATE_COOKIE, state, { ...this.stateCookieOptions(), maxAge: STATE_TTL_MS });
  res.redirect(302, this.github.authorizeUrl(state));
}

@Get('github/callback')
async callback(
  @Query() query: Record<string, unknown>,
  @Req() req: AuthedRequest,
  @Res() res: Response,
): Promise<void> {
  const expected = parseCookies(req.headers.cookie)[OAUTH_STATE_COOKIE];
  const state = typeof query.state === 'string' ? query.state : undefined;
  if (!expected || !state || !safeEqual(expected, state)) return this.fail(res, 'state_mismatch');
  if (query.error === 'access_denied') return this.fail(res, 'access_denied');
  const code = typeof query.code === 'string' && query.code ? query.code : undefined;
  if (typeof query.error === 'string' || !code) return this.fail(res, 'oauth_failed');
  try {
    const profile = await this.github.fetchUser(await this.github.exchangeCode(code));
    const user = await this.users.upsertGithubUser(profile);
    await this.sessions.purgeExpired();
    const old = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (old) await this.sessions.destroy(old); // no stale session survives a new login
    const { token } = await this.sessions.create(user.id);
    res.clearCookie(OAUTH_STATE_COOKIE, this.stateCookieOptions());
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(this.env));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.redirect(302, `${this.env.appUrl}/all`);
  } catch {
    this.fail(res, 'oauth_failed');
  }
}

```

Order matters for test 9: state is verified first, then `error=access_denied`. (A forged `error=access_denied` with a bad state is `state_mismatch`; this is intended.) Register `GithubClient` and `UsersService` in `AuthModule.providers`. Add `generateToken` to the imports from `./session`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run apps/api && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): GitHub OAuth with state cookie, user upsert and session cookie"
```

---

### Task 5: Public GET /articles with keyset pagination

**Files:**
- Create: `apps/api/src/articles/cursor.ts`, `cursor.test.ts`, `articles.service.ts`, `articles.controller.ts`, `articles.module.ts`, `articles.e2e.test.ts`
- Modify: `apps/api/src/app.module.ts` (import `ArticlesModule`)

**Interfaces:**
- Consumes: `articles`, `articleSkills`, `Db` from `@attn/core`; `ArticlesQuery`, `ArticlesPage`, `ArticleCard`, `articlesQuerySchema`, `articlesPageSchema`, `resolveDateRange` (Task 1); `parseWith` (Task 2); tokens `DB`, `SOURCES`, `TAXONOMY`, `APP_CONFIG`; `Source`, `Taxonomy`, `Config` types from `@attn/shared`; `startTestApp`, `seedArticle`, `skillIds`, `resetDb` (Task 2).
- Produces:
  - `encodeCursor(c: { publishedAt: Date; id: number }): string`, `decodeCursor(s: string): { publishedAt: Date; id: number }` (throws `InvalidCursorError`).
  - `ArticlesService.list(query: ArticlesQuery): Promise<ArticlesPage>`; `ArticlesModule`.
  - Route `GET /api/articles` (no guard).

- [ ] **Step 1: Write failing tests**

`cursor.test.ts`: round trip keeps `publishedAt` to the millisecond and `id`; the encoded string matches `/^[A-Za-z0-9_-]+$/`; `decodeCursor` throws `InvalidCursorError` for `'!!!'`, base64 of non-JSON, JSON with wrong shape (`{"t":1,"id":"x"}`), an invalid date, and a negative or non-integer id.

`articles.e2e.test.ts` (`beforeEach` resetDb; read `ctx.base`; helper `get(qs)` returns `{ status, body }` using `fetch` without any cookie; `[S1, S2, S3] = skillIds(3)`; source ids used in seeds must include one real id from `data/sources.yml` — read it with `loadSources()[0]` for the sourceName assertion):

1. Public and labeled only: seed one `labeled`, one `pending`, one `failed` -> only the labeled one is returned; status 200 without cookie; body parses with `articlesPageSchema`.
2. Order: newest `publishedAt` first; three rows with identical `publishedAt` come back by `id` descending.
3. Card content: for an article with `primary: S1`, `secondary: [S2]`, `sourceId: <real id>`, `wordCount: 1500`: `skills` is `[{id:S1,name:<taxonomy name>,isPrimary:true},{id:S2,...,isPrimary:false}]`, `sourceName` equals the YAML name, `publishedAt` is the ISO string, keys of an item are exactly the `articleCardSchema` keys (no `labelModel`, `labelAttempts`, `guid`, `titleHash`).
4. Unknown source id in DB -> `sourceName === sourceId`; skill id not in taxonomy -> `name === id`; `wordCount: null` -> `wordCount: null`.
5. `source` filter returns only that source; unknown `source` returns `{ items: [], nextCursor: null }` with 200.
6. `skill` filter matches primary and secondary membership; an article with the skill in both cannot appear twice (seed S1 primary + S2 secondary and filter `skill=S2`: exactly one item).
7. Date range: seed articles at 2026-03-01T23:59:59.999Z, 2026-03-02T00:00:00.000Z, 2026-03-02T12:00:00.000Z, 2026-03-03T00:00:00.000Z. `from=2026-03-02&to=2026-03-02` returns exactly the middle two; `from=2026-03-02T12:00:00Z` returns the last two; `to=2026-03-02T00:00:00Z` returns the first two (inclusive to the millisecond).
8. Pagination across equal timestamps: seed 7 articles where 4 share one `publishedAt`; walk with `limit=2` following `nextCursor` until null; the concatenated ids equal the full unpaged ordering, with no duplicates or gaps; the last page has `nextCursor: null`.
9. Exact boundary: with exactly 4 articles and `limit=4`, `nextCursor` is `null`; with `limit=3` it is a string and the second page has 1 item and `null`.
10. Filter + cursor: `source=A&limit=2` over a mixed set paginates only through source A's articles.
11. Default limit equals `APP_CONFIG.page_size` (seed `page_size + 1` rows -> `page_size` items and a cursor); `limit=1` works; `limit=50` accepted.
12. 400 `{ error: 'bad_request' }` with a message naming the field for: `limit=0`, `limit=51`, `limit=abc`, `from=nope`, `to=2026-02-31`, `from=2026-03-02&to=2026-03-01`, `cursor=garbage`, `cursor=` (empty), and repeated `skill=a&skill=b`.
13. Empty database -> `{ items: [], nextCursor: null }`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run apps/api/src/articles`
Expected: FAIL.

- [ ] **Step 3: Implement**

`cursor.ts`:

```ts
import { z } from 'zod';

export class InvalidCursorError extends Error {}

export interface Cursor {
  publishedAt: Date;
  id: number;
}

const payload = z.object({ t: z.iso.datetime(), id: z.number().int().nonnegative() });

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify({ t: c.publishedAt.toISOString(), id: c.id }), 'utf8').toString('base64url');
}

export function decodeCursor(s: string): Cursor {
  try {
    const parsed = payload.parse(JSON.parse(Buffer.from(s, 'base64url').toString('utf8')));
    return { publishedAt: new Date(parsed.t), id: parsed.id };
  } catch {
    throw new InvalidCursorError('invalid cursor');
  }
}
```

`articles.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { articleSkills, articles, type Db } from '@attn/core';
import { resolveDateRange, type ArticleCard, type ArticlesPage, type ArticlesQuery, type Config, type Source, type Taxonomy } from '@attn/shared';
import { and, desc, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { APP_CONFIG, DB, SOURCES, TAXONOMY } from '../tokens';
import { decodeCursor, encodeCursor } from './cursor';

@Injectable()
export class ArticlesService {
  private readonly sourceNames: Map<string, string>;
  private readonly skillNames: Map<string, string>;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SOURCES) sources: Source[],
    @Inject(TAXONOMY) taxonomy: Taxonomy,
    @Inject(APP_CONFIG) private readonly config: Config,
  ) {
    this.sourceNames = new Map(sources.map((s) => [s.id, s.name]));
    this.skillNames = new Map(taxonomy.domains.flatMap((d) => d.skills.map((s) => [s.id, s.name] as const)));
  }

  async list(query: ArticlesQuery): Promise<ArticlesPage> {
    const limit = query.limit ?? this.config.page_size;
    const { from, toExclusive } = resolveDateRange(query);
    const conds: SQL[] = [eq(articles.labelStatus, 'labeled')];
    if (query.source) conds.push(eq(articles.sourceId, query.source));
    if (query.skill) {
      conds.push(sql`exists (select 1 from ${articleSkills} where ${articleSkills.articleId} = ${articles.id} and ${articleSkills.skillId} = ${query.skill})`);
    }
    if (from) conds.push(gte(articles.publishedAt, from));
    if (toExclusive) conds.push(lt(articles.publishedAt, toExclusive));
    if (query.cursor) {
      const c = decodeCursor(query.cursor); // InvalidCursorError is mapped to 400 by the controller
      conds.push(sql`(${articles.publishedAt}, ${articles.id}) < (${c.publishedAt.toISOString()}::timestamptz, ${c.id})`);
    }

    const rows = await this.db
      .select({
        id: articles.id, sourceId: articles.sourceId, url: articles.url, title: articles.title,
        publishedAt: articles.publishedAt, wordCount: articles.wordCount,
        difficulty: articles.difficulty, type: articles.type, quality: articles.quality,
      })
      .from(articles)
      .where(and(...conds))
      .orderBy(desc(articles.publishedAt), desc(articles.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const skillRows = page.length
      ? await this.db.select().from(articleSkills).where(inArray(articleSkills.articleId, page.map((r) => r.id)))
      : [];

    const items: ArticleCard[] = page.map((r) => ({
      id: r.id,
      title: r.title,
      url: r.url,
      sourceId: r.sourceId,
      sourceName: this.sourceNames.get(r.sourceId) ?? r.sourceId,
      publishedAt: r.publishedAt.toISOString(),
      wordCount: r.wordCount,
      difficulty: r.difficulty ?? 0,
      type: r.type ?? 'news',
      quality: r.quality ?? 0,
      skills: skillRows
        .filter((s) => s.articleId === r.id)
        .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.skillId.localeCompare(b.skillId))
        .map((s) => ({ id: s.skillId, name: this.skillNames.get(s.skillId) ?? s.skillId, isPrimary: s.isPrimary })),
    }));

    const last = page[page.length - 1];
    const nextCursor = rows.length > limit && last ? encodeCursor({ publishedAt: last.publishedAt, id: last.id }) : null;
    return { items, nextCursor };
  }
}
```

`articles.controller.ts`:

```ts
import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { articlesQuerySchema, type ArticlesPage } from '@attn/shared';
import { parseWith } from '../common/zod';
import { InvalidCursorError } from './cursor';
import { ArticlesService } from './articles.service';

@Controller('articles')
export class ArticlesController {
  constructor(@Inject(ArticlesService) private readonly articles: ArticlesService) {}

  @Get()
  async list(@Query() raw: Record<string, unknown>): Promise<ArticlesPage> {
    const query = parseWith(articlesQuerySchema, raw);
    try {
      return await this.articles.list(query);
    } catch (e) {
      if (e instanceof InvalidCursorError) throw new BadRequestException('cursor: invalid cursor');
      throw e;
    }
  }
}
```

`articles.module.ts`: `@Module({ controllers: [ArticlesController], providers: [ArticlesService] })`. Add to `AppModule`.

Note: `taxonomy`/`sources` come from `@Global` `AppConfigModule`, `DB` from the global `DbModule`, so no imports are needed. If the `exists (...)` fragment fails because Drizzle renders `articles.id` unqualified inside the subquery, write the table-qualified columns explicitly (`"articles"."id"`) with `sql.raw`/`sql.identifier`; the e2e test 6 catches this.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run apps/api && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): public GET /articles with filters and keyset pagination"
```

---

### Task 6: Meta endpoints (GET /sources, GET /taxonomy)

**Files:**
- Create: `apps/api/src/meta/meta.controller.ts`, `meta.module.ts`, `meta.e2e.test.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: tokens `SOURCES`, `TAXONOMY`; `Source`, `Taxonomy`, `SourceSummary`, `sourcesResponseSchema`, `taxonomySchema` from `@attn/shared`; `loadSources`, `loadTaxonomy` from `@attn/core`; `startTestApp` (Task 2).
- Produces: `GET /api/sources` -> `SourceSummary[]` sorted by name (case-insensitive); `GET /api/taxonomy` -> `Taxonomy`. Both public.

- [ ] **Step 1: Write failing test** `meta.e2e.test.ts`
1. `/api/sources` parses with `sourcesResponseSchema`, has `loadSources().length` entries, contains only `id` and `name` keys, is sorted by `name.toLowerCase()`.
2. `/api/taxonomy` parses with `taxonomySchema`, `version` equals `loadTaxonomy().version`, and every skill id of the YAML is present.
3. Both work without a cookie (status 200).

- [ ] **Step 2: Run to verify failure** — `pnpm vitest run apps/api/src/meta` -> FAIL.

- [ ] **Step 3: Implement**

```ts
// meta.controller.ts
import { Controller, Get, Inject } from '@nestjs/common';
import type { Source, SourceSummary, Taxonomy } from '@attn/shared';
import { SOURCES, TAXONOMY } from '../tokens';

@Controller()
export class MetaController {
  constructor(
    @Inject(SOURCES) private readonly sources: Source[],
    @Inject(TAXONOMY) private readonly taxonomy: Taxonomy,
  ) {}

  @Get('sources')
  listSources(): SourceSummary[] {
    return this.sources
      .map((s) => ({ id: s.id, name: s.name }))
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  }

  @Get('taxonomy')
  getTaxonomy(): Taxonomy {
    return this.taxonomy;
  }
}
```

`meta.module.ts`: `@Module({ controllers: [MetaController] })`; add to `AppModule`.

- [ ] **Step 4: Run to verify it passes** — `pnpm test && pnpm typecheck && pnpm lint` -> PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): public GET /sources and GET /taxonomy"
```

---

### Task 7: apps/web scaffold (Next.js 16, Tailwind, proxy, lint wiring)

**Files:**
- Create: `apps/web/package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `src/app/globals.css`, `src/app/layout.tsx` (minimal, replaced in Task 8), `src/app/page.tsx` (placeholder, replaced in Task 9), `src/types/shims.d.ts`
- Modify: root `package.json` (scripts, devDependencies), `eslint.config.js`, `.gitignore`

**Interfaces:**
- Consumes: `@attn/shared` (workspace; TS source export), root TypeScript 6.0.3, root ESLint 10 flat config.
- Produces: workspace package `@attn/web` with scripts `dev` (`next dev`, port 3000), `build` (`next build`), `start` (`next start`); root script `"web": "pnpm --filter @attn/web dev"`; Tailwind tokens (classes `bg-bg`, `bg-card`, `text-fg`, `text-muted`, `border-line`, `text-accent`, `bg-accent`, `text-accent-fg`, `bg-accent-soft`) used by Tasks 8-10; rewrite `/api/:path*` -> `${API_URL}/api/:path*`.

- [ ] **Step 1: Install and configure**

`apps/web/package.json`:

```json
{
  "name": "@attn/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "@attn/shared": "workspace:^",
    "next": "^16.4.0",
    "react": "^19.3.0",
    "react-dom": "^19.3.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.3.3",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "tailwindcss": "^4.3.3"
  }
}
```

Run `pnpm install` (versions on 2026-10-14: next 16.4.0, react 19.3.0, tailwindcss and @tailwindcss/postcss 4.3.3; keep newer stable if resolved). Root: `pnpm add -w -D @next/eslint-plugin-next eslint-plugin-react-hooks`, and add `"web": "pnpm --filter @attn/web dev"` to root scripts.

`apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "isolatedModules": true,
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "src/**/*.ts", "src/**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`src/types/shims.d.ts`:

```ts
/// <reference types="next/image-types/global" />
declare module '*.css';
```

`next.config.ts`:

```ts
import type { NextConfig } from 'next';

// Evaluated at build time for the rewrite: Docker passes API_URL as a build arg.
const apiUrl = (process.env.API_URL ?? 'http://localhost:3001').replace(/\/+$/, '');

const config: NextConfig = {
  transpilePackages: ['@attn/shared'],
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
};

export default config;
```

`postcss.config.mjs`: `export default { plugins: { '@tailwindcss/postcss': {} } };`

`src/app/globals.css`:

```css
@import "tailwindcss";

:root {
  --bg: #fafaf9;
  --card: #ffffff;
  --fg: #1c1917;
  --muted: #6b665f;
  --line: #e7e5e4;
  --accent: #4338ca;
  --accent-fg: #ffffff;
  --accent-soft: #e0e7ff;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #12110f;
    --card: #1b1a17;
    --fg: #f5f5f4;
    --muted: #a8a29e;
    --line: #2e2c28;
    --accent: #a5b4fc;
    --accent-fg: #12110f;
    --accent-soft: #2a2d57;
  }
}

@theme inline {
  --color-bg: var(--bg);
  --color-card: var(--card);
  --color-fg: var(--fg);
  --color-muted: var(--muted);
  --color-line: var(--line);
  --color-accent: var(--accent);
  --color-accent-fg: var(--accent-fg);
  --color-accent-soft: var(--accent-soft);
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}

body {
  background: var(--bg);
  color: var(--fg);
  font-family: var(--font-sans);
}
```

Minimal `src/app/layout.tsx`:

```tsx
import type { ReactNode } from 'react';
import './globals.css';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

Placeholder `src/app/page.tsx`: `export default function Page() { return <main className="p-6">ATTN</main>; }`.

Root `.gitignore`: add `.next/` and `next-env.d.ts`.

Root `eslint.config.js`: add `'**/.next'` and `'**/next-env.d.ts'` to `ignores`, import `nextPlugin from '@next/eslint-plugin-next'` and `reactHooks from 'eslint-plugin-react-hooks'`, and append:

```js
{
  files: ['apps/web/**/*.{ts,tsx}'],
  plugins: { '@next/next': nextPlugin, 'react-hooks': reactHooks },
  rules: {
    ...nextPlugin.configs['core-web-vitals'].rules,
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
  },
},
```

(If a plugin does not load under ESLint 10, see Decisions "Web lint".)

- [ ] **Step 2: Verify**

Run:
```bash
pnpm lint && pnpm typecheck
pnpm --filter @attn/web build
```
Expected: lint and typecheck PASS; the Next build succeeds with TypeScript 6.0.3 (this is the compatibility check; if Next rejects the TS version or cannot find `typescript`, add `"typescript": "6.0.3"` to web devDependencies and re-run; if Next rewrites `apps/web/tsconfig.json`, keep its edits). Then `git status`: only intended files changed (`next-env.d.ts` and `.next/` ignored).

Clean-checkout check (CI has no `.next` or `next-env.d.ts`): `rm -rf apps/web/.next apps/web/next-env.d.ts && pnpm typecheck && pnpm lint` must still pass. CI runs only lint, typecheck and test, so `next build` is verified locally only.

Also run `pnpm install` output check: if pnpm lists ignored build scripts for `sharp` or `@tailwindcss/oxide` and the build still passes, leave `onlyBuiltDependencies` alone.

- [ ] **Step 3: Commit**

```bash
git add apps/web package.json pnpm-lock.yaml eslint.config.js .gitignore
git commit -m "feat(web): Next.js 16 app scaffold with Tailwind 4 and /api rewrite"
```

---

### Task 8: Web shell (layout, nav with signed-in state, API client, sign-out)

**Files:**
- Create: `apps/web/src/lib/api.ts`, `src/lib/query.ts`, `src/lib/nav-items.ts`, `src/components/nav.tsx`, `src/components/sign-out-button.tsx`, `src/app/error.tsx`, `src/app/not-found.tsx`
- Modify: `apps/web/src/app/layout.tsx`

**Interfaces:**
- Consumes: `Me`, `meSchema`, `ArticlesPage`, `articlesPageSchema`, `ArticlesQuery`, `SourceSummary`, `sourcesResponseSchema`, `Taxonomy`, `taxonomySchema`, `errorBodySchema`, `ErrorBody` from `@attn/shared` (Task 1); Tailwind tokens (Task 7); api routes `GET /api/me`, `/api/articles`, `/api/sources`, `/api/taxonomy`, `POST /api/auth/logout`, `GET /api/auth/github` (Tasks 3-6).
- Produces:
  - `src/lib/api.ts` (server-side only): `class ApiError extends Error { status: number; body: ErrorBody | null }`; `getMe(): Promise<Me | null>` (null on 401 or when the api is unreachable); `getArticles(q: ArticlesQuery): Promise<ArticlesPage>`; `getSources(): Promise<SourceSummary[]>`; `getTaxonomy(): Promise<Taxonomy>`; `apiGet<T>(path, schema, opts?: { query?: Record<string, string | number | undefined>; cookie?: string })` for later stages (authenticated callers read `(await cookies()).toString()` themselves, outside any try/catch, and pass it as `cookie`).
  - `src/lib/query.ts`: `buildQueryString(params: Record<string, string | number | undefined>): string` (leading `?`, empty string when no params; skips `undefined` and empty strings).
  - `src/lib/nav-items.ts`: `interface NavItem { href: string; label: string; auth: 'any' | 'user' }`, `NAV_ITEMS: NavItem[]` (today only `{ href: '/all', label: 'All', auth: 'any' }`).
  - `Nav` (server component), `SignOutButton` (client).

- [ ] **Step 1: Implement** (no unit tests for web; verification in Step 2)

`src/lib/query.ts`:

```ts
export function buildQueryString(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}
```

`src/lib/api.ts`:

```ts
// Server-side API client. Server components call the api directly at API_URL
// (the browser uses the /api/* rewrite instead). Import only from server components.
import { cookies } from 'next/headers';
import {
  articlesPageSchema,
  errorBodySchema,
  meSchema,
  sourcesResponseSchema,
  taxonomySchema,
  type ArticlesPage,
  type ArticlesQuery,
  type ErrorBody,
  type Me,
  type SourceSummary,
  type Taxonomy,
} from '@attn/shared';
import { buildQueryString } from './query';

const apiBase = () => (process.env.API_URL ?? 'http://localhost:3001').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorBody | null,
    message: string,
  ) {
    super(message);
  }
}

interface Parser<T> {
  parse(input: unknown): T;
}

export async function apiGet<T>(
  path: string,
  schema: Parser<T>,
  opts: { query?: Record<string, string | number | undefined>; cookie?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.cookie) headers.cookie = opts.cookie;
  const res = await fetch(`${apiBase()}/api${path}${buildQueryString(opts.query ?? {})}`, {
    headers,
    cache: 'no-store',
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const body = errorBodySchema.safeParse(json);
    throw new ApiError(res.status, body.success ? body.data : null, body.success ? body.data.message : `API ${res.status}`);
  }
  return schema.parse(json);
}

export async function getMe(): Promise<Me | null> {
  // Read cookies() OUTSIDE the try: Next signals "dynamic usage" by throwing from it,
  // and swallowing that would let a prerendered route cache a signed-out shell.
  const cookie = (await cookies()).toString();
  try {
    return await apiGet('/me', meSchema, { cookie });
  } catch {
    return null; // 401, or the api is down: render the signed-out shell
  }
}

export const getArticles = (q: ArticlesQuery): Promise<ArticlesPage> =>
  apiGet('/articles', articlesPageSchema, { query: { ...q } });
export const getSources = (): Promise<SourceSummary[]> => apiGet('/sources', sourcesResponseSchema);
export const getTaxonomy = (): Promise<Taxonomy> => apiGet('/taxonomy', taxonomySchema);
```

`src/lib/nav-items.ts`:

```ts
export interface NavItem {
  href: string;
  label: string;
  /** 'user' items are shown only when signed in. Stages 4-5 add Profile and For you here. */
  auth: 'any' | 'user';
}

export const NAV_ITEMS: NavItem[] = [{ href: '/all', label: 'All', auth: 'any' }];
```

`src/components/sign-out-button.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.push('/');
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      className="rounded-md border border-line px-3 py-1.5 text-sm text-muted hover:text-fg disabled:opacity-60"
    >
      Sign out
    </button>
  );
}
```

`src/components/nav.tsx`:

```tsx
import Link from 'next/link';
import { getMe } from '@/lib/api';
import { NAV_ITEMS } from '@/lib/nav-items';
import { SignOutButton } from './sign-out-button';

export async function Nav() {
  const me = await getMe();
  const items = NAV_ITEMS.filter((i) => i.auth === 'any' || me);
  return (
    <header className="border-b border-line bg-card">
      <div className="mx-auto flex max-w-4xl items-center gap-6 px-4 py-3">
        <Link href="/" className="text-lg font-bold tracking-tight">
          ATTN
        </Link>
        <nav className="flex flex-1 gap-4 text-sm">
          {items.map((i) => (
            <Link key={i.href} href={i.href} className="text-muted hover:text-fg">
              {i.label}
            </Link>
          ))}
        </nav>
        {me ? (
          <div className="flex items-center gap-3 text-sm">
            {me.avatarUrl ? (
              // Keep the next line only if Task 7 kept @next/eslint-plugin-next; otherwise delete it.
              // eslint-disable-next-line @next/next/no-img-element -- small GitHub avatar, no optimizer needed
              <img src={me.avatarUrl} alt="" width={28} height={28} className="rounded-full" />
            ) : null}
            <span className="hidden sm:inline">{me.name ?? me.login}</span>
            <SignOutButton />
          </div>
        ) : (
          // Plain anchor: this is an api redirect, not a Next route.
          <a href="/api/auth/github" className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg">
            Sign in with GitHub
          </a>
        )}
      </div>
    </header>
  );
}
```

`src/app/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Nav } from '@/components/nav';
import './globals.css';

export const metadata: Metadata = {
  title: 'ATTN',
  description: 'AI articles ranked by your skill priorities and level.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Nav />
        <main className="mx-auto max-w-4xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
```

`src/app/error.tsx` (client; props `{ error, reset }`; shows "Something went wrong" and a "Try again" button calling `reset`) and `src/app/not-found.tsx` (heading "Page not found" with link home), using the same Tailwind tokens.

- [ ] **Step 2: Verify**

Run: `pnpm lint && pnpm typecheck && pnpm --filter @attn/web build`
Expected: PASS. Manual check later in Task 10 (full smoke).

- [ ] **Step 3: Commit**

```bash
git add apps/web
git commit -m "feat(web): app shell with nav, signed-in state, typed API client"
```

---

### Task 9: Landing page

**Files:**
- Modify: `apps/web/src/app/page.tsx` (replace the placeholder)

**Interfaces:**
- Consumes: `authErrorMessage` (Task 1); `getMe` (Task 8); Tailwind tokens (Task 7).
- Produces: route `/` with: error banner for a known `?auth_error=` code; hero explaining that ATTN ranks existing AI articles by skill priority and skill level (not by topic alone), curation only, links to originals; three short "how it works" points (pick focus skills, take a situational quiz, get a ranked feed); primary button "Sign in with GitHub" (`<a href="/api/auth/github">`; for a signed-in visitor it becomes a link "Open ATTN" to `/all`); secondary link "Browse all articles" to `/all`.

- [ ] **Step 1: Implement**

```tsx
import Link from 'next/link';
import { authErrorMessage } from '@attn/shared';
import { getMe } from '@/lib/api';

export default async function Landing({ searchParams }: { searchParams: Promise<{ auth_error?: string | string[] }> }) {
  const params = await searchParams;
  const code = Array.isArray(params.auth_error) ? params.auth_error[0] : params.auth_error;
  const error = authErrorMessage(code); // fixed messages only; never echoes the query text
  const me = await getMe();

  return (
    <div className="space-y-12">
      {error ? (
        <p role="alert" className="rounded-lg border border-line bg-accent-soft px-4 py-3 text-sm">
          {error}
        </p>
      ) : null}

      <section className="space-y-4">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">AI articles that fit your level.</h1>
        <p className="max-w-2xl text-lg text-muted">
          ATTN ranks existing AI articles by your skill priorities and skill level, not by topic alone. Curation only:
          every card links to the original article.
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          {me ? (
            <Link href="/all" className="rounded-md bg-accent px-4 py-2 font-medium text-accent-fg">
              Open ATTN
            </Link>
          ) : (
            <a href="/api/auth/github" className="rounded-md bg-accent px-4 py-2 font-medium text-accent-fg">
              Sign in with GitHub
            </a>
          )}
          <Link href="/all" className="rounded-md border border-line px-4 py-2 text-muted hover:text-fg">
            Browse all articles
          </Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {[
          ['Pick your focus', 'Choose up to five skills that matter most right now.'],
          ['Take a short quiz', 'Situational questions place you on a level from 0 to 4 for each skill.'],
          ['Read what fits', 'Articles are ranked by skill priority and difficulty relative to your level.'],
        ].map(([title, text]) => (
          <div key={title} className="rounded-xl border border-line bg-card p-4">
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-muted">{text}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `pnpm lint && pnpm typecheck && pnpm --filter @attn/web build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web
git commit -m "feat(web): landing page with sign-in and auth error banner"
```

---

### Task 10: All page (filters, cards, cursor pagination) and end-to-end smoke

**Files:**
- Create: `apps/web/src/lib/filters.ts`, `src/components/article-card.tsx`, `src/components/filters-form.tsx`, `src/app/all/page.tsx`

**Interfaces:**
- Consumes: `getArticles`, `getSources`, `getTaxonomy`, `ApiError` (Task 8); `buildQueryString` (Task 8); `ArticleCard`, `ArticlesQuery`, `readingMinutes`, `SourceSummary`, `Taxonomy` (Tasks 1, 6).
- Produces:
  - `src/lib/filters.ts`: `type RawSearchParams = Record<string, string | string[] | undefined>`; `FILTER_KEYS = ['source','skill','from','to'] as const`; `pickFilters(sp: RawSearchParams): { source?: string; skill?: string; from?: string; to?: string; cursor?: string }` (first value of each known key, empty -> omitted, unknown keys dropped).
  - `ArticleCardView({ article }: { article: ArticleCard })`: title as external link (`target="_blank" rel="noopener noreferrer"`), skill chips (primary: `bg-accent text-accent-fg`; others: `bg-accent-soft`), source name, UTC date (`Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' })`), `N min read` from `readingMinutes(article.wordCount)` (omitted when null).
  - `FiltersForm({ sources, taxonomy, values })`: `<form method="get" action="/all">` with source select, skill select grouped by domain (`optgroup`), `from`/`to` date inputs, "Apply" button and "Reset" link; no cursor field (changing filters restarts at the newest).
  - Route `/all`.

- [ ] **Step 1: Implement**

`filters.ts`:

```ts
export type RawSearchParams = Record<string, string | string[] | undefined>;
export const FILTER_KEYS = ['source', 'skill', 'from', 'to'] as const;

export interface PickedFilters {
  source?: string;
  skill?: string;
  from?: string;
  to?: string;
  cursor?: string;
}

export function pickFilters(sp: RawSearchParams): PickedFilters {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
  const out: PickedFilters = {};
  for (const k of [...FILTER_KEYS, 'cursor'] as const) {
    const v = first(sp[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}
```

`article-card.tsx` (server component) implements the card described above: `<article className="rounded-xl border border-line bg-card p-4">`, title `<a>` with `font-semibold hover:underline`, meta row `source · date · N min read`, chip list.

`filters-form.tsx`: server component, native controls with `defaultValue={values.x}`; selects first option `All sources` / `All skills` with value `""`; `from`/`to` `<input type="date">`; layout `grid gap-3 sm:grid-cols-4`.

`app/all/page.tsx`:

```tsx
import Link from 'next/link';
import { ArticleCardView } from '@/components/article-card';
import { FiltersForm } from '@/components/filters-form';
import { ApiError, getArticles, getSources, getTaxonomy } from '@/lib/api';
import { pickFilters, type RawSearchParams } from '@/lib/filters';
import { buildQueryString } from '@/lib/query';

export const metadata = { title: 'All articles | ATTN' };

export default async function AllPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const filters = pickFilters(await searchParams);
  const { cursor, ...rest } = filters;
  const [sources, taxonomy] = await Promise.all([getSources(), getTaxonomy()]);

  let page = null;
  let problem: string | null = null;
  try {
    page = await getArticles(filters);
  } catch (e) {
    if (e instanceof ApiError && e.status === 400) problem = e.message; // hand-edited URL: show it, do not crash
    else throw e;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">All articles</h1>
      <FiltersForm sources={sources} taxonomy={taxonomy} values={rest} />
      {problem ? (
        <p role="alert" className="rounded-lg border border-line bg-accent-soft px-4 py-3 text-sm">
          {problem}
        </p>
      ) : null}
      {page && page.items.length === 0 ? <p className="text-muted">No articles match these filters.</p> : null}
      <div className="space-y-3">{page?.items.map((a) => <ArticleCardView key={a.id} article={a} />)}</div>
      <div className="flex gap-4 text-sm">
        {cursor ? <Link href={`/all${buildQueryString(rest)}`} className="text-muted hover:text-fg">Back to newest</Link> : null}
        {page?.nextCursor ? (
          <Link href={`/all${buildQueryString({ ...rest, cursor: page.nextCursor })}`} className="font-medium text-accent">
            Older articles
          </Link>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify code**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @attn/web build`
Expected: PASS.

- [ ] **Step 3: Manual smoke (real api + web, no GitHub credentials)**

```bash
# terminal A: migrate the dev DB, seed two labeled articles with psql or a throwaway tsx script using seedArticle-like inserts, start api
DATABASE_URL=postgres://attn:attn@localhost:5432/attn pnpm attn migrate
# blank GitHub credentials, so a repo-root .env (loaded by main.ts) cannot change the result
DATABASE_URL=postgres://attn:attn@localhost:5432/attn SCHEDULE_ENABLED=false GITHUB_CLIENT_ID= GITHUB_CLIENT_SECRET= pnpm api
# terminal B
pnpm web
# terminal C
curl -s localhost:3000/api/health                      # through the Next rewrite -> {"status":"ok","db":"up"}
curl -s "localhost:3000/api/articles?limit=1"           # JSON page
curl -si localhost:3000/api/auth/github | head -5       # 302 Location: http://localhost:3000/?auth_error=not_configured
curl -s "localhost:3000/?auth_error=not_configured" | grep -c "not configured"   # >= 1: fixed message shown
curl -s "localhost:3000/?auth_error=%3Cscript%3E" | grep -c "<script>alert"   # 0: arbitrary text is never reflected
curl -s -o /dev/null -w "%{http_code}
" "localhost:3000/all?from=nope"   # 200 (the page shows the api's 400 message in an alert; pickFilters drops unknown keys such as limit)
curl -s "localhost:3000/all?from=nope" | grep -c 'role="alert"'               # >= 1
```
Expected: outputs as commented; record them in the task report. Real GitHub sign-in cannot be exercised here (no credentials); it is covered by the fake-GitHub e2e tests in Task 4.

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat(web): All page with filters, article cards and cursor pagination"
```

---

### Task 11: Docker (api, web), compose services, env example, README

**Files:**
- Create: `apps/api/Dockerfile`, `apps/web/Dockerfile`, `.dockerignore`
- Modify: `docker-compose.yml`, `.env.example`, `README.md`

**Interfaces:**
- Consumes: root scripts (`pnpm attn migrate`, `pnpm --filter @attn/api start`, `pnpm --filter @attn/web build|start`), env vars from `apps/api/src/config/env.ts` (Task 2), `API_URL` (Task 7).
- Produces: compose services `postgres`, `api`, `web`; `docker compose up --build` serves the site on `http://localhost:3000`.

These files cannot be built locally (Docker image pulls are broken). Keep them standard and simple, prefer clarity over image size, and do not claim they work.

- [ ] **Step 1: Write files**

`.dockerignore`:

```
node_modules
**/node_modules
.git
.env
.cache
**/.next
**/dist
docs
```

`apps/api/Dockerfile` (build context = repo root):

```dockerfile
FROM node:24-slim
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
ENV NODE_ENV=production
EXPOSE 3001
# Migrations are idempotent; run them before starting the api.
CMD ["sh", "-c", "pnpm attn migrate && pnpm --filter @attn/api start"]
```

`apps/web/Dockerfile`:

```dockerfile
FROM node:24-slim
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
# The /api/* rewrite is baked in at build time.
ARG API_URL=http://api:3001
ENV API_URL=$API_URL
RUN pnpm --filter @attn/web build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "@attn/web", "start"]
```

`docker-compose.yml`: keep `postgres` and `pgdata` as they are, change the header comment, and add:

```yaml
  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://attn:attn@postgres:5432/attn
      PORT: "3001"
      APP_URL: ${APP_URL:-http://localhost:3000}
      GITHUB_CLIENT_ID: ${GITHUB_CLIENT_ID:-}
      GITHUB_CLIENT_SECRET: ${GITHUB_CLIENT_SECRET:-}
      GOOGLE_GENERATIVE_AI_API_KEY: ${GOOGLE_GENERATIVE_AI_API_KEY:-}
      LABEL_MODEL: ${LABEL_MODEL:-}
      COOKIE_SECURE: ${COOKIE_SECURE:-}
      # SCHEDULE_ENABLED is deliberately not set: the daily collect+label job runs inside this container by default.
    expose:
      - "3001"

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
      args:
        API_URL: http://api:3001
    depends_on:
      - api
    environment:
      API_URL: http://api:3001
    ports:
      - "3000:3000"
```

(The api is not published on the host: the browser reaches it only through the web proxy, as in production.)

`.env.example`: keep the six active keys, and append commented optional lines:

```
# Optional (see README):
# PORT=3001                   # api port (default 3001)
# COOKIE_SECURE=false         # session cookies are Secure by default; set false ONLY for local plain-http dev (api logs a warning)
# SCHEDULE_ENABLED=true       # set false to disable the daily collect+label job
# API_URL=http://localhost:3001   # read by apps/web (put it in the web's environment, not only here)
```

`README.md` (re-read it first; Stage 2 agents edit it): update Status to "Stage 3 of 5: website + auth"; add to Quick start the dev flow (`pnpm api` in one terminal, `pnpm web` in another, open http://localhost:3000); a "Sign in with GitHub (OAuth app)" section: create an OAuth app at GitHub Settings > Developer settings, homepage `http://localhost:3000`, callback URL `http://localhost:3000/api/auth/github/callback` (the browser-facing origin plus `/api/auth/github/callback`), put the client id/secret in `.env`, session cookies are always `Secure` unless you set `COOKIE_SECURE=false`, which you need for plain-http local development (the api logs a warning); production must serve https and leave it unset; `APP_URL` is the browser-facing origin, without credentials the landing page shows "not configured"; the commands table gets `pnpm api` and `pnpm web`; a short API list (`/api/health`, `/api/auth/github`, `/api/auth/github/callback`, `POST /api/auth/logout`, `/api/me`, `/api/articles?source=&skill=&from=&to=&cursor=&limit=`, `/api/sources`, `/api/taxonomy`); the layout block lists `apps/api` and `apps/web`; a note that over plain http (compose on localhost) `COOKIE_SECURE=false` must be set in `.env`, and that the api container also runs the daily job; a note "`docker compose up --build` starts postgres, api and web (the Dockerfiles have not been built in the authoring environment)".

- [ ] **Step 2: Verify**

Run:
```bash
pnpm lint && pnpm typecheck && pnpm test
docker compose config >/dev/null 2>&1 && echo compose-ok || pnpm --filter @attn/core exec node --input-type=module -e "import fs from 'node:fs'; import {parse} from 'yaml'; parse(fs.readFileSync(process.argv[1],'utf8')); console.log('yaml-ok')" "$PWD/docker-compose.yml"
```
Expected: lint/typecheck/test PASS; `compose-ok` (if the docker CLI is installed) or `yaml-ok`. State in the report that the images were not built or run.

- [ ] **Step 3: Commit**

```bash
git add apps/api/Dockerfile apps/web/Dockerfile .dockerignore docker-compose.yml .env.example README.md
git commit -m "feat: Dockerfiles, compose api/web services, env example and README for auth and web"
```

---

## Self-Review (done while writing)

- **Spec coverage:** §6.5 (hashed session id, httpOnly/Secure/Lax cookie, logout deletes row, failed OAuth to landing with message, same-origin proxy) -> Tasks 3, 4, 7, 9. §6.2 and §6.6 articles (labeled only, newest first, source/skill/date filters, cursor on `published_at`, JSON errors, DTOs in shared) -> Tasks 1, 2, 5, 10. §6.4 landing -> Task 9. §2 architecture (`apps/web`, compose api/web, rewrite) -> Tasks 7, 11. §7 secrets/`.env.example` -> Tasks 2, 11. §8 (api e2e with faked OAuth, web typecheck+lint, CI) -> Tasks 2-6, root commands. Privacy invariant -> Task 4 scan test. Out of scope respected (no onboarding/quiz/profile/feed/events).
- **Placeholder scan:** none intended; test cases are enumerated with exact inputs/outputs, code is shown for all non-trivial files; `error.tsx`/`not-found.tsx` and the two small web components are described by exact content rules.
- **Name consistency:** `startTestApp/testEnv/seedArticle/seedUser/skillIds/startFakeGithub` (Task 2) are the only names used in Tasks 3-6; `SessionService.create/findUser/destroy/purgeExpired`, `SESSION_COOKIE`, `parseCookies`, `sessionCookieOptions`, `generateToken`, `hashToken` (Task 3) are used verbatim in Task 4; `OAUTH_STATE_COOKIE` is defined and used in Task 4 only; shared exports from Task 1 match imports in Tasks 5, 6, 8, 9, 10; `AuthModule` exports match the extensibility note.
