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
// Per-string truncation above doesn't bound the TOTAL size of an event (e.g. an
// array of many short strings each under MAX_STR can still add up to hundreds of
// MB), which let single writes blow past MAX_LOG before rotation ever triggered.
// Hard-cap the fully serialized line so rotation stays reliable.
const MAX_LINE = 2 * 1024 * 1024;
// Some hosts fire the same hook twice for one logical event (observed: Cursor's
// afterAgentThought emits the identical thought text under two different
// generation_id formats within the same millisecond). Collapse those before
// they double every downstream count.
const DEDUP_WINDOW_MS = 5000;
const DEDUP_TAIL_BYTES = 16 * 1024;
const LOCK_FILE = EVENTS_FILE + ".lock";
const LOCK_MAX_WAIT_MS = 200;
const LOCK_STALE_MS = 2000;

// The two double-fired hooks land within the SAME millisecond, as two
// separate OS processes — without serializing them, both can read the file
// tail before either has appended, and the dedup check above sees nothing to
// match against. Take a tiny exclusive-create lock around check+write so
// only one of them runs that section at a time. Bounded wait + self-healing
// on a stale lock (crashed holder) so this can never hang the agent.
function withLock(fn) {
  const deadline = Date.now() + LOCK_MAX_WAIT_MS;
  const clock = new Int32Array(new SharedArrayBuffer(4));
  let fd = null;
  while (fd == null) {
    try {
      fd = fs.openSync(LOCK_FILE, "wx");
    } catch {
      try {
        if (Date.now() - fs.statSync(LOCK_FILE).mtimeMs > LOCK_STALE_MS) fs.unlinkSync(LOCK_FILE);
      } catch {}
      if (Date.now() >= deadline) break; // fail-open: proceed unlocked rather than block the agent
      try { Atomics.wait(clock, 0, 0, 5); } catch {}
    }
  }
  try {
    return fn();
  } finally {
    if (fd != null) {
      try { fs.closeSync(fd); } catch {}
      try { fs.unlinkSync(LOCK_FILE); } catch {}
    }
  }
}

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

function coreContent(ev) {
  return ev.text ?? ev.thinking ?? ev.prompt ?? ev.message ?? ev.last_assistant_message ??
    ev.command ?? ev.file_path ?? ev.path ?? "";
}

// Cursor tags every event in a turn with a generation_id, but afterAgentThought
// suffixes it per-chunk ("<base>-<index>-<rand>"). The observed double-fire
// emits the SAME thought under both the suffixed id and the bare base id, so
// strip the suffix before comparing — see turnGenId() in assets/index.html for
// the matching client-side logic.
function baseGenerationId(ev) {
  const raw = ev.generation_id || ev.prompt_id || "";
  const m = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-\d+-[0-9a-z]+$/i.exec(raw);
  return m ? m[1] : raw;
}

// Reads only the tail of the log (events append fast, so a true duplicate is
// always within the last few lines) and checks whether the current event
// already appears there — same hook, same session, same core content (and
// same turn, when a generation/prompt id is available), within
// DEDUP_WINDOW_MS. Fail-open: any read/parse error just means "not a duplicate".
function isDuplicateOfRecent(ev) {
  let fd;
  try {
    fd = fs.openSync(EVENTS_FILE, "r");
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - DEDUP_TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const evTs = new Date(ev._ts).getTime();
    const evCore = String(coreContent(ev)).slice(0, 500);
    const evSession = ev.session_id || ev.conversation_id;
    const evGen = baseGenerationId(ev);
    if (!evCore) return false;
    const lines = buf.toString("utf8").split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      let prev;
      try { prev = JSON.parse(line); } catch { continue; }
      if (prev._event !== ev._event) continue;
      const prevSession = prev.session_id || prev.conversation_id;
      if (evSession && prevSession && evSession !== prevSession) continue;
      if (evGen && baseGenerationId(prev) && baseGenerationId(prev) !== evGen) continue;
      const prevTs = new Date(prev._ts).getTime();
      if (!Number.isFinite(prevTs) || !Number.isFinite(evTs) || Math.abs(evTs - prevTs) > DEDUP_WINDOW_MS) continue;
      if (String(coreContent(prev)).slice(0, 500) === evCore) return true;
    }
  } catch { /* no file yet, or read failed — treat as not a duplicate */ }
  finally { if (fd != null) try { fs.closeSync(fd); } catch {} }
  return false;
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
    fs.mkdirSync(OBS_DIR, { recursive: true });
    withLock(() => {
      if (isDuplicateOfRecent(ev)) return;
      attachUsageFromTranscript(ev);
      rotateIfLarge();
      let line = JSON.stringify(truncateStrings(ev, 0));
      if (Buffer.byteLength(line, "utf8") > MAX_LINE) {
        // Extremely rare: even after per-string truncation, the event is still
        // huge (many fields adding up). Fall back to a minimal marker record
        // instead of writing a multi-MB line that defeats log rotation.
        line = JSON.stringify({
          _event: ev._event, _source: ev._source, _ts: ev._ts,
          session_id: ev.session_id, conversation_id: ev.conversation_id,
          _oversized: true, _originalBytes: Buffer.byteLength(line, "utf8"),
        });
      }
      fs.appendFileSync(EVENTS_FILE, line + "\n");
    });
  } catch { /* logging is best-effort */ }

  archiveTranscript(ev);

  allow();
  process.exit(0);
}

main().catch(() => { allow(); process.exit(0); });
