# SciForge 项目协议

最后更新：2026-05-22

当前目标：把 **反馈收件箱** 做成 SciForge 的用户反馈和修复闭环：用户可以评论任意页面元素，反馈带截图和上下文证据进入收件箱；收件箱可以提交/拉取 GitHub issue；被勾选的问题可以交给为 SciForge 服务的 Codex CLI backend 修复。这里的 Codex CLI repair 指 SciForge 后端以 DeepSeek profile/provider 调用的 Codex CLI 服务，不是当前 Codex App 助手。

本文件是当前执行任务板。已完成的 R-* 真实多轮压测仅保留最终 gate 仍需对账的三条任务；其他旧 P1-P6 run log 和历史方案只保留在历史归档说明、Git history、`docs/archive/` 与 `docs/test-artifacts/` 中，不再作为当前实现入口。

## 当前事实

SciForge 当前路线是 **反馈收件箱优先，Runtime Codex/Codex CLI 后端修复，GUI 作为 TUI extension 和 repair control surface**。

核心架构：

- Codex CLI / TUI 拥有 agent 逻辑、上下文、记忆、工具、插件、修复和执行。
- SciForge GUI 是翻译壳、观察层和可复用展示层，不是 agent host。
- GUI -> runtime 只发送 terminal-equivalent text command。
- runtime -> GUI 只返回 normalized events、audit events 或 intent-based `gui.*` results。
- GUI 可以做 deterministic presentation behavior，不能做 provider route、capability ranking、repair policy、prompt assembly 或 completion 判断。
- 多轮对话以 Codex CLI thread/session 为权威状态源；SciForge 只保存 thread id、attempt id、UI metadata 和 evidence refs，继续对话时调用 Codex 原生 resume，而不是拼 GUI transcript。
- `docs/` 是产品/架构/协议/用法真相源；backend runtime migration 真相源是 `packages/backend/CodexRuntimeMigration.md`。
- 短中期桌面化选择 Electron；Tauri 只作为 runtime launcher、app data、secret storage 和 platform service 稳定后的长期优化项。
- 反馈收件箱是 issue triage、GitHub 同步和 Codex CLI repair 的主入口；SciForge 工作台只提供任意元素评论、当前页面相关反馈提示和跳转入口，避免工作台自己被修时还承担完整修复控制台。
- Codex CLI repair 进度在反馈收件箱中以 terminal mirror 方式呈现：直接透传 Codex CLI 的终端信息，像复刻一份 terminal。该 terminal mirror 可以主显给用户，但不能直接作为 completion 判断、GitHub issue 正文或永久审计内容；写入 issue 或持久审计前必须做 bounded/scrubbed 处理。

## 归档真实多轮压测任务（最终 gate 对账）

这些 R-* 项是已完成的历史多轮压测，不是当前反馈收件箱实现入口；保留在这里是为了让 `smoke:real-task-matrix` 和 `smoke:real-task-protocol-gates` 能继续对账 PROJECT 与 passed manifests。

- [x] R-PROTO-04 GUI presentation catalog discovery：第一轮生成多类型 artifacts；第二轮要求 agent 通过 `gui.list/read/search` 说明 GUI 当前能用哪些 renderer 预览这些 artifacts；第三轮让 TUI 调 `gui.present` 聚焦其中一个 artifact。必须证明 discovery 来自 `/gui/capabilities/presentation.json` 或 `/gui/renderers/<componentId>.json`，不是 React import、AgentServer gateway 或 GUI task ranking。
  - Evidence 2026-05-21: `docs/test-artifacts/real-tasks/R-PROTO-04/manifest.json` is `status: passed`, `releaseEligible: true`, `attemptScope: task-specific-live-attempt`.
- [x] R-PROTO-05 Inline artifact reference right-panel preview：第一轮生成至少两个 markdown/table artifacts，其中一个在 assistant 文本里以裸文件名 inline code 出现；第二轮点击该裸文件名并验证右侧面板预览；第三轮切换到不可解析 inline code 和重复 basename 场景。必须证明只有可解析真实对象会升级为引用，且预览不改变 task truth。
  - Evidence 2026-05-21: `docs/test-artifacts/real-tasks/R-PROTO-05/manifest.json` is `status: passed`, `releaseEligible: true`, `attemptScope: task-specific-live-attempt`.
- [x] R-VERIFY-02 Confidence source and explanation：第一轮生成无 verifier confidence 的普通回答，必须不显示默认百分比；第二轮生成 tool-backed 或 verifier-backed result，要求输出 `confidenceExplanation`；第三轮制造 partial/blocked 或 contradictory evidence，验证 confidence 降低并列出 penalties。必须证明 GUI 不计算 confidence，所有分数来自 TUI/verifier/harness payload。
  - Evidence 2026-05-21: `docs/test-artifacts/real-tasks/R-VERIFY-02/manifest.json` is `status: passed`, `releaseEligible: true`, `attemptScope: task-specific-live-attempt`.


## 不可妥协原则
- 用户级 browser 验收必须使用 Codex in-app browser，从默认聊天入口开始；系统浏览器、macOS `open`、外部 Chrome、Playwright 只能作为辅助诊断。
- 验收必须从用户意图反推：每个 claimed success 都要能对应到实际文件改动、命令输出、browser/DOM/截图证据或明确的 blocked manifest；缺任何一项只能标 `partial` / `blocked`，不能写 `passed`。
- 单文件超过约 2000 行时必须拆分或登记拆分任务。
- 真实 browser E2E 是最终验收；terminal smoke 只能补充。必须实现用户级验收：真正准确解决了用户的问题、优化用户体验
- 已经完成的TODO需要打勾
- 所有修改必须通用、可泛化到任何场景，不能在代码里面硬编码和为当前案例打补丁
- 代码路径保持唯一真相源：发现冗余链路时删除、合并旧链路，避免长期并行实现。


