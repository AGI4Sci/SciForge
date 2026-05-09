# SciForge 文档

最后更新：2026-05-09

`docs/` 只保留项目级真相源。模块内部的 API、renderer、skill 或 provider 细节继续放在对应 package 的 README 或源码旁边，避免同一个 contract 在多处漂移。

## 权威文档

- [`Usage.md`](Usage.md)：启动、配置、常用工作流、双实例互修、Computer Use 和验证命令。
- [`Architecture.md`](Architecture.md)：真实运行链路、会话策略、AgentServer/backend gateway、workspace writer、时间线和互修边界。
- [`Extending.md`](Extending.md)：scenario package、capability brief、sense/action/verifier、UIManifest、interactive view 和 skill promotion 的扩展契约。
- [`SciForgeConversationSessionRecovery.md`](SciForgeConversationSessionRecovery.md)：多轮对话、session 恢复、上下文选择和 Python 策略层的算法开发参考。

根目录 [`../README.md`](../README.md) 是产品入口和快速开始；本目录的文档是实现细节入口。若出现冲突，以代码和这里列出的文档为准。

## 代码真相源

- 启动脚本和 smoke：[`../package.json`](../package.json)
- UI 配置默认值：[`../src/ui/src/config.ts`](../src/ui/src/config.ts)
- UI 到 runtime 的 handoff：[`../src/ui/src/api/sciforgeToolsClient.ts`](../src/ui/src/api/sciforgeToolsClient.ts)
- Workspace writer API：[`../src/runtime/workspace-server.ts`](../src/runtime/workspace-server.ts)
- Runtime gateway：[`../src/runtime/generation-gateway.ts`](../src/runtime/generation-gateway.ts)
- Python conversation policy bridge：[`../src/runtime/conversation-policy/apply.ts`](../src/runtime/conversation-policy/apply.ts)、[`../packages/conversation-policy-python/src/sciforge_conversation`](../packages/conversation-policy-python/src/sciforge_conversation)
- Scenario contracts：[`../packages/scenario-core/src`](../packages/scenario-core/src)
- Capability registry：[`../src/shared/capabilityRegistry.ts`](../src/shared/capabilityRegistry.ts)
- Sense ABI / verifier runtime ABI：[`../src/shared/senseProvider.ts`](../src/shared/senseProvider.ts)、[`../src/runtime/runtime-types.ts`](../src/runtime/runtime-types.ts)、[`../src/runtime/gateway/verification-policy.ts`](../src/runtime/gateway/verification-policy.ts)
- Interactive view registry：[`../packages/ui-components/README.md`](../packages/ui-components/README.md)
- Skill registry：[`../packages/skills/README.md`](../packages/skills/README.md)
- Vision sense：[`../packages/senses/vision-sense/README.md`](../packages/senses/vision-sense/README.md)
- Computer Use action loop：[`../packages/computer-use/README.md`](../packages/computer-use/README.md)

## 当前状态

SciForge 是活跃研发原型。当前实现重点是 workspace-backed 科研工作台、真实 AgentServer/backend 调用、结构化 artifact、可审计 ExecutionUnit、Python conversation-policy、多 backend 切换、vision-sense/Computer Use 通路、反馈收件箱和双实例互修。

默认内置 4 个 scenario：文献证据评估、结构探索、组学差异分析、生物医学知识图谱。它们的真实 contract 来自 [`../packages/scenario-core/src/scenarioSpecs.ts`](../packages/scenario-core/src/scenarioSpecs.ts)，UI 中的页面配置来自 [`../src/ui/src/data.ts`](../src/ui/src/data.ts)。

## 维护规则

- 不再新增项目级长文档。新内容优先合并到 `Usage.md`、`Architecture.md` 或 `Extending.md`；多轮对话算法细节继续沉淀到 `SciForgeConversationSessionRecovery.md`。
- 文档描述字段、命令或协议时，必须指向代码真相源。
- 模块专有细节留在模块目录，例如 `packages/ui-components/*/README.md` 或 `packages/senses/vision-sense/vision_docs/`。
- 删除或重命名文档时，同步更新 README、代码里的 `detailRef` 和 smoke 测试。
