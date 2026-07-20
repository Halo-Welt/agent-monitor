# Agent Monitor

Multi-engine, hook-based observability for AI coding agents — **Cursor, Claude Code, Codex, and any agent with command hooks**. Every action is captured locally and displayed in a native **macOS menu bar app** with a **Tree / Timeline / History** UI, source-colored events, and a per-turn **sequence diagram** that reconstructs the conversation flow from captured hooks.

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
Agent Monitor.app (macOS menu bar)
   │  embedded HTTP+SSE server → panel UI
   ▼
Tree / Timeline / History + per-turn sequence diagram
```

Hooks only write files (zero network, fail-open), so they never slow the agent. The macOS app tails the log and pushes updates over SSE to its built-in panel.

## macOS menu bar app

Build and run:

```bash
sh scripts/build-macos-app.sh
# output: macos/build/Build/Products/Release/Agent Monitor.app
open "macos/build/Build/Products/Release/Agent Monitor.app"
```

**Features:**

- Menu bar icon shows agent activity (idle / live / active / offline)
- Click the menu for a compact summary (source, recent events, counts)
- **Open Panel** (⌘O) opens the full monitor window
- **Install Hooks…** registers Cursor / Claude Code hooks in one click
- **Launch at Login**

The app embeds a local HTTP+SSE server (default `http://127.0.0.1:4517`) and serves the panel UI from its bundle. Set `OBSERVER_PORT` to change the port. If the port is busy, quit any other process using it and restart the app.

Build copies the latest `assets/` into the app bundle on every build via `scripts/sync-macos-assets.sh`.

Optional distribution package:

```bash
sh scripts/package-dmg.sh   # requires: brew install create-dmg
```

**Requirements:** macOS 13+, Xcode 15+ to build. Ad-hoc signing is fine for local use; distribute with Developer ID signing and notarization.

## Install hooks

You can register hooks from the app menu (**Install Hooks…**) or from the command line:

```bash
sh install.sh
```

This copies capture scripts to a project-independent location (`~/.cursor/agent-monitor`) and registers **Cursor**, **Claude Code**, and **Codex** user hooks (merged, not overwritten). Reload Cursor after install. Start a new Codex session; if Codex reports hooks pending review, open `/hooks` and trust Agent Monitor.

Then open the macOS app and choose **Open Panel** (⌘O) to view live events.

## Monitor more agents

All agents feed one panel, tagged and colored by source. Copy-paste configs in [`docs/multi-agent.md`](docs/multi-agent.md):

- **Cursor** — configured by `install.sh` or the app
- **Claude Code** — configured by `install.sh` or the app; manual template: [`adapters/claude-code.settings.json`](adapters/claude-code.settings.json)
- **Codex** — configured by `install.sh` or the app; manual template: [`adapters/codex.hooks.json`](adapters/codex.hooks.json)
- **Any agent** — point its command hook at `~/.cursor/agent-monitor/scripts/capture.sh <your-source-name>`; add novel event names to `EVENT_ALIASES` in `assets/index.html` if needed.

## Data & privacy

Everything stays under `~/.cursor/observer/` on your machine. The log may contain **file contents, shell output, and prompts from all projects** — treat it as sensitive. Delete that directory anytime to reset.

## License

MIT — see [LICENSE](LICENSE).
