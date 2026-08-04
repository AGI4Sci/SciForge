# SciForge Mobile Zulip 实现设计

Last updated: 2026-06-30

本文设计一个基于 Zulip 的 SciForge 手机端与科研协作层。目标是把 SciForge 的自主科研 Agent、科学家反馈、实验记录、证据链和周报同步放进一个低摩擦的移动协作空间。

本文不是法律意见。许可证结论仅用于工程选型和后续尽调入口。

## 结论

SciForge Mobile 第一版建议基于 Zulip 实现，而不是从零做 IM，也不是深度改造 Mattermost Server。

原因：

- Zulip Server 与 Zulip Mobile 生态核心代码采用 Apache-2.0，商用 fork 和私有化部署边界更清晰。
- Zulip 的 stream/topic 模型天然适合科研项目：项目、假设、实验、周报、PI 反馈都可以按 topic 组织，避免普通群聊刷屏。
- SciForge 已有 AgentRuntime、Connect phone、Schedule、Paper Radar、Evidence DAG、多 Agent worker 等科研执行底座；Zulip 只需要承担协作、通知、身份和话题组织层。
- 第一版不需要把 Agent 过程实时直播进群。Agent 后台自主推进，Zulip 只承载高信号节点：专家问题、审批请求、决策记录、成果卡片和周报。

## 许可证边界

### 选择 Zulip 的许可证理由

Zulip 官方许可文档说明 Zulip 以 Apache License 2.0 分发。Apache-2.0 允许商用、修改、分发和闭源派生，但需要保留版权、许可证和 NOTICE 等声明。

参考：

- Zulip licensing: https://zulip.readthedocs.io/en/stable/contributing/licensing.html
- Zulip server: https://github.com/zulip/zulip
- Zulip Flutter client: https://github.com/zulip/zulip-flutter

### 必须遵守的规则

- 不使用 Zulip 商标、logo、App 名称、bundle id、默认品牌图形作为 SciForge 产品标识。
- 保留上游 Apache-2.0 license、copyright、NOTICE。
- 修改 Zulip 源码时，在 release evidence 中保留修改范围、上游 commit、依赖许可证扫描结果。
- 不把上游 Zulip 官方托管服务、移动推送服务或云服务条款假设为 SciForge 可直接转售的服务能力。

### 与 Mattermost 的差异

Mattermost Mobile 本身也是 Apache-2.0，但 Mattermost Server 源码编译和深度改造会进入 AGPLv3 或商业授权路径；企业功能还涉及 Source Available 许可。Zulip 的全栈 Apache-2.0 边界更适合 SciForge 做商用科研协作产品。

## 产品目标

### 目标

- 科学家可以像用群聊一样加入一个项目空间，与人类成员和 Agent 一起协作。
- Agent 可以在后台自主执行科研任务：查文献、运行分析、整理实验、生成图表、形成证据链。
- Agent 在关键节点向科学家提问、收集反馈、请求审批。
- 系统自动把本周实验进展、失败原因、证据变化、阻塞和下周计划整理成周报，并同步到项目群。
- 所有科研结论都能追溯到论文、数据、代码、运行记录、人工反馈和 Evidence DAG 节点。

### 非目标

- 第一版不做一个完全替代微信的通用社交 App。
- 第一版不要求把 SciForge 桌面完整搬到手机端。
- 第一版不把 Agent 的每个工具调用、token 流、调试日志都发到 Zulip。
- 第一版不做湿实验仪器控制、采购、云预算扣费等高风险自动执行能力；这些能力只能作为审批卡片或未来扩展。

## 用户模型

