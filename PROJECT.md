# SciForge 项目协议

最后更新：2026-06-04

## 当前目标

SciForge 当前主线是 **Cursor-like Multi-agent / Sub-agent Workbench**。
目标不是在 GUI 里重新实现一个 agent runtime，而是把 Codex app-server / Agent Host
的 sub-agent 能力投影成和 Cursor Agent 一致的桌面体验：

- 用户从 composer 的 `Add agents, context, tools` 选择 `Multitask`。
- `Multitask` 是可见、可移除、随 draft/thread 保存的 mode chip，不是自动发送的 slash 文本。
- 主 agent 可以并行启动多个 sub-agent，支持不同 agent type、后台运行和显式 resume。
- 聊天过程展示 `Thought` / `Worked` 聚合行和多个子任务卡片。
- 子任务卡片展示标题、公开 agent/model lane、状态、完成摘要和 refs。
- 最终回答合并多个 sub-agent 结果，默认不展开 raw transcript。
- `subagent:*`、`artifact:subagent-*`、transcript/result refs 点击后打开右侧 References pane。

旧 left/middle/right/browser/image/desktop/annotation/window-action/computer-use 分散任务板已合并。
`PROJECT.md` 只跟踪 multi-agent / sub-agent 体验对齐；Workbench 和 Desktop/Action 相关任务分别由
`PROJECT_workbench.md` 与 `PROJECT_desktop_actions.md` 维护。

## 本轮双端观察基线

- 2026-06-04 只读观察 Cursor Agent desktop app：composer 的
  `Add agents, context, tools` 菜单包含 `Plan`、`Debug`、`Multitask`、`Ask`、
  `Image`、`Models`、`Skills`、`MCP Servers`；点击 `Multitask` 后出现紫色
  `Multitask` chip，placeholder 变为 `Coordinate parallel tasks...`，不会自动发送。
- 2026-06-04 只读观察 Cursor sub-agent 演示：主聊天展示 `Thought` / `Worked` 行、
  两个子任务卡片、公开模型 lane、完成摘要，并在最终回答中以表格和分节结论合并结果。
- 2026-06-04 只读观察 SciForge：本地 Web UI 左栏已接近 Cursor Agents sidebar；
  composer 菜单和测试已包含 Cursor-like taxonomy，但 `Multitask` 仍偏向 slash directive，
  还缺 mode chip、子任务卡片、background/resume 状态和 References refs 闭环。
- 2026-06-04 SciForge desktop dev 启动受当前工作区 TypeScript 错误阻塞：
  `packages/presentation/components/image-evidence-viewer/render.tsx` 与
  `src/desktop/annotation-window-capture-provider.ts` 需要先恢复 typecheck 后再做桌面 live parity。

## 不可变规则

- 所有修改必须通用，不能为当前页面、截图、URL、文件名、agent id 或历史 run 写硬编码补丁。
- Codex app-server / Agent Host 是 sub-agent 创建、调度、provider route、workspace 写入、
  tool execution、background/resume 和 completion 判断的唯一执行 owner。
- GUI 只发送 terminal-equivalent text、declared intent、focus/confirmation 结果或只读 projection；
  不直接创建 sub-agent、不选择 provider、不读 raw transcript、不写 workspace。
- `Multitask` 入口只声明用户 intent；点击后不得自动发送任务、不得静默 spawn、不得把
  `/multitask` 文本硬塞进 composer。
- sub-agent 卡片和过程行只能展示 bounded public state：标题、agent type/alias、公开模型 alias、
  status、duration、summary、refs；不得展示 provider URL、API key、token、本地绝对路径、
  raw model name/config、raw JSON、stdout/stderr 或 prompt echo。
- 大 payload、截图、录屏、terminal transcript、DOM snapshot、artifact、audit、replay 和
  sub-agent transcript 必须 refs-first；默认折叠内部 transcript。
- child agent 不得在左栏冒充普通独立 thread；必须保留 parent/child relation、agent id、status、
  refs 和 resume boundary。
- refs 点击只能 focus/open 右侧对象 pane，不能隐式插入 composer。
- `NO_SUBAGENT_TOOL_AVAILABLE`、缺少 MCP server、desktop 无法启动或 typecheck 失败只能作为
  blocker/evidence，不得当作验收通过。
