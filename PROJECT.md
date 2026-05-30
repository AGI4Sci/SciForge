# SciForge 项目协议

最后更新：2026-05-30

当前目标：把 SciForge 从 GUI-as-extension 进一步收敛为 **Agent Host Semantic Pipeline**，并让 web 端聊天的信息展示、实时交互、过程折叠和动作明细体验与 Cursor Agent desktop app 对齐。Codex app-server 是产品 runtime 必需的原生 backend 和 rich-client 主路径；`codex exec --json` 不再作为产品 runtime fallback，只能在 legacy adapter、fixture、smoke/test 或历史 evidence 中出现；Claude Code stream-json 是可选 backend。所有暴露给 Agent Host 的边界模块统一通过 `module.describe/query/read/invoke` 进入，复杂能力由 Agent Host 组合成 typed semantic pipeline，GUI 只是一个特殊模块。

旧任务历史已在 Git 历史中保留；本文件只记录当前阶段原则、任务板、TODO 和验收规则。

## 当前范围

- 主要工作范围是模块边界 contract、runtime adapter、GUI module surface、Codex app-server 必需接入、Claude stream-json 兼容、pipeline trace、skills/memory/capability discovery 的模块化迁移。
- SciForge 不维护第二套 AgentServer。Agent Host 拥有推理、规划、工具选择、重试、取消、repair、memory/skill/capability ranking 和 pipeline 编排。
- GUI 继续只负责 presentation、confirmation、focus、hot-region projection、read-only GUI resources 和 terminal-equivalent text。GUI 不做 provider route、completion 判断、capability ranking 或隐藏 prompt assembly。
- web 聊天体验必须以 Cursor Agent desktop app 为交互基线：回答内容可以不同，但过程信息的实时呈现、折叠层级、动作行、命令/编辑/diff 明细、文件预览、运行态和完成态行为必须一致。
- 对齐聊天体验时，Codex 应主动同时使用 SciForge web 与 Cursor Agent desktop app 做双端对照：用 Browser 检查 SciForge 的真实页面，用 Computer Use 观察 Cursor Agent 的项目/对话管理、过程流、折叠和详情面板；对照结果只能沉淀为通用交互规则和验收 evidence，不能复制成针对某个截图、文件名或历史会话的硬编码。
- Cursor Agent 对齐范围同时包含左侧栏和右侧主内容：左侧栏的新项目、新对话、项目分组、置顶/归档/草稿/丢弃、当前分支/环境、上下文入口和搜索机制；右侧聊天的信息流、过程聚合、动作行、文件预览、diff、命令输出、sub agent transcript 和结果呈现机制。
- Computer Use、browser、connectors、verifiers、skills、memory、capabilities 和 artifacts 都应作为 Agent Host 可组合模块暴露；模块只执行单步能力，不直接调用下游模块。
- 迁移期可以保留 `gui.*`、`capability_discovery.*`、旧 runtime event 和 `AgentCliAdapter` alias，但它们只能存在于 adapter shim、fixture 或 legacy normalizer 层；新增设计必须以 `module.*` 为 canonical public surface。

## 不可变规则

- 所有修改必须通用，不能为当前案例写硬编码补丁。
- 代码路径保持唯一真相源：发现冗余链路时删除或合并旧链路，避免长期并行实现。
- 旧逻辑和最终方案不一致时，删除旧逻辑，不做长期兼容。
- 产品 runtime backend 必须优先并要求 Codex app-server；`codex exec --json`、exec-MCP 或 CLI bridge 只能作为 legacy/test-only 诊断、fixture 或历史兼容记录，不能重新写成运行时 fallback 方向。
- 业务代码单文件超过约 2000 行时必须拆分或登记拆分任务；测试代码、副产物不需要受这个限制。
- 已完成的 TODO 需要打勾，并补充 evidence、日期和最终状态。
- 涉及 provider URL、API key、model name、Authorization、token、secret、password、credential 的日志和 evidence 必须脱敏；ignored local config 不得提交。
- Codex CLI 拓展的核心算法部分优先用 Python 写，方便人类查看、修改。
- 纯 helper、validator、React component 和 package-private adapter 不需要直接实现 `module.*`；只有暴露给 Agent Host 的边界模块需要。

## 模块化设计原则

- 公共函数只有四个：`module.describe`、`module.query`、`module.read`、`module.invoke`。
- `module.describe` 是边界模块唯一硬必备能力。模块如果不支持 `query/read/invoke`，必须在 `describe` 中声明不支持。
- `describe/query/read` 必须只读；只有 `invoke` 可以有副作用。
- `list/search` 收敛为 `query`，`stat` 收敛为 `read({ includeMeta: true })`，`watch/subscribe/present/ask_user/apply_batch` 收敛为具体 `invoke` intent。
- `events`、`refs`、`approval`、`subscription` 和 `batch` 是按需 facet，不是每个模块必备；所有支持的 facet 必须能从 `describe` 查询到。
- 小结果可以 inline；大 payload、敏感内容、可复用对象和审计材料必须使用 ref。
- Agent Host 负责编排 semantic pipeline；模块不得直接 import 或调用其它模块；GUI 可以展示 pipeline trace，但不决定 pipeline。
- 默认是 trace-first：隐式组合可以存在，但必须记录结构化 pipeline trace；高风险、长任务、跨外部系统或多副作用流程必须先产出显式 pipeline plan。

## 体验对齐工作原则

- 默认采用双端对照循环：SciForge web 作为实现目标，Cursor Agent desktop app 作为体验基线；Codex 在做聊天、侧栏、过程流、文件预览、diff、命令输出或 sub agent 展示相关改动时，应主动打开两端并记录当前 evidence。
- 双端对照不得改变架构边界。SciForge 左侧栏按钮、菜单、拖拽、搜索、新项目和新对话创建如果会影响 agent/session/workspace 状态，必须生成终端等价文本或进入 Agent Host 可审计 pipeline；只读状态通过 `module.query/read({ moduleId: 'gui' })` 暴露；GUI-local 展示、焦点、确认和布局协商通过 `module.invoke({ moduleId: 'gui', intent })`。
- 左侧栏不是第二套 agent host。它只管理 workspace/project/thread 的可视化投影、选择、排序、归档、置顶、草稿和上下文入口；真实任务启动、provider route、工具选择、repair、GitHub sync、sub agent 创建和 workspace 写入仍由 Agent Host 执行并产生 trace。
- 右侧主内容不是日志 dump。它必须把 backend 原生 stream 映射为 Cursor Agent-like 的可交互信息层：顶层 answer + worked/explored 聚合；展开后是 read/search/run/edit/thought/approval/subagent 动作行；继续展开才显示命令、输出、diff、文件预览、transcript/ref。
- 对齐可以使用 Cursor 的行为作为 UX oracle，但不要求回答文本、模型策略或内部实现一致。验收以用户可见交互、折叠状态、实时状态变化、可点击对象和 refs-first 明细为准。

## 当前任务板：Agent Host Semantic Pipeline

### Contract / Dispatcher

- [x] 定义 shared `module.*` contract。
  验收：`packages/contracts/runtime` 或等价 shared contract 暴露 `ModuleDescription`、`ModuleQueryRequest/Result`、`ModuleReadRequest/Result`、`ModuleInvokeRequest/Result`、facet metadata、operation ref、approval request 和 pipeline trace 类型；不依赖 `src/runtime` 或 `src/ui` 私有实现。
  证据（2026-05-29）：新增 `packages/contracts/runtime/modules.ts` / `.test.ts`，导出 `ModuleDescription`、`ModuleQueryRequest/Result`、`ModuleReadRequest/Result`、`ModuleInvokeRequest/Result`、`ModuleResultEnvelope`、`ModulePipelineTraceStep`、facet/function/intent helpers，并接入 `@sciforge-ui/runtime-contract` exports；trace step 增补 input/result summary、timing 和 approval 字段。验证：`node --import tsx --test packages/contracts/runtime/modules.test.ts` passed；`npm run typecheck --silent` passed。

- [x] 实现 runtime module dispatcher。
  验收：Host adapter 可以通过一个 dispatcher 调用 `module.describe/query/read/invoke`；dispatcher 支持按 `moduleId` 路由到 GUI、skills、memory、capabilities、browser、verifier、actions、artifacts；未声明能力 fail closed。
  证据（2026-05-29）：新增 `src/runtime/modules/dispatcher.ts` / `.test.ts`，默认 registry 覆盖 `gui`、`skills`、`memory`、`capabilities`、`browser`、`verifier`、`actions`、`artifacts`，支持按 `moduleId` 和 ref prefix 路由，unsupported module/function/intent fail closed，trace summary 脱敏并记录 timing/refs/approval。验证：`node --import tsx --test src/runtime/modules/dispatcher.test.ts` passed；focused runtime suite passed；`npm run typecheck --silent` passed。

- [x] 建立 `module.describe` registry。
  验收：所有边界模块可返回 title、summary、resource kinds/ref prefixes、intents、side effect level、approval requirement、operation/event/ref/subscription/batch facets 和 limits。
  证据（2026-05-29）：`createRuntimeModuleRegistry()` 聚合真实 GUI/resource modules 与 browser/verifier/actions/artifacts describe-only 边界；`dispatcher.test.ts` 验证 registry describe 返回全部边界模块，GUI/capabilities intents 和 facet metadata 可查询。验证：`node --import tsx --test src/runtime/modules/dispatcher.test.ts` passed。

