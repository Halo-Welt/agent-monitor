#!/bin/sh
# Optional: wrap Agent Monitor.app in a .dmg (requires create-dmg: brew install create-dmg)
set -e

ROOT=$(cd "$(dirname "$0")/.." && pwd)
APP="$ROOT/macos/build/Build/Products/Release/Agent Monitor.app"
OUT="$ROOT/macos/build/Agent-Monitor.dmg"

if [ ! -d "$APP" ]; then
  echo "!! Run scripts/build-macos-app.sh first" >&2
  exit 1
fi

if ! command -v create-dmg >/dev/null 2>&1; then
  echo "!! create-dmg not found. Install: brew install create-dmg" >&2
  exit 1
fi

create-dmg \
  --volname "Agent Monitor" \
  --window-pos 200 120 \
  --window-size 600 400 \
  --icon-size 100 \
  --app-drop-link 450 185 \
  "$OUT" \
  "$APP"

echo "==> Created $OUT"
