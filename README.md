# ATTN

ATTN is a public website with a personal feed of AI articles. A user signs in, picks focus skills, takes a
situational quiz, and ATTN ranks existing articles by skill priority and skill level, not by topic alone.
It is curation only: links to existing articles, no generated content.

## Status

Stage 1 of 5: foundation + collect. The monorepo, validated YAML data, the Postgres schema and
`attn collect` (RSS, Atom and sitemap sources with conditional GET, URL normalization and deduplication)
are built. Labeling, ranking, levels, the API and the web app are planned.

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

`attn collect` prints one line per source and a totals line. A failing source is recorded in
`source_state.last_error` and does not stop the others.

## Layout

```
data/                YAML validated by zod schemas from packages/shared
packages/shared      zod schemas
packages/core        db/, collect/, data loading, cli.ts
                     (extract/, label/, rank/, levels/, eval/ are planned)
docker-compose.yml   postgres (api and web services are planned)
apps/api, apps/web   planned
```

## Data files

- `data/taxonomy.yml`: Role, Domain and Skill tree with the 0-4 level scale and a version.
- `data/sources.yml`: the 13 first-party sources (`rss` or `sitemap`), with optional filters.
- `data/config.yml`: the single place for tunable numbers (backfill window, label limits, thresholds, feed settings).
- `data/quiz/` and `data/golden/`: quiz question bank and hand-labeled articles; planned, empty for now.

## Evaluation

Coming in Stage 2: how to run `attn eval`, read the report, add golden items, compare models.

## Known limitations

- OpenAI News is not a source. openai.com article pages sit behind a Cloudflare managed challenge (HTTP 403) for
  the honest `attn-collector` User-Agent, and spoofing a browser is not an option. Its RSS blurbs (median 149
  characters) are also below `label_min_chars` (500), so they could not be labeled.

## License

MIT
