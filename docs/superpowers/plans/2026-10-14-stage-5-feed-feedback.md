# ATTN Stage 5: For you + Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in, onboarded user opens "For you" and sees articles ranked by skill priority and level (one SQL query), and every feedback button (read, 👍, too easy, too hard, not interested) changes the user's skill state exactly as spec §5.2/§5.3 says; the Profile shows real reading history and 👍 share; the MVP done-criteria within the repo's control are met.

**Architecture:** `packages/core/src/rank/` holds the `Ranker` interface and `SqlRanker` (one `SELECT` with CTEs, all constants passed in from `data/config.yml`, no NestJS, no role knowledge). `packages/core/src/levels/feedback.ts` holds the pure offset/interest math and `levels/events.ts` holds `recordEvent`: one transaction that locks the user's `user_skills` row, inserts the unique event with `ON CONFLICT DO NOTHING RETURNING` and applies the effects only when a row was inserted. `apps/api` gets thin `feed` (`GET /feed`) and `events` (`POST /articles/:id/events`) modules behind Stage 3's `SessionGuard`. `apps/web` adds `/for-you` with client feedback buttons and "load more".

**Tech Stack:** Node 24, pnpm workspaces, TypeScript 6.0.3 (pinned `^6.0.3`, do not upgrade), vitest 5, zod 4, NestJS 12.1.x, Drizzle + postgres.js, Next.js 16.4, React 19.3, Tailwind CSS 4.3, Postgres 17. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-14-attn-design.md` (binding). Stage 5 = spec §9 item 5, with §1, §2, §3.2, §5.2, §5.3, §6.1, §6.3, §6.6, §7, §8. Earlier plans for conventions: `docs/superpowers/plans/2026-10-14-stage-3-website-auth.md` and `...stage-4-onboarding-profile.md`. **Stage 4 interfaces are treated as given** and named where used: `applyReadPoint`, `effectiveLevel`, `effectiveUncertain`, `progressToNext`, `roleSkillIds`, `saveOnboarding`, `setFocus`, `isOnboarded`, `buildProfile` (core `levels/`, barrel `packages/core/src/levels/index.ts`); `profileSchema` / `Profile` / `MAX_FOCUS` (`@attn/shared`, `onboarding.ts`); `signIn` (`apps/api/src/test/auth.ts`); `startTestApp(overrides?, extra?)`; `requireProfile()` (`apps/web/src/lib/guards.ts`); `browserJson`, `BrowserApiError` (`apps/web/src/lib/browser-api.ts`); `FOCUS_LOCK_NAMESPACE = 727002` (`levels/store.ts`), `PIPELINE_LOCK_KEY = 727001` (`db/lock.ts`). Stage 4 Task 7 landed at `26ffdfb`: `signIn(ctx, over?) -> { user, token, headers }` in `apps/api/src/test/auth.ts`, `startTestApp(overrides?, extra?: { quiz?: Quiz; taxonomy?: Taxonomy })` in `apps/api/src/test/app.ts`, `GET /api/profile`, the `QUIZ` token. Stage 5 Tasks 6, 7 and 10 depend on it; Stage 5 starts only after Stage 4 is complete. **Re-read each of these files as it exists on the branch before using or editing it; if a name differs, adapt this plan's call sites and say so in the task report.**

## Global Constraints

Every task's requirements implicitly include this section. Values are copied from the spec or the environment.

- **Ranking (spec §6.1):** `t = level + difficulty_offset` (null level counts as 1 and as uncertain: `coalesce(level, 1)`), with the top clamped to 4 (Decision 2; there is no lower clamp). Filter: primary skill is a focus skill, or background with `quality >= background_quality_min` (4); `difficulty ∈ {t, t+1}`, for uncertain skills `{t-1 … t+2}`; `quality >= quality_min` (2); `type ∈ {release, news}` only if published within `fresh_days` (14), other types have no age limit; no `read` or `not_interested` event from this user. `score = priority × interest × fit × quality / 4`; `priority = (6 - r)/5` for focus rank `r`, `0.1` for background; `fit = 1.0` for `t+1`, `0.8` for `t`, `0.5` otherwise; `order by score desc, published_at desc`. Page size 20 (`page_size`) with "load more" (offset). One SQL query per request, nothing precomputed per user.
- **Level growth (spec §5.2):** "read" gives +1 point to the article's primary skill when `difficulty >= level`; one point per article (unique event); at `points_per_level` (5): level +1, points 0; cap 4. Implemented by Stage 4's `applyReadPoint`; this stage only calls it.
- **Feedback (spec §5.3):** applies to the article's **primary** skill. too easy / too hard: `difficulty_offset = clamp(round((too_easy - too_hard) / offset_k), -1, +1)` recomputed from that skill's events after each click. Events recorded before the user's latest quiz result for that skill do not count (Decision 14: spec §5.1 "redo resets `difficulty_offset`"). not interested: `interest × interest_decay` (0.8), floor `interest_min` (0.2); the article leaves the feed. 👍: no ranking effect; the share of 👍 among read articles is the quality metric. Read: the article leaves the feed.
- **Events (spec §3.2):** `article_events` unique `(user_id, article_id, kind)` (constraint `article_events_user_article_kind_unique`).
- **API (spec §6.6):** prefix `/api`; `GET /feed?offset=`, `POST /articles/:id/events { kind }`, both behind `SessionGuard`; errors JSON `{ error, message }`; request/response shapes are zod schemas in `packages/shared`.
- **Config (spec §7):** every tunable number lives in `data/config.yml` (zod-validated, `configSchema` is a `strictObject`). Task 1 adds the four formula constants the spec lists in §6.1 but not in §7.
- **Controller ruling 1:** event handling only `UPDATE`s existing `user_skills` rows and never inserts one. A user with no `user_skills` rows (not onboarded) still gets the event recorded; skill effects are skipped.
- **Controller ruling 2 / privacy invariant (spec §2):** ranking and events never touch `label/`, `eval/` or `extract/`; Task 12 adds a scan test.
- **Controller ruling 3 / concurrency:** read effects (points, level-up) must be correct under double-clicks and parallel clicks: unique event insert as the gate (`INSERT … ON CONFLICT DO NOTHING RETURNING`), effects only when a row came back, all in one transaction, after locking the `user_skills` row `FOR UPDATE`.
- **Controller ruling 4:** the `Ranker` interface lives in `packages/core` with no NestJS and no knowledge of roles (spec §2). Roles never appear in `rank/`.
- **Testing (spec §8):** vitest. Ranking against real Postgres (`attn_test`, `TEST_DATABASE_URL`) with a fixture covering every filter and score branch; unit tests for offset and interest math; api e2e for feed and events behind the session guard. **Web: typecheck and lint only; do not add web tests** (pure helpers used by the web live in `@attn/shared` and are tested there). No LLM calls in any test; never mock global `fetch`.
- **NestJS under vitest/tsx:** every constructor parameter of an injectable uses explicit `@Inject(TOKEN_OR_CLASS)`; tokens live in `apps/api/src/tokens.ts`; validate with zod through `parseWith` (`apps/api/src/common/zod.ts`), no `ValidationPipe`.
- **Environment:** native Postgres 17 on `localhost:5432`; TypeScript 6.0.3; Next 16 with Tailwind 4; Docker unavailable locally; no GitHub or Gemini credentials (so the demo uses a seed script, Task 11).
- **Working style:** change only what the task asks; one commit per task with the attribution trailers the session requires; do not claim success without running the verify command and reading its output. `pnpm lint`, `pnpm typecheck` and `pnpm test` must be green after every task. Other agents may edit neighbouring files: re-read before editing, and make edits to shared files (`app.module.ts`, `tokens.ts`, `index.ts` barrels, `README.md`) append-only. Stage 5 runs its tasks sequentially, so the one deliberate non-append edit is Task 8 inserting the "For you" nav item first.

## Decisions

Points the spec leaves open or the environment forced (binding for this plan):

1. **Four new config keys** (Task 1): `background_priority: 0.1`, `fit_next: 1.0`, `fit_same: 0.8`, `fit_stretch: 0.5`, so no ranking constant is hard-coded. The focus priority `(6 - r)/5` is derived from `MAX_FOCUS` (a structural limit, not a tunable): `(MAX_FOCUS + 1 - r) / MAX_FOCUS`.
2. **`t` is clamped at the top only:** `t = least(coalesce(level, 1) + difficulty_offset, 4)`; there is no lower clamp. Without the top clamp a level-4 skill with offset +1 matches difficulty `{5, 6}`, which never exist, so the skill vanishes from For you and the user can never click "too hard" on it to undo the offset (a dead end the spec did not intend). With it, level 4 offset +1 gives `t = 4`: certain band `{4, 5}`, difficulty 4 at fit 0.8. Level 0 offset -1 keeps `t = -1` (band `{-1, 0}`: difficulty 0 shows at fit 1.0), which correctly narrows. A deviation from the literal text of spec §6.1; recorded in `docs/decisions.md` (Task 1). Pinned by tests in Tasks 3 and 4.
3. **Tie-break:** `order by score desc, published_at desc, id desc`. The extra `id desc` makes offset paging deterministic. Score is computed in `numeric` (interest `real` cast to `numeric`), so mathematically equal scores compare equal instead of differing in the last float bit.
4. **Freshness boundary:** an article is fresh when `published_at >= now - fresh_days days` (inclusive). `now` is a parameter of `createSqlRanker` (default `() => new Date()`), so tests fix the clock.
5. **Ranker surface:** `Ranker.rank(userId, {limit, offset}) → ArticleCard[]` (spec). `SqlRanker` additionally exposes `rankScored(...) → {card, score}[]` for tests and diagnostics. It issues exactly **one** SQL statement (skills of each card are aggregated with `json_agg` in the same query); a test counts statements. Names for cards come from the injected `sources` and `taxonomy` (unknown ids fall back to the id, like `ArticlesService`). Raw `db.execute` returns `timestamptz` columns as **strings** (drizzle's postgres-js driver installs identity parsers), e.g. `2026-10-13 12:00:00+00`, so `published_at` is mapped with `new Date(String(row.published_at)).toISOString()`; a Date-typed assumption would throw.
6. **Feed response:** `GET /api/feed?offset=N` → `{ items: ArticleCard[], nextOffset: number | null }`. `offset` is an integer `0 … 10000` (default 0), anything else is 400. The service asks the ranker for `page_size + 1` rows to know whether there is more; `nextOffset = offset + page_size` or `null`. A user with no `user_skills` rows gets `200 { items: [], nextOffset: null }` (the web redirects such users to onboarding via `requireProfile()`). `Cache-Control: no-store`.
7. **Events response / idempotency:** `POST /api/articles/:id/events` with `{ kind }` returns **200** `{ kind, recorded }` always: `recorded: true` when this click created the event, `recorded: false` when the same `(user, article, kind)` already existed (a repeated click is a harmless no-op, nothing is applied twice). Unknown id or an article that is not `labeled` → 404; bad `:id` (not a positive integer) or bad body → 400. A user may record several different kinds on one article (e.g. `too_easy` after `like`). `too_easy` and `too_hard` on the same article both count in the offset formula (spec: counts of events; no cancelling).
8. **Rounding:** `computeDifficultyOffset` rounds half away from zero (symmetric: `+0.5 → +1`, `-0.5 → -1`), unlike `Math.round`. With the default `offset_k = 3` no tie can occur; the rule only matters if `offset_k` is set even.
9. **Event effects run on the locked row** (`SELECT … FOR UPDATE` on `user_skills`, taken before the event insert so every effect for one (user, skill) is serialized and always sees committed counts). Lock order is always `user_skills` row, then `article_events`, so there is no deadlock between concurrent clicks. `interest` is computed in JS from the locked value and written back.
10. **Web "load more" offset:** cards that leave the list (`read`, `not_interested`) are exactly the ones the server now excludes, so the next request uses `offset = items.length + duplicatesSkipped` (the visible count plus any already-visible cards the server returned again after a re-rank by `too_easy`/`too_hard`). `mergeFeedItems` in `@attn/shared` implements and tests this. "Read" is an `<a target="_blank" rel="noopener noreferrer">` (no popup blocking) whose click sends the `read` event and removes the card on success; on failure the card stays and an alert shows.
11. **Landing/redirect:** the post-login redirect stays `/profile` (Stage 4 decision); "For you" is a nav item for signed-in users. Not changed here.
12. **Demo data (Task 11):** `pnpm attn seed-demo` inserts deterministic labeled articles (`label_model = 'demo-seed'`, URLs `https://example.com/demo/<skill>/<n>`) directly, never through `label/`; `--remove` deletes them. Idempotent (`ON CONFLICT (url) DO NOTHING`).
13. **Archiving ai-news is the owner's decision.** The repo only documents the criterion and the steps in the README (Task 12).
14. **Offset recompute counts only events after the user's latest quiz result for that skill.** Spec §5.1 says redoing the quiz resets `difficulty_offset`; §5.3 says the offset is recomputed from the events. Recomputing from all history would silently bring the old offset back on the next click. So `recordEvent` counts `too_easy`/`too_hard` events (on articles whose primary skill is the skill) with `created_at > max(quiz_answers.answered_at)` over the user's answers for that skill (skill of an answer = `question_id` without its trailing `-<n>`); no quiz answers for the skill means all events count. Verified against Stage 4: `saveOnboarding`'s upsert into `quiz_answers` sets `answered_at = now()` on conflict (`packages/core/src/levels/store.ts`, `answeredAt: sql\`now()\``), so no Stage 4 change is needed. A quiz redo that sends no answers for a skill leaves its offset and its marker alone (same as Stage 4: only answered skills are re-scored). Events recorded before onboarding count if the user has no quiz answers for the skill. Cost if the owner prefers full history: delete one `WHERE` clause in `levels/events.ts`.

