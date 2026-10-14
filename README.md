# ATTN

ATTN is a public website with a personal feed of AI articles. A user signs in, picks focus skills, takes a
situational quiz, and ATTN ranks existing articles by skill priority and skill level, not by topic alone.
It is curation only: links to existing articles, no generated content.

## Status

Stage 3 of 5: website + auth. Built: GitHub sign-in (session cookie), the public articles API
(`/api/articles`, `/api/sources`, `/api/taxonomy`) and the Next.js site (landing page and the public All list
with source, skill and date filters). Earlier stages: the monorepo, validated YAML data, the Postgres
schema, `attn collect` (RSS, Atom and sitemap sources with conditional GET, URL normalization and
deduplication), article text extraction, LLM labeling (`attn label`), model evaluation against a golden set
(`attn eval`) and the API job that runs collect then label daily. Onboarding, ranking, levels and the personal
feed are planned.

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
| `pnpm attn eval --model <id>` | Measure a model against the golden set; writes nothing to the DB (see Evaluation) |
| `pnpm api` | Start the API on `PORT` (default 3001); `GET /api/health`; runs the daily job |
| `pnpm web` | Start the Next.js site in dev mode on port 3000; rewrites `/api/*` to `API_URL` (default `http://localhost:3001`) |

`attn collect` prints one line per source and a totals line. A failing source is recorded in
`source_state.last_error` and does not stop the others.

## Layout

```
data/                YAML validated by zod schemas from packages/shared
packages/shared      zod schemas
packages/core        db/, collect/, extract/, label/, pipeline/, eval/, data loading, cli.ts
                     (rank/, levels/ are planned)
docker-compose.yml   postgres, api, web
apps/api             NestJS: auth (GitHub OAuth, sessions), articles, sources/taxonomy, health, the daily job
apps/web             Next.js app router site: landing page and the public All list
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
- `GET /api/articles?source=&skill=&from=&to=&cursor=&limit=`: labeled articles, newest first, cursor pagination
- `GET /api/sources`
- `GET /api/taxonomy`

## Docker

`docker compose up --build` starts postgres, api and web, and serves the site on http://localhost:3000. The
Dockerfiles have not been built in the authoring environment (image pulls were broken there), so treat them as
untested. The api container applies migrations on start and also runs the daily collect+label job. The compose
site is plain http on localhost, so set `COOKIE_SECURE=false` in `.env` (compose passes it through). The api is
not published on the host; the browser reaches it only through the web proxy.

## Data files

- `data/taxonomy.yml`: Role, Domain and Skill tree with the 0-4 level scale and a version.
- `data/sources.yml`: the 13 first-party sources (`rss` or `sitemap`), with optional filters.
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

`attn label` needs `LABEL_MODEL` and `GOOGLE_GENERATIVE_AI_API_KEY` in `.env`. Without them it exits 1 and names
the missing variable.

It takes pending articles oldest first (at most `label_batch`, or `--limit` if smaller), one at a time with
`label_delay_ms` between model calls. For each article it fetches the page, extracts the readable text and
keeps it in memory only; just `word_count` is stored. A page that cannot be fetched or yields fewer than
`label_min_chars` characters (paywall, JS-only page, PDF) becomes `failed` and is retried on later runs until
`label_max_attempts`. If the provider answers 429, the run ends and the remaining articles stay `pending`.
A bad or missing API key (401/403) or an unknown model id (404) is fatal: the run stops at once without
changing that article's status or attempts, `attn label` prints the provider error and exits 1, and the API job
logs it at error level. `attn eval` stops the same way and exits 1 with the partial report; it also exits 1 when
not a single article could be scored.

`attn collect` and `attn label` take the same Postgres advisory lock as the daily job. If another run holds it,
they print `another collect/label run is in progress` and exit 1.

Output: one line per article, `<outcome>  <url>[  <error>]`, then
`total: selected=<n> labeled=<n> failed=<n> rate_limited=<yes|no>`.

Privacy invariant: only the article `title`, `url` and public article text go to the model, and the `Labeler`
type has no place for user data (quiz answers, levels, user ids). This is enforced by types and tests, and
`packages/core/src/levels/privacy.test.ts` scans the sources and fails if user data reaches the LLM path.

### Daily job

The API (`pnpm api`) runs collect and then label at `schedule_cron` (UTC, from `data/config.yml`) under a
Postgres advisory lock, so two instances never run it at once, and neither does a manual `attn collect` / `attn label` alongside it. `SCHEDULE_ENABLED=false` disables it. Without
`LABEL_MODEL` or the API key the label step is reported as skipped.

## Evaluation

`LABEL_MODEL` has no default on purpose and is left empty in `.env.example`: the model is chosen only by eval
results, and an empty value never silently selects an unevaluated model.

**The golden set is a draft.** `data/golden/draft.yml` was drafted by Claude, not by the project owner. Review
it (fix or delete wrong items, then remove the header comment) before trusting any score or making a model
choice.

### What it is

`attn eval` measures a model against the hand-labeled golden set in `data/golden/*.yml`. It writes nothing to
the DB, needs the API key, and never runs in CI. Automated tests never call an LLM; eval is the only place
label quality is measured.

### Get a key and run it

1. Create a free API key in Google AI Studio (https://aistudio.google.com/apikey) and put it in `.env` as
   `GOOGLE_GENERATIVE_AI_API_KEY`. The free tier is enough; limits are shown per project in AI Studio, and the
   free tier may use submitted content to improve Google products, which is fine here because only public
   article text is sent.
2. Run:

```sh
pnpm attn eval --model gemini-3.6-flash
```

The first run fetches each article once and caches the extracted text in `.cache/text/` (gitignored), so later
runs, and other models, see identical input. Delete a cache file (or the folder) to force a refetch. The run
sleeps `label_delay_ms` between calls; on a provider 429 it stops, prints the partial report and exits 1.

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
```

The numbers are illustrative.

- `primary_skill`: share of articles where the primary skill matches exactly.
- `secondary_skills`: mean Jaccard overlap of predicted and expected sets (both empty counts as 1).
- `difficulty_exact`, `difficulty_within1`: difficulty equal, or within +-1.
- `type`: exact match.
- `quality_within1`: quality within +-1.
- `evaluated=n of total` and `failed:`: articles whose text could not be fetched or was too short are listed
  and excluded from the percentages.
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

Compare the six lines and the disagreement lists, then set the winner as `LABEL_MODEL` in `.env`. Because the
text cache is shared, the comparison is on identical text. Prompt or taxonomy changes also move the scores, so
re-run all candidates after such a change.

## Known limitations

- OpenAI News is not a source. openai.com article pages sit behind a Cloudflare managed challenge (HTTP 403) for
  the honest `attn-collector` User-Agent, and spoofing a browser is not an option. Its RSS blurbs (median 149
  characters) are also below `label_min_chars` (500), so they could not be labeled.

## License

MIT
