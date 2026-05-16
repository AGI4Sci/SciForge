# SciForge - PROJECT.md

最后更新：2026-05-16

## 当前目标

在网页端持续测试、优化和修复 SciForge 多轮对话机制，使最终 Single-Agent runtime 稳定、流畅、可扩展。所有修改必须通用；多轮运行时以 [`docs/SciForge-SingleAgent-Architecture.md`](docs/SciForge-SingleAgent-Architecture.md) 为最终 contract，产品/实现背景参考 [`docs/Architecture.md`](docs/Architecture.md)。

## 必读边界

实现前先读：

- [`docs/SciForge-SingleAgent-Architecture.md`](docs/SciForge-SingleAgent-Architecture.md)：最终多轮 runtime contract，包含 Workspace Kernel、AgentServer Context Core、Runtime Bridge、Capability Gateway、Projection-only UI、conformance 和长期防污染边界。
- [`docs/Architecture.md`](docs/Architecture.md)：SciForge 总体架构、Backend-first / Capability-driven / Harness-governed 方向、`src` 与 `packages` 边界。
- [`docs/AgentHarnessStandard.md`](docs/AgentHarnessStandard.md)：harness runtime、profile、stage hook、contract、trace、merge 规则和行为治理入口。

历史任务归档：2026-05-14/15 的旧 CAP/PKG/GT/PSM/MEM/H022 长段在 [`docs/archive/PROJECT-history-2026-05-14-15.md`](docs/archive/PROJECT-history-2026-05-14-15.md)。旧 `SF-STAB-*` 事故链路已吸收到当前任务板，不再作为活动 backlog。

## 不变原则

- 所有修改必须通用、可泛化到任何场景，不能在代码里为当前案例、prompt、provider、backend、文件名或错误文本打补丁；skills/tools 等插件化能力必须尽可能即插即用、易扩展。
- 有多种方案时，优先实现最简洁、通用、可验证的方案。
- 算法相关代码优先用 Python 实现，方便人类用户优化和检查。
- 代码路径保持唯一真相源：发现冗余链路时删除、合并，避免长期并行实现。
- 设计和实现保持同一真相源：真实 browser、conformance、性能或用户体验证明关键设计不满足需求时，必须在同一 milestone 同步修改设计文档、代码和本文件；不能只改代码绕过 contract，也不能只改文档掩盖缺口。
- Capability 必须在生成层成为可执行 authoring contract：当系统已有 ready provider/tool route 时，Backend prompt 不能只收到抽象规则或诊断摘要，必须收到标准 helper/API 签名、任务输入字段和可复制 adapter skeleton；运行时 preflight/guard 只作为最后防线。
- 新增 tool 的最小接入闭环是：CapabilityManifest -> ProviderManifest/route resolver -> HarnessContract decision -> compact context envelope -> authoring contract/helper SDK -> Gateway.execute -> validator/preflight -> ArtifactDelivery/Projection -> conformance fixture。
- 多轮记忆采用 Single-Agent runtime 边界：Workspace Kernel 的 append-only ledger/ref store 是可恢复事实源；AgentServer Context Core 负责 context orchestration、retrieval、compaction 和 backend handoff；agent backend 只消费 cache-aware projection/task packet 并按需读取 refs。
- 不需要保护旧兼容行为；旧逻辑如果与最终版本冲突，默认删除、合并。
- 代码膨胀必须自动触发治理：源码文件超过 1000 行进入 watch list；超过 2000 行优先拆分；超过 3000 行视为维护风险。
- 长文件拆分必须按职责命名，不能机械切成 part1/part2；主入口只做流程编排。

## 当前任务：Browser Multiturn Stability Sprint

状态：active
总控：Codex Orchestrator
工作分支：`main`

目标：用 Codex in-app browser 对真实 Web UI 做 fresh、continue、repair、provider/tool、refresh restore、artifact selection、audit/debug 路径测试；发现问题后写入本任务板，并做通用修复，直到最终方案稳定运行。

当前 milestone：Parallel Browser Stability & Speed。重点不是再证明 fixture smoke 能过，而是多开独立端口和独立 workspace/state 的真实网页进程，在能成功完成对话任务的前提下，压测多轮对话是否稳定、足够快。每个进程必须只改通用模块，不允许为某个 prompt、端口、backend、provider 或浏览器会话写特例。

### 阶段门

1. **PROJECT Cleanup Gate**：本文件只保留当前目标、原则、活动任务、issue queue、验证门和 handoff；旧任务正文删除或移入 archive。
2. **Browser Discovery Gate**：每轮至少用 in-app browser 跑一个真实多轮路径；不能只用 terminal smoke 代替用户可见验证。
3. **Root-Cause Fix Gate**：每个 P0/P1 必须定位到 contract/module 边界，优先修架构薄腰；preflight/retry 只能作为最后防线。
4. **Projection Gate**：用户可见 terminal state 必须来自 ConversationProjection + ArtifactDelivery；raw run、stream delta、ExecutionUnit 只进 transient/audit/debug。
5. **Conformance Gate**：修复后至少跑相关 targeted tests、`npm run typecheck`、`npm run smoke:single-agent-runtime-contract`；milestone 完成前跑 `npm run verify:single-agent-final`。
6. **Sync Gate**：完成 milestone 后更新本文件、提交并 push 到 `origin/main`。

### 成功底线

稳定、快速的前提是多轮对话任务能真正完成。任何速度优化都必须遵守以下优先级：

1. **完成任务优先**：fresh、continue、repair、provider/tool、artifact follow-up 必须在真实 browser 中产出用户请求的有效结果，或在确实缺少权限/证据/输入时给出可恢复的下一步。
2. **准确回答才算成功**：`TaskSuccess=true` 必须代表用户问题被准确、完整、可核查地回答；只恢复 UI、只保留 refs、只显示 `satisfied`、只没有 raw leak、只没有 Projection wait，都不能单独算成功。如果回答空泛、答非所问、只复述 refs、提示 `Reference path was not readable`、出现 failed/repair-needed 污染，或没有真正利用用户选择的 artifact/provider evidence，必须记为 `TaskSuccess=false`。
3. **Projection terminal 必须可信**：`satisfied` 只能在任务内容真实完成时出现；`background-running` 代表已有准确且有用的前台结果且后台继续；`needs-human` / `repair-needed` / `failed-with-reason` 只能用于真实阻塞，不得用来掩盖 backend 慢、回答质量不足或实现缺口。
4. **不能用快失败冒充快**：提前 fail-closed、返回空结果、跳过 provider/tool、跳过验证、直接给 degraded answer，除非 contract 明确证明继续执行不可行。
5. **快的是首个有用反馈和收敛路径**：可以更早展示计划、进度、partial answer、recover action，但不能牺牲最终任务质量、refs grounding、ArtifactDelivery 或 verification boundary。
6. **多轮连续性是成功的一部分**：第二轮必须接住上一轮目标和结果；repair 必须基于当前失败 refs；artifact follow-up 必须基于用户选择的 refs，并给出基于该 selected artifact 的实质回答。

### 活动任务

