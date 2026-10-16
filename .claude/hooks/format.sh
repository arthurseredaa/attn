#!/bin/bash
# PostToolUse (Edit|Write): oxlint --fix, then oxfmt, on the edited file.
# Lint errors that --fix cannot fix go back to Claude (exit 2 + stderr). Ignored and
# non-code files are skipped by the tools' own config (.oxlintrc.json, .oxfmtrc.json).

f=$(jq -r '.tool_input.file_path // empty')
[ -n "$f" ] && [ -f "$f" ] || exit 0
root=${CLAUDE_PROJECT_DIR:-$(pwd)}
case "$f" in "$root"/*) ;; *) exit 0 ;; esac
bin="$root/node_modules/.bin"
[ -x "$bin/oxfmt" ] || exit 0 # e.g. a fresh worktree before pnpm install
cd "$root" || exit 0

lint_out=
case "$f" in
  *.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs | *.mts | *.cts)
    lint_out=$("$bin/oxlint" --fix --quiet "$f" 2>&1) && lint_out=
    ;;
esac
"$bin/oxfmt" --no-error-on-unmatched-pattern "$f" >/dev/null 2>&1

if [ -n "$lint_out" ]; then
  printf 'oxlint errors remain in %s after --fix:\n%s\n' "$f" "$lint_out" >&2
  exit 2
fi
exit 0
