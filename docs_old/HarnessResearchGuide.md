# Harness Research Guide

最后更新：2026-05-11

本文是研究和修改 SciForge agent harness 的入口。目标是让策略实验进入 harness contract、profile、module、runtime merge 和 prompt render projection，而不是重新写进 AgentServer 大 prompt 字符串。

## 先选正确入口

| 想改的东西 | 正确位置 | 不要改的位置 |
| --- | --- | --- |
| 新增 contract 字段、决策类型或 trace 字段 | `packages/agent-harness/src/contracts.ts` | `src/runtime/gateway/agentserver-prompts.ts` 的自然语言规则 |
| 调整默认 latency、context、tool、verification、repair、progress、presentation 策略 | `packages/agent-harness/src/profiles.ts` 的 profile/callback/defaults | AgentServer system prompt 或 generation prompt |
| 改 decision merge、安全收紧、stage 执行顺序、critical/audit 分层 | `packages/agent-harness/src/runtime.ts` | gateway 分支、UI 分支或 prompt 文案 |
| 新增或替换研究模块 | `packages/agent-harness/src/modules.ts` 和对应 profile `moduleStack` | prompt builder 里的“如果是某类任务就...” |
| 把 harness contract 交给 AgentServer | `src/runtime/gateway/agent-harness-shadow.ts` | 在 prompt 中内联完整 contract/trace |
| 改 backend 可见的 harness 提示投影 | `buildAgentHarnessPromptRenderPlan` 输出的 bounded render plan | 直接在 `buildAgentServerGenerationPrompt` 写 fresh/continuity/tool-use/repair/latency 策略 |
| 改最终 AgentServer prompt 的排版和 compact JSON envelope | `src/runtime/gateway/agentserver-prompts.ts` | 重新承载策略真相源 |

## Prompt 边界

AgentServer prompt renderer 只能做三件事：

- 渲染来自 trusted policy provider 的协议行，例如 runtime contract、artifact policy 和 package runtime-policy。
- 接收 harness `promptRenderPlanSummary`，展示已经由 `HarnessContract.promptDirectives` 和 module preview 投影出的 bounded 条目。
- 裁剪、去除 raw fields、保留 source refs 和 render digest，保证提示内容可从 contract/trace 重建。

它不能重新承载这些策略：

- fresh、continuity、continuation、repair 的上下文选择。
- tool-use、capability preference、side effect、budget 和 provider 升级策略。
- latency tier、first-result deadline、background continuation 策略。
- verification layers、repair budget、presentation-first 展示策略。

如果确实需要改变这些行为，先改 harness callback/profile/module，再让 `buildAgentHarnessPromptRenderPlan` 以 `renderedEntries` 暴露一个可审计 preview。

## Module Directive Preview

每个 profile 的 `moduleStack` 都应能在 prompt render plan 中看到 preview。Preview 的作用不是替代 module 逻辑，而是让研究者比较不同 stack 对 backend 可见提示的影响：

- `strategyRefs` 展示 intent、latency、context、repair 等结构化策略摘要。
- `directiveRefs` 展示 contract 中真正允许进入 prompt 的 directive。
- `module-preview:<moduleId>` 展示当前 module 已参与提示投影，方便对比 profile/module stack。
- `renderDigest` 锁定投影结果，smoke 可以比较不同实验配置。

新增 module 时，最小流程是：

1. 在 `packages/agent-harness/src/modules.ts` 注册 `HarnessModule`，声明 owned stages、inputs、outputs、cost、tier applicability。
2. 在 profile 的 `moduleStack` 中启用它。
3. 让 callback 返回结构化 `HarnessDecision`，必要时附带 `promptDirectives`。
4. 通过 `buildAgentHarnessPromptRenderPlan` 观察 module preview 和 directive refs。
5. 增加 smoke，证明最终 AgentServer prompt 只包含 bounded summary，没有 raw contract/trace。

## 验证命令

- `npm run smoke:harness-research-guide`
- `npm run smoke:agentserver-prompt-policy-prose`
- `npm run smoke:contract-driven-handoff`
- `npm run smoke:agent-harness-profile-coverage`

这些 smoke 共同保证研究入口、prompt prose guard、contract-driven handoff 和 module/profile coverage 没有漂移。