## 必读文档

- [`docs/README.md`](docs/README.md)：当前文档入口，概括 SciForge GUI-as-TUI-extension 的总原则、权威文档列表和核心边界。
- [`docs/Architecture.md`](docs/Architecture.md)：当前总架构真相源，定义 GUI、TUI agent host、native extensions、desktop packaging 和职责归属。
- [`docs/TuiGuiProtocol.md`](docs/TuiGuiProtocol.md)：当前 TUI/GUI 协议真相源，规定 GUI 输入必须变成终端等价文本，TUI 通过只读 GUI resources 和 `gui.*` intent tools 感知/驱动 GUI。
- [`docs/NativeExtensionOwnershipMap.md`](docs/NativeExtensionOwnershipMap.md)：native extension 归属说明，明确 capability discovery、harness/policy、provider route、verifier、skill promotion、Computer Use 和 repair 的 Codex 原生归属。
- [`docs/Usage.md`](docs/Usage.md)：当前可运行代码的启动、配置、运维、workspace 产物和迁移期兼容路径说明，不能把其中的旧 AgentServer 路径当作最终架构。
- [`packages/backend/CodexRuntimeMigration.md`](packages/backend/CodexRuntimeMigration.md)：Runtime Codex 迁移路线，定义 `codex exec --json`、profile 隔离、DeepSeek/provider proxy、native resume 和桌面 productization gate。
- [`packages/backend/CODEX_COMPATIBILITY.md`](packages/backend/CODEX_COMPATIBILITY.md)：Codex CLI 兼容层说明，记录不 fork Codex、运行期隔离、DeepSeek streaming tool-call 修复、事件分层和升级检查清单。
- Runtime Codex/DeepSeek 本地运行依赖 `SCIFORGE_RUNTIME_API_KEY` 和 provider proxy upstream base URL（`SCIFORGE_PROXY_UPSTREAM_BASE_URL` / `upstreamBaseUrl`）；缺任一项时只能记录 blocked/provider-preflight evidence，不能把当前 Codex App 或其他 provider silent fallback 当作 repair backend。

## 当前基线

- 反馈收件箱页面已经存在导航入口和空状态，但当前 active scope 是补齐真实业务闭环，而不是继续扩写旧 R-* 压测板。
- GitHub issue 同步默认使用当前 `origin` repo；repo owner/name、base branch、labels、assignees、token source、dry-run/real-submit 必须可配置。没有配置或 token 不足时必须 fail closed，并保留本地反馈。
- Codex CLI repair 默认不 commit、不 push、不 merge。默认产物是隔离 worktree/branch、repair plan、patch/diff、tests、terminal mirror、bounded audit refs 和风险说明；commit、push、PR、merge 都需要用户单独确认。
- 修复控制主入口在反馈收件箱。工作台可显示“此元素/此页面有反馈”并跳转到收件箱，但不承担批量选择、repair queue、GitHub sync 和 patch approval 的完整流程。
- 评论 evidence 必须同时包含用户评论、元素内容、页面上下文和截图证据。截图需要有原图和标注图，标注图必须框出目标元素并标出评论点位/编号。
- Issue body 必须为人类和 agent 都可读：复现步骤、期望/实际行为、元素证据、截图、环境、workspace/session/run refs、GitHub sync metadata、修复状态和安全限制要结构化呈现。
- 反馈数据、GitHub sync state、repair audit 和截图是产品数据；Codex CLI repair 不得删除或重写它们来伪装修复成功。

## 长文件拆分登记

- `tests/smoke/real-task-evidence-schema.test.ts`：超过 long-file budget；后续拆分为 schema fixtures、positive contract cases、negative contract cases。
- `src/runtime/gateway/generated-task-runner-generation-lifecycle.ts`：超过 long-file budget；后续拆分 lifecycle state machine、event mapping、persistence helpers。
- `src/ui/src/app/chat/sessionTransforms.ts`：超过 long-file budget；后续拆分 session normalization、message transforms、artifact/run projection helpers。

执行规则：

- 当前任务板只保留反馈收件箱闭环任务；旧 R-* 任务不再作为 active TODO。
- 每个任务完成后直接把对应 `- [ ]` 改成 `- [x]`，并在该行或下一行补 evidence 路径、运行日期和最终状态。
- 每个失败验收都要产出一个可执行修复点；修复点进入代码和测试，不在 `PROJECT.md` 复制成另一套任务清单。
- 除非新的失败任务证明必要，不重开 worker branch 考古、大范围盲 rename/delete、seed/demo 成功声明、非 Codex browser acceptance 或 prompt-specific hardcode。

## 反馈收件箱任务板

所有用户级验收默认使用 Codex in-app browser 打开 `http://127.0.0.1:5173/`。terminal、unit test 和 smoke test 只能补充，不能替代用户级 browser evidence。

通过条件：

- 从真实 UI 捕获至少一个元素评论，并能在反馈收件箱看到同一条反馈。
- 至少一次 GitHub submit 和一次 GitHub pull/sync 路径被验证；无凭据时必须有 blocked evidence 和本地 fallback。
- 至少一次勾选 issue 后调用 DeepSeek Codex CLI backend repair，并在反馈收件箱看到 terminal mirror 进度。
- Repair 默认只生成 patch/diff/tests/audit，不自动 commit/push/merge；用户确认路径必须可见。
- 修复必须泛化到 issue type、元素类型、repo 配置和用户输入变化，不能硬编码当前案例。

