# SciForge Project Protocol

最后更新：2026-05-19

当前基线：`dev` 已从 `origin/dev@505c46c` 集成已验收的 parallel worker 结果；本文件记录真实状态，不把 blocked/partial evidence 写成 pass。

## Current Truth

SciForge 当前路线是 **UI/packages preserved, Runtime Codex first, GUI-as-TUI-extension, desktop boundary next**。

核心架构：

- Codex CLI / TUI owns agent logic, context, memory, tools, plugins, repair and execution.
- SciForge GUI 是翻译壳、观察层和可复用展示层，不是 agent host。
- GUI -> runtime 只发送 terminal-equivalent text command。
- runtime -> GUI 只返回 normalized events、audit events 或 intent-based `gui.*` results。
- GUI 可以做 deterministic presentation behavior，不能做 provider route、capability ranking、repair policy、prompt assembly 或 completion 判断。
- 多轮对话以 Codex CLI thread/session 为权威状态源；SciForge 只保存 thread id、attempt id、UI metadata 和 evidence refs，继续对话时调用 `codex exec resume <thread_id> <prompt>`。
- `docs/` 是产品/架构/协议/用法真相源；backend runtime migration 真相源是 `packages/backend/CodexRuntimeMigration.md`。
- 短中期桌面化选择 Electron；Tauri 只作为 runtime launcher、app data、secret storage 和 platform service 稳定后的长期优化项。

必须保留：

- `src/ui/**` 现有页面体验和视觉结构；runtime / desktop 迁移期间不允许换成临时 demo shell。
- `packages/**` 中的 contracts、presentation components、skills、workers、observe/actions/verifiers 等可复用资产。
- `docs/` 当前设计方向，`docs_old/` 旧方案快照。

可以清理或重写：

- `src/runtime/**` 旧 AgentServer-first gateway / harness / generation / workspace runtime 链路。
- 迁移期配置字段、脚本名和测试名中的 AgentServer-first 语义。
- 临时缓存、构建产物、无引用实验残留。

## Non-Negotiable Principles

- 成本透明，provider/model/profile/workspace/command id 必须可见、可审计、可测试。
- Runtime Codex 默认使用 DeepSeek / provider proxy：`sciforge-runtime-deepseek` profile，当前集成使用 `bailian/deepseek-v4-flash`。
- Runtime Codex 不得静默继承 Developer Codex profile。
- `allowOpenAiRuntime=false` 时禁止 OpenAI provider fallback。
- raw provider SSE、raw Codex JSONL、stdout、stderr、plugin warning 只进 audit/debug，默认折叠，不进入主回复 DOM 或 foreground waiting summary。
- 用户级 browser 验收必须使用 Codex in-app browser，从默认聊天入口开始；系统浏览器、macOS `open`、外部 Chrome、Playwright 只能作为辅助诊断。
- 多 agent / 多 server 验收前必须做端口预检；并行实例端口按 `parallelProfile` 记录实际端口。
- 恢复上下文、续跑或总结时不得使用模板化“完成”结论替代真实工作；必须重新核对当前 git 状态、目标文件、测试输出、evidence 路径和用户最新意图。
- 验收必须从用户意图反推：每个 claimed success 都要能对应到实际文件改动、命令输出、browser/DOM/截图证据或明确的 blocked manifest；缺任何一项只能标 `partial` / `blocked`，不能写 `passed`。
- 单文件超过约 2000 行时必须拆分或登记拆分任务。
- 真实 browser E2E 是最终验收；terminal smoke 只能补充。

## Required Reading

- [`docs/README.md`](docs/README.md)
- [`docs/Architecture.md`](docs/Architecture.md)
- [`docs/TuiGuiProtocol.md`](docs/TuiGuiProtocol.md)
- [`docs/Usage.md`](docs/Usage.md)
- [`packages/backend/CodexRuntimeMigration.md`](packages/backend/CodexRuntimeMigration.md)
- [`packages/backend/CODEX_COMPATIBILITY.md`](packages/backend/CODEX_COMPATIBILITY.md)