### GUI Module

- [x] 将现有 `gui.*` surface 迁移为 GUI module alias。
  验收：`module.query/read/invoke({ moduleId: 'gui' })` 能覆盖现有 GUI resource tree、hot-region、presentation catalog、present、ask_user、notify、set_status、apply_batch；旧 `gui.*` tool 继续作为 alias，通过同一实现路径转发。
  证据（2026-05-29）：新增 `src/runtime/modules/gui-module-handler.ts` / `.test.ts`，复用 `GuiProtocolController` 作为唯一真相源；`src/runtime/codex/gui-mcp-tools.ts` 的 11 个 `gui.*` alias 改为通过 GUI module handler 转发；Codex normalizer 支持 completed `module.invoke({ moduleId: 'gui', intent: 'present'|'ask_user' })` 与旧 `gui.present/gui.ask_user` 进入同一 visible event 路径。验证：`node --import tsx --test src/runtime/modules/gui-module-handler.test.ts src/runtime/codex/gui-mcp-tools.test.ts src/runtime/codex/codex-event-normalizer.test.ts` passed。

- [x] GUI module 保持 presentation-only。
  验收：GUI module 不做 capability ranking、provider route、workspace execution、completion/verdict/confidence 判断；所有副作用 intent 只限 GUI-local presentation transaction，并带 revision/precondition。
  证据（2026-05-29）：GUI module description 只声明 GUI resource/hot-region 和 `present/ask_user/notify/set_status/apply_batch/watch`，所有副作用均为 `local` 或 `none`；handler 只包装 `GuiProtocolController` 的 resource tree、presentation catalog、precondition 和 intent log，不读取 provider/capability ranking，也不执行 workspace action。验证：`node --import tsx --test src/runtime/modules/gui-module-handler.test.ts` passed。

### Backend Adapters

- [x] 新增 `CodexAppServerAdapter` 作为产品 runtime 必需 backend。
  验收：adapter 支持 thread/start、turn/start、turn/steer 或等价文本输入；消费 thread/turn/item/delta/tool/approval 事件；把 Codex dynamic tools 或 MCP tools 映射到 `module.*`；web 对话能实时显示 assistant delta、tool lifecycle、approval request 和 done。产品 runtime 方向必须以 Codex app-server 为 required rich-client backend，不允许把 exec 路径恢复为 fallback。
  证据（2026-05-29）：新增 `src/runtime/codex/codex-app-server-adapter.ts` 与 backend-neutral adapter tests，支持 injectable app-server client、thread/turn start、turn steer、cancel，并把 app-server thread/turn/delta/tool/approval/done fixtures 通过 `backend-event-normalization.ts` 归一为 `NormalizedAgentEvent` + `ModulePipelineTraceStep`；approval request 映射为 GUI-visible confirmation event。验证：`node --import tsx --test src/runtime/codex/backend-event-normalization.test.ts src/runtime/codex/backend-adapters.test.ts` passed。

- [x] 限制 `CodexExecJsonAdapter` 为 legacy/test-only 兼容。
  验收：现有 `codex exec --json` 只能作为 legacy adapter、fixture、smoke/test 或历史 evidence 运行；文档、配置、UI 文案和 runtime direction 都不得把它描述为 rich-client 主路径或产品 fallback；事件归一化继续输出同一 pipeline trace，方便测试旧事件形状。
  证据（2026-05-29）：保留现有 `CodexExecJsonAdapter`；新增 backend-neutral normalizer 将 `sciforge.codex.normalized-event.v1` 事件作为 `codex-exec-json` backend passthrough，并为 tool lifecycle 产出 module trace。方向更新（2026-05-30）：产品 runtime 入口改为 Codex app-server required；exec JSON 仅 legacy/test-only。验证：`node --import tsx --test src/runtime/codex/backend-event-normalization.test.ts src/runtime/codex/codex-event-normalizer.test.ts` passed。

- [x] 新增 `ClaudeStreamJsonAdapter`。
  验收：使用 `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages`；stdout NDJSON 映射为同一内部事件；`control_request/control_response` 映射为 approval/input；`module.*` 通过 SciForge MCP server 暴露。
  证据（2026-05-29）：新增 `src/runtime/codex/claude-stream-json-adapter.ts`，以 fixture-friendly spawn 启动 `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages`，stdin 写入 user message，stdout NDJSON 经 backend-neutral normalizer 映射为 message/tool/approval/done，`control_request/control_response` 映射到 approval trace。验证：`node --import tsx --test src/runtime/codex/backend-event-normalization.test.ts src/runtime/codex/backend-adapters.test.ts` passed。

### Pipeline Trace / UI

- [x] 引入统一 pipeline trace。
  验收：每次跨模块组合记录 step id、moduleId、function、intent/query/ref、input summary、result summary、refs、approval、operation、timing、status、parent/child relation；trace 必须脱敏并可折叠展示。
  证据（2026-05-29）：`ModulePipelineTraceStep` 增补 input/result summary、timing、approval；runtime dispatcher 对 `describe/query/read/invoke` 生成脱敏 trace；backend-neutral normalizer 对 Codex app-server、legacy/test-only Codex JSONL、Claude stream-json tool/approval lifecycle 生成同一 trace step，并脱敏 provider URL、secret、model/provider 字段。验证：`node --import tsx --test src/runtime/modules/dispatcher.test.ts src/runtime/codex/backend-event-normalization.test.ts` passed。

- [x] 抽出 backend presentation profile。
  验收：Codex app-server、legacy/test-only Codex JSONL、Claude stream-json 的 event shape 都先归一化为内部事件，再由 `codex-cli-like`、`claude-code-like`、`sciforge-default` profile 决定折叠、展开和标签；UI 不直接硬编码 backend raw event。
  证据（2026-05-29）：`src/ui/src/streamEventPresentation.ts` 新增 `BackendPresentationProfileId` 与 profile policy，默认保持 `sciforge-default`，可从 backend-neutral `raw.backend` 推导 `codex-cli-like` / `claude-code-like`；测试证明 presentation profile 与 runtime `profile` 元数据分离。验证：`node --import tsx --test src/ui/src/streamEventPresentation.test.ts` passed。

- [x] 修复 web 对话实时性。
  验收：assistant partial/delta、tool start/completion、approval request、operation progress 在 100-300ms 内进入 GUI reducer；final result 只负责收尾，不负责首次展示。
  证据（2026-05-29）：`packages/contracts/runtime/events.ts` 将 backend-neutral `message_delta/assistant_delta`、`tool_started/tool_completed`、`approval_requested` 和 `operation_progress` 映射到 GUI reducer 使用的 `text-delta`、`tool-call`、`tool-result`、`human-approval-required`、`process-progress` contract types；`src/ui/src/api/sciforgeToolsClient/runtimeEvents.ts` 在 SSE/WS 读取阶段即时 normalize，`assistantDraftFromStreamEvents` 可在 `done` 前拿到 partial text，final result 只聚合/收尾。backend normalizer 新增 operation progress 事件。验证：`node --import tsx --test packages/contracts/runtime/events.test.ts src/ui/src/api/sciforgeToolsClient/runtimeEvents.test.ts src/runtime/codex/backend-event-normalization.test.ts src/runtime/codex/backend-adapters.test.ts` passed。

- [x] 对齐 Cursor Agent desktop app 的聊天过程体验。
  验收：新增或收敛为 `cursor-agent-like` presentation profile；SciForge web 对话在运行时和完成后与 Cursor Agent desktop app 的信息架构一致。顶层只显示用户消息、assistant 进度句、可折叠的 `Worked for ...` / `Explored ...` 聚合项和最终回答；运行中的 shell、文件编辑、读取、搜索、思考、approval、sub agent spawn/complete 必须即时更新；完成后的过程默认折叠；用户展开聚合项后看到动作行，展开单个动作后看到命令、stdout/stderr 摘要、文件 diff、文件预览或 sub agent transcript。回答内容不要求一致，但折叠层级、可点击行为、状态文案、动作摘要和明细承载位置必须一致。旧的 SciForge summary、占位 progress、重复 transcript 或不可交互过程块必须删除。
  观察基线（2026-05-30，Computer Use 观察 Cursor Agents）：完成态普通读文件任务显示 assistant 进度句 + `Explored 3 files` 聚合项；展开后出现 `Read README.md L1-263` 等动作行，点击动作打开右侧文件预览。开发任务显示 `Worked for 22s/35s` 聚合项；展开后有 `Explored 3 searches, ran 8 commands`、`Ran ...`、`Thought for 1s`、`Edited data.ts +1 -1` 等动作行；点击 shell 动作在原位展开命令和输出摘要；点击 edit diff 在原位展开红绿 diff。此观察只作为交互基线，不允许写成针对具体截图或具体文件名的硬编码。
  证据（2026-05-30，最终状态：完成）：新增 `cursor-agent-like` backend presentation profile，并由 `src/ui/src/app/chat/cursorAgentProcess.ts` 将 backend-native stream 映射为 `Worked for ...` / `Explored ...` presentation groups、read/search/shell/edit/diff/thought/approval/subagent 动作行和 refs-first 明细；`RunningWorkProcess` / `RunExecutionProcess` 删除旧 SciForge summary fallback、空 audit fold、wait-only 占位块、assistant transcript 重复行和重复 transcript ref，命令、输出、diff、cwd、file path、provider/model/secret/local path 均在展示层脱敏，文件预览只接受相对 workspace/artifact 可信 ref。Browser 证据 ref：`docs/agent-desktop-alignment-evidence/sciforge-browser-alignment-2026-05-30.png`；Computer Use 证据 ref：`docs/agent-desktop-alignment-evidence/evidence-2026-05-30.json` 中的 Cursor Agents 只读观察条目。验证：`node --import tsx --test src/ui/src/streamEventPresentation.test.ts src/ui/src/app/chat/RunExecutionProcess.test.ts src/ui/src/app/appShell/sidebarCursorAgentModel.test.ts` passed；`npm run typecheck --silent` passed。