## Review Focus

Inputs and conditions a happy-path suite would miss. Each has a test in the named task.

1. Double-click / parallel identical `read` clicks, and parallel reads of different articles of one skill: exactly one point per article, level-ups never lost or doubled (Task 5, 7).
2. Two parallel `too_easy` clicks on different articles of one skill: the offset must reflect both (a stale count would give 0) (Task 5).
3. Events from a never-onboarded user (or on an article whose primary skill has no user row): event stored, no `user_skills` row created, no error (Tasks 5, 7).
4. Events on a pending/failed/unknown article, a malformed id (`abc`, `0`, `-1`, `1.5`, `99999999999`), unknown `kind`, extra body keys: 404/400, nothing written (Tasks 5, 7).
5. A quiz redo followed by one `too_easy` click must not resurrect the pre-redo offset (Task 5).
6. Feed paging stability: tied scores, offset past the end, invalid/huge offset, and the web's offset after cards were removed (Tasks 3, 4, 6, 1).

## File Structure

```
data/config.yml                                      (modify) 4 new keys
docs/decisions.md                                    (modify, append) config keys, t clamp, offset reset (Task 1)
packages/shared/src/config.ts                        (modify) 4 new keys
packages/shared/src/feed.ts                          feed/event DTO schemas, mergeFeedItems
packages/shared/src/feed.test.ts
packages/shared/src/index.ts                         (modify, append) export feed
packages/core/src/levels/feedback.ts                 computeDifficultyOffset, applyNotInterested
packages/core/src/levels/events.ts                   recordEvent, ArticleNotFoundError
packages/core/src/rank/types.ts                      Ranker, RankParams, RankConfig, ScoredCard
packages/core/src/rank/sql.ts                        SqlRanker, createSqlRanker
packages/core/src/rank/fixtures.ts                   test fixture builders (tests only; exported via testing.ts)
packages/core/src/rank/index.ts                      barrel; core index re-exports it
packages/core/src/rank/{eligibility,scoring,paging}.test.ts, privacy.test.ts
packages/core/src/demo/seed.ts, seed.test.ts         demo articles (Task 11)
packages/core/src/cli.ts                             (modify) seed-demo command
apps/api/src/tokens.ts                               (modify, append) RANKER
apps/api/src/feed/                                   feed.service.ts, feed.controller.ts, feed.module.ts, feed.e2e.test.ts
apps/api/src/events/                                 events.service.ts, events.controller.ts, events.module.ts, events.e2e.test.ts
apps/api/src/feed/loop.e2e.test.ts                   feed -> events -> profile loop (Task 10)
apps/api/src/app.module.ts                           (modify, append) FeedModule, EventsModule
apps/web/src/lib/api.ts                              (modify, append) getFeed
apps/web/src/lib/nav-items.ts                        (modify, append) For you
apps/web/src/components/feed-card.tsx                client card with feedback buttons
apps/web/src/components/feed-list.tsx                client list + load more
apps/web/src/app/for-you/page.tsx                    route
scripts/smoke.sh                                     end-to-end smoke (Task 12)
README.md                                            (modify, append-only sections) Task 12
```

---

### Task 1: Config constants and shared feed/event DTOs

**Files:**
- Modify: `docs/decisions.md` (append a section), `data/config.yml`, `packages/shared/src/config.ts`, `packages/shared/src/schemas.test.ts` (the `config` fixture object at line ~20), `packages/shared/src/index.ts` (append `export * from './feed';`)
- Create: `packages/shared/src/feed.ts`, `packages/shared/src/feed.test.ts`

**Interfaces:**
- Consumes: `articleCardSchema`, `ArticleCard` (`api.ts`), `eventKindSchema`, `EventKind` (`enums.ts`), `configSchema`/`Config`.
- Produces (all from `@attn/shared`):
  - `Config` gains `background_priority`, `fit_next`, `fit_same`, `fit_stretch` (each `z.number().gt(0).lte(1)`).
  - `FEED_MAX_OFFSET = 10_000`; `feedQuerySchema` (input `{ offset?: string }` → output `{ offset: number }`, default 0, `^\d+$`, `<= FEED_MAX_OFFSET`); `feedPageSchema` = `{ items: ArticleCard[]; nextOffset: number | null }`; type `FeedPage`.
  - `articleIdParamSchema` (string `^[1-9]\d{0,9}$` → number `<= 2147483647`); `eventBodySchema` = strict `{ kind: EventKind }`; `eventResponseSchema` = strict `{ kind: EventKind; recorded: boolean }`; types `EventBody`, `EventResponse`.
  - `mergeFeedItems(current: ArticleCard[], incoming: ArticleCard[]): { items: ArticleCard[]; duplicates: number }` (appends incoming cards whose `id` is not in `current`, keeping order; `duplicates` counts the skipped ones).

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/feed.test.ts` (build cards with a small helper `card(id)` that satisfies `articleCardSchema`):
1. `feedQuerySchema.parse({})` → `{ offset: 0 }`; `{ offset: '40' }` → 40; `'0'` → 0; `'10000'` ok.
2. Rejects `'-1'`, `'1.5'`, `'abc'`, `''`, `'10001'`, `'1e3'`, `' 5'`, and an array `['1','2']`.
3. `articleIdParamSchema.parse('7')` → 7; rejects `'0'`, `'-1'`, `'1.5'`, `'abc'`, `'007'`, `'99999999999'`, `'2147483648'`.
4. `eventBodySchema` accepts each of the five kinds; rejects `{ kind: 'share' }`, `{}`, `{ kind: 'read', extra: 1 }`.
5. `eventResponseSchema` parses `{ kind: 'read', recorded: false }`; rejects a missing `recorded`.
6. `feedPageSchema` parses `{ items: [card(1)], nextOffset: null }` and `{ items: [], nextOffset: 20 }`; rejects `nextOffset: -1`... (it must be a non-negative integer or null).
7. `mergeFeedItems([c1,c2],[c2,c3,c4])` → items `[c1,c2,c3,c4]`, duplicates 1; empty current takes all; empty incoming returns a copy with duplicates 0; input arrays are not mutated; duplicates inside `incoming` itself are also skipped (second occurrence counts as a duplicate).

`docs/decisions.md` (append, no test): a section "Stage 5 ranking and feedback (2026-10-14)" listing (a) the four new `config.yml` keys with defaults and meaning: `background_priority` 0.1 (priority of an article whose primary skill is background), `fit_next` 1.0 (fit when difficulty = t+1), `fit_same` 0.8 (difficulty = t), `fit_stretch` 0.5 (any other difficulty inside the uncertain range); spec §7's key list does not name them and the spec is not edited; (b) the `t` top clamp (Decision 2 of the Stage 5 plan, with its reason); (c) the offset reset rule (Decision 14, with its reason and the one-`WHERE` revert). Keep the file's existing style.

`schemas.test.ts`: add the four keys to the `config` fixture; add cases: a config missing `fit_next` fails; `fit_same: 0` fails; `fit_stretch: 1.5` fails.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/shared`
Expected: FAIL (exports missing; fixture keys rejected by the strict schema only after Step 3, so first the new tests fail).

- [ ] **Step 3: Implement**

`config.ts`: inside `configSchema` add `background_priority: unitInterval, fit_next: unitInterval, fit_same: unitInterval, fit_stretch: unitInterval,`.

`data/config.yml` (keep the existing comment style, append after `page_size`):

```yaml
# Feed: priority of an article whose primary skill is a background skill. Focus skill rank r has priority (6 - r) / 5.
background_priority: 0.1
# Feed: fit multiplier when the article difficulty is t + 1 (t = level + difficulty_offset).
fit_next: 1.0
# Feed: fit multiplier when the article difficulty is t.
fit_same: 0.8
# Feed: fit multiplier for any other difficulty inside the uncertain range (t - 1 and t + 2).
fit_stretch: 0.5
```

`feed.ts`:

```ts
import { z } from 'zod';
import { articleCardSchema, type ArticleCard } from './api';
import { eventKindSchema } from './enums';

export const FEED_MAX_OFFSET = 10_000;

export const feedQuerySchema = z.object({
  offset: z
    .string()
    .regex(/^\d+$/, 'must be a non-negative integer')
    .transform(Number)
    .pipe(z.number().int().max(FEED_MAX_OFFSET))
    .default(0),
});

export const feedPageSchema = z.object({
  items: z.array(articleCardSchema),
  nextOffset: z.number().int().min(0).nullable(),
});
export type FeedPage = z.infer<typeof feedPageSchema>;

export const articleIdParamSchema = z
  .string()
  .regex(/^[1-9]\d{0,9}$/, 'must be a positive integer')
  .transform(Number)
  .pipe(z.number().int().max(2_147_483_647));

export const eventBodySchema = z.strictObject({ kind: eventKindSchema });
export type EventBody = z.infer<typeof eventBodySchema>;

export const eventResponseSchema = z.strictObject({ kind: eventKindSchema, recorded: z.boolean() });
export type EventResponse = z.infer<typeof eventResponseSchema>;

export function mergeFeedItems(
  current: ArticleCard[],
  incoming: ArticleCard[],
): { items: ArticleCard[]; duplicates: number } {
  const seen = new Set(current.map((c) => c.id));
  const items = [...current];
  let duplicates = 0;
  for (const card of incoming) {
    if (seen.has(card.id)) duplicates += 1;
    else {
      seen.add(card.id);
      items.push(card);
    }
  }
  return { items, duplicates };
}
```

