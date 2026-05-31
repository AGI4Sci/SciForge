# SciForge 文档

最后更新：2026-05-29

当前架构重构的核心结论：

> **SciForge GUI 是 TUI agent 的 GUI extension。TUI / agent host 拥有全部逻辑。**

GUI 给 TUI 的操作输入全部是文本。默认 TUI 服务必须走 Codex app-server；`codex exec --json` 只作为 legacy/test-only 兼容和历史证据，Claude Code stream-json 是可选 backend，不需要独立 AgentServer。生产默认 model provider 应是 DeepSeek `deepseek-v4-flash` 或用户配置的低成本 provider/proxy。跨模块组合采用 Agent Host Semantic Pipeline：所有模块对外收敛到 `module.describe/query/read/invoke`，Agent Host 负责 pipeline 编排和 trace，GUI 只是其中一个特殊模块。迁移期 `gui.*` alias 只能作为 adapter shim 暴露；稳定心智模型是统一 `module.*` 函数。

当前注释路线是连续反馈体验：全局 `AnnotationSidebar` 负责点选对象、澄清问题和对象关系，并可承载低风险 quick action；反馈收件箱负责复杂改动的管理、确认、审计、GitHub sync 和 Runtime Codex repair。`annotation-plan-only` 仍用于无副作用的整理/预览 lane，`annotation-quick-action` 用于侧栏低风险小改动。

## 权威文档

| 文档 | 状态 | 用途 |
|---|---|---|
| [`Architecture.md`](Architecture.md) | **当前总架构真相源** | GUI-as-extension 的产品边界、Agent Host Semantic Pipeline、职责归属、全局注释侧栏、双目录能力发现、引用预览、confidence、harness/policy 和 UI 边界。 |
| [`SemanticModuleEngineering.md`](SemanticModuleEngineering.md) | **软件工程范式设计** | 统一模块函数、Root Agent Host、L1 Module Host、resource graph、UI/memory/skills/tools/project 的关系，以及跨开源项目资源组合原则。 |
| [`TuiGuiProtocol.md`](TuiGuiProtocol.md) | **当前协议真相源** | GUI → TUI 文本输入，TUI 通过 `module.query/read/invoke(moduleId='gui')` 读取 GUI resource tree 并表达展示/确认意图；迁移期 `gui.*` adapter shim、annotation feedback envelopes、展示组件目录、对象引用、confidence、hot region、precondition 和协商。 |
| [`BrowserRuntimeArchitecture.md`](BrowserRuntimeArchitecture.md) | **内置浏览器运行时设计** | Codex-like browser session、tab、action、snapshot、trace、安全确认和 GUI presentation surface 边界。 |
| [`NativeExtensionOwnershipMap.md`](NativeExtensionOwnershipMap.md) / [`native-extension-ownership-map.json`](native-extension-ownership-map.json) | **TUI native extension 归属图** | capability discovery、GUI 展示组件目录、confidence、harness/policy、provider route、verifier、skill promotion、Computer Use 和 dual-instance repair 的 Codex 原生/GUI extension 归属与可验证 manifest。 |
| [`CodexRuntimeMigration.md`](CodexRuntimeMigration.md) | 当前迁移路线 | Codex app-server 为默认生产 runtime；`CodexExecJsonAdapter`/`codex exec --json` 仅 legacy/test-only，`ClaudeStreamJsonAdapter` 作为可选 backend；统一归一化为内部事件、module pipeline trace 和 backend presentation profile。 |
| [`Usage.md`](Usage.md) | 当前操作手册 | 当前代码启动、配置、验证命令；它描述现状，不代表最终职责归属。 |
| [`FeedbackInboxDesignPrinciples.md`](FeedbackInboxDesignPrinciples.md) | **反馈收件箱设计原则** | 反馈收件箱作为本地反馈、`annotation-plan` 记录、GitHub sync、Runtime Codex repair 和证据审计控制面的设计边界、证据策略、readiness gate、系统 Terminal/Web Viewer、repair log evidence 和确认原则。 |

迁移前旧方案保存在 [`../docs_old`](../docs_old)，只作为历史对照和迁移输入；不要再把它当作当前架构真相源。

## 核心规则

1. **GUI → TUI 全部是文本。**
   按钮、拖拽、菜单、表单都必须生成终端等价文本。

2. **TUI → GUI 调 GUI module intent。**
   稳定范式是 `module.invoke({ moduleId: 'gui', intent })`；`gui.*` 只允许作为迁移期或 host-specific adapter alias。

3. **TUI 读取 GUI 状态像读资源树。**
   默认只给 shell + hot region；需要更多信息时用 `module.query/read` 按需探测，`watch` 作为可选 subscription facet。

4. **插件系统使用 Codex 原生机制。**
   Codex CLI / app-server 已经有 plugin、skill、tool、MCP 和 custom model provider；SciForge 不再定义第二套，也不要求或新增 AgentServer。

5. **运行期成本必须可控。**
   默认运行期不得消耗 OpenAI token，除非用户显式 opt in；Codex 使用的 provider/model 必须可见、可审计、可测试。

6. **GUI 不做 agent 决策。**
   GUI 不做 provider route、capability ranking、repair strategy 或隐藏 prompt assembly；只允许确定性的 UI precondition、risk label 和 confirmation routing。

7. **GUI 是确定性体验扩展。**
   GUI 可以有 renderer、layout、focus、precondition、defer/reject/suggestion 等 presentation autonomy；接入 GUI 后任务能力不增加，只是展示、确认和交互变好。

8. **GUI 展示能力和 TUI 任务能力分开发现。**
   TUI 任务能力走 Codex 原生 skills/tools/plugins/MCP；GUI 展示组件走只读 GUI resources。两边不互相注册、不互相 import。

9. **引用、trace 和 confidence 必须按需可解释。**
   小数据可以 inline；大 payload、敏感内容和审计材料必须用 ref。`confidence` 只能来自 TUI/verifier/harness 的可解释输出，GUI 不补默认百分比。

10. **注释侧栏是连续反馈入口。**
   `AnnotationSidebar` 可以跨工作台和非工作台引用对象；它负责澄清、预览、保存反馈，也可以在低风险条件下触发小改动。复杂改动、GitHub、repair、commit/push/PR/merge 必须进入收件箱确认和审计。

11. **浏览器验收必须覆盖两类页面。**
   注释、反馈收件箱和 repair UI 的用户级验收必须使用 Codex in-app browser，并同时覆盖工作台页面和至少一个非工作台页面。
