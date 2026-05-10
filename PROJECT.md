# SciForge - PROJECT.md

最后更新：2026-05-10

## 关键原则
- 所有修改必须通用、可泛化到任何场景，不能在代码里面硬编码和为当前案例打补丁
- Agent harness 是项目级策略资产，不允许散落在 UI、gateway、prompt builder、conversation policy 或 repair 分支里；探索预算、上下文选择、skill hints、tool-use policy、验证强度和用户可见进度必须通过可版本化 harness policy 与阶段 hook 注入。
- 算法相关的代码优先用Python实现，方便人类用户优化、检查算法
- 代码路径保持唯一真相源：发现冗余链路时删除、合并或降级旧链路，避免长期并行实现。
- 代码膨胀必须自动触发治理：源码文件超过 1000 行进入 watch list；超过 1500 行必须在 PROJECT.md 有模块化拆分任务、语义 part 计划或生成文件豁免；超过 2000 行优先拆分；超过 3000 行视为维护风险。后续开发若让文件越过阈值，应优先抽模块、删除冗余逻辑或补拆分 TODO，而不是继续堆主文件。
- 长文件拆分必须按职责命名，不能机械切成 `part1/part2`；如果暂时不能完全解耦，也要拆成有语义的文件，例如 `*-event-normalizer`、`*-runner`、`*-diagnostics`、`*-state-machine`，并保持主入口只做流程编排。
- `npm run smoke:long-file-budget` 是代码膨胀守门 smoke：超过阈值且未被 PROJECT.md 跟踪的长文件应让验证失败，从而自动触发模块化、去重或任务补录。


## 根本方向

