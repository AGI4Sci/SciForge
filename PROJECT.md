# SciForge - PROJECT.md

最后更新：2026-05-13

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
- 代码膨胀必须自动触发治理：源码文件超过 1000 行进入 watch list；超过 1500 行必须在 PROJECT.md 有模块化拆分任务、语义 part 计划或生成文件豁免；超过 2000 行优先拆分；超过 3000 行视为维护风险。后续开发若让文件越过阈值，应优先抽模块、删除冗余逻辑或补拆分 TODO，而不是继续堆主文件。
- 长文件拆分必须按职责命名，不能机械切成 part1/part2；如果暂时不能完全解耦，也要拆成有语义的文件，例如 *-event-normalizer、*-runner、*-diagnostics、*-state-machine，并保持主入口只做流程编排。
- 推进项目的时候尽可能多开sub agents，并行加速推进
- Prompt builder 不是策略真相源；策略必须来自 harness contract、capability manifest 或可信 runtime policy。
- Safety policy 继续 fail closed；latency、验证、上下文和 repair 深度必须可按层级收缩。
- 复杂任务要可审计，但审计路径不能阻塞用户看到第一份可读结果。
- 任何长任务都必须产出 structured partial/failure，而不是等总超时后只显示 runtime trace。
- 不用“无限追加上下文”换取正确性；多轮稳定性必须依赖 state digest、refs、cache、checkpoint 和按需展开。

## 任务板

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
- [ ] 接入 history edit/revert 和 export bundle 到同一 event-sourced kernel。

## 当前并行任务板

更新时间：2026-05-13 23:xx Asia/Shanghai。任何 agent 开始新任务前必须先更新或确认这里的任务状态；完成后把验证命令和结果写回对应 milestone，再提交/推送。

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

- [ ] 接入 history edit/revert 到 event-sourced kernel。
- [ ] export bundle 改为导出 event log、projection、refs manifest 和 audit-only raw attachments。
- [ ] 拆分 watch list 长文件：`src/runtime/generation-gateway.ts`、`src/runtime/gateway/context-envelope.ts`、`src/ui/src/app/ChatPanel.tsx`。
- [ ] 将 `tests/smoke/smoke-conversation-kernel-final-shape.ts` 加入 package script 或 verify 链路，防止 final-shape guard 被遗忘。

长文件治理：

- [ ] `packages/skills/literature/index.ts` 当前超过 1500 行。后续应拆为 `literature-search-provider`、`literature-download-provider`、`literature-report-synthesis`、`literature-contract-normalizer` 等语义模块，主入口只保留 capability 编排和导出。
- [ ] `src/ui/src/app/chat/sessionTransforms.ts` 当前超过 1500 行。后续应拆为 `session-message-projection`、`session-run-projection`、`session-reference-projection`、`session-archive-projection` 等语义模块，避免聊天状态恢复继续膨胀。

## 最终形态修改建议

当前多轮稳定性问题已经不是单点 bug，而是旧链路中存在多个半真相源：UI state、session records、runs、executionUnits、task attempts、repair diagnostics、verification 和 history restore 都在局部推断“当前任务到底是什么状态”。继续在这些链路上补丁式修复会越来越难保证稳定、流畅和可审计。

基于 agent backend 已经足够通用且能力很强这一前提，最终形态需要进一步调整为：

> **Backend maximal reasoning, SciForge minimal orchestration.**

SciForge 不应成为第二个 agent，也不应在 UI、gateway、prompt builder 或 repair loop 里重新判断用户语义。Backend 负责最大化通用推理、能力选择、多轮指代、研究策略、胶水代码生成、报告撰写和基于结构化错误的修复；SciForge 只负责 backend 很难天然稳定保证的运行秩序：capability contract、event log、refs/artifacts 持久化、runtime/safety boundary、failure owner classification、verification gate、background continuation 和 UI projection。

最终心智模型应保持为 5 个原语，而不是把 9 层实现流水线当成新的复杂架构：

```text
Event -> State -> Contract -> Decision -> Projection
```

`Event` 记录事实，`State` 约束合法转换，`Contract` 判断结果边界是否可信，`Decision` 记录下一步策略，`Projection` 给 UI 和后续轮次消费。其它模块都只是这 5 个原语的实现细分。

