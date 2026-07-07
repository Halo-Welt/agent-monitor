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

function archiveTranscript(ev) {
  try {
    const conv = safeName(ev.conversation_id, "unknown");
    if ((ev._event === "stop" || ev._event === "sessionEnd") &&
        ev.transcript_path && fs.existsSync(ev.transcript_path)) {
      fs.mkdirSync(TX_DIR, { recursive: true });
      fs.copyFileSync(ev.transcript_path, path.join(TX_DIR, conv + ".jsonl"));
    }
    if (ev._event === "subagentStop" &&
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
  ev._source = process.argv[2] || ev._source || "unknown";

  try {
    fs.mkdirSync(OBS_DIR, { recursive: true });
    fs.appendFileSync(EVENTS_FILE, JSON.stringify(ev) + "\n");
  } catch { /* logging is best-effort */ }

  archiveTranscript(ev);

  allow();
  process.exit(0);
}

main().catch(() => { allow(); process.exit(0); });
