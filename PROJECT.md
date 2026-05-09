# SciForge - PROJECT.md

最后更新：2026-05-09

## 关键原则

- AgentServer 是项目无关的通用大脑和 fallback backend；SciForge 不维护写死工具清单，优先通过 skill registry、workspace-local task code 和 AgentServer 动态探索/写代码解决请求。
- 正常用户请求必须交给 AgentServer/agent backend 真实理解和回答；SciForge 不设置、不维护、不返回预设回复模板，只允许输出协议校验、执行恢复、安全边界和错误诊断类系统信息。
- Self-evolving skills 是核心原则：任务代码先在当前 workspace 中生成、修复和验证；稳定成功后，经用户确认再沉淀到 skill library 或 package skill package 候选。
- 所有修改必须通用、可泛化到任何场景，不能在代码里面硬编码和为当前案例打补丁
- 算法相关的代码优先用Python实现，方便人类用户优化、检查算法
- Python conversation-policy package 是多轮对话策略算法的唯一真相源；TypeScript 只能保留 transport、runtime 执行边界和 UI 渲染，不再维护一套并行的策略推断算法。
- T096/T097 的 execution mode 策略只允许来自 Python classifier；TypeScript 的职责是字段透传、runtime shell、guard 调用、ref 持久化和 UI fallback，不允许用 prompt regex 或 provider/scenario 分支重建策略。
- 当 senses、skills、tools、verifiers、ui-components 增多时，主 agent 只消费 capability broker 生成的紧凑 capability brief；能力模块默认是 typed service/adapter，只有开放式、多步推理模块才声明内部 planner/小 agent，UI components 只负责按 schema 渲染。
- 真实任务应输出标准 artifact JSON、日志和 ExecutionUnit；不得用 demo/空结果伪装成功。
- 错误必须进入下一轮上下文：failureReason、日志/代码引用、缺失输入、recoverActions、nextStep 和 attempt history 都要保留。
- 多轮对话要以 workspace refs 为长期事实来源，以最近消息为短期意图来源；“继续、修复、基于上一轮、文件在哪里”必须能接上当前 session。
- 代码路径保持唯一真相源：发现冗余链路时删除、合并或降级旧链路，避免长期并行实现。
- 代码膨胀必须自动触发治理：源码文件超过 1000 行进入 watch list；超过 1500 行必须在 PROJECT.md 有模块化拆分任务、语义 part 计划或生成文件豁免；超过 2000 行优先拆分；超过 3000 行视为维护风险。后续开发若让文件越过阈值，应优先抽模块、删除冗余逻辑或补拆分 TODO，而不是继续堆主文件。
- 长文件拆分必须按职责命名，不能机械切成 `part1/part2`；如果暂时不能完全解耦，也要拆成有语义的文件，例如 `*-event-normalizer`、`*-runner`、`*-diagnostics`、`*-state-machine`，并保持主入口只做流程编排。
- `npm run smoke:long-file-budget` 是代码膨胀守门 smoke：超过阈值且未被 PROJECT.md 跟踪的长文件应让验证失败，从而自动触发模块化、去重或任务补录。
- Computer Use 必须走 window-based 主路径：观察、grounding、坐标映射和动作执行都绑定目标窗口/窗口内容坐标，而不是全屏全局猜测；并行长测必须隔离目标窗口、输入通道和 trace，不抢占用户真实鼠标键盘。

## 任务板

### T098 Conversation Latency Policy 与多轮快速响应策略集中化

状态：进行中；Thread A-F 已完成，本轮已完成单一真相源清理：Python conversation-policy 继续作为 latency/response/background/cache 策略唯一真相源，TypeScript 已移除遗留 capability/verification 策略生成入口，UI handoff 只透传显式配置，runtime verification 不再用 prompt 关键词推断风险。剩余工作集中在多轮 direct-context 快速路径真实运行优化，以及真实 backend 慢/429/timeout/取消路径的长跑观察。目标是把“多轮对话什么时候直接回答、什么时候启动 workspace task、什么时候先给快速可读回复、什么时候后台补全、什么时候阻塞 verification/context compaction”集中到 Python conversation-policy 中，形成跨 scenario、跨 backend、跨任务类型的通用低等待策略。当前系统已经有 Python conversation-policy、execution classifier、context policy、memory/handoff/recovery、WorkEvidence 和主对话 WorkEvent，但多轮 direct-context 真实路径、真实 provider 慢/429/timeout/取消路径仍需要长跑校准。本任务要把这些策略收拢为可测试、可调参、可审计的 `latencyPolicy` / `responsePlan` / `backgroundPlan`，TypeScript 只负责执行策略结果、展示状态和保留 runtime safety guard。

范围边界：

- Python 是策略唯一真相源：首包 SLA、是否 direct-context、是否允许后台补全、是否阻塞 verification、是否阻塞 context compaction、是否复用缓存、是否降级为轻量回答等策略判断都应在 `packages/conversation-policy-python` 中产生。
- TypeScript 是执行壳：`runOrchestrator`、`sciforgeToolsClient`、runtime gateway 和 UI 只消费 Python policy 输出，负责 abort/retry、stream、workspace refs、UI 状态和高风险 safety enforcement，不复制 prompt regex、复杂度评分或策略推断。
- 高风险 action 仍必须 fail-closed：低等待优化不能绕过 human approval、危险动作 verification、artifact/schema guard、WorkEvidence guard 或用户显式要求的强验证。
- 低风险/信息型/继续型任务应优先降低体感等待：允许先返回短可读 answer/status，再让后台 stage 补 artifact、验证、报告或更完整结果。
- 所有策略必须面向通用任务形态，不能为某个 scenario、provider、prompt、论文站点、国家新闻、固定文案或截图案例写分支。
- 任务完成后必须更新本节 `状态`、Todo checkbox、验收结果和剩余风险；任何线程完成子任务后都要在本节写入实际文件路径、测试命令和未完成项。

建议新增/扩展的策略 contract：

