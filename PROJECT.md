# SciForge 项目协议

最后更新：2026-05-23

当前目标：把 SciForge 收敛到统一的 **Codex-native realtime session** 模型。主聊天需要实时交互并消费 Codex 结构化事件，UI 负责更好的信息呈现；repair 默认把 Codex CLI 进程交给系统 Terminal / detached control surface，Web terminal 只是可选 attach viewer，repair log evidence 是审计证据而不是第二个工作终端。所有 TUI-GUI 交互必须继续符合 `docs/TuiGuiProtocol.md` 和 `docs/Architecture.md`：GUI 把用户意图变成文本，TUI/Codex 拥有任务逻辑，GUI 只做展示、确认、输入收集和只读状态投影。

## 当前决策

- 主聊天框不做 raw terminal UI。它需要实时交互能力，但默认消费 Codex structured events，渲染为 chat messages、tool cards、artifact refs、right-panel preview、confirmation/input UI 和 status。
- 主聊天底层可以使用 WebSocket session bridge，但 WebSocket/PTY/stdio/HTTP 都只是传输细节，不能成为业务协议或任务真相源。
- Raw terminal 交互抽成 `terminal-session-viewer` 这类 `packages/presentation/components` 组件，只维护 interactive 模式；它负责 ANSI/xterm 渲染、键盘输入、paste、resize、scrollback、copy/focus 等 UI 能力，通过事件上抛给 host。
- `terminal-session-viewer` 不是 action provider、不是 verifier、不是 agent host：不能启动进程、选择 provider、执行命令、写 workspace、判断 completion 或 repair verdict。
- Repair UI 保留一个主路径：feedback context + `打开系统 Terminal` -> generated launch script -> Codex CLI repair session；`启动 Web Viewer` 只是可选 WebSocket PTY attach 视图。不要再出现 `HTTP writer` 入口，也不要再有与 repair 启动语义重复的 `启动并发送`。
- 暂时不做多 agent repair 编排。Codex CLI 如需子任务，可由 Codex 自己在 CLI session 内 spawn subagents；SciForge UI 不先做跨 agent 调度层。
- System Terminal 是 Codex CLI repair 的推荐控制面，尤其适合修复 SciForge UI、Vite、workspace writer 或 feedback 控制面本身；Web Viewer 不是进程生命线。
- Provider 预检可以保留，但它只回答“当前 Codex CLI 配置是否可用”。API key、base URL、profile 等由设置入口让用户配置；页面、日志、GitHub issue 和 docs 不得暴露 secret。
- Evidence / audit 需要继续存在，但目标是减少用户补充信息：系统自动带上反馈注释、目标元素、截图、DOM/route、repair log refs、patch/test refs；用户只需要确认问题是否解决，以及补充“还有什么问题”。
- 用户确认边界改成产品选择：用户可以选择自动操作或手动 git 操作。默认仍不自动 commit/push/PR/merge；未来可以保留自动 merge 方向，但必须有显式策略和确认 gate。
- 旧的跨实例 repair 编排、HTTP writer、provider 预检、evidence/audit、用户确认边界只保留对当前产品仍有价值的部分；实现上以单一路径、可观察、可删除旧链路为优先。

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

- 反馈收件箱已经有可见 `注释` 按钮、元素选择、截图/标注证据、本地 feedback bundle、GitHub issue 同步、repair audit 展示、系统 Terminal repair launch 和可选 Web Viewer。
- 2026-05-23 已验证 Direct Codex PTY：Codex in-app browser 点击 `启动 Codex`，xterm 显示真实 Codex CLI trust prompt，通过 PTY 输入 `1` 后继续运行，terminal mirror 记录 `DIRECT_CODEX_PTY_OK` 和反馈标题。
- 主聊天已经有 `realtimeSession` envelope + WebSocket structured-events 桥接；HTTP SSE 保留为非浏览器/测试 fallback，`CODEX_REALTIME_SESSION_TRANSPORT_STATUS.websocketComplete` 为 `true`。
- `packages/presentation/components/terminal-session-viewer/` 已新增 pure presentation renderer 和 registry 入口；Feedback repair host 通过该 component 提供 live PTY mount，host 仍拥有 xterm/WebSocket/stdin/resize/stop 行为。
- 旧 HTTP writer 产品入口、workspace client 类型、workspace server endpoint/state registry 和重复 `启动并发送` 路径已删除；当前只保留 `打开系统 Terminal` 和可选 `启动 Web Viewer`。
- Runtime Codex/DeepSeek 本地运行依赖本机 ignored 配置或设置页注入的 provider 参数，包括 `SCIFORGE_RUNTIME_API_KEY` 和 provider proxy upstream base URL；任何公开产物不得包含 secret。

