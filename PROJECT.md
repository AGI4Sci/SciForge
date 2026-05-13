# SciForge - PROJECT.md

最后更新：2026-05-14

## 当前目标

按照设计文档[`docs/Architecture.md`](docs/Architecture.md)中的最终形态去实现SciForge, 旧版本实现、旧逻辑不需要兼容，建议删除后重写，确保代码逻辑干净

## 重要
同时开启多个sub agents，并行使用computer use能力从网页端并调试、修复，实现所有的任务，并行度越高越好。完成milestone后更新PROJECT.md、同步到github，直到完成为止。然后继续同时开启多个sub agents并行工作，实现所有的任务，并行度越高越好，在一个阶段完成后，你可以删掉没用的sub agents，重启新的sub agents，持续不间断地并行实现目标。步伐越大越好，尽快实现目标。

当你觉得任务已经完成，或者觉得余下任务没必要做、不合理的时候，可以停下。不合理的任务你可以把它改得合理；你也可以加上新的任务。



## 开工前必读
任何 agent 在执行本项目任务前，必须先读本文件和与任务相关的设计文档，避免凭局部代码印象破坏系统边界。

- [`docs/Architecture.md`](docs/Architecture.md)：SciForge 总体架构、Backend-first / Contract-enforced / Capability-driven / Harness-governed 方向、`src` 与 `packages` 边界。
- [`docs/AgentHarnessStandard.md`](docs/AgentHarnessStandard.md)：harness runtime、profile、stage hook、contract、trace、merge 规则和行为治理入口。

## 不变原则

- 所有修改必须通用、可泛化到任何场景，不能在代码里面硬编码和为当前案例打补丁
- Agent harness 是项目级策略资产，不允许散落在 UI、gateway、prompt builder、conversation policy 或 repair 分支里；探索预算、上下文选择、skill hints、tool-use policy、验证强度和用户可见进度必须通过可版本化 harness policy 与阶段 hook 注入。
- Agent 行为治理的唯一入口是 packages/agent-harness profile registry 与声明式 stage hook；新增治理入口必须先进入 harness contract/trace，再由 gateway、prompt、UI、repair loop 消费，不能以 TODO 名义保留第二套散落规则。
- 算法相关的代码优先用Python实现，方便人类用户优化、检查算法
- 代码路径保持唯一真相源：发现冗余链路时删除、合并或降级旧链路，避免长期并行实现。
- 不需要考虑旧兼容性，可以直接删除旧逻辑代码重写，保持代码链条绝对干净
- 代码膨胀必须自动触发治理：源码文件超过 1000 行进入 watch list；超过 2000 行优先拆分；超过 3000 行视为维护风险。后续开发若让文件越过阈值，应优先抽模块、删除冗余逻辑或补拆分 TODO，而不是继续堆主文件。
- 长文件拆分必须按职责命名，不能机械切成 part1/part2；如果暂时不能完全解耦，也要拆成有语义的文件，例如 *-event-normalizer、*-runner、*-diagnostics、*-state-machine，并保持主入口只做流程编排。
- 推进项目的时候尽可能多开sub agents，并行加速推进
- Prompt builder 不是策略真相源；策略必须来自 harness contract、capability manifest 或可信 runtime policy。
- Safety policy 继续 fail closed；latency、验证、上下文和 repair 深度必须可按层级收缩。
- 复杂任务要可审计，但审计路径不能阻塞用户看到第一份可读结果。
- 任何长任务都必须产出 structured partial/failure，而不是等总超时后只显示 runtime trace。
- 不用“无限追加上下文”换取正确性；多轮稳定性必须依赖 state digest、refs、cache、checkpoint 和按需展开。

## 任务板

### 2026-05-14 Milestone：设计文档最终形态正文化

本轮按最新实现状态更新 `docs/Architecture.md`，目标是让设计文档正文直接表达 Conversation Kernel v2 的最终形态，而不是把最终形态留在尾部建议或实现清单里。