- 业务代码单文件超过约 2000 行时必须拆分或登记拆分任务。
- 已完成 TODO 必须打勾，并补充日期、evidence refs、验证命令和最终状态。

## 相关任务板

- [`PROJECT_workbench.md`](PROJECT_workbench.md)：left/middle/right、composer、process rows、Browser/Image/References pane。
- [`PROJECT_desktop_actions.md`](PROJECT_desktop_actions.md)：Desktop native host、Annotation、Window Action、Computer Use adapter。
- 历史分散任务板：`docs/archive/project-tasks-2026-06-04/`。

## 当前任务板：Cursor-like Sub-agent Parity

### P0：Agent Host sub-agent 执行闭环

- [ ] Codex app-server production path 默认注入 `sciforge_subagents` MCP server，并公开
  `multi_agent_v1.spawn_agent` 为 Agent Host tool。
- [ ] spawn result 必须包含 safe `agentId`、`parentAgentId`、`agentType`、`status`、
  `resultSummary`、`resultRef`、`transcriptRef`、`refs`、duration 和 background/resume metadata。
- [ ] 支持同一 turn 中并行启动多个 sub-agent，并记录 parent/child trace。
- [ ] 支持 `run_in_background`：后台任务有可见状态、完成通知和失败/取消状态，不阻塞主 composer。
- [ ] 支持显式 `resume`：用户或主 agent 必须指定可恢复 child agent / ref，不自动无边界续跑旧任务。
- [ ] transcript/state 默认写入 runtime-owned subagent store，不进入 workspace raw payload；
  GUI 只看到 refs 和 bounded summary。
- [ ] 缺少 sub-agent tool、MCP server 启动失败、transcript 写入失败或 unsafe ref 时 fail closed，
  并给出用户可理解的 blocker summary。

### P0：Composer Multitask mode

- [ ] `Add agents, context, tools` 菜单稳定展示 `Plan`、`Debug`、`Multitask`、`Ask`、
  `Image`、`Models`、`Skills`、`MCP Servers`。
- [ ] 点击 `Multitask` 后显示 Cursor-like mode chip，placeholder 变为
  `Coordinate parallel tasks...`，不自动发送，不写入 `/multitask` 文本。
- [ ] mode chip 可移除、可替换，并随 workspace/project/thread draft 隔离保存。
- [ ] 发送时 GUI 只提交 declared intent / terminal-equivalent text，由 Agent Host 决定是否 spawn、
  spawn 几个、agent type、background 和 resume。
- [ ] `Plan`、`Ask`、`Debug`、`Multitask` 的选中态、互斥关系和 keyboard/accessibility 行为
  与 Cursor Agent 一致。

### P0：Sub-agent process presentation

- [ ] running chat 展示 `Thought for ...` / `Worked for ...` 聚合行，默认折叠内部 tool trace。
- [ ] 每个 child agent 显示一张子任务卡片：标题、公开 agent/model lane、status、summary、refs。
- [ ] 并行 child agents 必须在同一 assistant turn 中并列呈现，互不覆盖状态。
- [ ] 完成后主回答默认合并为表格和分节结论，不把 child transcript 原样堆进最终回答。
- [ ] failed / blocked / cancelled / background-running / resumed 子任务都有独立视觉状态和可点击 refs。
- [ ] 过程行和卡片必须复用 Cursor-like process model，不新建调试日志栏或 provider 面板。

### P1：References / right pane refs

- [ ] `subagent:*`、`artifact:subagent-result-*`、`artifact:subagent-transcript-*`、
  `transcript:*` refs 路由到 References pane。
- [ ] References pane 默认显示 bounded result summary、inspected refs、agent type、status、
  parent/child relation 和 transcript ref；raw transcript 默认折叠。
- [ ] result/transcript refs 可从子任务卡片、最终回答、process details 中点击打开。
- [ ] unsafe refs、absolute paths、`.sciforge/raw`、provider/debug payload 不进入可见 ref list。
- [ ] References pane 不执行 resume；resume 只能通过 Agent Host declared intent。

### P1：Sidebar / thread lifecycle

- [ ] parent thread row 可展示有 active/background child agent 的状态 hint，但 child agent 不变成普通 thread。
- [ ] Archive/Discard/Restore parent thread 时必须清楚表达对 background child agents 的影响。
- [ ] Search / command palette 可发现 sub-agent results、running background tasks、resume candidates，
  只展示公共标题/摘要和 refs。
