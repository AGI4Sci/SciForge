# SciForge - PROJECT.md

最后更新：2026-05-16

## 当前目标
在网页端测试、优化多轮对话机制，使得其稳定、流畅，同时优化用户在网页端的体验。所有修改必须通用；Single-Agent 多轮运行时以 `docs/SciForge-SingleAgent-Architecture.md` 为最终 contract，当前实现背景参考 `docs/Architecture.md`。

## 阅读和执行分层

本文件按三层使用，避免后续实现者被历史任务淹没：

- **第一层：方向和边界**：当前目标、重要、不变原则、`Single-Agent Runtime Final Contract Cutover` 的最终方案、阶段门和完成定义。任何实现开始前先读这一层。
- **第二层：当前实现计划**：P0-P7 的 SA-* 任务。未来直接实现最终版本时，只从这一层认领任务。
- **第三层：历史证据和稳定化日志**：旧 `CAP-*` / `PKG-*` / `GT-*` / `PSM-*` / `MEM-*` / `H022` / `SF-STAB-*` 只用于追溯问题来源和吸收遗漏灵感，不再驱动新实现。

如果第一层与旧历史任务冲突，以第一层和 [`docs/SciForge-SingleAgent-Architecture.md`](docs/SciForge-SingleAgent-Architecture.md) 为准。


## 重要
进入实现轮后，同时开启多个 sub agents，并行使用 browser/computer use 能力从网页端调试、修复，实现所有当前 SA-* 任务，并行度越高越好。完成 milestone 后更新 PROJECT.md、同步到 github，直到完成为止。一个阶段完成后，可以删掉没用的 sub agents，重启新的 sub agents，持续不间断地并行实现目标。

并行不能绕过阶段门：未完成 Inventory/Conformance guard 前，不得把旧链路伪装成最终实现。用户明确限定“只改计划/文档”时，只更新计划/文档，不启动代码实现。

当你觉得任务已经完成，或者觉得余下任务没必要做、不合理的时候，可以停下。不合理的任务你可以把它改得合理；你也可以加上新的任务。


## 不变原则

- 所有修改必须通用、可泛化到任何场景，不能在代码里面硬编码和为当前案例打补丁
- 有多种修改方案的时候，优先实现最简洁、通用的方案
- 算法相关的代码优先用Python实现，方便人类用户优化、检查算法
- 代码路径保持唯一真相源：发现冗余链路时删除、合并或降级旧链路，避免长期并行实现。
- 多轮记忆采用 Single-Agent runtime 边界：Workspace Kernel 的 append-only ledger/ref store 是可恢复事实源；AgentServer Context Core 负责 context orchestration、retrieval、compaction 和 backend handoff；agent backend 只消费 cache-aware projection/task packet 并按需读取 refs，禁止把完整历史或大文件当 prompt 记忆回灌。
- 不需要考虑旧兼容性，可以直接删除旧逻辑，然后实现最终版本，保持代码链条绝对干净
- 代码膨胀必须自动触发治理：源码文件超过 1000 行进入 watch list；超过 2000 行优先拆分；超过 3000 行视为维护风险。后续开发若让文件越过阈值，应优先抽模块、删除冗余逻辑或补拆分 TODO，而不是继续堆主文件。
- 长文件拆分必须按职责命名，不能机械切成 part1/part2；如果暂时不能完全解耦，也要拆成有语义的文件，例如 *-event-normalizer、*-runner、*-diagnostics、*-state-machine，并保持主入口只做流程编排。
- 推进项目的时候尽可能多开sub agents，并行加速推进

任何 agent 在执行本项目任务前，必须先读本文件和与任务相关的设计文档，避免凭局部代码印象破坏系统边界。
- [`docs/Architecture.md`](docs/Architecture.md)：SciForge 总体架构、Backend-first / Contract-enforced / Capability-driven / Harness-governed 方向、`src` 与 `packages` 边界。
- [`docs/SciForge-SingleAgent-Architecture.md`](docs/SciForge-SingleAgent-Architecture.md)：Single-Agent 多轮运行时最终 contract，包含 Workspace Kernel、AgentServer Context Core、Runtime Bridge、Capability Gateway、上下文防漂移、KV cache、conformance 和长期防污染边界。
- [`docs/AgentHarnessStandard.md`](docs/AgentHarnessStandard.md)：harness runtime、profile、stage hook、contract、trace、merge 规则和行为治理入口。

## 任务板

### 2026-05-16 Task：Single-Agent Runtime Final Contract Cutover

状态：active

最终方案：以 [`docs/SciForge-SingleAgent-Architecture.md`](docs/SciForge-SingleAgent-Architecture.md) 为唯一多轮 runtime contract，直接切到最终形态。不要做过渡兼容层，不保留旧 prompt builder、旧本地记忆、旧 UI raw fallback 或旧 gateway 分支作为并行路径。旧逻辑如果与最终 contract 冲突，默认删除、合并或改名迁移；只有作为审计数据读取时才允许保留，并且必须标注 audit-only。

执行说明：本节是当前唯一实现入口。本节以下旧 `CAP-*` / `PKG-*` / `GT-*` / `PSM-*` / `MEM-*` / `H022` 任务只作为历史证据；未迁入 SA-* 的旧 TODO 不再驱动实现。当前阶段不需要兼容旧行为，也不为旧测试保留 parallel path。

不变量：

- Runtime Bridge 不拥有策略：不判断用户意图、不拼 prompt、不选择 capability、不做 repair 策略。
- Workspace Kernel 是唯一可恢复事实源：append-only ledger/ref store + synchronous Projection。
- AgentServer Context Core 负责 context orchestration、retrieval、compaction、handoff 和 audit。
- Capability Gateway 对 Runtime Bridge 只暴露 `execute`；route/preflight/invoke/materialize/validate 是内部阶段。
- UI 只消费 Projection；stream delta、raw run、raw ExecutionUnit 只能进 transient/debug/audit channel。
- Direct context 只能是 AgentServer/Backend/harness policy 输出的结构化 decision，不能是 Runtime Bridge 或 UI 的关键词模板。
- 不兼容旧链路：发现旧字段、旧函数、旧测试或旧 UI 文案仍在驱动主路径时，优先删除或迁移到最终 contract。

并行工作流：

| Workstream | Owner | 范围 | 验收 |
|---|---|---|---|
| SA-KERNEL | Kernel agent | Workspace Kernel、StorageAdapter、appendEvent、Projection、retention、tombstone | C01/C02/C15 通过 |
| SA-CONTEXT | Context agent | AgentServerAdapter、buildContextRequest、DegradedHandoffPacket、SyntheticAudit、KV cache | C02/C03/C04/C05/C13 通过 |
| SA-GATEWAY | Gateway agent | Capability Gateway `execute` 收口、ProviderManifest、Worker discovery、ArtifactDelivery、scenario policy-only | C07/C08/C17/C18 通过 |
| SA-RUNTIME | Runtime agent | Declarative TurnPipeline、RunStateMachine、EventRelay、FailureNormalizer、RepairPolicy、direct-context gate | C06/C09/C10/C11/C16 通过 |
| SA-UI | UI agent | UIAction、Projection-only terminal state、ArtifactDelivery visible/audit split、legacy raw fallback 删除 | C12/C17 通过 |
| SA-CONFORMANCE | Test agent | Core Conformance Suite、no-legacy guards、browser smoke、docs smoke | C01-C18 自动化 |
| SA-WEB-E2E | Browser agent | Web 端到端多轮对话、刷新/恢复、失败/repair、artifact selection、audit export | web-multiturn-final 全部通过 |

阶段门：

1. **Inventory Gate**：先完成 SA-DEL 与 SA-CONF 的 inventory/guard，确认旧链路清单完整。
2. **Kernel/Context Gate**：先统一 Workspace Kernel 与 AgentServerContextRequest，再迁 UI 和 Gateway。
3. **Runtime/Gateway Gate**：删除 Runtime Bridge 策略分支，Gateway public API 收口到 `execute`。
4. **UI Gate**：删除 raw/projectionless 主展示 fallback，所有 terminal state 来自 Projection。
5. **Conformance Gate**：C01-C18 全部自动化后，才允许回到真实长任务压测。
6. **Web E2E Gate**：所有 Web 端到端多轮对话 smoke 通过后，才认为最终版本可用。

最终版本完成定义：

- 代码主路径中只有一套 Workspace Kernel、一个 AgentServer context contract、一个 Runtime Bridge pipeline、一个 Gateway public API、一个 Projection UI 事实源。
- 旧 `ProjectSessionMemory`、`handoffMemoryProjection`、direct-context 本地判断、capability preflight 可见阶段、projectionless UI 主展示等旧链路已经删除或标注为 audit-only migration helper。
- C01-C18 有自动化 guard，并在 `smoke:single-agent-runtime-contract` 或等价命令中可重复运行。
- Web 端到端多轮对话覆盖 fresh、continue、repair、explicit refs、artifact selection、provider unavailable、empty result、background/long run、refresh restore、audit export。
- 真实用户可见行为满足：不忘当前问题、不被旧 artifact 污染、不重复无意义 repair、不把 raw/audit/internal 内容伪装成主结果、不在 AgentServer/Gateway 不可观测时静默成功。

最终实现批次：

| 批次 | 并行任务 | 退出条件 |
|---|---|---|
| Batch 0: Inventory Freeze | SA-DEL、SA-CONF inventory | 旧链路清单完整，新增 guard 能失败地捕捉旧路径 |
| Batch 1: Kernel + Context | SA-KERNEL、SA-CONTEXT | `appendEvent` / `AgentServerContextRequest` / degraded packet contract 落地 |
| Batch 2: Runtime + Gateway | SA-RUNTIME、SA-GATEWAY | direct-context/preflight 策略分支删除，Gateway `execute` 收口 |
| Batch 3: UI Projection | SA-UI | 无 Projection 时不展示主结果，ArtifactDelivery 唯一决定可见性 |
| Batch 4: Conformance | SA-CONFORMANCE | C01-C18 全部机器化 |
| Batch 5: Web E2E | SA-WEB-E2E | web-multiturn-final 全部通过，证据 bundle 落盘 |

依赖关系和并行边界：

- Batch 0 是硬门槛：先让 no-legacy guard 能抓到旧路径，再进入大规模替换；否则实现者会把旧链路继续包一层新名字。
- SA-KERNEL 和 SA-CONTEXT 可以并行，但必须先约定 `WorkspaceKernel.appendEvent`、`ProjectMemoryRef`、`AgentServerContextRequest`、`BackendHandoffPacket` 的 canonical types；类型未冻结前只允许写 fixture/golden tests。
- SA-RUNTIME 和 SA-GATEWAY 可以并行删除策略分支，但 Runtime Bridge 只能消费 Gateway `execute` 和 AgentServer structured decision，不允许临时回调旧 preflight/direct-context。
- SA-UI 可以先补 Projection fixture、ArtifactDelivery fixture 和 no-legacy guard；真正删除 raw fallback 必须等 `ConversationProjection` 主路径可用。
- SA-WEB-E2E 从 Batch 0 就可以搭 harness、fixture server 和 evidence writer，但只有 Batch 5 才允许把它作为最终通过门；中间失败必须反馈到 SA-KERNEL/SA-CONTEXT/SA-RUNTIME/SA-UI，而不是在浏览器测试里特判。

最终验证命令目标：

- `npm run smoke:single-agent-runtime-contract`：只跑最终 runtime C01-C18 contract，不保护旧路径。
- `npm run smoke:web-multiturn-final`：跑真实 Web 多轮矩阵，覆盖 Projection restore、artifact selection、repair、degraded、audit export。
- `npm run verify:single-agent-final`：串联 typecheck、核心单测、C01-C18、Web E2E 和 no-legacy guard；这是最终版本唯一完成门。
- `docs/test-artifacts/single-agent-final/manifest.json`：最终验收证据总索引，引用 conformance、Web E2E、console logs、screenshots、session bundles 和 failure/improvement notes。

#### 架构任务

- [x] SA-ARCH-01：新增最终 runtime contract 文档 [`docs/SciForge-SingleAgent-Architecture.md`](docs/SciForge-SingleAgent-Architecture.md)，并把旧 `ProjectSessionMemory.md` 内容吸收进去。
- [x] SA-ARCH-02：更新 [`docs/README.md`](docs/README.md) 和 [`docs/Architecture.md`](docs/Architecture.md)，将 `SciForge-SingleAgent-Architecture.md` 设为最终 runtime contract，`Architecture.md` 降级为当前实现背景。
- [x] SA-ARCH-03：删除旧 [`docs/ProjectSessionMemory.md`](docs/ProjectSessionMemory.md)，避免文档第二真相源。
- [ ] SA-ARCH-04：把旧 `CAP-*` / `PSM-*` / `MEM-*` 未完成 TODO 全部迁移到本节；不能迁移的旧 TODO 直接关闭或删除，禁止继续作为兼容 backlog。
- [x] SA-ARCH-05：将最终文档的 C01-C18 固化为机器可跑的 conformance guard，并接入 `smoke:all` 或专门 `smoke:single-agent-runtime-contract`。Evidence：`npm run smoke:single-agent-runtime-contract`、`npm run verify:single-agent-final` 通过。
- [ ] SA-ARCH-06：旧历史任务迁移完成后，把本文件中 2026-05-14/2026-05-15 历史长段移入 `docs/archive/PROJECT-history-2026-05-14-15.md` 或删除，只保留当前 SA-* 任务板和稳定化状态。
- [ ] SA-ARCH-07：为每个 SA-* 任务补 `evidence` 字段或完成备注模板，记录修改文件、验证命令、失败边界和不能采用的兼容方案。

#### P0：删除旧链路和命名漂移

