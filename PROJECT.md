# SciForge Project Protocol

最后更新：2026-05-19

## Current Truth

SciForge 是面向终端 Agent 的 GUI extension。GUI 输入只发文本，GUI 状态只读，GUI 输出只做 intent-based `gui.*` tools。目标架构不需要独立 AgentServer。

运行期不能被 OpenAI token 成本锁死。长期 backend 可以只支持 Codex，但必须优先通过上游 Codex 的 custom `model_provider` / `model_providers.<id>.base_url` 接入 DeepSeek `deepseek-v4-flash` 或本地 provider proxy。开发者用 Codex CLI 实现迁移，不代表 SciForge 用户运行任务时必须消耗 OpenAI token。

`docs/` 是当前设计真相源，`docs_old/` 是旧方案快照，只用于对照和迁移。

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
- 成本透明，运行期 provider/model 必须可见、可审计、可测试；禁止静默 fallback 到更贵 provider。
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
- [`docs/CodexRuntimeMigration.md`](docs/CodexRuntimeMigration.md)
- [`docs/Usage.md`](docs/Usage.md)
- [`docs_old/README_SNAPSHOT.md`](docs_old/README_SNAPSHOT.md)

## Current Goal For Codex CLI

把 SciForge 从 AgentServer-first 迁移为 Codex CLI-first GUI extension。Codex CLI `/goal` 应按下面顺序执行：

1. 先读 Required Reading 和本文件的 Active Work。
2. 先做 Phase 1：`codex exec --json` bridge，让现有前端 streaming API 能消费 Codex JSONL。
3. 再做 Phase 2：抽 `AgentCliAdapter`，把 spawn、profile、JSONL normalize、cancel、audit 隔离到小模块。
4. 同步更新 settings、runtime health、header、结果区和 docs/tests，确保默认运行期 profile 是 `sciforge-runtime-deepseek`。
5. 最后清理或隔离 AgentServer 默认路径，跑 targeted tests、docs smoke、真实 browser E2E，并勾选已完成 todo。

不要实现新的 AgentServer / AgentHost / app-server wrapper。不要 fork Codex。只有当 Codex custom provider 不能直接接入 DeepSeek 时，才做最小 `codex-provider-proxy`。

## Active Work

### MIGRATION-20260519 Codex exec JSON runtime

状态：active
Owner：Codex CLI `/goal`
目标：用 Codex backend 替换 AgentServer 默认运行层。Phase 1 走 `codex exec --json`，Phase 2 抽 `AgentCliAdapter`。长期只支持 Codex backend；DeepSeek `deepseek-v4-flash` 是默认 model provider。

#### A. Config / Settings / Cost Guard

代码落点：

- `config.example.json`
- `src/ui/src/config.ts`
- `src/ui/src/domain.ts`
- `src/ui/src/app/appShell/ShellPanelsSettingsDialog.tsx`
- `src/ui/src/app/runtimeHealthPanel.tsx`
- `src/ui/src/app/chat/ChatPanelHeader.tsx`
- `src/ui/src/app/chat/ContextWindowMeter.tsx`
- `src/ui/src/app/appShell/appHelpers.ts`
- `src/ui/src/config.test.ts`

Todo：

- [ ] 将默认配置从 `agentServerBaseUrl` / 多 backend 改为 Codex runtime profile：`sciforge-runtime-deepseek`
- [ ] 保留 `agentServerBaseUrl` 只作 legacy/migration 字段，不在默认 UI 中作为主配置
- [ ] 设置默认 model provider 为 DeepSeek `deepseek-v4-flash` 或 Codex custom provider/proxy
- [ ] 新增 `allowOpenAiRuntime` 显式开关；默认禁止 OpenAI provider
- [ ] Settings 文案改为 `Codex Runtime`、`Runtime Profile`、`Model Provider`、`Model`、`Base URL`、`API Key`
- [ ] Runtime health panel 检查 Codex runtime/profile/proxy，而不是 AgentServer health
- [ ] Header backend picker 从多 backend 改为 Codex runtime profile / provider 状态
- [ ] Context window 文案从 AgentServer ownership 改为 Codex runtime / GUI projection 边界
- [ ] 配置测试覆盖：默认不含 AgentServer 主路径；缺 key/profile fail closed；OpenAI 需要显式 opt in

#### B. Codex Exec Bridge / AgentCliAdapter

代码落点：

- 新增 `src/runtime/codex/agent-cli-adapter.ts`
- 新增 `src/runtime/codex/codex-exec-json-adapter.ts`
- 新增 `src/runtime/codex/codex-event-normalizer.ts`
- 新增 `src/runtime/codex/codex-runtime-config.ts`
- `src/runtime/workspace-server.ts`
- `src/runtime/workspace-runtime-gateway.ts`
- `src/runtime/generation-gateway.ts`
- `src/runtime/workspace-runtime-events.ts`
- `src/ui/src/api/sciforgeToolsClient.ts`
- `src/ui/src/app/chat/runOrchestrator.ts`
- `src/ui/src/streamEventPresentation.ts`

Todo：

