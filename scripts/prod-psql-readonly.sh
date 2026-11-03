#!/usr/bin/env bash
# Read-only psql helper for the self-hosted PROD Supabase pooler.
# Connection parameters come from .env.local via scripts/lib/prod-pooler.sh
# (recipe: docs/OPS_LOCAL.md); nothing about the host lives in this file.
#
# Usage:
#   scripts/prod-psql-readonly.sh -At -c "select 1;"
#   scripts/prod-psql-readonly.sh -f /path/to/query.sql
#
# All args are passed through to psql. Every -c/-f runs inside one
# `BEGIN READ ONLY … ROLLBACK`, so an accidental write fails instead of landing
# on prod. (PGOPTIONS default_transaction_read_only does NOT work here: the
# Supavisor transaction pooler drops startup options — checked 2026-11-03,
# the setting read back as `off`.) Migrations/DDL: scripts/prod-migrate.sh.
set -euo pipefail

cd "$(dirname "$0")/.."
. scripts/lib/prod-pooler.sh
URL=$(prod_pooler_url)

exec psql "$URL" -q -v ON_ERROR_STOP=1 -c 'BEGIN READ ONLY' "$@" -c 'ROLLBACK'