- [ ] SA-DEL-01：把 `src/runtime/project-session-memory.ts`、`src/runtime/gateway/conversation-handoff-projection.ts` 中仍以 ProjectSessionMemory 命名的主路径迁移为 `workspace-kernel` / `context-projection` 命名；旧名字不得作为 public runtime contract 暴露。
- [ ] SA-DEL-02：删除或迁移 `handoffMemoryProjection`、`memoryPlan`、`availableSkills` 这类旧兼容字段；如果 backend/harness 仍需读取，改成 explicit `AgentServerContextRequest.contextRefs` / `capabilityBriefRef` / `cachePlan`。
- [ ] SA-DEL-03：删除 UI 中 `legacyRawRecoverableReasonForRun`、`legacy raw recover action`、raw compact summary 等主路径 fallback；历史 session 只允许 audit-only 展示。
- [ ] SA-DEL-04：删除 Runtime/Gateway 中把 malformed backend text、raw JSON、legacy task output 伪装成成功结果的 fallback；必须归类 `contract-incompatible`、`validation` 或 `failed-with-reason`。
- [x] SA-DEL-05：清理 docs/tests 中旧 `ProjectSessionMemory.md`、`Extending.md`、`SciForgeConversationSessionRecovery.md` 权威入口引用；当前 `smoke:docs-scenario-package` 已改为检查最终文档，后续继续扩展为断链 guard。Evidence：`docs/README.md` / `docs/Architecture.md` 标记旧文档为 archive/historical；`smoke:docs-scenario-package` 校验旧 docs 不存在、旧名只出现在 archive/historical 语境且 docs markdown 链接可解析。
- [ ] SA-DEL-06：清点所有 `legacy` / `compatibility` / `fallback` 命名；凡是仍参与主流程的条目必须迁移到最终 contract 或删除，不能只改文案。
- [ ] SA-DEL-07：删除 `src/runtime/gateway/direct-context-fast-path.ts` 中的 Runtime 本地 prompt regex/关键词判断和本地回答模板；保留时只能作为 `DirectContextDecision` consumer，不允许生成 strategy。
- [ ] SA-DEL-08：删除 `src/runtime/gateway/capability-provider-preflight.ts` 作为 Runtime 可调用路径；provider preflight/route 只能作为 Gateway 内部阶段，不暴露 `endpoint/baseUrl/invokeUrl/workerId/runtimeLocation` 给 Runtime Bridge 或 Backend。
- [x] SA-DEL-09：删除 `src/runtime/generation-gateway.ts` 中直接调用 `directContextFastPathPayload()`、`capabilityProviderPreflight()`、`capabilityProviderPreflightPayload()` 的主流程分支；这些行为必须变成 PipelineStep 输入 refs 或 Gateway/AgentServer 结构化输出。Evidence：`src/runtime/generation-gateway.ts` 已移除 Runtime 主路径短路；`npm run smoke:t098-latency`、`npm run verify:single-agent-final` 通过。
- [x] SA-DEL-10：重写 `tests/smoke/smoke-t098-latency-diagnostics-matrix.ts` 中保护旧 `sciforge.direct-context-fast-path` / `sciforge.capability-provider-preflight` 可见阶段的断言；改为保护 `DirectContextDecision`、route-to-agentserver 和 Gateway `execute` 收口。Evidence：T098 不再期待 direct-context/preflight visible execution unit，改断言 AgentServer routing 与 routeDecision provider routes。
- [x] SA-DEL-11：将 `packages/agent-harness/src/profiles.ts` 中 prompt regex classifier 降级为显式 fixture/config 或结构化 policy decision 输入；harness 可以输出 decision，但不能靠关键词替 Runtime/Backend 猜语义。Evidence：`packages/agent-harness/src/profiles.ts` 已删除 prompt regex hint classifier，latency/context-audit 只消费 `conversationSignals`、`runtimeConfig`、`intentMode`、`directContextDecision` 等结构化输入；`runtime.test.ts` 覆盖 prompt-only 不触发 audit/latency 分类，targeted tests、`typecheck` 与 runtime smoke 通过。

#### P1：Workspace Kernel 与 Projection

- [ ] SA-KERNEL-01：实现明确 `StorageAdapter` interface，支持 SQLite/filesystem/in-memory adapter，但对外统一 `appendEvent` synchronous-on-write。
- [ ] SA-KERNEL-02：让 `appendEvent` 成功返回时同步持久化 ledger、更新 materialized `ConversationProjection`、递增 `projectionVersion`；replay 仅用于冷启动、审计和一致性测试。
- [ ] SA-KERNEL-03：将小事实内联到 `WorkspaceEvent`，大正文/长日志/snapshot/audit bundle 才注册为 `ProjectMemoryRef`；新增 guard 防止 health/degraded/failure 摘要被无脑 ref 化。
- [ ] SA-KERNEL-04：实现 `RefKindGroup` 派生 retention，禁止调用方逐个传任意 retention；archive/pin/delete/tombstone 全部 append event。
- [ ] SA-KERNEL-05：实现 `CrossSessionRef` / explicit import 记录，禁止复制裸路径跨 session 充当记忆。
- [ ] SA-KERNEL-06：补 conformance：C01、C02、C15、Workspace Kernel 最小验收用例。
- [ ] SA-KERNEL-07：合并 `src/runtime/project-session-memory.ts` 与 `src/runtime/conversation-kernel/*` 两套 ledger/projection 形态；只保留一个 `WorkspaceKernel.appendEvent(event): AppendResult` 主路径，另一套只能作为 migration adapter 或删除。
- [x] SA-KERNEL-08：为 `ProjectMemoryRef` 对齐最终 contract：补齐 `handoff-packet`、`context-snapshot`、`retrieval-audit`、`run-audit` 等 kind，新增 `RefKindGroup`，并禁止输入直接携带 retention。Evidence：`PROJECT_MEMORY_REF_KINDS` / `RefKindGroup` / kind-derived retention 已落地，handoff/context/retrieval/run-audit aliases 会归一化，输入 retention 被忽略；`project-session-memory.test.ts` 与 `smoke:project-session-memory` 通过。
- [x] SA-KERNEL-09：补 `registerRef/readRef/listRefs(page/filter)` contract，`listRefs` 默认只返回 `RefDescriptor` 且分页；大正文必须通过 readRef 按需读取。Evidence：`src/runtime/conversation-kernel/ref-store.ts` 新增 RefStore contract，`listRefs` 默认只返回 descriptors 并支持分页/filter，正文只能经 `readRef` 读取；`ref-store.test.ts`、`conversation-kernel.test.ts`、`smoke:conversation-kernel-final-shape` 与 `verify:single-agent-final` 通过。

#### P2：AgentServer Context Core 与 buildContextRequest

- [ ] SA-CONTEXT-01：新增/收口 `AgentServerAdapter`，默认模式固定为 `owned-orchestrator-third-party-backend`；`third-party-adapter` 只能作为显式兼容模式，不能是默认路径。
- [ ] SA-CONTEXT-02：实现正式 `AgentServerContextRequest`：`currentTask.currentTurnRef` 必填，`stablePrefixRefs` / `perTurnPayloadRefs` 二层 cachePlan，selected refs 必须 bounded/source-tagged。
- [ ] SA-CONTEXT-03：实现 buildContextRequest 防漂移规则：fresh 默认隔离旧 recent turns；continue/repair 才打开 current work；无 explicit refs 时只提供 bounded indexes 和 retrievalPolicy，不猜“最相关 artifact”。
- [ ] SA-CONTEXT-04：实现 byte-level deterministic `RefSelectionPolicy` budgets，并禁止函数字段；AgentServer retrieval 不可用时只允许确定性 fallbackOrder。
- [x] SA-CONTEXT-05：实现 `DegradedHandoffPacket` 类型和 forbidden-field guard，禁止 recentTurns/fullRefList/rawHistory/compactionState 进入降级包。Evidence：`src/runtime/gateway/agentserver-context-contract.ts` + `agentserver-context-contract.test.ts`。
- [x] SA-CONTEXT-06：实现 `SyntheticAuditMeta`，third-party/partial audit 必须标 `synthetic: true`；无法说明 refs、预算和原因时 fail/degrade。Evidence：`validateSyntheticAuditMeta()` fail-closed guard 与 targeted test 通过。
- [x] SA-CONTEXT-07：补 conformance：C02、C03、C04、C05、C13、AgentServer Context Core 最小验收用例。Evidence：`node --import tsx --test src/runtime/gateway/agentserver-context-contract.test.ts`、`npm run smoke:single-agent-runtime-contract` 通过。
- [x] SA-CONTEXT-08：新增 `src/runtime/gateway/agentserver-context-contract.ts`，集中定义 `AgentServerContextRequest`、`AgentServerContextResponse`、`BackendHandoffPacket`、`DegradedHandoffPacket` 和 canonical serialization。
- [ ] SA-CONTEXT-09：替换 `src/runtime/gateway/agentserver-prompts.ts` 中直接组装 prompt/currentTurnSnapshot 的本地 context 包；AgentServer prompt renderer 只能消费 `BackendHandoffPacket` / bounded render plan。
- [ ] SA-CONTEXT-10：合并或废弃 `src/runtime/gateway/conversation-handoff-planner.ts` 与 `src/runtime/workspace-task-input.ts` 中重复的 handoff budget/compaction/audit 逻辑，只保留一个 canonical handoff normalizer。
- [ ] SA-CONTEXT-11：`src/runtime/gateway/conversation-handoff-projection.ts` 不再输出容易被误用的 `recentConversation` / `recentRuns` raw-ish blocks；改为 bounded descriptors、source refs、digest 和 retrieval policy。
- [x] SA-CONTEXT-12：`src/runtime/gateway/agentserver-context-window.ts` 的 AgentServer core snapshot 去掉 clipped `turn.content`，统一为 `contentRef/contentDigest/contentChars/contentOmitted`。Evidence：`compactAgentServerCoreSnapshot()` recent turns 不再输出 clipped `content`，只保留 ref/digest/chars/omitted；raw content 只用于本地 digest/chars 计算；`agentserver-context-window.test.ts`、`context-envelope.test.ts`、`smoke:single-agent-runtime-contract`、`smoke:no-legacy-paths` 与 `typecheck` 通过。

#### P3：Capability Gateway、Provider/Worker 与 ArtifactDelivery

- [ ] SA-GATEWAY-01：Runtime Bridge 只能调用 `Gateway.execute`；`resolveRoute` / `preflight` / `invoke` / `materialize` / `validate` 改为内部 API，并加 lint/contract test 防外部调用。
- [ ] SA-GATEWAY-02：`Gateway.validate` 只做结构校验；科学/语义判断必须来自 Backend 或 verifier capability 的 `verification-record`。
- [x] SA-GATEWAY-03：实现 `ArtifactDelivery` contract：`primary-deliverable` / `supporting-evidence` 才进入 Projection 可见结果，`audit` / `diagnostic` / `internal` 只能进 debug/audit。Evidence：`artifactHasUserFacingDelivery` 已下沉到 runtime contract，覆盖 readable target、audit/diagnostic/internal、audit-only/unsupported、json-envelope；C17 smoke 使用同一规则。
- [ ] SA-GATEWAY-04：Worker discovery 统一归一成 `ProviderManifest`，不得把单个 endpoint shape 泄漏给 Backend 或 Runtime Bridge。
- [ ] SA-GATEWAY-05：scenario package contract 改为 policy-only guard：禁止 execution code、prompt regex、provider branch、多轮 semantic judge、preset answer/system prompt。
- [ ] SA-GATEWAY-06：补 conformance：C07、C08、C17、C18、Capability Gateway 最小验收用例。
- [ ] SA-GATEWAY-07：provider status / capability status 查询只能读取 Capability Registry / ProviderManifest / AgentServer worker registry projection，不能触发 Gateway preflight 作为用户回答路径。
- [x] SA-GATEWAY-08：`CapabilityProviderRoute` 对 Backend/Runtime 只暴露 capability/provider id、routeDigest、health summary、permission summary 和 evidence refs；endpoint/invoke path/auth/workspace roots 只留 Gateway 内部。Evidence：provider route 已拆成 Gateway 内部 preflight shape 与 public handoff shape；context/payload/routeDecision 不再序列化 endpoint/baseUrl/url/invokeUrl/invokePath/workerId/runtimeLocation/auth/workspace roots，generated-task providerInvocation 仍使用内部 route。

#### P4：Runtime Bridge、Run lifecycle 与 failure

- [ ] SA-RUNTIME-01：把主流程收敛为声明式 `TurnPipeline(registerTurn → requestContext → driveRun → finalizeRun)`；executor 禁止业务 `if` 和用户文本判断。
- [ ] SA-RUNTIME-02：RunStateMachine 不维护可变内存状态；所有 transition、checkpoint、terminal 都 append `run-status` / checkpoint event，并从 Projection 恢复。
- [ ] SA-RUNTIME-03：EventRelay 实现 `producerSeq` / `cursor` / `callId + inputDigest + routeDigest` 幂等；重复 tool call 复用 resultRefs。
- [ ] SA-RUNTIME-04：WriteAheadSpool 只做 in-process bounded buffer；超过 depth/age 上限进入 `storage-unavailable` failed，不进入 degraded。
- [ ] SA-RUNTIME-05：FailureNormalizer 输出 `failureClass`、`recoverability`、`owner`、`failureSignature`；是否 repair 只由 TurnPipeline.onFailure + RepairPolicy 决定。
- [ ] SA-RUNTIME-06：direct-context fast path 改为结构化 `DirectContextDecision`；Runtime Bridge/UI 不得用关键词、本地模板或 artifact kind 直接回答。
- [ ] SA-RUNTIME-07：Harness policy 只输出 decision/contract/trace refs；Runtime Bridge 只把它们作为 context refs，不解释领域语义。
- [ ] SA-RUNTIME-08：补 conformance：C06、C09、C10、C11、C16、Runtime Bridge 最小验收用例。
- [ ] SA-RUNTIME-09：`DirectContextDecision` 必须包含 `decisionRef`、`decisionOwner`、`requiredTypedContext`、`usedRefs`、`sufficiency`；无 decision 或 insufficient 时必须 route-to-agentserver。
- [x] SA-RUNTIME-10：禁止 `directContextIntent(prompt)`、`promptRequires*`、`if prompt.includes` 类文本判断进入 Runtime Bridge / generation gateway 主流程。Evidence：`directContextIntent(prompt)` / `promptRequires*` 文本判断源已从 Runtime Gateway 主流程删除，direct-context 只消费结构化 `DirectContextDecision` / selected tool ids / provider route manifest；`smoke:single-agent-runtime-contract` 与 `smoke:no-legacy-paths` guard 覆盖 directContextIntent/promptRequires 零基线，`verify:single-agent-final` 通过。

