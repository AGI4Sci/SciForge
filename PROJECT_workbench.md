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

- [x] `Add agents, context, tools` 菜单稳定支持 Plan、Ask、Debug、Multitask、Image、Models、Skills、MCP Servers。（2026-06-05 evidence: `src/ui/src/app/chat/composerToolMenu.ts`、`composerToolMenu.test.ts`、`ChatComposer.test.tsx` menu rendering；commands: `node --import tsx --test src/ui/src/app/chat/ChatComposer.test.tsx src/ui/src/app/chat/composerReferences.test.ts src/ui/src/app/chat/composerToolMenu.test.ts src/ui/src/app/chat/composerDeclaredIntents.test.ts src/ui/src/app/chat/sessionTransforms.test.ts`）
- [x] `Multitask` 使用 mode chip，不自动发送，不注入 slash 文本，随 workspace/project/thread draft 隔离保存。（2026-06-05 evidence: `composerToolMenu.ts` `composerDraftStorageKey`、`composerToolMenu.test.ts` draft isolation, and `ChatComposer.test.tsx` mode chip/no slash-text assertions；commands: `node --import tsx --test src/ui/src/app/chat/ChatComposer.test.tsx src/ui/src/app/chat/composerToolMenu.test.ts src/ui/src/app/chat/composerDeclaredIntents.test.ts`）
- [x] Annotation/Image 入口进入 unified pending context，支持预览、移除、随消息发送。（2026-06-05 evidence: `src/ui/src/app/chat/composerReferences.ts`、`composerReferences.test.ts`；commands: `node --import tsx --test src/ui/src/app/chat/composerReferences.test.ts src/ui/src/app/chat/sessionTransforms.test.ts`）
- [x] model/mode picker 只展示公开 alias 和 intent，不展示 provider config 或 secret。（2026-06-05 evidence: `composerToolMenu.ts` public model/mode intents and `composerDeclaredIntents.ts` fail-closed sanitizer；commands: `node --import tsx --test src/ui/src/app/chat/composerToolMenu.test.ts src/ui/src/app/chat/composerDeclaredIntents.test.ts`）

### P0：Process / Sub-agent Presentation

- [x] running chat 展示 Cursor-like `Thought` / `Worked` 聚合行，默认折叠内部 trace。（2026-06-05 evidence: `FinalMessageContent.tsx`、`RunExecutionProcess.test.ts` process folding；commands: `node --import tsx --test src/ui/src/app/chat/MessageContent.test.tsx src/ui/src/app/chat/FinalMessageContent.test.tsx src/ui/src/app/chat/cursorProcessObjectReferences.test.ts src/ui/src/app/chat/RuntimeGuiPanel.test.tsx src/ui/src/app/chat/RunExecutionProcess.test.ts`）
- [x] child agent 卡片展示标题、公开 agent/model lane、status、summary 和 refs。（2026-06-05 evidence: `cursorProcessObjectReferences.ts` and child-agent process tests; commands: `node --import tsx --test src/ui/src/app/chat/cursorProcessObjectReferences.test.ts src/ui/src/app/chat/RunExecutionProcess.test.ts`）
- [x] 并行 child agents 在同一 assistant turn 中并列呈现，互不覆盖状态。（2026-06-05 evidence: `RunExecutionProcess.test.ts` parallel child-agent card assertions；commands: `node --import tsx --test src/ui/src/app/chat/RunExecutionProcess.test.ts`）
- [x] failed / blocked / cancelled / background-running / resumed 都有独立视觉状态。（2026-06-05 evidence: `RuntimeGuiPanel.test.tsx`、`RunExecutionProcess.test.ts` status matrix；commands: `node --import tsx --test src/ui/src/app/chat/RuntimeGuiPanel.test.tsx src/ui/src/app/chat/RunExecutionProcess.test.ts`）

### P0：Object Ref Routing

- [x] `subagent:*`、`trace:*`、`run:*` refs 路由到 References pane。（2026-06-05 evidence: `resultPaneContract.ts` references contract and `resultPaneContract.test.ts`; commands: `node --import tsx --test src/ui/src/app/results/resultPaneContract.test.ts src/ui/src/app/results/referencesPaneModel.test.ts`）
- [x] `browser:*` / URL refs 路由到 Browser pane。（2026-06-05 evidence: `resultPaneContract.ts` browser route matrix; commands: `node --import tsx --test src/ui/src/app/results/resultPaneContract.test.ts src/ui/src/app/results/browserPaneModel.test.ts`）
- [x] `annotation:*` / `image:*` / `crop:*` / `screenshot:*` refs 路由到 Image / Evidence pane。（2026-06-05 evidence: `resultPaneContract.ts` image route matrix and image pane adapter tests; commands: `node --import tsx --test src/ui/src/app/results/resultPaneContract.test.ts src/ui/src/app/results/imagePaneModel.test.ts`）
- [x] `terminal:*` refs 路由到 Terminal pane。（2026-06-05 evidence: `resultPaneContract.ts` terminal route matrix and terminal controller tests; commands: `node --import tsx --test src/ui/src/app/results/resultPaneContract.test.ts src/ui/src/app/results/rightPaneTerminalController.test.ts`）
- [x] `file:*` refs 路由到 Files pane。（2026-06-05 evidence: `resultPaneContract.ts` file route matrix and workspace preview route tests; commands: `node --import tsx --test src/ui/src/app/results/resultPaneContract.test.ts src/ui/src/app/results/workspaceObjectPreviewRouteModel.test.ts`）

