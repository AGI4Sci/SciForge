# SciForge 项目协议

最后更新：2026-05-31

当前目标：把 SciForge 收敛为 **Agent Host Semantic Pipeline + Cursor-like Agent Workbench**。Codex app-server 是产品 runtime 必需的原生 backend 和 rich-client 主路径；GUI 是 Agent Host 的 presentation / confirmation / focus / resource projection 模块，不是第二个 agent host。旧任务历史已在 Git 历史中保留；本文件只保留当前原则、任务板、TODO 和验收规则。

## 当前范围

- SciForge web 必须像 Cursor Agent desktop app 一样承载对话、过程、右侧结果栏、左侧仓库/对话管理和可点击对象；回答内容可以不同，但信息架构、折叠层级、实时状态、右侧 pane 行为和 refs-first 交互必须一致。
- Codex app-server 是产品 runtime 主路径；`codex exec --json`、runtime gateway、Workspace Gateway 和旧 AgentServer 路径只能作为 legacy/test-only/diagnostic shim。
- 所有边界能力通过 `module.describe/query/read/invoke` 或 Codex native tool/plugin/MCP 暴露；GUI 不做 provider route、capability ranking、completion 判断、workspace 写入、Computer Use 执行或隐藏 prompt assembly。
- BrowserRuntime、Computer Use、files、terminal、connectors、verifiers、skills、memory、capabilities 和 artifacts 都是 Agent Host 可组合模块；复杂流程由 Agent Host 组合成 typed semantic pipeline，并写入结构化 trace。
- 对齐体验时必须同时使用 SciForge web 与 Cursor Agent desktop app 做双端对照：Browser 验证 SciForge 真实页面，Computer Use 观察 Cursor Agent 基线；对照结果只能沉淀为通用规则，不允许写成截图/文件名/历史会话硬编码。

## 不可变规则

- 所有修改必须通用，不能为当前页面、截图、URL、文件名或历史 run 写硬编码补丁。
- 代码路径保持唯一真相源；旧逻辑和最终方案冲突时删除或迁移旧逻辑，不做长期并行实现。
- GUI -> TUI 只发送终端等价文本、focus/confirmation 结果或只读 projection；TUI -> GUI 只通过 declared GUI intents。
- 右侧结果栏不是日志 dump。它必须按对象类型展示 Browser、Screen、Terminal、Files、References 等 Cursor-like panes，并以可点击 refs 驱动。
- 大 payload、截图、录屏、terminal transcript、DOM snapshot、artifact、audit 和 replay 必须 refs-first；不得内联 raw screenshot/base64/provider payload/secret。
- 涉及 provider URL、API key、model name、Authorization、token、secret、password、credential 的日志和 evidence 必须脱敏；ignored local config 不得提交。
- 业务代码单文件超过约 2000 行时必须拆分或登记拆分任务。
- 已完成 TODO 需要打勾，并补充日期、evidence refs、验证命令和最终状态。

## 模块化设计原则

- 公共函数只有四个：`module.describe`、`module.query`、`module.read`、`module.invoke`。
- `describe/query/read` 必须只读；只有 `invoke` 可以有副作用。未声明 module function、intent、facet 或 ref prefix 必须 fail closed。
- `list/search` 收敛为 `query`，`stat` 收敛为 `read({ includeMeta: true })`，`watch/subscribe/present/ask_user/apply_batch` 收敛为具体 `invoke` intent。
- Agent Host 负责编排 semantic pipeline；模块不得直接 import 或调用其它模块；GUI 可以展示 pipeline trace，但不决定 pipeline。
- trace-first 是默认要求：跨模块组合必须记录 step id、moduleId、function、intent/query/ref、input/result summary、refs、approval、operation、timing、status 和 parent/child relation。

## 体验对齐原则

- 用户体验尽可能与 Cursor Agent desktop app 的稳定信息架构对齐；对照记录只保留通用行为，不固化一次性坐标、URL、截图或历史 run。
- 左侧栏只管理 workspace/project/thread 的可视化投影、选择、排序、归档、置顶、草稿和上下文入口；真实任务启动、工具选择、repair、sub agent 创建和 workspace 写入仍由 Agent Host 执行并产生 trace。
- 聊天中间栏只展示用户消息、assistant 进度句、`Worked for ...` / `Explored ...` 聚合项、动作行和最终回答；旧 SciForge summary、重复 transcript、不可交互过程块和占位 progress 应删除。
- 右侧结果栏必须按对象渲染：Browser 展示真实可交互网页或明确 blocked/error；Screen 展示 Computer Use virtual screen/replay frames；Terminal 展示 Cursor-like terminal session；Files 展示 workspace file viewer/editor；References 展示对象 refs 和 provenance。
- 点击对象引用必须打开或聚焦右侧对象；把引用插回输入框只能通过显式引用/上下文菜单完成。

## 当前任务板

- 右侧结果栏任务板已迁移到 [`PROJECT_right.md`](PROJECT_right.md)。
- Computer Use 详细任务板维护在 [`PROJECT_CU.md`](PROJECT_CU.md)。

### P1：左侧栏和聊天体验继续收敛

