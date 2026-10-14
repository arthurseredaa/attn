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
- `guid` dedup is global (any source), as the spec says "same `guid`"; guids are usually URLs. A missing guid is stored as the normalized url.
- `articles.published_at` is NOT NULL: if an entry has no usable date, use `collected_at` (now). Sitemap `lastmod` stands in for the publication date. A sitemap URL with no `lastmod` is skipped on a source's first run (no `source_state` row yet), so backfill does not page-fetch every undated URL; on later runs it is inserted with `published_at` = collection time. A `<sitemapindex>` is followed one level deep.
- If a sitemap page fetch (og:title) fails for a new URL, insert the article anyway with a title derived from the URL slug (so a 304/unchanged sitemap never leaves it stranded).
- `source_state` ETag/Last-Modified are saved only after a source was processed successfully; on error only `last_error`/`last_run_at` change.
- Sources may carry an optional `filter` (`path_prefix`, `exclude_path_prefix`, `keywords`) carried over from ai-news for `vercel` and `ai-hero` (otherwise Vercel's feed is mostly non-AI). It applies to rss and sitemap sources alike; it is a small pure function in collect. Vercel's filter keeps only `/blog/` (no `/changelog/`: the spec excludes changelogs).
- "Exactly one primary skill per article" (spec §3.2) is enforced at the DB level as at-most-one by a partial unique index on `article_skills (article_id) where is_primary`; the at-least-one half is the label stage's insert logic (Stage 2).
- Backfill (`backfill_days`) is applied on every run, which is equivalent to "first run" in effect.
- Implementers receive the Global Constraints and this Decisions section together with their task text.
- Test database is a separate database `attn_test` on the same compose Postgres; vitest runs core test files serially.
- `attn migrate` is part of the CLI (needed to apply migrations outside tests).

## Review Focus

Inputs the spec implies but a happy-path suite would miss. Each has a test in the named task.

1. One feed returns HTTP 500, malformed XML, or stalls past the timeout: other sources are still collected and the failure is recorded in `last_error` (Task 9, tests 9-11).
2. Entries with no title, no link, a `mailto:`/`javascript:` link: skipped, never crash the run (Tasks 7, 9).
3. Same article reached via `?utm_source=x`, `#section`, trailing slash, or re-seen on the next run: exactly one row (Tasks 6, 9). Uppercase hosts are covered at the unit level in Task 6.
4. Server answers 304 or ignores conditional headers and returns the full feed again: no duplicate rows, no error (Tasks 8, 9).
5. CDATA/entity titles, Atom entries with several `<link rel=...>`, RSS `<guid isPermaLink="false">`, future-dated and undated entries (Tasks 7, 9).

---

### Task 1: Monorepo scaffold, TypeScript, vitest, eslint

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, `.gitignore`, `.nvmrc`, `LICENSE` (MIT, holder "Arthur Sereda", year 2026)
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: workspace packages `@attn/shared` and `@attn/core` (both `"type": "module"`, `"exports": "./src/index.ts"`, consumed as TS source). Root scripts: `lint`, `typecheck`, `test`, `attn` (`tsx packages/core/src/cli.ts`, the file is created in Task 10; do not create it now). Root `vitest.config.ts` is the plain form `defineConfig({ test: { include: ['packages/*/src/**/*.test.ts'], fileParallelism: false } })` (not `test.projects`); Task 5 adds `globalSetup` to it.

- [ ] **Step 1: Initialize the workspace.** `git status` must be clean first. Create root `package.json` with `"private": true`, `"type": "module"`, `"packageManager": "pnpm@10.3.0"`, `"engines": {"node": ">=24"}`, `"pnpm": {"onlyBuiltDependencies": ["esbuild"]}` and the scripts: `"lint": "eslint ."`, `"typecheck": "pnpm -r exec tsc --noEmit"`, `"test": "vitest run --passWithNoTests"`, `"attn": "tsx packages/core/src/cli.ts"`. `pnpm-workspace.yaml`: `packages: ['packages/*', 'apps/*']`. `.nvmrc`: `24`. `.gitignore`: `node_modules`, `.env`, `.cache/`, `dist/`, `*.tsbuildinfo`, `.DS_Store`, `coverage/`.
- [ ] **Step 2: Install dev dependencies at current stable versions.** Run `pnpm add -Dw typescript vitest eslint @eslint/js typescript-eslint tsx @types/node`. If pnpm reports a peer conflict between `typescript` and `typescript-eslint`, pin `typescript` to the highest version that satisfies typescript-eslint's peer range and note it in the commit message. Run `pnpm view <pkg> version` to see what is current if unsure.
- [ ] **Step 3: tsconfig.** `tsconfig.base.json`: `target ES2023`, `module ESNext`, `moduleResolution Bundler`, `strict true`, `noUncheckedIndexedAccess true`, `noEmit true`, `skipLibCheck true`, `verbatimModuleSyntax true`, `types: ["node"]`. Each package tsconfig extends it and `include: ["src"]`. Root `tsconfig.json` is just `{ "extends": "./tsconfig.base.json", "include": ["*.ts", "*.js"] }` (config files only); packages are typechecked by the `typecheck` script.
- [ ] **Step 4: Packages.** `@attn/shared` and `@attn/core` `package.json`: `name`, `version 0.0.0`, `private true`, `type module`, `exports {".": "./src/index.ts"}`. `core` depends on `"@attn/shared": "workspace:*"`. `shared/src/index.ts`: `export {};`. `core/src/index.ts`: `export {};`.
- [ ] **Step 5: eslint flat config.** `eslint.config.js` using `typescript-eslint` recommended + `@eslint/js` recommended, ignoring `node_modules`, `.cache`, `**/drizzle/**` (generated SQL/meta), `dist`. Rule: `@typescript-eslint/no-unused-vars` error with `argsIgnorePattern: '^_'`.
- [ ] **Step 6: vitest config.** Create `vitest.config.ts` as in the Interfaces block. No placeholder test is written; `--passWithNoTests` keeps `pnpm test` green until Task 3 adds real tests.
- [ ] **Step 7: Verify.** Run `pnpm install && pnpm lint && pnpm typecheck && pnpm test`. Expected: all exit 0 (vitest reports no test files).
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
- [ ] **Step 4: Verify.** Run `docker compose up -d --wait` then `docker compose ps` (postgres `healthy`) and `docker compose exec postgres psql -U attn -d attn -c 'select 1'` (prints 1). Validate YAML syntax: `docker compose config -q` exits 0 and `pnpm dlx yaml-lint .github/workflows/ci.yml` exits 0 (show output).
- [ ] **Step 5: Commit.**

```bash
git add docker-compose.yml .env.example .github
git commit -m "chore: docker compose postgres, env example, CI workflow"
```

---

### Task 3: Shared zod schemas and YAML loaders

**Files:**
- Create: `packages/shared/src/enums.ts`, `taxonomy.ts`, `sources.ts`, `config.ts`, `quiz.ts`, `golden.ts`; modify `packages/shared/src/index.ts` to re-export all
- Create: `packages/shared/src/schemas.test.ts`
- Create: `packages/core/src/data.ts`, `packages/core/src/data.test.ts`; modify `packages/core/src/index.ts`
- Modify: `packages/shared/package.json`, `packages/core/package.json` (deps)

**Interfaces:**
- Consumes: workspace from Task 1.
- Produces (from `@attn/shared`):
  - `enums.ts`: `levelSchema = z.number().int().min(0).max(4)`; `articleTypeSchema = z.enum(['release','tutorial','deep_dive','news','research'])`; `eventKindSchema = z.enum(['read','like','too_easy','too_hard','not_interested'])`; `labelStatusSchema = z.enum(['pending','labeled','failed'])` (Task 5 builds its pgEnums from `.options` of these).
  - `taxonomySchema` → `Taxonomy`: `{ version: number; levels: {level:0..4,label:string,description:string}[] (exactly 5, levels 0..4); domains: {id,name,skills:{id,name,description,roles:string[] (min 1)}[]}[] }`; refine: skill ids unique across the file, domain ids unique.
  - `sourceFilterSchema` → `SourceFilter` = `{path_prefix?: string[]; exclude_path_prefix?: string[]; keywords?: string[]}` (non-empty strings; path prefixes start with `/`); `sourceSchema` → `Source` = discriminated union on `type`: `{id,name,type:'rss',url,filter?}` | `{id,name,type:'sitemap',url,path_prefix,filter?}` (`filter` allowed on both); `sourcesSchema = z.array(sourceSchema)` with unique ids; `Source` type exported.
  - `configSchema` → `Config` with the 16 keys from Global Constraints (strict: unknown keys rejected; positive integers: `backfill_days, label_batch, label_delay_ms, label_max_chars, label_min_chars, label_max_attempts, points_per_level, offset_k, fresh_days, page_size`; `quality_min` and `background_quality_min` integers 0..4; `uncertain_spread` positive number; `interest_decay` and `interest_min` in (0,1]; `schedule_cron` non-empty string).
  - `quizSchema` → `{ version:number; questions:{id,skill_id,situation,options:{text,level}[] (4..6)}[] }`; `goldenItemSchema`/`goldenSchema` → array of `{url (url), primary_skill, secondary_skills (max 3, default []), difficulty, type: 'release'|'tutorial'|'deep_dive'|'news'|'research', quality}`.
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
- [ ] **Step 5: Write failing loader test** `packages/core/src/data.test.ts` using a temp dir (`fs.mkdtempSync(os.tmpdir()…)`) with small YAML files written in the test: `loadSources` returns parsed array; `loadTaxonomy` returns a valid minimal taxonomy; `loadConfig` on a file with a bad value throws an error whose message contains `config.yml`; env `ATTN_DATA_DIR` is honored by `dataDir()`.
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
  it('vercel filter keeps /blog/ only', () => {
    const v = loadSources().find((s) => s.id === 'vercel');
    expect(v?.filter?.path_prefix).toEqual(['/blog/']);
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
| vercel | Vercel | rss | https://vercel.com/atom | filter.path_prefix: [/blog/] (no /changelog/); filter.keywords: [ai, llm, llms, agent, agents, agentic, mcp, claude, openai, gpt, gemini, ai sdk, ai gateway, v0, inference, embeddings, rag, prompt] |
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
  - `schema.ts` builds its pgEnums from `@attn/shared` (`pgEnum('label_status', labelStatusSchema.options)`, `articleTypeSchema.options`, `eventKindSchema.options`) instead of retyping the values, and exports tables `users, sessions, sourceState, articles, articleSkills, userSkills, quizAnswers, articleEvents` and enums `labelStatus('pending'|'labeled'|'failed')`, `articleType('release'|'tutorial'|'deep_dive'|'news'|'research')`, `eventKind('read'|'like'|'too_easy'|'too_hard'|'not_interested')`.
  - `client.ts`: `type Db = PostgresJsDatabase<typeof schema>`; `createDb(url: string): { db: Db; close(): Promise<void> }`.
  - `migrate.ts`: `runMigrations(url: string): Promise<void>` (applies `packages/core/drizzle` folder, resolved relative to the file).
  - `test/db.ts`: `testDb(): Promise<Db>` (shared per test file; connects to `TEST_DATABASE_URL`, default `postgres://attn:attn@localhost:5432/attn_test`), `resetDb(db: Db): Promise<void>` (TRUNCATE all tables RESTART IDENTITY CASCADE). `global-setup.ts` creates database `attn_test` if missing (connect to the `postgres` maintenance db on the same server) and runs `runMigrations` on it once per vitest run.
  - Column naming in the DB is snake_case (spec names); TS property names camelCase (`publishedAt`, `titleHash`, `sourceId`, …).

- [ ] **Step 1: Install.** `pnpm --filter @attn/core add drizzle-orm postgres` and `pnpm --filter @attn/core add -D drizzle-kit`. Add package scripts in `packages/core/package.json`: `"db:generate": "drizzle-kit generate"`. Ensure Postgres is up: `docker compose up -d --wait`.
- [ ] **Step 2: Write `schema.ts`** following spec §3.2 exactly:
  - `users`: `id uuid pk default random`, `github_id bigint({mode:'number'}) unique not null`, `login text not null`, `name text`, `avatar_url text`, `role text not null default 'dev'`, `created_at timestamptz not null default now()`.
  - `sessions`: `id text pk` (sha256 of the cookie token), `user_id uuid fk users on delete cascade`, `created_at`, `expires_at timestamptz not null`.
  - `source_state`: `source_id text pk`, `etag text`, `last_modified text`, `last_run_at timestamptz`, `last_error text`.
  - `articles`: `id integer generated always as identity pk`, `source_id text not null`, `url text not null unique`, `guid text not null`, `title text not null`, `title_hash text not null`, `published_at timestamptz not null`, `collected_at timestamptz not null default now()`, `word_count integer`, `label_status labelStatus not null default 'pending'`, `label_attempts integer not null default 0`, `difficulty integer` (check 0..4), `type articleType`, `quality integer` (check 0..4), `label_model text`, `labeled_at timestamptz`, `taxonomy_version integer`. Indexes: `(guid)` (global guid dedup), `(title_hash)`, `(published_at desc)`, `(label_status, published_at)`.
  - `article_skills`: pk `(article_id, skill_id)`, `article_id fk articles on delete cascade`, `skill_id text`, `is_primary boolean not null default false`; partial unique index on `(article_id)` where `is_primary` (exactly one primary at most).
  - `user_skills`: pk `(user_id, skill_id)`, `level integer null` (check 0..4), `uncertain boolean not null default false`, `points integer not null default 0`, `focus_rank integer null` (check 1..5), `interest real not null default 1.0`, `difficulty_offset integer not null default 0` (check -1..1); unique `(user_id, focus_rank)` where focus_rank is not null.
  - `quiz_answers`: pk `(user_id, question_id)`, `first_option integer not null`, `second_option integer not null`, `quiz_version integer not null`, `answered_at timestamptz default now()`.
  - `article_events`: `id integer identity pk`, `user_id uuid fk`, `article_id fk`, `kind eventKind`, `created_at`; unique `(user_id, article_id, kind)`.
  - Foreign keys cascade on delete from users/articles.
- [ ] **Step 3: client/migrate.** `createDb` uses `postgres(url, {max: 5})` + `drizzle(client, {schema})`. `drizzle.config.ts`: dialect `postgresql`, schema `./src/db/schema.ts`, out `./drizzle`. Run `pnpm --filter @attn/core db:generate` and commit the generated SQL. `runMigrations` uses `drizzle-orm/postgres-js/migrator` with a single-connection client and closes it.
- [ ] **Step 4: Test helper + global setup**, then wire `globalSetup: ['packages/core/src/test/global-setup.ts']` into root `vitest.config.ts`.
- [ ] **Step 5: Write `schema.test.ts`** (real Postgres). Tests: (a) inserting two articles with the same `url` throws a unique violation; (b) two `article_skills` rows with `is_primary = true` for the same article throws; (c) `difficulty = 5` throws check violation; (d) `article_events` duplicate `(user, article, kind)` throws; (e) deleting a user cascades to sessions/user_skills; (f) `resetDb` leaves tables empty; (g) a second `article_skills` row with `is_primary = false` for the same article is allowed. Use `await expect(db.insert(...)).rejects.toThrow()` (postgres.js error wrapped by drizzle; assert on `.rejects.toThrow()` and optionally `cause.code` `23505`/`23514`). Call `resetDb` in `beforeEach`.
- [ ] **Step 6: Run** `pnpm test` → schema tests PASS. Also confirm all eight tables exist: `docker compose exec postgres psql -U attn -d attn_test -c '\dt'` lists exactly the 8 tables (drizzle's `__drizzle_migrations` lives in schema `drizzle`, not `public`; optionally `select count(*) from drizzle.__drizzle_migrations` is >= 1).
- [ ] **Step 7: Verify** `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Step 8: Commit.**

```bash
git add -A
git commit -m "feat(core/db): drizzle schema for all spec tables, migration, test db helper"
```

---

### Task 6: URL normalization, title hash, entity decoding, entry filter (pure functions)

**Files:**
- Create: `packages/core/src/collect/normalize.ts`, `packages/core/src/collect/normalize.test.ts`, `packages/core/src/collect/filter.ts`, `packages/core/src/collect/filter.test.ts`

**Interfaces:**
- Consumes: `SourceFilter` (type, `{path_prefix?: string[]; exclude_path_prefix?: string[]; keywords?: string[]}`) exported from `@attn/shared` (Task 3).
- Produces (`normalize.ts`):
  - `normalizeUrl(raw: string): string | null` — `null` for unparsable URLs or non-`http(s)` schemes.
  - `decodeEntities(s: string): string` — decodes `&amp; &lt; &gt; &quot; &apos; &#39; &#NNN; &#xHH;` (no dependency); unknown entities are left untouched.
  - `titleHash(title: string): string` — sha256 hex of the title: HTML-entity-decoded, lowercased, every run of non-letter/non-digit characters (`/[^\p{L}\p{N}]+/gu`) replaced by one space, trimmed.
  - `utcDay(d: Date): string` (`YYYY-MM-DD`, UTC) and `utcDayBounds(d: Date): { start: Date; end: Date }` (UTC midnight of that day, and the next UTC midnight; half-open).
- Produces (`filter.ts`):
  - `passesPathFilter(url: string, filter: SourceFilter | undefined): boolean` — `path_prefix`: URL pathname must start with one of them; `exclude_path_prefix`: pathname must start with none. Absent filter or absent keys → true.
  - `passesFilter(entry: { url: string; title: string }, filter: SourceFilter | undefined): boolean` — `passesPathFilter` AND (if `keywords` given) at least one keyword matches case-insensitively as a whole word/phrase in the title or the URL pathname. Build each keyword regex by escaping regex metacharacters and wrapping with `(?<![\p{L}\p{N}])…(?![\p{L}\p{N}])` (flag `iu`), so `v0` and `ai sdk` work and `ai` does not match "maintain".

- [ ] **Step 1: Write failing tests.** `normalize.test.ts` table:

```ts
const cases: [string, string | null][] = [
  ['https://Example.COM/Post/?utm_source=x&utm_medium=y&id=3#frag', 'https://example.com/Post?id=3'],
  ['https://example.com/a/?ref=hn&fbclid=abc', 'https://example.com/a'],
  ['https://example.com/', 'https://example.com'],
  ['https://example.com/?id=1', 'https://example.com?id=1'],
  ['https://example.com/a/b/', 'https://example.com/a/b'],
  ['http://example.com/a?b=1&a=2', 'http://example.com/a?b=1&a=2'], // param order untouched
  ['mailto:a@b.c', null], ['javascript:alert(1)', null], ['not a url', null], ['', null],
  ['https://example.com:443/a', 'https://example.com/a'],
  ['HTTPS://EXAMPLE.com/A', 'https://example.com/A'], // only the host is lowercased; path case kept
];
```

  Also: `titleHash('Hello,  World!') === titleHash('hello world')`; `titleHash('Tom &amp; Jerry') === titleHash('Tom & Jerry')`; different titles differ; hash is 64 hex chars; `decodeEntities('a &amp; b &#65; &#x42; &bogus;')` → `'a & b A B &bogus;'`; `utcDay(new Date('2026-01-01T23:30:00-05:00'))` is `'2026-01-02'`; `utcDayBounds` returns `[2026-01-02T00:00Z, 2026-01-03T00:00Z)` for that date. `filter.test.ts`: vercel-like filter (`path_prefix: ['/blog/']`, `keywords: ['ai','ai sdk','v0']`) passes `/blog/ai-gateway` titled "AI Gateway GA" and rejects `/blog/new-office` titled "Our new office" and `/changelog/ai-thing`; `exclude_path_prefix` rejects `/ai-coding-dictionary/x`; keyword `ai` does not match "maintain"; `v0` matches "Introducing v0 templates"; keyword `c++` (regex metachars) does not throw; `passesPathFilter` ignores keywords; `undefined` filter passes everything.
- [ ] **Step 2: Run** `pnpm test normalize filter` → FAIL.
- [ ] **Step 3: Implement.** `normalizeUrl` with the WHATWG `URL`: reject non-http(s); delete search params matching `/^utm_/i`, `ref`, `fbclid` (rebuild `search` preserving the order of the rest); clear `hash`; strip trailing slashes from `pathname` FIRST (`/a/b/` → `/a/b`, `/` → empty); then build the string manually as `protocol + '//' + host + pathname + search` (this yields `https://example.com?id=1` for the root-with-query case). Default ports are already dropped by `URL`.
- [ ] **Step 4: Run tests** → PASS; `pnpm lint && pnpm typecheck`.
- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/collect
git commit -m "feat(collect): url normalization, title hash, entity decoding, source entry filter"
```

---

### Task 7: Feed and sitemap parsers, fixtures

**Files:**
- Create: `packages/core/src/collect/types.ts`, `parse-feed.ts`, `parse-sitemap.ts`, `parse-page.ts`, `parse.test.ts`
- Create fixtures in `packages/core/src/collect/fixtures/`: `rss.xml`, `variants.xml`, `filter.xml`, `atom.xml`, `sitemap.xml`, `sitemapindex.xml`, `page.html`, `broken.xml`, and `load.ts`

**Interfaces:**
- Consumes: `decodeEntities` from `./normalize` (Task 6).
- Produces:
  - `types.ts`: `RawEntry { url: string; guid: string | null; title: string | null; publishedAt: Date | null }`, `SitemapUrl { url: string; lastmod: Date | null }`.
  - `parseFeed(xml: string): RawEntry[]` — RSS 2.0 (`channel/item`: `link`, `guid` incl. object form `{#text, @_isPermaLink}`, `title`, `pubDate`, `dc:date`) and Atom (`feed/entry`: `id`, `title` (string or `{#text,@_type}`), `published` else `updated`, `link` = the one with `rel="alternate"` or no `rel`, among possibly several). Entries without a non-empty link are dropped. Titles: CDATA/entity text is passed through `decodeEntities`, and for Atom `type="html"` titles tags are stripped after decoding (`Atom <b>three</b>` → `Atom three`); a missing/blank title → `null`. Invalid dates → `null`. URLs are trimmed but NOT normalized (the orchestrator does that; non-http links such as `mailto:` are kept here). Throws `Error('unrecognized feed format')` for XML that is neither RSS nor Atom, and an Error for malformed XML (check with `XMLValidator.validate(xml) === true` first).
  - `parseSitemap(xml: string, pathPrefix: string): SitemapUrl[]` — `urlset/url` whose `loc` pathname starts with `pathPrefix` and is not equal to the prefix itself; `lastmod` parsed (date-only or full ISO) or `null`. Throws `Error('sitemap index')`-prefixed message if the document is a `<sitemapindex>`.
  - `isSitemapIndex(xml: string): boolean` and `parseSitemapIndex(xml: string): string[]` (the `loc`s of `sitemapindex/sitemap`).
  - `parsePageTitle(html: string): string | null` — `og:title` meta content (cheerio), else `<title>` text, trimmed, else `null`.
  - `fixtures/load.ts`: `readFixture(name: string, base?: string): string` — reads `fixtures/<name>` next to the file and replaces every `{{BASE}}` with `base` (default `http://fixture.test`).

**Fixture contract** (Tasks 9 and 10 rely on these exact contents; "now" in all tests is `2026-10-14T12:00:00Z`, `backfill_days: 180` → cutoff 2026-04-17). Every url is `{{BASE}}/…`.

`rss.xml` (RSS 2.0, 8 items):
1. link `/posts/one/`, `<guid isPermaLink="true">{{BASE}}/posts/one/</guid>`, title `First post`, pubDate `Tue, 06 Oct 2026 10:00:00 GMT`
2. link `/posts/two`, `<guid isPermaLink="false">tag:two</guid>`, title `<![CDATA[Tom &amp; Jerry]]>`, pubDate `Thu, 01 Oct 2026 09:00:00 GMT`
3. NO `<link>`, title `No link`, recent pubDate
4. link `/posts/four`, title `Undated`, pubDate `yesterday-ish` (invalid)
5. link `mailto:editor@example.com`, title `Mail`, recent pubDate
6. link `/posts/old`, title `Old`, pubDate `Mon, 01 Jan 2024 10:00:00 GMT`
7. link `/posts/future`, title `Future`, pubDate `Mon, 30 Nov 2026 10:00:00 GMT`
8. link `/posts/notitle`, NO `<title>`, recent pubDate
`parseFeed` returns 7 entries (item 3 dropped).

`variants.xml` (RSS, 4 items, all recent pubDate, same `<guid>g-dup</guid>` for the first three): links `{{BASE}}/Posts/Dup/?utm_source=x#top`, `{{BASE}}/Posts/Dup`, `{{BASE}}/Posts/Dup/` (titles `Dup A`, `Dup B`, `Dup C`), and a 4th item with link `javascript:alert(1)`, title `Bad`.

`filter.xml` (RSS, 3 recent items): `{{BASE}}/blog/ai-gateway-ga` "AI Gateway GA"; `{{BASE}}/blog/new-office` "Our new office"; `{{BASE}}/other/ai-thing` "AI thing".

`atom.xml` (3 entries): (1) title `Atom one`, `<link rel="self" href="{{BASE}}/feed.atom"/>` followed by `<link rel="alternate" href="{{BASE}}/atom/one"/>`, `<published>2026-09-20T10:00:00Z</published>`, `<id>tag:atom-one</id>`; (2) title `Atom two`, one link `/atom/two` without `rel`, only `<updated>2026-09-10T10:00:00Z</updated>`; (3) `<title type="html">Atom &lt;b&gt;three&lt;/b&gt;</title>`, link `/atom/three`, published `2026-09-01T10:00:00Z`.

`sitemap.xml` (urlset, 7 urls): `/news/alpha` lastmod `2026-10-02`; `/news/beta` lastmod `2026-09-15T08:30:00Z`; `/news/gamma` no lastmod; `/news/` (index page); `/news/ancient` lastmod `2024-01-01`; `/engineering/x` lastmod `2026-08-01`; `/about` lastmod `2026-01-01`. `parseSitemap(…, '/news/')` returns alpha, beta, gamma, ancient (4); `'/engineering/'` returns 1.

`sitemapindex.xml`: two `<sitemap><loc>` entries: `{{BASE}}/sitemap-a.xml`, `{{BASE}}/sitemap-b.xml`.

`page.html`: `<head>` with `<meta property="og:title" content="OG Title">` and `<title>Title | Site</title>`. `broken.xml`: `<rss><channel><item>` (truncated).

- [ ] **Step 1: Install.** `pnpm --filter @attn/core add fast-xml-parser cheerio`.
- [ ] **Step 2: Create the fixtures and `load.ts`** exactly per the contract above.
- [ ] **Step 3: Write failing `parse.test.ts`** using `readFixture(name, 'http://fixture.test')`. Assert: `rss.xml` → 7 entries, entry 2 has guid `tag:two` and title `Tom & Jerry`, entry 1 guid equals its url, entry 4 `publishedAt === null`, entry 8 `title === null`, entry 5 keeps `mailto:`; `atom.xml` → picks the alternate link of entry 1, uses `updated` for entry 2, entry 3 title is `Atom three`; `variants.xml` → 4 entries; sitemap results as stated above with proper `Date` values (`alpha` → `2026-10-02T00:00:00.000Z`) and `null` lastmod for gamma; `parseSitemap(sitemapindex, '/news/')` throws; `isSitemapIndex` true only for the index fixture and `parseSitemapIndex` returns its 2 locs; `parseFeed(broken)` and `parseFeed('<html/>')` throw; `parsePageTitle` prefers og:title, falls back to `<title>` (inline html `<title> T </title>` → `T`), returns `null` for `''`.
- [ ] **Step 4: Run** → FAIL. **Step 5: Implement.** `new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', processEntities: true, isArray: (name) => ['item','entry','link','url','sitemap'].includes(name) })`. Because `link` is forced to an array, RSS `<link>text</link>` arrives as `['text']`: write a `text(v: unknown): string | null` helper that unwraps arrays (first non-empty), `{#text}` objects, strings and numbers, and use it everywhere. fast-xml-parser does not decode entities inside CDATA, hence the explicit `decodeEntities` on titles.
- [ ] **Step 6: Run tests** → PASS; `pnpm lint && pnpm typecheck`.
- [ ] **Step 7: Commit.**

```bash
git add packages/core
git commit -m "feat(collect): rss/atom, sitemap and page-title parsers with fixtures"
```

---

### Task 8: HTTP fetcher, source_state, shared test server

**Files:**
- Create: `packages/core/src/collect/http.ts`, `packages/core/src/collect/state.ts`, `packages/core/src/test/server.ts`, `packages/core/src/collect/http.test.ts`, `packages/core/src/collect/state.test.ts`

**Interfaces:**
- Consumes: `Db`, `sourceState` table, `testDb`, `resetDb` (Task 5).
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

  `conditionalGet` sends `If-None-Match` / `If-Modified-Since` when stored, `User-Agent`, `Accept: application/xml, text/xml, application/rss+xml, application/atom+xml, */*`; follows redirects; default timeout 20000 ms via `AbortSignal.timeout`; 304 → `not_modified` (echoing the stored validators); 2xx → `ok` with the response's ETag/Last-Modified; any other status throws `Error('HTTP <status> for <url>')`; network/timeout errors propagate. `getText` is the same without validators and returns the body, throwing on non-2xx. `fetchFn` defaults to global `fetch`.
  - `state.ts`: `getState(db, sourceId): Promise<CachedState | null>` (null when there is no `source_state` row at all — Task 9 uses this to detect a source's first run); `recordSuccess(db, sourceId, v: CachedState, now: Date)` (upsert, sets `last_run_at`, clears `last_error`); `recordFailure(db, sourceId, message: string, now: Date)` (upsert, sets `last_error` + `last_run_at`, keeps etag/last_modified).
  - `test/server.ts` (shared by Tasks 8, 9, 10):

```ts
import type { IncomingMessage } from 'node:http';
export interface RouteResponse { status?: number; headers?: Record<string, string>; body?: string; delayMs?: number }
export type Route = RouteResponse | ((req: IncomingMessage) => RouteResponse);
export interface TestServer {
  baseUrl: string;                                   // e.g. http://127.0.0.1:41234
  requests: { method: string; path: string; headers: IncomingMessage['headers'] }[];
  hits(path: string): number;                        // count of requests to that path (query excluded)
  setRoute(path: string, route: Route): void;
  close(): Promise<void>;                            // calls server.closeAllConnections() first, so stalled routes cannot hang the test run
}
export function startServer(routes?: Record<string, Route>): Promise<TestServer>; // port 0; unknown path → 404; default status 200
```

- [ ] **Step 1: Write `test/server.ts`** per the interface above (plain `node:http`, `delayMs` implemented with `setTimeout` before writing the response).
- [ ] **Step 2: Write failing `http.test.ts`** using `startServer` (close in `afterEach`). Tests: first request has no conditional headers and returns body + ETag + Last-Modified (route returns `headers: {etag:'"v1"', 'last-modified':'Wed, 01 Oct 2026 00:00:00 GMT'}`); second call with those validators sends `If-None-Match`/`If-Modified-Since` (route function inspects `req.headers` and returns status 304) and yields `not_modified` with the same validators; a 500 route throws an error containing `500`; a route with `delayMs: 500` and `timeoutMs: 50` rejects; a 301 route (`headers: {location: '/final'}`) to a 200 `/final` is followed; request carries the `User-Agent` header; `getText` returns the body and throws on 404.
- [ ] **Step 3: Write failing `state.test.ts`** (real Postgres, `resetDb` in `beforeEach`): `getState` returns null for unknown; `recordSuccess` then `getState` returns validators; `recordFailure` after success keeps validators and sets `last_error`; a later `recordSuccess` clears `last_error`; `recordFailure` on an unknown source creates a row (`getState` then returns non-null with null validators).
- [ ] **Step 4: Run** → FAIL. **Step 5: Implement** `http.ts` and `state.ts`.
- [ ] **Step 6: Run** `pnpm test` → PASS; `pnpm lint && pnpm typecheck`.
- [ ] **Step 7: Commit.**

```bash
git add packages/core/src
git commit -m "feat(collect): conditional GET fetcher, source_state persistence, shared test server"
```

---

### Task 9: Collect orchestrator with dedup and backfill

**Files:**
- Create: `packages/core/src/collect/collect.ts`, `packages/core/src/collect/dedup.ts`, `packages/core/src/collect/collect.test.ts`, `packages/core/src/collect/dedup.test.ts`
- Modify: `packages/core/src/index.ts` (export public API)

**Interfaces:**
- Consumes: `Db`, `articles`, `testDb`, `resetDb` (Task 5); `normalizeUrl`, `titleHash`, `utcDayBounds`, `passesFilter`, `passesPathFilter` (Task 6); `parseFeed`, `parseSitemap`, `isSitemapIndex`, `parseSitemapIndex`, `parsePageTitle`, `RawEntry`, `readFixture` (Task 7); `conditionalGet`, `getText`, `FetchFn`, `getState`, `recordSuccess`, `recordFailure`, `startServer` (Task 8); `Source`, `Config` from `@attn/shared`.
- Produces:

```ts
export interface Candidate { sourceId: string; url: string /*normalized*/; guid: string; title: string; titleHash: string; publishedAt: Date }
export async function urlExists(db: Db, url: string): Promise<boolean>;
export async function isDuplicate(db: Db, c: Candidate): Promise<boolean>;
   // true if articles has the same url, OR the same guid (global, any source), OR the same title_hash with published_at on the same UTC day

export interface SourceReport {
  sourceId: string; status: 'ok' | 'not_modified' | 'error';
  seen: number;       // entries returned by the parser (rss entries, or sitemap urls under path_prefix)
  inserted: number; duplicates: number; tooOld: number;
  skipped: number;    // invalid/non-http url, missing title (rss), failed filter, sitemap url without lastmod on the first run
  error?: string;
}   // invariant on status 'ok': seen === inserted + duplicates + tooOld + skipped
export interface CollectOptions { db: Db; sources: Source[]; config: Pick<Config,'backfill_days'>; fetchFn?: FetchFn; now?: Date; backfillDays?: number; timeoutMs?: number; onlySourceIds?: string[] }
export async function collectSource(opts: Omit<CollectOptions,'sources'|'onlySourceIds'> & { source: Source }): Promise<SourceReport>;
export async function collectAll(opts: CollectOptions): Promise<SourceReport[]>; // sequential, never throws for per-source failures
```

Behavior of `collectSource` (rules from Decisions apply: guid dedup is global; published_at fallback = `now`; same UTC day; first run = `getState` returned null):
1. `state = getState`; `conditionalGet(source.url, state, fetchFn, timeoutMs)`. `not_modified` → `recordSuccess` (keep validators), report `not_modified` (all counters 0).
2. rss: `parseFeed(body)`. sitemap: if `isSitemapIndex(body)`, fetch each child sitemap with `getText(childUrl, fetchFn, timeoutMs)` ONE level deep only (a child that is itself an index is an error for that child: ignored with no recursion; a failing child fails the source) and concatenate `parseSitemap(child, path_prefix)`; otherwise `parseSitemap(body, path_prefix)`. Dedupe repeated urls within the result.
3. Per entry, in this order: `normalizeUrl` (null → `skipped`); rss entry without title → `skipped`; `passesPathFilter(url, source.filter)` false → `skipped` (the filter applies to rss and sitemap sources alike); rss: `passesFilter({url,title}, filter)` false → `skipped`; sitemap entry with `lastmod === null` AND first run → `skipped` (avoids page-fetching every undated URL during backfill); `publishedAt` = entry date, else `now`; older than `now - backfillDays` days (option `backfillDays`, else `config.backfill_days`) → `tooOld`; future dates are kept as is; `guid` = entry guid or the normalized url.
4. sitemap only: `urlExists(db, url)` true → `duplicates++` with NO page fetch. Otherwise `getText(url, fetchFn, timeoutMs)` → `parsePageTitle`; on failure or no title use a slug title (last path segment, hyphens to spaces, first letter capitalised: `/news/beta` → `Beta`); then `passesFilter({url,title}, filter)` false → `skipped`.
5. Build the `Candidate` with `titleHash(title)`; `isDuplicate` true → `duplicates++`; else insert `{ sourceId, url, guid, title, titleHash, publishedAt }` with `.onConflictDoNothing({ target: articles.url })` (a conflict counts as a duplicate). `collected_at` and `label_status='pending'` come from defaults.
6. After the loop `recordSuccess(db, id, {etag, lastModified}, now)`. Any exception in steps 1-5 → `recordFailure` (message), report `status: 'error'` + `error`; rows inserted before the failure stay. A failed first run still creates a `source_state` row, so the next run is no longer a "first run" (accepted edge).
`collectAll`: if any `onlySourceIds` entry is not in `sources`, throw `new Error('unknown source id(s): nope')` (ids joined by `, `) before doing anything; runs sources sequentially; returns the reports.

- [ ] **Step 1: Write failing `dedup.test.ts`** (real Postgres; insert an existing article, then call): `urlExists` true/false; `isDuplicate`: same url → true; same guid but different url AND different source → true (global); same title_hash on the same UTC day, different url → true; same title_hash on a different day → false; unrelated → false.
- [ ] **Step 2: Write failing `collect.test.ts`.** Use `startServer` (Task 8) with routes built from `readFixture(name, server.baseUrl)` (set `now = new Date('2026-10-14T12:00:00Z')`, `config = { backfill_days: 180 }`), `resetDb` in `beforeEach`. Source objects point at `${baseUrl}/rss.xml` etc. Tests:
  1. `rss.xml` first run: report `seen 7, inserted 4, duplicates 0, tooOld 1, skipped 2` (inserted = First post, Tom & Jerry, Undated with `published_at = now`, Future; tooOld = Old; skipped = mailto + no-title). The stored url of "First post" is normalized (`…/posts/one`, no trailing slash); `title_hash` set; `label_status` `pending`; `source_state.etag` saved when the route sends an ETag.
  2. Second run, route answers 304 when `If-None-Match` matches: `not_modified`, row count unchanged.
  3. Route ignoring conditional headers (always 200): second run `inserted 0` and `duplicates === 4` (the four previously inserted), `tooOld 1`, `skipped 2`.
  4. `variants.xml`: `seen 4, inserted 1, duplicates 2, skipped 1` and exactly one row; the stored url is `…/Posts/Dup` (path case kept).
  5. `atom.xml` end to end: 3 inserted, titles `Atom one`, `Atom two`, `Atom three`.
  6. Sitemap, `path_prefix: '/news/'`, first run (no state): pages `/news/alpha` and `/news/beta` served as HTML with `og:title` `Alpha OG` / `Beta OG`; report `seen 4, inserted 2, tooOld 1 (ancient), skipped 1 (gamma: no lastmod, first run)`; titles stored from og:title; `published_at` equals lastmod. Second run (route 200, state now exists): `gamma` is inserted with `published_at = now` (page `/news/gamma` served), and `server.hits('/news/alpha')` is still 1 (existing URLs never refetched).
  7. Sitemap page 404 for `/news/beta` → inserted with slug title `Beta`.
  8. Sitemap index source: index route lists two children, each a small urlset; rows from both children inserted; a child that is itself an index adds nothing (no recursion) and does not crash.
  9. `collectAll` with a source answering 500 and a healthy source: healthy rows inserted, failing report `status 'error'`, its `source_state.last_error` contains `500`, healthy source `last_error` is null.
  10. A source whose route has `delayMs: 500` with `timeoutMs: 50`: report `error`, other source unaffected.
  11. `broken.xml` → error report, no rows, no etag saved.
  12. `backfillDays: 10` overrides config: only entries newer than 10 days inserted from `rss.xml` (cutoff 2026-10-04 12:00: First post, Undated and Future inserted = 3; Tom & Jerry and Old are tooOld = 2).
  13. `filter.xml` with `filter: { path_prefix: ['/blog/'], keywords: ['ai'] }` → inserted 1 (AI Gateway GA), skipped 2. Same filter on a sitemap source (`path_prefix` filter `exclude_path_prefix: ['/news/beta']`) skips beta.
  14. `collectAll({ onlySourceIds: ['nope'] })` rejects with a message containing `nope`; `onlySourceIds` with a valid id runs only that source.
- [ ] **Step 3: Run** → FAIL. **Step 4: Implement** `dedup.ts` and `collect.ts`; same-day check: `title_hash = $h AND published_at >= start AND published_at < end` using `utcDayBounds`. Export `collectAll`, `collectSource`, `isDuplicate`, `urlExists`, types from `index.ts`.
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
- Consumes: `createDb`, `runMigrations`, `testDb`, `resetDb` (Task 5); `dataDir`, `loadSources`, `loadConfig` (Task 3/4); `collectAll`, `SourceReport`, `FetchFn` (Task 9/8); `startServer` (Task 8); `readFixture` (Task 7). Root script `pnpm attn` → `tsx packages/core/src/cli.ts` (Task 1).
- Produces: `pnpm attn <command>`:
  - `pnpm attn migrate` — applies migrations to `DATABASE_URL` (idempotent).
  - `pnpm attn collect [--source <id>]... [--backfill-days <n>]` — `--source` may repeat (`parseArgs` `multiple: true`); `--backfill-days` must be a positive integer, otherwise exit 1. Loads sources + config from `env.ATTN_DATA_DIR ?? dataDir()` (call `loadSources(dir)`, `loadConfig(dir)` explicitly with that dir), runs `collectAll`, prints one line per source (`id  status  seen=… inserted=… dup=… old=… skipped=…  [error]`) and a totals line. Exit 0 even when individual sources failed (recorded in `source_state`); exit 1 on fatal problems (missing `DATABASE_URL`, invalid YAML, unknown `--source` — print the `unknown source id(s): …` message to `err` — invalid `--backfill-days`, unknown command).
  - `export async function run(argv: string[], env: NodeJS.ProcessEnv, io?: { out(s: string): void; err(s: string): void }, deps?: { now?: Date; fetchFn?: FetchFn }): Promise<number>`; the process entry at the bottom is guarded by `if (import.meta.url === pathToFileURL(process.argv[1]!).href)` and loads `.env` with `process.loadEnvFile('.env')` only when the file exists (Node 24 built-in).
  - Unknown command prints usage listing `migrate | collect` (`label` and `eval` come in Stage 2).

- [ ] **Step 1: Write failing `cli.test.ts`** calling `run()` directly. Setup: `startServer` serving `readFixture('rss.xml', baseUrl)` at `/rss.xml`; temp data dir (`fs.mkdtempSync`) containing `sources.yml` with one rss source pointing at it and a copy of the real `data/config.yml`; `env = { DATABASE_URL: TEST_DATABASE_URL, ATTN_DATA_DIR: tmp }` (pass the dir through `env`, not `process.env`); `deps.now = new Date('2026-10-14T12:00:00Z')` so fixture dates are deterministic. `resetDb` in `beforeEach`. Tests: (a) `run(['collect'], env, io, deps)` returns 0, output contains the source id and `inserted=4`, 4 rows in the DB; (b) `--source nope` returns 1 and `err` mentions `nope`; (c) missing `DATABASE_URL` returns 1; (d) unknown command returns 1 with usage; (e) `--backfill-days 10` honored (3 inserted: First post, Undated, Future); (f) `--backfill-days 0` and `--backfill-days abc` return 1; (g) `run(['migrate'], env, io)` returns 0 and returns 0 again when run a second time.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement `cli.ts`** (`node:util` `parseArgs`, no dependency).
- [ ] **Step 4: README.md skeleton** with sections: what ATTN is (one paragraph from spec §1), status (Stage 1 of 5: foundation + collect), Requirements (Node 24, pnpm, Docker), Quick start (`cp .env.example .env`, `docker compose up -d --wait`, `pnpm install`, `pnpm attn migrate`, `pnpm attn collect`), Commands table (`pnpm lint|typecheck|test`, `pnpm attn migrate|collect`), Layout (short tree from spec §2, marking apps/ and label/rank/levels/eval as upcoming), Data files (what each YAML does; `data/config.yml` is the single place for tunables), Evaluation (placeholder: "coming in Stage 2: how to run `attn eval`, read the report, add golden items, compare models"), License (MIT). No claims about unbuilt features beyond "planned".
- [ ] **Step 5: Verify tests.** `pnpm lint && pnpm typecheck && pnpm test` all green.
- [ ] **Step 6: Live smoke check against the real internet** (not part of CI): `docker compose up -d --wait`, `cp -n .env.example .env`, `pnpm attn migrate`, `pnpm attn collect`, show the full output. Expected: 14 report lines; most `ok` with `inserted>0`. A source or two erroring on the real network (including the `anthropic-*` sitemaps, which hit the real sitemap structure) is an expected finding to REPORT with its error text, not something to fix in this task. Then run `pnpm attn collect` again: sources return `not_modified` or `inserted=0`, no duplicate growth. Run `docker compose exec postgres psql -U attn -d attn -c "select source_id, count(*) from articles group by 1 order by 1"` and show it. Do NOT commit `.env`.
- [ ] **Step 7: Commit.**

```bash
git add packages/core/src/cli.ts packages/core/src/cli.test.ts README.md
git commit -m "feat(cli): attn migrate and attn collect; README skeleton"
```

---

## Self-Review

- **Spec coverage (§9.1):** monorepo/ts/vitest/eslint: Task 1; compose/.env/CI: Task 2; shared schemas: Task 3; data carry-over (taxonomy translated, 14 sources, config with every §7 key): Task 4; all §3.2 tables + migrations: Task 5; normalization/dedup/backfill/conditional GET/rss+atom/sitemap with path_prefix and og:title for new URLs: Tasks 6-9; `attn collect`: Task 10; README skeleton: Task 10; tests per §8 (fixtures, normalization, dedup, real-Postgres DB tests, no LLM): Tasks 5-10.
- **Deferred deliberately (later stages):** api/web compose services (Stage 3), secrets use (Stages 2-3), quiz and golden data (schemas only here), `label`/`eval`/`rank`/`levels`/`extract` modules, daily job, the label-stage logic that guarantees a primary skill per article.
- **Type consistency:** `Db`, `Source`, `SourceFilter`, `Config`, `RawEntry`, `SitemapUrl`, `CachedState`, `FetchFn`, `Candidate`, `SourceReport`, `TestServer`, `readFixture` are named identically across Tasks 3-10.
