#!/bin/sh
# Build Agent Monitor.app (Release)
set -e

ROOT=$(cd "$(dirname "$0")/.." && pwd)
PROJECT="$ROOT/macos/AgentMonitor.xcodeproj"
SCHEME="AgentMonitor"
CONFIG="${1:-Release}"

echo "==> Building $SCHEME ($CONFIG)"
xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration "$CONFIG" \
  -derivedDataPath "$ROOT/macos/build" \
  build

APP="$ROOT/macos/build/Build/Products/$CONFIG/Agent Monitor.app"
if [ -d "$APP" ]; then
  echo ""
  echo "==> Built: $APP"
  echo "    Open with: open \"$APP\""
else
  echo "!! Build finished but .app not found at expected path" >&2
  find "$ROOT/macos/build" -name "Agent Monitor.app" -maxdepth 6 2>/dev/null
  exit 1
fi