- [x] 将 `docs/Architecture.md` 的“当前最终形态”更新为 **Backend-first, Capability-driven, Harness-governed, Event-sourced**，以 `Event -> State -> Contract -> Decision -> Projection` 作为核心心智模型。
- [x] 把 `ConversationEventLog`、`ConversationStateMachine`、contract gates、`HarnessDecisionRecorded`、`HarnessContract`、`ConversationProjection`、UI projection shell 和 audit export 写入正文架构链路。
- [x] 删除尾部重复的“最终形态修改建议”，避免设计文档同时存在旧最终形态与新建议。
- [x] 精简冗余代码说明：删除关键代码清单、验收命令清单和 Workspace Writer 端点枚举，保留架构职责、边界和运行观察项。

本轮验证：

- [x] `rg` 扫描 `docs/Architecture.md`，确认不再出现 `最终形态修改建议`、`Backend-first Capability Architecture`、`关键代码` 或 `验收命令`。
- [x] 文档 diff 人工复核，确认 final-shape big idea 已进入正文且没有改动 runtime 代码。

### 2026-05-13 Milestone：Conversation Kernel v2 最小切片与 Harness 薄腰

本轮按最终形态继续推进 **Backend maximal reasoning, SciForge minimal orchestration**，并使用多个 sub agents 并行实现 runtime kernel、agent-harness 薄腰、网页端验证和 smoke 验收。

- [x] 新增 `src/runtime/conversation-kernel/` 最小 runtime：append-only event log、InlineEvent/RefEvent 边界、状态机 replay、ConversationProjection、failure owner 分类、verification gate 和 background continuation contract。
- [x] 新增 `packages/agent-harness` 薄腰代数：`ContractFn`、`HookFn`、`ContractResult`、`HookDecision`、failure-owner route、确定性 merge、trace digest 和 profile fixture helper。
- [x] 新增 thin-waist smoke，防止 conversation kernel / harness contract 层回流领域 enum、大 inline payload 或 package-owned UI/component 语义。
- [x] 修复 workspace generated task 的裸 `input.json` / `output.json` argv：这些常见占位符会映射到 session-scoped input/output refs，避免任务把输出写到 workspace 根目录。
- [x] 修复网页端显式文本引用 handoff：`ui-text:` 引用会保留 bounded selected text / composer marker，其它大 payload 仍走 digest，确保 backend 能解析 prompt 中的引用标记。
- [x] 使用 Computer Use 打开 `http://127.0.0.1:5173/` 验证网页端：主界面无白屏，工作区、场景工作台、失败 run、结果区、可复现 ExecutionUnit 和恢复诊断均可见。

本轮验证：

- [x] `node --import tsx --test src/runtime/conversation-kernel.test.ts`
- [x] `node --import tsx --test packages/agent-harness/src/*.test.ts`
- [x] `node --import tsx --test src/runtime/workspace-task-runner.test.ts`
- [x] `node --import tsx --test src/ui/src/api/sciforgeToolsClient.policy.test.ts src/ui/src/app/chat/composerReferences.test.ts`
- [x] `npx tsx tests/smoke/smoke-conversation-kernel-thin-waist.ts`
- [x] `npm run smoke:browser`
- [x] `npm run smoke:agent-harness-contract`
- [x] `npm run smoke:contract-driven-handoff`
- [x] `npm run smoke:no-scattered-harness-policy`
- [x] `npm run typecheck`
- [x] `npm run smoke:no-src-capability-semantics`
- [x] `npm run smoke:long-file-budget`
- [x] `npm run build`

### 2026-05-13 Milestone：ConversationProjection 接管失败边界与 UI 主状态

本轮继续推进 **Conversation Kernel v2 final shape**，把 failure-owner、task outcome、result presentation、task attempt history 和网页端主状态往同一个 `ConversationProjection` 薄投影收敛。并行工作由多个 sub agents 分别覆盖 runtime gateway、contract/history、UI bridge 和 final-shape smoke，最后在主线程集成验证。

