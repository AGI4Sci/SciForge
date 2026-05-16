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

SA evidence / blocked 模板：

- 已完成 SA-*：同一 bullet 必须追加 `Evidence：修改文件；验证命令；失败边界；拒绝的兼容方案。`
- 未完成 SA-*：默认状态为 `Evidence：pending`；认领时必须补 `Blocked：owner/dependency/next unblock command` 或明确 `Blocked：无`。
- 任何旧 CAP/PSM/MEM/H022 内容只能作为 archive evidence 引用；不能作为当前验收门，也不能要求保留旧兼容路径。
- 如果某 SA-* 任务决定关闭而不实现，必须写 `Won't implement` 原因、被哪个 SA-* 覆盖、以及为什么不会留下用户可见缺口。

#### 架构任务

- [x] SA-ARCH-01：新增最终 runtime contract 文档 [`docs/SciForge-SingleAgent-Architecture.md`](docs/SciForge-SingleAgent-Architecture.md)，并把旧 `ProjectSessionMemory.md` 内容吸收进去。
- [x] SA-ARCH-02：更新 [`docs/README.md`](docs/README.md) 和 [`docs/Architecture.md`](docs/Architecture.md)，将 `SciForge-SingleAgent-Architecture.md` 设为最终 runtime contract，`Architecture.md` 降级为当前实现背景。
- [x] SA-ARCH-03：删除旧 [`docs/ProjectSessionMemory.md`](docs/ProjectSessionMemory.md)，避免文档第二真相源。
- [x] SA-ARCH-04：把旧 `CAP-*` / `PSM-*` / `MEM-*` 未完成 TODO 全部迁移到本节；不能迁移的旧 TODO 直接关闭或删除，禁止继续作为兼容 backlog。Evidence：CAP/PSM/MEM/H022 未完成项已映射到 SA-GATEWAY、SA-CONTEXT、SA-KERNEL、SA-RUNTIME、SA-UI、SA-CONF、SA-WEB；无法迁移的旧 TODO 标记 archive/historical closed。
- [x] SA-ARCH-05：将最终文档的 C01-C18 固化为机器可跑的 conformance guard，并接入 `smoke:all` 或专门 `smoke:single-agent-runtime-contract`。Evidence：`npm run smoke:single-agent-runtime-contract`、`npm run verify:single-agent-final` 通过。
- [x] SA-ARCH-06：旧历史任务迁移完成后，把本文件中 2026-05-14/2026-05-15 历史长段移入 `docs/archive/PROJECT-history-2026-05-14-15.md` 或删除，只保留当前 SA-* 任务板和稳定化状态。Evidence：历史长段已归档到 [`docs/archive/PROJECT-history-2026-05-14-15.md`](docs/archive/PROJECT-history-2026-05-14-15.md)，`PROJECT.md` 仅保留 SA-* 当前任务板、迁移摘要和 Stability Orchestration。
- [x] SA-ARCH-07：为每个 SA-* 任务补 `evidence` 字段或完成备注模板，记录修改文件、验证命令、失败边界和不能采用的兼容方案。Evidence：新增 “SA evidence / blocked 模板”；未完成 SA-* 默认使用该模板，完成时必须在本条目内补修改文件、验证命令、失败边界和拒绝的兼容方案。

#### P0：删除旧链路和命名漂移

