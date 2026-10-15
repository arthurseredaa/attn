# ATTN — design decisions (grill session, 2026-10-14)

Input for the spec. Agreed with the user in a /grill-me session held in `~/Projects/ai-news`.

## What it is

Public website with a personal feed of AI articles. The user onboards, gets an AI skill map, picks focus
skills, and ATTN ranks existing articles by their priorities and level.

- Goals: portfolio, learning to build such systems, own tool. No monetization.
- Differentiator vs TLDR (one human-curated issue for everyone) and daily.dev (tag-based feed): ranking
  by **skill priority + skill level**, not by topic alone.
- Curation only: links to existing articles. No generated guides.
- Everything in English.

## Skill map

- Fixed curated taxonomy `Role → Domain → Skill`, versioned YAML. A skill can belong to several roles
  (`roles: [dev, pm]`).
- Roles: architecture supports many, launch with `dev` only (developers who use AI and build with it).
  Adding a role = new YAML for taxonomy, sources, quiz and golden set, no code changes. The ranking
  engine does not know about roles; roles only affect onboarding (which skills are offered) and sources.
- Onboarding: pick role → pick up to 5 focus skills and order them (the rest are background) → quiz.
- Quiz:
  - situational questions ("Claude Code went off track mid-session, what do you do?") with 4–6 options;
    each option has a hidden level 0–4;
  - after the first choice the user picks a **second** one ("if that option weren't there");
  - skill level = median of first choices over the skill's questions;
  - spread |first − second| = confidence; a large spread marks the skill "uncertain", and the feed mixes
    difficulty for it (±1) so feedback calibrates it;
  - question bank is written together (Claude drafts, user reviews), stored in the repo as YAML,
    versioned with the taxonomy. Being public in open source is fine.
- Level grows from reading: the "Read" button (never disabled) gives 1 point to the article's primary
  skill if the article's difficulty ≥ the user's level. 5 points = +1 level. Numbers live in config.
- The user can redo onboarding at any time; the new result replaces levels. Focus and order can be
  changed at any time.
- Focus ranks when a focus skill leaves the taxonomy: the Profile renumbers ranks 1..n at read time, but the
  Stage 5 ranker reads the stored `focus_rank`, where the removed skill only leaves a gap until the next focus
  save (rare: only the owner edits the taxonomy). Cost if wrong: later focus skills get a slightly lower
  priority until the user edits their focus.

## Matching

- **Labeling is global, one LLM call per article**, full text (truncated). Output: `skills[]` (primary /
  secondary), `difficulty` 0–4, `type` (release / tutorial / deep dive / news / research), `quality`.
  Enums in the output schema. Reading time is computed from word count, no AI. No summaries.
- **Relevant article** for a user:
  1. primary skill is in focus; a background skill only with quality above a high threshold;
  2. difficulty = level or level+1 (±1 for "uncertain" skills);
  3. quality ≥ threshold;
  4. not read or dismissed by the user, no duplicate of the same story in the feed;
  5. releases and news ≤ 14 days old; tutorials and deep dives have no age limit (the feed mixes fresh
     items with an evergreen library).
- **Ranking**: deterministic formula, priority → level fit → quality. No per-user LLM calls. A module
  behind an interface so it can be swapped (e.g. LLM rerank) later.
- The feed is computed by a **SQL query on request**. Nothing is precomputed per user. Cache only if
  measured to be needed.
- Feedback buttons: Read, 👍, too easy, too hard, not interested. "Too easy/hard" adjusts level fit for
  that skill, "not interested" lowers weight. The share of 👍 is the ranking quality metric.
- Label quality: the user hand-labels ~50 articles (golden set, YAML), a CLI eval script measures
  per-field agreement. The model is chosen only by eval results. No admin UI.

## Website

