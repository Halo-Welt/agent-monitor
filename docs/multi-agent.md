# 多引擎接入（Cursor / Claude Code / Codex / 任意 agent）

Agent Monitor 现在是**引擎无关**的：任何支持「命令型 hook + stdin JSON」的 agent，都能把事件流汇入同一个面板，并按来源（source）区分、着色、筛选。

## 原理

1. 每个 agent 的 hook 命令都指向同一个采集脚本，并带一个**来源标记**参数：
   ```
   ~/.cursor/agent-monitor/scripts/capture.sh <source>
   ```
   `<source>` 会被记录为事件的 `_source`（如 `cursor` / `claude` / `codex` / `workbuddy`）。
2. 采集脚本把事件 JSON 追加进 `~/.cursor/observer/events.jsonl`，并始终 `exit 0`、返回允许——只旁听，不阻断。
3. macOS 应用内嵌的面板 UI (`assets/index.html`) 有一张**大小写不敏感的事件别名表** `EVENT_ALIASES`，把各家事件名（`preToolUse` / `PreToolUse` / `UserPromptSubmit` …）归一到统一类别（prompt/response/thought/tool/shell/file/lifecycle）。MCP 与子 agent 入口保留为通用 tool call；子 agent 的独立会话会按 transcript 目录关系嵌套回父会话，展示其内部动作。

每轮用量也会归一到同一展示口径：Cursor 使用 hook 中的 token 字段；Claude Code 与 Codex 读取本地 transcript，汇总本轮 API 总量、最后一次调用的上下文快照和可识别的模型调用次数。它不抓取原始模型 API 流量，也不估算价格或费用。

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

`install.sh` 和 App 的 **Install Hooks…** 会自动把 Agent Monitor 合并到 `~/.codex/hooks.json`，不会覆盖已有 hook。支持 Codex Desktop 与交互式 CLI 共用的会话事件，包括 `SessionStart`、`UserPromptSubmit`、工具与权限调用、上下文压缩、子 agent 和 `Stop`。

Codex 会对新安装或发生变化的非托管 hook 做信任校验。安装后新建 Codex 会话；如果出现待审核提示，请在 CLI 中打开 `/hooks`，确认并信任 Agent Monitor。可手动使用的当前 schema 模板见 [`adapters/codex.hooks.json`](../adapters/codex.hooks.json)。

Codex 使用 `turn_id` 标识回合；Agent Monitor 会据此重建时序图，并从 `~/.codex/sessions/` 下的 rollout JSONL 读取该回合的 `token_count`。统计只累加每次调用的 `last_token_usage`，不会把跨回合累计的 `total_token_usage` 重复计入。

## 任意 agent（如 workbuddy）

只要该 agent 支持「命令型 hook + stdin 传 JSON」：

1. 在它的 hooks 配置里，把某个/所有生命周期事件的命令指向：
   ```
   CAP workbuddy
   ```
2. 打开 Agent Monitor macOS 应用，选择 **Open Panel**（⌘O），`workbuddy` 会自动作为一个新来源出现（自动分配颜色、可筛选）。
3. 若它的事件名不在通用词表里，在 `~/.cursor/agent-monitor/assets/index.html` 的 `EVENT_ALIASES` 里加一行（小写事件名 → 统一类别）即可，无需改核心逻辑。

## 注意

- 采集是全局的：会记录**所有**接入 agent、所有项目的 prompt / shell 输出 / 文件内容到 `~/.cursor/observer/events.jsonl`，属敏感数据，随时可删该目录重置。
- 不同 agent 的 hook 返回协议略有差异，但采集脚本只 `exit 0` + 返回允许，对三家都是「放行」，不会阻断或拖慢 agent。
