# Capability Discovery

最后更新：2026-05-17

状态：partial backend retry consumption + ledger replay refs + default UI summary card + debug folding / blocked-on-P1-P6-browser-validation（2026-05-17）。当前代码已经提供 `capability_discovery.search/expand/plan/explain` 的 TypeScript contract 与 runtime service、核心 manifest、AgentServer tiny handoff brief、generated-task authoring guidance、generated-task helper 调用桥、AgentServer stream-side tool-call -> tool-result bridge、session-bundle audit record / workspace ledger replay ref 持久化和 targeted tests。生成任务可通过 `invoke_capability(task_input, "capability_discovery.search|expand|plan|explain", input)` 做 bounded progressive disclosure；AgentServer stream 若发出 `capability_discovery.*` tool-call，Gateway 会执行 discovery、发出 `tool-result`、写入 sanitized audit record，并 append `sciforge.workspace-ledger-event.v1` 到 session bundle `ledger/events.jsonl`，同时保持 `completionEvidence=not-evidence`。如果单向 stream 只返回 discovery tool-call 而没有终态结果，AgentServer generation dispatch 会 retry 一次，并把压缩后的 `capabilityDiscoveryToolResults` 放入 context envelope、generation request、input/runtime metadata，供 backend 在第二次请求中消费。`ProjectionApi.getCapabilityPlanSummary` 已能从 discovery tool-result 的 search/plan 结果生成最小用户摘要并过滤 debug refs，默认 Results UI 已接入能力计划卡；能力发现记录已折叠进 debug/advanced UI，并通过 `UserActionApi.openDebugAudit` 语义动作记录安全 refs。剩余缺口是真实 P1-P6 browser 验收。

## 目标

Capability Discovery 是 SciForge 从“场景配置系统”走向“通用聊天工作台”的关键薄腰。它回答的问题不是“现在有哪些工具列表”，而是：

```text
为了真正解决当前用户目标，agent 还需要了解哪些能力？
这些能力是否可用、需要什么权限、如何组合、缺什么 provider 或证据？
```

它本身应作为一个原子 capability 暴露给 AgentServer/backend，而不是由 runtime 写死固定触发时机。Agent 在发现当前 compact capability brief 不足、任务需要专业组件、provider 失败、验证失败或 selected refs 暗示新能力时，主动调用 discovery API。

## 当前代码基础

已有基础：

- `CapabilityManifest` 和 core/package manifest registry。
- manifest 到 harness candidate 的投影。
- provider availability / preflight / public route projection。
- capability broker compact brief 和 lazy expansion 的雏形。
- generated task 中的 `invoke_capability(...)` authoring path。
- harness stages：`selectCapabilities`、`onBeforeCapabilityBroker`、`onAfterCapabilityBroker`、`onToolPolicy`、`onBudgetAllocate`。

已部分落地：

- 稳定的 `capability_discovery` contract/types：`packages/contracts/runtime/capability-discovery.ts`。
- 核心 `capability_discovery` manifest：`packages/contracts/runtime/capability-manifest.ts`。
- `CapabilityDiscoveryService`：`src/runtime/capability-discovery.ts`，基于 manifest registry 与 broker 实现 `search/expand/plan/explain`。
- 初始 AgentServer handoff / prompt tiny brief：`src/runtime/gateway/context-envelope.ts` 与 `src/runtime/gateway/agentserver-generation-prompts.ts`。
- AgentServer stream-side tool transport：`src/runtime/gateway/capability-discovery-tool-transport.ts` 与 `src/runtime/gateway/agentserver-stream.ts` 可解析 `capability_discovery.*` tool-call，执行 service，发出 `tool-result`，写入 session-bundle audit record，并 append workspace ledger replay event。
- Backend retry consumption bridge：当当前 HTTP NDJSON stream 只产出 discovery tool-call 且没有终态结果时，`agentserver-generation-dispatch` retry 一次，并携带 compact `capabilityDiscoveryToolResults`，让 backend 在下一次 handoff 中继续推理。
- generated-task authoring guidance：`packages/skills/runtime-policy.ts` 与 generated task input 中的 `capabilityDiscovery` tiny brief。
- generated-task helper bridge：`sciforge_task.invoke_capability(..., "capability_discovery.search|expand|plan|explain", ...)` 可从 bounded task routes 产出 search/expand/plan/explain 结果；该桥不执行用户任务，仍要求真实工作走 capability route。
- leakage guard：discovery 输出与 prompt compaction 不暴露 auth、endpoint、workspace roots、raw provider internals；expand 只返回 public provider shape。
- targeted tests 覆盖 search-only、expand-selected、plan missing provider/permission、no-secret/no-endpoint/no-workspace-root leakage、tiny handoff brief、generated-task authoring、generated Python helper invocation、AgentServer stream tool-result/audit bridge 和 discovery not-evidence。

