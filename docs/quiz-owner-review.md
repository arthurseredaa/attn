# Quiz bank: owner review list

`data/quiz/dev.yml` is a DRAFT (see the README, "Onboarding and the quiz bank"). The owner reviews every
question; this list is the set of close level calls that the drafting and review rounds left open, so start here.
Each line names the question id, the option level in doubt and the doubt. Levels use the shared scale
(0 never touched it … 4 builds it / expert). Option ids are bank indexes, so re-level an option in place; do not
reorder the options of a question.

## Close level calls

| Question | Option level | Doubt |
|---|---|---|
| ai-sdk-1 | L0 | "Add the second vendor's client … route a few call sites with an env flag" is nearly the same approach as L1 ("install … copy its readme snippet"); arguably not worse than L1. |
| ai-code-governance-2 | L4 | Wording "block merging PRs that hold one" ("one" = a signed commit) is ambiguous. |
| ai-teaching-2 | L4 | Annotated weekly session logs: the only team-process L4 in the bank. |
| cc-hooks-2 | L0 | "Leave the permission prompts on, check them next morning" is safer than L1 (an instruction line), though the run stalls. |
| cc-mcp-usage-1 | L4 | Read replica through a reader account: raised from L3 (control moves into the database); the reviewer called it "arguably L4". |
| cc-plugins-2 | L4 | CI install gate on every OS was kept above L3 (tagged releases plus changelog); neither repairs the current incident (L2 does). |
| codebase-agents-1 | L4 | Service map regenerated from code on every merge vs L3 (read-code tool plus nightly re-index): is the gap a full level? |
| context-engineering-1 | L4 | Nested CLAUDE.md per folder plus a generated test command overlaps L3 (root plus nested files) on nesting; they differ only in generating the test command. |
| context-engineering-2 | L3 | Agent-maintained decision log in CLAUDE.md was kept above L2 (one-off notes file); appending to CLAUDE.md grows always-loaded context. |
| human-in-the-loop-1 | L0 | A notice after the fact ignores the required confirmation: a naive L0, but borderline (an option should not contradict the situation). |
| llm-observability-1 | L3 | Span processor alerting on steps over five seconds presumes spans exist, while the situation says nothing is logged in between; is it above L2 (per-call spans)? |
| llm-observability-1 | L4 | Trace id across services, workers and the gateway assumes a multi-service path. |
| model-selection-1 | L4 | Small-model-first cascade with a cut-off set on labelled calls vs L3 "rerun three models over a labelled set". |
| parallel-agents-1 | L3 | Orchestrator ruling: a worktree setup script with a port and a database copy per agent is L3 (custom setup for one's own need), not L2. The owner may revert it. |
| prompt-injection-1 | L4 | Refund check in tool code against the order owner and the mail server's sender check (L4) vs a separate typed-request model call (L3). |
| streaming-ui-1 | L4 | SSE with event ids and resume on reload is the only top option; the frame-batched flush was lowered to L2. |
| streaming-ui-2 | L3 | Token store outside React state, throttle and abort vs the three L2s; it aborts the stream on the client, while only an L2 passes the abort signal to the model call. Does L3 stop server generation? |
| structured-output-1 | L3 (x2) | Two L3s and no L4. Strict schema mode is a provider toggle (L1-L2 by the docs-toggle rule) but moves the check into decoding. |
| team-adoption-1 | L2 | Pairing on a real ticket and noting the blockers best answers "stopped after a week", yet sits below both L3s. |
| team-adoption-1 | L3 (x2) | No L4. The two L3s are CLAUDE.md plus a custom command, and a preinstalled dev container (lowered from L4). |
| tool-use-loop-1 | L3 | Orchestrator ruling: replaying recorded API responses is L3, but "rerun … by hand" weakens the harness reading. |
| tool-use-loop-2 | L3 | Failing loudly on a missing result id only detects the mismatch, while an L2 fixes the cause. |
| (whole bank) | L1 | Orchestrator ruling: "copy a documented example" is L1 (the taxonomy's L1 "following examples and defaults" wins over the authoring-rule example); adapting a documented example is L2. L1 instances: cc-hooks-1, cc-headless-ci-1, tool-use-loop-1, ai-sdk-1, ai-sdk-2. |

## Statistical residuals (information only)

All are under the limits the bank tests enforce; they are listed so a review does not reintroduce them.

| Scope | Signal | Note |
|---|---|---|
| questions 1-32 | situation echo gradient | rho -0.18 (p 0.02); best solver +0.17 to +0.24 inflation. |
| questions 1-32 | commas | +0.27 inflation. |
| questions 1-32 | sibling similarity | +0.26 inflation. |
| questions 33-64 | "D13" feature combination | +0.28 inflation. |
| questions 33-64 | coordination load (" and " plus commas) | best solver +0.35 inflation, inside the noise range; per-level ratio flat. |
| not stated | extended "lazy" word list (vendor, guide, tutorial …) | +0.21 inflation. |
| questions 33-64 | per-skill scored-level inflation for echo | up to +0.34 per skill; +0.12 per question. |
