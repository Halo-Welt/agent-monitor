#!/usr/bin/env node
// agent-monitor capture hook.
// Reads a hook event (JSON on stdin), appends it to ~/.cursor/observer/events.jsonl,
// and snapshots transcript files on stop/sessionEnd/subagentStop.
// Hard rule: this must NEVER block the agent. Any failure still exits 0 and returns "allow".

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const OBS_DIR = path.join(os.homedir(), ".cursor", "observer");
const EVENTS_FILE = path.join(OBS_DIR, "events.jsonl");
const TX_DIR = path.join(OBS_DIR, "transcripts");

// A single event can carry a full file's contents or a huge tool payload (hosts
// like Cursor cap fields near 1 MB). Left raw, the log balloons to hundreds of
// MB and the panel can't load it. Truncate any one string to ~20 KB — enough to
// stay useful in the UI — and roll the log past 128 MB so disk stays bounded.
const MAX_STR = 20 * 1024;
const MAX_LOG = 128 * 1024 * 1024;

function truncateStrings(value, depth) {
  if (depth > 12) return value;
  if (typeof value === "string") {
    return value.length > MAX_STR
      ? value.slice(0, MAX_STR) + "…[+" + (value.length - MAX_STR) + " chars truncated]"
      : value;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = truncateStrings(value[i], depth + 1);
  } else if (value && typeof value === "object") {
    for (const k of Object.keys(value)) value[k] = truncateStrings(value[k], depth + 1);
  }
  return value;
}

function rotateIfLarge() {
  try {
    const st = fs.statSync(EVENTS_FILE);
    if (st.size > MAX_LOG) {
      // Keep one archive generation so the roll never drops history outright.
      fs.renameSync(EVENTS_FILE, EVENTS_FILE + ".1");
    }
  } catch { /* no file yet, or stat failed — nothing to rotate */ }
}

function allow() {
  try { process.stdout.write('{"permission":"allow"}'); } catch {}
}

function safeName(value, fallback) {
  const v = String(value == null ? "" : value).replace(/[^a-zA-Z0-9._-]/g, "_");
  return v || fallback;
}

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(data); } };
    try {
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (c) => { data += c; });
      process.stdin.on("end", done);
      process.stdin.on("error", done);
      const t = setTimeout(done, 2000);
      if (t.unref) t.unref();
    } catch { done(); }
  });
}

function isToolResultUser(msg) {
  const content = msg && msg.content;
  return Array.isArray(content) && content.length > 0 &&
    content.every((c) => c && typeof c === "object" && c.type === "tool_result");
}

function isRealUserPrompt(entry, msg) {
  if (!msg || msg.role !== "user") return false;
  if (entry && entry.isMeta) return false; // skill / system injections
  if (isToolResultUser(msg)) return false;
  return true;
}

// Claude Code hooks don't include token usage; the transcript does (per assistant
// message). Aggregate one turn — prefer matching prompt_id, else the latest real
// user prompt. Dedup by message.id (one API response may span multiple lines).
function usageFromClaudeTranscript(transcriptPath, promptId) {
  try {
    if (!transcriptPath || !fs.existsSync(transcriptPath)) return null;
    const text = fs.readFileSync(transcriptPath, "utf8");
    let turn = null;
    let matched = null;
    for (const line of text.split("\n")) {
      if (!line) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      if (o.isSidechain) continue;
      const msg = o.message;
      if (o.type === "user" && isRealUserPrompt(o, msg)) {
        turn = new Map();
        if (promptId && o.promptId === promptId) matched = turn;
        continue;
      }
      if (turn && o.type === "assistant" && msg && msg.usage) {
        turn.set(msg.id || o.uuid || ("n" + turn.size), msg.usage);
      }
    }
    const src = matched || turn;
    if (!src || !src.size) return null;
    const out = {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
    };
    for (const u of src.values()) {
      out.input_tokens += Number(u.input_tokens) || 0;
      out.output_tokens += Number(u.output_tokens) || 0;
      out.cache_read_tokens += Number(u.cache_read_input_tokens || u.cache_read_tokens) || 0;
      out.cache_write_tokens += Number(u.cache_creation_input_tokens || u.cache_write_tokens) || 0;
    }
    return out;
  } catch {
    return null;
  }
}

function attachUsageFromTranscript(ev) {
  const name = String(ev._event || "");
  if (!/^stop$/i.test(name) && !/^subagentstop$/i.test(name)) return;
  if (ev.input_tokens != null || ev.output_tokens != null) return; // Cursor already has these
  const tp = ev.transcript_path || ev.agent_transcript_path;
  const usage = usageFromClaudeTranscript(tp, ev.prompt_id);
  if (!usage) return;
  ev.input_tokens = usage.input_tokens;
  ev.output_tokens = usage.output_tokens;
  ev.cache_read_tokens = usage.cache_read_tokens;
  ev.cache_write_tokens = usage.cache_write_tokens;
}

function archiveTranscript(ev) {
  try {
    const conv = safeName(ev.conversation_id || ev.session_id, "unknown");
    const evName = String(ev._event || "");
    if (/^(stop|sessionend)$/i.test(evName) &&
        ev.transcript_path && fs.existsSync(ev.transcript_path)) {
      fs.mkdirSync(TX_DIR, { recursive: true });
      fs.copyFileSync(ev.transcript_path, path.join(TX_DIR, conv + ".jsonl"));
    }
    if (/^subagentstop$/i.test(evName) &&
        ev.agent_transcript_path && fs.existsSync(ev.agent_transcript_path)) {
      const sub = safeName(ev.subagent_id || ev.tool_call_id, "sub");
      const dir = path.join(TX_DIR, conv);
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(ev.agent_transcript_path, path.join(dir, sub + ".jsonl"));
    }
  } catch { /* archiving is best-effort */ }
}

async function main() {
  const raw = await readStdin();
  let ev;
  try { ev = JSON.parse(raw || "{}"); }
  catch { ev = { _parse_error: true, _raw: String(raw).slice(0, 4000) }; }
  if (ev == null || typeof ev !== "object") ev = { _value: ev };

  ev._ts = new Date().toISOString();
  ev._event = ev.hook_event_name || ev._event || "unknown";
  // Source agent tag, passed as the first CLI arg by the hook command
  // (e.g. "cursor", "claude", "codex", "workbuddy"). Enables multi-engine views.
  const argSource = process.argv[2];
  ev._source = argSource || ev._source || "unknown";

  // Cross-fire guard. Some hosts run hooks registered for OTHER agents too:
  // Cursor executes the hooks in ~/.claude/settings.json, so the SAME Cursor
  // event is captured twice — once as "cursor", once as "claude". The payload
  // still identifies its real host (Cursor events carry cursor_version). If we
  // were invoked under a non-cursor tag but the payload is a Cursor event, the
  // "cursor" hook already recorded it — skip to avoid a duplicate line. Genuine
  // Claude Code / Codex / WorkBuddy events lack cursor_version and are kept.
  if (ev.cursor_version && argSource && argSource !== "cursor") { allow(); process.exit(0); }

  try {
    attachUsageFromTranscript(ev);
    fs.mkdirSync(OBS_DIR, { recursive: true });
    rotateIfLarge();
    fs.appendFileSync(EVENTS_FILE, JSON.stringify(truncateStrings(ev, 0)) + "\n");
  } catch { /* logging is best-effort */ }

  archiveTranscript(ev);

  allow();
  process.exit(0);
}

main().catch(() => { allow(); process.exit(0); });
