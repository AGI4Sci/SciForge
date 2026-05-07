# CLI 与 UI 共享 Agent 使用说明

本文档说明 SciForge 如何让 UI 聊天和终端/CLI 任务执行保持一致。UI 和 CLI 不需要拥有相同的呈现方式，但应该尽可能复用同一套推理、上下文、观察、动作、验证、artifact 和失败恢复契约。

## 共享核心

两个入口都应收敛到同一种 agent handoff 形状：

```text
用户意图
  -> 共享 Agent handoff contract
  -> scenario / skill-domain / refs / artifact policy
  -> AgentServer 或 workspace runtime
  -> ToolPayload / artifacts / ExecutionUnits / object references
  -> UI renderer 或 CLI formatter
```

共享字段放在 `src/shared/*`。共享模块不得 import React、DOM API、Node-only filesystem/process API 或页面组件。

当前第一层共享模块是 `src/shared/agentHandoff.ts`，它定义：

- `handoffSource`：`ui-chat`、`cli`、`workspace-runtime` 或 `test`。
- 共享 skill domain：`literature`、`structure`、`omics`、`knowledge`。
- 共享默认 AgentServer URL。
- 共享默认请求超时。
- 共享调度原则：用户可见答案由 AgentServer/backend 推理。
- 共享上下文原则：传 refs 和 bounded summaries，不把大 payload 全量塞进上下文。

## UI 聊天

UI 聊天面向交互式科研工作，负责：

- 收集当前可见 session 上下文和用户显式引用。
- 展示流式事件和当前 run 状态。
- 通过已注册 interactive views 渲染 artifacts。
- 保存本地/workspace 聊天记录。
- 让用户选择对象、文件、组件和 scenario 设置。

UI 聊天不得维护一套私有任务协议。它向 workspace runtime 发送任务时，必须包含 `handoffSource=ui-chat` 和 `sharedAgentContract`。

UI-only 事项可以继续留在 UI 层，例如面板布局、选择弹层、滚动、视觉反馈和组件 allowlist。但任务上下文、artifact 期望、已选工具、已选 senses 和 action 边界的语义应与 CLI 共享。

## CLI / 终端执行

CLI 执行面向脚本化、可复现运行，负责：

- 从终端 flags、文件或 stdin 接收 prompt/config。
- 将日志和 artifacts 写入 workspace 路径。
- 为自动化返回机器可读摘要。
- 在没有浏览器 UI 状态的情况下运行。

CLI 默认使用 `handoffSource=cli`。

如果 CLI 命令收到与 UI 聊天相同的 prompt、references、workspace path、scenario package、selected senses/actions/verifiers 和模型配置，它应该进入同样的 workspace runtime 语义。输出呈现可以不同：CLI 可以打印 JSON、Markdown、路径或紧凑状态行；UI 则用组件渲染同一个 ToolPayload。

## 共享边界规则

- AgentServer/backend 负责正常用户可见答案的推理。
- UI 和 CLI 只提供上下文、refs、artifact policy、已选能力和诊断。
- 大型 artifacts、截图、PDF、notebook 和 trace data 应以 refs 加 bounded summaries 传递。
- 结构化失败必须包含足够信息，方便后续 UI 或 CLI run 修复：failure reason、missing input、logs/refs、recover actions、next step 和 attempt history。
- 为 UI 新增的 contract 必须能在 CLI 中表达，不依赖 browser-only state。
- 为 CLI 新增的 contract 必须能被 UI 展示，不依赖 terminal-only output parsing。

## Observe / Reason / Action / Verify 闭环

SciForge 的执行闭环应始终包含 verify 阶段：

```text
Observe -> Reason -> Action -> Verify -> 更新记忆/策略 -> 下一轮
```

Verify 是闭环的必要阶段，但不是每次都必须调用昂贵或人工 verifier。每个 run 都应明确自己的验证策略：低风险草稿可以使用轻量规则或记录为 `unverified`；会影响外部环境、科研结论、文件写入、发布、删除、支付、授权等任务必须使用更强 verifier，并在必要时请求人类确认。

SciForge packages 应围绕以下能力组织：

