# SciForge Project Protocol

最后更新：2026-05-19

## Current Truth

SciForge 当前路线是 **UI/packages preserved, runtime rewritten, desktop-ready boundary next**。

核心架构：

- Codex CLI / TUI owns agent logic.
- SciForge GUI 是翻译壳、观察层和可复用展示层，不是 agent host。
- GUI -> runtime 只发送 terminal-equivalent plain text command。
- runtime -> GUI 只返回 normalized events、audit events 或 intent results。
- GUI 可以做 deterministic presentation behavior，不能重新变成 agent runtime。
- `docs/` 保持产品/协议真相源；backend 运行期迁移真相源已收拢到 `packages/backend/CodexRuntimeMigration.md`。
- 短中期桌面化选择 Electron；Tauri 只作为 runtime 边界稳定后的长期优化项。

必须保留：

- `src/ui/**` 现有页面体验和视觉结构；runtime / desktop 迁移期间不允许换成临时 demo shell。
- `packages/**` 中的模块化资产、contracts、presentation components、skills、workers、observe/actions/verifiers 等可复用包。
- `docs/` 当前新设计，`docs_old/` 旧方案快照。

可以清理或重写：

- `src/runtime/**` 旧 AgentServer-first gateway / harness / generation / workspace runtime 链路。
- 临时缓存、构建产物、无引用实验残留。
- 与 Codex CLI-first 和 desktop-ready 方案冲突的 runtime 默认路径。

删除约束：

- 不能先物理删除仍被现有 UI import 的投影/状态模型。
- 删除旧 AgentServer-first 文件前，必须确认无引用，并跑 targeted tests、`npm run build`、`git diff --check` 和真实 browser UI 验收。
- 不用 `git reset --hard` 或 `git checkout --` 回退用户改动。

## GitHub Sync Status

- 2026-05-19：已执行 `git fetch origin --prune`。
- 当前分支：`dev`。
- 同步结果：`HEAD...origin/dev` 为 `0 0`，没有 ahead/behind；未执行 pull/rebase/reset。
- 注意：当前 worktree 有大量未提交改动；继续集成时必须按 dirty worktree 协作规则处理。
- 注意：Git 提示 `.git/gc.log` 阻塞自动 gc，且 loose objects 过多；这是仓库维护项，不应混入 feature/runtime 改动。

## Non-Negotiable Principles

- 成本透明，provider/model/profile/workspace/command id 必须可见、可审计、可测试。
- Runtime Codex 默认使用 DeepSeek `bailian/deepseek-v4-flash`，通过 `sciforge-runtime-deepseek` profile 和 backend proxy。
- Runtime Codex 不得静默继承 Developer Codex profile。
- `allowOpenAiRuntime=false` 时禁止 OpenAI provider fallback。
- raw provider SSE、raw Codex JSONL、stdout、stderr、plugin warning 只进 audit/debug，默认折叠，不进入主回复 DOM 或 foreground waiting summary。
- 用户级 browser 验收必须使用 Codex in-app browser，从默认聊天入口开始；系统浏览器、macOS `open`、外部 Chrome、Playwright 只能作为辅助诊断。
- 多 agent / 多 server 验收前必须做端口预检；主 orchestrator 默认 `5173`，支持进程默认 `5174`-`5178`，若改端口必须记录实际端口。
- 新增兼容层必须写清退役条件。
- 单文件超过约 2000 行时必须拆分。
- 真实 browser E2E 是最终验收；terminal smoke 只能补充。

## Required Reading

- [`docs/Architecture.md`](docs/Architecture.md)
- [`docs/TuiGuiProtocol.md`](docs/TuiGuiProtocol.md)
- [`packages/backend/CodexRuntimeMigration.md`](packages/backend/CodexRuntimeMigration.md)
- [`docs/Usage.md`](docs/Usage.md)
- [`packages/backend/CODEX_COMPATIBILITY.md`](packages/backend/CODEX_COMPATIBILITY.md)

