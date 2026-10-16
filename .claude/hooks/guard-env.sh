#!/bin/bash
# PreToolUse (Bash): block shell commands that name .env / .env.local (secrets).
# Read/Edit of those files is denied in settings.json; this closes the `cat .env` path.
# .env.example and `process.env` are fine.

cmd=$(jq -r '.tool_input.command // empty')
# A commit message may mention .env; git commit never reads it (.env is gitignored).
[[ "$cmd" =~ ^[[:space:]]*git[[:space:]]+commit([[:space:]]|$) ]] && exit 0
if grep -Eq "(^|[[:space:]/'\"=<])\.env(\.local)?(\$|[[:space:];|&'\")>])" <<<"$cmd"; then
  echo 'Blocked by .claude/hooks/guard-env.sh: the command touches .env (secrets). Ask the user to run it, or use .env.example.' >&2
  exit 2
fi
exit 0