| 角色 | Zulip 身份 | SciForge 权限 |
| --- | --- | --- |
| PI | Zulip owner/admin 或 `pi` user group | 项目策略、高风险审批、周报确认、成员管理 |
| Scientist | Zulip member 或 `scientist` user group | 常规实验反馈、方案审批、证据审阅 |
| Reviewer | Zulip member 或 `reviewer` user group | 只审阅报告、图表、证据，不触发执行 |
| Student/RA | Zulip member | 提任务、上传材料、跟进实验 |
| SciForge Agent | Zulip bot user | 发问题卡、审批卡、周报卡；后台执行由 SciForge Runtime 完成 |
| External collaborator | Zulip guest 或 restricted user | 只访问被邀请的 streams/topics |

## Zulip 概念映射

| Zulip 概念 | SciForge 概念 | 示例 |
| --- | --- | --- |
| Organization / Realm | 实验室或机构部署 | `Zhang Lab SciForge` |
| Stream | 科研项目或课题 | `protein-design`, `single-cell-atlas` |
| Topic | 假设、实验、周报、反馈线 | `hypothesis-3`, `failed-runs`, `weekly-report`, `agent-questions` |
| Message | 科学家讨论或 Agent 卡片 | PI 反馈、审批卡、周报 |
| Bot | SciForge Agent | `SciForge Agent`, `Paper Radar Agent` |
| User group | 角色和审批组 | `pi`, `reviewers`, `wet-lab` |
| Reaction | 轻量反馈 | approve、concern、needs-evidence |
| Poll / narrow topic | 方案选择和焦点讨论 | 选择实验参数、比较候选方案 |

## 核心体验

### 1. 项目空间

每个科研项目对应一个 Zulip stream。项目内默认创建这些 topics：

```text
weekly-report
agent-questions
approvals
decisions
paper-radar
failed-runs
artifacts
```

具体实验或假设创建独立 topic，例如：

```text
hypothesis-ligand-binding
experiment-2026-07-qpcr-retry
figure-style-review
```

### 2. Agent 任务委派

科学家在 Zulip 中使用 `@SciForge Agent` 或命令触发任务：

```text
@SciForge Agent 根据上周失败日志，找出 qPCR 波动大的可能原因，并给出下周复现实验方案。
```

Zulip Bridge 将消息转成 SciForge Runtime turn。Agent 后台执行，过程写入 Research Ledger 和 runtime trace。Zulip 中只显示：

- 收到任务的简短确认，默认可关闭。
- 需要专家判断的问题。
- 需要审批的动作。
- 任务完成后的成果卡片。

### 3. 主动提问卡片

当 Agent 需要人类科学判断时，在 `agent-questions` 或原 topic 发提问卡：

```text
Question: qPCR 复现实验是否优先控制 RNA 质量还是引物批次？
Why: 最近 3 次失败中 Ct 方差主要出现在低表达组，Agent 无法判断是样本降解还是引物问题。
Needed from: @wet-lab
Options:
1. 优先重测 RNA integrity
2. 优先更换引物批次
3. 同时做，但减少生物重复数
Deadline: 2026-07-02 18:00
Evidence: EDAG claim C-102, run R-884, log artifact A-219
```

科学家可以回复、reaction、或点击自定义动作。Bridge 将反馈写入 `FeedbackRecord`，并继续 steer 或 unblock Agent。

### 4. 审批卡片

所有高风险动作必须发到 `approvals` topic，并默认 fail closed：

- 删除或覆盖实验数据。
- 外发报告、图表、论文草稿。
- 访问 restricted 数据。
- 运行高预算计算任务。
- 安装依赖或执行不可审计脚本。
- 将未验证 claim 升级为结论。

审批动作：

```text
approve / reject / request_changes / ask_evidence / delegate
```

审批结果写入 Research Ledger、AgentRuntime approval、Evidence DAG provenance。

### 5. 周报同步

每周固定时间由 Schedule 触发 Digest Generator，生成草稿后先发给 PI 或 `reviewers` topic 审阅。确认后同步到 `weekly-report` topic。

周报必须按事实来源生成：

- 本周完成的实验和分析。
- 新增证据和证据状态。
- 失败实验与原因假设。
- 人工决策和审批记录。
- 当前阻塞和需要谁反馈。
- 下周计划。