阻塞缺口：

- 当前 HTTP NDJSON stream 仍是单向协议，不声称支持同一 stream 回合内的真正双向 tool response；现阶段的消费 contract 是 bounded retry handoff，把 compact discovery tool results 作为下一次 backend 请求输入。
- `capability_discovery` core manifest、generated-task helper bridge、stream-side tool-result bridge、retry consumption bridge 和 session ledger replay event 已落地；但不能只因 tool-result/retry/ledger ref 可见就判定 UI summary 和真实 browser 任务都已闭环。
- `ProjectionApi.getCapabilityPlanSummary` 已能基于 persisted/attached discovery tool-result 生成普通用户摘要；默认 ResultsRenderer 已接入能力计划卡，高级调试折叠已通过 `UserActionApi.openDebugAudit` 接入语义动作边界。
- discovery audit refs 当前可写入 session-bundle records，并通过 `ledger/events.jsonl` 进入 workspace ledger/replay 索引。
- 自进化扩展点已预留，但尚未从 execution traces、provider failures、verification feedback、repair outcomes 中训练复杂排序系统。

## 核心原则

- Discovery 不执行用户任务，只发现、解释、展开和规划能力。
- Discovery 不替代 backend 推理。它提供候选和约束，最终任务规划仍由 backend 完成。
- Discovery 不替代 `Gateway.execute`。真正执行必须走 `invoke_capability` / Capability Gateway。
- Discovery 必须 progressive disclosure，不能把完整 registry、schema、examples、provider endpoint 或 secret 注入初始 prompt。
- Runtime/harness 不硬编码所有触发时机，只提供 discovery API brief、预算、权限、安全和审计兜底。
- Discovery 的推荐不构成完成态证据。完成态仍由 artifact、WorkEvidence、verification 和 Projection 决定。

## Agent 行为模型

推荐链路：

```text
Initial handoff
  -> compact capability brief
  -> tiny capability_discovery API brief

Agent/backend
  -> tries to reason with current compact brief
  -> if insufficient / ambiguous / provider failed / verification failed
       call capability_discovery.search(...)
       optionally call capability_discovery.expand(...)
       optionally call capability_discovery.plan(...)
       use invoke_capability(...) or ask user for missing permission/input

Runtime/Gateway
  -> enforce budget, side effects, provider-first policy and no-secret rules
  -> write discovery audit refs
  -> project user-facing summary and debug details
```

## API Surface

### `search`

Purpose: lightweight candidate retrieval.

```ts
type CapabilitySearchQuery = {
  goal: string;
  currentContextRefs?: string[];
  selectedRefs?: string[];
  desiredArtifacts?: string[];
  constraints?: {
    latencyTier?: 'instant' | 'quick' | 'bounded' | 'deep' | 'background';
    allowedSideEffects?: string[];
    privacyProfile?: string;
    maxCandidates?: number;
  };
};

type CapabilitySearchResult = {
  contract: 'sciforge.capability-discovery.v1';
  discoveryRef: string;
  auditRef: string;
  candidates: Array<{
    capabilityId: string;
    title: string;
    brief: string;
    kind: string;
    confidence: number;
    availability: 'ready' | 'missing-provider' | 'unauthorized' | 'unavailable';
    why: string[];
    sideEffectClass: string;
    missing?: string[];
  }>;
  excluded: Array<{ capabilityId: string; reason: string }>;
  next?: Array<'expand' | 'plan' | 'ask-user' | 'invoke-capability'>;
};
```

### `expand`

Purpose: reveal details only for selected candidates.

```ts
type CapabilityExpandQuery = {
  capabilityIds: string[];
  include?: Array<'schemas' | 'examples' | 'providers' | 'validators' | 'repairHints' | 'failureModes'>;
  maxSchemaBytes?: number;
};
```