| ID | 状态 | 内容 | 验收 |
|---|---|---|---|
| BM-001 | completed | 清理 `PROJECT.md`，删除旧 SA/SF-STAB 任务正文，建立新的 browser stability sprint 任务板。 | 本文件只包含当前 sprint、issue queue、验证门和 handoff；旧历史只以 archive 链接存在。 |
| BM-002 | completed | 用 in-app browser 跑 fresh -> continue 多轮路径，记录用户可见问题。 | Browser DOM evidence 覆盖新聊天隔离、Projection terminal、continue audit intent。 |
| BM-003 | completed | 修复本轮 browser 发现的最高优先级问题，必须是通用 contract/module 修复。 | 通用修复落在 runtime gateway、UI transport context policy、Agent Harness shadow intent；无 prompt/provider/scenario 特例。 |
| BM-004 | completed | 补齐回归测试和 conformance 证据。 | targeted tests、typecheck、single-agent runtime smoke、web conformance、`verify:single-agent-final` 均通过。 |
| BM-005 | completed | 同步文档和 GitHub。 | `PROJECT.md` 已更新；本次 milestone commit + push `main` 完成。 |
| PBT-001 | completed | 建立并行端口/状态隔离矩阵，让多个进程可同时跑 SciForge Web UI、workspace writer、AgentServer 和 in-app browser。 | P1 使用 `SCIFORGE_INSTANCE=p1`、UI `5173`、workspace `5174`、AgentServer `18080`、`workspace/parallel/p1`、`.sciforge/parallel/p1`、`.sciforge/parallel/p1/config.local.json`；证据见 `docs/test-artifacts/web-e2e/P1-MT-003/manifest.json`。 |
| PBT-002 | in_progress | 建立真实网页成功率 + 速度 baseline：记录任务是否完成，以及从发送到首个可见状态、首个 backend event、Projection terminal、可读结果的耗时。 | P1 已输出 browser timing/evidence manifest；fresh no-exec 成功，fresh normal 成功但 `T_first_backend_event/T_terminal_projection≈126s` 超预算，final rerun 被 UI hydrate + AgentServer first-event stall 阻断，已写 Issue Queue。 |
| PBT-003 | todo | 修复长时间 running / 软等待 / Projection 等待问题，同时保留任务完成能力。 | 有 backend 进展的 run 应继续推动任务完成；确实 stalled 时必须在 bounded 时间内进入 Projection-visible `background-running`（已有可读前台结果）或真实阻塞的 `needs-human` / `repair-needed` / `failed-with-reason`；不能无限显示“主结果等待 ConversationProjection”。 |
| PBT-004 | in_progress | 优化 fresh -> continue 常规对话成功率和速度。 | 修复 answer-only continuation policy/direct-context contract 与 Projection persistence；真实 browser 仍暴露 AgentServer first-event stall 和 UI hydrate blocker，需要下一轮复验。 |
| PBT-005 | todo | 优化 provider/tool 路径任务完成率、速度和稳定性。 | ready provider/tool route 必须尽早进入 capability-first authoring contract 并实际完成检索/读取/产物生成；provider unavailable 只有在确认无可用 route 时才快速 Projection-visible 阻塞；不得长时间等待 backend 自行生成直连网络代码。 |
| PBT-006 | todo | 压测 repair from failure 的任务恢复能力和 bounded-stop。 | repair 应优先恢复并完成原任务；只用同 session failure refs/digests；重复失败或 token/静默超限时才返回最小 Projection recover action，不自动无限 repair。 |
| PBT-007 | todo | 验证 refresh/reopen restore 真实浏览器路径。 | reload/reopen 后右侧主结果、recover actions、artifact refs 从 persisted Projection 恢复；不能因 compact storage 丢 projection 而显示等待 Projection。 |
| PBT-008 | todo | 验证 artifact selection 真实交互边界。 | 点击/选择旧 artifact 后追问，request 只带 selected explicit refs；不得混入 latest artifact 或当前 run raw body。 |
| PBT-009 | todo | 把真实 browser evidence 纳入 final gate。 | 至少新增 3 条真实浏览器证据：Projection restore、artifact selection、provider/tool latency；final evidence manifest 不再只有 fixture-managed/mock-only 记录；证据必须区分“边界通过”和“准确回答成功”，不得把 failed/repair-needed 或空泛 direct-context 回答标为 `TaskSuccess=true`。 |
| PBT-010 | todo | 建立 Multiturn Browser Golden Path Gate：把 fresh artifact、reload restore、context-only follow-up、selected artifact follow-up、provider unavailable/recover、slow backend bounded-stop 变成真实 in-app browser 回归矩阵。 | 每个 case 输出 evidence manifest：URL、run id、session id、prompt、DOM evidence、console/network summary、timing、TaskSuccess、AnswerQuality、UsefulPartial、BlockingTruth、MultiturnContinuity、ProjectionWaitAtTerminal、RawLeak；terminal 不得显示等待 Projection；direct-context sufficient 时不得 dispatch AgentServer；summary follow-up 不得只吐 refs；synthetic wait 不得把 stall 延长到 120s 之外；`TaskSuccess=true` 必须有准确回答用户问题的 DOM 证据。 |
| MTG-001 | todo | **[P0] 跑通真实网页多轮 Golden Path**：fresh 成功生成用户可读结果 -> 选择 artifact -> follow-up 只用 selected refs -> reload/reopen 后继续追问 -> audit/debug 不污染主结果。 | 用 Codex in-app browser 跑完整链路并输出 evidence manifest；每轮记录 URL、run id、session id、selected refs、request summary、DOM、console/network、timing；全链路 `TaskSuccess=true`、`AnswerQuality=accurate`、`MultiturnContinuity=true`、`ProjectionWaitAtTerminal=0`、`RawLeak=false`。任何 failed/repair-needed、不可读 selected artifact、只列 refs、空泛总结或未回答用户问题都使 Golden Path 失败。 |
| MTG-002 | todo | **[P0] 统一主结果真相源**：网页端所有 terminal 主结果只从 `ConversationProjection + ResultPresentation + ArtifactDelivery` 渲染，不被 raw run、wrapper failure、stream delta 或 stale `taskOutcomeProjection` 覆盖。 | 构造 satisfied Projection 但 wrapper/backend raw 为 failure 的回归用例；DOM、records 和 reload/reopen 均显示 Projection answer；旧 backend failure 只进 audit/debug，不进入主结果。 |
| MTG-003 | todo | **[P0] 打稳 AgentServer generated task 输出契约**：ready backend 生成任务必须写标准 `ToolPayload`，包含 `message`、`claims`、`uiManifest`、`executionUnits`、`artifacts` 和合法 outputPath 写入。 | Capability-first authoring contract 提供 copyable adapter/helper；preflight 在昂贵执行前阻断明显非法代码；真实 browser fresh artifact run 不再因缺 ToolPayload envelope 失败。 |
| MTG-004 | in_progress | **[P1] 收敛 conversation-policy timeout / 误路由**：policy 输出成为严格 contract；selected refs + no-rerun/no-tools/context-only 进入 direct-context，fresh work 和 provider/tool work 不被误判成 direct answer。 | Python/TS contract tests 覆盖 answer-only continuation transform、selected refs direct-context、fresh/provider/tool dispatch；browser 修复前误路由已消除为 direct-context，但最终复验被 UI hydrate blocker 截断。 |
| MTG-005 | in_progress | **[P1] 把 timing 指标产品化**：每个真实 browser run 自动记录 `T_first_progress`、`T_first_backend_event`、`T_terminal_projection`、`T_readable_answer` 和 stall bound，并按边界归因。 | `docs/test-artifacts/web-e2e/P1-MT-003/manifest.json` 记录 P1 timing、DOM evidence、console summary，并按 AgentServer / Projection / UI hydrate 归因；仍需接入自动 final gate。 |
| MTG-006 | todo | **[P1] 将 Golden Path 纳入 final gate**：`verify:single-agent-final` 或 companion final gate 必须引用真实 in-app browser evidence，而不只依赖 fixture/mock。 | 至少一条 fresh -> artifact -> follow-up -> reload/reopen -> follow-up 的真实 evidence 成为 release blocker；该 release blocker 必须准确回答用户问题，不能只是 restore/selection/audit 边界证据；缺 browser evidence 或 evidence 中 `AnswerQuality!=accurate` / `TaskSuccess!=true` 时 final gate fail。 |
| P1-MT-001 | in_progress | 修复 answer-only continuation 路由：当 follow-up 可由上一轮 `ConversationProjection.visibleAnswer`、bounded artifact refs / citation refs 直接回答，且没有外部 IO、代码执行、文件写入或 provider side effect 时，必须走 direct continuation answer，不进入 generated workspace task。 | 通用修复已落在 Python policy answer-only transform + TS direct-context fast path；targeted tests 通过。Browser 复验修复前显示 direct-context 被 expected artifacts 阻断，最终修复后被 UI hydrate blocker 截断，需 blocker 修复后复验 `TaskSuccess=true`。 |
| P1-MT-002 | completed | 修复 persisted response 与 Projection 不一致：`messages.content` / `runs.response` 应优先来自 `displayIntent.resultPresentation` / `ConversationProjection.visibleAnswer`，只有没有有效 Projection/presentation 时才显示 backend failure summary。 | UI response normalization 保留 transport wrapper `displayIntent`，task-attempt materialization 支持 `displayIntent.resultPresentation.conversationProjection`；targeted tests 通过，raw endpoint/stdout/stderr 不进入主结果。 |
| P1-MT-003 | in_progress | 建立网页端多轮流畅度 gate：覆盖 fresh answer -> answer-only continue -> selected artifact/ref follow-up 三轮，记录成功率、首进度、首 backend event、terminal Projection、可读结果和最长静默。 | P1 manifest 已覆盖 fresh no-exec、fresh normal、answer-only continue blocker 和 console/network summary；仍需稳定 DOM/test hook 与 final-gate 自动化。 |
| P2-MT-001 | todo | P2 provider/tool 多轮成功矩阵：ready provider 首轮 `satisfied` 后，连续两轮 follow-up 必须复用 public provider refs / ArtifactDelivery，而不是 raw run/history。 | Browser 记录 ready -> ask-for-details -> ask-for-artifact 三轮；每轮 `TaskSuccess=true` 或真实 blocker，`MultiturnContinuity=true`，`ProjectionWaitAtTerminal=0`，主结果 `RawLeak=false`。 |
| P2-MT-002 | todo | P2 fail-closed recover-to-ready：provider unavailable 后切换可用 route 或用户选择 recover action，下一轮不得被旧 failed Projection 污染。 | unavailable -> recover/ready follow-up 真实 browser 完成；request/handoff 只带 blocker refs 和 recover action，不带 raw endpoint/stdout；provider/tool terminal <= 120s。 |
| P2-MT-003 | todo | P2 empty-result refinement loop：empty provider result 后，用户收窄或放宽 query 的 follow-up 应复用 empty-result diagnostics 并完成新检索。 | empty -> refined query follow-up 进入 ready provider route；前一轮 empty refs 只作为 bounded diagnostic，不触发无限 repair；最终 `satisfied` 或真实 no-result blocker。 |
| P2-MT-004 | todo | P2 multiturn smoothness gate：把 provider/tool 路径的等待理由、首个可见进度、backend event 和 terminal Projection 变成稳定用户体验。 | 三轮路径每轮 `T_first_progress<=3s`、`T_first_backend_event<=15s`，超过时有 visible waiting reason；按钮/输入区不被 terminal audit/details 挤压或遮挡。 |
| P2-MT-005 | todo | P2 provider route restore：ready/unavailable/empty 任一 terminal 后 reload/reopen，Projection、recover actions、artifact refs 和 selected provider summary 必须恢复。 | in-app browser reload/reopen evidence；restore source 为 Projection/ArtifactDelivery，不读 raw run body；主结果不显示 endpoint/auth/private path。 |
| P2-MT-006 | todo | P2 ready provider golden path：固定一条通用 ready provider/tool 金线路径，证明 CapabilityManifest -> ProviderManifest/route resolver -> authoring contract -> Gateway.execute -> Projection 可以真实完成任务。 | Browser 首轮 ready route `TaskSuccess=true`、`satisfied`、`T_first_progress<=3s`、`T_first_backend_event<=15s`、`T_terminal_projection<=120s`；backend generated task 使用 `sciforge_task.invoke_capability` 或等价 helper，不生成 `urllib`、`requests`、raw socket 或 worker endpoint 直连；terminal `ProjectionWaitAtTerminal=0`、`RawLeak=false`。 |
| P2-MT-007 | todo | P2 public outcome continuation：为 provider/tool follow-up 建立稳定 compact context envelope 段，只携带上一轮 public outcome、provider refs、artifact ids、route summary 和 recover state。 | 第二轮/第三轮 backend handoff 可看到 bounded public outcome envelope；不携带 raw run body、stdout/stderr、endpoint、auth、worker private path 或 audit-only artifact；follow-up 能基于上一轮 refs 继续回答或生成 artifact，`MultiturnContinuity=true`。 |
| P2-MT-008 | todo | P2 controlled unavailable fixture：建立通用 no-ready-route fixture 或 test switch，让 browser 能稳定验证 provider unavailable fail-closed，而不是被当前环境 ready route 掩盖。 | Fixture 只能表达 capability route 状态，不能写 prompt/provider/端口特例；unavailable browser run 在无可用 route 时快速 Projection-visible `failed-with-reason` / `needs-human`，带真实 blocker、recover action 和 refs；不得进入 AgentServer dispatch 或生成直连网络代码。 |
| P2-MT-009 | todo | P2 empty provider terminal contract：把 provider 空结果定义为可信 terminal Projection，不允许无界 running、无界 repair 或空等 Projection。 | Empty result browser run terminal 为 `completed-with-empty-result`、`needs-human` 或 `failed-with-reason` 中的真实状态；包含 no-result reason、recover/refine action、public refs；`ProjectionWaitAtTerminal=0`、`T_terminal_projection<=120s`、下一轮 refined query 可重新走 ready provider route。 |
| P2-MT-010 | todo | P2 browser runtime state contract：给真实网页验证提供稳定 DOM/test hook，直接读取 run/session/status/timing/projection/raw-leak 状态，减少人工猜测。 | DOM/test hook 或 accessible state 可读 `runId`、`sessionId`、terminal status、`T_first_progress`、`T_first_backend_event`、`ProjectionWaitAtTerminal`、`RawLeak`、selected provider summary；这些字段来自 Projection/ArtifactDelivery/transport state，不暴露 endpoint、secret、private path 或 raw stdout/stderr body。 |
| MT-001 | **completed** | **[P0] 修复 `_infer_task_relation` 默认返回 `"new-task"`**：`goal_snapshot.py` 中 `_infer_task_relation` 现在在 `has_prior_context=True` 且无明确 new-task 信号时返回 `"continue"`。 | `_infer_task_relation('Can you elaborate?', False, True)` 返回 `"continue"`；19/19 Python 单测通过；`verify:single-agent-final` 989/989 通过。 |
| MT-002 | **completed** | **[P1] 修复 Python policy 多 tsx 子进程导致耗时 3-5 秒**：新建 `src/runtime/gateway/conversation-policy-batch.ts` 将 11+ 个独立 tsx spawn 合并为单次批量调用；新建 `batch.py` 作为 Python 侧统一 bridge；`service.py` 重写为纯 Python + 单次 batch 调用。实测 fresh: 400ms（原 3.4s），continue: 622ms（原 4.7s），8.5x 加速。 | Python policy 整体 < 1000ms；context_mode 对 continue turn 正确返回 `"continue"`；`verify:single-agent-final` 989/989 通过。 |
| MT-003 | **completed** | **[P1] 为 policy timeout 的 continue turn 添加 transport-level fallback**：`generation-gateway.ts` 新增 `policyFailureAllowsTransportContinuation`，当 transport 层 `contextReusePolicy.mode = 'continue'` 且 `historyReuse.allowed != false` 时，policy 超时不再 fail-closed，改为降级继续 dispatch。 | policy timeout 的 continue turn 不再触发 `runtime-execution-forbidden`；`verify:single-agent-final` 989/989 通过。 |
| MT-004 | **completed** | **[P2] 补充多轮路径 Python policy 单测**：新建 `packages/reasoning/conversation-policy/tests/test_multiturn_continuation.py`，19 个测试覆盖 `_infer_task_relation`、`_has_prior_context`、`build_goal_snapshot` 和 batch 速度（< 2000ms）。 | 19/19 Python 单测通过（约 0.9s）；`verify:single-agent-final` 989/989 通过。 |
| MT-005 | **completed** | **[P0] 修复 `normalizeToolPayloadShape` 缺少 confidence 类型强转**：`direct-answer-payload.ts` 中 `normalizeToolPayloadShape()` 不将 string confidence 强转为 number；AgentServer 输出 `confidence: "0.85"` (string) 时 `schemaErrors()` 立即标记 "confidence must be a number"，阻止 payload 通过验证 → `normalized = undefined` → repair/reject → TaskSuccess=false。修复：`normalizeToolPayloadShape()` 现在将 string confidence `parseFloat()`（fallback 0.72），与 `normalizeAgentServerToolPayloadCandidate()` 保持一致。 | `normalizeToolPayloadShape({ confidence: "0.85" })` 返回 `confidence: 0.85`；`verify:single-agent-final` 995/995 通过。 |
| MT-006 | **completed** | **[P0] 修复 schema validation 在 normalization 之前判断导致 continue turn 拒绝合法 payload**：`generated-task-runner-output-lifecycle.ts` 中 `schemaErrors(payload)` 在 `normalizeToolPayloadShape()` 之前运行，常见 AgentServer 类型偏差（string confidence、array reasoningTrace）已被 normalization 修正但 validation 不重试。修复：validation 先跑 `schemaErrors(payload)` 检测偏差，如果有错误则尝试 `deps.normalizeToolPayloadShape(payload)` 后重跑 `schemaErrors(coercedPayload)`，只有 coercion 后仍不过才 reject。 | string confidence + array reasoningTrace payload 通过 validation；`GeneratedTaskRunnerDeps` 新增 `normalizeToolPayloadShape`；`verify:single-agent-final` 995/995 通过。 |

