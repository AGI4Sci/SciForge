# SciForge Project Protocol

最后更新：2026-05-19

## Current Truth

SciForge 是面向终端 Agent 的 GUI extension。默认目标是 Codex CLI / Claude Code CLI。GUI 输入只发文本，GUI 状态只读，GUI 输出只做 intent-based `gui.*` tools。目标架构不需要独立 AgentServer。

`docs/` 是当前设计真相源，`docs_old/` 是旧方案快照，只用于对照和迁移。

## Active Work

### DOCS-MIGRATION-20260519 CLI-first GUI extension

状态：active
Owner：Orchestrator
目标：把旧的 AgentServer / gateway / harness / projection 方案迁移到 CLI-first GUI extension 方案，并继续收敛代码边界。

Todo：

- [x] 恢复旧方案快照到 `docs_old/`
- [x] 在 `docs/` 中收束新的设计入口
- [x] 在根文档中标明 `docs_old/` 只作历史对照
- [x] 更新 smoke，锁住新旧文档边界
- [ ] 移除 runtime / config / UI 中剩余的 AgentServer 默认依赖
- [ ] 用 Codex CLI / Claude Code CLI 连接与事件流替换 AgentServer 运行层
- [ ] 继续把旧 gateway / projection / harness 兼容层收口为迁移 shim
- [ ] 未来新增设计只写入 `docs/`，不再扩散到旧方案目录

### UX-SYSTEM-TASK-20260517-universal-chat-entry

状态：active / partial
目标：默认入口无需 builder 术语就能承接 literature、data analysis、coding / self-improvement 任务。

Todo：

- [x] 去掉 shell 里的 builder 式默认措辞
- [ ] 验证默认入口覆盖 literature / analysis / coding / self-improvement
- [ ] 验证 answer-first 结果面板可直接读懂
- [ ] 保持 debug / raw payload 默认折叠

### UX-SYSTEM-TASK-20260517-ui-execution-decoupling

状态：in_progress
目标：让用户动作和调试展开都走函数式 API，而不是原始 payload。

Todo：

- [x] 保留 `ProjectionApi` / `UserActionApi` / `ProjectionSubscriptionApi`
- [ ] 完成 import / verify / confirm 事务流
- [ ] 继续把 preview / audit helpers 推到函数边界后面
- [ ] 保持 raw ToolPayload / stdout / stderr 只进 audit channel

## Working Rules

- 真实 browser 优先；terminal smoke 只能补充，不能替代用户可见证据。
- `TaskSuccess=true` 必须代表用户 hard requirements 被准确、完整、可核查地解决。
- 反假成功优先；`satisfied`、artifact refs、summary、plan 都不能单独算完成。
- 所有修复必须通用，不写 prompt/provider/session/端口特例。
- 设计 contract 先写 `docs/`，再同步代码与 smoke。

## Kept Principles

下面是值得长期遵守的条目：

- 默认通用聊天入口，不要求普通用户先理解 builder、allowlist、execution unit 或 raw payload。
- Answer-first，默认结果区先给主答案、完成度、关键证据和下一步。
- 诚实失败，能力不足、provider 不可用、数据不可得或验证失败时必须说明缺口和恢复路径。
- Capability discovery 和其它扩展能力必须 progressive disclosure，初始 context 只暴露最小必要信息。
- UI / 执行层必须函数化，raw payload、stdout、stderr、hand-off JSON 只能进 audit/debug。
- 真实 browser 优先，terminal smoke 只能补充不能替代用户可见证据。
- 反假成功优先，`satisfied`、artifact refs、summary、plan 不能单独算完成。
- 所有修复必须通用，不写单 prompt、单 provider、单 session、单端口特例。
- 文档与代码同步，设计 contract 先写 `docs/`，再同步实现和 smoke。
- 同步优先，完成一个迁移或修复后要更新任务板并保持证据可追溯。
- 代码卫生优先，发现冗余逻辑链条、重复实现、死分支或无效兼容层时要清理，不保留“看起来也能跑”的旧路径。
- 旧逻辑与新方案冲突时，默认以新方案为准，直接删除旧逻辑并重写，不用历史包袱维持两套并行语义。
- 单文件超过约 2000 行时应主动拆分，按职责、视图、协议、适配器或测试边界切开，避免把复杂性压进一个大文件。
- 新增兼容层必须有明确退役条件；如果没有退役计划，它不是兼容层，而是债务。
- 重构时优先切断不必要的链式转发和薄包装层，保留真正有语义的边界，删掉纯转述代码。

## Required Reading

- [`docs/Architecture.md`](docs/Architecture.md)
- [`docs/TuiGuiProtocol.md`](docs/TuiGuiProtocol.md)
- [`docs/Usage.md`](docs/Usage.md)
- [`docs_old/README_SNAPSHOT.md`](docs_old/README_SNAPSHOT.md)

## Verification

常用检查：

```bash
npm run smoke:harness-research-guide
npm run smoke:docs-scenario-package
git diff --check
```

当迁移代码落地后，再补对应模块的 targeted tests 和必要 browser 证据。

## Historical Archive

长期历史和旧运行日志不再堆在这里。需要追溯时看：

- [`docs/archive/`](docs/archive/)
- [`docs_old/`](docs_old/)
