# shellcheck shell=bash
# Sourced by the prod ops scripts. Builds the PROD pooler connection URL from
# .env.local so that no host, pooler user or password lives in tracked files.
#
# .env.local keys (see .env.example):
#   SUPABASE_POSTGRESS_PASSWORD   required
#   SUPABASE_POOLER_USER          required (Supavisor form: postgres.<tenant>)
#   SUPABASE_POOLER_SSH           ssh alias (e.g. from ~/.ssh/config). When set, the pooler is
#                                 reached ONLY through an SSH tunnel that is opened on demand:
#                                 127.0.0.1:$SUPABASE_POOLER_PORT → server 127.0.0.1:$SUPABASE_POOLER_REMOTE_PORT
#   SUPABASE_POOLER_PORT          local port; default 16543 with SSH, 6543 without
#   SUPABASE_POOLER_REMOTE_PORT   server-side pooler port, default 6543 (transaction mode / DDL)
#   SUPABASE_POOLER_HOST          required only WITHOUT SSH (direct connection)
#   SUPABASE_POOLER_SSLMODE       optional, default disable
#
# Usage (from a script whose cwd is the repo root):
#   . scripts/lib/prod-pooler.sh
#   URL=$(prod_pooler_url) || exit 1

_prod_env() {
  # Last assignment wins; strip surrounding single/double quotes.
  grep -E "^$1=" .env.local 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'"'"'"'
}

_port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

# Opens the tunnel if it is not already up. Port-forward only (-N): runs no command on the server.
_prod_tunnel() {
  local alias=$1 lport=$2 rport=$3 i
  _port_open "$lport" && return 0
  echo "prod-pooler: opening ssh tunnel 127.0.0.1:$lport → $alias:$rport" >&2
  ssh -f -N \
    -o ExitOnForwardFailure=yes -o ConnectTimeout=10 \
    -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
    -L "127.0.0.1:${lport}:127.0.0.1:${rport}" "$alias" </dev/null >/dev/null || {
      # stdout must be closed: callers run us inside $(...), which would otherwise
      # wait for the backgrounded ssh forever.
      echo "prod-pooler: ssh tunnel to $alias failed" >&2; return 1; }
  for i in 1 2 3 4 5 6 7 8 9 10; do
    _port_open "$lport" && return 0
    sleep 1
  done
  echo "prod-pooler: tunnel started but 127.0.0.1:$lport is not accepting connections" >&2
  return 1
}

prod_pooler_url() {
  local pw user ssh host port rport ssl missing=()
  pw=$(_prod_env SUPABASE_POSTGRESS_PASSWORD)
  user=$(_prod_env SUPABASE_POOLER_USER)
  ssh=$(_prod_env SUPABASE_POOLER_SSH)
  port=$(_prod_env SUPABASE_POOLER_PORT)
  rport=$(_prod_env SUPABASE_POOLER_REMOTE_PORT); rport=${rport:-6543}
  ssl=$(_prod_env SUPABASE_POOLER_SSLMODE); ssl=${ssl:-disable}
  [ -n "$pw" ]   || missing+=(SUPABASE_POSTGRESS_PASSWORD)
  [ -n "$user" ] || missing+=(SUPABASE_POOLER_USER)

  if [ -n "$ssh" ]; then
    host=127.0.0.1; port=${port:-16543}
  else
    host=$(_prod_env SUPABASE_POOLER_HOST); port=${port:-6543}
    [ -n "$host" ] || missing+=("SUPABASE_POOLER_HOST (or SUPABASE_POOLER_SSH)")
  fi
  if [ ${#missing[@]} -gt 0 ]; then
    echo "missing in .env.local: ${missing[*]} (recipe: docs/OPS_LOCAL.md)" >&2
    return 1
  fi
  if [ -n "$ssh" ]; then
    _prod_tunnel "$ssh" "$port" "$rport" || return 1
  fi
  printf 'postgresql://%s:%s@%s:%s/postgres?sslmode=%s' "$user" "$pw" "$host" "$port" "$ssl"
}
