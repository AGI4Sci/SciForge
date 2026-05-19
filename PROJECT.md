# SciForge Project Protocol

最后更新：2026-05-19

## Current Truth

SciForge 当前路线是 **UI/packages preserved, runtime rewritten**。

核心架构：

- Codex CLI / TUI owns agent logic.
- SciForge GUI 是翻译壳、观察层和可复用展示层。
- GUI -> runtime 只发送 terminal-equivalent plain text command。
- runtime -> GUI 只返回 normalized events、audit events 或 intent results。
- GUI 可以做 presentation behavior，不能重新变成 agent runtime。

必须保留：

- `src/ui/**` 现有页面体验和视觉结构；runtime 迁移期间不允许换成临时 demo shell。
- `packages/**` 中的模块化资产、contracts、presentation components、skills、workers、observe/actions/verifiers 等可复用包。
- `docs/` 当前新设计，`docs_old/` 旧方案快照。

可以清理或重写：

- `src/runtime/**` 旧 AgentServer-first gateway / harness / generation / workspace runtime 链路。
- 临时缓存、构建产物、无引用实验残留。
- 与 Codex CLI-first 方案冲突的 runtime 默认路径。

删除约束：

- 不能先物理删除仍被现有 UI import 的投影/状态模型。
- 删除旧 AgentServer-first 文件前，必须确认无引用，并跑 targeted tests、`npm run build`、`git diff --check` 和真实 browser UI 验收。

## Non-Negotiable Principles

- 成本透明，provider/model/profile/workspace/command id 必须可见、可审计、可测试。
- Runtime Codex 默认使用 DeepSeek `bailian/deepseek-v4-flash`，通过 `sciforge-runtime-deepseek` profile 和 backend proxy。
- Runtime Codex 不得静默继承 Developer Codex profile。
- `allowOpenAiRuntime=false` 时禁止 OpenAI provider fallback。
- raw provider SSE、raw Codex JSONL、stderr 只进 audit/debug，默认折叠，不进入主回复 DOM。
- 新增兼容层必须写清退役条件。
- 单文件超过约 2000 行时必须拆分。
- 真实 browser E2E 是最终验收；terminal smoke 只能补充。

## Required Reading

- [`docs/Architecture.md`](docs/Architecture.md)
- [`docs/TuiGuiProtocol.md`](docs/TuiGuiProtocol.md)
- [`docs/CodexRuntimeMigration.md`](docs/CodexRuntimeMigration.md)
- [`docs/Usage.md`](docs/Usage.md)
- [`docs_old/README_SNAPSHOT.md`](docs_old/README_SNAPSHOT.md)
- [`packages/backend/CODEX_COMPATIBILITY.md`](packages/backend/CODEX_COMPATIBILITY.md)

## Completed Baseline

### BASELINE-20260519 preserve UI and packages

状态：done

- [x] 恢复 `src/ui/**`，保证页面与清理前一致
- [x] 恢复 `packages/**` 模块化资产
- [x] 恢复 `src/runtime/**`，避免现有 UI 投影模型断引用
- [x] 恢复原 `package.json` / `vite.config.ts` / `tsconfig.json` / `config.example.json`
- [x] 删除临时重写 stub：`src/ui/src/guiProtocol.ts`、`tests/smoke/smoke-clean-rewrite-baseline.ts`
- [x] 清理 `.pytest_cache`、`__pycache__`、`dist-ui`、Vite 临时缓存
- [x] 启动 `npm run dev:ui`，用浏览器确认 UI 页面恢复
- [x] 跑 `git diff --check`
- [x] 跑 `npm run build`

### BACKEND-20260519 Codex DeepSeek compatibility

状态：done

落点：

- `packages/backend/**`
- `packages/backend/.codex-runtime/**` 本地 ignored runtime state

已完成：

- [x] 新增 `@sciforge/backend` workspace package
- [x] 新增 OpenAI Responses -> Chat Completions compatibility proxy
- [x] 新增 isolated Runtime Codex home：`packages/backend/.codex-runtime/codex-home`
- [x] 新增 `sciforge-runtime-deepseek` profile 模板
- [x] 新增 `backend:codex-runtime:setup`
- [x] 新增 `backend:codex-runtime:exec`
- [x] 记录 upstream Codex CLI 不 fork 决策和升级 checklist：`packages/backend/CODEX_COMPATIBILITY.md`
- [x] 修复 DeepSeek streaming tool-call empty delta 覆盖工具名的问题
- [x] 验证 DeepSeek Runtime Codex 能完成真实工具任务：读 CSV、执行命令、写 `report.md` / `summary.json`

通过验证：

