# 06A 统一 Trace 与 Collector 设计文档 v0.1

状态：设计草案  
负责人：王学文  
任务优先级：P0  
推荐方案：方案 B，增强现有 `@sciforge/full-trace`，增加科研语义层  

## 1. 背景

SciForge 的定位不是训练模型，而是为科研 Agent 提供人类控制面、工具执行面和证据层。科研场景下，一个结果是否可信，不只取决于最终文本或文件，还取决于这个结果是如何产生的：

- 用户提出了什么科研目标；
- Agent 如何理解任务并制定行动；
- 调用了哪些工具、命令、模型、HPC 或外部文档接口；
- 输入数据、代码、环境、参数和审批记录是什么；
- 生成了哪些 Artifact；
- 哪些 Evidence 支撑了哪些 Conclusion；
- 哪些地方经过人工审核、修改、拒绝或验收；
- 失败、阻塞、复跑和成本如何被记录。

因此，06A 的目标不是增加普通日志，而是建立 SciForge 的科研执行“黑匣子”：让任意科研产物都能回答“这个结果是怎么产生的？”

## 2. 第一份交付与完成标准

### 第一份交付

06A 的第一份交付包括：

- Trace Schema v0.1；
- JSONL 模板；
- Markdown 模板；
- Collector 骨架；
- Validator 骨架。

### 完成标准

06A 必须满足：

- 缺输入时校验失败；
- 缺证据时校验失败；
- 缺 Artifact 时校验失败；
- 缺人工理由时校验失败；
- 缺父事件时校验失败；
- 凭证不进入 Trace；
- PII 不进入 Trace。

这里的“校验失败”分为两类：

- `event validation`：单条事件结构错误时拒绝收集；
- `trace closure validation`：一次科研任务准备完成、导出、提交或作为 baseline Trace 使用前，检查整个 Trace 是否闭合。

## 3. 非目标

v0.1 不直接实现以下内容：

- 不实现完整服务器端 Trace Service；
- 不引入新的数据库；
- 不直接对接真实 OpenContent、HPC 集群或财务系统；
- 不实现 06B/06C 的完整业务流程；
- 不替换现有 `@sciforge/full-trace`；
- 不记录真实 API key、token、cookie、密码、外发密码、下载直链或个人隐私信息。

v0.1 的重点是先建立统一事件协议、校验规则和本地可验证的骨架，为后续服务器部署和业务模块接入保留接口。

## 4. 当前 SciForge 已有能力

SciForge 已经存在 `@sciforge/full-trace` 包，提供基础 Trace 能力：

- append-only JSONL 存储；
- traceId、runtimeId、threadId、turnId、requestId 关联；
- model request / response / usage / error 记录；
- Agent runtime event 记录；
- owner-only 本地文件权限；
- 30 天默认保留；
- export / clear / summaries；
- credential redaction。

相关文件：

- `packages/full-trace/src/schema.ts`
- `packages/full-trace/src/store.ts`
- `packages/full-trace/src/redaction.ts`
- `src/main/services/agent-runtime-trace-service.ts`
- `src/shared/agent-runtime-contract.ts`
- `src/main/runtime/agent-runtime/host.ts`
- `src/main/runtime/agent-runtime/agent-tool-surface.ts`

现有 full-trace 更偏底层执行轨迹，主要回答：

- 模型请求和响应是什么；
- Agent runtime 发出了哪些事件；
- 工具事件、审批事件和错误事件如何发生。

06A 需要补充的是科研语义层，回答：

- 哪个事件代表科研输入；
- 哪个事件创建了 Artifact；
- 哪些 Evidence 支撑结论；
- 哪些人工理由影响了结果；
- 哪些事件之间存在父子因果关系；
- 这个 Trace 是否足够用于复现和审核。

## 5. 确定方案：增强现有 full-trace，增加科研语义层

06A v0.1 确定采用“增强现有 `@sciforge/full-trace`，增加科研语义层”的方案。

本方案不重建一套平行日志系统，而是复用 SciForge 已有的 durable full-trace 能力，包括 traceId 关联、Agent runtime event 记录、本地 JSONL 存储、export、retention 和 credential redaction。在此基础上，06A 增加 `ScientificTraceEvent v0.1`、`ScientificTraceCollector`、`ScientificTraceValidator`、JSONL/Markdown 模板和 fixtures，使现有执行轨迹具备科研复现语义。

核心做法：

- 复用 `@sciforge/full-trace` 的存储、关联、导出和 redaction 能力；
- 定义 `ScientificTraceEvent v0.1` 作为科研语义事件协议；
- 通过 Collector 将科研语义事件包装后写入现有 full-trace；
- 通过 Validator 校验单事件结构和整条 Trace 的闭合性；
- 通过 JSONL 模板支持机器读取、baseline Trace 和复跑；
- 通过 Markdown 模板支持人工审核、PR 说明和科研过程复盘；
- 在 Agent Runtime、Tool Execution、Artifact 广播、HPC、Finance、文档协作、DAG、绘图等边界逐步接入。