## Parallel Integration Status

集成时间：2026-05-19。集成目标分支：`dev`。

Merged:

- `codex/parallel-p2-gui-protocol` @ `038b33a`：合入完整 `gui.*` tool/resource surface、MCP dispatcher/server、GUI protocol tests 和 in-app browser protocol evidence。证据：`docs/test-artifacts/parallel/p2/p2-gui-protocol-browser-manifest.json`。
- `codex/parallel-p3-runtime-present` @ `14a319f`：合入 Runtime Codex `gui_present` completion event、file-backed GUI intent state fallback、UI fail-closed completion handling 和 live `gui.present` browser evidence。证据：`docs/test-artifacts/parallel/p3/p3-runtime-present-live-manifest.json`。
- `codex/parallel-p4-compat-browser` @ `075ad28`：合入 upstream Codex no-fork gate、OpenAI-looking proxy opt-in guard、DeepSeek response compatibility regression 和 strict browser manifest negative checks。该分支的 live browser release gate 是 `blocked`，未作为 pass 合入。证据：`docs/test-artifacts/parallel/p4/manifest.json`。
- `codex/parallel-p5-native-extensions` @ `50ed5aa`：合入 native extension ownership map、capability text-command boundary、Computer Use ownership note 和 gates。证据：`docs/test-artifacts/parallel/p5/p5-native-extensions-browser-manifest.json`。
- `codex/parallel-p7-launcher-desktop` @ `69b0229`：合入 production runtime launcher、app data layout、platform service、secret storage 和 Electron boundary contracts。状态仍是 partial：没有真实 Electron app/window smoke。证据：`docs/test-artifacts/parallel/p7/p7-launcher-desktop-manifest.json`。
- `codex/parallel-p8-source-hygiene` @ `48a2a03`：合入 long-file split、single-agent final gate drift checks、no-hardcoded-success/no-legacy gate wiring 和 p8 browser evidence。该 browser evidence 仍有 result projection residual risk。证据：`docs/test-artifacts/parallel/p8/browser-acceptance-manifest.json`。
- `codex/parallel-p6-legacy-cleanup` @ `52090ba` partial cherry-pick only：只合入通用 runtime success-envelope / Runtime Codex home sync / stall-bound fixes。未合入该分支的大范围 AgentServer rename/delete。

Blocked / Not Merged:

- `codex/parallel-p6-legacy-cleanup` full branch：blocked by high-risk 400+ file rename/delete scope, conflicts with accepted `p2/p3/p4/p8` work, and incorrect documentation drift that described deleting `RuntimeCodex-first` paths. Needs a rerun from current `dev` with import graph, scoped rename plan, and no reversal of Runtime Codex target semantics.
- `codex/parallel-p4-compat-browser` live release acceptance: blocked by missing live Runtime Codex credential in that worker run; strict mode correctly rejected the blocked manifest as pass.
- `codex/parallel-p7-launcher-desktop` desktop productization: partial only; launcher contracts merged, real Electron shell/cold-start/user run remains future work.
- `codex/parallel-p8-source-hygiene` browser result projection: Runtime Codex generated and previewed workspace artifact, but main result panel still reported missing ConversationProjection. Do not treat as release-ready browser pass.

Needs rerun:

- Strict integrated default-chat Codex in-app browser path proving single-turn visible answer, selected artifact follow-up, and second-turn visible answer on current `dev`.
- Full AgentServer-first big-bang cleanup from current `dev`, with no broad blind rename and no `RuntimeCodex-first` deletion language.
- Desktop cold-start smoke after actual Electron app/package exists.

## Active Tasks

### T1-GUI-PROTOCOL-20260519 complete GUI tool surface

状态：merged / verify on integrated dev

已落地：

- `gui.present/ask_user/notify/set_status/apply_batch/get_context/list/read/search/stat/watch`
- file-backed GUI extension state
- MCP stdio server injection for implemented tools/resources
- UI affordance for terminal-equivalent command text

验收：