```json
{
  "latencyPolicy": {
    "firstVisibleResponseMs": 8000,
    "firstEventWarningMs": 12000,
    "silentRetryMs": 45000,
    "allowBackgroundCompletion": true,
    "blockOnContextCompaction": false,
    "blockOnVerification": false,
    "reason": "low-risk continuation can answer from current context while background evidence completes"
  },
  "responsePlan": {
    "initialResponseMode": "direct-context-answer | quick-status | streaming-draft | wait-for-result",
    "finalizationMode": "append-final | replace-draft | update-artifacts-only",
    "userVisibleProgress": ["planning", "search", "fetch", "validate", "emit"],
    "fallbackMessagePolicy": "truthful-partial-with-next-step"
  },
  "backgroundPlan": {
    "enabled": true,
    "tasks": ["verification", "artifact-materialization", "report-expansion"],
    "handoffRefsRequired": true,
    "cancelOnNewUserTurn": false
  },
  "cachePolicy": {
    "reuseScenarioPlan": true,
    "reuseSkillPlan": true,
    "reuseReferenceDigests": true,
    "reuseLastSuccessfulStage": true
  }
}
```

Todo：

- [x] 在 `packages/conversation-policy-python` 新增 `latency_policy.py`：输入 goalSnapshot、contextPolicy、executionModePlan、capabilityBrief、selected actions/verifiers、recent failures、context budget、current refs 和 user guidance，输出通用 `latencyPolicy`，覆盖 first visible response SLA、silent stream warning/retry、是否允许后台补全、context compaction 是否阻塞、verification 是否阻塞。
- [x] 新增 `response_plan.py` 或扩展 `service.py` 的 `userVisiblePlan`：输出 `initialResponseMode`、`finalizationMode`、`progressPhases`、`fallbackMessagePolicy` 和后台补全说明；要求 direct-context 和 low-risk continuation 可快速回复，multi-stage/high-risk/action 任务按策略等待或给明确进展。
- [x] 新增 `cache_policy.py`：集中判断 scenario plan、skill plan、UI plan、reference digest、artifact index、last successful stage 和 backend session 是否可复用；TypeScript 只执行缓存读取/写入，不自行判断复用资格。
- [x] 将 Python response schema、TS bridge normalizer 和 GatewayRequest enrichment 接入 `latencyPolicy`、`responsePlan`、`backgroundPlan`、`cachePolicy`；缺失时只能回落为安全默认值，不能在 TS 中用 prompt regex 重建策略。
- [x] 清理遗留 TS 策略源：删除 `src/shared/capabilityRegistry.ts` 中的 `buildCapabilityBrief` / prompt scoring / verifier selection / risk inference，删除未被生产路径引用的 `src/shared/verification.ts` policy builder，`sciforgeToolsClient` 不再合成 verification/human approval 默认策略，runtime verification risk 只看显式 policy、结构化 action/evidence 和 executionUnits。
- [x] 改造 `runOrchestrator` preflight compaction：由 `latencyPolicy.blockOnContextCompaction` 决定是否阻塞发送；允许后台预压缩/非阻塞压缩，把结果写入 stream event 和下一轮 context，而不是让普通追问卡在发送前。
- [x] 改造 `sciforgeToolsClient` 静默等待、45s 重连和 timeout 逻辑：阈值来自 `latencyPolicy`；UI 展示由 `responsePlan.userVisibleProgress` 和 T095 WorkEvent 消费，避免硬编码散在多个位置。
- [x] 改造 verification 使用方式：低风险回答不因 `unverified` / lightweight verification 阻塞用户可读回复；高风险 action、显式 human approval、危险 side effect 继续由 runtime verification gate fail-closed；Verification 只以结构化 badge/artifact/ref 进入 UI 和下一轮上下文。
- [x] 增加后台补全 runtime 协议：支持一个 run 先落地 initial assistant message，再通过 run update / artifact update / finalization event 追加最终结果；必须保留 runId、stage refs、WorkEvidence、verification refs 和 cancellation semantics。
- [x] 增加多轮 direct-context 快速路径：继续解释上一轮结果、询问文件位置、追问已有 artifact/claim/table 时，不启动完整 workspace task；若需要新外部 I/O 或新 artifact，再按 executionModePlan 走 thin adapter/single-stage/multi-stage。
- [x] 增加通用 fixtures 和 smoke：覆盖简单追问、上一轮 artifact 追问、低风险 current-events、文献检索、长报告、失败修复、高风险 action、context 接近阈值、backend silent stream、用户中途追加引导；断言策略来自 Python、TS 只透传执行。
- [x] 增加 telemetry/diagnostics：记录 time-to-first-visible-response、time-to-first-backend-event、context compaction wait、verification wait、background completion duration、cache hit/miss 和 fallback reason，输出为低噪声 WorkEvidence/Run diagnostics。

验收标准：

- [x] 任意 scenario 的低风险多轮追问能在策略 SLA 内出现用户可读反馈，且不丢失后续 artifact、verification、WorkEvidence 和 final answer。
- [x] Python conversation-policy 是 latency/response/cache/background 策略唯一真相源；TypeScript 中不新增 prompt/scenario/provider 专用策略分支。
- [x] context compaction、verification 和 artifact materialization 可以按策略后台执行；只有高风险 action、安全边界、schema/WorkEvidence fail-closed 才阻塞最终成功。
- [x] 后台补全不会制造幽灵状态：每次初始回复、后台 stage、最终更新都绑定 runId/stageId/ref，并能被下一轮上下文读取。
- [ ] 真实 backend 慢、无首事件、429、timeout、空结果、用户取消和中途追加引导都有通用恢复路径和 UI 状态。

验收命令：

- `python3 -m pytest packages/conversation-policy-python/tests`
- `node --import tsx --test src/runtime/conversation-policy/*.test.ts`
- `node --import tsx --test src/ui/src/app/chat/*.test.ts src/ui/src/api/agentClient/*.test.ts`
- `npx tsx tests/smoke/smoke-t097-execution-mode-matrix.ts`
- `npx tsx tests/smoke/smoke-t096-work-evidence-provider-fixtures.ts`
- `npm run smoke:t098-latency`
- `node --import tsx --test src/shared/capabilityRegistry.test.ts src/ui/src/api/sciforgeToolsClient.policy.test.ts`
- `npx tsx tests/smoke/smoke-runtime-gateway-modules.ts`
- `npx tsx tests/smoke/smoke-browser-workflows.ts`
- `npx tsc --noEmit`
- `npm run build`

并行协调：