## Design Conflicts To Resolve

这些是进入实现前必须先讨论或在 task 中显式选择的冲突点：

1. **文档位置冲突**：`CodexRuntimeMigration.md` 已移动到 `packages/backend/`，但 `docs/README.md`、`docs/Architecture.md`、`docs/Usage.md` 和若干 smoke 仍可能引用旧 `docs/` 路径。最终方案应把 backend 迁移文档视为 backend 包内真相源，`docs/` 只保留产品/协议真相源。
2. **完成态来源冲突**：当前计划要求结果区等待 TUI `gui.present` 或等效 intent；不能让 GUI 从 raw message/stdout/jsonl 合成完成态。实现前要明确 `gui.present` intent state 如何进入现有结果区 view model。
3. **多轮能力边界冲突**：Phase 1 依赖 `codex exec resume`，但真实 isolated `CODEX_HOME` 是否可恢复上下文尚未证明。若失败，不能用 GUI transcript 拼接伪多轮，必须转入 Phase 2 app-server/thread。
4. **AgentServer 清理顺序冲突**：架构目标要求移除 AgentServer-first 默认路径，但现有 UI/测试仍可能依赖投影模型和 gateway fallback。清理必须在 Codex bridge 覆盖等价风险后分批做。
5. **桌面化时机冲突**：Electron 是短中期方向，但必须等 production runtime launcher、app data layout、secret storage 和 platform service 边界清晰后再产品化，不能把开发端口和仓库内 runtime state 固化进桌面契约。

## Active Tasks

### DOC-SYNC-20260519 authoritative doc map

状态：planned

目标：只更新文档索引和测试期望，让仓库承认 `packages/backend/CodexRuntimeMigration.md` 是 backend 运行期迁移真相源；`docs/` 保留架构与协议真相源。

Todo：

- [ ] 更新 `docs/README.md` 的权威文档表，指向 `../packages/backend/CodexRuntimeMigration.md`。
- [ ] 更新 `docs/Architecture.md` 和 `docs/Usage.md` 中旧 `docs/CodexRuntimeMigration.md` 链接。
- [ ] 更新 docs smoke，使它读取 `packages/backend/CodexRuntimeMigration.md`。
- [ ] 保留 `docs_old/` 作为历史快照，不重新引入旧 runtime 设计。
- [ ] 明确 `docs/AgentServerLegacyCleanupReport.md` 若已删除，则其清理结论并入本 `PROJECT.md` 的 legacy cleanup task。

验收：

- [ ] `npm run smoke:harness-research-guide`
- [ ] `npm run smoke:docs-scenario-package`
- [ ] `git diff --check`

### GUI-PROTOCOL-20260519 complete TUI extension surface

状态：planned

目标：让实现与 [`docs/TuiGuiProtocol.md`](docs/TuiGuiProtocol.md) 的最终 tool surface 对齐。TUI 可读 GUI resource tree，并能通过 intent-based `gui.*` tools 表达展示、确认、输入、状态和 GUI-local transaction；GUI 只做 presentation negotiation，不做任务推理。

Todo：

- [ ] `GuiProtocolController` 暴露 `gui.get_context/list/read/search/stat/watch` 只读状态操作。
- [ ] `GuiProtocolController` 暴露 `gui.present/ask_user/notify/set_status/apply_batch` intent 操作。
- [ ] `gui.ask_user` 只产生 confirmation/input/choice presentation state 和 terminal-equivalent command affordances。
- [ ] `gui.apply_batch` 支持 `all-or-nothing` 与 `best-effort` GUI-local transaction，只能修改 GUI view state，不触碰 workspace state。
- [ ] `gui.watch` 订阅语义 resource revision/change，不暴露低级 DOM 事件。
- [ ] Runtime Codex MCP manifest/server 注入完整 `gui.*` tool surface，并把 intent tools 持久化到 GUI extension state。
- [ ] UI 结果区消费 TUI `gui.present` intent 作为完成态来源；不得从 raw stdout/jsonl/message 猜完成态。
- [ ] `availableGuiTools`、MCP tool list、docs tool list 和 tests 保持一致。

