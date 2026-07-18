# SciForge Project DAG worker

该 worker 严格按 `docs/evidence-project-dag-design.zh-CN.md` 将多个 **committed Evidence Snapshot** 编译为项目级不可变快照。它不读取原始聊天、不接受未提交 PROV、不提供直连 compiler 的 HTTP 旁路。

## 唯一更新链路

所有自动提交、手动立即更新、Goal 变化、DecisionEvent 和恢复重试最终都写入同一 `project_update_job`：

```http
POST /updates
Authorization: Bearer $SCIFORGE_PROJECT_DAG_API_KEY
Content-Type: application/json

{
  "projectKey": "path:/workspace/project-a",
  "evidenceVector": [{"threadId":"runtime:thread-1","digest":"sha256:..."}],
  "capturedScope": {
    "includedSessions":["runtime:thread-1"],
    "excludedSessions":[],"isolatedSessions":[]
  },
  "reason":"evidence_snapshot_committed",
  "priority":5,
  "autonomyMode":"checkpointed"
}
```

`evidenceVector` 是跨 DAG 的唯一输入合同。Project DAG 使用 `threadId + digest`
直接读取并验证 Evidence DAG 已提交的不可变文件，不接收、不复制、也不缓存
Snapshot envelope。Evidence DAG 始终是来源、证据与 provenance 的唯一事实层；
Project DAG 只按 Goal、scope 与 policy 编译派生视图。

Evidence commit 可以只携带变化 session；worker 只与该 `projectKey` 已持久化 membership/vector 合并，绝不扫描全局 Evidence store 扩大 scope。显式 scope 命令必须携带完整 captured scope。每个 Project Snapshot 固化实际 included/excluded/isolated 集合与精确 digest vector。

P2 worker 按项目合并触发、每项目同时最多一个 generation；重启时 running job 直接恢复为 queued。编译 graph 与 Project Snapshot 在同一个 SQLite 事务提交，失败不会暴露中间图。可重试失败进入 `retry_scheduled` 并保存 `last_error / attempts / next_attempt_at`；超过上限后进入终态 `failed`，只能通过 `POST /updates/{jobId}/retry` 重新进入同一编译 lane。

Snapshot 提交事务只把绑定该 immutable digest 的 L0 请求写入独立 `audit_run` durable queue，不执行审计。P3 audit worker 使用独立数据库连接低优先级消费；进程退出后恢复 running job，失败同样持久化错误和指数退避。新 Project Snapshot 提交会把旧 digest 的 queued/running/completed/failed 审计统一标记为 `stale`，不会用旧 Finding 覆盖新图。审计/注意力是 fail-open 只读侧链，失败不会反向把已经提交的 Project job 标为失败。

## 主要只读合同

- `GET /updates/status?projectKey=...`：latest committed、desired vector、pending/error/next retry、audit target/status/error/next retry、attention。
- `GET /updates/history?projectKey=...`
- `POST /updates/{jobId}/retry`：人工立即重试 `retry_scheduled` 或 `failed` 编译任务。
- `GET /snapshots/latest?projectKey=...`
- `GET /snapshots/{digest}`
- `GET /graph?projectKey=...`
- `GET /claims?projectKey=...`、`GET /claims/{id}?projectKey=...`
- `GET /provenance/{claimId}?projectKey=...&snapshotDigest=...`
- `GET /assessments|findings|reviews|attention?projectKey=...`
- `POST /reviews/{reviewPacketId}/decision`：记录 `approve | reject | defer | request_evidence` 人工结果。

Graph/claim/detail 查询只读取 latest committed Snapshot payload；即使 writer 正在事务中更新 current tables，客户端仍只看见上一个完整版本。

`GET /graph` 同时返回节点级 `humanReview`、去重的 `humanReviews`、当前
`reviewPackets` 和项目级 `humanReview` gate 汇总。统一状态为
`not_needed | pending | approved | rejected | deferred | expired`；每条记录包含
level、0..1 score、结构化 reasons、blocking、policyVersion、timestamps 与 checker。
Review Packet 还包含 question、machineChecks、delta、blastRadius、recommendedAction
和 options。新项目默认 `checkpointed`；旧 Snapshot/数据库无需 human-review 字段仍可读取。

内置 UI 的 Claim 列表可点击，并把详情查询固定到列表所来自的 committed Snapshot digest。详情按设计顺序展示状态与 scope、按溯源等级/工件可验证性/source quality 分维度排序的 strongest path、按 Artifact 身份去重的独立来源、支持/反对/refinement/适用性限定、ArtifactVersion/SourceAnchor/run、L0–L4 与断点，以及与该 Claim Finding 可证明关联的 DecisionEvent。不同 session 不会被误算成独立来源，项目级 Decision 也不会冒充 Claim 历史。移除来源的 what-if 只在浏览器内对 committed graph 做 `supports` / `derived_from` / `same_as` 依赖模拟，不发写请求、不修改当前图。