- Thread A/B 可以最先并行启动，二者只写 `packages/conversation-policy-python/src/sciforge_conversation/*` 和 `packages/conversation-policy-python/tests/*`；A 负责 latency 策略，B 负责 response/background/cache 策略，避免同时编辑同一个新文件。
- Thread C 在 A/B 的 response shape 基本稳定后启动；如果 A/B 尚未完成，C 只能先加向后兼容的 optional schema 和 fixture，不得臆造策略算法。
- Thread D 依赖 C 的 TS bridge 字段；在 C 合入前只允许准备 tests/harness，不要把策略判断写进 UI/runtime。
- Thread E 可以与 C/D 并行做 session transform 和 runtime event contract，但不得改 Python 策略；如需要新增策略字段，先在本节记录并与 A/B 对齐。
- Thread F 可以从第一天开始补 telemetry/smoke fixtures，但所有 assertions 必须验证“策略来自 Python response，TS 只执行/展示”，不能把测试写成固定 prompt 或固定场景快照。
- 所有线程都要遵守 disjoint write set：如果必须修改同一文件，先在本节“线程状态”写明冲突文件和合并顺序，再继续。
- 每个线程结束时必须更新本节：勾选完成项、补充实际修改文件、测试命令、失败/跳过原因、剩余风险；不能只在最终回复里说明。

线程状态：

- [x] Thread A - Python latency policy：已完成；新增 `packages/conversation-policy-python/src/sciforge_conversation/latency_policy.py`，接入 `contracts.py` / `service.py` / `__init__.py`，新增 `packages/conversation-policy-python/tests/test_latency_policy.py`。覆盖 direct context、low-risk continuation、light lookup、multi-stage project、repair、high-risk action、context near limit；验证命令 `cd packages/conversation-policy-python && uv run --with pytest python -m pytest tests` 通过（67 passed）。剩余风险：本机 `python3` 是 3.9.6，低于包要求 `>=3.10`，直接运行 `python3 -m pytest packages/conversation-policy-python/tests` 会在既有 `@dataclass(slots=True)` collection 阶段失败；需 CI/开发环境使用 Python 3.10+ 或 uv 托管解释器。
- [x] Thread B - Python response/background/cache plan：已完成；新增 `packages/conversation-policy-python/src/sciforge_conversation/response_plan.py` 和 `packages/conversation-policy-python/src/sciforge_conversation/cache_policy.py`，接入 `contracts.py` / `service.py` / `__init__.py`，新增 `packages/conversation-policy-python/tests/test_response_cache_policy.py` 并更新 `test_contracts.py`。覆盖全部 execution mode 与 low/medium/high 风险等级，验证 responsePlan/backgroundPlan/cachePolicy 输出及 ref/artifact/stage/backend session 缓存复用/失效。验证命令 `python3 -m pytest packages/conversation-policy-python/tests` 通过（67 passed）。剩余风险：TS bridge/runtime 尚未消费这些字段，后台补全 runId/stageId/ref 协议仍由后续线程完成。
- [x] Thread C - TypeScript bridge and request enrichment：已完成；更新 `src/runtime/conversation-policy/contracts.ts` / `apply.ts` normalizer 与 enrichment，透传 `latencyPolicy`、`responsePlan`、`backgroundPlan`、`cachePolicy` 到 `uiState.conversationPolicy` 和 `uiState.*Policy` 顶层稳定位置；缺失字段回落为 fail-closed 安全默认（verification/context compaction 阻塞、background/cache 不声明完成或复用）。更新 `src/runtime/gateway/context-envelope.ts` 和 `src/runtime/gateway/agentserver-prompts.ts` 只展示裁剪后的 `conversationPolicySummary`，未新增 prompt regex。新增 `src/runtime/conversation-policy/policy.test.ts` 覆盖字段透传、缺失默认、prompt/envelope 无整份策略复制。验证命令 `node --import tsx --test src/runtime/conversation-policy/*.test.ts` 通过（3 passed），`npx tsc --noEmit` 通过。剩余风险：runtime/UI 尚未按这些策略执行，后台补全 runId/stageId/ref 协议仍由 Thread D/E 完成。
- [x] Thread D - UI/runtime orchestration execution shell：已完成；新增 `src/ui/src/latencyPolicy.ts` 作为 TS 执行壳读取器，只消费 Python 输出的 `latencyPolicy` / `responsePlan` 字段，不做 prompt/scenario 策略推断。更新 `src/ui/src/app/chat/runOrchestrator.ts`，preflight context compaction 读取最近 policy 的 `blockOnContextCompaction`，为 `false` 时发送继续、压缩后台执行并通过 stream event 记录。更新 `src/ui/src/api/sciforgeToolsClient.ts`，silent wait warning、silent first-event retry 和可选 request timeout 从当前轮 `conversation-policy` stream event 的 `latencyPolicy` 更新，缺失时保留安全默认；`responsePlan.initialResponseMode` 生成通用 `process-progress` quick/direct/wait 状态。更新 `src/ui/src/processProgress.ts` 及 tests，覆盖 quick-status/direct-context 可见反馈；更新 `src/ui/src/app/chat/runOrchestrator.targetInstance.test.ts` 和新增 `src/ui/src/api/sciforgeToolsClient.policy.test.ts`，覆盖非阻塞 compaction、policy silent retry 阈值和 quick status。为保持验收类型检查，`src/runtime/generation-gateway.ts` 补 `await applyRuntimeVerificationPolicy(...)`，不改变 verification-policy / WorkEvidence / schema guard 语义。验证命令：`node --import tsx --test src/runtime/conversation-policy/policy.test.ts src/ui/src/processProgress.test.ts src/ui/src/app/chat/runOrchestrator.targetInstance.test.ts src/ui/src/api/sciforgeToolsClient.policy.test.ts`、`npx tsc --noEmit`、`npm run build` 均通过。剩余风险：当前轮 preflight 只能使用发送前已有的最近 policy；当前轮 Python policy 要等 workspace stream 返回后才能驱动 transport 阈值和 quick status，首包前策略预取/后台补全完整协议仍由后续线程继续收敛。
- [x] Thread E - Background completion protocol and persistence：已完成；新增通用 `sciforge.background-completion.v1` runtime event / session transform contract，覆盖 initial response、background stage update、finalization，保持 runId/stageId/ref 一致；`applyBackgroundCompletionEventToSession` 支持同一 run 的 artifact / verification / WorkEvidence / final response 追加，失败与用户取消写入 `failureReason` / `recoverActions` / `nextStep`，下一轮 `requestPayloadForTurn` 可读取后台结果。更新 workspace timeline 对既有 run 状态变化的持久化事件，新增 runtime contract schema/smoke 与 long task smoke。验证命令：`node --import tsx --test src/ui/src/app/chat/sessionTransforms.test.ts src/ui/src/app/appShell/workspaceState.test.ts`、`npx tsx tests/smoke/smoke-background-completion-protocol.ts`、`npx tsx tests/smoke/smoke-runtime-contract-schemas.ts`。
- [x] Thread F - Telemetry and end-to-end latency smoke：已完成；新增 `src/runtime/gateway/latency-telemetry.ts` 并接入 `src/runtime/generation-gateway.ts`，在每轮 runtime 结束时输出一条低噪声 `latency-diagnostics` event，同时把摘要挂入 payload `logs` 和 `workEvidence`，覆盖 time-to-first-visible-response、time-to-first-backend-event、context compaction wait、verification wait、cache hit/miss 和 fallback reason。`src/ui/src/app/chat/sessionTransforms.ts` 的 background completion raw diagnostics 记录 `backgroundCompletionDurationMs`。新增 `tests/smoke/smoke-t098-latency-diagnostics-matrix.ts` 与 `npm run smoke:t098-latency`，本地 Python policy 生成 10 类通用 fixtures：普通追问、上一轮 artifact 追问、低风险 current-events、文献检索、长报告、失败修复、高风险 action、context near limit、backend silent stream、用户中途追加引导；断言 `latencyPolicy` / `responsePlan` / `backgroundPlan` / `cachePolicy` 来自 Python response，TS 只透传/执行。smoke 暴露并修复一个明确策略缺口：`packages/conversation-policy-python/src/sciforge_conversation/response_plan.py` 和 `cache_policy.py` 现在会把 `policyHints.selectedActions` 纳入 high-risk action 风险计算，`packages/conversation-policy-python/tests/test_response_cache_policy.py` 已覆盖 high-risk action 禁止 background/cache reuse。后续补齐剩余 T098 TODO：`packages/conversation-policy-python/src/sciforge_conversation/execution_classifier.py` 不再把 runtime planning skill `scenario.*.agentserver-generation` 误当 selected action，从而让已有 artifact/table 追问进入 Python `direct-context-answer`；新增 `src/runtime/gateway/direct-context-fast-path.ts`，在 Python 明确选择 direct-context 且没有 AgentServer base URL 时，从现有 artifacts/refs/execution refs 生成可审计 ToolPayload，不启动 workspace task；有 AgentServer 时仍保持 AgentServer owns orchestration 的 direct payload 路径。`src/runtime/gateway/verification-policy.ts` 将 `latencyPolicy.blockOnVerification=false` 写入 verification artifact/displayIntent 的 `nonBlocking` 标记，低风险 `unverified`/lightweight verification 只作为 badge/artifact/ref 进入 UI 和下一轮上下文，高风险 action 仍 fail-closed。验证命令：`python3 -m pytest packages/conversation-policy-python/tests/test_execution_classifier.py packages/conversation-policy-python/tests/test_response_cache_policy.py` 通过（24 passed），`npm run smoke:t098-latency && npm run smoke:background-completion` 通过，`npx tsc --noEmit` 通过，`npm run build` 通过。剩余风险：当前 telemetry 记录的是 runtime gateway 与 background session transform 的低噪声诊断摘要；真实 provider 的 429/timeout/用户取消路径还需要长跑 smoke 或 live backend 观测来校准 SLA 分布。
- [x] Single truth source cleanup：已完成；`src/shared/capabilityRegistry.ts` 只保留 capability metadata 与 lazy contract registry，删除旧 TS `buildCapabilityBrief`、prompt scoring、risk inference 和 verifier selection；删除未被生产路径引用的 `src/shared/verification.ts` / `src/shared/verification.test.ts`，避免维护第二套 verification policy builder；`src/ui/src/api/sciforgeToolsClient.ts` 只透传显式 `scenarioOverride.verificationPolicy` / `humanApprovalPolicy` / `unverifiedReason`，不再合成默认策略；`src/runtime/gateway/verification-policy.ts` 不再从用户 prompt 关键词推断 high risk，只从显式 policy、结构化 selected actions/action side effects、uiState policy 和 executionUnits safety evidence 推断，同时保留 action provider self-report 的 fail-closed gate。验证命令：`node --import tsx --test src/shared/capabilityRegistry.test.ts src/ui/src/api/sciforgeToolsClient.policy.test.ts`、`npx tsx tests/smoke/smoke-runtime-gateway-modules.ts`、`uv run --with pytest python -m pytest tests`（在 `packages/conversation-policy-python`）、`npm run smoke:t098-latency`、`npx tsc --noEmit`、`npm run build` 均通过。剩余风险：真实 provider 的慢/429/timeout/取消分布仍需 live backend 长跑校准；transport safe default 仍保留为执行壳兜底，不承担策略选择。

