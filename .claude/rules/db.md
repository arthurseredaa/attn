---
paths:
  - packages/core/src/db/**
  - packages/core/drizzle/**
  - packages/core/drizzle.config.ts
---

# Database schema and migrations

- The schema lives in `packages/core/src/db/schema.ts` (drizzle). Migrations in `packages/core/drizzle/` are generated
  output: never hand-edit them (edits there are denied in settings).
- To change the schema, use the `db-migration` skill.
- Migrations are applied by `pnpm attn migrate` (`packages/core/src/db/migrate.ts`, idempotent). The api Docker
  image runs it before start; in local dev (`pnpm api`) run it yourself after generating.
- Nothing references source ids by foreign key on purpose (a source removed from `data/sources.yml` keeps its
  articles). Do not add such a key.
