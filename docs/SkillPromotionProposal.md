# Skill 提升提案

SciForge 只有在用户审阅后，才会把一次或多次成功的 workspace task 提升为已安装 skill。Promotion proposal 是草稿记录，不是可执行 skill；它用于保留来源、泛化说明、验证计划和人工确认状态。

## Proposal 结构

```json
{
  "id": "proposal.<skill-id>.<timestamp>",
  "status": "needs-user-confirmation",
  "createdAt": "ISO-8601",
  "source": {
    "workspacePath": "/absolute/workspace",
    "taskCodeRef": ".sciforge/tasks/example.py",
    "inputRef": ".sciforge/task-inputs/example.json",
    "outputRef": ".sciforge/task-results/example.json",
    "stdoutRef": ".sciforge/logs/example.stdout.log",
    "stderrRef": ".sciforge/logs/example.stderr.log",
    "successfulExecutionUnitRefs": ["EU-..."]
  },
  "proposedManifest": {
    "id": "domain.task_name",
    "kind": "workspace",
    "description": "What reusable task this skill performs.",
    "skillDomains": ["structure"],
    "inputContract": {},
    "outputArtifactSchema": {},
    "entrypoint": {
      "type": "workspace-task",
      "command": "python",
      "path": "tasks/example.py"
    },
    "environment": {},
    "validationSmoke": {},
    "examplePrompts": [],
    "promotionHistory": []
  },
  "generalizationNotes": [
    "Which user-specific paths, ids, or thresholds were parameterized."
  ],
  "validationPlan": {
    "smokePrompts": [],
    "expectedArtifactTypes": [],
    "requiredEnvironment": {}
  },
  "reviewChecklist": {
    "noHardCodedUserData": false,
    "reproducibleEntrypoint": false,
    "artifactSchemaValidated": false,
    "failureModeIsExplicit": false,
    "userConfirmedPromotion": false
  }
}
```

## 提升规则

- Proposal 必须指向促成本次提升的准确 task code、input、output、logs 和成功 ExecutionUnit。
- 只有 validation smoke 通过且 `userConfirmedPromotion=true` 后，拟议 skill 才能变为可用。
- 用户特定路径、标识符、凭证、一次性阈值和临时 workspace 假设必须参数化或删除。
- 失败任务可以生成 repair notes，但不能直接提升；必须等待后续成功 run。
- skill manifest 中必须说明输入 contract、输出 artifact schema、失败模式和可复现入口。

## 与 Scenario / Runtime 的关系

Promotion 后的 skill 可以被 scenario package 选择，但 scenario 应引用 skill manifest 与版本，而不是复制 proposal 内容。Runtime 执行时继续记录 ExecutionUnit、artifact refs、stdout/stderr refs 和 verifier 结果，方便将来再次审计或升级 skill。

## 安全边界

Promotion 不是自动授权。任何会写文件、调用外部服务、操作 GUI、访问凭证或影响实验设备的能力，都必须在 manifest 中声明 action boundary、安全闸门和验证策略。可复用 skill 应尽量只表达任务知识和代码入口；外部环境动作交给 `packages/actions`。
