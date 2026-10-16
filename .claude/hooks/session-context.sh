#!/bin/bash
# SessionStart: local environment facts Claude would otherwise spend tool calls on.
# (Branch, git status and recent commits are already injected by Claude Code.)

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" || exit 0
if nc -z -G 1 localhost 5432 >/dev/null 2>&1; then
  echo 'Postgres: up on localhost:5432 (DB tests and `pnpm attn` will work).'
else
  echo 'Postgres: DOWN. DB tests and `pnpm attn` need `docker compose up -d --wait postgres` (ask the user first).'
fi
[ -f .env ] || echo 'No .env in this checkout: commands that need secrets (label, eval, api) will fail.'
[ -d node_modules ] || echo 'No node_modules in this checkout: run `pnpm install` first.'
exit 0
