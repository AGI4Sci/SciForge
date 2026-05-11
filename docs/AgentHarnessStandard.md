# Agent Harness Standard

最后更新：2026-05-10

本文是 SciForge agent harness 的编程标准。它面向未来的 harness 研究和实现，作用类似 PyTorch Lightning 对训练循环、callbacks、profiles 和 logger 的标准化：研究者可以新增策略、实验 profile 和能力预算，但不能改散落的 gateway、prompt、UI 或 repair 分支。

## 目标

Agent harness 解决的问题不是“系统有什么能力”，而是“每一轮 agent 应该按什么生命周期、预算、上下文和验证规则使用能力”。

目标：

- 把探索预算、上下文选择、工具约束、能力偏好、验证强度、修复策略和用户可见进度集中到一个可版本化策略层。
- 让 runtime 主流程稳定，策略变化通过 profile/callback 注入。
- 让每次策略选择可审计，可复现，可比较。
- 支持不同研究 profile，例如 `fast-answer`、`research-grade`、`debug-repair`、`low-cost`、`privacy-strict`、`high-recall-literature`。
- 支持通用能力生态，而不是为某个 prompt、站点、provider 或 scenario 写隐藏 workflow。

非目标：

- Harness 不替代 agent backend 的推理、规划和胶水代码生成。
- Harness 不替代 capability manifest。能力声明仍由 capability registry 负责。
- Harness callback 不直接读写 workspace、不调用外部 API、不拼最终 prompt、不改 React state。

## 主逻辑

标准运行循环：

```text
raw request
  -> normalize GatewayRequest
  -> apply conversation policy as low-level facts/signals
  -> HarnessRuntime.evaluate()
       -> classify intent
       -> select profile
       -> select context
       -> allocate budgets
       -> select capability candidates
       -> build HarnessContract
       -> record HarnessTrace
  -> build context envelope from HarnessContract
  -> build capability broker brief from HarnessContract
  -> render prompt/payload from HarnessContract
  -> dispatch agent backend
  -> enforce stream/tool budgets
  -> validate result
  -> decide repair or finalization
  -> audit trace, ledger, verification refs and UI progress
```

Runtime owns lifecycle and enforcement. Harness owns decisions. Backend owns reasoning and composition.

## 核心对象

```ts
export interface HarnessRuntime {
  evaluate(input: HarnessInput): Promise<HarnessEvaluation>;
  dispatchHook(stage: HarnessStage, context: HarnessContext): Promise<HarnessDecision>;
}

export interface HarnessProfile {
  id: string;
  version: string;
  callbacks: HarnessCallback[];
  defaults: HarnessDefaults;
  mergePolicy: HarnessMergePolicy;
}

export interface HarnessCallback {
  id: string;
  version: string;
  stages: HarnessStage[];
  decide(context: HarnessContext): Promise<HarnessDecision> | HarnessDecision;
}

export interface HarnessEvaluation {
  contract: HarnessContract;
  trace: HarnessTrace;
}
```

`HarnessContext` 是 hook 的只读输入。它可以包含当前 turn、refs 摘要、scenario policy、conversation policy 输出、capability brief、runtime config、recent failure refs、budget state 和 prior trace 摘要。默认不包含完整文件正文、完整 stdout/stderr、历史 artifact 正文或 secrets。

`HarnessDecision` 是 hook 的局部输出。它只能表达策略，不执行工作：

```ts
export interface HarnessDecision {
  latencyTier?: 'instant' | 'quick' | 'bounded' | 'deep' | 'background';
  intentSignals?: TurnIntentSignals;
  contextHints?: ContextDecision;
  capabilityHints?: CapabilityDecision;
  budgets?: Partial<HarnessBudgets>;
  verification?: Partial<VerificationDecision>;
  repair?: Partial<RepairDecision>;
  progress?: Partial<ProgressDecision>;
  promptDirectives?: PromptDirective[];
  blockedRefs?: string[];
  blockedCapabilities?: string[];
  auditNotes?: HarnessAuditNote[];
}
```

`HarnessContract` 是本轮唯一行为契约。Context builder、broker、prompt renderer、validator、repair loop 和 UI 都消费这个 contract，而不是各自推断行为。

