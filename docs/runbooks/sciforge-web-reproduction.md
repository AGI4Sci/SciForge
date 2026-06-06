# 运行手册：网页科研复现

最后更新：2026-06-06

本文是未来科研复现工作流的运行边界，不属于当前 Browser / Computer Use 基本模块 P0。

## 适用范围

当用户要求 SciForge 复现、审计或部分验证科研结果时，可以使用这个工作流。它必须从用户可见的普通聊天任务开始，由 Codex backend Agent Host 负责 task plan、模块选择、repair、completion truth 和 final answer。

Browser、Computer Use、workspace、artifact 和 verifier 都只是模块能力面。

## 记录内容

每个可复验步骤只记录 refs-first 证据：

- 用户目标和约束 refs。
- Browser source / page evidence refs。
- Computer Use observation / action refs。
- paper / dataset / analysis-plan refs。
- execution-unit refs。
- artifact refs。
- verifier refs。
- repair history refs。

不要把 raw screenshot、raw provider output、完整日志、私有 PDF 正文、数据集原文或本机绝对路径塞进主回答。

## 通过边界

科研负结果不是产品失败。缺原始数据、许可证限制、算力不足、provider 不可用或 verifier 拒绝，都应该产出 partial / blocked，并给出证据和下一步选项。

只有当 final answer 同时包含可检查产物、来源 / 执行 / 验证 refs 和未完成事项说明时，才能视为用户级可验收。