```text
packages/
  senses/        observe: instruction + modality -> text-response
  skills/        reasoning strategy and task knowledge
  actions/       action providers: instruction/action plan -> environment effect + trace
  verifiers/     verification providers: result/trace/artifact/state -> verdict/reward/critique
  ui-components/ interactive artifact views/renderers
```

### Senses

Senses 是信息摄入模块。一个 sense 接收 `instruction + 一个或多个模态`，返回 `text-response`。

这个 text response 可以是 JSON、Markdown、坐标、标签、OCR、区域摘要、视觉描述、不确定性说明或下一步观察建议。Senses 应暴露：

- 接受哪些模态类型。
- 输出格式。
- 成本/延迟预期。
- 安全和隐私边界。
- 失败模式。
- 是否预期被多次调用。

主 agent 可以用不同 instruction 多次调用同一个 sense。例如视觉任务可以先问整体布局，再问局部小字，再问某个图表 panel，再做不确定性复查。调用多少次由主 agent 自己决定。

`packages/senses/vision-sense` 是此契约的当前样板包。

### Actions

Actions 是会改变外部环境的模块，长期应迁移到 `packages/actions/`。

例子包括 `packages/actions/computer-use`、浏览器沙箱动作、远程桌面动作、文件系统编辑动作、notebook/kernel 动作，以及未来实验仪器或 lab automation 动作。

一个 action provider 应暴露 action schema、环境目标、安全闸门、可逆/不可逆边界、确认规则、trace contract、verifier contract 和失败模式。

`computer-use` 应从当前独立 package 逐步迁移到 `packages/actions/computer-use`，迁移期间保留兼容导出。

### Verifiers

Verifiers 是给闭环提供反馈和 reward 的验证模块。它们接收任务目标、结果、artifact refs、trace refs、当前环境状态或验证 instruction，返回 verdict、reward、critique、evidence refs、repair hints 和 confidence。

推荐输出形状：

```json
{
  "verdict": "pass | fail | uncertain | needs-human | unverified",
  "reward": 0.0,
  "confidence": 0.82,
  "critique": "...",
  "evidenceRefs": [],
  "repairHints": []
}
```

Verifier provider 可以来自：

- 人类反馈：用户验收、批注、打分、选择 accept/reject/revise。
- 其它 agent：基于 rubric 检查答案、artifact 和 trace。
- 规则或 schema：JSON schema、artifact contract、lint、typecheck、unit test。
- 环境观察：GUI 状态、文件系统 diff、外部 API 状态、实验仪器状态。
- Reward model 或 simulator：为下一轮 ReAct 提供可比较的 score。

验证强度由风险和成本决定，而不是由 UI 或 CLI 入口决定。所有 run 都应有 `verificationPolicy`：至少记录为什么选择轻量验证、人工验证、自动验证或暂时 `unverified`。

### Interactive Views

`ui-components` 不应放进 `actions`。它们更准确的定位是 interactive artifact views 或 renderers：

```text
artifact + view props -> human/agent-readable interactive surface
```

它们可以被用户操作，也可以被 computer-use 这类 action provider 操作，但它们本身不是 action provider。它们应声明数据 schema、可见 affordance、交互事件、object/reference 输出、accessibility 与 pointer/keyboard 预期，以及是否支持代码级交互。

当前目录名 `packages/ui-components` 可以为兼容现有 registry 保留；未来文档可以引入 `interactive-views` 作为别名。若要改名，应作为迁移任务处理，不应随手移动。

## 后续修改原则

新增能力时：

1. 模态理解放进 `packages/senses`。
2. 改变环境的执行能力放进 `packages/actions`。
3. 结果、trace、artifact 或状态验证放进 `packages/verifiers`。
4. 推理策略和任务知识放进 `packages/skills`。
5. 展示和数据交互表面放进 `packages/ui-components`，或未来的 `packages/interactive-views` 别名。
6. 跨 UI/CLI/runtime 的 contract 放进 `src/shared`。
7. 确保 UI 聊天和 CLI 都能表达同一个请求 contract，包括 selected senses/actions/verifiers 和 verification policy。
8. 先为共享 contract 边界加测试，再接 UI 或 CLI 的特定呈现。
