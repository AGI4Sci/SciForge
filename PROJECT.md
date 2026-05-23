# SciForge 项目协议

最后更新：2026-05-23

当前目标：把反馈收件箱里的 repair 入口清理成一个干净、可解释、可实时交互的 **Direct Codex PTY Terminal**。Repair 本质是一次带 feedback context 的 Codex CLI session；UI 只负责生成/展示上下文提示、承载 PTY 交互、展示结果和确认边界，不再维护一条并行的 HTTP writer repair 路径。

## 当前决策

- 暂时不做多 agent repair 编排。Codex CLI 如需子任务，可由 Codex 自己在 CLI session 内 spawn subagents；SciForge UI 不先做跨 agent 调度层。
- Direct Codex Terminal 是 Codex CLI 专用终端，不是开放的系统 shell。短期只允许与当前 feedback repair 绑定的 Codex CLI 交互，降低权限面和状态复杂度。
- Repair UI 保留一个主路径：可选初始提示输入框 + `启动 Codex`；启动后进入 xterm/WebSocket PTY，支持实时读写和停止。不要再出现 `HTTP writer` 入口，也不要再有与 `启动 Codex` 语义重复的 `启动并发送`。
- Provider 预检可以保留，但它只回答“当前 Codex CLI 配置是否可用”。API key、base URL、profile 等由设置入口让用户配置；页面、日志、GitHub issue 和 docs 不得暴露 secret。
- Evidence / audit 需要继续存在，但目标是减少用户补充信息：系统自动带上反馈注释、目标元素、截图、DOM/route、terminal refs、patch/test refs；用户只需要确认问题是否解决，以及补充“还有什么问题”。
- 用户确认边界改成产品选择：用户可以选择自动操作或手动 git 操作。默认仍不自动 commit/push/PR/merge；未来可以保留自动 merge 方向，但必须有显式策略和确认 gate。
- 旧的跨实例 repair 编排、provider 预检、evidence/audit、用户确认边界只保留对当前产品仍有价值的部分；实现上以单一路径、可观察、可删除旧链路为优先。

## 不可妥协原则

- 用户级 browser 验收必须使用 Codex in-app browser，从默认可见入口开始；系统浏览器、macOS `open`、外部 Chrome、Playwright 只能作为辅助诊断。
- 每个 claimed success 都要能对应到实际文件改动、命令输出、browser/DOM/截图证据或明确的 blocked manifest；缺任何一项只能标 `partial` / `blocked`。
- 已完成的 TODO 需要打勾，并补充 evidence 路径、日期和最终状态。
- 所有修改必须通用，不能为当前案例写硬编码补丁。
- 代码路径保持唯一真相源：发现冗余链路时删除或合并旧链路，避免长期并行实现。
- 单文件超过约 2000 行时必须拆分或登记拆分任务。

## 必读文档

- [`docs/README.md`](docs/README.md)：当前文档入口。
- [`docs/Architecture.md`](docs/Architecture.md)：GUI-as-TUI-extension 总架构。
- [`docs/TuiGuiProtocol.md`](docs/TuiGuiProtocol.md)：GUI 输入变成终端等价文本、TUI 通过 `gui.*` intent tools 驱动 GUI 的协议边界。
- [`docs/NativeExtensionOwnershipMap.md`](docs/NativeExtensionOwnershipMap.md)：provider route、verifier、repair 等能力归属。
- [`docs/Usage.md`](docs/Usage.md)：当前启动、配置、运维和 workspace 产物说明。
- [`docs/FeedbackInboxDesignPrinciples.md`](docs/FeedbackInboxDesignPrinciples.md)：反馈收件箱设计原则。
- [`packages/backend/CodexRuntimeMigration.md`](packages/backend/CodexRuntimeMigration.md)：Runtime Codex 迁移路线。
- [`packages/backend/CODEX_COMPATIBILITY.md`](packages/backend/CODEX_COMPATIBILITY.md)：Codex CLI 兼容层说明。

## 当前基线

