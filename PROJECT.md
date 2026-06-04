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

## 本轮实现证据

- 2026-06-04 Runtime：`sciforge_subagents` 已注入 Codex app-server production path；
  `multi_agent_v1.spawn_agent` 默认通过 Agent Host / Runtime Codex adapter 执行 child turn，
  unit fixture 必须显式使用 read-only runner；`run_in_background` 先返回 running state ref，
  后台完成后更新 runtime-owned store；显式 resume 必须命中 runtime store 中的 child agent/ref。
  child turn 显式继承 parent `approvalPolicy` 和 sandbox boundary；默认 child id/result ref/transcript ref
  对同 parent 下的同 prompt 并发 sibling 不碰撞，显式 resume 必须匹配 current parent 和 workspace scope。
  验证命令：
  `node --import tsx --test src/runtime/codex/subagent-runner.test.ts src/runtime/codex/subagent-mcp-tools.test.ts src/runtime/codex/subagent-extension-manifest.test.ts src/runtime/codex/subagent-runtime-store.test.ts src/runtime/codex/codex-app-server-client.test.ts src/runtime/codex/backend-event-normalization.test.ts src/runtime/codex/codex-event-normalizer.test.ts src/runtime/codex/codex-exec-json-adapter.test.ts`（95/95 pass）。
- 2026-06-04 Composer：Browser live 验证 Web UI fresh chat 的 Add menu 选择 `Multitask`
  后出现 chip，placeholder 为 `Coordinate parallel tasks...`，textarea 为空，Send 保持 disabled，
  visible assistant message 计数不变。
  验证命令：`node --import tsx --test src/ui/src/app/chat/ChatComposer.test.tsx src/ui/src/app/chat/composerToolMenu.test.ts src/ui/src/app/chat/composerDeclaredIntents.test.ts --test-name-pattern "composer"`；
  `node --import tsx --test --test-name-pattern "composer (model|mode|Plan Ask Debug)" src/ui/src/api/sciforgeToolsClient.policy.test.ts`。
- 2026-06-04 Process / References / Sidebar：子任务卡片、safe refs、References pane routing、
  final-answer sub-agent result aggregation、public process-progress redaction、child status hint
  和 search/resume candidates 均有 focused tests。验证命令：
  `node --import tsx --test src/ui/src/app/chat/RunExecutionProcess.test.ts src/ui/src/app/chat/finalMessagePresentation.test.tsx src/ui/src/app/chat/ChatComposer.test.tsx src/ui/src/app/chat/composerToolMenu.test.ts src/ui/src/app/chat/composerDeclaredIntents.test.ts src/ui/src/streamEventPresentation.test.ts src/ui/src/processProgress.test.ts src/ui/src/api/sciforgeToolsClient.policy.test.ts`（195 pass / 13 skip）；
  `node --import tsx --test packages/support/object-references/index.test.ts src/ui/src/app/results/resultPaneContract.test.ts src/ui/src/app/results/referencesPaneModel.test.ts src/ui/src/app/results/workspaceObjectPreviewModel.test.ts src/ui/src/app/results/workspaceObjectPreviewSubagentAdapter.test.tsx`（28/28 pass）；
  `node --import tsx --test src/ui/src/app/appShell/sidebarCursorAgentModel.test.ts src/ui/src/app/appShell/ShellPanels.sidebarModel.test.ts src/ui/src/app/appShell/SidebarProjectChatSection.test.tsx src/ui/src/app/appShell/sidebarProjectModel.test.ts`（54/54 pass）。
- 2026-06-04 Desktop：`npx tsc -p tsconfig.desktop.build.json --noEmit --pretty false` 和
  `npm run desktop:dev:prepare` 均通过；`npm run desktop:dev` 达到 started vite / workspace-writer /
  provider-proxy / runtime-codex / electron 的 live readiness line；5174 workspace-writer、
  5176 runtime-codex 和 5175 provider-proxy upstream health 均通过。额外用完整 dev shell + Electron live
  fresh-run 验证通过：在 SciForge desktop app 打开 composer menu、选择 `Multitask`、发送只读可并行拆分任务，
  观察到 3 个 child-agent cards、7 个 safe ref buttons、`artifact:subagent-*` / `subagent:*` refs、
  background/resume state ref，并展开 child process 后点击 safe ref 打开 References pane。证据文件：
  `/var/folders/vf/mcq7fgls60376whd6km0r_mr0000gn/T/sciforge-desktop-multitask-live-JFnNLX/live-evidence.json`；
  证据只记录稳定 UI 行为、公开 refs 和验证命令，不包含个人账号、私有会话正文、raw transcript、坐标或 API 配置。
- 2026-06-04 全局：`npx tsc --noEmit --pretty false`、`git diff --check` 均通过。
- 2026-06-04 Review remediation：独立 review 发现 duplicate sibling child identity/ref collision、
  explicit resume 缺少 parent/workspace scope、public process progress 漏 `/workspace/...` 绝对路径、
  native-route public event 只按 key 过滤未递归清洗 value；已补红灯测试并修复。验证命令包含在
  Runtime 与 Process focused suites 中；`npx tsc --noEmit --pretty false` 和 `git diff --check`
  已复跑通过。

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

- [x] 2026-06-04 Codex app-server production path 默认注入 `sciforge_subagents` MCP server，并公开
  `multi_agent_v1.spawn_agent` 为 Agent Host tool。
- [x] 2026-06-04 spawn result 必须包含 safe `agentId`、`parentAgentId`、`agentType`、`status`、
  `resultSummary`、`resultRef`、`transcriptRef`、`refs`、duration 和 background/resume metadata。
