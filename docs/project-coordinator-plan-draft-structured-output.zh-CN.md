# Project Coordinator 生成 Plan 失败：Runtime 返回了错误的任务结构

## 记录信息

- 日期：2026-08-27
- 分支：`test_colab`
- 影响范围：Project Plan 草稿生成、通用 Agent Runtime、Codex/Claude Runtime 适配器、协同中心错误提示
- 当前状态：Desktop 生产路径、自动化验证和真实本机 Runtime 验证已完成，等待合并与登录后 UI 复测

## 问题现象

用户已经连接 Cloud，Project 创建成功，并把另一个 User 加入 Project。Cloud、Runtime 和 Agent 状态都显示
就绪，但点击“生成 Plan 草稿”后界面只显示：

```text
Handler for project-coordinator.plan-draft.generate failed.
```

失败与第二个 User 是否在线无关。运行时调用本身已经完成；真正失败发生在 Project Coordinator 校验模型
最终输出时。

## 直接证据

失败 turn 返回的是常见的通用任务结构：

```json
{
  "tasks": [
    {
      "id": "task-1",
      "title": "...",
      "description": "...",
      "assignee": "...",
      "dependencies": [],
      "status": "pending"
    }
  ],
  "rationale": "..."
}
```

Project 域合同要求的却是：

```text
planItemId
title
objective
completionCriteria
dependencyPlanItemIds
requiredCapabilityTags
fileIntent
```

因此 `generatedPlanContentSchema` 正确地拒绝了输出；但旧路径把解析错误交给 Capability Broker，Broker 只
返回泛化的 handler failure，用户无法判断究竟是 Cloud、Runtime 还是数据结构出了问题。

## 根因

旧实现只在 prompt 中写了一句“返回严格 JSON”，没有在 Runtime 协议层约束最终响应结构。模型可以返回
语法正确的 JSON，却仍使用自己熟悉的通用字段。测试 fake 恰好总是返回完全符合合同的 JSON，所以没有
覆盖“模型成功、JSON 合法、domain shape 错误”这一真实失败模式。

另一个恢复风险是 durable directive ID 只包含 Project ID 和 Project revision。若修复后仍复用旧 ID，同一
revision 的重试可能与旧 prompt/Schema 的 turn 输入摘要冲突，不能安全恢复。

## 修复

1. 在 `@sciforge/domain-sdk/agent-execution` 增加可选、限长、provider-neutral 的 `outputSchema`。
2. Host 将 Schema 纳入稳定 directive 输入摘要，并向选定 Runtime 透传。
3. Codex app-server 使用原生 `turn/start.outputSchema`；Claude Agent SDK 使用原生
   `outputFormat: { type: "json_schema" }`。声明了 Schema 但 Provider 没返回 structured output 时直接
   fail closed。
4. Project Coordinator 从 canonical task 的固定字段构造 Provider-compatible JSON Schema，并在 Runtime
   返回后再次执行严格 Zod 校验；同时校验 `planItemId` 唯一且依赖只引用同一次响应中的条目。
   Portable locator 的 `identity` 是 Provider-owned 任意 JSON map，不能进入 strict structured-output
   Schema。文件任务只允许模型选择 `sourceInputIndex`；main 再绑定原始 exact locator 和 Cloud
   `provisioningRevision`，模型不能复制或发明 locator identity。
5. 生成的任务不包含 `assignee`。精确 Worker Agent assignment 仍在 Human 审核 Plan 草稿时完成。
6. directive ID 升级为 `project-plan:v2:<projectId>:<projectRevision>`，避免与修复前的 durable turn 冲突。
7. capability 只返回三种有界失败原因：`runtime_unavailable`、`runtime_execution_failed`、
   `invalid_structured_output`。Provider 原始响应和 Schema 诊断只保留为 main-process cause；UI 显示对应的
   中英文操作提示。

## 回归约束

- 通用 `id/description/assignee/dependencies/status` 任务 JSON 必须被拒绝；
- 错误输出不得写入本地 Plan draft；
- Schema 必须到达 Codex 和 Claude 的原生 structured-output 参数；
- Provider Schema 不得包含 `propertyNames`、递归 `$ref` 或任意 portable identity map；
- 文件选择必须由 main 从 `sourceInputIndex` 绑定为原始 locator 和 Cloud provisioning revision；
- Claude 声明 structured output 后缺少 `structured_output` 必须失败；
- 相同 Project revision 的新合同使用 `v2` directive identity；
- Renderer 不得看到 Provider 原始错误或内部 Schema 详情；
- 最终 Zod 校验始终保留，不能只信任 Provider 的 Schema 实现。

## 复测步骤

1. 启动修复后的 Desktop，完成 OIDC 登录并连接 Cloud。
2. 确认 Runtime、Coordinator Agent 和至少一个 Project member 可见。
3. 打开已创建的 Project，点击“生成 Plan 草稿”。
4. 预期出现至少一个包含目标、完成条件和能力标签的可编辑 Plan item。
5. 确认草稿中的 Agent assignment 初始为空，由 Human 从当前可见的 exact Agent 中选择。
6. 模拟 Runtime 不可用时，预期界面提示检查本地 Runtime，而不是显示泛化 handler failure。
7. 模拟结构错误时，预期界面说明 Plan 结构无效且未保存草稿，不展示 Provider 原始响应。

## 自动化验证回执

- Project Coordinator：`71/71`；
- Codex Runtime：`14/14`；
- root Vitest：`371/371` files、`3427/3427` tests；
- Node/Web/Domain typecheck、ESLint、Capability governance、package version audit、OpenSpec strict validation
  和 production build：通过；
- 本机真实 Codex `0.150.0-alpha.8`：修订前 Schema 被 Provider 明确拒绝
  `propertyNames is not permitted`；修订后同一 `--output-schema` 路径成功返回 7 个 canonical task 字段，
  且输出再次通过 Project Zod 合同。
- 同步最新 `test_colab` 并重新构建、重启 SciForge Desktop 后，再次通过正式
  `AgentRuntime -> local Codex adapter -> Codex app-server turn/start.outputSchema` 路径完成真实 turn
  `01a043c3-2919-7381-9dd2-34edf774ff6d`。Provider 实际返回 2 个 task、194 个 output tokens；根对象仅有
  `tasks/rationale`，每个 task 仅有 7 个 canonical 字段，正式 `projectPlanTaskSchema`、唯一 ID 和依赖闭包
  校验全部通过。测试创建的临时 Runtime thread 已在取证后删除。

本轮无法在真实 Cloud Project 上完成最后一次草稿持久化点击：开发进程重启后，现有 OIDC authority 已于
`2026-08-27T13:33:44Z` 失效，协作诊断明确返回 `OIDC User authority changed` / `Sign in to SciForge Cloud
before continuing`。Cloud HTTPS 端点和 TLS 可达；该登录状态不属于 Plan structured-output 修复，也不把它
计作通过。重新登录后仍须按上面的 UI 复测步骤验证 Cloud 草稿落盘。

仓库的 hardcoded changed-path architecture gate 依赖 commit
`e0038b8c7109390445dccb691052fec74a153c09`，该对象不在当前 `test_colab` 仓库对象库中，因此 gate 自身
无法计算 ancestry。作为可执行的静态替代检查，直接复用了同一脚本导出的 source-audit 函数，对相对
`origin/test_colab` 的当前变更路径执行检查，findings 为空；这不冒充 hardcoded gate 已通过。
