# SciForge 架构

最后更新：2026-05-08

本文合并原项目总文档、AgentServer 协议、多轮 session、CLI/UI handoff、时间线和互修说明。实现真相源优先看文中列出的代码路径。

## 当前边界

SciForge 当前是本地 workspace-backed 科研 Agent 工作台。它的职责不是维护一套硬编码回复模板，而是把用户请求、workspace 引用、scenario contract、能力 brief、backend stream、artifact、ExecutionUnit、反馈和修复证据组织成可审计系统。

核心原则来自 [`../PROJECT.md`](../PROJECT.md)：

- 正常用户请求必须交给 AgentServer/agent backend 真实理解和回答。
- Python conversation-policy package 是多轮对话策略算法主路径。
- TypeScript 保留 transport、runtime 执行边界、workspace writer 和 UI 渲染。
- Agent 输出必须落到标准 `ToolPayload`、artifact、日志和 ExecutionUnit。
- 错误、缺失输入、失败原因和恢复建议必须进入下一轮上下文。

## 模块地图

```text
src/ui/                         React + Vite 工作台
src/ui/src/api/sciforgeToolsClient.ts
                                UI -> workspace runtime handoff
src/runtime/workspace-server.ts Workspace writer HTTP API
src/runtime/generation-gateway.ts
                                Runtime gateway 主编排
src/runtime/gateway/*           AgentServer context、payload、repair、diagnostics 子模块
src/runtime/conversation-policy/*
                                TypeScript -> Python policy bridge
packages/conversation-policy-python/
                                goal/context/memory/digest/capability/recovery 策略
packages/scenario-core/         scenario package 与质量门禁
src/shared/                     capability、sense、verification、handoff 共享 contract
packages/ui-components/         interactive artifact view registry
packages/skills/                skill registry 与 package skills
packages/senses/vision-sense/   vision sense provider
packages/computer-use/          sense-agnostic GUI action loop
```

## Runtime 请求链路

```text
User turn
  -> ChatPanel / runPromptOrchestrator
  -> sendSciForgeToolMessage
  -> workspace writer /api/sciforge/tools/run/stream
  -> runWorkspaceRuntimeGateway
  -> applyConversationPolicy
  -> tryRunVisionSenseRuntime, if selected and request looks like Computer Use
  -> loadSkillRegistry + agentserver.generate.<domain>
  -> request AgentServer /api/agent-server/runs/stream
  -> direct ToolPayload or generated workspace task
  -> runWorkspaceTask
  -> validate payload, repair if possible
  -> composeRuntimeUiManifest
  -> UI normalizes response and updates session state
```

关键代码：

- UI request builder：[`../src/ui/src/api/sciforgeToolsClient.ts`](../src/ui/src/api/sciforgeToolsClient.ts)
- Runtime entry：[`../src/runtime/generation-gateway.ts`](../src/runtime/generation-gateway.ts)
- AgentServer prompt/handoff：[`../src/runtime/gateway/agentserver-prompts.ts`](../src/runtime/gateway/agentserver-prompts.ts)
- Generated task runner：[`../src/runtime/gateway/generated-task-runner.ts`](../src/runtime/gateway/generated-task-runner.ts)
- Payload validation：[`../src/runtime/gateway/payload-validation.ts`](../src/runtime/gateway/payload-validation.ts)
- UI manifest resolver：[`../src/runtime/runtime-ui-manifest.ts`](../src/runtime/runtime-ui-manifest.ts)

## AgentServer Contract

SciForge dispatch 到 AgentServer 的 stream endpoint：

```text
POST <agentServerBaseUrl>/api/agent-server/runs/stream
```

runtime payload 中包含：

- `agent`：backend、agent id、workspace、system prompt。
- `input.text`：由 context envelope、workspace tree、selected skills、artifact schema、UI contract 和当前 prompt 组成的生成提示。
- `runtime`：backend、cwd、用户侧 LLM endpoint、sandbox 和 context-window metadata。
- `metadata`：SciForge source、task purpose、context budget、重试策略。

