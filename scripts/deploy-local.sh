#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE_DIR="${FASTRESEARCH_RELEASES_ROOT:-/home/dev/ci-releases/fastresearch}"
UNIT="${FASTRESEARCH_UNIT:-fastresearch.service}"
FORCE=0
SKIP_PULL=0

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --skip-pull) SKIP_PULL=1 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

uid="$(id -u)"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/${uid}}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=${XDG_RUNTIME_DIR}/bus}"

mkdir -p "$STATE_DIR"
cd "$ROOT"

if [[ "$SKIP_PULL" -eq 0 ]]; then
  git fetch origin main
  git pull --ff-only origin main
fi

sha="$(git rev-parse HEAD)"
prev=""
if [[ -f "$STATE_DIR/deployed-sha" ]]; then
  prev="$(tr -d '[:space:]' < "$STATE_DIR/deployed-sha")"
fi

if [[ "$FORCE" -eq 0 && "$sha" == "$prev" && -f dist/index.html ]] && systemctl --user is-active --quiet "$UNIT"; then
  echo "FastResearch already deployed $sha"
  exit 0
fi

if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi
npm run build
test -f dist/index.html

systemctl --user daemon-reload || true
systemctl --user restart "$UNIT"
systemctl --user is-active "$UNIT"
sleep 3
python3 - <<'PY'
import sys, urllib.error, urllib.request
urls = [
    "http://127.0.0.1:8787/api/health",
    "http://127.0.0.1:8787/",
    "http://127.0.0.1/",
]
ok = {200, 301, 302, 401}
for url in urls:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, method="GET"), timeout=8) as resp:
            status, body = resp.status, resp.read(120)
    except urllib.error.HTTPError as exc:
        status, body = exc.code, exc.read(120)
    text = body.decode("utf-8", "replace")
    if "/api/health" in url:
        if status != 200 or ("ok" not in text.lower() and "healthy" not in text.lower()):
            print("FAIL", url, status, text)
            sys.exit(1)
    elif status not in ok:
        print("FAIL", url, status, text)
        sys.exit(1)
    print("OK", status, url)
PY

echo "$sha" > "$STATE_DIR/deployed-sha"
echo "FastResearch deployed $sha"