注：References pane 当前沿用内部 tab kind `evidence` 作为 migration/canonicalization 名称；legacy `screen` route 也只 canonicalize 到 Image/Evidence，不作为可见 product tab 或通过条件。

### P1：Right Pane Simplification

- [x] Right Pane shell 只保留 tab lifecycle、active pane、focus dispatch 和 empty state。（2026-06-05 evidence: `rightPaneLifecycleController.ts`、`rightPaneTabController.ts`、`rightPaneSurfaceAdapter.tsx`; commands: `node --import tsx --test src/ui/src/app/results/rightPaneLifecycleController.test.ts src/ui/src/app/results/rightPaneTabController.test.ts src/ui/src/app/results/rightPaneSurfaceAdapter.test.ts`）
- [x] Browser/Image/Terminal/Files/References 的 projection adapter 分别维护，避免集中到 ResultsRenderer。（2026-06-05 evidence: `browserPaneHostAdapter.tsx`、`imagePaneHostAdapter.tsx`、`terminalPaneHostAdapter.tsx`、`filesPaneHostAdapter.tsx`、`referencesPaneHostAdapter.tsx` and `ResultShell.test.tsx`; commands: `node --import tsx --test src/ui/src/app/results/ResultShell.test.tsx src/ui/src/app/results/rightPaneSurfaceAdapter.test.ts`）
- [x] Terminal PTY 输入/resize/stop 只在 Terminal pane 走 host-owned PTY control，不扩散到其他 pane。（2026-06-05 evidence: `rightPaneLifecycleController.ts` pane-scoped cleanup and `rightPaneTerminalController.ts`; commands: `node --import tsx --test src/ui/src/app/results/rightPaneLifecycleController.test.ts src/ui/src/app/results/rightPaneTerminalController.test.ts`）

### P1：Sidebar / Workspace UX

- [x] Parent thread row 可展示 active/background child agent 状态，但 child agent 不变成普通 thread。（2026-06-05 evidence: `ShellPanels.tsx` projection and `ShellPanels.sidebarModel.test.ts` parent thread row assertions；commands: `node --import tsx --test src/ui/src/app/appShell/ShellPanels.sidebarModel.test.ts src/ui/src/app/appShell/sidebarCursorAgentModel.test.ts`）
- [x] Search / command palette 可发现 sub-agent result、background task、resume candidate，只展示公共标题/摘要/refs。（2026-06-05 evidence: `sidebarCommandPaletteModel.ts` public agent candidate search and tests；commands: `node --import tsx --test src/ui/src/app/appShell/sidebarCommandPaletteModel.test.ts src/ui/src/app/appShell/ShellPanels.sidebarModel.test.ts`）
- [x] 多 repository / Home / peer workspace 下，draft、refs、background child state 和 resume candidate 必须隔离。（2026-06-05 evidence: `sidebarProjectModel.ts`、`sidebarProjectSessions.ts`、`workspaceState.ts` and scoped sidebar tests；commands: `node --import tsx --test src/ui/src/app/appShell/sidebarProjectModel.test.ts src/ui/src/app/appShell/sidebarProjectSessions.test.ts src/ui/src/app/appShell/workspaceState.test.ts src/ui/src/app/appShell/ShellPanels.sidebarModel.test.ts`）

## 验收规则

- 文档改动：`git diff --check`。
- Composer 改动：运行 composer 和 declared-intent focused tests。
- Process presentation 改动：验证 raw provider/debug/secret 不进入最终回答或 process rows。
- Ref routing 改动：验证点击 ref 只打开对应 pane，不隐式写 composer，不触发 provider action。
- Browser pane 改动：真实 Browser 能力必须在 Desktop Electron native host 中验证；Web dev 只能证明 UI/diagnostic。
- Image pane 改动：确认图片证据不升级为 action truth 或 completion truth。

## 历史任务板

旧分散任务板已归档到 `docs/archive/project-tasks-2026-06-04/`。
