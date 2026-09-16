# Capability Workflow Eval 测试集

这份测试集用于评估真实 Agent 是否能从自然语言任务出发，自主完成 routing、discovery、action selection、参数构造、连续调用和最终交付。它与 `golden.jsonl` 的 deterministic Capability Unit Eval、以及 `evaluator-self-test.jsonl` 的 grader 自测分开运行。

## 首批 13 条任务

首批任务定义在 `eval-cases/capability/workflow-golden.jsonl`，全部没有 `simulation`。运行时 evaluator 不会得到预先写好的调用轨迹；Agent 只会收到 case 的 `query`。每条任务的 `requiredActions`、`allowedActions`、`forbiddenActions`、授权要求、顺序约束和最终状态断言只由 evaluator 使用。

| Case | 类型 | 重点覆盖 | 运行前提 |
| --- | --- | --- | --- |
| `workflow-single-paper-search` | single-action | 基础 routing、discovery、selection、invocation | 当前 Paper Radar 索引 |
| `workflow-paper-ranking-recent` | multi-step | search → rank、日期和 topK 参数 | 当前 Paper Radar 索引 |
| `workflow-paper-digest-grounded` | multi-step | 检索、排序、digest 和证据关联 | 当前 Paper Radar 索引 |
| `workflow-paper-profile-review` | multi-step | profile discovery、profile 传递、简报生成 | 已配置 `protein design` profile |
| `workflow-paper-trend-plot` | cross-domain | Paper Radar → Scientific Plotting、全量统计和绘图 | 当前 Paper Radar 索引、可用 plotting workspace |
| `workflow-dataset-to-plot` | cross-domain | dataset profile/filter → plotting | case 自带 JSONL fixture |
| `workflow-dataset-clean-validate` | multi-step | 去重、列选择、数据质量验证 | case 自带 JSONL fixture |
| `workflow-dataset-filter-transform` | multi-step | 条件筛选、字段转换、验证 | case 自带 JSONL fixture |
| `workflow-dataset-join-validate` | multi-step | 两个数据集关联、结果验证 | case 自带 JSONL fixture |
| `workflow-compute-baseline-artifacts` | multi-step | provider status、baseline、artifact 结果 | `local-fixture` compute provider |
| `workflow-evidence-project-review` | cross-domain | Evidence 和 Project 状态联合读取 | 当前 thread/workspace context |
| `workflow-paper-profile-save-approval` | single-action | confirmation authorization、写入前置审批 | 可完成 confirmation 的 Agent runtime |
| `workflow-capability-explanation-no-call` | boundary | 只回答问题时不得调用 Capability | 无需 workspace/provider |

`paper-radar.rank` 本身可以查询并排序本地索引，因此不是所有文献任务都强制要求先调用 `search`。只有用户目标明确包含“先检索再筛选”的数据依赖时，case 才将 `search → rank` 作为 ordering contract。`scientific-compute.run-baseline` 当前是 `local-fixture` baseline，不代表通用统计计算能力。

## 运行方式

启动 SciForge 开发实例后，执行真实 Agent workflow：

```sh
npm run dev

npm run eval:capability -- \
  --live \
  --cases eval-cases/capability/workflow-golden.jsonl \
  --output eval-results/workflow-live
```

默认 `--live` 连接已有开发实例，适合观察 Agent 行为；需要隔离全局 Paper Radar DB、profiles 和 Host 进程内缓存时，使用每条 case 启动并销毁一个临时 Host 的模式：

```sh
npm run eval:capability -- \
  --live \
  --isolate-global-state \
  --cases eval-cases/capability/workflow-scenarios.jsonl \
  --output eval-results/workflow-scenarios-live
```

该模式要求当前没有其他 `npm run dev` 实例占用项目开发锁和 bridge 端口；每条 case 的临时 `userDataDir` 会在 Host 退出后删除。外部 provider 的远端状态、账号侧 rate limit 和未由 SciForge 控制的缓存仍需由 provider harness 隔离。

为了先观察全部失败详情，可以临时加 `--allow-failures`。每条 case 的原始 full trace 会写入输出目录的 `traces/<case-id>.jsonl`，规范化的执行状态和验收证据会写入同目录的 `traces/<case-id>.trace.json`，后续可以离线重放：

```sh
npm run eval:capability -- \
  --cases eval-cases/capability/workflow-golden.jsonl \
  --trace-dir eval-results/workflow-live/traces \
  --output eval-results/workflow-replay
```

