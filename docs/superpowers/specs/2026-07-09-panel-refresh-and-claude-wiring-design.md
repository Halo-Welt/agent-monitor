# 设计：面板精修 + GSAP 动效 + Claude Code 自动接入

日期：2026-07-09

## 背景与动机

1. **Claude Code 没被检测到。** 根因确认：`~/.claude/settings.json` 里没有 `hooks` 字段，`events.jsonl` 中 `_source=claude` 的事件为 0。`install.sh` 只自动注册 Cursor hooks，对 Claude Code / Codex 仅打印手动合并提示，用户从未手动合并，导致 Claude Code 一直未接入。这不是采集管线 bug，而是安装器的接入缺口。
2. **Raw hook events 藏在折叠里。** 详情面板底部的 `<details class="raw">` 默认折叠，用户希望像其它区块一样平铺写出。
3. **界面偏丑。** 现为浅色 GitHub 风，需精修并引入 GSAP 动效。
4. **整体用 superpowers 优化。** 采用「探索→对齐→设计→实现→验证」的流程。

## 目标

- Claude Code 能被自动接入并上报事件。
- Hook 原始事件默认可见。
- 浅色主题精修 + 克制的 GSAP 动效，GSAP 完全本地化、零外网。
- 不破坏「本地、零依赖、fail-open、旁听不阻断」的核心特性。

## 非目标（YAGNI）

- 不同步改动 `extension/` 那套独立 webview UI（本次聚焦浏览器面板）。
- 不做深浅双主题（用户选定精修浅色）。
- 不重构 `render()` 的整表重建架构，仅在其上叠加「只对新增元素」的入场动效。

## 方案

### A. Claude Code 接入
- **立即合并**：向 `~/.claude/settings.json` 注入 `hooks`，仅新增该字段，保留 `env`（含 token）/`theme`/`enabledPlugins` 原样。事件用 Claude 的 PascalCase + `{matcher, hooks:[{type:"command", command}]}` 结构，command 为 `~/.cursor/agent-monitor/scripts/capture.sh claude`。幂等：若某事件下已存在含 `agent-monitor` 的 command 则跳过。
- **install.sh**：新增一段 Node 合并逻辑，安装时若存在 `~/.claude/settings.json` 则自动合并 Claude hooks（同样幂等、保留其它字段）。
- **注意**：Claude Code 仅在会话启动时读取 settings.json，合并后需新开 claude 会话才生效。

### B. Raw hook events 平铺
- 将详情面板的 `details.raw` 折叠块改为常规 `d-section`（标题 `Hook events (N)`），默认可见。每条事件的 JSON 放入带 `max-height` 滚动的代码块，避免超长输出撑爆面板。

### C. 界面精修 + GSAP
- **视觉**：保留浅色，精修色板 / 间距 / 层级 / 字体，优化 topbar、chips、session/turn 卡片、详情面板可读性。
- **GSAP 交付**：本地文件 `assets/gsap.min.js`，由 `server.mjs` 新增静态路由 `/gsap.min.js` 提供（路径限制在 assets 目录内）。index.html 通过 `<script src="/gsap.min.js">` 引入。加载失败时 feature-detect 降级（无动效但功能完好）。
- **动效（克制）**：
  - 新增节点 / 时间线行：stagger 淡入上滑，只对本次渲染中「首次出现」的 key 生效（用 `animatedKeys` 集合去重），避免每次 SSE 刷新全表重放。
  - 详情面板：选中变化时内容做淡入/位移过渡。
  - Tree / Timeline 切换：交叉淡入。
  - 运行中节点：GSAP 呼吸脉冲替代/增强现有 CSS pulse。

### D. 波及文件
- 改：`assets/index.html`、`scripts/server.mjs`、`install.sh`。
- 新增：`assets/gsap.min.js`、本 spec。
- install.sh 由「复制 index.html」改为「复制整个 assets/ 目录」。
- 收尾重跑 install.sh，同步到 `~/.cursor/agent-monitor`，使 4517 上运行的面板生效。

## 数据流（不变）

```
Agent → hook → capture.sh <source> → capture.mjs → ~/.cursor/observer/events.jsonl
   → server.mjs (tail + SSE) → assets/index.html (timeline + tree)
```

## 验证标准

- `node scripts/server.mjs` 启动无报错，浏览器打开无 JS 报错。
- `/gsap.min.js` 可访问且 `window.gsap` 存在；断网/移除文件时面板仍可用（降级）。
- Raw hook events 默认可见。
- 新开一个 claude 会话后，面板出现 `_source=claude` 的事件。
- 现有 Cursor 事件、筛选、Tree/Timeline、详情渲染均正常。

## 风险

- Claude settings.json 含密钥：合并脚本只读改写 hooks，绝不打印/提交该文件（位于 ~ 下，不在仓库内）。
- 整表重建 + 动效可能在超大日志下抖动：动效仅作用于新增元素，且可降级，风险可控。