该方案可以完整满足 06A 第一份交付和完成标准，因为它同时覆盖：

- 统一事件格式；
- 统一收集入口；
- 统一校验规则；
- 统一脱敏策略；
- 可复用本地存储；
- 可导出 baseline Trace；
- 可扩展到服务器部署和 Web 端访问；
- 可支撑 06B、06C 以及全组其他模块接入。

## 6. 需求覆盖确认

按本方案实施，06A 的每一项任务要求都有明确落点：

| 任务要求 | 本方案对应设计 | 完成判定 |
| --- | --- | --- |
| Trace Schema v0.1 | 定义 `ScientificTraceEvent v0.1`，包含 `traceId`、`eventId`、`parentEventId`、`type`、`actor`、`source`、`payload`、`links`。 | 能表达用户输入、Agent 行动、工具调用、Artifact、Evidence、人工审核、错误、Job、Cost 等事件。 |
| JSONL 模板 | 每行一条 `ScientificTraceEvent`，用于 baseline Trace、fixture 和复跑输入。 | 正常样例可通过校验，缺项样例能触发预期错误。 |
| Markdown 模板 | 从 JSONL Trace 生成面向人工审核的科研过程报告。 | 报告能展示输入、时间线、Artifact、Evidence、人工理由和验证结果。 |
| Collector 骨架 | `ScientificTraceCollector.collect/collectMany/validateTrace` 接收科研事件并写入 full-trace。 | Agent、Tool、Artifact、HPC、Finance 等模块有统一接入口。 |
| Validator 骨架 | `validateEvent` 校验单事件，`validateTraceClosure` 校验整条 Trace 是否可复现。 | 缺输入、缺证据、缺 Artifact、缺人工理由、缺父事件时校验失败。 |
| 凭证不进入 Trace | 复用并扩展现有 redaction，对 API key、token、cookie、password、Authorization、外发密码、带凭证 URL 进行拒绝或脱敏。 | JSONL、Markdown、export 和测试输出中不出现原始凭证。 |
| PII 不进入 Trace | 增加 PII guard，对手机号、邮箱、身份证号、详细地址等个人信息进行拒绝或脱敏。 | fixture 测试证明原始 PII 不落盘。 |
| 支持服务器部署 | Schema 预留 `clientId`、`sessionId`、`requestId`、`idempotencyKey`、`serverId`，Storage 通过 adapter 解耦。 | v0.1 本地可用，未来可替换为 ServerTraceStorage。 |
| 支持全组模块接入 | 用 provider-neutral 的 `source.module/provider` 和 `links` 连接文档协作、DAG、Computer Use、多端同步、HPC、Finance、Verifier、绘图。 | 其他模块只需按 Schema 上报事件，不需要各自维护独立 Trace。 |

因此，本方案不是只做文档说明，而是能落到明确代码产出和测试产出：类型定义、Collector、Validator、templates、fixtures、tests。只要后续实现严格按照本方案推进，就可以完整覆盖 06A 的第一份交付与完成标准。

推荐架构：

```text
Agent Runtime / Tools / Artifact / HPC / Finance / Human Review
        |
        v
ScientificTraceCollector
        |
        v
ScientificTraceValidator + Secret/PII Guard
        |
        v
FullTraceAdapter
        |
        v
@sciforge/full-trace LocalTraceStore
        |
        +--> JSONL export
        +--> Markdown report
        +--> future ServerTraceStorage
```

## 7. 设计原则

### 7.1 Provider-neutral

Trace 不绑定 OpenContent、Claude Science、Codex、Claude Code、DeepSeek 或某个 HPC 平台。外部系统只作为 `source.provider` 或 `payload.provider` 记录。

### 7.2 Runtime-neutral

Trace 不假设任务一定来自 Electron、本地 Codex 或本地 Claude。事件需要支持：

- local Electron；
- Web client；
- mobile approval；
- remote runtime；
- server-side worker；
- HPC scheduler；
- third-party document service。

### 7.3 Secret-safe

凭证和敏感信息不能进入持久 Trace。包括但不限于：

- API key；
- token；
- Authorization header；
- cookie；
- password；
- client secret；
- private key；
- OpenContent token；
- 外发密码；
- 带凭证的下载链接；
- 真实身份证号、手机号、邮箱、详细地址等 PII。

### 7.4 Evidence-complete

可以导出或作为 baseline 的 Trace 必须能说明：

- 输入是什么；
- 产物是什么；
- 证据是什么；
- 人工判断是什么；
- 事件因果关系是什么。

### 7.5 Append-only

