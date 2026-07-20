# Agent Monitor

面向 AI 编码 agent 的多引擎、基于 hook 的可观测性工具 —— **支持 Cursor、Claude Code、Codex，以及任何带命令 hook 的 agent**。它捕获 agent 的每一个动作，并在原生 **macOS 菜单栏应用**中展示 **树 / 时间线 / 历史** 视图、按来源着色的事件，以及基于已捕获 hook 重建的**每轮时序图**。

**天生全局：** hook 安装在 `~/.cursor/` 下，不绑定任何具体项目，因此它能同时监控你所有项目的对话。数据不出本机。

[English README](README.md)

![树视图与每轮时序图](docs/screenshots/tree-sequence-diagram.png)

## 捕获哪些内容

每一个 hook 事件都会追加写入本地 JSONL 日志：

- 你的 prompt、agent 的思考块与最终回复
- 每一次工具调用，含**完整的输入与结果**
- Shell 命令及其**完整输出**
- 文件读取（内容）与编辑（diff）
- MCP 调用与结果
- 子 agent：任务、类型、模型、状态、统计信息，以及它们各自的 transcript
- 会话生命周期与上下文压缩（compaction）

在会话/子 agent 结束时，还会把对话 transcript 快照进归档目录。

## 无法捕获哪些内容（平台限制）

以下内容不被任何 agent hook 或本地 transcript 完整暴露：

- 实际发送给 LLM 的完整拼装 prompt（系统 prompt、规则、序列化后的上下文）
- 逐 token 的推理 / 原始模型 API 的请求-响应
- 未被 agent 记录到 hook 或 transcript 中的模型用量

一句话：**对话层**（agent 做了什么）几乎被完整捕获；**模型层**（模型逐 token 收到了什么）无法捕获。

面板中的 **API 总量**来自 agent 已暴露的数据：Cursor 直接读取 hook 字段，Claude Code 与 Codex 从本地 transcript 汇总这一轮内的模型调用；**上下文总量**是本轮最后一次调用的上下文快照，**调用次数**是本轮可识别的模型调用数。这些是本地记录的用量统计，不是对原始模型 API 流量的独立抓包，也不包含价格或费用估算。

## 架构

```
Agent (Cursor / Claude Code / Codex / …)
   │  生命周期事件 → 启动一个 hook 进程，JSON 从 stdin 传入
   ▼
scripts/capture.sh <source> → scripts/capture.mjs   (只追加、fail-open、绝不阻塞)
   │  每个事件一行 JSON（附带 _source 标签）
   ▼
~/.cursor/observer/events.jsonl
   │  watch + tail
   ▼
Agent Monitor.app（macOS 菜单栏）
   │  内嵌 HTTP+SSE 服务 → 面板 UI
   ▼
树 / 时间线 / 历史 + 每轮时序图
```

采集 hook 只写文件（零网络、fail-open），因此永远不会阻塞或拖慢 agent。macOS 应用 tail 日志并通过 SSE 推送到内嵌面板。

## macOS 菜单栏 App

构建并运行：

```bash
sh scripts/build-macos-app.sh
# 产物: macos/build/Build/Products/Release/Agent Monitor.app
open "macos/build/Build/Products/Release/Agent Monitor.app"
```

**功能：**

- 菜单栏图标实时显示 agent 活动状态（idle / live / active / offline）
- 点击菜单查看精简摘要（来源、最近事件、计数）
- **Open Panel**（⌘O）打开完整监控窗口
- **Install Hooks…** 一键注册 Cursor / Claude Code hooks
- **Launch at Login** 开机自启

App 内嵌本地 HTTP+SSE 服务（默认 `http://127.0.0.1:4517`），从 bundle 提供面板 UI。可通过 `OBSERVER_PORT` 更改端口。若端口被占用，退出占用进程后重启 App。

每次构建会通过 `scripts/sync-macos-assets.sh` 将最新 `assets/` 同步进 app bundle。

可选分发包：

```bash
sh scripts/package-dmg.sh   # 需要: brew install create-dmg
```

**要求：** macOS 13+，Xcode 15+（用于构建）。本地开发可 ad-hoc 签名；分发给他人需使用 Developer ID 签名并 notarize。

## 安装 hooks

可通过 App 菜单（**Install Hooks…**）或命令行注册：

```bash
sh install.sh
```

这会把采集脚本拷贝到一个与项目无关的位置（`~/.cursor/agent-monitor`），并注册 **Cursor**、**Claude Code** 与 **Codex** 用户 hook（合并，不会覆盖已有配置）。安装后重新加载 Cursor；Codex 新建会话后若提示 hook 待审核，请打开 `/hooks` 并信任 Agent Monitor。

然后打开 macOS App，选择 **Open Panel**（⌘O）查看实时事件。

## 监控更多 agent

所有 agent 都会汇入同一个面板，按来源打标签并着色。可直接复制的配置见 [`docs/multi-agent.md`](docs/multi-agent.md)：

- **Cursor** —— 由 `install.sh` 或 App 自动配置
- **Claude Code** —— 由 `install.sh` 或 App 自动配置；手动模板见 [`adapters/claude-code.settings.json`](adapters/claude-code.settings.json)
- **Codex** —— 由 `install.sh` 或 App 自动配置；手动模板见 [`adapters/codex.hooks.json`](adapters/codex.hooks.json)
- **任意 agent** —— 把它的命令 hook 指向 `~/.cursor/agent-monitor/scripts/capture.sh <your-source-name>`；如果它使用了新的事件名，在 `assets/index.html` 的 `EVENT_ALIASES` 中补充即可。

## 数据与隐私

所有数据都保存在本机的 `~/.cursor/observer/` 下。该日志可能包含**你所有项目的文件内容、shell 输出和 prompt** —— 请当作敏感数据对待。随时删除该目录即可重置。

## 许可证

MIT —— 见 [LICENSE](LICENSE)。
