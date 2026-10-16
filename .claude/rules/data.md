---
paths:
  - data/**
---

# Data files

- Every file in `data/` is validated by a zod schema from `packages/shared`. After editing one, run
  `pnpm exec vitest run packages/core/src/data.real.test.ts packages/core/src/quiz-data.test.ts`.
- `data/config.yml` is the single place for tunable numbers; read them from config instead of hardcoding in code.
- `data/sources.yml`: removing a source keeps its articles and `source_state` row. Before adding one, check that its
  article pages are reachable with the honest `attn-collector` User-Agent (see Known limitations in README.md).
- `data/quiz/dev.yml` is a DRAFT awaiting owner review (`docs/quiz-owner-review.md`); do not present it as final.
- `data/golden/` is the hand-labeled eval reference; change it only on the owner's instruction.
- Secrets never go into `data/`.
