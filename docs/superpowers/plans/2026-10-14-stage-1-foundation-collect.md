# ATTN Stage 1: Foundation + Collect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pnpm TypeScript monorepo with validated YAML data (taxonomy, 14 sources, config), the full Postgres schema, and a working `pnpm attn collect` that pulls RSS/Atom/sitemap sources into `articles` with conditional GET, URL normalization and deterministic dedup.

**Architecture:** `packages/shared` holds zod schemas only. `packages/core` holds plain modules (`db/`, `collect/`, `data.ts`, `cli.ts`), no HTTP framework. Packages export TypeScript source directly (no build step); `tsx` runs the CLI, `vitest` runs tests. DB-touching tests run against a real Postgres from docker compose. Collectors take an injectable `fetch`, so tests use a local `http.createServer` and fixtures, never the network.

**Tech Stack:** Node 24, pnpm workspaces, TypeScript, vitest, eslint (typescript-eslint), zod 4, `yaml`, Drizzle ORM + drizzle-kit + `postgres` driver, `fast-xml-parser`, `cheerio` (og:title), `tsx`, Postgres 17 via docker compose.

**Spec:** `docs/superpowers/specs/2026-10-14-attn-design.md` (binding; wins over `docs/decisions.md`). Stage 1 = spec §9 item 1.

## Global Constraints

Every task's requirements implicitly include this section. Values are copied from the spec.

- pnpm monorepo, TypeScript everywhere, vitest throughout. Everything in English. Code written from scratch; `~/Projects/ai-news` is read-only data source only. Repo is public, MIT license.
- Layout: `data/` (YAML), `packages/shared` (zod schemas), `packages/core` (plain modules, no NestJS, no HTTP knowledge), `docker-compose.yml`. `apps/api` and `apps/web` do NOT exist in this stage.
- LLM work is NOT in this stage. No LLM calls, no AI SDK dependency.
- Level scale 0-4: 0 never touched it; 1 basic use; 2 regular practice; 3 advanced, customizes it; 4 builds it / expert. Used by quiz options and article difficulty.
- Taxonomy: 6 domains, 32 skills, translated to English; each skill has `id`, `name`, `description`, `roles: [dev, ...]`; skill ids stay stable (copy exactly); file has a `version`.
- Sources are first-party only, exactly 14: rss = claude-dev, mozilla-ai-blog, mcp-blog, vercel, github-blog-ai, openai-news, simon-willison, latent-space, addy-osmani, hamel-evals, ai-hero, cloudflare-ai; sitemap with `path_prefix` = anthropic-news (`/news/`), anthropic-engineering (`/engineering/`). No changelogs, GitHub releases, md-diff, aggregators.
- Postgres tables (Drizzle), all in this stage: users, sessions, source_state, articles, article_skills, user_skills, quiz_answers, article_events, with the columns in spec §3.2. Full article text is never stored.
- Collect: per-source conditional GET with ETag / Last-Modified stored in `source_state`; a failing source writes `last_error` and does not stop the others. rss: url, guid, title, published_at from each entry (RSS and Atom). sitemap: URLs under `path_prefix` with `lastmod`; for NEW URLs only, fetch the page for `og:title` / `<title>`.
- URL normalization: lowercase host, drop `utm_*`, `ref`, `fbclid` and the fragment, drop trailing `/`.
- Dedup (deterministic; no LLM, no embeddings): on insert, skip the entry if an article with the same normalized `url`, or same `guid`, or same `title_hash` + publication date already exists.
- First run collects entries no older than `backfill_days`.
- `data/config.yml` keys (zod-validated, every one required): `backfill_days`, `label_batch`, `label_delay_ms`, `label_max_chars`, `label_min_chars`, `label_max_attempts`, `schedule_cron`, `uncertain_spread`, `points_per_level`, `offset_k`, `interest_decay`, `interest_min`, `quality_min`, `background_quality_min`, `fresh_days`, `page_size`. Spec-stated values: `points_per_level` 5, `interest_decay` 0.8, `interest_min` 0.2, `quality_min` 2, `background_quality_min` 4, `fresh_days` 14, `page_size` 20.
- Secrets only in env; `.env.example` has exactly: `DATABASE_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_GENERATIVE_AI_API_KEY`, `LABEL_MODEL`, `APP_URL`.
- CI (GitHub Actions): lint, typecheck, tests with a Postgres service.
- Working style: change only what the task asks; commit per task; do not claim success without running the verify command and seeing its output.

## Decisions on points the spec leaves open (binding for this plan)

