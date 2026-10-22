# Labeler Choice Plan: per-field Jev + Haiku combo

> Staged execution: one stage at a time. After each stage, stop, show what changed and the verification output, and
> wait for the owner's explicit approval before the next one. Commit and push a stage only after it is approved.

**Goal:** Pick the production labeler by measurement. Jev is the best labeler for primary skill, type, secondary
skills and relevance; Haiku is the best for difficulty and quality. Build a combo that takes each field from the model
that is best at it, measure it on golden, and switch `LABEL_MODEL` to it.

**History:** the first version of this plan (commit `3605c2b`) distilled Fable's labels into rules for Haiku. Stage 0
showed Jev already close to Fable on primary skill and best on secondary skills, so the rules-for-Haiku stages were
dropped in favour of a per-field combo. Skill-boundary rules survive as an optional stage 4.

## Data (2026-10-21, local DB)

Collected 488 articles (all 14 sources, `backfill_days: 180`) and labeled them with the project's own labeler and
prompt:

| Labeler | Where | Result |
| --- | --- | --- |
| `claude-haiku-5-5` | DB `attn` | 484 labeled, 4 failed (fetch) |
| `typesafe-ai/jev` | DB `attn_jev` (copy of `attn`) | 263 labeled, 221 excluded by the relevance gate, 4 failed |
| `claude-fable-5-1` | `.cache/fable-2026-10-21/fable.jsonl` (DB untouched) | 484 labeled |

Files in `.cache/fable-2026-10-21/` (gitignored, kept out of git on purpose): `fable.jsonl`, `haiku.tsv`, `jev.tsv`
(`id|status|primary|secondaries|type|difficulty|quality`), `compare.py`, `combo_check.py`, `fable-run.mts`,
`label-loop.sh`, `eval-baseline-*.txt`.

43 of the 58 golden articles are among the 488 collected ones. Anything learned from the 488 (stage 4) excludes them.

## Global constraints