`fixtures.files` 会在每条 case 的隔离 workspace 中创建文件。fixture 只提供输入数据，不提供 Agent 的 action 轨迹，也不提供最终答案。删除 live thread 时 Host 会清理该 thread 的 capability approval 和订阅状态。普通 `--live` 运行仍共享已有 Host 的全局 index；使用 `--isolate-global-state` 时，Paper Radar local DB、profiles 和 Host 进程内授权缓存随每条 case 的临时 `userDataDir` 隔离。外部 provider 和已有 workspace resource 仍需要由运行环境单独准备。

## 任务完成证据

工具调用成功不等于任务完成。带有 `expectedFinalState` 的 case 必须提供独立 final-state inspector，或者通过 `--final-state-dir` 提供由测试环境核验的结果文件。结果文件不是给 Agent 的提示，而是 evaluator 的外部 oracle，例如：

```json
{
  "taskSuccess": true,
  "finalState": {
    "rankedResults": true,
    "rankedCount": 5,
    "plotCreated": true
  },
  "evidence": ["verified against the isolated workspace artifact"]
}
```

没有 final-state evidence 时，报告仍然会记录真实 trajectory、调用结果和错误原因，但 `Task Success Rate` 与 `Final State Accuracy` 必须显示为 unsupported 或不完整，case 状态为 `INCONCLUSIVE`，不能把 turn completed 当作任务成功。

对于 open-ended summary，数量、日期、引用存在性和统计值优先用 deterministic assertion。`grounded-summary` 和 `state-grounded-explanation` 保留为 `llm_judge` rubric；当前没有 LLM Judge 时应显示 unsupported，不应伪造分数。
真实 trace 同时保存 `assistantMessages` 和 `finalAnswer`，因此后续接入 Judge 时可以评估 Agent 的最终回答，而不必重新运行 workflow。

报告中的 `Invocation Success Rate` 只统计已经解析为 Capability action 的 logical invocation；`Runtime Tool Success Rate` 统计 trace 中所有有终态的 Runtime Tool 调用。二者不能互相替代。`averageToolCalls` 是全部 Runtime Tool 数，`averageCapabilityToolCalls` 只统计已解析的 Capability 调用。

Runtime Tool 的 allow-list 是显式约束：如果 case 没有填写 `expected.tools.allowed`，Agent Runtime 的辅助工具（例如 `exec_command`）会保留在 trace 中用于诊断，但不会自动算作错误；只有填写 `allowed`，或明确填写 `forbidden` / `unnecessary` 时，才会参与 Runtime Tool 选择约束。

## 覆盖口径

Coverage 需要分开统计：

- 设计覆盖：case contract 是否涉及 action。
- 真实调用覆盖：full trace 是否实际调用 action。
- 成功调用覆盖：实际调用是否成功。
- 任务贡献覆盖：输出是否被后续步骤或最终交付使用。
- 边界覆盖：是否测过授权、失败、重试或不必要调用。

现有 coverage report 主要回答设计覆盖，不能直接当作 151 个 Agent-visible action 的真实调用成功率。需要验证“完全不调用 Capability”的边界时使用 `expected.noCapabilityCalls: true`；这与 `allowedActions: []` 不同，后者表示没有配置 Action allow-list 限制。

下一批受控场景已经定义在 `eval-cases/capability/workflow-scenarios.jsonl`，共 6 条，覆盖授权拒绝、失败恢复、持续失败、空结果、合理替代路径和跨 domain 数据依赖。后续扩展到约 60 条任务时，建议将首批 13 条作为稳定基线，再增加：

- 约 24 条同 domain 多步任务；
- 约 20 条跨 domain 任务；
- 约 8 条授权、重试、持续失败、空结果和边界任务。

只有在对应 fixture、provider fault injection、workspace resource 和 final-state inspector 可用后，边界任务才进入可执行的 live golden set。否则应单独标记为 pending，不能用 deterministic simulation 冒充真实 Agent 结果。

## 失败诊断要求

报告应该能把下面几种情况区分开：

- action 没有被调用：`missing action`；
- action 被调用但失败：`invocation failure`，附带 error code、logical invocation 和 provider attempts；
- 调用了不允许或禁止的 action：`wrong/forbidden action`；
- 上一步结果没有传到下一步：`final-state` 或数据 lineage assertion failure；
- Agent 宣称完成但没有交付证据：`task success unsupported` 或 `final-state mismatch`。

`operationRef → capabilityId` 必须来自 Host 的结构化 identity evidence。无法可靠解析 action ID 时，报告应显示 unresolved，而不是根据 tool title 或 tag 猜测。