Latency tier 是本轮第一策略决策，优先于 context、capability、budget、verification、repair、progress 和 presentation 的默认值：

- `instant`：不调用外部工具，直接基于当前上下文回答。
- `quick`：允许少量工具调用，默认走 critical path，并尽快形成可读答案。
- `bounded`：允许明确工具链，但限制 Top-K、下载、验证和 repair 成本。
- `deep`：用户明确要求深入研究、复现、长报告或严格验证时启用。
- `background`：超过交互预算的工作转后台，前台先返回 partial/presentation。

Profile migration note：`balanced-default` now means fast-first `quick`/`bounded` behavior, while `research-grade` and domain deep profiles are explicit upgrades. Runtime trace must record the selected profile, module stack, latency tier, and why a deeper profile was or was not selected so historical balanced-heavy behavior is not treated as a regression.

AgentServer handoff 使用 metadata-only 交接面：

- payload metadata 必须带 `harnessProfileId`、`harnessContractRef`、`harnessTraceRef`、budget summary、decision owner。
- 结构化 `agentHarnessHandoff` 必须可从 `HarnessContract` 和 refs 重建。
- prompt text 不内联完整 contract、trace、promptDirectives 或 stage records。
- fresh/continuation/repair 的 refs 差异通过 contract/context refs 表达，并由 `npm run smoke:contract-driven-handoff` 覆盖。

## 分级 Hooks

Hooks 按层级组织。低层 hook 越靠近 runtime enforcement，高层 hook 越靠近策略研究。新增策略应优先作为 callback，而不是改主流程。

### Level 0: Runtime Lifecycle

| Hook | 作用 | 典型输出 |
| --- | --- | --- |
| `onRequestReceived` | 创建 trace、request id、基础 runtime facts | `traceId`, request metadata |
| `onRequestNormalized` | 接收标准 `GatewayRequest` | normalized facts |
| `onRunCompleted` | 记录完成态 | final audit summary |
| `onRunFailed` | 记录失败态 | failure audit summary |
| `onRunCancelled` | 区分用户取消、系统中断、timeout | cancel outcome |

### Level 1: Planning

| Hook | 作用 | 典型输出 |
| --- | --- | --- |
| `classifyIntent` | 给出 `fresh/continuation/repair/audit/file-grounded/interactive` 信号 | `intentMode`, confidence |
| `selectProfile` | 选择或覆盖 harness profile | profile id |
| `selectContext` | 选择允许/禁止/必需 refs | context refs |
| `setExplorationBudget` | 设定探索深度和上下文预算 | `minimal/normal/deep`, context budget |

Conversation policy 在这里是输入信号源，不是最终决策者。它输出 bounded facts、context isolation、digest、handoff compaction 和 conservative defaults；harness profile 可以采纳、覆盖或收紧。

### Level 2: Capability Planning

| Hook | 作用 | 典型输出 |
| --- | --- | --- |
| `onRegistryBuild` | 将 skills/tools/actions/observe/verifiers 投影成统一 manifest | registry facts |
| `selectCapabilities` | 输出候选能力和 broker policy | `HarnessCandidate[]` |
| `onBeforeCapabilityBroker` | 注入 scenario/user/history/provider/budget 信号 | broker input |
| `onAfterCapabilityBroker` | 审计 broker 结果和 lazy expansion | broker audit |
| `onToolPolicy` | 决定工具可见性、side effects 和 provider constraints | tool policy |
| `onBudgetAllocate` | 统一分配能力预算 | `CapabilityBudget` |

统一候选模型：

```ts
export interface HarnessCandidate {
  kind: 'skill' | 'tool' | 'observe' | 'action' | 'verifier' | 'view' | 'runtime-adapter' | 'composed';
  id: string;
  manifestRef: string;
  score: number;
  reasons: string[];
  providerAvailability?: ProviderAvailability[];
  budget?: Partial<CapabilityBudget>;
  fallbackCandidateIds?: string[];
}
```

默认 callback 链：

- `ScenarioPolicyCallback`
- `ProviderAvailabilityCallback`
- `SafetyPolicyCallback`
- `BudgetPolicyCallback`
- `HistoryPolicyCallback`
- `UserIntentOverrideCallback`