Trace 事件默认追加，不静默覆盖。更正、拒绝、回滚、复跑都应该产生新事件。

### 7.6 Idempotent

多端同步、网络重试、HPC 重复提交时可能产生重复请求。Collector 应支持 `idempotencyKey`，避免同一业务动作被重复记录为多个事实。

### 7.7 Server-ready

v0.1 使用本地 full-trace，但 Schema 必须携带未来服务器部署需要的字段：

- `clientId`
- `sessionId`
- `requestId`
- `idempotencyKey`
- `serverId`
- `runtimeId`
- `threadId`
- `turnId`

## 8. 核心概念

### Trace

一次科研任务的完整执行轨迹。它由多条事件组成，并通过 `traceId` 关联。

### TraceEvent

Trace 中的一条结构化事件。比如用户输入、Agent 行动、工具调用、Artifact 创建、人工审核、HPC job 状态变化、成本记录。

### Parent Event

事件的直接因果来源。除根事件外，v0.1 要求事件必须有父事件。

示例：

```text
USER_INPUT
  -> AGENT_ACTION
    -> TOOL_CALL_REQUESTED
      -> TOOL_CALL_COMPLETED
        -> ARTIFACT_CREATED
          -> EVIDENCE_ATTACHED
            -> HUMAN_REVIEW_RECORDED
```

### Artifact

科研过程生成的产物。可以是图表、数据文件、代码、报告、模型输出、HPC 结果文件、文档版本、报销草稿。

### Evidence

支持某个结论或产物可信度的证据。Evidence 可以引用 Artifact、外部来源、计算结果、人工审核或 DAG 节点。

### Human Review

人工审核记录。v0.1 中，只要人工审核会影响结论、产物、预算、复跑或审批状态，就必须记录理由。

## 9. Trace Schema v0.1

### 9.1 科研语义事件

建议定义科研语义事件为 `ScientificTraceEventV01`：

```ts
type ScientificTraceEventType =
  | 'TRACE_STARTED'
  | 'TRACE_COMPLETED'
  | 'USER_INPUT'
  | 'AGENT_ACTION'
  | 'AGENT_DECISION'
  | 'TOOL_CALL_REQUESTED'
  | 'TOOL_CALL_COMPLETED'
  | 'COMMAND_EXECUTION'
  | 'ARTIFACT_CREATED'
  | 'EVIDENCE_ATTACHED'
  | 'HUMAN_REVIEW_REQUESTED'
  | 'HUMAN_REVIEW_RECORDED'
  | 'ERROR_RECORDED'
  | 'JOB_SUBMITTED'
  | 'JOB_STARTED'
  | 'JOB_FINISHED'
  | 'JOB_FAILED'
  | 'JOB_CANCELLED'
  | 'JOB_RESUMED'
  | 'RESOURCE_USAGE_RECORDED'
  | 'COST_ESTIMATED'
  | 'EXPENSE_DRAFT_CREATED'
  | 'BUDGET_APPROVAL_REQUESTED'
  | 'BUDGET_APPROVAL_RECORDED'
  | 'DOCUMENT_VERSION_CREATED'
  | 'DAG_NODE_CREATED'
  | 'DAG_EDGE_CREATED'
  | 'VERIFIER_RESULT_RECORDED'
  | 'PLOT_CREATED'

type ScientificTraceActor = {
  type: 'human' | 'agent' | 'tool' | 'system' | 'scheduler' | 'verifier'
  id?: string
  displayName?: string
}

type ScientificTraceSource = {
  module: string
  provider?: string
  runtimeId?: string
  threadId?: string
  turnId?: string
  requestId?: string
  idempotencyKey?: string
  clientId?: string
  sessionId?: string
  serverId?: string
  jobId?: string
}

type ScientificTraceLinks = {
  inputs?: string[]
  artifacts?: string[]
  evidence?: string[]
  reviews?: string[]
  dagNodes?: string[]
  dagEdges?: string[]
  versions?: string[]
  costs?: string[]
  relatedEvents?: string[]
}

type ScientificTraceEventV01 = {
  schemaVersion: 'sciforge.scientific-trace.v0.1'
  eventId: string
  traceId: string
  parentEventId?: string
  type: ScientificTraceEventType
  timestamp: string
  actor: ScientificTraceActor
  source: ScientificTraceSource
  payload: Record<string, unknown>
  links?: ScientificTraceLinks
}
```

### 9.2 与现有 full-trace 的兼容方式

v0.1 不建议立刻修改 `TraceEventKind`，而是先将科研语义事件包装进现有 full-trace：

```ts
{
  traceId,
  runtimeId,
  threadId,
  turnId,
  source: 'scientific-trace-collector',
  kind: 'agent_event',
  payload: {
    eventKind: 'lifecycle',
    scientificEvent
  }
}
```

这样做的好处：