(`feedQuerySchema` is applied to `Record<string, unknown>`; the `offset` array case fails the `z.string()` step.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run packages/shared packages/core/src/data.real.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS (`data.real.test.ts` loads the real `data/config.yml` through `configSchema`).

- [ ] **Step 5: Commit**

```bash
git add docs/decisions.md data/config.yml packages/shared
git commit -m "feat(shared): feed/event DTOs, mergeFeedItems and ranking constants in config"
```

---

### Task 2: Pure feedback math (difficulty offset, interest decay)

**Files:**
- Create: `packages/core/src/levels/feedback.ts`, `packages/core/src/levels/feedback.test.ts`
- Modify: `packages/core/src/levels/index.ts` (append `export * from './feedback';`)

**Interfaces:**
- Consumes: nothing (pure).
- Produces (from `@attn/core`):
  - `computeDifficultyOffset(tooEasy: number, tooHard: number, offsetK: number): -1 | 0 | 1` = `clamp(round((tooEasy - tooHard) / offsetK), -1, 1)`, rounding half away from zero, never returns `-0`. Throws `RangeError` for negative or non-integer counts or `offsetK` not a positive integer.
  - `applyNotInterested(interest: number, decay: number, min: number): number` = `max(min, interest * decay)`. Throws `RangeError` if `interest` is not `> 0` or if `decay` or `min` is outside `(0, 1]`.

- [ ] **Step 1: Write the failing tests** (`feedback.test.ts`, `offsetK = 3` unless stated)
1. Table for `computeDifficultyOffset(e, h, 3)`: `(0,0)→0`, `(1,0)→0` (0.33), `(2,0)→1` (0.67), `(3,0)→1`, `(9,0)→1` (clamped), `(0,1)→0`, `(0,2)→-1`, `(0,9)→-1`, `(5,5)→0`, `(4,2)→1` (0.67), `(2,4)→-1`, `(3,2)→0`, `(2,3)→0`.
2. `offsetK = 1`: `(1,0)→1`, `(0,1)→-1`, `(1,1)→0`. `offsetK = 2`: `(1,0)→1` (0.5 rounds away from zero) and `(0,1)→-1` (symmetry). `offsetK = 4`: `(2,0)→1`, `(0,2)→-1`, `(1,0)→0`.
3. Result is never `-0`: `Object.is(computeDifficultyOffset(0, 1, 3), 0)` is true.
4. Errors: `(-1,0,3)`, `(1.5,0,3)`, `(0,0,0)`, `(0,0,2.5)` throw `RangeError`.
5. `applyNotInterested(1, 0.8, 0.2)` → 0.8 (closeTo); applied repeatedly: 0.8, 0.64, 0.512, 0.4096, 0.32768, 0.262144, then 0.2 (floor) and stays 0.2; `interest` already below floor (0.1) returns `min` 0.2 (floor wins); `decay = 1` returns the interest unchanged (≥ min); `min = 1` returns 1.
6. `applyNotInterested(0, 0.8, 0.2)`, `(1, 0, 0.2)`, `(1, 1.2, 0.2)`, `(1, 0.8, 0)` throw `RangeError`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/core/src/levels/feedback.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
function assertCount(n: number, name: string): void {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`${name} must be a non-negative integer, got ${n}`);
}

export function computeDifficultyOffset(tooEasy: number, tooHard: number, offsetK: number): -1 | 0 | 1 {
  assertCount(tooEasy, 'tooEasy');
  assertCount(tooHard, 'tooHard');
  if (!Number.isInteger(offsetK) || offsetK < 1) throw new RangeError(`offsetK must be a positive integer, got ${offsetK}`);
  const raw = (tooEasy - tooHard) / offsetK;
  const rounded = Math.sign(raw) * Math.round(Math.abs(raw)); // half away from zero
  if (rounded >= 1) return 1;
  if (rounded <= -1) return -1;
  return 0;
}