验收：

- [ ] `node --import tsx --test src/ui/src/app/guiProtocol.test.ts`
- [ ] `node --import tsx --test src/runtime/codex/gui-extension-manifest.test.ts`
- [ ] `node --import tsx --test "src/runtime/codex/*.test.ts"`
- [ ] `npm run smoke:harness-research-guide`
- [ ] `npm run smoke:docs-scenario-package`

### RUNTIME-CODEX-20260519 session, GUI extension, and audit boundary

状态：planned

目标：保留薄 adapter 语义，把 Runtime Codex 作为唯一默认生产 runtime；GUI 只发送 terminal-equivalent text，并通过 Codex 原生 MCP/tool/resource 机制暴露 `gui.*` extension。

Todo：

- [ ] `commandText` 保持 terminal-equivalent text：无 ref 为用户原文，有 ref 为 `ask --ref "<ref>" "<prompt>"`。
- [ ] 禁止把 GUI transcript、expected artifacts、capability selection、provider route、历史 run JSON 或 artifact body 拼进 `commandText`。
- [ ] Runtime Codex 缺 profile、workspace、DeepSeek key/proxy 时 fail closed。
- [ ] `allowOpenAiRuntime` 保持显式 opt-in，默认 false。
- [ ] raw JSONL/stdout/stderr/plugin warning 只进 audit/debug，主回复 DOM 和 foreground waiting summary 不展示原始日志。
- [ ] 每个 run 的 provider/model/profile/workspace/command id 写入 normalized event 和 GUI/audit 可见区域。
- [ ] DeepSeek 真实两轮验收：第一轮记暗号，第二轮通过 Codex 原生 session/resume 回答暗号。
- [ ] 若 `codex exec resume` 在 isolated `CODEX_HOME` 中不能恢复上下文，明确标记为 Phase 2 app-server/thread 需求，不做 transcript 拼接 workaround。
- [ ] TUI 自主调用 `gui.present` 后，UI 能读取展示意图并更新结果区；不得由 GUI 从 raw message 猜测完成态。

验收：

- [ ] `node --import tsx --test "src/runtime/codex/*.test.ts"`
- [ ] `node --import tsx --test src/ui/src/api/sciforgeToolsClient/runtimeEvents.test.ts src/ui/src/streamEventPresentation.test.ts src/ui/src/processProgress.test.ts src/ui/src/app/chat/runStatusPresentation.test.ts src/ui/src/app/chat/finalMessagePresentation.test.tsx`
- [ ] `node --import tsx --test src/ui/src/app/guiProtocol.test.ts`
- [ ] `npm run typecheck`
- [ ] `git diff --check`

### VERIFICATION-20260519 real in-app browser acceptance

状态：planned / blocked-by-runtime

目标：只用 Codex in-app browser 从默认聊天入口证明用户级路径可用；不能用系统浏览器、macOS `open`、外部 Chrome 或 Playwright 替代结论。

阻塞：

- [ ] 多 turn 暗号验收未通过：必须确认 `codex exec resume` + isolated `CODEX_HOME` 在真实 Runtime Codex 环境里是否能恢复上下文。
- [ ] 结果区仍等待 TUI `gui.present` 或等效 intent；GUI 不应合成 `ConversationProjection` 冒充完成态。
- [ ] blocked manifest 位于 ignored 路径：`docs/test-artifacts/runtime-codex-browser-acceptance/manifest.json`。

Todo：

