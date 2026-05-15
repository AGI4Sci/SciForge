# Project Session Memory

最后更新：2026-05-15

本文定义 SciForge 的本地项目记忆机制。它不是第二个 agent，也不是把完整聊天历史塞回 prompt；它是 workspace 侧的可审计事实账本、内容引用和上下文投影编译器。

核心结论：

```text
Workspace owns canonical truth.
AgentServer owns context orchestration.
Agent backend owns reasoning over a bounded task packet.
```

也就是说，用户本地 workspace 必须能完整恢复会话事实；AgentServer 负责按 policy、budget、backend 能力和检索需求把这些事实投影成 context；agent backend 只消费当前任务所需的稳定上下文和 refs，并在需要更多信息时调用受控 retrieval/read-ref 能力。

## 为什么需要本地 Project Session Memory

仅依赖 backend native thread 或 AgentServer 内部 memory 有三个问题：

- backend session、模型 thread 或 AgentServer 服务可能丢失、切换或压缩失败。
- 长会话中的大文件、日志、task code、artifact body 不适合长期留在 model context。
- 多 backend 编排时，需要一个 backend 无关的、可审计的会话真相源。

SciForge 因此维护本地 project-scoped ledger。AgentServer 的 context/core 能力仍然复用，但它不再是唯一可恢复来源；它是读取本地 ledger、生成 context packet、维护 context policy 和 compaction decision 的控制面。

## 设计原则

- **Append-only truth**：事实只能追加，不能原地改写。历史编辑、压缩、迁移、删除请求都写成新事件。
- **Large content by ref**：大文件、stdout/stderr、raw backend output、artifact body、task source 都卸载到文件系统，ledger 只记录 ref、digest、size、mime、summary 和 producer。
- **Projection is disposable**：`ConversationProjection`、context envelope、handoff packet、artifact index、failure index 都是可重建投影，不是事实源。
- **Agent backend reads on demand**：backend 默认拿小任务包；需要细节时通过 `retrieve`、`read_ref`、`workspace_search` 等受控能力读取。
- **Compression preserves audit**：压缩只新增 summary/constraint projection，不删除原文账本；所有压缩决策记录 trigger、scope、decision owner 和 source refs。
- **Cache-aware rendering**：优化目标不是单轮最小 token，而是稳定 prefix 最大化、uncached tail 最小化。
- **Human sovereignty**：永久删除、跨 session memory 提炼和敏感内容清理必须由用户确认。

## 三层模型

### 1. Append-only Ledger

Ledger 是会话事实真相源。建议落盘在：

```text
.sciforge/sessions/{sessionId}/ledger/events.jsonl
```

每条事件建议包含：

```ts
type ProjectSessionEvent = {
  schemaVersion: 'sciforge.project-session-event.v1';
  eventId: string;
  sessionId: string;
  turnId?: string;
  runId?: string;
  parentEventIds?: string[];
  createdAt: string;
  actor: 'user' | 'ui' | 'runtime' | 'agentserver' | 'backend' | 'worker' | 'verifier' | 'system';
  kind:
    | 'user-turn'
    | 'assistant-visible-message'
    | 'backend-dispatch'
    | 'backend-event'
    | 'execution-unit'
    | 'artifact-materialized'
    | 'verification-recorded'
    | 'failure-classified'
    | 'decision-recorded'
    | 'context-projection-recorded'
    | 'compaction-recorded'
    | 'history-edit-recorded'
    | 'human-approval-recorded';
  summary: string;
  refs: ProjectMemoryRef[];
  metadata?: Record<string, unknown>;
};
```

Ledger 记录“发生过什么”和“证据在哪里”。它不要求把每个 token 都保存成 prompt，也不要求每次 run 都重放完整历史。

### 2. Content-addressed Blob Store

大内容放在文件系统或现有 artifact/log/task-results 目录，ledger 引用它们。推荐 ref 元数据：

```ts
type ProjectMemoryRef = {
  ref: string;
  kind: 'artifact' | 'task-input' | 'task-output' | 'stdout' | 'stderr' | 'log' | 'source' | 'verification' | 'bundle';
  digest: string;
  sizeBytes: number;
  mime?: string;
  producerRunId?: string;
  preview?: string;
  readable?: boolean;
  retention?: 'hot' | 'warm' | 'cold' | 'audit-only';
};
```

