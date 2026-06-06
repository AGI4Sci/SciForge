# SciForge 架构

最后更新：2026-06-06

## 北极星

SciForge 是 Codex backend 的 GUI / Browser / Desktop 能力面，不是 Agent Host。

Codex backend 拥有：

- 用户意图理解。
- task plan。
- tool / module 选择。
- approval / risk policy。
- repair。
- completion truth。
- final answer。

SciForge 拥有：

- GUI 输入与展示。
- BrowserHostSession。
- Computer Use / WindowActionSession。
- refs-first evidence。
- hard-confirm / stop / cancel / blocked recovery 投影。

## 默认产品流

```text
用户普通聊天 turn
  -> Codex backend Agent Host
     -> Ground：理解任务并收集 refs / readiness / evidence
     -> Guard：风险、权限、确认、blocked 判断
     -> Act：调用模块
     -> Completion truth：基于 evidence 判断结果
     -> Final answer：给用户可检查的回答
  -> SciForge UI 展示回答、证据、产物和确认界面
```

普通聊天是唯一产品入口。Browser Search、Computer Use、runtime gateway、slash command 或 GUI 控件都不能成为任务入口。

## 模块公共语义

所有模块都通过同一组语义暴露给 Codex backend：

```text
module.describe
module.read / observe
module.invoke
```

模块只返回：

- operation result。
- evidence refs。
- action refs。
- artifact refs。
- approval request。
- blocked reason。
- compact observation。

模块不得返回用户可见 final answer，也不得声明用户级 completion truth。

## Bounded Operation

`executeBoundedOperation` 是 `module.invoke` 下的 typed intent，用于模块内部执行一个有边界的局部动作串。它不是新顶层 API，不是工作流引擎，也不是第二个 Agent Host。

Host 发起 operation 时必须给出：

```text
operationKind
ownerModule
targetScope
localObjective
allowedActions
riskPolicy
requiredEvidence
maxSteps
maxTimeMs
maxModelCalls
stopConditions
```

模块内部只能运行窄状态机：

```text
observe
  -> decide local next intent
  -> local guard
  -> locate / bind
  -> execute atomic adapter action
  -> verify
  -> write evidence
  -> completed / partial / blocked / needs-confirmation / failed
```

硬规则：

- 一个 operation 只能有一个 owner module。
- 一个 operation 只能有一个 target scope。
- operation 内部不得调用另一个 `executeBoundedOperation`。
- 配置只声明边界，不能表达 `if/else/loop` 工作流。
- 内部步骤只能调用 owner adapter 的原子 read / action / verify。
- 自动 repair 禁止；模块只能返回 blocked reason / repair hint。
- 跨模块、跨 target、高风险动作、证据冲突或预算耗尽必须返回 Host。

## Model Router 边界

模块内部可以直接调用 Model Router，但只能用于局部辅助：

- 截图 / crop / 页面片段描述。
- 候选目标消歧。
- 候选 next intent。
- before / after 比较。
- 不确定性解释。

Model Router 不得改变 risk policy，不得决定跨模块下一步，不得绕过 confirmation，不得自动 repair，不得产出 completion truth 或 final answer。

可执行 binding、坐标、input lease、真实动作和文件写入必须来自 owner adapter / Host port。

## 用户级验收

用户级验收只能由 Codex backend 产出。

完成必须有同一 current run 的 evidence 支撑：

- Browser 任务需要 source page refs / page text refs。
- GUI action 需要 before evidence / grounding refs / executor event / after evidence / stale invalidation。
- Artifact 任务需要 final artifact refs / validator refs。
- 高风险动作需要 approval refs。

tool 文本、GUI projection、旧截图、历史 run、fixture、package probe 或模型自信不能替代用户级完成。

## 相关文档

- [`../PROJECT.md`](../PROJECT.md)：当前用户需求和验收标准。
- [`BrowserRuntimeArchitecture.md`](BrowserRuntimeArchitecture.md)：Browser 模块。
- [`../packages/actions/computer-use/vision_computer_use_agent_mvp.md`](../packages/actions/computer-use/vision_computer_use_agent_mvp.md)：Computer Use 模块。
