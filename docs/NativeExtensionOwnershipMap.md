# Native Extension 归属图

最后更新：2026-05-21

本文是 [`native-extension-ownership-map.json`](native-extension-ownership-map.json) 的可读版摘要。JSON 文件是可验证清单；本文说明每类能力最终归谁拥有、通过什么 surface 暴露，以及 GUI/runtime 的边界在哪里。

运行 `npm run smoke:native-extension-ownership` 可以校验 manifest、`/capabilities` 命令动词和可读策略形状。

| 领域 | 归属 | 目标 surface | GUI/runtime 边界 |
|---|---|---|---|
| Capability discovery | Codex 原生 plugin / skill / tool / MCP | `/capabilities search`、`expand`、`plan`、`explain`；展示通过 `gui.present` / `gui.ask_user` | GUI 只发送文本命令；GUI 和 runtime 都不做 capability ranking。 |
| GUI 展示组件目录 | SciForge GUI extension | `/gui/capabilities/presentation.json`、`/gui/renderers/<componentId>.json`、`gui.search(scope='/gui/capabilities')`、`gui.present` | `packages/presentation/components` 只声明 renderer/viewer/workbench 能力；不得注册成 TUI task skill/tool。 |
| Confidence / 置信度 | Codex 原生 verifier / harness / policy | result payload 的 `confidence`、`confidenceExplanation`，或 MCP verifier 结果 | GUI 只能渲染 TUI 给出的可解释分数；不得补默认值、不得从日志或文案推断可信度。 |
| Harness / policy / budget / repair | Codex TUI 原生扩展 | Codex policy plugin、skill 或 MCP surface | GUI 可以展示状态或收集确认；不选择策略。 |
| Provider route | Codex provider / MCP / tool 生态 | custom model provider、本地 provider proxy、MCP server、Codex tool | Runtime 只审计 profile/provider/model/workspace/command id 并 fail closed；不得静默 fallback 到 OpenAI。 |
| Verifier | Codex 原生 verifier tool / skill | tool、skill、MCP verifier | Verifier 输出 evidence、verdict、critique 或 repair hint；GUI 不从 raw logs 推断 completion。 |
| Skill promotion | Codex skill / plugin / MCP / slash command | Codex 原生扩展 artifact | Workspace proposal 只是 staging，不是最终 promotion 目标。 |
| Computer Use | Sense plugin 加上上游 desktop bridge | `packages/observe/vision`、`packages/actions/computer-use`、desktop bridge | React/UI 不执行 Computer Use；raw screenshot/log payload 只能进入折叠 audit/debug refs。 |
| Dual-instance self-repair | 默认退休；只有 Codex-native 形态可恢复 | Codex 原生 repair workflow、skill/plugin 或 external supervisor | 两个 SciForge app instance 不是默认 repair runtime。 |

边界规则：凡是改变任务能力、选择 provider、修复执行、验证真伪、提升 skill、计算可信度或判断 completion 的功能，都属于 TUI/Codex 原生扩展生态。SciForge GUI 只贡献 presentation、confirmation、focus、folded audit/debug、只读 GUI resource tree 和终端等价文本。

最小可靠发现模型：

1. TUI 任务能力通过 Codex 原生 mechanisms 发现。GUI 只发送 `/capabilities search|expand|plan|explain` 文本。
2. GUI 展示能力通过 `/gui/capabilities/presentation.json` 和 `/gui/renderers/<componentId>.json` 只读暴露。TUI 用 `gui.read/search` 发现，用 `gui.present` 表达展示意图。
3. 两个目录不互相注册、不互相 import、不共享 ranking。这样可以避免 GUI 变成第二个 agent，也避免 TUI 依赖 React 内部实现。