用户显式选择能力可以提高优先级，但仍必须通过安全、配置和预算 gate。

### Level 3: Dispatch

| Hook | 作用 | 典型输出 |
| --- | --- | --- |
| `beforePromptRender` | 把 contract 投影为少量 prompt directives | prompt directives |
| `beforeAgentDispatch` | 生成 AgentServer payload 前做最终 budget/metadata 检查 | dispatch metadata |
| `onAgentDispatched` | 记录 backend、model、payload refs | dispatch trace |

Prompt renderer 只能渲染 `HarnessContract.promptDirectives`。Fresh/continuity、workspace read policy、repair retry、tool-use policy 等不能继续散落在 prompt builder 字符串里。

### Level 4: Execution

| Hook | 作用 | 典型输出 |
| --- | --- | --- |
| `onAgentStreamEvent` | 归一化 backend stream，计量 token/usage/silence | stream trace |
| `onStreamGuardTrip` | 决定 retry/abort/visible status | guard decision |
| `beforeToolCall` | side-effect 和预算前置 gate | allow/block |
| `afterToolCall` | 记录 budget debit、refs、observations | budget debit |
| `onObserveStart` | 接入 observe provider invocation | observe audit |
| `onActionStepEnd` | 接入 action loop step trace | action audit |

Execution hooks 可以阻止、重试或 fail closed，但必须产出结构化 trace。它们不能偷偷改写用户目标或合成成功结果。

### Level 5: Validation and Repair

| Hook | 作用 | 典型输出 |
| --- | --- | --- |
| `beforeResultValidation` | 准备验证策略和 refs | validation context |
| `afterResultValidation` | 合并 schema/artifact/current-ref/work-evidence/verifier findings | `ValidationDecision` |
| `onRepairRequired` | 决定 repair/supplement/fail-closed/needs-human | `RepairDecision` |
| `beforeRepairDispatch` | 构建 compact repair context | repair context |
| `afterRepairAttempt` | 记录 rerun、diff、validation outcome | repair outcome |

所有失败路径必须形成同一链路：

```text
ValidationDecision
  -> RepairDecision
  -> RepairExecutor outcome
  -> AuditRecord
```

`ResultValidationHarness` 统一处理：

- ToolPayload schema
- artifact refs and materialization
- completed payload evidence
- current-turn reference usage
- WorkEvidence
- guidance adoption
- provided verification results
- runtime verification gate
- observe/action trace contract

`RepairPolicyHarness` 统一决定：

- `none`
- `repair-rerun`
- `supplement`
- `fail-closed`
- `needs-human`

Runner 只执行，不重新判断策略。

### Level 6: UX and Interaction

| Hook | 作用 | 典型输出 |
| --- | --- | --- |
| `beforeUserProgressEvent` | 生成标准 process-progress event | progress model |
| `beforeResultPresentation` | 生成结果呈现策略，不生成答案内容 | presentation plan |
| `onInteractionRequested` | 澄清、人工确认、运行中 guidance | interaction event |
| `onBackgroundContinuation` | 后台完成和可恢复状态 | background policy |
| `onCancelRequested` | 用户取消语义 | cancel decision |

UI 只能消费 stream event、`HarnessContract.presentationPlan`、runtime materialized `ResultPresentationContract` 和 refs，不直接推断任务语义。标准事件优先使用：

- `process-progress`
- `result-presentation`
- `interaction-request`
- `clarification-needed`
- `human-approval-required`
- `guidance-queued`
- `run-cancelled`

`ProgressPlan` 必须携带结构化策略，而不是只携带展示文案：

```ts
export interface ProgressPlan {
  initialStatus: string;
  visibleMilestones: string[];
  phaseNames?: string[];
  firstResultDeadlineMs: number;
  phaseDeadlines: Record<string, number>;
  backgroundAfterMs: number;
  silenceTimeoutMs: number;
  backgroundContinuation: boolean;
  silencePolicy?: SilencePolicy;
  backgroundPolicy?: BackgroundPolicy;
  cancelPolicy?: CancelPolicy;
  interactionPolicy?: InteractionPolicy;
}
```

