# SciForge 文档

最后更新：2026-05-16

`docs/` 只保留项目级真相源。模块内部的 API、renderer、skill、provider 或 package 细节继续放在对应 package 的 README 或源码旁边，避免同一个 contract 在多处漂移。

## 权威文档状态

| 文档 | 状态 | 用途 |
|---|---|---|
| [`SciForge-SingleAgent-Architecture.md`](SciForge-SingleAgent-Architecture.md) | **当前最终 runtime contract** | Single-Agent 多轮运行时、Workspace Kernel、AgentServer Context Core、Runtime Bridge、Gateway、上下文防漂移、KV cache、conformance 和长期防污染边界。 |
| [`Architecture.md`](Architecture.md) | 当前实现背景 / 产品架构 | 解释现有 backend-first、capability-driven、harness-governed 工作台形态、模块地图、请求链路和已落地边界；多轮 runtime contract 以 `SciForge-SingleAgent-Architecture.md` 为准。 |
| [`Usage.md`](Usage.md) | 当前操作手册 | 启动、配置、常用工作流、双实例互修、Computer Use 和验证命令。 |
| [`AgentHarnessStandard.md`](AgentHarnessStandard.md) | 专项标准 | Lightning-style agent harness 编程标准、分级 hooks、contract schema、merge 规则和最小实验案例。 |
| [`HarnessResearchGuide.md`](HarnessResearchGuide.md) | 专项研究入口 | harness prompt/policy 研究入口、module directive preview 和 AgentServer prompt 边界。 |

Archive/historical 清理状态：

- archive/historical: `ProjectSessionMemory.md` 已被 [`SciForge-SingleAgent-Architecture.md`](SciForge-SingleAgent-Architecture.md) 吸收并删除；对应内容现在落在 Workspace Kernel、AgentServer Context Core、Context Bridge、KV cache 和 retention/conformance 章节。
- archive/historical: `Extending.md`、`SciForgeConversationSessionRecovery.md` 不在当前 `docs/` 中，已从权威入口移除；相关扩展 contract 以 package README、源码 contract 和 `Architecture.md` / `SciForge-SingleAgent-Architecture.md` 为准。

根目录 [`../README.md`](../README.md) 是产品入口和快速开始；本目录的文档是实现细节入口。若出现冲突，运行时设计以 [`SciForge-SingleAgent-Architecture.md`](SciForge-SingleAgent-Architecture.md) 为准，已落地实现细节以代码真相源为准。

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

SciForge 是活跃研发原型，但架构主线已经收敛为 **backend-first / contract-enforced / capability-driven / harness-governed / single-agent multiturn**。2026-05-16 起，项目级多轮运行时的最终设计入口是 [`SciForge-SingleAgent-Architecture.md`](SciForge-SingleAgent-Architecture.md)：它明确 Workspace Kernel 是可恢复事实源，AgentServer Context Core 负责上下文编排和 backend handoff，Agent Backend 负责推理/规划/修复，Capability Gateway 负责受控执行，Runtime Bridge 只做 transport、run lifecycle、event relay 和 failure normalization。

[`Architecture.md`](Architecture.md) 继续作为当前实现背景和产品架构地图，保留 backend-first、capability-driven、harness-governed、package boundary、worker protocol、runtime 请求链路和 UI 投影边界。若它与 `SciForge-SingleAgent-Architecture.md` 的 runtime contract 冲突，以后者为准。

Harness 编程标准见 [`AgentHarnessStandard.md`](AgentHarnessStandard.md)：`HarnessRuntime` 负责生命周期，`HarnessProfile` 负责策略组合，`HarnessCallback` 只返回结构化 decision，`HarnessContract` 驱动 context/broker/prompt/validation/UI。

当前守门状态：

- `smoke:no-legacy-paths` 和 `smoke:no-src-capability-semantics` baseline 均为 0。
- `packages:check` 覆盖 skill catalog generation、capability manifest registry、workspace package metadata、package runtime boundary 和 UI component publication checks。
- `smoke:official-packages` 锁定 scenario package policy-only 边界。
- `smoke:capability-broker` 和 `smoke:agentserver-broker-payload` 锁定 broker compact 默认暴露与 lazy expansion。

默认内置 4 个 scenario：文献证据评估、结构探索、组学差异分析、生物医学知识图谱。它们的真实 contract 来自 [`../packages/scenarios/core/src/scenarioSpecs.ts`](../packages/scenarios/core/src/scenarioSpecs.ts)，UI 中的页面配置来自 [`../src/ui/src/data.ts`](../src/ui/src/data.ts)。

## 维护规则

- 不再随意新增项目级长文档。新内容优先合并到 `SciForge-SingleAgent-Architecture.md`、`Architecture.md`、`Usage.md`、`AgentHarnessStandard.md` 或 `HarnessResearchGuide.md`。
- 旧专项草稿如果已被最终架构吸收，应删除并在本 README 记录状态，而不是长期保留成第二真相源。
- 文档描述字段、命令或协议时，必须指向代码真相源。
- 模块专有细节留在模块目录，例如 `packages/presentation/components/*/README.md` 或 observe provider 的 `vision_docs/`。
- 删除或重命名文档时，同步更新 README、代码里的 `detailRef` 和 smoke 测试。