AgentServer 可以返回两类成功结果：

- 直接 `ToolPayload`：用于已经由 backend 推理完的 report-only 或结构化答案。
- `AgentServerGenerationResponse`：包含 `taskFiles`、`entrypoint`、`environmentRequirements`、`validationCommand` 和 `expectedArtifacts`，随后由 SciForge 写入 workspace 并执行。

生成的 workspace task 必须通过 `inputPath` 和 `outputPath` argv 读写，最终输出合法 `ToolPayload`。如果 entrypoint 不是可执行代码，runtime 会进行严格重试；如果任务失败或 schema 不合格，runtime 会尝试 repair rerun，最后返回 `repair-needed` 或 `failed-with-reason`。

## Conversation Policy

会话策略的主路径是 Python package，默认开启：

- 算法参考：[`SciForgeConversationSessionRecovery.md`](SciForgeConversationSessionRecovery.md)
- Bridge：[`../src/runtime/conversation-policy/python-bridge.ts`](../src/runtime/conversation-policy/python-bridge.ts)
- TS request/response contract：[`../src/runtime/conversation-policy/contracts.ts`](../src/runtime/conversation-policy/contracts.ts)
- Python contract：[`../packages/conversation-policy-python/src/sciforge_conversation/contracts.py`](../packages/conversation-policy-python/src/sciforge_conversation/contracts.py)
- Python service：[`../packages/conversation-policy-python/src/sciforge_conversation/service.py`](../packages/conversation-policy-python/src/sciforge_conversation/service.py)

环境变量：

- `SCIFORGE_CONVERSATION_POLICY_MODE=active|off`，默认 `active`。
- `SCIFORGE_CONVERSATION_POLICY_PYTHON`，默认 `python3`。
- `SCIFORGE_CONVERSATION_POLICY_MODULE`，默认 `sciforge_conversation.service`。
- `SCIFORGE_CONVERSATION_POLICY_PYTHONPATH`，默认 `packages/conversation-policy-python/src`。
- `SCIFORGE_CONVERSATION_POLICY_TIMEOUT_MS`，默认 3500ms。

Policy response 会写回 `GatewayRequest.uiState`：

- `goalSnapshot`
- `contextReusePolicy` / `contextIsolation`
- `memoryPlan`
- `currentReferences`
- `currentReferenceDigests`
- `artifactIndex`
- `capabilityBrief`
- `handoffPlan`
- `acceptancePlan`
- `recoveryPlan`
- `userVisiblePlan`

如果 Python policy 失败，runtime 会发出 `conversation-policy` failed event，并继续用 transport-only fallback；这保证策略层问题不会阻塞普通运行。

## Context 与恢复

SciForge 不把完整历史和大文件无界塞进 backend。当前 turn 优先使用显式 refs、bounded digest、artifact index 和最近 run summary。相关代码：

- Context envelope：[`../src/runtime/gateway/context-envelope.ts`](../src/runtime/gateway/context-envelope.ts)
- Context window / compaction：[`../src/runtime/gateway/agentserver-context-window.ts`](../src/runtime/gateway/agentserver-context-window.ts)
- Backend failure diagnostics：[`../src/runtime/gateway/backend-failure-diagnostics.ts`](../src/runtime/gateway/backend-failure-diagnostics.ts)
- Task attempt history：[`../src/runtime/task-attempt-history.ts`](../src/runtime/task-attempt-history.ts)

恢复策略包括：

- context-window preflight 和 handoff slimming。
- AgentServer rate limit / context exceeded 的一次紧凑重试。
- 当前引用 digest recovery。
- schema failure 后的 repair prompt 和 rerun。
- silent stream watchdog 与 timeout 诊断。

## Workspace Writer API

Workspace writer 是本地 HTTP API，默认端口 `5174`。入口是 [`../src/runtime/workspace-server.ts`](../src/runtime/workspace-server.ts)。