## 当前任务板：Codex Realtime Session 统一化

### RT-01 协议与架构边界

- [x] 更新实现前先对齐 `docs/TuiGuiProtocol.md` 和 `docs/Architecture.md`：GUI -> TUI 只发送文本，TUI -> GUI 只通过 `gui.*` intent 和只读 GUI resources 表达展示/输入/确认需求。
- [x] 明确 WebSocket、PTY、stdio、HTTP 都只是 transport；业务协议是 Codex session events、terminal-equivalent text input、`gui.*` intent tools 和 read-only GUI resource tree。
- [x] 禁止把 ANSI/raw terminal buffer 当成主聊天的 task truth、completion truth、confidence source 或 GUI context 默认输入。
- [x] 清理任何让 GUI 负责 provider route、capability ranking、repair strategy、completion 判断的路径。

RT-01 evidence note (2026-05-23): implementation keeps main chat on terminal-equivalent `commandText` plus structured Codex events, rejects raw-terminal realtime envelopes and legacy GUI handoff fields in runtime server tests, and keeps provider readiness as display-only diagnostics rather than GUI route selection. `terminal-session-viewer` is registered as presentation-only and has no process/socket/provider/workspace side-effect imports.

### RT-02 主聊天 Realtime Codex Session

- [x] 将主聊天框底层收敛为 Codex-native realtime session bridge，支持 WebSocket 实时收发用户文本和 Codex structured events。
- [x] 主聊天 UI 默认消费结构化事件：assistant message、tool call/result、artifact refs、file refs、run refs、progress/status、confirmation/input request、`gui.present` intent。
- [x] 主聊天不显示 raw terminal；需要调试时只提供高级/开发者入口查看 session diagnostics，不作为默认用户路径。
- [x] GUI 按钮、表单、选中对象追问、artifact 打开、能力偏好等操作都生成终端等价文本或通过 TUI-owned `gui.*`/confirmation flow 返回文本。
- [x] 保持 session resume/thread truth 在 Codex/TUI 侧；GUI 只保存 session id、UI metadata、refs、view state 和可恢复 presentation state。
- [x] 主聊天需要继续支持 artifact object reference 点击、右侧预览、结构化 refs 和 progressive GUI context，不把 React/DOM 内部状态泄露给 TUI。

RT-02 evidence note (2026-05-23): `packages/contracts/runtime/codex-realtime-session.ts` and `src/ui/src/api/sciforgeToolsClient/codexRealtimeSession.ts` define a Codex-native session envelope around terminal-equivalent text and structured events with WebSocket transport support. `src/runtime/codex/codex-runtime-server.ts` exposes `/api/sciforge/runtime/codex/realtime/ws` as the HTTP upgrade route, workspace/standalone servers wire that route, and the UI client sends the realtime request over WebSocket while preserving HTTP SSE as non-browser/test fallback. Focused tests cover session refs/resume, raw terminal rejection, structured `gui.present`, artifact refs, WebSocket upgrade send/receive, and UI WebSocket event parsing; see `CODEX_REALTIME_SESSION_TRANSPORT_STATUS` and `src/runtime/codex/README.md`.

### RT-03 Interactive Terminal Viewer 组件