并行实现 prompts：

#### Thread A - Python latency policy

```text
你负责实现 T098 的 Python latency policy。只修改 packages/conversation-policy-python 及其 tests，必要时更新 PROJECT.md 中 T098 状态。

目标：
- 新增 sciforge_conversation/latency_policy.py，输出 latencyPolicy。
- 输入应来自 service.py 已有 policy_input、goalSnapshot、contextPolicy、executionModePlan、capabilityBrief、recovery/failure/guidance/context budget 等通用字段。
- 策略必须通用，不得按 scenario/provider/prompt 特例。
- 覆盖 firstVisibleResponseMs、firstEventWarningMs、silentRetryMs、allowBackgroundCompletion、blockOnContextCompaction、blockOnVerification、reason。
- 高风险 action / selected action / human approval required / failed verification 必须 block；direct-context、低风险 continuation、已有 artifact 追问可非阻塞。

验收：
- 新增 pytest fixtures 覆盖 direct context、low-risk continuation、light lookup、multi-stage project、repair、high-risk action、context near limit。
- python3 -m pytest packages/conversation-policy-python/tests 通过。
- 更新 PROJECT.md 的 T098 Thread A 进度和剩余风险。
```

#### Thread B - Python response/background/cache plan

```text
你负责实现 T098 的 responsePlan/backgroundPlan/cachePolicy。优先在 packages/conversation-policy-python 内实现，必要时只做最小 TS contract 类型补充，不改 UI 行为。

目标：
- 新增或扩展 response_plan.py、cache_policy.py。
- service.py 输出 responsePlan、backgroundPlan、cachePolicy，并进入 ConversationPolicyResponse contract。
- responsePlan 至少包含 initialResponseMode、finalizationMode、userVisibleProgress、fallbackMessagePolicy。
- backgroundPlan 至少包含 enabled、tasks、handoffRefsRequired、cancelOnNewUserTurn。
- cachePolicy 至少覆盖 scenario/skill/UI plan、reference digests、artifact index、last successful stage/backend session 是否可复用。
- 所有决策基于通用 executionMode/contextPolicy/capability/risk/failure/ref 信号。

验收：
- pytest 覆盖所有 mode 和风险等级。
- 不在 TS 中复制策略判断。
- 更新 PROJECT.md 的 T098 Thread B 进度。
```