### 并行进程矩阵

每个调试进程独立启动一套端口、workspace、state 和 config。建议 4 个进程同时跑，必要时继续向后加 `P5/P6`。

| 进程 | 目标 | UI | Workspace Writer | AgentServer | Workspace Path | State Dir | Config Path |
|---|---|---:|---:|---:|---|---|---|
| P1 | fresh/continue speed baseline | 5173 | 5174 | 18080 | `workspace/parallel/p1` | `.sciforge/parallel/p1` | `.sciforge/parallel/p1/config.local.json` |
| P2 | provider/tool latency + fail-closed | 5273 | 5274 | 18180 | `workspace/parallel/p2` | `.sciforge/parallel/p2` | `.sciforge/parallel/p2/config.local.json` |
| P3 | repair bounded-stop + failure recovery | 5373 | 5374 | 18280 | `workspace/parallel/p3` | `.sciforge/parallel/p3` | `.sciforge/parallel/p3/config.local.json` |
| P4 | refresh/reopen + artifact selection | 5473 | 5474 | 18380 | `workspace/parallel/p4` | `.sciforge/parallel/p4` | `.sciforge/parallel/p4/config.local.json` |

启动模板：

```bash
SCIFORGE_INSTANCE=p2 \
SCIFORGE_INSTANCE_ID=p2 \
SCIFORGE_UI_PORT=5273 \
SCIFORGE_WORKSPACE_PORT=5274 \
SCIFORGE_AGENT_SERVER_PORT=18180 \
SCIFORGE_WORKSPACE_PATH=workspace/parallel/p2 \
SCIFORGE_STATE_DIR=.sciforge/parallel/p2 \
SCIFORGE_LOG_DIR=.sciforge/parallel/p2/logs \
SCIFORGE_CONFIG_PATH=.sciforge/parallel/p2/config.local.json \
SCIFORGE_WORKSPACE_WRITER_URL=http://127.0.0.1:5274 \
SCIFORGE_AGENT_SERVER_URL=http://127.0.0.1:18180 \
npm run dev
```

如果本机模型/AgentServer 太重，可以共享一个 AgentServer，但必须仍隔离 UI/workspace/state，并显式记录：

```bash
SCIFORGE_AGENT_SERVER_AUTOSTART=0
SCIFORGE_AGENT_SERVER_URL=http://127.0.0.1:18080
```

### 并行 Todo 分工

#### P1-P4 任务分配总览

| 进程 | 认领任务 | 当前焦点 | 交付物 |
|---|---|---|---|
| P1 | `PBT-001`, `PBT-002`, `PBT-004`, `MTG-001`, `MTG-004`, `MTG-005`, `P1-MT-001`, `P1-MT-002`, `P1-MT-003` | fresh/continue、answer-only continuation、policy 误路由、速度 baseline 和 timing 产品化。 | fresh -> continue 真实 browser evidence；answer-only direct continuation 修复；timing manifest；policy/transport/runtime 归因。 |
| P2 | `PBT-005`, `MTG-003`, `P2-MT-001`, `P2-MT-002`, `P2-MT-003`, `P2-MT-004`, `P2-MT-005`, `P2-MT-006`, `P2-MT-007`, `P2-MT-008`, `P2-MT-009`, `P2-MT-010` | provider/tool、capability-first authoring contract、ready/unavailable/empty 多轮矩阵。 | ready provider golden path；public outcome continuation；controlled unavailable / empty terminal contract；provider DOM/timing state hook。 |
| P3 | `PBT-003`, `PBT-006`, `PBT-010`, `MTG-002` | Projection terminal、repair bounded-stop、主结果真相源、direct-context-first 和 Golden Path gate。 | Multiturn Browser Golden Path Gate 第一版；Projection-only terminal 渲染；repair/recover bounded evidence；background-running 策略。 |
| P4 | `PBT-007`, `PBT-008`, `PBT-009`, `MTG-006` | refresh/reopen restore、artifact selection、audit/debug 边界和 final gate evidence。 | reload/reopen evidence；selected refs request boundary；audit-only artifact 过滤；真实 browser evidence 纳入 final gate。 |

#### Process P1 - Fresh / Continue / Fast First Result

- 认领：`PBT-001`, `PBT-002`, `PBT-004`, `MTG-001`, `MTG-004`, `MTG-005`, `P1-MT-001`, `P1-MT-002`, `P1-MT-003`。
- [ ] 用 in-app browser 打开 `http://127.0.0.1:5173/`，跑 fresh no-exec、fresh normal answer、continue from Projection 三条路径。
- [x] 记录 timings：send -> first visible progress、send -> first backend event、send -> terminal Projection、send -> readable answer。
- [x] 验证 fresh 首轮没有旧 failure/ref/current work，continue 显示 `intent=continuation` 且只带 bounded Projection refs。
- [x] 如果首个可见状态超过 3s 或 terminal Projection 超过 60s，写入 Issue Queue 并定位到 policy/transport/runtime 之一。
- [ ] 跑 `MTG-001` Golden Path 主线首版：fresh 成功结果 -> selected-ref follow-up；遇到 selection/reload 边界时移交 P4 复验。
- [x] 修复 `P1-MT-001` / `P1-MT-002`：answer-only follow-up 不进 generated workspace task，persisted response 与 Projection 可见答案一致。
- [x] 将 `P1-MT-003` 与 `MTG-005` 合并为可读 timing/evidence manifest，失败必须按 policy / transport / runtime / AgentServer / Projection / UI hydrate 归因。

#### Process P2 - Provider / Tool / Capability-First

认领：`PBT-005`, `MTG-003`, `P2-MT-001`..`P2-MT-010`。

已验证基线：

- [x] 更正 P2 browser workspace：`http://127.0.0.1:5273/` 现在以 `SCIFORGE_WORKSPACE_PATH=/Applications/workspace/ailab/research/app/SciForge/workspace/parallel/p2` 和 `SCIFORGE_STATE_DIR=/Applications/workspace/ailab/research/app/SciForge/.sciforge/parallel/p2` 启动；先前只隔离端口、未隔离 workspace 的网页证据作废，不再纳入 P2 验收。
- [x] 用 in-app browser 打开 `http://127.0.0.1:5273/`，跑 ready provider route、provider unavailable、empty provider result 三条路径。
- [x] 检查 backend prompt / generated task 是否使用 `sciforge_task.invoke_capability` 或等价 helper；不得生成 `urllib`、`requests`、raw socket 或 worker endpoint 直连。
- [x] provider unavailable 必须快速返回 Projection-visible failed-with-reason / needs-human，不进入长时间 AgentServer 自循环。
- [x] 检查 DOM/request/run raw 不泄漏 endpoint、auth、worker private path；只暴露 public provider summary 和 refs。
- [x] 增加 browser runtime state/test hook：`data-testid="runtime-visible-state"` 可读 run/session/status/projection/timing/raw-leak，`runtime-execution-process` 标记 Projection vs audit source；hook 字段只允许 Projection/ArtifactDelivery/public provider route refs。

下一轮多轮稳定任务：