- [x] 对齐 Cursor Agent desktop app 的左侧栏项目/对话管理。
  验收：SciForge 左侧栏具备与 Cursor Agent 一致的信息架构和交互语义：workspace/project 分组、当前项目高亮、新项目入口、新对话入口、项目内线程列表、草稿、置顶、归档、丢弃、搜索、更多菜单、当前分支/本地环境/context 状态和跨项目切换。所有会触发 agent turn、workspace 写入、GitHub、repair、sub agent 或外部副作用的动作必须转换为终端等价文本并由 Agent Host 处理；GUI 只能维护 presentation/session selection 和只读投影。左侧栏状态必须能通过 `gui:/shell.json`、`gui:/regions/sidebar/*` 或等价 `module.query/read` 资源被 TUI 按需读取。
  证据（2026-05-30，最终状态：完成）：新增 `src/ui/src/app/appShell/sidebarCursorAgentModel.ts`，定义 Cursor Agent-like workspace/project/thread/draft/pinned/archived/discarded 投影、active branch/local environment/context 状态、新项目/新对话/search/archive/discard/pin/restore 的 terminal-equivalent commandText，以及 selection/sort 等 GUI-local presentation actions；`ShellPanels` 将真实左侧栏 project/thread groups 转换为同一 projection 并挂载 `data-gui-region-id/ref/summary`；`GuiProtocolController` 通过 `gui:/regions/sidebar/summary.md`、`refs.json`、`actions.json`、`viewport.json` 和 `/gui/shell.json` 暴露左侧栏只读资源，默认占位 sidebar 不发布虚构可变命令。所有 sidebar resource refs 和 commandText 使用稳定公开 ref，不发布本地绝对路径。Browser/Computer Use 证据 ref：`docs/agent-desktop-alignment-evidence/evidence-2026-05-30.json`。验证：`node --import tsx --test src/ui/src/app/appShell/sidebarCursorAgentModel.test.ts src/ui/src/app/appShell/ShellPanels.sidebarModel.test.ts src/ui/src/app/guiProtocol.test.ts src/runtime/codex/gui-extension-manifest.test.ts` passed；`npm run typecheck --silent` passed。

- [x] 建立 SciForge + Cursor Agent 双端对照验收机制。
  验收：chat/sidebar/presentation 相关 PR 或 repair run 的验收记录必须同时包含 SciForge browser evidence 和 Cursor Agent Computer Use evidence；至少覆盖左侧栏新项目/新对话管理、完成态折叠、运行态实时更新、命令展开、编辑 diff 展开、文件预览、sub agent 展开和右侧结果呈现。对照 evidence 必须脱敏、refs-first，不得包含 provider secret、API key、完整私密对话或无关桌面信息。
  证据（2026-05-30，最终状态：完成）：新增 `src/ui/src/app/agentDesktopAlignmentEvidence.ts`，以 `sciforge.agent-desktop-alignment-evidence.v1` schema 要求每个验收项同时具备 `sciforge-browser` 与 `cursor-agent-computer-use` refs，并拒绝 provider URL、API key、Authorization、token、secret、password、credential、model name、local path、完整私密对话、inline raw transcript、HTML、screenshot/base64 payload。已物化脱敏 evidence record：`docs/agent-desktop-alignment-evidence/evidence-2026-05-30.json`；Browser artifact：`docs/agent-desktop-alignment-evidence/sciforge-browser-alignment-2026-05-30.png`。验证：`node --import tsx --test src/ui/src/app/agentDesktopAlignmentEvidence.test.ts` passed。

### Live 双端对照复核（重新打开）

复核说明（2026-05-30）：上面标为完成的聊天、侧栏和双端 evidence 记录只能证明 fixture/schema/focused tests 与一次局部观察已经落地；它们不能替代当前真实 SciForge web 与 Cursor Agent desktop app 的连续双端对照。以下任务优先级高于上述完成记录；全部完成前，不得再次声明左侧创建新项目/新对话、对话体验和右侧数据展示已经 live parity completed。