- [x] `TaskRunCard` / `ResultPresentationContract` 携带 `conversationProjectionRef` 与 compact `conversationProjectionSummary`，task attempt history 会从 output payload / display intent 中派生 kernel summary。
- [x] Gateway task outcome 通过 kernel projection 映射 `failureOwner`、`recoverActions`、`verificationState` 与 `backgroundState`，避免 failed run 再由 UI/raw response 二次猜测状态。
- [x] 外部 provider / rate limit / timeout / remote closed / 5xx 类失败前移到 kernel failure classifier，生成 `external-blocked`，保留 partial evidence refs，不再优先进入 generated task code repair loop。
- [x] Result renderer、workspace recover focus 和 archive drawer 优先消费 `displayIntent` / result presentation 中的 `ConversationProjection`，projection 满足时覆盖 legacy raw run status。
- [x] Workspace project-record timeline 在不放松主结果区 ownership 边界的前提下，恢复单 run、显式 object refs、package refs 和 failed payload 中的 artifact / execution unit 审计引用。
- [x] 新增 `smoke-conversation-kernel-final-shape`，覆盖 external-provider 不触发 code repair、event-log replay projection 确定性、UI projection bridge 字段映射。
- [x] 使用 Computer Use 在 Edge 打开网页端，确认工作台、失败 run、结果区、refs、可恢复动作和 execution unit 审计信息真实可见。

本轮验证：

- [x] `npm run typecheck`
- [x] `node --import tsx --test src/runtime/task-attempt-history.test.ts src/ui/src/app/appShell/workspaceState.test.ts src/ui/src/app/chat/ArchiveDrawer.test.tsx`
- [x] `node --import tsx --test src/ui/src/app/results-renderer-execution-model.test.ts src/runtime/gateway/result-presentation-contract.test.ts src/runtime/gateway/transient-external-failure.test.ts src/runtime/gateway/generated-task-runner-output-lifecycle.test.ts`
- [x] `node --import tsx --test src/runtime/conversation-kernel.test.ts packages/contracts/runtime/task-run-card.test.ts packages/agent-harness/src/*.test.ts`
- [x] `npx tsx tests/smoke/smoke-conversation-kernel-final-shape.ts`
- [x] `npx tsx tests/smoke/smoke-conversation-kernel-thin-waist.ts`
- [x] `npm run smoke:no-src-capability-semantics`
- [x] `npm run smoke:result-presentation-contract`
- [x] `npm run smoke:runtime-contracts`
- [x] `npm run smoke:browser`
- [x] `npm run smoke:long-file-budget`
- [x] `npm run build`
- [x] `git diff --check`

下一步 final-shape 收敛任务：

- [x] 新会话 gateway outcome 写入可 replay 的 `ConversationEventLog`，让 task outcome / result presentation 可从 event log restore projection，而不是信任临时 projection。
- [x] 将 raw run / executionUnits 在主 workbench 与聊天执行过程里继续降级：有 `ConversationProjection` 时主状态、verification tag、execution process、archive badge 都优先 projection，raw 只作为 audit fallback。
- [x] 将 background continuation 与 verification gate 收紧为记录事件契约：`BackgroundRunning` / `BackgroundCompleted` 必须有 checkpoint refs、revision plan 和 foreground partial；`VerificationRecorded` 必须有 verifier evidence ref。
- [ ] 拆分 watch list 长文件，尤其是 `src/runtime/generation-gateway.ts`、`src/runtime/gateway/context-envelope.ts`、`src/ui/src/app/ChatPanel.tsx`，避免 final-shape 迁移继续堆主入口。

### 2026-05-13 Milestone：EventLog Restore 与 Projection 主 Surface 收紧

第二轮继续并行推进 final-shape：runtime event-log、kernel contract、UI projection surface、边界扫描四条线同时推进，并在主线程集成。目标是让 projection 从“可携带的显示对象”升级为“可从事件日志确定性恢复的主状态”，并继续压缩 raw run / executionUnits 对主 UI 的影响面。

