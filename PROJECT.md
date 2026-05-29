# SciForge 项目协议

最后更新：2026-05-30

当前目标：把 SciForge 从 GUI-as-extension 进一步收敛为 **Agent Host Semantic Pipeline**，并让 web 端聊天的信息展示、实时交互、过程折叠和动作明细体验与 Cursor Agent desktop app 对齐。Codex app-server 是首选原生 backend；`codex exec --json` 保留为迁移兼容；Claude Code stream-json 是可选 backend。所有暴露给 Agent Host 的边界模块统一通过 `module.describe/query/read/invoke` 进入，复杂能力由 Agent Host 组合成 typed semantic pipeline，GUI 只是一个特殊模块。

旧任务历史已在 Git 历史中保留；本文件只记录当前阶段原则、任务板、TODO 和验收规则。

## 当前范围

- 主要工作范围是模块边界 contract、runtime adapter、GUI module surface、Codex app-server 接入、Claude stream-json 兼容、pipeline trace、skills/memory/capability discovery 的模块化迁移。
- SciForge 不维护第二套 AgentServer。Agent Host 拥有推理、规划、工具选择、重试、取消、repair、memory/skill/capability ranking 和 pipeline 编排。
- GUI 继续只负责 presentation、confirmation、focus、hot-region projection、read-only GUI resources 和 terminal-equivalent text。GUI 不做 provider route、completion 判断、capability ranking 或隐藏 prompt assembly。
- web 聊天体验必须以 Cursor Agent desktop app 为交互基线：回答内容可以不同，但过程信息的实时呈现、折叠层级、动作行、命令/编辑/diff 明细、文件预览、运行态和完成态行为必须一致。
- Computer Use、browser、connectors、verifiers、skills、memory、capabilities 和 artifacts 都应作为 Agent Host 可组合模块暴露；模块只执行单步能力，不直接调用下游模块。
- 迁移期可以保留 `gui.*`、`capability_discovery.*`、旧 runtime event 和 `AgentCliAdapter` alias，但它们只能存在于 adapter shim、fixture 或 legacy normalizer 层；新增设计必须以 `module.*` 为 canonical public surface。

## 不可变规则

- 所有修改必须通用，不能为当前案例写硬编码补丁。
- 代码路径保持唯一真相源：发现冗余链路时删除或合并旧链路，避免长期并行实现。
- 旧逻辑和最终方案不一致时，删除旧逻辑，不做长期兼容。
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

- [x] 新增 `CodexAppServerAdapter` 作为首选 backend。
  验收：adapter 支持 thread/start、turn/start、turn/steer 或等价文本输入；消费 thread/turn/item/delta/tool/approval 事件；把 Codex dynamic tools 或 MCP tools 映射到 `module.*`；web 对话能实时显示 assistant delta、tool lifecycle、approval request 和 done。
  证据（2026-05-29）：新增 `src/runtime/codex/codex-app-server-adapter.ts` 与 backend-neutral adapter tests，支持 injectable app-server client、thread/turn start、turn steer、cancel，并把 app-server thread/turn/delta/tool/approval/done fixtures 通过 `backend-event-normalization.ts` 归一为 `NormalizedAgentEvent` + `ModulePipelineTraceStep`；approval request 映射为 GUI-visible confirmation event。验证：`node --import tsx --test src/runtime/codex/backend-event-normalization.test.ts src/runtime/codex/backend-adapters.test.ts` passed。

- [x] 保留并降级 `CodexExecJsonAdapter` 为兼容路径。
  验收：现有 `codex exec --json` 仍可运行，但文档、配置和 UI 文案不再把它描述为 rich-client 主路径；事件归一化继续输出同一 pipeline trace。
  证据（2026-05-29）：保留现有 `CodexExecJsonAdapter`；新增 backend-neutral normalizer 将 `sciforge.codex.normalized-event.v1` 事件作为 `codex-exec-json` backend passthrough，并为 tool lifecycle 产出 module trace；文档入口改为 Codex app-server 首选、exec JSON 兼容。验证：`node --import tsx --test src/runtime/codex/backend-event-normalization.test.ts src/runtime/codex/codex-event-normalizer.test.ts` passed。