### FB-01 任意元素评论与证据采集

- [x] 支持用户对任意可见页面元素发起评论；评论入口不依赖特定组件名或硬编码 selector。
- [x] 每条反馈必须记录：URL/route、viewport、scroll、devicePixelRatio、target role/label/text snippet、stable selector、DOM path、bounding box、评论正文、severity、期望行为、实际行为、session/run/artifact refs。
- [x] 捕获原始截图和标注截图；标注截图必须框出目标元素并显示评论点位/编号。截图生成失败时反馈仍可保存，但必须标为 `partial evidence` 并提示用户。
- [x] 证据写入本地 feedback bundle，且截图、selector、文本片段和 refs 都要做 secret/path/provider-body scrub。
- [x] 验收：从工作台任选一个元素评论，在反馈收件箱看到反馈、标注截图、目标元素摘要和证据完整性状态。
  - Evidence 2026-05-21: Codex in-app browser `http://127.0.0.1:5173/` captured `feedback-mpfloo3f-tsg98f`; local bundle at `workspace/parallel/p1/.sciforge/feedback/feedback-mpfloo3f-tsg98f`; screenshot artifact `docs/test-artifacts/feedback-inbox-closure/feedback-inbox-browser-2026-05-21.png`; `npm run typecheck`; focused feedback tests.

### FB-02 反馈收件箱本地状态机

- [x] 收件箱展示 `comment`、`request`、`open`、`GitHub open`、`triaged`、`fixed`、`blocked` 等状态，并支持筛选、批量勾选、标记、删除/恢复。
- [x] 本地反馈、GitHub issue、repair request 三类对象必须有唯一 ID 和可追溯 refs，不能只靠标题或截图文件名关联。
- [x] 生成 request bundle 时必须包含 selected feedback、证据 refs、期望结果、风险提示和允许/禁止操作范围。
- [x] 删除选中只能软删除本地条目或取消 selection，不得删除 GitHub issue、repair audit、workspace patch 或截图原始证据。
  - Evidence 2026-05-21: `feedbackWorkspace.test.ts`, `FeedbackRepairAuditPanel.test.tsx`, focused feedback test suite; browser inbox showed status filters, bulk controls, soft-delete/restore controls, IDs and refs.
- [x] 验收：创建多条反馈，筛选/勾选/标记/恢复后计数和详情一致，刷新 browser 后状态仍可恢复。
  - Evidence 2026-05-21: Codex in-app browser used two persisted feedback records; `feedback-mpflkt4d-kuc403` moved `open -> triaged -> deleted -> restored triaged`; after browser reload, filters showed `GitHub open (1)`, `triaged (1)`, `deleted (0)` with details intact; screenshot `docs/test-artifacts/feedback-inbox-closure/feedback-inbox-state-machine-2026-05-21.png`.

### FB-03 GitHub Issue 提交与拉取同步

- [x] 默认同步当前 `origin` repo；repo、labels、assignees、milestone、token source、dry-run/real-submit 必须在配置中可覆盖。
- [x] 提交 GitHub issue 时 issue body 必须格式化包含：summary、repro steps、expected/actual、target element evidence、annotated screenshot、raw screenshot link/ref、environment、local feedback id、session/run refs、repair policy。
- [x] 拉取 GitHub open issues 时必须去重并保留 remote number/url/state/labels/updatedAt；本地修改和远端状态冲突时显示 sync conflict，不覆盖用户本地批注。
- [x] GitHub token 缺失、权限不足、rate limit、repo 不存在、网络失败时必须 fail closed，保留本地 pending 状态和可重试诊断。
  - Evidence 2026-05-21: browser dry-run generated GitHub payload without API call; a real browser submit exposed GitHub 422 body-length, fixed by omitting all screenshot data URLs from issue body/bundle JSON; `githubFeedback.test.ts`, `workspaceClient.feedback.test.ts`, `npm run smoke:workspace-instance-feedback-api`.
- [x] 验收：提交一条本地反馈为 GitHub issue，再从 GitHub 拉取同一 issue，不重复创建，状态从本地 pending 正确变成 GitHub open。
  - Evidence 2026-05-21: Codex in-app browser real-submit created `https://github.com/AGI4Sci/SciForge/issues/3`; subsequent `从 GitHub 同步` imported 1 open issue with no duplicate local feedback, `feedback-mpfloo3f-tsg98f` persisted as `github-open`, conflict `none`; screenshot `docs/test-artifacts/feedback-inbox-closure/feedback-inbox-github-roundtrip-2026-05-21.png`; issue body has marker and screenshot refs, no inline `data:image/`.
  - Evidence 2026-05-22: real GitHub submit is still live, not dry-run. `feedback-mpflkt4d-kuc403` created `https://github.com/AGI4Sci/SciForge/issues/4`; direct issue API and retry pull-sync confirmed it open, local state persisted `githubIssueNumber: 4` / `githubSyncStatus: github-open` / `status: github-open`; artifact `docs/test-artifacts/feedback-inbox-closure/real-github-issue-create-2026-05-22.json`. `githubFeedback.test.ts` now covers triaged feedback transitioning to `github-open` after real issue creation.
  - Evidence 2026-05-22: user explicitly confirmed real issue creation again; `feedback-real-issue-mpfw8vrp` created real Issue `https://github.com/AGI4Sci/SciForge/issues/5`, direct GitHub API verification confirmed it `open`, local state persisted `status: github-open` / `githubSyncStatus: github-open` / `githubIssueNumber: 5`, issue body retained the SciForge feedback marker and omitted inline `data:image/`; artifact `docs/test-artifacts/feedback-inbox-closure/real-github-issue-create-2026-05-22-confirmed.json`.

