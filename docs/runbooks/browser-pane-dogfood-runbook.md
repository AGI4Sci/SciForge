# 历史运行手册：Browser Pane Dogfood

最后更新：2026-06-06

本文只保留旧 Browser pane live-surface dogfood 的历史口径。它不再作为当前 P0 的任务来源，也不再定义 Browser 用户级验收。

当前 Browser 设计以以下文档为准：

- [`../../PROJECT.md`](../../PROJECT.md)
- [`../Architecture.md`](../Architecture.md)
- [`../BrowserRuntimeArchitecture.md`](../BrowserRuntimeArchitecture.md)

## 历史口径（已 superseded）

Browser 是 SciForge 暴露给 Codex backend 的能力模块，不是 Browser agent，也不是第二个 Agent Host。

旧 Browser pane dogfood 曾按两个组合 operation 记录诊断结果：

- `browser.search_read`：搜索并读取公开网页证据。
- `browser.open_read`：打开指定 URL 或 page ref 并读取可引用证据。

这两项现在只作为历史运行记录中的诊断术语保留，不是当前 public/product surface、兼容 alias 或 P0 通过条件。当前 Browser product surface 以六个 primitive 为准：`browser.search`、`browser.navigate`、`browser.observe`、`browser.read`、`browser.extract`、`browser.download`。

当前 Browser primitive 只返回 refs-first result envelope，例如 `resources`、`evidenceState`、source refs、page refs、search result refs、blocked reason、approval request 和 compact observation。它不负责选择是否搜索、不负责综合答案、不负责 repair，也不宣布用户任务完成。

## 局部动作范围

Browser 未来可以支持点击、下载、打开下一页、站内探索等局部动作，但旧 `module.invoke(executeBoundedOperation)` 浏览器组合入口已经移出当前 public surface。它只可用于阅读历史 trace 或诊断旧运行，不能作为当前产品验收路径。

当前局部动作必须落在具体 Browser primitive 上，并满足：

- 一个 owner module：Browser。
- 一个 target scope：当前 tab、当前 URL、当前站点或当前下载目标。
- 一个局部目标：例如“打开前三个结果并读取证据”。
- 有 `allowedActions`、`maxSteps`、`maxTimeMs`、`maxModelCalls`、`riskPolicy`、`requiredEvidence` 和 `stopConditions`。
- 不嵌套调用另一个组合 operation。
- 不表达跨模块 workflow。

是否继续搜索、是否改用其它模块、是否总结成 final answer，均由 Codex backend Agent Host 决定。

## 旧口径不再使用

以下内容可作为历史诊断线索，但不得作为当前 P0 通过条件：

- 右侧 Browser pane 连续冲浪矩阵。
- `BrowserHostSession` owning `native-embedded` live surface。
- `singleInteractiveTruth=true` / `secondTruthSource=false` 作为用户级 completion 条件。
- 通过固定 URL、固定搜索站点、固定截图或历史 frame 声明 pass。
- 把 Browser UI dogfood 结果直接升级为聊天 final answer。

如果未来重新做 Browser UI dogfood，它只能证明 Browser surface 的交互稳定性；用户级任务完成仍必须由 Codex backend 基于当前 run 的 evidence refs 和 completion truth 判断。
