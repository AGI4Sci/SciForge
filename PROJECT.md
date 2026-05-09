# SciForge - PROJECT.md

最后更新：2026-05-09

## 关键原则
- 所有修改必须通用、可泛化到任何场景，不能在代码里面硬编码和为当前案例打补丁
- 算法相关的代码优先用Python实现，方便人类用户优化、检查算法
- 代码路径保持唯一真相源：发现冗余链路时删除、合并或降级旧链路，避免长期并行实现。
- 代码膨胀必须自动触发治理：源码文件超过 1000 行进入 watch list；超过 1500 行必须在 PROJECT.md 有模块化拆分任务、语义 part 计划或生成文件豁免；超过 2000 行优先拆分；超过 3000 行视为维护风险。后续开发若让文件越过阈值，应优先抽模块、删除冗余逻辑或补拆分 TODO，而不是继续堆主文件。
- 长文件拆分必须按职责命名，不能机械切成 `part1/part2`；如果暂时不能完全解耦，也要拆成有语义的文件，例如 `*-event-normalizer`、`*-runner`、`*-diagnostics`、`*-state-machine`，并保持主入口只做流程编排。
- `npm run smoke:long-file-budget` 是代码膨胀守门 smoke：超过阈值且未被 PROJECT.md 跟踪的长文件应让验证失败，从而自动触发模块化、去重或任务补录。


## 根本方向