路径可以继续使用现有 `.sciforge/sessions/.../task-results`、`logs`、`artifacts`、`verifications`、`handoffs`。新机制不要求搬迁历史文件；它要求这些文件都有稳定 ref 和 digest，并能被 ledger/event log 索引。

### 3. Context Projections

Projection 是从 ledger 派生的上下文视图：

```text
currentWork        最近仍有高价值的工作窗口
persistentState    当前 session 稳定目标、约束、决策、open questions
memoryCandidates   session 结束时可提炼为跨 session memory 的候选
artifactIndex      artifact/ref 的可见索引
failureIndex       failure signature、recover actions、next step
decisionLog        harness/context/repair/verification 决策摘要
```

Projection 可以压缩、重建、丢弃或迁移；只要 ledger 和 blobs 存在，会话就能恢复。

## AgentServer 的位置

AgentServer 不应该被降级成无状态转发器。它仍然是 context 编排控制面：

- 读取 workspace ledger 和 projection refs。
- 管理 `contextPolicy`、current work、recent turns、persistent/memory layers。
- 生成 backend-specific `BackendHandoffPacket`。
- 执行 context snapshot、compaction preview/apply、session finalize preview/apply。
- 暴露受控 retrieval primitives，例如 `retrieve`、`read_ref`、`workspace_search`。
- 记录每次 handoff 的 `contextRefs`、policy、budget、compaction 和 retrieval audit。

关键边界是：AgentServer 可以维护运行态 session context，但该状态必须能由 workspace ledger 重建或校验。backend native thread 不能成为唯一真相源。

### 与 AgentServer Context Core 对齐

AgentServer Core 文档中的 `CanonicalSessionContext`、`memory`、`persistent`、`currentWork`、`recentTurns`、`contextRefs` 和 `BackendHandoffPacket` 仍然是 SciForge 应复用的通用能力。Project Session Memory 不替代这些能力，而是给它们提供本地可恢复来源：

```text
workspace ledger/ref store
  -> AgentServer canonical session context
  -> contextRefs / retrieval chain / compaction decisions
  -> BackendHandoffPacket
  -> backend-specific harness
```

因此：

- AgentServer 的 canonical session context 是运行态 canonical context；workspace ledger 是可恢复事实源。
- `contextRefs` 应引用 ledger events、projection blocks、artifact refs 和 retrieval audit，而不是只引用自然语言摘要。
- AgentServer Core 负责 external auditable context；backend harness 可以继续使用自己的 prefix/work、stable/dynamic 或 compaction tag 策略。
- SciForge 不应该把 `context-harness.md` 中某个 backend 的内部 COMPACTION TAG 格式硬编码成项目公共协议；只能吸收信息守恒、决策透明、检索兜底、cache-aware rendering 这些通用原则。

## Backend Handoff Packet

Agent backend 默认不接收完整历史，而是接收一个小任务包：

```json
{
  "goal": "repair last bounded stop",
  "mode": "repair-continuation",
  "constraints": [
    "one minimal step only",
    "do not replay broad history",
    "use provider route or return failed-with-reason"
  ],
  "refs": [
    {"ref": "execution-unit:EU-...", "kind": "execution-unit"},
    {"ref": ".sciforge/.../stderr.log", "kind": "stderr"}
  ],
  "providerRoutes": [],
  "retrievalTools": ["retrieve", "read_ref", "workspace_search"],
  "expectedOutput": "minimal-repair-task | failed-with-reason ToolPayload"
}
```

如果 backend 需要细节，它必须按需读取 ref；读取行为进入 audit。这样可以最大程度复用 agent backend 的通用推理和文件探索能力，同时避免每轮把历史和日志重新塞进 context。

## KV Cache-Aware Projection Compiler

KV cache 复用要求“稳定前缀”比“总 token 小”更重要。Projection compiler 应按下面顺序渲染 context：

