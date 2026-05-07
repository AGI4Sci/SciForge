# SciForge Computer Use

`sciforge-computer-use` 是面向 GUI 工作的 sense-agnostic action loop。它是 action provider，不是 sense。目标包位置是 `packages/actions/computer-use`；当前 `packages/computer-use` 路径在迁移完成前作为兼容位置保留。

它有意不 import `vision-sense` 或 SciForge TypeScript runtime。本包定义稳定的 Python contract，用于：

- 通过任意 sense provider 观察目标。
- 规划一个通用 GUI action。
- 定位视觉/逻辑目标。
- 通过 host adapter 执行动作。
- 验证结果。
- 写入 file-ref-only trace data。

`vision-sense` 可以作为其中一个 sense provider，但 action loop 也可以消费 OCR、浏览器沙箱截图、远程桌面帧、窗口元数据，或未来安全的 accessibility summary。