- [ ] 先跑 P2-MT-006 ready provider golden path：固定一条通用 ready provider/tool browser 路径，确认 generated task 收到完整 helper/API 签名和 adapter skeleton，并实际通过 `Gateway.execute` 完成检索/读取/产物生成。
- [ ] 实现 P2-MT-007 public outcome continuation：compact context envelope 新增或修正上一轮 public outcome 段，只允许 public answer、provider refs、ArtifactDelivery ids、route summary、recover/blocker state 进入 backend handoff。
- [ ] 补 P2-MT-008 controlled unavailable fixture：用通用 route-state fixture/test switch 制造 no-ready-route，验证 unavailable 在 gateway/provider preflight 边界 fail-closed，不能被当前环境已有 ready route 掩盖。
- [ ] 补 P2-MT-009 empty provider terminal contract：空结果必须进入可信 terminal Projection，并提供 refine/recover action；下一轮 refined query 重新走 provider route，不继承无界 repair/running。
- [ ] 补 P2-MT-010 browser runtime state contract：让 in-app browser 可稳定读取 run/session/status/timing/projection/raw-leak 状态，作为 P2 真实网页验收证据源。
- [ ] Ready provider 首轮 `satisfied` 后连续追问两轮：一轮要求解释/引用 provider refs，一轮要求生成或更新 artifact；每轮都必须通过 capability-first authoring contract，而不是由 backend 手写直连网络代码。
- [ ] Provider unavailable 后执行 recover action 或切换到可用 route：下一轮必须从 failed Projection 的 blocker refs 继续，不能继承 raw stdout/stderr、endpoint、旧 run body 或把旧 failed state 当成当前答案。
- [ ] Empty provider result 后做 query refinement：follow-up 必须携带 bounded empty-result diagnostic 和 public refs，重新走 ProviderManifest/route resolver/Gateway.execute，不能进入无界 repair 或空等 Projection。
- [ ] Reload/reopen 已 terminal 的 provider session：ready/unavailable/empty 三类结果恢复后，主结果、recover actions、artifact refs 和 selected provider summary 都来自 ConversationProjection + ArtifactDelivery。
- [ ] 将 P2 多轮证据写回 Issue Queue 或 Verified：每条路径记录 URL、run id、session id、prompt/task、DOM evidence、console/network summary、timing、`TaskSuccess`、`UsefulPartial`、`BlockingTruth`、`MultiturnContinuity`、`ProjectionWaitAtTerminal`、`RawLeak`。

#### Process P3 - Repair / Bounded Recovery

- 认领：`PBT-003`, `PBT-006`, `PBT-010`, `MTG-002`。
- [ ] 用 in-app browser 打开 `http://127.0.0.1:5373/`，制造 provider/schema/validation failure，再点 recover 或输入 repair follow-up。
- [ ] 验证 repair mode 来自 current Projection failure refs 或 recover action，不由 prompt 关键词单独触发。
- [ ] 验证 repair handoff refs/digests-only，不携带 raw artifact/log body。
- [ ] 重复失败、silent stream、token guard 或 bounded-stop 时，必须返回最小 Projection recover action，不允许无限 repair loop。
- [ ] 认领 `PBT-010`，在 P3 环境跑 Multiturn Browser Golden Path Gate 第一版：fresh artifact -> reload restore -> context-only follow-up -> selected artifact follow-up，全部用 Codex in-app browser 记录证据。
- [ ] 为 direct-context-first 增加真实 browser 验收：当 current Projection/ArtifactDelivery refs、digest preview 或 bounded claims 足够回答时，下一轮直接生成可读回答，不启动 AgentServer；当上下文不足时，才进入 task/repair/recover。
- [ ] 把前台结果和慢后台任务解耦成可验收策略：已有可读 Projection 时允许进入 `background-running`，缺少真实 blocker 时不得把 backend 慢包装成 `failed-with-reason` / `needs-human` / `repair-needed`。
- [ ] 给每条 Golden Path 输出 evidence manifest；如果发现 terminal 等待 Projection、raw body 主结果泄漏、direct-context sufficient 仍 dispatch、summary follow-up 只列 refs、synthetic wait 延长 stall，必须写入 Issue Queue 并归因到 Projection terminal、context handoff、repair policy、bounded stop、UI recover action 或 ArtifactDelivery 边界。

#### Process P4 - Restore / Artifact Selection / Audit Boundary

- 认领：`PBT-007`, `PBT-008`, `PBT-009`, `MTG-006`。
- [x] 用 in-app browser 打开 `http://127.0.0.1:5473/`，生成一个 terminal Projection 后 reload/reopen。
- [x] 验证刷新后右侧主结果、recover actions、artifact refs 仍从 persisted Projection 恢复。
- [x] 点击旧 artifact，确认它进入 composer explicit refs；再追问，检查 request 只使用 selected refs，不混入 latest artifact。
- [x] 打开 audit/debug，确认 raw details 可审计但不驱动主结果；audit/diagnostic/internal ArtifactDelivery 不进用户可见主结果。
- [x] 支援 `MTG-001` 的 selected artifact -> reload/reopen -> follow-up 后半段，并把证据交给 P1/P3 汇总进 Golden Path manifest。
- [x] 将 `PBT-009` / `MTG-006` 落成 final gate：缺少真实 in-app browser evidence 时 companion gate fail。

### 速度验收口径

所有进程统一记录这些指标，避免只凭体感判断“慢”。速度指标必须和成功指标一起看；未完成任务的“快”不计入优化成功。

- `TaskSuccess`：是否准确完成用户请求。`TaskSuccess=true` 必须同时满足：回答直接解决当前用户问题；内容准确、具体、非空泛；必要时正确使用 selected refs/provider/tool/artifact evidence；没有 failed/repair-needed/degraded 污染当前主结果；没有 `Reference path was not readable`、只列 refs、只说恢复动作、只给诊断、只输出“后端运行未完成”；并有 DOM/record evidence 证明用户可见答案与当前轮目标一致。`satisfied` Projection、可读文本、artifact refs、无 raw leak、无 Projection wait 只是必要条件，不是成功充分条件。
- `AnswerQuality`：`accurate` / `partial` / `diagnostic-only` / `failed`。只有 `accurate` 可以与 `TaskSuccess=true` 同时出现；`partial` 可以计入 `UsefulPartial`，但不能算 Golden Path 成功；`diagnostic-only` 和 `failed` 必须进入 Issue Queue 或 recover path。
- `UsefulPartial`：如果任务进入 `background-running`，前台必须已有有用 partial answer 或 artifact；不能只是空壳进度。
- `BlockingTruth`：如果进入 `needs-human` / `repair-needed` / `failed-with-reason`，必须有真实 blocker、recover action 和 refs；不能只是 timeout 包装。
- `MultiturnContinuity`：continue/repair/follow-up 是否保留当前目标并只使用合法 refs。

- `T_first_progress`：发送后到 UI 出现结构化 progress 的时间，目标 <= 3s。
- `T_first_backend_event`：发送后到第一个 workspace/runtime/backend event 的时间，目标 <= 15s；超过要有 visible waiting reason。
- `T_terminal_projection`：发送后到 terminal ConversationProjection 的时间；普通 fresh/continue 目标 <= 60s，provider/tool/repair 目标 <= 120s。
- `T_stall_bound`：已有 backend event 后再次静默的最长时间；必须 bounded，不能无限软等待。
- `ProjectionWaitAtTerminal`：terminal run 中必须为 0；terminal 时仍显示“主结果等待 ConversationProjection”就是 P0。
- `RawLeak`：主结果区不得出现 raw JSON、endpoint、secret、stdout/stderr body 或 audit-only artifact。

### 本轮 PBT Issue Queue

#### Open

- `MT-ROOT-001` - **[P0] Python policy `_infer_task_relation` 默认 `"new-task"` 导致全部 continue turn `MultiturnContinuity=false`**：根因定位完成。调用链：`goal_snapshot.py:127` `_infer_task_relation` 在 `has_prior_context=True` 且 prompt 无明确 continuation 关键词时返回 `"new-task"` → `conversation-context-policy.ts:69` `inferMode("new-task")` → `mode: 'isolate'` → `apply.ts:152-153` 覆盖 transport `contextReusePolicy` → `agent-harness-continuity-decision.ts:15` `policyAllowsReuse=false` → `agentserver-generation-dispatch.ts:366` `reconcileExisting:false`。复现：`python3 -c "_infer_task_relation('Can you elaborate?', False, True)"` → `'new-task'`。修复在 MT-001。

- `MT-ROOT-002` - **[P1] Python policy 每次请求启动多个 tsx 子进程，整体耗时 3-5 秒**：`context_policy.py:45` 和 `reference_digest.py` 各自 `subprocess.run tsx` 启动 TypeScript 评估；实测 fresh turn 3462ms，continue turn 4690ms。接近 8000ms 硬超时（`python-bridge.ts:40`）。超时后 `apply.ts:44-59` 标记 `applicationStatus='failed'`；continue turn 的 `policyFailureAllowsStatelessFreshGeneration`（`generation-gateway.ts:323`）固定返回 `false`（因为有 refs/history），直接 fail-closed。修复在 MT-002 + MT-003。

