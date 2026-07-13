# Agent Monitor

Multi-engine, hook-based observability for AI coding agents — **Cursor, Claude Code, Codex, and any agent with command hooks**. Every action is captured locally and streamed to a zero-dependency web panel with a **Tree / Timeline / History** UI, source-colored events, and a per-turn **sequence diagram** that reconstructs the conversation flow from captured hooks.

**Global by design:** hooks live under `~/.cursor/` and are not tied to a single repo, so one panel watches agents across all your projects. Data never leaves your machine.

[中文文档](README.zh-CN.md)

![Tree view with per-turn sequence diagram](docs/screenshots/tree-sequence-diagram.png)

## What it captures

Each hook event is appended to a local JSONL log:

- User prompts, agent thinking blocks, and final replies
- Every tool call with **full input and output**
- Shell commands with **full terminal output**
- File reads (content) and edits (diffs)
- MCP calls and results
- Subagents: task, type, model, status, stats, and archived transcripts
- Session lifecycle and context compaction

When a session or subagent ends, a transcript snapshot is archived on disk.

## What it cannot capture (platform limits)

No agent hook exposes these — no observer can:

- The fully assembled prompt sent to the LLM (system prompt, rules, serialized context)
- Per-token reasoning or raw model API request/response
- Exact per-call token usage

In short: the **conversation layer** (what the agent did) is captured almost completely; the **model layer** (what the model saw token-by-token) is not.

## Architecture

```
Agent (Cursor / Claude Code / Codex / …)
   │  lifecycle events → spawn a hook process, JSON on stdin
   ▼
scripts/capture.sh <source> → scripts/capture.mjs   (append-only, fail-open, never blocks)
   │  one JSON line per event (tagged with _source)
   ▼
~/.cursor/observer/events.jsonl
   │  watch + tail
   ▼
scripts/server.mjs  ──SSE──▶  assets/index.html   (tree + timeline + history)
```

Hooks only write files (zero network, fail-open), so they never slow the agent. The collector tails the log and pushes updates over SSE.

## Panel

- **Tree / Timeline / History** views with **source** and **type** filters, text search, and a session picker
- **Tree:** sessions ordered by **most recent activity on top**; within a session, turns stay chronological (`prompt → steps → response`)
- **Per-turn sequence diagram:** seven fixed swimlanes (User, Agent, Tool, Shell, File, MCP, Subagent). Solid arrows = calls; dashed arrows = returns. **Expanded by default**; intermediate step lists are **collapsed by default**. Click any arrow to open details. Updates live as events arrive while the diagram is open.
- **Follow:** in Tree view, pins to the **top** (newest session); in Timeline, pins to the **bottom** (newest event). Scroll away to pause; return to the edge to resume.
- Click any node for rich detail: prose, terminal output, diffs, tool I/O, subagent stats, plus raw hook JSON

## macOS menu bar app

Package Agent Monitor as a native macOS menu bar app — no need to run `server.mjs` manually:

```bash
sh scripts/build-macos-app.sh
# output: macos/build/Build/Products/Release/Agent Monitor.app
open "macos/build/Build/Products/Release/Agent Monitor.app"
```

**Features:**

- Menu bar icon shows agent activity (idle / live / active / offline)
- Click the menu for a compact summary (source, recent events, counts)
- **Open Panel** (⌘O) opens the full monitor window (same web UI)
- **Install Hooks…** registers Cursor / Claude Code hooks in one click
- **Launch at Login**

The app embeds the same HTTP+SSE server (default `http://127.0.0.1:4517`) as the CLI `server.mjs`. If the port is busy, quit any old `node server.mjs` process first.

Build copies the latest `assets/` into the app bundle on every build via `scripts/sync-macos-assets.sh`.

**Requirements:** macOS 13+, Xcode 15+ to build. Ad-hoc signing is fine for local use; distribute with Developer ID signing and notarization.

## Install

```bash
sh install.sh
```

This copies capture/panel scripts to a project-independent location (`~/.cursor/agent-monitor`) and registers **Cursor** user hooks (merged, not overwritten). Reload the Cursor window after install.

Start the panel:

```bash
node ~/.cursor/agent-monitor/scripts/server.mjs
# open http://127.0.0.1:4517  (set OBSERVER_PORT to change the port)
```

## Monitor more agents

All agents feed one panel, tagged and colored by source. Copy-paste configs in [`docs/multi-agent.md`](docs/multi-agent.md):

- **Cursor** — configured by `install.sh`
- **Claude Code** — merge [`adapters/claude-code.settings.json`](adapters/claude-code.settings.json) into `~/.claude/settings.json`
- **Codex** — see [`adapters/codex.hooks.json`](adapters/codex.hooks.json)
- **Any agent** — point its command hook at `~/.cursor/agent-monitor/scripts/capture.sh <your-source-name>`; add novel event names to `EVENT_ALIASES` in `assets/index.html` if needed.

## Data & privacy

Everything stays under `~/.cursor/observer/` on your machine. The log may contain **file contents, shell output, and prompts from all projects** — treat it as sensitive. Delete that directory anytime to reset.

## License

MIT — see [LICENSE](LICENSE).