#### Thread C - TypeScript bridge and request enrichment

```text
你负责把 Python T098 策略字段接入 TypeScript bridge 和 GatewayRequest enrichment。不要实现策略算法，只做 schema、normalization、透传、安全默认值。

目标：
- 更新 src/runtime/conversation-policy/contracts.ts、apply.ts、python-bridge.ts 相关 normalizer。
- requestWithPolicyResponse 将 latencyPolicy、responsePlan、backgroundPlan、cachePolicy 写入 uiState.conversationPolicy 以及稳定顶层位置（如 uiState.latencyPolicy 等），供 runtime/UI 消费。
- buildContextEnvelope 和 agentserver-prompts 只展示裁剪后的策略摘要，不能新增 prompt regex。
- 缺失字段使用安全默认：block verification/action safety、允许普通 UI 继续但不声明后台完成。

验收：
- 新增/更新 TS unit tests，断言字段透传、缺失默认、无策略复制。
- node --import tsx --test src/runtime/conversation-policy/*.test.ts 通过。
- npx tsc --noEmit 通过。
- 更新 PROJECT.md 的 T098 Thread C 进度。
```

#### Thread D - UI/runtime orchestration execution shell

```text
你负责让 UI/runtime 按 T098 policy 执行，但不在 TS 中推断策略。重点改 runOrchestrator、sciforgeToolsClient、process progress 和 running message。

目标：
- runOrchestrator preflight compaction 读取 latencyPolicy.blockOnContextCompaction；false 时不阻塞发送，改为后台/stream event 记录。
- sciforgeToolsClient silent wait/retry/timeout 阈值读取 latencyPolicy；缺失时保留现有安全默认。
- 支持 responsePlan.initialResponseMode 的最小 UI 行为：quick-status/direct-context 不必等完整 workspace task 才显示可读反馈；复杂任务仍显示明确进展。
- 不绕过 runtime verification-policy、WorkEvidence guard、schema validation。
- 所有 UI 文案和状态通用，不写固定 scenario/prompt。

验收：
- 更新 chat/runOrchestrator、sciforgeToolsClient 相关 tests。
- browser smoke 或 unit fixture 覆盖 context compaction 非阻塞、silent retry 阈值来自 policy、quick status 可见。
- npm run build、npx tsc --noEmit 通过。
- 更新 PROJECT.md 的 T098 Thread D 进度。
```

#### Thread E - Background completion protocol and persistence

```text
你负责设计并实现 T098 后台补全协议。重点是 runId/stageId/ref 的一致性，不做策略算法。

目标：
- 定义 initial response、background stage update、finalization event 的通用 runtime event / session transform contract。
- 一个 run 可以先写入初始 assistant message，再追加 artifact/verification/WorkEvidence/final response 更新。
- 后台补全必须可取消、可被新用户 turn 继承上下文、可在失败时写 failureReason/recoverActions/nextStep。
- 更新 sessionTransforms、workspace state persistence、object references，确保下一轮能看到后台补全结果。
- 不为某个场景写专用状态。

验收：
- 单测覆盖初始回复、后台成功、后台失败、用户取消、新用户 turn 期间后台完成、artifact update、verification update。
- smoke 覆盖一个通用 long task 先回复后补全。
- 更新 PROJECT.md 的 T098 Thread E 进度。
```

#### Thread F - Telemetry and end-to-end latency smoke

```text
你负责 T098 诊断与验收矩阵，不改核心策略除非测试暴露明确缺口。

目标：
- 增加 time-to-first-visible-response、time-to-first-backend-event、compaction wait、verification wait、background completion duration、cache hit/miss、fallback reason 的低噪声 telemetry。
- 新增通用 smoke fixtures：普通追问、上一轮 artifact 追问、低风险 current-events、文献检索、长报告、失败修复、高风险 action、context near limit、backend silent stream、用户中途追加引导。
- 验证策略字段来自 Python response，TS 只执行/展示。
- 给 PROJECT.md T098 更新可量化验收结果和剩余风险。

验收：
- 新增 smoke 可稳定本地运行，不依赖真实外网或单一 provider。
- npm run build、npx tsc --noEmit、相关 smoke 通过。
```

### T097 任务复杂度路由与 Reproducible Task Project Runtime

状态：已完成本轮验收，继续观察真实 backend mode 遵循和产品运行中的证据质量。本轮已完成 Python classifier、TS 字段透传、Task Project runtime/runner、WorkEvidence guard 接入、AgentServer prompt 边界、运行中 UI 最小展示、repair/continue stage 锚点、guidance adoption contract、guidance adoption runtime guard 和 stage adapter promotion proposal 入口。T097 负责任务复杂度路由和多阶段 Task Project runtime：每个用户请求先经过 Python 策略层判断任务类型、复杂度、不确定性、可复现需求和交互风险，再选择合适执行模式：已有上下文直答、薄可复现 adapter、单阶段 workspace task、多阶段 Task Project、或 repair/continuation。复杂任务应拆成可执行 stage，agent 每次只写/修改当前阶段所需代码，SciForge 执行后把阶段证据、失败和用户追加引导反馈给 agent，再进入下一阶段。

接口边界补充：`executionModePlan` 的策略字段由 `packages/conversation-policy-python/src/sciforge_conversation/execution_classifier.py` 产生；TS 只在 `src/runtime/conversation-policy/apply.ts`、`src/runtime/gateway/context-envelope.ts`、`src/runtime/gateway/agentserver-prompts.ts` 中做字段映射、裁剪和 prompt contract 展示。缺失时只能回退为 `unknown` / `backend-decides`，不能用 prompt regex 自行判断 mode。

与 T096 的关系：T097 决定“这轮应该怎么跑、拆几段、何时继续或修复”；T096 定义“每段运行必须留下什么证据、怎样判断失败、怎样把失败归一成可恢复上下文”。T097 的 Project/Stage runner 消费 T096 的 `WorkEvidence` schema 与 guard，不另建一套证据语义。

核心原则：

