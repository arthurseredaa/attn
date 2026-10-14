# ATTN Stage 4: Onboarding + Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in user picks and orders 1-5 focus skills, answers a situational quiz (first and second choice per question), and sees a Profile page with a level/progress/uncertain map of all role skills, editable focus, "take quiz" for unassessed skills and "redo onboarding". Quiz scoring and reading-points logic live in `core/levels` as pure functions.

**Architecture:** `packages/core/src/levels/` holds pure logic (scale, quiz scoring, option presentation without levels, points to level) and Postgres-backed functions (`saveOnboarding`, `setFocus`, `buildProfile`) that take a `Db`, so the api and any CLI share them. `apps/api` gets a thin `profile` module (`GET /profile`) and an `onboarding` module (`GET /quiz`, `POST /onboarding`, `PUT /focus`) behind Stage 3's `SessionGuard`. `apps/web` adds `/onboarding`, `/onboarding/quiz` and `/profile`; hidden quiz option levels exist only in `data/quiz/dev.yml` and the server.

**Tech Stack:** Node 24, pnpm workspaces, TypeScript 6.0.3 (pinned `^6.0.3`, do not upgrade), vitest 5, zod 4, NestJS 12.1.x, Drizzle + postgres.js, Next.js 16.4, React 19.3, Tailwind CSS 4.3, Postgres 17. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-14-attn-design.md` (binding). Stage 4 = spec §9 item 4, with §2, §3.1, §3.2, §5.1, §5.2, §6.3, §6.6, §8. Earlier plans for conventions: `docs/superpowers/plans/2026-10-14-stage-1-foundation-collect.md`, `...stage-2-label-eval.md`, `...stage-3-website-auth.md` (Stage 3 interfaces are treated as given and are named below where used).

## Global Constraints

Every task's requirements implicitly include this section. Values are copied from the spec or the environment.

- **Level scale (spec §3.1):** 0 never touched it; 1 basic use; 2 regular practice; 3 advanced, customizes it; 4 builds it / expert. Quiz option levels and article difficulty share it.
- **Quiz (spec §3.1):** `data/quiz/dev.yml`: questions with `id`, `skill_id`, `situation`, 4-6 `options`, each with a hidden `level` 0-4. Written together (Claude drafts, user reviews), public in the repo, versioned. Validated with `quizSchema` from `packages/shared`.
- **Scoring (spec §5.1):** per question the user picks a first option, then a second from the remaining ones. `level` = median of the levels of first choices over the skill's questions (**lower median** for an even count). `uncertain` = mean `|first - second|` >= `uncertain_spread` (1.5 in `data/config.yml`). Redoing the quiz replaces `level` and `uncertain`, overwrites `quiz_answers` for those skills and resets `difficulty_offset`. Onboarding creates a `user_skills` row for every skill of the role; a skill without a quiz result (`level` null) is treated as level 1 and `uncertain` everywhere.
- **Level growth (spec §5.2):** "read" gives +1 point to the article's primary skill when `difficulty >= level`; one point per article; at `points_per_level` (5) points: level +1, points reset to 0; level caps at 4.
- **Profile (spec §6.3):** map of all role skills by domain with level, progress to next level (e.g. 3/5) and an `uncertain` marker; focus highlighted, numbered and editable in place; "take quiz" for unassessed skills; "redo onboarding"; reading history; share of 👍.
- **API (spec §6.6):** prefix `/api`; `GET /taxonomy` (exists from Stage 3), `GET /quiz?skills=…`, `POST /onboarding { focus[], answers[] }`, `PUT /focus { focus[] }`, `GET /profile`. Errors are JSON `{ error, message }`. Request and response shapes are zod schemas in `packages/shared`.
- **Privacy invariant (spec §2):** `label/` receives only public article text. Quiz answers, levels, `user_skills` and user ids never reach `packages/core/src/label/`, `eval/`, `extract/` or the LLM; Task 12 adds a scan test.
- **Hidden levels never reach the browser:** no response, page prop or web bundle contains an option `level`. `GET /quiz` DTO is a strict schema without it; scoring is server-side only.
- **Focus rank uniqueness (Stage 1 note):** the partial unique index `user_skills_focus_rank_idx` on `(user_id, focus_rank) WHERE focus_rank IS NOT NULL` is **not deferrable**. Every focus write runs in one transaction that first sets all of the user's ranks to NULL, then sets the new ranks.
- **Testing (spec §8):** vitest. core unit tests for quiz scoring, points/levels and uncertainty; core Postgres tests for the store; api e2e for onboarding, focus, quiz and profile through the session guard (`startTestApp`). **Web: typecheck and lint only; do not add web tests.** No LLM calls in any test; never mock global `fetch`.
- **NestJS under vitest/tsx:** every constructor parameter of an injectable uses explicit `@Inject(TOKEN_OR_CLASS)`; tokens live in `apps/api/src/tokens.ts`; validate with zod through `parseWith` (`apps/api/src/common/zod.ts`), no `ValidationPipe`.
- **Environment:** native Postgres 17 on `localhost:5432` (tests use `attn_test`, `TEST_DATABASE_URL`); TypeScript pinned to 6.0.3; Next 16 with Tailwind 4 in `apps/web`. Real GitHub sign-in cannot be exercised here (no credentials).
- **Working style:** change only what the task asks; one commit per task with the attribution trailers the session requires; do not claim success without running the verify command and reading its output. `pnpm lint`, `pnpm typecheck` and `pnpm test` must be green after every task. Other agents may be editing neighbouring files: **re-read every Stage 3 file named below as it exists on the branch before editing it**.

## Decisions

Points the spec leaves open or that the environment forced (binding for this plan):

1. **Bank scope: all 32 skills, exactly 2 questions each (64 questions).** Reason: the engine works on any subset, but the profile offers "take quiz" for any skill at any time, so every skill needs a bank; 2 per skill keeps an onboarding of five focus skills at 10 questions while a lower median over 2 answers plus the spread over 2 pairs is still meaningful. A test requires >= 2 per skill (the engine accepts more later) and Task 3 requires full coverage of the role's skills. Written in two tasks (domains agentic-coding + agent-building, then the other four) so each review is readable. The file is a **DRAFT**: header comment requires owner review (the owner is unavailable).
2. **Onboarding order:** (1) role screen is skipped (one role, `dev`, set automatically); (2) pick focus (1-5) and order it by drag; (3) the quiz covers **focus skills only, in rank order** (<= 10 questions); background skills stay unassessed. They are assessed later from the Profile with "take quiz" (per skill, per domain, or all unassessed). The API itself accepts answers for any subset of skills, including none ("Skip quiz for now" sends `answers: []`).
3. **Onboarded = the user has at least one `user_skills` row.** `POST /onboarding` creates rows for every role skill atomically, so there is no half-onboarded state. Exposed as `profile.onboarded`; `GET /profile` for a not-onboarded user returns 200 with `onboarded: false`, all skills shown as unassessed, no focus (it never writes). `PUT /focus` for a not-onboarded user is 409 `conflict`. Stage 3's `GET /me` and `meSchema` are not touched. `focus` may legitimately be empty for an onboarded user (focus skills removed from the taxonomy later). **Constraint for Stage 5:** reading events must only UPDATE existing `user_skills` rows (points/level), never INSERT them; an insert would make a never-onboarded user look onboarded and skip onboarding. Stage 5 must skip point awards when `isOnboarded` is false.
4. **Redirect rule:** the OAuth callback now redirects to `${APP_URL}/profile` (Stage 3 redirected to `/all` and said Stage 4 would change it). Pages that need an onboarded user call `requireProfile()` (`apps/web/src/lib/guards.ts`): no session -> `/`, not onboarded -> `/onboarding`. Stage 5's For you page reuses it. `/all` and `/` stay public. No Next middleware (it would need an api call per request).
5. **Option ids are bank indexes.** `GET /quiz` returns `options: [{ id, text }]` where `id` is the option's index in `dev.yml`; the order is a **deterministic shuffle per question** (sort by sha256 of `questionId:index`), so authors cannot leak levels through YAML order and tests stay stable. Answers are `{ questionId, first, second }` with option ids.
6. **Answer validation (422 `unprocessable_entity`):** unknown question id; duplicate question; option id out of range; `second === first`; a skill answered **partially** (every bank question of an answered skill is required; a skill with no answers at all is simply not assessed); a skill outside the user's role; a focus id that is not a role skill, a duplicate focus id, or more than 5 / zero focus ids. Malformed JSON shapes are 400 (zod).
7. **Persisted state (redo resets `points` to 0: a deliberate extension of spec §5.1, which lists only level, uncertain, quiz_answers and difficulty_offset; the points belonged to the replaced level, so progress toward the next level restarts and the user loses partial progress on redo):** an unassessed skill row is `level = null, uncertain = true, points = 0`. Stage 5's SQL must use `coalesce(level, 1)` (spec: treated as level 1); `uncertain` is already true there. A quiz result row is `level = <lower median>, uncertain = <spread rule>, points = 0, difficulty_offset = 0`; `interest` is kept (it is a preference, not a calibration); `focus_rank` is set from the request's `focus`, every other skill's rank becomes null.
8. **Redo semantics:** `POST /onboarding` again is "redo onboarding": focus is replaced by the request's focus when the body has one (`focus` is optional; when absent the existing ranks are untouched, and a not-yet-onboarded user must send it, else 422 `Pick a focus first`), skills with answers are re-scored and their `quiz_answers` upserted (primary key `(user_id, question_id)`), skills **without** answers keep their level/points/offset untouched (so "take quiz" for one skill, or onboarding with a subset, never wipes the others). "Take quiz" for a skill sends **no** `focus` (a concurrent focus edit in another tab is never overwritten, and an empty focus is no problem).
9. **Points logic (pure):** unassessed (level null) reads accumulate points while `level` stays null; at `points_per_level` the level becomes `2` (1 + 1) and `uncertain` is left as it is (Stage 5 owns feedback calibration). At level 4 no points are awarded and `points` stays 0. A read of an article with `difficulty < effectiveLevel` awards nothing. The read **event** and its unique constraint are Stage 5.
10. **Focus write:** `setFocus` and `saveOnboarding` take `pg_advisory_xact_lock(FOCUS_LOCK_NAMESPACE, hashtext(userId))` first (two-int form; `FOCUS_LOCK_NAMESPACE = 727002` exported from `store.ts`, distinct from `PIPELINE_LOCK_KEY = 727001` in `db/lock.ts`, so a hash collision can never block a focus edit behind a pipeline run), so two concurrent focus edits of one user serialize instead of hitting the non-deferrable unique index. It also inserts any missing role-skill rows (a skill added to the taxonomy after onboarding).
11. **Profile shape** (`profileSchema`): `{ onboarded, role, focus[], domains[], history, likes }`. `history` = last 20 `article_events` with `kind = read` joined to `articles` (`{ items: [{ articleId, title, url, sourceName, readAt }], total }`); `likes` = `{ read, liked, share }` with `share = liked / read` over articles the user both read and liked, `null` when `read = 0`. Stage 4 implements these queries for real against `article_events`; with no events they return empty/zero, so **Stage 5 only has to write events**. Skills in the taxonomy without a row show as unassessed; rows whose skill left the taxonomy are ignored.
12. **`POST /onboarding` and `PUT /focus` return the fresh `Profile`** (the web refreshes from it; saves a round trip).
13. **Web drag ordering uses native HTML5 drag and drop plus move up/down buttons** (keyboard and touch fallback). No dependency is added.
14. **"Take quiz" is keyed off the absence of quiz answers, not off `level`.** `ProfileSkill.quizzed` = the user has at least one `quiz_answers` row for the skill (skill id = question id without its trailing `-<n>`; the bank validator guarantees that id pattern). A skill that gained a level only through reading (`level` 2, `assessed true`) still shows `Take quiz` and the `Uncertain` badge while `quizzed` is false.
15. **`GET /taxonomy` and `GET /sources` already exist (Stage 3 `MetaModule`, public); no task here touches them.** The web uses the existing `getTaxonomy()` in `apps/web/src/lib/api.ts`.
16. **Level labels** on the Profile come from `taxonomy.levels` (fetched with `getTaxonomy()`); the profile DTO carries numbers only.

## Review Focus

Inputs and conditions a happy-path suite would miss. Each has a test in the named task.

1. Quiz answers that are well-formed but wrong: `first === second`, option id out of range, duplicate or unknown question, a half-answered skill, a skill outside the role: always 422 and **no rows written** (Tasks 4, 8).
2. Focus edits that swap ranks (1<->2), shrink, grow to 5, or race each other: no unique-index violation, ranks always exactly `1..n` (Task 5).
3. Redo with fewer skills must not wipe other skills' levels; redo of a skill resets its points and `difficulty_offset` but keeps `interest` (Tasks 5, 8).
4. Profile for: a not-onboarded user (no writes, `onboarded: false`), a skill added to or removed from the taxonomy after onboarding, a level-4 skill (no next level), unassessed skill with points (Task 6, 7).
5. The quiz endpoint must never leak a level (deep key scan of the JSON, strict DTO schema), and level numbers in the web must come only from `GET /profile` (Tasks 4, 8).

## File Structure

```
data/quiz/dev.yml                                    DRAFT bank, 32 skills x 2 questions
packages/shared/src/quiz.ts                          (modify) quizBankIssues, quizCoverageIssues
packages/shared/src/onboarding.ts                    DTO schemas: quiz response/query, onboarding/focus bodies, profile
packages/shared/src/index.ts                         (modify) export onboarding
packages/core/src/data.ts                            (modify) loadQuiz
packages/core/src/levels/scale.ts                    effectiveLevel, effectiveUncertain, MAX_LEVEL
packages/core/src/levels/role.ts                     roleSkillIds, assertValidFocus, FocusError
packages/core/src/levels/quiz.ts                     lowerMedian, scoreSkill, scoreQuiz, QuizAnswerError
packages/core/src/levels/present.ts                  presentQuiz (levels stripped, deterministic shuffle)
packages/core/src/levels/points.ts                   applyReadPoint, progressToNext
packages/core/src/levels/store.ts                    isOnboarded, saveOnboarding, setFocus, NotOnboardedError
packages/core/src/levels/profile.ts                  buildProfile, likeShare
packages/core/src/levels/fixtures.ts                 fixtureQuiz (tests only; exported via testing.ts)
packages/core/src/levels/index.ts                    barrel; core index re-exports it
apps/api/src/tokens.ts                               (modify) QUIZ
apps/api/src/config/config.module.ts                 (modify) provide QUIZ
apps/api/src/test/app.ts                             (modify) startTestApp(overrides, extra?)
apps/api/src/test/auth.ts                            signIn helper
apps/api/src/profile/                                profile.service.ts, profile.controller.ts, profile.module.ts, profile.e2e.test.ts
apps/api/src/onboarding/                             onboarding.service.ts, onboarding.controller.ts, onboarding.module.ts, onboarding.e2e.test.ts
apps/web/src/lib/                                    api.ts (modify), browser-api.ts, guards.ts, reorder.ts, nav-items.ts (modify)
apps/web/src/components/onboarding/                  sortable-list.tsx, focus-picker.tsx, quiz-runner.tsx, onboarding-flow.tsx
apps/web/src/components/profile/                     skill-card.tsx, focus-editor.tsx
apps/web/src/app/onboarding/page.tsx, quiz/page.tsx  routes
apps/web/src/app/profile/page.tsx                    route
```

---

### Task 1: Shared DTOs, quiz bank validators, `loadQuiz`

**Files:**
- Create: `packages/shared/src/onboarding.ts`
- Modify: `packages/shared/src/quiz.ts`, `packages/shared/src/index.ts` (add `export * from './onboarding';`)
- Modify: `packages/core/src/data.ts`
- Test: `packages/shared/src/onboarding.test.ts`, `packages/core/src/quiz-data.test.ts`

**Interfaces:**
- Consumes: `levelSchema` (`enums.ts`), `quizSchema`/`Quiz` (`quiz.ts`), `Taxonomy` (`taxonomy.ts`), `taxonomySkillIds` (exported from `label.ts`, returns the flat skill id array), `loadTaxonomy`, `dataDir` (`data.ts`), `articleCardSchema`'s `z.url({ protocol: /^https?$/ })` pattern (Stage 3 `api.ts`).
- Produces (all exported from `@attn/shared` unless noted):
  - `quizBankIssues(quiz: Quiz, taxonomy: Taxonomy): string[]`; `quizCoverageIssues(quiz: Quiz, taxonomy: Taxonomy, role: string): string[]`.
  - `MAX_FOCUS = 5`; `quizOptionDtoSchema` = `{ id: number; text: string }`; `quizQuestionDtoSchema` = strict `{ id: string; skillId: string; situation: string; options: QuizOptionDto[] (4-6) }`; `quizResponseSchema` = strict `{ version: number; questions: QuizQuestionDto[]; unavailable: string[] }`; types `QuizOptionDto`, `QuizQuestionDto`, `QuizResponse`.
  - `quizQuerySchema` (input `{ skills: string }` comma separated -> output `{ skills: string[] }` trimmed, de-duplicated, 1..64); `quizAnswerSchema` = strict `{ questionId: string; first: number; second: number }` (non-negative ints); `focusSchema` (1..5 unique non-empty strings); `onboardingBodySchema` = strict `{ focus?: string[]; answers: QuizAnswerInput[] (max 200) }` (`focus` optional); `focusBodySchema` = strict `{ focus: string[] }`; types `QuizAnswerInput`, `OnboardingBody`, `FocusBody`.
  - `profileSkillSchema`, `profileDomainSchema`, `focusEntrySchema`, `historyItemSchema`, `profileSchema` and types `ProfileSkill`, `ProfileDomain`, `FocusEntry`, `HistoryItem`, `Profile` (shapes in Step 3).
  - `loadQuiz(role?: string, dir?: string): Quiz` in `@attn/core`: reads `quiz/<role>.yml` (default role `'dev'`), validates with `quizSchema` and `quizBankIssues(quiz, loadTaxonomy(dir))`, throws an `Error` naming the file and listing issues.

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/onboarding.test.ts` (build a tiny taxonomy and bank inline; helper `q(id, skill, levels, texts?)` makes `{ id, skill_id, situation: 's', options: levels.map((level, i) => ({ text: texts?.[i] ?? `${id} opt ${i}`, level })) }`; taxonomy with skills `a`, `b` using the pattern from `schemas.test.ts`):

