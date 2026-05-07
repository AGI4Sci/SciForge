# AgentServer 任务生成协议

本文档定义 SciForge 调用 AgentServer 生成或修复 workspace task 时使用的最小协议。AgentServer 在这里只扮演通用任务生成/修复大脑，不应依赖 SciForge 内部硬编码工具名，也不应假设前端状态、DOM 或本地文件内容已经被完整塞进上下文。

## 设计原则

- 传递用户意图、可用能力、有限 workspace 摘要和 artifact/UI 契约，而不是传递大型文件正文。
- AgentServer 可以生成任务代码、入口、环境要求、验证命令和预期 artifacts。
- SciForge runtime 负责落盘、执行、收集 stdout/stderr、校验输出、记录 attempt history 和触发修复。
- 失败必须结构化返回，包含缺失条件、日志引用和下一步修复线索。
- 生成协议不绑定 UI；同一份请求应能由 UI 聊天、CLI 或自动化入口构造。

## 生成请求

```json
{
  "prompt": "User request",
  "skillDomain": "structure",
  "workspaceTreeSummary": [
    { "path": "data/input.csv", "kind": "file", "sizeBytes": 1234 }
  ],
  "availableSkills": [
    {
      "id": "structure.rcsb_latest_or_entry",
      "kind": "seed",
      "available": true,
      "reason": "Manifest validation passed"
    }
  ],
  "artifactSchema": {},
  "uiManifestContract": {},
  "uiStateSummary": {},
  "priorAttempts": []
}
```

关键字段说明：

- `prompt`：用户的科研目标或修复意图。
- `skillDomain`：任务领域，用于收敛可用技能和 artifact 期望。
- `workspaceTreeSummary`：有限目录摘要，避免把文件全文注入模型上下文。
- `availableSkills`：已通过 manifest 校验的候选能力。
- `artifactSchema`：期望输出的结构化 artifact 契约。
- `uiManifestContract`：UI 渲染可接受的 component/slot 契约。
- `uiStateSummary`：可选的 UI 选择、当前对象引用或 bounded summary。
- `priorAttempts`：历史运行或修复摘要，用于避免重复失败。

## 生成响应

```json
{
  "taskFiles": [
    {
      "path": ".sciforge/tasks/generated.py",
      "content": "print('ok')",
      "language": "python"
    }
  ],
  "entrypoint": {
    "language": "python",
    "path": ".sciforge/tasks/generated.py"
  },
  "environmentRequirements": {},
  "validationCommand": "python .sciforge/tasks/generated.py ...",
  "expectedArtifacts": ["structure-summary"],
  "patchSummary": "Created a new workspace task."
}
```

响应中的代码与入口仍需由 SciForge 做安全与 schema 校验。`validationCommand` 是建议验证命令，不代表 runtime 可以跳过本地 policy。

## 修复请求

```json
{
  "prompt": "User request",
  "skillDomain": "structure",
  "codeRef": ".sciforge/tasks/structure.py",
  "inputRef": ".sciforge/task-inputs/structure.json",
  "outputRef": ".sciforge/task-results/structure.json",
  "stdoutRef": ".sciforge/logs/structure.stdout.log",
  "stderrRef": ".sciforge/logs/structure.stderr.log",
  "schemaErrors": ["missing artifacts"],
  "userFeedback": "The result is not the requested protein.",
  "uiStateSummary": {},
  "priorAttempts": []
}
```

修复请求只传引用和摘要。AgentServer 如需更多上下文，应请求明确的 ref 摘要，而不是假设 runtime 会暴露完整 workspace。

## 修复响应

修复响应继承生成响应，并补充：

```json
{
  "parentAttempt": 1,
  "selfHealReason": "Schema validation failed.",
  "diffSummary": "Added missing artifact metadata and dataRef."
}
```

修复必须保留父 attempt、修复原因和差异摘要，方便 UI、CLI 与后续 verifier 解释为什么产生了新版本任务。

## Attempt 记录

- 每次运行或修复都应在 `.sciforge/task-attempts/` 下写入 `TaskAttemptRecord`。
- 修复 attempt 必须保留 `parentAttempt`、`selfHealReason`、`patchSummary` 和可选 `diffRef`。
- 成功 attempt 应关联生成的 artifacts、ExecutionUnits、stdout/stderr refs 和验证结果。
- 如果 AgentServer 无法生成或修复任务，SciForge 返回 `repair-needed` 或 `failed`，并携带代码/日志引用、具体缺失条件和可恢复建议。

## 与 Observe / Action / Verify 的关系

AgentServer 负责 Reason 阶段的代码与修复生成；Observe、Action、Verify 分别由 senses、actions 和 verifiers/runtime policy 承担。对于 GUI 或视觉任务，AgentServer 不应直接输出屏幕坐标；它应生成任务目标和策略，由 `vision-sense`、Computer Use action 与 verifier 闭环处理。