### FB-04 DeepSeek Codex CLI Repair Backend

- [x] Codex CLI repair 必须走 SciForge 后端服务，以 DeepSeek/runtime profile 调用 Codex CLI；不能把当前 Codex App 助手当作 repair executor。
- [x] 用户在反馈收件箱勾选一个或多个 issue 后，可生成 repair request，并在 readiness 通过时从后端启动 Codex CLI repair；工作台只提供相关 issue 跳转，不作为完整 repair queue。
- [x] repair request 必须包含 issue refs、feedback evidence、repo config、base branch、允许写入路径、禁止写入路径、需要运行的 tests、用户确认策略。
- [x] 进度展示采用 terminal mirror：后端启动后把 Codex CLI 的终端信息按时间顺序透传到反馈收件箱，支持复制、折叠、停止和导出；terminal mirror 不能被 GUI 解析成 completion verdict。
  - Evidence 2026-05-22: implementation/smoke evidence only. Backend exposes terminal-mirror tail and safe stop endpoints; Runtime Codex repair registers the active turn and cancels only that turn on stop; inbox polls terminal entries, supports copy/fold/stop/export repair bundle, and keeps verdicts tied to result/test/audit data rather than terminal text. Completed results no longer present an enabled stop action. Verified with `FeedbackRepairAuditPanel.test.tsx`, `workspaceClient.feedback.test.ts`, `npm run smoke:workspace-instance-feedback-api`, `npm run smoke:repair-handoff-runner`, `npm run typecheck`; Codex in-app browser showed the feedback inbox, blocked repair readiness panel, 2 repair audit panels, terminal mirror controls, and safe-mode status at `http://127.0.0.1:5173/`.
- [x] Codex CLI repair 输出路径写 bounded audit bundle；给用户看的 terminal mirror 可以实时直出，进入 issue/comment/audit summary 前必须 scrub secret、token、raw provider body 和绝对敏感路径。
  - Evidence 2026-05-22: `npm run smoke:repair-handoff-runner`, `npm run smoke:runtime-provider-preflight`, `npm run smoke:runtime-codex-truth-source`; terminal mirror tests include secret-like tokens/provider body/user-path redaction, target run registration fails closed before executor dispatch, and preflight manifest is served through the workspace writer without exposing config-secret fallback paths. This verifies routing, audit, scrub/preflight classification, and truth-source policy, not a live DeepSeek repair.