- [x] `GatewayTaskOutcomeProjection` 新增 `conversationEventLog`、`conversationEventLogRef`、`conversationEventLogDigest` 和 `projectionRestore`，重新 attach 时优先 replay event log 生成 `ConversationProjection` 和 task card summary。
- [x] `ConversationEventLog` 增加 schema/event 校验、稳定 digest 和类型守卫，防止污染后的 stale projection 覆盖记录事实。
- [x] `BackgroundRunning` / `BackgroundCompleted` 事件必须记录 checkpoint refs、revision plan 和 foreground partial ref；`VerificationRecorded` 必须携带 verifier evidence ref。
- [x] State replay / projection 不再从 answer payload 中推断 background 或 verification；只有记录事件才能改变这些状态。
- [x] `ResultsRenderer`、`RunExecutionProcess`、message verification tag、ArchiveDrawer 在 projection 存在时忽略 raw failed run / failed execution unit 的主状态展示，raw 信息保留在审计/调试路径。
- [x] 边界扫描列出了仍需继续收敛的 raw-run 入口：`viewPlanResolver`、`sessionTransforms` request payload、`executionUnitsForRun` 拆分、`SciForgeWorkbench` recover focus 等。
- [x] 使用 Computer Use 打开 `http://127.0.0.1:22966/` 验证网页端，工作台、失败 run、结果区、恢复动作、refs 和 ExecutionUnit 审计信息可见。

本轮验证：

- [x] `npm run typecheck`
- [x] `node --import tsx --test src/runtime/conversation-kernel.test.ts src/runtime/gateway/result-presentation-contract.test.ts src/ui/src/app/results-renderer-execution-model.test.ts src/ui/src/app/ResultsRenderer.test.ts src/ui/src/app/ChatPanel.test.ts src/ui/src/app/chat/ArchiveDrawer.test.tsx`
- [x] `node --import tsx --test src/runtime/gateway/generated-task-runner-output-lifecycle.test.ts src/runtime/gateway/transient-external-failure.test.ts src/runtime/task-attempt-history.test.ts src/ui/src/app/appShell/workspaceState.test.ts`
- [x] `npx tsx tests/smoke/smoke-conversation-kernel-final-shape.ts`
- [x] `npx tsx tests/smoke/smoke-conversation-kernel-thin-waist.ts`
- [x] `npm run smoke:result-presentation-contract`
- [x] `npm run smoke:runtime-contracts`
- [x] `npm run smoke:no-src-capability-semantics`
- [x] `npm run smoke:browser`
- [x] `npm run smoke:long-file-budget`
- [x] `npm run build`
- [x] `git diff --check`

下一步 final-shape 收敛任务：

- [x] `viewPlanResolver` 输入改为 projection artifacts / visibleAnswer / ref preview，避免主结果模块继续从 raw run/displayIntent/response 推断。
- [x] `sessionTransforms` 下一轮请求 payload 改为携带 projection、selected refs、audit refs 按需展开，避免把 raw session.runs / executionUnits 当 continuation 真相源。
- [x] 拆分 `executionUnitsForRun` 为 audit-only helper 与 projection-owned execution process，禁止主 UI 直接依赖 raw EU 聚合器。
- [x] `SciForgeWorkbench` active recover focus 改为 projection-level focus；raw failure focus 只进入 audit/debug。
- [x] 接入 history edit/revert 到同一 event-sourced kernel；export bundle 已接入 event-log/projection/audit-only raw 边界。

## 当前并行任务板

更新时间：2026-05-13 23:xx Asia/Shanghai。任何 agent 开始新任务前必须先更新或确认这里的任务状态；完成后把验证命令和结果写回对应 milestone，再提交/推送。

### Active：第四轮 final-shape history/export/verify/拆分

