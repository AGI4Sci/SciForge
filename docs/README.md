# SciForge 文档

最后更新：2026-05-15

`docs/` 只保留项目级真相源。模块内部的 API、renderer、skill 或 provider 细节继续放在对应 package 的 README 或源码旁边，避免同一个 contract 在多处漂移。

## 权威文档

- [`Usage.md`](Usage.md)：启动、配置、常用工作流、双实例互修、Computer Use 和验证命令。
- [`Architecture.md`](Architecture.md)：真实运行链路、会话策略、AgentServer/backend gateway、workspace writer、时间线和互修边界。
- [`ProjectSessionMemory.md`](ProjectSessionMemory.md)：workspace 本地 append-only project memory、refs/blob store、context projection、AgentServer orchestration 和 KV cache-aware handoff 设计。
- [`AgentHarnessStandard.md`](AgentHarnessStandard.md)：Lightning-style agent harness 编程标准、分级 hooks、contract schema、merge 规则和最小实验案例。
- [`HarnessResearchGuide.md`](HarnessResearchGuide.md)：harness prompt/policy 研究入口、module directive preview 和 AgentServer prompt 边界。
- [`Extending.md`](Extending.md)：scenario package、capability brief、observe/action/verifier、UIManifest、interactive view 和 skill promotion 的扩展契约。
- [`SciForgeConversationSessionRecovery.md`](SciForgeConversationSessionRecovery.md)：多轮对话、session 恢复、上下文选择和 Python 策略层的算法开发参考。

根目录 [`../README.md`](../README.md) 是产品入口和快速开始；本目录的文档是实现细节入口。若出现冲突，以代码和这里列出的文档为准。

## 代码真相源

- 启动脚本和 smoke：[`../package.json`](../package.json)
- UI 配置默认值：[`../src/ui/src/config.ts`](../src/ui/src/config.ts)
- UI 到 runtime 的 handoff：[`../src/ui/src/api/sciforgeToolsClient.ts`](../src/ui/src/api/sciforgeToolsClient.ts)
- Workspace writer API：[`../src/runtime/workspace-server.ts`](../src/runtime/workspace-server.ts)
- Runtime gateway：[`../src/runtime/generation-gateway.ts`](../src/runtime/generation-gateway.ts)
- Python conversation policy bridge：[`../src/runtime/conversation-policy/apply.ts`](../src/runtime/conversation-policy/apply.ts)、[`../packages/reasoning/conversation-policy/src/sciforge_conversation`](../packages/reasoning/conversation-policy/src/sciforge_conversation)
- Scenario contracts：[`../packages/scenarios/core/src`](../packages/scenarios/core/src)
- Capability registry：[`../packages/contracts/runtime/capabilities.ts`](../packages/contracts/runtime/capabilities.ts)
- Observe ABI / verifier runtime ABI：[`../packages/contracts/runtime/observe.ts`](../packages/contracts/runtime/observe.ts)、[`../src/runtime/runtime-types.ts`](../src/runtime/runtime-types.ts)、[`../src/runtime/gateway/verification-policy.ts`](../src/runtime/gateway/verification-policy.ts)
- Interactive view registry：[`../packages/presentation/components/README.md`](../packages/presentation/components/README.md)
- Skill registry：[`../packages/skills/README.md`](../packages/skills/README.md)
- Vision observe provider：[`../packages/observe/vision/README.md`](../packages/observe/vision/README.md)
- Computer Use action loop：[`../packages/actions/computer-use/README.md`](../packages/actions/computer-use/README.md)

## 当前状态

SciForge 是活跃研发原型，但架构主线已经完成 backend-first / contract-enforced / capability-driven cutover。下一阶段的项目级原则是 **harness-governed agent behavior**：agent harness 不应散落在 UI、gateway、prompt builder、conversation policy 和 repair loop 里，而应作为独立策略层，通过稳定阶段 hook 注入 runtime。当前实现重点是 workspace-backed 科研工作台、真实 AgentServer/backend 调用、compact capability broker、统一 `CapabilityManifest` registry、结构化 artifact、可审计 ExecutionUnit、`ContractValidationFailure` repair loop、Python conversation-policy、多 backend 切换、vision-sense/Computer Use 通路、反馈收件箱和双实例互修。

终极形态见 [`Architecture.md#终极形态harness-governed-scientific-agent-os`](Architecture.md#终极形态harness-governed-scientific-agent-os)。核心原则是：capability registry 是能力真相源，harness policy 是行为治理真相源，runtime gateway 是生命周期和 enforcement 真相源，agent backend 是推理和组合真相源。Harness 编程标准见 [`AgentHarnessStandard.md`](AgentHarnessStandard.md)：`HarnessRuntime` 负责生命周期，`HarnessProfile` 负责策略组合，`HarnessCallback` 只返回结构化 decision，`HarnessContract` 驱动 context/broker/prompt/validation/UI。

当前守门状态：

- `smoke:no-legacy-paths` 和 `smoke:no-src-capability-semantics` baseline 均为 0。
- `packages:check` 覆盖 skill catalog generation、capability manifest registry、workspace package metadata、package runtime boundary 和 UI component publication checks。
- `smoke:official-packages` 锁定 scenario package policy-only 边界。
- `smoke:capability-broker` 和 `smoke:agentserver-broker-payload` 锁定 broker compact 默认暴露与 lazy expansion。

默认内置 4 个 scenario：文献证据评估、结构探索、组学差异分析、生物医学知识图谱。它们的真实 contract 来自 [`../packages/scenarios/core/src/scenarioSpecs.ts`](../packages/scenarios/core/src/scenarioSpecs.ts)，UI 中的页面配置来自 [`../src/ui/src/data.ts`](../src/ui/src/data.ts)。

## 维护规则

- 不再随意新增项目级长文档。新内容优先合并到 `Usage.md`、`Architecture.md`、`ProjectSessionMemory.md`、`AgentHarnessStandard.md` 或 `Extending.md`；多轮对话算法细节继续沉淀到 `SciForgeConversationSessionRecovery.md`。
- 文档描述字段、命令或协议时，必须指向代码真相源。
- 模块专有细节留在模块目录，例如 `packages/presentation/components/*/README.md` 或 observe provider 的 `vision_docs/`。
- 删除或重命名文档时，同步更新 README、代码里的 `detailRef` 和 smoke 测试。