- Login with GitHub OAuth (name and avatar from the profile).
- **For you**: personal live feed; each article shows only title, skills and link. Read items disappear.
- **All**: everything collected, chronological, filters by source, skill and date (the "raw" view).
- **Profile**: map of all skills by domain with levels, focus highlighted and ordered, progress to the
  next level (e.g. 3/5), "take quiz" for unassessed skills, reading history.
- No Telegram in MVP.

## Backend and data

- pnpm monorepo: `apps/web` (Next.js, frontend only), `apps/api` (NestJS), `packages/shared` (zod
  schemas and types), `packages/core` (collectors, labeling, ranking as plain modules without NestJS).
  YAML data in the repo: taxonomy, quiz, `sources.yml`.
- Postgres + Drizzle.
- Daily schedule: collect → label new articles.
- LLM via Vercel AI SDK (`ai` 7.x, `@ai-sdk/google`) on a free Gemini key; switching provider = changing
  the import and the key.
- **Invariant**: only public article text goes to the LLM. User data (quiz answers, levels, ids) never
  does. (The Gemini free tier may use prompts for product improvement and human review.)
- Full article text is used only for labeling; it is not shown or stored.
- Secrets only in env; the repo has `.env.example`.

## Repository and ai-news

- `~/Projects/attn`, public on GitHub, MIT, code written from scratch.
- From `~/Projects/ai-news` carry over **as data only**: `sources.yml` (28 sources: 18 rss, 6
  gh-releases, 2 sitemap, 2 md-diff) and `taxonomy.yml` (32 skills, 6 domains) as the taxonomy base.
  Collector types worth reimplementing: rss, GitHub releases, sitemap with path prefix, markdown
  changelog diff; HTTP ETag/Last-Modified caching; dedup by title hash.
- `ai-news` is archived on GitHub and its Claude Desktop scheduled task is disabled **only once ATTN
  covers the user's own use case**, not before.

## Deferred on purpose

- Quiz scope and onboarding order (user leans to a quiz over all skills so the user sees the whole
  picture) — decide at the quiz stage.
- Hosting (compare prices, Hetzner mentioned). Free options checked 2026-10-14: only Oracle Always Free
  stays on with a disk; Fly.io/Railway have no free tier; Render/Koyeb sleep, no disk.
- Login for non-dev roles (Google or email) — with the first non-dev role.
- Paid Gemini tier — when users from the EEA/CH/UK appear or at a real public launch (the free tier
  terms require paid services for apps available to users there).
- Feed cache — only if measured.

## Research notes (2026-10-14)

- TLDR AI: weekday email, ~1.15M readers, ~18 items (3 sponsored), human curators, no personalization,
  ads-only business. https://tldr.tech/ai, https://advertise.tldr.tech/
- Personalizing competitors: daily.dev (tags at onboarding), Feedly Leo (topics + "less like this").
  None ranks by skill level.
- Telegram framework, if needed later: grammY (telegraf is stalled since 2024).
- ai-news volume: ~150–250 new items a week after the initial backfill.

## Stage 5 ranking and feedback (2026-10-14)

- **Four ranking constants in `data/config.yml`.** Spec §7's key list does not name them and the spec is
  not edited; they keep every number of the §6.1 formula out of the code:
  - `background_priority` 0.1: priority of an article whose primary skill is a background skill (a focus
    skill of rank `r` has priority `(6 - r) / 5`).
  - `fit_next` 1.0: fit when the article difficulty is `t + 1`.
  - `fit_same` 0.8: fit when the difficulty is `t`.
  - `fit_stretch` 0.5: fit for any other difficulty inside the uncertain range (`t - 1`, `t + 2`).
- **`t` is clamped at the top only** (Stage 5 plan Decision 2): `t = least(level + difficulty_offset, 4)`, no lower clamp (a literal
  deviation from spec §6.1). Without it a level-4 skill with offset +1 matches difficulty 5 and 6, which
  never exist, so the skill vanishes from For you and the user can never click "too hard" to undo the
  offset. Level 0 with offset -1 keeps `t = -1` (difficulty 0 still shows), which correctly narrows.
  Revert: drop the `least(..., 4)`.