未验证内容必须标为 `unverified`，不能写成确定结论。

## 系统架构

```text
Zulip Mobile / Web
  -> Zulip Server
    -> Zulip Event Queue / REST API / Bot Webhook
      -> SciForge Zulip Bridge
        -> Noise Gate
        -> Policy Governor
        -> Research Ledger
        -> AgentRuntimeHost
          -> SciForge Runtime / Codex / Claude adapter
          -> Model Router
          -> Workers: Schedule, Paper Radar, Workflow, Workspace Host
        -> Evidence DAG
        -> Digest Generator
      -> Zulip REST API
        -> Agent question cards
        -> Approval cards
        -> Artifact cards
        -> Weekly digest
```

### 组件职责

#### Zulip Server

- 负责用户、组织、stream、topic、消息、移动端、通知、权限基础设施。
- 作为项目协作事实入口，但不直接执行科研任务。

#### SciForge Zulip Bridge

新增服务。负责把 Zulip 事件和 SciForge Runtime 连接起来。

职责：

- 订阅 Zulip 事件队列或 bot webhook。
- 识别 `@SciForge Agent`、命令、审批回复、reaction、topic 新建等事件。
- 将 Zulip stream/topic 映射到 SciForge project/thread/task。
- 调用 AgentRuntimeHost 开始 turn、steer turn、resolve approval、resolve user input。
- 将 Agent 高信号输出发回 Zulip。
- 对重复消息、重试、并发任务做幂等处理。

#### Noise Gate

负责降噪。默认规则：

- Agent 过程事件写 ledger，不发 Zulip。
- 同一任务短时间内多个更新合并成一个卡片。
- 相同问题不重复问同一个科学家。
- 静默时间只发安全告警和高风险审批。
- 每个项目每天最多 N 条非人工触发 Agent 消息。

#### Policy Governor

负责权限和风险判断。

- 低风险动作自动执行，写入 ledger。
- 中风险动作发到 `approvals` topic。
- 高风险动作只允许 PI 或指定 user group 审批。
- 无法判断风险时按高风险处理。

#### Research Ledger

新增 append-only 事件日志。任何科研状态变化都写入 ledger：

- Zulip 消息和反馈。
- Agent 计划、任务、运行状态。
- 审批请求和审批结果。
- 实验运行、输入、参数、输出、失败。
- artifact hash 和来源。
- Evidence DAG claim 引用。
- 周报生成和确认。

#### Evidence DAG

复用现有 `packages/domains/evidence-dag`。通用 Agent artifact consumer contribution 在 turn 完成后把 trace 输入 Evidence DAG。周报和成果卡片引用 Evidence DAG 的 claim/source/status。

#### Digest Generator

新增服务或 worker。输入 Research Ledger、Evidence DAG、Paper Radar digest、runtime thread summaries，输出周报草稿和 Zulip 消息。

## 数据模型

### ResearchProject

```ts
type ResearchProject = {
  id: string
  zulipRealmId: string
  zulipStreamId: string
  name: string
  workspaceRoot: string
  defaultRuntimeId: 'sciforge' | 'codex' | 'claude'
  agentBotUserId: string
  createdAt: string
  updatedAt: string
}
```

### ResearchTopic

```ts
type ResearchTopic = {
  id: string
  projectId: string
  zulipTopicName: string
  kind:
    | 'general'
    | 'hypothesis'
    | 'experiment'
    | 'agent_questions'
    | 'approvals'
    | 'decisions'
    | 'paper_radar'
    | 'weekly_report'
    | 'artifacts'
  defaultVisibility: 'group' | 'inbox' | 'ledger_only'
  createdAt: string
}
```

### ResearchTask

