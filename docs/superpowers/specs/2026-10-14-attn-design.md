# ATTN — design spec

Date: 2026-10-14. Input: `docs/decisions.md` (grill session) plus the brainstorming session of the same day.
Where this spec differs from `decisions.md`, this spec wins (sources, dedup, ranking formula).

## 1. Goal and success

ATTN is a public website with a personal feed of AI articles. A user signs in, picks focus skills, takes a
situational quiz, and ATTN ranks existing articles by **skill priority and skill level**, not by topic alone.
Curation only: links to existing articles, no generated content. Everything in English. No monetization.

Goals: portfolio, learning to build such systems, the user's own daily tool.

MVP is done when the user judges that ATTN covers their own use case; then `~/Projects/ai-news` is archived
and its scheduled task disabled (not before).

## 2. Architecture

pnpm monorepo, TypeScript everywhere.

```
data/                    YAML, validated by zod schemas from packages/shared
  taxonomy.yml           Role → Domain → Skill, level scale, version
  sources.yml            14 first-party sources (rss | sitemap)
  quiz/dev.yml           question bank for role dev
  golden/*.yml           hand-labeled articles for eval
  config.yml             every tunable number (thresholds, weights, limits)

packages/shared          zod schemas: YAML files, LLM label output, API DTOs
packages/core            plain modules, no NestJS:
  db/                    Drizzle schema + migrations
  collect/               rss (RSS + Atom), sitemap; HTTP cache; URL normalization; dedup
  extract/               fetch + Readability → text (in memory only), word count
  label/                 Labeler interface; Gemini implementation via AI SDK generateObject
  rank/                  Ranker interface; implementation = one SQL query
  levels/                quiz scoring, reading points → level, feedback effects
  eval/                  per-field agreement of labels vs golden set
  cli.ts                 pnpm attn collect | label | eval

apps/api (NestJS)        auth, onboarding/quiz, feed, articles, events, profile, jobs
apps/web (Next.js)       landing, All, For you, Profile, onboarding (frontend only);
                         rewrites /api/* → api, so the browser sees one origin
docker-compose.yml       postgres, api, web (host-agnostic; provider chosen later)
```

Boundaries:

- `core` knows nothing about HTTP or NestJS. The api and the CLI call the same functions.
- `rank` knows nothing about roles. Roles only affect which skills onboarding offers and which sources exist.
  Adding a role = new YAML (taxonomy entries, sources, quiz, golden set), no code changes.
- **Privacy invariant:** `label` receives only public article text. Its signature takes no user data, so
  quiz answers, levels and user ids cannot reach the LLM.
- LLM access only through Vercel AI SDK (`ai` 7.x, `@ai-sdk/google`). Switching provider = change the import
  and the key.

## 3. Data

### 3.1 YAML

- **taxonomy.yml** — carried over from `ai-news/taxonomy.yml` (6 domains, 32 skills) and translated to
  English. Each skill has `id`, `name`, `description`, `roles: [dev, …]`. Skill ids are stable; the file has
  a `version`. It also defines the shared **level scale 0–4**, used by both quiz options and article
  difficulty:
  0 — never touched it; 1 — basic use; 2 — regular practice; 3 — advanced, customizes it;
  4 — builds it / expert.
- **sources.yml** — first-party sources only. No changelogs, no GitHub releases, no aggregators: first
  parties write about their own releases, and that is the level of release coverage ATTN wants.
  - rss: claude-dev, mozilla-ai-blog, mcp-blog, vercel, github-blog-ai, openai-news, simon-willison,
    latent-space, addy-osmani, hamel-evals, ai-hero, cloudflare-ai
  - sitemap (with `path_prefix`): anthropic-news (`/news/`), anthropic-engineering (`/engineering/`)
  - Dropped from ai-news: claude-code-changelog, github-copilot-changelog, cursor-changelog,
    6 gh-releases sources, 2 md-diff sources, hn-ai, lobsters-ai, smol-ai-news.
- **quiz/dev.yml** — questions per skill: `id`, `skill_id`, `situation`, 4–6 `options` each with a hidden
  `level` 0–4. Written together (Claude drafts, user reviews), public in the repo, versioned.