`PresentationPolicyCallback` 属于 Level 6。它可以根据 `intentMode`、artifact/view 类型、validation outcome、failure category、user role/debug mode、当前 refs 摘要和 profile 生成展示层级、默认折叠策略、inline citation 密度和诊断可见性；它不能编写最终答案、读取 artifact 正文、拼 raw JSON，也不能在 UI 里补第二套语义判断。

```ts
export interface PresentationPlan {
  primaryMode: 'answer-first' | 'artifact-first' | 'failure-first' | 'diagnostic-first';
  status: 'complete' | 'partial' | 'needs-human' | 'background-running' | 'failed';
  defaultExpandedSections: PresentationSectionId[];
  defaultCollapsedSections: PresentationSectionId[];
  citationPolicy: CitationPolicy;
  artifactActionPolicy: ArtifactActionPolicy;
  diagnosticsVisibility: 'hidden' | 'collapsed' | 'expanded';
  processVisibility: 'hidden' | 'collapsed' | 'expanded';
  roleMode?: 'standard' | 'power-user' | 'debug';
}

export type PresentationSectionId =
  | 'answer'
  | 'key-findings'
  | 'evidence'
  | 'artifacts'
  | 'next-actions'
  | 'process'
  | 'diagnostics'
  | 'raw-payload';

export interface ResultPresentationContract {
  schemaVersion: 'sciforge.result-presentation.v1';
  status: 'complete' | 'partial' | 'needs-human' | 'background-running' | 'failed';
  answerBlocks: PresentationBlock[];
  keyFindings: PresentedFinding[];
  inlineCitations: InlineObjectReference[];
  artifactActions: ArtifactAction[];
  confidenceExplanation?: string;
  nextActions: PresentationAction[];
  processSummary?: PresentationBlock[];
  diagnosticsRefs: string[];
  defaultExpandedSections: PresentationSectionId[];
  sourceRefs: {
    harnessContractRef: string;
    validationRef?: string;
    payloadRef?: string;
    artifactRefs: string[];
    verificationRefs: string[];
  };
}
```

字段 ownership 规则：

- backend/payload 提供可读答案、claim、artifact refs、failure reason 和 recover action 的内容。
- runtime materializer/validator 补齐稳定 refs、locator、artifact action、verification state、缺证标记和 diagnostics refs。
- harness `PresentationPolicyCallback` 只决定哪些层级默认可见、哪些默认折叠、引用如何贴近结论、失败时哪些恢复动作优先展示。
- UI 只渲染 `ResultPresentationContract`，并通过 refs 联动 Chat、Results/View pane、Notebook/Execution pane；不能根据 prompt、scenario id、artifact 文件名或自然语言关键词重判展示语义。

默认呈现约束：

- `answer`、`key-findings`、`evidence`、`artifacts`、`next-actions` 默认可见。
- `process`、`diagnostics`、`raw-payload` 默认折叠；标准用户模式下 raw payload 不应默认展开。
- 关键结论若没有 inline citation，必须明确标注为 unverified/speculative，或由 validator 产生 presentation warning。
- 失败或 partial result 默认可见 failure reason、impact、recover actions 和证据 refs；backend/model、task id、stdout/stderr、schema diagnostics 仍进入折叠诊断层。

`cancelPolicy` 必须区分：

- `user-cancelled`
- `system-aborted`
- `timeout`
- `backend-error`

`silencePolicy` 是 UI、transport、backend silent watchdog 的唯一真相源。同一 run 只能有一条可审计 retry/abort/visible-status 决策。

离线 smoke `npm run smoke:interaction-progress-harness` 必须覆盖长任务沉默、用户取消、系统 abort、timeout、human approval 和 mid-run guidance 的稳定事件投影。UI/transport/backend 接入前也要先保证 contract/projection 可复现。

### Level 7: Audit and Research

| Hook | 作用 | 典型输出 |
| --- | --- | --- |
| `onPolicyDecision` | 记录 hook decision | trace entry |
| `onBudgetDebit` | 记录预算消耗 | budget ledger |
| `onVerifierVerdict` | 记录 verifier 结果 | verification ref |
| `onAuditRecord` | 写入 attempts、ledger、telemetry | audit record |

