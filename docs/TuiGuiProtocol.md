# GUI / Codex Backend 协议

最后更新：2026-06-06

## 结论

SciForge GUI 不定义新的 Agent Host 协议。当前只有两个方向：

```text
GUI -> Codex backend:
  用户自然语言
  refs
  Autonomy profile
  confirmation / cancel result

Codex backend -> GUI:
  final answer
  evidence / artifact refs
  approval request
  status / blocked recovery
  presentation intent
```

GUI 不做 task planning、tool selection、risk policy、repair、completion truth 或 final answer。

## GUI 可以做

- 收集用户输入。
- 附带选区、annotation、browser、window、artifact 等 refs。
- 展示模块 readiness、运行状态、证据、产物和 blocked reason。
- 展示 hard-confirm UI，并把用户确认 / 取消结果回传给 Codex backend。
- 提供 stop / cancel / takeover 控制面。
- 在 debug / expert 模式生成 terminal-equivalent text。

## GUI 不能做

- 根据用户文本直接调用 Browser / Computer Use 业务动作。
- 作为隐藏 task router。
- 执行 workspace、browser、desktop、connector 或 artifact 操作。
- 从 GUI projection、按钮文案、截图或历史 run 推断 completion truth。
- 扩大 Autonomy profile 或绕过 hard-confirm。

## 与 Bounded Operation 的关系

`executeBoundedOperation` 由 Codex backend 通过 `module.invoke` 调用。GUI 只能展示 operation 的状态和证据，不能直接创建或驱动 operation。

## 相关文档

- [`../PROJECT.md`](../PROJECT.md)：当前需求和验收标准。
- [`Architecture.md`](Architecture.md)：总架构和 Bounded Operation。