- [x] 继续按 Cursor Agent 检查 Automations、Customize、Search、Repositories 菜单、归档/删除/恢复、跨项目切换和新对话保留。
  完成：2026-05-31；evidence：Computer Use 只读观察 Cursor Agents 左侧栏：New Agent、Automations、Customize、Repositories/Open Workspace、项目分组、thread Pin/Archive、draft Discard、See more；SciForge sidebar search 将 Automations/Customize/Repositories 映射为 local-presentation actions，不生成 `commandText`，Repositories 只展开/聚焦仓库区；archive settings 覆盖 restore/delete，retained new-chat history 不进入 archived settings，跨项目 project groups 保留各 workspace 线程。验证：`node --import tsx --test src/ui/src/app/appShell/SettingsArchivedChatsPanel.test.tsx src/ui/src/app/appShell/ShellPanels.sidebarModel.test.ts src/ui/src/app/appShell/SidebarProjectChatSection.test.tsx src/ui/src/app/appShell/sidebarProjectSessions.test.ts src/ui/src/app/appShell/sidebarCursorAgentModel.test.ts`；状态：passed。
- [x] 继续检查 running delta、完成态折叠、`Worked for ...` / `Explored ...`、动作行、命令输出、diff、文件预览、approval、sub agent 和错误/取消状态。
  完成：2026-05-31；evidence：Cursor 只读对照确认中间栏使用 `Worked for ...` / `Thought ...` 折叠过程；SciForge `RunExecutionProcess` 覆盖 running terminal deltas、完成态 folding、动作行、命令输出、diff/file preview、approval/sub-agent 以及 failed/cancelled terminal targets；右侧 file/object focus 不隐式插入 composer。验证：`node --import tsx --test src/ui/src/app/chat/RunExecutionProcess.test.ts src/ui/src/app/sciforgeApp/SciForgeWorkbench.test.ts src/ui/src/app/ResultsRenderer.test.ts`；状态：passed。


## 验证规则

- 纯文档改动：运行 `git diff --check`。
- Shared contract / TypeScript policy 改动：运行 focused Node tests 和 `npm run typecheck --silent`。
- Runtime adapter 改动：运行 adapter normalization tests、runtime event tests 和 `git diff --check`。
- GUI module / result pane 改动：运行 GUI protocol/controller tests、runtime events client tests、pane focused tests、Browser visual check，并确认 GUI 没有执行 Computer Use action。
- Browser pane 改动：覆盖 embeddable URL、X-Frame-Options/CSP blocked URL、network failure、loading、open-external 和 DOM/AX observation refs。
- Screen pane / Computer Use 改动：运行 package-local Python suite、package bridge focused tests、presentation focused tests 和 refs-first validator。
- Terminal pane 改动：覆盖 running/completed/error/stopped terminal session、pty transcript refs、copy/download/focus/resize 和非 terminal object rejection。

## 本地模型配置

- 本地调试可以使用 ignored config，例如 `config.local.json`、`config.computer-use.local.json`。
- 这些文件可能包含 provider URLs、API keys、model names，绝不能提交或打印。
- Runtime Codex / Computer Use 服务环境必须通过 ignored config 或环境变量提供密钥；文档、日志和 repair action 只能引用变量名，不能打印 secret 值。
- 默认 provider/model 应可见、可审计，不得静默 fallback 到 OpenAI。

## 暂缓集成

- 将 Claude Code 作为默认 backend。
- 默认 release gate 中运行长耗时 live Computer Use / browser / Claude real-process tests。
- GUI workbench 拖拽式 pipeline 编排。当前 pipeline 编排归 Agent Host，GUI 只做展示和确认。
- 删除 `capability_discovery.*` 或 `gui.*` alias。必须等 `module.*` 主路径稳定后再做；删除前 alias 只能停留在 adapter shim，不能再扩展新能力。

## 必读文档

- [`docs/README.md`](docs/README.md)：当前文档入口。
- [`docs/Architecture.md`](docs/Architecture.md)：总架构、Agent Host Semantic Pipeline、GUI-as-extension 和模块归属。
- [`docs/TuiGuiProtocol.md`](docs/TuiGuiProtocol.md)：GUI 输入、只读投影、`gui.*` alias 和执行边界。
- [`docs/NativeExtensionOwnershipMap.md`](docs/NativeExtensionOwnershipMap.md)：provider route、verifier、repair、Computer Use 和 connector 能力归属。
- [`docs/BrowserRuntimeArchitecture.md`](docs/BrowserRuntimeArchitecture.md)：browser runtime 作为 TUI capability + GUI presentation surface 的边界。
- [`PROJECT_CU.md`](PROJECT_CU.md)：Computer Use multi-screen actor-cursor 协议和任务板。

## Worktree 规则

- 开发默认在 `dev` 分支；长期分支尽量只保留 `main` 和 `dev`。
- `config.local.json`、`config.computer-use.local.json`、`.sciforge/**`、package caches、runtime homes 等本地状态不得进入 Git。
- 不使用 `git reset --hard` 或 `git checkout --` 擦除用户改动。
- 只清理明确的 generated caches、temporary workspaces 和 build outputs。
