#!/bin/bash
# Fast unit tests only: no server, no browser. Used by `npm test` / `npm run test:fast`
# and the CI "Lint, parse, unit tests" job. The longer server and Playwright checks
# live in GitHub Actions (see .github/workflows/ci.yml).
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"
fail=0
shopt -s nullglob
tests=(tests/*.test.mjs)
if [ ${#tests[@]} -eq 0 ]; then
  echo "No tests/*.test.mjs files found"
  exit 1
fi
for t in "${tests[@]}"; do
  echo "== $t"
  node "$t" || fail=1
done
exit $fail