- [ ] 端口预检并记录实际端口；默认主 UI `5173`，workspace writer `5174`，并行 worker 使用 `5175`-`5178`。
- [ ] 单 turn：默认聊天入口提交明确任务，确认 provider/model/profile/workspace/command id 可见。
- [ ] 单 turn：主聊天出现 DeepSeek/Codex 回复。
- [ ] 单 turn：raw stderr/jsonl/stdout/plugin warning 默认折叠。
- [ ] artifact open/follow-up：通过 UI 选择 artifact 后追问，验证 TUI 使用 selected ref 生成 terminal-equivalent text。
- [ ] 多 turn：第一轮记暗号，第二轮只回暗号；失败时记录为 Codex session 能力边界或实现缺口，不许改成 passed。
- [ ] `tests/smoke/smoke-runtime-codex-browser-acceptance.ts` 的 manifest 只有在真实 in-app browser 观察到可见结果后才能标 passed。
- [ ] blocked/failed manifest 必须写清端口、URL、profile、原因、截图/DOM 证据位置。

验收：

- [ ] `npm run smoke:runtime-codex-browser-acceptance`
- [ ] `npm run smoke:single-agent-final-gate`
- [ ] `npm run verify:single-agent-final`
- [ ] `git diff --check`

### LEGACY-CLEANUP-20260519 AgentServer quarantine

状态：planned / blocked-by-codex-bridge-coverage

目标：清理默认路径里的 AgentServer-first 语义，但保留 UI 当前仍需要的投影模型直到 Codex bridge + GUI protocol 替代覆盖成立。

Todo：

- [ ] 新 runtime code 不得 import legacy AgentServer modules。
- [ ] 把必要 contract 迁移到 neutral runtime / GUI protocol 命名。
- [ ] UI import check：不直接 import `src/runtime/gateway/**`、`src/runtime/generation-gateway.ts`、`src/runtime/workspace-runtime-gateway.ts`。
- [ ] `src/runtime/codex/**` 不 import legacy AgentServer modules。
- [ ] `smoke:all` 不应依赖 AgentServer 默认路径。
- [ ] legacy AgentServer smoke 移到 legacy/migration 分类，或改名明确边界。
- [ ] `targeted gateway policy smoke` 同步 `codex-runtime-bridge` 后的 stage-list 期望。
- [ ] `smoke:runtime-ui-manifest` 输出/期望不一致，需要 runtime UI manifest owner 判断更新测试还是实现。
- [ ] 删除纯转发、重复实现、无退役条件兼容层；每次删除前跑 import check、targeted tests、`npm run build`、browser UI 验收。

参考：

- [`packages/backend/CodexRuntimeMigration.md`](packages/backend/CodexRuntimeMigration.md)
- 本任务条目是 AgentServer quarantine 的当前清理清单；旧 `docs/AgentServerLegacyCleanupReport.md` 不再是权威输入。

验收：

- [ ] `npm run smoke:no-legacy-paths`
- [ ] `npm run smoke:docs-scenario-package`
- [ ] `npm run build`
- [ ] `npm run typecheck`
- [ ] `git diff --check`

### RUNTIME-LAUNCHER-20260519 production runtime boundary

状态：planned / after-runtime-codex

目标：把开发启动脚本和生产 runtime launcher 分开，让 runtime 能被 Electron main process 稳定嵌入和管理。

Todo：

- [ ] 新增 production runtime launcher，统一管理端口或 IPC、ready/health、stdout/stderr audit、graceful shutdown。
- [ ] launcher 启动失败必须 fail closed，并把原因变成结构化 health/audit event。
- [ ] 生产桌面端不得把 `5173` 或其它固定开发端口写成用户可见契约；若使用 loopback，必须选择空闲端口并只通过受控配置传给 renderer。
- [ ] 应用全局配置、Runtime Codex home、日志、缓存、用户 workspace `.sciforge/` 状态分离。
- [ ] Runtime Codex home 从仓库内临时路径迁移到系统 app data 目录，保留开发期 isolated home 作为 test/dev 路径。
- [ ] provider API key 默认进入系统 keychain / credential store；明文配置只能作为显式调试 fallback。
- [ ] 平台能力集中到 platform service：open external、reveal in folder、terminal command、path quoting、kill process、permission probe。
- [ ] macOS、Windows、Linux 的 shell/path/process 差异不得散落到 React 组件或 Codex adapter。