```text
1. Immutable Prefix
   system rules, runtime contract, ToolPayload schema, safety policy

2. Workspace Identity
   workspace id, cwd, allowed roots, artifact roots, checkedAt/version

3. Stable Session State
   goal, stable constraints, decisions, user preferences, open questions

4. Stable Index Blocks
   artifact index summary, run index summary, failure index summary

5. Current Task Packet
   current user request, mode, selected refs, blocker, provider routes

6. Retrieved Evidence
   read_ref/retrieve results for this turn only
```

工程规则：

- 动态字段后置：`runId`、`createdAt`、usage、latest error、progress、current blocker 不得插入稳定 prefix 前面。
- 稳定块按 `blockId + sha256` 复用；内容没变时字节级复用旧 block。
- 约束更新使用 append + `supersedes`，不要重写整段 summary。
- repair mode 只追加小的 `RecoveryPacket`，不重新渲染完整历史。
- retrieval 结果默认是本轮 tail evidence，不立即进入 stable state；run 结束后再提炼。
- compaction 决策看 `uncachedTailTokens`、`changedStableBlockTokens` 和 `stablePrefixTokens`，不只看总 token。

推荐 block 元数据：

```ts
type ContextProjectionBlock = {
  blockId: string;
  kind: 'immutable-prefix' | 'workspace-identity' | 'stable-session-state' | 'index' | 'task-packet' | 'retrieved-evidence';
  sha256: string;
  tokenEstimate: number;
  cacheTier: 'stable-prefix' | 'mostly-stable' | 'tail';
  sourceEventIds: string[];
  supersedes?: string[];
  createdAt: string;
};
```

## Compaction 和恢复

压缩不修改 ledger，只新增 projection 事件：

```text
ledger/events.jsonl
  append user/backend/runtime events forever

projection/current.jsonl
  may contain current raw window + partial compaction summaries

projection/persistent.jsonl
  stable session state, constraints, decisions, summaries

projection/memory-candidates.jsonl
  session-finalize candidates for cross-session memory
```

当 projection 超预算：

1. 先用 deterministic slimming：移除可按 ref 读取的大内容，保留 digest/ref/preview。
2. 再做 semantic compaction：生成 summary、constraints、open questions、failure signatures。
3. 记录 `compaction-recorded` 事件，包含 affected turn/event range、source refs、decision owner、reason 和 output projection refs。
4. 如果 persistent/memory 超预算，暂停并请求用户确认清理，不自动永久删除。

恢复顺序：

```text
current projection
  -> persistent session state
  -> ledger index
  -> blob/ref read
  -> AgentServer context snapshot
  -> workspace search
  -> ask human
```

## 与现有代码的落点

现有机制可以逐步演进，不需要一次性重写：

- `ConversationEventLog` 是 ledger 的种子形态。
- `.sciforge/sessions/**/records/*.json`、`task-results`、`logs`、`artifacts`、`verifications` 是 blob/ref store 的现有落点。
- `ConversationProjection`、`contextEnvelope`、`handoffMemoryProjection` 是 projection 的现有落点。
- AgentServer `/context`、`/compact` 和 run handoff 是 context orchestration 的现有落点。
- 新增内容应优先补 ledger schema、projection block metadata、retrieval/read-ref contract 和 cache-aware rendering，而不是新增 prompt 特例。

## 反模式

- 把完整旧聊天、raw stdout/stderr、raw task code 或大 artifact body 当作“记忆”直接塞进 prompt。
- 让 UI recent messages 在 AgentServer 不可用时升级成事实记忆。
- 让 backend native thread 成为唯一可恢复来源。
- 为某个 scenario、prompt、provider 或错误文本写 repair 分支。
- 每轮重写 stable summary，破坏 KV cache。
- 压缩时删除原文而不保留 ref、digest 和 audit 事件。

## 目标状态

最终形态：

```text
Append-only Ledger        = canonical truth
Content-addressed Refs    = recoverable evidence
Context Projection Blocks = cache-aware context
AgentServer Core          = orchestration and retrieval
Agent Backend             = bounded reasoning and repair
UI                        = projection viewer
```

这比“把记忆全放 AgentServer”更可恢复，也比“本地维护第二套聊天记忆”更干净。SciForge 本地保存事实，AgentServer 编排上下文，backend 只做当前任务需要的推理。
