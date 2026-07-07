# Agent Monitor (Cursor/VSCode extension)

A live **sidebar** for the [agent-monitor](https://github.com/Halo-Welt/agent-monitor) hooks plugin. It renders everything the Cursor Agent does — timeline + session/turn/tool tree, with rich per-event detail — right inside the editor. No browser, no HTTP server, no ports.

## How it works

The companion **hooks plugin** captures every agent action into `~/.cursor/observer/events.jsonl`. This extension reads that file directly (`fs.watch` + 1s polling) and streams new events to a webview sidebar via `postMessage`.

```
Cursor Agent → hooks → ~/.cursor/observer/events.jsonl → this extension → sidebar webview
```

## Requirements

Install the **agent-monitor hooks plugin** as well (this extension only visualizes what the plugin captures). Without it, `events.jsonl` stays empty and the sidebar shows nothing.

## Usage

1. Install this extension.
2. Click the **Agent Monitor** icon in the activity bar.
3. Use the Cursor Agent as normal — events stream into the panel live.

- **Tree / Timeline** views, **type filter chips**, text filter, session picker.
- **Follow** auto-scrolls to newest events; scroll up to pause, scroll to bottom to resume.
- Click any node for a rich detail view (shell output, file diffs, tool I/O, subagent stats) with a raw-JSON fallback.

## Privacy

All data stays local under `~/.cursor/observer/`. This log can contain file contents, shell output, and prompts — treat it as sensitive.

## License

MIT
