# ATTN

ATTN is a public website with a personal feed of AI articles. A user signs in, picks focus skills, takes a
situational quiz, and ATTN ranks existing articles by skill priority and skill level, not by topic alone.
It is curation only: links to existing articles, no generated content.

## Status

Stage 2 of 5: extract, label, eval and the daily job. Built: the monorepo, validated YAML data, the Postgres
schema, `attn collect` (RSS, Atom and sitemap sources with conditional GET, URL normalization and
deduplication), article text extraction, LLM labeling (`attn label`), model evaluation against a golden set
(`attn eval`) and a small API skeleton that runs collect then label daily. Ranking, levels, auth, the
endpoints and the web app are planned.

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

`attn collect` prints one line per source and a totals line. A failing source is recorded in
`source_state.last_error` and does not stop the others.

## Layout

```
data/                YAML validated by zod schemas from packages/shared
packages/shared      zod schemas
packages/core        db/, collect/, extract/, label/, pipeline/, eval/, data loading, cli.ts
                     (rank/, levels/ are planned)
docker-compose.yml   postgres (api and web services are planned)
apps/api             NestJS skeleton: health endpoint and the daily job (auth and endpoints: Stage 3)
apps/web             planned
```

## Data files

- `data/taxonomy.yml`: Role, Domain and Skill tree with the 0-4 level scale and a version.
- `data/sources.yml`: the 13 first-party sources (`rss` or `sitemap`), with optional filters.
- `data/config.yml`: the single place for tunable numbers (backfill window, label limits, thresholds, feed settings).
- `data/quiz/`: quiz question bank; planned, empty for now.
- `data/golden/`: hand-labeled articles for `attn eval`. It holds `draft.yml` for now (see Evaluation).

## Labeling

`attn label` needs `LABEL_MODEL` and `GOOGLE_GENERATIVE_AI_API_KEY` in `.env`. Without them it exits 1 and names
the missing variable.

It takes pending articles oldest first (at most `label_batch`, or `--limit` if smaller), one at a time with
`label_delay_ms` between model calls. For each article it fetches the page, extracts the readable text and
keeps it in memory only; just `word_count` is stored. A page that cannot be fetched or yields fewer than
`label_min_chars` characters (paywall, JS-only page, PDF) becomes `failed` and is retried on later runs until
`label_max_attempts`. If the provider answers 429, the run ends and the remaining articles stay `pending`.

Output: one line per article, `<outcome>  <url>[  <error>]`, then
`total: selected=<n> labeled=<n> failed=<n> rate_limited=<yes|no>`.

Privacy invariant: only the article `title`, `url` and public article text go to the model, and the `Labeler`
type has no place for user data (quiz answers, levels, user ids). This is enforced by types and tests.

### Daily job

The API (`pnpm api`) runs collect and then label at `schedule_cron` (UTC, from `data/config.yml`) under a
Postgres advisory lock, so two instances never run it at once. `SCHEDULE_ENABLED=false` disables it. Without
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