#### P5：UIAction、Projection-only UI 与审计

- [ ] SA-UI-01：所有 UI 写操作收口为 `UIAction`：submit-turn、trigger-recover、cancel-run、concurrency-decision、open-debug-audit；UI 不直接写 Kernel。
- [ ] SA-UI-02：UI terminal state 只来自 Projection；`answer-delta` 只能作为 transient display，和 Projection 冲突时丢弃 transient。
- [ ] SA-UI-03：删除 results/archive/chat 中 raw run/backend stream 推断 terminal state 的逻辑；历史 raw 内容只能 audit/debug 展示。
- [ ] SA-UI-04：按 `ArtifactDelivery.previewPolicy` 分流 inline/open-system/audit-only/unsupported，禁止 JSON/raw fallback 伪装为主结果。
- [ ] SA-UI-05：Debug panel 只消费 RunAudit/context snapshot/audit refs；用户可见失败原因来自 Projection 的 visibleAnswer/recoverActions。
- [ ] SA-UI-06：补 conformance：C12、C17、UI/Projection 最小验收用例和 browser smoke。
- [ ] SA-UI-07：`src/ui/src/app/conversation-projection-view-model.ts` 的 `conversationProjectionForRun` 数据源迁移为 session-level materialized `ConversationProjection`；`run.raw` / `run.response` 内嵌 projection 只允许 migration/audit fixture。
- [x] SA-UI-08：删除 `src/ui/src/app/results-renderer-execution-model.ts` 的 `projectionlessRunPresentationState` 主展示 fallback；无 Projection 时结果区只显示“等待 Projection”，raw/run refs 进入 audit/debug。Evidence：ResultsRenderer targeted tests 与 `npm run verify:single-agent-final` 通过。
- [x] SA-UI-09：删除 `src/ui/src/app/results/viewPlanResolver.ts` 的 `artifactsForProjectionlessMainPlan` 主 plan fallback；主 view plan 必须来自 Projection + ArtifactDelivery。Evidence：projectionless view plan 返回空主 items，Projection + ArtifactDelivery 用例保持可见。
- [x] SA-UI-10：删除 `src/ui/src/app/appShell/workspaceState.ts` 的 `recoverableRunAuditFallbackForSession` / `legacyRawRecoverableReasonForRun` 主路径；recover focus、verification badge、next actions 全部来自 Projection。Evidence：`workspaceState.ts` 已删除 raw recover fallback，`workspaceState.test.ts` 断言 failed/raw repair history 被忽略；`sa-ui-legacy-raw-terminal-fallback` baseline 收紧到 0；`npm run verify:single-agent-final` 通过。
- [x] SA-UI-11：删除 `src/ui/src/app/chat/messageRunPresentation.tsx` 和 `src/ui/src/app/ChatPanel.tsx` 中 raw `verificationResult` / `displayIntent.resultPresentation` 驱动主展示的 fallback；保留时只能进入 audit/debug。Evidence：`RunVerificationTag` 只消费 ConversationProjection verification，`ChatPanel` 不再把 `displayIntent.resultPresentation` 注入最终消息主展示；`ChatPanel.test.ts` 覆盖 raw verification 与 displayIntent resultPresentation 不驱动可见 badge/正文；`npm run verify:single-agent-final` 通过。
- [x] SA-UI-12：统一 ArtifactDelivery 可见性 helper：presentation/input/view-plan/results/message references 全部只认 `artifactHasUserFacingDelivery`；`diagnostic` 必须 audit-only，不得进入主 presentation input。Evidence：presentation input、view-plan projection/focus、results availableArtifacts 和 message references 均复用 helper；diagnostic/readable projection 与 object-focus 测试均不进入主 plan/input。
- [x] SA-UI-13：`packages/support/object-references/presentation-role.ts` 中基于 artifact type/path/metadata 的 role heuristic 只能用于排序或审计，不得决定主结果可见性。Evidence：object reference 可见性改为显式结构化 user-facing contract；presentation-role heuristic 仅保留排序/审计用途，synthetic file/url focus 与 scenario message refs 不再靠文件名/metadata 进入主结果；`object-references`、`MessageContent`、`viewPlanResolver` targeted tests 和 `smoke:object-references` / `verify:single-agent-final` 通过。

#### P6：Conformance、验证与并行执行节奏

- [x] SA-CONF-01：新增 `smoke:single-agent-runtime-contract`，覆盖 C01-C18；失败时不允许合并任何 runtime/gateway/UI 变更。Evidence：`tests/smoke/smoke-single-agent-runtime-contract.ts`。
- [x] SA-CONF-02：扩展 `smoke:no-legacy-paths`：禁止主路径出现 `legacyRaw*`、`memoryPlan`、旧 `ProjectSessionMemory` public contract、Gateway 内部阶段外部调用、raw-history degraded packet。Evidence：`tools/check-no-legacy-paths.ts` 新增 SA guard；当前 legacy baseline 冻结，新增/增加会失败。
- [x] SA-CONF-03：新增 buildContextRequest golden fixtures：fresh、continue、repair、explicitRefs、no explicitRefs、degraded、retrieval unavailable、token budget overrun。Evidence：`agentserver-context-contract.test.ts` 覆盖 request/degraded packet、canonical serialization + SHA-256 golden hash，以及 raw history / untagged refs / recent turns / nested compaction fail-closed。
- [ ] SA-CONF-04：新增 browser smoke：Projection terminal 胜过 stream delta、ArtifactDelivery audit-only 不可见、direct-context insufficient 必须 route-to-agentserver。
- [x] SA-CONF-05：每个并行 workstream 完成后更新本节任务状态和证据命令；未通过 conformance 的代码不得进入下一阶段。Evidence：本轮 SA-CONTEXT、SA-RUNTIME、SA-UI、SA-CONF 状态已按完成事实更新；`npm run verify:single-agent-final` 通过后才进入同步。
- [x] SA-CONF-06：新增 C06/C07 lint：覆盖 `src/runtime/generation-gateway.ts`、`src/runtime/gateway/**`，禁止 Runtime 主流程调用 `directContextIntent(prompt)`、`promptRequires*`、`capabilityProviderPreflight()` 和 Gateway 内部阶段。Evidence：`smoke:single-agent-runtime-contract` 与 `smoke:no-legacy-paths` 静态 guard。
- [x] SA-CONF-07：新增 UI no-legacy guard：主路径禁止从 `raw.status`、`raw.failureReason`、`resultPresentation.status`、ExecutionUnit terminal status 推导 terminal/recover state；仅允许 debug/audit 白名单读取。Evidence：`sa-ui-legacy-raw-terminal-fallback` guard + projection-only UI tests。
- [x] SA-CONF-08：新增 context request C02-C05/C13 fixtures：不含 raw history/body/full ref list；fresh turn 必有 current turn anchor；stable prefix 不含 turn/run/timestamp；degraded packet 禁止 forbidden fields；synthetic audit 必须显式标记。Evidence：`agentserver-context-contract.test.ts` + C02-C05/C13 smoke fixtures。
- [x] SA-CONF-09：新增 ArtifactDelivery C17 fixtures：`diagnostic`、`audit`、`internal`、`audit-only`、`unsupported` 均不得进入 primary view plan 或 presentation input。Evidence：`smoke-single-agent-runtime-contract.ts` C17 fixture and UI projection-only tests.
- [ ] SA-CONF-10：新增最终完成 gate 命令 `npm run verify:single-agent-final`，串联 typecheck、核心单测、C01-C18、browser web-multiturn-final；任何一步失败都不能标记最终版本完成。First cut：命令已新增并通过 typecheck、核心单测、C01-C18、no-legacy guard；browser web-multiturn-final 尚未接入，留给 SA-WEB-E2E 阶段。
- [x] SA-CONF-11：为 `package.json` 中 `smoke:browser`、`smoke:browser-multiturn`、`smoke:browser-provider-preflight` 建迁移 guard；它们可以成为 `smoke:web-multiturn-final` 的子场景，但不能继续作为保护旧 preflight/direct-context 的独立完成门。Evidence：旧 browser smoke scripts 现在委托 `smoke:web-multiturn-final -- --tag ...`，guard 断言 legacy browser smoke 不再作为独立完成门。
- [ ] SA-CONF-12：新增 final evidence validator，校验 `docs/test-artifacts/single-agent-final/manifest.json` 是否引用 C01-C18 结果、Web E2E case manifests、console/network logs、screenshots 和 no-legacy guard 输出。

#### P7：Web 端到端多轮对话测试矩阵

目标：Web 端到端测试不是旧 H022 压测附录，而是最终版本验收入口。每条用例都必须使用真实 UI、真实 workspace writer、可控 mock/real AgentServer，记录 session bundle、runtime events、Projection、RunAudit、context snapshot refs、artifact refs 和浏览器截图。测试只验证最终 contract，不允许为了通过测试保留旧 direct-context/preflight/raw fallback。

统一验收：

- 每个用例至少 3 轮：fresh turn、follow-up/continue、repair/export/format-change 中任一。
- 每个用例都断言 `currentTask.currentTurnRef`、explicit refs、Projection terminal state、ArtifactDelivery visibility、RunAudit/context refs。
- 刷新页面或重开标签后，UI 只能从 Projection 恢复，不依赖 React 内存或 raw run。
- 失败必须显示用户可理解 reason、recoverActions 和 next step；不能显示 completed/empty 假成功。
- 所有浏览器 console/runtime errors 必须为 0，除非测试明确验证错误提示。

Web E2E 测试工程边界：

- 测试入口使用 `tests/smoke/smoke-web-multiturn-final.ts` 或等价文件；旧 browser smoke 只能被迁移为 case helper。
- AgentServer 使用 scriptable mock + 可选真实 provider 双模式：mock 模式必须能精确发出 final-answer、tool-call、failure、degraded、background checkpoint、malformed packet、empty result；真实 provider 模式只用于 happy path 和 nightly/deep 验证。
- 每个 case 都写入独立 manifest：`docs/test-artifacts/web-e2e/<case>/manifest.json`，并由总 manifest 汇总到 `docs/test-artifacts/single-agent-final/manifest.json`。
- 浏览器断言必须同时读取 DOM、UI state debug export、session bundle、Kernel events、Projection 和 RunAudit；只看 DOM 不算通过。
- 所有测试数据必须是 fixture 化的研究问题、paper metadata、CSV、provider responses 和 artifact refs；禁止靠外网实时搜索结果决定通过/失败。
- 失败 case 不允许吞错：若 mock AgentServer/Gateway 返回不可观测失败，UI 必须进入 `failed-with-reason` 或 `repair-needed`，并在 manifest 中留下 failure evidence。

Web E2E 任务：