- [ ] SA-DEL-01：把 `src/runtime/project-session-memory.ts`、`src/runtime/gateway/conversation-handoff-projection.ts` 中仍以 ProjectSessionMemory 命名的主路径迁移为 `workspace-kernel` / `context-projection` 命名；旧名字不得作为 public runtime contract 暴露。
- [ ] SA-DEL-02：删除或迁移 `handoffMemoryProjection`、`memoryPlan`、`availableSkills` 这类旧兼容字段；如果 backend/harness 仍需读取，改成 explicit `AgentServerContextRequest.contextRefs` / `capabilityBriefRef` / `cachePlan`。
- [ ] SA-DEL-03：删除 UI 中 `legacyRawRecoverableReasonForRun`、`legacy raw recover action`、raw compact summary 等主路径 fallback；历史 session 只允许 audit-only 展示。
- [ ] SA-DEL-04：删除 Runtime/Gateway 中把 malformed backend text、raw JSON、legacy task output 伪装成成功结果的 fallback；必须归类 `contract-incompatible`、`validation` 或 `failed-with-reason`。
- [x] SA-DEL-05：清理 docs/tests 中旧 `ProjectSessionMemory.md`、`Extending.md`、`SciForgeConversationSessionRecovery.md` 权威入口引用；当前 `smoke:docs-scenario-package` 已改为检查最终文档，后续继续扩展为断链 guard。Evidence：`docs/README.md` / `docs/Architecture.md` 标记旧文档为 archive/historical；`smoke:docs-scenario-package` 校验旧 docs 不存在、旧名只出现在 archive/historical 语境且 docs markdown 链接可解析。
- [ ] SA-DEL-06：清点所有 `legacy` / `compatibility` / `fallback` 命名；凡是仍参与主流程的条目必须迁移到最终 contract 或删除，不能只改文案。
- [ ] SA-DEL-07：删除 `src/runtime/gateway/direct-context-fast-path.ts` 中的 Runtime 本地 prompt regex/关键词判断和本地回答模板；保留时只能作为 `DirectContextDecision` consumer，不允许生成 strategy。
- [x] SA-DEL-08：删除 `src/runtime/gateway/capability-provider-preflight.ts` 作为 Runtime 可调用路径；provider preflight/route 只能作为 Gateway 内部阶段，不暴露 `endpoint/baseUrl/invokeUrl/workerId/runtimeLocation` 给 Runtime Bridge 或 Backend。Evidence：删除 `capabilityProviderPreflightPayload()` 可见 ToolPayload 路径；direct-context 和 generated-task 改走 `capabilityProviderRoutesForHandoff()` / `capabilityProviderRoutesForGatewayInvocation()` public/internal route API；`smoke:single-agent-runtime-contract` C07 baseline 降为 0，`smoke:no-legacy-paths` 与 `verify:single-agent-final` 通过。
- [x] SA-DEL-09：删除 `src/runtime/generation-gateway.ts` 中直接调用 `directContextFastPathPayload()`、`capabilityProviderPreflight()`、`capabilityProviderPreflightPayload()` 的主流程分支；这些行为必须变成 PipelineStep 输入 refs 或 Gateway/AgentServer 结构化输出。Evidence：`src/runtime/generation-gateway.ts` 已移除 Runtime 主路径短路；`npm run smoke:t098-latency`、`npm run verify:single-agent-final` 通过。
- [x] SA-DEL-10：重写 `tests/smoke/smoke-t098-latency-diagnostics-matrix.ts` 中保护旧 `sciforge.direct-context-fast-path` / `sciforge.capability-provider-preflight` 可见阶段的断言；改为保护 `DirectContextDecision`、route-to-agentserver 和 Gateway `execute` 收口。Evidence：T098 不再期待 direct-context/preflight visible execution unit，改断言 AgentServer routing 与 routeDecision provider routes。
- [x] SA-DEL-11：将 `packages/agent-harness/src/profiles.ts` 中 prompt regex classifier 降级为显式 fixture/config 或结构化 policy decision 输入；harness 可以输出 decision，但不能靠关键词替 Runtime/Backend 猜语义。Evidence：`packages/agent-harness/src/profiles.ts` 已删除 prompt regex hint classifier，latency/context-audit 只消费 `conversationSignals`、`runtimeConfig`、`intentMode`、`directContextDecision` 等结构化输入；`runtime.test.ts` 覆盖 prompt-only 不触发 audit/latency 分类，targeted tests、`typecheck` 与 runtime smoke 通过。

#### P1：Workspace Kernel 与 Projection