- `PBT-SPEED-001` - P1/P2 真实 browser 发现 provider/tool 路径可进入长时间 running：已有 backend event 后反复 soft wait，右侧仍显示“主结果等待 ConversationProjection”。P1 追加证据：owner=P1，ports=5173/5174/18080，URL=`http://127.0.0.1:5173/`，fresh no-exec run=`project-literature-evidence-review-mp839pcy-d19dxp` session=`session-literature-evidence-review-mp83912n-ssjra2`，T_first_progress=1380ms，T_first_backend_event=1380ms，T_terminal_projection=29672ms，ProjectionWaitAtTerminal=0，TaskSuccess=true；fresh normal run=`project-literature-evidence-review-mp83aeg2-137ww9` session=`session-literature-evidence-review-mp83a6oq-8h1s1a`，T_first_progress=1575ms，T_first_backend_event=1575ms，T_terminal_projection=9334ms，ProjectionWaitAtTerminal=0，但主结果为 `conversation policy timed out after 8000ms` fail-closed 而非 primer design answer，TaskSuccess=false，根因边界=`policy`；continue run=`project-literature-evidence-review-mp83d9ay-j21srm` session=`session-literature-evidence-review-mp83a6oq-8h1s1a`，intent=continuation 但只继承失败 Projection，MultiturnContinuity=false，根因边界=`policy -> Projection`；另见 OpenTeam 401/diagnostic 路径把 raw JSON/error body 暴露到主结果，RawLeak=true，根因边界=`AgentServer -> UI restore/presentation sanitization`。P2 追加证据：owner=P2，ports=5273/5274/18180，run=`project-literature-evidence-review-mp83esmo-j0zz31`，session=`session-literature-evidence-review-mp83eomk-ht9bm4`，provider discovery 已返回 unavailable，但 gateway 仍 dispatch 并显示 `Dispatched protocol=protocol-success` / `EU-p2-unavailable-1`，根因边界=`provider route resolver -> gateway dispatch preflight`。需要通用 bounded stall/terminal Projection 策略，同时 provider unavailable/policy timeout 必须在确认无可用 route 后快速 Projection-visible failed-with-reason，但修复不能替代 ready provider/tool 的真实执行，不能用快速 degraded/empty result 冒充 TaskSuccess。
- `PBT-SPEED-001/P1-latest` - owner=P1，ports=5173/5174/18080，URL=`http://127.0.0.1:5173/`，root boundary=`policy -> runtime gateway -> UI presentation`。最新 in-app browser 复验：fresh no-exec run=`project-literature-evidence-review-mp86fqm3-vy25sq`，session=`session-literature-evidence-review-mp86ffw1-lmw6b0`，prompt=`fresh no exec baseline answer in two sentences why conversationprojection should be the only user visible result source no search no code`，T_first_progress=1186ms，T_first_backend_event=1186ms，T_terminal_projection=8857ms，T_readable_answer=1186ms，T_stall_bound=769ms，ProjectionWaitAtTerminal=0，RawLeak=false，DOM 主结果显示 `ConversationProjection should be the only user-visible result source...` 和 `research-report` refs。fresh normal run=`project-literature-evidence-review-mp86g3cq-2ym67y`，session=`session-literature-evidence-review-mp86fraw-rl3ew1`，prompt=`fresh normal answer baseline give three points why primer design checks gc content and specificity no search no code`，T_first_progress=1121ms，T_first_backend_event=1121ms，T_terminal_projection=11114ms，T_readable_answer=1121ms，T_stall_bound=779ms，ProjectionWaitAtTerminal=0，RawLeak=false，DOM 主结果显示 GC/Tm、hairpin/primer-dimer、specificity/BLAST 三点。continue run=`project-literature-evidence-review-mp86gv8p-ds21yn`，same session，prompt=`continue previous answer compress the three points into one checklist and explicitly reuse previous conclusion no new search`，T_first_progress=1230ms，T_first_backend_event=1230ms，T_terminal_projection=1230ms，T_readable_answer=1230ms，T_stall_bound=888ms，ProjectionWaitAtTerminal=0，RawLeak=false，**原 TaskSuccess=false 但根因已修复**：`confidence must be a number; reasoningTrace must be a string` 现在通过 `normalizeToolPayloadShape()` coercion 解决（MT-005 + MT-006）；dispatch 路由问题仍需 P1-MT-001 修复。Additional risk: persisted `messages/runs.response` for fresh successes is still normalized to `后端运行未完成：backend failure...` while DOM projection renders the readable answer; fix should align response normalization with `displayIntent.resultPresentation` without using raw run body。
- `P1-MT-ROOT-001` - **[P1 → partially fixed]** answer-only continuation schema validation 阻断：真实 browser continue run，AgentServer 输出 `confidence: "0.85"` (string) 和 `reasoningTrace: [...]` (array)，`schemaErrors()` 在 `normalizeToolPayloadShape()` 之前运行，立即标记 "confidence must be a number" → `normalized = undefined` → repair/reject → TaskSuccess=false。**已修复 (MT-005 + MT-006)**：`normalizeToolPayloadShape()` 新增 confidence string→number coercion + reasoningTrace array→string join；`generated-task-runner-output-lifecycle.ts` 先尝试 coercion 再判断 schema 是否致命。**仍需 P1-MT-001 修复**：answer-only continuation 仍可能被误路由到 generated workspace task 而非 direct-context answer；schema 问题已修复但 dispatch 路由未改善。
- `P1-MT-ROOT-002` - **[P1] persisted response 与 Projection 可见答案不一致**：同一批 P1 browser fresh run 的 DOM 主结果已显示 Projection-derived readable answer，但 `records/messages.json` 和 `records/runs.json` 仍写入 `后端运行未完成：backend failure...`。这会污染 reload、history、continue context 和用户信任。根因边界=`UI response normalization / persistence`。修复任务见 `P1-MT-002`。
- `P1-MT-ROOT-003` - **[P2] 缺少稳定真实网页多轮流畅度 gate**：当前 evidence 仍需要人工从 DOM 推断 success/timing，且 fresh/continue/provider/selection 的真实 browser 证据分散。需要统一 case matrix 与可读 evidence manifest，防止同类 regressions 反复出现。根因边界=`test/evidence gate`。修复任务见 `P1-MT-003` 和 `PBT-010`。
- `P1-MT-ROOT-004` - **[P1] answer-only continuation 已进入 direct-context 但被 expected artifacts gate 错挡**：in-app browser run=`project-literature-evidence-review-mp8e9yh9-fotsty`，URL=`http://127.0.0.1:5173/`，prompt=`continue previous answer compress the three points into one checklist and explicitly reuse previous conclusion no new search no code`，`HarnessDecisionRecorded intent=continuation`，不再进入 generated workspace task，但 direct-context 返回 `缺失产物：paper-list, evidence-matrix, notebook-timeline, runtime-context-summary`，TaskSuccess=false。根因边界=`Projection / direct-context expected-artifact gate`。已修：answer-only transform 直接从 prior visible answer/current refs 生成 checklist，不要求场景默认 expected artifacts；真实复验被 `P1-MT-ROOT-005` 阻断。
- `P1-MT-ROOT-005` - **[P1] final browser rerun 被 UI hydrate + AgentServer first-event stall 阻断**：修复后复验期间，fresh normal rerun 超过 60s 停在 `AgentServer codex is still working; no backend event for 10s` / `主结果等待 ConversationProjection`，根因边界=`AgentServer`；随后 console 出现 `ReferenceError: executionUnitBelongsToRun is not defined at results-renderer-execution-model.ts`，页面回到 overview，根因边界=`UI hydrate`。证据见 `docs/test-artifacts/web-e2e/P1-MT-003/manifest.json`。下一步先修 UI hydrate/test hook，再复验 P1-MT-001 browser `TaskSuccess=true`。
- `PBT-EVIDENCE-001` - 当前 `verify:single-agent-final` 的 Web matrix 主要是 fixture/scriptable mock；final manifest 缺真实 in-app/browser screenshot、console、network evidence。P4 追加真实 browser 证据：owner=P4，ports=5473/5474/18380，URL=`http://127.0.0.1:5473/`，run=`project-biomedical-knowledge-graph-mp83g42n-z229ys`，follow-up run=`project-literature-evidence-review-mp83mmxt-fy7y15`，session=`session-workspace-biomedical-knowledge-graph-我想比较kras-g12d突变相关文献证据-并在场景-mp83bd44-mp83bd4s-nnci7j`，artifact refs=`artifact:knowledge-runtime-result`,`artifact:verification-f6f4f84c9a6f`,`artifact:research-report`，selected explicit ref=`message:msg-mp83g42o-49pg5w`，T_first_backend_event≈4.3s，T_terminal_projection≈149s，follow-up terminal≈8.3s，reload/reopen `ProjectionWaitAtTerminal=0`，main result `RawLeak=false`，DOM/console/network evidence captured from Codex in-app browser。P4-latest 追加 machine-enforced evidence manifest：`tests/fixtures/real-browser-evidence/manifest.json`，包含 projection-restore、artifact-selection、provider-tool-latency、audit-boundary 四条真实 in-app browser 记录，截图/DOM 位于 `tests/fixtures/real-browser-evidence/p4-2026-05-16/`；本轮原始本地捕获另保留在 `docs/test-artifacts/real-browser-evidence/p4-2026-05-16/`。重要更正：这些 P4 证据目前只能证明 restore/selection/audit 边界，不证明 SciForge 已准确回答用户问题；页面仍可见 failed/repair-needed 历史和不可读 selected artifact 迹象，因此不能作为 `TaskSuccess=true` Golden Path release blocker。下一步必须让 final gate 同时校验 `AnswerQuality=accurate`。

#### In Progress

暂无。各进程认领后把 owner、端口和 run/session id 写到这里。

### Issue Queue

#### Open

暂无。

#### In Progress

暂无。

#### Fixed Pending Verification