- [ ] SA-WEB-01：新增 `smoke:web-multiturn-final` 总入口，负责启动 dev services、准备 isolated workspace、启动 mock/real AgentServer、跑完整 Web 多轮矩阵并导出 evidence bundle。
- [ ] SA-WEB-02：Fresh → Continue 记忆稳定用例：第一轮提出研究目标，第二轮要求“记住一开始的问题并继续”，第三轮要求换格式；断言 old artifact 不覆盖 current turn，stableGoalRef 只来自显式/Backend proposal。
- [ ] SA-WEB-03：Explicit artifact selection 用例：同 session 存在旧报告和新报告，用户点击旧 artifact 后追问“基于这个继续”；断言 `explicitRefs/currentTask.explicitRefs` 指向旧对象，结果不混入最新 artifact。
- [ ] SA-WEB-04：Failed run repair 用例：制造 provider unavailable 或 schema validation failure，用户要求“解释失败，不重跑无关步骤，再继续修复”；断言 RepairPolicy 熔断、failureSignature、recoverActions、RunAudit refs。
- [ ] SA-WEB-05：Provider unavailable → available 用例：第一轮缺 `web_search/web_fetch` 时 fail closed，第二轮 mock provider ready 后同任务进入 AgentServer dispatch；断言 provider status 不走 Runtime preflight 可见阶段，不泄漏 endpoint shape。
- [ ] SA-WEB-06：Empty result 用例：mock search 返回空结果；UI 必须显示 recoverable/needs-human/empty-result，而不是 completed 报告；follow-up 扩大 query 后复用前一轮 failure evidence。
- [ ] SA-WEB-07：Long/background run 用例：长任务运行中刷新页面、打开第二标签、提交 clarification；断言 foreground/background 并发策略、checkpoint、cursor resume、Projection terminal state。
- [ ] SA-WEB-08：Degraded AgentServer 用例：AgentServer context API 不可用；Runtime 只能生成 refs-first `DegradedHandoffPacket`，UI 显示 degraded reason，不把 raw history 塞进 backend。
- [ ] SA-WEB-09：ArtifactDelivery 可见性用例：同一 run 返回 primary、supporting、diagnostic、audit、internal artifacts；右侧主结果只展示 primary/supporting，diagnostic/audit/internal 只在 debug/audit。
- [ ] SA-WEB-10：Audit export 用例：完成或失败后导出 JSON bundle；断言包含 ledger events、Projection、RunAudit、context snapshot、refs manifest、tombstone/degraded/failure evidence，不包含 secret/raw provider token。
- [ ] SA-WEB-11：Reload/reopen session 用例：关闭并重开页面恢复旧 session；断言可见答案、active/terminal run、artifact refs、recover actions 全部来自 persisted Projection。
- [ ] SA-WEB-12：Multi-tab conflict 用例：两个标签对同一 session 同时提交；默认只允许一个 foreground active run，另一条按 `wait/attach/cancel/fork` 策略处理，不能隐式并发写同一 session。
- [ ] SA-WEB-13：Direct context gate 用例：只问当前 run 状态时可以从结构化 `DirectContextDecision` 回答；一旦问题要求生成/repair/tool/status 判断不充分，必须 route-to-agentserver。
- [ ] SA-WEB-14：No legacy UI fallback 用例：构造只有 raw run/legacy resultPresentation、没有 Projection 的历史 session；主结果区只能显示等待/需迁移，raw 内容只在 audit/debug，不得展示为 terminal result。
- [ ] SA-WEB-15：真实文献多轮 happy path：使用 mock 非空 web provider 或真实 provider，完成检索、下载/读取、中文报告、引用修正、审计导出；验证 provider route trace、artifact lineage、evidence refs。
- [ ] SA-WEB-16：真实数据分析多轮 happy path：上传/引用 CSV，摘要统计、改分组、解释异常值、导出 markdown + code refs；验证大文件按 ref/read_ref 读取，不进 raw prompt。
- [x] SA-WEB-17：Web E2E evidence bundle 规范：每个 SA-WEB 用例自动生成 `docs/test-artifacts/web-e2e/<case>/manifest.json`，包含 run ids、event ids、projectionVersion、screenshots、console logs、network summaries 和 failure/improvement note。Evidence：`tests/smoke/web-e2e/evidence-bundle.ts` 生成 `sciforge.web-e2e.evidence-bundle.v1` manifest 并写入 per-case `manifest.json`，包含 run/event/projection、screenshots、console/network 摘要和 failure/improvement note；focused web-e2e helper tests 与 `typecheck` 通过。
- [ ] SA-WEB-18：将旧 `smoke:browser`、`smoke:browser-multiturn`、`smoke:browser-provider-preflight` 中仍有价值的步骤迁入 `smoke:web-multiturn-final`；旧 smoke 只保留为子命令或删除，不能继续保护旧链路。
- [x] SA-WEB-19：实现 scriptable AgentServer mock，支持按 case 脚本发出 `BackendHandoffPacket`、stream delta、tool-call、tool-result、failure、degraded 和 background checkpoint；每个事件都带 deterministic id/digest。Evidence：`tests/smoke/web-e2e/scriptable-agentserver-mock.ts` 支持 health/discovery/context/compact/run-stream 脚本事件，事件 id/digest 确定；`scriptable-agentserver-mock.test.ts`、`typecheck` 与 `verify:single-agent-final` 通过。
- [x] SA-WEB-20：实现 fixture workspace builder，按 case 生成 isolated workspace、session id、初始 refs、旧 artifacts、新 artifacts、CSV/PDF/text fixture、provider manifest 和 expected Projection。Evidence：`tests/smoke/web-e2e/fixture-workspace-builder.ts` 生成隔离 workspace、`.sciforge` state/config、旧/新 report、CSV/PDF/text/audit/log/provider manifest 和 expected Projection；`fixture-workspace-builder.test.ts`、`typecheck` 与 `verify:single-agent-final` 通过。
- [x] SA-WEB-21：实现 browser instrumentation：捕获 console error/warn、network failures、uncaught exceptions、page screenshots、DOM snapshots、debug panel export 和 downloaded audit bundle。Evidence：`tests/smoke/web-e2e/browser-instrumentation.ts` 提供 console/pageerror/request/http/download 捕获、截图、DOM snapshot、debug export snapshot/dispose；`typecheck` 与 `verify:single-agent-final` 通过。
- [x] SA-WEB-22：实现 after-each contract verifier：对比 browser visible state、Kernel Projection、session bundle、RunAudit、ArtifactDelivery manifest 和 expected case contract；任何一处不一致都失败。Evidence：`tests/smoke/web-e2e/contract-verifier.ts` 提供 `assertWebE2eContract()` / afterEach verifier，覆盖 browser visible state、Kernel Projection、session bundle、RunAudit、ArtifactDelivery manifest 和 loader；focused web-e2e helper tests 与 `typecheck` 通过。
- [x] SA-WEB-23：实现 refresh/reopen helper：每个核心 case 在第 2 轮后刷新页面，在 terminal 后重开 session，验证 Projection-only restore。Evidence：`tests/smoke/web-e2e/refresh-reopen-helper.ts` 在 round 2 后 refresh、terminal 后 reopen session，并断言 visible restore 只来自 Projection、refs/audit/delivery 对齐；focused web-e2e helper tests 与 `typecheck` 通过。
- [x] SA-WEB-24：实现 multi-tab helper：同一 session 打开两个 page，上报并发 decision，断言 `activeRun/backgroundRuns` 和 UIAction concurrency-decision 一致。Evidence：`tests/smoke/web-e2e/multi-tab-helper.ts` 打开同 session 双 page，记录 `UIAction(type=concurrency-decision)`，校验 active/background run ids 与 Projection 一致；focused web-e2e helper tests 与 `typecheck` 通过。
- [x] SA-WEB-25：实现 secret scrubber：evidence bundle 中禁止出现 provider token、absolute secret path、raw auth header；只允许 digest、routeDigest、provider id 和 audit-safe summary。Evidence：`tests/smoke/web-e2e/secret-scrubber.ts` 递归清理 token/auth header/secret path/内部 route 字段，保留 providerId、routeDigest、digest、summary；focused web-e2e helper tests 与 `typecheck` 通过。
- [x] SA-WEB-26：实现 Web E2E flake policy：同一 case 失败必须输出最小复现 command、case manifest、last screenshot 和 first failed contract；禁止简单重试掩盖 nondeterministic context drift。Evidence：`tests/smoke/web-e2e/flake-policy.ts` 生成最小复现、case manifest、last screenshot、first failed contract，并对 context/projection digest drift fail closed；focused web-e2e helper tests 与 `typecheck` 通过。
- [ ] SA-WEB-27：将 `R-LIT-*`、`R-DATA-*`、`R-RUN-*`、`R-UI-*` 中已沉淀的真实多轮任务映射到 SA-WEB case tags，保留真实场景覆盖，但验收标准统一回最终 contract。

#### 当前已识别旧链路候选

- `src/runtime/project-session-memory.ts`：旧命名仍在 runtime contract 中，需要迁移为 Workspace Kernel / context projection 命名。
- `src/runtime/conversation-kernel/*`：与 `ProjectSessionMemory` 并存，需合并为唯一 Workspace Kernel 主路径。
- `src/runtime/gateway/conversation-handoff-projection.ts`：仍调用 `normalizeProjectSessionMemory`，需要对齐 `AgentServerContextRequest` / `cachePlan`。
- `src/runtime/gateway/conversation-handoff-planner.ts`、`src/runtime/workspace-task-input.ts`：重复承担 handoff budget/compaction/audit，需要收敛为一个 canonical handoff normalizer。
- `src/runtime/gateway/agentserver-prompts.ts`：仍在主链路组装 prompt/currentTurnSnapshot，需要改为消费 `BackendHandoffPacket` / bounded render plan。
- `src/runtime/gateway/agentserver-context-window.ts`：中间 snapshot 仍可能保留 clipped turn content，需要改成 ref/digest-only。
- `src/runtime/gateway/direct-context-fast-path.ts`：已有收紧，但最终要改成结构化 `DirectContextDecision` 来源，不保留 Runtime Bridge 自判策略。
- `src/runtime/gateway/capability-provider-preflight.ts`：preflight/route 作为 Runtime 可见阶段外泄，需要收回 Gateway 内部。
- `src/runtime/generation-gateway.ts`：存在 direct-context/preflight 策略分支，需要纳入 declarative pipeline / AgentServer decision。
- `src/ui/src/app/appShell/workspaceState.ts`：含 `legacyRawRecoverableReasonForRun`，需要删除主路径 fallback。
- `src/ui/src/app/ResultsRenderer.tsx`、`src/ui/src/app/results-renderer-execution-model.test.ts`、`src/ui/src/app/chat/ArchiveDrawer.test.tsx`：含 compatibility / legacy raw 行为，需要改成 Projection/ArtifactDelivery/audit-only。
- `src/ui/src/app/conversation-projection-view-model.ts`、`src/ui/src/app/results-renderer-execution-model.ts`、`src/ui/src/app/results/viewPlanResolver.ts`、`src/ui/src/app/chat/messageRunPresentation.tsx`、`src/ui/src/app/ChatPanel.tsx`：仍有 raw/projectionless 主展示入口，需要迁移到 Projection-only。
- `packages/support/object-references/presentation-role.ts`、`packages/presentation/interactive-views/presentation-input-policy.ts`：ArtifactDelivery 可见性 helper 尚未完全统一，`diagnostic` role 需要 audit-only。
- `packages/presentation/components/index.test.ts`：保留 compatibility alias 的测试需要重新评估；若是 UI component registry 迁移兼容，必须从 runtime 主路径移出。
- `packages/agent-harness/src/profiles.ts`：仍有 prompt regex classifier，需要变成结构化 policy decision 输入或 fixture。
- `tests/smoke/smoke-t098-latency-diagnostics-matrix.ts`：仍保护旧 direct-context/preflight 可见阶段，需要重写为 C06/C07/C16 guard。
- `package.json` 的 `smoke:browser`、`smoke:browser-multiturn`、`smoke:browser-provider-preflight`：仍是旧浏览器验收入口，需要迁入 `smoke:web-multiturn-final` 或降级为子场景。
- `docs/Architecture.md` 中仍记录 `availableSkills` 兼容字段、conversation-policy 主路径等当前实现背景；实现完成后应继续删减或标注 historical-only。

旧任务处理规则：本节以下 2026-05-14 / 2026-05-15 任务只作为历史上下文和已完成证据。未完成 TODO 必须迁移到 SA-*；不允许为了完成旧 TODO 新增兼容层。

### 2026-05-14 Task：LLM-gated fast path 与分布式工具接入层

最终方案：direct-context fast path 必须先经过 LLM/语义 classifier 做 intent/context match；只允许在 typed context 足够时低延迟回答。工具生态拆成 Skill、Capability、Provider、Runtime Resolver 四层。新增机器提供既有 capability 时应只改 AgentServer/worker/tool-routing 配置；新增工具类型必须通过 Tool Manifest 注册 capability/provider contract，而不是只写 `SKILL.md`。标准工具机器必须走 SciForge Tool Worker Protocol，并由 AgentServer worker registry/router 发现、健康检查、授权和路由；worker 可以独立发布，SciForge 只消费 registry snapshot、route decision 和 provider health/permission 状态。

架构任务：

- [x] CAP-ARCH-01：将四层模型写入 `docs/Architecture.md`：Skill 描述方法，Capability 定义抽象能力和 schema，Provider 声明执行来源，Runtime Resolver 在 run 前绑定 provider 并记录 route。
- [x] CAP-ARCH-02：将 direct-context fast path 边界写入 `docs/Architecture.md`：fast path 可以低延迟，但不能纯模板化；必须先判断 required typed context 和 sufficiency。
- [x] CAP-ARCH-03：将分布式工具接入写入 `docs/Architecture.md`：标准 worker/capability 只改配置，全新工具类型必须通过 Tool Manifest 和 healthcheck 接入。
- [x] CAP-ARCH-04：将 SciForge Tool Worker Protocol、worker manifest、结构化 invoke/result envelope、独立发布 worker 和 AgentServer registry/router handoff 边界写入 `docs/Architecture.md`。

实现 TODO：

- [x] CAP-P0-01：把 `direct-context-fast-path` 改成 LLM-gated 或 semantic-classifier-gated 路径；输出必须记录 intent、required context、context ids、sufficiency 和 skipped-task reason。
- [x] CAP-P0-02：新增 `skill/tool/capability/provider status` intent，禁止进入 artifact-summary direct-context；必须查询 Capability Registry / Tool Registry / AgentServer worker registry。
- [x] CAP-P0-03：实现 capability preflight：scenario/skill requires 的 capability 缺失、provider offline、未授权或限流时，发送前阻断并给出用户可操作提示。
- [x] CAP-P0-04：为 `web_search` / `web_fetch` 建立标准 capability/provider contract，禁止任务在无 provider 时生成临时网页 scraper 充当搜索工具。
- [x] CAP-P0-05：配置页 Tools/Skills 展示 provider 来源、运行位置、健康状态、授权状态、权限、primary/fallback route 和依赖关系。
- [x] CAP-P1-01：定义 Tool Manifest schema：capability id、transport、endpoint/command/mcp server、input/output schema、permissions、healthcheck、fallback eligibility、rate-limit metadata。
- [x] CAP-P1-02：接入 AgentServer worker/tool-routing discovery，把 `backend-server`、`server`、`client-worker`、`ssh`、`remote-service` 映射为 SciForge provider registry。
- [x] CAP-P1-03：Runtime Resolver 在每次 run 前把 required capabilities 解析为 provider route，并写入 handoff、ExecutionUnit、TaskRunCard 和 audit trace。
- [x] CAP-P1-04：统一 zero-result、HTTP 429、provider offline、permission denied、missing capability 的 failure classification 和恢复建议。
- [x] CAP-P2-01：支持 worker/tool server 暴露 manifests 后自动注册到 Capability Registry；新增标准工具机器只改配置，不改 SciForge 代码。
- [ ] CAP-P2-02：补齐真实网页 E2E happy path：无 web search provider 时阻断；启用 AgentServer server-side search 后同一文献任务可检索、下载、总结并保留 provider route trace。当前已有 fail-closed 与 zero-result 可恢复 smoke，仍缺非空 provider/mock 或真实 provider 的下载/总结链路。
- [ ] CAP-P2-03：对齐 AgentServer worker registry/router contract：SciForge provider registry 只消费 registry snapshot、route decision、health/permission/rate-limit 状态和 worker version，不直接依赖单个 worker endpoint shape。
- [ ] CAP-P2-04：为独立发布 worker 增加 contract smoke：manifest discovery、schema version、health/readiness、invoke result envelope、event stream、cancel、permission denied、rate-limit、empty-result 和 fallback route trace。
- [ ] CAP-P2-05：在 Tools/Skills 配置页展示 worker release 信息：worker id/version/protocol version/publisher/release channel、capability/provider version、breaking-change/migration warning 和 route primary/fallback 状态。

### 2026-05-15 Task：Package Capability/Worker 边界收敛

最终方案：保留 `observe`、`actions`、`verifiers`、`presentation`、`skills`、`contracts` 作为 agent-loop 行为边界；每个能力显式声明 capability contract，回答“能做什么”；每个可搬运执行包显式声明 worker/provider manifest，回答“在哪里执行、怎么执行”。1:1 capability/provider 默认合并在对应能力包中；1:N worker 或 N:1 provider matrix 才拆到 `packages/workers`。顶层 `packages/tools` 不再作为能力落点。