因此，最佳长期方向仍是直接重写为 **Conversation Kernel v2**，但它的定位必须是“薄而硬的运行内核”，不是“更聪明的业务路由器”。不考虑旧兼容性，只保留旧 session 的只读 archive viewer。新会话全部进入一个 event-sourced conversation kernel：

```text
TurnReceived
  -> Planned
  -> Dispatched
  -> PartialReady
  -> OutputMaterialized
  -> Validated
  -> Satisfied | DegradedResult | ExternalBlocked | RepairNeeded | NeedsHuman | BackgroundRunning
```

核心原则：

- SciForge 少做语义判断，多做运行秩序；只约束、执行、记录、验证和展示 backend 的工作，不替 backend 推理用户想要什么。
- 只保留一个 append-only `ConversationEventLog` 作为多轮状态唯一真相源；UI、runtime、repair、verification、history restore 都从 projection 派生。
- 删除散落在 UI/localStorage、task attempts、runs、executionUnits 和 repair 分支中的状态推断逻辑；这些对象可以作为事件 payload 或 projection 结果，但不能再反向驱动状态机。
- UI 只消费 `ConversationProjection`：`currentTurn`、`visibleAnswer`、`activeRun`、`artifacts`、`executionProcess`、`recoverActions`、`verificationState`、`backgroundState`。
- repair 先做失败归属分类，再决定动作。`external-provider`、`payload-contract`、`runtime-runner`、`backend-generation`、`verification`、`ui-presentation` 必须明确分层；HTTP 429、timeout、remote closed、DNS/5xx 等外部瞬时失败进入 `ExternalBlocked`，保留 refs 和 partial，不触发代码 repair loop。
- 前台永远 fast-first：3 秒内必须展示当前阶段、已保存 refs、是否后台继续、用户现在可查看的 partial 或诊断。全文下载、深验证、补证据和长报告扩展转后台 revision 合并。
- Harness contract 成为唯一策略入口。context budget、repair budget、verification level、background policy、capability hints、progress policy 都来自 harness profile/callback，不再散落到 gateway、prompt builder、UI 或 repair runner。
- Harness 的最终实现形态应是可组合的 `ContractFn` + `HookFn` 代数，而不是一组继续膨胀的 gateway if/else。SciForge 提供稳定 contract gates、状态归一化和 hook 合并规则；backend 负责推理、规划和生成任务。
- 旧 session 不迁移为新状态机。旧数据只读展示；新 kernel 不为旧 records shape 写兼容 fallback。

更彻底的抽象建议：

```ts
export type ContractFn<Input, Output> = (input: Input) => ContractResult<Output>;

export type HookFn<Facts, Decision> = (
  facts: Facts,
  prior: readonly ContractResult<unknown>[],
) => HookDecision<Decision>;

export interface HarnessProfile {
  id: string;
  defaults: HarnessDefaults;
  contracts: readonly ContractFn<unknown, unknown>[];
  hooks: readonly HookFn<HarnessFacts, HarnessDecision>[];
  mergePolicy: HarnessMergePolicy;
}
```

`ContractFn` 必须是纯函数、确定性、可 fixture 测试；它只做格式校验、refs/artifacts 可解析性检查、状态转换合法性检查、failure owner 最小归一化和可见结果约束。它不做用户意图推理，不按论文/任务/backend 写领域特例。

`HookFn` 只基于 current facts、contract results 和 profile defaults 做策略选择，例如 latency tier、context refs、capability budget、verification depth、repair action、background continuation 和 progress projection。Hook 可以表达偏好和收紧约束，但不能直接改写 event log、伪造 artifact 或绕过 contract gate。

`HarnessProfile` 是 harness 的组合单位：`fast-answer`、`research-grade`、`strict-evidence`、`low-cost`、`privacy-strict`、`debug-repair` 都应该只是 defaults + hook pipeline + merge policy 的不同组合，而不是不同 gateway 分支。用户需求变化时，SciForge 组装 profile；backend 仍接收一个清晰、可审计、refs-first 的 contract envelope。

Conversation Kernel v2 的完整层级职责以 [`docs/Architecture.md`](docs/Architecture.md) 为准：`User turn -> ConversationEventLog -> ConversationStateMachine -> contract gates + harness hooks -> HarnessContract -> capability/backend dispatch -> materialized refs/artifacts/execution evidence -> validation/failure classification -> ConversationProjection -> UI rendering / background continuation / audit export`。任何实现都应先确认自己新增逻辑属于哪一层；无法归层的逻辑默认不应加入主链路。