- 不破坏现有 `@sciforge/full-trace`；
- 不影响 Model Router / Plan Gateway 的现有 trace；
- 可以复用 LocalTraceStore、export、clear、redaction；
- 后续如果需要，可以再新增正式的 `scientific_event` kind。

## 10. 事件必填规则

### 10.1 所有事件必填

每条事件必须包含：

- `schemaVersion`
- `eventId`
- `traceId`
- `type`
- `timestamp`
- `actor.type`
- `source.module`
- `payload`

### 10.2 父事件规则

除以下根事件外，其他事件必须包含 `parentEventId`：

- `TRACE_STARTED`
- `USER_INPUT`

如果事件没有父事件，Validator 必须失败。

### 10.3 输入规则

`USER_INPUT` 事件必须包含至少一种输入引用：

- `payload.text`
- `payload.inputRef`
- `links.inputs`

如果一个 Trace 准备完成、导出或作为 baseline 使用，但没有任何 `USER_INPUT`，Trace closure validation 必须失败。

### 10.4 Artifact 规则

`ARTIFACT_CREATED`、`PLOT_CREATED`、`DOCUMENT_VERSION_CREATED`、`EXPENSE_DRAFT_CREATED` 等产物事件必须包含：

- artifact id 或 version id；
- path、uri 或 storage reference；
- hash、checksum 或明确说明不可 hash 的原因；
- parentEventId。

如果一个 Trace 声称产生科研结果，但没有 Artifact，Trace closure validation 必须失败。

### 10.5 Evidence 规则

`EVIDENCE_ATTACHED` 必须包含：

- evidence id；
- evidence type；
- evidence target；
- supporting artifact、external source 或 reviewer reference；
- parentEventId。

如果结论、Verifier 结果或完成事件没有 evidence 链接，Trace closure validation 必须失败。

### 10.6 Human Review 规则

`HUMAN_REVIEW_RECORDED` 必须包含：

- reviewer id 或匿名 reviewer reference；
- decision；
- reason；
- reviewed target；
- parentEventId。

如果人工审核会影响审批、拒绝、修改、验收、预算或结论，但没有 `reason`，Validator 必须失败。

### 10.7 凭证和 PII 规则

Collector 写入前必须运行 secret / PII guard。以下内容不得进入 Trace：

- `authorization`
- `cookie`
- `token`
- `apiKey`
- `accessToken`
- `refreshToken`
- `clientSecret`
- `password`
- `privateKey`
- `sk-...` 形式 key；
- JWT；
- GitHub token；
- AWS key；
- OpenContent token；
- 外发密码；
- 带用户名密码的 URL；
- 带 token 的下载或上传直链；
- 身份证号；
- 手机号；
- 邮箱；
- 详细家庭住址。

v0.1 的策略：

- 明确 secret 字段名：拒绝或替换为 `[REDACTED]`；
- 明确 secret pattern：替换为 `[REDACTED]`；
- PII 字段名：拒绝进入 Trace；
- PII pattern：默认替换为 `[REDACTED_PII]`；
- fixture 和测试中必须证明凭证和 PII 不会落盘。

## 11. Collector 设计

### 11.1 接口

Collector 骨架建议如下：

```ts
type ScientificTraceCollectResult = {
  eventId: string
  traceId: string
  stored: boolean
  warnings: string[]
}

type ScientificTraceCollector = {
  collect(event: ScientificTraceEventV01): Promise<ScientificTraceCollectResult>
  collectMany(events: readonly ScientificTraceEventV01[]): Promise<ScientificTraceCollectResult[]>
  validateTrace(traceId: string): Promise<ScientificTraceValidationResult>
}
```

### 11.2 收集流程

```text
raw event
  -> normalize ids and timestamp
  -> sanitize secrets and PII
  -> validate event structure
  -> enforce parent / input / artifact / evidence / human reason rules
  -> convert to full-trace event input
  -> append to LocalTraceStore
  -> return collect result
```

### 11.3 幂等策略

如果 `source.idempotencyKey` 存在，Collector 应使用：

```text
traceId + source.module + idempotencyKey
```

作为业务幂等键。

v0.1 可以先在内存或测试 fixture 中验证幂等语义，后续服务器版本再使用数据库唯一约束。

## 12. Validator 设计

### 12.1 单事件 Validator

`validateEvent(event)` 负责：

- schemaVersion 是否支持；
- eventId / traceId / type / timestamp 是否存在；
- actor 是否存在；
- source.module 是否存在；
- 非根事件是否有 parentEventId；
- 特定事件类型是否包含必填 payload；
- 是否存在 secret 字段；
- 是否存在 PII 字段；
- payload 是否可 JSON 序列化。

### 12.2 Trace closure Validator

`validateTraceClosure(events)` 负责：