主要端点：

- `GET /health`
- `GET|POST /api/sciforge/config`
- `GET /api/sciforge/instance/manifest`
- `GET /api/sciforge/instance/stable-version`
- `POST /api/sciforge/instance/stable-version/promote`
- `POST /api/sciforge/instance/stable-version/sync-plan`
- `GET|POST /api/sciforge/workspace/snapshot`
- `GET|POST /api/sciforge/workspace/file`
- `POST /api/sciforge/workspace/file-action`
- `POST /api/sciforge/workspace/open`
- `GET /api/sciforge/preview/raw`
- `GET /api/sciforge/preview/descriptor`
- `GET /api/sciforge/preview/derivative`
- `GET|POST /api/sciforge/scenarios/*`
- `GET /api/sciforge/task-attempts/list`
- `GET /api/sciforge/task-attempts/get`
- `GET|POST /api/sciforge/skill-proposals/*`
- `GET|POST /api/sciforge/feedback/issues*`
- `POST /api/sciforge/repair-handoff/run`
- `POST /api/sciforge/tools/run`
- `POST /api/sciforge/tools/run/stream`

文件路径会经过 workspace root 约束；`open-external`、`reveal-in-folder` 等外部动作在 server 端做边界检查。

## Feedback 与双实例互修

反馈不是直接在单实例里启动内嵌 repair agent。当前实现是 peer instance handoff：

1. 目标实例收集 feedback comment / request / GitHub issue metadata。
2. 执行方实例在主聊天栏选择 target instance。
3. UI 根据自然语言里的 `feedback #id` 或 `GitHub #number` 调目标 writer 读取 issue bundle。
4. AgentServer payload 中带上 `repairHandoffRunner` contract。
5. `repair-handoff-runner` 在目标 repo 的隔离 worktree 中运行修复、测试和 diff 收集。
6. 结果写回目标实例 `/repair-result`，可同步到 GitHub Issue。

关键代码：

- Target selector：[`../src/ui/src/app/chat/TargetInstanceSelector.tsx`](../src/ui/src/app/chat/TargetInstanceSelector.tsx)
- Target issue lookup：[`../src/ui/src/app/chat/targetInstance.ts`](../src/ui/src/app/chat/targetInstance.ts)
- Repair runner：[`../src/runtime/repair-handoff-runner.ts`](../src/runtime/repair-handoff-runner.ts)
- GitHub sync：[`../src/runtime/github-repair-sync.ts`](../src/runtime/github-repair-sync.ts)
- Stable registry：[`../src/runtime/stable-version-registry.ts`](../src/runtime/stable-version-registry.ts)

## Timeline 与决策模型

Timeline、decision、belief graph 和 wet-lab summary 当前是 UI domain contract，不是独立后端服务。类型真相源在 [`../src/ui/src/domain.ts`](../src/ui/src/domain.ts)：

- `TimelineEventRecord`
- `ResearcherDecisionRecord`
- `BeliefDependencyGraph`
- `WetLabEvidenceSummary`

它们的定位是把 run、artifact、evidence、人工决定和外部实验摘要串成可复查研究记录。真实结论仍应通过 artifact refs、execution refs、verification result 和人工确认支撑。

## Vision Sense 与 Computer Use

`local.vision-sense` 是 Observe/sense 插件，runtime 入口是 [`../src/runtime/vision-sense-runtime.ts`](../src/runtime/vision-sense-runtime.ts)。它只在满足两个条件时短路普通 AgentServer 路径：

- request 中选择了 `local.vision-sense`。
- prompt 看起来是 Computer Use / GUI 操作请求。

如果 desktop bridge 未启用，runtime 返回 fail-closed diagnostic payload，不假装执行成功。实际图像理解、grounding、window-local 坐标、scheduler lock 和 trace 验证详见 vision-sense 与 computer-use 包 README。