Contract 不能弱到只检查 JSON shape。它至少要保证以下最小语义不变量：

- `Satisfied` 必须有用户可见答案、artifact ref 或明确 empty-result 说明。
- `DegradedResult` 必须有可用结果、质量/证据/完整性缺口、可复用 refs 和可选补救路径，不能伪装成完整成功。
- `Failed` / `ExternalBlocked` 必须有 owner layer、reason、evidenceRefs 和 nextStep。
- `Verified` 必须有 verifier evidence ref；未验证只能展示为未验证。
- `BackgroundRunning` 必须有 checkpoint refs、revision plan 和前台 partial。
- 所有 refs 必须可解析、可 stale-check、可在 event log replay 后重建 projection。

Contract boundary 是必须的，但不能发展成重型领域 contract 系统。SciForge 至少保留四类薄 contract：

- `PayloadContract`：backend/runtime 返回的数据形状、状态字段和 machine-readable envelope 是否可信。
- `RefArtifactContract`：所有产物是否通过 ref、digest、size、mime、checkpoint 和 stale-check 边界进入系统。
- `StateContract`：每个 terminal/wait state 是否满足最小可展示、可恢复、可审计不变量。
- `CapabilityIOContract`：每个 capability 的输入、输出、副作用、失败形态和 repair hint 是否可验证。

Contract 不判断用户真正想要什么，不替 backend 做领域推理，不为单个任务写专属 schema。它只决定 SciForge 何时可以信任、展示、恢复、重试、降级或拒绝一个结果。

防腐化约束必须进入接口和测试，而不是只靠文档：

- `ConversationStateMachine` 只能消费 event types 和 transition metadata；`ContractFn` 只能消费 materialized outputs、refs 和 schema descriptors。两者不能共享 provider、paper、backend、scenario 等领域 enum。
- `ConversationEventLog` 必须区分小型 `InlineEvent` 与大内容 `RefEvent`；stdout/stderr、generated code、PDF text、report body、raw stream 和 task files 只能通过 ref/digest/checkpoint 进入 log。
- `HookFn` 的 decision 必须记录为 event；replay、restore、audit 和跨标签同步只消费 recorded decision，不能重新执行依赖时间、预算或 provider health 的 hook。
- Failure owner 是 next-action router，不是责任归因标签。保留独立 owner 的前提是它会改变 retry、repair、supplement、needs-human、fail-closed 或 degraded-result 路径。
- 主 UI 只能接收 `ConversationProjection` 和 ref preview API；raw runs/task attempts/executionUnits/backend stream 只能作为 audit/debug channel，不能参与主状态或 visible answer 判定。
- 每个 `HarnessProfile` 必须有 canonical fixture：给定 event log、profile id 和 materialized refs，输出确定的 `HarnessContract`、decision trace、merge diagnostics 和 digest。

应删除或禁止回流的旧逻辑：

- UI 按 prompt、scenario、artifact type 或最近 run 猜测当前用户意图。
- gateway 中为某个任务、论文、backend、文件名或错误文本写语义特例。
- prompt builder 承担策略真相源，把 context/repair/latency/verification policy 写成散落自然语言。
- repair loop 默认把失败交给 backend 改代码，而不是先做 owner layer 分类。
- 多套 records 同时维护主状态，并互相覆盖 `completed`、`failed`、`repair-needed`、`verified`。
- direct-text fallback 把代码、trace、taskFiles、日志或过程叙述包装成最终答案。

建议新增/收敛目录：

```text
src/runtime/conversation-kernel/
  event-log.ts
  state-machine.ts
  projection.ts
  turn-runner.ts
  failure-classifier.ts
  background-continuation.ts
  verification-gate.ts

packages/agent-harness/
  src/contract-fns.ts
  src/hook-fns.ts
  src/profiles.ts
  src/merge-policy.ts
  src/trace.ts
```

推荐实施切片：

1. 冻结旧多轮状态链路，禁止新增状态推断分支。
2. 建立最小 event log、状态机和 projection，只覆盖一次用户请求、一次 generated task、一次 partial、一次失败分类、一次刷新恢复。
3. 把 external-provider 失败分类从 repair loop 前移到 kernel failure classifier。
4. 让 UI workbench 只渲染 `ConversationProjection`，不直接读取 task attempts/runs 推断主状态。
5. 再逐步迁入 background continuation、history edit/revert、verification gate 和 export bundle。
