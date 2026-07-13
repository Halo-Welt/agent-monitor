#!/bin/sh
# Sync web assets + install kit into the macOS app bundle resources before build.
set -e

ROOT=$(cd "$(dirname "$0")/.." && pwd)
WRAPPER="${WRAPPER_NAME:-${FULL_PRODUCT_NAME:-Agent Monitor.app}}"
DEST="${TARGET_BUILD_DIR}/${WRAPPER}/Contents/Resources"

mkdir -p "$DEST/BundledAssets"
cp "$ROOT/assets/"* "$DEST/BundledAssets/"

mkdir -p "$DEST/install-kit/scripts" "$DEST/install-kit/assets"
cp "$ROOT/install.sh" "$DEST/install-kit/"
cp "$ROOT/scripts/"* "$DEST/install-kit/scripts/"
cp "$ROOT/assets/"* "$DEST/install-kit/assets/"
chmod +x "$DEST/install-kit/install.sh" "$DEST/install-kit/scripts/capture.sh"

echo "==> Synced panel assets + install kit to $DEST"
