# SciForge 文档地图

最后更新：2026-06-06

## 先读这些

1. [`../PROJECT.md`](../PROJECT.md)：当前唯一需求入口，说明用户真正要什么、P0 范围和用户级验收。
2. [`Architecture.md`](Architecture.md)：总架构，说明 Codex backend 是唯一 Agent Host，以及 Bounded Operation 契约。
3. [`BrowserRuntimeArchitecture.md`](BrowserRuntimeArchitecture.md)：Browser 模块边界。
4. [`../packages/actions/computer-use/vision_computer_use_agent_mvp.md`](../packages/actions/computer-use/vision_computer_use_agent_mvp.md)：Computer Use 模块边界。

读完这四份，agent 应该能理解当前用户需求。

## 当前口径

- 普通聊天是唯一产品入口。
- SciForge 是 Codex backend 的 GUI / Browser / Desktop 能力面，不是第二个 Agent Host。
- Browser、Computer Use 和未来拓展模块只提供信息输入和局部操作执行。
- `executeBoundedOperation` 是 `module.invoke` 下的 typed intent，用于模块内有边界的局部动作串。
- 用户级 completion truth 和 final answer 只由 Codex backend 产出。
- 诊断路径、fixture、GUI projection、历史 run 和旧矩阵不能替代用户级验收。

## 其它专题文档

| 文档 | 用途 |
| --- | --- |
| [`ModelRouterArchitecture.md`](ModelRouterArchitecture.md) | Model Router 的局部模型辅助边界。 |
| [`TuiGuiProtocol.md`](TuiGuiProtocol.md) | GUI 与 Codex backend 的输入 / 展示边界。 |
| [`SemanticModuleEngineering.md`](SemanticModuleEngineering.md) | 模块工程原则，当前以 Bounded Operation 为最小实现。 |
| [`NativeExtensionOwnershipMap.md`](NativeExtensionOwnershipMap.md) | native / GUI / Agent Host 归属摘要。 |
| [`VirtualAppScreenArchitecture.md`](VirtualAppScreenArchitecture.md) | 旧 VirtualAppScreen 口径的废弃说明。 |
| [`ChannelPluginArchitecture.md`](ChannelPluginArchitecture.md) | 外部消息渠道的未来边界。 |
| [`FeedbackInboxDesignPrinciples.md`](FeedbackInboxDesignPrinciples.md) | 反馈收件箱的未来产品原则。 |
| [`group-collaborator-design.md`](group-collaborator-design.md) | 飞书群协作者的未来产品原则。 |
| [`Usage.md`](Usage.md) | 当前启动和运维手册，描述现状，不定义产品职责。 |

## 历史与运行材料

- `docs/superpowers/specs/**` 和 `docs/superpowers/plans/**` 是历史设计 / 计划存档；当前 P0 不从这些文件恢复旧路线。
- `docs/archive/**` 是历史任务板。
- `docs/runbooks/**` 是运行手册；其中 Browser pane、VirtualAppScreen 和旧 Model Router 矩阵只保留历史边界，不定义当前验收。
- `docs/test-artifacts/**`、`docs/agent-desktop-alignment-evidence/**` 和 `docs/*.json` 是证据 / 基线 / 测试材料，不是需求入口。

这些材料不能覆盖 `PROJECT.md`、`Architecture.md`、Browser 模块文档和 Computer Use 模块文档的当前口径。

当前可参考的 runbook：

| 文档 | 用途 |
| --- | --- |
| [`runbooks/model-router-runtime-codex-runbook.md`](runbooks/model-router-runtime-codex-runbook.md) | Runtime Codex 使用 Model Router 的运行边界。 |
| [`runbooks/model-router-mvp-acceptance-boundary.md`](runbooks/model-router-mvp-acceptance-boundary.md) | Model Router 当前最小验收边界。 |
| [`runbooks/sciforge-web-reproduction.md`](runbooks/sciforge-web-reproduction.md) | 未来科研复现 workflow 的 refs-first 边界。 |
| [`runbooks/browser-pane-dogfood-runbook.md`](runbooks/browser-pane-dogfood-runbook.md) | 历史 Browser pane dogfood 口径，仅供诊断。 |
| [`runbooks/virtual-app-screen-dogfood-runbook.md`](runbooks/virtual-app-screen-dogfood-runbook.md) | 历史 VirtualAppScreen dogfood 口径，仅供诊断。 |