- 算法优先 Python：任务分类、复杂度评分、stage 规划、继续/修复策略应在 `packages/conversation-policy-python` 中实现，方便学生阅读、修改和写实验；TypeScript 只保留 request transport、workspace project/stage runner、artifact/ref 持久化和 UI 展示。
- Runtime shell 优先 TypeScript：project/stage 目录创建、输入输出落盘、命令执行、stream 转发、证据归档、UI 状态和 AgentServer 往返属于 TypeScript 执行壳；TypeScript 不复制 Python 的分类、复杂度评分或 stage 规划算法。
- 可复现性优先：依赖新检索、文件、命令、工具或产物的结果必须留下 project/stage code、input、output、stdout/stderr、WorkEvidence 和 artifact refs；只有纯解释已有上下文时才允许直接 ToolPayload。
- 分阶段优先于一次性大脚本：对长任务、高不确定性任务、多 provider 检索、多 artifact 产出、外部 I/O、需要用户中途纠偏的任务，AgentServer 应先生成 stage spec / 当前阶段代码，运行后再基于阶段反馈继续。
- 轻量任务不应走重型 pipeline：简单 search/fetch/current-events 查询可以走薄 adapter 或单阶段 project，限制 provider 数、结果数、超时和输出体积，但仍保留可复现证据链。
- Agent backend 负责策略和代码，SciForge 负责项目状态机、stage 执行、证据归档、失败守门、用户可见进度和下一轮 handoff。
- 所有路由规则、stage 类型和 adapter contract 必须面向通用任务形态；不得为单一 provider、scenario、prompt、论文站点、backend 或固定文案写特例。

简化流程：

```text
user request
  -> Python classifier
  -> execution mode
  -> AgentServer stage/task generation
  -> SciForge runner
  -> WorkEvidence
  -> next stage / repair / final payload
```

执行模式草案：

- `direct-context-answer`：只基于已有 refs / digest / session state 回答，不产生新外部 I/O。
- `thin-reproducible-adapter`：简单外部检索或轻量工具调用；生成最小 adapter/stage，输出 WorkEvidence 和简短结果。
- `single-stage-task`：一次可完成的本地计算、文件转换、窄范围分析或简单 artifact 生成。
- `multi-stage-project`：需要 plan -> search/fetch/read/analyze/validate/emit 多阶段反馈的任务。
- `repair-or-continue-project`：基于已有 project/stage 的失败、用户追加引导或上一轮 artifact 继续。

Todo：

- [x] 在 `packages/conversation-policy-python` 新增任务复杂度分类器：输入 prompt、refs、artifacts、expectedArtifactTypes、selected capabilities、recent failures，输出 `executionMode`、`complexityScore`、`uncertaintyScore`、`reproducibilityLevel`、`stagePlanHint` 和选择理由。
- [x] 为 Python 分类器建立可编辑规则与 fixture：覆盖简单问答、轻量搜索、新闻/current-events、文献调研、全文下载、代码修改、文件探索、长任务、repair、continuation、用户运行中追加引导；断言不依赖单一 provider/scenario/prompt。
- [x] 定义 Task Project schema 与持久化 helpers：`.sciforge/projects/<project-id>/project.json`、`plan.json`、`stages/<n>-<kind>.json`、`src/`、`artifacts/`、`evidence/`、`logs/`，每个 stage 记录 codeRef/inputRef/outputRef/stdoutRef/stderrRef/evidenceRefs/failureReason/nextStep，并支持 project/stage 创建、读取、更新、evidence refs 记录、bounded handoff 摘要和 recent project 列表。
- [x] 在 TypeScript runtime 增加 Project/Stage runner：创建 project、写入 stage code/input、执行当前 stage、调用 T096 guard 归档 WorkEvidence、验证 stage 输出、决定是否请求 AgentServer 生成下一 stage。
- [x] 改造 AgentServer handoff：把 Python 分类结果、执行模式和当前 project/stage/WorkEvidence 摘要放入 `CURRENT TURN SNAPSHOT`；要求多阶段模式下只返回下一阶段 patch/spec，不一次性生成整条 pipeline。
- [x] 将 Python `executionModePlan` 接入 GatewayRequest enrichment、context envelope 的 `sessionFacts`/`scenarioFacts` 和 AgentServer prompt；TypeScript 只透传稳定字段，缺失时回落到 `unknown`/`backend-decides`。
- [x] 增加 stage feedback loop 的 runtime handoff 基础：每阶段完成后把 T096 WorkEvidence 摘要、diagnostics/schema errors/verifier 摘要、artifact refs、recoverActions、用户追加 guidance 和失败诊断压成结构化摘要回传给 agent；handoff 已包含紧凑 guidance adoption contract，runtime guard 会要求 active guidance 都有结构化 adopted/deferred/rejected 决策和 reason，缺失时进入 repair-needed。
- [x] 增加中途可见进度 UI：主对话最小展示当前 project、stage、状态、最近 evidence/failure/recover/diagnostic/nextStep；右侧阶段性 artifact 展示继续作为后续增强。
- [x] 支持用户中途干预的 runtime 基础：追加消息进入 project guidance queue，下一阶段 handoff 读取 queued/deferred guidance，并提供 adopted/deferred/rejected 状态记录 helper；continuation selection 已把 repair/continue 锚定到最近 failed/repair-needed/blocked stage，成功后追加 guidance 时锚定最近 completed stage，避免从 stage one 重跑。
- [x] 建立 promotion 路径：成功稳定的 stage adapter 可以被提议为 reusable skill/package；Task Project 保留从一次性代码到可复用能力的演化证据，复用现有 skill-promotion safety gate、proposal manifest、validation smoke 和人工确认流程。
- [x] 增加 T097 端到端 smoke：同一任务分别触发 direct-context、thin adapter、single-stage、multi-stage、repair/continue 五种模式，断言选择理由、执行 refs、stage 证据、UI 状态和 repair guidance adoption 都稳定。
- [x] 补齐基础 UI+runtime 端到端矩阵：`tests/smoke/smoke-t097-execution-mode-matrix.ts` 用同一套 execution mode fixtures 验证 Python decision 字段、AgentServer handoff、runner refs、WorkEvidence、UI runtime 状态和 repair/continue handoff。
- [x] 补齐 browser 级 RunningWorkProcess DOM smoke：`tests/smoke/smoke-browser-workflows.ts` 使用通用 TaskProject/TaskStage/WorkEvidence fixture 验证默认紧凑展示 project/stage/status/evidence/failure/recover/diagnostic/nextStep，raw output 只在二级折叠中出现，且结构化字段优先于文本 fallback。

验收标准：

