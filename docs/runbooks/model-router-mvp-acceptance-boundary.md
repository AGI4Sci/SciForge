# 运行手册：Model Router 当前验收边界

最后更新：2026-06-06

本文说明 Model Router 在当前 P0 中如何验收。它不替代 [`../../PROJECT.md`](../../PROJECT.md) 和 [`../ModelRouterArchitecture.md`](../ModelRouterArchitecture.md)。

## 当前口径

Model Router 是 `/v1/responses` 兼容的模型 facade，不是 Agent Host。

它可以服务两类调用：

- Codex backend 的普通推理调用。
- `executeBoundedOperation` 内部的局部辅助调用。

在 bounded operation 内，Model Router 只能用于局部感知和消歧，例如截图描述、页面片段描述、候选目标排序、before/after 对比和不确定性判断。它不能改变风险等级，不能跨模块调用，不能自动 repair，不能宣布 completion truth，也不能生成用户可见 final answer。

## 最小验收

当前 P0 只要求证明：

- Runtime 可以通过公开 router alias 调用 Model Router。
- trace / audit 保持 refs-first。
- trace、manifest 和 UI 公开面不泄漏 API key、Authorization、私有 provider URL、raw upstream model slug、raw provider payload、长 base64 或本机绝对路径。
- bounded operation 可以配置 `maxModelCalls`，并在超预算或 provider 不可用时 fail closed。
- Browser / Computer Use operation result 只包含局部 evidence，不把模型输出升级为用户级完成。

修改 Model Router 配置、trace 或 public metadata 时，至少运行相关 focused tests 和 `git diff --check`。真实 provider live matrix 可以作为额外 release 证据，但不是当前基本模块 P0 的前置条件。

## 历史矩阵

旧文档中的以下矩阵不再驱动当前 P0：

- 主聊天图片理解 live matrix。
- Computer Use 五类复杂桌面任务 release matrix。
- CU bundle adapter / materializer / release harness 作为当前完成条件。
- 用历史 live bundle、fixture 或 diagnostic-only run 声明 release acceptance。

这些材料若保留，只能用于未来 release hardening 或回归审计。当前任务先完成 Browser / Computer Use 基本模块的用户级最小闭环。