- [ ] 建立持续 live evidence ledger。
  验收：这是一个多轮循环任务，不是一轮观察后即可关闭。每一轮对照必须同时包含 SciForge Browser evidence 与 Cursor Agent Computer Use evidence；记录轮次、时间、观察入口、覆盖区域、差异、修正决定、复测结果和脱敏检查。ledger 只保存 refs、结构化摘要和截图/DOM/可访问性树引用，不保存 provider secret、API key、完整私密对话、本地绝对路径或无关桌面内容。
  进展（2026-05-30，状态：未关闭）：新增并持续更新 canonical refs-first ledger `docs/agent-desktop-alignment-evidence/live-ledger-2026-05-30.json`，schema 为 `sciforge.agent-desktop-alignment-live-ledger.v1`，支持多轮 live ledger、固定复核顺序、按 requirement 检查每轮双端 refs、redaction check、verification refs 和 open difference 追踪；已移除早期分裂的 nested ledger，避免 Round 01 重复记录。当前 ledger 已登记正式双端 Round 01/02/03/04/05/06/09/10/11/12/13/14/15；Round 07 只作为 open difference 内的 exec-MCP legacy/test-only evidence refs，不是产品 runtime fallback 或独立 supplemental ledger round。Round 09 用 arXiv Agentic RL prompt 对照 Cursor 既有会话和新建会话，并在 SciForge Browser 中复测同类长研究任务，关闭 transport lifecycle / traceback raw dump 对话与右侧呈现差异；Round 10 在 SciForge Browser 中通过 Codex app-server product path 实测 `multi_agent_v1.spawn_agent`、sub-agent lifecycle、transcript/result refs、右侧 sub-agent preview 和同线程 resume，且没有走 exec/shell fallback；Round 11/12 复测确认 post-cleanup 后 SciForge 仍保留 worker-id sub-agent 行、隐藏 prompt echo/raw JSON、去除 recorded replay 头部文案、sub-agent refs 先于 summary/details、右侧安全 preview 可用，并把 Cursor-like sidebar 状态、真实 DOM 行级 archive/discard/restore、产品 runtime 文案和过程流细节补齐；Round 13 用复杂同 prompt 和用户提供的 Cursor 展开态截图继续校准“同一张纸/画布”观感；Round 14 按 Cursor 文件查看基线把默认左侧文件树移出聊天侧栏，并把点击/读取文件后的目录树+可编辑文件内容收敛为 `packages/presentation/components/workspace-file-viewer` 展示组件，由 `ResultsRenderer` 装配 workspace list/read/write；Round 15 按用户要求重新发起同类只读 `PROJECT.md` 对话，Browser 复测 SciForge 完成态 `Explored 1 file` 展开后点击 `Read PROJECT.md` 会打开右侧目录树+可编辑内容区，并登记当前轮 Cursor Computer Use helper `procNotFound` 阻塞，所以该轮是 `retest-needed` 而非最终完成。`validation.ok=true`，但 ledger 仍是 `active`：唯一 open difference 仍是 sub-agent live parity，因为 Cursor Agent 同 prompt 仍报告 `NO_SUBAGENT_TOOL_AVAILABLE`，没有 positive sub-agent transcript/result baseline；必须补到 Cursor positive baseline 或形成明确 product-scope 决策后，才能宣称最终 live parity 完成。
  Round 01 记录（2026-05-30，状态：observed）：SciForge Browser refs 覆盖初始 app shell 与 post-fix bounded writer diagnostic，Cursor Agent Computer Use refs 覆盖初始 sidebar/completed aggregate/right preview 脱敏摘要；`round-01-sidebar-writer-html-response` 已关闭，`round-01-uncovered-interactive-chat-and-right-pane-actions` 已由 Round 04/05 复测关闭，剩余 sub-agent 差异转由 Round 03 的窄化 open item 跟踪。
  Round 02 记录（2026-05-30，状态：passed）：启动真实 Workspace Writer 并将 SciForge UI 配置到健康 writer URL 后，用 Browser 实测左侧栏 `New Agent`、`Search`、`REPOSITORIES`、项目状态、新聊天和搜索；用 Cursor Agent Computer Use 对照 `New Agent ⌘N`、Repositories、repo 内 New Agent、Pin/Archive/Discard、Local/Context。`round-02-sciforge-live-writer-not-running` 已关闭。
  Round 03 记录（2026-05-30，状态：retest-needed）：Browser 真实发送只读 SciForge 对话，覆盖 running、failed recovery、`Worked`/`Explored`、read action 和右侧恢复状态；Computer Use 展开 Cursor Agent `Worked for 9s`、`Explored 3 files`、`Read ... Lx-y` 并点击 Read action 打开右侧文件 preview。已用通用修正关闭 runtime metadata/recovery copy 暴露、read action 把 prompt 当 target、SciForge trusted preview ref 缺失；Round 04 补采 Cursor running-state evidence 后，Round 03 的 validator 缺口已关闭。
  Round 04 记录（2026-05-30，状态：retest-needed）：用户修复 base URL 后，Browser 真实发送 SciForge 成功对话，观察到运行中 `Working`、完成态 `Worked`/`Explored`、workspace-relative `Read` action、`Preview file` 和右侧 Markdown preview；另一个 diff 请求出现 `Diff` action 和可展开 detail，但只登记为 partial diff evidence。Computer Use 对照 Cursor Agent 的 running rows、shell command expansion、完成态 Worked aggregates、右侧 Source Control / file preview baseline。补充修正：内部 `stdout/stderr/diff/transcript` audit refs 不再持久化或出现在 replay DOM，`pwd` / `ls src` 等非文件命令 target 不再合成 preview，右侧预览 hydration 只接受安全 workspace path；过程树和结果栏做了轻量 Cursor-like UI polish。验证：`node --import tsx --test src/runtime/codex/codex-event-normalizer.test.ts src/ui/src/app/chat/RunExecutionProcess.test.ts src/ui/src/streamEventPresentation.test.ts src/ui/src/app/results/WorkspaceObjectPreview.test.ts` passed；`node --import tsx --test src/ui/src/app/agentDesktopAlignmentEvidence.test.ts` passed；`npm run typecheck --silent` passed；`git diff --check` passed。Round 05 后完整 diff-detail 展开已补齐，仍 open：sub agent transcript/ref 双端 live evidence。
  Round 05 记录（2026-05-30，状态：passed）：base URL 恢复后，Browser 再次真实发送只读 shell diff 请求并展开历史 pre-cleanup 完成态 diff action，确认命令、exit 1、workspace-relative file ref 和 unified diff hunk markers 都在可展开 detail 中显示；Computer Use 同轮读取 Cursor Agent 当前可见侧栏、完成态 `Worked` aggregates 和右侧 Source Control / changed-file baseline。补充修正：backend-native diff payload 通过 Codex normalizer、backend-neutral adapter、WebSocket realtime stream ordering 和 `cursorAgentProcess` action rendering 保留为结构化 diff detail，避免 close race 丢失相邻 tool lifecycle 事件。验证：`node --import tsx --test src/runtime/codex/codex-event-normalizer.test.ts src/runtime/codex/backend-event-normalization.test.ts src/runtime/codex/backend-adapters.test.ts src/ui/src/api/sciforgeToolsClient/codexRealtimeSession.test.ts src/ui/src/api/sciforgeToolsClient/runtimeEvents.test.ts src/ui/src/app/chat/RunExecutionProcess.test.ts` passed；`npm run typecheck --silent` passed；`git diff --check` passed。仍 open：sub agent transcript/ref 双端 live evidence。
  Round 06 记录（2026-05-30，状态：blocked）：Browser 真实发送只读 sub-agent probe，要求仅在可用时启动一个只读 sub-agent/delegated worker 检查 `PROJECT.md`；SciForge live 返回 `NO_SUBAGENT_TOOL_AVAILABLE`，没有 sub-agent lifecycle row、transcript ref 或 result ref。normalized runtime audit 同时显示 remote plugin sync 需要 ChatGPT auth，当前本地 Runtime Codex 注入的工具面仍只有 GUI MCP 工具；Computer Use 当前 Cursor 可见 session 也未观察到 positive sub-agent baseline。该轮不能用 shell/terminal-equivalent fallback 伪装成真实 sub-agent evidence；下一步必须暴露通用 local sub-agent/delegated-worker MCP tool surface，产生标准 `tool_started`/`tool_completed` lifecycle 和安全 transcript/result refs，再做 live retest。
  Round 07 记录（2026-05-30，状态：legacy/test-only evidence refs）：latest live exec-MCP attempt 只挂在 open difference 的 evidence refs 中作为 legacy/test-only 诊断记录，不是产品 runtime fallback，也不是独立的 canonical ledger round；该 attempt 仍返回 `NO_SUBAGENT_TOOL_AVAILABLE`，没有真实 sub-agent/delegated-worker lifecycle、transcript ref 或 result ref。该结果不改变产品 backend 方向：必须在 Codex app-server required path 上暴露通用 sub-agent/delegated-worker MCP tool surface，再做正式双端 live retest。
  Round 09 记录（2026-05-30，状态：passed）：按用户要求先观察 Cursor Agent 既有 arXiv 对话，再用 exact Chinese prompt 新建 Cursor Agent 对话，并在 SciForge Browser 新建同类 arXiv Agentic RL 长研究对话；Cursor baseline 是用户消息后跟 progress prose、`Worked/Explored` 聚合和可展开 search/fetch/run/edit 动作，最终报告不显示 raw lifecycle。SciForge 复测发现 app-server/rich-client transport copy、Python traceback 和右侧 raw failure summary 可见；已通过通用修正关闭：`cursorAgentProcess` 按首个动作时间排序并保留长任务 early anchors，`runStatusPresentation` 隐藏 transport progress，`finalMessagePresentation` / right-pane Markdown / `results-renderer-execution-model` 折叠 traceback 和 raw diagnostics，`RunningWorkProcess` / `RunExecutionProcess` 用“过程详情/底层诊断已收起”替代工程化 audit 文案。该轮不关闭 sub-agent open difference。
  Round 10 记录（2026-05-30，状态：blocked）：按同一 ASCII prompt 分别新建 SciForge 和 Cursor Agent 对话。SciForge Browser 通过 Codex app-server product path 成功调用 `multi_agent_v1.spawn_agent`，完成态显示 `1 sub agent` 聚合、sub-agent action row、safe transcript/result artifact refs、文件 refs、右侧 sub-agent result preview，并在同线程 follow-up/resume 中再次保留 sub-agent tool；Cursor Agent 同 prompt 只显示 progress/read/MCP rows 并在最终回答中明确 `NO_SUBAGENT_TOOL_AVAILABLE`，没有 positive sub-agent transcript/result refs，也没有用 shell 伪装。该轮证明 SciForge 侧通用 protocol/code 已转正，但最终 parity 仍被 Cursor positive baseline 不可得阻塞。
  Round 11 记录（2026-05-30，状态：blocked）：Browser 对 Round 10 正向 SciForge conversation 做 post-cleanup 复测，确认 sub-agent process 行保留 worker id、`Request summary` / prompt tail / raw JSON 不再出现在过程或右侧 preview，recorded 过程不再显示 `Work replay` / `replay` badge，sub-agent transcript/result/file refs 先于 summary/details，`artifact:subagent-result-*` 可打开右侧安全 sub-agent preview；Computer Use 复查 Cursor Agent 同 prompt conversation，仍显示 `NO_SUBAGENT_TOOL_AVAILABLE`，没有 positive transcript/result baseline。证据 refs：`docs/agent-desktop-alignment-evidence/live-2026-05-30/round-11-sciforge-postcleanup-summary.json`、`docs/agent-desktop-alignment-evidence/live-2026-05-30/round-11-sciforge-postcleanup-subagent-preview.png`、`docs/agent-desktop-alignment-evidence/live-2026-05-30/round-11-cursor-subagent-still-unavailable-summary.json`。验证：`node --import tsx --test src/ui/src/app/chat/RunExecutionProcess.test.ts src/ui/src/app/results/WorkspaceObjectPreview.test.ts src/ui/src/streamEventPresentation.test.ts src/ui/src/api/sciforgeToolsClient/runtimeEvents.test.ts src/runtime/codex/codex-runtime-server.test.ts` passed；`node --import tsx --test src/ui/src/app/agentDesktopAlignmentEvidence.test.ts` passed；`npm run typecheck --silent` passed；`git diff --check` passed。
  Round 12 记录（2026-05-30，状态：blocked）：继续按 Cursor Agent sidebar/process presentation 审计结果做通用硬化：真实 sidebar DOM 改为统一渲染 draft/active/archived/discarded，行级 active/draft 提供 pin/archive/discard，archived/discarded 提供 restore；workspace session 增加向后兼容 `archiveState`，旧 deleted title/reason 只作为 migration fallback；过程流移除 live/replay 可见 chrome，长动作按完整过程计数并插入 folded placeholder，tool-labeled prompt echo 不再进入 action；右侧 sub-agent preview 改为 refs-first 并过滤 trace/audit/.sciforge refs；设置和 feedback 文案改为 Runtime Codex/app-server 方向。Browser 复测确认 SciForge localhost 上 New Agent、统一 DRAFT rows、active discard、sub-agent refs-before-summary、无 prompt echo/raw JSON/replay/backend selector/Codex CLI 文案；Computer Use 复查 Cursor Agent 同 prompt conversation，仍为 `NO_SUBAGENT_TOOL_AVAILABLE`，没有 positive transcript/result baseline。证据 refs：`docs/agent-desktop-alignment-evidence/live-2026-05-30/round-12-sciforge-sidebar-process-summary.json`、`docs/agent-desktop-alignment-evidence/live-2026-05-30/round-12-cursor-subagent-still-unavailable-summary.json`。验证：`node --import tsx --test src/ui/src/app/chat/RunExecutionProcess.test.ts src/ui/src/app/results/WorkspaceObjectPreview.test.ts src/ui/src/streamEventPresentation.test.ts src/ui/src/app/appShell/SidebarProjectChatSection.test.tsx src/ui/src/app/appShell/ShellPanels.sidebarModel.test.ts src/ui/src/app/appShell/sidebarCursorAgentModel.test.ts src/ui/src/workspace/sessionWorkspace.test.ts src/ui/src/app/appShell/ShellPanelsSettingsDialog.test.ts src/ui/src/app/agentDesktopAlignmentEvidence.test.ts` passed；`npm run typecheck --silent` passed；`git diff --check` passed。
  Round 13 记录（2026-05-30，状态：passed）：按用户要求用更复杂的同 prompt 对照 SciForge 与 Cursor Agent 展开态视觉，Cursor 参照为用户提供的同 prompt 截图和 Computer Use 中同会话/文件预览状态。通用修正：active assistant draft 与最终回答继续做 prose normalization；`RunningWorkProcess` 让 thought/result summary 以普通正文流展开，读文件/搜索叶子行不再显示完成态 status/time，`More activity` 是弱提示而非伪可展开控件；命令详情去掉 `Stdout:`/`Stderr:` chrome；action refs 显示人类可读标题而不是 raw `artifact:`/`file:` prefix；`FinalMessageContent` 的 final audit fold 改为 `More activity` 并移除 Detail/Supporting detail 标签，structured result refs 过滤 `.sciforge`/raw/audit 引用；`assistantText` 删除会误伤 `T cell`/`B cells` 的单字母合并规则。证据 refs：`docs/agent-desktop-alignment-evidence/live-2026-05-30/round-13-sciforge-complex-same-prompt-fold-expand-summary.json`、`docs/agent-desktop-alignment-evidence/live-2026-05-30/round-13-sciforge-complex-same-prompt-expanded.png`、`docs/agent-desktop-alignment-evidence/live-2026-05-30/round-13-cursor-complex-same-prompt-fold-expand-summary.json`。验证：focused chat/process/final-message tests passed；wider UI/process/evidence suite passed；`npm run typecheck --silent` passed；`git diff --check` passed；Browser 复测确认无 visible Stdout/Stderr、raw action ref prefix、final audit label、completed leaf timestamp/status chrome。该轮没有新增未关闭差异，最终 live parity 仍等待 Cursor positive sub-agent baseline 或 product-scope 决策。
  Round 14 记录（2026-05-30，状态：passed）：按用户截图和设计文档约束修正文件查看位置：`docs/Architecture.md` / `docs/NativeExtensionOwnershipMap.md` 明确右侧预览是 GUI presentation 能力，因此新增 `packages/presentation/components/workspace-file-viewer`（manifest、README、fixtures、renderer tests）作为目录树+可编辑草稿 UI；`ResultsRenderer` 负责安全读取 focused file ref、列目录、保存草稿和隐藏旧只读 `WorkspaceObjectPreview` 双渲染；`ShellPanels` 默认不再渲染左侧 `Files` project tree，也不再展开时主动 `listWorkspace`。Cursor Computer Use 观察确认 Cursor chat canvas 左侧、右侧为项目树+PROJECT.md editable editor；SciForge Browser 复测确认默认左栏没有 file tree。证据 refs：`docs/agent-desktop-alignment-evidence/live-2026-05-30/round-14-sciforge-file-viewer-summary.json`、`docs/agent-desktop-alignment-evidence/live-2026-05-30/round-14-sciforge-sidebar-no-file-tree.png`、`docs/agent-desktop-alignment-evidence/live-2026-05-30/round-14-cursor-file-tree-editor-summary.json`。验证：`npm --workspace @sciforge-ui/components run packages:check --silent` passed；`node --import tsx --test packages/presentation/components/workspace-file-viewer/render.test.tsx src/ui/src/app/ResultsRenderer.test.ts src/ui/src/app/appShell/ShellPanels.sidebarModel.test.ts` passed；`npm run typecheck --silent` passed。该轮没有新增未关闭差异。
  Round 15 记录（2026-05-30，状态：retest-needed）：按用户要求重新发起同类只读 `PROJECT.md` 对话并点击完成态展开内容。通用修正：`cursorAgentProcess` 为 action/ref 保留 originating `runId`，prompt fallback 文件路径去掉尾随标点；`RunExecutionProcess` / `NativeEventStream` 把 source run id 传入过程模型；`ResultsRenderer` 对来自 cursor-process 的 file ref 按 originating run workspace root 读取，避免历史/空 run 把右侧文件查看重新折叠或读错 workspace。Browser 复测确认 SciForge 右侧出现 `workspace-file-viewer`、目录树、选中的 `PROJECT.md` 和可编辑 textarea；Cursor 新一轮 Computer Use 因 helper `procNotFound` 未能完成，只沿用用户截图和 Round 14 Computer Use baseline 作为参照。证据 refs：`docs/agent-desktop-alignment-evidence/live-2026-05-30/round-15-sciforge-file-viewer-opened-summary.json`、`docs/agent-desktop-alignment-evidence/live-2026-05-30/round-15-sciforge-file-viewer-opened.png`、`docs/agent-desktop-alignment-evidence/live-2026-05-30/round-15-cursor-file-tree-editor-reference-summary.json`。验证：focused chat/results/backend tests passed；`npm --workspace @sciforge-ui/components run packages:check --silent` passed；仍需 Cursor fresh live retest 后才能把该轮改为 passed。