验收：

- [ ] launcher unit tests 覆盖 ready/health、port conflict、child exit、stderr audit、shutdown。
- [ ] platform service tests 覆盖 path/command quoting 的跨平台 contract。
- [ ] secret storage 有 mockable contract 和 fail-closed 行为。

### DESKTOP-PRODUCTIZATION-20260519 Electron desktop shell

状态：planned / after-runtime-launcher

依据：[`docs/Architecture.md`](docs/Architecture.md) 的 `Desktop Packaging Direction` 和 [`packages/backend/CodexRuntimeMigration.md`](packages/backend/CodexRuntimeMigration.md) 的 `Desktop Runtime Productization`。

目标：第一阶段用 Electron 把现有 React + Vite GUI、Node/TypeScript workspace runtime、`packages/backend` proxy 和上游 Codex CLI bridge 封装成本地软件；不重写原生 UI，不引入新的 agent backend。

Todo：

- [ ] 新增 desktop app 边界，例如 `apps/desktop` 或 `desktop/`，避免 Electron 逻辑散落到 React/UI。
- [ ] Electron main 加载 `vite build` 产物，而不是启动 Vite dev server。
- [ ] Electron main 管理窗口、菜单、协议、系统权限、日志目录和退出清理。
- [ ] Electron main 启动、停止并观测 workspace server、`packages/backend` provider proxy、Runtime Codex 进程。
- [ ] Renderer 只通过稳定 IPC 或 loopback API 发送命令、读取 normalized events 和 audit events。
- [ ] 桌面窗口内完成一次真实 Codex-backed run，并展示 provider/model/profile/workspace/command id。
- [ ] 保持 Web/desktop 双运行能力；开发期仍可用 Vite + workspace server 做浏览器验收。

验收：

- [ ] cold start 桌面 smoke。
- [ ] runtime health 可见。
- [ ] 真实 run 可完成。
- [ ] artifact open/follow-up 可用。
- [ ] debug/audit 默认折叠。
- [ ] provider fallback 禁止。
- [ ] 退出后本地子进程清理干净。

## Definition Of Done

- 原 UI 页面保持一致，browser 截图确认没有退化成临时壳。
- `packages/**` 模块资产保留。
- `packages/backend` DeepSeek compatibility proxy 继续通过复杂工具任务验收。
- `src/runtime/**` 默认路径切到 Codex bridge。
- legacy AgentServer-first 文件只有在仍被 UI 引用时短期保留，并有删除任务。
- provider/model/profile/workspace/command id 在 GUI 和 audit 中可见。
- raw JSONL/stdout/stderr/plugin warning 默认折叠，只进 audit/debug。
- 桌面化新增能力必须保持 Web/desktop 双运行，不把 Electron 业务逻辑写进 React/UI。
- `npm run typecheck` 通过。
- `npm run build` 通过。
- `git diff --check` 通过。
- 真实 Codex in-app browser E2E 证明一条用户任务能通过 Runtime Codex 完成。

## Local Worktree Policy

- `packages/backend/.codex-runtime/**` 是开发期 Runtime Codex 本地状态，不进入 git。
- `docs/test-artifacts/**` 默认只作为本地验收证据；需要入库前必须确认体积、隐私和复现价值。
- 不用 `git reset --hard` 或 `git checkout --` 回退用户改动。
- 清理 worktree 时只删除明确生成的缓存、临时 workspace 和构建产物。

## Historical Archive

- `docs_old/` keeps the old design snapshot.
- Git history keeps removed source files and old task logs.
- Do not reintroduce old runtime code unless a task explicitly proves it is reusable and not AgentServer-first debt.