- [x] 验收：选择一个 issue 启动 repair，用户能在反馈收件箱看到近似 terminal 的实时输出、退出码、产物 refs 和失败/成功边界。
  - Blocked 2026-05-22: current local config has no enabled repair peer instance, and Runtime Codex provider preflight is diagnostic-only because `SCIFORGE_RUNTIME_API_KEY` and `SCIFORGE_PROXY_UPSTREAM_BASE_URL` are missing from the service environment; see `docs/test-artifacts/runtime-provider-preflight/manifest.json`. No-peer handoff and provider-preflight failure now fail closed before executor dispatch and persist durable `needs-follow-up` repair result audit instead of only showing transient UI hints. Strict validate-only command `SCIFORGE_BROWSER_ACCEPTANCE_VALIDATE_ONLY=1 SCIFORGE_REQUIRE_LIVE_BROWSER_ACCEPTANCE=1 npm run smoke:runtime-codex-browser-acceptance` exits blocked with `STRICT_BROWSER_ACCEPTANCE_EXIT=1` for this exact boundary.
  - Evidence 2026-05-22: workspace writer now exposes `runtime-codex-browser-acceptance-manifest`; the inbox readiness panel requires live repair peer `/health` plus instance manifest capabilities, provider preflight, and strict in-app browser acceptance evidence before displaying ready. A config-only peer is partial/checking, unhealthy or mismatched peers are blocked before executor dispatch, and the durable blocked audit records provider/browser/peer readiness metadata. Verified with focused feedback tests, `npm run smoke:workspace-instance-feedback-api`, `npm run smoke:repair-handoff-runner`, `npm run smoke:runtime-provider-preflight`, `npm run typecheck`, `git diff --check`, and strict browser validate-only exit `1`.
  - Evidence 2026-05-22: repair handoff now seeds the source feedback comment into a fresh target peer before target run registration, preserves target writer/app URLs on repair results, and differentiates execution readiness from stale release/browser acceptance. Browser acceptance readiness rejects old `passed` manifests by `observedAt`/evidence freshness. Verified with 72 focused feedback tests, `npm run smoke:workspace-instance-feedback-api`, `npm run smoke:repair-handoff-runner`, `npm run smoke:runtime-provider-preflight`, `npm run typecheck`, `git diff --check`, and strict browser validate-only exit `1`.
  - Evidence 2026-05-22: peer handoff contract no longer self-blocks on p1/p2 managed workspace siblings before target seeding: the runner boundary uses the executor instance workspace instead of the repo root, runner-owned `.sciforge/repair-results` and `.sciforge/repair-worktrees` are not treated as protected user paths, `.sciforge/feedback/**` is included in protected feedback hashing, terminal mirror polling resolves against the actual run/result target before dropdown defaults, and browser freshness requires at least one evidence file. Verified with focused feedback tests, `npm run smoke:workspace-instance-feedback-api`, `npm run smoke:repair-handoff-runner`, `npm run smoke:runtime-provider-preflight`, `npm run typecheck`, `git diff --check`, and strict browser validate-only exit `1`.
  - Evidence 2026-05-22: the readiness panel now probes the active workspace writer `/health` and surfaces stale capabilities before repair acceptance. Current live `6173` writer is an old process that lacks `runtime-codex-browser-acceptance-manifest`, so the UI can tell the user to restart the workspace writer/dev server instead of hiding the failure behind a missing manifest. Verified with `FeedbackInboxPage.test.ts`, 73 focused feedback tests, `npm run typecheck`, and `git diff --check`.
  - Evidence 2026-05-22: dual-instance dev no longer leaves the inbox with an empty repair-peer config when the launcher has already supplied a counterpart. The workspace writer now derives one default `repair` peer from `SCIFORGE_COUNTERPART_JSON` when `peerInstances` is absent, while an explicit `peerInstances: []` still disables peers. Verified with `npm run smoke:dual-instance`, `npm run smoke:dual-worktree-instance`, and `npm run typecheck`. This narrows the remaining live blocker to starting/syncing current worktrees plus provider env, not hidden peer config.
  - Evidence 2026-05-22: `tools/dev.ts` now refuses to silently reuse a workspace writer that is `/health`-ok but missing repair/browser readiness capabilities, including `runtime-codex-browser-acceptance-manifest`; it reports the missing capabilities and asks for a writer restart instead of claiming "already running". Verified with `node --import tsx --test tools/dev-health.test.ts`, `npm run smoke:dual-instance`, `npm run smoke:dual-worktree-instance`, `npm run smoke:workspace-instance-feedback-api`, `npm run smoke:runtime-provider-preflight`, `npm run typecheck`, and strict validate-only browser acceptance exit `1`.
  - Evidence 2026-05-22: current-code live peer handoff now works up to the provider boundary. Temporary current-code writers `p2`/`p1-current` on `6174`/`6175` exposed all repair/browser capabilities and derived `p2` as an enabled repair peer from `SCIFORGE_COUNTERPART_JSON`. Handoff for `feedback-mpflkt4d-kuc403` created isolated worktree `.sciforge/repair-worktrees/feedback-repair-live-peer-blocked-nogit-1779389918460`, terminal mirror `.sciforge/repair-results/feedback-repair-live-peer-blocked-nogit-1779389918460/terminal-mirror.ndjson`, patch/audit refs, and a durable `needs-follow-up` result in `workspace/parallel/p2/.sciforge/workspace-state.json`; terminal mirror shows `Missing SCIFORGE_RUNTIME_API_KEY` fail-closed, diff-check passed, commit audit passed with no executor commit, and `changedProtectedPaths: []`.
  - Evidence 2026-05-22: Runtime Codex repair now performs a pre-dispatch provider gate before `git worktree add`, target repair-run registration, or executor dispatch when using the real adapter. Missing service `SCIFORGE_RUNTIME_API_KEY` returns a durable `needs-follow-up` result with `pre-dispatch-provider-preflight.json` and terminal mirror evidence, leaves `refs.worktreePath`/`refs.branch` empty, records `noExecutorDispatch`, `noIsolatedWorktreeCreated`, and `noTargetRepairRunRegistered`, and does not count config/adapter secret fallback as service env. Non-secret upstream base URL may still come from service env or ignored config. Repair-result handoff now carries the source `issueBundle`, so a fresh target peer can seed the feedback comment before saving a blocked result without creating a target repair run. If target writer result persistence fails, the runner keeps local `result.json`/terminal evidence and records `targetResultPersistence: failed` instead of dropping to a transient 400. Terminal mirror API smoke now covers cursor/limit, missing-file empty tails, and path-escape 400s. Verified with `npm run smoke:repair-handoff-runner`, `npm run smoke:workspace-instance-feedback-api`, `npm run smoke:runtime-provider-preflight`, `npm run smoke:runtime-codex-truth-source`, `npm run typecheck`, `git diff --check`, and strict browser validate-only exit `1`.
  - Evidence 2026-05-22: terminal mirror stop endpoint now has smoke coverage for non-active repair runs: POST `/api/sciforge/repair-handoff/stop` with a valid `terminalMirrorRef` records a fail-closed mirror line, GET `/terminal-mirror` returns the appended stop evidence, and stop-path escape still returns 400. Verified with `npm run smoke:workspace-instance-feedback-api`.
  - Evidence 2026-05-22: live DeepSeek Runtime Codex repair completed from current-code p1/p2 services. `feedback-live-runtime-repair-mpfwpa6z` produced `verdict: fixed`, patch ref `.sciforge/repair-results/feedback-repair-live-runtime-mpfwpa6z/repair.patch`, terminal mirror `.sciforge/repair-results/feedback-repair-live-runtime-mpfwpa6z/terminal-mirror.ndjson`, audit bundle `.sciforge/repair-results/feedback-repair-live-runtime-mpfwpa6z/dirty-worktree-protection.json`, and passed marker test output under the isolated repair worktree. Codex in-app browser at `http://127.0.0.1:5174/` showed the fixed repair audit, terminal mirror lines (`done status=done exit=0`, marker test passed, no executor commit, repair verdict fixed), patch/test/audit refs, and success/failure boundaries. Browser evidence: `docs/test-artifacts/feedback-inbox-closure/live-runtime-codex-repair-browser-recheck-2026-05-22.png` and `.dom.txt`. The live UI uncovered and verified a bounded fix allowing target workspace writers to read runner-owned repo-level `.sciforge/repair-results/**/terminal-mirror.ndjson` while path escape remains blocked; verified with `npm run smoke:workspace-instance-feedback-api` and `npm run typecheck`.