架构任务：

- [x] PKG-ARCH-01：更新 `packages/README.md`，固化行为边界与 capability/worker 双轴模型，明确 `packages/tools` 不再接收新增能力。
- [x] PKG-ARCH-02：明确 `web_search` / `web_fetch` 属于 read-only web observe capability，默认 provider route 由独立 `web-worker` 执行包提供。
- [x] PKG-ARCH-03：明确独立 worker 的最小发布面：worker manifest、health、invoke、permissions、smoke、README 和远程复制运行说明。

实现 TODO：

- [x] PKG-P0-01：把 Tool Worker Protocol SDK 从 `packages/tools/protocol-sdk` 迁到 `packages/contracts/tool-worker`，作为共享 worker contract 包。
- [x] PKG-P0-02：新增 `packages/observe/web`，承载 `web_search` / `web_fetch` capability contract 文档和 manifest。
- [x] PKG-P0-03：把默认 `web-worker` 执行包迁到 `packages/workers/web-worker`，保留 provider id `sciforge.web-worker.*` 和 CLI/HTTP entrypoints。
- [x] PKG-P0-04：更新 workspace/package metadata checks，让 `packages/workers/*` 成为合法独立 worker 边界。
- [x] PKG-P1-01：让 runtime 默认 capability registry 从 `packages/observe/web` manifest 发现 `web_search` / `web_fetch`，消除 `CORE_CAPABILITY_MANIFESTS` 中同 id 的临时投影。
- [ ] PKG-P1-02：为 `packages/workers/web-worker` 增加完整 worker release smoke，覆盖 manifest discovery、health/readiness、invoke envelope、permission denied、empty-result 和 fallback route trace。
- [ ] PKG-P1-03：把 package boundary inventory 和 legacy cutover inventory 补齐到新的 `contracts/tool-worker`、`observe/web`、`workers/web-worker` 路径。
- [ ] PKG-P1-04：更新 Tools/Skills 配置页展示 worker package path、worker version、capability manifest path 和 provider route 的分离关系。

### 2026-05-15 Task：Generated task provider-first 与 Task SDK

最终方案：AgentServer 生成的 workspace task 必须优先使用 SciForge 已解析出的 capability provider route；只有没有对应能力或 route 不可用时，任务才可以进入受控自由实现。SciForge 在任务入口同目录注入轻量 Task SDK，任务输入显式携带 provider route、helper 引用和 provider-first policy。所有外部依赖失败都必须合法退出为 ToolPayload，带结构化失败原因、恢复建议、执行单元和证据 refs；429、timeout、DNS、quota、permission、empty-result 等都归入通用 external dependency failure，而不是为单一网站或单一错误码打补丁。

架构任务：

- [x] GT-ARCH-01：明确“优先使用已有能力；缺失能力再自由发挥”的 provider-first 生成任务原则。
- [x] GT-ARCH-02：Task SDK 不是给模板绑定某个任务，而是给所有生成任务提供稳定的输入读取、payload 写入、provider route 检查和合法失败构造入口。
- [x] GT-ARCH-03：失败分支可以合法退出；合法失败 payload 是后续恢复、repair、用户诊断和多轮继续的输入，而不是异常噪声。
- [x] GT-ARCH-04：external dependency failure 按类别建模，避免只针对 HTTP 429/timeout 写特例。

实现 TODO：

- [x] GT-P0-01：生成任务 materialize 时在 entrypoint 同目录写入 `sciforge_task.py`，支持任务复制到任意机器后仍能按 SciForge task input contract 运行。
- [x] GT-P0-02：task input 写入 `taskHelperSdk`、`capabilityProviderRoutes` 和 `capabilityFirstPolicy`，让生成任务可发现 provider route 与合法退出规则。
- [x] GT-P0-03：preflight 在已有 ready `web_search` / `web_fetch` provider route 时阻断直接外部网络调用，要求改用 provider contract 或合法失败 payload。
- [x] GT-P0-04：workspace task payload 边界归一化常见 schema drift，例如 `reasoningTrace` 数组、空 `uiManifest[].artifactRef` 和可机械推导的 artifact id/type。
- [x] GT-P1-01：补齐网页端 E2E：在多轮真实对话中验证 provider-first route、Task SDK 注入、合法失败 payload、repair/continue 都能被 UI 正确呈现。已通过 `smoke:browser-provider-preflight`、`smoke:browser-multiturn` 和 `smoke:browser`；Task SDK 注入由 generated-task lifecycle 单测覆盖，网页 smoke 覆盖 provider fail-closed、server-side discovery、recoverable empty-result、repair continuation 和 audit follow-up 呈现。
- [ ] GT-P1-02：为 external dependency failure 增加 provider-neutral 回归集，覆盖 HTTP/DNS/timeout/rate-limit/quota/permission/empty-result/fallback route trace。

### 2026-05-15 Task：Project Session Memory 与 Cache-aware Context Projection

最终方案：workspace 本地维护 append-only Project Session Ledger 和 ref/blob store 作为可恢复事实源；AgentServer 作为 context orchestration 控制面，读取 ledger/projection refs，执行 retrieval、compaction、session current-work 和 backend handoff；agent backend 只消费 cache-aware projection compiler 生成的小任务包，并通过受控 `retrieve` / `read_ref` / `workspace_search` 按需读取信息。压缩只新增 projection/summary/constraint 事件，不修改 ledger；KV cache 优化以稳定 prefix 和最小 uncached tail 为目标。

架构任务：

- [x] PSM-ARCH-01：原 `ProjectSessionMemory.md` 专项稿已并入 [`docs/SciForge-SingleAgent-Architecture.md`](docs/SciForge-SingleAgent-Architecture.md)，最终 contract 定义 append-only ledger、content-addressed refs/blob store、context projections、AgentServer orchestration、backend handoff packet 和 KV cache-aware projection compiler。
- [x] PSM-ARCH-02：更新 [`docs/Architecture.md`](docs/Architecture.md)，将旧“AgentServer owns memory, SciForge owns projection”边界升级为“workspace owns canonical truth, AgentServer owns orchestration, backend consumes projection”。
- [x] PSM-ARCH-03：更新 [`docs/README.md`](docs/README.md)，把 `SciForge-SingleAgent-Architecture.md` 设为项目级多轮 runtime contract，并清理旧专项文档入口。

实现 TODO：

- [x] PSM-P0-01：定义 `ProjectSessionEvent` / `ProjectMemoryRef` / `ContextProjectionBlock` runtime contract，明确 event id、source refs、digest、cache tier、supersedes 和 projection block metadata；落点为 `src/runtime/project-session-memory.ts`。
- [x] PSM-P0-02：把现有 `ConversationEventLog`、session records、task-results、logs、artifacts、verifications 映射为 append-only ledger + ref/blob store；`ensureSessionBundle()` 已创建 `ledger/` 与 `projection/` restore 入口，projection 可从 events/ref index 重建。
- [x] PSM-P0-03：实现 cache-aware context projection compiler：稳定 prefix/workspace identity/stable session state/index blocks 字节级复用，current task packet 和 retrieved evidence 后置；conversation handoff/context envelope 已消费 PSM projection blocks。
- [x] PSM-P0-04：为 repair/bounded-stop continuation 增加 hard short-circuit：`RecoveryPacket` 只进入 tail task packet，既有 repair hard-stop prompt/stream guard 继续负责阻断长 AgentServer generation。
- [ ] PSM-P1-01：接入 AgentServer retrieval/read-ref/workspace-search contract，让 backend 通过受控 retrieval primitive 按需读取 ledger refs、artifact body、stdout/stderr 和 workspace 文件片段；SciForge handoff 已声明 `retrieve/read_ref/workspace_search`，AgentServer 仍需补 typed `read_ref` 执行端。
- [ ] PSM-P1-02：为 compaction preview/apply 写入 append-only `compaction-recorded` 事件，记录 source event range、decision owner、trigger、output projection refs 和 cache delta；当前已有 `buildCompactionRecordedEvent()` contract，尚需接入真实 preview/apply。
- [x] PSM-P1-03：增加 migration/recovery smoke：`smoke:project-session-memory` 从 ledger/ref store 恢复 active run、artifact index、failure index 和 next handoff packet。
- [x] PSM-P1-04：增加 KV cache regression：连续多轮只改变 tail task packet 时稳定 prefix block hash 不变；repair mode 不重写 stable session summary。

### 2026-05-14 Task：多轮记忆管理收敛到 AgentServer

历史完成项，已被 2026-05-15 `Project Session Memory 与 Cache-aware Context Projection` 边界升级。保留本节作为旧 `memoryPlan` 删除、stable AgentServer session/current-work 接入和多轮 smoke 的完成记录；新的当前原则是 workspace ledger 为可恢复事实源，AgentServer 为 context orchestration，backend 消费 projection。

旧阶段曾采用的方案：把 AgentServer 视为多轮对话记忆的唯一权威来源，SciForge 只投影本轮意图、引用、证据边界和恢复策略。该边界已被上方 Project Session Memory 取代；保留本节只用于说明旧 `memoryPlan` 删除、`handoffMemoryProjection` 收敛和 smoke 验证的完成背景。

架构任务：

- [x] MEM-ARCH-01（历史）：当时将 `docs/Architecture.md` 固化为“AgentServer owns memory, SciForge owns projection”的边界，并删除把 `memoryPlan`、conversation ledger 或 UI recent messages 描述为本地长期记忆的旧表述；当前实现依据以上方 PSM 边界为准。
- [x] MEM-ARCH-02：梳理 `conversation-policy` 输出字段语义：`contextReusePolicy` 只表达 `continue/repair/isolate`，`handoffMemoryProjection` 只表达本轮可暴露摘要和 refs，不承担 recall。
- [x] MEM-ARCH-03（历史）：把 AgentServer `/context`、`/compact`、stable `agentId`、`contextPolicy.includeCurrentWork/includeRecentTurns/persistRunSummary` 写成当时阶段的多轮记忆 contract；当前需升级为 workspace ledger + AgentServer orchestration + backend projection contract。

实现 TODO：

- [x] MEM-P0-01：修正 continuation 判定链路，用户问“你还记得一开始的问题吗”这类纯多轮指代时必须稳定复用 AgentServer session/current-work，而不是 fresh agent scope。
- [x] MEM-P0-02：检查 `agentServerContextPolicy()` 与 `agentServerAgentId()`：fresh task 隔离旧记忆，continue/repair 使用稳定 scope，并打开 AgentServer recent turns/current work。
- [x] MEM-P0-03：`contextEnvelope` 只携带 current turn snapshot、refs、digest、artifact/run refs 和 policy summary；禁止把完整历史、raw logs 或大 artifact body 作为本地记忆塞回 handoff。
- [x] MEM-P0-04：AgentServer context/compact API 不可用时只降级为 refs-first handoff slimming，并在 UI/runtime event 中说明“记忆服务不可用”，不静默启用本地长期记忆 fallback。
- [x] MEM-P1-01：为多轮记忆增加 smoke/browser case：先问 A，再跑文献/计算任务，再问“我一开始问的是什么”，验证 AgentServer 记忆能回答且不会被当前 artifact refs 污染。
- [x] MEM-P1-02：增加 isolate case：新任务带显式 current refs 时不得复用旧 AgentServer recent turns，避免旧研究目标污染当前结论。
- [x] MEM-P1-03：增加 repair case：只复用目标 failed run、failure evidence refs 和 AgentServer current work，不读取无关历史 run。
- [x] MEM-P1-04：UI 显示 context/memory 状态时区分 AgentServer memory、SciForge projection、handoff slimming 和 audit refs，避免让用户误以为本地 UI ledger 就是完整记忆。
- [x] MEM-P2-01：删除 `memoryPlan` 旧链路并统一为 `handoffMemoryProjection`，在类型、测试和文档中消除“本地记忆系统”误解。


### H022 Real-world Complex Task Backlog for SciForge Hardening

职责：沉淀更多真实、多轮、可复现的用户任务，用这些任务持续压测 SciForge 的通用能力边界。每个任务都必须像真实用户一样提出目标、补充约束、引用中间结果、追问失败原因、要求继续或导出，而不是只跑单轮 happy path。后续修复必须从任务暴露的问题中抽象出通用 runtime、harness、payload、artifact、verification、resume、presentation 或 backend handoff 改造，禁止为某个 prompt、某篇论文、某个文件名、某个 backend 写硬编码。

2026-05-15 网页端多轮压测进展：