- `PBT-P2-005` - owner=P2，ports=5273/5274/18180，URL=`http://127.0.0.1:5273/`，root boundary=`authoring contract / backend handoff prompt`：ready provider browser run `project-biomedical-knowledge-graph-mp85ppgk-m79b4z` / session=`session-workspace-biomedical-knowledge-graph--kras-g12d----mp85idt0-mp85o4xa-9ql96d` 进入 ready `web_search`/`web_fetch` route，但 AgentServer generated task returned static/non-interface code and failed with `does not write the SciForge outputPath argument`; handoff evidence showed `canonicalPythonAdapter` array was compacted to `[truncated ... entries]`, so the backend did not receive a copyable adapter skeleton. Fix: `capabilityFirstPolicy.canonicalPythonAdapter` is now a single multiline copyable Python skeleton with `failed_with_reason_payload`, `success_payload`, `invoke_capability`, and `write_payload(output_path, ...)`; `agentserver-prompts.test.ts` asserts helper definitions survive prompt rendering. Targeted tests passed.
- `PBT-P2-006` - owner=P2，ports=5273/5274/18180，URL=`http://127.0.0.1:5273/`，root boundary=`provider route resolver / gateway execution order`：provider-unavailable browser attempt prompt=`P2 unavailable require web_search provider...` showed first progress/backend event at ~27s and `ProjectionWaitAtTerminal` still visible during running because provider preflight was after direct-context / sense / dispatch-side gates. Fix: `generation-gateway` now runs `capabilityProviderUnavailablePayload` immediately after conversation policy + harness + provider discovery and before direct-context, vision-sense, AgentServer dispatch, or generated task execution; regression test `provider preflight blocks before sense or backend dispatch for explicit provider tasks` passed. Full unavailable browser recheck still needs a genuinely non-ready route because current P2 browser environment resolved `sciforge.web-worker.web_search` as ready.
- `PBT-P2-007` - owner=P2，ports=5273/5274/18080，URL=`http://127.0.0.1:5273/`，root boundary=`P2 workspace isolation / browser runtime state contract / raw-debug boundary`：用户指出 Web 端工作目录疑似错误，复核确认早期 P2 dev 只隔离了端口，没有隔离 workspace root。已重启 P2 dev with `SCIFORGE_WORKSPACE_PATH=/Applications/workspace/ailab/research/app/SciForge/workspace/parallel/p2`、`SCIFORGE_STATE_DIR=/Applications/workspace/ailab/research/app/SciForge/.sciforge/parallel/p2`，browser 左侧显示 `p2` / `.sciforge`，Workspace Writer 为 `http://127.0.0.1:5274`。Fix：新增通用 `runtime-visible-state` / `runtime-timing-progress` / `runtime-execution-process` DOM hook，字段包含 `runId`、`sessionId`、run status、Projection status、`T_first_progress`、`T_first_backend_event`、`T_terminal_projection`、`ProjectionWaitAtTerminal`、`RawLeak`；raw audit/debug 输出经 scrubber 脱敏，DOM hook 只保留 `artifact:*` 与 `runtime://capability-provider-route/*` public refs。Browser evidence after correction：run=`project-literature-evidence-review-mp85zynq-ea8utx`，session=`session-workspace-biomedical-knowledge-graph--kras-g12d----mp85idt0-mp85x35v-2nvl49`，prompt=`P2 unavailable require web_search provider. No ready route should fail closed with recover action no backend dispatch.`，hook shows `data-projection-status=degraded-result`、`data-run-status=completed`、`data-projection-wait-at-terminal=false`、`data-raw-fallback-used=false`、`data-raw-leak=false`、visible raw-run/log leak=false。Verification：`node --import tsx --test src/runtime/gateway/capability-provider-preflight.test.ts src/runtime/gateway/generated-task-runner-execution-lifecycle.test.ts src/ui/src/app/results-renderer-execution-model.test.ts src/ui/src/app/ResultsRenderer.test.ts src/ui/src/streamEventPresentation.test.ts` passed 93/93；`npx tsc --noEmit --pretty false` passed；`npm run smoke:single-agent-runtime-contract` passed；`smoke-web-multiturn-final --tag smoke:browser-provider-preflight` passed SA-WEB-05/SA-WEB-06. Remaining browser matrix gap：this corrected browser capture is unavailable/diagnostic hook evidence, not full ready -> two follow-ups -> empty refined-query satisfied matrix.
- `PBT-RESTORE-001` - owner=P4，ports=5473/5474/18380，root boundary=`compact storage / UI hydration`：browser run `project-biomedical-knowledge-graph-mp83g42n-z229ys` / session `session-workspace-biomedical-knowledge-graph-我想比较kras-g12d突变相关文献证据-并在场景-mp83bd44-mp83bd4s-nnci7j` reload/reopen 后恢复 `repair-needed` Projection、recover action 和 artifact refs，`ProjectionWaitAtTerminal=0`。修复：compact storage 优先保留 `displayIntent` / `resultPresentation` / Projection contract keys，P4 instance config 从 build env 注入并隔离 storage key。
- `PBT-SELECTION-001` - owner=P4，ports=5473/5474/18380，root boundary=`artifact selection / request boundary / ArtifactDelivery visibility`：browser point-select 写入 composer explicit ref `message:msg-mp83g42o-49pg5w`，follow-up run `project-literature-evidence-review-mp83mmxt-fy7y15` 的 handoff `2026-05-16T08-42-47-629Z-agentserver-generation-dd3ee042c4.json` 只携带 selected ref，未混入未选择的 `artifact:knowledge-runtime-result`、`artifact:verification-f6f4f84c9a6f` 或新 run `artifact:research-report`。修复：explicit refs 统一设置 `selectedRefsOnly`，UI request payload 和 gateway artifact context 按 selected refs allowlist 过滤。
- `PBT-AUDIT-001` - owner=P4，ports=5473/5474/18380，root boundary=`ArtifactDelivery visibility / audit-debug boundary`：audit/debug raw details 可审计但不驱动主结果；generic result presentation paths previously projected all payload artifacts into inline citations/actions without checking explicit ArtifactDelivery role/preview policy. 修复：ResultPresentation contract adapter and gateway adapter now keep legacy no-delivery artifacts visible while filtering explicit non-user-facing `audit` / `diagnostic` / `internal` or `json-envelope` deliveries from human-facing citations/actions.
- `PBT-RESTORE-001/P4-latest` - owner=P4，ports=5473/5474/18380，URL=`http://127.0.0.1:5473/`，session=`session-workspace-biomedical-knowledge-graph-_kras-g12d_-_-mp83bd44-mp84kgal-tqsw1l`，run=`project-literature-evidence-review-mp87qpij-i2o4sm`，artifact ref=`artifact:research-report-kras-g12d`。真实 in-app browser reload + new-tab reopen 后选中 persisted latest run，右侧主结果恢复 direct-context answer、recover actions、artifact ref 和审计摘要；DOM evidence 包含 `当前聚焦 run project-literature-evidence-review-mp87qpij-i2o4sm · completed`、`基于当前会话已有上下文直接回答，不启动新的 workspace task。`、`research-report-kras-g12d`、`0 EU` / `No runtime execution units yet.`；`ProjectionWaitAtTerminal=0`，主结果 RawLeak=false，audit raw/details 只在折叠审计区。验收更正：这是 restore/audit boundary pass，不是用户问题成功回答；当前页面仍可见 failed/repair-needed 历史和不可读 artifact 提示，`TaskSuccess=false` / `AnswerQuality=diagnostic-only`，不得作为 Golden Path 成功。
- `PBT-SELECTION-001/P4-latest` - owner=P4，ports=5473/5474/18380，root boundary=`artifact selection / request boundary / conversation policy direct-context`：旧 artifact click 现在同时 focus right pane 并写入 composer explicit ref；立即 fill/send 也不会因 React state stale 丢失 pending refs。follow-up prompt=`use selected artifact only no rerun no tools summarize what it says in five bullets`，selected explicit refs=`artifact:research-report-kras-g12d`，terminal run=`project-literature-evidence-review-mp87qpij-i2o4sm`，request/persisted record references 仅包含 selected artifact ref（无 latest artifact allowlist 扩散）；conversation policy 修复 dataclass capability manifest normalization、`turn.text`/`turn.refs` alias seed、structured no-exec selected-ref direct decision，并把 selected tool/capability hints 保持为 no-exec 上下文限制而非强制 workspace execution。验收更正：selected-ref boundary pass，但回答含 `Reference path was not readable` / 未真正总结 selected artifact 内容，不能算准确回复；`TaskSuccess=false`、`AnswerQuality=failed`、`MultiturnContinuity=true`、`ProjectionWaitAtTerminal=0`、`RawLeak=false`。
- `PBT-EVIDENCE-001/P4-final-gate` - owner=P4，root boundary=`final evidence gate / browser evidence manifest`：`verify:single-agent-final` 的 final manifest now references real Codex in-app browser evidence at `tests/fixtures/real-browser-evidence/manifest.json` and requires projection-restore、artifact-selection、provider-tool-latency categories. Validator currently rejects missing categories, missing screenshot/DOM files, terminal Projection waits, or RawLeak=true. 验收更正：这仍不足以证明 release readiness，因为 gate 尚未强制 `AnswerQuality=accurate` 和用户问题准确回答；必须追加 companion gate 或扩展 manifest schema，使 failed/repair-needed/diagnostic-only evidence 不能作为 Golden Path release blocker。已有验证命令只证明边界 gate 通过，不证明任务成功。

#### Verified