### FB-05 Repair 护栏与用户确认

- [x] 每次 repair 在隔离 worktree/branch 中运行，开始前记录 base commit、dirty worktree 状态、protected files digest 和 feedback data digest。
- [x] Codex CLI 先生成 repair plan，再允许 patch；plan 必须列出 root cause hypothesis、write scope、protected scope、commands/tests、rollback-free recovery strategy 和需要用户确认的风险。
- [x] 默认不 commit、不 push、不 PR、不 merge。用户点确认后才允许生成 commit；push/PR 需要第二次单独确认；merge 永远不能自动执行。
  - Evidence 2026-05-22: repair result action endpoint creates a local commit only inside `.sciforge/repair-worktrees/**` after explicit commit confirmation, `verdict: fixed`, passed dirty-worktree guard metadata, repair plan presence, no executor-created commit, and passing recorded tests. Non-fixed results, guard-blocked results, and `commit: disabled` remain blocked even if a caller passes confirmation; push/PR second-confirmation paths record no-op blocked audit with no remote mutation; merge fails closed. Confirmation records are preserved in `feedbackRepairActions`, rendered as an Action audit in the inbox, and exported in the repair bundle. Verified with `npm run smoke:workspace-instance-feedback-api`, `workspaceClient.feedback.test.ts`, `FeedbackRepairAuditPanel.test.tsx`, `sessionStore.test.ts`, `npm run typecheck`.
- [x] 禁止 destructive repair：`git reset --hard`、无边界 `git checkout/restore`、删除反馈数据、改写 ignored secret config、修改 provider credentials、清空 audit、伪造 tests 或 output artifacts。
- [x] 如果 repair 目标包含反馈收件箱自身或 repair backend，控制面进入 safe mode：已有 terminal mirror 保持只读，新的 patch apply/commit/push 需要额外确认或外部控制面。
  - Evidence 2026-05-22: structured safe-mode scopes now cover `FeedbackInboxPage.tsx`, `src/ui/src/feedback/**`, `workspaceClient.ts`, `workspace-server.ts`, and `repair-handoff-runner.ts`; repair result/action metadata records `safeMode`, local commit requires both `confirmed` and `safeModeConfirmed` when those paths are touched, push/PR remain no-op/blocked, merge fails closed. Verified with `node --import tsx --test src/ui/src/feedback/FeedbackRepairAuditPanel.test.tsx src/ui/src/api/workspaceClient.feedback.test.ts`, `npm run smoke:workspace-instance-feedback-api`, `npm run smoke:repair-handoff-runner`, `npm run typecheck`, and Codex in-app browser render check at `http://127.0.0.1:5173/` (`docs/test-artifacts/feedback-inbox-closure/feedback-inbox-safe-mode-2026-05-22.png`).
- [x] 验收：制造一个可修复问题，确认 Codex CLI 只产生 patch/diff/tests/audit；未点确认时没有 commit，点确认后只创建本地 commit，push/PR 仍等待单独确认。
  - Partial 2026-05-22: smoke verifies the confirmation gates with fixture repair results and isolated temp worktrees, including blocked non-fixed results, blocked dirty-worktree guard failures, disabled commit policy, safe-mode extra confirmation, and push/PR no-op audit. Full acceptance remains blocked until a configured DeepSeek repair peer produces a real patch/diff/tests/audit from a selected issue.
  - Evidence 2026-05-22: commit confirmation routing now uses the repair result target writer/workspace instead of assuming the source inbox writer, so peer repairs can commit only inside the target `.sciforge/repair-worktrees/**` after confirmation. Smoke coverage verifies target instance writer/app URL preservation and seeded target issue state; full E2E still waits on live DeepSeek output.
  - Evidence 2026-05-22: browser recheck is now a first-class repair action with `sideEffect: none`; it updates the repair result `humanVerification`, merges evidence refs, preserves `browserVerification` through workspace compaction, renders an explicit `browserRecheck` audit row, never records `passed` without strict fresh in-app browser acceptance evidence plus refs, and failed/rejected browser verification blocks even a confirmed local commit. Verified with focused feedback tests and `npm run smoke:workspace-instance-feedback-api`.
  - Evidence 2026-05-22: repair result persistence now closes the corresponding repair run status instead of leaving completed/blocked handoffs permanently `running`; `fixed` results mark the run `fixed`, `needs-follow-up` / `partially-fixed` mark it `needs-human-verification`, and failed results mark it `blocked`. Verified with `npm run smoke:workspace-instance-feedback-api`, `node --import tsx --test tools/dev-health.test.ts`, and `npm run typecheck`.
  - Evidence 2026-05-22: repair runner guard no longer treats its own git worktree registration metadata as user-owned protected `.git` drift, while `.git` remains a forbidden executor write scope. Verified with `npm run smoke:repair-handoff-runner`; live handoff `feedback-repair-live-peer-blocked-nogit-1779389918460` persisted `changedProtectedPaths: []` and closed the run as `needs-human-verification` with no executor commit.
  - Evidence 2026-05-22: repair audit presentation now gates full GitHub-synced success copy on durable evidence completeness across plan, terminal mirror, patch/diff, test output refs, audit bundle, and guard digests. A `fixed` result with only a superficial passed test stays evidence-partial, exports missing refs, and does not render “已同步 GitHub” as a completed success. Verified with `FeedbackRepairAuditPanel.test.tsx`, `FeedbackInboxPage.test.ts`, and `npm run typecheck`.
  - Evidence 2026-05-22: live Runtime Codex repair for `feedback-live-runtime-repair-mpfwpa6z` changed only `tests/fixtures/runtime-codex-live-repair-marker-feedback-repair-live-runtime-mpfwpa6z.txt` inside isolated worktree `.sciforge/repair-worktrees/feedback-repair-live-runtime-mpfwpa6z`; dirty guard passed with no protected/forbidden/outside-allowed drift and executor commit audit recorded `created: false`. Before confirmation, commit action returned `requires-user-confirmation` and worktree HEAD stayed `fec71e82c9934d45ea6a80b5350973aa33a85d01`. Browser recheck then recorded `humanVerification.status: passed`. Explicit commit confirmation created only local isolated-worktree commit `72b798e27e78c75b3df477e0b150f9f76ee8d135`; push without second confirmation returned `requires-second-confirmation`, PR with second confirmation recorded no remote mutation, and merge returned HTTP 400. The live gate uncovered and verified a bounded fix allowing target workspace writers to commit runner-owned repo-level `.sciforge/repair-worktrees/**` while path boundaries remain constrained; verified with `npm run smoke:workspace-instance-feedback-api` and `npm run typecheck`.