- [ ] 执行反复对照闭环，直到用户体验一致。
  验收：每一轮都按 `观察 SciForge -> 观察 Cursor Agent -> 记录差异 -> 更新 PROJECT.md TODO -> 实现通用修正 -> 验证 -> 再次双端对照` 的顺序推进；如果复测仍有差异，必须继续新增或更新 TODO，不得把任务打勾。只有左侧创建新项目/新对话、对话体验和右侧数据展示在真实双端操作中连续通过，且所有差异都有 evidence 或已关闭，才能进入最终完成态。
  Round 01 执行记录（2026-05-30，状态：partial）：按顺序完成 SciForge Browser 观察、Cursor Agent 只读观察、差异记录、通用修正和 SciForge 复测；发现当前 `http://localhost:5174/` 是 UI dev server 且 Workspace Writer 未在配置 URL 提供 JSON，导致项目树无法完成真实文件交互。通用修正：`workspaceClient` 将 HTML/non-JSON writer response 收敛为 bounded diagnostic，不再暴露 raw parse error、HTML 或本地绝对路径。验证：`node --import tsx --test src/ui/src/api/workspaceClient.preview-cache.test.ts` passed。
  Round 02/03/04/05/06/07/09/10/11/12/13/14/15 执行记录（2026-05-30，状态：blocked）：继续按闭环推进；Round 02 完成健康 writer + 左侧栏实测并关闭 writer 环境差异；Round 03 完成 SciForge 真实只读对话和 Cursor Agent 完成态/read/file-preview 对照，发现并通用修正运行过程自然语言 metadata 脱敏和 read action target；Round 04 在 base URL 修复后完成 SciForge 成功对话复测，补齐 Cursor running-state、命令展开、SciForge trusted preview ref 与右侧 Markdown preview evidence；Round 05 继续用真实 SciForge 对话展开 diff detail，并补齐 Cursor Agent 当前右侧 changed-file baseline；Round 06 证明缺口不是“少一轮 evidence”，而是 Runtime Codex 缺少真实 sub-agent/delegated-worker MCP tool surface；Round 07 exec-MCP legacy/test-only probe 仍显示 `NO_SUBAGENT_TOOL_AVAILABLE`，并且不能恢复 exec runtime fallback 方向；Round 09 完成 arXiv Agentic RL 长任务双端对照，关闭 transport lifecycle / raw traceback / 右侧 failure summary dump 差异；Round 10 完成 Codex app-server required path 的 sub-agent protocol/code 修复和 SciForge live retest，包括 resume dynamic tools、safe artifact refs 和右侧 sub-agent preview，但 Cursor Agent 同 prompt 仍没有 positive baseline；Round 11 追加通用过程/预览清理并用 Browser + Computer Use 复测，SciForge 保持 positive，Cursor 仍是 `NO_SUBAGENT_TOOL_AVAILABLE`；Round 12 继续把 Cursor-like sidebar 状态和过程流细节接到真实 DOM、右侧 preview 和产品文案，并完成双端复查；Round 13 聚焦复杂同 prompt 的最终回答和展开态视觉；Round 14 聚焦文件查看 placement，把默认左侧 project tree 移到 read/file 查看时的右侧 tree+editable editor；Round 15 重新发起只读文件查看对话，修正 file ref 的 run/workspace 归属并在 Browser 复测打开右侧 tree+editable editor，但 Cursor fresh retest 当前被 Computer Use helper 阻塞。最终 live parity 仍等待 Cursor positive sub-agent baseline 或 product-scope 决策。