- [ ] `node --import tsx --test src/ui/src/app/guiProtocol.test.ts`
- [ ] `node --import tsx --test src/runtime/codex/gui-extension-manifest.test.ts src/runtime/codex/gui-mcp-tools.test.ts`
- [ ] `npm run smoke:harness-research-guide`

### T2-RUNTIME-CODEX-20260519 gui.present completion path

状态：merged / strict browser release gate still needs integrated rerun

已落地：

- Runtime Codex adapter emits explicit `gui_present` completion events.
- UI requires `gui_present` before marking Runtime Codex completion as live-eligible.
- Resume failure emits structured audit with stderr summary, profile, workspace, command id and evidence refs.
- Runtime Codex command uses `workspace-write` sandbox and `approval never`.
- Upstream Codex no-fork gate and OpenAI fallback guard are active.

验收：

- [ ] `node --import tsx --test src/runtime/codex/*.test.ts`
- [ ] `node --import tsx --test src/ui/src/api/sciforgeToolsClient/runtimeEvents.test.ts src/ui/src/api/agentClient/responseNormalization.test.ts src/ui/src/api/sciforgeToolsClient.policy.test.ts`
- [ ] `npm run smoke:runtime-codex-final-acceptance`
- [ ] `npm run smoke:runtime-codex-browser-acceptance`

### T5-NATIVE-EXTENSIONS-20260519 ownership map

状态：merged / residual migration debt tracked

已落地：

- `docs/native-extension-ownership-map.json`
- `docs/NativeExtensionOwnershipMap.md`
- `npm run smoke:native-extension-ownership`
- `smoke:no-src-capability-semantics` baseline to prevent increases

剩余风险：

- `docs/native-extension-src-semantics-baseline.json` 是迁移债务 snapshot，不代表 src capability semantics 已清零。
- dual-instance/self-repair remains migration diagnostics unless converted to Codex-native workflow.

验收：

- [ ] `npm run smoke:native-extension-ownership`
- [ ] `npm run smoke:package-runtime-boundary`
- [ ] `npm run smoke:no-src-capability-semantics`

### T6-LEGACY-CLEANUP-20260519 AgentServer big-bang delete

状态：blocked / needs rerun from current dev

目标：一次性删除 AgentServer-first 默认路径、fallback、legacy smoke 命名和文档入口。最终仓库只保留 Runtime Codex + GUI protocol 路径；必要状态/投影模型迁移为 neutral runtime / GUI protocol 命名。

阻塞原因：

- `codex/parallel-p6-legacy-cleanup` full branch touched hundreds of files and conflicted with accepted p2/p3/p4/p8 work.
- Branch documentation introduced incorrect `RuntimeCodex-first` cleanup language, which reverses the target architecture.
- Current `npm run smoke:no-legacy-paths` passes as a no-increase gate, not as proof that legacy paths are fully removed.

验收：

- [ ] Import graph for `AgentServer|agentserver|agent-server` active tree references.
- [ ] `rg -n "AgentServer|agentserver|agent-server" package.json src packages tests tools docs PROJECT.md` only hits allowed historical archive/evidence/migration notes.
- [ ] `npm run smoke:no-legacy-paths`
- [ ] `npm run typecheck`
- [ ] `npm run test`
- [ ] `npm run build`
- [ ] `npm run verify:single-agent-final`
- [ ] Codex in-app browser default-chat acceptance from integrated branch.

### T7-RUNTIME-LAUNCHER-20260519 production runtime boundary

状态：partial / launcher boundary merged

已落地：

- Production runtime launcher module with ready/health/shutdown.
- AppData layout contract separating config, Runtime Codex home, logs, cache, global state and workspace state.
- Mockable secret storage with fail-closed default and explicit plaintext debug fallback.
- Platform service contract for open external, reveal, terminal command, path quoting, kill process and permission probe.
- Electron shell boundary tests require production renderer to load Vite build artifact instead of dev URL.

Blocked:

- No packaged Electron app/window yet.
- No desktop cold-start smoke.
- OS keychain provider is not wired; only contract/mock exists.

验收：