- [ ] SA-KERNEL-01：实现明确 `StorageAdapter` interface，支持 SQLite/filesystem/in-memory adapter，但对外统一 `appendEvent` synchronous-on-write。
- [x] SA-KERNEL-02：让 `appendEvent` 成功返回时同步持久化 ledger、更新 materialized `ConversationProjection`、递增 `projectionVersion`；replay 仅用于冷启动、审计和一致性测试。Evidence：`src/runtime/conversation-kernel/workspace-kernel.ts` 新增 `WorkspaceKernel.appendEvent()`，同步 append ledger、materialize Projection、递增 `projectionVersion`，并提供 `restoreProjection()` / `replayProjection()`；`conversation-kernel.test.ts`、`smoke:conversation-kernel-final-shape` 与 `verify:single-agent-final` 通过。
- [ ] SA-KERNEL-03：将小事实内联到 `WorkspaceEvent`，大正文/长日志/snapshot/audit bundle 才注册为 `ProjectMemoryRef`；新增 guard 防止 health/degraded/failure 摘要被无脑 ref 化。
- [ ] SA-KERNEL-04：实现 `RefKindGroup` 派生 retention，禁止调用方逐个传任意 retention；archive/pin/delete/tombstone 全部 append event。
- [ ] SA-KERNEL-05：实现 `CrossSessionRef` / explicit import 记录，禁止复制裸路径跨 session 充当记忆。
- [x] SA-KERNEL-06：补 conformance：C01、C02、C15、Workspace Kernel 最小验收用例。Evidence：`smoke:single-agent-runtime-contract` 覆盖 C01/C02/C15，`conversation-kernel.test.ts` 覆盖 WorkspaceKernel append/projection/ref 最小用例，`verify:single-agent-final` 通过。
- [x] SA-KERNEL-07：合并 `src/runtime/project-session-memory.ts` 与 `src/runtime/conversation-kernel/*` 两套 ledger/projection 形态；只保留一个 `WorkspaceKernel.appendEvent(event): AppendResult` 主路径，另一套只能作为 migration adapter 或删除。Evidence：`createWorkspaceKernel()` 成为当前 Kernel 主入口；`project-session-memory.ts` 新增 `normalizeWorkspaceKernelAuditInput()` / `recoverWorkspaceKernelProjection()` / `compileWorkspaceContextProjection()` 等 Workspace 命名 adapter，并把旧 ProjectSessionMemory API 标注为 migration/audit adapter；targeted tests 与 `verify:single-agent-final` 通过。
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
- [x] SA-CONTEXT-11：`src/runtime/gateway/conversation-handoff-projection.ts` 不再输出容易被误用的 `recentConversation` / `recentRuns` raw-ish blocks；改为 bounded descriptors、source refs、digest 和 retrieval policy。Evidence：handoff projection 输出改为 `selectedMessageRefs` / `selectedRunRefs`，planner 兼容旧 key 时递归过滤 forbidden raw/legacy 字段；`conversation-handoff-projection.test.ts`、`conversation-handoff-planner.test.ts`、`typecheck` 与 `verify:single-agent-final` 通过。
- [x] SA-CONTEXT-12：`src/runtime/gateway/agentserver-context-window.ts` 的 AgentServer core snapshot 去掉 clipped `turn.content`，统一为 `contentRef/contentDigest/contentChars/contentOmitted`。Evidence：`compactAgentServerCoreSnapshot()` recent turns 不再输出 clipped `content`，只保留 ref/digest/chars/omitted；raw content 只用于本地 digest/chars 计算；`agentserver-context-window.test.ts`、`context-envelope.test.ts`、`smoke:single-agent-runtime-contract`、`smoke:no-legacy-paths` 与 `typecheck` 通过。

#### P3：Capability Gateway、Provider/Worker 与 ArtifactDelivery