export function applyNotInterested(interest: number, decay: number, min: number): number {
  if (!(interest > 0)) throw new RangeError(`interest must be > 0, got ${interest}`);
  if (!(decay > 0 && decay <= 1)) throw new RangeError(`decay must be in (0, 1], got ${decay}`);
  if (!(min > 0 && min <= 1)) throw new RangeError(`min must be in (0, 1], got ${min}`);
  return Math.max(min, interest * decay);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run packages/core/src/levels/feedback.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/levels
git commit -m "feat(core): pure difficulty-offset and interest-decay math"
```

---

### Task 3: Ranker interface and the eligibility filter (real Postgres)

**Files:**
- Create: `packages/core/src/rank/types.ts`, `packages/core/src/rank/sql.ts`, `packages/core/src/rank/fixtures.ts`, `packages/core/src/rank/index.ts`, `packages/core/src/rank/eligibility.test.ts`
- Modify: `packages/core/src/index.ts` (append `export * from './rank';`), `packages/core/src/testing.ts` (append `export * from './rank/fixtures';`)

**Interfaces:**
- Consumes: `Db`, `articles`, `articleSkills`, `userSkills`, `articleEvents`, `users` (`db/schema`); `ArticleCard`, `Config`, `Source`, `Taxonomy`, `MAX_FOCUS`, `articleCardSchema` (`@attn/shared`); `testDb`, `resetDb`.
- Produces (from `@attn/core`):
  - `interface RankParams { limit: number; offset: number }`; `interface Ranker { rank(userId: string, params: RankParams): Promise<ArticleCard[]> }`.
  - `type RankConfig = Pick<Config, 'quality_min' | 'background_quality_min' | 'fresh_days' | 'background_priority' | 'fit_next' | 'fit_same' | 'fit_stretch'>`.
  - `interface ScoredCard { card: ArticleCard; score: number }`.
  - `interface RankDeps { config: RankConfig; sources: Source[]; taxonomy: Taxonomy; now?: () => Date }`.
  - `class SqlRanker implements Ranker { rank(...); rankScored(userId, params): Promise<ScoredCard[]> }` and `createSqlRanker(db: Db, deps: RankDeps): SqlRanker`. `rank` and `rankScored` throw `RangeError` when `limit` is not an integer in `1…1000` or `offset` is not an integer `>= 0`.
  - Test fixtures from `@attn/core/testing`: `rankConfig: RankConfig` (explicit literals: 2, 4, 14, 0.1, 1.0, 0.8, 0.5; `eligibility.test.ts` has one assertion that it equals the picked keys of `loadConfig()`, so drift from `data/config.yml` fails a test); `RANK_NOW = new Date('2026-10-14T12:00:00.000Z')`; `rankSources: Source[]` (one source `{ id: 'src', name: 'Source One', … }` minimal valid shape); `rankTaxonomy: Taxonomy` is **not** provided: tests use `loadTaxonomy()`; `makeUser(db): Promise<string>` (inserts a user with a fresh `githubId` and **does not set `role`**, the column default applies; returns id); `giveSkill(db, userId, skillId, over?: Partial<typeof userSkills.$inferInsert>): Promise<void>` (defaults `level 2, uncertain false, interest 1, difficultyOffset 0, focusRank null`); `makeArticle(db, o: ArticleFixture): Promise<number>` where `ArticleFixture = { primary: string; secondary?: string[]; difficulty?: number (default 2); quality?: number (default 3); type?: ArticleType (default 'tutorial'); publishedAt?: Date (default RANK_NOW minus 1 day); status?: LabelStatus (default 'labeled'); url?: string; sourceId?: string (default 'src') }` (inserts article + skills; unique url/guid/title_hash from a module counter); `addEvent(db, userId, articleId, kind): Promise<void>`.
  - Task 4 extends `sql.ts` (scoring/order); this task builds the candidate CTE and a provisional `order by published_at desc, id desc`.

- [ ] **Step 1: Write the failing tests** (`eligibility.test.ts`; `beforeEach` resets the DB and creates `u = await makeUser(db)`; `ranker = createSqlRanker(db, { config: rankConfig, sources: rankSources, taxonomy: loadTaxonomy(), now: () => RANK_NOW })`; helper `ids = async (user = u) => (await ranker.rank(user, { limit: 100, offset: 0 })).map((c) => c.id)`; `S1, S2, S3` = first three taxonomy skill ids; unless a case says otherwise the user has `S1` as focus rank 1, level 2, certain, so `t = 2` and the certain band is difficulty `{2, 3}`)

Skill-role filter:
1. Focus skill, quality 2 → included; quality 1 → excluded (`quality_min`).
2. Background skill (`focusRank null`) quality 3 → excluded; quality 4 → included (`background_quality_min`).
3. Primary skill with no `user_skills` row for this user → excluded; a **secondary** skill that is the user's focus skill does not qualify an article whose primary has no row; an article whose primary is a user skill and whose secondary is anything qualifies on the primary only.

Difficulty band (focus S1):
4. Level 2, offset 0, certain: difficulty 0,1 excluded; 2 and 3 included; 4 excluded (articles of every difficulty 0..4 in one test).
5. Level 2, uncertain true: 0 excluded; 1,2,3,4 included.
6. Level `null` (unassessed, `uncertain` true in the row): `t = 1`: difficulty 0,1,2,3 included, 4 excluded. Same result with `uncertain false` and `level null` (null level is always uncertain).
7. Offset +1 (level 2): `t = 3`: 2 excluded, 3 and 4 included; offset -1: `t = 1`: 0 excluded, 1 and 2 included, 3 excluded.
8. **Decision 2 pin (top clamp):** level 4 offset +1 certain: `t = min(5, 4) = 4`, so difficulty 4 qualifies (and 5 does not exist), difficulty 3 does not. Level 3 offset +1 certain: `t = 4`, same result (difficulty 4 only qualifies from 4, 3 does not). Level 4 offset +1 with `uncertain true`: difficulty 3 (`t-1`) and 4 qualify. Level 4 offset -1: `t = 3`, certain band `{3, 4}`. Level 0 offset -1 certain: `t = -1` (no lower clamp), difficulty 0 qualifies and difficulty 1 does not.
8a. `rankConfig` equals `{ quality_min, background_quality_min, fresh_days, background_priority, fit_next, fit_same, fit_stretch }` picked from `loadConfig()`.

Freshness (`RANK_NOW`, `fresh_days 14`):
9. `release` and `news` published 13 days ago → included; 15 days ago → excluded; exactly 14 days ago (`RANK_NOW` minus 14 × 86400000 ms) → included (inclusive boundary).
10. `tutorial`, `deep_dive`, `research` published 400 days ago → included. A `release` published in the **future** (+2 days) is included.

Events:
11. A `read` event of this user → excluded; `not_interested` → excluded; `like`, `too_easy`, `too_hard` events do **not** exclude.
12. Another user's `read` of the same article does not exclude it for this user; the other user's feed is independent.

Labeling and URLs:
13. `pending` and `failed` articles are excluded even with matching skill rows (`makeArticle` with `status`).
14. An article whose url is `ftp://x.test/a` (or `javascript:alert(1)`) is excluded (the card schema allows http(s) only); `http://` and `https://` included.

Card shape and the one-query rule:
15. Every returned card parses with `articleCardSchema`; `publishedAt` equals the inserted `Date`'s `toISOString()`; `skills` has the primary first with `isPrimary true` and the taxonomy names, secondary skills after it sorted by id; `sourceName` is `'Source One'` for `src` and falls back to the id for an unknown source id; `publishedAt` is an ISO string; `difficulty`, `type`, `quality`, `wordCount` come from the row.
16. `vi.spyOn(db, 'execute')` around one `rank` call: called exactly **once** (skills are aggregated in the same statement).
17. `rank(u, { limit: 0, offset: 0 })`, `{ limit: 1.5, … }`, `{ limit: 1001, … }`, `{ limit: 1, offset: -1 }` and `{ limit: 1, offset: 0.5 }` reject with `RangeError`. A user id that is not a uuid rejects (Postgres error), it is not interpolated into SQL.
18. A user with no `user_skills` rows gets `[]`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/core/src/rank/eligibility.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`types.ts` per the Produces block (no imports from `levels/`, `label/`, `eval/`, `extract/`; it and the rest of `rank/` must not contain the word "role" anywhere, comments included, nor the string `'dev'`).

`sql.ts` (a complete, runnable provisional query; the difficulty band sits in the outer `where` and the order is by date; Task 4 will wrap the band and the score into a `scored` CTE). Use drizzle's `sql` template; every value is a bound parameter:

```ts
import { sql } from 'drizzle-orm';
import type { ArticleCard, ArticleType } from '@attn/shared';

interface Row {
  id: number;
  source_id: string;
  url: string;
  title: string;
  published_at: string; // raw db.execute returns timestamptz as a string
  word_count: number | null;
  difficulty: number;
  type: ArticleType;
  quality: number;
  score_f: number;
  skills: { id: string; isPrimary: boolean }[];
}

function assertPaging(limit: number, offset: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new RangeError(`limit must be an integer 1..1000, got ${limit}`);
  if (!Number.isInteger(offset) || offset < 0) throw new RangeError(`offset must be an integer >= 0, got ${offset}`);
}

export class SqlRanker implements Ranker {
  private readonly sourceNames: Map<string, string>;
  private readonly skillNames: Map<string, string>;
  constructor(
    private readonly db: Db,
    private readonly deps: RankDeps,
  ) {
    this.sourceNames = new Map(deps.sources.map((s) => [s.id, s.name]));
    this.skillNames = new Map(deps.taxonomy.domains.flatMap((d) => d.skills.map((k) => [k.id, k.name] as const)));
  }

  async rank(userId: string, p: RankParams): Promise<ArticleCard[]> {
    return (await this.rankScored(userId, p)).map((s) => s.card);
  }

  async rankScored(userId: string, { limit, offset }: RankParams): Promise<ScoredCard[]> {
    assertPaging(limit, offset);
    const c = this.deps.config;
    const now = (this.deps.now ?? (() => new Date()))();
    const freshSince = new Date(now.getTime() - c.fresh_days * 86_400_000).toISOString();
    const rows = (await this.db.execute(sql`
      with cand as (
        select a.id, a.source_id, a.url, a.title, a.published_at, a.word_count,
               a.difficulty, a.type, a.quality,
               us.focus_rank, us.interest::numeric as interest,
               least(coalesce(us.level, 1) + us.difficulty_offset, 4) as t,
               (us.level is null or us.uncertain) as unc
        from articles a
        join article_skills p on p.article_id = a.id and p.is_primary
        join user_skills us on us.user_id = ${userId}::uuid and us.skill_id = p.skill_id
        where a.label_status = 'labeled'
          and a.url ~* '^https?://'
          and a.quality >= ${c.quality_min}::int
          and (us.focus_rank is not null or a.quality >= ${c.background_quality_min}::int)
          and (a.type not in ('release', 'news') or a.published_at >= ${freshSince}::timestamptz)
          and not exists (
            select 1 from article_events e
            where e.user_id = ${userId}::uuid and e.article_id = a.id and e.kind in ('read', 'not_interested'))
      )
      select cand.id, cand.source_id, cand.url, cand.title, cand.published_at, cand.word_count,
             cand.difficulty, cand.type, cand.quality,
             0::float8 as score_f,
             (select coalesce(json_agg(json_build_object('id', k.skill_id, 'isPrimary', k.is_primary)
                                       order by k.is_primary desc, k.skill_id), '[]'::json)
              from article_skills k where k.article_id = cand.id) as skills
      from cand
      where cand.difficulty between (case when cand.unc then cand.t - 1 else cand.t end)
                                and (case when cand.unc then cand.t + 2 else cand.t + 1 end)
      order by cand.published_at desc, cand.id desc
      limit ${limit}::int offset ${offset}::int`)) as unknown as Row[];
    return rows.map((r) => ({ card: this.toCard(r), score: r.score_f }));
  }

  private toCard(r: Row): ArticleCard {
    return {
      id: r.id,
      title: r.title,
      url: r.url,
      sourceId: r.source_id,
      sourceName: this.sourceNames.get(r.source_id) ?? r.source_id,
      publishedAt: new Date(String(r.published_at)).toISOString(),
      wordCount: r.word_count,
      difficulty: r.difficulty,
      type: r.type,
      quality: r.quality,
      skills: r.skills.map((k) => ({ id: k.id, name: this.skillNames.get(k.id) ?? k.id, isPrimary: k.isPrimary })),
    };
  }
}

export const createSqlRanker = (db: Db, deps: RankDeps): SqlRanker => new SqlRanker(db, deps);
```

(`json_agg` already orders primary first, then by id. The `t` expression includes the Decision 2 top clamp. Add a test assertion that `publishedAt` of a card equals `fixtureDate.toISOString()` of the inserted `Date`, which pins the string-to-ISO mapping.)

`fixtures.ts` implements the helpers listed above (`makeArticle` inserts into `articles` with `labelModel: 'test'`, `difficulty`/`type`/`quality` null when `status !== 'labeled'`, then `articleSkills` rows with exactly one primary).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run packages/core/src/rank && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): Ranker interface and SQL eligibility filter"
```

---

### Task 4: Ranker scoring, ordering and paging

**Files:**
- Modify: `packages/core/src/rank/sql.ts`
- Create: `packages/core/src/rank/scoring.test.ts`, `packages/core/src/rank/paging.test.ts`

**Interfaces:**
- Consumes: Task 3 (`createSqlRanker`, `SqlRanker.rankScored`, fixtures `makeUser`, `giveSkill`, `makeArticle`, `rankConfig`, `RANK_NOW`, `rankSources`).
- Produces: the final ranking query. `rankScored(...).score` equals `priority × interest × fit × quality / 4` (JS `number`, from `numeric` cast to `float8`), results ordered `score desc, published_at desc, id desc`.

- [ ] **Step 1: Write the failing tests**

`scoring.test.ts` (user has skill rows as stated; articles at `RANK_NOW` minus 1 day unless stated; use `toBeCloseTo(x, 9)` for scores):
1. **Priority by focus rank:** five focus skills ranks 1..5 (levels 2, certain), one article each at difficulty 3 (= `t+1`, fit 1.0), quality 4, interest 1 → scores `1.0, 0.8, 0.6, 0.4, 0.2` in that order (priority `(6-r)/5`).
2. **Background priority:** background skill (level 2), difficulty 3, quality 4 → score `0.1` (`background_priority`); with a config override `background_priority: 0.5` → `0.5` (constant comes from config).
3. **Fit branches** (focus rank 1, level 2, `uncertain true`, quality 4, interest 1): difficulty 3 (`t+1`) → 1.0; difficulty 2 (`t`) → 0.8; difficulty 1 (`t-1`) → 0.5; difficulty 4 (`t+2`) → 0.5. With `fit_stretch: 0.25` the last two become 0.25. With `fit_next: 0.9, fit_same: 0.7` the first two follow.
4. **Quality factor:** focus rank 1, difficulty 3, interest 1: quality 4 → 1.0, quality 3 → 0.75, quality 2 → 0.5.
5. **Interest factor:** interest 0.5 → score halves; interest stored as `real` 0.8 yields exactly `0.8 × …` (numeric cast, no `0.800000011920929` artefact: `score` of a rank-1, fit-1, quality-4, interest-0.8 article `toBeCloseTo(0.8, 9)`).
6. **Hand-computed combo:** focus rank 2 (priority 0.8), interest 0.5, difficulty `t+1` (fit 1.0), quality 3 → `0.8 × 0.5 × 1.0 × 3 / 4 = 0.3`. Another: background (0.1), level `null` (t = 1, uncertain), difficulty 0 (`t-1` → fit 0.5), quality 4 → `0.1 × 1 × 0.5 × 4 / 4 = 0.05`.
7. **Offset changes fit:** level 2, `difficulty_offset +1` (t = 3): difficulty 4 scores fit 1.0, difficulty 3 fit 0.8.
8. **Order:** an article with a higher score always precedes a lower one regardless of `published_at` (older high-score first).
9. **Tie-break by recency:** two articles with identical score, `published_at` differing → newer first. Three identical-score identical-date articles come back by `id desc`, and the order is the same on repeated calls.
10. **Equal-but-computed-differently scores tie exactly:** focus rank 3 (0.6), interest 1, difficulty `t+1`, quality 4 vs focus rank 1 (1.0), interest 0.6 (stored `real`), difficulty `t+1`, quality 4 → both `0.6` and ordered by recency (guards float noise: this fails if interest is not cast to `numeric`).
11. **Cross-skill mix (concrete rows).** User: `S1` focus rank 1, level 2, certain, interest 1; `S2` focus rank 2, level 2, `uncertain true`, interest 1; `S3` background, level 2, certain, interest 1; `S4` focus rank 3, level 2, certain, interest 0.5 (`not_interested` decayed). Articles (all `tutorial`, published `RANK_NOW` minus 1 day unless stated; `makeArticle` creates them in this order so ids ascend A..F): A: `S1`, difficulty 3, quality 4 -> `1.0 x 1 x 1.0 x 4/4 = 1.0`; B: `S1`, difficulty 2, quality 4 -> `1.0 x 0.8 = 0.8`; C: `S2`, difficulty 1 (`t-1`, stretch), quality 4 -> `0.8 x 0.5 = 0.4`; D: `S4`, difficulty 3, quality 4 -> `0.6 x 0.5 x 1.0 = 0.3`; E: `S3`, difficulty 3, quality 4 -> `0.1`; F: `S2`, difficulty 3, quality 2, published 5 days earlier than C -> `0.8 x 1.0 x 2/4 = 0.4`, tied with C, so C (newer) precedes F. Expected order `[A, B, C, F, D, E]` with those scores (closeTo 9 digits).
13. **Top clamp (Decision 2):** level 4, offset +1, certain, focus rank 1, quality 4, interest 1: a difficulty-4 article scores `0.8` (`t = 4`, difficulty = t, fit_same); a difficulty-3 article is absent. Level 3 offset +1 gives the same result. Level 0 offset -1: a difficulty-0 article scores `1.0` (`t = -1`, difficulty = t+1).
12. `rank` (cards only) returns the same ids in the same order as `rankScored`.

`paging.test.ts`:
1. 25 eligible articles with distinct scores: `rank(limit 10, offset 0/10/20)` returns 10, 10, 5 cards whose concatenation equals `rank(limit 100, offset 0)` (no gaps, no duplicates).
2. 25 eligible articles with **all identical** scores and dates: pages of 10 still concatenate to the full order (id tie-break), no duplicates.
3. `offset` past the end → `[]`; `limit` larger than the remainder returns the remainder.
4. A `read` event between page 1 and page 2: re-requesting with `offset = visibleCount` (the web rule, Decision 10) yields the following articles with none repeated and none skipped (assert on ids).
5. 300 eligible articles, `limit 20`, `offset 280` → 20 cards (large offset works).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/core/src/rank`
Expected: FAIL (score is 0 / order is by date).