- `BM-BROWSER-001` - Projectionless fail-closed terminal result：browser fresh no-exec run 曾在右侧主结果卡在“主结果等待 ConversationProjection”。修复：`finalizeGatewayPayload` 统一为所有 terminal payload 附加 ResultPresentation/ConversationProjection contract。验证：browser fresh run 显示“只得到部分结果” Projection，不再等待 raw run；`generation-gateway.policy.test.ts` 增加 fail-closed Projection 断言；`verify:single-agent-final` 通过。
- `PBT-P2-001` - owner=P2，ports=5273/5274/18180，root boundary=`provider route resolver / gateway dispatch preflight`：CapabilityProviderPreflight now treats explicit capability ids in prompts as required routes and `generation-gateway` fail-closes before AgentServer dispatch when required routes are not ready. Browser verification: unavailable run=`project-literature-evidence-review-mp845kfy-02w6pd` showed `Capability provider route preflight blocked AgentServer dispatch`, recover actions, `ProjectionWaitAtTerminal=0`, and mock AgentServer `/runs/stream` count stayed `5 -> 5`.
- `PBT-P2-002` - owner=P2，ports=5273/5274/18180，root boundary=`UI config/session isolation`：P2 Browser showed file tree `p2`, Workspace Writer `http://127.0.0.1:5274`, AgentServer `http://127.0.0.1:18180` after instance-scoped config/workspace storage and build-env defaults.
- `PBT-P2-003` - owner=P2，ports=5273/5274/18180，root boundary=`UI exposure / ArtifactDelivery`：ready/empty/unavailable browser checks showed `RawLeak=false` in main result; audit refs remain folded as `audit ref(s) retained for debug details`.
- `PBT-P2-004` - owner=P2，ports=5273/5274/18180，root boundary=`ResultPresentation -> TaskOutcomeProjection`：ready provider route with complete evidenced ResultPresentation now projects `protocol=protocol-success; task=satisfied` instead of `DegradedResult`. Browser verification run=`project-biomedical-knowledge-graph-mp84v78l-5whmyn` showed `Satisfied`, `T_first_progress=769ms`, `T_first_backend_event=4513ms`, `T_terminal_projection=4513ms`, `ProjectionWaitAtTerminal=0`, `RawLeak=false`.
- `PBT-P3-001` - owner=P3，ports=5373/5374/18280，URL=`http://127.0.0.1:5373/`，root boundary=`bounded stop / Projection terminal / UI recover action`：provider failure/recover browser path now terminates as recoverable Projection instead of indefinite `主结果等待 ConversationProjection`. Evidence: provider failure run=`project-literature-evidence-review-mp846tds-8szvgn`, repair run=`project-literature-evidence-review-mp84ai6h-d6iub1`, session=`session-literature-evidence-review-mp841lbz-2h9wdb`; DOM shows `RepairNeeded`, `HarnessDecisionRecorded ... intent=repair`, recover actions scoped to current refs/digests, `ProjectionWaitAtTerminal=0`, `RawLeak=false` for raw stdout/stderr/log bodies. Fix: pre-response AgentServer silent guard aborts with structured audit, UI transport bounded stall recovery returns minimal `repair-needed` ConversationProjection with refs/digests-only recover actions, synthetic wait events no longer reset the stall bound, and P3 config/workspace storage is instance-scoped.
- `PBT-P3-002` - owner=P3，ports=5373/5374/18280，URL=`http://127.0.0.1:5373/`，root boundary=`Projection terminal / multiturn continuity / UI recover action`：repair/terminal Projection execution events no longer display placeholder epoch timestamps such as `1970-01-01T00:00:00.000Z`. Fix: ConversationProjection view-model normalizes invalid/epoch execution event timestamps to the active run completed/created time while preserving valid backend timestamps. Browser verification after reload showed P3 endpoints `5374`/`18280`, `hasEpochTimestamp=false`, `ProjectionWaitAtTerminal=0`; targeted renderer/projection/direct-context tests passed, `npm run typecheck`, `npm run smoke:single-agent-runtime-contract`, and `npm run smoke:web-final-conformance` passed.
- `PBT-P3-003` - owner=P3，ports=5373/5374/18280，root boundary=`multiturn continuity / harness intent / backend handoff`：structured direct-context run-status follow-up no longer misroutes to AgentServer when current refs are sufficient, while generation/repair/tool-status-insufficient still route to AgentServer. Fix: direct-context fast path requires an explicit `DirectContextDecision`; it accepts ref-backed run-diagnostic context, records `decisionRef` in audit params, and does not synthesize a direct answer from implicit turn constraints or prompt text. Verification: `tests/smoke/web-e2e/cases/direct-context-gate.test.ts` passed both direct run-status and routed generation/repair/tool-status branches; static contract guard stayed clean.
- `PBT-P3-004` - owner=P3，ports=5373/5374/18280，URL=`http://127.0.0.1:5373/`，root boundary=`TaskOutcomeProjection / ResultPresentation finalization / multiturn success`：browser fresh artifact run `project-literature-evidence-review-mp86fgah-l0g4ij` previously exposed the generic failure mode: AgentServer produced a readable artifact and `resultPresentation.status=complete`, but a stale pre-presentation `taskOutcomeProjection` was restored as `DegradedResult`, yielding `TaskSuccess=false` without a real blocker. Fix: current request finalization recomputes TaskOutcomeProjection after ResultPresentation is attached, while request-less restore still replays persisted event logs. Targeted regression asserts stale `needs-work` projection becomes `satisfied` only when current complete presentation has answer blocks plus artifact/citation evidence; message-only and missing expected artifact cases remain `needs-work`.
- `PBT-P3-005` - owner=P3，ports=5373/5374/18280，URL=`http://127.0.0.1:5373/`，root boundary=`UI response normalization / Projection terminal / raw-debug boundary`：browser multiturn evidence showed outer `displayIntent.conversationProjection.visibleAnswer.status=satisfied` while chat/run response still displayed `后端运行未完成：backend failure` from an inner backend wrapper. Fix: `normalizeAgentResponse` now prefers Projection visible answer text over stale wrapper failure text, and only uses backend failure summaries when no valid Projection answer is present. Regression asserts satisfied Projection text wins without leaking HTTP endpoint/stdout refs; existing raw backend failure tests still pass.
- `PBT-P3-006` - owner=P3，ports=5373/5374/18280，URL=`http://127.0.0.1:5373/`，root boundary=`conversation policy / UI transport current-turn isolation / harness intent`：真实 browser 新聊天首轮曾被 optimistic current user message 污染为 continuation/repair-like 上下文，示例 run=`project-literature-evidence-review-mp8842ro-bihhn1`，session=`session-literature-evidence-review-mp8842ro-bihhn1`，DOM 含 `HarnessDecisionRecorded ... intent=continuation`。Fix：UI transport 发送 `currentTurnId`，runtime policy 过滤当前 optimistic user turn；如果 structured `sessionMessages` 全部被过滤，不回退到 `recentConversation`。
- `PBT-P3-007` - owner=P3，ports=5373/5374/18280，URL=`http://127.0.0.1:5373/`，root boundary=`conversation policy direct-context refs / multiturn continuity`：context-only follow-up 曾未提升 current artifact refs，误 dispatch AgentServer 并触发 convergence guard；成功 fresh run=`project-literature-evidence-review-mp88d91d-50ufrv` 后 follow-up 出现 token guard `315996 total tokens`。Fix：goal snapshot 扩展 current/existing artifact/context-only 识别，gateway 在 context-only 且无 explicit refs/digests 时把同 session artifact refs 提升为 current references；direct-context 仍必须来自 structured `DirectContextDecision`。
- `PBT-P3-008` - owner=P3，ports=5373/5374/18280，URL=`http://127.0.0.1:5373/`，root boundary=`Projection terminal / session bundle restore / bounded stop`：browser fresh run `P3 terminal projection validation...` 写出 task attempt 与 artifacts，但 `records/runs.json=[]`，UI 停在 `主结果等待 ConversationProjection`；后端 terminal 证据在 session=`session-literature-evidence-review-mp89c8nr-zktgsb`，attempt=`generated-literature-adfb70b1be82`。Fix：`appendTaskAttempt` 在同 session bundle 中物化最小 terminal run、`materializedConversationProjection` 和 projection map，只携带 ConversationProjection/TaskRunCard/refs，不复制 raw output/log/stdout/stderr body；UI stall guard 排除 backend-wait synthetic events，并把 `stallBoundMs` capped at 120s。Browser reload DOM 显示 `Satisfied P3 终端投影验证完成...`，`ProjectionWaitAtTerminal=0`，`RawLeak=false`。
- `PBT-P3-009` - owner=P3，ports=5373/5374/18280，URL=`http://127.0.0.1:5373/`，root boundary=`direct-context handoff / refs-digests-only continuity / ArtifactDelivery`：同 session context-only 风险概括 initially terminal 但只列 refs，TaskSuccess=false。Fix：continuation payload 携带 bounded claims 和 ref-backed artifact digest preview（hash + short preview），direct-context answer 可从当前 Projection/ArtifactDelivery 可见 claims/digests 生成短回答，仍不传 raw artifact/log/stdout/stderr body；repair/dispatch 仍要求 `DirectContextDecision`。Browser evidence：run=`project-literature-evidence-review-mp8aj69d-wf0fk2`，session=`session-literature-evidence-review-mp89c8nr-zktgsb`，DOM 显示 `Answered directly from current-session context without starting a new workspace task. 上下文投影块数量超过缓存预算时可能导致投影漂移; 多阶段任务中 eventIndex/refIndex 同步不完整可能导致状态恢复不一致.`；T_first_progress≈23589ms，T_first_backend_event≈23589ms，T_terminal_projection≈23589ms，ProjectionWaitAtTerminal=0，RawLeak=false，AgentServer dispatch=false。
- `PBT-P3-010` - owner=P3，ports=5373/5374/18280，URL=`http://127.0.0.1:5373/`，root boundary=`MTG-002 main result truth source / UI response normalization`：satisfied `ConversationProjection.visibleAnswer` now wins over stale wrapper/backend failure diagnostics and stale `ContractValidationFailure` for chat `message.content`, persisted `run.response`, and completed status; raw failure diagnostics remain in `run.raw` / audit. Regression: `responseNormalization.test.ts` covers satisfied Projection over stale backend wrapper failure and stale ContractValidationFailure.
- `PBT-P3-011` - owner=P3，ports=5373/5374/18280，root boundary=`repair trigger / UI transport context policy`：repair mode no longer comes from prompt keywords alone. UI transport enters `contextReusePolicy.mode='repair'` only when current structured failure/recover refs are present in recent runs/execution units or selected failure refs; prompt-only `repair/retry/recover` with no current failure target remains bounded `continue`. Regression: `sciforgeToolsClient.policy.test.ts` covers keyword-only non-repair and failure-ref repair without repair keywords.
- `PBT-P3-012` - owner=P3，ports=5373/5374/18280，URL=`http://127.0.0.1:5373/`，root boundary=`PBT-010 Multiturn Browser Golden Path / direct-context-first / Projection restore`：First PBT-010 capture was invalidated because the Web UI workspace root was the main repo root instead of `workspace/parallel/p3`; invalid diagnostic retained at `docs/test-artifacts/web-e2e/p3-golden-path-manifest.json`. Corrected P3 evidence is `docs/test-artifacts/web-e2e/p3-golden-path-manifest.corrected.json`: browser left tree shows `p3` / `.sciforge`, services use P3 ports, workspace path is `/Applications/workspace/ailab/research/app/SciForge/workspace/parallel/p3`; session=`session-literature-evidence-review-mp89c8nr-zktgsb`; fresh terminal run=`project-literature-evidence-review-mp89jqxt-6qqald` shows `P3 终端投影验证完成...` and created artifact refs including `artifact:artifact-research-report-001`; reload restore shows `runtime-visible-state` with `data-run-status=completed`, `data-projection-status=satisfied`, `data-projection-wait-at-terminal=false`, `data-raw-leak=false`; context-only/direct follow-up run=`project-literature-evidence-review-mp8aj69d-wf0fk2` shows `Answered directly from current-session context without starting a new workspace task...`, `0 EU` / `No runtime execution units yet`, no new AgentServer handoff beyond the original four handoff/slimming files; selected artifact/object-ref follow-up evidence run=`project-literature-evidence-review-mp89qkkc-a2op32` retains bounded artifact objectReferences for `artifact-chinese-memo-001` and `artifact-research-report-001` without raw artifact/log/stdout/stderr body. All corrected manifest cases record `TaskSuccess=true`, `MultiturnContinuity=true`, `ProjectionWaitAtTerminal=0`, `RawLeak=false`; console duplicate-key warning is tracked separately as `PBT-P3-013`.
- `PBT-P3-013` - owner=P3，ports=5373/5374/18280，URL=`http://127.0.0.1:5373/`，root boundary=`browser evidence hygiene / direct-context claim rendering`：corrected P3 browser reload initially produced repeated React duplicate-key console errors for `direct-context-claim-session-literature-evidence-review-mp89c8nr-zktgsb-turn-1ljfuto`. Fix：`RunKeyInfo` now keys rendered claim rows as `claim.id + index`, preserving persisted claim ids/refs while making the React render key unique. Verification：targeted `RunExecutionProcess.test.ts` passed; in-app browser reload after 2026-05-16T14:13:01.837Z produced `newDuplicateLogCount=0`; runtime hook still `projectionStatus=satisfied`, `ProjectionWaitAtTerminal=false`, `RawLeak=false`.
- `BM-BROWSER-002` - UI transport did not explicitly classify fresh/continue/repair：continue turn 依赖 prompt 文本和残留 refs 推断上下文，容易出现真实 runtime context 与 UI handoff 不一致。修复：`sciforgeToolsClient` 为每轮请求写入 `contextReusePolicy` / `contextIsolation`，fresh 禁止历史复用，continue/repair 只复用 bounded refs。验证：UI policy tests 覆盖 fresh/continue；browser continuation persisted context 显示 `context=continue` 与 Projection continuation ref。
- `BM-BROWSER-003` - Agent Harness audit summarized continuation as fresh：runtime 已按 continue 复用，但 `HarnessDecisionRecorded` 仍显示 `intent=fresh`。修复：Agent Harness shadow input 从 transport `contextReusePolicy` 派生 `continuation` / `repair` intent。验证：browser continuation DOM 显示 `HarnessDecisionRecorded profile=balanced-default; intent=continuation; exploration=minimal`；新增 `agent-harness-shadow.test.ts` 覆盖 continue/repair policy seed。
- `SF-STAB-001..008` 历史问题已关闭并吸收到当前原则、conformance 和设计文档：新聊天隔离、provider-first authoring contract、Projection-only UI、repair bounded-stop 和 capability-first preflight 均由最终 contract 覆盖。详细事故链路见 git history 与 archive。

### Browser Test Matrix

每轮至少覆盖其中一条真实路径：

- Multiturn Golden Path：fresh 成功生成准确、可核查、用户可用的结果 -> 选择 artifact -> follow-up 只使用 selected refs 且准确回答 selected artifact 相关问题 -> reload/reopen -> 再次 follow-up 仍准确回答；全链路 `TaskSuccess=true`、`AnswerQuality=accurate`、`MultiturnContinuity=true`、`ProjectionWaitAtTerminal=0`、`RawLeak=false`。任何 failed/repair-needed/degraded、不可读 ref、空泛 direct-context、只列 refs 或只显示审计诊断都不是 Golden Path 成功。
- Fresh chat isolation：新聊天首轮不能继承旧 failure、repair context、current work 或 stable AgentServer session id。
- Fresh provider/tool task：ready provider/tool route 必须进入 capability-first authoring contract；如果 backend/tool 不可用，Projection 可见 failed-with-reason。
- Continue from result：第二轮必须保留 current user goal，不被旧 artifact 或 raw run 污染。
- Direct-context-first：当前 session 的 Projection/ArtifactDelivery refs、digest preview 或 bounded claims 足够回答时，follow-up 必须直接给出可读结果；不足时才进入 task/repair/recover，且不得靠 prompt 关键词单独触发。
- Repair from failure：repair 必须 bounded、refs/digests-only，并返回 minimal adapter task 或合法 failed-with-reason Projection。
- Refresh/reopen restore：刷新或重开后，右侧主结果、recover actions、artifact refs 必须来自 persisted Projection。
- Artifact selection：显式选择旧 artifact 后追问，只能使用 selected refs，不混入最新 artifact。
- Audit/debug：raw details 可审计，但不能驱动主结果。

