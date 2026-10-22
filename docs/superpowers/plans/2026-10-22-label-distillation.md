# Label Distillation Plan (Fable → Haiku / Jev)

> Staged execution: one stage at a time. After each stage, stop, show what changed and the verification output, and
> wait for the owner's explicit approval before the next one. Commit and push a stage only after it is approved.

**Goal:** Make the cheap labelers (`claude-haiku-5-5`, `typesafe-ai/jev`) label closer to a strong reference by turning
the disagreements between them and Claude Fable 5.1 into explicit rules: sharper skill boundaries in
`data/taxonomy.yml`, calibrated rubrics in `packages/core/src/label/prompt.ts` and, for Haiku, a few worked examples.
Then pick `LABEL_MODEL` by eval and relabel.

**Approach:** Prompt-level distillation, no fine-tuning. Fable is the teacher on a training set; the golden set is only
ever used to measure. A rule stays only if eval on golden does not get worse.

**Budget:** about $5 of API credits in total (stage costs below). Planning price for Fable on this labeler:
~$0.042 per article (measured: 485 calls cost ~$20.4 on 2026-10-21; the token-based estimate was lower, see
Open questions).

## Starting data (2026-10-21)

Collected 488 articles (all 14 sources, `backfill_days: 180`) into the local `attn` database and labeled them three
ways with the project's own labeler and prompt:

| Labeler | Where | Result |
| --- | --- | --- |
| `claude-haiku-5-5` | DB `attn` | 484 labeled, 4 failed (fetch) |
| `typesafe-ai/jev` | DB `attn_jev` (copy of `attn`) | 263 labeled, 221 excluded by the relevance gate, 4 failed |
| `claude-fable-5-1` | `.cache/fable-2026-10-21/fable.jsonl` (DB untouched) | 484 labeled, $13.91 by token count |

Agreement with Fable on the 263 articles Jev kept:

| | primary | type | difficulty exact / ±1 | quality exact / ±1 |
| --- | --- | --- | --- | --- |
| Haiku | 51% | 76% | 43% / 96% | 51% / 98% |
| Jev | 73% | 89% | 20% / 71% | 33% / 93% |

Findings that drive the rules:

1. Haiku uses `agent-verification` and `context-engineering` as catch-alls. Fable moves Haiku's `agent-verification`
   to `ai-code-governance` (9), `evals` (7), `prompt-injection` (7), `cc-skills-commands` (7); Haiku's
   `context-engineering` to `cc-skills-commands` (6), `spec-driven-workflow` (3).
2. Jev's main primary confusion: `evals` → `model-selection` (6).
3. Both overrate difficulty and quality against Fable. Haiku is +1 on about half the articles and almost never off by
   2. Jev is +1..+3 on difficulty for 179 of 263 (75 of them by 2 or more).
4. Jev's relevance gate looks right: of the 221 excluded, Fable gave quality 1 to 174, 2 to 41, and 3 to only 6.

Files in `.cache/fable-2026-10-21/` (gitignored, not in git on purpose): `fable.jsonl` (one line per article: id, label,
usage, cost), `haiku.tsv` and `jev.tsv` (exported labels: `id|status|primary|secondaries|type|difficulty|quality`),
`compare.py` (the agreement report above), `fable-run.mts` (resumable Fable run with a cost cap), `label-loop.sh`
(runs `attn label` until nothing is pending).

## Global constraints

- **Train/test split.** 43 of the 58 golden articles are among the 488 collected ones. They are excluded from every
  training step (dossier, rule proposals, examples). Training set = the other 441. Golden is only for `attn eval`.