- 至少存在一条 `USER_INPUT`；
- 至少存在一条 Artifact 事件；
- 至少存在一条 Evidence 事件；
- 所有非根事件的 parentEventId 都能找到；
- 人工审核事件必须有 reason；
- 完成事件必须能追溯到输入、Artifact 和 Evidence；
- 失败 Trace 必须有 `ERROR_RECORDED` 或明确的 blocked reason；
- 重复/复跑 Trace 必须能关联 baseline trace 或 previous run。

### 12.3 校验结果

```ts
type ScientificTraceValidationIssue = {
  code:
    | 'MISSING_INPUT'
    | 'MISSING_EVIDENCE'
    | 'MISSING_ARTIFACT'
    | 'MISSING_HUMAN_REASON'
    | 'MISSING_PARENT_EVENT'
    | 'SECRET_DETECTED'
    | 'PII_DETECTED'
    | 'INVALID_SCHEMA'
  severity: 'error' | 'warning'
  eventId?: string
  message: string
}

type ScientificTraceValidationResult = {
  ok: boolean
  issues: ScientificTraceValidationIssue[]
}
```

## 13. JSONL 模板

JSONL 用于机器读取、测试和 baseline Trace。每一行是一条事件。

```jsonl
{"schemaVersion":"sciforge.scientific-trace.v0.1","eventId":"event_001","traceId":"trace_demo_001","type":"TRACE_STARTED","timestamp":"2026-08-06T08:00:00.000Z","actor":{"type":"system","id":"sciforge"},"source":{"module":"agent-runtime","runtimeId":"codex","threadId":"thread_demo","turnId":"turn_demo"},"payload":{"goal":"Generate a reproducible research artifact"}}
{"schemaVersion":"sciforge.scientific-trace.v0.1","eventId":"event_002","traceId":"trace_demo_001","type":"USER_INPUT","timestamp":"2026-08-06T08:00:01.000Z","actor":{"type":"human","id":"user_demo"},"source":{"module":"agent-runtime","runtimeId":"codex","threadId":"thread_demo","turnId":"turn_demo","clientId":"desktop_demo"},"payload":{"text":"Analyze the demo dataset and produce a figure."},"links":{"inputs":["input_demo_dataset"]}}
{"schemaVersion":"sciforge.scientific-trace.v0.1","eventId":"event_003","traceId":"trace_demo_001","parentEventId":"event_002","type":"AGENT_ACTION","timestamp":"2026-08-06T08:00:03.000Z","actor":{"type":"agent","id":"codex"},"source":{"module":"agent-runtime","runtimeId":"codex","threadId":"thread_demo","turnId":"turn_demo"},"payload":{"action":"Plan data validation and plotting steps."}}
{"schemaVersion":"sciforge.scientific-trace.v0.1","eventId":"event_004","traceId":"trace_demo_001","parentEventId":"event_003","type":"TOOL_CALL_REQUESTED","timestamp":"2026-08-06T08:00:05.000Z","actor":{"type":"agent","id":"codex"},"source":{"module":"agent-tool-surface","runtimeId":"codex","threadId":"thread_demo","turnId":"turn_demo","requestId":"request_tool_demo","idempotencyKey":"plot-demo-001"},"payload":{"toolName":"scientific_plotting","argumentsRef":"args_demo_001"}}
{"schemaVersion":"sciforge.scientific-trace.v0.1","eventId":"event_005","traceId":"trace_demo_001","parentEventId":"event_004","type":"ARTIFACT_CREATED","timestamp":"2026-08-06T08:00:10.000Z","actor":{"type":"tool","id":"scientific_plotting"},"source":{"module":"scientific-plotting","runtimeId":"codex","threadId":"thread_demo","turnId":"turn_demo"},"payload":{"artifactId":"artifact_figure_demo","path":"artifacts/figure_demo.png","sha256":"demo_sha256_value","mimeType":"image/png"},"links":{"artifacts":["artifact_figure_demo"]}}
{"schemaVersion":"sciforge.scientific-trace.v0.1","eventId":"event_006","traceId":"trace_demo_001","parentEventId":"event_005","type":"EVIDENCE_ATTACHED","timestamp":"2026-08-06T08:00:12.000Z","actor":{"type":"system","id":"evidence-dag"},"source":{"module":"evidence-dag","runtimeId":"codex","threadId":"thread_demo","turnId":"turn_demo"},"payload":{"evidenceId":"evidence_figure_demo","evidenceType":"artifact_hash","target":"artifact_figure_demo"},"links":{"evidence":["evidence_figure_demo"],"artifacts":["artifact_figure_demo"]}}
{"schemaVersion":"sciforge.scientific-trace.v0.1","eventId":"event_007","traceId":"trace_demo_001","parentEventId":"event_006","type":"HUMAN_REVIEW_RECORDED","timestamp":"2026-08-06T08:00:20.000Z","actor":{"type":"human","id":"reviewer_demo"},"source":{"module":"human-review","clientId":"desktop_demo"},"payload":{"decision":"approved","reason":"The figure uses the requested demo dataset and includes reproducible parameters.","reviewedTarget":"artifact_figure_demo"},"links":{"reviews":["review_demo_001"],"artifacts":["artifact_figure_demo"],"evidence":["evidence_figure_demo"]}}
{"schemaVersion":"sciforge.scientific-trace.v0.1","eventId":"event_008","traceId":"trace_demo_001","parentEventId":"event_007","type":"TRACE_COMPLETED","timestamp":"2026-08-06T08:00:25.000Z","actor":{"type":"system","id":"sciforge"},"source":{"module":"scientific-trace-collector","runtimeId":"codex","threadId":"thread_demo","turnId":"turn_demo"},"payload":{"status":"completed"},"links":{"inputs":["input_demo_dataset"],"artifacts":["artifact_figure_demo"],"evidence":["evidence_figure_demo"],"reviews":["review_demo_001"]}}
```