1. `quizBankIssues` returns `[]` for questions `a-1` levels `[2,0,4,1]`, `a-2` levels `[3,1,0,4,2]`.
2. Flags a duplicate question id; an id not matching `<skill_id>-<n>` (e.g. `x1` for skill `a`); an unknown `skill_id`; a skill with only one question; duplicate option texts (case-insensitive) within a question; fewer than 3 distinct levels (`[1,1,2,2]`); a level span under 2 (`[1,2,1,2]` has span 1); a monotonic option order (`[0,1,2,3]` and `[4,3,2,1]` and `[0,0,2,4]`); an option text with a self-rating word (`"I am an expert"`, `"Beginner"`; the regex is `/\b(beginner|intermediate|expert|novice)\b/i`). Each issue string contains the question id.
3. `quizCoverageIssues(quiz, taxonomy, 'dev')` lists skill ids of the role that have no question; returns `[]` when all are covered; ignores skills whose `roles` lack the role.
4. `quizQuerySchema.parse({ skills: ' a, b ,a,,' })` -> `{ skills: ['a','b'] }`; `{ skills: '' }` and `{ skills: ',' }` throw; missing `skills` throws.
5. `onboardingBodySchema`: accepts `{ focus: ['a'], answers: [] }` and `{ answers: [] }` (no focus); rejects a missing `answers`, `focus: []`, six focus ids, duplicate focus ids, an answer with `first: -1`, `second: 1.5`, an extra key (`level: 3`) on an answer or on the body.
6. `quizResponseSchema` is strict: a question with an option carrying a `level` key fails to parse (this is the schema the privacy tests rely on); a valid response with `unavailable: []` parses.
7. `profileSchema` (skills carry `quizzed`) parses a minimal not-onboarded profile `{ onboarded: false, role: 'dev', focus: [], domains: [], history: { items: [], total: 0 }, likes: { read: 0, liked: 0, share: null } }`; rejects `focusRank: 6` on a skill; rejects a `history` item whose `url` is `javascript:alert(1)`.

