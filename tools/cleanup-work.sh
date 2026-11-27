#!/bin/bash
# Stop leftover servers and (optionally) build artifacts from THIS checkout only.
# Run from a Zen Multiverse checkout, or pass its path, when a work session is done.
#
#   bash tools/cleanup-work.sh [checkout]
#   bash tools/cleanup-work.sh --artifacts [checkout]
#
# --artifacts also deletes this checkout's src-tauri/target (Rust build cache).
#
# Safety: never touches processes whose working directory is outside this checkout,
# never touches anything listening on port 8787, never touches display :6, and
# never touches sand-host.
set -u
ART=0
ROOT=""
for a in "$@"; do
  case "$a" in
    --artifacts) ART=1 ;;
    -h|--help)
      awk 'NR==1{next} /^#/{sub(/^# ?/,""); print; next} {exit}' "$0"
      exit 0
      ;;
    *)
      if [ -n "$ROOT" ]; then
        echo "usage: bash tools/cleanup-work.sh [--artifacts] [checkout]" >&2
        exit 2
      fi
      ROOT=$a
      ;;
  esac
done
if [ -z "$ROOT" ]; then
  # Prefer the repo that contains this script; fall back to cwd if it looks like one.
  HERE=$(cd "$(dirname "$0")/.." && pwd)
  if [ -d "$HERE/src-tauri" ] || [ -f "$HERE/package.json" ]; then
    ROOT=$HERE
  else
    ROOT=$(pwd)
  fi
fi
ROOT=$(cd "$ROOT" && pwd) || exit 1
if [ ! -d "$ROOT/src-tauri" ] && [ ! -f "$ROOT/package.json" ]; then
  echo "Does not look like a Zen Multiverse checkout: $ROOT" >&2
  exit 1
fi

is_protected_pid() {
  local pid=$1 cmd cwd
  cmd=$(tr '\0' ' ' < /proc/$pid/cmdline 2>/dev/null || true)
  cwd=$(readlink /proc/$pid/cwd 2>/dev/null || true)
  case "$cmd" in
    *sand-host*|*sand-supervisor*|*sand-exit-watch*) return 0 ;;
    *Xvfb\ :6*|*Xvfb*:6\ *) return 0 ;;
  esac
  # Port 8787 is reserved for another agent's long-lived server.
  if command -v ss >/dev/null 2>&1; then
    if ss -lntp 2>/dev/null | grep -E ":8787\\b" | grep -q "pid=$pid"; then
      return 0
    fi
  fi
  return 1
}

cwd_in_root() {
  local cwd=$1
  [ -n "$cwd" ] && [ "$cwd" = "$ROOT" -o "${cwd#"$ROOT"/}" != "$cwd" ]
}

is_leftover_cmd() {
  local cmd=$1
  case "$cmd" in
    *'python3 -m http.server'*|*'python -m http.server'*) return 0 ;;
    *'wrangler dev'*|*'wrangler d1'*) return 0 ;;
    *'vite '*|*'/vite '*) return 0 ;;
    *'node scripts/soak.mjs'*|*'node scripts/soak'*) return 0 ;;
    *'tools/ci/smoke.py'*|*'tools/ci/collision.py'*|*'tools/ci/solids-export.py'*|*'tools/perf-pass.py'*) return 0 ;;
  esac
  return 1
}

stopped=0
skipped=0
for dir in /proc/[0-9]*; do
  pid=${dir#/proc/}
  cwd=$(readlink "$dir/cwd" 2>/dev/null) || continue
  cwd_in_root "$cwd" || continue
  cmd=$(tr '\0' ' ' < /proc/$pid/cmdline 2>/dev/null) || continue
  [ -n "$cmd" ] || continue
  if is_protected_pid "$pid"; then
    echo "skip protected pid $pid (port 8787, display :6, or sand-host)"
    skipped=$((skipped+1))
    continue
  fi
  is_leftover_cmd "$cmd" || continue
  echo "stop $pid  $cmd"
  kill "$pid" 2>/dev/null || true
  stopped=$((stopped+1))
done
# Give them a moment, then a firm stop if they're still around.
if [ "$stopped" -gt 0 ]; then
  sleep 1
  for dir in /proc/[0-9]*; do
    pid=${dir#/proc/}
    cwd=$(readlink "$dir/cwd" 2>/dev/null) || continue
    cwd_in_root "$cwd" || continue
    cmd=$(tr '\0' ' ' < /proc/$pid/cmdline 2>/dev/null) || continue
    is_protected_pid "$pid" && continue
    is_leftover_cmd "$cmd" || continue
    echo "stop -9 $pid  $cmd"
    kill -9 "$pid" 2>/dev/null || true
  done
fi

if [ "$ART" -eq 1 ] && [ -d "$ROOT/src-tauri/target" ]; then
  echo "remove $ROOT/src-tauri/target"
  rm -rf "$ROOT/src-tauri/target"
fi

echo "cleanup $ROOT: stopped $stopped leftover process(es), skipped $skipped protected"
