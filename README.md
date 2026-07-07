# Agent Monitor

Multi-engine, hook-based observability for AI coding agents — **Cursor, Claude Code, Codex, and any agent with command hooks**. It captures every action an agent takes and streams it to a local, zero-dependency web panel with a live **timeline** and a collapsible **session → turn → tool/subagent tree**, color-coded by source.

**Global by design:** the hooks live under `~/.cursor/` and are not tied to any project, so it monitors every project's conversations at once. Nothing leaves your machine.

## What it captures

Every hook event, appended to a local JSONL log:

- Your prompt, the agent's thinking blocks and final replies
- Every tool call with **full input and result**
- Shell commands and their **full output**
- File reads (content) and edits (diffs)
- MCP calls and results
- Subagents: task, type, model, status, stats, and their own transcript
- Session lifecycle and context compaction

It also snapshots conversation transcripts into the archive on session/subagent end.

## What it cannot capture (platform limits)

Not exposed by any agent hook — no observer can get them:

- The full assembled prompt actually sent to the LLM (system prompt, rules, serialized context)
- Per-token reasoning / raw model API request-response
- Exact per-call token usage

In short: the **conversation layer** (what the agent did) is captured almost completely; the **model layer** (what the model received token-by-token) is not.

## Architecture

```
Agent (Cursor / Claude Code / Codex / …)
   │  lifecycle events → run a hook process, JSON on stdin
   ▼
scripts/capture.sh <source> → scripts/capture.mjs   (append-only, fail-open, never blocks)
   │  one JSON line per event (+ _source tag)
   ▼
~/.cursor/observer/events.jsonl
   │  watch + tail
   ▼
scripts/server.mjs  ──SSE──▶  assets/index.html   (timeline + tree, source-filtered)
```

The capture hook only writes files (zero network, fail-open) so it can never block or slow the agent. The collector tails the log and pushes updates over SSE.

## Install

```bash
sh install.sh
```

This copies the capture/panel scripts to a project-independent location
(`~/.cursor/agent-monitor`) and registers **Cursor** user hooks (merged, not
clobbered). Reload the Cursor window afterwards.

Start the panel:

```bash
node ~/.cursor/agent-monitor/scripts/server.mjs
# open http://127.0.0.1:4517  (set OBSERVER_PORT to change the port)
```

## Monitor more agents

Every agent streams into the same panel, tagged and colored by source. See
[`docs/multi-agent.md`](docs/multi-agent.md) for ready-to-paste configs:

- **Cursor** — configured by `install.sh`
- **Claude Code** — merge [`adapters/claude-code.settings.json`](adapters/claude-code.settings.json) into `~/.claude/settings.json`
- **Codex** — see [`adapters/codex.hooks.json`](adapters/codex.hooks.json)
- **Any agent** — point its command hook at `~/.cursor/agent-monitor/scripts/capture.sh <your-source-name>`; if it uses novel event names, add them to `EVENT_ALIASES` in `assets/index.html`.

## Panel

- **Tree / Timeline** views, **source filter** + **type filter** chips, text filter, session picker
- **Follow** auto-scrolls to newest events; scroll up to pause, scroll to bottom to resume
- Click any node for a rich detail view (prose, terminal output, file diffs, tool I/O, subagent stats) with a raw-JSON fallback

## Optional: in-editor sidebar

[`extension/`](extension/) is a Cursor/VSCode extension that renders the same
panel in a webview sidebar (reads the same `events.jsonl`, no browser needed).
Build a `.vsix` with `npm install && npm run package` inside `extension/`, then
install it from VSIX. See [`extension/README.md`](extension/README.md).

## Data & privacy

All data stays local under `~/.cursor/observer/`. This log can contain **file
contents, shell output, and prompts across all your projects** — treat it as
sensitive. Delete the folder any time to reset.

## License

MIT — see [LICENSE](LICENSE).
