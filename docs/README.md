# SciForge 文档

最后更新：2026-05-22

当前架构重构的核心结论：

> **SciForge GUI 是 TUI agent 的 GUI extension。TUI / agent host 拥有全部逻辑。**

GUI 给 TUI 的操作输入全部是文本。默认 TUI 服务是 Codex backend，不需要独立 AgentServer；长期只支持 Codex backend，但生产默认 model provider 应是 DeepSeek `deepseek-v4-flash` 或用户配置的低成本 provider/proxy。TUI 感知 GUI 状态时读取只读虚拟 GUI resource tree；TUI 改变 GUI 展示时调用 intent-based `gui.*` tools。算法、capability discovery、harness/policy、provider route、verifier、workspace 操作都使用 Codex 原生 plugin/skill/tool/MCP 和 custom model provider 机制。GUI 侧的 `packages/presentation/components` 只作为展示能力目录，通过 `/gui/capabilities/presentation.json` 和 `/gui/renderers/<componentId>.json` 只读暴露。

## 权威文档

| 文档 | 状态 | 用途 |
|---|---|---|
| [`Architecture.md`](Architecture.md) | **当前总架构真相源** | GUI-as-extension 的产品边界、职责归属、双目录能力发现、引用预览、confidence、harness/policy 和 UI 边界。 |
| [`TuiGuiProtocol.md`](TuiGuiProtocol.md) | **当前协议真相源** | GUI → TUI 文本输入，TUI 读取 GUI resource tree，TUI → GUI intent-based `gui.*` tools，展示组件目录、对象引用、confidence、hot region、precondition 和协商。 |
| [`NativeExtensionOwnershipMap.md`](NativeExtensionOwnershipMap.md) / [`native-extension-ownership-map.json`](native-extension-ownership-map.json) | **TUI native extension 归属图** | capability discovery、GUI 展示组件目录、confidence、harness/policy、provider route、verifier、skill promotion、Computer Use 和 dual-instance repair 的 Codex 原生/GUI extension 归属与可验证 manifest。 |
| [`CodexRuntimeMigration.md`](CodexRuntimeMigration.md) | 当前迁移路线 | Phase 1 `codex exec --json`、Phase 2 `AgentCliAdapter`、DeepSeek provider、两个 Codex 实例隔离和审计。 |
| [`Usage.md`](Usage.md) | 当前操作手册 | 当前代码启动、配置、验证命令；它描述现状，不代表最终职责归属。 |
| [`FeedbackInboxDesignPrinciples.md`](FeedbackInboxDesignPrinciples.md) | **反馈收件箱设计原则** | 反馈收件箱作为本地反馈、GitHub sync、Runtime Codex repair 和证据审计控制面的设计边界、证据策略、readiness gate、系统 Terminal/Web Viewer、repair log evidence 和确认原则。 |

迁移前旧方案保存在 [`../docs_old`](../docs_old)，只作为历史对照和迁移输入；不要再把它当作当前架构真相源。

## 核心规则

1. **GUI → TUI 全部是文本。**
   按钮、拖拽、菜单、表单都必须生成终端等价文本。

2. **TUI → GUI 调 intent-based `gui.*` tools。**
   TUI 表达展示/确认/输入意图，GUI 基于 hot region、interaction mode 和本地规则执行或协商。

3. **TUI 读取 GUI 状态像读资源树。**
   默认只给 shell + hot region；需要更多信息时用 `list/read/search/stat/watch` 按需探测。

4. **插件系统使用 Codex 原生机制。**
   Codex CLI / app-server 已经有 plugin、skill、tool、MCP 和 custom model provider；SciForge 不再定义第二套，也不要求 AgentServer。

5. **运行期成本必须可控。**
   默认运行期不得消耗 OpenAI token，除非用户显式 opt in；Codex 使用的 provider/model 必须可见、可审计、可测试。

6. **GUI 不做算法判断。**
   GUI 不做 intent classifier、provider route、capability ranking、repair strategy、prompt assembly。

7. **GUI 是确定性体验扩展。**
   GUI 可以有 renderer、layout、focus、precondition、defer/reject/suggestion 等 presentation autonomy；接入 GUI 后任务能力不增加，只是展示、确认和交互变好。

8. **GUI 展示能力和 TUI 任务能力分开发现。**
   TUI 任务能力走 Codex 原生 skills/tools/plugins/MCP；GUI 展示组件走只读 GUI resources。两边不互相注册、不互相 import。

9. **引用和 confidence 必须可解释。**
   可解析 artifact/file 引用应能聚焦右侧预览；`confidence` 只能来自 TUI/verifier/harness 的可解释输出，GUI 不补默认百分比。
