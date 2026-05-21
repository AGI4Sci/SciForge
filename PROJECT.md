# SciForge 项目协议

最后更新：2026-05-21

当前目标：把 **反馈收件箱** 做成 SciForge 的用户反馈和修复闭环：用户可以评论任意页面元素，反馈带截图和上下文证据进入收件箱；收件箱可以提交/拉取 GitHub issue；被勾选的问题可以交给为 SciForge 服务的 Codex CLI backend 修复。这里的 Codex CLI repair 指 SciForge 后端以 DeepSeek profile/provider 调用的 Codex CLI 服务，不是当前 Codex App 助手。

本文件是当前执行任务板。已完成的 R-* 真实多轮压测、旧 P1-P6 run log 和历史方案只保留在历史归档说明、Git history、`docs/archive/` 与 `docs/test-artifacts/` 中，不再作为当前实现入口。

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

## 当前基线

- 反馈收件箱页面已经存在导航入口和空状态，但当前 active scope 是补齐真实业务闭环，而不是继续扩写旧 R-* 压测板。
- GitHub issue 同步默认使用当前 `origin` repo；repo owner/name、base branch、labels、assignees、token source、dry-run/real-submit 必须可配置。没有配置或 token 不足时必须 fail closed，并保留本地反馈。
- Codex CLI repair 默认不 commit、不 push、不 merge。默认产物是隔离 worktree/branch、repair plan、patch/diff、tests、terminal mirror、bounded audit refs 和风险说明；commit、push、PR、merge 都需要用户单独确认。
- 修复控制主入口在反馈收件箱。工作台可显示“此元素/此页面有反馈”并跳转到收件箱，但不承担批量选择、repair queue、GitHub sync 和 patch approval 的完整流程。
- 评论 evidence 必须同时包含用户评论、元素内容、页面上下文和截图证据。截图需要有原图和标注图，标注图必须框出目标元素并标出评论点位/编号。
- Issue body 必须为人类和 agent 都可读：复现步骤、期望/实际行为、元素证据、截图、环境、workspace/session/run refs、GitHub sync metadata、修复状态和安全限制要结构化呈现。
- 反馈数据、GitHub sync state、repair audit 和截图是产品数据；Codex CLI repair 不得删除或重写它们来伪装修复成功。

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

- [ ] 支持用户对任意可见页面元素发起评论；评论入口不依赖特定组件名或硬编码 selector。
- [ ] 每条反馈必须记录：URL/route、viewport、scroll、devicePixelRatio、target role/label/text snippet、stable selector、DOM path、bounding box、评论正文、severity、期望行为、实际行为、session/run/artifact refs。
- [ ] 捕获原始截图和标注截图；标注截图必须框出目标元素并显示评论点位/编号。截图生成失败时反馈仍可保存，但必须标为 `partial evidence` 并提示用户。
- [ ] 证据写入本地 feedback bundle，且截图、selector、文本片段和 refs 都要做 secret/path/provider-body scrub。
- [ ] 验收：从工作台任选一个元素评论，在反馈收件箱看到反馈、标注截图、目标元素摘要和证据完整性状态。

### FB-02 反馈收件箱本地状态机

- [ ] 收件箱展示 `comment`、`request`、`open`、`GitHub open`、`triaged`、`fixed`、`blocked` 等状态，并支持筛选、批量勾选、标记、删除/恢复。
- [ ] 本地反馈、GitHub issue、repair request 三类对象必须有唯一 ID 和可追溯 refs，不能只靠标题或截图文件名关联。
- [ ] 生成 request bundle 时必须包含 selected feedback、证据 refs、期望结果、风险提示和允许/禁止操作范围。
- [ ] 删除选中只能软删除本地条目或取消 selection，不得删除 GitHub issue、repair audit、workspace patch 或截图原始证据。
- [ ] 验收：创建多条反馈，筛选/勾选/标记/恢复后计数和详情一致，刷新 browser 后状态仍可恢复。

### FB-03 GitHub Issue 提交与拉取同步