`packages/core/src/quiz-data.test.ts` (temp dir pattern from `data.test.ts`: `fs.mkdtempSync(path.join(os.tmpdir(), 'attn-quiz-'))`, write `taxonomy.yml` with skills `a` and `b` and `quiz/dev.yml`):
1. `loadQuiz('dev', dir)` returns the parsed bank for a valid file.
2. Throws an error matching `/quiz\/dev\.yml/` and containing the issue text when a question references an unknown skill.
3. Throws naming the file when the YAML is malformed or `version` is missing.
4. Throws with `/ENOENT|no such file/i` when `quiz/<role>.yml` does not exist (`loadQuiz('nope', dir)`).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/shared/src/onboarding.test.ts packages/core/src/quiz-data.test.ts`
Expected: FAIL (exports missing).

- [ ] **Step 3: Implement**

Append to `packages/shared/src/quiz.ts`:

```ts
import type { Taxonomy } from './taxonomy';

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
```

(Note: `quizSchema` import of `levelSchema` stays; put the new `import type` at the top of the file.)

`packages/shared/src/onboarding.ts`:

```ts
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
```

`packages/core/src/data.ts`: add `quizSchema, quizBankIssues, type Quiz` to the `@attn/shared` import and

```ts
export function loadQuiz(role: string = 'dev', dir: string = dataDir()): Quiz {
  const quiz = loadYaml(`quiz/${role}.yml`, quizSchema, dir);
  const issues = quizBankIssues(quiz, loadTaxonomy(dir));
  if (issues.length > 0) throw new Error(`${path.join(dir, `quiz/${role}.yml`)}: ${issues.join('; ')}`);
  return quiz;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run packages/shared packages/core/src/quiz-data.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared packages/core/src/data.ts packages/core/src/quiz-data.test.ts
git commit -m "feat(shared,core): onboarding/profile DTOs, quiz bank validators, loadQuiz"
```

---

### Task 2: Quiz bank DRAFT, part 1 (agentic-coding and agent-building, 16 skills)

**Files:**
- Create: `data/quiz/dev.yml`
- Modify: `packages/core/src/quiz-data.test.ts` (add a "real bank" describe)
- Modify: `README.md` line `- \`data/quiz/\`: quiz question bank; planned, empty for now.` -> `- \`data/quiz/dev.yml\`: DRAFT question bank for role dev (32 skills x 2 situational questions with hidden option levels); needs owner review.`

**Interfaces:**
- Consumes: `loadQuiz`, `loadTaxonomy` (Task 1), `quizBankIssues`, `quizSchema` from `@attn/shared`; `data/taxonomy.yml` skill ids and descriptions (**read each skill's `description` before writing its questions**).
- Produces: `data/quiz/dev.yml` with `version: 1` and the first 32 questions, ids `<skill_id>-1` and `<skill_id>-2`, for these skills in taxonomy order: `context-engineering, cc-skills-commands, cc-hooks, cc-subagents, cc-plugins, cc-mcp-usage, cc-headless-ci, parallel-agents, spec-driven-workflow, agent-verification, tool-use-loop, agent-sdk, mcp-server-build, multi-agent-orchestration, human-in-the-loop, workflow-automation`. Task 3 appends the remaining 32 questions to the same file.

Authoring rules (each is enforced by `quizBankIssues` where it is checkable):
- The file starts with this header comment, verbatim:
  ```yaml
  # DRAFT quiz bank: drafted by Claude (2026-10-14), NOT reviewed by the project owner.
  # The owner must review every question and every option level before this bank is trusted:
  # check that the situation is realistic, that each option's hidden level (0-4, the shared level scale)
  # matches what the option shows about the person, and that wrong-sounding options are not obviously wrong.
  # Once reviewed, remove this header. Levels are hidden: they never leave the server.
  ```
- Per skill, 2 questions: question 1 = an everyday situation for that skill; question 2 = a different, harder or less common situation (so the pair is not a repeat). Each question: `situation` is 1-3 sentences describing a concrete moment ("Your CI run fails after the agent edited three files…"), then 4-6 options each describing **what the person would do or has done** (a first-person action, not a self-rating). Never use the words beginner, intermediate, expert, novice.
- Hidden `level` per option follows the scale applied to that skill: 0 = has not done or ignores it (a realistic "haven't needed that, I'd ask a teammate / skip it"); 1 = follows defaults or an example; 2 = regular practice; 3 = customizes it for their own needs; 4 = builds or designs it from scratch or could teach it. Each question uses at least 3 distinct levels spanning >= 2 (e.g. 0, 2, 3, 4), and a skill's two questions together should use a spread of levels.
- Option order is **scrambled**: not sorted by level ascending or descending (the validator rejects both). Keep option lengths and tone similar so length does not signal level; every option must sound like something a competent person might really do.
- Content must reflect the skill description in `taxonomy.yml` and its boundaries (for example `cc-plugins` is about packaging, not writing single skills; `multi-agent-orchestration` is not Claude Code subagents).

Worked example (exact format; write the rest in the same shape):

```yaml
version: 1
questions:
  - id: cc-hooks-1
    skill_id: cc-hooks
    situation: >-
      Your team keeps committing code that skips the formatter because the coding agent edits files
      directly. You want formatting to happen every time without relying on the agent remembering.
    options:
      - text: Add "always run the formatter" to the agent's instructions and hope it follows them.
        level: 1
      - text: Write a PostToolUse hook that runs the formatter on the edited file and blocks on failure, scoped to matching tools only.
        level: 3
      - text: Run the formatter by hand before committing.
        level: 0
      - text: Set up a PostToolUse hook from a documented example that formats after every edit.
        level: 2
      - text: Build a hook script that reads the tool payload, formats only changed hunks, reports through exit codes and JSON output, and has its own tests.
        level: 4
```

- [ ] **Step 1: Write the failing test**

Add to `packages/core/src/quiz-data.test.ts` a `describe('real quiz bank', ...)` using the real data dir (`loadQuiz()` with no arguments) with these cases:
1. `loadQuiz()` does not throw (schema + `quizBankIssues` clean).
2. Gated on the header: read `path.join(dataDir(), 'quiz/dev.yml')`; **if** the first line starts with `# DRAFT`, the first five lines equal the verbatim header above; if the owner removed the header after review the test passes without it (no test needs deleting).
3. Every question of the part-1 skill list above exists exactly twice (`<skill>-1`, `<skill>-2`), and questions appear in taxonomy order.
4. Every option `level` appears at least once in the part-1 bank for levels 0, 1, 2, 3 and 4 (a sanity check that the scale is used end to end).
5. No option text exceeds 280 characters and no `situation` exceeds 500 (keeps the UI readable).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/core/src/quiz-data.test.ts -t "real quiz bank"`
Expected: FAIL (file missing).

- [ ] **Step 3: Write `data/quiz/dev.yml`** (part 1, 32 questions) following the rules above.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run packages/core/src/quiz-data.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS. Then read the file once top to bottom and fix any option whose level you would argue with.

- [ ] **Step 5: Commit**

```bash
git add data/quiz/dev.yml packages/core/src/quiz-data.test.ts README.md
git commit -m "docs(data): DRAFT quiz bank part 1 (agentic coding, agent building)"
```

---

### Task 3: Quiz bank DRAFT, part 2 (remaining 16 skills) and full-coverage test

**Files:**
- Modify: `data/quiz/dev.yml` (append 32 questions)
- Modify: `packages/core/src/quiz-data.test.ts`

**Interfaces:**
- Consumes: Task 2's file and rules (same authoring rules, header, format; **read the skill descriptions in `data/taxonomy.yml` first**), `quizCoverageIssues` (Task 1).
- Produces: a complete bank: 64 questions, exactly 2 per skill. Part 2 skills, in taxonomy order: `ai-sdk, streaming-ui, generative-ui, structured-output, evals, llm-observability, prompt-injection, cost-caching, model-selection, embeddings, rag, team-adoption, shared-config-standards, ai-teaching, codebase-agents, ai-code-governance` (part 1 already covered the 16 skills of the first two domains, including `human-in-the-loop` and `workflow-automation`).

- [ ] **Step 1: Write the failing tests** (extend `real quiz bank`)
1. `quizCoverageIssues(loadQuiz(), loadTaxonomy(), 'dev')` is `[]` (all 32 skills covered).
2. `loadQuiz().questions` has length 64 and every taxonomy skill has exactly 2 questions `<id>-1`, `<id>-2`.
3. Replace the part-1-only case 3 with this full-bank order check (questions follow taxonomy order, each skill's `-1` before `-2`).
4. Per skill, the two questions are not identical in level pattern *and* text (guards copy-paste): `situation` differs and the option text sets are disjoint.
5. Level histogram over the whole bank: every level 0..4 is used by at least 5% of options (guards a bank that never uses level 4 or 0).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/core/src/quiz-data.test.ts`
Expected: FAIL (coverage issues for 16 skills).

- [ ] **Step 3: Append the part-2 questions to `data/quiz/dev.yml`** following the Task 2 rules (do not touch the header or part-1 entries).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS. Read the appended half once and fix levels you would argue with.

- [ ] **Step 5: Commit**

```bash
git add data/quiz/dev.yml packages/core/src/quiz-data.test.ts
git commit -m "docs(data): DRAFT quiz bank part 2, full coverage of 32 skills"
```

---

### Task 4: `core/levels` pure logic: scale, role, quiz scoring, presentation, points

**Files:**
- Create: `packages/core/src/levels/scale.ts`, `role.ts`, `quiz.ts`, `present.ts`, `points.ts`, `fixtures.ts`, `index.ts`
- Modify: `packages/core/src/index.ts` (add `export * from './levels';`), `packages/core/src/testing.ts` (add `export { fixtureQuiz } from './levels/fixtures';`)
- Test: `packages/core/src/levels/scale.test.ts`, `role.test.ts`, `quiz.test.ts`, `present.test.ts`, `points.test.ts`

**Interfaces:**
- Consumes: `Level`, `Quiz`, `Taxonomy`, `QuizQuestionDto`, `QuizResponse`, `MAX_FOCUS` from `@attn/shared`.
- Produces (all from `@attn/core`):
  - `scale.ts`: `UNASSESSED_LEVEL = 1`, `MAX_LEVEL = 4`, `effectiveLevel(level: number | null): Level` (null -> 1), `effectiveUncertain(level: number | null, uncertain: boolean): boolean` (null -> true).
  - `role.ts`: `roleSkillIds(taxonomy: Taxonomy, role: string): string[]` (taxonomy order, skills whose `roles` include the role); `class FocusError extends Error { code: 'empty' | 'too_many' | 'duplicate' | 'unknown_skill' }`; `assertValidFocus(focus: string[], roleSkills: string[]): void`.
  - `quiz.ts`: `interface QuizAnswer { questionId: string; first: number; second: number }`; `interface SkillQuizResult { skillId: string; level: Level; uncertain: boolean }`; `class QuizAnswerError extends Error { code: 'unknown_question' | 'duplicate_question' | 'option_out_of_range' | 'same_option' | 'incomplete_skill' }`; `lowerMedian(values: number[]): number` (throws `RangeError` on empty); `scoreSkill(pairs: { first: number; second: number }[], uncertainSpread: number): { level: Level; uncertain: boolean }` (**pairs are option LEVELS**, not ids); `scoreQuiz(bank: Quiz, answers: QuizAnswer[], uncertainSpread: number): SkillQuizResult[]` (sorted by `skillId`; validates as listed).
  - `present.ts`: `presentQuiz(bank: Quiz, skillIds: string[]): QuizResponse` (questions for the skills in the given order, each skill's questions in bank order; options `{ id: bankIndex, text }` in a deterministic shuffle; `unavailable` = requested skills with no question; no level anywhere).
  - `points.ts`: `interface SkillProgress { level: number | null; points: number }`; `applyReadPoint(state: SkillProgress, articleDifficulty: number, pointsPerLevel: number): SkillProgress & { awarded: boolean; leveledUp: boolean }`; `progressToNext(level: number | null, points: number, pointsPerLevel: number): { points: number; needed: number } | null` (null at level 4).
  - `fixtures.ts`: `fixtureQuiz: Quiz` = version 7 with questions (texts `"<id> option <i>"`, situation `"Situation <id>"`): `ce-1` / skill `context-engineering` levels `[2,0,4,1,3]`; `ce-2` / `context-engineering` `[3,1,0,4,2]`; `ch-1` / `cc-hooks` `[1,3,0,2]`; `ch-2` / `cc-hooks` `[2,0,3,4]`. (It is deliberately not run through `quizBankIssues`; ids do not follow the real pattern.) Option id = array index, so for `ce-1` option id 2 has level 4.

- [ ] **Step 1: Write the failing tests**

`scale.test.ts`: `effectiveLevel(null) === 1`, `effectiveLevel(0) === 0`, `effectiveLevel(4) === 4`; `effectiveUncertain(null, false) === true`, `(2, false) === false`, `(2, true) === true`.

`role.test.ts` (small inline taxonomy: domains with skills `a` roles `[dev]`, `b` roles `[dev, pm]`, `c` roles `[pm]`): `roleSkillIds(t,'dev')` is `['a','b']`; `'pm'` is `['b','c']`; unknown role `[]`. `assertValidFocus(['a','b'], ['a','b'])` passes; throws `FocusError` with `code` `empty` for `[]`, `too_many` for 6 ids, `duplicate` for `['a','a']`, `unknown_skill` for `['z']` (order of checks: empty, too_many, duplicate, unknown_skill).

`quiz.test.ts`:
1. `lowerMedian`: `[3]`->3; `[1,3]`->1 (lower of two); `[4,0,2]`->2; `[0,4,2,3]`->2; `[5,1,1,5]`->1; unsorted input is sorted internally; input array is not mutated; `[]` throws `RangeError`.
2. `scoreSkill` level: pairs first-levels `[2,3]` -> level 2; `[4,4]` -> 4; `[0,0]` -> 0; single pair `[3]` -> 3.
3. `scoreSkill` uncertainty, `uncertainSpread = 1.5`: pairs `(2,0),(3,0)` mean 2.5 -> true; `(4,3),(4,3)` mean 1 -> false; boundary `(3,0),(1,1)`... mean (3+0)/2 = 1.5 -> **true** (>=); just under: `(2,0),(1,1)` mean 1 -> false; reversed order counts (`(1,3),(1,3)` mean 2 -> true); identical levels for first and second (spread 0) -> false.
4. `scoreQuiz(fixtureQuiz, answers, 1.5)` with answers `ce-1: first 0 (level 2) second 1 (level 0)`, `ce-2: first 0 (level 3) second 2 (level 0)` -> `[{ skillId: 'context-engineering', level: 2, uncertain: true }]`. With `ce-1: first 2 (4) second 4 (3)`, `ce-2: first 3 (4) second 0 (3)` -> level 4, uncertain false. Both skills in one call return two results sorted by skillId (`cc-hooks` before `context-engineering`); `ch-1: first 1 (3) second 3 (2)`, `ch-2: first 2 (3) second 3 (4)` -> `cc-hooks` level 3, uncertain false.
5. `scoreQuiz` errors (each is a `QuizAnswerError` with the stated `code`, and nothing is returned): unknown question id -> `unknown_question`; the same question twice -> `duplicate_question`; `first: 9` or `second: 5` on a 5-option question -> `option_out_of_range`; `first === second` -> `same_option`; only `ce-1` answered -> `incomplete_skill`. `scoreQuiz(fixtureQuiz, [], 1.5)` returns `[]`.

`present.test.ts`:
1. `presentQuiz(fixtureQuiz, ['cc-hooks','context-engineering'])` returns questions in the order `ch-1, ch-2, ce-1, ce-2`, `version: 7`, `unavailable: []`.
2. Each question's option ids are a permutation of `0..n-1` and `text` equals the bank text of that index (so ids really are bank indexes).
3. Deterministic: two calls give identical output; **not** the bank order for at least one of the four questions (guards a no-op shuffle).
4. `quizResponseSchema.parse(result)` succeeds (strict schema) and `JSON.stringify(result)` contains no `"level"` substring.
5. `presentQuiz(fixtureQuiz, ['evals'])` -> `questions: []`, `unavailable: ['evals']`; mixed request keeps available questions and lists the unavailable ids; duplicate requested ids do not duplicate questions.

`points.test.ts` (`ppl = 5`):
1. Level 2, points 0, difficulty 2 -> points 1, awarded true, leveledUp false; difficulty 3 awards too; difficulty 1 -> unchanged, awarded false.
2. Level 2, points 4, difficulty 2 -> level 3, points 0, leveledUp true.
3. Level 3, points 4, difficulty 4 -> level 4, points 0; level 4, points 0, difficulty 4 -> unchanged, awarded false, points stays 0 (cap).
4. Level null behaves as 1: difficulty 0 -> no award; difficulty 1 -> points 1 and level **stays null**; at points 4 -> level 2, points 0, leveledUp true.
5. `ppl = 1`: every qualifying read levels up; level 0, difficulty 0 awards (0 >= 0).
6. Pure: the input object is not mutated; a stored `points >= ppl` (config lowered later) levels up on the next qualifying read.
7. `progressToNext(2, 3, 5)` -> `{ points: 3, needed: 5 }`; `(null, 0, 5)` -> `{ points: 0, needed: 5 }`; `(4, 0, 5)` -> `null`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/core/src/levels`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

`quiz.ts` core algorithm (write the rest around it):

```ts
export function lowerMedian(values: number[]): number {
  if (values.length === 0) throw new RangeError('lowerMedian of an empty list');
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] as number;
}

export function scoreSkill(
  pairs: { first: number; second: number }[],
  uncertainSpread: number,
): { level: Level; uncertain: boolean } {
  const level = lowerMedian(pairs.map((p) => p.first)) as Level;
  const spread = pairs.reduce((sum, p) => sum + Math.abs(p.first - p.second), 0) / pairs.length;
  return { level, uncertain: spread >= uncertainSpread };
}
```

`scoreQuiz`: index the bank by question id; walk the answers (throw `unknown_question`, `duplicate_question`, `option_out_of_range` for `first`/`second` not in `0..options.length-1`, `same_option`); group by `skill_id` mapping option ids to levels; for each answered skill require that the set of answered question ids equals all bank question ids of that skill (`incomplete_skill`); call `scoreSkill`; sort by `skillId`.

`present.ts` shuffle key: `createHash('sha256').update(`${q.id}:${i}`).digest('hex')`, sort ascending. Questions: iterate the de-duplicated requested skill ids; for each, the bank questions of that skill in bank order.

`points.ts`:

```ts
export function applyReadPoint(state: SkillProgress, articleDifficulty: number, pointsPerLevel: number) {
  const eff = effectiveLevel(state.level);
  if (eff >= MAX_LEVEL || articleDifficulty < eff) {
    return { ...state, awarded: false, leveledUp: false };
  }
  const points = state.points + 1;
  if (points >= pointsPerLevel) {
    return { level: eff + 1, points: 0, awarded: true, leveledUp: true };
  }
  return { level: state.level, points, awarded: true, leveledUp: false };
}
```

`index.ts` re-exports `scale`, `role`, `quiz`, `present`, `points` (store and profile are added by Tasks 5 and 6).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run packages/core/src/levels && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): levels module with quiz scoring, option presentation and reading points"
```

---

### Task 5: `core/levels` store: `saveOnboarding`, `setFocus`, `isOnboarded`

**Files:**
- Create: `packages/core/src/levels/store.ts`, `packages/core/src/levels/store.test.ts`
- Modify: `packages/core/src/levels/index.ts` (add `export * from './store';`)

**Interfaces:**
- Consumes: `userSkills`, `quizAnswers`, `users`, `Db` (`packages/core/src/db/schema.ts`, `client.ts`); `SkillQuizResult`, `QuizAnswer`, `assertValidFocus`, `FocusError` (Task 4); `testDb`, `resetDb`, `fixtureQuiz` from `src/testing.ts`/`test/db.ts`; a user row inserted directly with `db.insert(users).values({ githubId: n, login: 'u' })` (core tests cannot import api helpers).
- Produces:
  - `class NotOnboardedError extends Error`.
  - `isOnboarded(db: Db, userId: string): Promise<boolean>`.
  - `FOCUS_LOCK_NAMESPACE = 727002`; `interface OnboardingInput { userId: string; roleSkillIds: string[]; focus?: string[]; results: SkillQuizResult[]; answers: QuizAnswer[]; quizVersion: number }`.
  - `saveOnboarding(db: Db, input: OnboardingInput): Promise<void>`: one transaction: advisory lock, insert missing rows for all `roleSkillIds` (`level null, uncertain true`), set focus **only when `focus` is given** (null all ranks, then ranks `1..n`; when undefined every `focus_rank` is left untouched), for each result update `level, uncertain, points = 0, difficulty_offset = 0`, upsert the answers into `quiz_answers` (`quizVersion`, `answeredAt = now()`). Validates a given focus with `assertValidFocus(focus, roleSkillIds)` first (throws `FocusError`, nothing written). Results whose skill is not in `roleSkillIds` throw `Error`.
  - `setFocus(db: Db, userId: string, focus: string[], roleSkillIds: string[]): Promise<void>`: validates with `assertValidFocus`; transaction: advisory lock; `NotOnboardedError` if the user has no rows; insert missing rows; null all ranks; set new ranks.

- [ ] **Step 1: Write the failing tests** (`store.test.ts`; `beforeEach(() => resetDb(db))`; `roles = ['s1','s2','s3','s4','s5','s6']`; results from literal values, answers built from `fixtureQuiz` ids)

1. `isOnboarded` false for a new user; true after `saveOnboarding`.
2. `saveOnboarding` with `focus: ['s3','s1']`, no results, no answers: six rows exist for the user; `s3` has `focus_rank 1`, `s1` has `2`, the rest null; every row has `level null`, `uncertain true`, `points 0`, `interest 1`, `difficulty_offset 0`; `quiz_answers` empty.
3. With results `[{ skillId: 's1', level: 2, uncertain: false }]` and two answers: `s1` row has `level 2, uncertain false`; the other rows remain unassessed; `quiz_answers` has the answers with `quiz_version 7` and the right option numbers.
4. **Redo resets calibration, keeps the rest**: after step 3, update `s1` to `points 3, difficulty_offset 1, interest 0.6` directly, plus `s2` to `level 4, points 2, difficulty_offset -1`; call `saveOnboarding` again with `focus: ['s2']`, results `[{ skillId: 's1', level: 3, uncertain: true }]` and new answers for the same question ids with different options. Expect: `s1` -> `level 3, uncertain true, points 0, difficulty_offset 0, interest 0.6`; **`s2` untouched** (`level 4, points 2, difficulty_offset -1`) except its new `focus_rank 1`; `s1.focus_rank` null; `quiz_answers` has one row per question id (overwritten, not duplicated) with the new options.
5. Focus validation: `focus: []`, a duplicate id, 6 ids and an unknown id each reject with `FocusError` and leave **zero rows** (nothing created, transaction not even started for the user).
6. A result for a skill outside `roleSkillIds` rejects and leaves zero rows (transaction rolled back, including the inserted skill rows).
7. Failure mid-transaction rolls back everything: pass an answer with a `questionId` longer than... use a deliberate failure instead: call `saveOnboarding` with `answers` containing the same `questionId` twice (the upsert in one statement raises "ON CONFLICT DO UPDATE command cannot affect row a second time"); expect rejection and no `user_skills` rows for the user.
8. `setFocus` on a not-onboarded user rejects with `NotOnboardedError` and writes nothing.
9. `setFocus` swaps ranks: start with focus `['s1','s2']`, `setFocus(db,u,['s2','s1'],roles)` -> `s2` rank 1, `s1` rank 2 (no unique violation).
10. `setFocus` shrinks (`['s1']` -> others null), grows to five, and rejects a sixth/unknown/duplicate with `FocusError` leaving the previous focus intact.
11. `setFocus` inserts a missing role-skill row: delete the `s6` row, add `s6` to focus -> row recreated with rank set, `level null`.
12a. `saveOnboarding` with `focus` undefined on an onboarded user (focus `['s1','s2']`) and a result for `s3`: `s3` is scored, the ranks of `s1`,`s2` are unchanged.
12. **Concurrency:** start from focus `['s1','s2','s3']`; run `Promise.all` of 20 `setFocus` calls alternating `['s3','s2','s1']` and `['s1','s4']`; all resolve; final ranks are exactly one of the two valid shapes (either s3=1,s2=2,s1=3 or s1=1,s4=2), never mixed, and the count of non-null ranks equals the focus length.
13. Other users' rows are never touched (two users, change one's focus, the other's rows are equal before and after).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/core/src/levels/store.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Core of `store.ts` (add imports for `and, eq, inArray, isNotNull, sql` from `drizzle-orm`):

```ts
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export const FOCUS_LOCK_NAMESPACE = 727002; // PIPELINE_LOCK_KEY is 727001 (db/lock.ts); the two-int form keeps keyspaces apart

async function lockUser(tx: Tx, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${FOCUS_LOCK_NAMESPACE}, hashtext(${userId}))`);
}