- [ ] 多 repository / Home / peer workspace 下，Multitask draft、background child state 和 resume candidate
  必须按 workspace/project 隔离。

### P1：Desktop live parity

- [ ] 修复当前阻塞 desktop dev 启动的 typecheck 错误，并恢复 `npm run desktop:dev` 可打开真实 SciForge。
- [ ] 每轮 sub-agent UI 改动前完成 Cursor Agent 只读 baseline：menu、mode chip、子任务卡片、
  background/resume 或 References 中至少一个同类 workflow。
- [ ] 每轮实现后在 SciForge desktop app 完成同类 workflow：打开 composer menu、选择 Multitask、
  发送可并行拆分任务、观察 child cards、打开 refs、验证 resume/background 状态。
- [ ] live evidence 只记录稳定行为和 refs，不记录个人账号、私有会话正文、坐标或本地绝对路径。

### P2：Capability / model / safety polish

- [ ] agent type 公开为 `explore`、`worker`、`review`、`shell` 等用户可理解 alias，
  不暴露 provider route 或 raw model slug。
- [ ] 模型显示使用公开 alias 和速度标签，例如 `Composer Fast` / `Assistant Deep`，
  不展示 raw provider config。
- [ ] 高风险 workspace 写入、外部发送、删除、安装、系统设置等仍走现有 confirmation policy；
  child agent 不能绕过 parent thread 的 approval boundary。
- [ ] 子任务摘要需要清楚说明适用场景和不适用场景：并行调研、长命令、独立 verification 适合；
  强耦合同一文件 edits、需要完整聊天历史的任务默认由主 agent 做。

## 验收规则

- 纯文档改动：运行 `git diff --check`。
- `PROJECT.md` 入口改动：确认当前任务板只保留 multi-agent / sub-agent UX 对齐；
  Browser / Annotation / Window Action 不再作为当前主任务出现。
- Composer 改动：运行 `src/ui/src/app/chat/ChatComposer.test.tsx`、
  `src/ui/src/app/chat/composerToolMenu.test.ts` 和 declared-intent focused tests；验证
  `Multitask` chip、placeholder、remove/replace、draft persistence、no auto send、no slash injection。
- Runtime/protocol 改动：运行 subagent MCP/manifest、Codex app-server client、event normalizer 和
  backend adapter focused tests；验证 parent/child trace、background/resume metadata、安全 refs 和脱敏。
- Process presentation 改动：运行 `RunningWorkProcess`、cursor process model、stream event presentation
  focused tests；验证 `Thought` / `Worked` 行、并行子任务卡片、公开 model/agent alias、状态和摘要。
- References/right pane 改动：运行 object-ref routing、References pane 和 result pane focused tests；
  验证 sub-agent result/transcript refs 可打开、默认折叠 raw transcript、refs-first 且脱敏。
- Desktop/live 改动：先恢复 `npm run desktop:dev`，再完成 Cursor Agent baseline 和 SciForge desktop
  同类 workflow evidence；无法启动 desktop 时必须登记 blocker，不能用 Web UI 截图冒充桌面验收。
- 安全检查：任何 sub-agent UI、event、ref、summary、evidence 中不得出现 provider URL、API key、
  Authorization、token、secret、本地绝对路径、raw JSON、stdout/stderr、raw transcript。

## 必读文档

- [`docs/README.md`](docs/README.md)：当前文档入口。
- [`docs/Architecture.md`](docs/Architecture.md)：Agent Host Semantic Pipeline 和 GUI-as-extension。
- [`docs/TuiGuiProtocol.md`](docs/TuiGuiProtocol.md)：GUI 输入、只读投影和执行边界。
- [`docs/NativeExtensionOwnershipMap.md`](docs/NativeExtensionOwnershipMap.md)：native / runtime / GUI ownership。

## Worktree 规则

- 开发默认在 `dev` 分支；长期分支尽量只保留 `main` 和 `dev`。
- `config.local.json`、`config.computer-use.local.json`、`.sciforge/**`、package caches、
  runtime homes、subagent transcript/state stores 等本地状态不得进入 Git。
- 不使用 `git reset --hard` 或 `git checkout --` 擦除用户改动。
- 只清理明确的 generated caches、temporary workspaces 和 build outputs。