- [ ] **Step 3: Implement** — replace the `select` of Task 3 with the final shape (Decision 3):

```sql
, scored as (
  select cand.*,
    (case when cand.focus_rank is not null
          then (${MAX_FOCUS_SQL}::numeric + 1 - cand.focus_rank) / ${MAX_FOCUS_SQL}::numeric
          else ${c.background_priority}::numeric end)
    * cand.interest
    * (case when cand.difficulty = cand.t + 1 then ${c.fit_next}::numeric
            when cand.difficulty = cand.t     then ${c.fit_same}::numeric
            else ${c.fit_stretch}::numeric end)
    * cand.quality / 4 as score
  from cand
  where cand.difficulty between (case when cand.unc then cand.t - 1 else cand.t end)
                            and (case when cand.unc then cand.t + 2 else cand.t + 1 end)
)
select s.*, s.score::float8 as score_f, (<skills subquery on s.id>) as skills
from scored s
order by s.score desc, s.published_at desc, s.id desc
limit ${limit}::int offset ${offset}::int
```

where `MAX_FOCUS_SQL = sql.raw(String(MAX_FOCUS))` (a compile-time constant, not user input). This moves the band predicate from Task 3's outer `where` into the `scored` CTE and orders by score; `cand` (including `least(…, 4) as t`) is unchanged. Keep it a single `db.execute`, and map `score_f` (replacing Task 3's constant `0::float8`) to `score`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run packages/core && pnpm typecheck && pnpm lint`
Expected: PASS (including Task 3's tests, which must still hold).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/rank
git commit -m "feat(core): ranker scoring, deterministic ordering and offset paging"
```

---

### Task 5: `recordEvent` (unique-event gate, locked effects)

**Files:**
- Create: `packages/core/src/levels/events.ts`, `packages/core/src/levels/events.test.ts`
- Modify: `packages/core/src/levels/index.ts` (append `export * from './events';`)

**Interfaces:**
- Consumes: Task 2 (`computeDifficultyOffset`, `applyNotInterested`); Stage 4 `applyReadPoint(state: SkillProgress, articleDifficulty: number, pointsPerLevel: number)` returning `{ level, points, awarded, leveledUp }`; `articleEvents`, `articles`, `articleSkills`, `userSkills`, `Db`; `EventKind`, `Config` (`@attn/shared`); fixtures `makeUser`, `giveSkill`, `makeArticle`, `addEvent` (Task 3); `saveOnboarding` is not needed (rows are given with `giveSkill`).
- Produces (from `@attn/core`):
  - `type FeedbackConfig = Pick<Config, 'points_per_level' | 'offset_k' | 'interest_decay' | 'interest_min'>`.
  - `class ArticleNotFoundError extends Error`.
  - `interface RecordEventResult { recorded: boolean; skillUpdated: boolean }`.
  - `recordEvent(db: Db, input: { userId: string; articleId: number; kind: EventKind }, cfg: FeedbackConfig): Promise<RecordEventResult>`. Throws `ArticleNotFoundError` (nothing written) when the article does not exist, is not `labeled`, or has no primary skill.

- [ ] **Step 1: Write the failing tests** (`events.test.ts`; `cfg = { points_per_level: 5, offset_k: 3, interest_decay: 0.8, interest_min: 0.2 }`; `S1`, `S2` taxonomy ids; helpers `row = (user, skill) => select the user_skills row`, `eventCount = (user, article?, kind?)`)

Read:
1. User with `S1` level 2, points 0; article primary `S1` difficulty 2: result `{ recorded: true, skillUpdated: true }`, points 1, level 2, one `read` event. Same call again: `{ recorded: false, skillUpdated: false }`, points still 1, still one event row.
2. Difficulty 1 (< level 2): event recorded, `skillUpdated` false, points 0, level 2. Difficulty 3 awards.
3. Points 4, difficulty 2, level 2 → level 3, points 0.
4. Level 4: event recorded, nothing changes (points stay 0).
5. Level `null`: difficulty 0 → no award; difficulty 1 → points 1 and level stays `null`; at points 4 → level 2, points 0.
6. Only the **primary** skill is affected: article primary `S1`, secondary `S2` (user has rows for both) → `S2` row untouched.
7. **Double-click:** `Promise.all` of 10 identical `read` calls (same user, article) → exactly one result has `recorded: true`; points exactly +1; one event row.
8. **Parallel different articles:** level 1 (certain), points 0, 10 articles of difficulty 2 on `S1`, read in `Promise.all` → every call `recorded: true`, final `level 3, points 0` (10 points = 2 level-ups, none lost or doubled). A variant with 7 articles → `level 2, points 2`.
9. **Level cap under parallel reads:** level 3, points 0, 12 parallel reads of 12 different articles of **difficulty 3** (difficulty ≥ level, so each would award) → `level 4, points 0` (the cap holds, no value above 4, no check-constraint error).

too_easy / too_hard (k = 3):
10. (k = 3, user has no quiz answers) After `too_easy` on 1 article: offset 0 (event stored). 2 articles → offset 1; 3 → 1. `too_hard` on 2 articles → -1. 2 easy then 2 hard → 0 (recomputed from events, not incremental); 1 easy + 3 hard → -1... assert each step's stored offset.
11. Events on articles whose primary skill is **another** skill are not counted; only the article's primary skill's `difficulty_offset` changes.
12. Repeat of the same `too_easy` on the same article: `recorded: false`, offset unchanged. `too_easy` and `too_hard` on one article both count (offset formula uses both: 1 easy + 1 hard on the same article → 0).
13. **Parallel too_easy on different articles of one skill:** 2 parallel calls → final offset 1 (a stale count would leave 0); 6 parallel `too_hard` → -1 and 6 event rows.

not_interested:
14. Interest 1 → 0.8 (closeTo) → 0.64 on a second article; 10 articles → floors at 0.2; the same article twice → second is a no-op (`recorded: false`, interest unchanged). `read` and `like` do not change interest. Parallel `not_interested` on 3 articles → interest closeTo 0.512.

like:
15. `like` records the event (`recorded: true`, `skillUpdated: false`) and changes **no** `user_skills` column; repeat → `recorded: false`.

Ruling 1 (not onboarded):
16. A user with no `user_skills` rows: each of the five kinds returns `recorded: true`, `skillUpdated: false`; the event rows exist; **`user_skills` still has zero rows**. A user who has rows for `S2` only, clicking an article whose primary is `S1`: same (no row created for `S1`).