模板要求：

- 不使用真实 API key；
- 不使用真实 token；
- 不使用真实个人信息；
- 文件路径可以是 fixture 路径；
- hash 可以是 fixture hash；
- 所有非根事件必须有 parentEventId。

## 14. Markdown 模板

Markdown 用于人工审核、PR 说明和科研过程复盘。

```markdown
# Scientific Trace Report

Trace ID: trace_demo_001
Status: completed
Generated At: 2026-08-06T08:00:25.000Z

## Goal

Generate a reproducible research artifact.

## Inputs

- input_demo_dataset: demo dataset used for plotting

## Timeline

1. USER_INPUT: user requested dataset analysis and figure generation.
2. AGENT_ACTION: agent planned validation and plotting.
3. TOOL_CALL_REQUESTED: scientific_plotting was invoked.
4. ARTIFACT_CREATED: artifacts/figure_demo.png was created.
5. EVIDENCE_ATTACHED: artifact hash was attached as evidence.
6. HUMAN_REVIEW_RECORDED: reviewer approved with reason.
7. TRACE_COMPLETED: trace was closed.

## Artifacts

- artifact_figure_demo
  - path: artifacts/figure_demo.png
  - sha256: demo_sha256_value
  - mimeType: image/png

## Evidence

- evidence_figure_demo
  - type: artifact_hash
  - target: artifact_figure_demo

## Human Review

- reviewer: reviewer_demo
- decision: approved
- reason: The figure uses the requested demo dataset and includes reproducible parameters.

## Validation

- missing input: pass
- missing artifact: pass
- missing evidence: pass
- missing human reason: pass
- missing parent event: pass
- credentials detected: pass
- PII detected: pass

## Reproducibility Notes

- Use the linked input dataset.
- Re-run the recorded plotting tool with the stored argument reference.
- Compare output hash with the recorded artifact hash.
```

## 15. 与其他任务的关系

06A 是基础设施，不替其他任务实现业务逻辑，但需要能接收它们产生的事件。

| 任务 | 需要 06A 支持的事件 |
| --- | --- |
| 01 文档协作 | `DOCUMENT_VERSION_CREATED`, `HUMAN_REVIEW_RECORDED`, `ARTIFACT_CREATED` |
| 02 证据与产物版本服务 | `ARTIFACT_CREATED`, `EVIDENCE_ATTACHED`, `DOCUMENT_VERSION_CREATED` |
| 03 增强 DAG | `DAG_NODE_CREATED`, `DAG_EDGE_CREATED`, `EVIDENCE_ATTACHED` |
| 04 Computer Use 线程隔离 | `TOOL_CALL_REQUESTED`, `TOOL_CALL_COMPLETED`, `ERROR_RECORDED` |
| 05 多客户端同步与通知 | `HUMAN_REVIEW_REQUESTED`, `HUMAN_REVIEW_RECORDED`, idempotency fields |
| 06B HPC 闭环 | `JOB_SUBMITTED`, `JOB_STARTED`, `JOB_FINISHED`, `JOB_FAILED`, `JOB_CANCELLED`, `JOB_RESUMED`, `RESOURCE_USAGE_RECORDED` |
| 06C 财务报销闭环 | `RESOURCE_USAGE_RECORDED`, `COST_ESTIMATED`, `EXPENSE_DRAFT_CREATED`, `BUDGET_APPROVAL_REQUESTED`, `BUDGET_APPROVAL_RECORDED` |
| 06D Verifier | `VERIFIER_RESULT_RECORDED`, `EVIDENCE_ATTACHED`, `HUMAN_REVIEW_RECORDED` |
| 06E 复跑与自动化 | `TRACE_STARTED`, `TRACE_COMPLETED`, parent trace reference, idempotency fields |
| 07 科学产物版本化 | `DOCUMENT_VERSION_CREATED`, `ARTIFACT_CREATED`, `EVIDENCE_ATTACHED` |
| 08 绘图 | `PLOT_CREATED`, `ARTIFACT_CREATED`, `EVIDENCE_ATTACHED` |