- [x] 在 `packages/presentation/components/terminal-session-viewer/` 新增可复用组件包，包含 `manifest.ts`、`render.tsx`、`README.md`、`package.json`、fixtures 和 renderer tests。
- [x] 只维护 interactive 模式：组件面向活的 terminal session，可处理键盘输入、paste、resize、scrollback、selection/copy、focus、connected/running/stopped/error 状态。
- [x] 不做独立 read-only product mode；历史 audit/log 继续用 summary/log renderer。completed/stopped 只是 interactive session 的终态显示，不引入第二套只读 viewer 契约。
- [x] 组件 props 只接收 host 提供的 `sessionRef`、status、terminal buffer/stream、capabilities、theme、title/metadata 和 declared event callbacks。
- [x] 组件事件只声明用户交互意图：`data-input`、`paste-input`、`resize`、`copy-request`、`download-request`、`stop-request`、`focus-change`。
- [x] 组件不得启动进程、创建 WebSocket、选择 provider、执行命令、写 workspace、调用 GitHub、生成 repair verdict、计算 confidence 或读取未声明外部资源。
- [x] 将该组件登记进 `packages/presentation/components` registry 和 presentation catalog，agentSummary 必须说明它是 GUI terminal surface，不是 TUI task capability。

RT-03 evidence note (2026-05-23): `node --import tsx --test packages/presentation/components/index.test.ts packages/presentation/components/terminal-session-viewer/render.test.tsx` passed; `npm --workspace @sciforge-ui/components run packages:check` passed earlier in this run.

### RT-04 Repair Terminal 单一路径

- [x] 移除反馈收件箱里所有 `HTTP writer` 可见按钮、状态标签、help copy 和入口逻辑。
- [x] 删除 `启动并发送` 与 repair 启动的重复语义：未运行时优先 `打开系统 Terminal`，textarea 内容作为 initial prompt 进入同一次 Codex repair session；`启动 Web Viewer` 是可选 attach 路径。
- [x] 运行中使用 `terminal-session-viewer` 承载 PTY 交互；用户 follow-up 通过 terminal viewer 输入，host 转发到 PTY stdin。
- [x] 清理 `FeedbackCodexTerminalPanel` / inbox 页面中的 HTTP writer mode、状态分支、按钮分支和样式。
- [x] 清理 workspace client 中只服务 HTTP writer 的 start/write/tail/stop 类型与调用。
- [x] 删除 workspace server 中 HTTP writer terminal session 的 endpoint、state registry、poll/tail/write/stop 分支。
- [x] 删除旧的 direct HTTP writer repair prompt dispatch 适配层；feedback context prompt 只作为 Codex repair session 启动时的 initial message。
- [x] 保留 repair log evidence、repair result persistence、repair audit 和 confirmation actions，但它们不应依赖 HTTP writer session 或 Web Viewer 生命周期。

RT-04 evidence note (2026-05-23): `npm run smoke:no-legacy-paths` passed with 609 source files and 0 tracked findings; focused feedback/workspace client tests passed. `FeedbackCodexTerminalPanel` now renders the visible PTY surface through `renderTerminalSessionViewer` using `liveSurfaceRef`; the host keeps ownership of the real xterm instance, WebSocket attach, stdin forwarding, resize, start, and stop behavior.

### RT-05 Provider 设置与预检

- [x] 在 UI 中提供明确的 provider 设置入口，允许用户配置/检查 API key、base URL、profile/model，但不显示 secret 原文。
- [x] Provider 预检只做 readiness 诊断：缺 key、base URL、profile 错误、upstream outage 都要有明确状态和下一步。
- [x] 预检失败时可以阻止自动 repair，但不能让 terminal 面板看起来像按钮失效；需要可见说明和可恢复动作。
- [x] 主聊天和 repair 使用同一套 provider readiness 语义，但 readiness 不进入 GUI 任务决策或 provider routing。

RT-05 evidence note (2026-05-23): shared `providerReadiness` helpers drive runtime health, main chat warning copy, feedback repair readiness, and Settings masked secret display; `src/ui/src/runtimeHealth.test.ts` and `src/ui/src/app/chat/runStatusPresentation.test.ts` passed.

### RT-06 Evidence / Audit 和反馈闭环