- [x] 新增 `ClaudeStreamJsonAdapter`。
  验收：使用 `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages`；stdout NDJSON 映射为同一内部事件；`control_request/control_response` 映射为 approval/input；`module.*` 通过 SciForge MCP server 暴露。
  证据（2026-05-29）：新增 `src/runtime/codex/claude-stream-json-adapter.ts`，以 fixture-friendly spawn 启动 `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages`，stdin 写入 user message，stdout NDJSON 经 backend-neutral normalizer 映射为 message/tool/approval/done，`control_request/control_response` 映射到 approval trace。验证：`node --import tsx --test src/runtime/codex/backend-event-normalization.test.ts src/runtime/codex/backend-adapters.test.ts` passed。

### Pipeline Trace / UI

- [x] 引入统一 pipeline trace。
  验收：每次跨模块组合记录 step id、moduleId、function、intent/query/ref、input summary、result summary、refs、approval、operation、timing、status、parent/child relation；trace 必须脱敏并可折叠展示。
  证据（2026-05-29）：`ModulePipelineTraceStep` 增补 input/result summary、timing、approval；runtime dispatcher 对 `describe/query/read/invoke` 生成脱敏 trace；backend-neutral normalizer 对 Codex app-server、Codex JSONL、Claude stream-json tool/approval lifecycle 生成同一 trace step，并脱敏 provider URL、secret、model/provider 字段。验证：`node --import tsx --test src/runtime/modules/dispatcher.test.ts src/runtime/codex/backend-event-normalization.test.ts` passed。

- [x] 抽出 backend presentation profile。
  验收：Codex app-server、Codex JSONL、Claude stream-json 的 event shape 都先归一化为内部事件，再由 `codex-cli-like`、`claude-code-like`、`sciforge-default` profile 决定折叠、展开和标签；UI 不直接硬编码 backend raw event。
  证据（2026-05-29）：`src/ui/src/streamEventPresentation.ts` 新增 `BackendPresentationProfileId` 与 profile policy，默认保持 `sciforge-default`，可从 backend-neutral `raw.backend` 推导 `codex-cli-like` / `claude-code-like`；测试证明 presentation profile 与 runtime `profile` 元数据分离。验证：`node --import tsx --test src/ui/src/streamEventPresentation.test.ts` passed。

- [x] 修复 web 对话实时性。
  验收：assistant partial/delta、tool start/completion、approval request、operation progress 在 100-300ms 内进入 GUI reducer；final result 只负责收尾，不负责首次展示。
  证据（2026-05-29）：`packages/contracts/runtime/events.ts` 将 backend-neutral `message_delta/assistant_delta`、`tool_started/tool_completed`、`approval_requested` 和 `operation_progress` 映射到 GUI reducer 使用的 `text-delta`、`tool-call`、`tool-result`、`human-approval-required`、`process-progress` contract types；`src/ui/src/api/sciforgeToolsClient/runtimeEvents.ts` 在 SSE/WS 读取阶段即时 normalize，`assistantDraftFromStreamEvents` 可在 `done` 前拿到 partial text，final result 只聚合/收尾。backend normalizer 新增 operation progress 事件。验证：`node --import tsx --test packages/contracts/runtime/events.test.ts src/ui/src/api/sciforgeToolsClient/runtimeEvents.test.ts src/runtime/codex/backend-event-normalization.test.ts src/runtime/codex/backend-adapters.test.ts` passed。