- [x] `npm --workspace @sciforge/backend test`
- [x] `npm run typecheck`
- [x] `git diff --check`
- [x] direct proxy tool-call shape smoke
- [x] Runtime Codex complex tool-use acceptance

## Active Work

### RUNTIME-REWRITE-20260519 Codex exec runtime bridge

状态：active

目标：用 strangler 方式替换 `src/runtime/**` 旧 AgentServer-first 链路。保留 UI 和 packages，新增最小 Codex CLI runtime bridge；先切默认路径，再删除无引用旧代码。

代码落点：

- `src/runtime/codex/agent-cli-adapter.ts`
- `src/runtime/codex/codex-exec-json-adapter.ts`
- `src/runtime/codex/codex-event-normalizer.ts`
- `src/runtime/codex/codex-runtime-config.ts`
- `src/runtime/codex/codex-runtime-server.ts`
- `src/runtime/workspace-server.ts`
- `src/runtime/workspace-runtime-gateway.ts`
- `src/runtime/generation-gateway.ts`
- `src/ui/src/api/sciforgeToolsClient.ts`
- `src/ui/src/app/chat/runOrchestrator.ts`
- `src/ui/src/app/runtimeHealthPanel.tsx`
- `src/ui/src/app/chat/ChatPanelHeader.tsx`
- `src/ui/src/app/appShell/ShellPanelsSettingsDialog.tsx`
- `vite.config.ts`

Todo：

- [ ] 新建 `src/runtime/codex`，只放 Codex CLI bridge，不新增旧 gateway/harness/generation code
- [ ] 定义 `AgentCliAdapter.startTurn({ commandText, workspacePath, profile, abortSignal })`
- [ ] 实现 `CodexExecJsonAdapter`：spawn `codex exec --json --profile sciforge-runtime-deepseek --cd <workspace> <commandText>`
- [ ] adapter 必须使用 `packages/backend` isolated `CODEX_HOME`，不得使用 `~/.codex`
- [ ] stdout JSONL -> `NormalizedAgentEvent`
- [ ] stderr -> audit/debug event only
- [ ] exit code -> `done` / `failed`
- [ ] abort/cancel 必须清理子进程
- [ ] runtime config fail closed：缺 profile、缺 workspace、缺 DeepSeek key/proxy 都失败
- [ ] `allowOpenAiRuntime=false` 时禁止 OpenAI provider
- [ ] 提供最小本地 HTTP/SSE endpoint，供现有 GUI streaming path 消费
- [ ] 每个 run 在 GUI 和 audit 中显示 provider/model/profile/workspace/command id

### GUI-PROTOCOL-20260519 resource tree and intent tools

状态：active

目标：在现有 UI 上增量实现 GUI resource tree 和 intent tools，而不是替换 UI。

Todo：

- [ ] 固化 `/gui/shell.json`
- [ ] 固化 `/gui/hot-region.json`
- [ ] 固化 `/gui/intent-log.json`
- [ ] 实现 `gui.list(path)` / `gui.read(path)` / `gui.search(query)` / `gui.stat(path)`
- [ ] 实现 intent tools：`gui.present`、`gui.notify`、`gui.set_status`
- [ ] intent result 必须包含 `ok/appliedRevision/deferred/reason/suggestions`
- [ ] GUI 内部行为只做 presentation policy，不做 agent 决策
- [ ] raw runtime JSONL/stdout/stderr 默认折叠，只进 audit

### LEGACY-CLEANUP-20260519 AgentServer quarantine

状态：active

目标：清理默认路径里的 AgentServer-first 语义，但保留 UI 当前仍需要的投影模型直到迁移完成。

Todo：

- [ ] 新 runtime code 不得 import legacy AgentServer modules
- [ ] 找出 UI 仍直接 import 的旧 runtime 投影/状态模型
- [ ] 把必要 contract 迁移到 neutral runtime / GUI protocol 命名
- [ ] `smoke:all` 不应依赖 AgentServer 默认路径
- [ ] legacy AgentServer smoke 移到 legacy/migration 分类，或改名明确边界
- [ ] 删除纯转发、重复实现、无退役条件兼容层
- [ ] 每次删除前跑 import check、targeted tests、`npm run build`、browser UI 截图

### VERIFICATION-20260519 final acceptance

状态：active

Todo：

