#!/usr/bin/env node
// agent-monitor collector.
// Serves the visualization panel, exposes captured events as JSON, and streams
// new events over SSE by tailing ~/.cursor/observer/events.jsonl.
// Zero dependencies (Node built-ins only).

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OBS_DIR = path.join(os.homedir(), ".cursor", "observer");
const EVENTS_FILE = path.join(OBS_DIR, "events.jsonl");
const TX_DIR = path.join(OBS_DIR, "transcripts");
const PANEL = path.join(__dirname, "..", "assets", "index.html");

const HOST = process.env.OBSERVER_HOST || "127.0.0.1";
const PORT = process.env.OBSERVER_PORT ? Number(process.env.OBSERVER_PORT) : 4517;

const clients = new Set();
let offset = 0;

function readAllEvents() {
  try {
    const txt = fs.readFileSync(EVENTS_FILE, "utf8");
    const out = [];
    for (const line of txt.split("\n")) {
      const s = line.trim();
      if (!s) continue;
      try { out.push(JSON.parse(s)); } catch { /* skip malformed */ }
    }
    return out;
  } catch { return []; }
}

function broadcast(line) {
  for (const res of clients) {
    try { res.write(`data: ${line}\n\n`); } catch { /* dropped client */ }
  }
}

function readNew() {
  let size;
  try { size = fs.statSync(EVENTS_FILE).size; } catch { return; }
  if (size < offset) offset = 0; // rotated/truncated
  if (size === offset) return;
  let fd;
  try {
    fd = fs.openSync(EVENTS_FILE, "r");
    const buf = Buffer.alloc(size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    offset = size;
    for (const line of buf.toString("utf8").split("\n")) {
      const s = line.trim();
      if (s) broadcast(s);
    }
  } catch { /* ignore */ }
  finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch {} } }
}

function startWatching() {
  try { fs.mkdirSync(OBS_DIR, { recursive: true }); } catch {}
  try { offset = fs.statSync(EVENTS_FILE).size; } catch { offset = 0; }
  try { fs.watch(OBS_DIR, (_e, fn) => { if (!fn || fn === "events.jsonl") readNew(); }); } catch {}
  setInterval(readNew, 1000); // polling fallback: fs.watch misses some appends
  setInterval(() => broadcast(JSON.stringify({ _event: "_ping", _ts: new Date().toISOString() })), 25000);
}

function send(res, code, type, body) {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

const server = http.createServer((req, res) => {
  let u;
  try { u = new URL(req.url, `http://${HOST}:${PORT}`); }
  catch { return send(res, 400, "text/plain", "bad request"); }

  if (u.pathname === "/" || u.pathname === "/index.html") {
    try { send(res, 200, "text/html; charset=utf-8", fs.readFileSync(PANEL)); }
    catch (e) { send(res, 500, "text/plain", "panel not found: " + e.message); }
    return;
  }

  if (u.pathname === "/api/events") {
    return send(res, 200, "application/json; charset=utf-8", JSON.stringify(readAllEvents()));
  }

  if (u.pathname === "/api/transcript") {
    const rel = u.searchParams.get("file") || "";
    const resolved = path.resolve(TX_DIR, rel);
    if (resolved !== TX_DIR && !resolved.startsWith(TX_DIR + path.sep)) {
      return send(res, 400, "text/plain", "bad path");
    }
    try { send(res, 200, "text/plain; charset=utf-8", fs.readFileSync(resolved, "utf8")); }
    catch { send(res, 404, "text/plain", "not found"); }
    return;
  }

  if (u.pathname === "/stream") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(": connected\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  send(res, 404, "text/plain", "not found");
});

server.listen(PORT, HOST, () => {
  console.log(`[agent-monitor] panel   -> http://${HOST}:${PORT}`);
  console.log(`[agent-monitor] events  -> ${EVENTS_FILE}`);
  startWatching();
});
