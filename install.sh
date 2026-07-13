#!/bin/sh
# agent-monitor hook installer.
# Installs capture scripts into a project-independent location
# (~/.cursor/agent-monitor), then registers Cursor + Claude Code user hooks
# (merged, not clobbered). View captured events in the macOS menu bar app.
#
# Usage:  sh install.sh
set -e

SELF=$(cd "$(dirname "$0")" && pwd)
DST="$HOME/.cursor/agent-monitor"
CAP="$DST/scripts/capture.sh"

echo "==> Installing capture scripts into $DST"
mkdir -p "$DST/scripts" "$DST/assets"
cp "$SELF/scripts/capture.sh" "$SELF/scripts/capture.mjs" "$DST/scripts/"
cp "$SELF"/assets/* "$DST/assets/"
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

echo "==> Registering Claude Code user hooks (~/.claude/settings.json, merged)"
if [ -d "$HOME/.claude" ]; then
  CAP="$CAP" "$NODE" - <<'NODE'
const fs=require("fs"), os=require("os"), path=require("path");
const CAP=process.env.CAP;
const cmd=CAP+" claude";
const MATCHER=new Set(["PreToolUse","PostToolUse","PostToolUseFailure"]);
const EVENTS=["SessionStart","SessionEnd","UserPromptSubmit","PreToolUse","PostToolUse",
  "PostToolUseFailure","Stop","SubagentStop","PreCompact","Notification"];
const p=path.join(os.homedir(),".claude","settings.json");
let cfg={};
try{ cfg=JSON.parse(fs.readFileSync(p,"utf8"))||{}; }catch{}
cfg.hooks=cfg.hooks||{};
for(const e of EVENTS){
  const arr=Array.isArray(cfg.hooks[e])?cfg.hooks[e]:[];
  const has=arr.some(g=>g&&Array.isArray(g.hooks)&&g.hooks.some(h=>h&&typeof h.command==="string"&&h.command.includes("agent-monitor")));
  if(!has){
    arr.push(MATCHER.has(e)?{matcher:"",hooks:[{type:"command",command:cmd}]}:{hooks:[{type:"command",command:cmd}]});
  }
  cfg.hooks[e]=arr;
}
fs.mkdirSync(path.dirname(p),{recursive:true});
fs.writeFileSync(p, JSON.stringify(cfg,null,2)+"\n");
console.log("   wrote",p,"(only 'hooks' modified; other settings preserved)");
NODE
else
  echo "   ~/.claude not found — Claude Code not installed; skipped. Re-run after installing it."
fi

cat <<EOF

==> Cursor + Claude Code: hooks registered (merged, existing settings kept).
    - Cursor:      Reload Window (or restart Cursor) to load the hooks.
    - Claude Code: start a NEW claude session — settings.json is read at
                   session start, so a running session won't pick them up.

==> View captured events:
    Open the Agent Monitor macOS app and choose "Open Panel" (⌘O).
    Or build it:  sh scripts/build-macos-app.sh

==> Add MORE agents (they all stream into the same panel, tagged by source):

  Codex     ->  ~/.codex/hooks.json   (see docs/multi-agent.md)
     command:  "$CAP codex"
  Any agent ->  point its command-hook at:
     "$CAP <your-source-name>"
  If the new agent uses novel event names, add them to EVENT_ALIASES in
  $DST/assets/index.html (case-insensitive).

EOF
