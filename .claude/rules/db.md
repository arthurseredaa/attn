---
paths:
  - packages/core/src/db/**
  - packages/core/drizzle/**
  - packages/core/drizzle.config.ts
---

# Database schema and migrations

- The schema lives in `packages/core/src/db/schema.ts` (drizzle). Migrations in `packages/core/drizzle/` are generated
  output: never hand-edit them (edits there are denied in settings).
- Generate: `pnpm --filter @attn/core db:generate --name <what>`. Read the generated SQL before running tests or
  `pnpm attn migrate`: vitest global setup applies migrations to `attn_test`.
- Migrations are applied by `pnpm attn migrate` (`packages/core/src/db/migrate.ts`, idempotent). The api Docker
  image runs it before start; in local dev (`pnpm api`) run it yourself after generating.
- The drizzle migrator compares only timestamps (`when` in `meta/_journal.json`), not hashes. A regenerated migration
  is re-applied on any DB that ran the old version and fails with "already exists".
- Fixing a wrong migration that is uncommitted: fix `schema.ts`, `rm` the new `.sql` and `meta/<n>_snapshot.json`,
  `git restore packages/core/drizzle/meta/_journal.json`, regenerate. If tests already applied it, also
  `psql postgres://attn:attn@localhost:5432/postgres -c 'drop database attn_test with (force)'` (recreated on the
  next test run); if the dev DB `attn`
  applied it, ask the owner. Once committed or deployed, never regenerate: add a forward migration.
- Tables added to the schema also go into the `TRUNCATE` list of `resetDb` in `packages/core/src/test/db.ts`.
- Nothing references source ids by foreign key on purpose (a source removed from `data/sources.yml` keeps its
  articles). Do not add such a key.