SciForge 的最终形态是 **Backend-first, Contract-enforced, Capability-driven, Harness-governed**。完整设计以 [`docs/Architecture.md`](docs/Architecture.md#最终形态backend-first-capability-architecture) 和 [`docs/Architecture.md#终极形态harness-governed-scientific-agent-os`](docs/Architecture.md#终极形态harness-governed-scientific-agent-os) 为准；本文件只保留围绕最终形态重构的任务板。

核心定位：

- SciForge 是 downstream scenario adapter，不是第二套 agent。
- Agent backend 负责用户意图理解、多轮指代、能力选择、任务规划、胶水代码生成、artifact 内容读取、失败诊断、继续执行和修复。
- SciForge 负责协议、capability registry、capability broker、workspace refs、执行边界、contract validation、artifact 持久化、view 渲染和机器可读错误回传。
- `src/` 是固定平台逻辑和运行时骨架；`packages/` 是即插即用能力生态。回答“系统怎么运行”的逻辑进 `src/`，回答“系统能做什么”的逻辑进 `packages/`。详见 [`docs/Architecture.md`](docs/Architecture.md#src-与-packages-边界固定平台-vs-插拔能力)。
- Packages 不只是代码复用单元，而是 capability contract 单元；observe、skills、actions、verifiers、views、memory、import/export 都应暴露可声明、可校验、可组合、可替换、可修复的 capability。
- Agent harness 是独立行为治理层；runtime 只提供稳定阶段 hook 和 enforcement，harness profile 负责决定 fresh/continuation/repair/audit 等模式下的探索范围、上下文预算、工具预算、skill 倾向、验证强度和用户可见进度。详见 [`docs/Architecture.md`](docs/Architecture.md#终极形态harness-governed-scientific-agent-os)。
- 胶水代码、执行 trace、validation failure、repair attempts 和 composed capability 下钻记录本身是资产；必须沉淀到 Capability Evolution Ledger，用于晋升高频组合、改进 validator、完善 repair hints 和训练 broker。
- 重构时必须删除历史遗留链路，只保留最新唯一逻辑和唯一真相源；不得为了兼容旧实现长期保留并行路径、prompt regex、场景特例、provider 特例或 UI 语义兜底。

## 重构守则

- 每个重构任务都必须先声明新的唯一真相源，再删除旧入口、旧 adapter、旧 fallback 和旧测试夹具。
- 临时兼容层必须有删除任务、删除条件和 smoke guard；没有删除计划的兼容层不允许合入。
- Backend-first 优先级高于 UI 侧聪明化：SciForge 不判断“用户是不是想看报告/上一轮/markdown”，只传 refs、capability brief 和 contract。
- Harness-governed 优先级高于 prompt 局部补丁：不得在某个 request path、scenario、provider 或 UI 分支里临时追加探索指令、工具约束、上下文规则或技能偏好；必须进入 harness hook/profile 或 capability manifest。
- `src/` 可以写死平台秩序，但不能写死 package 领域语义；`packages/` 可以扩展能力，但不能绕过 `src/` 的安全、refs、validation 和 persistence 边界。
- 所有 capability 输出都必须可代码校验；校验失败生成 `ContractValidationFailure` 返回 backend 修复，不在 SciForge 侧改写成成功。
- 高频稳定路径可以固化为 composed capability，但仍必须暴露 manifest、validator、repair hints 和 fallback，下钻后可由 backend 重新组合原子能力。
- 历史任务不再单独维护；如果仍有价值，必须并入下面的最终形态重构任务。

## 倒叙任务板

### T132 Longfile Sweep：手写长文件退出 watch list

状态：完成；目标是把当前 `smoke:long-file-budget` watch list 中的手写平台/测试入口全部压回 1000 行以下，只保留明确生成文件豁免，避免后续继续在大文件中堆职责。

2026-05-10：完成 Longfile-H 并行拆分 sweep。`events.ts` 抽出 interaction/progress/health event family 到 `events-interaction-progress.ts` 后降到 971 行；`SciForgeApp.tsx` 抽出 `sciforgeApp/*` workbench/feedback/state helpers 后降到 574 行；`ShellPanels.tsx` 抽出 Settings dialog/model 后降到 749 行；`packages/support/object-references/index.ts` 抽出 helpers、inline refs、response normalization 与 upload preview 后降到 684 行；`smoke-vision-sense-runtime-bridge.ts`、`smoke-runtime-gateway-modules.ts`、`smoke-browser-workflows.ts` 和 `tools/longform-regression.ts` 分别抽出专属 fixtures/helpers 后降到 835/920/993/951 行。`npm run smoke:long-file-budget` 现在只报告 generated `packages/skills/catalog.ts`，手写文件全部退出 >=1000 watch list。

验收标准：

- [x] 所有手写 watch-list 文件低于 1000 行。
- [x] 抽出的 helper 均按语义命名，不使用机械 `part1/part2`。
- [x] public re-export / UI 行为 / smoke 语义保持兼容。
- [x] `npm run smoke:long-file-budget` 通过，且只剩 generated-file exemption。

### T131 ResultsRenderer 长文件治理：拆分结果渲染主入口

状态：进行中；`src/ui/src/app/ResultsRenderer.tsx` 已从超过 1500 行降到 853 行，退出 1000 行 watch list。目标是把结果渲染主入口收敛为流程编排，把 artifact normalization、view-plan selection、execution notebook projection、fallback/empty-state presentation、object reference actions 等职责拆到语义模块，避免继续在单一 React 文件里堆叠。已拆出 execution audit 数据模型、artifact inspector/reference normalization、view-model 投影、object reference action 计划/执行 helper、artifact inspector drawer presentation 和 registry slot / unknown component fallback presentation，保持 React 文件只消费投影结果。

Todo：

- [x] 拆出 `results-renderer-artifact-normalizer`：只处理 loose backend artifact / ToolPayload 到稳定渲染输入的归一化。
- [x] 拆出 `results-renderer-view-model`：只负责 view plan、primary/supporting/provenance section 和 empty-state 投影。
- [x] 拆出 `results-renderer-execution-model`：只负责 execution units、notebook panels、work evidence 和 audit display 的 UI 数据模型。
- [x] 拆出 `results-renderer-object-actions`：只负责 object reference action plan、pin 队列、path/copy/open/inspect 决策和可注入执行。
- [x] 拆出 `results-renderer-artifact-inspector`：只负责 artifact inspector drawer presentation、lineage、preview refs 和 handoff target 展示。
- [x] 拆出 `results-renderer-registry-slot`：只负责 registry slot、unknown component fallback、artifact diagnostics 和 handoff preview presentation。
- [x] 保持 `ResultsRenderer.tsx` 只做 React composition 和事件接线，目标降到 1000 行以下。
- [x] 增加或迁移聚焦测试，覆盖 artifact fallback、report/preview rendering、execution notebook 和 object reference actions。（已新增 view-model、execution audit、object actions、artifact inspector、registry slot fallback、unknown component artifact fallback、report artifact empty-state fallback 与 manifest/component mismatch fallback 聚焦测试。）

验收标准：

- [x] `npm run smoke:long-file-budget` 通过，且 `ResultsRenderer.tsx` 不再超过 1500 行。
- [x] `ResultsRenderer.tsx` 低于 1000 行，退出 long-file watch list。
- [x] 结果渲染行为不回退到 UI 语义路由；view/preview 决策仍消费 package-owned policy 和 runtime contract。（artifact fallback/report mismatch 聚焦测试覆盖 package empty-state 与 artifact-owned renderer 改派。）

### T130 Agent Harness Runtime MVP：把标准变成可运行策略层

状态：进行中；目标是按 [`docs/AgentHarnessStandard.md`](docs/AgentHarnessStandard.md) 建立最小可运行 harness runtime。第一阶段只生成 `HarnessContract` 和 `HarnessTrace`，不改变业务行为；第二阶段逐步让 context、broker、prompt、validation、repair 和 UI 消费 contract。

进展：shadow-mode MVP 已完成。`packages/agent-harness` 提供 contract/profile/callback/trace 基础运行时，gateway 在 conversation policy 之后、既有 dispatch/fast-path 之前评估 `HarnessRuntime.evaluate()`，并把 `HarnessContract` / `HarnessTrace` 写入 request/uiState/metadata 与 stream trace。默认路径仍保持 shadow/兼容行为；context envelope、verification policy、progress plan、continuity decision 和 backend selection 已有 opt-in 消费或结构化 audit 首片，broker、repair loop 和全面默认启用仍待继续推进。

2026-05-10：新增 opt-in context envelope governance 小切片。默认仍关闭；打开 `agentHarnessContextEnvelopeEnabled` 后，`buildContextEnvelope` 可从 `uiState.agentHarness.contract` / `agentHarnessHandoff` 消费 allowed/blocked/required refs 与 `contextBudget.maxReferenceDigests`，对 current references/digests 做 deterministic filtering/slimming，并输出 `contextGovernanceAudit` 记录 contract/trace/source/decision。

2026-05-10：将 harness context governance 从 `context-envelope.ts` 抽到 `context-envelope-governance.ts`，保留同一 feature flag 与行为，`context-envelope.ts` 降到 873 行并退出 1000 行 watch list。

2026-05-10：新增 opt-in verification policy consumption 小切片。默认 shadow 行为不变；打开 `agentHarnessVerificationPolicyEnabled` / `agentHarnessConsumeVerificationPolicy` 后，`requestWithAgentHarnessShadow` 会把 harness contract 的 `verificationPolicy.intensity` 投影成 runtime `VerificationPolicy`，只收紧 mode/risk/required，不放宽 caller 已有策略，并写入 `uiState.agentHarnessVerificationPolicy` audit。

2026-05-10：新增 opt-in progress plan consumption 小切片。默认仍不发新进度事件；打开 `agentHarnessProgressPlanEnabled` / `agentHarnessConsumeProgressPlan` 后，`requestWithAgentHarnessShadow` 会把 harness contract 的 `progressPlan` 投影成真实 `process-progress` workspace runtime event，并写入 `uiState.agentHarnessProgressPlan` audit，UI 可通过现有 `progressModelFromEvent` 消费。

2026-05-10：新增结构化 continuity decision 小切片。`agentHarnessContinuityDecision()` 现在统一输出 fresh/continuation/repair 的 `useContinuity`、reason、trace/audit metadata；`requestNeedsAgentServerContinuity()` 委托该 decision 保持布尔行为不变，并在 opt-in `agentHarnessContinuityAuditEnabled` / `agentHarnessTraceContinuityDecision` 下把 decision 写入 handoff/metadata。

2026-05-10：新增 opt-in backend selection decision 小切片。`agentServerBackendSelectionDecision()` 现在统一记录 request/env/llmEndpoint/default 的 backend 选择、source、runtime signals 与 trace；`agentServerBackend()` 保持原字符串行为并委托该 decision，打开 `agentHarnessBackendSelectionAuditEnabled` / `agentHarnessTraceBackendSelectionDecision` 后会把 decision 写入 AgentServer payload metadata 与 `agentHarnessHandoff`。

2026-05-10：Longfile-D/T130 将 `agent-harness-shadow.ts` 的 continuity decision、backend selection audit 与 progress plan projection 抽到语义 helper，主入口降到 809 行并退出 1000 行 watch list；默认行为和原 `agentHarnessContinuityDecision` 导出保持不变。

2026-05-10：新增 opt-in capability broker harness input 小切片。默认关闭；打开 `agentHarnessCapabilityBrokerEnabled` / `agentHarnessCapabilityBrokerInputEnabled` 后，broker brief 会消费 harness contract/candidates 的 skill hints、preferred capability ids、blocked capabilities 与 tool budget，并输出 `harnessInputAudit`。blocked tokens 现在可匹配 manifest side effects，确保 `workspace-write` / `network` 等能力不会绕过 gate。

2026-05-10：T130 broker harness input 第二小切片完成。opt-in projection 继续消费 harness provider availability 与 verification policy，并把 provider count、verification policy keys/mode 写入 audit；`context-envelope` 只做 broker input 接线，默认关闭路径和 lazy schema/examples 行为保持不变。

2026-05-10：T130/T127 repair loop opt-in bridge 首片完成。`createValidationRepairAuditChain()` 在 opt-in `agentHarnessRepairPolicy` 下可从 `uiState.agentHarness.contract` 消费 repair/verification 摘要，只收紧 repair budget / fail-closed 决策，不放宽既有策略，并把 contract/trace/profile/verification 摘要写入 audit refs/sink refs；payload validation 与 runtime verification gate 真实路径已接入。

Todo：

- [x] 建立 `packages/agent-harness`：导出 `HarnessRuntime`、`HarnessProfile`、`HarnessCallback`、`HarnessContext`、`HarnessDecision`、`HarnessContract`、`HarnessTrace`、`HarnessStage`。
- [x] 实现 profile registry：`balanced-default`、`fast-answer`、`research-grade`、`debug-repair`、`low-cost`、`privacy-strict`、`high-recall-literature`。
- [x] 实现 deterministic merge engine：blocked refs/capabilities union、budget only tightens、risk/verification only escalates、side effects fail closed、conflicts written to trace。
- [x] 在 `runWorkspaceRuntimeGateway` 中接入 `HarnessRuntime.evaluate()`，位置在 conversation policy 之后、direct fast-path / vision / AgentServer dispatch 之前。
- [x] 第一阶段只把 `HarnessContract` 写入 request/uiState/metadata 和 stream trace，不改变已有 runtime 行为。
- [ ] 第二阶段打开 feature flag，让 context envelope、broker、prompt renderer、verification policy、repair loop、UI progress 逐项消费 contract。（context envelope、broker、verification policy、progress plan、continuity/backend selection 与 prompt renderer metadata 已有 opt-in/首片；repair loop 和默认启用仍待推进。）
- [x] 增加 `smoke:agent-harness-contract`：同一输入输出稳定 contract、trace 有阶段记录、profile 切换只改 contract 不 fork gateway path。
- [x] 增加 `smoke:no-scattered-harness-policy`：禁止在 gateway、prompt builder、UI、scenario、provider 分支新增 harness 指令散文、探索规则、skill 偏好或工具预算。

验收标准：

- [ ] Agent 行为治理只有一个入口：`packages/agent-harness` profile registry。
- [x] Harness runtime 可以 shadow mode 运行并产出完整 trace。
- [x] 关闭 harness feature flag 时现有 backend-first/capability-driven 行为保持不变。
- [x] 打开 harness feature flag 后，至少 context budget、progress plan 和 validation policy 三项由 contract 驱动。（context budget、progress plan、verification policy/validation bridge 已有 opt-in 首片；主流程全面启用仍待后续推进。）

### T129 Unified Capability Graph：skills/tools/actions/observe/verifiers 进入同一能力图

状态：进行中；目标是让所有可用能力都通过统一 `CapabilityManifest`、`HarnessCandidate`、`CapabilityBudget` 被 broker 和 harness 治理，避免 package skills、tool catalog、observe/action loop 与 AgentServer generation fallback 平行存在。

进展：第一阶段统一候选图已落地为 shadow/helper 层。`projectCapabilityManifestsToHarnessCandidates()` 可以把 heterogeneous `CapabilityManifest` 投影为 `HarnessCandidate`，包含 `kind/id/manifestRef/score/reasons/providerAvailability/budget/fallbackCandidateIds`，并输出 provider/blocked/budget gate audit；当前不改变 broker 真实选择路径。第二阶段 broker input path 已接收 harness `skillHints`、`blockedCapabilities`、`toolBudget`、`verificationPolicy` 和 provider availability，并把对应信号写入 compact brief/audit，schema/examples/repair hints 仍保持 lazy expansion；最新小切片让 broker compact brief/audit 输出结构化 `budget` 字段，并按 `maxProviders` 裁剪 selected provider brief，同时 `summarizeToolsForAgentServer()` 已改为从 broker selected briefs 映射 budgeted compact tool summaries，不再默认空数组或恢复旧 catalog。第三阶段新增最小 `CapabilityBudgetDebit` contract/helper，能把单次 capability invocation 的 budget debit 记录为可写入 executionUnit/workEvidence/audit 的稳定 sink-addressable record；首个运行时小切片已接入 `literature.retrieval` offline runner，在 providerAttempts、workEvidence 和顶层 `budgetDebits` 审计输出里保留 sink refs。第四阶段新增纯 `loadCapabilityManifestRegistry()` package discovery 合并入口，能把 core manifests 与传入的 package discovery manifests 合成同一 registry，并输出包含 provider availability、required config、side effects、risk、validators、repair hints 的 compact audit，仍不展开 schema/examples。第五阶段新增默认候选 callback projection，把 skill package policy、tool package manifest、observe provider selection、Computer Use action plan 投影为统一 `HarnessCandidate`，证明用户显式选择只提高优先级，仍不能绕过 provider/config/safety/budget gate。第六阶段新增离线 file discovery helper，可从文件树发现 JSON manifest 和 TS 导出的 capability metadata，合并进同一 registry 并输出 file-discovery audit；第七阶段新增 opt-in `loadCapabilityManifestRegistryWithFileDiscovery()` 与 `buildCapabilityBrokerBriefForAgentServerWithFileDiscovery()`，默认仍不扫描文件树，显式 option / feature flag 才把 file discovery 合并进 registry/broker，并输出 registry/broker audit。第八阶段默认 core registry 加载真实离线 package action/verifier manifest：`action.sciforge.computer-use` 与 `verifier.fixture.human-approval`，并在 harness candidate graph / broker audit 中保留 provider、risk、sideEffects、validators、repair hints 和 budget metadata，不展开 schema/examples。第九阶段移除 AgentServer context envelope 对旧 `uiState.capabilityBrief` 的真相源依赖：`scenarioFacts.capabilityBrief` 现在只由 broker/registry compact brief 投影生成，旧字段只留下计数级 ignored audit，不再向 prompt/handoff 泄漏 legacy selected/excluded/verification sentinel。第十阶段把 `action.sciforge.computer-use` 的真实 `local.vision-sense` Computer Use loop 接入 `CapabilityBudgetDebit`，在 payload 顶层、executionUnit、workEvidence 与 audit log refs 中回挂 sink refs。第十一阶段默认 core registry 加载真实 presentation package view manifest：`view.report-viewer` 由 `packages/presentation/components/report-viewer/manifest.ts` 投影而来，进入 unified graph/broker audit，保留 provider、validator、repair hint、fallback 与 view budget metadata，schema/examples/prompt 仍保持 lazy。第十二阶段继续默认 registry breadth，新增真实 presentation package view manifest：`view.paper-card-list` 由 `packages/presentation/components/paper-card-list/manifest.ts` 投影为统一 `CapabilityManifest`，进入 core registry、unified graph 和 broker compact audit，保持 schema/examples/prompt lazy，不改变 runtime route。第十三阶段确认 observe invocation success/provider-unavailable 真实路径已写入 `CapabilityBudgetDebit`，并在 execution unit、work evidence、audit 与 observe invocation refs 中保留 sink-addressable debit refs。第十四阶段继续默认 registry breadth，新增真实 presentation package view manifest：`view.sequence-viewer` 由 `packages/presentation/components/sequence-viewer/manifest.ts` 投影进 core registry、unified graph 和 broker compact audit，schema/examples 仍保持 lazy。第十五阶段继续默认 registry breadth，新增真实 presentation package view manifest：`view.structure-viewer` 进入 core registry、unified graph 和 broker compact audit；默认 candidate callback 的 provider availability 合并改为保守策略，同 provider 任一来源 unavailable 时不会被 callback 或显式选择重新抬成 available。第十六阶段继续默认 registry breadth，新增真实 presentation package view manifest：`view.graph-viewer` 进入 core registry、unified graph 和 broker compact audit；`CapabilityBudgetDebit` sink refs 现在统一 trim/dedupe executionUnit、workEvidence 和 audit refs，避免 invocation debit 回挂产生漂移。

Todo：

- [ ] 将 `packages/skills`、`packages/actions`、`packages/observe`、`packages/verifiers`、`packages/presentation` 和 core runtime capabilities 投影成统一 `CapabilityManifest`。（actions/verifiers 与五个 presentation/view 真实 package manifest 已进入默认 registry。）
- [x] 扩展 capability registry loader，支持 package manifest discovery、provider availability、required config、side effects、risk、validators、repair hints。（纯函数合并入口、离线文件树 discovery 与 opt-in broker audit 接入已完成；默认路径仍不扫描。）
- [x] 定义 `HarnessCandidate`：`kind/id/manifestRef/score/reasons/providerAvailability/budget/fallbackCandidateIds`。
- [x] 将 `scoreSkillByPackagePolicy`、tool package manifests、observe provider selection、Computer Use action plan 统一包装为默认 candidate callbacks。（首片为 shadow projection，不改变真实 broker 路由。）
- [x] 将 `summarizeToolsForAgentServer()` 改为按 harness/capability budget 输出 budgeted tool briefs，不再默认空数组。
- [x] Broker 输入接收 `skillHints`、`blockedCapabilities`、`CapabilityBudget`、`verificationPolicy`、provider availability 和 ledger history。
- [ ] 每次 capability invocation 写入 `budgetDebits` 到 executionUnit/workEvidence/audit；已完成 `literature.retrieval` offline runner 与 `action.sciforge.computer-use` / `local.vision-sense` Computer Use loop。
- [x] 增加 `smoke:unified-capability-graph`：同一 prompt 下 skill/tool/observe/action/verifier 都能作为候选进入 broker audit，且安全/配置/预算 gate 生效；真实 package action/verifier manifest 默认可见且保持 lazy audit。
- [x] 增加 `smoke:capability-broker-harness-input`：harness hints/budget/provider/verification policy 进入 broker compact audit，blocked capability 不能绕过 gate。
- [x] 增加 `smoke:capability-budget-debits`：单次 capability invocation 能生成带 executionUnit/workEvidence/audit sink refs 的 budget debit record。
- [x] 增加 `smoke:capability-manifest-file-discovery`：临时 JSON/TS package manifests 可被文件树 discovery 合并进 registry 和 unified graph。

验收标准：

- [x] 没有第二套 skill/tool selection 真相源。（旧 `uiState.capabilityBrief` 已降级为 ignored audit，AgentServer handoff 只消费 broker/registry compact brief。）
- [x] 用户显式选择能力只提高候选优先级，不能绕过 safety/config/budget gate。
- [x] Provider availability 合并 fail closed：同 provider 任一来源 unavailable 时，用户显式选择或 callback boost 不能抬成 available。
- [x] Broker 默认仍只暴露 compact brief；schema/examples/repair hints 继续 lazy expansion。

### T128 Contract-driven Handoff：context、prompt、AgentServer payload 全部由 contract 渲染

状态：进行中；目标是把 fresh/continuation、workspace read policy、current refs、repair retry、tool-use policy 等散落 prompt/metadata 规则迁入 `HarnessContract`，prompt builder 只做 deterministic rendering。

进展：第一阶段 metadata-only handoff 已落地。AgentServer dispatch payload 不再把 harness contract/prompt directives 内联进自然语言 prompt，而是携带 `harnessProfileId`、`harnessContractRef`、`harnessTraceRef`、budget summary、decision owner 和结构化 `agentHarnessHandoff` 元数据，作为 deterministic renderer 的稳定交接面。第二阶段补充了 `uiState.agentHarnessInput` 到 shadow contract 的 refs/intent 桥接，并新增离线 `smoke:contract-driven-handoff` 覆盖 fresh/continuation/repair 三类 handoff refs。第三阶段新增 `promptRenderPlan` metadata scaffold：从 `HarnessContract` 的 intent/context/repair/promptDirectives 确定性渲染 strategy/directive refs，所有策略句和 selected refs 都带 `sourceCallbackId`。第四阶段补充 `sourceRefs`、结构化 `renderedEntries` 与 deterministic `renderDigest`，使策略句顺序可从 contract/trace refs 重建；第五阶段让 `buildAgentServerGenerationPrompt` 消费 `agentHarnessHandoff.promptRenderPlan` / `promptRenderPlan` 并生成结构化 `promptRenderPlanSummary`，放入 current-turn snapshot 和 compact request，避免把完整 rendered text 或 metadata 原样塞回 prompt。第六阶段新增 `smoke:agentserver-prompt-policy-prose`，冻结 AgentServer generation/repair prompt 中现存 hardcoded 策略散文，并只允许 runtime-contract policy/contract providers、`packages/skills/runtime-policy` 与 harness `promptRenderPlanSummary.renderedEntries` 继续提供新增策略句。第七阶段把 generation prompt 中 taskFiles/entrypoint/physical-write 三句契约迁入 `packages/skills/runtime-policy` 的 trusted provider，prompt builder hardcoded 策略散文从 31 条降到 28 条。第八阶段修复同 prompt timeout/cancel 后恢复 handoff：recent repair-needed/failed/needs-human attempt 会触发 `priorAttempts` 附带，确保 compacted retry prompt 仍能恢复失败上下文。第九阶段把 AgentServer generation/repair prompt 剩余 hardcoded policy prose 迁入 `packages/skills/runtime-policy` trusted providers，`buildAgentServerGenerationPrompt` 与 `buildAgentServerRepairPrompt` 的 hardcoded 策略散文守门计数均降到 0；recoverable recent attempt 只在 normalized prompt 完全一致时自动附带，避免 fresh request 泄漏旧失败 attempts。

2026-05-10：AgentServer generation recovery helper 区块抽出到 `agentserver-generation-recovery.ts`，主 `generation-gateway.ts` 只保留 recovery helper 调用；context-window/rate-limit compact retry、retry audit、成功后 recovery event 和 task-attempt audit 行为保持原样，主文件降到约 1012 行。`smoke:agentserver-repair` 同步兼容 fresh generation 的 `workspace-task-generation-inline` handoff purpose。

2026-05-10：`recoverable-attempts.ts` 抽出 recoverable recent attempt prompt matcher，`generation-gateway.ts` 降到 991 行并退出 1000 行 watch list。`buildCompactRepairContext` / `buildAgentServerRepairPrompt` 新增 repairContextPolicy evidence filtering/audit，按 `allowedFailureEvidenceRefs`、`blockedFailureEvidenceRefs`、stdout/stderr summary、validation findings 和 prior attempts policy 裁剪 repair prompt 输入。

2026-05-10：PromptSplit-A/T128 将 AgentServer repair context policy summary、evidence filtering 和 audit helper 抽出到 `agentserver-repair-context-policy.ts`，`agentserver-prompts.ts` 只保留 compact repair context/prompt 调用并降到 848 行，退出 1000 行 watch list；compact repair / repair smokes 和 prompt prose guard 保持通过。

2026-05-10：backend selection 已接入 metadata-only harness handoff。AgentServer generation dispatch 使用同一份 backend selection decision 选择 backend，并在 opt-in audit 下暴露到 input/runtime/top-level metadata 与 `agentHarnessHandoff.backendSelectionDecision`；默认不暴露新 metadata，stream guard 继续复用现有 `SilentStreamDecisionRecord`。

2026-05-10：T128-B 补齐 context budget deterministic slimming trace。`contextEnvelopeGovernanceAudit` 在 contract 驱动的 reference digest budget 裁剪时输出 `sciforge.context-envelope.slimming-trace.v1`，包含 contract/trace refs、budget field、input/kept/omitted/required refs、decisionRef 和 digest；`normalizeBackendHandoff` 同步写出 `.sciforge/handoffs/*-slimming-trace.json`，并在 handoff manifest/audit refs 中回挂 trace ref、source HarnessContract refs 和 deterministic decisions。

2026-05-10：T128-D 新增纯 handoff reconstruction helper，可从 payload metadata、normalized handoff manifest 和 slimming trace audit refs 抽取 HarnessContract/HarnessTrace refs，并用传入的 `HarnessContract`/trace 确定性重建 `agentHarnessHandoff` scaffold 与 `promptRenderPlanSummary`；`smoke:contract-driven-handoff` 扩展 generation/repair normalized payload 用例，证明不需要恢复完整 backend 文本也能重建 refs 和 render summary。

2026-05-10：T128-E 加强 handoff reconstruction helper negative/compat 覆盖：缺 canonical `harnessContractRef` 时只允许 partial reconstruction，不从 trace-only refs 或 legacy `agentHarnessHandoff.contractRef` 推断完整 contract ref；旧 handoff metadata 继续兼容读取 trace ref 但不会误判为完整重建。

2026-05-10：T128-F 将 context envelope governance 收敛为 contract-only 消费。打开 feature flag 后，真实 filtering/slimming 只读取 `uiState.agentHarness.contract` / `agentHarnessHandoff` 的 context refs 与 budget；旧 `uiState.allowedContextRefs`、`blockedContextRefs`、`contextBudget` 以及 capability policy 中的 context-like 字段只进入 `contextGovernanceAudit.ignoredLegacySources`，不参与决策。`workspaceTreeSummary` 同步抽到 `context-envelope-workspace-tree.ts`，`context-envelope.ts` 保持低于 1000 行。

2026-05-10：T128-G 补齐 legacy repair context policy ignored audit。`contextEnvelopeIgnoredLegacySources` 现在记录 legacy `repairContextPolicy` 的 policy 字段与 failure evidence ref 计数，但这些字段不参与 context refs filtering 或 budget slimming，继续维持 contract-only 决策面。

2026-05-10：T128-H repair context policy contract-only 消费首片完成。AgentServer repair context policy summary 只从 `agentHarnessHandoff` / `agentHarness.contract` 生成可执行过滤规则；legacy `repairContextPolicy` 仅进入 deterministic ignored audit。summary/audit 增加 `sourceKind`、contract/trace refs 与 deterministic decision ref，prompt builder 仍不新增 hardcoded policy prose。

2026-05-10：T128-I context envelope 补齐 contract repairContextPolicy audit。`contextEnvelopeGovernanceAudit` 现在从 canonical `agentHarness.contract` / `agentHarnessHandoff` 输出 bounded `repairContextPolicy` summary（字段、contract/trace refs、deterministic decision ref、failure evidence refs），legacy `uiState.repairContextPolicy` 仍只进入 ignored audit，且不参与 context refs filtering / digest slimming。

Todo：

- [ ] `buildContextEnvelope` 只消费 `allowedContextRefs`、`blockedContextRefs`、`requiredContextRefs`、`contextBudget`、`repairContextPolicy`。（context refs/budget 已在 opt-in contract-only governance 下忽略 legacy 决策源；AgentServer repair prompt context 已 contract-only 消费；context envelope 自身已对 contract repairContextPolicy 做 bounded audit，legacy repairContextPolicy 仍不参与决策。）
- [ ] `buildCapabilityBrokerBriefForAgentServer` 只消费 `capabilityPolicy`、`skillHints`、`toolBudget` 和 scenario/capability manifest。
- [x] `buildAgentServerGenerationPrompt` 只渲染 `promptDirectives`、current-turn snapshot、selected contract refs，不再新增行为治理散文。（剩余策略散文已迁入 trusted runtime-policy providers；prompt prose guard 计数为 0。）
- [x] `buildAgentServerRepairPrompt` 只渲染 `repairContextPolicy` 允许的失败 evidence、validator findings 和 recover actions。（策略散文已迁入 trusted runtime-policy providers；stdout/stderr、validation findings、prior attempts 和 work-evidence 输入已有 deterministic filtering/audit。）
- [x] AgentServer payload metadata 带 `harnessProfileId`、`harnessContractRef`、`harnessTraceRef`、budget summary、decision owner。
- [x] 增加第一阶段 `smoke:contract-driven-handoff`：mock AgentServer 捕获真实 dispatch，验证 fresh 不泄漏旧 attempts/logs，continuation/repair 携带 contract refs/repair policy。
- [ ] 将 backend selection、fresh/continuity prompt rule、context/rate-limit recovery、stream guard 统一通过 harness hook 输出结构化决策。（backend selection、continuity decision 与 silent stream decision 已有结构化首片；完整 hook 收敛仍待推进。）
- [x] 扩展 `smoke:contract-driven-handoff` 到 deterministic renderer：prompt 中所有策略句都有 `sourceCallbackId`。
- [x] 增加 `smoke:agentserver-prompt-policy-prose`：禁止 prompt builder 新增未受信策略散文，并要求 generation prompt 继续消费 `promptRenderPlanSummary`。

验收标准：

- [x] Prompt builder 不再是策略真相源。（generation/repair hardcoded policy prose guard 均为 0；新增策略句只能来自 runtime-contract、packages/skills/runtime-policy 或 harness rendered entries。）
- [x] Handoff payload 可以从 `HarnessContract` 和 refs 重建。
- [x] Context budget 超限时有 deterministic slimming trace。

### T127 Result Validation / Repair / Audit Pipeline：失败路径统一成决策链

状态：进行中；目标是所有输出路径进入同一 `ValidationDecision -> RepairDecision -> AuditRecord` 链路，generated-task runner、direct payload、observe/action、verification gate 和 repair rerun 不再各自判断成败。

进展：

- 2026-05-10：新增 `@sciforge-ui/runtime-contract/validation-repair-audit` 第一阶段纯契约，定义 `ValidationDecision`、`RepairDecision`、`AuditRecord`、通用 finding/subject/ref/budget shape，并用离线 smoke 证明 direct payload、generated-task result、observe result 失败可以落到同一决策链；尚未重接 runner 主流程。
- 2026-05-10：新增 gateway 侧 `createValidationRepairAuditChain()` bridge，并让 `smoke:validation-repair-audit-chain` 增加 verification-gate 失败样本，验证 failed runtime verification result 会进入 `ValidationDecision -> RepairDecision -> AuditRecord`，并保留 policy/evidence/sink/telemetry refs 与 repair hints；该切片尚未重接主流程 wiring。
- 2026-05-10：真实 `payload-validation` schema failure 与 completed payload contract failure 已通过 bridge 生成 validation/repair/audit chain，并挂回 repair-needed execution unit 的 `refs.validationRepairAudit`，保留原有 `validationFailure` 行为兼容；`generated-task-runner` 生命周期尚未整体收敛。
- 2026-05-10：T127 小切片新增 validationRepairAudit attempt metadata helper；`appendTaskAttempt` 可从 repair-needed payload/outputRef 提取并保留 `refs.validationRepairAudit` 与 `validationRepairAuditRecords`，用 smoke 证明 payload-validation schema failure 的 audit record 能随 attempt append/read 回流；完整 AuditSink/ledger wiring 在后续小切片继续接入。
- 2026-05-10：新增纯执行层 `repair-executor.ts`，可从既有 `RepairDecision`/validation-audit chain 机械映射并执行 patch/rerun/supplement/peer handoff/needs-human/fail-closed action plan，输出 `RepairExecutorResult` 与 executor refs；策略仍由 `RepairPolicyHarness` 决定，executor 不做策略判断。
- 2026-05-10：新增 `validation-repair-audit-sink.ts` 纯 sink/helper 与 sink contract 类型，可把 `ValidationRepairAuditChain` 或 `{ validationDecision, repairDecision, auditRecord }` 投影为 `appendTaskAttempt`、`ledger`、`verification-artifact`、`observe-invocation` sink refs/records；该切片先不重接 runner 主流程。
- 2026-05-10：AuditSink 首片已从纯 projection 推进到 `appendTaskAttempt` / read path，attempt metadata 可保留并回读 `refs.validationRepairAuditSink` 与 `validationRepairAuditSinkRecords`，覆盖 `appendTaskAttempt`、`ledger`、`verification-artifact`、`observe-invocation` 四类 sink target；Capability Evolution Ledger 真实写入首片已接入 validation/repair audit sink，verification/observe 真实写入仍待接入。
- 2026-05-10：新增 `validation-repair-telemetry-sink.ts` 纯 TelemetrySink/helper，可把 validation/repair/audit/executor/chain 投影成稳定 spans，覆盖 `generation/request`、`materialize`、`payload-validation`、`work-evidence`、`verification-gate`、`repair-decision`、`repair-rerun`、`ledger-write`、`observe-invocation`。
- 2026-05-10：Verification gate 真实路径已接入 validation/repair/audit chain：`applyRuntimeVerificationPolicy` 在 failed/needs-human gate 上生成 `verification-gate` audit subject，把 `validationRepairAudit` refs 挂回 top-level 和 execution unit，并把 gated payload 写回原 `outputRef`，让 `readTaskAttempts` 可从输出回流 audit metadata。
- 2026-05-10：`generated-task-runner` 生命周期瘦身首片完成，新增 `generated-task-runner-validation-lifecycle.ts` 承接 validation/repair/audit helper，主入口从 1211 行降到 1083 行；完整 generate/run/validate/repair/audit 编排继续收敛。
- 2026-05-10：AuditSink `verification-artifact` 真实写入首片完成，可把 verification artifact sink record 写入 `.sciforge/validation-repair-audit/verification-artifacts/<auditId>.json`，并读回包含 `auditId`、`contractId`、`failureKind`、`sinkRefs` 的 artifact/fact。
- 2026-05-10：TelemetrySink 从纯 projection 推进到真实落盘首片，可把 spans 写入 `.sciforge/validation-repair-telemetry/spans.jsonl`，并提供 read/summary helper 保留 validation/repair/audit/executor refs。
- 2026-05-10：`generated-task-runner` 继续拆分 supplement lifecycle，新增 `generated-task-runner-supplement-lifecycle.ts` 承接 missing artifact 检测、supplement payload merge 与 fallback ledger 记录；主入口从 1083 行降到 822 行，退出 1000 行 watch list。
- 2026-05-10：TelemetrySink 接入 runtime gateway verification 后真实路径，best-effort 写 `.sciforge/validation-repair-telemetry/spans.jsonl` 并把 `refs.validationRepairTelemetry` 回挂最终 payload；verification-gate / repair-decision spans 可由 read/summary helper 回流。
- 2026-05-10：Capability Evolution Ledger 新增 compact ledger facts 投影，可从同一 ledger 记录统一读出 success、failure、fallback、repair、needs-human 事实类型，为成功/失败/repair/fallback 事实补齐稳定消费面。
- 2026-05-10：将 gateway telemetry 回挂 helper 抽入 `validation-repair-telemetry-runtime.ts`，保持 `generation-gateway.ts` 只做流程编排并从 1412 行降到 1368 行。
- 2026-05-10：新增通用 result-to-finding projection model，`validation-repair-audit-bridge` 可直接接 `observeResponse`、`actionResult`、`findingProjections` 并统一汇入 findings；`smoke:validation-repair-audit-chain` 覆盖 direct/generated/observe/action/verification 同一 chain shape。
- 2026-05-10：将 `SilentStreamDecisionRecord` 类型、schema 常量与构造/反序列化 helper 抽入 `events-silent-stream.ts`，`events.ts` re-export 保持兼容并从 1410 行降到 1284 行。
- 2026-05-10：Longfile-G/contracts 将 run termination event family 抽入 `events-run-termination.ts`，`events.ts` 继续 re-export 保持 public API 兼容并降到 1233 行；`events-silent-stream.ts` 改为直接依赖 termination helper，移除对主入口的反向引用。
- 2026-05-10：repair rerun 真实路径接入同一 validation/repair/audit chain。`generated-task-runner-validation-lifecycle` 会在 repair rerun payload 上挂 `repair-rerun-result` audit refs，accepted rerun 投影为 no-op repair decision，失败/repair-needed rerun 投影为统一 work-evidence finding，并把 annotated payload best-effort 写回 outputRef 供 `readTaskAttempts()` 回流。
- 2026-05-10：Capability Evolution Ledger compact facts 读路径保留 JSONL 真实行号；真实 generated-task runner success event 与 supplemental fallback lifecycle 写入后，`readCapabilityEvolutionLedgerFacts()` 可读回 success / fallback+success compact facts，`limit` 场景下 `recordRef` 不漂移。
- 2026-05-10：AuditSink observe-invocation 真实落盘 wiring 接入 observe orchestration provider-unavailable 路径，写入 `.sciforge/validation-repair-audit/observe-invocations/*.json` 并可由 read helper/facts 回流。
- 2026-05-10：repair-rerun TelemetrySink 真实写入完成。repair rerun audit chain 生成后 best-effort 写 `.sciforge/validation-repair-telemetry/spans.jsonl`，accepted rerun 也投影 `repair-rerun` span，并把 telemetry refs 回挂 payload / `readTaskAttempts()` metadata。
- 2026-05-10：TelemetrySink observe-invocation 真实 wiring 接入 observe orchestration success/provider-unavailable 路径，best-effort 写 `.sciforge/validation-repair-telemetry/spans.jsonl`，并把 telemetry refs/可选 summary 回挂 observe invocation record。
- 2026-05-10：Capability Evolution Ledger validation-repair audit 转换 helper 抽入 `capability-evolution-ledger-validation-audit.ts`，原 public API re-export 兼容，`capability-evolution-ledger.ts` 降到 813 行并退出 1000 行 watch list。
- 2026-05-10：T127-E 继续收敛 generated-task runner lifecycle：generation failure/direct payload attempt、generated task input、pre-output/parse repair policy 与 success ledger refs 组装迁入 `generated-task-runner-validation-lifecycle.ts`，主入口降到 712 行，runner 分支不再手写这些 repair policy / ledger input 字段。
- 2026-05-10：T127-F 继续收敛 generated-task runner lifecycle：direct ToolPayload refs/log/normalize/materialize/attempt lifecycle 与 entrypoint/path-only taskFiles/task-interface strict retry 编排迁入 `generated-task-runner-generation-lifecycle.ts`，主入口降到 476 行；新增 entrypoint direct retry smoke，并同步更新旧 generation/path-only/repair smokes 到 fresh attempt 与 visible verification-result 语义。
- 2026-05-10：T127-G 补齐 AuditSink/TelemetrySink 读回面：verification artifact 与 observe invocation sink read-back 现在输出统一 summary（target/sourceRef/counts/status/outcome/failure kind/sink refs/recent artifacts），runner 与 observe runtime 共用 TelemetrySink attempt-ref helper，不再各自手写 telemetry ref shape。
- 2026-05-10：T127-H 继续收敛 generated-task runner output lifecycle。workspace task run 后的 pre-output repair、output parse、schema/normalize、repair rerun、attempt append、supplement fallback、promotion proposal、success ledger 与最终 materialize 迁入 `generated-task-runner-output-lifecycle.ts`，`generated-task-runner.ts` 降到 303 行，只保留 generation/run/output lifecycle 编排。
- 2026-05-10：T127-I TelemetrySink 回挂 helper 收敛。新增 `mergeValidationRepairTelemetryAttemptMetadata()` 与 `attachValidationRepairTelemetryWriteResult()`，runtime gateway 和 observe runtime 复用同一 refs/summary 回挂逻辑，observe 不再手写 telemetry ref + summary shape。
- 2026-05-10：T127-J 继续收敛 generated-task runner execution lifecycle。taskFiles 物化、task id/runtime refs/input/supplement scope 组装与 `runWorkspaceTask` 调用迁入 `generated-task-runner-execution-lifecycle.ts`，主入口降到 246 行，只做 generation/direct payload/retry/execution/output lifecycle 编排。
- 2026-05-10：T127-K AuditSink action-result readback 首片完成。`validation-repair-audit-sink` 可从已落盘 verification artifacts 中筛出 `subject.kind === 'action-result'` 并汇总 audit/finding/source sink/telemetry refs，smoke 覆盖 action-result sink projection -> verification artifact write -> readback summary。
- 2026-05-10：T127-L repair/audit chain 接入 opt-in harness repair policy。payload validation 与 runtime verification gate 生成 chain 时可在 feature flag 下从 HarnessContract 收紧 repair budget / fail-closed 决策，并把 harness policy 摘要写入 audit refs/sink refs。
- 2026-05-10：T127-M 继续收敛 generation failure lifecycle。AgentServer generation failure、current reference digest self-heal recovery、generation failure attempt append 与 repair-needed payload 生成迁入 `generated-task-runner-generation-lifecycle.ts`，`generated-task-runner.ts` 降到 146 行，只保留 generation/direct/retry/execution/output lifecycle 编排。
- 2026-05-10：T127-N 统一 AuditSink/TelemetrySink readback summary 字段。verification artifact、observe invocation、action-result 与 telemetry spans 现在共用 target/source/counts/status/outcome/failure/sink/telemetry refs 形状，smoke 覆盖 action-result、verification artifact、observe invocation 和 telemetry summary 回读。

Todo：

- [x] 建立 `ResultValidationHarness`：统一 schema、artifact refs、completed payload、current refs、WorkEvidence、guidance adoption、provided verification results、runtime verification gate、observe/action trace contract。
- [x] 建立 `RepairPolicyHarness`：统一决定 `none` / `repair-rerun` / `supplement` / `fail-closed` / `needs-human`。
- [x] 建立 `RepairExecutor`：只执行 patch/rerun/supplement/peer handoff，不做策略判断。
- [x] 建立 `AuditSink`：统一写 `appendTaskAttempt`、Capability Evolution Ledger、verification artifacts、observe invocation records。（appendTaskAttempt/read path、Capability Evolution Ledger validation/repair audit、verification artifact 与 observe-invocation 真实写入已接入。）
- [x] 建立 `TelemetrySink`：记录 `generation/request`、`materialize`、`payload-validation`、`work-evidence`、`verification-gate`、`repair-decision`、`repair-rerun`、`ledger-write`、`observe-invocation` spans。（projection、jsonl 落盘/read/summary、gateway verification、repair-rerun 与 observe-invocation 真实写入已完成。）
- [ ] 将 `generated-task-runner` 收敛为生命周期编排：generate/run/validate/repair/audit。（generation、execution、output、validation/repair/audit、supplement lifecycle、generated task input、pre-output/parse repair policy、success ledger refs、生成重试/materialize/strict retry、generation failure/self-heal helper 已拆出，主入口 146 行并退出 watch list；后续只剩跨 helper 边界继续打磨。）
- [x] Verification gate 结果必须回流 repair/audit，而不是只在最终 payload 上 fail closed。
- [x] 增加 `smoke:validation-repair-audit-chain`：direct payload、generated task、observe result、verification gate 失败都能追溯 contract id、failure kind、related refs、repair budget、最终 outcome。

验收标准：

- [x] direct payload、generated task、repair rerun、observe/action result 共用同一 validation finding model。（真实 repair rerun 已接入 `repair-rerun-result` chain/finding projection；observe/action 仍为离线链路覆盖。）
- [x] Runner 分支不再手写 repair policy 和 ledger input。（T127-E 已把 generation/direct attempt ledger、generated task input、pre-output/parse repair policy 与 success ledger refs 迁入 lifecycle helper。）
- [x] Capability Evolution Ledger 拥有完整成功/失败/repair/fallback 事实。（validation/repair audit sink、compact ledger facts、真实 generated-task success 与 supplemental fallback facts 已覆盖。）

### T126 Interaction and Progress Harness：用户可见进度、澄清、取消统一治理

状态：进行中；目标是让 UI 继续保持 thin shell，但具备清晰的长任务进度、沉默等待、澄清、人工确认、取消和后台完成体验。UI 只消费 structured stream events，不做语义路由。

进展：第一阶段 contract/projection MVP 已完成。`ProgressPlan` 已扩展 silence/background/cancel/interaction policy，新增标准 `HarnessInteractionProgressEvent` 契约与 gateway 投影 helper；当前只提供 runtime contract 与离线 smoke，不改 UI/transport/backend 真实事件路由。smoke 已补充 generic `WorkspaceRuntimeEvent` 投影守卫，证明结构化进度事件不会把 prompt/scenario 语义文本透传到通用 runtime event 字段。最新小切片新增 `RunTerminationRecord` 与 `normalizeRunTermination()`，让 `user-cancelled`、`system-aborted`、`timeout`、`backend-error` 进入结构化 termination 字段，并在 session/background history 中保留；UI silent stream waiting 也开始从 harness contract 的 `progressPlan.silencePolicy.timeoutMs` 恢复等待阈值，保留 5s fallback。Transport/backend stream guard 已开始消费 harness `silencePolicy`，silent timeout event/recovery audit 带 `timeoutMs`、`decision`、`maxRetries`、`retryable`、`contractRef`、`recoveryAction` 等结构化字段。最新首片新增 `SilentStreamDecisionRecord`，transport/backend/UI silent watchdog 可共享同一 run-level decision id，backend audit 合并 transport decision，UI progress 只补 `ui-progress` layer。后续小切片新增 `InteractionProgressEvent` contract 与真实 transport/UI normalization，`clarification-needed`、`human-approval-required`、`guidance-queued`、`run-cancelled` 可进入 `processProgress` / session history，UI 仍只消费结构化 status/label/detail。最新 UI 小切片新增 `latestProgressModelFromCompactTrace()`，可从 compact `streamProcess.events` / `streamProcess.summary` / session `runs[].raw.streamProcess` 恢复最近 progress model，减少对完整 React event array 的依赖。

2026-05-10：ChatPanel thin-shell guard 小切片完成。`runningMessageContentFromStream()` 可直接测试 running message 内容，新增测试证明即使 prompt/scenario/detail 含 search/write/failed/approval/retrieval/repair 等诱饵词，ChatPanel 和 `RunningWorkProcess` 仍只按 structured progress/work-event 字段展示，诱饵文本只留在 raw fold。

2026-05-10：Longfile-F/UI 将 ChatPanel running message/readiness、message-run verification/linking、upload artifact staging 和 run timeline projection 抽到 `src/ui/src/app/chat/*Presentation.ts(x)` / `uploadedArtifact.ts` helpers，保留 `ChatPanel.tsx` 兼容 re-export，主文件降到 996 行并退出 1000 行 watch list；UI 行为和 runtime/workspace-server 路由不变。

2026-05-10：T126 compact interaction restore 小切片完成。runtime contract 新增 compact record restore helper，`processProgress` 可从 compact `streamProcess.events` / session raw streamProcess 恢复多个 progress model 并取最新；`streamEventPresentation` 删除本地 interaction schema/status/label/budget 解析，统一消费 runtime contract normalized event + presentation，继续避免 prompt/scenario 语义 fallback。

2026-05-10：T126 compact replay guard 收尾完成。compact interaction/progress restore 现在只接受 `detail` / `summary` 的结构化字段，不从 `message`、`text`、`prompt` 或 `scenario` 恢复；session history、streamProcess compact trace 与 worklog 三处都补了 poison guard，确保 UI 仍只消费 structured contract。

Todo：

- [x] 定义 `ProgressPlan`：initial status、phase names、silence policy、background policy、cancel policy、interaction policy。
- [x] 标准事件：`process-progress`、`interaction-request`、`clarification-needed`、`human-approval-required`、`guidance-queued`、`run-cancelled`。
- [x] 将 UI、transport、backend 三层 silent watchdog 统一为 `silencePolicy`，同一 run 只产生一条可审计 retry/abort/visible-status 决策。（已新增 shared `SilentStreamDecisionRecord` 首片，三层复用同一 decision id/layers。）
- [x] 区分 `user-cancelled`、`system-aborted`、`timeout`、`backend-error`，历史 run 不全部折叠成普通 failed。
- [x] 让 `streamEventPresentation` 根据结构化 `importance/phase/status/reason/budget` 投影 worklog，减少自然语言启发式。
- [x] 短期兼容现有 guidance queue；长期将澄清和人工确认升级为一等 interaction contract。（clarification/human approval/guidance queued 已有 interaction progress contract 与 transport/processProgress 首片。）
- [x] 增加 `smoke:interaction-progress-harness`：长任务沉默、用户取消、系统 abort、timeout、human approval、mid-run guidance 都有稳定事件和最终 run state。

验收标准：

- [x] ChatPanel 不根据 prompt/scenario 判断任务语义。
- [x] 用户取消、系统中断和后端失败可在 session/history 中区分。
- [x] 长任务进度可以从 stream trace 恢复，而不是依赖完整 React event array。（compact streamProcess events/summary 与 prior run payload 已有恢复 helper 和测试覆盖。）

### T125 Research Capability Pack：通用科研能力包与 literature.retrieval

状态：进行中；目标是把高频科研任务沉淀为通用 composed capabilities，而不是隐藏 workflow。第一批聚焦文献检索、PDF 下载、全文抽取、批量总结、引用核验和证据矩阵。

进展：第一阶段 `literature.retrieval` composed capability 已进入核心 capability manifest registry，声明 PubMed/Crossref/Semantic Scholar/OpenAlex/arXiv/web/SCP provider 面、输入输出 contract、默认预算、refs-first full text policy、引用核验字段和结构化失败/partial 语义。第二阶段首片已从 manifest-only 推进到离线 provider mock runner/normalizer contract：可在无 live provider 的情况下归一化 `paper-list`、`evidence-matrix`、`research-report`、`workEvidence`、`providerAttempts`、`citationVerificationResults`，并验证空结果、provider timeout、超预算、download failure、citation mismatch 的失败/partial outcome。

Todo：

- [x] 新增 `literature.retrieval` composed capability：providers 覆盖 PubMed、Crossref、Semantic Scholar、OpenAlex、arXiv、web search、SCP biomedical search。
- [x] 输入 contract：`query`、`databases`、`dateRange`、`species`、`maxResults`、`includeAbstracts`、`fullTextPolicy`、`dedupePolicy`。
- [x] 输出 contract：`paper-list`、`evidence-matrix`、`research-report`、`workEvidence`、`providerAttempts`、`citationVerificationResults`。
- [x] 默认 budget：`maxProviders=3`、`maxResults=30`、`perProviderTimeoutMs=10000`、`maxFullTextDownloads=3`、`maxDownloadBytes=25MB`。
- [x] 空结果、provider timeout、download failure、citation mismatch 必须输出 structured failure/partial payload，不能算成功。
- [x] 引用核验强制检查 DOI/PMID/arXiv id/title/year/journal 一致性，结果进入 verificationResults。
- [x] PDF/full text 抽取保持 refs-first：全文写 artifact/task-results，prompt 只收 bounded summary、hash、page/section locators。
- [x] 新增离线 provider mock runner/normalizer contract：多 provider attempts、去重、预算截断、refs-first report 降级和 citation verification outcome 均可本地复现。
- [x] 增加 `smoke:literature-retrieval-capability`：arXiv/PubMed/OpenAlex 至少一个 provider 可 mock 成功；空结果、超预算、引用不一致均 fail closed 或 partial。

验收标准：

- [x] Harness 只选择 profile/budget/provider policy，不固化 arXiv 或任意站点 workflow。
- [x] 同一能力可被不同 scenario 复用。
- [x] 文献检索结果可审计、可验证、可修复。

### T124 Harness Experiment Suite：把 agent harness 变成可研究、可比较的实验平台

状态：进行中；目标是为 harness profile、hook、budget 和 repair strategy 建立可复现实验基准，让未来 agent harness 研究可以像训练框架一样比较策略效果。

进展：第一阶段离线实验基准已落地。新增 `tests/harness/fixtures`、trace assertion helpers 和 `smoke:agent-harness-experiments`，可以在不依赖 live backend 的情况下比较 `fast-answer`、`research-grade`、`low-cost`、`privacy-strict` profile 的 contract/trace 差异，并覆盖 repair 与预算耗尽场景。第二阶段 replay/metrics/golden scaffolding 已落地：`smoke:agent-harness-replay` 会从保存的 trace 快照和 fixture refs 重放 contract decision，汇总预算/验证/repair 指标，并锁定最小 golden trace 摘要。最新 replay guard 会校验 verification intensity、progress initial status 与 progress phase count，并把这些轴写入 metrics，确保实验比较不只看预算/网络调用。

Todo：

- [x] 建立 `tests/harness/fixtures`：fresh research、file-grounded summary、repair after validation failure、silent stream/cancel、capability budget exhaustion。
- [x] 建立 trace assertion helper：断言 hook order、decision merge、budget debit、blocked refs、selected candidates、validation/repair/audit chain。
- [x] 建立 profile diff runner：同一 prompt 在 `fast-answer`、`research-grade`、`low-cost`、`privacy-strict` 下产出不同 contract，但不 fork runtime path。
- [x] 建立 replay runner：从 saved `HarnessTrace` 和 refs 重放 contract decision，不依赖 live backend。
- [x] 建立 metrics：latency、context tokens、tool calls、network calls、download bytes、validation failures、repair attempts、final artifact quality。
- [x] 建立 golden traces：锁定最小实验案例的 expected contract/trace，不锁定 backend 具体自然语言答案。
- [x] 增加 `npm run smoke:agent-harness-experiments`。
- [x] 增加 `npm run smoke:agent-harness-profile-coverage`。
- [x] 增加 `npm run smoke:agent-harness-replay`。

验收标准：

- [x] 新 profile 必须附带最小实验 fixture 和 trace assertion。
- [x] 新 hook 必须声明 owned stages、input facts、decision fields、merge behavior 和测试覆盖。
- [x] Harness 研究可以比较策略效果，而不是比较散落 prompt 文案。

### T123 Agent Harness Policy：集中治理探索、上下文、工具和进度策略

状态：待办；目标是把 agent harness 从 gateway、prompt builder、conversation policy、UI 状态和 repair loop 中抽成独立、可版本化、可切换的行为治理层。Runtime 负责稳定阶段 hook 和 enforcement；harness 负责按 intent mode/profile 输出结构化 `HarnessContract`。这不是为某个文献检索案例打补丁，而是让任意任务都能在统一策略下选择探索预算、上下文范围、技能倾向、工具预算、验证强度和用户可见进度。

设计文档：[`docs/Architecture.md`](docs/Architecture.md#终极形态harness-governed-scientific-agent-os)、[`docs/AgentHarnessStandard.md`](docs/AgentHarnessStandard.md)。

Todo：

- [ ] 建立 `packages/agent-harness` 或等价 package，定义 `HarnessStage`、`HarnessProfile`、`HarnessContract`、`HarnessDecision`、`ExplorationMode`、`IntentMode` 和 profile registry。
- [ ] 以 [`docs/AgentHarnessStandard.md`](docs/AgentHarnessStandard.md) 作为唯一 harness 编程标准；后续新增 hook、profile、merge rule、最小实验案例必须先更新该文档。
- [ ] 将 harness 标准化为 Lightning-style callback 模型：`HarnessRuntime` 负责阶段调用和 decision merge，`HarnessProfile` 组合 callbacks/budgets，`HarnessCallback` 只返回结构化 `HarnessDecision`，`HarnessTrace` 记录每个阶段输入摘要、输出、预算消耗和 enforcement 结果。
- [ ] 在 runtime gateway 增加稳定 hook 调用点：`onRequestReceived`、`classifyIntent`、`selectProfile`、`selectContext`、`setExplorationBudget`、`selectCapabilities`、`beforePromptRender`、`beforeAgentDispatch`、`onAgentStreamEvent`、`beforeToolCall`、`afterToolCall`、`beforeResultValidation`、`afterResultValidation`、`onRepairRequired`、`beforeRepairDispatch`、`afterRepairAttempt`、`beforeUserProgressEvent`、`onRunCompleted`、`onRunFailed`、`onRunCancelled`。
- [ ] 定义默认 profile：`balanced-default`、`fast-answer`、`research-grade`、`debug-repair`、`low-cost`、`privacy-strict`；profile 只返回通用策略，不写单一 prompt、站点或 scenario 特例。
- [ ] 定义 `HarnessDecision` merge 规则：callbacks 可 additive hint、收紧 budget、增加 blocked refs、提升 verification；不得放宽前序 callback 明确禁止的 side effect，除非 profile merge policy 显式允许并写入 trace。
- [ ] 重新定界 conversation policy：Python/TS conversation-policy 只输出 current-turn facts、context isolation、bounded digest、handoff compaction、acceptance/recovery/cache/latency defaults；`intentMode`、execution mode、capability profile、repair executor 和 UI interaction 的最终决策上移到 harness。
- [ ] 将 fresh / continuation / repair / audit / file-grounded / interactive 的探索范围规则迁入 harness：fresh 默认 minimal 探索，continuation/repair/audit 才允许读取相关历史 attempts、task results、stdout/stderr、ledger 和 verification refs。
- [ ] 将 AgentServer generation prompt 中关于 fresh request、历史读取、workspace inspection、当前引用、repair retry 的散落指令迁入 harness contract，由 prompt renderer 统一渲染。
- [ ] 将 UI 初始进度、静默等待提示、后台完成策略和 abort/cancelled 展示策略改为消费 harness `progressPlan`，避免 ChatPanel / stream presentation 各自维护行为文案。
- [ ] 为 UI 增加结构化 interaction contract：`interaction-request`、`clarification-needed`、`human-approval-required`、`guidance-queued`，并用 `cancelPolicy` 区分 `user-cancelled`、`system-aborted`、`timeout`、`backend-error`。
- [ ] 将 UI/transport/backend 三层 silent watchdog 统一到 harness `silencePolicy`：同一 run 只产生一条可审计 retry/abort/visible-status 决策，避免重复等待提示。
- [ ] 将 capability broker 输入扩展为接收 harness `skillHints`、`blockedCapabilities`、`toolBudget` 和 `verificationPolicy`；broker 仍只根据 capability manifest 和 refs 做通用筛选。
- [ ] 将 `packages/skills`、`packages/actions`、`packages/observe`、`packages/verifiers` 与 core runtime capabilities 投影成统一 `CapabilityManifest`，进入同一个 registry/broker 图，避免 package skills 与 AgentServer generation fallback 平行存在。
- [ ] 定义统一 `HarnessCandidate` 和默认候选 callback 链：`ScenarioPolicyCallback`、`ProviderAvailabilityCallback`、`SafetyPolicyCallback`、`BudgetPolicyCallback`、`HistoryPolicyCallback`、`UserIntentOverrideCallback`；用户显式选择能力仍必须过安全/配置/预算 gate。
- [ ] 定义 `CapabilityBudget` contract：`maxWallMs`、`maxContextTokens`、`maxToolCalls`、`maxObserveCalls`、`maxActionSteps`、`maxNetworkCalls`、`maxDownloadBytes`、`maxResultItems`、`maxProviders`、`maxRetries`、`perProviderTimeoutMs`、`costUnits`、`exhaustedPolicy`，并把每次 invocation 的 `budgetDebits` 写入 executionUnit/workEvidence/audit。
- [ ] 将 validation/repair 收敛为唯一 `ValidationDecision -> RepairDecision -> AuditRecord` 链路：schema/artifact/current-ref/WorkEvidence/guidance/verification gate/observe trace 都进入 `ResultValidationHarness`，repair/supplement/fail-closed/needs-human 由 `RepairPolicyHarness` 决定，runner 只执行。
- [ ] 将 `appendTaskAttempt`、Capability Evolution Ledger、verification artifacts、observe invocation records 和 telemetry span 统一接入 `AuditSink` / `TelemetrySink`，禁止 generated-task runner、repair loop、observe runtime 各自手写审计策略。
- [ ] 将 `buildContextEnvelope`、`buildCapabilityBrokerBriefForAgentServer`、`buildAgentServerGenerationPrompt`、`buildAgentServerRepairPrompt` 改为只消费 `HarnessContract` 和 capability/scenario manifest，不继续本地新增行为治理散文。
- [ ] 去除/合并重复 backend selection、fresh/continuity prompt rule、generated-task contract retry、context/rate-limit recovery、stream guard 和 capability routing 分支，统一通过 harness hook 输出结构化决策。
- [ ] 新增通用 `literature.retrieval` composed capability：providers 覆盖 PubMed、Crossref、Semantic Scholar、OpenAlex、arXiv、web search、SCP biomedical search；input 包含 `query/databases/dateRange/maxResults/includeAbstracts/fullTextPolicy`；output 包含 `paper-list/evidence-matrix/research-report/workEvidence`；默认预算包含 `maxProviders=3`、`maxResults=30`、`perProviderTimeoutMs=10000`、`maxFullTextDownloads=3`、`maxDownloadBytes=25MB`。
- [ ] 增加 smoke：fresh request 只读取 compact workspace/scenario/capability brief，不读取旧 attempts/outputPath/config；continuation request 可读取当前 session 相关 refs；repair request 可读取 failed run 相关 stdout/stderr/log refs。
- [ ] 增加 smoke：不同 harness profile 对同一 prompt 输出不同预算和 progress plan，但 runtime request path、capability registry 和 validation loop 不分叉。
- [ ] 增加 no-legacy guard：禁止在 gateway、UI、scenario 或 provider 分支里新增 harness 指令散文、prompt 特例、探索规则或 skill 偏好。

验收标准：

- [ ] Agent 行为治理只有一个真相源：harness package/profile registry；runtime、UI、prompt builder 只消费结构化 contract。
- [ ] fresh/continuation/repair/audit 的探索差异由 harness 决定，并在 stream/ledger 中可审计。
- [ ] 每个失败路径都有同一条 `ValidationDecision -> RepairDecision -> AuditRecord` 记录，可追溯到 contract id、failure kind、related refs、repair budget 和最终 outcome。
- [ ] 新增任务类型或调优策略时只改 harness profile/hook policy 或 capability manifest，不改核心 gateway 主流程。
- [ ] 现有 backend-first、capability-driven、contract-validation repair loop smoke 保持通过。