- [ ] `node --import tsx --test src/runtime/desktop/*.test.ts packages/backend/src/runtime-home.test.ts`
- [ ] `npm run build`

### T9-SOURCE-HYGIENE-20260519 long-file split

状态：merged / residual projection risk

已落地：

- `src/runtime/gateway/direct-context-fast-path.ts` split into shared and selected-report modules.
- `src/runtime/gateway/direct-context-fast-path.test.ts` split into selected-report and helper tests.
- `src/runtime/gateway/generated-task-runner-generation-lifecycle.ts` remains above the split-task threshold and is tracked for continued extraction; current split moved literature recovery into `src/runtime/gateway/generated-task-runner-literature-recovery.ts`.
- `src/ui/src/api/sciforgeToolsClient.ts` converted to a public barrel with implementation in `sciforgeToolsClient/client.ts` and `transportContext.ts`.

剩余风险：

- p8 live run generated and previewed an artifact, but main result panel still reported missing ConversationProjection. This is not a full release acceptance pass.

验收：

- [ ] `npm run smoke:long-file-budget`
- [ ] `node --import tsx --test src/runtime/gateway/direct-context-fast-path.test.ts src/runtime/gateway/direct-context-fast-path-selected-report.test.ts src/runtime/gateway/direct-context-fast-path.helpers.test.ts`
- [ ] `node --import tsx --test src/ui/src/api/sciforgeToolsClient.policy.test.ts`

## Final Acceptance For This Integration

2026-05-19 integration verification result:

- [x] `npm run typecheck` passed.
- [x] targeted tests for touched areas passed after fixing the p8 `sciforgeToolsClient` split regression.
- [x] `npm run test` passed: 1405 tests, 1392 pass, 13 skipped, 0 failed.
- [x] `npm run smoke:no-hardcoded-success` passed.
- [x] `npm run smoke:no-legacy-paths` passed.
- [x] `npm run smoke:runtime-codex-browser-acceptance` ran and wrote evidence, but status is `blocked`: Runtime Codex UI stream path is not aligned with the workspace server route (`missing`). This is not a live browser pass.
- [x] `npm run verify:single-agent-final` passed as a gate and retained the blocked browser evidence instead of converting it to pass.
- [x] `npm run build` passed.
- [x] `git diff --check` passed.

## Definition Of Done

- 原 UI 页面保持一致，browser 截图确认没有退化成临时壳。
- `packages/**` 模块资产保留。
- Runtime Codex 默认路径可用，provider/model/profile/workspace/command id 在 GUI 和 audit 中可见。
- raw JSONL/stdout/stderr/plugin warning 默认折叠，只进 audit/debug。
- 多轮对话通过 Codex 原生 thread/session 和 `codex exec resume` 完成，不通过 GUI transcript 拼接。
- TUI/Runtime Codex 通过 `gui.present` 或等效 intent 驱动主结果区完成态。
- AgentServer-first 默认路径、fallback、smoke 命名和文档入口被删除或只存在于允许的历史归档中。
- 桌面化新增能力保持 Web/desktop 双运行，不把 Electron 业务逻辑写进 React/UI。
- `npm run typecheck` 通过。
- `npm run build` 通过。
- `git diff --check` 通过。
- 真实 Codex in-app browser E2E 证明一条用户任务能通过 Runtime Codex 完成；blocked manifest 不能替代 pass。

## Local Worktree Policy

- 本项目开发基于 `dev` 分支进行；长期只保留 `main` 和 `dev`。
- `packages/backend/.codex-runtime/**` 是开发期 Runtime Codex 本地状态，不进入 git。
- `docs/test-artifacts/**` 默认只作为本地验收证据；需要入库前必须确认体积、隐私和复现价值。
- 不用 `git reset --hard` 或 `git checkout --` 回退用户改动。
- 清理 worktree 时只删除明确生成的缓存、临时 workspace 和构建产物。

## Historical Archive

- `docs_old/` keeps the old design snapshot.
- Git history keeps removed source files and old task logs.
- Do not reintroduce old runtime code unless a task explicitly proves it is reusable and not AgentServer-first debt.