## 16. 插入点设计

### 16.1 Agent Runtime

入口：

- `src/main/services/agent-runtime-trace-service.ts`

用途：

- 将 runtime-neutral 的 `AgentRuntimeEvent` 映射为科研语义事件；
- 捕获 `USER_INPUT`、`AGENT_ACTION`、`TOOL_CALL_*`、`HUMAN_REVIEW_*`、`ERROR_RECORDED`。

### 16.2 Tool Execution

入口：

- `src/main/runtime/agent-runtime/agent-tool-surface.ts`

用途：

- 对 Codex 和 Claude Code 的工具调用提供统一捕获点；
- 记录 `TOOL_CALL_REQUESTED` 和 `TOOL_CALL_COMPLETED`；
- 使用 `idempotencyKey` 支持多端或重试去重。

### 16.3 Capability Broker

入口：

- `src/main/capabilities/broker.ts`

用途：

- 记录 SciForge capability 层的业务操作；
- 捕获权限、审批、资源变化和失败。

### 16.4 Artifact 广播

入口：

- `src/main/runtime/agent-runtime/host.ts`

用途：

- 在 `broadcastCompletedTurnArtifacts` 处记录 Artifact 进入 Evidence DAG 前的统一事件；
- 生成 `ARTIFACT_CREATED` 或 `EVIDENCE_ATTACHED`。

### 16.5 Model Router / Usage

入口：

- `packages/workers/model-router`
- `packages/workers/plan-gateway`

用途：

- 继续记录 model usage；
- 06C 可以从 usage event 派生 token 成本；
- 不重复存储模型调用日志。

### 16.6 未来 HPC / Finance

06B 和 06C 应直接向 Collector 上报事件：

```text
JobManager -> ScientificTraceCollector
CostCollector -> ScientificTraceCollector
BudgetApproval -> ScientificTraceCollector
```

## 17. Storage 设计

v0.1 使用现有 `LocalTraceStore`。

未来可以抽象为：

```ts
type ScientificTraceStorage = {
  append(event: ScientificTraceEventV01): Promise<void>
  read(traceId: string): Promise<ScientificTraceEventV01[]>
  exportJsonl(traceId: string): Promise<string>
}
```

第一版实现：

```text
ScientificTraceCollector
  -> FullTraceStorageAdapter
  -> LocalTraceStore
```

未来服务器实现：

```text
ScientificTraceCollector
  -> ServerTraceStorage
  -> HTTPS API / Database
```

因此方案 B 可以支持未来服务器部署：迁移时主要替换 Storage，不需要推翻 Schema 和 Collector。

## 18. 测试设计

### 18.1 正常 Trace fixture

包含：

- `USER_INPUT`
- `AGENT_ACTION`
- `TOOL_CALL_REQUESTED`
- `TOOL_CALL_COMPLETED`
- `ARTIFACT_CREATED`
- `EVIDENCE_ATTACHED`
- `HUMAN_REVIEW_RECORDED`
- `TRACE_COMPLETED`

预期：

- event validation 通过；
- trace closure validation 通过；
- JSONL 可读；
- Markdown 可生成；
- 无 secret / PII。

### 18.2 缺输入 fixture

删除 `USER_INPUT`。

预期：

- trace closure validation 返回 `MISSING_INPUT`。

### 18.3 缺 Artifact fixture

删除所有 Artifact 事件。

预期：

- trace closure validation 返回 `MISSING_ARTIFACT`。

### 18.4 缺 Evidence fixture

删除所有 Evidence 事件。

预期：

- trace closure validation 返回 `MISSING_EVIDENCE`。

### 18.5 缺人工理由 fixture

保留 `HUMAN_REVIEW_RECORDED`，但删除 `payload.reason`。

预期：

- event validation 返回 `MISSING_HUMAN_REASON`。

### 18.6 缺父事件 fixture

非根事件删除 `parentEventId`。

预期：

- event validation 返回 `MISSING_PARENT_EVENT`。

### 18.7 凭证 fixture

payload 中放入 fake token、fake API key、fake Authorization header。

预期：

- 原值不落盘；
- JSONL 和 Markdown 中只出现 `[REDACTED]`；
- 测试确认 fake secret 不存在。

### 18.8 PII fixture

payload 中放入 fake phone、fake email、fake id card。

预期：

- 原值不落盘；
- JSONL 和 Markdown 中只出现 `[REDACTED_PII]` 或 validation error；
- 测试确认 fake PII 不存在。

## 19. 与 06B 的衔接

06B 的 baseline Trace 应使用 06A Schema 记录：