每个 hook 都必须能解释：

- 输入事实摘要是什么。
- 为什么做这个 decision。
- 它收紧或放宽了什么预算。
- 它阻止或允许了哪些 refs/capabilities/side effects。
- 最终 outcome 是什么。

每个新增 profile 或 callback 合入前必须通过 `npm run smoke:agent-harness-profile-coverage`：

- profile id、version、callback id 必须稳定且命名空间化。
- callback 必须声明非空 owned stages，且不能重复。
- 每个 profile 必须映射到一个最小实验 fixture。
- fixture replay 必须在 `HarnessTrace` 中实际命中该 profile 的 callback。
- profile/hook 行为变化还应通过 `npm run smoke:agent-harness-experiments` 或 `npm run smoke:agent-harness-replay` 更新 golden/metrics，而不是只改 prompt 文案。

## Contract Schema 草案

```ts
export interface HarnessContract {
  schemaVersion: 'sciforge.agent-harness-contract.v1';
  profileId: string;
  latencyTier: 'instant' | 'quick' | 'bounded' | 'deep' | 'background';
  intentMode: 'fresh' | 'continuation' | 'repair' | 'audit' | 'file-grounded' | 'interactive';
  explorationMode: 'minimal' | 'normal' | 'deep';
  allowedContextRefs: string[];
  blockedContextRefs: string[];
  requiredContextRefs: string[];
  contextBudget: ContextBudget;
  capabilityPolicy: CapabilityPolicy;
  toolBudget: CapabilityBudget;
  verificationPolicy: VerificationPolicy;
  repairContextPolicy: RepairContextPolicy;
  progressPlan: ProgressPlan;
  presentationPlan: PresentationPlan;
  promptDirectives: PromptDirective[];
  traceRef?: string;
}

export interface CapabilityBudget {
  maxWallMs: number;
  maxContextTokens: number;
  maxToolCalls: number;
  maxObserveCalls: number;
  maxActionSteps: number;
  maxNetworkCalls: number;
  maxDownloadBytes: number;
  maxResultItems: number;
  maxProviders: number;
  maxRetries: number;
  perProviderTimeoutMs: number;
  costUnits: number;
  exhaustedPolicy: 'partial-payload' | 'fail-with-reason' | 'needs-human';
}
```

## Merge Rules

Decision merge 必须 deterministic。

规则：

- `blockedRefs`、`blockedCapabilities`、`requiredContextRefs` 使用 set union。
- budget 只能收紧，不能放宽，除非 profile merge policy 明确允许。
- risk/verification 只能升级，不能降级，除非 human approval 已满足。
- side-effect allowance 默认 fail closed。
- prompt directives 必须带 `sourceCallbackId`，并由 renderer 去重、排序、裁剪。
- prompt render plan 必须保留 `sourceRefs.contractRef` / `sourceRefs.traceRef`、结构化 `renderedEntries` 和 deterministic `renderDigest`，使 prompt 策略句可以从 `HarnessContract` / `HarnessTrace` refs 重建，而不是只能从自然语言 prompt 反推。
- 冲突时保留更保守 decision，并写入 trace。

示例：

```text
privacy-strict blocks network
high-recall-literature requests network
=> merged contract blocks network unless selected profile explicitly says high-recall can override privacy-strict and records the override reason
```

## 最小实验案例

这些案例用于验证 harness 标准是否真的成为编程标准，而不是文档愿望。

### Experiment 1: Fresh Request Minimal Exploration

输入：

```text
帮我检索今天 arXiv 上 AI Agent 相关论文，并写总结报告
```

期望：

- `intentMode=fresh`
- `explorationMode=normal` 或由 `research-grade` 提升为 `deep`
- 默认不读取旧 `.sciforge/task-results`、旧 attempts、stdout/stderr、历史 artifacts 正文
- broker 偏好 `literature.retrieval`、PDF extraction、citation verification
- prompt 中 fresh/continuity 规则来自 `HarnessContract.promptDirectives`
- trace 中记录 context refs、capability budget 和 provider budget

