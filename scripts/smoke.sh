#!/usr/bin/env bash
# End-to-end smoke for For you + feedback against the api only (no web, no GitHub, no labeling key).
# Needs DATABASE_URL (falls back to the one in .env), psql, curl, node. Env: API_PORT (default 3001), KEEP=1 to keep
# the smoke user and demo articles afterwards. Prints exactly nine "ok:" lines (checks a-i), exits non-zero on the first failure.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=.+' .env | head -1 | cut -d= -f2-)" || true
  DATABASE_URL="${DATABASE_URL%\"}"; DATABASE_URL="${DATABASE_URL#\"}"
  DATABASE_URL="${DATABASE_URL%\'}"; DATABASE_URL="${DATABASE_URL#\'}"
fi
: "${DATABASE_URL:?DATABASE_URL is required (export it or set it in .env)}"
export DATABASE_URL

API_PORT="${API_PORT:-3001}"
BASE="http://localhost:${API_PORT}/api"
GITHUB_ID=999001

if lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "smoke: port $API_PORT is already in use; pick a free one, e.g. API_PORT=3021 bash scripts/smoke.sh" >&2
  exit 1
fi

API_PID=""
SEEDED=0 # demo articles this script inserted; only those are removed afterwards
cleanup() {
  status=$?
  trap - EXIT
  set +e
  if [ -n "$API_PID" ]; then
    # the api runs in its own process group (set -m below): stop exactly that group
    kill -- "-$API_PID" 2>/dev/null
    pkill -P "$API_PID" 2>/dev/null
    kill "$API_PID" 2>/dev/null
  fi
  if [ "${KEEP:-}" = "1" ]; then
    echo "smoke: KEEP=1, smoke user (github_id $GITHUB_ID) and demo articles kept" >&2
  else
    psql "$DATABASE_URL" -qc "delete from users where github_id = $GITHUB_ID;" >/dev/null 2>&1
    if [ "$SEEDED" -gt 0 ]; then pnpm -s attn seed-demo --remove >/dev/null 2>&1; fi
  fi
  exit "$status"
}
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "ok: $*"; }
# js <json> <expression over d>: prints the value of the expression
js() { node -e 'const d = JSON.parse(process.argv[1]); const v = eval(process.argv[2]); process.stdout.write(String(v));' "$1" "$2"; }
check() { # check <label> <json> <expression that must be true>
  [ "$(js "$2" "$3")" = "true" ] || fail "$1: $3 on $(printf %s "$2" | head -c 400)"
}

pnpm -s attn migrate >/dev/null
SEED_OUT="$(pnpm -s attn seed-demo)"
SEEDED="$(printf %s "$SEED_OUT" | sed -n 's/.*demo articles: inserted=\([0-9][0-9]*\).*/\1/p' | head -1)"
SEEDED="${SEEDED:-0}"

TOKEN="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"
HASH="$(printf %s "$TOKEN" | shasum -a 256 | cut -d' ' -f1)"
psql "$DATABASE_URL" -qc "delete from users where github_id = $GITHUB_ID;"
psql "$DATABASE_URL" -qc "insert into users (github_id, login, name) values ($GITHUB_ID, 'smoke', 'Smoke');"
psql "$DATABASE_URL" -qc "insert into sessions (id, user_id, expires_at) select '$HASH', id, now() + interval '1 day' from users where github_id = $GITHUB_ID;"

set -m
SCHEDULE_ENABLED=false COOKIE_SECURE=false PORT="$API_PORT" pnpm -s api >/dev/null 2>&1 &
API_PID=$!
disown "$API_PID"
set +m
for _ in $(seq 1 60); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/health" || true)" = "200" ] && break
  kill -0 "$API_PID" 2>/dev/null || fail "api exited before becoming healthy"
  sleep 1
done
[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/health" || true)" = "200" ] || fail "api not healthy on $BASE/health"

get() { curl -sf -H "cookie: attn_session=$TOKEN" "$BASE$1"; }
post() { curl -sf -X POST -H "cookie: attn_session=$TOKEN" -H 'content-type: application/json' -d "$2" "$BASE$1"; }

# a. before onboarding the feed is empty
F0="$(get /feed)"
check a "$F0" 'd.items.length === 0'
ok "feed is empty before onboarding"

# b. onboarding with two focus skills and no quiz answers
post /onboarding '{"focus":["context-engineering","cc-hooks"],"answers":[]}' >/dev/null
ok "onboarding with focus context-engineering, cc-hooks"

# c. first page
P1="$(get /feed)"
check c "$P1" 'd.items.length === 20 && d.nextOffset === 20 && d.items.every((c) => c.quality >= 2)'
check c "$P1" '["context-engineering", "cc-hooks"].includes(d.items[0].skills.find((s) => s.isPrimary).id)'
ok "first page has 20 cards, quality >= 2, first card in a focus skill"

# d. second page, no repeats
P2="$(get '/feed?offset=20')"
check d "$P2" "d.items.length > 0 && !d.items.some((c) => ($(js "$P1" 'JSON.stringify(d.items.map((c) => c.id))')).includes(c.id))"
ok "second page has no cards from the first"

# e. read removes the article; a repeat is a no-op
READ_ID="$(js "$P1" 'd.items[0].id')"
R1="$(post "/articles/$READ_ID/events" '{"kind":"read"}')"
check e "$R1" 'd.recorded === true'
R2="$(post "/articles/$READ_ID/events" '{"kind":"read"}')"
check e "$R2" 'd.recorded === false'
P3="$(get /feed)"
check e "$P3" "!d.items.some((c) => c.id === $READ_ID)"
ok "read is recorded once and removes the article"

# f. not interested removes the next card
NI_ID="$(js "$P3" 'd.items[0].id')"
N1="$(post "/articles/$NI_ID/events" '{"kind":"not_interested"}')"
check f "$N1" 'd.recorded === true'
P4="$(get /feed)"
check f "$P4" "!d.items.some((c) => c.id === $NI_ID)"
ok "not_interested removes the card"

# g. like the read article
L1="$(post "/articles/$READ_ID/events" '{"kind":"like"}')"
check g "$L1" 'd.recorded === true'
ok "like on the read article"

# h. profile history and like share
PROFILE="$(get /profile)"
check h "$PROFILE" 'd.history.total === 1 && d.likes.share === 1'
ok "profile shows history.total 1 and likes.share 1"

# i. no cookie, no feed
CODE="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/feed")"
[ "$CODE" = "401" ] || fail "i: feed without a cookie returned $CODE"
ok "feed without a cookie is 401"
