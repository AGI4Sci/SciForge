# SciForge Workbench 任务板

最后更新：2026-06-04

## 当前目标

Workbench 负责用户可见的桌面体验：左栏、聊天/过程、composer、右侧对象 pane、Browser pane 和 Image / Evidence pane。它不拥有 Agent Host、Computer Use executor、provider route、workspace 写入或 completion 判断。

当前主线仍以 `PROJECT.md` 的 Cursor-like multi-agent / sub-agent workbench 为准。本文件只记录 UI surface 的通用任务，避免 left/middle/right/browser/image 分散维护。

## 设计原则

- GUI 只呈现 bounded public state，不暴露 provider URL、token、raw JSON、stdout/stderr、raw transcript 或本地绝对路径。
- Composer 只提交用户文本、declared intent 和 refs-first context；不直接创建 sub-agent、不执行 Computer Use、不写 workspace。
- Annotation refs 作为 pending context 进入 composer；用户发送后进入 thread。
- 点击 object ref 只 focus/open 对应 pane；把 ref 插入 composer 必须是显式引用动作。
- Browser 是真实 Desktop native BrowserHostSession；Web dev 缺 native host 时只能显示 blocked/diagnostic。
- Image / Evidence pane 只展示图片、annotation、provenance、before/after evidence 和 action timeline refs；不执行鼠标键盘。
- 单文件业务代码接近 2000 行时必须拆分或登记。

## 当前任务

### P0：Composer / Context

- [ ] `Add agents, context, tools` 菜单稳定支持 Plan、Ask、Debug、Multitask、Image、Models、Skills、MCP Servers。
- [ ] `Multitask` 使用 mode chip，不自动发送，不注入 slash 文本，随 workspace/project/thread draft 隔离保存。
- [ ] Annotation/Image 入口进入 unified pending context，支持预览、移除、随消息发送。
- [ ] model/mode picker 只展示公开 alias 和 intent，不展示 provider config 或 secret。

### P0：Process / Sub-agent Presentation

- [ ] running chat 展示 Cursor-like `Thought` / `Worked` 聚合行，默认折叠内部 trace。
- [ ] child agent 卡片展示标题、公开 agent/model lane、status、summary 和 refs。
- [ ] 并行 child agents 在同一 assistant turn 中并列呈现，互不覆盖状态。
- [ ] failed / blocked / cancelled / background-running / resumed 都有独立视觉状态。

### P0：Object Ref Routing

- [ ] `subagent:*`、`trace:*`、`run:*` refs 路由到 References pane。
- [ ] `browser:*` / URL refs 路由到 Browser pane。
- [ ] `annotation:*` / `image:*` / `crop:*` / `screenshot:*` refs 路由到 Image / Evidence pane。
- [ ] `terminal:*` refs 路由到 Terminal pane。
- [ ] `file:*` refs 路由到 Files pane。

### P1：Right Pane Simplification

- [ ] Right Pane shell 只保留 tab lifecycle、active pane、focus dispatch 和 empty state。
- [ ] Browser/Image/Terminal/Files/References 的 projection adapter 分别维护，避免集中到 ResultsRenderer。
- [ ] Terminal PTY 输入/resize/stop 只在 Terminal pane 走 host-owned PTY control，不扩散到其他 pane。

### P1：Sidebar / Workspace UX

- [ ] Parent thread row 可展示 active/background child agent 状态，但 child agent 不变成普通 thread。
- [ ] Search / command palette 可发现 sub-agent result、background task、resume candidate，只展示公共标题/摘要/refs。
- [ ] 多 repository / Home / peer workspace 下，draft、refs、background child state 和 resume candidate 必须隔离。

## 验收规则

- 文档改动：`git diff --check`。
- Composer 改动：运行 composer 和 declared-intent focused tests。
- Process presentation 改动：验证 raw provider/debug/secret 不进入最终回答或 process rows。
- Ref routing 改动：验证点击 ref 只打开对应 pane，不隐式写 composer，不触发 provider action。
- Browser pane 改动：真实 Browser 能力必须在 Desktop Electron native host 中验证；Web dev 只能证明 UI/diagnostic。
- Image pane 改动：确认图片证据不升级为 action truth 或 completion truth。

## 历史任务板

旧分散任务板已归档到 `docs/archive/project-tasks-2026-06-04/`。