async function ensureRows(tx: Tx, userId: string, roleSkillIds: string[]): Promise<void> {
  if (roleSkillIds.length === 0) return;
  await tx
    .insert(userSkills)
    .values(roleSkillIds.map((skillId) => ({ userId, skillId, level: null, uncertain: true })))
    .onConflictDoNothing();
}

/** The unique index on (user_id, focus_rank) is not deferrable: null every rank first, then set the new ones. */
async function writeFocus(tx: Tx, userId: string, focus: string[]): Promise<void> {
  await tx
    .update(userSkills)
    .set({ focusRank: null })
    .where(and(eq(userSkills.userId, userId), isNotNull(userSkills.focusRank)));
  for (const [i, skillId] of focus.entries()) {
    await tx
      .update(userSkills)
      .set({ focusRank: i + 1 })
      .where(and(eq(userSkills.userId, userId), eq(userSkills.skillId, skillId)));
  }
}
```

`saveOnboarding` calls `assertValidFocus` (only when `focus` is given) and the role check **before** opening the transaction, then `db.transaction(async (tx) => { lockUser; ensureRows; `if (focus) await writeFocus(...)`; for results update; upsert answers via insert(...).onConflictDoUpdate({ target: [quizAnswers.userId, quizAnswers.questionId], set: { firstOption: sql\`excluded.first_option\`, secondOption: sql\`excluded.second_option\`, quizVersion: sql\`excluded.quiz_version\`, answeredAt: sql\`now()\` } }) })`. `setFocus`: `assertValidFocus` first, then a transaction: lock, count rows (`NotOnboardedError` when 0), `ensureRows`, `writeFocus`. `isOnboarded`: `select 1 from user_skills where user_id = $1 limit 1`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run packages/core/src/levels && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/levels
git commit -m "feat(core): onboarding store with null-then-set focus ranks under an advisory lock"
```

---

### Task 6: `core/levels` profile builder

**Files:**
- Create: `packages/core/src/levels/profile.ts`, `packages/core/src/levels/profile.test.ts`
- Modify: `packages/core/src/levels/index.ts` (add `export * from './profile';`)

**Interfaces:**
- Consumes: `Profile`, `ProfileSkill`, `Taxonomy`, `Source` from `@attn/shared`; `userSkills`, `articleEvents`, `articles`, `Db`; `effectiveLevel`, `effectiveUncertain`, `progressToNext`, `roleSkillIds` (Task 4); fixtures: users via direct insert, articles via direct insert into `articles` (columns: `sourceId, url, guid, title, titleHash, publishedAt`), events via `db.insert(articleEvents)`, and `saveOnboarding` (Task 5).
- Produces:
  - `HISTORY_LIMIT = 20`.
  - `interface ProfileContext { role: string; taxonomy: Taxonomy; sources: Source[]; pointsPerLevel: number }`.
  - `likeShare(read: number, liked: number): number | null` (null when `read === 0`; else `liked / read`).
  - `buildProfile(db: Db, userId: string, ctx: ProfileContext): Promise<Profile>`; result validates against `profileSchema`. Read-only (never writes).

- [ ] **Step 1: Write the failing tests**

Use a taxonomy with two domains (`d1`: skills `s1`,`s2`; `d2`: `s3` roles `[dev]`, `x` roles `[pm]`) and sources `[{ id: 'src', name: 'Source One', ... }]` (use the minimal valid source shape from `schemas.test.ts` in shared).
1. `likeShare(0, 0) === null`, `(0, 3) === null`, `(4, 1) === 0.25`, `(2, 2) === 1`.
2. **Not onboarded:** `buildProfile` for a user with no rows returns `onboarded: false`, `focus: []`, domains containing only role skills (`x` excluded, taxonomy order, domain with no role skill omitted), every skill `level null, effectiveLevel 1, assessed false, quizzed false, uncertain true, points 0, pointsNeeded 5, focusRank null`; `history = { items: [], total: 0 }`; `likes = { read: 0, liked: 0, share: null }`; `user_skills` table still has zero rows afterwards.
3. **Onboarded:** after `saveOnboarding(focus ['s2','s1'], results [{s1, level 3, uncertain true}])`: `focus` is `[{ rank: 1, skillId: 's2', name }, { rank: 2, skillId: 's1', name }]`; `s1` is `level 3, effectiveLevel 3, assessed true, uncertain true, pointsNeeded 5`; `s2` unassessed; `s3` has `focusRank null`.
4. Progress fields: set `s1` to `level 2, points 3` -> `points 3, pointsNeeded 5`; `level 4` -> `pointsNeeded null`; unassessed with `points 2` -> `assessed false, points 2, pointsNeeded 5, effectiveLevel 1`; `pointsPerLevel` from the context is used (`3` -> `pointsNeeded 3`).
4a. **quizzed:** after `saveOnboarding` with answers for question ids `s1-1`, `s1-2` (and a result for `s1`) `s1.quizzed` is true and `s2.quizzed` false; a skill set directly to `level 2` with no quiz answers is `assessed true, quizzed false`; question id `s1-10` maps to skill `s1`; a question id without a `-<n>` suffix is ignored.
5. A role skill present in the taxonomy but with no row (insert the rows, delete `s3`'s) appears unassessed; a row for a skill id that is not in the taxonomy (`ghost`) is ignored and does not break anything; a focus rank on a skill that left the taxonomy is not listed in `focus`.
6. **History and likes:** insert 3 articles (published dates differ) and events: user read A (t1), read B (t3), read C (t2); liked B and an unread article D; another user read A. Expect `history.total 3`, `items` ordered by read time newest first (B, C, A) with `articleId, title, url, sourceName 'Source One', readAt` ISO; unknown `sourceId` falls back to `sourceName = sourceId`; `likes = { read: 3, liked: 1, share: 1/3 }` (the like on unread D is not counted).
7. With 25 reads, `items.length === 20` and `total === 25`.
8. `profileSchema.parse(result)` succeeds for cases 2, 3 and 6.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/core/src/levels/profile.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Outline: `roleIds = roleSkillIds(ctx.taxonomy, ctx.role)`; select the user's `user_skills` rows into a `Map` by `skillId`; domains = `taxonomy.domains` mapped to `{ id, name, skills }` keeping only skills in `roleIds` and dropping domains with none; each skill builds from `row` (or defaults): `level = row?.level ?? null`, `effectiveLevel = effectiveLevel(level)`, `assessed = level !== null`, `uncertain = effectiveUncertain(level, row?.uncertain ?? true)`, `points = row?.points ?? 0`, `pointsNeeded = progressToNext(level, points, ctx.pointsPerLevel)?.needed ?? null`, `focusRank = row?.focusRank ?? null`, `quizzed` = the skill id is in the set of `question_id.replace(/-\d+$/, '')` over the user's `quiz_answers`. `focus` = rows with a rank whose skill is in `roleIds`, sorted by rank, name from the taxonomy. `onboarded = rows.length > 0`. History: events `kind = 'read'` joined to `articles`, `order by article_events.created_at desc, article_events.id desc limit 20`, plus `count(*)`; source name from `ctx.sources`. Likes: `read` = count of read events; `liked` = count of `like` events whose `article_id` is also in this user's read events (`exists` subquery); `share = likeShare(read, liked)`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run packages/core && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/levels
git commit -m "feat(core): buildProfile with skill map, focus, reading history and like share"
```

---

### Task 7: API `GET /profile`, QUIZ provider, sign-in test helper, post-login redirect

**Files:**
- Modify: `apps/api/src/tokens.ts` (add `export const QUIZ = Symbol('QUIZ');`)
- Modify: `apps/api/src/config/config.module.ts` (provide and export `QUIZ` with `useFactory: () => loadQuiz()`; import `loadQuiz` from `@attn/core`)
- Modify: `apps/api/src/test/app.ts` (**re-read first**; add the optional second parameter)
- Create: `apps/api/src/test/auth.ts`
- Create: `apps/api/src/profile/profile.service.ts`, `profile.controller.ts`, `profile.module.ts`, `profile.e2e.test.ts`
- Modify: `apps/api/src/app.module.ts` (**append-only**: re-read it, add `ProfileModule`, keep every existing import such as `ArticlesModule`, `MetaModule`, `AuthModule`)
- Modify: `apps/api/src/auth/auth.controller.ts` and its OAuth e2e test (`apps/api/src/auth/*.e2e.test.ts`): success redirect `${appUrl}/all` -> `${appUrl}/profile`. Find with `grep -rn "/all" apps/api/src/auth`.

**Interfaces:**
- Consumes (Stage 3, given): `SessionGuard`, `CurrentUser`, `AuthUser` (`apps/api/src/auth/session.ts`: `Me` = `{ id, login, name, avatarUrl, role }`), `AuthModule` (exports `SessionService`, `SessionGuard`), `SessionService.create(userId): Promise<{ token: string; expiresAt: Date }>`, `SESSION_COOKIE`, `startTestApp`, `TestApp` (`{ app, moduleRef, base, db, close() }`), `seedUser(db, over?)`, `seedArticle`, `skillIds(n)`, tokens `DB`, `TAXONOMY`, `SOURCES`, `APP_CONFIG`; Task 6 `buildProfile`; Task 1 `profileSchema`.
- Produces:
  - `QUIZ` token; `startTestApp(overrides?: Partial<Env>, extra?: { quiz?: Quiz; taxonomy?: Taxonomy }): Promise<TestApp>` (today's signature is `startTestApp(overrides = {})`; when set, `.overrideProvider(QUIZ).useValue(extra.quiz)` / `.overrideProvider(TAXONOMY).useValue(extra.taxonomy)` before `.compile()`).
  - Boot dependency: `QUIZ` is loaded at api boot, so an invalid bank stops the api and every e2e test; Tasks 2 and 3 must be done before this task, and Docker images must keep `data/quiz` (Stage 3's `COPY . .` does).
  - `signIn(ctx: TestApp, over?: Partial<typeof users.$inferInsert>): Promise<{ user: typeof users.$inferSelect; token: string; headers: { cookie: string } }>` in `apps/api/src/test/auth.ts` (seeds a user via `seedUser`, creates a session via `ctx.moduleRef.get(SessionService, { strict: false }).create`, returns `headers.cookie = \`${SESSION_COOKIE}=${token}\``).
  - `ProfileService.get(user: AuthUser): Promise<Profile>` (exported by `ProfileModule`); `GET /api/profile` (guarded, `Cache-Control: no-store`).

- [ ] **Step 1: Write the failing tests** `profile.e2e.test.ts` (`startTestApp()`, `beforeEach(() => resetDb(db))`, `afterEach(close)`; `fetch(base + '/api/profile', { headers })`)

1. Without a cookie: 401 and body parses with `errorBodySchema` (`error: 'unauthorized'`).
2. Garbage cookie `attn_session=nope`: 401.
3. Signed in, never onboarded: 200, body parses with `profileSchema`, `onboarded false`, `role 'dev'`, `focus []`, total skills across domains equals the number of dev skills in `loadTaxonomy()` (32), all `assessed false, quizzed false`; `Cache-Control: no-store`; **`user_skills` is still empty** (GET never writes).
4. Onboarded user (insert rows through core `saveOnboarding` with `roleSkillIds(loadTaxonomy(),'dev')`, focus `[skillIds(3)[2], skillIds(3)[0]]`, result `{ skillId: skillIds(3)[0], level: 3, uncertain: true }`): the profile shows `onboarded true`, focus ranks 1 and 2 in order with names from the taxonomy, the assessed skill `level 3, uncertain true, pointsNeeded 5`, the rest unassessed.
5. History and likes are real queries: seed one article (`seedArticle`), insert a `read` and a `like` event for the user -> `history.total 1`, item `articleId` equals the seeded id, `sourceName` falls back to the id `'src'`, `likes = { read: 1, liked: 1, share: 1 }`. A second user's events do not appear.
6. One user's profile never shows another user's levels (two signed-in users, different onboarding results).
7. The post-login redirect test (updated Stage 3 case) expects `Location` `http://localhost:3000/profile` and the `https://attn.example/profile` variant.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run apps/api/src/profile`
Expected: FAIL.

- [ ] **Step 3: Implement**

`profile.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { buildProfile, type Db } from '@attn/core';
import type { Config, Profile, Source, Taxonomy } from '@attn/shared';
import type { AuthUser } from '../auth/session';
import { APP_CONFIG, DB, SOURCES, TAXONOMY } from '../tokens';

@Injectable()
export class ProfileService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TAXONOMY) private readonly taxonomy: Taxonomy,
    @Inject(SOURCES) private readonly sources: Source[],
    @Inject(APP_CONFIG) private readonly config: Config,
  ) {}

  get(user: AuthUser): Promise<Profile> {
    return buildProfile(this.db, user.id, {
      role: user.role,
      taxonomy: this.taxonomy,
      sources: this.sources,
      pointsPerLevel: this.config.points_per_level,
    });
  }
}
```

`profile.controller.ts`: `@Controller('profile')`, `@Get() @UseGuards(SessionGuard)`, parameters `@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response` (type from `express`), set `Cache-Control: no-store`, return `this.profiles.get(user)` (constructor `@Inject(ProfileService)`). `profile.module.ts`: `@Module({ imports: [AuthModule], controllers: [ProfileController], providers: [ProfileService], exports: [ProfileService] })`. Add to `AppModule`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS (the whole suite, including the updated OAuth redirect test).

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): GET /profile, QUIZ provider, signIn test helper, post-login redirect to /profile"
```

---

### Task 8: API `GET /quiz`, `POST /onboarding`, `PUT /focus`

**Files:**
- Create: `apps/api/src/onboarding/onboarding.service.ts`, `onboarding.controller.ts`, `onboarding.module.ts`, `onboarding.e2e.test.ts`
- Modify: `apps/api/src/app.module.ts` (**append-only**: re-read it, add `OnboardingModule`, keep every existing import)

**Interfaces:**
- Consumes: Task 7 (`QUIZ`, `ProfileService`, `startTestApp(overrides, { quiz })`, `signIn`); Stage 3 (`SessionGuard`, `CurrentUser`, `AuthUser`, `parseWith`, `DB`, `TAXONOMY`, `APP_CONFIG` tokens); core `presentQuiz`, `scoreQuiz`, `saveOnboarding`, `setFocus`, `roleSkillIds`, `assertValidFocus`, `FocusError`, `QuizAnswerError`, `NotOnboardedError`, `isOnboarded` (Tasks 4-5); shared `quizQuerySchema`, `onboardingBodySchema`, `focusBodySchema`, `quizResponseSchema`, `profileSchema`; `fixtureQuiz` from `@attn/core/testing`.
- Produces:
  - `OnboardingService` with `quiz(user: AuthUser, skills: string[]): QuizResponse`, `submit(user: AuthUser, body: OnboardingBody): Promise<Profile>` (`body.focus` optional; absent and not onboarded -> 422 `Pick a focus first`), `changeFocus(user: AuthUser, body: FocusBody): Promise<Profile>`.
  - Routes (all guarded): `GET /api/quiz?skills=a,b` -> `QuizResponse` with `Cache-Control: no-store`; `POST /api/onboarding` body `OnboardingBody` -> 200 `Profile`; `PUT /api/focus` body `FocusBody` -> 200 `Profile`.
  - Error mapping: query/body shape errors -> 400 (`parseWith`); unknown skill in `GET /quiz` -> 400 `Unknown skill: <id>`; `FocusError` and `QuizAnswerError` and "skill outside role" -> `UnprocessableEntityException(message)`; `NotOnboardedError` -> `ConflictException('Complete onboarding first')`.

- [ ] **Step 1: Write the failing tests** `onboarding.e2e.test.ts`. Start the app with `startTestApp({}, { quiz: fixtureQuiz })`. Helper `call(method, path, headers, body?)` using `fetch`. Option ids refer to `fixtureQuiz` bank indexes (see Task 4: `ce-1` levels `[2,0,4,1,3]`, `ce-2` `[3,1,0,4,2]`, `ch-1` `[1,3,0,2]`, `ch-2` `[2,0,3,4]`). Skill ids: `context-engineering`, `cc-hooks`, `evals`.

Quiz:
1. `GET /api/quiz?skills=cc-hooks` without a cookie: 401.
2. With a session: 200; body parses with `quizResponseSchema` (strict, so a `level` key fails it); `version 7`; questions `ch-1`, `ch-2` in order; `unavailable []`.
3. **No level leaks:** recursively collect all keys of the parsed JSON (`level` must not occur anywhere) and `JSON.stringify(body)` does not contain `"level"`; option ids of each question are a permutation of `0..n-1`; option `text` equals `"<id> option <i>"` for id `i` (still the bank index).
4. `skills=evals` (valid role skill, no questions in the fixture): 200, `questions []`, `unavailable ['evals']`; `skills=cc-hooks,evals,cc-hooks` returns `ch-1,ch-2` once, `unavailable ['evals']`.
5. 400 for missing `skills`, empty `skills=`, `skills=nope` (unknown skill; message contains `nope`), and a skill of another role (`seedUser(db, { role: 'pm' })`: every dev skill is unknown for that role -> 400). The 200 response carries `Cache-Control: no-store`.

Onboarding:
6. Happy path, signed in, `POST /api/onboarding` `{ focus: ['context-engineering','cc-hooks'], answers: [ce-1 first 0 second 1, ce-2 first 0 second 2, ch-1 first 1 second 3, ch-2 first 2 second 3] }` -> 200, body parses with `profileSchema`, `onboarded true`, focus ranks 1 `context-engineering`, 2 `cc-hooks`; `context-engineering` is `level 2, uncertain true, assessed true`; `cc-hooks` is `level 3, uncertain false`; the other 30 skills unassessed; DB has 32 `user_skills` rows for the user and 4 `quiz_answers` rows with `quiz_version 7`.
7. Skipping the quiz: `{ focus: ['evals'], answers: [] }` -> 200, `evals` focus rank 1, everything unassessed and `uncertain true`.
8. **Redo:** after case 6 (set `context-engineering` to `points 3, difficulty_offset 1` directly in the DB), POST `{ focus: ['cc-hooks'], answers: [ce-1 first 2 second 4, ce-2 first 3 second 0] }` -> `context-engineering` is `level 4`, uncertain false, `points 0`, `difficulty_offset 0` in the DB; `cc-hooks` keeps `level 3` (no answers sent) and now has `focusRank 1`; `context-engineering.focusRank` null; `quiz_answers` still 4 rows with the two `ce-*` rows updated.
8a. **Quiz-only retake:** after case 6, POST `{ answers: [ch-1 ..., ch-2 ...] }` with no `focus`: 200, focus ranks unchanged, `cc-hooks` re-scored; the same body from a never-onboarded user: 422 and no rows.
9. 400 (zod): body not an object, `focus: []`, six focus ids, duplicate focus, `answers` missing, an answer with a negative option, an extra key.
10. 422 and **no rows written** (`user_skills`, `quiz_answers` counts are 0 for the user afterwards): focus id `nope`; `first === second`; option id `9`; unknown question id `zz-1`; duplicate answer for `ce-1`; only `ce-1` answered (partial skill); a focus outside the role for a `pm` user (`unknown_skill`). Separate case with `startTestApp({}, { quiz, taxonomy })` where `taxonomy` is the real one plus a skill `pm-only` (roles `[pm]`) and `quiz` is `fixtureQuiz` plus two `pm-only` questions: a dev user answering the `pm-only` questions with a valid focus -> 422 `Skill not in your role: pm-only`, nothing written. No 422 message contains the word `level` (answer errors never echo option levels).
11. Unauthenticated POST: 401, nothing written.

Focus:
12. `PUT /api/focus` before onboarding: 409 `{ error: 'conflict' }`, no rows written.
13. After onboarding with focus `['context-engineering','cc-hooks']`: `PUT { focus: ['cc-hooks','context-engineering'] }` -> 200 profile with swapped ranks; `PUT { focus: ['evals'] }` -> others null; five ids -> ranks 1..5 in order; DB ranks always unique (a swap must not raise a unique violation).
14. 400 for `focus: []`, 6 ids, duplicates, missing body; 422 for an unknown skill id; after a rejected PUT the previous focus is intact.
15. Two concurrent PUTs with different valid focuses (`Promise.all`) both return 200 and the final DB ranks form exactly one of the two requested focuses.
16. Another user's focus is never touched by this user's PUT.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run apps/api/src/onboarding`
Expected: FAIL.

- [ ] **Step 3: Implement**

`onboarding.service.ts` core:

```ts
@Injectable()
export class OnboardingService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TAXONOMY) private readonly taxonomy: Taxonomy,
    @Inject(QUIZ) private readonly quizBank: Quiz,
    @Inject(APP_CONFIG) private readonly config: Config,
    @Inject(ProfileService) private readonly profiles: ProfileService,
  ) {}

  quiz(user: AuthUser, skills: string[]): QuizResponse {
    const role = roleSkillIds(this.taxonomy, user.role);
    const unknown = skills.find((s) => !role.includes(s));
    if (unknown) throw new BadRequestException(`Unknown skill: ${unknown}`);
    return presentQuiz(this.quizBank, skills);
  }

  async submit(user: AuthUser, body: OnboardingBody): Promise<Profile> {
    const role = roleSkillIds(this.taxonomy, user.role);
    try {
      if (body.focus) assertValidFocus(body.focus, role);
      else if (!(await isOnboarded(this.db, user.id))) throw new UnprocessableEntityException('Pick a focus first');
      const results = scoreQuiz(this.quizBank, body.answers, this.config.uncertain_spread);
      const outside = results.find((r) => !role.includes(r.skillId));
      if (outside) throw new UnprocessableEntityException(`Skill not in your role: ${outside.skillId}`);
      await saveOnboarding(this.db, {
        userId: user.id, roleSkillIds: role, focus: body.focus, results,
        answers: body.answers, quizVersion: this.quizBank.version,
      });
    } catch (e) {
      throw mapDomainError(e);
    }
    return this.profiles.get(user);
  }
  // changeFocus: setFocus(...) with the same mapping, then profiles.get(user)
}

function mapDomainError(e: unknown): unknown {
  if (e instanceof FocusError || e instanceof QuizAnswerError) return new UnprocessableEntityException(e.message);
  if (e instanceof NotOnboardedError) return new ConflictException('Complete onboarding first');
  return e;
}
```

Controller: `@Controller()` with `@Get('quiz')`, `@Post('onboarding') @HttpCode(200)`, `@Put('focus')`, each `@UseGuards(SessionGuard)`; query via `parseWith(quizQuerySchema, query).skills`, bodies via `parseWith(onboardingBodySchema, body)` / `parseWith(focusBodySchema, body)`. Module: `@Module({ imports: [AuthModule, ProfileModule], controllers: [OnboardingController], providers: [OnboardingService] })`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): GET /quiz, POST /onboarding and PUT /focus with server-side scoring"
```

---

### Task 9: Web foundations: API client additions, browser client, guards, reorder helper, nav item

**Files:**
- Modify: `apps/web/src/lib/api.ts` (**re-read first**), `apps/web/src/lib/nav-items.ts`, `apps/web/src/app/page.tsx` (landing: signed-in "Open ATTN" button goes to `/profile`)
- Create: `apps/web/src/lib/browser-api.ts`, `apps/web/src/lib/guards.ts`, `apps/web/src/lib/reorder.ts`, `apps/web/src/components/onboarding/sortable-list.tsx`

**Interfaces:**
- Consumes (Stage 3, given): `apiGet<T>(path, schema, { query?, cookie? })`, `ApiError { status, body }`, `getMe()`, `getTaxonomy()`, `NavItem`, `NAV_ITEMS`; shared `profileSchema`, `Profile`, `quizResponseSchema`, `QuizResponse`, `errorBodySchema`, `MAX_FOCUS`, `Me`.
- Produces:
  - `api.ts`: `getProfile(): Promise<Profile>` (reads `(await cookies()).toString()` outside any try/catch, then `apiGet('/profile', profileSchema, { cookie })`; throws `ApiError`), `getQuiz(skills: string[]): Promise<QuizResponse>` (query `{ skills: skills.join(',') }`, same cookie handling).
  - `guards.ts` (server only): `requireProfile(): Promise<Profile>` (401 -> `redirect('/')`; `!profile.onboarded` -> `redirect('/onboarding')`), `requireMe(): Promise<Me>` (`getMe()`; null -> `redirect('/')`).
  - `browser-api.ts` (client-safe): `class BrowserApiError extends Error { status: number }`; `browserJson<T>(method: 'GET' | 'POST' | 'PUT', path: string, schema: { parse(i: unknown): T }, body?: unknown): Promise<T>` (fetches `/api${path}` with `credentials: 'same-origin'`, JSON body, on non-2xx throws `BrowserApiError` whose message is the server's `message` via `errorBodySchema` or `Request failed (<status>)`, parses success bodies with the schema).
  - `reorder.ts`: `moveItem<T>(list: readonly T[], from: number, to: number): T[]` (returns a new array; out-of-range indexes return a copy unchanged), `toggleSkill(list: readonly string[], id: string, max: number): string[]` (removes when present, appends when absent and `list.length < max`, otherwise returns a copy unchanged).
  - `SortableList` client component: `SortableList({ items, renderLabel, onChange }: { items: string[]; renderLabel: (id: string) => ReactNode; onChange: (next: string[]) => void })` renders a numbered `<ol>`; each row has a drag handle (`draggable`, native `onDragStart/onDragOver/onDrop` using `moveItem`), "Move up", "Move down" and "Remove" buttons (disabled at the ends; every button has an `aria-label` naming the item).
  - `NAV_ITEMS` gains `{ href: '/profile', label: 'Profile', auth: 'user' }`.

- [ ] **Step 1: Implement** (no web tests, spec §8)

`reorder.ts`:

```ts
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

export function toggleSkill(list: readonly string[], id: string, max: number): string[] {
  if (list.includes(id)) return list.filter((x) => x !== id);
  return list.length < max ? [...list, id] : [...list];
}
```

`guards.ts`:

```ts
import { redirect } from 'next/navigation';
import type { Me, Profile } from '@attn/shared';
import { ApiError, getMe, getProfile } from './api';

export async function requireMe(): Promise<Me> {
  const me = await getMe();
  if (!me) redirect('/');
  return me;
}

export async function requireProfile(): Promise<Profile> {
  let profile: Profile;
  try {
    profile = await getProfile();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect('/');
    throw e;
  }
  if (!profile.onboarded) redirect('/onboarding');
  return profile;
}
```

`browser-api.ts`:

```ts
import { errorBodySchema } from '@attn/shared';

export class BrowserApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function browserJson<T>(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  schema: { parse(i: unknown): T },
  body?: unknown,
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = errorBodySchema.safeParse(json);
    throw new BrowserApiError(res.status, err.success ? err.data.message : `Request failed (${res.status})`);
  }
  return schema.parse(json);
}
```

`sortable-list.tsx`: `'use client'`, props as above, `const [dragFrom, setDragFrom] = useState<number | null>(null)`; each `<li draggable onDragStart={() => setDragFrom(i)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (dragFrom !== null) onChange(moveItem(items, dragFrom, i)); setDragFrom(null); }}>` with a number badge `{i + 1}`, `renderLabel(id)`, and three `<button type="button">`s; Tailwind tokens from Stage 3 (`border-line bg-card text-muted hover:text-fg`).

- [ ] **Step 2: Verify**

Run: `pnpm lint && pnpm typecheck && pnpm --filter @attn/web build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web
git commit -m "feat(web): profile/quiz API client, browser client, onboarding guard, sortable list"
```

---

### Task 10: Web onboarding flow (focus pick with drag ordering, then quiz)

**Files:**
- Create: `apps/web/src/components/onboarding/focus-picker.tsx`, `quiz-runner.tsx`, `onboarding-flow.tsx`
- Create: `apps/web/src/app/onboarding/page.tsx`, `apps/web/src/app/onboarding/quiz/page.tsx`

**Interfaces:**
- Consumes: Task 9 (`SortableList`, `browserJson`, `BrowserApiError`, `toggleSkill`, `requireMe`, `requireProfile`, `getProfile`, `getQuiz`, `getTaxonomy`); shared `Taxonomy`, `Profile`, `QuizQuestionDto`, `QuizAnswerInput`, `quizResponseSchema`, `profileSchema`, `quizQuerySchema`, `MAX_FOCUS`; Tailwind tokens `bg-card border-line text-muted bg-accent text-accent-fg bg-accent-soft`.
- Produces:
  - `FocusPicker({ taxonomy, role, value, onChange })` client: skills of the role (`skill.roles.includes(role)`) grouped by domain as toggle buttons (`aria-pressed`; unselected ones disabled once `MAX_FOCUS` are chosen); below them a "Your focus, in priority order" `SortableList` of the selected skills (names from the taxonomy); hint text "Pick 1 to 5 skills, then drag to order them. The first one matters most."
  - `QuizRunner({ questions, focus, skillNames, onSubmitted }: { questions: QuizQuestionDto[]; focus?: string[]; skillNames: Record<string, string>; onSubmitted: () => void })` client (`focus` is omitted for a retake; the POST body is `{ answers }` or `{ focus, answers }`): one question at a time with a skill name heading and progress "Question 3 of 10"; phase 1 "What would you do?" shows all options, the pick becomes `first`; phase 2 "If that option weren't there, what would you do?" shows the options except `first`, the pick becomes `second`; then the answer `{ questionId, first, second }` is stored and the next question starts; "Back" undoes the last pick or answer; after the last answer it posts `browserJson('POST', '/onboarding', profileSchema, focus ? { focus, answers } : { answers })`; on `BrowserApiError` it shows the message and a "Try again" button; a submit-in-flight state disables the buttons.
  - `OnboardingFlow({ taxonomy, role, initialFocus }: { taxonomy: Taxonomy; role: string; initialFocus: string[] })` client with steps `focus` -> `quiz`: "Continue" (enabled when 1-5 are picked) fetches `browserJson('GET', '/quiz?skills=' + encodeURIComponent(focus.join(',')), quizResponseSchema)`, shows `QuizRunner` for the returned questions; if `questions` is empty it posts immediately with `answers: []`; a secondary "Skip quiz for now" button posts `{ focus, answers: [] }`; on success `router.push('/profile')` then `router.refresh()`.
  - Routes: `/onboarding` (server): `const me = await requireMe()`, `const taxonomy = await getTaxonomy()`, `getProfile()` for the initial focus (`profile.focus.map(f => f.skillId)`, empty for a new user; this page is also "redo onboarding"), heading "Choose your focus" (redo: "Redo onboarding"); `/onboarding/quiz?skills=a,b` (server): `await requireProfile()`, parse `skills` with `quizQuerySchema.safeParse` (invalid -> `redirect('/profile')`), `getQuiz(skills)` (an `ApiError` 400 -> `redirect('/profile')`), render `QuizRetake({ questions, skillNames })` (client wrapper exported from `quiz-runner.tsx`; renders `QuizRunner` **without** `focus`, navigates to `/profile` and refreshes on success); `skillNames` = `{ [skill.id]: skill.name }` from `getTaxonomy()`. No focus is sent, so an empty or concurrently edited focus is irrelevant. If `unavailable` is non-empty and `questions` is empty show "No quiz is available for these skills yet." with a link back to `/profile`.

- [ ] **Step 1: Implement** the three client components and two pages per the contract above. The `QuizRunner` state machine:

```tsx
type Phase = { kind: 'first' } | { kind: 'second'; first: number };
const [index, setIndex] = useState(0);
const [phase, setPhase] = useState<Phase>({ kind: 'first' });
const [answers, setAnswers] = useState<QuizAnswerInput[]>([]);
// pick(optionId):
//   phase first  -> setPhase({ kind: 'second', first: optionId })
//   phase second -> const next = [...answers, { questionId, first: phase.first, second: optionId }];
//                   if (index + 1 < questions.length) { setAnswers(next); setIndex(index + 1); setPhase({ kind: 'first' }); }
//                   else void submit(next);
// back():
//   phase second -> setPhase({ kind: 'first' })
//   phase first && index > 0 -> drop the last answer, setIndex(index - 1), setPhase({ kind: 'first' })
```

Never render or log anything but `id` and `text` of options (the DTO has nothing else). The heading is `skillNames[question.skillId] ?? question.skillId`; `OnboardingFlow` builds `skillNames` from its `taxonomy` prop.

- [ ] **Step 2: Verify**

Run: `pnpm lint && pnpm typecheck && pnpm --filter @attn/web build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web
git commit -m "feat(web): onboarding flow with draggable focus ordering and two-choice quiz"
```

---

### Task 11: Web Profile page

**Files:**
- Create: `apps/web/src/components/profile/skill-card.tsx`, `apps/web/src/components/profile/focus-editor.tsx`, `apps/web/src/app/profile/page.tsx`

**Interfaces:**
- Consumes: Task 9 (`requireProfile`, `browserJson`, `BrowserApiError`, `SortableList`, `toggleSkill`), the existing Stage 3 `getTaxonomy()` (calls the existing `GET /api/taxonomy`); shared `Profile`, `ProfileSkill`, `FocusEntry`, `Taxonomy`, `profileSchema`, `MAX_FOCUS`; Stage 3 tokens.
- Produces:
  - `SkillCard({ skill, levelLabel }: { skill: ProfileSkill; levelLabel: string })` (server component): skill name; if `focusRank` a highlighted (`bg-accent-soft border-accent`) card with a numbered badge `#rank`; assessed skills show `L<level> <levelLabel>` and progress `points/pointsNeeded` (e.g. `3/5`, with a thin progress bar) or "Max level" when `pointsNeeded` is null; skills with `level` null show "Not assessed (treated as level 1)"; **every skill with `quizzed` false** (unassessed, or levelled up only by reading) shows a link `Take quiz` to `/onboarding/quiz?skills=<id>`; `uncertain` skills carry a badge `Uncertain` with `title="Your quiz answers were inconsistent, or the skill is not assessed yet. Reading feedback will calibrate it."`; the description is available as `title` on the name.
  - `FocusEditor({ focus, skills }: { focus: FocusEntry[]; skills: { id: string; name: string; domain: string }[] })` client: local `value: string[]` from `focus` (the page renders it with `key={profile.focus.map((f) => f.skillId).join(',')}` so `router.refresh()` after saving resets local state and "changed" compares against the new server value); `SortableList` for ordering/removal; an "Add a skill" `<select>` grouped by domain (`<optgroup>`) with skills not yet chosen, disabled at `MAX_FOCUS`; "Save focus" button (disabled unless changed and `value.length` is 1-5) calling `browserJson('PUT', '/focus', profileSchema, { focus: value })` then `router.refresh()`; "Reset" restores the server value; error message area (`role="alert"`) shows `BrowserApiError` messages; empty `value` shows "Pick at least one focus skill."
  - `/profile` page (server): `const profile = await requireProfile()`, `const taxonomy = await getTaxonomy()`; sections in order: header "Your profile" with a "Redo onboarding" link (`/onboarding`); `FocusEditor`; a banner with "Take the quiz for N skills" (N = skills with `quizzed` false) linking to `/onboarding/quiz?skills=<those ids, comma separated>` only when N > 0 (cap at 12 skills per link to keep the quiz short; the rest remain after those are done); the skill map as one section per domain (heading with the domain name and a "Take quiz for this domain" link when it has skills with `quizzed` false) containing `SkillCard`s; "Reading history" listing `history.items` (title linking out with `target="_blank" rel="noopener noreferrer"`, source, date) or the empty text "Nothing read yet. Articles you open from For you will appear here."; "👍 share" showing `NN%` of `likes.liked`/`likes.read` or "No reads yet" when `share` is null. Level labels come from `taxonomy.levels` (`levelLabel = taxonomy.levels.find(l => l.level === skill.level)?.label`).

- [ ] **Step 1: Implement** per the contract above.

- [ ] **Step 2: Verify code**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @attn/web build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web
git commit -m "feat(web): Profile page with skill map, editable focus, take-quiz and redo links"
```

---

### Task 12: Privacy scan test, README, end-to-end smoke

**Files:**
- Create: `packages/core/src/levels/privacy.test.ts`
- Modify: `README.md` (add a short "Onboarding and the quiz bank" section; update the privacy paragraph with a pointer to the scan test; keep every other line)

**Interfaces:**
- Consumes: the full stack from Tasks 1-11; `dataDir`/file system access via `node:fs`; `signIn`-style manual session creation for the smoke test (below).
- Produces: a test that fails when user data reaches the LLM path; documentation.

- [ ] **Step 1: Write the failing test** `privacy.test.ts` (reads source files with `fs`, paths relative to `import.meta.url`):
1. No non-test `.ts` file under `packages/core/src/label/`, `packages/core/src/eval/`, `packages/core/src/extract/` contains any of: `userSkills`, `quizAnswers`, `levels/`, `from '../levels`, `fixtureQuiz`, `user_skills`, `quiz_answers`.
2. No non-test `.ts` file under `packages/core/src/levels/` contains `from '../label` or `from '../eval` or the identifiers `Labeler`, `generateObject`.
3. No file under `apps/api/src/onboarding/` and `apps/api/src/profile/` (including tests) references `Labeler`, `createGeminiLabeler`, `labelPending` or the `LABELER` token.
4. `packages/core/src/label/` exports nothing whose parameter names include `user` or `quiz` (grep `/\b(userId|user_id|quiz)\b/` over non-test label sources returns nothing).
5. The built web bundle guard: `apps/web/src` contains no occurrence of the string `level:` inside `components/onboarding/` or `app/onboarding/` (option levels never exist in the web; skill `level` appears only under `components/profile/` and `app/profile/`). Implement as: files under `apps/web/src/components/onboarding/` and `apps/web/src/app/onboarding/` do not match `/\.level\b|\blevel:/`.

- [ ] **Step 2: Run to verify it passes** (the code already satisfies it; if a scan fails, fix the offending file, not the test)

Run: `pnpm vitest run packages/core/src/levels/privacy.test.ts`
Expected: PASS. Temporarily add `import '../levels';` to a file in `label/` and confirm FAIL, then remove it.

- [ ] **Step 3: README** — add under the existing data section: what `data/quiz/dev.yml` is (DRAFT, owner review required, 32 skills x 2 questions, hidden levels, how to add a question: id `<skill>-<n>`, 4-6 situational options, scrambled order, run `pnpm vitest run packages/core/src/quiz-data.test.ts`), the onboarding order (focus first, quiz covers focus skills, other skills via Profile), and the `uncertain_spread` / `points_per_level` knobs in `data/config.yml`.

- [ ] **Step 4: Full verification**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @attn/web build`
Expected: PASS.

Manual smoke (no GitHub credentials, so create a user and session directly):

```bash
export DATABASE_URL=postgres://attn:attn@localhost:5432/attn
pnpm attn migrate
TOKEN=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')
HASH=$(printf %s "$TOKEN" | shasum -a 256 | cut -d' ' -f1)
psql "$DATABASE_URL" -c "insert into users (github_id, login, name) values (999001, 'smoke', 'Smoke') on conflict do nothing;"
psql "$DATABASE_URL" -c "insert into sessions (id, user_id, expires_at) select '$HASH', id, now() + interval '1 day' from users where github_id = 999001;"
SCHEDULE_ENABLED=false COOKIE_SECURE=false pnpm api &   # terminal A
pnpm web &                                              # terminal B
curl -s -H "cookie: attn_session=$TOKEN" localhost:3000/api/profile | head -c 300     # onboarded:false
curl -s -H "cookie: attn_session=$TOKEN" "localhost:3000/api/quiz?skills=cc-hooks" | grep -c '"level"'   # 0
curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/profile                       # 307 to / without a cookie
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -H "cookie: attn_session=$TOKEN" localhost:3000/profile   # 307 to /onboarding
```

Expected: as commented. Then in a browser with the `attn_session` cookie set to `$TOKEN`, walk `/onboarding` (pick 3 skills, drag to reorder, answer the quiz) and confirm `/profile` shows numbered focus, levels, `x/5` progress and uncertain badges; "Take quiz" on an unassessed skill and "Redo onboarding" work. Record the outputs in the task report. Clean up: delete the smoke user (`delete from users where github_id = 999001;`) and stop both servers.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/levels/privacy.test.ts README.md
git commit -m "test(core): privacy scan for quiz data; docs: onboarding and quiz bank"
```

---

## Self-Review (done while writing)

- **Spec coverage:** §3.1 quiz bank -> Tasks 1-3; §3.2 `user_skills`/`quiz_answers` -> Tasks 5-6; §5.1 scoring, redo, role-wide rows, unassessed = level 1 uncertain -> Tasks 4, 5, 8 (Decisions 1-8); §5.2 points -> Task 4 (`applyReadPoint`, `progressToNext`; the event is Stage 5); §6.3 Profile -> Tasks 6, 7, 11; §6.6 endpoints -> Tasks 7, 8 (`GET /taxonomy` from Stage 3); §8 tests -> core units Tasks 1, 4, 5, 6; api e2e Tasks 7, 8; web typecheck/lint only; redirect for signed-in without onboarding -> Decision 4, Tasks 7, 9, 11; controller rulings 1-6 -> Decisions 1, 5, 10, Task 12 and Global Constraints.
- **Placeholder scan:** the only prose-defined bodies are web JSX layouts and the 64 bank questions; both have exact contracts, rules, one worked example and validators.
- **Type consistency:** `QuizAnswer` (core) and `QuizAnswerInput` (shared) have the same shape `{ questionId, first, second }`; `SkillQuizResult` is produced by `scoreQuiz` (Task 4) and consumed by `saveOnboarding` (Task 5) and the service (Task 8); `Profile` is built in Task 6, returned by Tasks 7-8, parsed by the web in Tasks 9-11; `presentQuiz` returns `QuizResponse` used by `GET /quiz` and `getQuiz`; `fixtureQuiz` ids and level arrays are the same in Tasks 4, 5, 8; `startTestApp(overrides, extra)` is defined in Task 7 and used in Task 8; `requireProfile`/`requireMe` (Task 9) are used in Tasks 10-11; `roleSkillIds`/`assertValidFocus`/`FocusError` (Task 4) are used in Tasks 5 and 8.