- 反馈收件箱已经有可见 `注释` 按钮、元素选择、截图/标注证据、本地 feedback bundle、GitHub issue 同步、repair audit 展示和 Direct Codex PTY Terminal。
- 2026-05-23 已验证 Direct Codex PTY：Codex in-app browser 点击 `启动 Codex`，xterm 显示真实 Codex CLI trust prompt，通过 PTY 输入 `1` 后继续运行，terminal mirror 记录 `DIRECT_CODEX_PTY_OK` 和反馈标题。
- 当前实现仍有旧 HTTP writer 代码和 UI 入口，这是下一步要删除的迁移债务。
- 当前实现仍可能同时显示 `启动 Codex` 与 `启动并发送` 这类重复动作，这是下一步要合并的 UX 债务。
- Runtime Codex/DeepSeek 本地运行依赖本机 ignored 配置或设置页注入的 provider 参数；任何公开产物不得包含 secret。

## 当前任务板：Direct Codex Terminal 清理

### RT-01 删除 HTTP writer 产品入口

- [ ] 移除反馈收件箱里所有 `HTTP writer` 可见按钮、状态标签、help copy 和入口逻辑。
- [ ] 移除 `启动并发送` 与 `启动 Codex` 的重复语义：未运行时只有一个启动动作，textarea 内容作为 initial prompt 进入同一次 Codex PTY session。
- [ ] 运行中只保留 PTY terminal、停止、必要的复制/导出诊断动作；follow-up 输入应通过 PTY 本身完成，避免旁路 writer。

### RT-02 删除 HTTP writer 前端代码

- [ ] 清理 `FeedbackCodexTerminalPanel` / inbox 页面中的 HTTP writer mode、状态分支、按钮分支和样式。
- [ ] 清理 workspace client 中只服务 HTTP writer 的 start/write/tail/stop 类型与调用。
- [ ] 删除或改写 HTTP writer 专用测试，保留 PTY start、PTY interactive input、stop、terminal mirror、error state 的覆盖。

### RT-03 删除 HTTP writer 后端代码

- [ ] 删除 workspace server 中 HTTP writer terminal session 的 endpoint、state registry、poll/tail/write/stop 分支。
- [ ] 删除旧的 direct HTTP writer repair prompt dispatch 适配层；feedback context prompt 只作为 Codex PTY 启动时的 initial message。
- [ ] 保留 provider preflight、feedback bundle、terminal mirror、repair result persistence 和确认边界，但它们不应依赖 HTTP writer session。

### RT-04 统一 Provider 设置与预检

- [ ] 在 UI 中提供明确的 provider 设置入口，允许用户配置/检查 API key、base URL、profile/model，但不显示 secret 原文。
- [ ] Provider 预检只做 readiness 诊断：缺 key、base URL、profile 错误、upstream outage 都要有明确状态和下一步。
- [ ] 预检失败时可以阻止自动 repair，但不能让 terminal 面板看起来像按钮失效；需要可见说明和可恢复动作。

### RT-05 简化 Evidence / Audit 和用户反馈闭环

- [ ] Repair context 自动包含用户注释、目标元素、截图、DOM/route、workspace/session refs 和 GitHub issue refs，用户不需要重复描述。
- [ ] Repair 结束后 UI 让用户只做两件事：确认问题是否解决；如果没有，补充剩余问题反馈。
- [ ] Audit bundle 保留 plan、terminal mirror、patch/diff、tests、guard digests、provider preflight 和用户确认记录；展示层默认 summary-first。

### RT-06 用户确认与 Git 操作模式

- [ ] 提供“手动 git 操作”和“自动操作”模式选择。默认手动。
- [ ] 自动模式也必须保留 commit、push、PR、merge 的分级确认；merge 不得静默执行。
- [ ] 为未来多 agent 协作保留自动 merge 的产品位置，但当前实现不引入多 agent 编排。

### RT-07 验收

- [ ] `git diff --check`
- [ ] `npm run typecheck`
- [ ] Focused tests：feedback inbox、workspace client、workspace server PTY terminal、terminal panel。
- [ ] Codex in-app browser：打开 `http://127.0.0.1:5173/`，确认没有 HTTP writer 入口、没有重复启动按钮；点击 `启动 Codex` 后进入真实 PTY，可实时输入、停止并看到结果/诊断。

## 归档真实多轮压测任务（最终 gate 对账）

这些 R-* 项是已完成的历史多轮压测，不是当前反馈收件箱实现入口；保留在这里是为了让 `smoke:real-task-matrix` 和 `smoke:real-task-protocol-gates` 能继续对账 PROJECT 与 passed manifests。

