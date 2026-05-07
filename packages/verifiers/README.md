# SciForge Verifiers

`packages/verifiers` 存放 Verify 阶段的 provider contract。Verifier 接收目标、结果、artifact refs、trace refs、环境状态或验证 instruction，返回 verdict、reward、critique、evidence refs、repair hints 和 confidence。

Verify 是 Observe/Reason/Action/Verify 闭环的必要阶段，但 verifier provider 和验证强度按风险选择。低风险草稿可以使用轻量 verifier 或显式标记为 `unverified`；高风险动作、科研结论、外部副作用、发布、删除、支付、授权等任务必须有更强 verifier，并在必要时请求人类确认。

## Provider 类型

manifest 字段 `verifierType` 支持：

- `human`：用户验收、批注、打分、accept/reject/revise。
- `agent`：其它 agent 按 rubric 检查答案、artifact 和 trace。
- `schema-test`：JSON schema、artifact contract、lint、typecheck、unit test。
- `environment`：GUI 状态、文件系统 diff、外部 API 状态、仪器状态。
- `simulator-reward-model`：simulator 或 reward model，为下一轮 ReAct 提供可比较 score。

## Manifest

每个 verifier provider 至少提供一个 `verifier-provider.manifest.json`，并符合 [`verifier-provider.manifest.schema.json`](verifier-provider.manifest.schema.json)。

必需声明：

- provider id、类型、领域、触发条件和反触发条件。
- 输入 request contract：goal、result refs、artifact refs、trace refs、state refs、rubric、verification policy。
- 输出 result contract：verdict、reward、confidence、critique、evidence refs、repair hints、diagnostics。
- 风险覆盖范围和默认策略。
- evidence/trace 存储策略。
- 失败模式和可恢复建议。

## 示例

- [`examples/minimal-schema-test.manifest.json`](examples/minimal-schema-test.manifest.json)：最小 schema/test verifier 示例。
- [`fixtures/human-approval.manifest.json`](fixtures/human-approval.manifest.json)：human verifier fixture。

