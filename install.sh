#!/bin/sh
# agent-monitor installer.
# Installs the capture/panel scripts into a project-independent location
# (~/.cursor/agent-monitor), then registers Cursor user hooks (merged, not
# clobbered). Prints how to wire Claude Code / Codex / any other agent.
#
# Usage:  sh install.sh
set -e

SELF=$(cd "$(dirname "$0")" && pwd)
DST="$HOME/.cursor/agent-monitor"
CAP="$DST/scripts/capture.sh"

echo "==> Installing capture/panel into $DST"
mkdir -p "$DST/scripts" "$DST/assets"
cp "$SELF/scripts/capture.sh" "$SELF/scripts/capture.mjs" "$SELF/scripts/server.mjs" "$DST/scripts/"
cp "$SELF/assets/index.html" "$DST/assets/"
chmod +x "$DST/scripts/capture.sh"

NODE=$(command -v node || echo "")
if [ -z "$NODE" ]; then echo "!! node not found on PATH; install Node.js first."; exit 1; fi

echo "==> Registering Cursor user hooks (~/.cursor/hooks.json, merged)"
CAP="$CAP" "$NODE" - <<'NODE'
const fs=require("fs"), os=require("os"), path=require("path");
const CAP=process.env.CAP;
const cmd=CAP+" cursor";
const events=["sessionStart","sessionEnd","stop","beforeSubmitPrompt","afterAgentResponse",
  "afterAgentThought","preToolUse","postToolUse","postToolUseFailure","beforeShellExecution",
  "afterShellExecution","beforeMCPExecution","afterMCPExecution","beforeReadFile","afterFileEdit",
  "subagentStart","subagentStop","preCompact"];
const p=path.join(os.homedir(),".cursor","hooks.json");
let cfg={version:1,hooks:{}};
try{ cfg=JSON.parse(fs.readFileSync(p,"utf8"))||cfg; }catch{}
cfg.version=cfg.version||1; cfg.hooks=cfg.hooks||{};
for(const e of events){
  const arr=Array.isArray(cfg.hooks[e])?cfg.hooks[e]:[];
  if(!arr.some(h=>h&&typeof h.command==="string"&&h.command.includes("agent-monitor"))) arr.push({command:cmd});
  cfg.hooks[e]=arr;
}
fs.mkdirSync(path.dirname(p),{recursive:true});
fs.writeFileSync(p, JSON.stringify(cfg,null,2)+"\n");
console.log("   wrote",p);
NODE

cat <<EOF

==> Cursor: done. Reload Window (or restart Cursor) to load the hooks.

==> Start the panel:
    node "$DST/scripts/server.mjs"     # then open http://127.0.0.1:4517

==> Add MORE agents (they all stream into the same panel, tagged by source):

  Claude Code  ->  ~/.claude/settings.json  (see docs/multi-agent.md)
     command:  "$CAP claude"
  Codex        ->  ~/.codex/hooks.json       (see docs/multi-agent.md)
     command:  "$CAP codex"
  Any agent    ->  point its command-hook at:
     "$CAP <your-source-name>"
  If the new agent uses novel event names, add them to EVENT_ALIASES in
  $DST/assets/index.html (case-insensitive).

EOF