- [ ] 真实使用 SciForge web 左侧栏并对照 Cursor Agent 左侧栏。
  验收：覆盖新项目入口、新对话入口、项目/线程分组、当前项目高亮、搜索、草稿、置顶、归档、丢弃、当前分支/本地环境/context 状态和跨项目切换。所有会改变 workspace、agent turn、GitHub、repair、sub agent 或外部系统的动作都必须被归类为 terminal-equivalent command 或 Agent Host pipeline；GUI-local 只允许选择、展示、排序、焦点和确认状态。

- [ ] 真实使用 SciForge web 对话流并对照 Cursor Agent 对话体验。
  验收：覆盖用户消息、assistant 实时 delta、运行中状态、完成态折叠、`Worked for ...` / `Explored ...` 聚合、read/search/run/edit/thought/approval/subagent 动作行、命令展开、编辑 diff 展开、文件预览跳转、sub agent transcript/ref 和错误/取消状态。回答文本和模型策略可以不同，信息架构、折叠层级、动作承载位置和可点击行为必须一致。

- [ ] 真实使用 SciForge web 右侧数据展示并对照 Cursor Agent 右侧主内容。
  验收：覆盖文件预览、diff、命令输出、workspace/artifact/data object preview、结果详情、引用跳转、空状态、加载状态、错误状态、长内容裁剪、敏感内容脱敏和 refs-first 展示。右侧主内容不得退化为日志 dump，也不得依赖当前截图、文件名、历史会话或 workspace-specific 硬编码。

- [ ] 形成差异清单并按通用规则关闭。
  验收：每个差异必须标注 category、影响范围、是否需要代码/协议/文档修正、最小通用修正方案、对应测试和复测 evidence。无法立即修正的差异必须登记为独立 TODO，不得用“已观察”“已有 schema”替代完成。
  进展（2026-05-30，状态：未关闭）：`src/ui/src/app/agentDesktopAlignmentEvidence.ts` 新增通用 difference schema，要求每个差异携带 category、surface、requirementIds、impactScope、requires、minimumGenericFix、decision、evidenceRefs、testRefs；open/fixing/retest-needed 差异必须带 `PROJECT.md` TODO ref，closed 差异必须带 retest evidence refs。当前 canonical ledger 的唯一 open difference 是 `diff:round-03-missing-command-diff-subagent-live-coverage`：Round 05 已关闭 expanded diff detail；Round 06/07 证明旧 Runtime Codex/exec-MCP 路径没有真实 sub-agent tool；Round 09 新增并关闭 `diff:round-09-transport-traceback-visible-in-chat-and-support-pane`；Round 10 已把 SciForge Codex app-server product path 修到 positive live evidence，并用 focused guard 明确产品入口不会自动导入或回落 `codex exec --json`；Round 13/14 分别关闭复杂同 prompt 展开态视觉残留和文件查看 placement 差异，没有新增未登记或未关闭差异。剩余 open item 是 Cursor Agent 当前同 prompt 无 positive sub-agent baseline，防止仅凭 SciForge 单侧通过或 exec fallback 诊断宣称最终完成。
  Round 03/04/05/06/07/09/10 差异（2026-05-30）：`diff:round-03-runtime-metadata-visible-in-process` 已通过 `cursorAgentProcess` / projection sanitizer / failed response copy 的通用修正关闭；`diff:round-03-read-action-target-used-prompt` 已通过安全 file-like target 推断关闭；`diff:round-03-sciforge-read-preview-ref-missing` 已通过 runtime structured file preview metadata、stream persistence safety gate 和 Round 04 successful read retest 关闭；`diff:round-01-uncovered-interactive-chat-and-right-pane-actions` 已由 Round 04/05 复测关闭；`diff:round-09-transport-traceback-visible-in-chat-and-support-pane` 已通过 Round 09 通用 presentation 修正和 Browser retest 关闭；`diff:round-03-missing-command-diff-subagent-live-coverage` 已通过 Round 10 在 SciForge 侧观察到真实 sub-agent lifecycle、transcript ref、result ref、右侧 preview 和 resumed-thread tool availability，但 Cursor Agent 同 prompt 仍返回 `NO_SUBAGENT_TOOL_AVAILABLE`，因此最终 sub-agent parity 仍保持 open。

- [ ] 完成最终 live parity 复测并更新完成态证据。
  验收：最终复测需要再次实际打开 SciForge web 和 Cursor Agent desktop app，对左侧创建新项目/新对话、对话过程和右侧数据展示逐项比对；只有持续 ledger、focused tests、typecheck 和 diff check 都通过，且连续复测未发现未登记差异时，才能把本小节任务打勾并补最终 evidence。若用户在后续使用中发现新的体验差异，本小节必须重新打开并追加新轮次 TODO。

### Skills / Memory / Capabilities

- [x] 将 skills 暴露为 module resource。
  验收：`module.query({ moduleId: 'skills' })` 可搜索 skill；`module.read({ ref: 'skill:...' })` 可读取 skill 摘要、约束和适用场景；skill 执行仍走 Agent Host 原生 skill/tool 机制。
  证据（2026-05-29）：新增 `src/runtime/modules/resource-modules.ts` / `.test.ts`，skills handler 复用 `packages/skills/catalog.ts`，按 id/label/description/tags 搜索，`skill:<id>` read 返回摘要、domains、entrypoint、outputs、required capabilities、failure modes 和适用 prompts；不执行 skill、不做 GUI ranking。验证：`node --import tsx --test src/runtime/modules/resource-modules.test.ts` passed。

- [x] 将 memory 暴露为 module resource。
  验收：`module.query({ moduleId: 'memory' })` 搜索 project/session/user memory；`module.read({ ref: 'memory:...' })` 读取小摘要；写入、更新、forget 走 `module.invoke` 并记录 trace、来源和审批要求。
  证据（2026-05-29）：memory handler 支持 caller-provided project/session/user fixture refs 的 query/read，小摘要和 meta 输出脱敏；`write/update/forget` 走 approval-gated `module.invoke`，返回 operation ref、approvalRequest 和 accepted-not-persisted dry-run 结果，不做隐式持久化。验证：`node --import tsx --test src/runtime/modules/resource-modules.test.ts` passed。

- [x] 将 capability discovery 暴露为 module resource。
  验收：`module.query/read/invoke({ moduleId: 'capabilities' })` 覆盖 search、explain、plan；GUI 只展示结果，不做 ranking。
  证据（2026-05-29）：capabilities handler 复用 `createCapabilityDiscoveryService`，`query` 暴露 compact capability resource items 且不输出 rank/score/confidence，`read capability:<id>` 返回 bounded summary，`invoke search/explain/plan/expand` 继续保留 `completionEvidence: 'not-evidence'`。验证：`node --import tsx --test src/runtime/modules/resource-modules.test.ts` passed。

### Cleanup / Migration

- [x] 清理旧命名和旧路径。
  验收：新增代码不再引入第二套 `registerCommand/registerTool/registerPolicy` 或 AgentServer 概念；旧 `gui.*` 和 capability alias 只作为 adapter shim 存在，并有删除计划。
  证据（2026-05-29）：`rg -n "registerCommand|registerTool|registerPolicy|AgentServer|gui\\.|capability_discovery\\.|capabilit(y|ies).*alias|alias"` 审计当前改动与新增文件；新增 runtime module/adapter 代码没有引入第二套 `registerCommand/registerTool/registerPolicy`，也没有新增 AgentServer public surface。`gui.*` 只保留在 `src/runtime/codex/gui-mcp-tools.ts` legacy shim、Codex normalizer 兼容映射和对应 tests；capability alias 只在文档中作为迁移 shim 被说明，runtime canonical surface 是 `module.query/read/invoke(moduleId='capabilities')`。删除计划：先让 Codex app-server 默认注入 `module.*` 并通过 smoke gates；legacy/test-only CLI bridge 和 Claude MCP 只保留兼容验证；随后删除 `capability_discovery.*` alias 注入和文档示例；最后在 GUI module adoption 稳定后删除 `gui.*` MCP alias，只保留 `module.*`。

- [x] 更新 smoke gates。
  验收：新增 focused tests 覆盖 module describe registry、GUI alias 转发、dispatcher fail-closed、Codex app-server event normalization、Claude stream-json normalization 和 pipeline trace 脱敏。
  证据（2026-05-29）：新增/扩展 focused tests：`packages/contracts/runtime/modules.test.ts`、`src/runtime/modules/dispatcher.test.ts`、`src/runtime/modules/gui-module-handler.test.ts`、`src/runtime/modules/resource-modules.test.ts`、`src/runtime/codex/gui-mcp-tools.test.ts`、`src/runtime/codex/codex-event-normalizer.test.ts`、`src/runtime/codex/backend-event-normalization.test.ts`、`src/runtime/codex/backend-adapters.test.ts`、`src/ui/src/streamEventPresentation.test.ts`。验证：focused runtime suite 39 tests passed；stream event presentation 26 tests passed；`npm run typecheck --silent` passed。