### FB-06 端到端真实验收

- [x] 从 Codex in-app browser 对工作台任意元素评论，截图标注和证据进入反馈收件箱。
  - Evidence 2026-05-21: `feedback-mpfloo3f-tsg98f`, `docs/test-artifacts/feedback-inbox-closure/feedback-inbox-browser-2026-05-21.png`, local bundle under `workspace/parallel/p1/.sciforge/feedback/feedback-mpfloo3f-tsg98f`.
- [x] 在反馈收件箱提交 GitHub issue，再从 GitHub 拉取同步，验证去重、状态和 issue body。
  - Evidence 2026-05-22: GitHub Issue `AGI4Sci/SciForge#3` is a real open issue confirmed via GitHub API; synced issue state lives under `workspace/parallel/p1/.sciforge/workspace-state.json`, local feedback count stayed stable during the #3 roundtrip, `feedback-mpfloo3f-tsg98f` has `githubIssueNumber: 3` and `githubSyncStatus: github-open`; issue body has SciForge feedback markers and no inline `data:image/`.
  - Evidence 2026-05-22: User explicitly allowed real issue creation again; `feedback-mpflkt4d-kuc403` created real Issue `AGI4Sci/SciForge#4`, direct issue API and retry pull-sync confirmed it open, and workspace state now has `status: github-open` plus `githubSyncStatus: github-open`.
  - Evidence 2026-05-22: User explicitly confirmed real issue creation a third time; `feedback-real-issue-mpfw8vrp` created real Issue `AGI4Sci/SciForge#5`, direct issue API confirmed it open, and workspace state plus feedback bundle now carry `githubIssueNumber: 5`, `githubSyncStatus: github-open`, screenshot refs, and a no-inline-screenshot issue body.
- [x] 勾选 issue 启动 DeepSeek Codex CLI repair，观察 terminal mirror，导出 patch/diff/tests/audit。
  - Blocked 2026-05-22: implementation now exposes terminal mirror polling/stop/export controls and a visible DeepSeek repair readiness panel, but local acceptance cannot run a real DeepSeek repair because `peerInstances` is empty and provider env lacks `SCIFORGE_RUNTIME_API_KEY` plus `SCIFORGE_PROXY_UPSTREAM_BASE_URL`; `npm run smoke:runtime-provider-preflight` wrote diagnostic-only blocked evidence and the strict browser acceptance validate-only gate exits blocked.
  - Evidence 2026-05-22: readiness is no longer config-only. The inbox probes each repair peer writer health and instance manifest, rejects missing workspace/capability mismatches, and loads the browser acceptance manifest served by the workspace writer. Current state still blocks correctly because no real repair peer and service env are configured.
  - Evidence 2026-05-22: target peer handoff no longer assumes the selected feedback already exists in the target workspace; the source issue bundle seeds the target writer before run/result registration. This keeps the remaining blocker narrowed to real peer/env availability, not source/target state drift.
  - Evidence 2026-05-22: reran the current blocked gates after launcher/readiness fixes. `npm run smoke:runtime-provider-preflight` still writes `current-env=config-secret-source`, and `SCIFORGE_BROWSER_ACCEPTANCE_VALIDATE_ONLY=1 SCIFORGE_REQUIRE_LIVE_BROWSER_ACCEPTANCE=1 npm run smoke:runtime-codex-browser-acceptance` exits `1` because `SCIFORGE_RUNTIME_API_KEY` is absent from the service environment and config-file secrets are only local proxy debug fallback. This confirms the remaining blocker is provider/service env, not a stale-writer false positive.
  - Evidence 2026-05-22: selected-issue handoff was exercised against a live current-code repair peer, not only fixture smoke. Temporary current-code writers `p1-current`/`p2` on `6175`/`6174` loaded `feedback-mpflkt4d-kuc403`, seeded it into the target workspace, registered `feedback-repair-live-peer-blocked-nogit-1779389918460`, wrote terminal mirror and audit refs, and returned durable `needs-follow-up` because Runtime Codex failed closed on missing `SCIFORGE_RUNTIME_API_KEY`. This proves terminal mirror/result/audit export up to the provider boundary; it still does not satisfy the full DeepSeek repair patch/diff/tests/browser recheck E2E.
  - Evidence 2026-05-22: the provider boundary is now cleaner than the live blocked handoff above. A real Runtime Codex adapter with missing service key is blocked before isolated worktree creation and before target repair-run registration, while still persisting bounded audit/result evidence; fake adapter smoke continues to cover the successful Runtime Codex contract path. Verified with `npm run smoke:repair-handoff-runner`, `npm run smoke:workspace-instance-feedback-api`, `npm run smoke:runtime-provider-preflight`, `npm run typecheck`, `git diff --check`, and strict validate-only browser acceptance exit `1`.
  - Evidence 2026-05-22: with service env populated from ignored p1/p2 config and proxy `http://127.0.0.1:3891/v1`, a real Runtime Codex adapter invoked model `bailian/deepseek-v4-flash` through profile `sciforge-runtime-deepseek` and completed `feedback-repair-live-runtime-mpfwpa6z`. The exported evidence bundle includes terminal mirror, repair request plan, patch, dirty-worktree audit, request bundle, and passed marker test output. Codex in-app browser on p2 displayed the live terminal mirror tail and refs after target writer reload; browser evidence lives at `docs/test-artifacts/feedback-inbox-closure/live-runtime-codex-repair-browser-recheck-2026-05-22.png` and `.dom.txt`.
