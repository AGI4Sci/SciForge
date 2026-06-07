# Native Extension 归属摘要

最后更新：2026-06-07

## 当前口径

Codex backend 是唯一 Agent Host。SciForge native / runtime / GUI 能力都只能作为模块或 adapter 提供给 Codex backend。

## 归属表

| 能力 | 归属方 | 不做 |
| --- | --- | --- |
| BrowserHostSession | Browser 模块 / native browser adapter | 不做搜索总结、不做 completion truth。 |
| Computer Use / WindowActionSession | Computer Use 模块 / scoped host adapter | 不做跨模块 workflow、不宣布用户级完成。 |
| GUI | SciForge UI | 不做任务规划、不执行业务动作、不判断 completion。 |
| Model Router | Model Router facade | 不做 Agent Host、不做 risk / repair / completion。 |
| Artifact / validator | Codex backend 可调用的 artifact / validator 模块 | 不由 GUI 或 Computer Use 自己宣布完成。 |
| Connectors / channels | Codex backend connector / intake 模块 | 不绕过 Agent Host 执行发送、删除、上传等副作用。 |

## 规则

- 所有模块只通过 `module.describe`、`module.read / observe`、`module.invoke` 或 Codex backend 原生等价 surface 暴露。
- 需要局部动作串时，使用模块当前公开 primitive。Computer Use 使用 `computer_use.run_procedure`，该 procedure 不承载智能、不拥有 completion truth。
- 高风险副作用必须返回 approval request，由 Codex backend 决定如何让 GUI 或外部渠道收集确认。
- `native-extension-ownership-map.json` 仍可作为机器可读清单，但如果它和 [`../PROJECT.md`](../PROJECT.md) 冲突，以 `PROJECT.md` 为准。

## 相关文档

- [`../PROJECT.md`](../PROJECT.md)：当前需求和验收标准。
- [`Architecture.md`](Architecture.md)：总架构。
- [`ComputerUseRuntimeArchitecture.md`](ComputerUseRuntimeArchitecture.md)：Computer Use primitive 边界。
