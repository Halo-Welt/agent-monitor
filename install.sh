#!/bin/sh
# agent-monitor hook installer.
# Installs capture scripts into a project-independent location
# (~/.cursor/agent-monitor), then registers Cursor, Claude Code, and Codex user hooks
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

echo "==> Registering Codex user hooks (~/.codex/hooks.json, merged)"
if [ -d "$HOME/.codex" ]; then
  CAP="$CAP" "$NODE" - <<'NODE'
const fs=require("fs"), os=require("os"), path=require("path");
const CAP=process.env.CAP;
const command=CAP+" codex";
const EVENTS=["SessionStart","UserPromptSubmit","PreToolUse","PermissionRequest","PostToolUse",
  "PreCompact","PostCompact","SubagentStart","SubagentStop","Stop"];
const LEGACY_EVENTS=["ToolExecution","TurnMetadata"];
const p=path.join(os.homedir(),".codex","hooks.json");
let cfg={};
if(fs.existsSync(p)){
  try{ cfg=JSON.parse(fs.readFileSync(p,"utf8")); }
  catch(e){ console.error("!! Cannot parse "+p+"; leaving it unchanged: "+e.message); process.exit(1); }
}
if(!cfg || Array.isArray(cfg) || typeof cfg!=="object"){
  console.error("!! "+p+" must contain a JSON object; leaving it unchanged."); process.exit(1);
}
if(cfg.hooks==null) cfg.hooks={};
if(Array.isArray(cfg.hooks) || typeof cfg.hooks!=="object"){
  console.error("!! "+p+" has a non-object 'hooks' field; leaving it unchanged."); process.exit(1);
}
const isOurs=h=>h&&typeof h.command==="string"&&h.command.includes("agent-monitor/scripts/capture.sh");
function withoutOurs(group){
  if(!group || typeof group!=="object") return group;
  if(isOurs(group)) return null; // migrate the pre-0.145 flat template
  if(!Array.isArray(group.hooks)) return group;
  const hooks=group.hooks.filter(h=>!isOurs(h));
  return hooks.length ? {...group,hooks} : null;
}
function groupsFor(event){
  const value=cfg.hooks[event];
  if(value==null) return [];
  if(!Array.isArray(value)){
    console.error("!! "+p+" has a non-array hook event '"+event+"'; leaving it unchanged.");
    process.exit(1);
  }
  return value.map(withoutOurs).filter(Boolean);
}
for(const event of EVENTS){
  const groups=groupsFor(event);
  groups.push({hooks:[{type:"command",command,timeout:5}]});
  cfg.hooks[event]=groups;
}
for(const event of LEGACY_EVENTS){
  if(cfg.hooks[event]==null) continue;
  const groups=groupsFor(event);
  if(groups.length) cfg.hooks[event]=groups;
  else delete cfg.hooks[event];
}
if(typeof cfg._comment==="string" && cfg._comment.startsWith("Template for Codex hooks")){
  delete cfg._comment;
  if(cfg.version===1) delete cfg.version;
}
fs.mkdirSync(path.dirname(p),{recursive:true});
const tmp=p+".agent-monitor.tmp";
fs.writeFileSync(tmp,JSON.stringify(cfg,null,2)+"\n");
fs.renameSync(tmp,p);
console.log("   wrote",p,"(existing hooks preserved)");
const configPath=path.join(os.homedir(),".codex","config.toml");
let toml="";
try{ toml=fs.readFileSync(configPath,"utf8"); }catch{}
if(/^\s*hooks\s*=\s*false\s*$/m.test(toml))
  console.log("   WARNING: config.toml disables hooks; remove 'hooks = false' to enable capture.");
if(/^\s*allow_managed_hooks_only\s*=\s*true\s*$/m.test(toml))
  console.log("   WARNING: allow_managed_hooks_only=true disables this user hook.");
NODE
else
  echo "   ~/.codex not found — Codex not installed; skipped. Re-run after installing it."
fi

cat <<EOF

==> Cursor + Claude Code + Codex: hooks registered where installed.
    - Cursor:      Reload Window (or restart Cursor) to load the hooks.
    - Claude Code: start a NEW claude session — settings.json is read at
                   session start, so a running session won't pick them up.
    - Codex:       start a NEW session, then open /hooks and trust the
                   Agent Monitor hooks if Codex marks them for review.

==> View captured events:
    Open the Agent Monitor macOS app and choose "Open Panel" (⌘O).
    Or build it:  sh scripts/build-macos-app.sh

==> Add MORE agents (they all stream into the same panel, tagged by source):

  Any agent ->  point its command-hook at:
     "$CAP <your-source-name>"
  If the new agent uses novel event names, add them to EVENT_ALIASES in
  $DST/assets/index.html (case-insensitive).

EOF