- **Offset reset on quiz redo** (Stage 5 plan Decision 14): the difficulty offset is recomputed only from `too_easy`/`too_hard` events
  created after the user's latest quiz answer for that skill (none: all events). Spec §5.1 says redoing
  the quiz resets `difficulty_offset`; §5.3 says it is recomputed from events, and recomputing from all
  history would bring the old offset back on the next click. Revert (use full history): delete one
  `WHERE` clause in `levels/events.ts`.
- **A read card collapses instead of disappearing** (final fix wave, deviates from spec §6.1 "Read removes the
  card"). After a successful `read` the card stays in place as a one-line strip "Read ✓ · 👍 · Too easy · Too
  hard"; each button still works and disables once sent, and "Not interested" is no longer offered. The article
  is already excluded server-side, so it leaves the list on the next page load or navigation. Why: spec §5.3's
  quality metric is the share of 👍 among read articles, and too easy / too hard are judgements made after
  reading; with literal removal neither could be given after reading, so the metric and the offset calibration
  would get almost no input. "Load more" therefore counts server-side exclusions, not DOM removals:
  `offset = served - (distinct cards with read or not_interested sent from this list)` (`feedNextOffset` in
  `@attn/shared`, refining plan Decision 10). Feedback buttons on Profile history rows were not added. Revert:
  make the card call the parent's remove on `read` again.
- **Only the Read button marks a card read** (owner change, 2026-10-15). Clicking the title just opens the article:
  no `read` event, no collapse. The Read button opens the article and records `read` as before; the event API is unchanged.
- **Overload retry is configured** (`label_overload_backoff_ms`, default `[2000, 5000, 10000]`): a provider
  overload (HTTP 503/529 or "high demand") retries the same article after each pause, then fails that article and
  the run continues; a 429 still stops the run (spec §4.2). Classified by status first, message text second.
- **State-changing routes require JSON** (`POST /onboarding`, `PUT /focus`, `POST /articles/:id/events`): any
  other content type, or none, gets 415 `unsupported_media_type`, as defense in depth against cross-site form
  posts. The session check runs first, so anonymous requests still get 401.

## Claude labeler (2026-10-14)

- **Claude Haiku is evaluated as the labeler alongside Gemini.** The owner chose to try `claude-haiku-5-5`. Spec
  §4.2 named a free-tier Gemini model; this widens it to a provider choice by the `LABEL_MODEL` prefix: `claude-*`
  goes to Anthropic (`@ai-sdk/anthropic`, `ANTHROPIC_API_KEY`), `gemini-*` to Google
  (`GOOGLE_GENERATIVE_AI_API_KEY`), any other prefix is a startup error ("unknown LABEL_MODEL provider"). Same
  prompt, output schema, temperature 0 (ignored by models that reject sampling parameters, such as Haiku 5.5) and
  error handling (401/403/404 fatal, 429 stops the run, 503/529 retried with `label_overload_backoff_ms`), plus
  Anthropic's 402 `billing_error` and 400 "credit balance is too low" (`invalid_request_error`) are fatal, since every later call would fail
  the same way. Extended thinking is off for Claude (`reasoning: 'none'`; effort `low` on models that cannot turn
  it off): a classification does not need it and it bills as output. The system prompt is sent with Anthropic
  prompt caching. Every labeling call, for both providers, caps output at 1024 tokens (a label is ~100). Claude has no free tier: it is paid per token, and
  `label_max_chars` drives the cost. The model is still chosen only by eval results; `attn eval` now prints the
  run's token totals so the cost can be compared. The privacy invariant is unchanged: only public article text is
  sent, to either provider.
- **The golden set is the Claude-drafted reference.** The owner accepted Claude's draft (`data/golden/draft.yml`)
  as the reference instead of hand-labeling ~50 articles (an earlier section says "the user hand-labels").
  Eval therefore measures agreement with that reference, not with a human judgement; a Claude labeler may score
  higher partly because Claude drafted the reference.

## jev labeler (2026-10-14)

- **`typesafe-ai/jev` is a third labeler, chosen by the `typesafe-ai/` prefix.** It is a decision model on the Vercel AI Gateway (`JEV_API_KEY`, paid per input token), called with the experimental `experimental_decide`: one call per article, choices for primary skill, type, difficulty and quality, and a yes/no question per skill for secondary skills (kept when probability >= `jev_secondary_threshold`, default 0.5, at most 3, never the primary); gateway auth, billing, restricted-model and non-input 400/422 errors stop the run, since they would repeat for every article; 409/5xx are retried and input-caused 4xx fail only that article.

## Labeler choice and eval results (2026-10-15)

- **`LABEL_MODEL=typesafe-ai/jev` labels everything; Gemini is not used.** Golden-set eval (58 articles, the
  Claude-drafted reference, so Claude may be favoured), % agreement:

  | Field | jev | claude-haiku-5-5 | gemini-3.5-flash-lite |
  |---|---|---|---|
  | primary skill | 72.4 | 65.5 | 58.6 |
  | secondary skills (Jaccard) | 49.7 | 20.0 | 31.3 |
  | difficulty exact | 43.1 | 62.1 | 58.6 |
  | difficulty ±1 | 93.1 | 98.3 | 93.1 |
  | type | 89.7 | 82.8 | 75.9 |
  | quality ±1 | 89.7 | 96.6 | 98.3 |

  Cost per run of 58: jev ≈ $0.019 (≈ $0.33 per 1000 articles at $0.042/M input tokens), Haiku 5.5 ≈ $0.026
  (≈ $0.45 per 1000 with prompt caching). jev needs paid Vercel credits: the free tier answers 403
  "Free tier users do not have access to this model".
- **Known jev weaknesses, to revisit after a trial period:**
  - Difficulty is often one level too hard (43.1% exact vs Haiku's 62.1%), so the feed may serve articles above the
    reader's level. Options: a difficulty-only second opinion from Haiku (the parked `feat/combo-labeler` branch
    supports `<main>+<secondary>` combos, currently for secondary skills only), or a calibration offset.
  - Secondary skills are under-predicted at `jev_secondary_threshold` 0.5: in 21 of the 32 secondary-skill
    disagreements jev returned none where the reference had some. Try 0.3 and 0.4 with `attn eval` (≈ 2 cents each).
- **The initial backlog was labeled without the API.** The 389 articles pending on 2026-10-15 were labeled by Claude
  Code subagents (Sonnet) reading each article's full extracted text with the same system prompt and rubrics, then
  imported with the labeler's own write path (`label_model = claude-code-subagent:sonnet`); 8 articles under
  `label_min_chars` were marked failed. Of the 389: 154 news, 104 deep_dive, 96 release, 21 research, only 14
  tutorial; 147 have quality 0–1 (mostly company news and vendor product posts outside the skill map), which points
  at sources worth pruning in `data/sources.yml`.

## Filters and search (2026-10-15)

- **Skill filters and title search on For you and All**, kept in the URL (`?skill=a&skill=b&q=text`, plus All's
  `source`, `from`, `to`). Owner request. `skill` is any-match over primary and secondary skills; `q` is a
  case-insensitive substring of the title (`%`, `_` and `\` escaped). Both endpoints validate the same way (unknown
  skill, more than 10 skills or a `q` over 100 characters is a 400). In the feed the filters sit in the ranking
  query's eligibility `WHERE`, before scoring, ordering and paging, so offsets stay consistent: a next page repeats
  the filters, and the web computes the offset (served minus excluded) per filtered list. Full-text search over the
  article body is not part of this. Revert: drop the two `and` fragments in `rank/sql.ts` and the filter bar.

## Source cleanup (2026-10-15)

Measured on the dev DB snapshot (397 articles: 389 labeled, 8 failed; 147 with quality <= 1, 137 with quality >= 3).
Rank already needs quality >= 2, so junk never reached a feed; it cost labeling spend and clutter.

- **Per-source junk (quality <= 1):** anthropic-news 107 of 181 (59%, 20 good), simon-willison 13 of 29 (54%),
  cloudflare-ai 8 of 20 (40%), vercel 6 of 29 (21%), mozilla-ai-blog 4 of 15 (27%, only 3 good), latent-space 4 of 20,
  ai-hero 4 of 47 (9%, 39 good). addy-osmani, github-blog-ai, claude-dev, anthropic-engineering and mcp-blog had none.
  The 8 failed rows were too short: simon-willison 5, ai-hero 2 (landing pages), latent-space 1.
- **Dropped:** `mozilla-ai-blog` (vendor product posts, few good). Its existing rows stay; no table has a foreign key
  to a source id, and the API falls back to the id as the name.
- **Collect rules (measured: junk blocked / q=2 blocked / good wrongly blocked):** ai-hero exact landing paths and
  `/workshops/` 4 / 0 / 0; vercel customer stories (`^/blog/how-.*-(on-vercel|with-v0|with-vercel)$`) and
  `accelerator` 5 / 3 / 0; cloudflare-ai titles (`birthday`, `founders`, `launched during`, `one year`, `sovereign`,
  `civil society`) 5 / 0 / 0. The analysis also proposed rules for simon-willison (no longer needed: tag feeds) and a
  cloudflare `domains` title (dropped: the owner approved the list above). Tuned on one sample, so the rules are narrow.
- **No collect rule for anthropic-news.** An exclude-path regex would have blocked about 78 junk but also 18 q=2 and
  2 good posts (cyber evals, CAISI/AISI safeguards); the stricter include-keyword list loses 7 good. The owner rejected
  both as too risky; the relevance gate decides per article instead.
- **Simon Willison:** the full feed (quotes, release notes) is replaced by the `ai-assisted-programming` tag feed
  (keeps id `simon-willison`, so old rows keep their source) and the `claude-code` tag feed (`simon-willison-claude-code`).
  They overlap; url uniqueness dedups.
- **New sources, no filter:** `philschmid` (https://www.philschmid.de/rss) and `jetbrains-ai`
  (https://blog.jetbrains.com/ai/feed/); the gate handles relevance. Feeds were fetched fine during analysis; tests use
  small saved fixtures shaped like them, never the network.
- **Relevance gate:** one extra boolean `relevant` question inside the existing single jev decide call (no extra call,
  negligible extra cost: the skill map adds some input tokens); below `relevance_threshold` 0.3 (lowered by the owner on 2026-10-15 after the first run excluded a useful live blog; code default stays 0.5) the article is `excluded` instead of labeled. A refusal or missing
  answer = relevant (never exclude on doubt). Other labelers have no gate. Recall bias is deliberate: sample-audit the
  `excluded` log lines now and then.
- **`excluded` status instead of deleting:** the foreign keys of `article_events` and `article_skills` cascade, so a
  delete would destroy user events and remove the dedup anchor (the url would be re-collected and re-labeled within the
  backfill window). Excluded rows stay, are skipped by labeling and every reader, and can be restored with
  `attn unexclude`, which also sets `relevance_override` so the gate cannot exclude that article again. Columns
  `excluded_reason` and `excluded_at` are nullable.
- **Stale HTTP validators:** `source_state.feed_url` records which url an etag/last-modified belongs to; validators are ignored
  when a source's url changed (Simon Willison moved to a tag feed). `filtered=` counts per fetch.
- **Existing junk** is excluded with `attn exclude --max-quality 1` and `--status failed` after a DB backup, run by the
  owner or orchestrator, not by the migration.