## 近期 TODO

- [x] 先落地 shared module contract。
- [x] 落地 runtime module dispatcher skeleton。
- [x] 把 `src/runtime/codex/gui-mcp-tools.ts` 的 `gui.*` 调用改为复用 GUI module handler。
- [x] 为 `module.describe({ moduleId: 'gui' })` 补测试，证明 GUI facets 和 intents 可查询。
- [x] 为 skills/memory/capabilities 设计最小 `describe/query/read` fixtures。
- [x] 梳理 `CodexExecJsonAdapter` 当前事件到 pipeline trace 的映射表。
- [x] 起草 `CodexAppServerAdapter` 事件归一化测试 fixture，不直接依赖真实 app-server。
- [x] 建立主动双端对照工作流：每次聊天体验相关改动都同时观察 SciForge web 和 Cursor Agent desktop app，记录通用差异、交互基线、截图/trace refs 和脱敏验收 evidence。
  证据（2026-05-30，最终状态：完成）：用 Browser 检查 SciForge 本地页面并物化截图 ref，用 Computer Use 只读观察 Cursor Agents 的左侧栏和右侧过程流；新增 `agentDesktopAlignmentEvidence` schema/test 把双端 refs、需求覆盖和脱敏规则固化为可复用验收机制；本轮 evidence record 位于 `docs/agent-desktop-alignment-evidence/evidence-2026-05-30.json`。
- [x] 为左侧栏定义 Cursor Agent-like project/thread model：workspace/project group、thread list、draft、pinned、archived、discarded、active branch/local environment/context budget、new project/new chat actions，并映射到 GUI resource tree。
  证据（2026-05-30，最终状态：完成）：`sidebarCursorAgentModel.ts` / `.test.ts` 覆盖 workspace/project/thread 投影、草稿/置顶/归档/丢弃状态、branch/environment/context 状态、新项目/新对话/search actions 和 `gui:/regions/sidebar/*` refs。
- [x] 将左侧栏可变操作收敛为 GUI-TUI 解耦协议：展示/选择/排序是 GUI-local presentation state；创建项目/新对话/启动 agent turn/归档同步/repair/GitHub/sub agent 必须生成终端等价文本或 Agent Host pipeline trace。
  证据（2026-05-30，最终状态：完成）：sidebar model 将 mutating actions 收敛为 terminal-equivalent commandText，将 selection/sort 保持为 GUI-local presentation action；`guiProtocol.test.ts` 验证默认 sidebar placeholder 只读且不暴露虚构可变 command affordance。
- [x] 建立 Cursor Agent-like chat presentation profile 的事件 taxonomy：`worked_group`、`explored_group`、`read`、`search`、`shell_command`、`file_edit`、`diff`、`thought`、`approval`、`subagent`、`done`，并映射到现有 backend-neutral events。
  证据（2026-05-30，最终状态：完成）：`streamEventPresentation.ts` 新增 `cursor-agent-like` profile，`cursorAgentProcess.ts` 将 backend-native events 映射为 Cursor-like presentation groups/action taxonomy；`streamEventPresentation.test.ts` 与 `RunExecutionProcess.test.ts` 覆盖 taxonomy 和旧 runtime 内部字段隐藏。
- [x] 重写 web 聊天过程组件，使顶层只保留 Cursor Agent-like 的聚合层，完成态默认折叠，运行态即时展开；删除所有旧 SciForge summary、占位 progress、重复 transcript 和非交互过程块。
  证据（2026-05-30，最终状态：完成）：`RunningWorkProcess.tsx` / `RunExecutionProcess.tsx` 统一走 `NativeEventStream` + Cursor-like process model；非 native fallback 也转换成 synthetic process events，不再渲染旧 `cursor-step-fold` summary；wait-only placeholder、空 audit fold 和重复 transcript ref 已移除。
- [x] 为命令运行实现 Cursor-like 交互：运行中显示正在运行，完成后动作行默认折叠；展开后显示 cwd、命令、退出状态、stdout/stderr bounded 摘要和脱敏后的完整输出 ref。
  证据（2026-05-30，最终状态：完成）：`cursorAgentProcess.ts` 提取 shell command lifecycle、cwd、exit、bounded output summary 和 stdout/stderr output refs，并统一脱敏 provider/model/secret/local path；`RunningWorkProcess.tsx` 以动作行 + `<details>` 明细展示。
- [x] 为文件读写实现 Cursor-like 交互：读取动作为可点击文件预览；编辑动作为 `Edited <file> +N -M`，旁边提供展开/收起 diff，diff 内容 bounded、脱敏、可跳转到文件。
  证据（2026-05-30，最终状态：完成）：file read 只在可信相对 `fileRef` 存在时提供 preview focus；file edit/diff 动作在 backend 提供 change summary/diff 时显示 `Edited <file> +N -M` 与 bounded/redacted diff detail，并通过 canonical refs 跳转文件；测试覆盖 raw `filePath` 和本地绝对 `fileRef` 不会被合成为可点击预览 ref。
- [x] 为 sub agent lifecycle 实现 Cursor-like 交互：创建中、运行中、完成、失败和取消都有实时动作行；完成后默认折叠，展开后显示子 agent 输入摘要、关键动作、结果摘要和 transcript/ref。
  证据（2026-05-30，最终状态：完成）：`cursorAgentProcess.ts` 将 spawn/running/completed/failed/cancelled 类 subagent events 映射为动作行、状态和 transcript refs；`RunExecutionProcess.test.ts` 覆盖 subagent 行与 refs-first 明细。
- [x] 增加 fixture、component 和 browser verification：覆盖运行中流式更新、完成态折叠、命令展开、编辑 diff 展开、文件预览、sub agent 展开和旧摘要文本不存在。
  证据（2026-05-30，最终状态：完成）：新增/扩展 `streamEventPresentation.test.ts`、`RunExecutionProcess.test.ts`、`ChatPanel.test.ts`、`sidebarCursorAgentModel.test.ts`、`agentDesktopAlignmentEvidence.test.ts`、`guiProtocol.test.ts`，并用 Browser 对 SciForge 本地页面做渲染检查；focused suite、typecheck 和 diff check 均通过。
- [ ] 持续执行 live 双端对照任务：每一轮先用 Browser 在当前本地 SciForge dev URL 真实操作/观察 SciForge，再用 Computer Use 只读观察 Cursor Agent desktop app，同步记录左侧栏、对话流和右侧展示 evidence；每轮结束都要更新 `PROJECT.md` 的差异、TODO、状态和 evidence。
  进展（2026-05-30）：持续 ledger schema 与当前 active ledger 已落地并更新到正式双端 Round 15；Round 07 exec-MCP legacy/test-only probe 仅作为 open difference evidence refs 记录，不是独立 supplemental ledger round：`docs/agent-desktop-alignment-evidence/live-ledger-2026-05-30.json`。该 ledger 当前 `validation.ok=true`，并关闭了 Cursor running-state supplemental、SciForge trusted file preview、右侧 Markdown preview、命令展开、完整 diff-detail 展开、Round 09 长研究任务 transport lifecycle/raw traceback/right-pane dump、Round 13 展开态视觉、Round 14 文件查看 placement 以及 Round 15 SciForge 重新对话后右侧文件 viewer 打开相关缺口；Round 10/11/12 已证明 SciForge Codex app-server product path 的 sub-agent lifecycle、artifact refs、右侧 preview、resume 动态工具、refs-first detail order、post-cleanup prompt/raw-output 隐藏、真实 sidebar DOM 状态和产品 runtime 文案可用。ledger 仍为 `active`，open difference 只剩 Cursor Agent 当前同 prompt 无 positive sub-agent transcript/result baseline；Round 15 的 Cursor fresh file-viewer retest 另受本机 Computer Use helper `procNotFound` 阻塞，已登记为复测限制。
- [ ] 左侧栏 TODO：逐项比对新项目、新对话、项目/线程分组、当前项目高亮、搜索、草稿、置顶、归档、丢弃、branch/environment/context 状态和跨项目切换；为每个差异登记通用修正，不写 workspace-specific 补丁。
  进展（2026-05-30）：Round 02 已真实操作 SciForge `New Agent`、search、writer-backed project tree/status，并用 Cursor Agent sidebar 对照；当前左侧栏实测差异已关闭，但最终 parity 仍需随下一轮回归确认不被后续 chat/right-pane 修正破坏。