- `title_hash` = sha256 hex of the title lowercased, HTML-entity-decoded, with every non-alphanumeric run collapsed to one space, trimmed. "Same publication date" = same UTC calendar day of `published_at`.
- `guid` dedup is scoped per source (`source_id` + `guid`), because guids are only unique within a feed. A missing guid is stored as the normalized url.
- `articles.published_at` is NOT NULL: if an entry has no usable date, use `collected_at` (now). Sitemap `lastmod` stands in for the publication date.
- If a sitemap page fetch (og:title) fails for a new URL, insert the article anyway with a title derived from the URL slug (so a 304/unchanged sitemap never leaves it stranded).
- `source_state` ETag/Last-Modified are saved only after a source was processed successfully; on error only `last_error`/`last_run_at` change.
- Sources may carry an optional `filter` (`path_prefix`, `exclude_path_prefix`, `keywords`) carried over from ai-news for `vercel` and `ai-hero` (otherwise Vercel's feed is mostly non-AI). It is a small pure function in collect.
- Test database is a separate database `attn_test` on the same compose Postgres; vitest runs core test files serially.
- `attn migrate` is part of the CLI (needed to apply migrations outside tests).

## Review Focus

Inputs the spec implies but a happy-path suite would miss. Each has a test in the named task.

1. One feed returns malformed XML / HTTP 500 / times out: other sources must still be collected and the failure recorded in `last_error` (Task 9).
2. Entries with no title, no link, a non-http(s) link (`mailto:`, `javascript:`), or an unparsable URL: skipped, never crash the run (Tasks 7, 9).
3. Same article reached via `?utm_source=x`, `#section`, trailing slash, uppercase host, or re-seen on the next run: exactly one row (Tasks 6, 9).
4. Server answers 304 or ignores conditional headers and returns the full feed again: no duplicate rows, no error (Tasks 8, 9).
5. Titles/links wrapped in CDATA or containing HTML entities, Atom entries with multiple `<link rel=...>`, RSS `<guid isPermaLink="false">`, entries with a future or missing date (Task 7).

---

### Task 1: Monorepo scaffold, TypeScript, vitest, eslint

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, `.gitignore`, `.nvmrc`, `LICENSE` (MIT, holder "Arthur Sereda", year 2026)
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`, `packages/core/src/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: workspace packages `@attn/shared` and `@attn/core` (both `"type": "module"`, `"exports": "./src/index.ts"`, consumed as TS source). Root scripts: `lint`, `typecheck`, `test`, `attn` (`tsx packages/core/src/cli.ts`, the file is created in Task 10; do not create it now). Root `vitest.config.ts` uses `test.projects` or a plain `include: ['packages/*/src/**/*.test.ts']` with `fileParallelism: false`.

- [ ] **Step 1: Initialize the workspace.** `git status` must be clean first. Create root `package.json` with `"private": true`, `"type": "module"`, `"packageManager": "pnpm@10.3.0"`, `"engines": {"node": ">=24"}`, `"pnpm": {"onlyBuiltDependencies": ["esbuild"]}` and the scripts: `"lint": "eslint ."`, `"typecheck": "tsc -b"` (or `tsc --noEmit -p` per package; pick one that works with project references or a single root tsconfig including `packages/*/src`), `"test": "vitest run"`, `"attn": "tsx packages/core/src/cli.ts"`. `pnpm-workspace.yaml`: `packages: ['packages/*', 'apps/*']`. `.nvmrc`: `24`. `.gitignore`: `node_modules`, `.env`, `.cache/`, `dist/`, `*.tsbuildinfo`, `.DS_Store`, `coverage/`.
- [ ] **Step 2: Install dev dependencies at current stable versions.** Run `pnpm add -Dw typescript vitest eslint @eslint/js typescript-eslint tsx @types/node`. If pnpm reports a peer conflict between `typescript` and `typescript-eslint`, pin `typescript` to the highest version that satisfies typescript-eslint's peer range and note it in the commit message. Run `pnpm view <pkg> version` to see what is current if unsure.
- [ ] **Step 3: tsconfig.** `tsconfig.base.json`: `target ES2023`, `module ESNext`, `moduleResolution Bundler`, `strict true`, `noUncheckedIndexedAccess true`, `noEmit true`, `skipLibCheck true`, `verbatimModuleSyntax true`, `types: ["node"]`. Each package tsconfig extends it and `include: ["src"]`. Root `tsconfig.json` has `files: []` and `references` to both packages if you use `tsc -b`; with `noEmit` + `composite` conflicts, simpler is root `typecheck` = `pnpm -r exec tsc --noEmit`. Choose the one that actually passes.
- [ ] **Step 4: Packages.** `@attn/shared` and `@attn/core` `package.json`: `name`, `version 0.0.0`, `private true`, `type module`, `exports {".": "./src/index.ts"}`. `core` depends on `"@attn/shared": "workspace:*"`. `shared/src/index.ts`: `export {};`. `core/src/index.ts`: `export {};`.
- [ ] **Step 5: eslint flat config.** `eslint.config.js` using `typescript-eslint` recommended + `@eslint/js` recommended, ignoring `node_modules`, `.cache`, `**/drizzle/**` (generated SQL/meta), `dist`. Rule: `@typescript-eslint/no-unused-vars` error with `argsIgnorePattern: '^_'`.
- [ ] **Step 6: Write smoke test.** `packages/core/src/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
describe('workspace', () => {
  it('runs vitest', () => { expect(1 + 1).toBe(2); });
});
```

`vitest.config.ts`: `defineConfig({ test: { include: ['packages/*/src/**/*.test.ts'], fileParallelism: false } })`.
- [ ] **Step 7: Verify.** Run `pnpm install && pnpm lint && pnpm typecheck && pnpm test`. Expected: all exit 0; vitest reports 1 passed.
- [ ] **Step 8: Commit.**

```bash
git add -A
git commit -m "chore: pnpm monorepo scaffold with typescript, vitest, eslint"
```

---

### Task 2: Docker compose, .env.example, CI workflow

**Files:**
- Create: `docker-compose.yml`, `.env.example`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: root scripts `lint`, `typecheck`, `test` from Task 1.
- Produces: a Postgres reachable at `postgres://attn:attn@localhost:5432/attn` (dev) and `postgres://attn:attn@localhost:5432/attn_test` (tests; created on demand by the test helper in Task 5). Env var `TEST_DATABASE_URL` (defaults to the latter in code). CI provides the same Postgres via a service container.

- [ ] **Step 1: docker-compose.yml.** One service `postgres` (image `postgres:17-alpine`), env `POSTGRES_USER=attn`, `POSTGRES_PASSWORD=attn`, `POSTGRES_DB=attn`, port `5432:5432`, named volume `pgdata`, healthcheck `pg_isready -U attn -d attn` (interval 2s, retries 30). Add a top comment: api and web services are added in Stage 3 (host-agnostic compose).
- [ ] **Step 2: .env.example** with exactly these keys and placeholder values (comment lines allowed):

```
DATABASE_URL=postgres://attn:attn@localhost:5432/attn
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GOOGLE_GENERATIVE_AI_API_KEY=
LABEL_MODEL=
APP_URL=http://localhost:3000
```

- [ ] **Step 3: CI.** `.github/workflows/ci.yml`: trigger `push` and `pull_request`; one job on `ubuntu-latest` with `services.postgres` (image `postgres:17-alpine`, same env, port 5432, health options `--health-cmd "pg_isready -U attn" --health-interval 2s --health-retries 30`); steps: `actions/checkout`, `pnpm/action-setup` (version from `packageManager`), `actions/setup-node` with `node-version-file: .nvmrc` and `cache: pnpm`, `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`. Job-level env `DATABASE_URL: postgres://attn:attn@localhost:5432/attn` and `TEST_DATABASE_URL: postgres://attn:attn@localhost:5432/attn_test`. Use current major versions of the actions (check their latest tags).
- [ ] **Step 4: Verify.** Run `docker compose up -d --wait` then `docker compose ps` (postgres `healthy`) and `docker compose exec postgres psql -U attn -d attn -c 'select 1'` (prints 1). Validate YAML syntax: `docker compose config -q` exits 0 and `pnpm dlx yaml-lint .github/workflows/ci.yml` or `node -e "require('yaml')"`-style parse (any parse check; show output).
- [ ] **Step 5: Commit.**

```bash
git add docker-compose.yml .env.example .github
git commit -m "chore: docker compose postgres, env example, CI workflow"
```

---

### Task 3: Shared zod schemas and YAML loaders

**Files:**
- Create: `packages/shared/src/taxonomy.ts`, `sources.ts`, `config.ts`, `quiz.ts`, `golden.ts`; modify `packages/shared/src/index.ts` to re-export all
- Create: `packages/shared/src/schemas.test.ts`
- Create: `packages/core/src/data.ts`, `packages/core/src/data.test.ts`; modify `packages/core/src/index.ts`
- Modify: `packages/shared/package.json`, `packages/core/package.json` (deps)

**Interfaces:**
- Consumes: workspace from Task 1.
- Produces (from `@attn/shared`):
  - `levelSchema = z.number().int().min(0).max(4)`
  - `taxonomySchema` → `Taxonomy`: `{ version: number; levels: {level:0..4,label:string,description:string}[] (exactly 5, levels 0..4); domains: {id,name,skills:{id,name,description,roles:string[] (min 1)}[]}[] }`; refine: skill ids unique across the file, domain ids unique.
  - `sourceSchema` → `Source` = discriminated union on `type`: `{id,name,type:'rss',url,filter?}` | `{id,name,type:'sitemap',url,path_prefix,filter?}`; `filter?: {path_prefix?: string[]; exclude_path_prefix?: string[]; keywords?: string[]}`; `sourcesSchema = z.array(sourceSchema)` with unique ids; `Source` type exported.
  - `configSchema` → `Config` with the 16 keys from Global Constraints (strict: unknown keys rejected; numbers positive/int where sensible; `interest_decay` and `interest_min` in (0,1]; `schedule_cron` non-empty string).
  - `quizSchema` → `{ version:number; questions:{id,skill_id,situation,options:{text,level}[] (4..6)}[] }`; `goldenItemSchema`/`goldenSchema` → array of `{url (url), primary_skill, secondary_skills (max 3, default []), difficulty, type: 'release'|'tutorial'|'deep_dive'|'news'|'research', quality}`.
  - `articleTypeSchema` (the 5-value enum).
- Produces (from `@attn/core`, `data.ts`): `dataDir(): string` (repo-root `data/`, resolved via `import.meta.url`, overridable by env `ATTN_DATA_DIR`), `loadTaxonomy(dir?)`, `loadSources(dir?)`, `loadConfig(dir?)`, each returning parsed+validated values and throwing an Error whose message names the file and the zod issues.

- [ ] **Step 1: Install deps.** `pnpm --filter @attn/shared add zod` and `pnpm --filter @attn/core add yaml`.
- [ ] **Step 2: Write failing schema tests** in `packages/shared/src/schemas.test.ts`. Cover: valid minimal taxonomy parses; duplicate skill id rejected; skill with empty `roles` rejected; sitemap source without `path_prefix` rejected; rss source with unknown `type` rejected; duplicate source ids rejected; config missing one key rejected, config with an extra key rejected; golden item with `difficulty: 5` rejected; quiz question with 3 options rejected. Example:

```ts
import { describe, it, expect } from 'vitest';
import { sourcesSchema, configSchema } from './index';
describe('sourcesSchema', () => {
  it('requires path_prefix for sitemap', () => {
    const r = sourcesSchema.safeParse([{ id: 'a', name: 'A', type: 'sitemap', url: 'https://x.test/s.xml' }]);
    expect(r.success).toBe(false);
  });
  it('rejects duplicate ids', () => {
    const s = { id: 'a', name: 'A', type: 'rss', url: 'https://x.test/f' };
    expect(sourcesSchema.safeParse([s, s]).success).toBe(false);
  });
});
```

- [ ] **Step 3: Run** `pnpm test` → FAIL (modules missing).
- [ ] **Step 4: Implement the schemas** per the Interfaces block; export inferred types (`z.infer`). Re-export from `index.ts`.
- [ ] **Step 5: Write failing loader test** `packages/core/src/data.test.ts` using a temp dir (`fs.mkdtempSync(os.tmpdir()…)`) with small YAML files written in the test: `loadSources` returns parsed array; `loadConfig` on a file with a bad value throws an error whose message contains `config.yml`; env `ATTN_DATA_DIR` is honored by `dataDir()`.
- [ ] **Step 6: Implement `data.ts`.** Read with `fs.readFileSync`, parse with `yaml` (`parse`), validate with the schema, wrap failures: `throw new Error(\`${file}: ${result.error.message}\`)`. `dataDir()` default: `path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data')`. Export from `index.ts`.
- [ ] **Step 7: Verify.** `pnpm lint && pnpm typecheck && pnpm test` all green.
- [ ] **Step 8: Commit.**

```bash
git add -A
git commit -m "feat(shared,core): zod schemas for yaml data and validating loaders"
```

---

### Task 4: Data carry-over (taxonomy, sources, config)

**Files:**
- Create: `data/taxonomy.yml`, `data/sources.yml`, `data/config.yml`, `data/quiz/.gitkeep`, `data/golden/.gitkeep`
- Create: `packages/core/src/data.real.test.ts`

**Interfaces:**
- Consumes: `loadTaxonomy`, `loadSources`, `loadConfig`, `dataDir` from `@attn/core` (Task 3); schemas from `@attn/shared`.
- Produces: the real data files the CLI (Task 10) loads; a test that guards them.

- [ ] **Step 1: Write the failing guard test** `packages/core/src/data.real.test.ts` (uses the real `data/`):

```ts
import { describe, it, expect } from 'vitest';
import { loadTaxonomy, loadSources, loadConfig } from './data';

describe('real data files', () => {
  it('taxonomy: 6 domains, 32 skills, all dev, 5 levels, English-only', () => {
    const t = loadTaxonomy();
    expect(t.domains).toHaveLength(6);
    const skills = t.domains.flatMap((d) => d.skills);
    expect(skills).toHaveLength(32);
    expect(skills.every((s) => s.roles.includes('dev'))).toBe(true);
    expect(t.levels.map((l) => l.level)).toEqual([0, 1, 2, 3, 4]);
    const text = JSON.stringify(t);
    expect(text).not.toMatch(/[Ѐ-ӿ]/); // no Cyrillic left
  });
  it('sources: exactly the 14 first-party ids', () => {
    const ids = loadSources().map((s) => s.id).sort();
    expect(ids).toEqual([
      'addy-osmani','ai-hero','anthropic-engineering','anthropic-news','claude-dev','cloudflare-ai',
      'github-blog-ai','hamel-evals','latent-space','mcp-blog','mozilla-ai-blog','openai-news',
      'simon-willison','vercel',
    ]);
  });
  it('config: loads and matches spec-stated values', () => {
    const c = loadConfig();
    expect(c).toMatchObject({ points_per_level: 5, interest_decay: 0.8, interest_min: 0.2,
      quality_min: 2, background_quality_min: 4, fresh_days: 14, page_size: 20 });
  });
});
```

- [ ] **Step 2: Run** `pnpm test` → FAIL (files missing).
- [ ] **Step 3: taxonomy.yml.** Source: `~/Projects/ai-news/taxonomy.yml` (read-only, do not modify). Copy the structure and ALL skill and domain `id`s exactly (6 domains, 32 skills). Translate every domain `name` and every skill `name` and `description` from Ukrainian to natural English; keep product/technical terms (CLAUDE.md, MCP, RAG, PreToolUse, etc.) unchanged. Do not translate ids. Set `version: 1` (new file, new numbering). Add `roles: [dev]` to every skill. Add a top-level `levels:` list of 5 entries with `level`, `label`, `description` using the scale: 0 never touched it; 1 basic use; 2 regular practice; 3 advanced, customizes it; 4 builds it / expert. Top-level key order: `version`, `levels`, `domains`.
- [ ] **Step 4: sources.yml.** Write a list of exactly these 14 entries (fields `id, name, type, url`, plus `path_prefix` for sitemaps, plus `filter` where shown). Feed URLs are taken from ai-news's sources.yml:

| id | name | type | url | extra |
|---|---|---|---|---|
| claude-dev | claude.dev | rss | https://claude.dev/rss.xml | |
| anthropic-news | Anthropic News | sitemap | https://www.anthropic.com/sitemap.xml | path_prefix: /news/ |
| anthropic-engineering | Anthropic Engineering | sitemap | https://www.anthropic.com/sitemap.xml | path_prefix: /engineering/ |
| mozilla-ai-blog | Mozilla.ai blog | rss | https://blog.mozilla.ai/rss/ | |
| mcp-blog | MCP blog | rss | https://blog.modelcontextprotocol.io/index.xml | |
| vercel | Vercel | rss | https://vercel.com/atom | filter.path_prefix: [/blog/, /changelog/]; filter.keywords: [ai, llm, llms, agent, agents, agentic, mcp, claude, openai, gpt, gemini, ai sdk, ai gateway, v0, inference, embeddings, rag, prompt] |
| github-blog-ai | GitHub Blog - AI & ML | rss | https://github.blog/ai-and-ml/feed/ | |
| openai-news | OpenAI News | rss | https://openai.com/news/rss.xml | |
| simon-willison | Simon Willison | rss | https://simonwillison.net/atom/everything/ | |
| latent-space | Latent Space | rss | https://www.latent.space/feed | |
| addy-osmani | Addy Osmani | rss | https://addyo.substack.com/feed | |
| hamel-evals | Hamel Husain | rss | https://hamel.dev/index.xml | |
| ai-hero | AI Hero | rss | https://www.aihero.dev/rss.xml | filter.exclude_path_prefix: [/ai-coding-dictionary/] |
| cloudflare-ai | Cloudflare Blog - AI | rss | https://blog.cloudflare.com/tag/ai/rss/ | |

  Add a header comment: first-party sources only; no changelogs / GitHub releases / aggregators.
- [ ] **Step 5: config.yml** with a comment per key. Use these defaults: `backfill_days: 180`, `label_batch: 20`, `label_delay_ms: 4000`, `label_max_chars: 20000`, `label_min_chars: 500`, `label_max_attempts: 3`, `schedule_cron: "0 6 * * *"`, `uncertain_spread: 1.5`, `points_per_level: 5`, `offset_k: 3`, `interest_decay: 0.8`, `interest_min: 0.2`, `quality_min: 2`, `background_quality_min: 4`, `fresh_days: 14`, `page_size: 20`.
- [ ] **Step 6: Verify.** `pnpm test` (guard test passes). Then `grep -c "^      - id:" data/taxonomy.yml` prints 32 and `grep -nP "[\x{0400}-\x{04FF}]" data/taxonomy.yml || echo none` prints `none`. `git -C ~/Projects/ai-news status --short` shows nothing changed by you.
- [ ] **Step 7: Commit.**

```bash
git add data packages/core/src/data.real.test.ts
git commit -m "feat(data): carry over taxonomy (English), 14 sources, config defaults"
```

---

### Task 5: Drizzle schema, migration, test database helper

**Files:**
- Create: `packages/core/src/db/schema.ts`, `packages/core/src/db/client.ts`, `packages/core/src/db/migrate.ts`, `packages/core/src/db/index.ts`, `packages/core/drizzle.config.ts`, `packages/core/drizzle/` (generated), `packages/core/src/test/db.ts`, `packages/core/src/test/global-setup.ts`, `packages/core/src/db/schema.test.ts`
- Modify: `packages/core/package.json`, `vitest.config.ts` (add `globalSetup`), `packages/core/src/index.ts`

**Interfaces:**
- Consumes: docker Postgres from Task 2.
- Produces:
  - `schema.ts` exports tables `users, sessions, sourceState, articles, articleSkills, userSkills, quizAnswers, articleEvents` and enums `labelStatus('pending'|'labeled'|'failed')`, `articleType('release'|'tutorial'|'deep_dive'|'news'|'research')`, `eventKind('read'|'like'|'too_easy'|'too_hard'|'not_interested')`.
  - `client.ts`: `type Db = PostgresJsDatabase<typeof schema>`; `createDb(url: string): { db: Db; close(): Promise<void> }`.
  - `migrate.ts`: `runMigrations(url: string): Promise<void>` (applies `packages/core/drizzle` folder, resolved relative to the file).
  - `test/db.ts`: `testDb(): Promise<Db>` (shared per test file; connects to `TEST_DATABASE_URL`, default `postgres://attn:attn@localhost:5432/attn_test`), `resetDb(db: Db): Promise<void>` (TRUNCATE all tables RESTART IDENTITY CASCADE). `global-setup.ts` creates database `attn_test` if missing (connect to the `postgres` maintenance db on the same server) and runs `runMigrations` on it once per vitest run.
  - Column naming in the DB is snake_case (spec names); TS property names camelCase (`publishedAt`, `titleHash`, `sourceId`, …).

- [ ] **Step 1: Install.** `pnpm --filter @attn/core add drizzle-orm postgres` and `pnpm --filter @attn/core add -D drizzle-kit`. Add package scripts in `packages/core/package.json`: `"db:generate": "drizzle-kit generate"`. Ensure Postgres is up: `docker compose up -d --wait`.
- [ ] **Step 2: Write `schema.ts`** following spec §3.2 exactly:
  - `users`: `id uuid pk default random`, `github_id text unique not null` (use bigint-as-text? keep `bigint` mode number is fine; choose `bigint({mode:'number'})` unique not null), `login text not null`, `name text`, `avatar_url text`, `role text not null default 'dev'`, `created_at timestamptz not null default now()`.
  - `sessions`: `id text pk` (sha256 of the cookie token), `user_id uuid fk users on delete cascade`, `created_at`, `expires_at timestamptz not null`.
  - `source_state`: `source_id text pk`, `etag text`, `last_modified text`, `last_run_at timestamptz`, `last_error text`.
  - `articles`: `id integer generated always as identity pk`, `source_id text not null`, `url text not null unique`, `guid text not null`, `title text not null`, `title_hash text not null`, `published_at timestamptz not null`, `collected_at timestamptz not null default now()`, `word_count integer`, `label_status labelStatus not null default 'pending'`, `label_attempts integer not null default 0`, `difficulty integer` (check 0..4), `type articleType`, `quality integer` (check 0..4), `label_model text`, `labeled_at timestamptz`, `taxonomy_version integer`. Indexes: `(source_id, guid)`, `(title_hash)`, `(published_at desc)`, `(label_status, published_at)`.
  - `article_skills`: pk `(article_id, skill_id)`, `article_id fk articles on delete cascade`, `skill_id text`, `is_primary boolean not null default false`; partial unique index on `(article_id)` where `is_primary` (exactly one primary at most).
  - `user_skills`: pk `(user_id, skill_id)`, `level integer null` (check 0..4), `uncertain boolean not null default false`, `points integer not null default 0`, `focus_rank integer null` (check 1..5), `interest real not null default 1.0`, `difficulty_offset integer not null default 0` (check -1..1); unique `(user_id, focus_rank)` where focus_rank is not null.
  - `quiz_answers`: pk `(user_id, question_id)`, `first_option integer not null`, `second_option integer not null`, `quiz_version integer not null`, `answered_at timestamptz default now()`.
  - `article_events`: `id integer identity pk`, `user_id uuid fk`, `article_id fk`, `kind eventKind`, `created_at`; unique `(user_id, article_id, kind)`.
  - Foreign keys cascade on delete from users/articles.
- [ ] **Step 3: client/migrate.** `createDb` uses `postgres(url, {max: 5})` + `drizzle(client, {schema})`. `drizzle.config.ts`: dialect `postgresql`, schema `./src/db/schema.ts`, out `./drizzle`. Run `pnpm --filter @attn/core db:generate` and commit the generated SQL. `runMigrations` uses `drizzle-orm/postgres-js/migrator` with a single-connection client and closes it.
- [ ] **Step 4: Test helper + global setup**, then wire `globalSetup: ['packages/core/src/test/global-setup.ts']` into root `vitest.config.ts`.
- [ ] **Step 5: Write `schema.test.ts`** (real Postgres). Tests: (a) inserting two articles with the same `url` throws a unique violation; (b) two `article_skills` rows with `is_primary = true` for the same article throws; (c) `difficulty = 5` throws check violation; (d) `article_events` duplicate `(user, article, kind)` throws; (e) deleting a user cascades to sessions/user_skills; (f) `resetDb` leaves tables empty. Use `await expect(db.insert(...)).rejects.toThrow()` (postgres.js error wrapped by drizzle; assert on `.rejects.toThrow()` and optionally `cause.code` `23505`/`23514`). Call `resetDb` in `beforeEach`.
- [ ] **Step 6: Run** `pnpm test` → schema tests PASS. Also confirm all eight tables exist: `docker compose exec postgres psql -U attn -d attn_test -c '\dt'` lists 8 tables plus `__drizzle_migrations`.
- [ ] **Step 7: Verify** `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Step 8: Commit.**

```bash
git add -A
git commit -m "feat(core/db): drizzle schema for all spec tables, migration, test db helper"
```

---

### Task 6: URL normalization, title hash, entry filter (pure functions)

**Files:**
- Create: `packages/core/src/collect/normalize.ts`, `packages/core/src/collect/normalize.test.ts`, `packages/core/src/collect/filter.ts`, `packages/core/src/collect/filter.test.ts`

**Interfaces:**
- Consumes: `Source['filter']` type shape from `@attn/shared` (`{path_prefix?, exclude_path_prefix?, keywords?}`).
- Produces:
  - `normalizeUrl(raw: string): string | null` — returns `null` for unparsable URLs or non-`http(s)` schemes.
  - `titleHash(title: string): string` — per the Decisions section (sha256 hex).
  - `utcDay(d: Date): string` (`YYYY-MM-DD`).
  - `passesFilter(entry: { url: string; title: string }, filter: SourceFilter | undefined): boolean` — `path_prefix`: URL pathname must start with one of them; `exclude_path_prefix`: must start with none; `keywords`: case-insensitive match of any keyword as a whole word/phrase in title or URL path (use `\b` boundaries; `v0` and `ai sdk` must work). Absent filter → true. Keywords and path_prefix both given → both must pass.

- [ ] **Step 1: Write failing tests** `normalize.test.ts` with a table, for example:

```ts
const cases: [string, string | null][] = [
  ['https://Example.COM/Post/?utm_source=x&utm_medium=y&id=3#frag', 'https://example.com/Post?id=3'],
  ['https://example.com/a/?ref=hn&fbclid=abc', 'https://example.com/a'],
  ['https://example.com/', 'https://example.com'],
  ['https://example.com/a/b/', 'https://example.com/a/b'],
  ['http://example.com/a?b=1&a=2', 'http://example.com/a?b=1&a=2'], // param order untouched
  ['mailto:a@b.c', null], ['javascript:alert(1)', null], ['not a url', null], ['', null],
  ['https://example.com:443/a', 'https://example.com/a'],
];
```

  Path case is preserved (only the host is lowercased). Also: `titleHash('Hello,  World!') === titleHash('hello world')`, `titleHash('Tom &amp; Jerry') === titleHash('Tom & Jerry')`, different titles differ, hash is 64 hex chars. `utcDay(new Date('2026-01-01T23:30:00-05:00'))` is `'2026-01-02'`. Filter tests: vercel-like config passes `/blog/ai-gateway` with title "AI Gateway GA" and rejects `/blog/new-office` titled "Our new office"; `exclude_path_prefix` rejects `/ai-coding-dictionary/x`; keyword `ai` does not match "maintain"; `v0` matches "Introducing v0 templates".
- [ ] **Step 2: Run** `pnpm test normalize filter` → FAIL.
- [ ] **Step 3: Implement.** Use the WHATWG `URL`: set `hostname` lowercase (URL already does), delete params matching `/^utm_/i`, `ref`, `fbclid`, clear `hash`, strip trailing `/` from pathname (empty pathname → no slash; result string built without trailing `/`), URL's default port removal is automatic. Return `url.toString()` then strip a trailing `/` only when the path is `/` and there is no query. HTML-entity decode in `titleHash`: decode `&amp; &lt; &gt; &quot; &#39; &#NNN; &#xHH;` with a small function (no dependency). Normalize with `normalize('NFKD')`? Not needed; lowercase then replace `/[^\p{L}\p{N}]+/gu` with a space and trim.
- [ ] **Step 4: Run tests** → PASS; `pnpm lint && pnpm typecheck`.
- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/collect
git commit -m "feat(collect): url normalization, title hash, source entry filter"
```

---

### Task 7: Feed and sitemap parsers

**Files:**
- Create: `packages/core/src/collect/parse-feed.ts`, `parse-sitemap.ts`, `parse-page.ts`, `types.ts`
- Create: `packages/core/src/collect/parse.test.ts`, `packages/core/src/collect/fixtures/rss.xml`, `atom.xml`, `sitemap.xml`, `page.html`, `broken.xml`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure parsing).
- Produces (`types.ts`):

```ts
export interface RawEntry { url: string; guid: string | null; title: string | null; publishedAt: Date | null }
export interface SitemapUrl { url: string; lastmod: Date | null }
```

  - `parseFeed(xml: string): RawEntry[]` — handles RSS 2.0 (`channel/item`: `link`, `guid` incl. `{#text, @_isPermaLink}`, `title`, `pubDate`, `dc:date`) and Atom (`feed/entry`: `id`, `title` (may be `{#text,@_type}`), `published` else `updated`, `link` choose `rel="alternate"` or no `rel`, among possibly several). Throws `Error('unrecognized feed format')` if neither root exists or XML is malformed. Items missing a link are returned with `url: ''`?? NO: skip them (drop entries without a usable link). Invalid dates → `null`. Does not normalize URLs (that is the orchestrator's job), but trims whitespace and decodes CDATA (fast-xml-parser does).
  - `parseSitemap(xml: string, pathPrefix: string): SitemapUrl[]` — `urlset/url` with `loc` whose pathname starts with `pathPrefix` and is not equal to the prefix itself (index pages like `/news/` are excluded); `lastmod` parsed or `null`. A `<sitemapindex>` throws `Error('sitemap index not supported')`.
  - `parsePageTitle(html: string): string | null` — `og:title` meta content via cheerio, else `<title>` text, trimmed, else `null`.

- [ ] **Step 1: Install.** `pnpm --filter @attn/core add fast-xml-parser cheerio`.
- [ ] **Step 2: Create fixtures** (hand-written, small, realistic):
  - `rss.xml`: 4 items: a normal item (`<guid isPermaLink="true">`); an item with `<guid isPermaLink="false">tag:abc</guid>` and CDATA title containing `&amp;`; an item with no `<link>` (must be skipped); an item with an invalid `pubDate` ("yesterday-ish") and `dc:date` absent; also include one `mailto:` link item (parser keeps it; filtering by scheme happens in Task 9, note: parser keeps non-empty links).
  - `atom.xml`: 3 entries: one with two links (`rel="self"` first then `rel="alternate"` with the real URL); one with only `updated`; one with `<title type="html">` text.
  - `sitemap.xml`: 5 urls: two under `/news/` with `lastmod` (one date-only, one full ISO), one `/news/` index itself, one `/engineering/x`, one `/about`; one `/news/` url without `lastmod`.
  - `page.html`: head with `og:title` "OG Title" and `<title>Title | Site</title>`; also `page-no-og` case inline in test.
  - `broken.xml`: truncated XML (`<rss><channel><item>`).
- [ ] **Step 3: Write failing tests** in `parse.test.ts` asserting exact output for each fixture: RSS yields 4 entries (no-link dropped from 5 → count what you made), guid for the isPermaLink=false item is `tag:abc`, title decoded to `Tom & Jerry`-style text; invalid date → `null`; Atom picks the alternate link, uses `updated` when `published` is missing, title text extracted from the object form; sitemap with prefix `/news/` returns exactly the 3 expected urls (index excluded) with proper `Date`s and `null` lastmod where absent, `/engineering/` returns 1; `parseFeed(broken)` and `parseFeed('<html/>')` throw; sitemapindex throws; `parsePageTitle` prefers og:title, falls back to `<title>`, returns null for empty html.
- [ ] **Step 4: Run** → FAIL. **Step 5: Implement** with `new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', processEntities: true, isArray: (name) => ['item','entry','link','url'].includes(name) })`. Add a small `text(v: unknown): string | null` helper that unwraps `{#text}` and strings/numbers. Validate that malformed XML throws: use `XMLValidator.validate(xml)` first and throw on `!== true`.
- [ ] **Step 6: Run tests** → PASS; `pnpm lint && pnpm typecheck`.
- [ ] **Step 7: Commit.**

```bash
git add packages/core
git commit -m "feat(collect): rss/atom, sitemap and page-title parsers with fixtures"
```

---

### Task 8: HTTP fetcher with conditional GET and source_state

**Files:**
- Create: `packages/core/src/collect/http.ts`, `packages/core/src/collect/state.ts`, `packages/core/src/collect/http.test.ts`, `packages/core/src/collect/state.test.ts`

**Interfaces:**
- Consumes: `Db`, `sourceState` table (Task 5); `testDb`, `resetDb` (Task 5).
- Produces:
  - `http.ts`:

```ts
export type FetchFn = typeof fetch;
export interface ConditionalResult {
  status: 'ok' | 'not_modified';
  body?: string;          // present when status === 'ok'
  etag: string | null;
  lastModified: string | null;
}
export interface CachedState { etag: string | null; lastModified: string | null }
export const USER_AGENT = 'attn-collector/0.1 (+https://github.com/arthursereda/attn)';
export async function conditionalGet(url: string, state: CachedState | null, fetchFn?: FetchFn, timeoutMs?: number): Promise<ConditionalResult>;
export async function getText(url: string, fetchFn?: FetchFn, timeoutMs?: number): Promise<string>;
```

  `conditionalGet` sends `If-None-Match` / `If-Modified-Since` when stored, `User-Agent`, `Accept: application/xml, text/xml, application/rss+xml, application/atom+xml, */*`; follows redirects; default timeout 20000 ms via `AbortSignal.timeout`; 304 → `not_modified` (echoing the stored validators); 2xx → `ok`; any other status throws `Error('HTTP <status> for <url>')`; network/timeout errors propagate. `getText` is the same without validators (used for sitemap page titles), throws on non-2xx.
  - `state.ts`: `getState(db, sourceId): Promise<CachedState | null>`; `recordSuccess(db, sourceId, v: CachedState, now: Date)` (upsert, sets `last_run_at`, clears `last_error`); `recordFailure(db, sourceId, message: string, now: Date)` (upsert, sets `last_error` + `last_run_at`, keeps etag/last_modified).

- [ ] **Step 1: Write failing `http.test.ts`** using a real local server (`http.createServer` on port 0, closed in `afterEach`): server records request headers and responds per route. Tests: first request has no conditional headers and returns body + ETag + Last-Modified; second call with those validators sends `If-None-Match`/`If-Modified-Since` and a 304 produces `not_modified` with the same validators; a 500 throws an error containing `500`; a server that stalls longer than `timeoutMs: 50` rejects; redirect 301 → 200 is followed; sends the `User-Agent` header.
- [ ] **Step 2: Write failing `state.test.ts`** (real Postgres, `resetDb` in `beforeEach`): `getState` returns null for unknown; `recordSuccess` then `getState` returns validators; `recordFailure` after success keeps validators and sets `last_error`; a later `recordSuccess` clears `last_error`.
- [ ] **Step 3: Run** → FAIL. **Step 4: Implement** both modules. `fetchFn` defaults to global `fetch`.
- [ ] **Step 5: Run** `pnpm test` → PASS; `pnpm lint && pnpm typecheck`.
- [ ] **Step 6: Commit.**

```bash
git add packages/core/src/collect
git commit -m "feat(collect): conditional GET fetcher and source_state persistence"
```

---

### Task 9: Collect orchestrator with dedup and backfill

**Files:**
- Create: `packages/core/src/collect/collect.ts`, `packages/core/src/collect/dedup.ts`, `packages/core/src/collect/collect.test.ts`, `packages/core/src/collect/dedup.test.ts`
- Modify: `packages/core/src/index.ts` (export public API)

**Interfaces:**
- Consumes: `Db`, `articles` (Task 5); `normalizeUrl`, `titleHash`, `utcDay`, `passesFilter` (Task 6); `parseFeed`, `parseSitemap`, `parsePageTitle`, `RawEntry` (Task 7); `conditionalGet`, `getText`, `FetchFn`, `getState`, `recordSuccess`, `recordFailure` (Task 8); `Source`, `Config` from `@attn/shared`.
- Produces:

```ts
export interface Candidate { sourceId: string; url: string /*normalized*/; guid: string; title: string; titleHash: string; publishedAt: Date }
export async function isDuplicate(db: Db, c: Candidate): Promise<boolean>;
   // true if articles has same url, OR same (source_id, guid), OR same title_hash with published_at on the same UTC day

export interface SourceReport {
  sourceId: string; status: 'ok' | 'not_modified' | 'error';
  seen: number; inserted: number; duplicates: number; tooOld: number; skipped: number; // skipped = invalid/filtered entries
  error?: string;
}
export interface CollectOptions { db: Db; sources: Source[]; config: Pick<Config,'backfill_days'>; fetchFn?: FetchFn; now?: Date; backfillDays?: number; onlySourceIds?: string[] }
export async function collectSource(opts: Omit<CollectOptions,'sources'|'onlySourceIds'> & { source: Source }): Promise<SourceReport>;
export async function collectAll(opts: CollectOptions): Promise<SourceReport[]>; // sequential, never throws for per-source failures
```

Behavior of `collectSource`:
1. `state = getState`; `conditionalGet(source.url, state, fetchFn)`. On `not_modified` → `recordSuccess` (keep validators) and report `not_modified`.
2. rss: `parseFeed(body)`; sitemap: `parseSitemap(body, source.path_prefix)`.
3. For each entry: `normalizeUrl` (null → `skipped`); `passesFilter` (rss only; false → `skipped`); missing title → for rss `skipped`; publishedAt null → `now`; older than `now - backfillDays` days (backfillDays option, else `config.backfill_days`) → `tooOld`; future-dated is kept as is; `guid` = entry guid or normalized url; candidate built with `titleHash(title)`.
4. sitemap: for each candidate url that passes `tooOld` and `isDuplicate` by url first (cheap check, so existing URLs never refetch the page), call `getText(url)` then `parsePageTitle`; on failure/no title use a slug title (last path segment, hyphens to spaces, capitalized first letter). Pages are fetched sequentially.
5. `isDuplicate` → `duplicates++`; else insert `{ sourceId, url, guid, title, titleHash, publishedAt }` with `.onConflictDoNothing({ target: articles.url })` (a conflict counts as a duplicate). `collected_at`, `label_status='pending'` come from defaults.
6. After the loop, `recordSuccess(db, id, {etag, lastModified}, now)`. Any exception in steps 1-5 → `recordFailure` (message), report `status: 'error'` with `error`, partially inserted rows stay.
`collectAll` filters by `onlySourceIds` (unknown id → throw before doing anything), runs sources sequentially, returns the reports.

- [ ] **Step 1: Write failing `dedup.test.ts`** (real Postgres; insert an existing article, then call `isDuplicate`): same url → true; same source+guid but different url → true; same guid in a *different* source → false; same `title_hash` same UTC day, different url → true; same title_hash a different day → false; unrelated → false.
- [ ] **Step 2: Write failing `collect.test.ts`.** Use a local `http.createServer` fixture server serving the Task 7 fixtures (import the fixture files from `./fixtures`), with `now` fixed (e.g. `2026-10-14T12:00:00Z`) so fixture dates are deterministic (set fixture dates relative to this; adjust fixture `pubDate`s if needed so some are within 180 days and one is older). Tests, each starting with `resetDb`:
  1. rss source: first run inserts the in-window entries, skips tooOld/no-link/`mailto:`; row has normalized url, `title_hash`, `published_at`, `label_status = 'pending'`; `source_state` has etag.
  2. Second run: server returns 304 for matching `If-None-Match` → report `not_modified`, row count unchanged.
  3. Server ignoring conditional headers (always 200 full body): second run inserts 0, `duplicates` equals seen count.
  4. Same article under `?utm_source=x#top` and trailing slash variants in one feed → exactly one row.
  5. Atom source works end to end.
  6. Sitemap source: only `/news/` urls in; for a new url the page is fetched (server counts hits) and `og:title` stored; second run (new `lastmod`-less fetch, 200) does NOT refetch pages for existing urls (hit count unchanged); page 404 for one url → inserted with slug title.
  7. `collectAll` with one source returning 500 and one healthy source: healthy rows inserted, failing source `status: 'error'`, `source_state.last_error` contains `500`, healthy source's `last_error` is null.
  8. Malformed XML (`broken.xml`) → error report, no rows, no etag saved.
  9. `backfillDays: 10` overrides config: only entries newer than 10 days inserted.
  10. Source with `filter.keywords` drops non-matching entries (counts in `skipped`).
  11. `onlySourceIds: ['nope']` throws.
  Route the sources' `url` to the local server (`http://127.0.0.1:<port>/rss.xml`); sitemap page URLs inside the fixture must also point to the local server, so generate the sitemap XML in the test by templating the port into the fixture (`{{BASE}}` placeholder; add that placeholder to `sitemap.xml` locs and update the Task 7 test accordingly by replacing it before parsing).
- [ ] **Step 3: Run** → FAIL. **Step 4: Implement** `dedup.ts` and `collect.ts`. The `isDuplicate` same-day check: `title_hash = $h AND published_at >= dayStartUtc AND published_at < dayStartUtc + 1 day`. Export `collectAll`, `collectSource`, `isDuplicate`, types from `index.ts`.
- [ ] **Step 5: Run** `pnpm test` → PASS; `pnpm lint && pnpm typecheck`.
- [ ] **Step 6: Commit.**

```bash
git add -A
git commit -m "feat(collect): collect orchestrator with dedup, backfill and per-source isolation"
```

---

### Task 10: CLI `attn collect`/`migrate`, README, live smoke check

**Files:**
- Create: `packages/core/src/cli.ts`, `packages/core/src/cli.test.ts`, `README.md`
- Modify: `packages/core/src/index.ts` only if needed

**Interfaces:**
- Consumes: `createDb`, `runMigrations` (Task 5); `loadSources`, `loadConfig` (Task 3/4); `collectAll`, `SourceReport` (Task 9). Root script `pnpm attn` → `tsx packages/core/src/cli.ts` (Task 1).
- Produces: `pnpm attn <command>`:
  - `pnpm attn migrate` — applies migrations to `DATABASE_URL`.
  - `pnpm attn collect [--source <id>]... [--backfill-days <n>]` — loads sources + config, runs `collectAll`, prints one line per source (`id  status  seen=… inserted=… dup=… old=… skipped=…  [error]`) and a totals line; exit code 0 even when individual sources failed (they are recorded), exit 1 on fatal problems (missing `DATABASE_URL`, invalid YAML, unknown `--source`, unknown command).
  - Export `run(argv: string[], env: NodeJS.ProcessEnv, io?: { out(s:string):void; err(s:string):void }): Promise<number>` from `cli.ts` and keep the process entry at the bottom guarded by `if (import.meta.url === pathToFileURL(process.argv[1]!).href)`; this makes it testable. Use `node:util` `parseArgs` (no dependency). Load `.env` via `process.loadEnvFile?.()` in the entry guard only if `.env` exists (Node 24 built-in).
  - `label` and `eval` commands are NOT in this stage: unknown command prints usage listing `migrate | collect`.

- [ ] **Step 1: Write failing `cli.test.ts`** calling `run()` (no process spawn): with a fixture http server and a temp `ATTN_DATA_DIR` containing one rss source pointing at the server, a minimal valid taxonomy file is NOT needed (collect loads only sources + config; copy the real `data/config.yml` into the temp dir in the test), `env.DATABASE_URL = TEST_DATABASE_URL`: (a) `run(['collect'], env, io)` returns 0, output contains the source id and `inserted=`; rows exist in the test DB; (b) `run(['collect','--source','nope'], …)` returns 1 and `err` mentions `nope`; (c) no `DATABASE_URL` returns 1; (d) unknown command returns 1 with usage; (e) `--backfill-days 1` is honored (older entries not inserted). `resetDb` in `beforeEach`; migrations already applied by global setup.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement `cli.ts`.**
- [ ] **Step 4: README.md skeleton** with sections: what ATTN is (one paragraph from spec §1), status (Stage 1 of 5: foundation + collect), Requirements (Node 24, pnpm, Docker), Quick start (`cp .env.example .env`, `docker compose up -d --wait`, `pnpm install`, `pnpm attn migrate`, `pnpm attn collect`), Commands table (`pnpm lint|typecheck|test`, `pnpm attn migrate|collect`), Layout (short tree from spec §2, marking apps/ and label/rank/levels/eval as upcoming), Data files (what each YAML does, `data/config.yml` is the single place for tunables), Evaluation (placeholder section "coming in Stage 2: how to run `attn eval`, read the report, add golden items, compare models"), License (MIT). No claims about unbuilt features beyond "planned".
- [ ] **Step 5: Verify tests.** `pnpm lint && pnpm typecheck && pnpm test` all green.
- [ ] **Step 6: Live smoke check against the real internet** (not part of CI): ensure `docker compose up -d --wait`, then `cp -n .env.example .env`, `pnpm attn migrate`, `pnpm attn collect`, show the full output. Expected: 14 report lines; most `ok` with `inserted>0`; a source or two erroring on the real network is acceptable but report which and why. Then run `pnpm attn collect` again: sources return `not_modified` or `inserted=0`, no duplicate growth. Check `docker compose exec postgres psql -U attn -d attn -c "select source_id, count(*) from articles group by 1 order by 1"` and show it. Do NOT commit `.env`.
- [ ] **Step 7: Commit.**

```bash
git add packages/core/src/cli.ts packages/core/src/cli.test.ts README.md
git commit -m "feat(cli): attn migrate and attn collect; README skeleton"
```

---

## Self-Review

- **Spec coverage (§9.1):** monorepo/ts/vitest/eslint: Task 1; compose/.env/CI: Task 2; shared schemas: Task 3; data carry-over (taxonomy translated, 14 sources, config with every §7 key): Task 4; all §3.2 tables + migrations: Task 5; normalization/dedup/backfill/conditional GET/rss+atom/sitemap with path_prefix and og:title for new URLs: Tasks 6-9; `attn collect`: Task 10; README skeleton: Task 10; tests per §8 (fixtures, normalization, dedup, real-Postgres DB tests, no LLM): Tasks 5-10.
- **Deferred deliberately (later stages):** api/web compose services (Stage 3), `.env` secrets use (Stages 2-3), quiz and golden data (schemas only here), `label`/`eval`/`rank`/`levels`/`extract` modules, daily job.
- **Type consistency:** `Db`, `Source`, `Config`, `RawEntry`, `SitemapUrl`, `CachedState`, `FetchFn`, `Candidate`, `SourceReport` names are used identically across Tasks 5-10.