- 已将 27 轮 browser 多轮上下文压测接入正式 `smoke:browser-multiturn` 脚本入口，并修复脚本对折叠 composer、当前 `sessionMessages` transport contract 和 context meter 压缩回落的旧假设；该网页压测覆盖长上下文、失败 run、复用 partial/日志继续、审计导出四段链路；截图证据：`docs/test-artifacts/browser-smoke-multiturn-context.png`。
- 从 `smoke:complex-multiturn-chat` 暴露并修复通用 handoff 缺口：failed run 的真实失败诊断必须来自结构化 `ExecutionUnit.failureReason`、recover actions 和 stdout/stderr/output refs；`streamProcess` 运行转写继续只保留 digest/refs，避免把 raw 过程当本地长期记忆塞回 prompt。
- 从同一压测暴露并修复 running guidance 继承缺口：运行中排队的用户约束在下一轮 transport `guidanceQueue` 中保留有界结构化正文，历史 message content 继续 digest 化，避免重复作为本地聊天记忆回灌。
- 扩展 `smoke:browser` 网页 failed-run restore 压测为三轮恢复链路：先诊断不重跑，再基于 partial/stdout/stderr refs 继续，最后确认可重试失败 PDF 并导出 audit 摘要；由此补齐 projection-first continuation 对 `failureReason`、`recoverActions`、`nextStep` 的结构化保留，并对超长诊断正文做 digest 化。
- 将网页 fixtures 对齐真实 delivery/ref contract：structure/reference/T097 场景都使用 run、ExecutionUnit、ArtifactDelivery 和 workspace-relative artifact refs；browser smoke 统一 mock AgentServer health/compact，避免本机 18080 状态影响 UI handoff 压测结论。
- 已用并行 subagents 补充 H022 后续缺口清单：R-UI-03 需要显式覆盖“点旧对象后继续”而非只验证 ref kind；还应增加 missing provider、empty result、partial-first 外部失败、多标签/历史编辑和 evidence bundle 导出场景。当前仍未勾选任何 R-*。
- 第二轮网页压测已把 R-UI-03 负例接入 `smoke:browser`：同一 restored session 同时存在旧报告和最新报告，用户显式点选旧 file 后追问时，top-level references、`uiState.currentReferences`、`uiState.agentContext.currentReferences` 都必须指向旧对象，且不得混入最新 artifact。
- 第二轮网页压测补上 R-UI-08 的真实 UI 导出路径：failed-run 三轮恢复后显式切到“只看执行单元”，点击 `导出 JSON Bundle`，解析浏览器导出的 bundle，断言 active run scope、session bundle refs、runtime-events、stdout/stderr、verification verdict 和 Failure/Improvement Note refs；同时修复 projection execution focus 下缺少 ExecutionUnit 导出入口、backend ExecutionUnit 未带 runId 时无法归属当前 UI run 的通用问题。
- CAP-P2-02 已新增独立网页 smoke `smoke:browser-provider-preflight`：启动真实 workspace/UI 与 mock AgentServer HTTP server，不拦截 SciForge `/tools/run/stream`；第一轮无 `web_search/web_fetch` provider 时断言 workspace runtime 在 AgentServer run dispatch 前 fail-closed，第二轮启用 server-side worker discovery 后同一文献任务进入 AgentServer dispatch，并把 zero-result 作为 `repair-needed`/可恢复状态展示，保留 provider route/provider id 断言。CAP-P2-02 的 happy-path“真实可检索、下载、总结”仍需后续用非空 mock/真实 provider 补齐后再勾选。
- R-LIT-02/R-UI-06 补充了一条 UI view-model contract：带 empty/zero-result 诊断和 recoverActions、无 artifacts 的 ConversationProjection 必须映射为 `recoverable`/“运行需要恢复”，防止 protocol success 或 message-only 输出被误当成完成报告。
- 本轮属于网页 smoke/contract hardening，尚未满足 H022 单个 R-* 真实任务的完整 evidence bundle 要求；后续应按 longform manifest 记录 session bundle、runtime events、stdout/stderr、verification verdict 和 Failure/Improvement Note 后再勾选具体 R-*。

执行规则：

- 每个真实任务都要保留 session bundle、runtime events、task inputs、task outputs、stdout/stderr、artifact refs、executionUnits、verification verdict 和最终用户可见结果。
- 每个任务结束后必须补一条 `Failure/Improvement Note`：问题现象、最小复现步骤、通用归因层、建议修复入口、不能采用的特例修复。
- 如果任务失败但产生了可用 partial，必须继续追问一次“复用已有结果继续”，测试 checkpoint 和 artifact lineage。
- 如果任务成功，必须继续追问一次“换范围/换格式/补证据/导出审计”，测试多轮引用和状态继承。
- 每类任务至少覆盖一个长任务、一个外部依赖不稳定、一个 schema/payload 漂移、一个用户中途改范围、一个历史恢复或刷新继续。
- 所有 TODO 默认是待跑真实任务，不代表已经实现修复；跑完后再把发现的问题拆成 H018-H021 或新 H 项下的通用工程任务。

文献与科研调研真实任务：

- [ ] R-LIT-01 今日 arXiv agent 论文深调研：检索今日/最近 agent 论文，下载 PDF，阅读全文，产出中文 markdown 报告；随后要求按方法、数据集、评测指标、主要结论重排；再要求导出审计包。已压测真实失败边界，保留 evidence bundle；后续修复见本轮 notes。
- [ ] R-LIT-02 arXiv 空结果恢复：限定一个很窄主题和当天日期，预期可能空结果；要求系统自动说明 empty result、扩展 query、保留不确定性，并继续生成 partial 报告。
- [ ] R-LIT-03 多来源文献对照：同一主题分别检索 arXiv、Semantic Scholar/PubMed/网页来源，去重并标注来源差异；用户要求删除低可信来源后重写结论。
- [ ] R-LIT-04 全文下载失败恢复：要求下载 10 篇论文全文，其中部分 PDF 超时/403/过大；系统必须保留已下载全文、标注失败原因、继续基于 metadata 补 partial。
- [ ] R-LIT-05 引用修正多轮：先生成报告，再让用户指出某条引用不可信；系统必须定位原 artifact/ref，修正该段，不污染其他结论。
- [ ] R-LIT-06 研究方向综述迭代：先做宽泛综述，再要求缩小到 robotics agent，再要求排除 benchmark 论文，再要求只保留开源代码论文。
- [ ] R-LIT-07 论文复现可行性筛选：检索论文后按代码可用性、数据集可用性、计算成本、复现风险排序，并导出复现计划。
- [ ] R-LIT-08 反事实追问：报告完成后用户问“如果只看非 LLM agent 呢”，系统必须复用已有检索 refs 并说明哪些需要刷新。已覆盖“缺少可用 paper-list/report 时必须先 repair/resume”的失败边界。
- [ ] R-LIT-09 历史文献任务恢复：打开昨天失败的 literature session，要求只看诊断不重跑；系统必须展示失败边界、可复用 refs 和下一步选项。
- [ ] R-LIT-10 双语报告：同一调研先生成中文报告，再要求英文 executive summary，再要求中英术语表，验证 artifact 派生关系。

代码修复与工程任务：

- [ ] R-CODE-01 端到端 bug 修复：用户贴浏览器失败截图，要求定位原因、写通用修复、跑测试、重启服务、同步 GitHub；过程中用户中断一次后继续。
- [ ] R-CODE-02 Schema drift 修复：构造 backend 返回宽松 JSON、fenced JSON、缺字段 payload、空 artifactRef 等情况，要求系统统一归一化而非 repair loop。
- [ ] R-CODE-03 长任务 stream 稳定性：运行超过前端 timeout 的任务，刷新浏览器、关闭标签、恢复历史，验证后端不被 passive disconnect 杀掉。
- [ ] R-CODE-04 多模块改造：让 agent 同时改 gateway、UI presentation、runtime contract、tests；用户中途要求缩小范围，只保留 runtime 修复。
- [ ] R-CODE-05 测试失败恢复：第一次 patch 后 typecheck/test 失败，用户要求解释失败并做最小通用修复，不能回滚无关改动。
- [ ] R-CODE-06 Dirty worktree 协作：预先放入用户未提交改动，再让 agent 修复另一区域，验证不会 reset/revert 用户改动。
- [ ] R-CODE-07 Release verify 请求：用户要求“等完整验证再推 GitHub”，系统必须阻塞到指定测试完成，失败时不推送。
- [ ] R-CODE-08 Backend handoff 漂移：AgentServer 返回 taskFiles、direct ToolPayload、plain text、malformed generation response 四类输出，要求统一分类和可恢复。
- [ ] R-CODE-09 多 backend 对比修复：同一任务用 Codex/OpenTeam 两个 backend 跑，比较失败模式，提炼 backend-neutral 修复。
- [ ] R-CODE-10 项目服务生命周期：修改代码后自动重启 dev server，确认端口占用、旧进程退出、新服务 ready、浏览器页面可刷新。

数据分析与文件 artifact 任务：

- [ ] R-DATA-01 CSV 多轮分析：上传/引用 CSV，先做摘要统计，再改分组口径，再要求异常值解释，再导出 markdown 报告和复现代码。
- [ ] R-DATA-02 两表合并冲突：A/B 两个表字段不一致，用户给映射规则，系统重算并保留 mapping artifact。
- [ ] R-DATA-03 大文件摘要：读取大文本/日志文件，只允许摘要和 refs，不允许把全文塞入 prompt；后续追问必须按需读取片段。
- [ ] R-DATA-04 图表迭代：先生成图表 artifact，再要求换坐标、换颜色、筛选子集、导出最终报告，测试 artifact identity。
- [ ] R-DATA-05 缺失文件恢复：历史 artifact 指向的文件被删除/移动，用户要求继续，系统必须 stale-check 并进入安全恢复。
- [ ] R-DATA-06 Notebook 风格任务：连续执行多个分析步骤，每步都有中间文件；用户要求回到第 2 步换参数后继续生成分支结果。
- [ ] R-DATA-07 外部数据源限流：调用外部 API 拉数据遇到 429/timeout，系统必须输出 transient-unavailable 诊断和重试建议。
- [ ] R-DATA-08 审计导出：分析完成后用户只要求导出 task graph、数据 lineage、执行命令和 artifact refs，不重新计算。

Runtime、恢复与会话生命周期任务：

- [ ] R-RUN-01 失败 run 诊断：用户点选 failed run，要求解释为什么失败、哪些文件可用、是否能继续、下一步怎么做。
- [ ] R-RUN-02 Repair loop 防护：制造 repeated repair no-op，要求系统停止重复修复并给通用失败分类。
- [ ] R-RUN-03 Background continuation：启动长任务后用户继续问另一个问题，后台完成后要求合并结果并标注 revision。
- [ ] R-RUN-04 多标签并发：两个浏览器标签对同一 session 发送消息，验证 ordering/conflict guard。
- [ ] R-RUN-05 编辑历史 revert：修改早期用户目标并选择 revert，系统必须废弃后续派生 runs/artifacts。
- [ ] R-RUN-06 编辑历史 continue：修改早期目标但保留已有结果，系统必须标注冲突和受影响结论。
- [ ] R-RUN-07 跨 session 恢复：新开页面恢复旧 session，只依赖持久化 state，不依赖前端内存。
- [ ] R-RUN-08 取消边界：用户显式 cancel 后要求继续，系统必须说明 cancel boundary，不自动恢复不可逆 side effect。
- [ ] R-RUN-09 版本漂移恢复：代码更新后打开旧 session，系统检测 capability/schema/version drift 并建议迁移或重跑。
- [ ] R-RUN-10 压缩后恢复：模拟只剩 state digest 和 refs，继续多轮任务，检查 artifact/run/ref 是否仍能命中。

UI 与 presentation 真实任务：

- [ ] R-UI-01 失败结果可读性：失败时右侧结果必须先展示用户可理解的原因、可用产物、下一步，而不是 raw trace 优先。
- [ ] R-UI-02 Partial 优先：长任务运行中必须展示已完成部分、当前阶段、后台状态和可安全中止/继续的操作。
- [ ] R-UI-03 Artifact 选择追问：用户点选某个 file/artifact 后追问“基于这个继续”，系统必须使用被点选对象而不是最近对象。
- [ ] R-UI-04 ExecutionUnit 展示：运行结果中 execution unit 必须包含 codeRef/stdoutRef/stderrRef/outputRef、状态、失败原因和 recoverActions。
- [ ] R-UI-05 Verification 状态：普通结果、未验证结果、后台验证中、验证失败、release verify 通过五种状态 UI 必须可区分。
- [ ] R-UI-06 空结果页面：没有 artifact 时不能显示误导性 completed；必须展示 empty/needs-human/recoverable 的准确状态。
- [ ] R-UI-07 多 artifact 比较：结果区同时出现 report、paper-list、diagnostic、verification，用户切换 focus mode 后仍保持正确排序。
- [ ] R-UI-08 导出 bundle：用户要求导出 JSON bundle/审计包，UI 必须能引用正确 session bundle 而不是当前空状态。

真实用户工作流任务：

- [ ] R-WF-01 科研选题助手：用户从模糊方向开始，逐步要求找热点、筛论文、列可做实验、评估新颖性、生成计划。
- [ ] R-WF-02 论文审稿助手：上传/引用论文 PDF，要求总结贡献、找弱点、查相关工作、生成审稿意见，再要求改成温和语气。
- [ ] R-WF-03 复现实验计划：从论文出发，提取环境、数据、训练命令、评测指标、风险，生成 step-by-step 复现 checklist。
- [ ] R-WF-04 项目周报：读取 workspace 最近任务、失败 run、已完成 artifact，生成周报；用户要求隐藏敏感路径后重写。
- [ ] R-WF-05 多同学协作分工：基于当前 PROJECT 和代码结构，给 3-5 个同学拆分任务；后续要求按风险/收益重排。
- [ ] R-WF-06 调研到代码任务：先调研某技术方案，再要求在 SciForge 中实现最小通用修复，再生成测试计划。
- [ ] R-WF-07 用户反馈收敛：用户连续指出“慢、崩、看不懂、引用错、重复跑”，系统把反馈归类到通用 TODO，而不是逐条道歉。
- [ ] R-WF-08 低预算模式：用户要求“不要下载全文，先用 metadata 快速判断”，后续再允许补全文，测试 budget escalation。
- [ ] R-WF-09 严格证据模式：用户要求“不要猜，不确定就标注”，系统必须降低 claim confidence 并输出 evidence gaps。
- [ ] R-WF-10 发布前检查：用户要求把本地改动推 GitHub 前做 release verify、写变更摘要、重启服务，并保留审计记录。

通用修复 TODO 池：

- [ ] TODO-GEN-01 为每个真实任务自动生成 `TaskRunCard`：目标、轮次、状态、refs、失败模式、通用归因层、下一步。
- [ ] TODO-GEN-02 建立 `FailureSignature` 去重：相同 schema drift、timeout、repair no-op、external transient 不重复开新诊断。
- [ ] TODO-GEN-03 建立 `NoHardcodeReview` checklist：每次修复必须说明适用场景、反例、为什么不是 prompt/file/backend 特例。
- [ ] TODO-GEN-04 让真实任务跑完后自动建议归属：harness、runtime server、AgentServer parser、payload normalization、presentation、verification、resume、UI。
- [ ] TODO-GEN-05 为“成功但不满足用户真实目标”的情况增加状态：protocol success 不等于 task success，必须进入 needs-work/needs-human。
- [ ] TODO-GEN-06 为 direct-text fallback 增加 guard：像代码、taskFiles、JSON、trace、日志的内容不能轻易包装成最终报告。
- [ ] TODO-GEN-07 为 schema normalization 建立白名单边界：只修复结构漂移，不吞掉真实语义错误或安全错误。
- [ ] TODO-GEN-08 为 external transient 建立 provider-neutral policy：HTTP、DNS、timeout、rate limit、quota、service unavailable 统一分类。
- [ ] TODO-GEN-09 为 session bundle 增加“一键打包/恢复/审计”检查清单，确保每个多轮任务可独立迁移。
- [ ] TODO-GEN-10 为复杂任务新增“用户满意度 proxy”：是否回答了最新请求、是否展示可用结果、是否给出下一步、是否避免重复劳动。