- [ ] SA-GATEWAY-01：Runtime Bridge 只能调用 `Gateway.execute`；`resolveRoute` / `preflight` / `invoke` / `materialize` / `validate` 改为内部 API，并加 lint/contract test 防外部调用。
- [ ] SA-GATEWAY-02：`Gateway.validate` 只做结构校验；科学/语义判断必须来自 Backend 或 verifier capability 的 `verification-record`。
- [x] SA-GATEWAY-03：实现 `ArtifactDelivery` contract：`primary-deliverable` / `supporting-evidence` 才进入 Projection 可见结果，`audit` / `diagnostic` / `internal` 只能进 debug/audit。Evidence：`artifactHasUserFacingDelivery` 已下沉到 runtime contract，覆盖 readable target、audit/diagnostic/internal、audit-only/unsupported、json-envelope；C17 smoke 使用同一规则。
- [ ] SA-GATEWAY-04：Worker discovery 统一归一成 `ProviderManifest`，不得把单个 endpoint shape 泄漏给 Backend 或 Runtime Bridge。
- [ ] SA-GATEWAY-05：scenario package contract 改为 policy-only guard：禁止 execution code、prompt regex、provider branch、多轮 semantic judge、preset answer/system prompt。
- [x] SA-GATEWAY-06：补 conformance：C07、C08、C17、C18、Capability Gateway 最小验收用例。Evidence：`smoke:single-agent-runtime-contract` 覆盖 C07/C08/C17/C18，`capability-provider-preflight.test.ts` 和 Web E2E SA-WEB-05 覆盖 public route redaction / idempotent gateway / worker discovery；`verify:single-agent-final` 通过。
- [x] SA-GATEWAY-07：provider status / capability status 查询只能读取 Capability Registry / ProviderManifest / AgentServer worker registry projection，不能触发 Gateway preflight 作为用户回答路径。Evidence：direct-context provider status 改为读取 `capabilityProviderRoutesForHandoff()` public route shape，删除 visible preflight ToolPayload，payload/test 明确禁止 `workerId`、endpoint、baseUrl、invokeUrl、runtimeLocation 泄漏；`direct-context-fast-path.test.ts`、`smoke:no-legacy-paths` 与 `verify:single-agent-final` 通过。
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
- [x] SA-CONF-10：新增最终完成 gate 命令 `npm run verify:single-agent-final`，串联 typecheck、核心单测、C01-C18、browser web-multiturn-final；任何一步失败都不能标记最终版本完成。Evidence：`package.json` 的 `verify:single-agent-final` 串联 `typecheck`、928 个核心测试、`smoke:single-agent-runtime-contract` C01-C18、`smoke:no-legacy-paths`、`smoke:single-agent-final-gate`、`smoke:web-multiturn-final` 和 `smoke:single-agent-final-evidence`；`npm run verify:single-agent-final` 通过。
- [x] SA-CONF-11：为 `package.json` 中 `smoke:browser`、`smoke:browser-multiturn`、`smoke:browser-provider-preflight` 建迁移 guard；它们可以成为 `smoke:web-multiturn-final` 的子场景，但不能继续作为保护旧 preflight/direct-context 的独立完成门。Evidence：旧 browser smoke scripts 现在委托 `smoke:web-multiturn-final -- --tag ...`，guard 断言 legacy browser smoke 不再作为独立完成门。
- [x] SA-CONF-12：新增 final evidence validator，校验 `docs/test-artifacts/single-agent-final/manifest.json` 是否引用 C01-C18 结果、Web E2E case manifests、console/network logs、screenshots 和 no-legacy guard 输出。Evidence：`tests/smoke/smoke-single-agent-final-evidence.ts` 校验 final manifest 的 C01-C18、no-legacy guard、16 个 Web E2E case manifest、console/network/screenshot evidence arrays 和 failure/improvement notes；`smoke:web-multiturn-final` 生成 manifest，`smoke:single-agent-final-evidence` 与 `typecheck` 通过。

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