- [ ] 对齐 Cursor Agent desktop app 的聊天过程体验。
  验收：新增或收敛为 `cursor-agent-like` presentation profile；SciForge web 对话在运行时和完成后与 Cursor Agent desktop app 的信息架构一致。顶层只显示用户消息、assistant 进度句、可折叠的 `Worked for ...` / `Explored ...` 聚合项和最终回答；运行中的 shell、文件编辑、读取、搜索、思考、approval、sub agent spawn/complete 必须即时更新；完成后的过程默认折叠；用户展开聚合项后看到动作行，展开单个动作后看到命令、stdout/stderr 摘要、文件 diff、文件预览或 sub agent transcript。回答内容不要求一致，但折叠层级、可点击行为、状态文案、动作摘要和明细承载位置必须一致。旧的 SciForge summary、占位 progress、重复 transcript 或不可交互过程块必须删除。
  观察基线（2026-05-30，Computer Use 观察 Cursor Agents）：完成态普通读文件任务显示 assistant 进度句 + `Explored 3 files` 聚合项；展开后出现 `Read README.md L1-263` 等动作行，点击动作打开右侧文件预览。开发任务显示 `Worked for 22s/35s` 聚合项；展开后有 `Explored 3 searches, ran 8 commands`、`Ran ...`、`Thought for 1s`、`Edited data.ts +1 -1` 等动作行；点击 shell 动作在原位展开命令和输出摘要；点击 edit diff 在原位展开红绿 diff。此观察只作为交互基线，不允许写成针对具体截图或具体文件名的硬编码。

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
  证据（2026-05-29）：`rg -n "registerCommand|registerTool|registerPolicy|AgentServer|gui\\.|capability_discovery\\.|capabilit(y|ies).*alias|alias"` 审计当前改动与新增文件；新增 runtime module/adapter 代码没有引入第二套 `registerCommand/registerTool/registerPolicy`，也没有新增 AgentServer public surface。`gui.*` 只保留在 `src/runtime/codex/gui-mcp-tools.ts` legacy shim、Codex normalizer 兼容映射和对应 tests；capability alias 只在文档中作为迁移 shim 被说明，runtime canonical surface 是 `module.query/read/invoke(moduleId='capabilities')`。删除计划：先让 Codex app-server / CLI bridge / Claude MCP 都默认注入 `module.*` 并通过 smoke gates；随后删除 `capability_discovery.*` alias 注入和文档示例；最后在 GUI module adoption 稳定后删除 `gui.*` MCP alias，只保留 `module.*`。

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
- [ ] 建立 Cursor Agent-like chat presentation profile 的事件 taxonomy：`worked_group`、`explored_group`、`read`、`search`、`shell_command`、`file_edit`、`diff`、`thought`、`approval`、`subagent`、`done`，并映射到现有 backend-neutral events。
- [ ] 重写 web 聊天过程组件，使顶层只保留 Cursor Agent-like 的聚合层，完成态默认折叠，运行态即时展开；删除所有旧 SciForge summary、占位 progress、重复 transcript 和非交互过程块。
- [ ] 为命令运行实现 Cursor-like 交互：运行中显示正在运行，完成后动作行默认折叠；展开后显示 cwd、命令、退出状态、stdout/stderr bounded 摘要和脱敏后的完整输出 ref。
- [ ] 为文件读写实现 Cursor-like 交互：读取动作为可点击文件预览；编辑动作为 `Edited <file> +N -M`，旁边提供展开/收起 diff，diff 内容 bounded、脱敏、可跳转到文件。
- [ ] 为 sub agent lifecycle 实现 Cursor-like 交互：创建中、运行中、完成、失败和取消都有实时动作行；完成后默认折叠，展开后显示子 agent 输入摘要、关键动作、结果摘要和 transcript/ref。
- [ ] 增加 fixture、component 和 browser verification：覆盖运行中流式更新、完成态折叠、命令展开、编辑 diff 展开、文件预览、sub agent 展开和旧摘要文本不存在。

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
- 删除 `capability_discovery.*` alias。必须等 `module.query/read/invoke(moduleId='capabilities')` 在 Codex app-server、CLI bridge 和 Claude MCP 路径都稳定后再做。
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