- [ ] mock JSONL smoke：delta/done/failed/stderr/audit/cancel
- [ ] runtime config tests：fail closed、OpenAI opt-in、profile/provider visibility
- [ ] GUI resource tests：list/read/search/stat
- [ ] intent tool tests：present/notify/set_status result schema
- [ ] audit folding tests：raw JSONL/stdout/stderr 不进主 DOM
- [ ] real browser E2E：默认聊天入口提交任务，看到 provider/model/profile，看到主输出，audit 默认折叠
- [ ] real browser E2E 必须使用 Codex in-app browser，不用系统浏览器、macOS `open`、外部 Chrome 或 Playwright 替代用户级验收

## Parallel Execution Prompts

下面 prompt 可分别复制给多个独立 Codex 进程并行执行。主进程负责最后集成。所有进程都必须先读本文件和 Required Reading。

### Prompt A: Backend Runtime Bridge Worker

```text
/goal You are Worker A for SciForge. Work in /Applications/workspace/ailab/research/app/SciForge.

Read PROJECT.md first, then docs/Architecture.md, docs/CodexRuntimeMigration.md, docs/Usage.md, and packages/backend/CODEX_COMPATIBILITY.md. You own only the runtime bridge implementation in src/runtime/codex/** plus the smallest necessary integration hooks in src/runtime/workspace-server.ts, src/runtime/workspace-runtime-gateway.ts, and src/runtime/generation-gateway.ts. Do not edit UI components except if a type export is strictly needed. Do not delete packages/** or replace the UI.

Implement RUNTIME-REWRITE-20260519 for the backend side. Create AgentCliAdapter, CodexExecJsonAdapter, Codex event normalizer, runtime config guard, cancel handling, and a tiny HTTP/SSE endpoint. The adapter must spawn:

codex exec --json --profile sciforge-runtime-deepseek --cd <workspace> <plain text command>

It must force Runtime Codex to use packages/backend/.codex-runtime/codex-home as CODEX_HOME. It must fail closed if the runtime profile, DeepSeek key, proxy, or workspace is missing. It must not inherit ~/.codex. It must not fallback to OpenAI unless allowOpenAiRuntime=true. stderr and raw JSONL are audit/debug only. stdout JSONL must normalize to stable events with provider/model/profile/workspace/command id.

Add focused tests for JSONL normalization, exit code mapping, stderr audit events, cancel cleanup, fail-closed config, and OpenAI opt-in. Run npm --workspace @sciforge/backend test, targeted runtime tests, npm run typecheck, and git diff --check. Do not run destructive git commands. Report changed files, verification commands, and remaining integration points.
```

### Prompt B: GUI Protocol Worker

```text
/goal You are Worker B for SciForge. Work in /Applications/workspace/ailab/research/app/SciForge.

Read PROJECT.md first, then docs/TuiGuiProtocol.md, docs/Architecture.md, docs/Usage.md, and docs_old/README_SNAPSHOT.md. You own the GUI protocol layer and tests. Preserve the existing src/ui/** visual structure. Do not replace the app with a temporary shell. Do not implement agent logic in the GUI.

Implement GUI-PROTOCOL-20260519 incrementally on the existing UI. Add or update modules for /gui/shell.json, /gui/hot-region.json, /gui/intent-log.json, gui.list(path), gui.read(path), gui.search(query), and gui.stat(path). Implement intent tools gui.present, gui.notify, and gui.set_status. Intent results must return ok, appliedRevision, deferred, reason, and suggestions. GUI behavior may apply presentation policy only; all agent decisions stay in Codex CLI/TUI.

Raw runtime JSONL/stdout/stderr must be folded by default and must not appear in the main answer DOM. Add focused tests for resource reads, search/stat behavior, intent result schema, and audit folding. Run targeted UI tests, npm run typecheck, and git diff --check. Do not touch backend proxy code unless a shared type requires it. Report changed files, tests, and any contract assumptions.
```

### Prompt C: UI Integration Worker

```text
/goal You are Worker C for SciForge. Work in /Applications/workspace/ailab/research/app/SciForge.

Read PROJECT.md first, then docs/Architecture.md, docs/CodexRuntimeMigration.md, docs/Usage.md, and packages/backend/CODEX_COMPATIBILITY.md. You own existing UI integration points: src/ui/src/api/sciforgeToolsClient.ts, src/ui/src/app/chat/runOrchestrator.ts, src/ui/src/app/runtimeHealthPanel.tsx, src/ui/src/app/chat/ChatPanelHeader.tsx, src/ui/src/app/appShell/ShellPanelsSettingsDialog.tsx, and closely related tests.

Connect the existing SciForge chat streaming path to the new Codex runtime bridge without changing the main UI layout. The user should see provider/model/profile/workspace/command id for each run. Settings and runtime health should talk about Codex Runtime, Runtime Profile, Model Provider, Model, Base URL, and API Key. AgentServer wording should be legacy-only. Context/window copy should describe the Codex runtime / GUI projection boundary.

Do not introduce multi-backend fallback semantics. Runtime Codex defaults to sciforge-runtime-deepseek and DeepSeek through packages/backend proxy. allowOpenAiRuntime must be explicit and default false. Raw JSONL/stdout/stderr go to audit only and stay folded by default.

Add focused tests for settings defaults, health panel display, header provider visibility, stream presentation, and audit folding. Run targeted UI tests, npm run typecheck, and git diff --check. Do not delete legacy runtime files; leave deletion to the cleanup worker after imports are moved. Report changed files, visible UI behavior, and remaining blockers.
```