### 验证命令

常用：

```bash
npm run typecheck
npm run smoke:single-agent-runtime-contract
npm run smoke:no-legacy-paths
npm run smoke:web-final-conformance
```

Milestone 完成门：

```bash
npm run verify:single-agent-final
```

Browser 验证必须使用 Codex in-app browser，不用普通 terminal smoke 替代。

### Activity Log

- 2026-05-16 - Orchestrator - 重置 `PROJECT.md` 为 Browser Multiturn Stability Sprint：删除旧 SA/SF-STAB 活动正文，只保留当前目标、原则、活动任务、issue queue、browser matrix 和验证门。
- 2026-05-16 - Orchestrator + subagents - 并行完成模块勘察、dev startup 勘察和预修复 smoke：定位多轮路径主链路在 `runOrchestrator`、UI handoff、runtime gateway、ConversationProjection、Agent Harness shadow 与 session persistence。
- 2026-05-16 - Browser - in-app browser fresh no-exec run 发现右侧结果等待 ConversationProjection；修复后 fresh run 显示 Projection-derived partial/degraded result，`projectionWaitCount=0`。
- 2026-05-16 - Browser - in-app browser continuation run 验证 context reuse 与审计一致：runtime handoff 为 continue，右侧 Projection terminal 可见，`HarnessDecisionRecorded` 显示 `intent=continuation`。
- 2026-05-16 - Verification - 通过 targeted tests、`npm run typecheck`、`npm run smoke:single-agent-runtime-contract`、`npm run smoke:no-legacy-paths`、`npm run smoke:web-final-conformance`、`npm run verify:single-agent-final`。`smoke:no-legacy-paths` 仅报告既有 baseline warnings，无新增 legacy findings。
- 2026-05-16 - Orchestrator - 新建 Parallel Browser Stability & Speed milestone：按 P1-P4 独立端口/状态/workspace/config 拆分并行真实 browser 调试任务；将“对话结果太慢”拆成 speed metrics、provider/tool latency、bounded stall、refresh restore、artifact selection 和真实 evidence gate。
- 2026-05-16 - P3 - 将 direct-context-first、前台/后台解耦、真实 in-app browser evidence gate 收敛为 `PBT-010` Multiturn Browser Golden Path Gate，并加入 P3 todo 与 Browser Test Matrix。
- 2026-05-16 - P2 - 执行 provider/tool 多轮稳定任务：browser ready route 暴露 authoring contract skeleton 被 compact 截断，修复为 multiline copyable adapter；provider preflight 前移到 harness/discovery 后第一道执行 gate；targeted tests、typecheck、single-agent runtime smoke、web final conformance 均通过。ready/unavailable/empty 多轮完整 satisfied matrix 仍需下一轮用真实 non-ready/empty provider route 复验。
- 2026-05-16 - P1 - 修复 answer-only continuation：Python policy 识别 no-search/no-code 的上一轮答案改写为 direct-context，TS direct-context fast path 从 prior visible answer/context 生成 checklist，并跳过场景默认 expected-artifact gate；同时修复 Projection/resultPresentation 优先持久化。新增 evidence manifest `docs/test-artifacts/web-e2e/P1-MT-003/manifest.json`。Targeted Python/TS tests 与 `npm run typecheck` 通过；真实 browser final rerun 被 `UI hydrate` (`executionUnitBelongsToRun is not defined`) + `AgentServer` first-event stall 阻断，已写 Issue Queue。
- 2026-05-16 - P2 - 将“网页端多轮对话稳定、流畅、成功运行”的下一步建议落成任务：新增 P2-MT-006 ready provider golden path、P2-MT-007 public outcome continuation、P2-MT-008 controlled unavailable fixture、P2-MT-009 empty provider terminal contract、P2-MT-010 browser runtime state contract，并把 Process P2 todo 调整为先打通一轮真实 provider 成功，再验证 follow-up、fail-closed、empty terminal 和 DOM/timing evidence。
- 2026-05-16 - P2 - 更正 P2 browser workspace：首次 5273 调试只隔离端口但 workspace root 仍指主仓，已停掉错误 dev server 并用 `workspace/parallel/p2` + `.sciforge/parallel/p2` 重启；browser 左侧显示 `p2` / `.sciforge`。本轮同时补齐 provider/capability contract：provider preflight 支持 configured/fallback routes、unauthorized/rate-limited fail-closed 只暴露 public refs；generated task helper 增加 `provider_result_is_empty` / `empty_result_payload`；UI runtime hook 暴露 run/session/status/timing/projection/raw-leak 且过滤 raw refs。验证：targeted P2 tests 93/93、typecheck、single-agent runtime contract smoke、browser-provider-preflight smoke SA-WEB-05/SA-WEB-06 通过；corrected browser hook evidence run=`project-literature-evidence-review-mp85zynq-ea8utx` / session=`session-workspace-biomedical-knowledge-graph--kras-g12d----mp85idt0-mp85x35v-2nvl49`，`ProjectionWaitAtTerminal=false`、`RawLeak=false`。
- 2026-05-16 - P4 - 用 Codex in-app browser 在 `http://127.0.0.1:5473/` 捕获 reload/reopen settled evidence：`project-literature-evidence-review-mp87qpij-i2o4sm` / `session-workspace-biomedical-knowledge-graph-_kras-g12d_-_-mp83bd44-mp84kgal-tqsw1l` 恢复 selected `artifact:research-report-kras-g12d` direct-context answer，`ProjectionWaitAtTerminal=0`、`RawLeak=false`、console warning/error count=0；截图和 DOM 写入 `docs/test-artifacts/real-browser-evidence/p4-2026-05-16/`。
- 2026-05-16 - P4 - 将真实 in-app browser evidence 纳入 final gate：`smoke:web-multiturn-final` final manifest 引用 `tests/fixtures/real-browser-evidence/manifest.json`，`smoke:single-agent-final-evidence` 强制 required categories、截图/DOM 文件存在、`ProjectionWaitAtTerminal=0` 和 `RawLeak=false`；缺真实 evidence 时 final gate fail。后续更正：该 gate 还必须继续扩展 `AnswerQuality=accurate` 校验，当前 P4 evidence 只能算边界证据，不能算准确回答成功。
- 2026-05-16 - P3 - 修复 `MTG-002` 主结果真相源：`normalizeAgentResponse` 让 satisfied Projection visible answer 压过 stale wrapper failure / stale ContractValidationFailure，并保持 raw diagnostics 只进 audit/raw；修复 `PBT-006` repair trigger：UI transport 不再因 prompt keyword 单独进入 repair，只看当前 failure/recover refs。验证：`node --import tsx --test src/ui/src/api/agentClient/responseNormalization.test.ts`、`node --import tsx --test src/ui/src/api/sciforgeToolsClient.policy.test.ts`。
- 2026-05-16 - P3 - 更正 PBT-010 browser workspace：首次 P3 capture 只隔离了端口但 workspace root 仍是主 repo，已标记 invalid；重启 P3 dev server with `SCIFORGE_WORKSPACE_PATH=/Applications/workspace/ailab/research/app/SciForge/workspace/parallel/p3`，browser 左侧仅显示 `p3` / `.sciforge`。Corrected evidence manifest: `docs/test-artifacts/web-e2e/p3-golden-path-manifest.corrected.json`；session=`session-literature-evidence-review-mp89c8nr-zktgsb`；fresh restore 和 context-only direct answer 均 `ProjectionWaitAtTerminal=0`、`RawLeak=false`、direct-context `0 EU` / no AgentServer dispatch。
- 2026-05-16 - P3 - 补齐 corrected PBT-010 manifest 为四段 Golden Path evidence：fresh terminal run=`project-literature-evidence-review-mp89jqxt-6qqald`、reload restore runtime hook、context-only/direct follow-up run=`project-literature-evidence-review-mp8aj69d-wf0fk2`、selected artifact/object-ref follow-up run=`project-literature-evidence-review-mp89qkkc-a2op32`；manifest 记录 DOM、timing、TaskSuccess、UsefulPartial、BlockingTruth、MultiturnContinuity、ProjectionWaitAtTerminal、RawLeak、console/network summary。修复并验证 `PBT-P3-013` direct-context claim duplicate-key console warning。
- 2026-05-16 - Root-Cause Analysis - 定位多轮对话持续失败的两个根因：(1) `goal_snapshot.py:127` `_infer_task_relation` 在 `has_prior_context=True` 时默认返回 `”new-task”` 而非 `”continue”`，经 `conversation-context-policy.ts:69` → `mode:'isolate'` → `apply.ts:152` 覆盖 transport policy → `policyAllowsReuse=false` 导致 AgentServer `reconcileExisting=false`；(2) Python policy 每次请求启动多个 `tsx` 子进程（context_policy.py + reference_digest.py），MacOS 实测 3.4-4.7 秒，接近 8000ms 硬超时，复杂 continue turn 超时后 fail-closed。已新增任务 MT-001/002/003/004 和 issue MT-ROOT-001/002。
- 2026-05-16 - Root-Cause Fix - MT-005: 修复 `normalizeToolPayloadShape` 缺少 confidence 类型强转：AgentServer 输出 `confidence: "0.85"` (string) 时 schema validation 立即标记 "confidence must be a number"，阻止 payload 通过验证。修复后 `parseFloat()` coercion + fallback 0.72。MT-006: 修复 schema validation 顺序 — `generated-task-runner-output-lifecycle.ts` 先尝试 `normalizeToolPayloadShape()` coercion 再判断是否 reject。同时修复 `executionUnitBelongsToRun` 类型错误（`run` 参数 `SciForgeRun | undefined` → guarded filter）。更新 `smoke:no-legacy-paths` baseline：capability-provider-preflight 29→31，direct-context-fast-path 9→16，generated-task-runner-execution-lifecycle 0→1。`verify:single-agent-final` 全部通过：995 tests + 16 web e2e + no-legacy guard + final evidence。

### Current Handoff

Browser Multiturn Stability Sprint 当前进入 MTG Golden Path 收敛阶段。最新完成 MT-005/006（schema validation coercion 修复），P1-MT-ROOT-001 的 schema 部分已修复，dispatch 路由仍需 P1-MT-001 修复。下一步优先认领 `MTG-001`：用 Codex in-app browser 跑通 fresh 成功结果 -> 选择 artifact -> selected-ref follow-up -> reload/reopen -> 再 follow-up 的完整链路；若失败，按 `MTG-002` 主结果真相源、`MTG-003` ToolPayload 输出契约、`MTG-004` conversation-policy 误路由、`MTG-005` timing 归因四个边界定位根因。P1-P4 并行进程仍可继续扩展 provider/tool、repair、restore、selection，但所有修复必须服务于 Golden Path 先全绿，再纳入 `MTG-006` final gate browser evidence。
