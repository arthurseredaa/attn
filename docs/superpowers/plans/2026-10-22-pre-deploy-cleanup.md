# Pre-deploy Cleanup Plan

> **How to run this plan (new session):** work only in the worktree
> `/Users/arthursereda/Projects/attn/.claude/worktrees/pre-deploy-cleanup` (branch `chore/pre-deploy-cleanup`, based
> on `main` at `8160d27`). The orchestrating session does not edit files itself: each stage is done by one **Sonnet
> subagent**; the orchestrator reviews its diff and check output, then reports to the owner. One stage at a time.
> After each stage: stop, show what changed and the verification output, wait for the owner's explicit approval, then
> one commit for that stage and `git push` of the branch. After the last approved stage: open a PR into `main` and give
> the owner the link. Tick the checkboxes here as stages finish (the tick goes into that stage's commit).

**Goal:** Small fixes and housekeeping before deploy work starts in a separate session: more articles labeled per
daily run, the chosen labeler recorded in `.env.example`, stale docs corrected, a deploy TODO, and leftover git
worktrees and branches removed. No deploy work here.

## Context

- The daily job in `apps/api` (`schedule_cron: "0 6 * * *"`, UTC) already collects new articles, skips duplicates and
  labels pending ones. It labels at most `label_batch` per run (now 20); new articles average about 11 a day with
  spikes above 20, so the backlog can grow.
- Labeler chosen by eval on 2026-10-22 (`docs/superpowers/plans/2026-10-22-label-distillation.md`):
  `LABEL_MODEL=typesafe-ai/jev+claude-haiku-5-5` with `label_combo_fields: [difficulty, quality]` (committed in
  `data/config.yml`, `8160d27`). Golden eval report: `.cache/fable-2026-10-21/eval-combo.txt` in the main checkout.
  About $0.001 per article (Jev input + Haiku), two API keys needed: `JEV_API_KEY`, `ANTHROPIC_API_KEY`.
- CI runs on GitHub and is green (`gh run list`).
- An old, never-committed deploy plan lives only in the `deploy` worktree; the owner decided not to keep it (stage 4
  deletes it). Deploy will be planned from scratch in a separate session.

## Owner decisions (2026-10-22)

| # | Decision |
| --- | --- |
| Q1 | `.env.example` may be read and edited (owner allowed it in global Claude settings). The real `.env` stays off limits: never read, print or edit it, and never name it in a Bash command (a repo hook blocks that). |
| Q2/Q3 | Old deploy plan is not kept anywhere. `plans/deploy.md` gets a short TODO only. |
| Q4 | Remove worktrees `deploy` and `test` and branches `worktree-deploy` and `test`, after checking they hold no commits missing from `main`. |
| Q5 | The `attn_fable` database was the owner's own Fable comparison run. Nothing to investigate. |
| Q6 | Update facts only: README "MVP done-criteria and hand-off" and stage statuses in the label-distillation plan. Owner-pending items (quiz review, OAuth round trip, openai-news, archiving ai-news) stay as they are. |
| Q7 | Keep everything in `.cache/fable-2026-10-21/` in the main checkout (DB dumps, labels, eval reports, scripts). Do not touch, move or delete it. |
| Q8 | Four stages in the order below, each its own approval; stages 1–3 one commit each. |
| Q9 | The `.cache` archive is not copied anywhere now; the deploy TODO records it so it moves to backup storage during deploy. |
| — | Changes go through a PR from `chore/pre-deploy-cleanup`, never straight to `main`. PR and commits carry no Claude attribution lines. |

## Global constraints

- Change only what a stage names; anything else noticed goes into the stage report, not the diff.
- Commits: conventional style with scope (repo `CLAUDE.md`).
- After any edit in `data/`: `pnpm exec vitest run packages/core/src/data.real.test.ts packages/core/src/quiz-data.test.ts`
  (`.claude/rules/data.md`). DB tests need Postgres: `docker compose up -d --wait postgres` from the main checkout.
- The worktree has no `node_modules` yet: run `pnpm install --frozen-lockfile` once before the first check.
- No paid API calls in this plan (`pnpm attn label` / `eval` are not needed).

## Stage 1: Label up to 100 articles per daily run

- [x] **Goal:** the daily job keeps up with spikes of new articles.
- **Files:** `data/config.yml` (`label_batch: 20` → `100`; keep the comment above it accurate). README only if it
  states the number 20 for `label_batch` (line ~220 says "at most `label_batch`", which stays).
- **Verify:** the data tests above; `pnpm format:check`; `git diff` shows only the intended lines.
- **Commit:** `fix(data): label up to 100 articles per daily run`.

## Stage 2: Record the chosen labeler in .env.example

- [ ] **Goal:** a new setup sees which `LABEL_MODEL` was evaluated and chosen.
- **Files:** `.env.example` only: a comment next to the existing `LABEL_MODEL` comments, e.g.
  `# Evaluated choice (2026-10-22): typesafe-ai/jev+claude-haiku-5-5 with label_combo_fields [difficulty, quality]`
  `# in data/config.yml (docs/superpowers/plans/2026-10-22-label-distillation.md). Needs JEV_API_KEY and ANTHROPIC_API_KEY.`
  Values stay empty: `LABEL_MODEL=` is not filled in (README Evaluation: no default on purpose).
- **Verify:** `git diff` changes comment lines only, no `KEY=value` line changes.
- **Commit:** `docs(env): note the evaluated label model`.

## Stage 3: Refresh docs and record the deploy TODO

- [ ] **Goal:** docs match reality before deploy planning starts.
- **Files:**
  - `README.md`, section "MVP done-criteria and hand-off": the CI sentence ("configured but has never run: the repo
    has no remote yet") → CI runs on GitHub and is green; "Choose `LABEL_MODEL`…" → done (combo, with a pointer to
    the label-distillation plan); "Push to GitHub and see CI green" → done; "Build the Docker images (never built…)"
    → images were built and run locally with `docker compose` (2026-10). Other owner items unchanged.
  - `docs/superpowers/plans/2026-10-22-label-distillation.md`: stage headings 2, 3, 5 get "— done" with one line each
    (commit `1e4ccd4`; golden eval of the combo; relabel: 254 labeled, 230 excluded, 4 failed); stage 4 "— skipped"
    with the reason (combo already matches Jev on primary skill).
  - `plans/deploy.md` (new): short TODO for the future deploy session —
    - plan deploy from scratch (the old Hetzner draft was dropped on 2026-10-22);
    - server secrets: `JEV_API_KEY`, `ANTHROPIC_API_KEY`, `LABEL_MODEL=typesafe-ai/jev+claude-haiku-5-5`, GitHub OAuth;
    - the API's daily job collects and labels (`schedule_cron`, `label_batch: 100`); labeling ~$0.001 per article;
    - run `pnpm attn migrate` on deploy (the local DB once missed a migration: `source_state.feed_url`);
    - nightly DB backups off-site with a restore drill;
    - move the label-experiment archive `.cache/fable-2026-10-21/` (DB dumps, Haiku/Jev/Fable labels, eval reports,
      ~1 MB, local only today) into the backup storage.
- **Verify:** `pnpm format:check`; every repo path and commit hash named in the changed docs exists
  (`ls` / `git cat-file -t`).
- **Commit:** `docs: refresh hand-off and record deploy todo`.

## Stage 4: Remove leftover worktrees and branches

- [ ] **Goal:** only `main` and this branch remain.
- **Where:** git commands against the main repo (`git -C /Users/arthursereda/Projects/attn …`); nothing in this PR.
- **Do:**
  1. `git log main..worktree-deploy` and `git log main..test` must both be empty; if not, stop and report.
  2. `git worktree remove --force .claude/worktrees/deploy` (`--force` because it holds the untracked old deploy plan,
     deleted by owner decision Q3). Do not touch the main checkout's `.cache/`.
  3. `git worktree prune` (the `test` worktree's directory is already gone).
  4. `git branch -d worktree-deploy test` (`-d`, not `-D`: it refuses if anything is unmerged).
- **Verify:** show `git worktree list` (main + `pre-deploy-cleanup` only) and `git branch` (`main`,
  `chore/pre-deploy-cleanup`); `ls /Users/arthursereda/Projects/attn/.cache/fable-2026-10-21` still lists the archive.
- **Commit:** none.

## Finish

- [ ] Open a PR `chore/pre-deploy-cleanup` → `main` with `gh pr create`: title `chore: pre-deploy cleanup`, body listing
  the three commits and stage 4's result, no Claude attribution. Give the owner the link; the owner reviews and merges.
- After the merge (owner's call): remove this worktree.
