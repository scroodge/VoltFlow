#!/usr/bin/env bash
# Compact, read-only prod query for agents. Wraps prod-psql-readonly.sh so the
# credential never appears in a command line or transcript, and caps output so
# one wide query cannot flood the context window.
#
# Usage:
#   scripts/prod-sql.sh "select count(*) from charging_sessions;"
#   scripts/prod-sql.sh -f /path/to/query.sql
#   PROD_SQL_MAX_LINES=200 scripts/prod-sql.sh "select ..."
#
# Output: unaligned, '|'-separated, with a header row; footer row counts off.
# Anything past PROD_SQL_MAX_LINES (default 60) is dropped with a note.
# For migrations/DDL use prod-psql-readonly.sh -f (see docs/OPS_LOCAL.md).
set -euo pipefail

if [ $# -eq 0 ]; then
  echo "usage: $0 \"<sql>\" | -f <file.sql>" >&2
  exit 2
fi

if [ "$1" = "-f" ]; then
  src=(-f "$2")
else
  src=(-c "$1")
fi

max=${PROD_SQL_MAX_LINES:-60}

"$(dirname "$0")/prod-psql-readonly.sh" -X -A -F '|' -P footer=off -P pager=off "${src[@]}" 2>&1 \
  | awk -v max="$max" 'NR <= max { print; next } { extra++ }
      END { if (extra) printf "[prod-sql: %d more lines truncated; narrow the query or set PROD_SQL_MAX_LINES]\n", extra }'
exit "${PIPESTATUS[0]}"
