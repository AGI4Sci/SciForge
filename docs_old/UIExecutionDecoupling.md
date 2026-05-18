# UI / Execution Decoupling

最后更新：2026-05-17

状态：partial foundation / in_progress（2026-05-17）。当前代码已经有 `ConversationProjection`、artifact delivery、workspace preview、run/audit refs、最小 `ProjectionApi` / `UserActionApi` / `ProjectionSubscriptionApi` 类型入口、UI action boundary、manual preview action、selected-object action、recover/cancel/approval/open-debug-audit action、最小 `CapabilityPlanSummary` projection 和部分 `completion-candidate` projection 读取；generated task pre-output / parse-output failure 已能产生 `completionCandidate`。默认消息 key info、evidence rows、execution detail 和折叠审计空态会 scrub `ToolPayload` / `taskFiles` / `stdout/stderr` / `raw payload` 等内部术语，避免普通主界面把 raw/debug contract 当用户答案展示。`WorkspaceObjectPreview` 的大文件手动加载会先走 `UserActionApi.loadArtifactPreview` 记录 typed action，workspace preview hydration 已下沉到可替换的 `ArtifactPreviewHydrationApi` adapter；ResultsRenderer 的选择类 object actions 会先走 `UserActionApi.selectObject`，recover buttons 会先走 `UserActionApi.triggerRecover`，运行细节展开和 CapabilityPlanSummary 的能力发现记录折叠区都会先走 `UserActionApi.openDebugAudit`，再交给 workbench 记录 typed action。但 UI 还没有整体迁移为只消费 ProjectionApi，默认 hydration adapter 仍会访问 workspace preview client，CapabilityPlanSummary 已接入默认 ResultsRenderer 能力计划卡，通用 AgentServer handoff / `tool_payload.json` salvage import/verify transaction 尚未闭环，canonical projection scrub/conformance 也还需继续扩展。本文定义目标边界，不表示当前代码已经完整实现。

## 目标

SciForge 的网页端应是一个薄操作台，而不是执行层解释器。UI 不应该理解 AgentServer 原始输出、stdout/stderr、handoff 漂移、ToolPayload 细节或某个 scenario 的内部规则；UI 只通过稳定函数读取投影、预览 artifact、订阅状态和发起用户动作。

核心目标：

- UI 只展示 canonical projection，不从 raw execution output 猜主结果。
- 用户干预必须函数化，例如选择 artifact、加载预览、重试、批准、切换能力偏好、取消运行。
- 执行层只产生日志、事件、artifact、ExecutionUnit、verification 和 completion candidate，不直接决定 React 组件怎么渲染。
- Projection/Presentation 层把 runtime ledger 归一化为 UI 可消费对象。
- API 先定义为进程内函数 contract，不绑定 HTTP、WebSocket、IPC、MCP 或本地文件协议；传输只是实现细节。

## 分层边界

```text
UI Shell
  reads ProjectionApi functions
  emits UserActionCommand functions

Projection / Presentation Service
  derives stable view models from ledger, refs, artifacts and verification
  owns result ordering, preview policy and debug folding

Runtime Ledger
  append-only facts: turns, runs, execution units, artifacts, verification, failures, finalization

Execution Orchestrator
  dispatches AgentServer, capability gateway, generated tasks and repair loops

Agent / Tools / Skills
  reason and execute through controlled capabilities
  never directly decide UI state
```

The UI consumes `Projection`, `ArtifactPreview`, `RunSummary`, `CapabilityPlanSummary` and `UserActionResult`. It must not consume backend stream text, raw ToolPayload, task attempts, stdout/stderr, handoff JSON or workspace files as primary state.

## 函数式 API

这些 API 是语义 contract，不是 HTTP 路由。它们可以由 in-process TypeScript、RPC、HTTP、WebSocket、worker bridge 或本地 runtime 实现，但调用方只依赖函数签名和返回对象。

### Read API

```ts
interface ProjectionApi {
  getConversationProjection(input: {
    sessionId: string;
    focusedRunId?: string;
  }): Promise<ConversationProjectionView>;

  listRuns(input: {
    sessionId: string;
    filter?: 'all' | 'active' | 'recoverable' | 'completed' | 'failed';
  }): Promise<RunSummary[]>;

  getRunProjection(input: {
    runId: string;
  }): Promise<RunProjectionView>;

  getArtifactPreview(input: {
    artifactRef: string;
    mode?: 'summary' | 'inline' | 'manual-load' | 'raw';
    byteLimit?: number;
  }): Promise<ArtifactPreview>;

  getExecutionTrace(input: {
    runId: string;
    audience: 'user' | 'debug' | 'audit';
  }): Promise<ExecutionTraceView>;

  getCapabilityPlanSummary(input: {
    sessionId: string;
    runId?: string;
  }): Promise<CapabilityPlanSummary | undefined>;
}
```

### Action API