`expand` may return input/output schema summaries, examples, validator refs, public provider route shape and repair hints. It must not return auth, raw endpoint secrets or workspace roots.

`expand` output carries `contract`、`discoveryRef`、`auditRef`、`expanded` and `excluded` fields. Returned providers are public shape only: provider id/label/kind/source/transport/health/requiredConfig/permissions/fallback eligibility; no endpoint/auth/workspace root/command is returned.

### `plan`

Purpose: propose a capability composition without executing it.

```ts
type CapabilityPlanQuery = {
  goal: string;
  candidateIds: string[];
  contextRefs?: string[];
  budget?: {
    maxToolCalls?: number;
    maxWallMs?: number;
    maxProviders?: number;
  };
};
```

Plan output should include ordered steps, dependencies, fallback routes, missing permissions/providers, expected artifacts and user confirmations needed.

Plan output also includes `completionEvidence: 'not-evidence'` to prevent Projection or TaskOutcome from treating a recommendation as task completion.

### `explain`

Purpose: produce user/debug/audit explanation.

```ts
type CapabilityExplainQuery = {
  planId?: string;
  capabilityIds?: string[];
  audience: 'user' | 'debug' | 'audit';
};
```

User-facing explanation should be short: “将使用文献检索、PDF 阅读、引用核验和报告生成；需要联网和下载 PDF 权限。” Debug/audit explanation may include scores, excluded candidates and provider readiness.

## Initial Handoff Brief

Initial context should include only a tiny brief:

```json
{
  "capabilityDiscovery": {
    "status": "available",
    "api": ["search", "expand", "plan", "explain"],
    "progressiveDisclosure": true,
    "useWhen": [
      "current capability brief is insufficient",
      "task requires specialized tools, skills, views, verifiers, or providers",
      "provider, preflight, validation, or repair needs an alternate route",
      "selected refs imply capabilities not present in the compact brief"
    ],
    "safety": {
      "noSecrets": true,
      "noInternalEndpoints": true,
      "noWorkspaceRoots": true,
      "executionRequiresInvokeCapability": true
    }
  }
}
```

## Runtime Responsibilities

Runtime and harness should not decide every discovery trigger. They should:

- expose the API brief in handoff;
- constrain budgets and allowed side effects;
- enforce no-secret/no-endpoint leakage;
- record discovery query/result refs;
- prevent provider-first bypass during execution;
- surface a user-readable ability plan summary;
- fold detailed discovery audit into debug/advanced UI.

## UI Shape

UI / execution decoupling 的通用函数边界见 [`UIExecutionDecoupling.md`](UIExecutionDecoupling.md)。本节只描述 discovery plan 如何投影到这些函数返回的 canonical view model。

Default UI should show a small summary:

```text
SciForge 将使用：文献检索、PDF 阅读、引用核验、报告生成。
需要：联网、下载 PDF。
```

Advanced/debug UI can show:

- selected candidates;
- expanded manifests;
- provider readiness;
- excluded capabilities and reasons;
- discovery audit refs;
- plan dependencies and fallback routes.

## Implementation Tasks

1. [x] Add `capability_discovery` manifest and schemas.
2. [x] Add discovery service backed by existing registry, broker, provider preflight and harness candidate projection.
3. [x] Add Gateway stream-side invocation transport / AgentServer tool-call surface; [x] add bounded backend retry result consumption. Same-stream bidirectional tool response remains explicitly out of scope for this milestone.
4. [x] Add AgentServer handoff brief.
5. [x] Add deterministic audit/ref ids for discovery calls; [x] persist stream-call audit records to session bundle; [x] persist discovery refs to workspace ledger/replay index.
6. [x] Add generated-task/agent authoring instructions for calling discovery then `invoke_capability`.
7. [x] Add UI summary and debug folding: `ProjectionApi.getCapabilityPlanSummary` can summarize discovery tool-results; default ResultsRenderer card is wired; folded discovery refs go through `UserActionApi.openDebugAudit`.
8. [x] Add conformance tests:
   - search-only returns compact candidates;
   - expand only expands selected ids;
   - plan reports missing provider/permission;
   - no-secret/no-endpoint leakage;
   - discovery recommendation is not task success;
   - execution still requires `invoke_capability`.