- [x] H / owner: Faraday / history edit-revert event-sourced
  - 写入范围：`src/ui/src/app/chat/sessionTransforms.ts` 与 tests、`src/runtime/conversation-kernel/**`、相关 runtime contract。
  - 目标：history edit/revert/continue 携带或写入可审计 event-log / projection invalidation / ref invalidation 信息，避免只作为 UI/session 局部状态。
  - 当前状态：`HistoryEdited` 进入 conversation-kernel event contract/replay/projection；UI historical edit branch 写入 compact `ConversationEventLog`、projection invalidation 和 ref invalidation contract，revert/continue 后续 refs 不再只是 session 局部状态。
  - 验收：通过 `node --import tsx --test src/runtime/conversation-kernel.test.ts`、`node --import tsx --test src/ui/src/app/chat/sessionTransforms.test.ts`、`npm run typecheck`。
- [x] I / owner: Rawls / export bundle final-shape
  - 写入范围：export/download/bundle 相关 helper 与 tests、result presentation/conversation-kernel helper。
  - 目标：bundle 导出包含 `ConversationEventLog`、restored `ConversationProjection`、refs manifest 和 audit-only raw attachments 边界。
  - 当前状态：`buildExecutionBundle` 新增 final-shape export 子结构，导出 scoped `ConversationEventLog`、由 event log replay 的 projection、refs manifest，并将 raw runs / executionUnits 标记为 audit-only attachments；UI 下载路径继续复用同一 helper。
  - 验收：通过 `node --import tsx --test src/ui/src/exportPolicy.test.ts`、`npx tsx tests/smoke/smoke-conversation-kernel-final-shape.ts`、`npm run typecheck`。
- [x] J / owner: Euler / final-shape smoke verify 链路
  - 写入范围：`package.json` scripts、verify/smoke guard、`PROJECT.md`。
  - 目标：`tests/smoke/smoke-conversation-kernel-final-shape.ts` 进入 package script 或 verify 链路，防止 guard 被遗忘。
  - 当前状态：新增 `smoke:conversation-kernel-final-shape` 并接入 `smoke:all`；新增 `smoke:final-shape-verify-guard` 并接入 `verify:fast`，guard 会检查 final-shape smoke 仍在 package verify 链路中。
  - 验收：通过 `npm run smoke:final-shape-verify-guard`、`npm run smoke:conversation-kernel-final-shape`。
- [x] K / owner: Hume / `sessionTransforms` 语义拆分第一刀
  - 写入范围：`src/ui/src/app/chat/sessionTransforms.ts`、新建语义模块与 tests。
  - 目标：抽出 projection continuation 逻辑，降低主文件职责压力，保持行为不变。
  - 当前状态：已抽出 `src/ui/src/app/chat/sessionProjectionContinuation.ts`，主文件保留 request payload 编排；projection continuation 行为继续由 `sessionTransforms.test.ts` 覆盖。
  - 验收：`node --import tsx --test src/ui/src/app/chat/sessionTransforms.test.ts`、`npm run typecheck`、`npm run smoke:long-file-budget`。

### 2026-05-13 Milestone：History/Edit、Export Bundle 与 Verify 链路收敛

第四轮由 Faraday、Rawls、Euler、Hume 并行推进，主线程负责合并、边界 guard 修复和最终验证。目标是把第三轮剩余的 event-sourced history、portable export、final-shape smoke 和长文件治理第一刀同时收口。

- [x] `HistoryEdited` 进入 conversation-kernel event contract / replay / projection；history edit/revert/continue 分支携带 compact `ConversationEventLog`、projection invalidation 和 ref invalidation。
- [x] export bundle final-shape 子结构导出 scoped `ConversationEventLog`、event-log restored `ConversationProjection`、refs manifest 和 audit-only raw attachments。
- [x] `smoke:conversation-kernel-final-shape` 接入 `smoke:all`，`verify:fast` 增加 `smoke:final-shape-verify-guard` 防止 smoke 脱链。
- [x] projection continuation 从 `sessionTransforms.ts` 抽到 `sessionProjectionContinuation.ts`；主文件仍在 watch list，但职责边界已往语义模块拆分。
- [x] export refs manifest 的 artifact ref 构造移入 runtime contract helper，保持 `src` 不持有 package-owned artifact ref literal。

