# SciForge 文档

最后更新：2026-05-19

当前架构重构的核心结论：

> **SciForge GUI 是 TUI agent 的 GUI extension。TUI / agent host 拥有全部逻辑。**

GUI 给 TUI 的操作输入全部是文本。默认 TUI 服务就是 Codex CLI / Claude Code CLI 这类终端进程，不需要独立 AgentServer。TUI 感知 GUI 状态时读取只读虚拟 GUI resource tree；TUI 改变 GUI 展示时调用 intent-based `gui.*` tools。算法、capability discovery、harness/policy、provider route、verifier、workspace 操作都使用目标 TUI 的原生 plugin/skill/tool/MCP 机制。

## 权威文档

| 文档 | 状态 | 用途 |
|---|---|---|
| [`Architecture.md`](Architecture.md) | **当前总架构真相源** | GUI-as-extension 的产品边界、职责归属、扩展模型、capability discovery、harness/policy 和 UI 边界。 |
| [`TuiGuiProtocol.md`](TuiGuiProtocol.md) | **当前协议真相源** | GUI → TUI 文本输入，TUI 读取 GUI resource tree，TUI → GUI intent-based `gui.*` tools，hot region、precondition 和协商。 |
| [`Usage.md`](Usage.md) | 当前操作手册 | 当前代码启动、配置、验证命令；它描述现状，不代表最终职责归属。 |

迁移前旧方案保存在 [`../docs_old`](../docs_old)，只作为历史对照和迁移输入；不要再把它当作当前架构真相源。

## 核心规则

1. **GUI → TUI 全部是文本。**
   按钮、拖拽、菜单、表单都必须生成终端等价文本。

2. **TUI → GUI 调 intent-based `gui.*` tools。**
   TUI 表达展示/确认/输入意图，GUI 基于 hot region、interaction mode 和本地规则执行或协商。

3. **TUI 读取 GUI 状态像读资源树。**
   默认只给 shell + hot region；需要更多信息时用 `list/read/search/stat/watch` 按需探测。

4. **插件系统使用 TUI 原生机制。**
   Codex CLI / Claude Code CLI 已经有 plugin、skill、tool、MCP；SciForge 不再定义第二套，也不要求 AgentServer。

5. **GUI 不做算法判断。**
   GUI 不做 intent classifier、provider route、capability ranking、repair strategy、prompt assembly。

6. **GUI 是确定性体验扩展。**
   GUI 可以有 renderer、layout、focus、precondition、defer/reject/suggestion 等 presentation autonomy；接入 GUI 后任务能力不增加，只是展示、确认和交互变好。