## Stability Orchestration

状态：active
总控：Codex Orchestrator
当前轮次：1

### 稳定化标准

- `npm run typecheck` 通过。
- 与本轮修复相关的单测或 smoke 通过。
- 网页端核心启动/多轮/恢复路径没有新增 runtime、console 或 payload contract 错误。
- Finder 连续 3 轮没有发现新的 P0/P1 稳定性问题后，可进入 `stable-candidate`。

### Agent 协作规则

- Finder Agent 负责使用、压测、复现和记录问题，不直接修代码。
- Fixer Agent 负责认领一个最高优先级问题、做最小通用修复、补测试和验证。
- 两个 agent 只能通过本节的 Issue Queue、Activity Log 和 Current Handoff 交接状态。
- 每个问题必须有唯一 ID、严重级别、复现步骤、期望行为、实际行为、证据、建议归因层。
- 修复必须说明为什么是通用修复，不能是 prompt、文件名、单一 backend 或单一 fixture 特例。
- 如同一问题 3 次修复仍未通过验证，移入 Blocked，等待人工或总控重新拆解。

### Issue Queue

#### Open

待 Finder 补充本轮发现。

#### In Progress

无。

#### Fixed Pending Verification

##### SF-STAB-006 - P1 - Minimal provider-route repair continuation still bounded-stops instead of returning a terminal payload

- 发现者：Orchestrator Round 4
- 修复者：Fixer Workers Round 4 + Orchestrator
- 来源：真实 in-app browser 使用，不是 terminal-only check。
- 前置状态：`SF-STAB-005` 修复后，provider-route minimal repair prompt 已不再被 `sciforge.direct-context-fast-path` 吃掉，而是进入 `agentserver.generate.literature`。
- 复现步骤：
  1. 重启 dev services，刷新真实 in-app browser `http://127.0.0.1:5173/`。
  2. 在同一 `literature-evidence-review@1.0.0` 会话中保留上一轮 bounded-stop 失败。
  3. 发送：`continue from the last bounded stop. do not start long generation. produce one minimal single stage result only. if web search or web fetch provider routes are usable then create a minimal adapter task that uses those provider routes. if this cannot be determined in this turn then return a valid failed with reason tool payload with failure reason recover actions next step and refs. do not ask agentserver for another long loop.`
  4. 等待最新 run 结束。
- 期望行为：AgentServer repair continuation 应返回一个最小 provider-route adapter task，或直接返回合法 `failed-with-reason`/`repair-needed` ToolPayload；不应再次消耗到 repair token guard。
- 实际行为：最新 run `project-literature-evidence-review-mp6qhi1m-hrit5p · failed · recoverable` 进入 `agentserver.generate.literature`，但仍以 `AgentServer repair generation bounded-stop after 94073 total tokens (limit 60000)` 结束，没有生成最小 adapter task，也没有合法 terminal ToolPayload。
- 证据：in-app browser 最新 run 的 ExecutionUnit `EU-literature-29e9e595` failureReason 为上述 bounded-stop；browser 本地 console error 为空。旧 `Tool/provider status answered...` 文本只来自历史 run，最新 run 不再由 direct-context fast path 完成。
- 疑似归因层：AgentServer repair continuation prompt/protocol 或 SciForge gateway repair fallback；当用户明确要求不要长生成且允许 terminal failed payload 时，系统应有一个 deterministic fallback，不能无限把同一 prompt 交给 AgentServer 重试。
- 为什么是通用问题：任何 backend 在 repair/minimal continuation 下不遵守 hard-stop 时，用户仍会卡在 recoverable bounded-stop；这会阻断所有 provider-first 修复闭环，不限于文献场景。
- 修复说明：AgentServer repair continuation prompt 明确只允许两种 terminal compact JSON：最小 provider-route adapter `AgentServerGenerationResponse`，或 `executionUnits.status="failed-with-reason"` 的 SciForge ToolPayload。stream guard 对 repair bounded-stop 抛出 typed error；generation gateway 将该 typed bounded-stop 转成终端 `repair-needed` ToolPayload，带 `repair-continuation-bounded-stop` blocker、failureReason、recoverActions、nextStep 和 refs/digests-only guidance，而不是继续裸露 backend generation failure。
- 追加修复：英文 fresh retrieval `search recent papers... if web_search provider is unavailable...` 不再被 provider-status fast path 截获；只有纯 provider/status 查询继续走 status fast path。
- 文件变更：`src/runtime/gateway/agentserver-prompts.ts`、`src/runtime/gateway/agentserver-stream.ts`、`src/runtime/generation-gateway.ts`、`src/runtime/gateway/context-envelope.test.ts`、`src/runtime/gateway/agentserver-stream.test.ts`、`src/runtime/generation-gateway.policy.test.ts`、`tests/smoke/smoke-agentserver-compact-repair.ts`、`src/runtime/gateway/direct-context-fast-path.ts`、`src/runtime/gateway/direct-context-fast-path.test.ts`。
- 验证命令：
  - `node --import tsx --test src/runtime/gateway/agentserver-stream.test.ts src/runtime/generation-gateway.policy.test.ts src/runtime/gateway/context-envelope.test.ts` 通过，22 tests。
  - `npm run smoke:agentserver-compact-repair` 通过。
  - `node --import tsx --test src/runtime/gateway/direct-context-fast-path.test.ts` 通过，16 tests。
  - `npx tsc --noEmit --pretty false` 通过。
- 浏览器复验状态：Orchestrator 已在真实 in-app browser 恢复 Workspace Writer URL 到 `http://127.0.0.1:5174` 并重跑文献场景。后续 repair continuation 最新 run `project-literature-evidence-review-mp6rl5bt-m6nutb · failed · recoverable` 没有再次出现 bounded-stop，而是在 AgentServer 模型渠道 `503 Service Unavailable` 处可恢复失败；browser 本地 console error 为空。仍需在模型渠道恢复后 replay 同一 bounded-stop 场景，确认 gateway terminal fallback 在真实 browser 中呈现为 `repair-needed` ToolPayload。

#### Verified

##### SF-STAB-005 - P1 - Provider-status fast path swallows minimal repair continuation and leaves browser run empty

- 发现者：Orchestrator Round 3
- 修复者：Fixer Workers Round 3 + Orchestrator
- 来源：真实 in-app browser 使用，不是 terminal-only check。
- 前置状态：`SF-STAB-004` verified 后，最新 browser run `project-literature-evidence-review-mp6pkfla-qintck` 已以 bounded recoverable failure 停止，不再触发 300k convergence guard。
- 复现步骤：
  1. 在同一 `literature-evidence-review@1.0.0` in-app browser 会话中保留上一轮 bounded-stop 失败。
  2. 继续发送等价最小修复指令：`continue from the last bounded stop. do not start long generation. produce one minimal single stage result only. if web search or web fetch provider routes are usable then create a minimal adapter task that uses those provider routes. if this cannot be determined in this turn then return a valid failed with reason tool payload with failure reason recover actions next step and refs. do not ask agentserver for another long loop.`
  3. 等待最新 run 结束。
- 期望行为：系统应把这类请求识别为 repair/continue execution intent：要么生成使用 provider route 的最小 adapter task，要么返回合法 `failed-with-reason`/`repair-needed` ToolPayload；不能只回答 provider status。
- 实际行为：最新 run `project-literature-evidence-review-mp6q2j4t-de2bzt · empty` 走 `sciforge.direct-context-fast-path`，仅返回 `Tool/provider status answered from SciForge runtime registries...` 和 `web_search/web_fetch: ready`，没有 adapter task、没有 failed-with-reason payload，也没有可展示 artifact，右侧显示“当前 run 没有 ConversationProjection 或可展示产物”。
- 证据：in-app browser DOM 显示该 run 的过程为 `Explored sciforge.direct-context-fast-path · runtime://capability-provider-status/... Done`，claims 包含 `Required provider routes are available.`；browser console error 为空。
- 疑似归因层：`src/runtime/gateway/direct-context-fast-path.ts` 中 provider-status intent 过宽；包含 `create/generate/minimal adapter task/continue from failed run` 的 provider-route repair 请求不应被 capability status fast path 截获。
- 为什么是通用问题：任何用户在失败后要求“如果 provider 可用就继续生成最小任务，否则合法失败”的恢复请求，都可能被 status-only fast path 吃掉，导致协议层 completed/empty 而真实目标未完成。
- 修复说明：收紧 `direct-context-fast-path` intent 分类，让 capability/provider status fast path 只回答纯状态/可用性问题；当 prompt 同时要求 create/generate/build/produce/run/continue task/adapter/result/payload，或要求返回 `failed-with-reason`/repair payload 时，必须让出给 backend/repair execution。`不要重跑无关步骤` 这类 scoped anti-rerun 指令如果伴随修复/生成意图，也不再被当作 context-only direct answer。
- 文件变更：`src/runtime/gateway/direct-context-fast-path.ts`、`src/runtime/gateway/direct-context-fast-path.test.ts`、`tests/smoke/smoke-t098-latency-diagnostics-matrix.ts`。
- 验证命令：
  - `node --import tsx --test src/runtime/gateway/direct-context-fast-path.test.ts` 通过，15 tests。
  - `node --import tsx tests/smoke/smoke-t098-latency-diagnostics-matrix.ts` 通过。
- 浏览器验证：重启 dev services 后，用真实 in-app browser 重发同一最小修复 continuation。最新 run `project-literature-evidence-review-mp6qhi1m-hrit5p` 不再走 `sciforge.direct-context-fast-path` status-only empty，而是进入 `agentserver.generate.literature`；browser 本地 console error 为空。
- 剩余风险：进入 AgentServer 后仍 bounded-stop，已另拆为 `SF-STAB-006`。

##### SF-STAB-004 - P1 - Browser bounded repair handoff still lets AgentServer generation self-loop to convergence guard

- 发现者：Orchestrator Round 2
- 修复者：Fixer Worker Round 2
- 来源：真实 in-app browser 使用，不是 terminal-only check。
- 前置状态：`SF-STAB-003` 修复后重启 dev services，并在同一 `literature-evidence-review@1.0.0` browser 会话中重发 repair continuation。
- 复现步骤：
  1. 在文献场景中保留 provider-first preflight failure 和历史 convergence guard failure。
  2. 发送：`请复用这次失败诊断继续，不要重跑无关步骤；修正生成任务，必须使用 SciForge 已解析的 web_search/web_fetch provider route 或输出合法失败 payload，然后继续完成中文证据摘要。`
  3. 等待最新 run 结束。
- 期望行为：bounded repair prompt 应让 AgentServer 返回一个最小修复 task、直接合法 failed-with-reason ToolPayload，或在较小 generation budget 内可恢复失败；不应继续进行无界自循环。
- 实际行为：新 handoff 已切到 repair 紧预算，slimming trace 显示 `maxPayloadBytes=96000`、`normalizedBytes=65871`、`maxPriorAttempts=1`，但真实 browser run 仍以 convergence guard 失败：`AgentServer generation stopped by convergence guard after 332847 total tokens (limit 300000)`。
- 证据：in-app browser 显示最新 run `project-literature-evidence-review-mp6p8nf9-gylju7 · failed · recoverable`，ExecutionUnit `EU-literature-9714406b` failureReason 为上述 332847 convergence guard；browser console error 为空。对应 handoff trace：`.sciforge/sessions/2026-05-14_literature-evidence-review_session-literature-evidence-review-mp5qqlah-7ejx43/handoffs/2026-05-15T09-08-52-229Z-agentserver-generation-0d38d10f31-slimming-trace.json`。
- 疑似归因层：AgentServer generation prompt/protocol still allows long deliberation/tool-loop under repair; repair prompt should force minimal provider-route patch or recoverable payload and perhaps use a lower repair-specific generation guard.
- 为什么是通用问题：即使 handoff 已 refs/digests-only，任何 repair continuation 都可能因 backend generation 自循环拖到全局 300k guard，用户仍得不到可恢复下一步。
- 修复说明：repair continuation prompt 增加 hard-stop，要求单阶段 minimal repair/continue，禁止 broad history/full pipeline/tool-loop；refs 不足时必须返回合法 `failed-with-reason` ToolPayload。generation gateway 将 `repairContinuation` 写入 prompt metadata/system prompt/tool policy/stream guard；AgentServer stream 对 repair continuation 使用更低 token guard，`maxContextWindowTokens=200000` 时从默认 300000 前移到 60000，并返回明确 bounded-stop recoverable failure。
- 文件变更：`src/runtime/gateway/agentserver-prompts.ts`、`src/runtime/gateway/agentserver-stream.ts`、`src/runtime/generation-gateway.ts`、`src/runtime/gateway/agentserver-stream.test.ts`、`src/runtime/gateway/context-envelope.test.ts`。
- 验证命令：
  - `node --import tsx --test src/runtime/gateway/agentserver-stream.test.ts src/runtime/gateway/context-envelope.test.ts src/runtime/gateway/agentserver-context-window.test.ts src/ui/src/app/chat/sessionTransforms.test.ts` 通过，48 tests。
  - `npx tsc --noEmit --pretty false` 通过。
- 浏览器验证：Orchestrator 重启 dev services 后用真实 in-app browser 重发同一 continuation。新 handoff 包含 `Repair-continuation hard stop` 和 `repairContinuation` metadata，仍为 repair 紧预算；最新 run `project-literature-evidence-review-mp6pkfla-qintck` 以 recoverable 失败返回，不再拖到 300k 全局 guard，而是在 `AgentServer repair generation bounded-stop after 93840 total tokens (limit 60000)` 停止；browser console error 为空。
- 剩余风险：当前模型仍没有产出最终中文证据摘要，而是按 bounded repair guard 返回可恢复失败。下一轮稳定性工作应聚焦 provider-route minimal repair task 的成功率，而不是上下文/loop 爆炸。