- `data/golden/` is not edited (owner's reference; `.claude/rules/data.md`).
- Fable is a stronger labeler, not ground truth: it labeled with the same prompt at the lowest effort, and on golden
  it is worse than Haiku at exact difficulty (stage 0).
- `pnpm attn label` / `pnpm attn eval` and every Fable call are paid: each paid run is named with its estimated cost
  and runs only after the owner says yes.
- `.env` is never read or printed. Scripts get `DATABASE_URL` from the environment or `process.loadEnvFile('.env')`.
  (`label-loop.sh` greps `.env` and is fixed before it is used again.)
- Tunable choices go in `data/config.yml`, not in code.
- Commits: conventional style with scope, no Claude attribution lines.

## Stage 0: Baseline on golden — done

`pnpm attn eval` on all 58 golden articles, 0 failures each. Cost: Fable ~$2.4, Haiku ~$0.03, Jev ~$0.02.

| golden (58) | Fable 5.1 | Haiku 5.5 | Jev |
| --- | --- | --- | --- |
| primary_skill | 75.9% | 55.2% | 70.7% |
| secondary_skills | 30.3% | 20.3% | 51.3% |
| difficulty exact / ±1 | 50.0% / 98.3% | 56.9% / 98.3% | 36.2% / 91.4% |
| type | 91.4% | 86.2% | 86.2% |
| quality ±1 | 100% | 96.6% | 93.1% |

Reading: Jev is within 3 articles of Fable on primary skill and far ahead on secondary skills; its weak field is
difficulty. Haiku is the best at exact difficulty. 58 articles is a small sample: 5 points is about 3 articles.

## Stage 1: Free combo check against Fable — done

`combo_check.py` on the 263 articles Jev kept, every label compared with Fable's (no model calls):

| vs Fable (263) | primary | type | secondary (Jaccard) | difficulty exact / ±1 | quality exact / ±1 |
| --- | --- | --- | --- | --- | --- |
| Haiku | 50.6% | 75.7% | 31.7% | 43.0% / 95.8% | 50.6% / 98.1% |
| Jev | 73.4% | 89.0% | 20.5% | 20.2% / 71.1% | 32.7% / 93.2% |
| Combo (Jev + Haiku's difficulty, quality) | 73.4% | 89.0% | 20.5% | 43.0% / 95.8% | 50.6% / 98.1% |

Haiku's difficulty holds when its primary skill differs from Jev's (exact 42% vs 44% when they agree, ±1 96% both),
so mixing fields from two labels is sound. On secondary skills Fable sides with Haiku while golden sides with Jev;
golden is the owner's reference, so secondary skills stay Jev's.

## Stage 2: Per-field combo

- **Goal:** `LABEL_MODEL=typesafe-ai/jev+claude-haiku-5-5` takes the fields named in config from the second model.
- **Design (owner chose config, 2026-10-22):** a config list `label_combo_fields` in `data/config.yml`, which fields the
  second model supplies. Default `[secondary_skills]` keeps today's combo behaviour exactly; the production setting
  would be `[difficulty, quality]`. Alternative considered: a field list in the model string itself; rejected because
  tunable choices live in config.
- **Do:**
  - `packages/shared`: add `label_combo_fields` to the config schema (allowed values: `secondary_skills`, `difficulty`,
    `quality`, `type`; non-empty, no duplicates; default `[secondary_skills]`).
  - `packages/core/src/label/combo.ts`: generalise the merge from secondary skills to the configured fields.
    `secondary_skills` keeps `mergeSecondarySkills` (minus main's primary, deduped, at most 3). Relevance stays main's.
    On a secondary failure all configured fields stay main's, with the existing one-line warning.
  - `factory.ts` / `cli.ts` / the API job: pass the config value through to `createComboLabeler`.
  - `data/config.yml`: add the key with the default value and a comment.
  - README, Labeling → Combo: describe the setting.
- **Tests (first):** `combo.test.ts` — default reproduces today's output byte for byte; `[difficulty, quality]` takes
  those two from the secondary and everything else from main; secondary failure keeps main's fields and warns;
  config schema rejects unknown and duplicate fields.
- **Verify:** `pnpm exec vitest run packages/core/src/label/ packages/core/src/data.real.test.ts`, then `pnpm test`,
  `pnpm typecheck`, `pnpm lint`, `pnpm format:check`.
- **Cost:** none.
- **Commit (after approval):** `feat(label): choose which fields a combo takes from the second model`.

## Stage 3: Measure the combo on golden

- **Goal:** Confirm the combo on the owner's reference, not just on Fable.
- **Do:** set `label_combo_fields: [difficulty, quality]` locally, run
  `pnpm attn eval --model typesafe-ai/jev+claude-haiku-5-5` (~$0.05), save to
  `.cache/fable-2026-10-21/eval-combo.txt`.
- **Verify:** primary, type and secondary within one article of Jev's stage 0 numbers; difficulty and quality within
  one article of Haiku's. A bigger gap means the merge is wrong, not the models: back to stage 2.
- **Commit (after approval):** `data/config.yml` with the production value, `.env.example` comment naming the combo as
  the evaluated choice: `feat(data): label with the Jev + Haiku combo`.

## Stage 4 (optional): Skill boundaries from Fable

- **Goal:** Sharper `description` text for skills that both labelers confuse. Worth doing only if stage 3 still shows
  primary-skill misses the owner cares about.
- **Do:** dossier of primary-skill confusions from the 441 non-golden articles (`agent-verification`,
  `context-engineering`, `evals` / `model-selection` pairs), owner review, one Fable call for proposed descriptions
  (~$1–2), owner picks, edit `data/taxonomy.yml` (ids unchanged; decide with the owner whether a description-only
  change bumps `version`), eval the combo again (~$0.05). Kept only if golden does not get worse.
- **Commit (after approval):** `fix(data): sharper skill boundaries in the taxonomy`.

## Stage 5: Relabel

- **Goal:** Local DB labeled by the chosen combo.
- **Do:** owner sets `LABEL_MODEL` in `.env`; reset labels to `pending` in the `attn` DB; run the label loop.
- **Verify:** counts by status, histograms of primary skill / difficulty / quality before and after, 10-article spot
  check against Fable.
- **Cost:** ~$0.5 (Haiku part) + cents (Jev).

## Open questions

- **Billing vs tokens:** credits fell by $20.62 on 2026-10-21 while per-call usage sums to ~$14.4 at list prices;
  Console shows only Haiku 5.5 and Fable 5.1. Check Console → Cost by token type before the next paid run larger
  than a few dollars. Remaining credits: ~$84.
- **Cleanup:** the `attn_jev` database stays until stage 5 is done; dropped only on the owner's word.
