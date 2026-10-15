# ATTN

ATTN is a public website with a personal feed of AI articles. A user signs in, picks focus skills, takes a
situational quiz, and ATTN ranks existing articles by skill priority and skill level, not by topic alone.
It is curation only: links to existing articles, no generated content.

## Status

MVP complete: stage 5 of 5 (For you + feedback). Built: collect (RSS, Atom and sitemap sources with conditional GET,
URL normalization and deduplication, article text extraction) and the API job that runs collect then label daily;
LLM labeling (`attn label`) with model evaluation against a golden set (`attn eval`); the website with GitHub
sign-in (session cookie), the public articles API and the All list; onboarding with a situational quiz and the
Profile (skill levels, focus, reading history, 👍 share); the personal For you feed ranked by skill priority and
level, with feedback buttons (read, 👍, too easy, too hard, not interested) that change the user's skill state; and
`attn seed-demo` for local demo data without a labeling key. What is left is the owner's: see
[MVP done-criteria and hand-off](#mvp-done-criteria-and-hand-off).

## Requirements

- Node 24
- pnpm
- Docker (for the standard local Postgres; any Postgres 17 reachable at `DATABASE_URL` works too)

## Quick start

```sh
cp .env.example .env
docker compose up -d --wait
pnpm install
pnpm attn migrate
pnpm attn collect
```

Run the site in development (two terminals), then open http://localhost:3000:

```sh
pnpm api   # terminal 1: API on http://localhost:3001
pnpm web   # terminal 2: Next.js on http://localhost:3000, proxies /api/* to the API
```

Over plain http, set `COOKIE_SECURE=false` in `.env` or sign-in cookies will not stick in some browsers
(see Sign in with GitHub).

## Commands

| Command | What it does |
| --- | --- |
| `pnpm lint` | ESLint over the whole repo |
| `pnpm typecheck` | `tsc --noEmit` in every package |
| `pnpm test` | vitest (DB tests need Postgres and the `attn_test` database) |
| `pnpm attn migrate` | Apply database migrations to `DATABASE_URL` (idempotent) |
| `pnpm attn collect [--source <id>]... [--backfill-days <n>]` | Collect new articles from all sources, or only the given ones |
| `pnpm attn label [--limit <n>]` | Label pending articles with `LABEL_MODEL` (see Labeling) |
| `pnpm attn exclude (--max-quality <n> \| --status failed) --reason <text> [--dry-run]` | Mark labeled articles with quality <= n (or failed ones) `excluded`; `--dry-run` prints the count and samples and changes nothing (see Source cleanup) |
| `pnpm attn unexclude --id <id>` | Return an excluded article to `pending` so the next `attn label` handles it |
| `pnpm attn eval --model <id>` | Measure a model against the golden set; writes nothing to the DB (see Evaluation) |
| `pnpm attn seed-demo [--remove]` | Insert deterministic labeled demo articles so For you works without a labeling API key; `--remove` deletes them |
| `pnpm api` | Start the API on `PORT` (default 3001); `GET /api/health`; runs the daily job |
| `pnpm web` | Start the Next.js site in dev mode on port 3000; rewrites `/api/*` to `API_URL` (default `http://localhost:3001`) |

`attn collect` prints one line per source (`seen= inserted= dup= old= skipped= filtered=`) and a totals line. A failing
source is recorded in `source_state.last_error` and does not stop the others. Every item blocked by an exclusion rule
(below) also gets one line before its source's summary: `filtered  <source id>  <rule>  <url>`.

## Layout

```
data/                YAML validated by zod schemas from packages/shared
packages/shared      zod schemas
packages/core        db/, collect/, extract/, label/, pipeline/, eval/, rank/, levels/, demo/, data loading, cli.ts
scripts/smoke.sh     end-to-end smoke of For you + feedback against the api
docker-compose.yml   postgres, api, web
apps/api             NestJS: auth (GitHub OAuth, sessions), articles, sources/taxonomy, feed, events, health, the daily job
apps/web             Next.js app router site: landing page, the public All list, onboarding, Profile, For you
```

## Sign in with GitHub (OAuth app)

1. On GitHub open Settings > Developer settings > OAuth Apps > New OAuth App.
2. Homepage URL: `http://localhost:3000`. Authorization callback URL:
   `http://localhost:3000/api/auth/github/callback` (the browser-facing origin plus `/api/auth/github/callback`).
3. Put the client id and a generated client secret in `.env` as `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.

`APP_URL` is the browser-facing origin (default `http://localhost:3000`, no credentials in it); the redirect URI
sent to GitHub is `${APP_URL}/api/auth/github/callback`, so change the OAuth app's URLs together with it. No
scope is requested (public profile only). Without credentials the landing page shows a "not configured"
message (`/api/auth/github` redirects to `/?auth_error=not_configured`).

Session cookies are always `Secure` unless you set `COOKIE_SECURE=false`. You need that for plain-http local
development (the api logs a warning at startup). Production must serve https and leave it unset.

Checked live without GitHub credentials: the api answers on 3001, the web on 3000 rewrites `/api/*` to it, and
`/api/auth/github` redirects to `/?auth_error=not_configured`. The real OAuth round trip has not been exercised
(no credentials in the authoring environment); the api tests fake GitHub with a local HTTP server.

## API

All routes are under `/api`; errors are JSON `{ "error", "message" }`.

- `GET /api/health`
- `GET /api/auth/github`: start sign-in (redirects to GitHub)
- `GET /api/auth/github/callback`: finish sign-in, set the session cookie, redirect to the site
- `POST /api/auth/logout`: delete the session (204)
- `GET /api/me`: the signed-in user (401 without a session)
- `GET /api/articles?source=&skill=&q=&from=&to=&cursor=&limit=`: labeled articles, newest first, cursor pagination;
  `skill` repeats (`skill=a&skill=b`, any-match on primary or secondary, up to 10, each a taxonomy id) and `q` is a
  case-insensitive title search (up to 100 characters); both are 400 when invalid
- `GET /api/sources`
- `GET /api/taxonomy`
- `GET /api/quiz?skills=`: quiz questions (no answers) for the signed-in user's role, for the given skills
- `POST /api/onboarding`: submit quiz results and optional focus; creates or redoes the user's skill levels
- `PUT /api/focus`: replace the ordered focus skills (onboarded users only)
- `GET /api/profile`: the signed-in user's skill levels and focus, reading history (latest 20, plus the total) and
  the 👍 share among read articles
- `GET /api/feed?offset=&skill=&q=`: the For you page (20 cards, `{ items, nextOffset }`), ranked for the signed-in
  user; `skill` and `q` work as on `/api/articles` and narrow the ranked list before paging, so repeat them with
  every `offset`
- `POST /api/articles/:id/events`: record feedback with `{ kind }` (`read`, `like`, `too_easy`, `too_hard`,
  `not_interested`); 200 `{ kind, recorded }`, a repeated click is a no-op (`recorded: false`)

`POST /api/onboarding`, `PUT /api/focus` and `POST /api/articles/:id/events` accept only `Content-Type:
application/json` (parameters such as `; charset=utf-8` are fine); anything else, including a form post or no body,
gets 415 `{ "error": "unsupported_media_type" }`. The session check comes first, so an anonymous request gets 401.

## Docker

`docker compose up --build` starts postgres, api and web, and serves the site on http://localhost:3000. The
Dockerfiles have not been built in the authoring environment (image pulls were broken there), so treat them as
untested. The api container applies migrations on start and also runs the daily collect+label job. The compose
site is plain http on localhost, so set `COOKIE_SECURE=false` in `.env` (compose passes it through). The api is
not published on the host; the browser reaches it only through the web proxy.

## Data files

- `data/taxonomy.yml`: Role, Domain and Skill tree with the 0-4 level scale and a version.
- `data/sources.yml`: the 15 first-party sources (`rss` or `sitemap`), with optional per-source `filter` (see Source cleanup).
  A source removed from the file (e.g. `mozilla-ai-blog`) keeps its articles and `source_state` row: nothing references
  source ids by foreign key, and the API shows such an article with its source id as the name.
- `data/config.yml`: the single place for tunable numbers (backfill window, label limits, thresholds, feed settings).
- `data/quiz/dev.yml`: DRAFT question bank for role dev (32 skills x 2 situational questions with hidden option levels); needs owner review.
- `data/golden/`: hand-labeled articles for `attn eval`. It holds `draft.yml` for now (see Evaluation).

## Onboarding and the quiz bank

`data/quiz/dev.yml` is the situational question bank for role `dev`: 32 skills x 2 questions, each with 4-6
options that carry a hidden level (0-4). **It is a DRAFT: the owner must review it before it is trusted**; start
with the open close calls in [docs/quiz-owner-review.md](docs/quiz-owner-review.md). The
levels never leave the server (`GET /api/quiz` strips them and shuffles the options). The bank is guarded by
statistical anti-gaming tests in `packages/core/src/quiz-data.test.ts`; the authoring rules behind them are
internal, in short: one imperative sentence per option, and no surface cue (length, wording, position) may
reveal the level.

To add a question: use the id `<skill>-<n>`, write 4-6 situational options in scrambled level order, and run
`pnpm vitest run packages/core/src/quiz-data.test.ts`.
Each taxonomy role gets its bank from `data/quiz/<role>.yml` (loaded and validated at api start); a role
without a file gets no quiz questions, so its users skip the quiz.

Onboarding order: the user picks and orders 1-5 focus skills first; the quiz then covers the focus skills only
(in rank order). Other skills stay unassessed (level 1, uncertain) until "Take quiz" on the Profile page.
Scoring knobs in `data/config.yml`: `uncertain_spread` (a skill is uncertain when the mean gap between first and
second choice levels reaches it) and `points_per_level` (reading points needed for +1 level).

## Labeling

`attn label` needs `LABEL_MODEL` and the API key of that model's provider in `.env`. The provider is chosen by the
model id prefix:

| `LABEL_MODEL` | Provider | Key |
| --- | --- | --- |
| `gemini-*` (e.g. `gemini-3.6-flash`) | Google AI Studio, has a free tier | `GOOGLE_GENERATIVE_AI_API_KEY` |
| `claude-*` (e.g. `claude-haiku-5-5`) | Anthropic, paid per token, no free tier | `ANTHROPIC_API_KEY` |
| `typesafe-ai/*` (`typesafe-ai/jev`) | TypeSafe AI decision model via Vercel AI Gateway, paid per input token | `JEV_API_KEY` |

Without the model or its key, or with any other prefix (`unknown LABEL_MODEL provider`), it exits 1 before touching
anything and names the problem.

**Combo.** `LABEL_MODEL=<main>+<secondary>` (e.g. `claude-haiku-5-5+gemini-3.5-flash-lite`) labels each article with
both models in parallel. The result is the main model's label (primary skill, type, difficulty, quality) with its
secondary skills replaced by the secondary model's, minus the main primary skill, deduped, at most 3. Both parts go
through the same checks (each needs its own key; an empty part or a second `+` exits 1 at startup). If the secondary
call fails for any reason (429, overload, invalid output, a fatal error of that provider), the article keeps the main
model's own secondary skills, one `warning: secondary labeler ...` line is logged, and the run continues; only a main
model failure behaves as before (fatal or 429 stops the run). The stored `label_model` is the full combo string, and
`eval` token totals cover both calls with a per-model breakdown.

To label with Claude, set `LABEL_MODEL=claude-haiku-5-5` and `ANTHROPIC_API_KEY` (from
https://console.anthropic.com). Every call is billed per input and output token. Input is dominated by the article
text, which is cut to `label_max_chars` (`data/config.yml`, default 20000 characters), so that setting is the main
cost knob. The system prompt (taxonomy and rubrics) is the same on every call and is sent with Anthropic prompt
caching, so within the cache lifetime (5 minutes) repeated calls bill it at the cheaper cache-read rate. Claude Haiku
5.5 does not accept a temperature: the SDK drops the `temperature: 0` setting for it and prints a warning per call.
Every call, for either provider, caps the output at 1024 tokens (a label is about 100).
Extended thinking, billed as output tokens, is turned off for Claude (`reasoning: 'none'`; on a model that cannot
turn it off, such as Opus 5.5, the SDK uses its lowest setting, effort `low`, and prints a warning).

`typesafe-ai/jev` is not a text-generation model but a decision model (32k context, $0.042 per 1M input tokens, no
output price), called with the AI SDK's `experimental_decide` through the Vercel AI Gateway; set `JEV_API_KEY` to a
gateway key (`vck_...`, passed explicitly, `AI_GATEWAY_API_KEY` is not needed). One decide call per article answers
about 37 questions against the same state (title, URL and the article text cut to `label_max_chars`): a choice for
`primary_skill` over all taxonomy skills, choices for `type`, `difficulty` (0-4) and `quality` (0-4) with the same
rubrics as the other labelers, the `relevant` gate below, and one yes/no question per skill for `secondary_skills`, since decide has no
multi-select. The secondary skills are those with probability at least `jev_secondary_threshold` (`data/config.yml`,
default 0.5), highest first, at most 3, never the primary. `experimental_decide` is an experimental API and may change
between AI SDK releases. Fatal for the run: 401/402/403/404 (bad key, no credit, a restricted model such as the
free-tier 403, unknown model) and a 400/422 that does not blame the article; the provider's own message is printed.
A 409 or 5xx is retried like an overload; a 413 or an input-too-long 400/422 fails only that article. Estimate:
about 11k input tokens per article if the gateway bills the state once (not yet verified with a real call).

It takes pending articles oldest first (at most `label_batch`, or `--limit` if smaller), one at a time with
`label_delay_ms` between model calls. For each article it fetches the page, extracts the readable text and
keeps it in memory only; just `word_count` is stored. A page that cannot be fetched or yields fewer than
`label_min_chars` characters (paywall, JS-only page, PDF) becomes `failed` and is retried on later runs until
`label_max_attempts`. A provider overload (HTTP 503/529 or "high demand") is transient: the same article is
retried after each pause in `label_overload_backoff_ms` (default 2 s, 5 s, 10 s, so three retries); if it is
still overloaded the article becomes `failed` (one attempt used) and the run goes on. A 429 is a quota limit, not
retried: the run ends and the remaining articles stay `pending`.
A bad or missing API key (401/403), an unknown model id (404) or, on Anthropic, an exhausted credit balance (400
"credit balance is too low") or a billing error (402 `billing_error`) is fatal: the run stops at once without
changing that article's status or attempts, `attn label` prints the provider error and exits 1, and the API job
logs it at error level. `attn eval` stops the same way and exits 1 with the partial report; it also exits 1 when
not a single article could be scored.

### Source cleanup: collect rules, relevance gate, `excluded`

Junk is kept out at two points. Both are owner-approved (2026-10-15, numbers in `docs/decisions.md`).

**Collect-time rules.** The per-source `filter` in `data/sources.yml` takes, besides `path_prefix`, `keywords` and
`exclude_path_prefix`:

| Key | Matches |
| --- | --- |
| `exclude_paths` | the URL path exactly, a trailing slash ignored (`/skills` also blocks `/skills/`, not `/skills/tdd`) |
| `exclude_path_regex` | a list of regexes tested against the URL path (case-sensitive) |
| `exclude_title_regex` | a list of regexes tested against the title (case-insensitive) |

A bad regex is a config error at load, naming the source, and stops `attn` and the API at startup. A blocked item is
not inserted; it is logged (source id, rule name, url) and counted in `filtered=` (not in `skipped=`). Rules in use:
ai-hero landing pages and `/workshops/`, vercel customer stories and accelerator posts, cloudflare-ai company news
by title. `anthropic-news` deliberately has no rule: the relevance gate handles it.

**Relevance gate (jev only).** The jev labeler's single decide call has one more yes/no question, `relevant`: does the
article teach or meaningfully inform at least one skill in the skill map (every taxonomy skill is listed in the
question; AI built into products counts; corporate news, events, marketing and unrelated topics do not). If the
probability is below `relevance_threshold` (`data/config.yml`, default 0.5) the article is not labeled but marked
`excluded`, with `excluded_reason` and `excluded_at`, and logged (id, title, p, url). A refused or missing answer counts
as relevant. The Claude and Gemini labelers have no gate and treat every article as relevant.

**The `excluded` status.** An excluded article stays in the table, so collect's unique-url dedup never re-inserts it.
It is never selected for labeling and never appears in For you, All or counts (every reader filters on
`label_status = 'labeled'`). `attn exclude --max-quality 1 --reason "q<=1 cleanup"` and
`attn exclude --status failed --reason "too short"` exclude existing rows (take the pipeline lock; `--dry-run` takes
none and writes nothing); `attn unexclude --id <id>` returns one article to `pending` with its attempts reset and marks it so the relevance gate
never excludes it again (the rescue path for a gate mistake).

`attn collect` and `attn label` take the same Postgres advisory lock as the daily job. If another run holds it,
they print `another collect/label run is in progress` and exit 1.

Output: one line per article, `<outcome>  <url>[  <error>]` (an article excluded by the relevance gate prints
`excluded  id=<id>  p=<probability>  <title>  <url>`), then
`total: selected=<n> labeled=<n> excluded=<n> failed=<n> rate_limited=<yes|no>`.

Privacy invariant: only the article `title`, `url` and public article text go to the model, and the `Labeler`
type has no place for user data (quiz answers, levels, user ids). This is enforced by types and tests, and
`packages/core/src/levels/privacy.test.ts` scans the sources and fails if user data reaches the LLM path.

### Daily job

The API (`pnpm api`) runs collect and then label at `schedule_cron` (UTC, from `data/config.yml`) under a
Postgres advisory lock, so two instances never run it at once, and neither does a manual `attn collect` / `attn label` alongside it. `SCHEDULE_ENABLED=false` disables it. Without
`LABEL_MODEL` or the key of its provider the label step is reported as skipped; a `LABEL_MODEL` with an unknown
prefix stops the API at startup.

## Evaluation

`LABEL_MODEL` has no default on purpose and is left empty in `.env.example`: the model is chosen only by eval
results, and an empty value never silently selects an unevaluated model.

**The golden set is Claude's draft, accepted as the reference.** `data/golden/draft.yml` was drafted by Claude, not
hand-labeled; the owner accepted it as the reference instead of hand-labeling (docs/decisions.md). Eval scores
therefore measure agreement with that reference, not with a human judgement, and a Claude labeler may agree with it
partly because Claude drafted it. Fix or delete items you disagree with; the scores follow.

### What it is

`attn eval` measures a model against the golden set in `data/golden/*.yml`. It writes nothing to
the DB, needs the API key, and never runs in CI. Automated tests never call an LLM; eval is the only place
label quality is measured.

### Get a key and run it

1. Put the key of the provider you want to measure in `.env`:
   - Gemini: create a free API key in Google AI Studio (https://aistudio.google.com/apikey) and set
     `GOOGLE_GENERATIVE_AI_API_KEY`. The free tier is enough; limits are shown per project in AI Studio, and the
     free tier may use submitted content to improve Google products, which is fine here because only public
     article text is sent.
   - Claude: create a key in the Anthropic Console (https://console.anthropic.com) and set `ANTHROPIC_API_KEY`.
     There is no free tier: an eval run is one paid call per golden article, and `label_max_chars` caps the
     article text that makes up most of each call's input.
   - jev: put a Vercel AI Gateway key in `JEV_API_KEY`; the run is billed per input token through the gateway.
2. Run (the `--model` prefix picks the provider, as in "Labeling"):

```sh
pnpm attn eval --model gemini-3.6-flash
pnpm attn eval --model claude-haiku-5-5
pnpm attn eval --model typesafe-ai/jev
```

The first run fetches each article once and caches the extracted text in `.cache/text/` (gitignored), so later
runs, and other models, see identical input. Delete a cache file (or the folder) to force a refetch. The run
sleeps `label_delay_ms` between calls. A provider overload (503/529, "high demand") is retried with the
`label_overload_backoff_ms` pauses, then that article is reported as a failure and the run continues; on a
provider 429 it stops, prints the partial report and exits 1.

### Read the report

```
model: gemini-3.6-flash
articles: evaluated=48 of 50 failed=2
primary_skill       66.7%
secondary_skills    41.2%
difficulty_exact    52.1%
difficulty_within1  91.7%
type                70.8%
quality_within1     83.3%
disagreements:
  https://example.com/post
    primary_skill: expected=cc-hooks actual=cc-subagents
failed:
  https://example.com/paywalled  text too short: 120 < 500 chars
  https://example.com/pdf        HTTP 404
tokens: input=231400 output=9800 cache_read=52800 cache_write=1100
```

The numbers are illustrative.

- `primary_skill`: share of articles where the primary skill matches exactly.
- `secondary_skills`: mean Jaccard overlap of predicted and expected sets (both empty counts as 1).
- `difficulty_exact`, `difficulty_within1`: difficulty equal, or within +-1.
- `type`: exact match.
- `quality_within1`: quality within +-1.
- `evaluated=n of total` and `failed:`: articles whose text could not be fetched or was too short are listed
  and excluded from the percentages.
- `tokens:` the provider's token totals over the run, the last line. It includes calls whose output failed to
  parse (they were billed) but not HTTP error responses, which carry no usage. `input` counts every input token,
  cached ones included; `cache_read` and `cache_write` (only when the provider reports them) are the cached part. Multiply by
  the provider's current per-token prices to get the run's cost; ATTN does not store prices.
- `disagreements:` names, per article, each field that did not match. Difficulty off by one is listed; quality
  off by one is not. Empty skill sets print as `-`.

Read the disagreements first. They usually reveal an unclear skill description or a wrong golden label rather
than a model fault.

### Add golden items

Put items in any new `data/golden/<name>.yml` (a YAML list):

```yaml
- url: https://example.com/post
  primary_skill: cc-hooks
  secondary_skills: [cc-subagents]   # 0-3 ids
  difficulty: 2                      # 0-4
  type: tutorial                     # release | tutorial | deep_dive | news | research
  quality: 3                         # 0-4
```

Skill ids come from `data/taxonomy.yml`. Label with the guide: the level scale and rubrics are in
`packages/core/src/label/prompt.ts` and `data/taxonomy.yml`. The loader rejects unknown skill ids, duplicate
URLs and out-of-range numbers, and names the file. Prefer a spread of sources, skills, difficulties and types;
aim for about 50 items.

### Compare models

Candidates, all with a free tier and non-preview when checked on 2026-10-14 against
https://ai.google.dev/gemini-api/docs/pricing: `gemini-3.6-flash`, `gemini-3.5-flash-lite`, `gemini-2.5-flash`.

```sh
pnpm attn eval --model gemini-3.6-flash
pnpm attn eval --model gemini-3.5-flash-lite
```

Claude Haiku (`claude-haiku-5-5`, paid) is also a candidate (docs/decisions.md); compare its `tokens:` line too.
A combo is evaluated the same way, `pnpm attn eval --model claude-haiku-5-5+gemini-3.5-flash-lite`; its `tokens:` line
sums both models and is followed by one indented line per model. A failing secondary falls back to the main model's
secondary skills (see Labeling), so its score then reflects the main model for that article.

Compare the six lines and the disagreement lists, then set the winner as `LABEL_MODEL` in `.env`. Because the
text cache is shared, the comparison is on identical text. Prompt or taxonomy changes also move the scores, so
re-run all candidates after such a change.

## How For you ranks

One SQL query per request, nothing precomputed per user. For each of the user's skills, `t = level + difficulty
offset` (an unassessed skill has level 1 and is uncertain). `t` is clamped to 4 at the top only (a level-4 skill
with offset +1 would otherwise match difficulties that do not exist and vanish); there is no lower clamp. An
article is a candidate when:

- its primary skill is a focus skill, or a background skill with `quality >= background_quality_min` (4);
- its difficulty is `t` or `t+1` (the difficulty band); for an uncertain skill the band widens to `t-1 ... t+2`;
- `quality >= quality_min` (2);
- it is a `release` or `news` item only if published within `fresh_days` (14); other types have no age limit;
- the user has no `read` or `not_interested` event for it.

`score = priority x interest x fit x quality / 4`. `priority` is `(6 - r) / 5` for focus rank `r` and
`background_priority` (0.1) for background skills; `interest` is the user's per-skill weight (1.0 at the start);
`fit` is `fit_next` (1.0) for difficulty `t+1`, `fit_same` (0.8) for `t` and `fit_stretch` (0.5) for the rest of
the band. Order: score descending, then newest first, then id (so paging is stable). `page_size` (20) cards per
page; "Load more" asks for the next offset (cards served so far minus the ones read or dismissed since, which the
server no longer ranks). All constants are in `data/config.yml`. Redoing the quiz for a skill
resets its difficulty offset for good: feedback recorded before the latest quiz answer for that skill no longer
counts.

## Feedback

Feedback applies to the article's primary skill, only to skills that exist after onboarding (a user who has not
onboarded has events recorded but no skill effects).

- **Read** (only the Read button records it, and it opens the article in a new tab; clicking the title just opens the
  article and records nothing): the article leaves the
  feed. On screen the card collapses to a strip "Read ✓ · 👍 · Too easy · Too hard", so feedback can still be given
  after reading; it is gone on the next page load. If the article's difficulty is at or above the user's level,
  the skill gets +1 point; `points_per_level` (5) points give +1 level (cap 4) and reset points.
- **👍**: no ranking effect. The share of 👍 among read articles is the quality metric, shown on the Profile.
- **Too easy / Too hard**: `difficulty_offset = clamp(round((too_easy - too_hard) / offset_k), -1, +1)`, recomputed
  from that skill's events after each click (`offset_k` is 3).
- **Not interested**: `interest = max(interest x interest_decay, interest_min)` (0.8 and 0.2); the card leaves the feed.

Every click is idempotent per user, article and kind: repeating it changes nothing.

## Local demo without API keys

Labeling needs a Gemini or Anthropic API key; the demo does not.

1. Start Postgres: `docker compose up -d --wait`, or any local Postgres 17 at `DATABASE_URL`.
2. `pnpm attn migrate`, then `pnpm attn seed-demo` (labeled demo articles under `https://example.com/demo/...`).
3. Run `pnpm api` and `pnpm web`, and sign in (needs GitHub OAuth credentials), or run `bash scripts/smoke.sh`,
   which creates a throwaway user and session, exercises the whole For you loop through the api and prints nine
   `ok:` lines. `API_PORT` (default 3001) picks the api port and the script refuses a port that is in use;
   `KEEP=1` keeps the smoke user and demo articles. The smoke user has the negative `github_id` -999001 (GitHub never
   issues negative ids) and is deleted afterwards; still, never run smoke against a shared or production DB.
4. Clean up with `pnpm attn seed-demo --remove`. The smoke script removes only demo articles it inserted itself, so
   after step 2 (where the demo articles already exist) it removes none and this step is yours.

## MVP done-criteria and hand-off

The MVP is done when the owner judges that ATTN covers their own use case. Then `~/Projects/ai-news` is archived
and its scheduled task disabled, not before. This repo does not do that.

Verifiably done in this repo: collect, label, eval, onboarding and quiz, For you, feedback, Profile. A CI workflow
(`.github/workflows/ci.yml`) is configured but has never run: the repo has no remote yet.

Owner hand-off:

- Choose `LABEL_MODEL` from `attn eval` results against `data/golden/draft.yml` (the accepted Claude-drafted
  reference) and set it in `.env`.
- Review the quiz DRAFT using [docs/quiz-owner-review.md](docs/quiz-owner-review.md).
- Set GitHub OAuth credentials and do a real sign-in round trip (never exercised here).
- Build the Docker images (never built in the authoring environment).
- Push to GitHub and see CI green.
- Decide on openai-news (dropped: Cloudflare 403, see Known limitations).
- Run ATTN for a trial period, then archive the old `ai-news` repo and disable its scheduled task (owner's call).

## Known limitations

- OpenAI News is not a source. openai.com article pages sit behind a Cloudflare managed challenge (HTTP 403) for
  the honest `attn-collector` User-Agent, and spoofing a browser is not an option. Its RSS blurbs (median 149
  characters) are also below `label_min_chars` (500), so they could not be labeled.
- JetBrains AI blog is not a source. blog.jetbrains.com (pages and feed) answers the honest `attn-collector`
  User-Agent with an AWS WAF bot challenge (HTTP 202, `x-amzn-waf-action: challenge`) as of 2026-10-15.

## License

MIT
