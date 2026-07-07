# 多引擎接入（Cursor / Claude Code / Codex / 任意 agent）

Agent Monitor 现在是**引擎无关**的：任何支持「命令型 hook + stdin JSON」的 agent，都能把事件流汇入同一个面板，并按来源（source）区分、着色、筛选。

## 原理

1. 每个 agent 的 hook 命令都指向同一个采集脚本，并带一个**来源标记**参数：
   ```
   ~/.cursor/agent-monitor/scripts/capture.sh <source>
   ```
   `<source>` 会被记录为事件的 `_source`（如 `cursor` / `claude` / `codex` / `workbuddy`）。
2. 采集脚本把事件 JSON 追加进 `~/.cursor/observer/events.jsonl`，并始终 `exit 0`、返回允许——只旁听，不阻断。
3. 面板 (`assets/index.html`) 有一张**大小写不敏感的事件别名表** `EVENT_ALIASES`，把各家事件名（`preToolUse` / `PreToolUse` / `UserPromptSubmit` …）归一到统一类别（prompt/response/thought/tool/shell/file/mcp/subagent/lifecycle），并把 `tool` 里的 Bash/Write 等按 `tool_name` 细分到 shell/file/mcp。

> 采集脚本的绝对路径以本机为准，下文用 `CAP` 代指
> `~/.cursor/agent-monitor/scripts/capture.sh`。

## Cursor（已接入）

`~/.cursor/hooks.json`，每个事件的 command 为 `CAP cursor`。由 `install.sh` 自动写入（合并，不覆盖你已有的 hooks）。改动后 **Reload Window**。

## Claude Code

Claude Code 的 hooks 在 `~/.claude/settings.json`（用户级，全局）。把 `adapters/claude-code.settings.json` 的 `hooks` 块合并进去（若已有 `hooks`，按事件追加即可）。事件用 PascalCase，结构比 Cursor 多一层 `matcher` 分组：

```json
{
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "CAP claude" }] }],
    "PreToolUse":  [{ "matcher": "", "hooks": [{ "type": "command", "command": "CAP claude" }] }],
    "PostToolUse": [{ "matcher": "", "hooks": [{ "type": "command", "command": "CAP claude" }] }],
    "Stop":        [{ "hooks": [{ "type": "command", "command": "CAP claude" }] }]
  }
}
```

（把 `CAP` 换成上面的绝对路径。完整事件见 `adapters/claude-code.settings.json`。）

## Codex

Codex（v0.133+，2026-05 起稳定）的 hooks 事件名与 Claude 基本一致（`SessionStart`/`PreToolUse`/`PostToolUse`/`UserPromptSubmit`/`Stop`/`PreCompact`/`SubagentStart`/`SubagentStop`…），并额外有只读观测事件（`ToolExecution`/`TurnMetadata`）。配置在 `~/.codex/hooks.json` 或 `config.toml` 的 `[hooks]`。

> ⚠️ Codex 的 hooks 配置 schema **随版本变化**，且对未知字段做严格校验。请先用 Codex CLI 的 `/hooks` 命令查看当前格式，再对照 `adapters/codex.hooks.json` 调整。核心不变：把某个 hook 的 command 指向 `CAP codex`。`TurnMetadata` 观测事件还能带来 turn 级 token/统计（Cursor 拿不到），值得接。

## 任意 agent（如 workbuddy）

只要该 agent 支持「命令型 hook + stdin 传 JSON」：

1. 在它的 hooks 配置里，把某个/所有生命周期事件的命令指向：
   ```
   CAP workbuddy
   ```
2. 打开面板，`workbuddy` 会自动作为一个新来源出现（自动分配颜色、可筛选）。
3. 若它的事件名不在通用词表里，在 `~/.cursor/agent-monitor/assets/index.html` 的 `EVENT_ALIASES` 里加一行（小写事件名 → 统一类别）即可，无需改核心逻辑。

## 注意

- 采集是全局的：会记录**所有**接入 agent、所有项目的 prompt / shell 输出 / 文件内容到 `~/.cursor/observer/events.jsonl`，属敏感数据，随时可删该目录重置。
- 不同 agent 的 hook 返回协议略有差异，但采集脚本只 `exit 0` + 返回允许，对三家都是「放行」，不会阻断或拖慢 agent。