- [x] 2026-06-04 支持同一 turn 中并行启动多个 sub-agent，并记录 parent/child trace。
- [x] 2026-06-04 支持 `run_in_background`：后台任务有可见状态、完成通知和失败/取消状态，不阻塞主 composer。
- [x] 2026-06-04 支持显式 `resume`：用户或主 agent 必须指定可恢复 child agent / ref，不自动无边界续跑旧任务。
- [x] 2026-06-04 transcript/state 默认写入 runtime-owned subagent store，不进入 workspace raw payload；
  GUI 只看到 refs 和 bounded summary。
- [x] 2026-06-04 缺少 sub-agent tool、MCP server 启动失败、transcript 写入失败或 unsafe ref 时 fail closed，
  并给出用户可理解的 blocker summary。

### P0：Composer Multitask mode

- [x] 2026-06-04 `Add agents, context, tools` 菜单稳定展示 `Plan`、`Debug`、`Multitask`、`Ask`、
  `Image`、`Models`、`Skills`、`MCP Servers`。
- [x] 2026-06-04 点击 `Multitask` 后显示 Cursor-like mode chip，placeholder 变为
  `Coordinate parallel tasks...`，不自动发送，不写入 `/multitask` 文本。
- [x] 2026-06-04 mode chip 可移除、可替换，并随 workspace/project/thread draft 隔离保存。
- [x] 2026-06-04 发送时 GUI 只提交 declared intent / terminal-equivalent text，由 Agent Host 决定是否 spawn、
  spawn 几个、agent type、background 和 resume。
- [x] 2026-06-04 `Plan`、`Ask`、`Debug`、`Multitask` 的选中态、互斥关系和 keyboard/accessibility 行为
  与 Cursor Agent 一致。

### P0：Sub-agent process presentation

- [x] 2026-06-04 running chat 展示 `Thought for ...` / `Worked for ...` 聚合行，默认折叠内部 tool trace。
- [x] 2026-06-04 每个 child agent 显示一张子任务卡片：标题、公开 agent/model lane、status、summary、refs。
- [x] 2026-06-04 并行 child agents 必须在同一 assistant turn 中并列呈现，互不覆盖状态。
- [x] 2026-06-04 完成后主回答默认合并为表格和分节结论，不把 child transcript 原样堆进最终回答。
- [x] 2026-06-04 failed / blocked / cancelled / background-running / resumed 子任务都有独立视觉状态和可点击 refs。
- [x] 2026-06-04 过程行和卡片必须复用 Cursor-like process model，不新建调试日志栏或 provider 面板。

### P1：References / right pane refs

- [x] 2026-06-04 `subagent:*`、`artifact:subagent-result-*`、`artifact:subagent-transcript-*`、
  `transcript:*` refs 路由到 References pane。
- [x] 2026-06-04 References pane 默认显示 bounded result summary、inspected refs、agent type、status、
  parent/child relation 和 transcript ref；raw transcript 默认折叠。
- [x] 2026-06-04 result/transcript refs 可从子任务卡片、最终回答、process details 中点击打开。
- [x] 2026-06-04 unsafe refs、absolute paths、`.sciforge/raw`、provider/debug payload 不进入可见 ref list。
- [x] 2026-06-04 References pane 不执行 resume；resume 只能通过 Agent Host declared intent。

### P1：Sidebar / thread lifecycle

- [x] 2026-06-04 parent thread row 可展示有 active/background child agent 的状态 hint，但 child agent 不变成普通 thread。
- [x] 2026-06-04 Archive/Discard/Restore parent thread 时必须清楚表达对 background child agents 的影响。
- [x] 2026-06-04 Search / command palette 可发现 sub-agent results、running background tasks、resume candidates，
  只展示公共标题/摘要和 refs。
- [x] 2026-06-04 多 repository / Home / peer workspace 下，Multitask draft、background child state 和 resume candidate
  必须按 workspace/project 隔离。

### P1：Desktop live parity

- [x] 2026-06-04 修复当前阻塞 desktop dev 启动的 typecheck 错误，并恢复 `npm run desktop:dev` 可打开真实 SciForge。
- [x] 2026-06-04 每轮 sub-agent UI 改动前完成 Cursor Agent 只读 baseline：menu、mode chip、子任务卡片、
  background/resume 或 References 中至少一个同类 workflow。
- [x] 2026-06-04 每轮实现后在 SciForge desktop app 完成同类 workflow：打开 composer menu、选择 Multitask、
  发送可并行拆分任务、观察 child cards、打开 refs、验证 resume/background 状态。
- [x] 2026-06-04 live evidence 只记录稳定行为和 refs，不记录个人账号、私有会话正文、坐标或本地绝对路径。

### P2：Capability / model / safety polish

- [x] 2026-06-04 agent type 公开为 `explore`、`worker`、`review`、`shell` 等用户可理解 alias，
  不暴露 provider route 或 raw model slug。
- [x] 2026-06-04 模型显示使用公开 alias 和速度标签，例如 `Composer Fast` / `Assistant Deep`，
  不展示 raw provider config。
- [x] 2026-06-04 高风险 workspace 写入、外部发送、删除、安装、系统设置等仍走现有 confirmation policy；
  child agent 不能绕过 parent thread 的 approval boundary。
- [x] 2026-06-04 子任务摘要需要清楚说明适用场景和不适用场景：并行调研、长命令、独立 verification 适合；
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
