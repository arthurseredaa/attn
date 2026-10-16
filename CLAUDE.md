# ATTN

Personal feed of AI articles: collect (RSS/Atom/sitemap) → LLM labeling by skill/level → ranked "For you" feed.
Curation only, no generated content. README.md is the full manual; `docs/decisions.md` records why things are the
way they are. Read the relevant section there before changing collect, labeling, ranking or the quiz.

## Layout

pnpm monorepo, TypeScript, Node 24 (ESM).

- `packages/shared` zod schemas and shared types (API contracts, data file schemas). Change contracts here first.
- `packages/core` db (drizzle + postgres), collect, extract, label, eval, rank, levels, pipeline, `cli.ts` (`pnpm attn`).
- `apps/api` NestJS: auth (GitHub OAuth, sessions), articles, feed, events, onboarding, profile, the daily job.
- `apps/web` Next.js app router + Tailwind + shadcn (`src/components/ui`).
- `data/` YAML validated by the shared zod schemas. Tunable numbers live in `data/config.yml`, not in code.
- `docs/superpowers/{specs,plans}` design specs and implementation plans; `plans/` ideas for future features.

## Commands

- `pnpm lint` (oxlint), `pnpm format` / `pnpm format:check` (oxfmt), `pnpm typecheck`, `pnpm test` (vitest).
- One package or file: `pnpm exec vitest run packages/core/src/rank/`.
- DB tests and `pnpm attn` need Postgres on localhost:5432 (`docker compose up -d --wait postgres`, or the owner's
  local Homebrew service). Tests use the `attn_test` database
  (`TEST_DATABASE_URL`), created on demand by the test helper.

Area-specific rules load on demand from `.claude/rules/` (db, web, data).

## Rules

- Secrets only in `.env` (see `.env.example`); never read or print it.
- `pnpm attn label` and `pnpm attn eval` call paid LLM APIs: ask before running them.
- Dependencies only through `pnpm add/remove`; never edit `pnpm-lock.yaml`.
- Commits: conventional style with scope, e.g. `feat(web): ...`, `fix(data): ...`, `docs(plan): ...`.
- CI (`.github/workflows/ci.yml`) runs format:check, lint, typecheck, test against Postgres 17.

## Claude Code hooks (.claude/)

- After every Edit/Write: `oxlint --fix` + `oxfmt` on that file; lint errors that remain come back to you.
- On Stop: if TS/JS files have uncommitted changes, `pnpm typecheck` + `pnpm lint` must pass or the turn continues.
- Bash commands that name `.env` are blocked.