- [ ] 默认同步当前 `origin` repo；repo、labels、assignees、milestone、token source、dry-run/real-submit 必须在配置中可覆盖。
- [ ] 提交 GitHub issue 时 issue body 必须格式化包含：summary、repro steps、expected/actual、target element evidence、annotated screenshot、raw screenshot link/ref、environment、local feedback id、session/run refs、repair policy。
- [ ] 拉取 GitHub open issues 时必须去重并保留 remote number/url/state/labels/updatedAt；本地修改和远端状态冲突时显示 sync conflict，不覆盖用户本地批注。
- [ ] GitHub token 缺失、权限不足、rate limit、repo 不存在、网络失败时必须 fail closed，保留本地 pending 状态和可重试诊断。
- [ ] 验收：提交一条本地反馈为 GitHub issue，再从 GitHub 拉取同一 issue，不重复创建，状态从本地 pending 正确变成 GitHub open。

### FB-04 DeepSeek Codex CLI Repair Backend

- [ ] Codex CLI repair 必须走 SciForge 后端服务，以 DeepSeek/runtime profile 调用 Codex CLI；不能把当前 Codex App 助手当作 repair executor。
- [ ] 用户在反馈收件箱勾选一个或多个 issue 后，可生成 repair request 并启动 Codex CLI repair；工作台只提供相关 issue 跳转，不作为完整 repair queue。
- [ ] repair request 必须包含 issue refs、feedback evidence、repo config、base branch、允许写入路径、禁止写入路径、需要运行的 tests、用户确认策略。
- [ ] 进度展示采用 terminal mirror：把 Codex CLI 的终端信息按时间顺序透传到反馈收件箱，支持复制、折叠、停止和导出；terminal mirror 不能被 GUI 解析成 completion verdict。
- [ ] Codex CLI 输出同时写 bounded audit bundle；给用户看的 terminal mirror 可以实时直出，进入 issue/comment/audit summary 前必须 scrub secret、token、raw provider body 和绝对敏感路径。
- [ ] 验收：选择一个 issue 启动 repair，用户能在反馈收件箱看到近似 terminal 的实时输出、退出码、产物 refs 和失败/成功边界。

### FB-05 Repair 护栏与用户确认

- [ ] 每次 repair 在隔离 worktree/branch 中运行，开始前记录 base commit、dirty worktree 状态、protected files digest 和 feedback data digest。
- [ ] Codex CLI 先生成 repair plan，再允许 patch；plan 必须列出 root cause hypothesis、write scope、protected scope、commands/tests、rollback-free recovery strategy 和需要用户确认的风险。
- [ ] 默认不 commit、不 push、不 PR、不 merge。用户点确认后才允许生成 commit；push/PR 需要第二次单独确认；merge 永远不能自动执行。
- [ ] 禁止 destructive repair：`git reset --hard`、无边界 `git checkout/restore`、删除反馈数据、改写 ignored secret config、修改 provider credentials、清空 audit、伪造 tests 或 output artifacts。
- [ ] 如果 repair 目标包含反馈收件箱自身或 repair backend，控制面进入 safe mode：已有 terminal mirror 保持只读，新的 patch apply/commit/push 需要额外确认或外部控制面。
- [ ] 验收：制造一个可修复问题，确认 Codex CLI 只产生 patch/diff/tests/audit；未点确认时没有 commit，点确认后只创建本地 commit，push/PR 仍等待单独确认。

### FB-06 端到端真实验收

- [ ] 从 Codex in-app browser 对工作台任意元素评论，截图标注和证据进入反馈收件箱。
- [ ] 在反馈收件箱提交 GitHub issue，再从 GitHub 拉取同步，验证去重、状态和 issue body。
- [ ] 勾选 issue 启动 DeepSeek Codex CLI repair，观察 terminal mirror，导出 patch/diff/tests/audit。
- [ ] 用户确认后才允许 commit；push/PR 需要另一个确认动作。未确认时 `git status` 不能出现自动提交或远端变化。
- [ ] 修复后重新打开浏览器验证原问题解决，且反馈数据、GitHub sync state、terminal mirror 和 repair audit 未被破坏。

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