```ts
interface UserActionApi {
  submitTurn(input: {
    sessionId: string;
    text: string;
    selectedRefs?: string[];
    userPreferences?: UserPreferencePatch;
  }): Promise<UserActionResult>;

  selectObject(input: {
    sessionId: string;
    objectRef: string;
    intent: 'inspect' | 'ask-followup' | 'compare' | 'pin';
  }): Promise<UserActionResult>;

  loadArtifactPreview(input: {
    sessionId: string;
    artifactRef: string;
    byteLimit?: number;
  }): Promise<ArtifactPreview>;

  requestRetry(input: {
    runId: string;
    reason?: string;
    scope: 'same-input' | 'with-repair-evidence' | 'rediscover-capabilities';
  }): Promise<UserActionResult>;

  triggerRecover(input: {
    runId: string;
    recoverAction: string;
  }): Promise<UserActionResult>;

  approveResult(input: {
    runId: string;
    approval: 'human-approved' | 'reject-result';
    note?: string;
  }): Promise<UserActionResult>;

  updateCapabilityPreference(input: {
    sessionId: string;
    preference: CapabilityPreferencePatch;
  }): Promise<UserActionResult>;

  openDebugAudit(input: {
    sessionId: string;
    runId?: string;
  }): Promise<UserActionResult>;

  cancelRun(input: {
    runId: string;
    reason?: string;
  }): Promise<UserActionResult>;
}
```

### Subscribe API

```ts
interface ProjectionSubscriptionApi {
  subscribeProjection(input: {
    sessionId: string;
    focusedRunId?: string;
  }, onEvent: (event: ProjectionEvent) => void): Unsubscribe;
}
```

Subscription events are presentation events, not raw backend stream events. They may say “run entered repair-needed” or “artifact preview is ready”; they should not leak prompt fragments, tokens, stdout, stderr, auth, provider endpoints or unbounded handoff payloads.

## Canonical View Models

```ts
type ConversationProjectionView = {
  sessionId: string;
  visibleAnswer: {
    status: 'running' | 'satisfied' | 'needs-work' | 'repair-needed' | 'needs-human' | 'failed';
    text: string;
    primaryArtifactRefs: string[];
    nextActions: UserActionDescriptor[];
  };
  focusedRun?: RunSummary;
  artifacts: ArtifactCard[];
  verification: VerificationSummary;
  debugAvailable: boolean;
};

type ArtifactPreview = {
  artifactRef: string;
  status: 'ready' | 'requires-manual-load' | 'too-large' | 'unavailable' | 'unsupported';
  title: string;
  mediaType?: string;
  sizeBytes?: number;
  preview?: string;
  structuredData?: unknown;
  actions: UserActionDescriptor[];
  sourceAction?: UIAction;
};

type UserActionResult = {
  accepted: boolean;
  projection?: ConversationProjectionView;
  queuedRunId?: string;
  message?: string;
  auditRef?: string;
};
```

## 运行完成态

UI 不能用 Agent 最后一段文本判断任务完成。完成态必须来自 runtime transaction：

```text
artifact.write / artifact.import
  -> execution_unit.record
  -> verification.record
  -> run.finalize or completion-candidate
  -> projection.derive
  -> UI render
```

如果 Agent 已经把 `tool_payload.json` 或 artifacts 写入 workspace，但没有通过正式 handoff 返回，runtime 应进入 `completion-candidate`，由 Projection Service 暴露“发现可用结果，待导入/验证/确认”的用户动作，而不是让 UI 只显示 contract failure。

## 用户干预

用户动作必须变成明确 command：

- “加载大文件预览” -> `loadArtifactPreview(...)`
- “只基于这个 artifact 继续问” -> `selectObject(..., intent: 'ask-followup')`
- “重新运行” -> `requestRetry(..., scope: 'same-input')`
- “带修复证据重试” -> `requestRetry(..., scope: 'with-repair-evidence')`
- “重新发现能力” -> `requestRetry(..., scope: 'rediscover-capabilities')` 或 `updateCapabilityPreference(...)`
- “接受未验证结果” -> `approveResult(..., approval: 'human-approved')`

UI 不拼 repair prompt，不直接改 run 状态，不直接写 workspace artifact，也不从 debug 文本提取 refs。

## 与 Capability Discovery 的关系

Capability Discovery 负责回答“需要哪些能力”。UI / Execution Decoupling 负责回答“发现和执行后的结果如何稳定展示和干预”。两者通过函数边界连接：

```text
capability_discovery.plan(...)
  -> CapabilityPlanSummary
  -> ProjectionApi.getCapabilityPlanSummary(...)
  -> UI shows concise plan
  -> UserActionApi.updateCapabilityPreference(...) when user changes preference
```

Discovery 的详细候选、分数、schema、provider readiness 默认属于 debug/audit。普通 UI 只展示简短计划、缺失权限和下一步动作。

## 实现任务

1. 定义 `ProjectionApi`、`UserActionApi` 和 `ProjectionSubscriptionApi` 的 TypeScript contract。
2. 将现有 workspace preview、run restore、artifact selection、retry/recover、config preference 收敛到这些函数。
3. 让 UI 组件只消费 canonical view models，不直接消费 raw run、raw ToolPayload、handoff JSON 或 stdout/stderr。
4. 增加 `completion-candidate` import/salvage 流程：合法 artifact / `tool_payload.json` 已存在时，runtime 可以生成候选 projection。
5. 将 large artifact preview 改成 `requires-manual-load` action，而不是组件内部猜读取策略。
6. 将 debug/audit 折叠由 Projection Service 统一决定。
7. 添加 conformance：
   - UI state can be restored only from projection functions;
   - raw AgentServer text cannot become visible answer directly;
   - user retry/select/load/approve actions always go through `UserActionApi`;
   - completion candidate with valid artifacts is discoverable without marking false success;
   - no secret, endpoint, stdout/stderr or raw handoff leaks in default projection.