Errors and isolation:
17. Article id that does not exist, a `pending` article, a `failed` article → `ArticleNotFoundError`; `article_events` is empty.
18. Another user's `user_skills` and events are never touched (two users, one clicks; the other's rows are deep-equal before and after).
19. Rollback: the user has a `user_skills` row for the article's primary skill; `recordEvent(... 'too_easy' ..., { ...cfg, offset_k: 0 })` makes `computeDifficultyOffset` throw `RangeError`: it rejects and **no** event row remains (the insert is rolled back with the transaction).
20. **Quiz redo resets the offset for good (Decision 14).** `cfg.offset_k = 3`. User with `S1` row. Record `too_easy` on articles X1, X2 (primary `S1`) → offset 1. Simulate the redo: `saveOnboarding(db, { userId, roleSkillIds: [S1, ...], results: [{ skillId: S1, level: 2, uncertain: false }], answers: [{ questionId: `${S1}-1`, first: 0, second: 1 }, { questionId: `${S1}-2`, first: 0, second: 1 }], quizVersion: 1 })` (re-read Stage 4's signature; it sets `difficulty_offset = 0` and `answered_at = now()`). Offset is 0. One more `too_easy` on a new article X3 → offset stays **0** (only X3 counts: 1/3 rounds to 0), not 1 (3 events). Two more `too_easy` (X3, X4) → offset 1. A `too_hard` click on an old article's skill sibling X5 after the redo counts normally.
21. Events recorded **before** any quiz answers exist (never took the quiz) all count; a quiz taken for **another** skill (answers for `S2`) does not move `S1`'s marker.
22. A quiz answer id such as `${S1}-10` is attributed to `S1` (suffix rule), and a different skill whose id merely starts with `S1` is not (use the real taxonomy to pick two skills; if none share a prefix, assert with a synthetic `quiz_answers` row `question_id = '${S1}x-1'` for the user, which must not move `S1`'s marker).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/core/src/levels/events.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
export async function recordEvent(db: Db, input: { userId: string; articleId: number; kind: EventKind }, cfg: FeedbackConfig): Promise<RecordEventResult> {
  const { userId, articleId, kind } = input;
  return db.transaction(async (tx) => {
    const [art] = await tx
      .select({ difficulty: articles.difficulty, skillId: articleSkills.skillId })
      .from(articles)
      .innerJoin(articleSkills, and(eq(articleSkills.articleId, articles.id), eq(articleSkills.isPrimary, true)))
      .where(and(eq(articles.id, articleId), eq(articles.labelStatus, 'labeled')));
    if (!art || art.difficulty === null) throw new ArticleNotFoundError(articleId);

    // 1. Lock the (user, skill) row first: every effect for it is serialized, and the lock order
    //    (user_skills, then article_events) is the same for every caller. No row = not onboarded.
    const [row] = await tx
      .select()
      .from(userSkills)
      .where(and(eq(userSkills.userId, userId), eq(userSkills.skillId, art.skillId)))
      .for('update');

    // 2. The unique event is the gate: a repeat inserts nothing and applies nothing.
    const inserted = await tx
      .insert(articleEvents)
      .values({ userId, articleId, kind })
      .onConflictDoNothing({ target: [articleEvents.userId, articleEvents.articleId, articleEvents.kind] })
      .returning({ id: articleEvents.id });
    if (inserted.length === 0) return { recorded: false, skillUpdated: false };
    if (!row || kind === 'like') return { recorded: true, skillUpdated: false };

    const where = and(eq(userSkills.userId, userId), eq(userSkills.skillId, art.skillId));
    if (kind === 'read') {
      const next = applyReadPoint({ level: row.level, points: row.points }, art.difficulty, cfg.points_per_level);
      if (!next.awarded) return { recorded: true, skillUpdated: false };
      await tx.update(userSkills).set({ level: next.level, points: next.points }).where(where);
    } else if (kind === 'not_interested') {
      await tx.update(userSkills).set({ interest: applyNotInterested(row.interest, cfg.interest_decay, cfg.interest_min) }).where(where);
    } else {
      // too_easy | too_hard: recompute from this user's events on articles with this primary skill,
      // counting only events newer than the user's latest quiz result for the skill (Decision 14).
      const [marker] = await tx
        .select({ at: sql<Date | null>`max(${quizAnswers.answeredAt})` })
        .from(quizAnswers)
        .where(and(eq(quizAnswers.userId, userId), sql`regexp_replace(${quizAnswers.questionId}, '-\d+$', '') = ${art.skillId}`));
      const counts = await tx
        .select({ kind: articleEvents.kind, n: sql<number>`count(*)::int` })
        .from(articleEvents)
        .innerJoin(articleSkills, and(eq(articleSkills.articleId, articleEvents.articleId), eq(articleSkills.isPrimary, true)))
        .where(
          and(
            eq(articleEvents.userId, userId),
            eq(articleSkills.skillId, art.skillId),
            inArray(articleEvents.kind, ['too_easy', 'too_hard']),
            marker?.at ? sql`${articleEvents.createdAt} > ${marker.at}` : undefined,
          ),
        )
        .groupBy(articleEvents.kind);
      const n = (k: EventKind) => counts.find((c) => c.kind === k)?.n ?? 0;
      await tx.update(userSkills).set({ difficultyOffset: computeDifficultyOffset(n('too_easy'), n('too_hard'), cfg.offset_k) }).where(where);
    }
    return { recorded: true, skillUpdated: true };
  });
}
```

(Notes for the implementer: import `quizAnswers` from the schema. `marker.at` may arrive as a string through the `sql<>` select (raw timestamptz): pass it back to the comparison unchanged, or compare inside SQL with a subquery `created_at > (select max(answered_at) …)` if the driver mangles it; the test 20 catches either failure. The `for('update')` lock before the insert is what makes tests 8, 9 and 13 pass; the counting `select` runs after the lock was granted, as a new READ COMMITTED statement, so it sees the event rows that earlier transactions committed. `applyReadPoint` is Stage 4's; re-read its real return type before wiring.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run packages/core && pnpm typecheck && pnpm lint`
Expected: PASS. Run the concurrency tests 5 times in a row (`for i in 1 2 3 4 5; do pnpm vitest run packages/core/src/levels/events.test.ts -t "parallel|Double-click|cap"; done`) and confirm they never flake.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/levels
git commit -m "feat(core): recordEvent with unique-event gate and row-locked feedback effects"
```

---

### Task 6: API `GET /feed`

**Files:**
- Modify: `apps/api/src/tokens.ts` (append `export const RANKER = Symbol('RANKER');`), `apps/api/src/app.module.ts` (append-only: add `FeedModule` to `imports`, keep every existing module)
- Create: `apps/api/src/feed/feed.service.ts`, `feed.controller.ts`, `feed.module.ts`, `feed.e2e.test.ts`

**Interfaces:**
- Consumes: `Ranker`, `createSqlRanker` (Task 3); `feedQuerySchema`, `feedPageSchema`, `FeedPage` (Task 1); Stage 3: `SessionGuard`, `CurrentUser`, `AuthUser`, `AuthModule`, `parseWith`, tokens `DB`, `APP_CONFIG`, `SOURCES`, `TAXONOMY`; Stage 4 test helpers: `signIn(ctx, over?)` → `{ user, token, headers }`, `startTestApp()`; `seedArticle`, `skillIds`, `seedUser`; core `saveOnboarding`, `roleSkillIds`, `loadTaxonomy`, `resetDb`.
- Produces: `RANKER` token provided by `FeedModule` via `useFactory: (db, config, sources, taxonomy) => createSqlRanker(db, { config, sources, taxonomy })`; `FeedService.get(user: AuthUser, offset: number): Promise<FeedPage>` (exported); `GET /api/feed?offset=` (guarded, `Cache-Control: no-store`).

- [ ] **Step 1: Write the failing tests** (`feed.e2e.test.ts`; `startTestApp()`, `beforeEach` resets the DB, `afterEach` closes; helper `onboard(user, { focus, results })` calls core `saveOnboarding(db, { userId, roleSkillIds: roleSkillIds(loadTaxonomy(), 'dev'), focus, results, answers: [], quizVersion: 1 })`; `S1,S2` from `skillIds(2)`; user is onboarded with focus `[S1]` and result `{ skillId: S1, level: 2, uncertain: false }` so the certain band is difficulty 2..3; `seed = (o) => seedArticle(ctx.db, { primary: S1, difficulty: 2, quality: 3, type: 'tutorial', ...o })`)
1. No cookie: 401, body parses with `errorBodySchema`, `error: 'unauthorized'`. Garbage cookie `attn_session=nope`: 401.
2. Signed in, never onboarded: 200 `{ items: [], nextOffset: null }` and **no `user_skills` rows were written**.
3. Onboarded: body parses with `feedPageSchema`; `Cache-Control: no-store`; seeded eligible articles appear in score order (a focus S1 article with difficulty 3 before one with difficulty 2 — fit 1.0 vs 0.8); ineligible ones (difficulty 0, quality 1, pending, a background-skill article with quality 3) are absent; each card's keys equal `Object.keys(articleCardSchema.shape)` (no user data leaks into cards).
4. Paging with 25 eligible articles with distinct `publishedAt`: `offset` omitted → 20 items and `nextOffset 20`; `offset=20` → 5 items and `nextOffset null`; the two pages share no id and together are ordered by published date desc; `offset=25` → `[]`, `nextOffset null`; exactly 20 articles → `nextOffset null` (the +1 probe).
5. `page_size` comes from config: mutate `ctx.moduleRef.get<Config>(APP_CONFIG, { strict: false }).page_size = 3` the way `articles.e2e.test.ts` does for its `limit` case, then 5 articles → 3 items, `nextOffset 3`.
6. Bad offsets → 400 with an error body: `offset=-1`, `offset=abc`, `offset=1.5`, `offset=` , `offset=10001`, `offset=1&offset=2`.
7. Isolation: user B (also onboarded, different focus) gets their own list; A's `read` event removes the article from A's feed only (insert the event with `addEvent`-style direct insert into `article_events`).
8. The privacy shape: the response body contains no key named `level`, `interest`, `points`, `score`, or `userId` anywhere (deep scan).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run apps/api/src/feed`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// feed.service.ts
@Injectable()
export class FeedService {
  constructor(
    @Inject(RANKER) private readonly ranker: Ranker,
    @Inject(APP_CONFIG) private readonly config: Config,
  ) {}

  async get(user: AuthUser, offset: number): Promise<FeedPage> {
    const size = this.config.page_size;
    const rows = await this.ranker.rank(user.id, { limit: size + 1, offset });
    return { items: rows.slice(0, size), nextOffset: rows.length > size ? offset + size : null };
  }
}
```

Controller: `@Controller('feed')`, `@Get() @UseGuards(SessionGuard)`, `@CurrentUser() user`, `@Query() raw`, `@Res({ passthrough: true }) res` (set `Cache-Control: no-store`), `const { offset } = parseWith(feedQuerySchema, raw)`, return `this.feed.get(user, offset)` (parse with `feedPageSchema` is not needed; the ranker's cards are already validated by tests). Module: `@Module({ imports: [AuthModule], controllers: [FeedController], providers: [FeedService, { provide: RANKER, inject: [DB, APP_CONFIG, SOURCES, TAXONOMY], useFactory: (db: Db, config: Config, sources: Source[], taxonomy: Taxonomy) => createSqlRanker(db, { config, sources, taxonomy }) }] })`. The Nest app has no role knowledge in `FeedService` (it passes only the user id).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): GET /feed backed by the SQL ranker"
```

---

### Task 7: API `POST /articles/:id/events`

**Files:**
- Create: `apps/api/src/events/events.service.ts`, `events.controller.ts`, `events.module.ts`, `events.e2e.test.ts`
- Modify: `apps/api/src/app.module.ts` (append-only: add `EventsModule`)

**Interfaces:**
- Consumes: `recordEvent`, `ArticleNotFoundError`, `RecordEventResult` (Task 5); `articleIdParamSchema`, `eventBodySchema`, `eventResponseSchema`, `EventResponse` (Task 1); Stage 3 `SessionGuard`, `CurrentUser`, `AuthUser`, `AuthModule`, `parseWith`, tokens `DB`, `APP_CONFIG`; `signIn`, `startTestApp`, `seedArticle`, `skillIds`; core `saveOnboarding`.
- Produces: `EventsService.record(user: AuthUser, articleId: number, kind: EventKind): Promise<EventResponse>`; route `POST /api/articles/:id/events` (guarded, `@HttpCode(200)`, `Cache-Control: no-store`). The route lives in its own controller (`@Controller('articles')`) in `EventsModule`; it does not touch `ArticlesController` (which stays public).

- [ ] **Step 1: Write the failing tests** (`events.e2e.test.ts`; same helpers as Task 6; user onboarded with `S1` level 2 certain, points 0; `post = (user, id, body) => fetch(base + '/api/articles/' + id + '/events', { method: 'POST', headers: { ...user.headers, 'content-type': 'application/json' }, body: JSON.stringify(body) })`; DB helpers read `user_skills` and `article_events` directly)
1. Guard: no cookie → 401 (and nothing written); garbage cookie → 401. A signed-in `GET /api/articles` stays public (no cookie → 200), i.e. the new controller did not guard the old one.
2. `read` happy path: 200, body parses with `eventResponseSchema` = `{ kind: 'read', recorded: true }`; DB: one event row, `points 1`. Repeat: 200 `{ kind: 'read', recorded: false }`, points still 1, one row.
3. Fifth distinct read (difficulty ≥ level) → `level 3, points 0`; a read of difficulty 1 article: 200 recorded true, points unchanged.
4. **Concurrency over HTTP:** 10 parallel identical `read` POSTs → exactly one body has `recorded: true`, nine `false`; points +1.
5. `too_easy` ×2 on two articles → offset 1 (DB); `too_hard` flips with counts as in Task 5 (one table check is enough).
6. `not_interested` → interest 0.8 (closeTo) on the article's primary skill; a second article → 0.64; the same article again → `recorded: false`.
7. `like` → 200 recorded true; `user_skills` unchanged (deep-equal rows before/after).
8. Not onboarded user: each kind returns 200 `recorded: true`; `article_events` has the row; `user_skills` stays empty.
9. 404 (body parses with `errorBodySchema`, `error: 'not_found'`, nothing written): id of an article that does not exist (`999999`), a `pending` article, a `failed` article.
10. 400 (nothing written): `:id` = `abc`, `0`, `-1`, `1.5`, `99999999999`; body `{}`, `{ kind: 'share' }`, `{ kind: 'read', extra: 1 }`, a non-JSON body, an empty body.
11. Isolation: user A's events never change user B's `user_skills`; both can record the same `(article, kind)` independently (`recorded: true` for each).
12. Response bodies contain only `kind` and `recorded` (no level/points/interest/offset values).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run apps/api/src/events`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// events.service.ts
@Injectable()
export class EventsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: Config,
  ) {}

  async record(user: AuthUser, articleId: number, kind: EventKind): Promise<EventResponse> {
    try {
      const r = await recordEvent(this.db, { userId: user.id, articleId, kind }, this.config);
      return { kind, recorded: r.recorded };
    } catch (e) {
      if (e instanceof ArticleNotFoundError) throw new NotFoundException('Article not found');
      throw e;
    }
  }
}
```

Controller: `@Controller('articles')`, `@Post(':id/events') @HttpCode(200) @UseGuards(SessionGuard)`, `@Param('id') id: string`, `@Body() body: unknown`, `@CurrentUser() user`; `parseWith(articleIdParamSchema, id)`, `parseWith(eventBodySchema, body)`, set `Cache-Control: no-store`. `this.config` already satisfies `FeedbackConfig` structurally (it is the full `Config`).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): POST /articles/:id/events with idempotent recording"
```

---

### Task 8: Web feedback card and API client

**Files:**
- Modify: `apps/web/src/lib/api.ts` (**re-read first**; append `getFeed`), `apps/web/src/lib/nav-items.ts` (insert the item first)
- Create: `apps/web/src/components/feed-card.tsx`

**Interfaces:**
- Consumes: Stage 3 `apiGet<T>(path, schema, { query?, cookie? })`, `readingMinutes`, tokens `bg-accent text-accent-fg bg-accent-soft border-line bg-card text-muted hover:text-fg`; Stage 4 `browserJson`, `BrowserApiError`; Task 1 `feedPageSchema`, `FeedPage`, `eventResponseSchema`, `EventKind`, `ArticleCard`.
- Produces:
  - `getFeed(offset = 0): Promise<FeedPage>` (server only; reads `(await cookies()).toString()` outside any try/catch, then `apiGet('/feed', feedPageSchema, { cookie, query: { offset } })`; throws `ApiError`).
  - `NAV_ITEMS` gains `{ href: '/for-you', label: 'For you', auth: 'user' }` placed **first**.
  - `FeedCard({ article, onRemoved }: { article: ArticleCard; onRemoved: (id: number) => void })` client component: title (link, `target="_blank" rel="noopener noreferrer"`), source, date, reading time, skills (primary `bg-accent text-accent-fg`, others `bg-accent-soft`, same markup as `ArticleCardView`), and a button row: **Read** (an `<a href={article.url} target="_blank" rel="noopener noreferrer">` styled as a button; `onClick` and `onAuxClick` (button 1) call `send('read')`, never `preventDefault`), **👍 Like**, **Too easy**, **Too hard**, **Not interested**. State: `sent: Set<EventKind>` (a button for a kind already sent is disabled and shows a pressed style, `aria-pressed`), `inflight: Set<EventKind>` (per-kind, so one slow request never blocks another kind), `error`. There is no global `busy`: a `read` click is never dropped because a like/too_easy request is in flight. `send(kind)`: `browserJson('POST', `/articles/${article.id}/events`, eventResponseSchema, { kind })`; on success add to `sent`, and for `read` and `not_interested` call `onRemoved(article.id)` (the card leaves the list); `like`, `too_easy`, `too_hard` keep the card. On `BrowserApiError` show the message in a `role="alert"` paragraph (401: "Your session expired, sign in again."); the card stays and the button is re-enabled (the `read` anchor still opens the tab; a failed read event shows the alert so the user can click again). All buttons have `type="button"` and an `aria-label` that names the action and the article title.

- [ ] **Step 1: Implement** (no web tests, spec §8). The `send` core:

```tsx
async function send(kind: EventKind) {
  if (sent.has(kind) || inflight.has(kind)) return;
  setInflight((s) => new Set(s).add(kind));
  setError(null);
  try {
    await browserJson('POST', `/articles/${article.id}/events`, eventResponseSchema, { kind });
    setSent((s) => new Set(s).add(kind));
    if (kind === 'read' || kind === 'not_interested') onRemoved(article.id);
  } catch (e) {
    setError(e instanceof BrowserApiError && e.status === 401 ? 'Your session expired, sign in again.' : e instanceof Error ? e.message : 'Something went wrong.');
  } finally {
    setInflight((s) => {
      const next = new Set(s);
      next.delete(kind);
      return next;
    });
  }
}
```

A button is disabled while its own kind is in flight or sent. For `read`, the anchor's `onClick={() => void send('read')}` runs while the browser opens the new tab, so the tab is never blocked by popup rules.

- [ ] **Step 2: Verify**

Run: `pnpm lint && pnpm typecheck && pnpm --filter @attn/web build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web
git commit -m "feat(web): feed API client, For you nav item and feedback card"
```

---

### Task 9: Web For you page with "load more"

**Files:**
- Create: `apps/web/src/components/feed-list.tsx`, `apps/web/src/app/for-you/page.tsx`

**Interfaces:**
- Consumes: Task 8 (`FeedCard`, `getFeed`); Stage 4 `requireProfile()` (no session → `/`, not onboarded → `/onboarding`), `browserJson`, `BrowserApiError`; Task 1 `feedPageSchema`, `FeedPage`, `mergeFeedItems`, `ArticleCard`.
- Produces:
  - `FeedList({ initial }: { initial: FeedPage })` client component. State: `items`, `hasMore = nextOffset !== null`, `duplicates` (cumulative), `loading`, `error`. Renders `FeedCard`s (`onRemoved` filters the id out of `items`), the empty state, and the "Load more" button. `loadMore()`: `offset = items.length + duplicates` (Decision 10), `browserJson('GET', `/feed?offset=${offset}`, feedPageSchema)`, then `mergeFeedItems(items, page.items)` → set `items`, add `duplicates`, `hasMore = page.nextOffset !== null`. Button disabled while `loading`; shown only when `hasMore`. Empty state when `items.length === 0 && !hasMore`: "Nothing to show right now. Check your focus skills on your profile, or come back after the next collection run." with a link to `/profile`; when `items.length === 0 && hasMore` the "Load more" button is shown alone. Errors in `role="alert"`.
  - `/for-you` (server): `await requireProfile()`, `const page = await getFeed(0)`, heading "For you", `<FeedList initial={page} />` with `key` unnecessary; `export const metadata = { title: 'For you | ATTN' }`; `export const dynamic = 'force-dynamic'`.

- [ ] **Step 1: Implement** per the contract above. `loadMore` core:

```tsx
async function loadMore() {
  setLoading(true);
  setError(null);
  try {
    const page = await browserJson('GET', `/feed?offset=${items.length + duplicates}`, feedPageSchema);
    const merged = mergeFeedItems(items, page.items);
    setItems(merged.items);
    setDuplicates((d) => d + merged.duplicates);
    setHasMore(page.nextOffset !== null);
  } catch (e) {
    setError(e instanceof Error ? e.message : 'Could not load more.');
  } finally {
    setLoading(false);
  }
}
```

- [ ] **Step 2: Verify**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @attn/web build`
Expected: PASS; the build output lists `/for-you` as a dynamic route.

- [ ] **Step 3: Commit**

```bash
git add apps/web
git commit -m "feat(web): For you page with load more"
```

---

### Task 10: Feed -> events -> profile loop (profile 👍 share and history verified on real data)

**Files:**
- Create: `apps/api/src/feed/loop.e2e.test.ts`
- Modify (only if a case fails because of a Stage 4 bug): `packages/core/src/levels/profile.ts` with a failing core test added first in `profile.test.ts`.

**Interfaces:**
- Consumes: Tasks 6-7 routes; Stage 4 `GET /api/profile` (`profileSchema`), `signIn`, `saveOnboarding`, `startTestApp`, `seedArticle`, `skillIds`; `applyReadPoint` semantics.
- Produces: the end-to-end proof that spec §5.2, §5.3, §6.1 and §6.3 work together through HTTP; no new production code expected.

- [ ] **Step 1: Write the tests** (`loop.e2e.test.ts`; one signed-in user onboarded with focus `[S1]`, `S1` level 2 certain, points 0; helpers `feed()`, `profile()`, `post(id, kind)`; `seed` as in Task 6)
1. **Read removes and records history:** 6 eligible articles (difficulty 2, distinct dates). `POST read` on the 3 newest in order → each disappears from `GET /feed` immediately; `GET /profile`: `history.total 3`, `history.items` ordered by read time newest first with `articleId`, `title`, `url`, `sourceName` (fallback `src`), ISO `readAt`; `S1` shows `points 3, pointsNeeded 5`.
2. **Level-up reshapes the feed:** 5 reads of difficulty-2 articles → profile `S1 level 3, points 0`; a remaining difficulty-2 article (below the new certain band 3..4) is gone from the feed while a difficulty-3 one is present.
3. **👍 share is real:** after 4 reads, `like` two of the read articles and one **unread** article → profile `likes = { read: 4, liked: 2, share: 0.5 }` (the like on the unread article is not counted); with zero reads `likes.share` is `null`; with reads and no likes it is `0`.
4. **not_interested:** removes the article from the feed, `GET /profile` is unchanged in level/points, and the DB `interest` of `S1` is 0.8; the S1 articles still rank (interest scales every S1 score equally, so the relative order of S1 articles is unchanged — assert the order before/after).
5. **too_hard lowers the band:** level 2, difficulty-1 article absent; two `too_hard` clicks on two articles → offset -1 (`t = 1`) and the difficulty-1 article now appears; two `too_easy` clicks on other articles bring the offset back to 0 and it disappears again.
6. **Double-click end to end:** 8 parallel `read` POSTs of one article → `history.total 1`, `points 1`, `likes.read 1`.
7. **Background skill:** an `S2` (background) article with quality 3 never shows; with quality 4 it shows after every focus article of higher score (`score` order) — assert order against a focus article with fit 0.8.
8. History pagination boundary: 25 reads → `history.total 25`, `history.items.length 20` (the Stage 4 limit).

- [ ] **Step 2: Run**

Run: `pnpm vitest run apps/api/src/feed/loop.e2e.test.ts`
Expected: PASS. If a case exposes a Stage 4 defect in `buildProfile` (history ordering, like counting), add a failing case to `packages/core/src/levels/profile.test.ts`, fix `profile.ts` minimally, and report it.

- [ ] **Step 3: Full suite**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api packages/core/src/levels
git commit -m "test(api): feed, events and profile end-to-end loop on real Postgres"
```

---

### Task 11: Demo seed (`attn seed-demo`) for local use without a Gemini key

**Files:**
- Create: `packages/core/src/demo/seed.ts`, `packages/core/src/demo/seed.test.ts`
- Modify: `packages/core/src/cli.ts` (add the command to `USAGE` and the `switch` in `run`; re-read first), `packages/core/src/cli.test.ts` (append cases), `packages/core/src/index.ts` (append `export * from './demo/seed';`)

**Interfaces:**
- Consumes: `Db`, `articles`, `articleSkills`, `loadTaxonomy`, `taxonomySkillIds` (`@attn/shared`), `loadSources`, `createDb`; the cli patterns `run(argv, env, io, deps)`, `Deps.now`.
- Produces:
  - `seedDemoArticles(db: Db, opts: { taxonomy: Taxonomy; sourceIds: string[]; now: Date; perSkill?: number }): Promise<{ inserted: number }>`: for every skill id of the taxonomy (in order) inserts `perSkill` (default 5) labeled articles with `label_model = 'demo-seed'`, `label_status 'labeled'`, `taxonomy_version` from the taxonomy, url `https://example.com/demo/<skillId>/<n>`, title `Demo: <skill name> #<n>`, source id cycling through `sourceIds`, `word_count` 400 + 150 × n, one primary skill (the skill) plus, except for `n = 1`, one secondary: the next skill in taxonomy order, **wrapping to the first skill for the last one**. Attributes follow fixed tables (no randomness): `difficulty = (n + skillIndex) % 5`, `quality = [4, 3, 2, 4, 3][n - 1]`, `type = ['tutorial', 'release', 'deep_dive', 'news', 'research'][n - 1]`, `published_at`: `release` and `news` at `now - (3 + skillIndex % 7)` days for odd skill index and `now - (30 + skillIndex)` days for even (so some are fresh and some stale), the rest at `now - (20 × n + skillIndex)` days. Inserts with `onConflictDoNothing` on `url` (idempotent), returns the number actually inserted.
  - `removeDemoArticles(db: Db): Promise<{ removed: number }>`: deletes articles with `label_model = 'demo-seed'` (cascade removes skills and events).
  - CLI: `attn seed-demo [--remove]`: prints `demo articles: inserted=<n>` or `demo articles: removed=<n>`; needs `DATABASE_URL` (exit 1 with the usual message otherwise); takes **no** pipeline lock; refuses nothing else. Added to `USAGE`.

- [ ] **Step 1: Write the failing tests**
`seed.test.ts` (real Postgres, `now = new Date('2026-10-14T12:00:00Z')`, real taxonomy and `['a','b']` source ids):
1. Inserts `32 × 5 = 160` articles; all `labeled`; each has exactly one primary skill; every taxonomy skill has 5 primaries; urls unique and start with `https://example.com/demo/`; `label_model` is `'demo-seed'`.
2. Idempotent: a second call inserts 0 and the table still has 160.
3. Spread: difficulties 0..4 all occur; qualities 2,3,4 all occur; all five types occur; at least one `release`/`news` is older than 14 days and at least one is within 14 days; every `quality >= 2`.
4. `removeDemoArticles` removes exactly the demo rows and leaves a non-demo article (inserted via fixtures) alone; returns the count.
5. **Ranker integration (the reason it exists):** onboard a user (`giveSkill` rows for all taxonomy skills, focus rank 1 on the first skill with level 2 certain) and `createSqlRanker(...).rank(user, { limit: 20, offset: 0 })` returns at least one card, only primary skill = a skill the user has a row for, and no card with `quality < 2`.
5a. The last taxonomy skill's articles with `n >= 2` carry the first skill as secondary (wrap-around), and no article has its own primary as secondary.
6. The module does not import from `label/`, `eval/`, `extract/` (the Task 12 scan covers it).
`cli.test.ts` additions (existing harness `run([...], env, io)`): `seed-demo` prints `demo articles: inserted=160`, running again prints `inserted=0`; `seed-demo --remove` prints `removed=160`; missing `DATABASE_URL` → exit 1 with `DATABASE_URL is not set`; `USAGE` text mentions `seed-demo`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/core/src/demo packages/core/src/cli.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** the two functions (batch insert articles with `.returning({ id, url })`, then the skills in one insert) and the CLI branch (`parseArgs` with `remove: { type: 'boolean' }`, `strict: true`).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): attn seed-demo for local demo data without a labeling key"
```

---

### Task 12: Privacy scan, README, final smoke and full verification (MVP done-criteria)

**Files:**
- Create: `packages/core/src/rank/privacy.test.ts`, `scripts/smoke.sh`
- Modify: `README.md` (append-only sections plus the Status paragraph, Layout and API list updates; keep every other line), `apps/api/src/auth/privacy.test.ts` (extend the file scan with `feed/` and `events/`)

**Interfaces:**
- Consumes: the whole stack from Tasks 1-11; Stage 4's `packages/core/src/levels/privacy.test.ts` (leave it as is; this task adds a complementary one).
- Produces: scan tests, README sections, `scripts/smoke.sh`, recorded smoke output.

- [ ] **Step 1: Write the failing test** `rank/privacy.test.ts` (reads source with `fs`, paths from `import.meta.dirname`; non-test `.ts` files only):
All scans read **non-test source files only** (skip `*.test.ts`, matching the existing `tsFiles()` helper in `apps/api/src/auth/privacy.test.ts`).
1. `packages/core/src/rank/*.ts`, `packages/core/src/demo/*.ts`, `packages/core/src/levels/events.ts`, `levels/feedback.ts` contain none of: `from '../label`, `from '../eval`, `from '../extract`, `Labeler`, `generateObject`, `@ai-sdk`.
2. Non-test files under `packages/core/src/label/`, `eval/`, `extract/` contain none of: `from '../rank`, `from '../levels`, `createSqlRanker`, `recordEvent`, `article_events`, `articleEvents`, `user_skills`, `userSkills`.
3. `packages/core/src/rank/*.ts` (including `fixtures.ts`) contain no role vocabulary (controller ruling 4). Check on the source **with comments stripped** (remove `//…` lines and `/* … */` blocks first): no `/\brole/i` match, no `'dev'`, no `roleSkillIds`. Test files are not scanned.
4. Non-test files under `apps/api/src/feed/` and `apps/api/src/events/` do not reference `Labeler`, `createGeminiLabeler`, `labelPending` or `LABELER`. Implement by adding `feed` and `events` to the directory list in the existing `apps/api/src/auth/privacy.test.ts` `files` array (its helper already skips tests).
5. `apps/web/src/components/feed-card.tsx` and `feed-list.tsx` do not match `/\b(level|interest|points)\b/` (case-sensitive; `\binterest\b` does not match `interested`, so "Not interested" and `not_interested` are fine).

- [ ] **Step 2: Run to verify it passes**

Run: `pnpm vitest run packages/core/src/rank/privacy.test.ts apps/api/src/auth/privacy.test.ts`
Expected: PASS. Prove the scan bites: temporarily add `import '../label';` to `rank/sql.ts` and confirm FAIL, then remove it.

- [ ] **Step 3: `scripts/smoke.sh`** (executable, `set -euo pipefail`; uses `node -e` for JSON, no `jq`). It must: require `DATABASE_URL`; run `pnpm attn migrate`; run `pnpm attn seed-demo`; create the smoke user and session with `psql` exactly as the Stage 4 task 12 smoke does (user `github_id 999001`, `sha256` of a random token, `attn_session` cookie); start the api (`SCHEDULE_ENABLED=false COOKIE_SECURE=false pnpm api` in the background, wait for `GET /api/health` 200, `trap` to kill it and delete the smoke user on exit); then through `http://localhost:3001/api` (the api, so no web needed): (a) `GET /feed` before onboarding → `items: []`; (b) `POST /onboarding` with focus `["context-engineering","cc-hooks"]` and `answers: []`; (c) `GET /feed` → `items.length === 20`, `nextOffset === 20`, all cards `quality >= 2`, the first card's primary skill is one of the two focus skills; (d) `GET /feed?offset=20` → items, none repeated from page 1; (e) `POST /articles/<first id>/events {"kind":"read"}` → `recorded: true`, repeat → `recorded: false`, and the article is gone from `GET /feed`; (f) `not_interested` on the next card removes it; (g) `like` the read article; (h) `GET /profile` → `history.total === 1` and `likes.share === 1`; (i) `GET /feed` without a cookie → 401. It prints one `ok: <check>` line per check (exactly nine, a-i) and exits non-zero on the first failure. The `trap` (on success and on failure) kills the api, deletes the smoke user and runs `pnpm attn seed-demo --remove`, unless `KEEP=1`.