本轮验证：

- [x] `npm run typecheck`
- [x] `node --import tsx --test src/runtime/conversation-kernel.test.ts src/ui/src/app/chat/sessionTransforms.test.ts src/ui/src/exportPolicy.test.ts`
- [x] `node --import tsx --test src/ui/src/exportPolicy.test.ts packages/contracts/runtime/artifact-reference-policy.test.ts`
- [x] `npm run smoke:final-shape-verify-guard`
- [x] `npm run smoke:conversation-kernel-final-shape`
- [x] `npm run smoke:long-file-budget`
- [x] `npm run smoke:no-src-capability-semantics`
- [x] `npm run build`
- [x] `git diff --check`

### 2026-05-13 Milestone：Final-shape 设计复核与核心缺口收口

本轮重新对照 `docs/Architecture.md` 的 Conversation Kernel v2 最终形态，并用 Kepler、Dirac、Avicenna、Raman 并行审计 runtime、UI、harness decision 和长文件治理。结论是仍存在可执行缺口：hook decision 只存在类型名、UI 无 projection 时仍让 raw run 驱动主状态、export restore 复制 replay switch、`sessionTransforms.ts` 超 1500 行。主线程随后合并并补齐这些缺口；全局 session-level append-only ledger 和主 renderer prop 级纯 projection interface 属于更大架构替换，当前先用 event-log restore、projection-first 行为和 smoke guard 锁住可验证边界。

- [x] `HarnessDecisionRecorded` 增加专用 ref-backed payload contract，要求 `decisionId`、`profileId`、稳定 digest 和 decision/contract/trace refs；state replay 与 `ConversationProjection` 保留 harness decision 摘要与 refs。
- [x] gateway task outcome 的 `ConversationEventLog` 在 `TurnReceived` 后、`Dispatched` 前写入 `HarnessDecisionRecorded`，并从 `agentHarness` / `agentHarnessHandoff` / metadata 中提取可 replay 的 contract/trace refs。
- [x] UI 主结果状态和 view plan 收紧为 projection/event-log 优先：`conversationProjectionForRun` 先 replay `ConversationEventLog`，stale raw projection 不再覆盖事实账本；没有 projection 时 raw run、ExecutionUnit、validation、resultPresentation 只保留在 audit/legacy 路径。
- [x] export bundle 的 restored projection 改为复用 runtime `projectConversation(log)`，删除 UI/export 内第二套 replay switch。
- [x] `sessionTransforms.ts` 第二刀拆分完成，history edit/revert event-log、projection invalidation、ref invalidation、conflict 标记进入 `sessionHistoryEdit.ts`；主文件从约 1648 行降到约 1139 行。
- [x] `smoke-conversation-kernel-final-shape` 增加 recorded harness decision replay 覆盖；browser T097 fixture 升级为 event-log/projection 驱动，避免旧 raw resultPresentation 依赖。
- [x] `conversation-kernel` 的 digest 计算拆到 node-only `event-log-digest.ts`，browser-safe event-log validation/projection replay 不再把 `node:crypto` 或 `Buffer` 带入网页端。

本轮验证：

- [x] `npm run typecheck`
- [x] `node --import tsx --test src/runtime/conversation-kernel.test.ts src/runtime/gateway/result-presentation-contract.test.ts src/ui/src/exportPolicy.test.ts src/ui/src/app/chat/sessionTransforms.test.ts`
- [x] `node --import tsx --test src/ui/src/app/ResultsRenderer.test.ts src/ui/src/app/results-renderer-execution-model.test.ts src/ui/src/app/results/viewPlanResolver.test.ts`
- [x] `npm run smoke:conversation-kernel-final-shape`
- [x] `npm run smoke:runtime-contracts`
- [x] `npm run smoke:result-presentation-contract`
- [x] `npm run smoke:no-src-capability-semantics`
- [x] `npm run smoke:long-file-budget`
- [x] `npm run build`
- [x] `npm run smoke:browser`
- [x] `git diff --check`