- [x] 用户确认后才允许 commit；push/PR 需要另一个确认动作。未确认时 `git status` 不能出现自动提交或远端变化。
  - Partial 2026-05-22: smoke verifies no commit before confirmation, local isolated-worktree commit after confirmation, push/PR no-op/blocked with separate confirmation, safe-mode extra confirmation, and `commit: disabled` fail-closed. Full E2E remains blocked until real DeepSeek repair output exists.
  - Evidence 2026-05-22: live confirmation gate completed after real Runtime Codex output existed. Unconfirmed commit returned `requires-user-confirmation` and no HEAD movement; confirmed commit created local isolated-worktree commit `72b798e27e78c75b3df477e0b150f9f76ee8d135`. Push without second confirmation returned `requires-second-confirmation`; PR with second confirmation remained external-only with no remote mutation; merge remained policy-blocked.
- [x] 修复后重新打开浏览器验证原问题解决，且反馈数据、GitHub sync state、terminal mirror 和 repair audit 未被破坏。
  - Partial 2026-05-22: product path now exists to record post-repair Codex in-app browser verification as a durable `browser-recheck` action, including evidence refs and repair result `humanVerification`; failed/rejected browser rechecks block commit, and pending rechecks stay visible. Full E2E remains blocked until a real DeepSeek repair produces output to re-open and verify in the browser.
  - Evidence 2026-05-22: Codex in-app browser reopened p2 at `http://127.0.0.1:5174/`, selected Feedback Inbox, and verified the fixed repair result, terminal mirror lines, patch/test/audit refs, browser evidence refs, local commit action audit, push/PR no-op audit, and preserved feedback screenshot bundle. Durable browser recheck action recorded `status: passed` with evidence `docs/test-artifacts/feedback-inbox-closure/live-runtime-codex-repair-browser-recheck-2026-05-22.png` and `.dom.txt`; post-commit browser evidence was saved as `docs/test-artifacts/feedback-inbox-closure/live-runtime-codex-repair-confirmed-commit-browser-2026-05-22.png` and `.dom.txt`.

## 压测后的最低验证

- 文档或任务板修改：`git diff --check`。
- 代码修改：`npm run typecheck`、touched areas 的 targeted tests、`git diff --check`。
- 反馈收件箱、GitHub sync 或 repair backend 修改：再跑匹配 touched area 的 targeted tests，并用 Codex in-app browser 完成至少一条 FB-* 用户级验收。
- Runtime/Codex CLI/provider 修改：再跑 `npm run smoke:runtime-provider-preflight`，并证明 DeepSeek Codex CLI backend 被调用，不能 silent fallback 到当前 Codex App 或 OpenAI runtime。
- Release 或大范围迁移：再跑 `npm run smoke:no-hardcoded-success`、`npm run smoke:no-legacy-paths`、`npm run smoke:runtime-codex-truth-source`、`npm run smoke:runtime-provider-preflight`、`npm run verify:single-agent-final`；真正 release 必须跑 `npm run verify:single-agent-release`，必要时 `npm run test` 和 `npm run build`。

## 本地 worktree 策略

- 本项目开发基于 `dev` 分支进行；长期只保留 `main` 和 `dev`。
- `config.local.json`、`.sciforge/**` 和 `packages/backend/.codex-runtime/**` 是本机状态，不进入 git。
- `docs/test-artifacts/**` 默认只作为本地验收证据；需要入库前必须确认体积、隐私和复现价值。
- 不用 `git reset --hard` 或 `git checkout --` 回退用户改动。
- 清理 worktree 时只删除明确生成的缓存、临时 workspace 和构建产物。

## 历史归档说明

- 2026-05-20 的 R-* 真实多轮压测大任务板已完成并从 active board 移出；证据仍保留在 `docs/test-artifacts/real-tasks/**`、相关 manifests、Git history 和旧任务板提交中。
- `docs/archive/` 保存旧 active task boards 和 detailed run histories。
- `docs_old/` 保存迁移前设计快照。
- Git history 保存已删除 source files、旧 task logs 和已完成任务板全文。
- 除非任务明确证明旧 runtime code 可复用且不是 AgentServer-first debt，否则不要重新引入。