##### SF-STAB-003 - P1 - Browser repair continuation sends unbounded AgentServer handoff and hits convergence guard

- 发现者：Orchestrator Round 1
- 修复者：Fixer Agent Round 1
- 来源：真实 in-app browser 使用，不是 terminal-only check。
- 前置状态：`SF-STAB-002` 修复后，在同一 `literature-evidence-review@1.0.0` browser 会话中重发 repair continuation。
- 复现步骤：
  1. 在文献场景中保留一个 provider-first preflight failure：`Generated task uses direct external network APIs (requests, urllib) even though SciForge has ready provider route(s) for web_fetch, web_search.`
  2. 发送：`请复用这次失败诊断继续，不要重跑无关步骤；修正生成任务，必须使用 SciForge 已解析的 web_search/web_fetch provider route 或输出合法失败 payload，然后继续完成中文证据摘要。`
  3. 等待最新 run 结束。
- 期望行为：repair handoff 应只携带失败诊断、相关 ExecutionUnit refs、provider route policy 和必要 digest，进入 bounded repair task generation；即使失败，也应在可控 token budget 内给出合法 recoverable payload。
- 实际行为：最新 run 进入 `context=repair; executionMode=repair-or-continue-project` 并连接 AgentServer，但最终失败：`AgentServer generation stopped by convergence guard after 307194 total tokens (limit 300000); use bounded session refs, current-reference digests, or a smaller task plan instead of an unbounded generation loop.`
- 证据：in-app browser DOM snapshot 显示最新 run `project-literature-evidence-review-mp6nnvbm-tyg1ic · failed · literature-evidence-review@1.0.0`，结果区为 `运行需要恢复 · recoverable`，failure reason 为上述 convergence guard；browser console error 为空。
- 疑似归因层：repair handoff/context envelope/session projection/AgentServer prompt compaction；可能把旧 run raw generation text、debug trace 或过多 session history带入 repair generation。
- 为什么是通用问题：任何失败 run 的 repair continuation 都可能因为未按 refs/digests-only 边界裁剪上下文而进入超大 handoff，不限于文献任务或 web provider。
- 修复说明：repair continuation 仍复用稳定 AgentServer session id，但不再隐式包含 AgentServer current-work/recent-turn raw bodies；AgentServer core snapshot 在 generation prompt 中只暴露 `recentTurnRefs`、digest、char count、session metadata 和 compaction tag digest。repair generation handoff 使用更紧的 backend payload budget；旧 generated task/code/output/result/text 等 body carrier 字段在 prompt handoff 中被摘要替换为 digest/ref，不内联原始内容。
- 为什么是通用修复：边界基于 repair context/session policy 和通用 body-carrier key 分类，不依赖文献场景、provider 名称、单个 prompt 或具体文件名；任何 repair continuation 的旧 run raw code/output/debug 内容都会走同一 refs/digests-only compaction。
- 文件变更：`src/runtime/gateway/agentserver-context-window.ts`、`src/runtime/gateway/agentserver-prompts.ts`、`src/runtime/generation-gateway.ts`、`src/runtime/gateway/agentserver-context-window.test.ts`、`src/runtime/gateway/context-envelope.test.ts`、`PROJECT.md`。
- 验证命令：
  - `node --import tsx --test src/runtime/gateway/agentserver-context-window.test.ts src/runtime/gateway/context-envelope.test.ts src/ui/src/app/chat/sessionTransforms.test.ts` 通过，43 tests。
  - `npm run typecheck` 通过。
  - `npm run smoke:agentserver-compact-repair` 通过。
- 浏览器验证：Orchestrator 重启 dev services 后用真实 in-app browser 重发同一 continuation；新 handoff trace 显示 repair 紧预算生效：`maxPayloadBytes=96000`、`maxInlineStringChars=8000`、`maxArrayItems=8`、`maxPriorAttempts=1`、`normalizedBytes=65871`。旧 raw generated code/output/debug body 不再是 handoff 爆炸来源。
- 剩余风险：bounded handoff 后 AgentServer generation 仍会自循环到 convergence guard，已另拆为 `SF-STAB-004`。

##### SF-STAB-002 - P1 - Browser repair continuation is over-blocked as no-execution and completes empty

- 发现者：Orchestrator Round 1
- 修复者：Fixer Agent Round 1
- 来源：真实 in-app browser 使用，不是 terminal-only check。
- 前置状态：`SF-STAB-001` 修复后，Orchestrator 在 in-app browser 打开 `http://127.0.0.1:5173/`，进入“文献证据评估场景”，发送真实文献请求。
- 复现步骤：
  1. 打开 `literature-evidence-review@1.0.0` 场景。
  2. 发送：`请检索最近关于 agent workflow reliability 的论文，返回中文证据摘要；如果 web_search provider 不可用，请说明缺失的 provider route 和可恢复下一步，不要伪造结果。`
  3. 等待首轮失败进入 recoverable：页面显示 `Generated task uses direct external network APIs (requests, urllib) even though SciForge has ready provider route(s) for web_fetch, web_search.`
  4. 继续发送：`请复用这次失败诊断继续，不要重跑无关步骤；修正生成任务，必须使用 SciForge 已解析的 web_search/web_fetch provider route 或输出合法失败 payload，然后继续完成中文证据摘要。`
- 期望行为：第二轮应被识别为 repair/continue with bounded execution，允许 AgentServer/workspace 生成 provider-first 修复任务，或在确实不能执行时输出 recoverable/needs-human 且主状态不能误导为 completed empty。
- 实际行为：第二轮显示 `completed`，但主结果为 `主结果等待 ConversationProjection · empty`；ExecutionUnit 为 `EU-runtime-execution-forbidden`，说明 `current-turn constraints forbid workspace/code/external execution`，并提示需要用户“明确允许执行后再继续”。这与用户“修正生成任务...然后继续完成”的明确继续意图冲突。
- 证据：in-app browser DOM snapshot 显示第二轮 run `project-literature-evidence-review-mp6n4f8x-urz5i9 · completed`，同时显示 `Runtime execution was not started because current-turn constraints forbid workspace/code/external execution`、`Needs human`、`主结果等待 ConversationProjection · empty`；browser console error 为空。
- 疑似归因层：conversation intent / current-turn execution constraints / repair continuation classification；可能把“不要重跑无关步骤”误解成 no-execution，而没有尊重“修正生成任务...继续完成”。
- 为什么是通用问题：任何失败 run 的“复用诊断继续、只跑必要步骤”都可能被过度归类为 no-execution，导致 repair loop 无法闭环；这不是某篇论文、某个 provider 或某个 prompt 的特例。
- 修复说明：在 Python conversation policy 中区分全局 no-execution 指令与 scoped anti-rerun guidance。`不要重跑无关/不相关/不必要/已完成/重复步骤` 这类约束如果同时出现 repair/continue/complete/use/invoke/provider-route 等继续执行意图，不再生成 `turnExecutionConstraints`，从而允许 bounded repair execution；纯 `不要执行/不要调用/只基于 refs` 仍保持 fail-closed。
- 文件变更：`packages/reasoning/conversation-policy/src/sciforge_conversation/goal_snapshot.py`、`packages/reasoning/conversation-policy/tests/test_goal_snapshot.py`、`packages/reasoning/conversation-policy/tests/test_execution_classifier.py`、`PROJECT.md`。
- 验证命令：
  - `python -m unittest packages/reasoning/conversation-policy/tests/test_goal_snapshot.py packages/reasoning/conversation-policy/tests/test_contracts.py` 通过，14 tests。
  - `PYTHONPATH=packages/reasoning/conversation-policy/src python -m pytest packages/reasoning/conversation-policy/tests/test_execution_classifier.py` 通过，17 tests。
  - provider-neutral service probe 通过：同类 repair continuation 输出 `turnExecutionConstraints: {}`、`executionMode: repair-or-continue-project`，风险为 external/multi-provider/recent-failure 而非 execution-forbidden。
  - `node --import tsx --test src/runtime/generation-gateway.policy.test.ts` 通过，2 tests。
  - `npm run typecheck` 通过。
- 浏览器验证：Orchestrator 在真实 in-app browser 中重发同一 continuation；最新 run 不再生成 `EU-runtime-execution-forbidden`，而是进入 `context=repair; executionMode=repair-or-continue-project` 并连接 AgentServer。该修复验证通过；后续暴露的 unbounded handoff/convergence guard 另拆为 `SF-STAB-003`。

##### SF-STAB-001 - P0 - Browser UI blocked by unresolved observe/web package import

- 验证者：Orchestrator Round 1
- 验证方式：in-app browser reload `http://127.0.0.1:5173/` 后主界面可用，无 Vite overlay；随后成功打开 `literature-evidence-review@1.0.0` 场景并发送真实 UI 请求。
- 验证命令：`npm run smoke:service-lifecycle` 通过；`npm run typecheck` 通过。
- 结论：已验证启动阻断解除；后续真实任务发现的新问题拆为 `SF-STAB-002`。

#### Blocked / Won't Fix

无。

### Activity Log

- 2026-05-15 16:00 CST - Orchestrator - 建立 Stability Orchestration 协作区，准备启动 Finder/Fixer 双 agent 轮次。
- 2026-05-15 16:12 CST - Finder Agent Round 1 - 读取 `PROJECT.md`、`docs/Architecture.md`、`docs/AgentHarnessStandard.md`；最初跑了 bounded terminal checks（`npm run typecheck`、web-worker node:test、provider/external failure node:test）且均通过，但根据总控新指令，这些只作为背景，不据此开问题。
- 2026-05-15 16:16 CST - Finder Agent Round 1 - 清理被中断后残留的临时 browser smoke 进程，避免污染后续真实浏览器验证。
- 2026-05-15 16:18 CST - Finder Agent Round 1 - 使用 Codex in-app browser 打开 `http://127.0.0.1:5173/`，首屏被 Vite import-analysis overlay 阻断，新增 `SF-STAB-001`。
- 2026-05-15 16:24 CST - Fixer Agent Round 1 - 曾认领 `SF-STAB-001` 并做只读排查；收到总控更新后暂停代码修改，保留 issue 给 Orchestrator 的 dev-health 通用修复路径。
- 2026-05-15 16:28 CST - Orchestrator - 受控重启 owned Vite dev server 后，用 in-app browser 复载确认 SciForge 主界面可用；补强 dev health app-module probes；`npm run smoke:service-lifecycle` 与 `npm run typecheck` 通过；将 `SF-STAB-001` 移到 Fixed Pending Verification。
- 2026-05-15 16:36 CST - Orchestrator - 用 in-app browser 验证 `SF-STAB-001` 已解除，打开文献场景并发送真实 provider-first 请求；首轮 fail-closed 可读，但 continuation 被误判 no-execution，新增 `SF-STAB-002`。
- 2026-05-15 16:49 CST - Fixer Agent Round 1 - 修复 `SF-STAB-002`：conversation policy 不再把 scoped “不要重跑无关步骤”误判为全局 no-execution；补 provider-neutral repair continuation regression；相关 Python/TS/typecheck 验证通过，等待真实 browser 复测。
- 2026-05-15 17:05 CST - Orchestrator - 用 in-app browser 复测 `SF-STAB-002`，确认 continuation 进入 AgentServer repair 路径、不再被 turn constraints 阻断；最新 run 因 307194 token convergence guard 失败，新增 `SF-STAB-003`。
- 2026-05-15 17:22 CST - Fixer Worker B - `SF-STAB-003` gateway patch ready：repair continuation disables implicit raw AgentServer current-work reuse and prompt handoff now summarizes AgentServer snapshots plus old task source/output bodies as refs/digests; targeted gateway tests pass.
- 2026-05-15 16:46 CST - Fixer Agent Round 1 - 将 `SF-STAB-003` 移到 Fixed Pending Verification：补 repair handoff refs/digests-only regression，typecheck/build/targeted gateway tests/AgentServer generation smoke/browser provider preflight smoke 通过；当前无 active in-app browser pane，等待 Orchestrator/Finder 真实 browser replay。
- 2026-05-15 17:55 CST - Orchestrator - 真实 browser 复测 `SF-STAB-003`，确认 repair handoff 已切到 96KB/refs-first 紧预算，但 AgentServer 仍在 bounded handoff 下自循环到 332847 tokens，新增 `SF-STAB-004`。
- 2026-05-15 18:20 CST - Fixer Worker Round 2 + Orchestrator - 修复并用真实 browser 验证 `SF-STAB-004`：repair continuation prompt 增加 hard-stop，stream guard 对 repair 降到 60000；最新 run `project-literature-evidence-review-mp6pkfla-qintck` 以 bounded-stop recoverable 失败返回，console error 为空。
- 2026-05-15 19:05 CST - Orchestrator + parallel fixer workers - 修复并用真实 browser 验证 `SF-STAB-005`：provider-status fast path 不再吞 provider-route minimal repair continuation，相关 direct-context 单测和 T098 smoke 通过；最新 run 进入 AgentServer repair 后仍 bounded-stop，新增 `SF-STAB-006`。
- 2026-05-15 20:15 CST - Fixer Workers Round 4 + Orchestrator - `SF-STAB-006` 修复进入 Fixed Pending Verification：repair bounded-stop 有 typed gateway fallback，prompt contract 强化为 terminal JSON；targeted tests、compact-repair smoke、typecheck 通过。真实 browser replay 当前被模型渠道 `503 Service Unavailable` 阻断，未能再次触发 bounded-stop。

### Current Handoff

当前稳定性队列中 `SF-STAB-001` 到 `SF-STAB-005` 均已 Verified，`SF-STAB-006` 已 Fixed Pending Verification。下一轮 Finder 应在模型渠道恢复后用真实 in-app browser replay provider-route minimal repair continuation，确认 bounded-stop 被呈现为终端 `repair-needed`/`failed-with-reason` ToolPayload 或最小 provider-route adapter task；如仍失败，保留最新 run id 并更新 `SF-STAB-006`，不要 reopen 已验证的 fast-path/context-window 问题。