- [ ] 对话体验 TODO：逐项比对运行中 delta、完成态折叠、`Worked for ...` / `Explored ...` 聚合、动作行、命令输出、diff、文件预览、approval、sub agent 和错误/取消状态；删除或登记所有旧 summary、重复 transcript、不可交互过程块和占位 progress。
  进展（2026-05-30）：Round 03 已真实覆盖 SciForge running/failed recovery/Worked/Explored/read action 和 Cursor completed Worked/Explored/read action；Round 04 在 base URL 修复后补齐 SciForge 成功对话、trusted file preview、右侧 Markdown preview、Cursor running-state 和命令展开 evidence，并补上内部 ref 不外露、非文件命令不合成 preview、过程树视觉层级的通用修正；Round 05 已补齐完整 diff-detail 展开；Round 06/07 证明旧路径缺少真实 sub-agent 工具面；Round 09 用 arXiv Agentic RL 长任务对齐 Cursor 的 progress prose、`Worked/Explored` 聚合、展开动作顺序和完成态 raw diagnostic folding，并通用隐藏 transport lifecycle / traceback dump；Round 10/11/12 已在 SciForge Codex app-server product path 采集并复测真实 sub-agent lifecycle、transcript ref、result ref、resume evidence、prompt/raw-output 隐藏和真实 DOM 过程/状态清理；Round 15 修正 file action/ref 的 originating `runId` 传递和 prompt fallback 路径标点裁剪，使展开后的 `Read PROJECT.md` 能稳定指向本轮 workspace。仍缺 Cursor Agent positive sub-agent baseline：同 prompt 当前返回 `NO_SUBAGENT_TOOL_AVAILABLE`。
- [ ] 右侧数据展示 TODO：逐项比对文件 preview、diff viewer、命令输出、artifact/data object preview、结果详情、refs 跳转、空/加载/错误状态、长内容裁剪和脱敏策略；确保右侧不是日志 dump。
  进展（2026-05-30）：Round 03 观察到 Cursor read action 可打开右侧文件 preview；Round 04 观察到 SciForge 成功 read action 通过 trusted workspace-relative ref 显示 `Preview file` 并打开右侧 Markdown preview，`diff:round-03-sciforge-read-preview-ref-missing` 已关闭；Round 05 已用真实 SciForge diff 请求确认命令、exit 1、workspace-relative ref 和 unified diff hunks 都进入展开 detail；Round 09 将右侧 Markdown/support-pane 的 raw traceback 和 diagnostic 文本接入同一套 final-message folding policy，避免 failed research run 退化为日志 dump；Round 10/11/12 观察到 SciForge sub-agent result ref 点击后进入安全 sub-agent preview，而不是 raw JSON/log dump，且 unsafe path fallback 不会永久 loading 或暴露 `/tmp` / `.sciforge/raw`，sub-agent refs 保持先于 summary/details；Round 14 将文件查看升级为右侧 tree+editable editor，并把可复用 UI 放入 `packages/presentation/components/workspace-file-viewer`，app 层只装配 workspace list/read/write helper；Round 15 重新发送只读 `PROJECT.md` 对话并点击展开后，Browser 确认右侧 `workspace-file-viewer` 有目录树、选中文件、可编辑 textarea 和 saved state。右侧 hydration 现在拒绝 `/tmp`、`../`、`.sciforge/logs|raw` 等不安全路径；当前剩余风险转为 Cursor 侧没有 positive sub-agent result/transcript refs 可用于双端对齐，以及本轮 Cursor fresh file-viewer 复测需等待 Computer Use helper 恢复。
- [ ] 并行工作 TODO：允许开启多个 sub agents 分别负责 PROJECT/evidence、左侧栏、对话流、右侧展示和测试验证；每个 sub agent 必须有不重叠的读写范围，结束时汇总差异和证据，未用 sub agent 及时关闭。作为 live evidence 时，必须使用 Codex app-server product backend 暴露的真实 sub-agent/delegated-worker MCP 工具；shell、terminal-equivalent 或 exec-MCP fallback 只能作为 UI/normalizer legacy/test-only probe，不能登记为真实 sub-agent evidence。
- [ ] 验收 TODO：每轮 live 修正后运行相关 focused UI tests、`npm run typecheck --silent` 和 `git diff --check`；复测时必须再次同时打开 SciForge web 与 Cursor Agent desktop app，并把本轮 evidence 写回 `PROJECT.md`。只有多轮复测确认用户体验一致，且没有未登记差异时，才能把 live parity 任务打勾。

## Computer Use 仍适用原则

Computer Use 仍采用三层循环：

```text
Evidence Loop:
  observe -> inspect/crop/VLM/OCR -> update evidence graph

Action Loop:
  plan action -> ground -> execute -> verify -> update evidence graph

Task Loop:
  evidence loop -> action loop -> evidence loop -> complete/blocked
```

- Evidence Loop 只允许不改变屏幕、窗口、viewport、focus、菜单、tab 或应用状态的观察型操作。
- 任何会改变可见状态的操作都必须进入 Action Loop，并记录 before/after evidence、grounding、executor outcome、verification 和 action causality。
- 完成判断必须从当前 evidence ledger 查询得出，不能只依赖历史 trace、旧截图或 action history。
- Computer Use 是 `actions` module 的能力，不是 GUI 能力；GUI 只展示 trace、收集确认和呈现结果。

## 验证规则

- 纯文档改动：运行 `git diff --check`。
- Shared contract / TypeScript policy 改动：运行 focused Node tests 和 `npm run typecheck --silent`。
- Runtime adapter 改动：运行对应 adapter normalization tests、runtime event tests 和 `git diff --check`。
- GUI module 改动：运行 GUI protocol/controller tests、runtime events client tests 和相关 chat projection tests。
- Computer Use package 代码改动：运行 package-local Python suite 和相关 package bridge focused tests。
- 涉及真实 app-server、Claude stream-json、browser 或 Computer Use live 的改动默认先做 fixture/focused tests；长耗时 live gates 只作为 opt-in release evidence。

## 本地模型配置

- 本地调试可以使用 ignored config，例如 `config.local.json`、`config.computer-use.local.json`。
- 这些文件可能包含 provider URLs、API keys、model names，绝不能提交或打印。
- Runtime Codex / Computer Use 服务环境必须通过 ignored config 或环境变量提供密钥；文档、日志和 repair action 只能引用变量名，不能打印 secret 值。
- 默认 provider/model 应可见、可审计，不得静默 fallback 到 OpenAI。

## 代码膨胀治理 Watch List

目标：非测试源码文件超过约 2000 行时必须拆分或登记拆分任务；测试代码不受该限制；构建产物不进入治理扫描。

- [x] 新增 `module.*` dispatcher、adapter 或 trace 代码时，优先按 contract、routing、normalization、presentation profile 和 tests 拆分，避免形成新的巨型 gateway。
  本轮审计（2026-05-29）：contract、dispatcher、GUI module、resource modules、backend normalization、backend adapters 和 presentation profile 分文件落地，未形成新的巨型 gateway；focused tests 与实现相邻。
- [x] 继续让 `workspace-server.ts`、chat session projection、runtime event parsing、backend adapters 保持在治理阈值内。
  本轮审计（2026-05-29）：`workspace-server.ts` 1925 行、`runtimeEvents.ts` 1199 行、`backend-event-normalization.ts` 794 行、`codex-app-server-adapter.ts` 136 行、`claude-stream-json-adapter.ts` 192 行、`sessionTransforms.ts` 343 行，均低于约 2000 行治理阈值。
- [x] generated catalog 超过阈值时必须在 smoke 输出中标注 generated/exempt，不得把豁免扩大到手写源码。
  本轮审计（2026-05-29）：本轮新增/修改为手写 contract、adapter、module 和 tests，没有新增 generated catalog；既有 generated/exempt 规则未扩大。

## 暂缓集成

- 将 Claude Code 作为默认 backend。
- 默认 release gate 中运行长耗时 live Computer Use / browser / Claude real-process tests。
- GUI workbench 拖拽式 pipeline 编排。当前 pipeline 编排归 Agent Host，GUI 只做展示和确认。
- 删除 `capability_discovery.*` alias。必须等 `module.query/read/invoke(moduleId='capabilities')` 在 Codex app-server product path 稳定后再做；legacy/test-only CLI bridge 和 Claude MCP 只能作为兼容验证，不作为产品 runtime fallback 前置条件。
- 删除 `gui.*` alias。必须等 `module.*` 主路径稳定后再做；删除前 `gui.*` 只能停留在 adapter shim，不能再扩展新能力。

## 必读文档

- [`docs/README.md`](docs/README.md)：当前文档入口。
- [`docs/Architecture.md`](docs/Architecture.md)：总架构、Agent Host Semantic Pipeline、GUI-as-extension 和模块归属。
- [`docs/TuiGuiProtocol.md`](docs/TuiGuiProtocol.md)：GUI 输入、只读投影、`gui.*` alias 和执行边界。
- [`docs/NativeExtensionOwnershipMap.md`](docs/NativeExtensionOwnershipMap.md)：provider route、verifier、repair、Computer Use 和 connector 能力归属。
- [`docs/BrowserRuntimeArchitecture.md`](docs/BrowserRuntimeArchitecture.md)：browser runtime 作为 TUI capability + GUI presentation surface 的边界。
- [`packages/actions/computer-use/README.md`](packages/actions/computer-use/README.md)：Computer Use action provider 边界。
- [`packages/observe/vision/README.md`](packages/observe/vision/README.md)：vision-sense 边界。

## Worktree 规则

- 开发默认在 `dev` 分支；长期分支尽量只保留 `main` 和 `dev`。
- `config.local.json`、`config.computer-use.local.json`、`.sciforge/**`、package caches、runtime homes 等本地状态不得进入 Git。
- 不使用 `git reset --hard` 或 `git checkout --` 擦除用户改动。
- 只清理明确的 generated caches、temporary workspaces 和 build outputs。