通过标准：

- 没有 gateway/prompt/UI 分支为该 prompt 写特例。
- 空检索结果必须返回 failed-with-reason 或 partial payload，不能伪成功。

### Experiment 2: File-grounded Summary

输入：

```text
请总结这个 PDF，并列出关键图表
```

附带 explicit file ref。

期望：

- `intentMode=file-grounded`
- required refs 包含当前 file ref
- large document 只通过 digest/artifact refs 进入 prompt
- 若 ref 不存在，必须 fail honestly
- validation 检查 payload 是否使用当前 ref

通过标准：

- 不因历史报告存在而切到 continuation。
- 不把完整 PDF 文本塞进 prompt。

### Experiment 3: Repair After Validation Failure

输入：上一轮 generated task 输出缺少 artifact ref。

期望：

- `ValidationDecision.failureKind=artifact-ref`
- `RepairDecision.kind=repair-rerun` 或 `supplement`
- repair context 只含相关 code/output/stdout/stderr 摘要
- `AuditRecord` 连接原 validation failure、repair attempt、rerun result 和 final outcome

通过标准：

- generated-task runner 不自行重判 repair policy。
- 每个失败路径都有 `ValidationDecision -> RepairDecision -> AuditRecord`。

### Experiment 4: Silent Stream and Cancel

输入：长任务 backend 30 秒无事件，用户中途取消。

期望：

- `silencePolicy` 统一 UI、transport、backend guard
- 只产生一条 retry/abort/visible-status decision
- `cancelPolicy=user-cancelled`
- run 历史区别于 backend error 和 timeout

通过标准：

- UI 不靠 prompt 文案判断状态。
- stream presentation 根据结构化 progress/importance/status 投影。

### Experiment 5: Capability Budget Exhaustion

输入：高召回文献检索，但 budget 限制为低成本。

期望：

- `CapabilityBudget.maxProviders` 和 `maxDownloadBytes` 降低
- broker 记录 fallback candidates
- full text downloads 超预算时返回 partial payload 或 failed-with-reason
- executionUnits/workEvidence 包含 `budgetDebits`

通过标准：

- 预算不是 prompt 文案，而是 runtime 可执行约束。

## 标准包布局

建议 package：

```text
packages/agent-harness/
  src/contracts.ts
  src/runtime.ts
  src/profiles/
    balanced-default.ts
    fast-answer.ts
    research-grade.ts
    debug-repair.ts
    low-cost.ts
    privacy-strict.ts
  src/callbacks/
    context-policy.ts
    capability-policy.ts
    budget-policy.ts
    validation-policy.ts
    repair-policy.ts
    progress-policy.ts
  src/testing/
    harness-fixtures.ts
    fake-clock.ts
    trace-assertions.ts
```

Runtime adapters stay in `src/runtime/**`; reusable policy and contracts live in `packages/agent-harness`.

## 实施顺序

1. 建立 `packages/agent-harness` contracts、profile registry 和 trace schema。
2. 在 gateway 接入 `HarnessRuntime.evaluate()`，先只生成 contract 和 trace，不改变行为。
3. 让 context envelope、capability broker、prompt renderer、verification policy、progress event 逐步消费 contract。
4. 把 fresh/continuity prompt rule、silent watchdog、validation/repair decision、capability budget 从散落分支迁入 callback。
5. 增加 smoke：fresh minimal exploration、profile diff、validation-repair-audit chain、UI silence/cancel、capability budget exhaustion。
6. 增加 no-legacy guard：禁止新增散落 harness prompt prose、skill preference、tool budget 和 exploration rule。

## 编程守则

- 新增行为策略先写 callback/profile，不能先改 prompt string。
- 新增能力先写 capability manifest/provider/validator，不能写 harness 特例。
- 新增 UI 体验先写 structured event/progress policy，不能靠 ChatPanel prompt 判断。
- 新增 repair 路径先写 `ValidationDecision` 和 `RepairDecision`，不能在 runner 分支里写 if。
- 每个 profile 必须有最小实验 fixture 和 trace assertion。
- 每个 callback 必须声明 owned stages、input facts、decision fields、merge behavior 和测试覆盖。