### Prompt D: Legacy Cleanup Worker

```text
/goal You are Worker D for SciForge. Work in /Applications/workspace/ailab/research/app/SciForge.

Read PROJECT.md first, then docs/Architecture.md, docs/CodexRuntimeMigration.md, docs/Usage.md, and docs_old/README_SNAPSHOT.md. You own analysis and cleanup planning for AgentServer-first legacy paths. Be conservative: do not delete files that current UI imports. Do not touch packages/backend runtime proxy except for documentation references.

Map all AgentServer-first default paths in src/runtime/gateway/**, src/runtime/generation-gateway.ts, src/runtime/workspace-runtime-gateway.ts, package smoke scripts, and tests/smoke/smoke-agentserver-*.ts. Identify which files are still imported by the UI or active runtime. Rename or quarantine tests only when the new Codex runtime bridge has replacement coverage. Remove only pure dead code or generated residue that import checks prove unused.

Produce a cleanup patch with minimal safe changes plus a migration report. New runtime code must not import legacy AgentServer modules. Legacy shims must have explicit retirement conditions. Run import checks with rg, targeted tests for any touched area, npm run typecheck, npm run build if you changed runtime boundaries, and git diff --check. Report deleted/kept files with reasons.
```

### Prompt E: Verification And Browser Acceptance Worker

```text
/goal You are Worker E for SciForge. Work in /Applications/workspace/ailab/research/app/SciForge.

Read PROJECT.md first, then docs/Architecture.md, docs/TuiGuiProtocol.md, docs/CodexRuntimeMigration.md, docs/Usage.md, and packages/backend/CODEX_COMPATIBILITY.md. You own verification assets and browser acceptance. Do not implement large product features unless a test harness needs a small hook.

Create or update tests for the final acceptance surface: mock Codex JSONL delta/done/failed/stderr/audit/cancel, runtime profile fail-closed, OpenAI opt-in, provider/model/profile audit visibility, GUI resource reads, intent result schema, and audit folding. Add a real browser E2E that starts from the existing default chat entry, submits a task through Runtime Codex, confirms provider/model/profile are visible, confirms the main answer appears, and confirms raw audit is folded by default.

All user-level browser validation must use Codex in-app browser only. Do not use system browser, macOS open, external Chrome, or Playwright as a replacement for acceptance. Before starting servers, do port preflight. Main orchestrator should use 5173; supporting workers should use distinct ports such as 5174-5178 and report the actual port if changed.

Run npm run typecheck, targeted tests, git diff --check, and the browser E2E if the runtime bridge is available. If runtime bridge is not ready, land the mock/contract tests and clearly mark the browser E2E as blocked on Worker A/C integration.
```

## Definition Of Done

- 原 UI 页面保持一致，browser 截图确认没有退化成临时壳。
- `packages/**` 模块资产保留。
- `packages/backend` DeepSeek compatibility proxy 继续通过复杂工具任务验收。
- `src/runtime/**` 默认路径切到 Codex bridge。
- legacy AgentServer-first 文件只有在仍被 UI 引用时短期保留，并有删除任务。
- provider/model/profile/workspace/command id 在 GUI 和 audit 中可见。
- raw JSONL/stdout/stderr 默认折叠，只进 audit/debug。
- `npm run typecheck` 通过。
- `npm run build` 通过。
- `git diff --check` 通过。
- 真实 Codex in-app browser E2E 证明一条用户任务能通过 Runtime Codex 完成。

## Local Worktree Policy

- `history.md` 是本地中断记录，不进入 git。
- `packages/backend/.codex-runtime/**` 是 Runtime Codex 本地状态，不进入 git。
- 不用 `git reset --hard` 或 `git checkout --` 回退用户改动。
- 清理 worktree 时只删除明确生成的缓存、临时 workspace 和构建产物。

## Historical Archive

- `docs_old/` keeps the old design snapshot.
- Git history keeps removed source files.
- Do not reintroduce old runtime code unless a task explicitly proves it is reusable and not AgentServer-first debt.