- [x] AgentServer handoff 已明确 direct-context/thin-adapter/single-stage/multi-stage/repair-continue 边界，要求 multi-stage 只返回下一阶段；仍需端到端运行矩阵持续验证 backend 遵循程度。
- [ ] 每个依赖外部 I/O 或本地执行的回答都有可复现 project/stage 证据链。
- [x] Python 分类策略可通过 fixture 独立测试和调参，TypeScript 不维护并行复杂度判断算法。
- [x] 多阶段 project 的 runtime handoff 能在失败、空结果、用户追加约束后从最近 stage 继续；backend 若遗漏采用/延后/拒绝声明，会被 guidance adoption guard fail closed 到 repair-needed。

验收命令：

- `npx tsc --noEmit`
- `node --import tsx --test src/runtime/gateway/guidance-adoption-guard.test.ts`
- `node --import tsx --test src/runtime/task-projects.test.ts`
- `node --import tsx --test src/runtime/gateway/context-envelope.test.ts`
- `npx tsx tests/smoke/smoke-t097-execution-mode-matrix.ts`
- `npx tsx tests/smoke/smoke-agentserver-handoff-current-turn.ts`
- `python3 -m pytest packages/conversation-policy-python/tests`

### T096 WorkEvidence 结构化证据与通用恢复守门

状态：已完成本轮验收，继续观察真实 provider 字段漂移。本任务承接外部检索失败被伪装成成功结果的问题，目标是在不重写 agent backend 通用 search/fetch/read/command 能力的前提下，让 SciForge 提供一层薄的结构化证据 contract、失败归一化和 runtime guard。Agent backend 继续负责推理、选择 provider、制定 fallback 策略；SciForge 只负责把关键执行事实整理成低噪声、可审计、可恢复的信息，并阻止“空结果/缺证据/失败被吞掉”进入成功状态。

字段边界补充：WorkEvidence 的通用字段是 `kind`、`status`、`provider`、`input`、`resultCount`、`outputSummary`、`evidenceRefs`、`failureReason`、`recoverActions`、`nextStep`、`diagnostics`、`rawRef`。`diagnostics` 和 `outputSummary` 只放低噪声事实，raw stdout、HTTP body、网页正文和长日志必须留在 refs。TaskStage 可以嵌入 `workEvidence` 摘要，但 TaskStage 不是 WorkEvidence，避免让 project schema 和 evidence schema 互相冒充。

与 T097 的关系：T096 是证据 schema、guard 和失败归一化层；T097 是任务复杂度路由和多阶段 project runtime 层。T096 不决定任务是否要拆成多阶段，也不维护复杂度算法；T097 不重新定义证据字段或失败语义，而是在每个 stage 边界调用 T096 的 WorkEvidence contract。

核心原则：

- SciForge 不维护领域专用搜索策略，不硬编码某个 provider、某个 scenario 或某条 prompt 的答案；只定义通用证据形状、失败语义和恢复边界。
- Backend 可以使用自己的原子工具和通用能力，但返回给 SciForge 的 search/fetch/read/write/command/validate 结果必须能被归一成 provider/query/status/resultCount/evidenceRefs/failureReason/recoverActions 等可审计字段或摘要。
- 可复现性优先于纯直答：凡是依赖新外部检索、本地文件、命令或产物生成的回答，默认应留下可运行任务、输入、输出、日志和证据 refs；轻量查询也应是薄 adapter/spec，而不是不可复现的临场自然语言回答。
- 轻量查询的优化目标不是绕过写代码，而是避免为一次性搜索生成重型 pipeline：优先复用稳定 runtime capability 或生成最小 adapter，限制 provider 数、结果数、超时、下载范围和输出体积。
- Raw stdout、HTTP body、网页正文和长日志继续保存在 workspace refs；handoff 给 agent 的默认内容应是结构化摘要、证据引用和可行动 nextStep。
- 外部检索、下载、API 调用、数据库查询等 I/O 任务如果没有明确失败诊断、provider status、fallback 尝试或可信空结果说明，不得被标记为高置信成功。
- Python 负责证据相关策略解释、repair/continuation 决策和可调规则；TypeScript 负责 runtime 执行壳里的事件适配、schema 校验、guard 调用、ref 持久化和 UI 投影。
- WorkEvidence 是跨 provider、跨 scenario、跨 backend 的通用 contract；不得为单一 provider、scenario、prompt 或固定错误文本增加专用成功/失败规则。

Todo：

- [x] 新增通用 `work-evidence-guard`：对 ToolPayload 做跨领域 evidence 检查，先覆盖“外部检索返回 0 结果但缺少 provider status / fallback / failed-with-reason”的 repair-needed 守门。
- [x] 将 generated task runner 接入 evidence guard：schema 合法、exitCode 为 0 但证据不足的检索结果也进入 repair，而不是展示为成功。
- [x] 为 generated task runner guard 增加 attempt history / repair smoke：覆盖 exitCode=0 且 0 result 无诊断进入 repair-needed、0 result 有 provider/fallback 诊断放行、command failed evidence 进入 repair-needed、正常 generated task 放行，并验证 refs 与 `failureReason` 保留。
- [x] 在 AgentServer generation/repair prompt 中补充外部 I/O reliability contract：要求 bounded timeout、retry/backoff、provider status、fallback 记录、失败时写 `failed-with-reason` ToolPayload。
- [x] 定义 runtime-side `WorkEvidence` schema：覆盖 `kind`、`status`、`provider`、`input`、`resultCount`、`outputSummary`、`evidenceRefs`、`failureReason`、`recoverActions`、`nextStep`、`diagnostics`、`rawRef`，作为 UI WorkEvent 之外的审计/恢复真相源。
- [x] 新增 TypeScript backend tool event adapter：把 Codex/Claude/Gemini/Hermes/OpenTeam Agent 等 backend 的通用 search/fetch/read/command/validate tool stream 归一成 `WorkEvidence`，UI 的 `WorkEventKind` 优先消费该结构或降级到现有文本 classifier；不按 provider/scenario/prompt/固定错误文本写专用分支。
- [x] 将 `WorkEvidence` 摘要写入 Task Project stage 记录和 bounded handoff，让 agent backend 能从 project/stage 继续读取低噪声执行事实。
- [x] 将 `WorkEvidence` 摘要继续接入 attempt history / repair context 全链路，避免 repair/continuation 反复读取 raw logs。
- [x] 将轻量可复现 adapter 的证据要求沉淀为 WorkEvidence guard fixture；执行模式选择、是否走 adapter 或 Task Project 归 T097 处理。
- [x] 扩展 guard：覆盖 claim 声称 verified 但无 evidence refs、command exitCode 非 0 却成功、fetch timeout/429 被吞、artifact 缺少 dataRef/schema 字段等通用假成功模式。
- [x] 增加 runtime WorkEvidence schema 与 guard 单测：覆盖每个 guard、schema 校验和正常放行路径，并通过 `node --import tsx --test src/runtime/gateway/work-evidence-guard.test.ts` 与 `npx tsc --noEmit`。
- [x] 增加 T096 端到端 fixture：模拟外部 provider 429、timeout、空结果、fallback 成功和 fallback 耗尽，验证 WorkEvidence、最终 payload 状态、attempt history、repair context 和下一轮 context envelope 都能表达真实状态；不重复覆盖 T097 execution mode 路由。
- [x] 扩展真实 AgentServer/backend stream smoke：经 `runWorkspaceRuntimeGateway`、AgentServer `/runs/stream` 协议和 UI runtime callbacks 验证 backend tool/provider events 可被通用 adapter 归一成 WorkEvidence，并进入 direct payload guard、attempt history、repair context、context envelope 和 UI process events。