- `data/golden/` is not edited (owner's reference; `.claude/rules/data.md`). If Fable disagrees with golden, that is
  reported, not "fixed".
- Fable is a stronger labeler, not ground truth: it labeled with the same prompt at the lowest effort. Every rule it
  proposes is reviewed by the owner before it goes in.
- `pnpm attn label` / `pnpm attn eval` and every Fable call are paid: each paid run is named with its estimated cost
  and runs only after the owner says yes.
- `.env` is never read or printed; scripts load it with `process.loadEnvFile('.env')`.
- Skill ids in `taxonomy.yml` are not renamed or removed; only `description` text changes.
- Commits: conventional style with scope (`feat(label): ...`, `fix(data): ...`, `docs(plan): ...`), no Claude
  attribution lines.

## Stage 0: Baseline on golden

- **Goal:** Starting numbers for all three models on golden, and a check of the teacher: golden was itself drafted by
  Claude, so if Fable disagrees with it a lot, either Fable or golden needs a look before Fable writes rules.
- **Do:**
  - `pnpm attn eval --model claude-haiku-5-5` (~$0.05)
  - `pnpm attn eval --model typesafe-ai/jev` (cents, Vercel balance)
  - `pnpm attn eval --model claude-fable-5-1` (~$2.5)
  - Save each report to `.cache/fable-2026-10-21/eval-baseline-<model>.txt`.
- **Files:** none in git.
- **Verify:** three reports, each with `evaluated=` close to 58 and the metric lines (`primary_skill`,
  `secondary_skills`, `difficulty_exact`, `difficulty_within1`, `type`, `quality_within1`). Summary table in the
  stage report.
- **Gate:** if Fable's `primary_skill` on golden is not clearly above Haiku's and Jev's, stop and discuss before
  stage 1.

## Stage 1: Disagreement dossier

- **Goal:** 30–40 representative cases where Haiku or Jev disagree with Fable, grouped by pattern, for the owner to
  check and for Fable to learn from.
- **Do:** a script in `.cache/fable-2026-10-21/` that reads `haiku.tsv`, `jev.tsv`, `fable.jsonl` and the article
  titles and URLs from the `attn` DB, drops the 43 golden URLs, and writes `dossier.md`:
  - primary-skill confusion pairs with at least 3 cases (findings 1 and 2), 3–5 articles each;
  - difficulty and quality overrating, 5–8 articles per field across the scale;
  - per case: title, URL, Haiku / Jev / Fable labels.
- **Files:** none in git.
- **Verify:** `dossier.md` exists; no golden URL in it (checked by the script, count printed); the owner reads it and
  strikes any case where Fable itself looks wrong.
- **Cost:** none (no model calls).

## Stage 2: Fable proposes rules

- **Goal:** Draft rules from the reviewed dossier.
- **Do:** one Fable call (higher effort than labeling) with the dossier, the current skill descriptions, the rubrics
  and `LABELING_GUIDANCE`, asking for:
  1. new `description` text for each skill in a confusion pair, naming the boundary (the style already used by
     `cc-plugins` / `cc-skills-commands` and `ai-code-governance`);
  2. calibration lines for the difficulty and quality rubrics (what a 2 vs a 3 looks like);
  3. 10–15 short worked examples (title, 1–2 sentence summary, label, one-sentence reason), training set only.
  Article text is fetched again for the dossier cases, cut to `label_max_chars`.
- **Files:** `.cache/fable-2026-10-21/proposals.md` (not in git).
- **Verify:** the owner reads the proposals and marks which to take.
- **Cost:** ~$1–2.

## Stage 3: Skill boundaries and rubrics

- **Goal:** Apply the accepted rules where both labelers see them.
- **Do:**
  - `data/taxonomy.yml`: new `description` text for the accepted skills. Both labelers read descriptions: Haiku via
    `buildSystemPrompt`, Jev via the per-question `instructions` in `jev.ts`.
  - `packages/core/src/label/prompt.ts`: calibration lines in `DIFFICULTY_RUBRIC` / `QUALITY_RUBRIC`. Jev picks these
    constants up through `jev.ts`, so `jev.ts` does not change.
  - Decide with the owner whether a description change bumps `taxonomy.version` (it is stored per article as
    `taxonomy_version`; `docs/decisions.md` has no rule for description-only edits).
  - Update `prompt.test.ts` / taxonomy tests only where they pin the changed text.
- **Verify:**
  - `pnpm exec vitest run packages/core/src/data.real.test.ts packages/core/src/quiz-data.test.ts` (data rule)
  - `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`
  - `attn eval` for Haiku and Jev (~$0.1), compared with stage 0 per metric. A change that makes any metric worse by
    more than one article's worth is reverted or reworded, then re-measured.
- **Commit (after approval):** `feat(label): sharper skill boundaries and calibrated rubrics from Fable review`.

## Stage 4 (optional): Worked examples for Haiku

- **Goal:** Give Haiku the accepted examples. They go into the cached system prompt, so they cost almost nothing per
  call.
- **Do:** an `## Examples` block in `buildSystemPrompt` (`prompt.ts`), examples kept as a constant next to the
  rubrics. Jev gets none (no system prompt; adding them to every question would multiply input tokens).
- **Verify:** `pnpm test` (`prompt.test.ts` covers the new block), `pnpm typecheck`; `attn eval` for Haiku (~$0.05),
  compared with stage 3. Kept only if not worse.
- **Commit (after approval):** `feat(label): worked examples in the labeling prompt`.

## Stage 5: Pick LABEL_MODEL and relabel

- **Goal:** Choose the production labeler from the stage 3–4 eval numbers and relabel the local DB with it.
- **Candidates:** `claude-haiku-5-5`, `typesafe-ai/jev`, or a combo. Jev's strengths (primary, type, relevance gate)
  and Haiku's (difficulty, quality) may favour a combo; the current combo only takes secondary skills from the second
  model, so a per-field combo would be a separate change, proposed here and not built.
- **Do:** set `LABEL_MODEL` in `.env` (owner), reset labels to `pending` in the `attn` DB, run `label-loop.sh`.
- **Verify:** label distribution before and after (primary skill, difficulty, quality histograms), 10-article spot
  check against Fable labels.
- **Cost:** Haiku ~$0.5 for 488 articles; Jev cents.
- **Commit (after approval):** `.env.example` comment with the chosen model and why, if it changes.

## Open questions

- **Billing vs tokens:** credits fell by $20.62 on 2026-10-21 while the per-call usage sums to ~$14.4 at list
  prices; Console usage shows only Haiku 5.5 and Fable 5.1. Check Console → Cost by token type before the next paid
  run larger than a few dollars.
- **Cleanup:** the `attn_jev` database stays until stage 5 is done; drop it only on the owner's word.
