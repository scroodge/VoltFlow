#!/usr/bin/env bash
# Read-only psql helper for the self-hosted PROD Supabase pooler.
# Connection recipe: docs/OPS_LOCAL.md. TLS is not available on the Supavisor
# pooler, so this intentionally uses sslmode=disable.
#
# Usage:
#   scripts/prod-psql-readonly.sh -At -c "select 1;"
#   scripts/prod-psql-readonly.sh -f supabase/migrations/<file>.sql   # DDL, not read-only
#
# All args are passed through to psql. For plain queries (-c/-At), the
# session is forced into READ ONLY mode via PGOPTIONS so an accidental
# write fails instead of landing on prod.
set -euo pipefail

cd "$(dirname "$0")/.."

PW=$(grep -E '^SUPABASE_POSTGRESS_PASSWORD=' .env.local | cut -d= -f2- | tr -d '"'"'"'"')
if [ -z "$PW" ]; then
  echo "SUPABASE_POSTGRESS_PASSWORD not found in .env.local" >&2
  exit 1
fi

export PGOPTIONS="-c default_transaction_read_only=on"

exec psql "postgresql://postgres.voltflow:${PW}@supabase.voltflow.life:6543/postgres?sslmode=disable" \
  -v ON_ERROR_STOP=1 "$@"
