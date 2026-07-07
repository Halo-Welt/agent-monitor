// Agent Monitor — VSCode/Cursor extension.
// Contributes an activitybar sidebar (webview) that renders the events captured
// by the agent-monitor hooks. Reads ~/.cursor/observer/events.jsonl directly
// (fs.watch + polling fallback) and streams new lines to the webview via postMessage.
// Zero network: no HTTP server, no ports.

import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const OBS_DIR = path.join(os.homedir(), ".cursor", "observer");
const EVENTS_FILE = path.join(OBS_DIR, "events.jsonl");
const TX_DIR = path.join(OBS_DIR, "transcripts");

function parseLines(text: string): unknown[] {
  const out: unknown[] = [];
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { /* skip malformed */ }
  }
  return out;
}

class AgentMonitorViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private offset = 0;
  private watcher?: fs.FSWatcher;
  private poll?: ReturnType<typeof setInterval>;

  constructor(private readonly ctx: vscode.ExtensionContext) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, "media")],
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
    view.onDidDispose(() => this.stopWatching());
  }

  private onMessage(msg: any): void {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "ready") {
      this.sendInit();
      this.startWatching();
    } else if (msg.type === "openTranscript" && typeof msg.file === "string") {
      this.openTranscript(msg.file);
    }
  }

  private post(message: unknown): void {
    this.view?.webview.postMessage(message);
  }

  private sendInit(): void {
    let text = "";
    try { text = fs.readFileSync(EVENTS_FILE, "utf8"); } catch { text = ""; }
    try { this.offset = fs.statSync(EVENTS_FILE).size; } catch { this.offset = 0; }
    this.post({ type: "init", events: parseLines(text) });
  }

  private startWatching(): void {
    this.stopWatching();
    try { fs.mkdirSync(OBS_DIR, { recursive: true }); } catch { /* ignore */ }
    try {
      this.watcher = fs.watch(OBS_DIR, (_e, fn) => {
        if (!fn || fn === "events.jsonl") this.readNew();
      });
    } catch { /* fs.watch may be unavailable; polling covers it */ }
    this.poll = setInterval(() => this.readNew(), 1000);
  }

  private stopWatching(): void {
    try { this.watcher?.close(); } catch { /* ignore */ }
    this.watcher = undefined;
    if (this.poll) { clearInterval(this.poll); this.poll = undefined; }
  }

  private readNew(): void {
    let size: number;
    try { size = fs.statSync(EVENTS_FILE).size; } catch { return; }
    if (size < this.offset) {
      // rotated/truncated: resend everything
      this.offset = 0;
      this.post({ type: "reset" });
      this.sendInit();
      return;
    }
    if (size === this.offset) return;
    let fd: number | undefined;
    try {
      fd = fs.openSync(EVENTS_FILE, "r");
      const buf = Buffer.alloc(size - this.offset);
      fs.readSync(fd, buf, 0, buf.length, this.offset);
      this.offset = size;
      const events = parseLines(buf.toString("utf8"));
      if (events.length) this.post({ type: "append", events });
    } catch { /* ignore */ }
    finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* ignore */ } } }
  }

  private async openTranscript(rel: string): Promise<void> {
    const resolved = path.resolve(TX_DIR, rel);
    if (resolved !== TX_DIR && !resolved.startsWith(TX_DIR + path.sep)) {
      vscode.window.showWarningMessage("Agent Monitor: invalid transcript path.");
      return;
    }
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(resolved));
      await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true });
    } catch {
      vscode.window.showInformationMessage("Agent Monitor: transcript not found (it is archived only after the subagent/session ends).");
    }
  }

  private html(webview: vscode.Webview): string {
    const nonce = getNonce();
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "media", "panel.css"));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "media", "panel.js"));
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
    ].join("; ");
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link href="${cssUri}" rel="stylesheet" />
<title>Agent Monitor</title>
</head>
<body class="in-webview">
<header>
  <div class="topbar">
    <div class="brand"><h1>Agent Monitor</h1><span class="sub">Cursor Agent observability</span></div>
    <span class="pill"><span id="dot" class="dot off"></span><span id="conn">connecting</span></span>
    <span class="pill" id="count">0 events</span>
    <div class="spacer"></div>
    <div class="seg">
      <button id="btnTree" class="active">Tree</button>
      <button id="btnTl">Timeline</button>
    </div>
    <div id="followBtn" class="toggle on" title="Auto-scroll to newest events"><span class="sw"></span><span>Follow</span></div>
  </div>
  <div class="filterbar">
    <input type="text" id="search" placeholder="filter by text…" />
    <select id="session"><option value="">All sessions</option></select>
    <div class="chips" id="chips"></div>
    <button class="chip-link" id="chipAll">all</button>
    <button class="chip-link" id="chipNone">none</button>
  </div>
</header>
<main>
  <div id="list"></div>
  <div id="detail">
    <div class="detail-head"><h2>Details</h2></div>
    <div class="detail-body"><div id="detailBody" class="empty">Click a node to inspect it — rich view plus raw hook events.</div></div>
  </div>
</main>
<script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new AgentMonitorViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("agentMonitor.panel", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("agentMonitor.reveal", () => {
      vscode.commands.executeCommand("agentMonitor.panel.focus");
    })
  );
}

export function deactivate(): void { /* nothing to clean up beyond disposables */ }