- [ ] **Step 4: README** (append-only; update, do not rewrite):
- **Status:** "Stage 5 of 5: For you + feedback" and what is built; remove "ranking and the personal feed are planned".
- **Layout:** `packages/core` list adds `rank/, levels/`; add `scripts/smoke.sh`.
- **Commands table:** add `pnpm attn seed-demo [--remove]` ("insert deterministic labeled demo articles so For you works without a Gemini key; `--remove` deletes them").
- **API list:** add `GET /api/feed?offset=`, `POST /api/articles/:id/events` (with `{ kind }`, 200 `{ kind, recorded }`, repeated click is a no-op), and the Stage 4 routes if the list does not have them yet (`GET /api/quiz`, `POST /api/onboarding`, `PUT /api/focus`, `GET /api/profile`).
- **New section "How For you ranks"** summarizing spec §6.1 in plain language: `t`, the difficulty band and the uncertain widening, filters, score formula and constants with their `data/config.yml` keys (`quality_min`, `background_quality_min`, `fresh_days`, `background_priority`, `fit_next`, `fit_same`, `fit_stretch`, `page_size`), tie-breaks, and the notes that `t` is clamped to 4 at the top only (Decision 2) and that a quiz redo resets the difficulty offset for good (Decision 14).
- **New section "Feedback"**: what each button does (read / 👍 / too easy / too hard / not interested), the formulas with `points_per_level`, `offset_k`, `interest_decay`, `interest_min`, that clicks are idempotent, that feedback only changes skills that exist after onboarding, and that 👍 share on the Profile is the quality metric.
- **New section "Local demo without API keys"**: `docker compose up -d --wait` or any local Postgres, `pnpm attn migrate`, `pnpm attn seed-demo`, run api and web, sign in (needs GitHub OAuth credentials) or run `scripts/smoke.sh`, `pnpm attn seed-demo --remove` to clean.
- **New section "MVP done-criteria and hand-off"**: the spec §1 criterion verbatim in spirit ("MVP is done when the owner judges that ATTN covers their own use case; then `~/Projects/ai-news` is archived and its scheduled task disabled, not before"); a checklist of what is verifiably done in this repo (collect, label, eval, onboarding, For you, feedback, Profile, CI) and what remains the owner's: choose and set `LABEL_MODEL` from eval results, review the DRAFT golden set and DRAFT quiz bank, real GitHub OAuth app, run for a trial period, then **archive ai-news and disable its scheduled task (this repo does not do it)**.

