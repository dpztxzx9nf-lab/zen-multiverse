#!/bin/bash
# Server tests against a fresh local wrangler dev (D1 migrated, local persist) per test file.
# live-prod.mjs is skipped (it talks to the real server). Needs wrangler on PATH and server/.dev.vars
# (CI copies server/.dev.vars.example: test-only values).
#   bash tools/ci/server-tests.sh [test.mjs ...]
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd); PORT=${PORT:-8797}
TESTS=("$@"); [ ${#TESTS[@]} -eq 0 ] && TESTS=($(cd "$ROOT/server/test" && ls *.mjs | grep -v -E '^(live-prod|garden-walk)'))
P=$(mktemp -d /tmp/zm-ci-persist.XXXX); fail=0
stop() { [ -n "${WP:-}" ] && kill -- -$WP 2>/dev/null; WP=; sleep 1; }
trap 'stop; rm -rf "$P"' EXIT
for t in "${TESTS[@]}"; do
  rm -rf "$P"/*; cd "$ROOT/server"
  wrangler d1 migrations apply zen-mp --local --persist-to "$P" >"$P.mig.log" 2>&1 || { echo "FAIL $t: migrations"; tail -5 "$P.mig.log"; fail=1; continue; }
  setsid wrangler dev --local --port $PORT --ip 127.0.0.1 --persist-to "$P" >"$P.wr.log" 2>&1 & WP=$!
  up=0; for _ in $(seq 1 90); do curl -sf http://127.0.0.1:$PORT/health >/dev/null && { up=1; break; }; sleep 1; done
  if [ $up = 0 ]; then echo "FAIL $t: server did not start"; tail -20 "$P.wr.log"; stop; fail=1; continue; fi
  cd "$ROOT"; out=$(MP=http://127.0.0.1:$PORT timeout 600 node "server/test/$t" 2>&1); rc=$?
  if [ $rc -ne 0 ] || echo "$out" | grep -q "FAIL"; then echo "FAIL $t (exit $rc)"; echo "$out" | grep -E "FAIL|Error|debug" | head -12; echo "-- last lines:"; echo "$out" | grep -v "^  debug" | tail -25; fail=1; else echo "ok   $t"; [ -n "${VERBOSE:-}" ] && echo "$out"; fi
  stop
done
rm -f "$P.mig.log" "$P.wr.log"
[ $fail = 0 ] && echo "ALL PASSED" || exit 1