SciForge 的最终形态是 **Backend-first, Contract-enforced, Capability-driven**。完整设计以 [`docs/Architecture.md`](docs/Architecture.md#最终形态backend-first-capability-architecture) 为准；本文件只保留围绕最终形态重构的任务板。

核心定位：

- SciForge 是 downstream scenario adapter，不是第二套 agent。
- Agent backend 负责用户意图理解、多轮指代、能力选择、任务规划、胶水代码生成、artifact 内容读取、失败诊断、继续执行和修复。
- SciForge 负责协议、capability registry、capability broker、workspace refs、执行边界、contract validation、artifact 持久化、view 渲染和机器可读错误回传。
- `src/` 是固定平台逻辑和运行时骨架；`packages/` 是即插即用能力生态。回答“系统怎么运行”的逻辑进 `src/`，回答“系统能做什么”的逻辑进 `packages/`。详见 [`docs/Architecture.md`](docs/Architecture.md#src-与-packages-边界固定平台-vs-插拔能力)。
- Packages 不只是代码复用单元，而是 capability contract 单元；observe、skills、actions、verifiers、views、memory、import/export 都应暴露可声明、可校验、可组合、可替换、可修复的 capability。
- 胶水代码、执行 trace、validation failure、repair attempts 和 composed capability 下钻记录本身是资产；必须沉淀到 Capability Evolution Ledger，用于晋升高频组合、改进 validator、完善 repair hints 和训练 broker。
- 重构时必须删除历史遗留链路，只保留最新唯一逻辑和唯一真相源；不得为了兼容旧实现长期保留并行路径、prompt regex、场景特例、provider 特例或 UI 语义兜底。

## 重构守则

- 每个重构任务都必须先声明新的唯一真相源，再删除旧入口、旧 adapter、旧 fallback 和旧测试夹具。
- 临时兼容层必须有删除任务、删除条件和 smoke guard；没有删除计划的兼容层不允许合入。
- Backend-first 优先级高于 UI 侧聪明化：SciForge 不判断“用户是不是想看报告/上一轮/markdown”，只传 refs、capability brief 和 contract。
- `src/` 可以写死平台秩序，但不能写死 package 领域语义；`packages/` 可以扩展能力，但不能绕过 `src/` 的安全、refs、validation 和 persistence 边界。
- 所有 capability 输出都必须可代码校验；校验失败生成 `ContractValidationFailure` 返回 backend 修复，不在 SciForge 侧改写成成功。
- 高频稳定路径可以固化为 composed capability，但仍必须暴露 manifest、validator、repair hints 和 fallback，下钻后可由 backend 重新组合原子能力。
- 历史任务不再单独维护；如果仍有价值，必须并入下面的最终形态重构任务。

## 倒叙任务板

### T122 src 固定平台 / packages 插拔能力边界收敛

状态：规划中；目标是把最终架构落成清晰代码边界：`src/` 只保留固定平台逻辑和运行时骨架，`packages/` 承载所有可插拔能力、manifest、schema、validator、provider、examples 和 repair hints。这个任务决定“什么可以写死”：平台秩序可以写在 `src/`，能力语义和组合能力必须进入 `packages/`。

设计文档：[`docs/Architecture.md`](docs/Architecture.md#src-与-packages-边界固定平台-vs-插拔能力)。

Todo：

- [x] 建立 `src/` 固定平台清单：app shell、workspace writer、runtime server、transport、stream lifecycle、registry loader、broker shell、validation loop、ref resolver、artifact persistence、permission/safety、ledger writer、boundary smoke。
- [x] 建立 `packages/` 插拔能力清单：observe、skills、actions、verifiers、views、importers/exporters、scenario packages、provider adapters、composed capabilities、mock fixtures。
- [x] `src -> packages` P0：迁移 `src/runtime/computer-use/**` 的 action provider 语义到 `packages/actions/computer-use`；`src` 只保留 gateway config、workspace refs、event emission 和 host bridge adapter。
  进展：`capture.ts` provider/fallback/diagnostic policy 已迁到 `packages/actions/computer-use/provider-policy.ts`；executor/input-channel/window-target taxonomy、scheduler policy、adapter aliases 和 planner issue literals 已迁到 `packages/actions/computer-use/runtime-policy.ts`，`src/runtime/computer-use/**` no-src baseline 清零。
- [ ] `src -> packages` P0：迁移 `src/runtime/vision-sense/**` 中 planner、grounding、focus refinement、semantic verifier feedback、trace policy 到 `packages/observe/vision`；会修改 GUI 的执行部分通过 `packages/actions/computer-use` 暴露。
  进展：refs-only / planner-only evidence completion、action-ledger completion、planner action rewrite 和 dense/no-effect tolerance policy 已迁到 `packages/observe/vision/sciforge_vision_sense/computer_use_policy.py`，并通过 `src/runtime/vision-sense/computer-use-policy-bridge.ts` 作为 runtime bridge 使用；vision-sense runtime/tool/trace/grounding ids、runtime event ids、completion mode、planner domain/task prompt instructions、Computer Use intent prompt policy 和 app-alias prompt line extraction 已迁到 `packages/observe/vision/computer-use-runtime-policy.ts`，trace output view slots 已迁到 `packages/presentation/interactive-views/vision-sense-trace-output-policy.ts`；`computer-use-plan.ts#domain-prompt-regex` baseline 已从 8 降到 1，runtime/action-loop/grounding/trace-output/sense-provider src capability baseline 已清零。
- [x] `src -> packages` P0：删除或迁移 `src/runtime/capability-profiles.ts`，统一到 `packages/scenarios/core/src/runtimeCapabilityProfiles.ts` 或 `packages/contracts/runtime/capabilities.ts`，避免重复 capability profile 真相源。
- [x] `src -> packages` P1：迁移 `src/runtime/runtime-ui-manifest.ts` 中 renderer aliases、domain defaults、artifact-to-component routing、title/layout/encoding inference 到 `packages/presentation/interactive-views`；`src` 只保留 composition adapter。
- [x] `src -> packages` P1：迁移 `src/ui/src/uiModuleRegistry.ts` 中 component manifest alias/index 构造到 `packages/presentation/components` 或 `packages/presentation/interactive-views` public export；UI 只消费 package registry。
- [x] `src -> packages` P1：迁移 `src/ui/src/artifactIntent.ts`、`src/ui/src/app/results/viewPlanResolver.ts` 中 artifact/component/domain ranking 和 prompt/domain regex 到 scenario/view capability policy。
  进展：`artifactIntent.ts` 已降为 `packages/presentation/interactive-views` policy wrapper；`viewPlanResolver.ts` 已删除 artifact type regex ranking、fallback ranking 和 component/domain mapping；binding/status/section/presentation dedupe、artifact/module selection、fallback display intent 和 blocked-design policy 已迁到 `packages/presentation/interactive-views/view-plan-result-policy.ts`，remaining baseline 收敛到 0 个 tracked findings。
- [x] `src -> packages` P1：迁移 `src/runtime/skill-markdown-catalog.ts` 中 SKILL.md catalog、domain/provider scoring 和 output inference 到 `packages/skills` 或 capability broker package。
- [x] `src -> packages` P1：迁移 `src/runtime/skill-registry/runtime-matching.ts` 中 SCP/PubMed/BLAST/UniProt/ChemBL 等技能匹配 scoring/gating 语义到 `packages/skills/matching-policy.ts`；`src` 只保留 runtime filtering/sorting adapter。
- [x] `src -> packages` P1：迁移 `src/runtime/skill-registry/{availability-validation,fallback,runtime-matching}.ts` 中 entrypoint/output/fallback runtime skill semantics 到 `packages/skills/runtime-policy.ts` 和 `packages/skills/matching-policy.ts`；`src` 只保留 filesystem probe adapter 和排序/filter。
- [x] `src -> packages` P1：迁移 `src/runtime/gateway/work-evidence-types.ts`、`backend-tool-work-evidence-adapter.ts`、`work-evidence-guard.ts`、`verification-results.ts` 中可复用 WorkEvidence contract、provider event normalization 和 verifier rules 到 `packages/contracts/runtime`、`packages/support/work-evidence` 或 `packages/verifiers`；gateway 只保留调用和 fail-closed enforcement。
  进展：`WorkEvidence` contract/parser/handoff summary、backend tool event adapter、WorkEvidence guard policy 和 verification result contract 已迁到 `packages/contracts/runtime/work-evidence*.ts`、`work-evidence-policy.ts`、`verification-result.ts`；`src/runtime/gateway/work-evidence-types.ts` 只保留 stable package re-export，旧 `backend-tool-work-evidence-adapter.ts` 已删除，`work-evidence-guard.ts`/`verification-results.ts` 只保留 fail-closed adapter。
- [x] `src -> packages` P1：迁移 `src/runtime/gateway/artifact-reference-context.ts` 中 skillDomain -> artifact type scope matching 到 `packages/contracts/runtime/artifact-reference-policy.ts`，gateway 只调用 package policy。
- [x] `src -> packages` P1：迁移 `src/runtime/gateway/direct-answer-payload.ts` 和 `src/ui/src/app/chat/runOrchestrator.ts` 中 report/summary intent、existing-artifact follow-up、report artifact、standalone artifact component binding 和 UI manifest fallback 到 `packages/presentation/interactive-views/direct-answer-result-policy.ts`。
- [x] `src -> packages` P1：迁移 `src/ui/src/api/{runtimeConfig,sciforgeToolsClient,scopeCheck}.ts` 和 `src/ui/src/app/ChatPanel.tsx` 中 scenario/domain/scope routing semantics 到 `packages/scenarios/core/src/scenarioRoutingPolicy.ts`；UI 只消费 package-owned routing policy。
- [x] `src -> packages` P2：拆分 `src/runtime/gateway/verification-policy.ts`，policy/result contract 和 verifier semantics 进入 `packages/contracts/runtime/verification-policy.ts`，workspace 写入和 runtime gating 留在 `src` adapter。
- [x] `src -> packages` P2：评估 `src/runtime/conversation-policy/contracts.ts`，纯 TS/Python contract 已迁入 `packages/contracts/runtime/conversation-policy.ts`；`python-bridge.ts`、`apply.ts` 继续留在 `src`，旧 `contracts.ts` 已删除。
- [ ] `packages -> src` P0：继续收敛 `packages/reasoning/conversation-policy/src/sciforge_conversation/service.py` 剩余 turn composition ownership；当前已删除 direct reference digest import 和 workspace-ref audit 语义，`acceptancePlan` / `userVisiblePlan` / `processStage` / `auditTrace` / `metadata` 组合已迁到 `src/runtime/gateway/conversation-service-plan.ts`，`smoke:fixed-platform-boundary` 已清零。
- [x] `packages -> src` P0：迁移 `acceptance.py` output acceptance gate 到 `src/runtime/gateway/conversation-acceptance-policy.ts`，Python 侧只保留兼容 bridge。
- [x] `packages -> src` P0：迁移 `execution_classifier.py` execution mode / risk / stage hint lifecycle 到 `src/runtime/gateway/conversation-execution-classifier.ts`，Python 侧只保留兼容 bridge 和 dataclass API。
- [x] `packages -> src` P0：迁移 `context_policy.py` context reuse / isolation / repair scope lifecycle 到 `src/runtime/gateway/conversation-context-policy.ts`，Python 侧只保留兼容 bridge。
- [x] `packages -> src` P0：迁移 `memory.py` bounded current-context memory planning 到 `src/runtime/gateway/conversation-memory-policy.ts`，Python 侧只保留兼容 bridge。
- [x] `packages -> src` P0：迁移 `recovery.py` failure recovery / retry budget / digest recovery lifecycle 到 `src/runtime/gateway/conversation-recovery-policy.ts`，Python 侧只保留兼容 bridge。
- [x] `packages -> src` P0：迁移 `cache_policy.py` artifact reuse lifecycle 到 `src/runtime/gateway/conversation-cache-policy.ts`，Python 侧只保留兼容 bridge。
- [x] `packages -> src` P0：迁移 `latency_policy.py` turn latency lifecycle 到 `src/runtime/gateway/conversation-latency-policy.ts`，Python 侧只保留兼容 bridge。
- [x] `packages -> src` P0：迁移 `response_plan.py` response/background completion lifecycle 到 `src/runtime/gateway/conversation-response-plan.ts`，Python 侧只保留兼容 bridge。
- [x] `packages -> src` P0：迁移 `packages/reasoning/conversation-policy/src/sciforge_conversation/capability_broker.py` 的 broker shell/main flow 到 `src/runtime/capability-broker`；Python 侧只保留兼容 brief envelope bridge，packages 只提供 manifests 和 schemas。
- [x] `packages -> src` P0：迁移 `handoff_planner.py` 到 `src/runtime/gateway/conversation-handoff-planner.ts`，因为它处理 handoff budget、safe file IO、workspace refs 和 artifact persistence lifecycle；Python 侧只保留兼容 bridge。
- [x] `packages -> src` P0：迁移 `reference_digest.py` 的 meaningful lifecycle 到 `src/runtime/gateway/conversation-reference-digest.ts`，Python 侧只保留兼容 bridge。
- [x] `packages -> src` P0：迁移 `artifact_index.py` 的 clickable refs、workspace path metadata、hash/size、execution refs、digest refs、pathRefs 摘要和 dedupe 到 `src/runtime/gateway/conversation-artifact-index.ts`，Python 侧只保留兼容 bridge。
- [x] `packages -> src` P1：迁移 `process_events.py` 的 stream/process event normalization 到 `src/runtime/gateway/workspace-event-normalizer.ts`，删除 Python 侧重复路径。
- [x] `packages -> src` P1：重新定界 `packages/support/object-references/index.ts` 为 package-owned reference policy：session lookup、action availability、composer marker allocation、synthetic artifact creation 和 chip ordering 保留在 package helper 中，UI 只调用 package API，避免把 artifact/path/domain mapping 搬回 thin shell。
- [x] `packages -> src` P1：拆分 `packages/support/artifact-preview/index.ts`，preview hydration、inline policy、default preview actions、file-kind inference 进入 `src/runtime/server/file-preview.ts` 和 UI results；`PreviewDescriptor` contract 留在 `packages/contracts/runtime`。
- [x] `packages -> src/tests` P1：迁移 `packages/scenarios/core/src/runtimeSmoke.ts` 到 `tests/smoke/scenario-runtime-smoke-harness.ts`；scenario package 只保留 policy/schema validation。
- [ ] `packages -> src/delete` P1：拆分 `packages/scenarios/core/src/componentElements.ts`，runtime recover actions、fallback components、compat aliases 不应作为 scenario policy；短期可迁入 `src/runtime/runtime-ui-manifest.ts` / UI compiler，长期由 registry-driven UI manifest 取代并删除。
  进展：`componentElements.ts` 已改为从 `packages/presentation/components` 的 `uiComponentRuntimeRegistry` 适配组件元素，删除 scenario-owned built-in/compat alias catalog 和 run-skill/repair-task/fallback-component recover action vocabulary；scenario core 只保留 contract-facing component element shape。
- [ ] `packages -> src` P2：评估 `packages/scenarios/core/src/uiPlanCompiler.ts`、`validationGate.ts`、`scenarioPackage.ts` 中 platform-wide compile/validation 行为；scenario specs、contracts、elementTypes 留在 package，运行期编译/校验进入 `src/runtime/scenario-policy` 或 UI compiler。进展：UI slot / fallback component validation 已从 `validationGate.ts` 收敛到 `uiPlanCompiler.ts`，package gate 只组合 artifact/skill/tool/failure-policy 校验和 UI compiler 结果。
- [x] 明确保留在 `src`：`src/runtime/workspace-server.ts`、`src/runtime/server/**`、`generation-gateway.ts`、`workspace-runtime-gateway.ts`、`workspace-task-runner.ts`、`task-projects.ts`、gateway adapter/orchestration 文件、`src/ui/src/app/**` React app shell。
- [x] 明确保留在 `packages`：`packages/presentation/components/**`、`packages/presentation/interactive-views/**`、`packages/presentation/design-system/**`、`packages/skills/**`、`packages/actions/computer-use/**`、`packages/observe/vision/**`、`packages/verifiers/**`、`packages/contracts/runtime/**`、`packages/scenarios/core/src/{scenarioSpecs,contracts,elementTypes}.ts`。
- [x] 增加 `smoke:fixed-platform-boundary`，实现为 `tools/check-fixed-platform-boundary.ts` 或扩展 `tools/check-module-boundaries.ts`，检查 `src` 固定平台与 `packages` 插拔能力边界。
- [x] 增加 `smoke:no-src-capability-semantics`，扫描 `src/**` 是否硬编码 package-owned artifact ids、component ids、provider ids、scenario ids、domain regex；临时 allowlist 必须关联本任务迁移项。
- [x] 将 `smoke:no-src-capability-semantics` 种子设为当前发现：`src/runtime/runtime-ui-manifest.ts` 的 prompt regex/domain defaults/component-to-artifact mapping；`src/runtime/gateway/artifact-reference-context.ts` 的 `paper-list`/`research-report`/skillDomain regex；`src/ui/src/app/chat/runOrchestrator.ts` 的 follow-up intent regex 和 `research-report -> report-viewer`；`src/ui/src/app/results/viewPlanResolver.ts` 的 artifact display intent、domain regex ranking 和 primary result ranking。
- [x] 增加 `smoke:capability-manifest-registry`，要求 package-owned capabilities 从 manifest/catalog 发现，而不是只在 `src` 中硬编码。
- [x] 增加 `smoke:workspace-package-metadata`，扩展当前 package metadata 检查到嵌套 package，覆盖现有多个 `package.json`。
- [x] 增加 `smoke:package-runtime-boundary`，禁止 package manifests 声称或实现 persistence、global safety、stream lifecycle、workspace ref resolution 等 runtime lifecycle ownership。
- [x] 更新 `tools/check-module-boundaries.ts`、`tools/check-package-catalog.ts`、`scripts/check-ui-components-package-boundaries.ts`、`package.json`、`docs/Extending.md`、`packages/README.md`，把上述 smoke 纳入验证。
  说明：`smoke:module-boundaries` 只守 import topology；`packages:check` 聚合 package catalog/metadata/runtime ownership/UI component publication checks；`smoke:fixed-platform-boundary` 和 `smoke:no-src-capability-semantics` 继续独立守 T122 `src`/`packages` ownership 与 `src` 语义基线，避免与 package checks 重复。
- [x] 针对 boundary-heavy 长文件补拆分计划或降低阈值：`src/runtime/generation-gateway.ts`、`src/runtime/workspace-server.ts`、`src/ui/src/app/ResultsRenderer.tsx`、`src/ui/src/app/ChatPanel.tsx`、`src/runtime/workspace-task-input.ts`、`src/runtime/gateway/agentserver-prompts.ts`。
  进展：`agentserver-prompts.ts` 中 ToolPayload protocol、current refs、bibliographic verification、artifact selection、capability routing、execution mode、generated task、fresh retrieval、repair 和 external I/O reliability prompt snippets 已迁到 `packages/contracts/runtime/artifact-policy.ts`、`packages/contracts/runtime/capabilities.ts`、`packages/presentation/interactive-views/runtime-ui-manifest-policy.ts` 和 `packages/skills/runtime-policy.ts`，gateway prompt builder 只负责拼装；no-src baseline 已清零。
- [x] 更新 `docs/Extending.md` 和 `packages/README.md`：新增模块应先判断属于平台秩序还是能力语义，再选择 `src/` 或 `packages/`。
- [ ] 删除与该边界冲突的旧 registry、旧 adapter 和旧 direct import。

进度备注：`smoke:fixed-platform-boundary` 当前剩余 0 个 tracked warnings；`smoke:no-src-capability-semantics` 当前收敛到 492 个 tracked findings，无新增；`smoke:no-legacy-paths` 当前收敛到 27 个 tracked findings，无新增。

验收标准：

- [ ] `src/` 中只剩平台骨架和通用运行时逻辑；没有 domain/package-specific capability semantics。
- [ ] `packages/` 中每个核心能力都有 manifest、schema、validator、provider 和 repair hints。
- [ ] 高频稳定路径若是平台秩序，固定在 `src/`；若是能力组合，注册为 `packages/` composed capability。
- [ ] boundary smoke 能阻止新增反向依赖、隐藏能力分支和绕过 runtime safety/validation 的 package 实现。

### T121 Capability Evolution Ledger：把胶水代码成功/失败轨迹变成资产

状态：规划中；目标是记录 backend 动态组合能力时产生的胶水代码、执行 trace、validation result、失败原因和修复轨迹，让成功路径可晋升为 composed capability，让失败路径反哺 validator、fallback policy、repair hints 和 broker。Ledger 不作为每轮大上下文直接喂给 backend；只通过 refs、digests、briefs 和 broker 摘要分层暴露。

设计文档：[`docs/Architecture.md`](docs/Architecture.md#composed-capability-fallback-and-evolution-ledger)。

Todo：

- [x] 定义 `CapabilityEvolutionRecord` contract：goal summary、selected capabilities、providers、input/output schema refs、glue code ref、executionUnit refs、artifact refs、validation result、failureCode、recoverActions、repair attempts、final status、latency/cost summary、promotion candidate。
- [x] 定义 composed capability fallback policy contract：`atomicCapabilities`、`fallbackToAtomicWhen`、`doNotFallbackWhen`、`retryBudget`、`fallbackContext`。
- [x] 将 composed capability result 标准化为 `status`、`failureCode`、`fallbackable`、`confidence`、`coverage`、`recoverActions`、`atomicTrace`、related refs。
- [x] generated task validation/repair 真实路径 best-effort 写入 Capability Evolution Ledger，并只返回 `ledgerRef`、`recordRef` 和 compact summary。
- [ ] 在 backend 动态写胶水代码、composed capability 执行、fallback 到原子能力等更完整路径写入 ledger record。
- [x] 建立 promotion proposal 规则：高频成功组合可提议晋升为 composed capability；高频失败模式可提议更新 validator、fallbackPolicy 或 repair hints。
- [ ] broker 只消费 ledger 的 compact summary，不直接展开完整胶水代码和日志；需要复用/修复时再按 ref 展开。
- [x] 增加 smoke：generated task schema invalid / repair completion 后 ledger 记录原失败、下钻路径和最终 artifact refs，compact summary 不展开胶水代码。
- [x] 增加 smoke：composed capability schema invalid 后 fallback 到 atomic capabilities，并记录 fallback 决策与 atomic trace。
- [ ] 删除任何散落的“成功胶水代码缓存”或“失败样例记录”临时实现，统一归入 ledger。

验收标准：

- [ ] 每次动态 glue code 或 composed capability fallback 都有 ledger record，可追溯到 run、execution units、artifacts 和 validation failures。
- [ ] fallback 是否发生由 validator/failureCode/fallbackPolicy/retryBudget 决定，不由 UI 或 LLM 自由猜测。
- [ ] ledger 能生成 promotion candidates 和 repair-hint improvement candidates。
- [ ] broker 默认只读取 ledger brief/digest，不造成每轮 token 暴涨。

### T120 Final Cutover：删除遗留链路并锁定唯一真相源

状态：规划中；目标是在最终形态完成后做全项目 cutover，删除所有历史并行实现，只保留 capability-first / backend-first 的唯一逻辑。

设计文档：[`docs/Architecture.md`](docs/Architecture.md#最终形态backend-first-capability-architecture)。

Todo：

- [x] 列出所有旧链路：UI prompt regex、场景 id 分支、provider 特例、旧 payload normalizer、旧 fallback、旧 preview resolver、旧 task adapter、旧 compatibility re-export。
- [x] 为每条旧链路标注新的唯一真相源：capability manifest、broker、resolver、validator、runtime executor 或 backend tool。
- [ ] 删除旧链路和对应测试夹具；只保留验证新路径的 tests/smoke。
- [x] 删除 12 个 `src/ui/src/scenarioCompiler/*` package facade re-export 文件，并将 UI/smoke/test 调用方改为直接导入 `@sciforge/scenario-core/*` 稳定入口。
- [x] 删除最终 `src/ui/src/scenarioSpecs.ts` package facade，并将调用方改为直接导入 `@sciforge/scenario-core/scenario-specs` 稳定入口。
- [x] 增加 `no-legacy-paths` smoke，禁止重新引入 UI 语义兜底、provider/scenario/prompt 特例和重复 source of truth。
- [x] 更新 docs/Architecture、docs/Extending、packages/README，删除旧架构描述。

验收标准：

- [ ] 全项目只有一条 backend-first request path 和一套 capability registry/broker/validation loop。
- [ ] 搜索不到已列入删除清单的 legacy symbols、旧 adapter、旧 fallback 和旧特例分支。
- [ ] `npm run typecheck`、runtime contract smoke、package boundary smoke、frontend rendering tests 和多轮 fixtures 全部通过。

### T119 UI Thin Shell：UI 只做展示、引用和安全边界

状态：规划中；目标是把 UI 从语义路由层降级为 thin shell。UI 只负责 session 可视化、object refs、artifact views、execution units、validation errors、recover actions 和用户交互安全边界。

设计文档：[`docs/Architecture.md`](docs/Architecture.md#角色边界)。

Todo：

- [ ] 删除 UI 侧自然语言意图判断、报告/markdown/上一轮结果等语义 fallback。
- [ ] UI 只从 backend response、workspace refs、UIManifest 和 capability result projection 渲染结果。
- [ ] 将“backend 不可达/stream 断开/validation failed”统一显示为诊断和 recover actions，不合成最终答案。
- [ ] 结果面板只依赖稳定 object refs；不直接依赖临时 `agentserver://` preview。
- [ ] 增加 UI smoke，断言 report 追问、artifact 追问、失败修复都由 backend/capability path 产生结果。

验收标准：

- [ ] UI 不含 prompt regex、scenario id 分支或 artifact type 特例来决定用户语义。
- [x] UI 能完整展示 `ContractValidationFailure`、recoverActions、related refs 和 backend repair state。
- [ ] 删除旧 UI fallback 后，多轮 report/artifact/repair fixtures 仍通过。

### T118 Backend-first Artifact and Run Tools

状态：规划中；目标是让 backend 通用读取、解析、渲染和继续 workspace 事实，解决多轮对话依赖 SciForge 猜测的问题。

设计文档：[`docs/Architecture.md`](docs/Architecture.md#backend-first-多轮-artifact-使用)。

Todo：

- [x] 定义并暴露 backend 工具 contract：`list_session_artifacts`、`resolve_object_reference`、`read_artifact`、`render_artifact`、`resume_run`。
- [x] 支持 workspace refs、artifact refs、executionUnit refs、run refs、file refs 和 `agentserver://` refs 的统一解析。
  说明：`agentserver://` 只在已 materialize 为稳定 artifact/file ref 时可读；未 materialize 的临时 URI 会返回 blocked，要求先转为稳定 refs。
- [x] 收敛 workspace file ref 解析到 `src/runtime/workspace-paths.ts` helper，并让 task attempts 复用该 helper 读取 outputRef 摘要；覆盖 `file:`、`.sciforge/*`、managed shorthand 和 workspace 越界拒绝。
- [x] run completed 前将 backend 输出 materialize 到 `.sciforge/task-results/*.json|md` 并返回稳定 object refs。
- [x] backend completed contract 禁止 “I will retrieve...” 这类计划句伪装完成；必须交付文本、artifact 或稳定 ref。
- [x] 建立三条最小多轮 fixtures：生成 report 后要 markdown、基于刚才 artifact 继续处理、按 failed run 原因修复。

验收标准：

- [ ] “给我 markdown 格式报告”由 backend 读取已有 artifact 后返回真实 Markdown 或稳定 report ref。
- [ ] “重新检索/再跑/最新”不会误用旧 artifact；backend 自主决定复用、扩展或重跑。
- [ ] `agentserver://` 输出不再成为 UI 预览稳定性的唯一依赖。

### T117 ContractValidationFailure and Repair Loop

状态：规划中；目标是把所有 schema、ref、artifact、UIManifest、WorkEvidence 和 verifier 错误统一为机器可读 validation failure，交回 backend 修复。

设计文档：[`docs/Architecture.md`](docs/Architecture.md#validation-and-repair-loop)。

Todo：

- [x] 定义 `ContractValidationFailure` contract：schema path、contract id、capability id、expected/actual、missing fields、invalid refs、unresolved URI、failureReason、recoverActions、nextStep、related refs。
- [x] 收窄 handoff payload contract：为 `failureRecoveryPolicy`、`referencePolicy`、`artifactPolicy`、verification snapshots 和 attempt refs 定义窄类型/guards，同时保持 loose transport record 兼容。
- [x] 将 payload schema、artifact schema、UIManifest schema 和 current-turn ref validation failure 映射到 `ContractValidationFailure`。
- [x] 将 WorkEvidence guard 和 verifier failure 映射到 `ContractValidationFailure`。
- [x] repair prompt/handoff 只消费结构化 failure，不读取散乱错误文本。
- [ ] 删除旧的分散 repair-needed/failed-with-reason 组装逻辑，保留统一 validation-to-repair 管线。
- [x] `repair-policy` handoff 统一携带 `validationFailure` 或结构化 `backendFailure`，不再把 loose `reason` 作为 repair 主入口。
- [x] 增加 fixtures：schema 缺字段、invalid ref、artifact 空结果、verifier fail、stdout/stderr 指向修复。

验收标准：

- [ ] 任一 contract 错误都能被统一序列化并带回 backend。
- [ ] backend 修复后同一 run/attempt history 可继续，而不是开新失败链路。
- [ ] 没有旧 validation error 文案分支继续作为业务逻辑入口。

### T116 Capability Broker and Layered Meta Exposure

状态：规划中；目标是让 backend 每轮只消费相关、紧凑的 capability brief；调用或修复时再按需展开 contract、examples、repair hints 和日志 refs。

设计文档：[`docs/Architecture.md`](docs/Architecture.md#meta-暴露与热路径固化)。

Todo：

- [x] 建立 capability broker 输入：prompt、object refs、artifact index、failure history、scenario policy、runtime policy、available providers。
- [x] broker 输出 compact capability brief 列表，默认不展开 full schema。
- [x] 定义 expansion API：`brief -> contract summary -> full schema/examples/repair hints`。
- [x] 将 backend request payload 改为消费 broker 输出，而不是散落的 skills/views/tools 列表。
- [ ] 删除旧 capability 拼接逻辑和重复 prompt context builder。

验收标准：

- [x] backend 默认只看到相关能力 brief，而不是全量协议。
- [ ] 选择能力后可按需展开 schema；失败修复时可展开 repair hints 和日志 refs。
- [ ] 旧的多处 capability list 构造逻辑被删除或合并到 broker。

### T115 Unified CapabilityManifest Registry

状态：规划中；目标是建立所有 packages/modules 的统一 capability manifest，使每个模块都可声明、校验、组合、替换和修复。

设计文档：[`docs/Architecture.md`](docs/Architecture.md#一切模块都是-capability)。

Todo：

- [x] 定义 `CapabilityManifest` contract：name、version、owner package、brief、routing tags、inputSchema、outputSchema、sideEffects、safety、examples、validator、repairHints、providers、lifecycle metadata。
- [ ] 梳理现有模块并分类：observe、skills、actions、verifiers、views、memory/context、importers/exporters、runtime adapters。
- [x] 为首批核心能力补 manifest：artifact resolver/read/render、workspace read/write、run command、Python task、vision observe、computer-use action、report viewer、evidence matrix、schema verifier。
- [x] 建立 registry loader 和 package boundary smoke，禁止核心能力无 manifest 暴露。
- [ ] 删除旧 registry、旧 skill list、旧 view registry 中与 manifest 重复的真相源。

验收标准：

- [x] 至少 8 个核心能力拥有 manifest，并能由 registry 统一加载。
- [x] 同一 capability 可声明多个 provider，但 contract 保持唯一。
- [x] package boundary smoke 能阻止无 contract 的核心能力扩散。

### T114 Scenario Packages as Policy Only

状态：规划中；目标是把 scenario package 收敛为领域 policy 和能力选择约束，不再承载执行逻辑、多轮判断或 prompt 特例。

设计文档：[`docs/Architecture.md`](docs/Architecture.md#角色边界)。

Todo：

- [x] 定义 scenario package 允许字段：artifact schemas、default views、allowed/required capabilities、domain vocabulary、verifier policy、privacy/safety boundaries。
- [ ] 删除 scenario 中的执行逻辑、prompt 特例、多轮语义判断和 provider 分支。
- [ ] scenario 只影响 capability broker 的筛选和 policy，不直接决定 backend 回答。
- [x] 增加 scenario package smoke，禁止新增执行代码或 prompt regex。

验收标准：

- [x] 所有 scenario package 都能被解释为 capability policy。
- [ ] backend 使用 scenario policy 选择能力，但任务理解和执行仍走通用 backend/capability path。
- [ ] 旧 scenario-specific execution path 被删除。

### T113 Immediate Stabilization Without New Architecture Debt

状态：规划中；目标是在开始大重构前，用最少改动稳定服务，同时不新增长期债务。

Todo：

- [ ] 暂停新增 UI 语义 fallback、prompt regex、provider/scenario 特例。
- [ ] 所有新修复必须记录未来唯一真相源和删除旧路径的后续任务。
- [ ] 对现有多轮 report/artifact/repair 问题，只允许通过 backend tools、stable refs、validation repair loop 或诊断提示推进。
- [ ] 新增 smoke 优先覆盖最终形态关键路径，而不是给旧路径补测试。

验收标准：

- [ ] 稳定化补丁不会扩大旧架构面积。
- [ ] 新增代码都能归入 T115-T120 的最终形态任务。
- [ ] 没有新的临时兼容层缺少删除计划。