- `JOB_SUBMITTED`
- `JOB_STARTED`
- `JOB_FINISHED`
- `JOB_FAILED`
- `JOB_CANCELLED`
- `JOB_RESUMED`
- `ARTIFACT_CREATED`
- `RESOURCE_USAGE_RECORDED`
- `HUMAN_REVIEW_RECORDED`

06B 的三类 baseline：

- 成功；
- 失败/阻塞；
- 重复运行。

每类 baseline 都应能通过 06A closure validation，或在失败/阻塞情况下给出明确 blocked reason。

## 20. 与 06C 的衔接

06C 的 baseline Trace 应使用 06A Schema 记录：

- `RESOURCE_USAGE_RECORDED`
- `COST_ESTIMATED`
- `EXPENSE_DRAFT_CREATED`
- `BUDGET_APPROVAL_REQUESTED`
- `BUDGET_APPROVAL_RECORDED`
- `HUMAN_REVIEW_RECORDED`
- `ERROR_RECORDED`

06C 的三类 fixture：

- 脱敏正常；
- 缺项；
- 重复/冲突。

禁止：

- 真实提交；
- 真实付款；
- 泄露个人信息；
- 在 Trace 中保存真实票据敏感信息。

## 21. 安全说明

老师提供的服务地址、API 配置、OpenContent SDK 和群内讨论表明，后续开发会接触真实接口、token 和服务器地址。06A 必须从第一版开始把安全作为硬约束：

- PR 中不能包含真实 key；
- fixture 中只能使用 fake secret；
- Markdown 报告不能输出 secret；
- exported JSONL 也不能输出 secret；
- 截图和日志中的 key 应视为已泄露并建议轮换；
- Collector 默认 fail closed：不确定是否安全时，不写入 Trace。

## 22. 实现阶段建议

### Phase 0：设计文档

产出：

- 本文档；
- Schema v0.1；
- JSONL 模板；
- Markdown 模板；
- 验证规则清单。

### Phase 1：类型和 Validator 骨架

产出：

- ScientificTraceEvent 类型；
- ValidationResult 类型；
- validateEvent；
- validateTraceClosure；
- secret / PII 测试。

### Phase 2：Collector 骨架

产出：

- ScientificTraceCollector；
- FullTraceStorageAdapter；
- collect / collectMany；
- 写入现有 LocalTraceStore。

### Phase 3：模板和 fixtures

产出：

- 正常 baseline JSONL；
- 缺输入 fixture；
- 缺 Artifact fixture；
- 缺 Evidence fixture；
- 缺人工理由 fixture；
- 缺父事件 fixture；
- secret / PII fixture；
- Markdown 渲染模板。

### Phase 4：接入最小主链路

产出：

- Agent runtime event 映射；
- Tool call 映射；
- Artifact 广播映射；
- targeted tests。

### Phase 5：支撑 06B / 06C

产出：

- HPC baseline Trace；
- Finance baseline Trace；
- 成功、失败/阻塞、重复/冲突样例；
- 人工时间、GPU/API 成本和科研验收字段。

## 23. Definition of Done

06A v0.1 完成时，应满足：

- 已有清晰的 Trace Schema v0.1；
- JSONL 模板可作为 baseline Trace；
- Markdown 模板可供人工审核；
- Collector 骨架能接收事件；
- Validator 骨架能拒绝缺输入、缺证据、缺 Artifact、缺人工理由、缺父事件；
- 凭证和 PII 不进入持久 Trace；
- 与现有 `@sciforge/full-trace` 兼容；
- 不破坏现有 model / agent trace；
- 为服务器部署预留 client/session/server/idempotency 字段；
- 文档说明其他模块如何接入 06A；
- 测试覆盖正常、缺项、secret、PII 场景。

## 24. 推荐的第一版 PR 范围

第一版 PR 建议只包含：

- `docs/trace/06a-trace-collector-design.zh-CN.md`
- Trace Schema v0.1 类型文件；
- Validator 骨架；
- Collector 骨架；
- JSONL 模板；
- Markdown 模板；
- fixtures；
- tests。

不建议第一版 PR 包含：

- 真实 OpenContent 接入；
- 真实 HPC 接入；
- 真实财务接口；
- 数据库迁移；
- Web 服务器 Trace API；
- 大范围重构 full-trace。

## 25. 最终判断

方案 B 可以满足 06A 第一份交付和完成标准，也能为 06B、06C 以及全组其他任务提供统一 Trace 基础。

关键不是重新写一套日志，而是在 SciForge 现有 full-trace 之上建立科研语义层：

```text
existing full-trace = durable execution trace
06A scientific trace = reproducible research semantics
```

v0.1 应优先保证：

- 结构统一；
- 校验明确；
- 安全默认；
- 本地可运行；
- 未来可上服务器；
- 能支撑 baseline Trace 和科研复现。