- [x] SA-WEB-01：新增 `smoke:web-multiturn-final` 总入口，负责启动 dev services、准备 isolated workspace、启动 mock/real AgentServer、跑完整 Web 多轮矩阵并导出 evidence bundle。Evidence：`tests/smoke/smoke-web-multiturn-final.ts` 建立最终 Web E2E 总入口、isolated run root、scriptable/real-provider mode、per-case evidence bundle 和 `docs/test-artifacts/single-agent-final/manifest.json`，当前全矩阵跑 `SA-WEB-02` 到 `SA-WEB-16` 共 16 个 final case；`npm run smoke:web-multiturn-final` 与 `npm run verify:single-agent-final` 通过。
- [x] SA-WEB-02：Fresh → Continue 记忆稳定用例：第一轮提出研究目标，第二轮要求“记住一开始的问题并继续”，第三轮要求换格式；断言 old artifact 不覆盖 current turn，stableGoalRef 只来自显式/Backend proposal。Evidence：`tests/smoke/web-e2e/cases/fresh-continue-memory.ts` 覆盖 Fresh → Continue → format-change 三轮，断言 stableGoalRef 只来自 Backend proposal/explicit，旧 artifact 只在 bounded index/audit，negative tests 覆盖 stale artifact/currentTask 泄漏；case tests、`smoke:web-multiturn-final -- --case SA-WEB-02` 与 `verify:single-agent-final` 通过。
- [x] SA-WEB-03：Explicit artifact selection 用例：同 session 存在旧报告和新报告，用户点击旧 artifact 后追问“基于这个继续”；断言 `explicitRefs/currentTask.explicitRefs` 指向旧对象，结果不混入最新 artifact。Evidence：`tests/smoke/web-e2e/cases/explicit-artifact-selection.ts` 断言 top-level/currentTask explicit refs 均锁定旧 artifact，mock payload 不混入最新 artifact；case tests、web-e2e tests 与 `typecheck` 通过。
- [x] SA-WEB-04：Failed run repair 用例：制造 provider unavailable 或 schema validation failure，用户要求“解释失败，不重跑无关步骤，再继续修复”；断言 RepairPolicy 熔断、failureSignature、recoverActions、RunAudit refs。Evidence：`tests/smoke/web-e2e/cases/failed-run-repair.ts` 覆盖 provider-unavailable/schema-validation 两种失败，断言 repair policy fail-closed、failureSignature、recoverActions、RunAudit refs 与 Projection/ArtifactDelivery contract；case tests、web-e2e tests 与 `typecheck` 通过。
- [x] SA-WEB-05：Provider unavailable → available 用例：第一轮缺 `web_search/web_fetch` 时 fail closed，第二轮 mock provider ready 后同任务进入 AgentServer dispatch；断言 provider status 不走 Runtime preflight 可见阶段，不泄漏 endpoint shape。Evidence：`tests/smoke/web-e2e/cases/provider-unavailable-available.ts` 断言 unavailable 不 dispatch，ready 后 dispatch AgentServer public routes，并禁止 endpoint/baseUrl/invokeUrl/workerId/runtimeLocation/auth 泄漏；case tests、web-e2e tests 与 `typecheck` 通过。
- [x] SA-WEB-06：Empty result 用例：mock search 返回空结果；UI 必须显示 recoverable/needs-human/empty-result，而不是 completed 报告；follow-up 扩大 query 后复用前一轮 failure evidence。Evidence：`tests/smoke/web-e2e/cases/empty-result-recovery.ts` 首轮 empty-result 落 needs-human/recoverable，negative test 防 completed/satisfied 污染，follow-up 扩大 query 并复用 failure evidence；case tests、web-e2e tests 与 `typecheck` 通过。
- [x] SA-WEB-07：Long/background run 用例：长任务运行中刷新页面、打开第二标签、提交 clarification；断言 foreground/background 并发策略、checkpoint、cursor resume、Projection terminal state。Evidence：`tests/smoke/web-e2e/cases/long-background-run.ts` 组合 refresh/reopen、multi-tab 和 contract verifier，覆盖 checkpoint refs、cursor resume、clarification 和 terminal Projection；case tests、web-e2e tests 与 `typecheck` 通过。
- [x] SA-WEB-08：Degraded AgentServer 用例：AgentServer context API 不可用；Runtime 只能生成 refs-first `DegradedHandoffPacket`，UI 显示 degraded reason，不把 raw history 塞进 backend。Evidence：`tests/smoke/web-e2e/cases/degraded-agentserver.ts` 模拟 context API 不可用，构造 refs-first degraded packet，断言 UI degraded reason 且 backend request 不含 rawHistory/recentTurns/fullRefList/compactionState；case tests、web-e2e tests 与 `typecheck` 通过。
- [x] SA-WEB-09：ArtifactDelivery 可见性用例：同一 run 返回 primary、supporting、diagnostic、audit、internal artifacts；右侧主结果只展示 primary/supporting，diagnostic/audit/internal 只在 debug/audit。Evidence：`tests/smoke/web-e2e/cases/artifact-delivery-visibility.ts` 复用 fixture + contract verifier，断言 browser main result 只展示 primary/supporting，audit/diagnostic/internal 泄漏时 fail closed；focused case test 与 `typecheck` 通过。
- [x] SA-WEB-10：Audit export 用例：完成或失败后导出 JSON bundle；断言包含 ledger events、Projection、RunAudit、context snapshot、refs manifest、tombstone/degraded/failure evidence，不包含 secret/raw provider token。Evidence：`tests/smoke/web-e2e/cases/audit-export.ts` 导出并校验 ledger、Projection、RunAudit、context snapshot、refs manifest、tombstone/degraded/failure evidence，经 `secret-scrubber` 清除 provider token/raw auth/内部 route；focused case tests 与 `typecheck` 通过。
- [x] SA-WEB-11：Reload/reopen session 用例：关闭并重开页面恢复旧 session；断言可见答案、active/terminal run、artifact refs、recover actions 全部来自 persisted Projection。Evidence：`tests/smoke/web-e2e/cases/reload-reopen-session.ts` 构造 reload/reopen restore 证据，断言 visible answer、run state、artifact refs 和 recover actions 均来自 persisted Projection，raw fallback/drift negative tests 通过；focused case tests 与 `typecheck` 通过。
- [x] SA-WEB-12：Multi-tab conflict 用例：两个标签对同一 session 同时提交；默认只允许一个 foreground active run，另一条按 `wait/attach/cancel/fork` 策略处理，不能隐式并发写同一 session。Evidence：`tests/smoke/web-e2e/cases/multi-tab-conflict.ts` 覆盖 wait/attach/cancel/fork 策略，断言 active/background run 与 UIAction concurrency-decision 对齐，并拒绝隐式并发 foreground 写入；focused case tests 与 `typecheck` 通过。
- [x] SA-WEB-13：Direct context gate 用例：只问当前 run 状态时可以从结构化 `DirectContextDecision` 回答；一旦问题要求生成/repair/tool/status 判断不充分，必须 route-to-agentserver。Evidence：`tests/smoke/web-e2e/cases/direct-context-gate.ts` 覆盖 sufficient run-status direct-context fast path，generation/repair/tool-status-insufficient 均 route-to-agentserver 且记录 insufficient decision；focused case tests 与 `typecheck` 通过。
- [x] SA-WEB-14：No legacy UI fallback 用例：构造只有 raw run/legacy resultPresentation、没有 Projection 的历史 session；主结果区只能显示等待/需迁移，raw 内容只在 audit/debug，不得展示为 terminal result。Evidence：`tests/smoke/web-e2e/cases/no-legacy-ui-fallback.ts` 构造 projectionless legacy session，主结果只显示 needs-human/migration wait，raw resultPresentation 留在 audit/debug，raw 泄漏与误塞 Projection negative tests 通过；focused case tests 与 `typecheck` 通过。
- [x] SA-WEB-15：真实文献多轮 happy path：使用 mock 非空 web provider 或真实 provider，完成检索、下载/读取、中文报告、引用修正、审计导出；验证 provider route trace、artifact lineage、evidence refs。Evidence：`tests/smoke/web-e2e/cases/literature-happy-path.ts` 使用非空 mock web_search/web_fetch provider 完成检索、下载/读取、中文报告、引用修正与审计导出，断言 provider route trace、ArtifactDelivery lineage 和 evidence refs；case tests、`smoke:web-multiturn-final -- --case SA-WEB-15` 与 `verify:single-agent-final` 通过。
- [x] SA-WEB-16：真实数据分析多轮 happy path：上传/引用 CSV，摘要统计、改分组、解释异常值、导出 markdown + code refs；验证大文件按 ref/read_ref 读取，不进 raw prompt。Evidence：`tests/smoke/web-e2e/cases/data-analysis-happy-path.ts` 覆盖 CSV ref 上传/引用、summary、regroup、outlier explanation、markdown + code refs 导出，negative tests 拒绝 raw prompt 注入大 CSV 和跳过 read_ref；case tests、`smoke:web-multiturn-final -- --case SA-WEB-16` 与 `verify:single-agent-final` 通过。
- [x] SA-WEB-17：Web E2E evidence bundle 规范：每个 SA-WEB 用例自动生成 `docs/test-artifacts/web-e2e/<case>/manifest.json`，包含 run ids、event ids、projectionVersion、screenshots、console logs、network summaries 和 failure/improvement note。Evidence：`tests/smoke/web-e2e/evidence-bundle.ts` 生成 `sciforge.web-e2e.evidence-bundle.v1` manifest 并写入 per-case `manifest.json`，包含 run/event/projection、screenshots、console/network 摘要和 failure/improvement note；focused web-e2e helper tests 与 `typecheck` 通过。
- [x] SA-WEB-18：将旧 `smoke:browser`、`smoke:browser-multiturn`、`smoke:browser-provider-preflight` 中仍有价值的步骤迁入 `smoke:web-multiturn-final`；旧 smoke 只保留为子命令或删除，不能继续保护旧链路。Evidence：`tests/smoke/web-e2e/case-registry.ts` 将旧 browser workflow、multi-turn context、provider preflight 的有效步骤映射到 final case registry；`package.json` 旧 smoke scripts 仍作为 `smoke:web-multiturn-final -- --tag ...` 子命令，`smoke:web-multiturn-final` 全矩阵和 `verify:single-agent-final` 通过。
- [x] SA-WEB-19：实现 scriptable AgentServer mock，支持按 case 脚本发出 `BackendHandoffPacket`、stream delta、tool-call、tool-result、failure、degraded 和 background checkpoint；每个事件都带 deterministic id/digest。Evidence：`tests/smoke/web-e2e/scriptable-agentserver-mock.ts` 支持 health/discovery/context/compact/run-stream 脚本事件，事件 id/digest 确定；`scriptable-agentserver-mock.test.ts`、`typecheck` 与 `verify:single-agent-final` 通过。
- [x] SA-WEB-20：实现 fixture workspace builder，按 case 生成 isolated workspace、session id、初始 refs、旧 artifacts、新 artifacts、CSV/PDF/text fixture、provider manifest 和 expected Projection。Evidence：`tests/smoke/web-e2e/fixture-workspace-builder.ts` 生成隔离 workspace、`.sciforge` state/config、旧/新 report、CSV/PDF/text/audit/log/provider manifest 和 expected Projection；`fixture-workspace-builder.test.ts`、`typecheck` 与 `verify:single-agent-final` 通过。
- [x] SA-WEB-21：实现 browser instrumentation：捕获 console error/warn、network failures、uncaught exceptions、page screenshots、DOM snapshots、debug panel export 和 downloaded audit bundle。Evidence：`tests/smoke/web-e2e/browser-instrumentation.ts` 提供 console/pageerror/request/http/download 捕获、截图、DOM snapshot、debug export snapshot/dispose；`typecheck` 与 `verify:single-agent-final` 通过。
- [x] SA-WEB-22：实现 after-each contract verifier：对比 browser visible state、Kernel Projection、session bundle、RunAudit、ArtifactDelivery manifest 和 expected case contract；任何一处不一致都失败。Evidence：`tests/smoke/web-e2e/contract-verifier.ts` 提供 `assertWebE2eContract()` / afterEach verifier，覆盖 browser visible state、Kernel Projection、session bundle、RunAudit、ArtifactDelivery manifest 和 loader；focused web-e2e helper tests 与 `typecheck` 通过。
- [x] SA-WEB-23：实现 refresh/reopen helper：每个核心 case 在第 2 轮后刷新页面，在 terminal 后重开 session，验证 Projection-only restore。Evidence：`tests/smoke/web-e2e/refresh-reopen-helper.ts` 在 round 2 后 refresh、terminal 后 reopen session，并断言 visible restore 只来自 Projection、refs/audit/delivery 对齐；focused web-e2e helper tests 与 `typecheck` 通过。
- [x] SA-WEB-24：实现 multi-tab helper：同一 session 打开两个 page，上报并发 decision，断言 `activeRun/backgroundRuns` 和 UIAction concurrency-decision 一致。Evidence：`tests/smoke/web-e2e/multi-tab-helper.ts` 打开同 session 双 page，记录 `UIAction(type=concurrency-decision)`，校验 active/background run ids 与 Projection 一致；focused web-e2e helper tests 与 `typecheck` 通过。
- [x] SA-WEB-25：实现 secret scrubber：evidence bundle 中禁止出现 provider token、absolute secret path、raw auth header；只允许 digest、routeDigest、provider id 和 audit-safe summary。Evidence：`tests/smoke/web-e2e/secret-scrubber.ts` 递归清理 token/auth header/secret path/内部 route 字段，保留 providerId、routeDigest、digest、summary；focused web-e2e helper tests 与 `typecheck` 通过。
- [x] SA-WEB-26：实现 Web E2E flake policy：同一 case 失败必须输出最小复现 command、case manifest、last screenshot 和 first failed contract；禁止简单重试掩盖 nondeterministic context drift。Evidence：`tests/smoke/web-e2e/flake-policy.ts` 生成最小复现、case manifest、last screenshot、first failed contract，并对 context/projection digest drift fail closed；focused web-e2e helper tests 与 `typecheck` 通过。
- [x] SA-WEB-27：将 `R-LIT-*`、`R-DATA-*`、`R-RUN-*`、`R-UI-*` 中已沉淀的真实多轮任务映射到 SA-WEB case tags，保留真实场景覆盖，但验收标准统一回最终 contract。Evidence：`tests/smoke/web-e2e/case-tags.ts` 将 36 个 R-LIT/R-DATA/R-RUN/R-UI 真实多轮任务映射到最终 SA-WEB case tags、complex multiturn source fixture ids 和 contract assertions；`case-tags.test.ts` 校验覆盖数、tag/source fixture 合法性和关键 lineage，`typecheck` 通过。

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

