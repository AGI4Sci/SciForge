# 06C 财务报销闭环设计与第一版实现说明

状态：第一版骨架
负责人：王学文
依赖任务：06A 统一 Trace 与 Collector

## 1. 目标

06C 的目标是让 SciForge 能够安全记录科研 Agent 使用资源后产生的费用，并形成可审核、可追溯、不可误提交的报销草稿流程。

第一版不接真实财务系统，不提交真实报销，不付款，也不保存个人敏感信息。当前实现使用本地 fixture 来证明流程闭环：

```text
Resource Usage
  -> Cost Calculation
  -> Expense Recognition
  -> Expense Validation
  -> Expense Draft Artifact
  -> Evidence
  -> Human Review
  -> 06A Trace Collector
```

## 2. 第一版交付内容

本次实现包括：

- `ScientificExpenseRecognizer`：从资源使用记录中识别费用条目；
- `ScientificExpenseValidator`：校验缺项、重复、金额冲突、PII、真实提交和付款风险；
- `ScientificExpenseDraftBuilder`：生成只读报销草稿 Artifact；
- `createScientificExpenseBaselineTrace()`：生成 06C baseline Trace；
- `createScientificExpenseBaselineJsonl()`：导出 JSONL baseline；
- `validateScientificExpenseBaselineTrace()`：复用 06A closure validation；
- 三类 fixture 与 baseline Trace：
  - `normal-sanitized`：脱敏正常报销草稿；
  - `missing-fields`：缺项，需要人工补充；
  - `duplicate-conflict`：重复或金额冲突，需要人工拒绝或修改；
- 单元测试覆盖识别、核验、必要提问、草稿、人工审核、拒绝、禁止真实提交、禁止付款和禁止泄露个人信息。

相关文件：

- `packages/domains/finance-expense/src/scientific-expense.ts`
- `packages/domains/finance-expense/src/scientific-expense.test.ts`
- `packages/domains/finance-expense/src/definition.ts`
- `packages/domains/finance-expense/src/main.ts`
- `packages/full-trace/src/scientific.ts`

## 3. 三类 baseline Trace

### 3.1 脱敏正常 baseline

```text
USER_INPUT
  -> RESOURCE_USAGE_RECORDED
  -> COST_ESTIMATED
  -> AGENT_ACTION(expense recognition)
  -> TOOL_CALL_COMPLETED(expense validation ok)
  -> EXPENSE_DRAFT_CREATED(draft-only artifact)
  -> EVIDENCE_ATTACHED
  -> BUDGET_APPROVAL_REQUESTED
  -> BUDGET_APPROVAL_RECORDED
  -> HUMAN_REVIEW_RECORDED
```

特点：

- 输入不包含邮箱、手机号、身份证、银行卡、token 等敏感信息；
- 只生成草稿，不真实提交；
- `realSubmissionAllowed = false`；
- `paymentAllowed = false`；
- 人工审核记录包含明确 reason。

### 3.2 缺项 baseline

```text
USER_INPUT
  -> RESOURCE_USAGE_RECORDED
  -> COST_ESTIMATED
  -> AGENT_ACTION(expense recognition)
  -> TOOL_CALL_COMPLETED(expense validation failed)
  -> HUMAN_REVIEW_REQUESTED(required question)
  -> EXPENSE_DRAFT_CREATED(needs-information draft)
  -> EVIDENCE_ATTACHED
  -> HUMAN_REVIEW_RECORDED
```

特点：

- 缺少 projectId、budgetId、purpose、amount 或日期等必要字段时不静默通过；
- 系统产生必要提问；
- 草稿状态为 `needs-information`；
- 人工审核记录说明为什么阻塞。

### 3.3 重复/冲突 baseline

```text
USER_INPUT
  -> RESOURCE_USAGE_RECORDED
  -> COST_ESTIMATED
  -> AGENT_ACTION(expense recognition)
  -> TOOL_CALL_COMPLETED(expense validation failed)
  -> HUMAN_REVIEW_REQUESTED(conflict review)
  -> EXPENSE_DRAFT_CREATED(rejected draft)
  -> EVIDENCE_ATTACHED
  -> HUMAN_REVIEW_RECORDED
```

特点：

- 重复 receiptId 或 usageId 会被识别；
- 金额与数量乘单价不一致会被识别；
- 草稿状态为 `rejected`；
- 人工审核记录拒绝原因；
- 不会真实提交或付款。

## 4. 安全边界

06C 第一版明确禁止：

- 调用真实报销系统；
- 调用真实付款接口；
- 保存银行卡、身份证、手机号、邮箱、家庭地址、token、API key、cookie；
- 把真实财务凭证内容原文写入 Trace；
- 在缺项、重复或冲突时自动通过。

当前实现只保存脱敏后的结构化引用，例如：

- `usageId`
- `receiptId`
- `receiptHash`
- `projectId`
- `budgetId`
- `artifactId`
- `evidenceId`

## 5. 与 06A 的关系

06C 不是另一套日志系统，而是复用 06A：

- 所有事件都是 `ScientificTraceEvent`；
- 所有事件通过 `prepareScientificTraceEvent()`；
- baseline 通过 `validateScientificTraceClosure()`；
- 可通过 `ScientificTraceCollector` 写入 `LocalTraceStore`；
- Artifact、Evidence、Human Review 和 Parent Event 都接受 06A 的统一校验。

## 6. 与 06B 的关系

06B 会产生资源使用事件，例如：

```text
RESOURCE_USAGE_RECORDED
```

06C 可以把这些资源使用记录转换为费用草稿：

```text
GPU hours / API tokens / Storage GB / Human minutes
  -> Cost estimate
  -> Expense draft
  -> Budget approval
  -> Human review
```

因此 06B 是科研计算用例，06C 是科研计算资源费用的财务闭环用例。两者都依赖 06A Trace。

## 7. 当前验证方式

运行：

```bash
npm --workspace @sciforge/full-trace run test
npm --workspace @sciforge/full-trace run typecheck
```

当前测试覆盖：

- 正常脱敏 baseline Trace；
- 缺项 baseline Trace；
- 重复/冲突 baseline Trace；
- JSONL 可解析；
- baseline Trace 可通过 06A closure validation；
- baseline events 可写入 LocalTraceStore；
- 禁止真实提交；
- 禁止付款；
- 禁止 PII 或付款信息进入 Trace。

## 8. 后续服务器扩展

后续如果接真实服务器，可以新增 adapter，例如：

```ts
class RemoteExpenseDraftAdapter {}
class BudgetServiceAdapter {}
class FinancePolicyAdapter {}
```

但这些 adapter 仍然只能输出草稿、审批和 Trace 事件。真实提交、付款、真实个人信息处理必须放在人工审核和安全边界之外，不能由当前 06C fixture 自动执行。
