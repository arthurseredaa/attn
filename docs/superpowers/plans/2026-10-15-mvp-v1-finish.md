# Plan — finish MVP V1 (owner's ordered list, 2026-10-15)

Owner's order. Do the steps in sequence and tick them off here. The orchestrator delegates the work to subagents,
replies to the owner in Ukrainian, and asks before destructive DB changes, pushes and merges, unless a step below
already says the owner approved it.

State at writing (main = `ef71d11` + this file):

- `LABEL_MODEL=typesafe-ai/jev` is set in `.env`. The 389 backlog articles were labeled by Claude Code subagents
  (`label_model = claude-code-subagent:sonnet`). 8 too-short articles are marked failed.
- `pnpm api` and `pnpm web` run in herdr panes. Restart the API after every merge, because it does not watch files.
- Open branches and worktrees (under `.claude/worktrees/`):
  - `feat/ux-filters` (worktree `agent-a556b0bc5afb6c88b`). Commits:
    - 4d1f133: onboarding hides the nav and sign out
    - 1df3cc8: only the Read button marks a card read
    - bf9a068: skill filters + title search on For you / All, in query params
    - 326ddf5: filter-bar pending state
  - `feat/combo-labeler` (worktree `agent-a390321a23782334f`), commit baa565d. `LABEL_MODEL=<main>+<secondary>`
    takes secondary_skills from the second model and falls back to the main model's on any secondary failure.
    Review: Approved.
- Eval results and jev's known weaknesses are recorded in `docs/decisions.md` → "Labeler choice and eval results
  (2026-10-15)".

## 1. Finish the running checks, then merge feat/ux-filters

- [x] Scoped re-review of fix round 1 (326ddf5) → Approved (else at most one more fix round).
- [x] Merge `feat/ux-filters` into main locally (approved by the owner as part of this plan). Then:
  - run the full gate on main;
  - remove the worktree and delete the branch with `git branch -d`;
  - restart the API pane.
- [ ] Owner clicks through `/onboarding`, `/for-you` and `/all`:
  - filters;
  - search;
  - the Read button;
  - back/forward.

  These were never rendered in a browser by an agent.

## 2. Source cleanup — remove junk and keep it out of the DB

- [ ] Analysis (read-only): per-source quality stats, junk share and samples. Output: proposed drop/keep/narrow
  lists, collect-time rules (URL path include/exclude, title keywords, RSS categories) with blocked-junk vs
  wrongly-blocked counts measured on the DB, a label-time relevance gate as a fallback (jev boolean "is this about
  AI-assisted software engineering?"), and new tutorial-heavy sources.
- [ ] Show the proposal to the owner and get the go-ahead. Deleting existing junk rows is destructive: back up
  first, and mind the FKs on `article_events` and `article_skills`.
- [ ] Implement: `data/sources.yml` changes plus collect-time filtering in `packages/core/src/collect/`, with tests
  and docs. Then a review, a merge and the cleanup of the existing junk.

## 3. Merge feat/combo-labeler

- [ ] Rebase or merge onto the current main, run the gate, then merge locally and remove the worktree and branch.
  `LABEL_MODEL` stays `typesafe-ai/jev` unless the owner picks a combo. A natural candidate is
  `typesafe-ai/jev+...`, but the combo only swaps secondary skills. jev's weak field is difficulty, which would need
  a per-field combo.

## 4. Push to GitHub

- [ ] Ask the owner: repo name (`attn`?) and visibility (private/public). `gh` is logged in as `arthurseredaa`. The
  repo has no remote yet.
- [ ] `gh repo create`, push main, then watch CI (`.github/workflows/ci.yml`, which has never run) until it is green.
  Fix CI-only failures (the DB service, env) on a branch.

## 5. UI redesign with shadcn/ui

- [ ] Brainstorm the scope with the owner first: which pages, the look, and dark mode. Then a written spec and plan.
- [ ] Set up shadcn/ui in `apps/web` (Next 16, React 19, Tailwind 4) and migrate the pages (landing, onboarding,
  For you, All, Profile), the nav, the cards and the filter bar. Keep behaviour and tests and keep accessibility. The
  owner does a browser check at the end.

## 6. Teach `pnpm attn eval` + eval in CI

- [ ] Walk the owner through `pnpm attn eval --model <id>`:
  - what the golden set is (`data/golden/draft.yml`, the accepted Claude draft);
  - how to read the per-field report and the token/cost lines;
  - how to compare models;
  - how to add golden items.
- [ ] Add eval to CI together with the owner. Decide:
  - the trigger: manual `workflow_dispatch` or label/prompt/taxonomy changes, not every push, since it is paid;
  - a secrets setup, `JEV_API_KEY` as a GitHub secret;
  - pass/fail thresholds per field;
  - where the report goes (job summary or artifact).

## 7. Freeze MVP V1

- [ ] Update README "Status" and the hand-off list. Tag `v1.0.0` (push the tag only with the owner's OK).

## Parked (not part of V1 unless the owner says so)

- jev tuning: `jev_secondary_threshold` 0.3 / 0.4 and the difficulty bias (see decisions.md). About 2 cents per
  eval run.
- Multi-role storage (one `articles` pool + per-role `article_labels`), and type-based age decay for old articles
  with an optional Library view. The research conclusions are in the orchestrator's memory and not yet in the spec.
- Owner hand-off items still open:
  - quiz DRAFT review (`docs/quiz-owner-review.md`);
  - Docker image build;
  - openai-news decision;
  - archive `~/Projects/ai-news` after a trial.