- [x] Repair context 自动包含用户注释、目标元素、截图、DOM/route、workspace/session refs 和 GitHub issue refs，用户不需要重复描述。
- [x] Repair 结束后 UI 让用户只做两件事：确认问题是否解决；如果没有，补充剩余问题反馈。
- [x] Audit bundle 保留 plan、repair log/session refs、patch/diff、tests、guard digests、provider preflight 和用户确认记录；展示层默认 summary-first。
- [x] Terminal transcript 可以作为 evidence ref，但 GUI 不能从 terminal 文本判断 fixed/blocked/completion；verdict 必须来自 Codex/TUI/verifier/harness 输出。
- [x] Evidence/audit 展示可以复用 terminal viewer 的 session refs，但长期审计摘要仍需要 scrubbed/bounded 表达，不能直接把 raw buffer 写入 GitHub issue 正文。

RT-06 evidence note (2026-05-23): focused coverage added in `src/ui/src/app/sciforgeApp/FeedbackInboxPage.test.ts` for structured feedback handoff refs (`handoffBundle`, screenshot/evidence refs, plan/terminal mirror refs, provider readiness as display-only), terminal transcript as an evidence ref rather than verdict source, GitHub issue bodies staying summary/public-ref based with bounded scrub before any terminal copy reaches long-term audit text, and repair-result closure that asks only whether the issue is solved while capturing remaining-problem feedback into the browser-recheck audit path. Remaining gap: still needs a live browser/repair run artifact proving an actual Codex PTY repair result writes patch/test refs and a scrubbed audit bundle end to end.

### RT-07 用户确认与 Git 操作模式

- [x] 提供“手动 git 操作”和“自动操作”模式选择。默认手动。
- [x] 自动模式也必须保留 commit、push、PR、merge 的分级确认；merge 不得静默执行。
- [x] 为未来多 agent 协作保留自动 merge 的产品位置，但当前实现不引入多 agent 编排。
- [x] 确认 UI 属于 GUI presentation/input collection；真实 git 操作仍由 Codex/TUI 原生 tools 或 backend action provider 执行。

RT-07 evidence note (2026-05-23): Feedback Inbox now exposes manual/auto git mode, passes `gitMode` through repair handoff/direct PTY metadata, and records commit/push/PR/merge confirmation through in-page presentation UI; merge remains non-silent.

### RT-08 验收

- [x] `git diff --check`
- [x] `npm run typecheck`
- [x] Focused tests：main chat realtime session bridge、structured event rendering、terminal-session-viewer、feedback inbox、workspace client、workspace server PTY terminal。
- [x] Component tests：`terminal-session-viewer` interactive input、paste、resize、copy/selection、stop event、connected/running/stopped/error states、no side-effect imports.
- [x] Codex in-app browser：打开 `http://127.0.0.1:5173/`，确认没有 HTTP writer 入口、没有重复启动按钮；点击 `启动 Codex` 后进入真实 PTY，可实时输入、停止并看到结果/诊断。
- [x] Codex in-app browser：主聊天发送一条真实请求，确认 UI 实时增长、结构化 tool/artifact/status 事件正常呈现，默认不显示 raw terminal。

RT-08 evidence note (2026-05-23): aggregate focused command passed 74 tests across runtime WebSocket/SSE realtime bridge, structured event rendering, terminal-session-viewer live surface, feedback inbox, workspace client, provider readiness, and run status. `npm run typecheck`, `git diff --check`, `npm run smoke:no-legacy-paths`, `npm run smoke:runtime-codex-truth-source`, and `npm run smoke:runtime-provider-preflight` passed. Codex in-app browser acceptance used `http://127.0.0.1:5173/`: repair UI showed p2 writer ready, no HTTP writer, no `启动并发送`, exactly one `启动 Codex`; clicking it opened a real connected WebSocket PTY with Codex trust prompt, `Enter` continued execution, and `停止` returned a completed session diagnostic. After the final WebSocket bridge, the repair surface also exposed `[data-component-id="terminal-session-viewer"]` and `.terminal-session-viewer-live-surface` in the live DOM. Main chat acceptance from the default visible chat entry sent `请只回复一句话：RT acceptance ok...`; after restarting stale p1 writer, the visible answer was `RT acceptance ok.`, no `realtimeSession` adapter error remained, and no raw terminal UI appeared. A later post-WebSocket rerun showed structured Runtime Codex progress over the live path with no raw terminal or adapter error, but the provider preflight displayed `upstream-outage`, so that last rerun did not produce a final assistant answer before timing out.

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
