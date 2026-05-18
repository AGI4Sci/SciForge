# SciForge 旧设计快照

最后更新：2026-05-19

本目录是迁移前 `docs/` 的 Git 快照，用于对照旧方案和迁移代码。当前设计真相源已经迁移到 [`../docs`](../docs)。

使用规则：

- `docs_old/` 只读保存旧方案，不再作为新设计入口。
- 新需求、新 contract、新架构讨论写入 `docs/`。
- 迁移实现时可以引用本目录定位旧概念、旧 API 和旧测试，但最终职责归属必须以 `docs/Architecture.md` 和 `docs/TuiGuiProtocol.md` 为准。
- 旧方案中的 AgentServer、runtime gateway、Capability Gateway、HarnessRuntime、ProjectionApi 等概念应逐步映射到新的 CLI-first / GUI-as-extension 架构。

当前迁移方向：

```text
docs_old/
  old agent host / AgentServer / gateway / harness design
    -> docs/
       Codex CLI / Claude Code CLI terminal host
       GUI -> TUI text input
       TUI reads read-only GUI resource tree
       TUI -> GUI intent-based gui.* tools
```
