#!/bin/bash
# End-to-end updater check: a RUNNING old build must notice a newer latest.json without a restart.
# Builds nothing itself: pass the debug binary (cargo build in src-tauri). Uses a throwaway signing key
# and a local feed, through the debug-only ZEN_UPDATE_* overrides (release builds ignore them).
#   bash tests/updater-e2e.sh <path-to-debug-zen-multiverse>
set -u
BIN=${1:?debug binary}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
CUR=$(python3 -c "import json;print(json.load(open('$ROOT/src-tauri/tauri.conf.json'))['version'])")
T=$(mktemp -d /tmp/zm-upd-e2e.XXXX); FEED=$T/feed; mkdir -p "$FEED" "$T/home"
fail=0; ok() { echo "ok   $1"; }; bad() { echo "FAIL $1"; fail=1; }
cleanup() { [ -n "${APP:-}" ] && kill -- -$APP 2>/dev/null; [ -n "${SRV:-}" ] && kill $SRV 2>/dev/null; wait 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT
CLI="npx -y @tauri-apps/cli@2"
$CLI signer generate --ci -p "" -w "$T/k" -f >/dev/null 2>&1 || { echo "FAIL signer generate"; exit 1; }
head -c 4096 /dev/urandom > "$FEED/pkg.bin"
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" $CLI signer sign -f "$T/k" -p "" "$FEED/pkg.bin" >/dev/null 2>&1 || { echo "FAIL signer sign"; exit 1; }
PORT=$(python3 -c 'import socket;s=socket.socket();s.bind(("",0));print(s.getsockname()[1])')
feed() { # version [sig override]
  python3 - "$1" "${2:-}" <<PY
import json,sys
sig=sys.argv[2] or open('$FEED/pkg.bin.sig').read()
p={'signature':sig,'url':'http://127.0.0.1:$PORT/pkg.bin'}
json.dump({'version':sys.argv[1],'notes':'test','pub_date':'2026-11-26T00:00:00Z',
  'platforms':{k:p for k in ['linux-x86_64','linux-x86_64-appimage','linux-x86_64-deb']}},open('$FEED/latest.json.tmp','w'))
PY
  mv "$FEED/latest.json.tmp" "$FEED/latest.json"
}
feed "$CUR"
(cd "$FEED" && exec python3 -m http.server $PORT --bind 127.0.0.1 >/dev/null 2>&1) & SRV=$!
LOG=$T/home/.local/share/io.thinkcore.zenmultiverse/logs/updater.log
HOME=$T/home XDG_DATA_HOME=$T/home/.local/share XDG_CONFIG_HOME=$T/home/.config XDG_CACHE_HOME=$T/home/.cache \
ZEN_UPDATE_URL=http://127.0.0.1:$PORT/latest.json ZEN_UPDATE_PUBKEY=$(cat "$T/k.pub") ZEN_UPDATE_FIRST_S=2 ZEN_UPDATE_EVERY_S=3 \
  setsid xvfb-run -a "$BIN" >"$T/app.out" 2>&1 & APP=$!  # own process group: cleanup stops xvfb, app and webkit together
waitfor() { for _ in $(seq 1 ${2:-60}); do grep -q "$1" "$LOG" 2>/dev/null && return 0; sleep 1; done; return 1; }
waitfor "up to date" 90 && ok "launch check: $CUR is up to date" || bad "no launch check (log: $(tail -2 "$LOG" 2>/dev/null))"
feed 9.0.0
waitfor "9.0.0 downloaded, ready" 30 && ok "running build found 9.0.0 without a restart" || bad "9.0.0 not picked up"
waitfor "9.0.0 already downloaded, waiting" 15 && ok "no re-download of the waiting update" || bad "re-downloaded 9.0.0"
feed 9.1.0 "dW50cnVzdGVkIGNvbW1lbnQ6IGJhZAo="
waitfor "download of 9.1.0 failed" 20 && ok "badly signed 9.1.0 refused" || bad "bad signature not refused"
feed 9.2.0
waitfor "9.2.0 downloaded, ready" 30 && ok "newer 9.2.0 replaces the waiting update" || bad "9.2.0 not picked up"
kill -0 $APP 2>/dev/null && ok "app still running" || bad "app exited"
echo "--- updater.log"; sed 's/^/  /' "$LOG" 2>/dev/null | tail -12
[ $fail = 0 ] && echo "ALL PASSED" || { echo "--- app output"; tail -20 "$T/app.out"; exit 1; }