旧链路候选处理规则：本节以下只允许保留 archive/historical 摘要和 Stability Orchestration。旧 2026-05-14/15 任务的未完成 TODO 必须迁移到 SA-* 或关闭；不允许为了完成旧 TODO 新增兼容层。

### Archive / Historical

状态：archive/historical

2026-05-14/15 的旧 CAP/PKG/GT/PSM/MEM/H022 长段已移入 [`docs/archive/PROJECT-history-2026-05-14-15.md`](docs/archive/PROJECT-history-2026-05-14-15.md)。这些内容只保留为 evidence/source lineage，不再是实现 backlog；后续实现只能从当前 SA-* 任务板认领。

旧任务迁移 / 关闭结果：

| 历史来源 | 当前归属 | 处理结果 |
|---|---|---|
| CAP direct-context / provider / worker registry | SA-GATEWAY-04/06/07/08、SA-RUNTIME-06/09/10、SA-WEB-05/13/15/18/19 | 已迁移；旧 CAP-P* 不再单独验收。 |
| PSM retrieval/read_ref/workspace_search | SA-CONTEXT-02/03/04/09/10/11、SA-KERNEL-01/02/07/08/09 | 已迁移；旧 `ProjectSessionMemory` 名称只可作为 migration/audit 背景。 |
| PSM compaction-recorded / retention | SA-KERNEL-02/04、SA-CONTEXT-10、SA-CONF-12 | 已迁移；新的验收必须写入 append-only Kernel/Projection evidence。 |
| MEM stable AgentServer session/current work | SA-CONTEXT-01/02/03、SA-WEB-02/08/11 | 已吸收；旧 `memoryPlan` / local long-term memory 表述关闭。 |
| H022 R-* 真实多轮任务 | SA-WEB-02 到 SA-WEB-27、SA-CONF-04/12 | 已转成最终 Web E2E case/tag/evidence bundle 要求；旧 R-* 不再作为勾选 backlog。 |
| H022 TODO-GEN-* 通用修复池 | SA-RUNTIME-05、SA-GATEWAY-02、SA-UI-02/03/04/05、SA-CONF-12、SA-WEB-17/26 | 已迁移为 failure normalization、Projection-only UI、ArtifactDelivery、evidence validator 和 flake policy。 |

旧任务处理规则：本节以下只保留 Stability Orchestration。旧 CAP/PSM/MEM/H022 未迁入 SA-* 的 TODO 视为 archive/historical closed；不允许为了完成旧 TODO 新增兼容层。

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
