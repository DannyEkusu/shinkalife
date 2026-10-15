#!/usr/bin/env bash
# Runs the migrations + RLS tests against a throwaway local PostgreSQL (needs PG15+ binaries; Supabase auth is shimmed).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd); BIN=$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)
D=$(mktemp -d); SOCK=$D; PORT=54329
pg() { if [ "$(id -u)" = 0 ]; then chown postgres "$D"; su postgres -c "$*"; else bash -c "$*"; fi; }
trap 'pg "$BIN/pg_ctl -D $D/data stop -m immediate >/dev/null 2>&1" || true; rm -rf "$D"' EXIT
pg "$BIN/initdb -D $D/data -A trust -U postgres >/dev/null"
pg "$BIN/pg_ctl -D $D/data -o \"-k $SOCK -p $PORT -c listen_addresses=''\" -l $D/log -w start >/dev/null"
"$BIN/psql" -h "$SOCK" -p $PORT -U postgres -d postgres -v root="$ROOT" -f "$ROOT/tests/db/rls.sql" 2>&1 | grep -E "PASS|FAIL|ERROR" | sed 's/^psql:[^ ]* //' 
test "${PIPESTATUS[0]}" -eq 0
