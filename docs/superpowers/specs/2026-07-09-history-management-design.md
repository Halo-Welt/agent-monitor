# 设计：历史记录管理 + Claude 回复识别修复

日期：2026-07-09

## 背景与动机

用户反馈「Claude 对话明明有回复，但面板没识别」。核查实际抓到的事件后确认两处缺陷：

1. **回复识别缺失**：Claude Code 没有独立的 response 事件，最终回复落在 `Stop` 事件的 `last_assistant_message` 字段。面板把 `Stop` 归为 `lifecycle`，且 response 渲染只取 `prompt/text/message/thinking`，从不读 `last_assistant_message` → 回复被丢弃。
2. **会话分组错误**：真正的 Claude Code 会话没有 `conversation_id`，只有 `session_id`。面板按 `conversation_id` 分组，缺失时统一塞进 `<source>:no-conversation`，导致多个 Claude 会话全糊成一个假会话。

在此基础上新增「历史记录管理」功能（用户选择最大范围）。

## 目标

- 正确识别并按会话展示 Claude 的 prompt + 回复。
- 独立的 History 视图：浏览、搜索、回放过往会话。
- 管理操作：导出、置顶/隐藏、删除单会话、清空全部。
- 不破坏本地/零依赖/fail-open 特性。

## 非目标（YAGNI）

- 不解析各家 agent 私有 transcript 的完整结构做回放（回放基于已捕获事件，多引擎通用）。
- 不改 `extension/` 那套独立 webview UI。
- 不引入任何第三方依赖（server 仍只用 Node 内置）。

## 方案

### 0. 识别修复（地基）
- `sessionKeyOf(ev) = conversation_id || session_id || (source + ":no-conversation")`，前后端一致。`build()`、会话下拉、History 均用它分组。
- `catOf`：事件带 `last_assistant_message` 时归为 `response`。
- `summarize` / `renderRich` 的 response 文本取值加入 `last_assistant_message`。

### 1. History 视图
- 顶栏分段控件加第三项 `History`。
- 会话卡片列表：来源徽标、短 id、模型、标题（首条 user prompt）、起止时间、时长、轮次数、工具数、最后回复摘要、状态。
- 复用 `#search` 过滤（id/标题/prompt/回复文本）。
- 排序：置顶（pinned）优先，其余按最近开始时间倒序；隐藏项折叠到「已隐藏 (N)」。
- 点卡片 → 详情面板显示「对话回放」：该会话事件按时间排序，逐条用 `renderRich` 呈现为聊天流；有归档 transcript 时给链接。

### 2. 管理操作
- **导出**（前端）：按会话事件生成 JSON 或 Markdown，`Blob` + `a[download]` 下载，文件名 `<source>-<shortid>.json|md`。
- **置顶/隐藏**（前端）：`localStorage` 键 `am:pins` / `am:hidden`（存 sessionKey 集合）。
- **删除单会话 / 清空全部**（服务端，破坏性）：
  - `POST /api/session/delete?key=<sessionKey>`：读全量事件，剔除 `sessionKeyOf===key` 的行，**原子重写**（写 `events.jsonl.tmp` 再 `rename`）；best-effort 删 `transcripts/<key>.jsonl` 与 `transcripts/<key>/`。返回删除条数。
  - `POST /api/history/clear`：`events.jsonl` 写空 + 清空 `transcripts/`。
  - 前端二次确认；成功后清空本地 `events`/`seen` 并重新 `GET /api/events` 重建。

### 3. 服务端
- 复用 `sessionKeyOf`（server 内实现一份）。
- 两个端点仅接受 `POST`，参数走 query（免 body 解析）。服务已绑 `127.0.0.1`。
- 原子重写避免损坏正被 tail 的日志；tailer 见 `size<offset` 会重置 offset（客户端 `seen` 去重，无重复显示）。

## 波及文件
- 改：`assets/index.html`、`scripts/server.mjs`。
- 收尾重跑 `install.sh` 同步到 `~/.cursor/agent-monitor`；提醒重启 4517 服务。

## 验证标准
- Claude 会话按 `session_id` 独立成会话；其 `Stop.last_assistant_message` 作为 response 显示（节点/详情/回放）。
- History 视图：卡片、搜索、置顶/隐藏、排序正常。
- 导出 JSON/MD 内容正确。
- `POST /api/session/delete` 后该会话消失、其余不受影响、日志未损坏；`clear` 清空全部。
- 现有 Cursor 事件、Tree/Timeline、筛选、GSAP 动效不回归。

## 风险
- 破坏性删除：原子写 + 双重确认；仅 localhost。
- 23MB 日志重写有开销：一次性操作，可接受。
- Claude 无 conversation_id 的归档 transcript 可能名为 `unknown.jsonl`（历史遗留），删除按 key best-effort，不保证清理旧的 `unknown.jsonl`。