```ts
type ResearchTask = {
  id: string
  projectId: string
  topicId: string
  zulipRootMessageId?: string
  runtimeId: 'sciforge' | 'codex' | 'claude'
  runtimeThreadId?: string
  title: string
  prompt: string
  state: 'proposed' | 'approved' | 'running' | 'blocked' | 'completed' | 'failed' | 'archived'
  riskLevel: 'low' | 'medium' | 'high'
  createdByZulipUserId: string
  assignedAgentId: string
  createdAt: string
  updatedAt: string
}
```

### ResearchLedgerEvent

```ts
type ResearchLedgerEvent = {
  id: string
  projectId: string
  taskId?: string
  actor:
    | { kind: 'zulip_user'; userId: string }
    | { kind: 'agent'; agentId: string }
    | { kind: 'system' }
  kind:
    | 'zulip_message_received'
    | 'agent_turn_started'
    | 'agent_turn_completed'
    | 'approval_requested'
    | 'approval_resolved'
    | 'feedback_received'
    | 'experiment_run_started'
    | 'experiment_run_completed'
    | 'artifact_created'
    | 'evidence_claim_created'
    | 'decision_recorded'
    | 'digest_generated'
    | 'digest_published'
  payload: Record<string, unknown>
  createdAt: string
}
```

### ApprovalRequest

```ts
type ApprovalRequest = {
  id: string
  projectId: string
  taskId?: string
  runtimeThreadId?: string
  runtimeTurnId?: string
  zulipMessageId?: string
  requestedAction: string
  rationale: string
  riskLevel: 'medium' | 'high'
  requiredUserGroup: 'pi' | 'scientist' | 'reviewer'
  status: 'pending' | 'approved' | 'rejected' | 'changes_requested' | 'expired'
  decisionByZulipUserId?: string
  decisionNote?: string
  createdAt: string
  decidedAt?: string
}
```

### FeedbackRecord

```ts
type FeedbackRecord = {
  id: string
  projectId: string
  taskId?: string
  source: 'zulip_reply' | 'zulip_reaction' | 'poll' | 'voice_note' | 'artifact_annotation'
  zulipMessageId: string
  byZulipUserId: string
  meaning:
    | 'approve'
    | 'reject'
    | 'concern'
    | 'needs_evidence'
    | 'parameter_choice'
    | 'freeform_comment'
  content: string
  evidenceRefs: string[]
  createdAt: string
}
```

### WeeklyDigest

```ts
type WeeklyDigest = {
  id: string
  projectId: string
  periodStart: string
  periodEnd: string
  status: 'draft' | 'review_requested' | 'approved' | 'published'
  sections: {
    progress: string[]
    failedRuns: string[]
    newEvidence: string[]
    decisions: string[]
    blocked: string[]
    nextActions: string[]
  }
  sourceLedgerEventIds: string[]
  sourceEvidenceClaimIds: string[]
  draftZulipMessageId?: string
  publishedZulipMessageId?: string
  reviewedByZulipUserId?: string
  generatedAt: string
}
```

## Zulip 消息策略

### 默认可见消息

| 类型 | 默认 topic | 是否进群 | 说明 |
| --- | --- | --- | --- |
| 人类消息 | 当前 topic | 是 | 科学家讨论 |
| Agent 问题卡 | `agent-questions` 或当前 topic | 是 | 需要人类判断 |
| 审批卡 | `approvals` | 是 | 中高风险动作 |
| 决策记录 | `decisions` | 是 | 人类确认的重要决策 |
| Artifact 卡 | `artifacts` | 可配置 | 图表、报告、数据包 |
| Paper Radar digest | `paper-radar` | 可配置 | 每日/每周论文摘要 |
| Weekly digest | `weekly-report` | 是 | 项目周报 |
| 安全告警 | `approvals` 或 `decisions` | 是 | 权限、合规、数据异常 |

### 默认不进群消息

- Agent 工具调用开始/结束。
- Agent token 流。
- 中间日志和调试信息。
- 重试、缓存、上下文压缩事件。
- Evidence DAG 内部更新，除非影响结论状态。
- 低风险任务 ack。