### Active：第三轮 final-shape raw-run 回流收敛

- [x] D / owner: Kuhn / `viewPlanResolver` projection-first
  - 写入范围：`src/ui/src/app/results/**`、`src/ui/src/app/results-renderer-view-model.ts`、相关 `ResultsRenderer` tests。
  - 目标：有 `ConversationProjection` 时主结果模块选择只从 `projection.artifacts`、`visibleAnswer`、ref preview 和 projection audit refs 派生；`activeRun.raw` / parsed response / displayIntent 只作为无 projection 时的 audit fallback。
  - 验收：通过 `node --import tsx --test src/ui/src/app/results/viewPlanResolver.test.ts src/ui/src/app/ResultsRenderer.test.ts src/ui/src/app/results-renderer-execution-model.test.ts`，`npm run typecheck`。
- [x] E / owner: Meitner / `sessionTransforms` request payload projection-first
  - 写入范围：`src/ui/src/app/chat/sessionTransforms.ts` 与对应 tests。
  - 目标：下一轮请求 payload 优先携带 `ConversationProjection`、selected refs、audit refs bounded summary；避免把 raw `session.runs` / `executionUnits` 当 continuation 真相源。
  - 验收：通过 `node --import tsx --test src/ui/src/app/chat/sessionTransforms.test.ts src/ui/src/app/chat/runOrchestrator.targetInstance.test.ts src/ui/src/api/sciforgeToolsClient.policy.test.ts`，`npm run typecheck`。
- [x] F / owner: Banach / raw execution units audit-only
  - 写入范围：`src/ui/src/app/results/executionUnitsForRun.ts`、调用方和对应 tests。
  - 目标：将 raw EU 聚合器明确命名为 audit-only helper；主 UI 在 projection 存在时不能调用 raw EU 聚合器，历史/审计 fallback 保留。
  - 当前状态：已完成调用方迁移；projection 存在时 execution focus 展示 projection execution process，raw EU 只保留 audit/history fallback。
  - 验收：通过 `node --import tsx --test src/ui/src/app/results-renderer-execution-model.test.ts src/ui/src/app/appShell/workspaceState.test.ts src/ui/src/app/chat/RunExecutionProcess.test.ts`，`npm run typecheck`。
- [x] G / owner: Carson / recover focus projection-level
  - 写入范围：`src/ui/src/app/sciforgeApp/SciForgeWorkbench.tsx`、`src/ui/src/app/appShell/workspaceState.ts`、projection helpers 和 tests。
  - 目标：active recover focus 优先由 projection 的 activeRun / recoverActions / verification / background 决定；raw failed run focus 只作为 audit/debug fallback。
  - 验收：通过 `node --import tsx --test src/ui/src/app/appShell/workspaceState.test.ts src/ui/src/app/sciforgeApp/appStateModels.test.ts src/ui/src/app/ResultsRenderer.test.ts`，`npm run typecheck`。

### 2026-05-13 Milestone：Raw-run 回流第三轮收敛

本轮由 Kuhn、Meitner、Banach、Carson 并行推进，主线程负责集成、网页端 smoke 和 `PROJECT.md` 任务状态收口。目标是把剩余主 UI / continuation / recover focus 入口从 raw run 与 raw execution units 回流到 `ConversationProjection`。