- **golden/*.yml** — `url` + expected `primary_skill`, `secondary_skills`, `difficulty`, `type`, `quality`.
  ~50 articles labeled by the user.

### 3.2 Postgres (Drizzle)

```
users            id, github_id (unique), login, name, avatar_url, role ('dev'), created_at
sessions         id (sha256 of the cookie token), user_id, created_at, expires_at
source_state     source_id, etag, last_modified, last_run_at, last_error

articles         id, source_id, url (normalized, unique), guid, title, title_hash,
                 published_at, collected_at, word_count,
                 label_status (pending | labeled | failed), label_attempts,
                 difficulty 0–4, type (release | tutorial | deep_dive | news | research),
                 quality 0–4, label_model, labeled_at, taxonomy_version
article_skills   article_id, skill_id, is_primary      -- exactly one primary per article

user_skills      user_id, skill_id, level 0–4 | null (unassessed), uncertain,
                 points, focus_rank 1–5 | null, interest (default 1.0),
                 difficulty_offset −1..+1
quiz_answers     user_id, question_id, first_option, second_option, quiz_version, answered_at
article_events   user_id, article_id, kind (read | like | too_easy | too_hard | not_interested),
                 created_at;  unique (user_id, article_id, kind)
```

- Full article text is never stored. `label` re-extracts it; `word_count` is written at that point.
  Reading time is derived from `word_count`, no AI.
- Skills live in YAML; the DB holds only `skill_id`. A skill removed from YAML disappears from onboarding;
  orphaned ids in `article_skills` are harmless because ranking joins through `user_skills`.
- Reading history = `article_events` with `kind = read`.

## 4. Pipeline

A daily job in `apps/api` (`@nestjs/schedule`, time from config) runs collect, then label, under a
Postgres advisory lock so two instances never run it at once. Both steps are idempotent; the same
functions run manually via `pnpm attn collect | label`.

### 4.1 Collect

- Per source: conditional GET with ETag / Last-Modified, state in `source_state`. A failing source writes
  `last_error` and does not stop the others.
- rss: url, guid, title, published_at from each entry (RSS and Atom).
- sitemap: URLs under `path_prefix` with `lastmod`; for new URLs only, fetch the page for `og:title` /
  `<title>`.
- URL normalization: lowercase host, drop `utm_*`, `ref`, `fbclid` and the fragment, drop trailing `/`.
- **Dedup (deterministic, no LLM, no embeddings):** on insert, skip the entry if an article with the same
  normalized `url`, or same `guid`, or same `title_hash` + publication date already exists. Collapsing
  different stories about the same event is out of scope; duplicates are measured on real data first.
- First run collects entries no older than `backfill_days`, which seeds the evergreen library.

### 4.2 Label

Takes `pending` articles oldest first, at most `label_batch` per run, sequentially with `label_delay_ms`
between calls (free-tier limits).

1. Fetch → Readability → text. Compute `word_count`, truncate to `label_max_chars`. If the text is shorter
   than `label_min_chars` (paywall, JS page), mark `failed`.
2. `generateObject` with a zod schema, temperature 0. The prompt holds the skill ids and descriptions, the
   difficulty rubric (level scale) and the quality rubric. Output: `primary_skill` (enum of skill ids),
   `secondary_skills` (≤ 3, same enum), `difficulty` 0–4, `type` (enum), `quality` 0–4.
3. Store fields, `label_model`, `labeled_at`, `taxonomy_version`; status `labeled`.

Failures set `failed` and increment `label_attempts`; failed articles are retried on later runs while
`label_attempts < label_max_attempts`. A 429 from the provider stops the current run; the rest stays
`pending` for the next day.

The model id comes from env `LABEL_MODEL` and is chosen only by eval results.

### 4.3 Eval

`pnpm attn eval --model <id>`:

- runs the labeler over `data/golden/*.yml`; writes nothing to the DB;
- caches extracted article text in `.cache/` (gitignored), so repeated runs compare models on identical
  input;
- prints per-field agreement: `primary_skill` exact; `secondary_skills` Jaccard; `difficulty` exact and
  within ±1; `type` exact; `quality` within ±1; plus a list of disagreements per article.

The README documents how to run it, read the report, add golden items and compare models.

## 5. Onboarding, levels, feedback

### 5.1 Onboarding (after first login; can be redone any time)

1. **Role** — the screen is shown only when the data has more than one role; today the role is set to
   `dev` automatically.
2. **Focus** — skills of the role grouped by domain; pick 1–5 and order them by drag. The rest are
   background skills. Focus and order can be changed any time.
3. **Quiz** — the engine works for any subset of skills (the bank's scope and the onboarding order are
   decided at stage 4). Per question the user picks a first option, then a second from the remaining ones
   ("if that option weren't there").
   - `level` = median of the levels of first choices over the skill's questions (lower median for an even
     count).
   - `uncertain` = mean |first − second| ≥ `uncertain_spread`.
   - Redoing the quiz replaces `level` and `uncertain`, overwrites `quiz_answers` for those skills, and
     resets `difficulty_offset`.
   - Onboarding creates a `user_skills` row for every skill of the role. A skill without a quiz result
     (`level` null) is treated as level 1 and `uncertain` everywhere (feed, points), so feedback
     calibrates it.

### 5.2 Level growth from reading

"Read" (never disabled) gives +1 point to the article's primary skill when `difficulty ≥ level`. One point
per article (unique event). At `points_per_level` (5) points: level +1, points reset to 0. Level caps at 4.

### 5.3 Feedback (applies to the article's primary skill)

- **too easy / too hard**: `difficulty_offset = clamp(round((too_easy − too_hard) / offset_k), −1, +1)`,
  recomputed from the events after each click, so one stray click does not move it.
- **not interested**: `interest × interest_decay` (0.8), floor `interest_min` (0.2); the article leaves the
  feed.
- **👍**: no ranking effect; the share of 👍 among read articles is the ranking quality metric.
- **Read**: the article leaves the feed and a point may be awarded.

## 6. Feed and website

### 6.1 For you (one SQL query per request, nothing precomputed per user)

For an article with primary skill `s` and the user's row for `s`: `t = level + difficulty_offset`.

Filter:
- `s` is a focus skill, or a background skill with `quality ≥ background_quality_min` (4);
- `difficulty ∈ {t, t+1}`; for `uncertain` skills `difficulty ∈ {t−1 … t+2}`;
- `quality ≥ quality_min` (2);
- `type ∈ {release, news}` only if published within `fresh_days` (14); tutorials, deep dives and research
  have no age limit;
- no `read` or `not_interested` event from this user.

Score:

```
score    = priority × interest × fit × quality / 4
priority = focus_rank r → (6 − r) / 5   (1.0 … 0.2); background → 0.1
fit      = difficulty = t+1 → 1.0;  = t → 0.8;  otherwise (uncertain range) → 0.5
order by score desc, published_at desc
```

All constants live in `config.yml`. `Ranker` is an interface `rank(userId, { limit, offset }) →
ArticleCard[]` so it can be swapped (e.g. LLM rerank) without touching the api. Page size 20 with
"load more".

Card: title, skills (primary highlighted), source, link, feedback buttons. "Read" opens the article in a
new tab and removes the card.

### 6.2 All (public, no login)

All `labeled` articles, newest first; filters by source, skill and date range; cursor pagination on
`published_at`. No feedback buttons.

### 6.3 Profile

Map of all role skills by domain with level, progress to next level (e.g. 3/5) and an `uncertain` marker;
focus highlighted, numbered and editable in place; "take quiz" for unassessed skills; "redo onboarding";
reading history; share of 👍.

### 6.4 Landing (public)

What ATTN does (ranking by skill priority and level), "Sign in with GitHub", link to All.

### 6.5 Auth

NestJS owns auth. GitHub OAuth flow in `apps/api`; on success it upserts the user (name and avatar from the
profile), inserts a `sessions` row and sets an httpOnly, Secure, SameSite=Lax cookie with a random token.
Logout deletes the row. Next.js proxies `/api/*`, so the cookie is first-party and no CORS is needed.
A failed OAuth returns to the landing page with a message.

### 6.6 API (`/api`)

```
GET  /auth/github, /auth/github/callback      POST /auth/logout      GET /me
GET  /taxonomy                                GET  /quiz?skills=…
POST /onboarding        { focus[], answers[] }
PUT  /focus             { focus[] }
GET  /feed?offset=
GET  /articles?source=&skill=&from=&to=&cursor=     (public)
POST /articles/:id/events  { kind }
GET  /profile
```

Errors are JSON `{ error, message }`. Request and response shapes are zod schemas in `packages/shared`.

## 7. Configuration and secrets

- `data/config.yml` (zod-validated): `backfill_days`, `label_batch`, `label_delay_ms`, `label_max_chars`,
  `label_min_chars`, `label_max_attempts`, `schedule_cron`, `uncertain_spread`, `points_per_level`,
  `offset_k`, `interest_decay`, `interest_min`, `quality_min`, `background_quality_min`, `fresh_days`,
  `page_size`.
- Secrets only in env; the repo has `.env.example`: `DATABASE_URL`, `GITHUB_CLIENT_ID`,
  `GITHUB_CLIENT_SECRET`, `GOOGLE_GENERATIVE_AI_API_KEY`, `LABEL_MODEL`, `APP_URL`.
- Gemini free tier may use prompts for product improvement; acceptable because only public article text is
  sent (§2 invariant). Move to the paid tier when users from EEA/CH/UK appear or at a real public launch.

## 8. Testing

vitest throughout.

- core unit tests on fixtures: RSS/Atom/sitemap XML, URL normalization, dedup, quiz scoring, points and
  levels, `difficulty_offset`, `interest`.
- Ranking tested against a real Postgres (docker), since the logic is SQL.
- No LLM calls in tests: the pipeline is tested with a fake `Labeler`; label quality is measured only by
  eval.
- api e2e: session guard and main endpoints, GitHub OAuth mocked.
- web: typecheck and lint only in MVP.
- CI (GitHub Actions): lint, typecheck, tests with a Postgres service.

## 9. Stages (one implementation plan each)

1. **Foundation + collect** — monorepo, shared, db, data carry-over (taxonomy translated, 14 sources,
   config), collectors, `attn collect`.
2. **Label + eval** — extract, labeler, golden set (user labels ~50 articles), `attn eval`, model choice,
   daily job in the api.
3. **Website + auth** — Next.js + NestJS auth, landing, All.
4. **Onboarding + profile** — quiz (bank scope and onboarding order decided here), levels, Profile.
5. **For you + feedback** — ranker, events, 👍 share. Then the user decides whether ATTN covers their use
   case and ai-news can be archived.

## 10. Out of scope for MVP

Telegram; non-dev roles and their login (Google or email); hosting provider choice (docker compose keeps it
open; Hetzner and Oracle Always Free are candidates); feed cache (only if measured); paid Gemini tier;
any dedup beyond §4.1 (embeddings, LLM story clustering); generated summaries or guides; admin UI.

The repo is public on GitHub, MIT license, code written from scratch; ai-news contributes data only.