- [ ] 定义 `AgentCliAdapter.startTurn({ commandText, workspacePath, profile })`
- [ ] 实现 `CodexExecJsonAdapter`：spawn `codex exec --json --profile <profile> --cd <workspace> <commandText>`
- [ ] 将 stdout JSONL 归一化为 `NormalizedAgentEvent`
- [ ] 将 stderr 只进入 audit/debug event，不进入默认主回复
- [ ] 将 exit code 映射为 turn completed / failed
- [ ] 支持 abort/cancel，确保子进程被清理
- [ ] 在 workspace server 暴露新的 runtime endpoint，或让现有 `/api/sciforge/tools/run/stream` 转接 Codex adapter
- [ ] `runOrchestrator` / `sendSciForgeToolMessage` 继续保持前端 API 稳定，但内部不再默认走 AgentServer dispatch
- [ ] 请求和结果都记录 provider/model/profile/workspace/command id
- [ ] 保留现有 stream event presentation 的 answer-first / audit-folding 约束，避免 Codex JSONL 泄漏到主 DOM

#### C. GUI Resource Tree / Intent Tools

代码落点：

- `src/ui/src/app/projectionApi.ts`
- `src/ui/src/app/uiActionBoundary.test.ts`
- `src/ui/src/app/ResultsRenderer.tsx`
- `src/ui/src/app/ResultsRenderer.test.ts`
- 可新增 `src/ui/src/app/guiResourceTree.ts`
- 可新增 `src/ui/src/app/guiIntentTools.ts`

Todo：

- [ ] 实现最小只读 GUI resource tree：`/gui/shell.json`、`/gui/hot-region.json`
- [ ] 实现 `gui.list` / `gui.read` / `gui.search` / `gui.stat` 的 mockable adapter
- [ ] GUI action 仍只产生命令文本，不直接调用业务函数
- [ ] 实现最小 intent tools：`gui.present`、`gui.notify`、`gui.set_status`
- [ ] 所有 GUI intent 返回 `ok/appliedRevision/deferred/reason/suggestions`
- [ ] 结果区可见显示本轮 provider/model/profile
- [ ] debug/audit 默认折叠，raw JSONL/stdout/stderr 不出现在默认 DOM

#### D. Remove / Quarantine AgentServer Defaults

代码落点：

- `src/runtime/gateway/agentserver-adapter.ts`
- `src/runtime/gateway/agentserver-stream.ts`
- `src/runtime/gateway/agentserver-generation-dispatch.ts`
- `src/runtime/gateway/agentserver-prompts.ts`
- `src/runtime/gateway/agentserver-repair-prompts.ts`
- `src/runtime/gateway/agentserver-context-*`
- `packages/contracts/runtime/*agentserver*`
- `package.json` smoke scripts
- `tests/smoke/smoke-agentserver-*.ts`
- `tests/smoke/web-e2e/scriptable-agentserver-mock.ts`

Todo：

- [ ] AgentServer 代码标记为 legacy shim，不再作为默认 dispatch path
- [ ] 新 runtime code 不得 import legacy AgentServer modules
- [ ] package smoke 新增 Codex runtime smoke；`smoke:all` 不再默认串起 agentserver smoke
- [ ] 旧 agentserver smoke 移到 migration/legacy 分类，或者改名明确只验证 legacy shim
- [ ] 删除与新方案冲突的多 backend 选择逻辑；不要保留两套并行语义
- [ ] 若保留 legacy shim，必须写清退役条件和测试边界

#### E. Verification / Browser E2E

代码落点：

- `tests/smoke/smoke-docs-scenario-package.ts`
- `tests/smoke/smoke-harness-research-guide.ts`
- 新增 `tests/smoke/smoke-codex-exec-json-runtime.ts`
- 新增或更新 `tests/smoke/web-e2e/*`

Todo：

- [ ] 测试默认配置不会访问 OpenAI endpoint
- [ ] 测试缺少 DeepSeek key/profile 时 fail closed
- [ ] 测试 mock Codex JSONL 能被归一化为 GUI event
- [ ] 测试 provider/model/profile 出现在 run audit 和结果区
- [ ] 跑 `npm run typecheck`
- [ ] 跑相关单测，例如 `node --import tsx --test src/runtime/codex/*.test.ts src/ui/src/config.test.ts`
- [ ] 跑新增 `npm run smoke:codex-runtime` 或等价 smoke
- [ ] 跑 `npm run smoke:harness-research-guide`
- [ ] 跑 `npm run smoke:docs-scenario-package`
- [ ] 跑 `git diff --check`
- [ ] 启动本地 dev server，用真实浏览器模拟深度使用 SciForge
- [ ] 至少完成一条真实用户任务，验证主回复解决问题、artifact 可打开、debug 默认折叠、provider/model/profile 正确显示

### CODEX-UPSTREAM-20260519 minimal upstream strategy

状态：active
Owner：Runtime Migration Owner
目标：长期只支持 Codex backend，但尽量不 fork、不改官方代码，确保官方更新后能快速迁移。

Todo：