- [x] R-PROTO-04 GUI presentation catalog discovery：第一轮生成多类型 artifacts；第二轮要求 agent 通过 `gui.list/read/search` 说明 GUI 当前能用哪些 renderer 预览这些 artifacts；第三轮让 TUI 调 `gui.present` 聚焦其中一个 artifact。必须证明 discovery 来自 `/gui/capabilities/presentation.json` 或 `/gui/renderers/<componentId>.json`，不是 React import、AgentServer gateway 或 GUI task ranking。
  - Evidence 2026-05-21: `docs/test-artifacts/real-tasks/R-PROTO-04/manifest.json` is `status: passed`, `releaseEligible: true`, `attemptScope: task-specific-live-attempt`.
- [x] R-PROTO-05 Inline artifact reference right-panel preview：第一轮生成至少两个 markdown/table artifacts，其中一个在 assistant 文本里以裸文件名 inline code 出现；第二轮点击该裸文件名并验证右侧面板预览；第三轮切换到不可解析 inline code 和重复 basename 场景。必须证明只有可解析真实对象会升级为引用，且预览不改变 task truth。
  - Evidence 2026-05-21: `docs/test-artifacts/real-tasks/R-PROTO-05/manifest.json` is `status: passed`, `releaseEligible: true`, `attemptScope: task-specific-live-attempt`.
- [x] R-VERIFY-02 Confidence source and explanation：第一轮生成无 verifier confidence 的普通回答，必须不显示默认百分比；第二轮生成 tool-backed 或 verifier-backed result，要求输出 `confidenceExplanation`；第三轮制造 partial/blocked 或 contradictory evidence，验证 confidence 降低并列出 penalties。必须证明 GUI 不计算 confidence，所有分数来自 TUI/verifier/harness payload。
  - Evidence 2026-05-21: `docs/test-artifacts/real-tasks/R-VERIFY-02/manifest.json` is `status: passed`, `releaseEligible: true`, `attemptScope: task-specific-live-attempt`.

## 验证规则

- 文档或任务板修改：`git diff --check`。
- 代码修改：`npm run typecheck`、touched areas 的 targeted tests、`git diff --check`。
- 反馈收件箱、GitHub sync 或 repair backend 修改：再跑匹配 touched area 的 targeted tests，并用 Codex in-app browser 完成至少一条用户级验收。
- Runtime/Codex CLI/provider 修改：再跑 `npm run smoke:runtime-provider-preflight`，并证明 Codex CLI backend 被调用，不能 silent fallback 到当前 Codex App 或其他 provider。
- Release 或大范围迁移：再跑 `npm run smoke:no-hardcoded-success`、`npm run smoke:no-legacy-paths`、`npm run smoke:runtime-codex-truth-source`、`npm run smoke:runtime-provider-preflight`、`npm run verify:single-agent-final`；真正 release 必须跑 `npm run verify:single-agent-release`，必要时 `npm run test` 和 `npm run build`。

## 本地 worktree 策略

- 本项目开发基于 `dev` 分支进行；长期只保留 `main` 和 `dev`。
- `config.local.json`、`.sciforge/**` 和 `packages/backend/.codex-runtime/**` 是本机状态，不进入 git。
- `docs/test-artifacts/**` 默认只作为本地验收证据；需要入库前必须确认体积、隐私和复现价值。
- 不用 `git reset --hard` 或 `git checkout --` 回退用户改动。
- 清理 worktree 时只删除明确生成的缓存、临时 workspace 和构建产物。

## 历史归档说明

- 旧 FB-00 到 FB-07 详细 run log 已从 active board 删除；当前状态由 Git history、`docs/FeedbackInboxDesignPrinciples.md`、`docs/test-artifacts/feedback-inbox-closure/` 和相关 commits 保留。
- 2026-05-20 的 R-* 真实多轮压测大任务板已完成并从 active board 移出；证据保留在 `docs/test-artifacts/real-tasks/**`、相关 manifests 和 Git history。
- `docs/archive/` 保存旧 active task boards 和 detailed run histories。
- `docs_old/` 保存迁移前设计快照。
- 除非任务明确证明旧 runtime code 可复用且不是 AgentServer-first debt，否则不要重新引入。