## Goal、审计、Decision 与发布

- `POST /goals` 立即创建 Goal version，并 enqueue 同一更新 lane。
- `POST /goals/{root}/update` 版本化更新；agent 改写根意图只创建可见 reframe proposal。
- `POST /audits`：只持久化 P3 请求并立即返回 queued AuditRun；`L0` 检查结构/断路/循环/共享源，`L1` 消费独立 A1/A2 ledger，`L2` 检查新鲜度/溯源阈值/发布策略。
- `GET /audits?projectKey=...`、`GET /audits/{auditId}`：读取 durable audit 状态与历史。
- `POST /audits/{auditId}/retry`：人工立即重试 failed 审计；stale 审计不可重试，必须对最新 digest 发起新请求。
- `POST /decisions`：保存 actor、autonomy mode、rationale、alternatives、evidence digest、confidence、reversibility 和 supersession；随后 enqueue 同一更新 lane。
- `POST /policy`：配置 `autonomous | checkpointed | supervised` 与 checkpoints。
- `POST /releases`：candidate/certified gate。外发时还必须携 Runtime authorization；DAG policy 不能替代 Runtime 权限。

审计只写 `AuditRun/Finding/ReviewItem` 侧链，不能修改图。每个需要处理的 Finding 都先形成同一结构的 ReviewItem；A3 根据可证明状态选择 `resolve / defer / request_evidence / challenge / override`，其中 resolve 必须由更新后的独立 assessment 证明条件已消失，agent override 必须同时满足项目策略和独立 assessment。DecisionEvent 才能改变处理状态，并作为 `decision_outputs` 由统一 compiler 进入下一不可变 Project Snapshot，禁止从审计页直接改图。

ReviewItem 保存结构化 `remediationCandidate`。它只描述下一步和目标，不执行工具：需要补证据时明确标记 `externalAction=true / runtimePermissionRequired=true / execution=record_only`，后续真实网络、发布、仪器或其他高风险动作仍只能由 Runtime 授权执行。`autonomous` 自动决策；`checkpointed` 只在配置的 Finding/subject/critical checkpoint 暂停；`supervised` 保留同一 ReviewItem/Decision/compile 链路但等待人类 Decision。相同 target digest、level 与 policy version 的请求使用稳定 request key 幂等合并；相同 evidence vector/policy 下未解决 Finding 不会因重复 A3 自动消失，也不会无限生成等价 Decision。显式 defer/override 可以在只增加 Decision 的同 vector snapshot 继承，但新 Evidence vector 必须重新复核。

## 跨层 provenance

resolver 严格消费 Evidence PROV 顶层：

- `edag:meta.snapshot`（status 必须为 `committed`）
- `edag:artifactRegistry` 的 `artifacts/artifactVersions/sourceAnchors`
- `edag:source_assertion` 的 `artifact_id/artifact_version_id/source_anchor_id`

返回 Project Claim → session origin → SourceAssertion → structured SourceAnchor → ArtifactVersion/Artifact 的完整路径、`reachesArtifact`、L0–L4 和明确断点。无 anchor 不能达到 L2，无内容/anchor digest 不能达到 L3。

resolver 在同一条读取链路上执行 fail-closed 访问策略继承：Project Snapshot/graph/scope、Project Claim、session Claim、SourceAssertion、ArtifactVersion、SourceAnchor、Artifact 和 run 任一环节受限，都会在没有宿主注入的可信授权判定时脱敏该 provenance path。脱敏结果只保留不可逆对象哈希、内容/anchor digest、存在性、L0–L4 和 `access_restricted` breakpoint；不会返回 statement/content、locator/历史路径/重绑定候选、selector/quote/query、run 输入/代码/参数/环境/输出或 ACL 内容。存储的 `accessPolicy` 只是约束 metadata，不能作为调用者给自己的授权；未知的非空策略结构默认按 restricted 处理。

## 验证

```bash
npm --workspace @sciforge/project-dag test
npx vitest run packages/workers/project-dag/desktop/*.test.ts
```

测试覆盖 committed-only 输入、不可变 vector、跨 workspace scope、原子失败回滚、编译退避/人工 retry、P3 审计入队与重启恢复、审计失败退避/人工 retry/stale、A0–A3、三自治模式、Decision supersession、分层 audit、跨层 L3 provenance、注意力前沿和 Runtime release permission。