## API 集成设计

### Zulip 到 SciForge

Bridge 需要处理这些 Zulip 事件：

- 新消息。
- @mention bot。
- topic 新建或移动。
- reaction 添加/移除。
- 用户组变化。
- 消息编辑。

事件处理流程：

```text
Zulip event
  -> idempotency check
  -> resolve project/topic
  -> parse command or card action
  -> write ResearchLedgerEvent
  -> route:
       command/task -> AgentRuntimeHost.startTurn
       approval action -> AgentRuntimeHost.resolveApproval
       feedback -> AgentRuntimeHost.steerTurn or resolveUserInput
       topic management -> update ResearchTopic
```

### SciForge 到 Zulip

Bridge 只发送高信号消息：

- `postAgentQuestionCard`
- `postApprovalCard`
- `postArtifactCard`
- `postDecisionRecord`
- `postWeeklyDigest`
- `postSafetyAlert`

所有发送必须先写 ledger，再调用 Zulip REST API。发送失败时，ledger 标记为 `delivery_failed`，由重试队列处理。

## MVP 范围

### MVP 1: Zulip 项目映射与 Agent 触发

交付：

- 配置一个 Zulip realm、bot token、stream 到 SciForge workspace 的映射。
- Bridge 能订阅 Zulip 消息。
- `@SciForge Agent` 能创建或复用 SciForge runtime thread。
- Agent 完成后能把简短结果发回原 topic。
- 所有 inbound/outbound 事件写入 Research Ledger。

验收：

- 在 Zulip 某个 project stream 中 @Agent 提任务，SciForge Runtime 能执行并返回结果。
- 重复投递同一 Zulip event 不会重复创建任务。
- Bridge 重启后能继续处理新消息。

### MVP 2: 提问卡与人工反馈

交付：

- Agent 可发 `clarification_request` 卡片。
- 科学家回复或 reaction 能被记录为 FeedbackRecord。
- Bridge 能将反馈转为 runtime user input 或 steer。

验收：

- Agent 阻塞在缺参数场景时，能在 Zulip 发问题卡。
- 科学家回复后，Agent 能继续执行。
- 反馈记录能在 ledger 中追溯到 Zulip message id。

### MVP 3: 审批卡

交付：

- 中高风险动作生成 ApprovalRequest。
- Bridge 在 Zulip `approvals` topic 发审批卡。
- PI 或指定 user group 的 approve/reject 能回写 AgentRuntime approval。
- 非授权用户审批无效，并发出轻量提示。

验收：

- 高风险动作没有审批时不能执行。
- 授权用户 approve 后任务继续。
- reject/request_changes 后 Agent 收到明确结果。

### MVP 4: 周报

交付：

- Schedule 每周触发 Digest Generator。
- Digest Generator 汇总 Research Ledger、Evidence DAG、Paper Radar、runtime thread summaries。
- 周报先发 draft 到 reviewer topic，确认后发到 `weekly-report`。

验收：

- 周报每条结论都有 source ledger event 或 evidence claim。
- 未验证 claim 显式标 `unverified`。
- PI 未确认时不发布到正式周报 topic。

## 后续增强

- Zulip narrow/search 视图内嵌 Evidence DAG 摘要。
- 图表/论文段落移动端轻量批注。
- 多 Agent 分工：Paper Radar Agent、Experiment Agent、Writing Agent、Review Agent。
- PI 偏好模型：学习审批和反馈风格，但必须可查看、可清除。
- 跨项目知识网络：同一实验室过去失败经验、protocol、artifact 可被检索。
- Contributor credit：记录人类反馈、Agent 产出、关键决策对成果的贡献。

## 安全与隐私