- [x] `viewPlanResolver` 在 projection 存在时只从 projection artifact refs、visible answer、audit refs 和 ref preview 派生主结果 plan；raw resultPresentation / response / displayIntent 只作为无 projection fallback。
- [x] 下一轮 request payload 新增 projection continuation record-only unit，携带 bounded projection summary、selected refs 和 audit refs；raw runs/executionUnits 降级为 audit-only 上下文。
- [x] `executionUnitsForRun` 改名为 `auditExecutionUnitsForRun`，调用方按 audit/history/fallback 语义收口；projection 存在时执行视图展示 projection execution process。
- [x] workbench recovery focus 只由 projection-level activeRun、recoverActions、verification、background signal 驱动；legacy raw failure focus 暴露为 audit fallback helper。
- [x] browser failed-run restore fixture 升级为 `ConversationProjection` 驱动，并修复 projection recoverable 状态被 runtime compatibility drift 抢标题的问题。
- [x] `conversation.projection.continuation` tool id 移入 runtime contract events policy，避免 UI `src` 持有 package-owned tool literal。

本轮验证：

- [x] `npm run typecheck`
- [x] `node --import tsx --test src/ui/src/app/results/viewPlanResolver.test.ts src/ui/src/app/ResultsRenderer.test.ts src/ui/src/app/results-renderer-execution-model.test.ts`
- [x] `node --import tsx --test src/ui/src/app/chat/sessionTransforms.test.ts src/ui/src/app/chat/runOrchestrator.targetInstance.test.ts src/ui/src/api/sciforgeToolsClient.policy.test.ts`
- [x] `node --import tsx --test src/ui/src/app/results-renderer-execution-model.test.ts src/ui/src/app/appShell/workspaceState.test.ts src/ui/src/app/chat/RunExecutionProcess.test.ts`
- [x] `node --import tsx --test src/ui/src/app/appShell/workspaceState.test.ts src/ui/src/app/sciforgeApp/appStateModels.test.ts src/ui/src/app/ResultsRenderer.test.ts`
- [x] `node --import tsx --test src/ui/src/app/chat/sessionTransforms.test.ts packages/contracts/runtime/events.test.ts`
- [x] `npx tsx tests/smoke/smoke-conversation-kernel-final-shape.ts`
- [x] `npx tsx tests/smoke/smoke-conversation-kernel-thin-waist.ts`
- [x] `npm run smoke:result-presentation-contract`
- [x] `npm run smoke:runtime-contracts`
- [x] `npm run smoke:no-src-capability-semantics`
- [x] `npm run smoke:browser`
- [x] `npm run smoke:long-file-budget`
- [x] `npm run build`
- [x] `git diff --check`

### Todo：后续 final-shape

- [x] 接入 history edit/revert 到 event-sourced kernel。
- [x] export bundle 改为导出 event log、projection、refs manifest 和 audit-only raw attachments。
- [x] `sessionTransforms.ts` 第二刀拆分，history edit/revert 语义进入 `sessionHistoryEdit.ts`，主入口回到 watch 级。
- [ ] 拆分 watch list 长文件：`src/runtime/generation-gateway.ts`、`src/runtime/gateway/context-envelope.ts`、`src/ui/src/app/ChatPanel.tsx`。
- [x] 将 `tests/smoke/smoke-conversation-kernel-final-shape.ts` 加入 package script 与 `smoke:all`；`verify:fast` 先运行轻量 guard 防止 final-shape smoke 脱链。

长文件治理：

- [ ] `packages/skills/literature/index.ts` 当前超过 1500 行。后续应拆为 `literature-search-provider`、`literature-download-provider`、`literature-report-synthesis`、`literature-contract-normalizer` 等语义模块，主入口只保留 capability 编排和导出。
- [x] `src/ui/src/app/chat/sessionTransforms.ts` 已完成第二刀：projection continuation 在 `sessionProjectionContinuation.ts`，history edit/revert 在 `sessionHistoryEdit.ts`；主文件当前约 1139 行，继续 watch 但不再是超过 1500 行的治理阻塞。

## 架构参考

Conversation Kernel v2 的最终形态、分层职责和防腐化约束以 [`docs/Architecture.md`](docs/Architecture.md) 正文为准。`PROJECT.md` 只保留当前目标、任务板、milestone、验证记录和后续 TODO；不要再在这里维护第二份长篇架构说明。