- [ ] 不在 SciForge 父目录默认 clone / 修改 Codex；先用已安装 Codex CLI 和官方 config 验证 custom provider
- [ ] 如需读源码，只 clone upstream 到 sibling `../codex-upstream` 作为 read-only reference，不把它作为 SciForge 构建依赖
- [ ] 如需本地服务，优先做 SciForge 自己的 `codex-provider-proxy` 或 `codex-bridge` 小项目，而不是改 Codex core
- [ ] 如果必须 fork Codex，只改最小文件集，并新增 `docs/CodexUpstreamPatchLog.md`
- [ ] `CodexUpstreamPatchLog.md` 必须记录 upstream commit、修改文件、修改原因、如何 rebase、如何验证
- [ ] 每次升级官方 Codex 后，先跑 provider/proxy contract tests，再跑 browser E2E

## Backlog After Runtime Migration

这些任务保留为迁移后的 UX / contract 收尾，不是当前 `/goal` 的第一目标。若实现迁移时顺手触及这些边界，可以同步完成并勾选；否则不要为了它们扩大本轮改动。

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

## Definition Of Done

- 默认配置、设置页、runtime health 和结果区都指向 Codex runtime profile，而不是 AgentServer。
- Runtime Codex 使用 `sciforge-runtime-deepseek` / DeepSeek `deepseek-v4-flash` 或显式配置的 provider proxy。
- 缺少 runtime profile、DeepSeek key 或 provider proxy 时 fail closed；不得静默 fallback 到 OpenAI。
- `allowOpenAiRuntime=true` 是唯一允许 OpenAI runtime provider 的路径，并且 UI 和 audit 必须显式显示。
- `codex exec --json` JSONL 事件被归一化为稳定 `NormalizedAgentEvent`，前端不直接解析 Codex 原始 JSONL。
- GUI 状态通过只读 resource tree 分级披露；TUI/Codex 改变 GUI 时只发 intent tools。
- AgentServer 不再是默认 dispatch path；保留的 legacy shim 有退役条件和测试边界。
- 真实 browser E2E 至少证明一条深度用户任务完成：主答案可用、artifact 可打开、debug 默认折叠、provider/model/profile 可见、无隐藏 OpenAI 请求。

## Codex CLI `/goal` Prompt

```text
/goal Read PROJECT.md first, then docs/Architecture.md, docs/TuiGuiProtocol.md, docs/CodexRuntimeMigration.md, docs/Usage.md, and docs_old/README_SNAPSHOT.md. Implement MIGRATION-20260519: migrate SciForge from AgentServer-first to Codex CLI-first GUI extension.

Use Phase 1 + Phase 2 only. Phase 1: add a codex exec --json bridge that starts Codex CLI with --profile sciforge-runtime-deepseek and --cd <user workspace>, consumes stdout JSONL, maps stderr to audit/debug only, handles exit code and cancel, and feeds the existing streaming UI path without exposing raw JSONL in the main DOM. Phase 2: extract a minimal AgentCliAdapter/CodexExecJsonAdapter/Codex event normalizer so spawn/profile/JSONL/cancel/audit details are isolated and testable.

Cost guard is mandatory. Runtime Codex must default to DeepSeek deepseek-v4-flash through Codex custom model_provider or a minimal SciForge provider proxy. Do not fork Codex and do not build a new AgentServer or AgentHost. Do not silently inherit the developer Codex profile. Do not silently fallback to OpenAI; only allow OpenAI runtime when allowOpenAiRuntime=true and show provider/model/profile in UI and audit.

Update config.example.json, src/ui/src/config.ts, src/ui/src/domain.ts, settings UI, runtime health, chat header, context window copy, workspace runtime gateway/server, runOrchestrator/sendSciForgeToolMessage, stream presentation, and relevant contracts/tests. Add a minimal read-only GUI resource tree (/gui/shell.json, /gui/hot-region.json), gui.list/read/search/stat, and intent tools gui.present/gui.notify/gui.set_status with ok/appliedRevision/deferred/reason/suggestions.

Quarantine AgentServer as legacy only: new runtime code must not import legacy AgentServer modules, smoke:all must not depend on agentserver smoke, and any retained legacy shim needs retirement conditions. Remove conflicting multi-backend semantics instead of maintaining parallel behavior.

Add targeted tests for config fail-closed behavior, OpenAI opt-in, Codex JSONL normalization, cancel/exit handling, provider/model/profile audit visibility, and GUI audit folding. Run npm run typecheck, targeted tests, docs smokes, git diff --check, and a real browser E2E that mimics deep SciForge usage and proves the user task succeeds. As each task is completed, update PROJECT.md checkboxes and record validation evidence.
```

## Working Rules

- 真实 browser 优先；terminal smoke 只能补充，不能替代用户可见证据。
- `TaskSuccess=true` 必须代表用户 hard requirements 被准确、完整、可核查地解决。
- 反假成功优先；`satisfied`、artifact refs、summary、plan 都不能单独算完成。
- 所有修复必须通用，不写 prompt/provider/session/端口特例。
- 设计 contract 先写 `docs/`，再同步代码与 smoke。
- 成本边界优先；默认运行期不得消耗 OpenAI token，除非用户显式 opt-in。

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
