# Timeline、Decision 与协作模型

Timeline event 是结构化科研记忆记录，不是普通 prose log。它要能支持团队协作、证据追踪、分支假设、结论修订、导出策略和后续 agent 复盘。

## Timeline Event

最小事件结构：

```json
{
  "id": "event-1",
  "actor": "researcher",
  "action": "confirmed-decision",
  "subject": "claim-1",
  "artifactRefs": ["wetlab-result-1"],
  "executionUnitRefs": [],
  "beliefRefs": ["belief-graph-1", "decision-1"],
  "branchId": "hypothesis-main",
  "visibility": "project-record",
  "decisionStatus": "inconclusive",
  "createdAt": "ISO-8601"
}
```

事件必须用 refs 连接 artifact、ExecutionUnit、belief graph、decision 或外部证据。长文本解释可以作为摘要字段存在，但不能替代结构化引用。

## 湿实验或外部证据摘要

```json
{
  "qualityChecks": [
    { "key": "replicates", "status": "warn", "detail": "n=2" }
  ],
  "supports": [],
  "opposes": [],
  "uncertain": ["effect direction varies by replicate"],
  "limitations": ["repeat required"],
  "recommendedNextActions": ["repeat assay with n>=3"],
  "researcherDecisionRefs": ["decision-1"]
}
```

证据摘要应区分支持、反对、不确定性和限制条件。不要把 inconclusive 的结果改写成成功结论。

## Researcher Decisions

- `decisionStatus` 可取 `supported`、`not-supported`、`inconclusive`、`needs-repeat`。
- `revisionStatus` 可取 `original`、`supersede`、`retract`、`amend`、`reaffirm`。
- 新 decision 不能覆盖原始 evidence node。
- 修订通过 `supersedesRef` 和 belief graph 的 `supersedes` edge 形成序列。
- 人类确认、agent 建议和 verifier verdict 应分别记录，避免混成一个不可审计状态。

## Branch Model

- `variantKind=parameter` 是 run 属性，默认不创建 branch。
- `variantKind=method` 创建 method branch。
- `variantKind=hypothesis` 创建 hypothesis branch，并应指向 alignment contract 或 belief graph 来源。
- 分支合并时应记录合并依据、冲突、保留证据和被废弃假设。

## Collaboration Model

可见性：

- `private-draft`
- `team-visible`
- `project-record`
- `restricted-sensitive`

导出策略：

- `allowed`
- `restricted`
- `blocked`

Artifacts、timeline events、decision records 和 comments 在导出前必须携带 visibility、audience 与 sensitive data 字段。导出器不能只根据前端当前过滤状态决定能否导出。

## 与 Verify 的关系

Verifier 输出可以成为 timeline event 的 evidence ref，但 verifier verdict 不等同于最终科研结论。高风险结论仍应经过人类 decision 记录；低风险自动化检查则可以作为 machine evidence 附加到 run history。