- [ ] **Step 5: Full verification and smoke**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @attn/web build`
Expected: PASS, all four.

Run: `export DATABASE_URL=postgres://attn:attn@localhost:5432/attn && bash scripts/smoke.sh`
Expected: exactly nine `ok:` lines (checks a-i) and exit 0. Paste the output into the task report.

Then, in a browser with the `attn_session` cookie set to the smoke token (keep the smoke user: run the script with `KEEP=1` to skip the cleanup trap, support this env flag in the script): open `http://localhost:3000/for-you`, confirm cards render with the primary skill highlighted, "Read" opens a new tab and removes the card, "Not interested" removes it, "Too easy"/"Too hard"/"👍" keep the card and disable once pressed, "Load more" appends 20 cards without repeats, `/profile` shows history and the 👍 share. Record what was and was not checked (real GitHub sign-in cannot be exercised here).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/rank/privacy.test.ts apps/api/src/auth/privacy.test.ts scripts/smoke.sh README.md
git commit -m "test,docs: privacy scans for ranking and events, smoke script, README for MVP hand-off"
```

---

## Self-Review (done while writing)

- **Spec coverage:** §5.2 read/points -> Tasks 5, 7, 10 (via Stage 4 `applyReadPoint`); §5.3 offset/interest/like/read -> Tasks 2, 5, 7, 10; §6.1 filter and score, config constants, page size, load more -> Tasks 1, 3, 4, 6, 8, 9; §6.3 Profile real data -> Task 10 (verifying Stage 4 queries) and Task 9's link from For you; §6.6 `GET /feed`, `POST /articles/:id/events` -> Tasks 6, 7; §7 config -> Task 1; §8 tests (ranking on real PG, unit math, api e2e behind the guard, web typecheck only) -> Tasks 2-7, 10; §2 boundaries (Ranker in core, no roles, privacy) -> Tasks 3, 12; §1 done-criteria within our control (README, smoke, verification, ai-news hand-off note) -> Tasks 11-12. Controller rulings 1 -> Task 5 tests 16 and Task 7 test 8; 2 -> Task 12; 3 -> Task 5 tests 7-9, 13 and Decision 9; 4 -> Task 3 and 12 test 3; 5 -> Tasks 11-12; 6 -> Global Constraints.
- **Placeholder scan:** the only prose-defined bodies are web JSX layouts (exact contracts given, core handlers shown) and the README text (section list given); no TBD/TODO.
- **Type consistency:** `Ranker`/`RankParams`/`RankConfig`/`ScoredCard`/`createSqlRanker`/`rankScored` (Tasks 3-4) are used with those names in Tasks 6 and 11; `RANKER` token defined in Task 6 only; `recordEvent`/`RecordEventResult`/`ArticleNotFoundError`/`FeedbackConfig` (Task 5) used in Task 7; `computeDifficultyOffset`/`applyNotInterested` (Task 2) used in Task 5; `feedQuerySchema`/`feedPageSchema`/`articleIdParamSchema`/`eventBodySchema`/`eventResponseSchema`/`mergeFeedItems` (Task 1) used in Tasks 6-9; fixtures `makeUser`, `giveSkill`, `makeArticle`, `addEvent`, `rankConfig`, `RANK_NOW`, `rankSources` (Task 3) used in Tasks 4, 5, 11; the web offset rule `items.length + duplicates` (Decision 10, Task 9) is the one Task 4 paging test 4 exercises at the SQL level.