验收标准：

- [x] Agent backend 仍负责策略和推理；SciForge 只提供证据归一化、失败守门、artifact/ref 持久化和恢复上下文，并保留可复现任务证据链。
- [x] 外部检索类任务在缺少 provider status/fallback/failure 证据时不会被标记为成功。
- [x] 下一轮 repair/continuation 能看到结构化 WorkEvidence 摘要，并据此换 provider、调整 query、请求用户补充或诚实失败；真实 AgentServer stream fixture 已覆盖 provider 429、timeout、empty result、fallback success、fallback exhausted 的 direct backend path。
- [x] 外部 I/O 的 `success` / `partial` / `empty` WorkEvidence 必须带 durable `evidenceRefs` 或 `rawRef`；无 ref 的 direct backend 成功会进入 `repair-needed`，避免不可复现直答伪装成可审计结果。

验收命令：

- `npx tsc --noEmit`
- `node --import tsx --test src/runtime/gateway/backend-tool-work-evidence-adapter.test.ts`
- `node --import tsx --test src/runtime/gateway/work-evidence-guard.test.ts`
- `node --import tsx --test src/ui/src/streamEventPresentation.test.ts`
- `npx tsx tests/smoke/smoke-t096-work-evidence-provider-fixtures.ts`

剩余风险：

- 已覆盖本地 AgentServer stream 协议、runtime direct payload path、stream `WorkEvidence` 到 UI `WorkEvent` atoms 的结构化优先链路，以及 snake_case、nested input/arguments/params、nested response/provider_status/request 字段漂移；长期真实 provider 运行中仍需把新增字段变体继续收敛到通用 adapter。
- Backend tool stream 到 WorkEvidence 的通用 adapter 已覆盖 search/fetch/read/command/validate 事实；低噪声摘要质量仍依赖 backend 是否提供 query/url/status/resultCount/ref 等结构化字段。
- 轻量 adapter 的证据要求已有 guard 与 runtime fixture 覆盖；无 durable refs 的外部 I/O 成功已会 repair-needed，剩余风险是产品运行中 backend 可能给出语义很弱但格式合法的 refs，需要靠后续审计质量测试收敛。

### T095 主对话栏 WorkEvent 原子事件层

状态：已完成本轮实现，继续跟踪后续增强。本任务承接 Cursor Agent 对标体验修复：主对话栏不直接平铺 raw stream，而是先把后台事件归纳成可复用的原子 WorkEvent，再由统一 presenter 决定“显示一句过程摘要、折叠详细内容、二级折叠 raw output”。目标是让复杂多轮任务，例如“检索最近一周 AI + 虚拟细胞的文章，并写总结报告”，在运行中持续显示 `Explored...`、`Searched...`、`Fetched...`、`Read...`、`Wrote...`、`Ran...`、`Waiting...` 等可理解摘要，同时避免把上下文窗口、usage、AgentServer JSON 和脚本 payload 直接淹没主对话。

实现语言原则：

- TypeScript 负责 UI 事件壳、stream presenter、React 展示策略和前端 fixture tests，因为这些逻辑紧贴浏览器主对话栏和 TS domain contract。
- Python 继续作为算法/策略唯一真相源，后续若要让 backend 主动发出结构化 work event hints，应落在 `packages/conversation-policy-python` 或 runtime policy bridge 中；TypeScript 只消费 schema，不复制长期策略算法。
- 原子事件必须是通用 schema / classifier / summarizer / display policy，不得按固定 prompt、固定 scenario、固定工具名、固定 DOM 或固定论文任务做特例补丁。

Todo：

- [x] 定义主对话栏原子事件分类：`plan`、`explore`、`search`、`fetch`、`read`、`write`、`command`、`wait`、`validate`、`artifact`、`recover`、`diagnostic`、`message`、`other`。
- [x] 新增 `src/ui/src/workEventAtoms.ts` 单文件原子事件层：集中维护事件类型、分类、摘要、raw 格式化和主对话栏可见性，后续针对 Search/Read/Fetch 等事件加强时只改这一处。
- [x] 改造 `streamEventPresentation.ts`：保留现有对外 API，但内部使用 WorkEvent 模块生成 worklog counts、operation line、raw output 和 summary，避免大文件继续堆分类规则。
- [x] 改造 `RunningWorkProcess.tsx`：运行中主对话栏只展示最近的高价值操作摘要；详细事件默认折叠，raw output 二级折叠。
- [x] 覆盖通用 fixture：AgentServer taskFiles payload 被显示为简洁写入摘要，不泄露脚本 JSON；上下文窗口和计划事件不进入 running live rows；搜索/读取/写入/执行/等待都有稳定摘要。
- [ ] 后续让 Python conversation policy/runtime 在合适时机发出结构化 `workEvent` hints，减少 TypeScript 对自然语言和 raw tool 文本的启发式归类。
- [ ] 扩展 `validate`、`artifact`、`recover` 的真实端到端 fixture：覆盖验收、产物引用、失败恢复和多轮追问上一轮对象。
- [x] 增加 browser smoke：用通用结构化 running work fixture 验证主对话栏 running 摘要、默认折叠、raw output 二级折叠和最终回答优先级；右侧结果栏对象渲染另行跟踪。

验收标准：

- [x] 主对话栏工作过程展示由原子事件模块驱动，不依赖单一任务或固定场景。
- [x] 默认视图可感知 agent 工作过程，但不平铺 raw JSON、长 stdout 或上下文诊断。
- [x] 相关 unit tests、typecheck 和生产 build 通过。
