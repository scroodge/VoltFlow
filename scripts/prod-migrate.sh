#!/usr/bin/env bash
# Apply migration file(s) to the self-hosted PROD Supabase pooler.
# Connection parameters come from .env.local via scripts/lib/prod-pooler.sh
# (recipe: docs/OPS_LOCAL.md). Neither host nor password appears in this file,
# on the command line, or in a transcript.
#
# Usage:
#   scripts/prod-migrate.sh                      # list the 5 newest migrations, do nothing
#   scripts/prod-migrate.sh <file.sql>...        # DRY RUN: BEGIN; <file>; ROLLBACK
#   scripts/prod-migrate.sh --yes <file.sql>...  # apply for real (one transaction per file)
#
# Flags:
#   --yes          actually commit (without it every run is rolled back)
#   --no-reload    skip `NOTIFY pgrst, 'reload schema'` after applying
#
# Notes:
#   - Self-hosted has no schema_migrations table: the repo file is the only history,
#     so every migration must be IF NOT EXISTS-idempotent. Re-running is expected to be safe.
#   - Files containing CREATE INDEX CONCURRENTLY / VACUUM, or their own BEGIN;/COMMIT;,
#     are applied without the wrapper, and the dry run skips them (a dry run of a file
#     that COMMITs would really commit).
set -euo pipefail

cd "$(dirname "$0")/.."

yes=0; reload=1; files=()
for arg in "$@"; do
  case "$arg" in
    --yes) yes=1 ;;
    --no-reload) reload=0 ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | sed '$d'; exit 0 ;;
    *) files+=("$arg") ;;
  esac
done

if [ ${#files[@]} -eq 0 ]; then
  echo "newest migrations (pass one or more paths to dry-run them):"
  ls -1 supabase/migrations/*.sql | sort | tail -5
  exit 0
fi

. scripts/lib/prod-pooler.sh
URL=$(prod_pooler_url)

run() { psql "$URL" -X -q -v ON_ERROR_STOP=1 -P pager=off "$@" 2>&1 | head -40; return "${PIPESTATUS[0]}"; }

applied=0
for f in "${files[@]}"; do
  [ -f "$f" ] || { echo "no such file: $f" >&2; exit 1; }
  name=$(basename "$f")
  # Own BEGIN/COMMIT would commit through our dry-run wrapper; CONCURRENTLY/VACUUM
  # cannot run in a transaction at all. Both: no dry run, apply without -1.
  if grep -qiE 'CONCURRENTLY|^\s*VACUUM|^\s*(BEGIN|COMMIT)\s*;' "$f"; then
    if [ $yes -eq 0 ]; then
      echo "SKIP dry-run  $name (own tx control or non-transactional statements; review by eye, apply with --yes)"
      continue
    fi
    echo "APPLY (no tx) $name"
    run -f "$f"
  elif [ $yes -eq 0 ]; then
    echo "DRY RUN       $name"
    run -c 'BEGIN' -f "$f" -c 'ROLLBACK'
    echo "  ok — rolled back"
  else
    echo "APPLY         $name"
    run -1 -f "$f"
    echo "  committed"
  fi
  applied=$((applied + 1))
done

if [ $yes -eq 1 ] && [ $applied -gt 0 ] && [ $reload -eq 1 ]; then
  run -c "NOTIFY pgrst, 'reload schema'" && echo "PostgREST schema cache reload sent"
fi

[ $yes -eq 1 ] || echo "nothing committed — re-run with --yes to apply"
