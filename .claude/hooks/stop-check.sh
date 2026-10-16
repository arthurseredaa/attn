#!/bin/bash
# Stop: if TS/JS files have uncommitted changes, run typecheck + lint and send failures
# back to Claude instead of letting the turn end. Blocks at most once per stop attempt
# (stop_hook_active) so a fix it cannot make does not loop forever.

input=$(cat)
[ "$(jq -r '.stop_hook_active // false' <<<"$input")" = true ] && exit 0
cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" || exit 0
git status --porcelain | grep -Eq '\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$' || exit 0

out=$( {
  pnpm typecheck || echo '^^ pnpm typecheck failed' # not -s: pnpm names the failing package
  pnpm -s lint || echo '^^ pnpm lint failed'
} 2>&1)
grep -q '^\^\^ pnpm' <<<"$out" || exit 0

jq -n --arg r "Uncommitted changes fail checks; fix them before finishing (last 4000 chars):
$(tail -c 4000 <<<"$out")" '{decision: "block", reason: $r}'
