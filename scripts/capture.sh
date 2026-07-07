#!/bin/sh
# agent-monitor hook entry point.
# Agents spawn hooks as plain processes whose PATH may not include node
# (common on macOS GUI apps). Locate node robustly, then run capture.mjs
# with stdin passed straight through. Always fail-open.
# First arg (optional) is the source agent tag (e.g. cursor, claude, codex),
# forwarded to capture.mjs and recorded as _source on each event.

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd)
[ -z "$DIR" ] && DIR="$(pwd)"

NODE=""
if command -v node >/dev/null 2>&1; then
  NODE=$(command -v node)
else
  for cand in \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    /usr/bin/node \
    "$HOME/Library/pnpm/node" \
    "$HOME/.local/share/pnpm/node" \
    "$HOME"/.nvm/versions/node/*/bin/node \
    "$HOME/.volta/bin/node" \
    /opt/local/bin/node
  do
    if [ -x "$cand" ]; then NODE="$cand"; break; fi
  done
fi

if [ -z "$NODE" ]; then
  printf '{"permission":"allow"}'
  exit 0
fi

exec "$NODE" "$DIR/capture.mjs" "$@"