- Zulip 消息正文不得包含 API key、provider token、数据库密码、私有模型凭据。
- Restricted artifact 只发摘要和引用，不直接发文件。
- Bridge 需要最小权限 bot token。
- 所有高风险外发内容必须经过 redaction 和审批。
- Bridge 日志必须脱敏，不保存完整敏感消息 payload。
- 对外 collaborator 默认只能访问被邀请的 stream/topic。
- 删除 Zulip 消息不能删除 Research Ledger 事实，只能追加 redaction/tombstone 事件。

## 推送策略

Zulip 自托管移动推送需要单独配置。SciForge 不能假设可以直接转售或依赖 Zulip 官方推送服务。

第一版建议：

- 内部试点可使用 Zulip 官方支持的 self-hosted mobile push 机制。
- 商业发布前评估自建 APNs/FCM relay 或与 Zulip 官方条款确认。
- 高风险审批和专家问题应走 push；普通 Agent 结果可只留在 Zulip unread。

参考：

- Zulip mobile push notifications: https://zulip.readthedocs.io/en/latest/production/mobile-push-notifications.html

## 实施任务拆分

### 1. 许可证和上游基线

- 固定 Zulip server/mobile 上游 commit。
- 保存 Apache-2.0 license 和 NOTICE。
- 做第三方依赖许可证扫描。
- 去除 Zulip 品牌、logo、默认 App 名称、bundle id。
- 写 release boundary 文档。

### 2. Bridge 服务

- 新增 `packages/workers/zulip-bridge` 或 `plugins/zulip-bridge-service`。
- 配置 realm URL、bot email/token、stream mapping、workspace root。
- 实现 Zulip event 订阅、幂等、重试。
- 实现 Zulip REST 发送消息。
- 实现 Research Ledger 持久化。

### 3. AgentRuntime 接入

- Bridge 调用 `AgentRuntimeHost.startThread/startTurn/readThread/steerTurn/resolveApproval/resolveUserInput`。
- 为 Zulip 入口使用 `remote_guard` governance profile。
- 将 Zulip display text 与 hidden runtime prompt 分离。
- 保留 Zulip message id、stream id、topic name 到 runtime metadata。

### 4. 卡片协议

- 定义 Markdown 卡片模板：问题、审批、artifact、decision、weekly digest。
- 定义 reaction 和回复解析规则。
- 定义卡片版本号和 idempotency key。
- 支持卡片编辑而不是重复发新消息。

### 5. Digest Generator

- 从 Research Ledger 查询本周事件。
- 从 Evidence DAG 查询 claim/status/source。
- 从 Paper Radar 查询 digest。
- 从 runtime threads 查询任务摘要。
- 生成 draft，等待 PI 确认后发布。

### 6. 管理 UI

- 在 SciForge 桌面设置里添加 Zulip 配置。
- 支持测试 bot 连接。
- 支持选择 workspace 与 Zulip stream 绑定。
- 支持查看 Bridge 状态、最近失败、队列积压。

## 验收总标准

- 一个外部科学家只使用 Zulip Mobile，就能被邀请进项目 stream，看到 Agent 问题、审批、成果和周报。
- Agent 能在后台执行任务，但不会把过程日志刷进群。
- 任何周报结论都能追溯到 ledger 或 Evidence DAG。
- 高风险动作没有审批不会执行。
- Zulip Bridge 重启、网络重试、重复事件不会造成重复任务或重复审批。
- 商业发布包不包含 Zulip 品牌，也保留上游 Apache-2.0 声明和依赖许可证证据。

## 未决问题

- 第一版是否直接 fork Zulip Mobile，还是先使用官方 Zulip Mobile + SciForge bot/Bridge 验证工作流。
- 是否需要自建移动推送服务，还是先用 Zulip 官方 self-hosted push 机制。
- Research Ledger 第一版存 SQLite、JSONL，还是复用现有 runtime event store。
- 周报发布是否必须 PI approve，还是 reviewer approve 即可。
- 外部合作者是否使用 Zulip guest，还是独立 SciForge identity federation。
