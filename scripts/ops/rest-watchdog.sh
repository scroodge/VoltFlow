#!/usr/bin/env bash
# PostgREST watchdog for self-hosted Supabase (runs ON the VPS, from cron, every minute).
#
# Why: 2026-10-07 supabase-rest wedged ("PGRST003 Timed out acquiring connection from
# connection pool") while Postgres was healthy; nothing alerted and nothing restarted it.
#
# Probe = a real query (`profiles?select=id&limit=1` with the public anon key). It needs a
# pool connection, so it fails when the pool is wedged. An unauthenticated GET is NOT
# enough: Kong answers 401 before PostgREST is reached.
#
# Acts when: container health is "unhealthy", OR the probe fails FAIL_THRESHOLD runs in a
# row. Restarts at most once per COOLDOWN_S, and tells Telegram about failures, restarts
# and recovery. Restart is skipped (alert only) when RESTART=0.
#
# Config: /etc/voltflow-watchdog.env (chmod 600), see docs/OPS_LOCAL.md section
# "PostgREST watchdog". Required: SUPABASE_URL SUPABASE_ANON_KEY TG_BOT_TOKEN TG_CHAT_ID

set -u

ENV_FILE="${WATCHDOG_ENV:-/etc/voltflow-watchdog.env}"
# shellcheck disable=SC1090
[ -r "$ENV_FILE" ] && . "$ENV_FILE"

: "${SUPABASE_URL:?missing in $ENV_FILE}"
: "${SUPABASE_ANON_KEY:?missing in $ENV_FILE}"
CONTAINER="${REST_CONTAINER:-supabase-rest}"
FAIL_THRESHOLD="${FAIL_THRESHOLD:-3}"
COOLDOWN_S="${COOLDOWN_S:-600}"
RESTART="${RESTART:-1}"
STATE_DIR="${STATE_DIR:-/var/lib/voltflow-watchdog}"
mkdir -p "$STATE_DIR"

exec 9>"$STATE_DIR/lock"
flock -n 9 || exit 0

FAILS_FILE="$STATE_DIR/fails"
LAST_RESTART_FILE="$STATE_DIR/last_restart"
ALERTED_FILE="$STATE_DIR/alerted"

notify() {
  [ -n "${TG_BOT_TOKEN:-}" ] && [ -n "${TG_CHAT_ID:-}" ] || return 0
  curl -s -m 10 -o /dev/null \
    --data-urlencode "chat_id=$TG_CHAT_ID" \
    --data-urlencode "text=$1" \
    "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" || true
}

health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER" 2>/dev/null || echo missing)"

body="$(mktemp)"
trap 'rm -f "$body"' EXIT
code="$(curl -s -m 15 -o "$body" -w '%{http_code}' \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  "$SUPABASE_URL/rest/v1/profiles?select=id&limit=1" || true)"
code="${code:-000}"

fails="$(cat "$FAILS_FILE" 2>/dev/null || echo 0)"

if [ "$code" = "200" ] && [ "$health" != "unhealthy" ]; then
  if [ -f "$ALERTED_FILE" ]; then
    notify "✅ PostgREST recovered (probe 200, health=$health)."
    rm -f "$ALERTED_FILE"
  fi
  echo 0 >"$FAILS_FILE"
  exit 0
fi

fails=$((fails + 1))
echo "$fails" >"$FAILS_FILE"
detail="$(head -c 200 "$body" | tr '\n' ' ')"
echo "$(date -u +%FT%TZ) probe=$code health=$health fails=$fails $detail"

[ "$fails" -ge "$FAIL_THRESHOLD" ] || [ "$health" = "unhealthy" ] || exit 0

if [ ! -f "$ALERTED_FILE" ]; then
  touch "$ALERTED_FILE"
  notify "🚨 PostgREST down: probe=$code health=$health fails=$fails ${detail}"
fi

[ "$RESTART" = "1" ] || exit 0

now="$(date +%s)"
last="$(cat "$LAST_RESTART_FILE" 2>/dev/null || echo 0)"
if [ $((now - last)) -lt "$COOLDOWN_S" ]; then
  exit 0
fi

echo "$now" >"$LAST_RESTART_FILE"
if docker restart "$CONTAINER" >/dev/null 2>&1; then
  notify "🔄 Restarted $CONTAINER (probe=$code health=$health). Will confirm recovery."
else
  notify "❌ docker restart $CONTAINER FAILED. Manual action needed."
fi
echo 0 >"$FAILS_FILE"
