# SciForge Computer Use 项目协议

最后更新：2026-06-02

当前目标：把 Computer Use 收敛为 **VirtualAppScreen：由 `packages/` 模块化 Native Host 拥有的本地原生 app 后台控制会话**。SciForge 打开右侧 `Screen` 时，必须默认创建或 attach 一个真实运行的本地 app screen；app 运行在 agent-owned virtual display / app surface 中，右侧结果栏显示 live frame，Computer Use 和人类都通过同一个 host-owned input lease / control plane 介入。当前路线直接瞄准终局 C：`NativeVirtualAppScreenHost` 是 session、surface、input、permission 和 evidence 的唯一权威控制面；macOS / Linux / Windows virtual display/app surface provider 只是 host 的平台 adapter；第三方虚拟屏幕工具只能用于调研、benchmark、诊断或参考实现，不能成为核心 contract、release pass 或 user-level acceptance 真相源。

本文件只记录 Computer Use 的当前原则、任务板、TODO 和验收规则。总项目原则以 [`PROJECT.md`](PROJECT.md) 为准；详细设计参考 [`docs/VirtualAppScreenArchitecture.md`](docs/VirtualAppScreenArchitecture.md)、[`docs/VirtualAppScreenNativeHost.md`](docs/VirtualAppScreenNativeHost.md)、[`packages/actions/computer-use/vision_computer_use_agent_mvp.md`](packages/actions/computer-use/vision_computer_use_agent_mvp.md) 和 [`docs/NativeExtensionOwnershipMap.md`](docs/NativeExtensionOwnershipMap.md)。

## 当前范围

- `packages/actions/computer-use` 拥有 request/result schema、VirtualAppScreen/session contract、actor cursor contract、domain-local action loop、scheduler/executor adapter contract、safety/approval、trace contract 和 compact handoff；它不是第二个 Root Agent Host。
- `packages/actions/computer-use/virtual-app-screen-host` 是终局目标的 package-owned Native Host 模块边界：拥有 host protocol、permission preflight、virtual display/app surface lifecycle、target app launch/attach、native/streaming surface presentation、input hot path、automation barriers、session grants 和 host-owned evidence writer。当前如果实现仍位于 `src/runtime/computer-use`，只能视为迁移 shim，新增通用 host 语义必须向该 package 边界收敛。
- `packages/observe/vision` 提供 observation、focus region、OCR/VLM/KV-Ground grounding helper、verifier feedback 和 file-ref-only visual memory；不直接执行真实桌面动作。
- GUI 只负责 VirtualAppScreen presentation、annotation overlay、trace/replay 展示、focus、confirmation 和 terminal-equivalent text；不直接执行 Computer Use。
- BrowserRuntime / DOM / accessibility / Playwright 可以作为 observation、target hint 或 adapter source，但不能绕过 Computer Use 的 executor lease、action causality、before/after evidence、artifact validation 或用户级 completion。
- Platform sidecar / MCP / backend adapter 只做 app/window capture、state、input/preflight 和 adapter readiness；不做 planning、completion、GUI presentation 或 workspace policy。
- `serve-web`、code-server、OpenVSCode、Xvfb/noVNC、RDP、QEMU/VM、shell-only runner、旧截图和普通 browser shortcut 都不是当前产品 fallback；它们只能作为历史诊断或对照资料，不能替代本地原生 VirtualAppScreen 通过验收。
- DeskPad、BetterDisplay、Mirage、Sunshine/Moonlight、noVNC/RDP/VNC、VM/容器桌面等只能作为调研、性能对照、diagnostic profile 或底层参考；不得作为 SciForge Native Host 的权威 session owner、grant issuer、input executor、evidence writer 或 user-level pass 来源。

## 不可变规则

- 所有修改必须通用，不能为当前页面、截图、URL、文件名或历史 run 写硬编码补丁。
- 代码路径保持唯一真相源；旧逻辑和最终方案冲突时删除或迁移旧逻辑，不做长期并行实现。
- GUI -> TUI 只发送终端等价文本、focus/confirmation 结果或只读 projection；TUI -> GUI 只通过 declared GUI intents。
- 右侧结果栏不是日志 dump。它必须按对象类型展示 Browser、Screen、Terminal、Files、References 等 Cursor-like panes，并以可点击 refs 驱动。
- 大 payload、截图、录屏、terminal transcript、DOM snapshot、artifact、audit 和 replay 必须 refs-first；不得内联 raw screenshot/base64/provider payload/secret。
- 涉及 provider URL、API key、model name、Authorization、token、secret、password、credential 的日志和 evidence 必须脱敏；ignored local config 不得提交。
- `no-session` 只能是启动前的瞬时状态或明确 blocked diagnostic；用户打开 `Screen` pane / screen window 后，系统必须自动进入 `provisioning`、`attached`、`observe-only`、`permission-missing` 或 `blocked`，不能长期停在空白 placeholder。
- 缺 Screen Recording、Accessibility、driver、system extension 或 app automation 权限时，必须 fail closed，并给出可执行的授权 handoff / recheck refs；授权未完成前不得用真实桌面、旧截图、noVNC、fixture 或 shell path 代替。
- 所有 Computer Use 动作必须产生当前会话 evidence refs：session/window/frame/input-intent/executor/before-after/verifier/gui.present。没有当前 run refs 就不能声称完成。
- 业务代码单文件超过约 2000 行时必须拆分或登记拆分任务。
- 已完成 TODO 需要打勾，并补充日期、evidence refs、验证命令和最终状态。

## 大文件拆分登记

- [x] 2026-06-01 登记 `packages/actions/computer-use/sciforge_computer_use/contracts.py`：当前约 3405 行，已新增 VirtualAppScreen user-acceptance / adapter readiness / input intent / annotation overlay 合约；后续应拆出 `virtual_app_screen_acceptance` 等 package-local contract 模块，保持 `contracts.py` 作为兼容导出和统一入口。当前验证：`PYTHONPATH=packages/actions/computer-use python3 -m pytest packages/actions/computer-use/tests/test_virtual_app_screen_user_acceptance.py -q`；状态：已登记，满足“拆分或登记拆分任务”规则。

## 模块化设计原则

- 公共函数只有四个：`module.describe`、`module.query`、`module.read`、`module.invoke`。
- `describe/query/read` 必须只读；只有 `invoke` 可以有副作用。未声明 module function、intent、facet 或 ref prefix 必须 fail closed。
- `list/search` 收敛为 `query`，`stat` 收敛为 `read({ includeMeta: true })`，`watch/subscribe/present/ask_user/apply_batch` 收敛为具体 `invoke` intent。
- Agent Host 负责编排 semantic pipeline；模块不得直接 import 或调用其它模块；GUI 可以展示 pipeline trace，但不决定 pipeline。
- trace-first 是默认要求：跨模块组合必须记录 step id、moduleId、function、intent/query/ref、input/result summary、refs、approval、operation、timing、status 和 parent/child relation。


## 目标架构

```text
Task / Collaboration Space
-> VirtualDisplayGroup
   -> VirtualAppScreen A
      -> targetAppRef / targetWindowRef / sessionRef
      -> frameStreamRef / currentFrameRef
      -> ActorCursor(user)
      -> ActorCursor(agent)
      -> annotationOverlayRefs
      -> inputLeaseRef
      -> actionAdapterRef
   -> VirtualAppScreen B
      -> another app/session/window
   -> EvidenceLedger
   -> ReplayBundle
   -> UserControlPlane(permission/allowlist/risk/stop/data-visibility refs)
   -> AdapterReadinessIndex
```

L0/L1/L2 放置：

```text
L2 Root Agent Host
  -> Codex app-server production path
  -> Codex CLI/native plugin debug path
  -> owns cross-module planning, approval, repair, completion, pipeline trace

L1 Computer Use Resource Adapter
  -> packages/actions/computer-use/virtual-app-screen-host Native Host package
  -> VirtualAppScreen session/app/window/frame/input/replay/evidence refs
  -> session permission/allowlist/risk/adapter readiness refs
  -> adapts backend/provider/version/resource lifecycle behind host-owned protocol
  -> exposes only Codex native tool/plugin/MCP or module.* surface

L0 Computer Use Handlers
  -> capture | crop | ground | propose scoped action | execute | verify | writeTrace | emitEvent | adapter preflight

GUI Module
  -> present frame/replay/overlay/permission/risk/stop controls, ask_user, notify, set_status, focus
```

## 当前任务板：VirtualAppScreen 本地 app 产品闭环

当前产品观察：右侧结果栏已经有 `Screen` pane、`virtual-screen-viewer`、refs-first grant 和 blocked/handoff 空态，但打开产品页后仍可能显示 `VirtualAppScreen attach state: no-session` 或 blocked permission/driver 文案。这个状态是正确的 fail-closed：contract / viewer / guard 基线已存在，真正缺的是 `packages/` 下 package-owned `NativeVirtualAppScreenHost` 被产品路径调用，默认创建本地 app session、present native surface、低延迟输入、人类介入和当前会话 evidence 的闭环。

旧的 contract / fixture / readiness 工作已移入“完成归档”。下面登记当前会直接影响“在 SciForge 右侧虚拟屏幕自由使用本地 app”的活跃任务；已完成子项必须保留日期、evidence refs、验证命令和最终状态。注意：没有真实 `NativeVirtualAppScreenHost` 当前会话证据时，只能记录 `blocked` / `permission-missing` / diagnostic contract，不能声称 user-level pass。

### P0：默认可见、真实运行、可控制

- [ ] P0-CU-VAS-NATIVE-HOST-PACKAGE：`packages/` 下模块化 Native VirtualAppScreen Host。
  验收：新增并产品化 `packages/actions/computer-use/virtual-app-screen-host` 作为唯一 native session/control/evidence host package。Host 拥有 permission preflight、virtual display/app surface lifecycle、target app launch/attach、frame/media presentation、human input hot path、automation barrier、pause/resume/stop、session grant 和 host-owned evidence writer；macOS / Linux / Windows provider 只是 host 内部 platform adapter。`src/runtime/computer-use` 只能装配 host、注入 workspace/current-run context 和保留迁移 shim，不新增通用 host 语义。
  当前状态：未完成。runtime/session-manager/provider shells 已有 refs-first contract、fail-closed guard、surface descriptor、grant 和 reconnect store；这些还不是 package-owned Native Host。下一步必须把 host protocol/control plane 提升到 `packages/actions/computer-use/virtual-app-screen-host`，再让产品 runtime 默认通过该 host provision/present/control。
  TODO：
  - [ ] 建立 `packages/actions/computer-use/virtual-app-screen-host` README、manifest/contract、public entrypoint 和 import boundary；package 不 import GUI 或 `src/runtime` 私有实现。
  - [ ] 定义 `NativeVirtualAppScreenHost` protocol：`describe/probe/createSession/launchApp/attachSurface/presentSurface/sendHumanInput/executeAutomationIntent/pause/resume/stop/readFrame/closeSession/validateGrant`。
  - [ ] 将 host-issued `liveBindingAttachGrantRef` 升级为可 dereference 的 attach capability：host bridge 必须读取 current provider-session record，校验 session/surface/frame/transport/sequence/owner/reconnect/current-run 后才能 present。
  - [ ] 拆分输入路径：真人 `sendHumanInput` fire-and-release，只等待 host input queue accepted；自动化 `executeAutomationIntent` 等待 automation barrier、after frame、verification 和 evidence ledger。
  - [ ] 实作 host-owned evidence writer：session/surface/frame/input/action/ledger records 由 host 写入，runtime 复验 hash/current-run/session ownership，不再信 hook 布尔声明。
  - [ ] 第三方虚拟屏幕软件只能实现 reference adapter、diagnostic adapter 或 benchmark profile；不得直接设置 user-level pass、不得绕过 host grant、不得成为 evidence writer。
  验证：`git diff --check`；后续实现需补 host package contract tests、runtime bootstrap tests、host grant validation tests、human hot-path tests 和 automation barrier tests；状态：target direction documented, package implementation pending。

- [ ] P0-CU-VAS-AUTO-OPEN：Screen pane 默认自动打开真实虚拟屏幕。
  验收：用户打开右侧 `Screen` pane 或新建一个 screen window 时，SciForge 通过 `NativeVirtualAppScreenHost` 自动创建或 attach 一个真实运行的 `VirtualAppScreen`。默认 profile 优先使用低风险本地 app（首选 VSCode/editor profile）；成功时 UI 进入 `attached` 并显示 host-owned live surface；失败时进入 `permission-missing`、`adapter-unavailable`、`observe-only` 或 `blocked`，不能长期停留在 `no-session` placeholder。
  当前状态：部分完成。右侧 `Screen` 打开时已生成 refs-first activation / permission-handoff payload，默认 placeholder 会先 request attach/probe，只有明确 authorization-incomplete 才进入 handoff；产品 runtime 已能接收 `/computer-use screen attach` 并在无 executor/dry-run 时返回 refs-first fail-closed `VirtualAppScreen` artifact；注册 runtime-owned executor 返回完整 evidence 时，产品 runtime 会 materialize `attached` live refs，并要求 provider-owned `surfaceTransport` evidence 才能进入 live；macOS / Linux Xpra / Windows IDD opt-in driver hook factory 已落地，产品 runtime 已把 env opt-in 和 generic target-app env config 接到 bootstrap；native executor 已强制 provider lifecycle 同 current-run/session/surface/sequence，driver/provider shell 已要求 hook-owned refs 和 `providerEvidenceWritten=true`。真实 create/launch/attach/readFrame 仍需 package-owned Host 调用当前机器 provider/permission evidence 才能声明通过。
  TODO：
  - [x] 2026-06-02 定义 `Screen` pane activation policy：打开 pane、切换到 pane、创建新 screen window、恢复 workspace 时自动 request attach，并由 right pane controller 只发 terminal-equivalent command。Evidence refs：`src/ui/src/app/results/rightPaneScreenController.ts`、`src/ui/src/app/results/screenPaneModel.ts`；验证：right-pane aggregate suite 137/137 passed。
  - [x] 2026-06-02 定义默认 app profile：无 task 绑定时使用 `app:profile/vscode-editor`；有 current run screen artifact 时优先消费 artifact refs，不复用旧 run。Evidence refs：`src/ui/src/app/results/screenPaneModel.ts`、`src/ui/src/app/results/screenPaneModel.test.ts`；验证：right-pane aggregate suite 137/137 passed。
  - [x] 2026-06-02 将 `no-session` 限定为启动前瞬时状态或 bounded blocked diagnostic；超过 bootstrap window 写 `blockedRef`、`permissionHandoffRef`、`permissionRecheckRef` 和 `providerReadinessRef`。Evidence refs：`src/ui/src/app/results/screenPaneModel.ts`、`src/ui/src/app/results/rightPaneScreenController.ts`；验证：right-pane aggregate suite 137/137 passed。
  - [x] 2026-06-02 初始 `Screen` placeholder activation 默认先发 `/computer-use screen attach` 做 provider probe/attach，不把存在 permission refs 的默认空态误路由为 handoff；只有 `requires-handoff` / authorization-incomplete 状态才发 permission handoff。Evidence refs：`src/ui/src/app/results/rightPaneScreenController.ts`、`src/ui/src/app/results/rightPaneScreenController.test.ts`；验证：`node --import tsx --test src/ui/src/app/results/rightPaneScreenController.test.ts`。
  - [x] 2026-06-02 provider lifecycle contract 在 ready probe 下写入当前会话 `sessionRef`、`liveSurfaceRef`、`frameStreamRef`、`currentFrameRef`、`lifecycleLedgerRef` 和 `evidenceLedgerRef`；缺真实 provider 时仍保持 blocked/handoff，不伪造 `sessionRef`。Evidence refs：`src/runtime/computer-use/virtual-display-provider.ts`、`src/runtime/computer-use/virtual-display-provider.test.ts`；验证：focused CU suite 51/51 passed。
  - [x] 2026-06-02 产品 runtime 早期接收 `/computer-use screen attach --source right-pane-screen ...`，写入 refs-first blocked `VirtualAppScreen` artifact，并明确 `providerExecuted=false` / `mutatingActionExecuted=false`，不落入普通 planner/package bridge。Evidence refs：`src/runtime/computer-use/virtual-app-screen-command.ts`、`src/runtime/vision-sense-runtime.ts`、`src/runtime/vision-sense-runtime.test.ts`；验证：`node --import tsx --test src/runtime/computer-use/virtual-app-screen-command.test.ts src/runtime/vision-sense-runtime.test.ts`。
  - [x] 2026-06-02 建立 runtime-owned VirtualAppScreen session manager 契约：只有注册 executor 返回完整 `sessionRef`、`liveSurfaceRef`、`frameStreamRef`、`currentFrameRef`、`guiPresented` 和 isolation evidence 时才 materialize live refs；无 executor 或证据不全时 fail closed。Evidence refs：`src/runtime/computer-use/virtual-app-screen-session-manager.ts`、`src/runtime/computer-use/virtual-app-screen-session-manager.test.ts`、`src/runtime/vision-sense-runtime.ts`；验证：`node --import tsx --test src/runtime/computer-use/virtual-app-screen-session-manager.test.ts src/runtime/vision-sense-runtime.test.ts`。
  - [x] 2026-06-02 Session manager / native executor 要求 provider-owned `surfaceTransport` descriptor；`attachSurface` / `readFrame` 传播 `surfaceTransportRef`、frame transport、telemetry 和 current sequence refs，缺失或 unsafe descriptor 时 fail closed，不把 replay/旧 frame 当 live。Evidence refs：`src/runtime/computer-use/virtual-display-provider.ts`、`src/runtime/computer-use/virtual-app-screen-native-executor.ts`、`src/runtime/computer-use/virtual-app-screen-session-manager.ts`；验证：`node --import tsx --test src/runtime/computer-use/virtual-display-provider.test.ts src/runtime/computer-use/virtual-app-screen-native-executor.test.ts src/runtime/computer-use/virtual-app-screen-session-manager.test.ts src/runtime/computer-use/virtual-app-screen-runtime-executors.test.ts`。
  - [x] 2026-06-02 产品 runtime 使用 session manager 全局 executor registry；注册 executor 且非 dry-run 时，`/computer-use screen attach` 返回 `done` + refs-first `computer-use-virtual-screen` live artifact；dry-run/无 executor 仍 fail closed。Evidence refs：`src/runtime/computer-use/virtual-app-screen-session-manager.ts`、`src/runtime/vision-sense/computer-use-trace-output.ts`、`src/runtime/vision-sense-runtime.ts`、`src/runtime/vision-sense-runtime.test.ts`；验证：`node --import tsx --test src/runtime/computer-use/virtual-app-screen-session-manager.test.ts src/runtime/vision-sense-runtime.test.ts`。
  - [x] 2026-06-02 增加 generic native executor adapter：只消费注入的 `VirtualDisplayProviderL1Contract` 操作结果，必须按 `probe -> createSession -> launchApp -> attachSurface -> readFrame` 取得当前 session/window/live/current-frame refs、`providerExecuted=true` 和隔离 readiness 才返回 `attached`；任何 blocked、projection-only、raw payload、缺 refs 或隔离不成立都会 fail closed。Evidence refs：`src/runtime/computer-use/virtual-app-screen-native-executor.ts`、`src/runtime/computer-use/virtual-app-screen-native-executor.test.ts`；验证：`node --import tsx --test src/runtime/computer-use/virtual-display-provider.test.ts src/runtime/computer-use/virtual-app-screen-native-executor.test.ts src/runtime/computer-use/virtual-app-screen-session-manager.test.ts src/runtime/vision-sense-runtime.test.ts`。
  - [x] 2026-06-02 增加 macOS provider side-effect hook shell：默认所有操作 fail closed 且 `providerExecuted=false`；只有注入的 generic hook/driver 返回 `providerExecuted=true`、ready readiness 和 refs 时，才可被 native executor 接成 attached。模块不导入 smoke、不包含 VSCode app path/bridge，支持 generic target refs。Evidence refs：`src/runtime/computer-use/native-providers/macos-virtual-display-provider.ts`、`src/runtime/computer-use/native-providers/macos-virtual-display-provider.test.ts`；验证：`node --import tsx --test src/runtime/computer-use/native-providers/macos-virtual-display-provider.test.ts src/runtime/computer-use/virtual-app-screen-native-executor.test.ts`。
  - [x] 2026-06-02 产品 runtime 默认 bootstrap 平台 executor shell：macOS 自动注册 no-hook native provider executor，优先级低于 profile-specific 产品 executor；缺真实 hook/权限/provider 时仍返回 `blocked` / `permission-missing`，不伪造 session/live/current-frame refs。Evidence refs：`src/runtime/computer-use/virtual-app-screen-runtime-executors.ts`、`src/runtime/computer-use/virtual-app-screen-runtime-executors.test.ts`、`src/runtime/vision-sense-runtime.ts`；验证：`node --import tsx --test src/runtime/computer-use/virtual-app-screen-runtime-executors.test.ts src/runtime/computer-use/native-providers/macos-virtual-display-provider.test.ts src/runtime/computer-use/virtual-app-screen-native-executor.test.ts src/runtime/computer-use/virtual-app-screen-session-manager.test.ts src/runtime/vision-sense-runtime.test.ts`。
  - [x] 2026-06-02 产品 runtime bootstrap 同时注册低优先级 macOS input runtime provider shell，和 native session executor 共享同一 provider；`/computer-use input-intent` 在无产品 input executor 时也能保留 provider readiness refs 并 fail closed，source-specific input executor 优先。Evidence refs：`src/runtime/computer-use/virtual-app-screen-runtime-executors.ts`、`src/runtime/computer-use/virtual-app-screen-runtime-executors.test.ts`；验证：`node --import tsx --test src/runtime/computer-use/virtual-app-screen-runtime-executors.test.ts src/runtime/computer-use/virtual-app-screen-input-runtime.test.ts src/runtime/vision-sense-runtime.test.ts`。
  - [x] 2026-06-02 Runtime Codex SSE `done` payload 如果已包含 safe `computer-use-virtual-screen` artifact + `virtual-screen-viewer` slot，会 materialize 为 structured projection；纯 raw `done` 仍因缺 `gui.present` fail closed。Evidence refs：`src/ui/src/api/sciforgeToolsClient/runtimeEvents.ts`、`src/ui/src/api/sciforgeToolsClient/runtimeEvents.test.ts`、`src/ui/src/api/sciforgeToolsClient/runtimeEvents.client.test.ts`；验证：`node --import tsx --test src/ui/src/api/sciforgeToolsClient/runtimeEvents.test.ts src/ui/src/api/sciforgeToolsClient/runtimeEvents.client.test.ts`。
  - [x] 2026-06-02 增加 macOS opt-in native driver hook factory：`createMacosVirtualDisplayDriverHooks(...)` 通过 generic deps / macOS helpers 执行 `probe -> createSession -> launchApp -> attachSurface -> readFrame`，写入当前会话 session/display/window/live-surface/frame-stream/current-frame/surfaceTransport/frameTransport/telemetry refs；缺 `node-mac-virtual-display`、`screencapture`、Screen Recording、Accessibility、window 或 capture 时 fail closed。默认 runtime 仍不自动启用，模块不导入 smoke、VSCode bridge 或 VSCode profile。Evidence refs：`src/runtime/computer-use/native-providers/macos-native-driver-helpers.ts`、`src/runtime/computer-use/native-providers/macos-virtual-display-driver.ts`、`src/runtime/computer-use/native-providers/macos-virtual-display-driver.test.ts`；验证：`node --import tsx --test src/runtime/computer-use/native-providers/macos-virtual-display-driver.test.ts src/runtime/computer-use/native-providers/macos-virtual-display-provider.test.ts src/runtime/computer-use/virtual-app-screen-native-executor.test.ts`。
  - [x] 2026-06-02 产品 runtime 将 `SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS` env opt-in 传入 runtime executor bootstrap；未显式 opt-in 时仍只注册 fail-closed shell，opt-in 时使用平台 driver factory，但不导入 smoke driver、VSCode bridge 或 viewer fallback。Evidence refs：`src/runtime/vision-sense-runtime.ts`、`src/runtime/vision-sense-runtime.test.ts`、`src/runtime/computer-use/virtual-app-screen-runtime-executors.ts`、`src/runtime/computer-use/virtual-app-screen-runtime-executors.test.ts`；验证：`node --import tsx --test src/runtime/vision-sense-runtime.test.ts src/runtime/computer-use/virtual-app-screen-runtime-executors.test.ts`。
  - [x] 2026-06-02 产品 runtime 增加 generic target-app env config：`SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON` 和 scalar overrides 只在 native driver hook opt-in 后解析；allowlist keys、trim strings、`ARGS_JSON` string array、regex preflight，invalid JSON/args/regex fail closed，不注册 fallback；平台字段按 macOS/Linux/Windows 过滤，显式 programmatic options 优先。Evidence refs：`src/runtime/computer-use/virtual-app-screen-runtime-executors.ts`、`src/runtime/computer-use/virtual-app-screen-runtime-executors.test.ts`；验证：`node --import tsx --test src/runtime/computer-use/virtual-app-screen-runtime-executors.test.ts src/runtime/vision-sense-runtime.test.ts`。
  - [ ] 产品 runtime 仍需在真实 macOS provider/permission 可用且 env opt-in 已打开时证明 create/launch/attach/readFrame 由平台 provider 实际执行；这不能由 smoke/projection/fake deps 替代。
  - [x] 2026-06-02 增加 Linux Xpra / Windows IDD provider side-effect hook shell parity：默认所有操作 fail closed 且 `providerExecuted=false`；只有注入 hooks 返回 `providerExecuted=true`、ready readiness 和 refs 时，才可被 native executor 接成 attached。runtime bootstrap 会在 `linux` / `win32` 注册低优先级 no-hook native/input shell，仍不伪造 session/live/current-frame refs；真正 unsupported 平台不注册。Evidence refs：`src/runtime/computer-use/native-providers/platform-virtual-display-provider-shell.ts`、`src/runtime/computer-use/native-providers/linux-xpra-virtual-display-provider.ts`、`src/runtime/computer-use/native-providers/windows-idd-virtual-display-provider.ts`、`src/runtime/computer-use/native-providers/platform-virtual-display-provider-shell.test.ts`、`src/runtime/computer-use/virtual-app-screen-runtime-executors.ts`、`src/runtime/computer-use/virtual-app-screen-runtime-executors.test.ts`；验证：`node --import tsx --test src/runtime/computer-use/native-providers/platform-virtual-display-provider-shell.test.ts src/runtime/computer-use/virtual-app-screen-runtime-executors.test.ts`。
  - [x] 2026-06-02 增加 Linux Xpra opt-in native driver hook factory：`createLinuxXpraVirtualDisplayDriverHooks(...)` 通过 generic deps / Linux Xpra helpers 执行 `probe -> createSession -> launchApp -> attachSurface -> readFrame`，写入当前会话 session/display/window/live-surface/frame-stream/current-frame/surfaceTransport/frameTransport/telemetry refs；缺 `xpra`、frame capture、isolated input readiness、target window 或 capture result 时 fail closed。默认 runtime 不自动启用真实副作用，不使用 noVNC/Xvfb/RDP/QEMU 或 browser shortcut fallback。Evidence refs：`src/runtime/computer-use/native-providers/linux-xpra-driver-helpers.ts`、`src/runtime/computer-use/native-providers/linux-xpra-virtual-display-driver.ts`、`src/runtime/computer-use/native-providers/linux-xpra-virtual-display-driver.test.ts`、`src/runtime/computer-use/native-providers/linux-xpra-virtual-display-provider.ts`、`src/runtime/computer-use/virtual-app-screen-native-executor.ts`；验证：`node --import tsx --test src/runtime/computer-use/native-providers/linux-xpra-virtual-display-driver.test.ts src/runtime/computer-use/native-providers/platform-virtual-display-provider-shell.test.ts src/runtime/computer-use/virtual-app-screen-native-executor.test.ts`。
  - [x] 2026-06-02 增加 Windows IDD opt-in native driver hook factory：`createWindowsIddVirtualDisplayDriverHooks(...)` 通过显式注入的 generic IDD driver deps 执行 `probe -> createSession -> launchApp -> attachSurface -> readFrame`，写入当前会话 session/display/window/live-surface/frame-stream/current-frame/surfaceTransport/frameTransport/telemetry refs；缺 win32 host、IDD driver API、driver install、`permission:windows/idd-driver-authorized`、window 或 capture API 时 fail closed。默认 runtime 不自动启用真实副作用，不使用 RDP/QEMU/Browser/DOM/Playwright shortcut fallback。Evidence refs：`src/runtime/computer-use/native-providers/windows-idd-virtual-display-driver.ts`、`src/runtime/computer-use/native-providers/windows-idd-virtual-display-driver.test.ts`、`src/runtime/computer-use/native-providers/windows-idd-virtual-display-provider.ts`、`src/runtime/computer-use/virtual-app-screen-native-executor.ts`；验证：`node --import tsx --test src/runtime/computer-use/native-providers/windows-idd-virtual-display-driver.test.ts`。
  - [ ] Linux Xpra / Windows IDD opt-in factories 仍需当前真实 host、driver/command、permission、window 和 capture evidence 后才能声明真实平台 create/launch/attach/readFrame 可用；当前 factory/fake dependency tests 不代表产品 live pass。
  - [x] 2026-06-02 Provider session ownership store / reconnect contract 已接通：attach 后记录 `providerSessionOwnerRef` / `providerSessionReconnectRef` / `liveBindingAttachGrantRef`、原 `sessionRef` / `liveSurfaceRef` / `frameStreamRef` / `surfaceTransportRef`；`/computer-use screen reconnect` 只能 revalidate 当前 store record、推进 `currentFrameRef/currentFrameSequence`，不会 create/launch/attach 第二个 session；right pane blocked/current-session payload 会发 refs-first reconnect command，registry/host adapter 保留并校验同一 provider session refs 和 session-manager attach grant。Evidence refs：`src/runtime/computer-use/virtual-app-screen-provider-session-store.ts`、`src/runtime/computer-use/virtual-app-screen-session-manager.ts`、`src/runtime/computer-use/virtual-app-screen-command.ts`、`src/runtime/vision-sense-runtime.ts`、`src/ui/src/app/results/rightPaneScreenController.ts`、`src/ui/src/app/results/rightPaneLiveBindingRegistry.ts`、`src/ui/src/app/results/screenPaneHostAdapter.tsx`；验证：`node --import tsx --test src/runtime/computer-use/virtual-app-screen-command.test.ts src/runtime/computer-use/virtual-app-screen-session-manager.test.ts src/runtime/vision-sense-runtime.test.ts src/ui/src/app/results/rightPaneScreenController.test.ts src/ui/src/app/results/rightPaneLiveBindingRegistry.test.ts src/ui/src/app/results/screenPaneHostAdapter.test.ts src/ui/src/app/results/screenPaneModel.test.ts`。
  - [x] 2026-06-02 增加产品 smoke：打开 SciForge UI，切到 `Screen`，断言不是长期 `no-session`，并输出 live frame 或明确 blocked manifest。Evidence refs：`tests/smoke/smoke-virtual-app-screen-dogfood-product.test.ts`、`docs/runbooks/virtual-app-screen-dogfood-runbook.md`；验证：`npm run smoke:virtual-app-screen-dogfood-product --silent`。
  - [x] 2026-06-02 Native provider shells / opt-in drivers 新增 evidence-written gate：ready hooks 必须返回 hook-owned required refs 且声明 `providerEvidenceWritten=true`；opt-in drivers 的 probe/create/launch/attach/readFrame 写 adapter/session/window/live-surface/frame/transport evidence records，input/control hook 缺 evidence-written proof、缺 refs、stale session 或缺 mutation proof 都 fail closed。Evidence refs：`src/runtime/computer-use/native-providers/macos-virtual-display-provider.ts`、`src/runtime/computer-use/native-providers/platform-virtual-display-provider-shell.ts`、`src/runtime/computer-use/native-providers/macos-virtual-display-driver.ts`、`src/runtime/computer-use/native-providers/linux-xpra-virtual-display-driver.ts`、`src/runtime/computer-use/native-providers/windows-idd-virtual-display-driver.ts`、`src/runtime/computer-use/native-providers/native-driver-input-control.ts`；验证：`node --import tsx --test src/runtime/computer-use/native-providers/macos-virtual-display-provider.test.ts src/runtime/computer-use/native-providers/platform-virtual-display-provider-shell.test.ts src/runtime/computer-use/native-providers/macos-virtual-display-driver.test.ts src/runtime/computer-use/native-providers/linux-xpra-virtual-display-driver.test.ts src/runtime/computer-use/native-providers/windows-idd-virtual-display-driver.test.ts`。
  - [x] 2026-06-02 Native executor 增加 provider operation-chain consistency gate：`probe -> createSession -> launchApp -> attachSurface -> readFrame` 必须同 provider/currentRun/session/targetWindow/liveSurface/frameStream/surfaceTransport/evidenceLedger，`readFrame.currentFrameSequence` 不能倒退；跨 run、跨 session 或 stale frame refs fail closed。Evidence refs：`src/runtime/computer-use/virtual-app-screen-native-executor.ts`、`src/runtime/computer-use/virtual-app-screen-native-executor.test.ts`；验证：`node --import tsx --test src/runtime/computer-use/virtual-app-screen-native-executor.test.ts`。
  验证：`node --import tsx --test packages/presentation/components/virtual-screen-viewer/render.test.tsx src/runtime/computer-use/virtual-display-provider.test.ts src/ui/src/app/ResultsRenderer.test.ts src/ui/src/app/results/screenPaneModel.test.ts src/ui/src/app/results/screenPaneHostAdapter.test.ts src/ui/src/app/results/rightPaneScreenController.test.ts tests/smoke/virtual-app-screen-vscode-smoke.test.ts tests/smoke/virtual-app-screen-research-workflow.test.ts tests/smoke/smoke-virtual-app-screen-dogfood-product.test.ts`；状态：activation/blocked path complete, real native attach/live-frame proof pending。

- [ ] P0-CU-VAS-NATIVE-HOST-ONE-TRUTH：`NativeVirtualAppScreenHost` 是唯一权威控制面。
  验收：当前产品只接受 package-owned Native Host 创建/验证的本地原生 app + 平台 virtual display / app surface session。macOS provider 可以使用 CGVirtualDisplay / ScreenCaptureKit / Swift helper / `node-mac-virtual-display` 类底层 bridge；Linux provider 可以使用 Xpra/headless compositor；Windows provider 可以使用 IDD virtual display driver。底层 provider、DeskPad/BetterDisplay/Mirage/Sunshine/noVNC/RDP/QEMU/VM、shell-only runner、旧截图和 browser shortcut 都不能直接作为 contract truth、host grant、input executor 或 fallback pass。
  当前状态：部分完成。原 `VirtualDisplayProvider` contract/gate 已完成：provider availability 通过 readiness/probe refs 表达，缺 provider/driver/permission 只能 `blocked` / `permission-missing`。但终局 C 的 host-owned control plane 尚未 package 化，provider shell 的 evidence-written 布尔声明仍需被 host-owned ledger/hash/current-run ownership 复验。
  TODO：
  - [x] 2026-06-02 定义 `VirtualDisplayProvider` L1 adapter interface：`probe`、`createSession`、`launchApp`、`attachSurface`、`readFrame`、`sendInputIntent`、`closeSession`。Evidence refs：`src/runtime/computer-use/virtual-display-provider.ts`、`src/runtime/computer-use/virtual-display-provider.test.ts`。
  - [x] 2026-06-02 为 macOS / Linux / Windows 写 readiness record：provider kind、install state、permissions、background renderability、physical desktop impact、input isolation、blocked reason。Evidence refs：`src/runtime/computer-use/virtual-display-provider.ts`。
  - [x] 2026-06-02 删除或降级所有 fallback pass 语义；没有 provider 时只能返回 `blocked` 或 `permission-missing`，VNC/noVNC/RDP/MJPEG 仅为 diagnostic-only。Evidence refs：`src/runtime/computer-use/virtual-display-provider.ts`、`tests/smoke/cu-next-live-acceptance-matrix.test.ts`。
  - [x] 2026-06-02 provider 输出的 `liveSurfaceRef` / `frameStreamRef` / `currentFrameRef` / frame transport contract 是唯一 interactive truth；replay、snapshot、old frame 只能作为 evidence。Evidence refs：`src/runtime/computer-use/virtual-display-provider.ts`。
  - [x] 2026-06-02 纯 `VirtualDisplayProvider` contract/projection 调用明确 `providerExecuted=false`；native executor 会拒绝 projection-only provider，防止仅凭合成 refs 冒充真实本地 app session。Evidence refs：`src/runtime/computer-use/virtual-display-provider.ts`、`src/runtime/computer-use/virtual-app-screen-native-executor.ts`、`src/runtime/computer-use/virtual-app-screen-native-executor.test.ts`。
  验证：`node --import tsx --test src/runtime/computer-use/virtual-display-provider.test.ts`；`npm run smoke:virtual-app-screen-user-acceptance-contract --silent`；`npm run smoke:cu-next-live-acceptance --silent`；状态：provider contract/gate landed, Native Host one-truth package and host-owned evidence verification pending。

- [ ] P0-CU-VAS-VSCODE-CLOSED-LOOP：首个本地 VSCode 闭环。
  验收：`NativeVirtualAppScreenHost` 在 agent-owned virtual display / app surface 中启动 VSCode，右侧 `Screen` present 同一 host-owned live surface；人类或 Computer Use 发送一次低风险输入；UI 和 manifest 返回 input accepted / automation barrier、before/after frame refs、executor event refs、verification refs 和 bounded evidence ledger。不能通过 shell 直接写文件或旧截图伪造完成。
  当前状态：部分完成。VSCode/editor profile、smoke scaffold、provider lifecycle evidence 和 macOS native provider-executed smoke 已存在；缺 SciForge 右栏产品路径中“right pane -> runtime -> package-owned Host -> 启动 VSCode -> Screen present live surface -> 输入 -> before/after evidence”的 user-level 闭环，manifest 仍保持 `userAcceptanceEligible=false` 直到 product-path evidence 齐全。
  TODO：
  - [x] 2026-06-02 固定 VSCode/editor profile 的 app identity、workspace target、window placement、allowed actions 和 safe close policy。Evidence refs：`tools/computer-use-next/vscode-virtual-app-screen-bridge.ts`、`tools/computer-use-next/virtual-app-screen-vscode-smoke.ts`、`tests/smoke/virtual-app-screen-vscode-smoke.test.ts`；验证：`node --import tsx --test tests/smoke/virtual-app-screen-vscode-smoke.test.ts`。
  - [x] 2026-06-02 VSCode smoke 显式串联 provider lifecycle refs：`createSession`、`launchApp`、`attachSurface`、`readFrame`、`sendInputIntent`，并写入 replay、evidence ledger、live surface、input intent 和 executor event records。Evidence refs：`tools/computer-use-next/virtual-app-screen-vscode-smoke.ts`、`tests/smoke/virtual-app-screen-vscode-smoke.test.ts`；验证：`node --import tsx --test tests/smoke/virtual-app-screen-vscode-smoke.test.ts`。
  - [x] 2026-06-02 VSCode smoke lifecycle evidence 区分 projection 与真实执行：`createVirtualDisplayProviderContract()` 生成的 lifecycle invoke/result 保持 `providerExecuted=false`，只有 provider-executed completion records 标记 `providerExecuted=true`，防止 synthetic refs 冒充 native product pass。Evidence refs：`tools/computer-use-next/virtual-app-screen-vscode-smoke.ts`、`tests/smoke/virtual-app-screen-vscode-smoke.test.ts`；验证：`node --import tsx --test tests/smoke/virtual-app-screen-vscode-smoke.test.ts`。
  - [x] 2026-06-02 provider-executed native smoke 创建 agent-owned macOS virtual display，真实启动 VSCode，并把窗口绑定到 virtual display 内的 `targetWindowRef`。Evidence refs：`/tmp/sciforge-vas-vscode-live-check/virtual-display-provider/provider-execution.json`、`/tmp/sciforge-vas-vscode-live-check/virtual-display-provider/app-launch/vscode.json`、`/tmp/sciforge-vas-vscode-live-check/virtual-display-provider/live-surface.json`；验证：`node --import tsx tools/computer-use-next/virtual-app-screen-vscode-smoke.ts --out-dir /tmp/sciforge-vas-vscode-live-check --run-id sciforge-vas-vscode-live-check --provider-executed`。
  - [x] 2026-06-02 SciForge 产品 runtime 已接收右栏 `/computer-use screen attach` terminal-equivalent command 并 fail closed 成当前 run `VirtualAppScreen` artifact；它不会把 contract/provider projection 冒充 VSCode product pass。Evidence refs：`src/runtime/computer-use/virtual-app-screen-command.ts`、`src/runtime/vision-sense-runtime.ts`、`tests/smoke/smoke-virtual-app-screen-dogfood-product.test.ts`。
  - [x] 2026-06-02 VSCode/native smoke 被明确隔离在 smoke 工具；产品 runtime 新增 session manager 契约，防止把 `buildVirtualDisplayScreenPayload` / smoke projection 当作真实 VSCode product session。Evidence refs：`src/runtime/computer-use/virtual-app-screen-session-manager.ts`、`src/runtime/computer-use/virtual-app-screen-session-manager.test.ts`。
  - [ ] 产品 runtime 仍需把已接收的 attach request 接到上述 native create/launch/attach 路径；当前 native smoke 不声称 SciForge 右栏产品 runtime 已自动 launch，也不是持久 right-pane session manager。
  - [ ] Screen pane 消费真实 provider session 的同一 `liveSurfaceRef`，展示当前 frame、agent cursor、人类 cursor、input lease 状态和 evidence refs；当前仅证明 artifact/live refs 进入 viewer/registry 时不会被改写。
  - [x] 2026-06-02 provider-executed native smoke 已发送最小非破坏性真实输入：focus temp workspace artifact、type short text、保存临时 workspace artifact，并验证 before/after。Evidence refs：`/tmp/sciforge-vas-vscode-live-check/virtual-display-provider/input-intents/click-and-type.json`、`/tmp/sciforge-vas-vscode-live-check/virtual-display-provider/executor-events/click-and-type.json`、`/tmp/sciforge-vas-vscode-live-check/virtual-display-provider/before-after/input.json`、`/tmp/sciforge-vas-vscode-live-check/virtual-display-provider/verification/vscode-input.json`；状态：`providerReady=true executionEvidenceComplete=true userAcceptanceEligible=false`。
  - [ ] 右栏产品路径仍需发送同一类非破坏性输入，并由 right pane / dogfood manifest 证明。
  - [x] 2026-06-02 manifest 必须声明 `userAcceptanceEligible=false` 直到 isolation、artifact、gui.present、before/after 和 verifier 全部来自当前 run。Evidence refs：`tools/computer-use-next/virtual-app-screen-vscode-smoke.ts`、`tests/smoke/virtual-app-screen-vscode-smoke.test.ts`；验证：`npm run smoke:virtual-app-screen-user-acceptance-contract --silent`。
  验证：`node --import tsx --test tests/smoke/virtual-app-screen-vscode-smoke.test.ts`；状态：VSCode profile/contract complete, real native closed-loop pending。

- [ ] P0-CU-VAS-RIGHT-PANE-LIVE-BINDING：右侧结果栏绑定 live frame。
  验收：`Screen` pane 默认展示当前 active `VirtualAppScreen` 的 host-owned live surface、actor cursors、annotation overlay、lease state、blocked/permission state、timeline 和 refs。`Results` / `Screen` / workspace focus 切换不能丢 host session；多个 screen window 要展示各自真实运行的 app surface。Right pane 只能用 host-issued `surfaceTransportDescriptor` + `liveBindingAttachGrantRef` attach；真实 host bridge 必须 dereference grant 并校验 current provider-session record 后才 present。
  当前状态：部分完成。Right pane 已能消费当前 run 的 Screen payload、保留 host-owned live refs 和 `surfaceTransport` refs、显示 blocked/permission/observe-only state，并在 Screen tab activation 时发 `gui.present` / activation refs；host adapter 只通过 provider-owned presentation bridge 绑定 live surface；runtime/UI reconnect contract 已能复验同一 provider session，不创建第二个 truth source。Session manager 已 mint `liveBindingAttachGrantRef`，runtime artifact / right pane model / host attach request / reconnect command 均透传并要求该 grant；Model/host 已降级缺 platform driver ready、permission ready、providerExecuted、provider owner/reconnect、session-manager attach grant、safe surfaceTransport descriptor、ledger 或 current sequence 的 live-looking artifacts。真实 Native Host bridge 对 grant record 的实际 dereference/validation、native media/data channel、多 screen 真实平台 evidence 和可操作刷新率仍需平台 evidence。
  TODO：
  - [x] 2026-06-02 让 result pane model 支持 active screen registry：`screenRef -> sessionRef -> liveSurfaceRef/currentFrameRef/blockedReason`，并保持 refs-first。Evidence refs：`src/ui/src/app/results/rightPaneLiveBindingRegistry.ts`、`src/ui/src/app/results/rightPaneLiveBindingRegistry.test.ts`；验证：focused CU suite 51/51 passed。
  - [x] 2026-06-02 实作 Screen tab activation 时的 `gui.present` / activation event refs，保证 right pane 不长期停留 placeholder。Evidence refs：`src/ui/src/app/results/rightPaneScreenController.ts`、`src/ui/src/app/ResultsRenderer.tsx`、`src/ui/src/app/results/rightPaneSurfaceAdapter.tsx`；验证：right-pane aggregate suite 137/137 passed。
  - [x] 2026-06-02 多 screen window 的 activation placeholders 使用 tab-scoped refs，不共享 `screenRef`、`handoffRef`、readiness 或 blocked refs。Evidence refs：`src/ui/src/app/results/rightPaneLiveBindingRegistry.ts`、`src/ui/src/app/results/screenPaneModel.ts`、`src/ui/src/app/results/screenPaneModel.test.ts`；验证：focused CU suite 51/51 passed。
  - [x] 2026-06-02 Registry model 覆盖 restore/reconnect 样式更新时保留同一 screen 的 live binding refs。Evidence refs：`src/ui/src/app/results/rightPaneLiveBindingRegistry.test.ts`；验证：focused CU suite 51/51 passed。
  - [x] 2026-06-02 Registry 覆盖 resize / tab switch reconnect checkpoint，保留同一 `sessionRef`、`liveSurfaceRef`、`frameStreamRef`、`surfaceTransport` 和 readiness/evidence refs，拒绝跨 screen 复用。Evidence refs：`src/ui/src/app/results/rightPaneLiveBindingRegistry.ts`、`src/ui/src/app/results/rightPaneLiveBindingRegistry.test.ts`；验证：`node --import tsx --test src/ui/src/app/results/rightPaneLiveBindingRegistry.test.ts src/ui/src/app/results/screenPaneModel.test.ts`。
  - [x] 2026-06-02 Active run 中的 blocked/fail-closed `computer-use-virtual-screen` artifact 会被 right pane payload 原样消费 `screenRef`、`adapterReadinessRef`、handoff/permission/evidence/gui-present refs，且不会伪造 `sessionRef`、`liveSurfaceRef`、`currentFrameRef`。Evidence refs：`src/ui/src/app/results/screenPaneModel.test.ts`；验证：`node --import tsx --test src/ui/src/app/results/screenPaneModel.test.ts src/ui/src/app/results/rightPaneLiveBindingRegistry.test.ts`。
  - [x] 2026-06-02 Screen host adapter 新增 refs-only live presentation attach effect：只在 live/attached、安全 refs、完整 isolation、session-manager attach grant 和非零 bounds 时调用可选 provider-owned `attach/present/detachVirtualAppScreenSurface` bridge；UI 不导入 executor、不拥有 session。Evidence refs：`src/ui/src/app/results/screenPaneHostAdapter.tsx`、`src/ui/src/app/results/screenPaneHostAdapter.test.ts`；验证：`node --import tsx --test src/ui/src/app/results/screenPaneHostAdapter.test.ts src/ui/src/app/results/screenPaneModel.test.ts src/ui/src/app/results/rightPaneLiveBindingRegistry.test.ts`。
  - [x] 2026-06-02 产品 runtime / UI 已接通 provider registry 与 host session store 的 reconnect contract：`screen-reconnect` route 跳过 executor bootstrap，只复验现有 provider-session store；right pane checkpoint 比较 expected/observed `sessionRef`、`liveSurfaceRef`、`frameStreamRef`、`providerSessionOwnerRef`、`providerSessionReconnectRef` 和 `liveBindingAttachGrantRef`，缺失或 mismatch 写 blocked evidence；host attach request 透传 owner/reconnect/grant/surfaceTransport/currentFrameSequence refs。Evidence refs：`src/runtime/computer-use/virtual-app-screen-provider-session-store.ts`、`src/runtime/computer-use/virtual-app-screen-session-manager.ts`、`src/runtime/vision-sense-runtime.ts`、`src/ui/src/app/results/rightPaneLiveBindingRegistry.ts`、`src/ui/src/app/results/screenPaneHostAdapter.tsx`；验证：`node --import tsx --test src/runtime/computer-use/virtual-app-screen-session-manager.test.ts src/runtime/vision-sense-runtime.test.ts src/ui/src/app/results/rightPaneLiveBindingRegistry.test.ts src/ui/src/app/results/screenPaneHostAdapter.test.ts src/ui/src/app/results/rightPaneScreenController.test.ts`。
  - [x] 2026-06-02 Right pane model/host live gate 收紧：active run 中 shape-compatible 但缺 `platformDriverStatus=ready`、permission ready、`providerExecuted=true`、provider owner/reconnect、session-manager `liveBindingAttachGrantRef`、safe surfaceTransport descriptor、ledger 或 current sequence 的 artifacts 一律降级为 replay/empty，host 不调用 `attachVirtualAppScreenSurface`。Evidence refs：`src/ui/src/app/results/screenPaneModel.ts`、`src/ui/src/app/results/screenPaneModel.test.ts`、`src/ui/src/app/results/screenPaneHostAdapter.tsx`、`src/ui/src/app/results/screenPaneHostAdapter.test.ts`；验证：`node --import tsx --test src/ui/src/app/results/screenPaneModel.test.ts src/ui/src/app/results/screenPaneHostAdapter.test.ts`。
  - [x] 2026-06-02 Session-manager-issued live attach grant contract 已落地：provider-session store mint `liveBindingAttachGrantRef`；runtime attached/reconnect artifact 输出 top-level `surfaceTransportDescriptor` + grant；right pane controller reconnect command 必须带 grant；host attach request 必须带 grant，缺 grant 或 unsafe grant fail closed。Evidence refs：`src/runtime/computer-use/virtual-app-screen-provider-session-store.ts`、`src/runtime/computer-use/virtual-app-screen-session-manager.ts`、`src/runtime/computer-use/virtual-app-screen-command.ts`、`src/runtime/vision-sense-runtime.ts`、`src/ui/src/app/results/screenPaneModel.ts`、`src/ui/src/app/results/screenPaneHostAdapter.tsx`、`src/ui/src/app/results/rightPaneScreenController.ts`；验证：`node --import tsx --test src/runtime/computer-use/virtual-app-screen-command.test.ts src/runtime/computer-use/virtual-app-screen-session-manager.test.ts src/runtime/vision-sense-runtime.test.ts src/ui/src/app/results/screenPaneModel.test.ts src/ui/src/app/results/screenPaneHostAdapter.test.ts src/ui/src/app/results/rightPaneScreenController.test.ts src/ui/src/app/results/rightPaneLiveBindingRegistry.test.ts packages/presentation/components/virtual-screen-viewer/render.test.tsx`。
  - [ ] 真实 Native Host bridge 仍需在 `attach/presentVirtualAppScreenSurface` 执行前 dereference / validate `liveBindingAttachGrantRef` 对应的 runtime provider-session record；当前 UI/command/renderer 已 fail closed 要求 grant，但不能把仅有 artifact 字段当作用户级 live proof。
  - [x] 2026-06-02 如果 Screen 只能 observe，UI 明确 `observe-only` 并禁用控制输入。Evidence refs：`packages/presentation/components/virtual-screen-viewer/render.tsx`、`packages/presentation/components/virtual-screen-viewer/render.test.tsx`；验证：right-pane aggregate suite 137/137 passed。
  验证：right-pane/runtime focused suite 88/88 passed；状态：presentation/live-ref binding + provider-session reconnect/grant contract complete when refs exist, real host-bridge grant validation and multi-screen platform evidence pending。

- [ ] P0-CU-VAS-PERMISSION-HANDOFF：缺权限时辅助授权并 fail closed。
  验收：缺 Screen Recording、Accessibility、driver/system extension、app automation 或 provider install 时，SciForge 不能伪造可用状态。UI 必须展示具体缺失项、授权步骤、重试按钮和 recheck refs；授权完成后重新 probe 并继续创建 session。
  当前状态：部分完成。UI payload、viewer 和 right-pane controller 已生成 macOS / Linux / Windows handoff/recheck refs；产品 runtime 已能接收 `/computer-use permission-handoff` / `permission-recheck`。`permission-handoff` 永远 presentation-only 且不执行 provider；`permission-recheck` 在注册 executor 就绪时可继续 attach，否则返回 refs-first fail-closed artifact。真实系统授权完成后的平台 provider side-effect 接入仍待完成。
  TODO：
  - [x] 2026-06-02 为 macOS Screen Recording、Accessibility、Automation、virtual display helper install 定义 permission preflight 和 repair hints refs。Evidence refs：`src/ui/src/app/results/screenPaneModel.ts`、`src/ui/src/app/results/screenPaneModel.test.ts`。
  - [x] 2026-06-02 为 Linux Xpra install/session permission 和 Windows IDD driver install 定义 handoff/recheck refs；安装/授权需要用户确认。Evidence refs：`src/ui/src/app/results/screenPaneModel.ts`、`src/runtime/computer-use/virtual-display-provider.ts`。
  - [x] 2026-06-02 授权流程产生 `permissionHandoffRef`、`recheckRef`、`providerReadinessRef` 和 UI evidence。Evidence refs：`src/ui/src/app/results/rightPaneScreenController.ts`、`packages/presentation/components/virtual-screen-viewer/render.tsx`。
  - [x] 2026-06-02 授权未完成前，Computer Use run 必须 `blocked` 或 `requires-handoff`，不得落到真实桌面输入。Evidence refs：`src/ui/src/app/results/rightPaneScreenController.ts`、`src/runtime/computer-use/virtual-display-provider.ts`。
  - [x] 2026-06-02 产品 runtime 早期接收 permission handoff/recheck terminal-equivalent command；handoff 在 session manager 顶层短路为 `requires-handoff` 且即使存在注册 executor 也不执行 provider 或系统输入。Evidence refs：`src/runtime/computer-use/virtual-app-screen-command.ts`、`src/runtime/computer-use/virtual-app-screen-session-manager.ts`、`src/runtime/computer-use/virtual-app-screen-session-manager.test.ts`。
  - [x] 2026-06-02 `permission-recheck` 在注册 executor 返回完整 native evidence 时可继续 materialize `attached` live refs；无 executor、dry-run 或 provider 未就绪仍 fail closed。Evidence refs：`src/runtime/vision-sense-runtime.ts`、`src/runtime/vision-sense-runtime.test.ts`。
  - [x] 2026-06-02 macOS opt-in driver probe 已能表达 provider install、`screencapture` command、Screen Recording 和 Accessibility readiness；缺任一项时返回 blocked/permission-missing、`providerExecuted=true`、refs-first readiness evidence，且不写 raw payload。Evidence refs：`src/runtime/computer-use/native-providers/macos-virtual-display-driver.ts`、`src/runtime/computer-use/native-providers/macos-virtual-display-driver.test.ts`；验证：`node --import tsx --test src/runtime/computer-use/native-providers/macos-virtual-display-driver.test.ts`。
  - [x] 2026-06-02 Windows IDD opt-in driver probe 已能表达 win32 host、IDD driver API/install、`permission:windows/idd-driver-authorized` 和 capture API readiness；缺任一项时返回 blocked/permission-missing、`providerExecuted=true`、refs-first readiness evidence，且不写 raw payload。Evidence refs：`src/runtime/computer-use/native-providers/windows-idd-virtual-display-driver.ts`、`src/runtime/computer-use/native-providers/windows-idd-virtual-display-driver.test.ts`；验证：`node --import tsx --test src/runtime/computer-use/native-providers/windows-idd-virtual-display-driver.test.ts`。
  - [ ] 授权完成后重新 probe 并继续 create/attach session 的产品路径仍需接入；当前只验证了 runtime continuation contract 和 macOS opt-in driver probe，不代表 SciForge 右栏 post-authorization live attach 已通过。
  验证：right-pane aggregate suite 137/137 passed；`npm run smoke:virtual-app-screen-user-acceptance-contract --silent`；`PYTHONPATH=packages/actions/computer-use python3 -m pytest packages/actions/computer-use/tests/test_virtual_app_screen_user_acceptance.py -q`；状态：permission handoff/fail-closed UI complete, post-authorization native continuation pending。

- [ ] P0-CU-VAS-HUMAN-INTERVENTION：人类可介入同一虚拟屏幕。
  验收：人类能在右侧 `Screen` 中 observe、take over、pause agent、resume agent、send input、stop session；agent 和 user cursor / input lease 清晰可见。真人输入走 Host `sendHumanInput` hot path：mouse/key events 入 host queue 后立刻返回 `inputAcceptedRef` / sequence，frame stream 和 evidence worker 后台追上；不得被截图、OCR、snapshot、ledger 或 verifier 等待阻塞。自动化动作仍走 `executeAutomationIntent`，必须等待 automation barrier、after frame、verification 和 evidence ledger。
  当前状态：部分完成。Viewer/control-plane 已呈现 actor cursor、lease owner、takeover/pause/resume/stop，并把人类输入/介入转成 terminal-equivalent `InputIntent` / lease commands；产品 runtime 已能接收 canvas input 和 lease-control commands，无 executor 时写 refs-first blocked evidence，有注册 runtime-owned input executor 时要求 provider evidence 后才返回 `done`。takeover/pause/resume/stop 已要求 provider-owned queue/current-frame-refresh/safe-stop evidence；input runtime executed path 只接受非 probe provider action refs，并校验 session/inputLease/actionAdapter/currentRun/before-after/verification/ledger 一致；macOS / Linux Xpra / Windows IDD opt-in driver factory 已暴露注入式 input/control hook 面并校验 provider-owned refs、`providerEvidenceWritten=true` 和 mutation proof。真实 Native Host 侧 fire-and-release human input queue、agent queue pause/resume 和 safe stop OS hook 执行仍需接入。
  TODO：
  - [x] 2026-06-02 定义 user lease、agent lease、takeover、pause、resume、stop 的状态机和 refs。Evidence refs：`packages/presentation/components/virtual-screen-viewer/render.tsx`、`packages/presentation/components/virtual-screen-viewer/render.test.tsx`。
  - [x] 2026-06-02 Screen overlay 显示 agent cursor、user cursor、active lease owner、pending action proposal 和 blocked reason。Evidence refs：`packages/presentation/components/virtual-screen-viewer/render.tsx`。
  - [x] 2026-06-02 人类输入通过 terminal-equivalent text / `InputIntent` 提交给 Computer Use provider adapter；GUI 不直接执行 backend action。Evidence refs：`packages/presentation/components/virtual-screen-viewer/render.tsx`、`src/ui/src/app/results/screenPaneHostAdapter.tsx`。
  - [ ] Native Host 必须拆出 `sendHumanInput` hot path：点击、抬起、键盘、拖拽进入 host input queue 后立即 ack；后台 evidence worker 补写 frame/input refs，不能阻塞人类交互体感。
  - [ ] 自动化动作必须走 `executeAutomationIntent` barrier：等待 action ack、fresh after-frame、verification/evidence refs；不能复用人类 fire-and-release ack 作为 automation completion。
  - [x] 2026-06-02 Provider lifecycle contract 已提供 `pause`、`resume`、`handoff`、`closeSession` refs，并在 blocked/permission 状态 fail closed。Evidence refs：`src/runtime/computer-use/virtual-display-provider.ts`、`src/runtime/computer-use/virtual-display-provider.test.ts`；验证：focused CU suite 51/51 passed。
  - [x] 2026-06-02 产品 runtime 早期接收 `/computer-use input-intent --source virtual-app-screen-canvas|virtual-app-screen-control ...`：canvas input 和 takeover/pause/resume/stop 都生成当前 session `InputIntent` / lease / executor / verification / blocked refs；无 provider executor 时 fail closed 且不落入 package bridge。Evidence refs：`src/runtime/computer-use/input-intent-command.ts`、`src/runtime/computer-use/virtual-app-screen-input-runtime.ts`、`src/runtime/vision-sense-runtime.ts`；验证：`node --import tsx --test src/runtime/computer-use/input-intent-command.test.ts src/runtime/computer-use/virtual-app-screen-input-runtime.test.ts src/runtime/vision-sense-runtime.test.ts`。
  - [x] 2026-06-02 增加 runtime-owned input executor registry：注册 executor 时 canvas input 映射 `sendInputIntent`，takeover/pause 映射 `pause`，resume 映射 `resume -> readFrame`，stop 映射 `closeSession`；必须有 `providerExecuted=true`、非 raw payload、controllable readiness、before/after、executor event、verification 和 evidence ledger refs，否则 fail closed。Evidence refs：`src/runtime/computer-use/virtual-app-screen-input-runtime.ts`、`src/runtime/computer-use/virtual-app-screen-input-runtime.test.ts`、`src/runtime/vision-sense-runtime.test.ts`；验证：`node --import tsx --test src/runtime/computer-use/virtual-app-screen-input-runtime.test.ts src/runtime/vision-sense-runtime.test.ts`。
  - [x] 2026-06-02 默认 macOS input provider shell 已接入 runtime bootstrap；无真实 hook 时返回 provider-backed blocked/permission evidence，产品 source-specific input executor 仍优先。Evidence refs：`src/runtime/computer-use/virtual-app-screen-runtime-executors.ts`、`src/runtime/computer-use/virtual-app-screen-runtime-executors.test.ts`；验证：`node --import tsx --test src/runtime/computer-use/virtual-app-screen-runtime-executors.test.ts src/runtime/vision-sense-runtime.test.ts src/runtime/computer-use/virtual-app-screen-input-runtime.test.ts`。
  - [x] 2026-06-02 Runtime 控制路径新增 provider-owned evidence gate：takeover/pause 必须返回 `agentQueueRef` 且 queue status 为 paused；resume 必须 `resume -> readFrame` 并返回 `currentFrameRefreshRef`；stop 必须返回 `safeStopRef` 和 `safe-close-or-pause-virtual-session-only` policy；缺任一 refs 都 fail closed，不把 runtime 合成 refs 当 provider 执行。Evidence refs：`src/runtime/computer-use/virtual-app-screen-input-runtime.ts`、`src/runtime/computer-use/virtual-app-screen-input-runtime.test.ts`；验证：`node --import tsx --test src/runtime/computer-use/virtual-app-screen-input-runtime.test.ts`。
  - [x] 2026-06-02 macOS / Linux Xpra / Windows IDD opt-in native driver factories 新增注入式 `sendInputIntent`、`pauseAgentQueue`、`resumeAgentQueue`、`safeStopSession` hook 面；只有真实 hook 返回 provider-owned `inputIntentRefs`、`executorEventRefs`、before/after、verification、`agentQueueRef` / `currentFrameRefreshRef` / `safeStopRef` 时才 ready，缺 hook 或缺 refs 时 fail closed，且不写 raw payload。Evidence refs：`src/runtime/computer-use/native-providers/native-driver-input-control.ts`、`src/runtime/computer-use/native-providers/macos-virtual-display-driver.ts`、`src/runtime/computer-use/native-providers/linux-xpra-virtual-display-driver.ts`、`src/runtime/computer-use/native-providers/windows-idd-virtual-display-driver.ts`；验证：`node --import tsx --test src/runtime/computer-use/native-providers/macos-virtual-display-driver.test.ts src/runtime/computer-use/native-providers/linux-xpra-virtual-display-driver.test.ts src/runtime/computer-use/native-providers/windows-idd-virtual-display-driver.test.ts src/runtime/computer-use/virtual-app-screen-input-runtime.test.ts src/runtime/computer-use/virtual-app-screen-runtime-executors.test.ts`。
  - [x] 2026-06-02 Input runtime executed path 移除 command/probe refs 补足：`sendInputIntent` / `pause` / `resume` / `readFrame` / `closeSession` 必须返回 matching `sessionRef`、`inputLeaseRef`、`actionAdapterRef`、`currentRunRef`、before/after、verification 和 `evidenceLedgerRef`；resume 的 fresh frame 必须属于同一 session；provider 只回传 command refs、probe refs、stale session 或缺 evidence-written proof 时 fail closed。Evidence refs：`src/runtime/computer-use/virtual-app-screen-input-runtime.ts`、`src/runtime/computer-use/virtual-app-screen-input-runtime.test.ts`、`src/runtime/computer-use/native-providers/native-driver-input-control.ts`、`src/runtime/computer-use/native-providers/macos-virtual-display-driver.test.ts`、`src/runtime/computer-use/native-providers/linux-xpra-virtual-display-driver.test.ts`、`src/runtime/computer-use/native-providers/windows-idd-virtual-display-driver.test.ts`；验证：`node --import tsx --test src/runtime/computer-use/virtual-app-screen-input-runtime.test.ts src/runtime/computer-use/native-providers/macos-virtual-display-driver.test.ts src/runtime/computer-use/native-providers/linux-xpra-virtual-display-driver.test.ts src/runtime/computer-use/native-providers/windows-idd-virtual-display-driver.test.ts`。
  - [ ] 真实 agent action queue OS/provider hooks 仍需接入：人类 takeover 时实际 pause queue；恢复时重新读取 current frame 和 state，并由 provider-owned queue/current-frame refs 证明。
  - [ ] Stop 的真实 provider hook 仍需安全关闭或 pause virtual session，避免关闭用户真实 app/window；runtime 和 driver factory 已要求 `safeStopRef` / safe-stop policy，但平台 OS 实现还需当前 provider evidence。
  验证：right-pane aggregate suite 137/137 passed；`npm run smoke:virtual-app-screen-lifecycle-contract --silent`；状态：viewer/control command + runtime/driver evidence gate complete, provider lease execution pending。

- [ ] P0-CU-VAS-EVIDENCE-LEDGER：所有动作都有当前会话 evidence refs。
  验收：每次 Computer Use action 都能从 `InputIntent` 追溯到 provider adapter、executor event、before frame、after frame、verifier、artifact 或 blocked reason；evidence bundle 是当前 session 产生的，不能引用旧截图、shell-only 文件、fixture pass 或跨 bundle refs。
  当前状态：部分完成。Acceptance validator 已拒绝 shell-only、stale、fixture pass、旧 run artifact 和跨 bundle refs，并要求 current-session action trace / `gui.present`；产品 runtime 的 InputIntent blocked/executed path 已要求 input intent、executor event、before/after、verification 和 ledger refs，且 executed refs 必须来自非 probe provider action。Opt-in driver factories 已写 adapter/session/window/live-surface/frame/transport evidence records，native executor 已校验 lifecycle refs 的 same-run/same-session consistency。真实 Native Host path 仍需在产品右栏执行时自动写 before/after frame 文件，并把 shell hook 布尔声明升级为 host-owned ledger/hash/current-run ownership verification。
  TODO：
  - [x] 2026-06-02 Provider lifecycle / VSCode smoke evidence contract 已把 `beforeFrameRef` / `afterFrameRef` / `beforeAfterFrameRefs` / `evidenceLedgerRef` 串入 `readFrame` 和 `sendInputIntent` refs。Evidence refs：`src/runtime/computer-use/virtual-display-provider.ts`、`tools/computer-use-next/virtual-app-screen-vscode-smoke.ts`；验证：focused CU suite 51/51 passed。
  - [x] 2026-06-02 macOS native VSCode provider smoke 已 materialize current-run before/after frame 文件和 evidence ledger，且不来自旧 session。Evidence refs：`/tmp/sciforge-vas-vscode-live-check/virtual-display-provider/frames/before.json`、`/tmp/sciforge-vas-vscode-live-check/virtual-display-provider/frames/after.json`、`/tmp/sciforge-vas-vscode-live-check/virtual-display-provider/evidence-ledger.json`；验证：provider-executed live check。
  - [x] 2026-06-02 产品 runtime InputIntent 分支会在无 provider 时写 refs-first blocked evidence，在注册 input executor 时验证 `inputIntentRefs`、`executorEventRefs`、`beforeFrameRef`、`afterFrameRef`、`beforeAfterFrameRefs`、`verificationRefs` 和 `evidenceLedgerRef` 后才返回 `done`。Evidence refs：`src/runtime/computer-use/virtual-app-screen-input-runtime.ts`、`src/runtime/computer-use/virtual-app-screen-input-runtime.test.ts`、`src/runtime/vision-sense-runtime.test.ts`；验证：`node --import tsx --test src/runtime/computer-use/virtual-app-screen-input-runtime.test.ts src/runtime/vision-sense-runtime.test.ts`。
  - [x] 2026-06-02 Native lifecycle / input evidence 增加 same-session 和 evidence-written gates：provider shell ready 需要 hook-owned refs + `providerEvidenceWritten=true`；native executor 拒绝跨 currentRun/session/surface/targetWindow/evidenceLedger/currentFrameSequence 的 lifecycle chain；input runtime 拒绝用 command/probe refs 补足执行证据。Evidence refs：`src/runtime/computer-use/native-providers/macos-virtual-display-provider.ts`、`src/runtime/computer-use/native-providers/platform-virtual-display-provider-shell.ts`、`src/runtime/computer-use/virtual-app-screen-native-executor.ts`、`src/runtime/computer-use/virtual-app-screen-input-runtime.ts`；验证：`node --import tsx --test src/runtime/computer-use/native-providers/macos-virtual-display-provider.test.ts src/runtime/computer-use/native-providers/platform-virtual-display-provider-shell.test.ts src/runtime/computer-use/virtual-app-screen-native-executor.test.ts src/runtime/computer-use/virtual-app-screen-input-runtime.test.ts`。
  - [ ] SciForge 右栏产品 Native Host path 仍需在执行时自动 materialize before/after frame 文件，frame 可以滞后但不能缺失或来自旧 session。
  - [ ] Generic native provider shell 仍需验证 provider-owned evidence 超过 hook 布尔声明：读取或验证 host ledger entry existence/hash/current-run ownership，或把 shell-only hook evidence 明确限制为 contract-only，直到真实 host evidence writer 被 runtime/ledger 复验。
  - [x] 2026-06-02 `gui.presentRef` 必须证明当前 evidence 已在右侧 `Screen` 展示或可 replay。Evidence refs：`tools/computer-use-next/live-acceptance-validator.ts`、`tools/computer-use-next/live-acceptance-bundle.ts`、`tests/smoke/cu-next-live-acceptance-matrix.test.ts`。
  - [x] 2026-06-02 artifact validator 必须拒绝 shell-only、stale file、旧 run artifact 和没有 app causality 的产物。Evidence refs：`tools/computer-use-next/live-acceptance-validator.ts`、`tests/smoke/cu-next-live-acceptance-matrix.test.ts`。
  - [x] 2026-06-02 blocked / permission / observe-only 也要写 evidence refs，方便复验当前失败原因。Evidence refs：`src/ui/src/app/results/screenPaneModel.ts`、`tests/smoke/smoke-virtual-app-screen-dogfood-product.test.ts`。
  验证：`npm run smoke:virtual-app-screen-user-acceptance-contract --silent`；`npm run smoke:cu-next-live-acceptance --silent`；状态：validator/gate complete, live provider ledger writer pending。

### P1：质量、扩展和 dogfood

- [ ] P1-CU-VAS-STREAM-QUALITY：低延迟 live transport 收口。
  验收：桌面 shell 优先 native embedded/presented surface；Web shell、远程 shell 或跨进程场景使用 WebRTC 或等价 native frame stream。右侧 `Screen` 达到本地 app 可操作的刷新率和输入回显，断线可重连，frame stream 只是同一个 Host surface 的 transport/evidence/replay，不成为第二真相源。
  当前状态：部分完成。Provider -> Screen transport/telemetry/input-hot-path contract 已落地；runtime attached artifact 会携带 safe `surfaceTransportDescriptor` 和 session-manager `liveBindingAttachGrantRef`，Screen host adapter 已能 refs-only attach/present/detach provider-owned surface。真实 Native Host native media/data channel、host bridge grant validation、reconnect 测量和可操作刷新率仍需 provider evidence。
  TODO：
  - [x] 2026-06-02 provider -> Screen 的 media/data channel、frame telemetry、current frame sequence、reconnect 和 input hot path refs 已接入 `virtual-screen-viewer` presentation；legacy transports 保持 diagnostic-only。Evidence refs：`packages/presentation/components/virtual-screen-viewer/render.tsx`、`packages/presentation/components/virtual-screen-viewer/render.test.tsx`；验证：focused CU suite 51/51 passed。
  - [x] 2026-06-02 Runtime/session artifact 与 Screen host adapter 接通 refs-only `surfaceTransportDescriptor` + `liveBindingAttachGrantRef` presentation contract；缺 descriptor、grant 或 unsafe refs 时不能 live attach。Evidence refs：`src/runtime/computer-use/virtual-app-screen-session-manager.ts`、`src/runtime/computer-use/virtual-app-screen-native-executor.ts`、`src/ui/src/app/results/screenPaneHostAdapter.tsx`；验证：`node --import tsx --test src/runtime/computer-use/virtual-app-screen-session-manager.test.ts src/runtime/computer-use/virtual-app-screen-native-executor.test.ts src/ui/src/app/results/screenPaneHostAdapter.test.ts`。
  - [ ] 真实产品 UI transport 仍需连接 Native Host media/data channel 或 native presented surface，并测量 reconnect 与可操作刷新率。
  - [x] 2026-06-02 frame stream 记录 bounded p50/p95 latency、drop、backpressure、current frame sequence。Evidence refs：`src/runtime/computer-use/virtual-display-provider.ts`、`src/runtime/computer-use/virtual-display-provider.test.ts`。
  - [x] 2026-06-02 输入热路径不得被 screenshot、OCR、replay 或 evidence capture 阻塞。Evidence refs：`src/runtime/computer-use/virtual-display-provider.ts`。
  - [x] 2026-06-02 VNC/noVNC/RDP/MJPEG 只能保留为历史诊断文档，不作为产品 fallback。Evidence refs：`src/runtime/computer-use/virtual-display-provider.ts`、`src/runtime/computer-use/virtual-display-provider.test.ts`。
  验证：`node --import tsx --test src/runtime/computer-use/virtual-display-provider.test.ts`；状态：contract/telemetry complete, measured product live transport pending。

- [x] P1-CU-VAS-APP-PROFILES：扩展本地科研 app profiles。
  验收：在 VSCode/editor 闭环后，逐步覆盖 Terminal、Browser research、Jupyter/notebook、PDF/Preview/Zotero、CSV/table viewer。每个 profile 都必须复用同一 Native Host session/surface/input/evidence model；profile 是 host target profile，不是独立工具桥。
  当前状态：完成为 diagnostic profile contract；没有 real Host/provider evidence 时不得 `userAcceptanceEligible=true`。
  TODO：
  - [x] 2026-06-02 为每个 profile 定义 app identity、allowed actions、artifact chain、risk policy、close/reuse policy。Evidence refs：`tools/computer-use-next/virtual-app-screen-research-workflow.ts`。
  - [x] 2026-06-02 每个 profile 都有 provider readiness、live/control refs、input intent、before/after、blocked reason 和 user handoff path；缺 real provider evidence 时保持 diagnostic-only。Evidence refs：`tools/computer-use-next/virtual-app-screen-research-workflow.ts`、`tests/smoke/virtual-app-screen-research-workflow.test.ts`。
  - [x] 2026-06-02 多 app 协作必须按多个 `VirtualAppScreen` 展示，不能把多个 app 塞进一个未声明 viewer。Evidence refs：`tools/computer-use-next/virtual-app-screen-research-workflow.ts`。
  验证：`node --import tsx --test tests/smoke/virtual-app-screen-research-workflow.test.ts`；状态：profile contract landed, real provider user acceptance remains gated。

- [ ] P1-CU-VAS-DOGFOOD：用 SciForge 自己验收右侧 Screen。
  验收：用 SciForge 当前产品 UI 打开 workspace，右侧 `Screen` 自动出现由 package-owned Native Host 创建/验证的真实 app screen；Computer Use 能在其中操作本地 app，人类能接管；run 输出 bounded manifest。dogfood 必须证明产品路径调用 `packages/actions/computer-use/virtual-app-screen-host` 或其当前迁移 shim，而不是直接调用 smoke/provider internals。
  当前状态：部分完成。Runbook、product smoke、bounded blocked manifest 和 right-pane runtime command acceptance 断言已落地；只有当当前 run manifest `status=passed` 且包含 UI attach、live frame、InputIntent、human takeover/resume 和 evidence refs 时，才能声明 dogfood passed。
  TODO：
  - [x] 2026-06-02 建立 dogfood runbook：打开 SciForge、进入 `Screen`、确认自动 provision、操作 VSCode、人工接管、恢复 agent、输出 evidence。Evidence refs：`docs/runbooks/virtual-app-screen-dogfood-runbook.md`。
  - [x] 2026-06-02 建立 product smoke，不直接操作 provider internals，只通过 SciForge UI 和 right pane 观察/输入。Evidence refs：`tests/smoke/smoke-virtual-app-screen-dogfood-product.test.ts`、`package.json`。
  - [x] 2026-06-02 每次失败写 `blocked` manifest：phase、reason、provider readiness、permission refs、last frame refs、last input refs。Evidence refs：`tests/smoke/smoke-virtual-app-screen-dogfood-product.test.ts`。
  - [x] 2026-06-02 dogfood manifest 记录 `runtimeCommandAcceptance`：若右栏捕获 `/computer-use screen attach` / permission command，必须能被产品 runtime parser 解析，且保持 `failClosed=true`、`providerExecuted=false`。Evidence refs：`tests/smoke/smoke-virtual-app-screen-dogfood-product.test.ts`、`src/runtime/computer-use/virtual-app-screen-command.ts`；验证：`node --import tsx --test tests/smoke/smoke-virtual-app-screen-dogfood-product.test.ts`。
  - [ ] dogfood manifest 必须记录 `nativeHost`、`humanInputHotPath`、`automationBarrierRefs` 和 `backgroundEvidenceRefs`；若使用第三方虚拟屏幕软件，只能标记为 reference/diagnostic，不能 `status=passed`。
  验证：`npm run smoke:virtual-app-screen-dogfood-product --silent`；状态：dogfood harness/runtime command acceptance complete, live passed dogfood evidence pending。

## 完成归档：2026-06-01 Contract / Readiness 基线

以下条目已提供 schema、contract、fixture 或 readiness evidence；它们不代表右侧 `Screen` 已经能默认打开真实本地 app。后续实现如果触碰这些边界，需要保留 refs-first、fail-closed 和 GUI presentation-only 约束。

用户级验收不是“能看到一张 frame”或“能点一次按钮”。一次 Computer Use run 只有同时满足下面条件，才能从 package/product smoke 升级为 user-acceptance evidence：

- 用户提出的科研任务有可检查产物或可检查外部状态，例如报告、notebook、figure、CSV、PPT/DOCX、实验日志、标注记录或 app 内已保存修改。
- 产物来自当前 `VirtualAppScreen` 会话的 action causality，而不是 shell 直写、旧 trace、fixture、DOM shortcut 或历史文件。
- 右侧 `Screen` 能展示当前 app/window/session frame、actor cursor、annotation/proposal、before/after、timeline 和关键 refs，用户可以观察或介入。
- evidence bundle 内有 adapter readiness、session permission、allowlist、risk preview、input intent、executor event、before/after frame、verification、artifact、gui.present 和 replay refs。
- isolated background control 的 flags 必须证明未影响用户物理桌面；做不到时只能是 diagnostic/hand-off，不能 user-level pass。

### P0-CU-UA-CONTRACT：定义用户级验收 manifest

- [x] 定义 `virtual-app-screen-user-acceptance-manifest` schema。
  验收：manifest 必须包含 `taskId`、`scenarioId`、`userIntent`、`targetAppRefs`、`targetWindowRefs`、`sessionRefs`、`adapterReadinessRefs`、`screenFrameRefs`、`inputIntentRefs`、`executorEventRefs`、`beforeAfterFrameRefs`、`annotationProposalRefs`、`artifactRefs`、`verificationRefs`、`guiPresentRefs`、`replayRef`、`evidenceLedgerRef`、`isolationFlags` 和 `blockedReason`。
  完成：2026-06-01；evidence refs：`tools/virtual-app-screen-user-acceptance-manifest.ts`、`packages/actions/computer-use/sciforge_computer_use/contracts.py`；验证：`npm run smoke:virtual-app-screen-user-acceptance-contract --silent`、`PYTHONPATH=packages/actions/computer-use python3 -m pytest packages/actions/computer-use/tests/test_virtual_app_screen_user_acceptance.py -q`；状态：schema/validator landed。
- [x] 定义 user-level pass / blocked / needs-confirmation / handoff 状态机。
  验收：`passed` 只能在产物、可见 app evidence、action causality、validator/verifier 和 isolation flags 全部满足时出现；缺权限、缺后台渲染、需要 focus steal、需要 shared input、目标歧义或高风险未确认时必须是 `blocked` / `needs-confirmation` / `requires-handoff`。
  完成：2026-06-01；evidence refs：`tests/smoke/virtual-app-screen-user-acceptance-manifest.test.ts`、`packages/actions/computer-use/tests/test_virtual_app_screen_user_acceptance.py`；验证：同上；状态：pass/fail-closed/confirmation/handoff covered。
- [x] 定义用户级验收与 package smoke 的边界。
  验收：package-local contract、M6 opt-in、target-bound fixture、历史 Docker/noVNC evidence、单次 click smoke 都不能单独写 `userAcceptanceEligible=true`；只能作为依赖 readiness、回归或诊断 evidence。
  完成：2026-06-01；evidence refs：`tools/computer-use-next/product-smoke-matrix.ts`、`tests/smoke/cu-next-live-acceptance-matrix.test.ts`、`packages/actions/computer-use/action-provider.manifest.json`；验证：`npm run smoke:cu-next-live-acceptance --silent`、`npm run smoke:module-boundaries --silent`、`npm run smoke:native-extension-ownership --silent`；状态：active gate migrated to VirtualAppScreen, M6 historical only。

### P0-CU-UA-FIRST-SCENARIO：收敛第一个可验收科研任务

- [x] 选择并固定首个用户级验收场景。
  验收：首个场景必须是低风险、可重复、可本地运行的科研任务，例如“在后台 Browser/PDF/notes app 中读取一段资料，添加可见标注，生成并展示 `research-note.md` 或 notebook/report artifact”；任务必须不需要外部账号、不发送外部消息、不修改用户真实桌面。
  完成：2026-06-01；evidence refs：`tools/computer-use-next/virtual-app-screen-first-scenario.ts`、`tests/smoke/virtual-app-screen-first-scenario.test.ts`；验证：`npm run smoke:virtual-app-screen-user-acceptance-contract --silent`、`node --import tsx tools/computer-use-next/virtual-app-screen-first-scenario.ts --out-dir /tmp/sciforge-vas-first-scenario-cli-smoke --run-id cli-fixture-smoke`；状态：local research-note scenario fixed, fixture defaults to diagnostic-only。
- [x] 定义首个场景的最低用户可见行为。
  验收：用户在 Screen tab 里至少能看到 target app frame、一次用户/agent annotation、一次等效鼠标键盘操作、一次 before/after frame 变化、最终产物预览和 replay timeline。
  完成：2026-06-01；evidence refs：`tools/computer-use-next/virtual-app-screen-first-scenario.ts`、`tests/smoke/virtual-app-screen-first-scenario.test.ts`、`packages/presentation/components/virtual-screen-viewer/render.test.tsx`；验证：`npm run smoke:virtual-app-screen-user-acceptance-contract --silent`、VirtualScreen viewer focused tests；状态：Screen-visible refs, annotation, input intent, before/after, artifact preview and replay timeline covered。
- [x] 定义首个场景的 artifact 验证。
  验收：最终 artifact 必须在当前 run bundle 或目标 workspace 中存在，内容包含来自 app evidence 的引用或摘要，并由 validator/verifier 证明不是空文件、旧文件或 shell-only 伪产物。
  完成：2026-06-01；evidence refs：`tools/computer-use-next/virtual-app-screen-first-scenario.ts`、`tests/smoke/virtual-app-screen-first-scenario.test.ts`；验证：`npm run smoke:virtual-app-screen-user-acceptance-contract --silent`；状态：artifact validator rejects shell-only and stale artifacts。

### P0-CU-UA-SCREEN-ATTACH：让 Screen tab 成为验收可见面

- [x] 定义 `VirtualAppScreen` result pane / action provider contract。
  验收：payload 只接受 refs-first 字段，例如 `targetAppRef`、`targetWindowRef`、`sessionRef`、`frameStreamRef`、`currentFrameRef`、`actorCursorRefs`、`annotationOverlayRefs`、`inputLeaseRef`、`actionAdapterRef`、`adapterReadinessRef`、`replayRef`、`evidenceLedgerRef`、`blockedRef` 和 `errorRef`；不接受 raw screenshot/base64/raw trace dump。
  完成：2026-06-01；evidence refs：`packages/presentation/components/virtual-screen-viewer/render.tsx`、`src/ui/src/app/results/resultPaneContract.ts`；验证：`node --import tsx --test packages/presentation/components/virtual-screen-viewer/render.test.tsx src/ui/src/app/results/resultPaneContract.test.ts`；状态：refs-first presentation contract landed。
- [x] 把 Screen tab 的空态从“virtual screen refs missing”升级为验收导向的 attach 状态。
  验收：没有 active app screen 时，UI 能区分 no session、adapter unavailable、observe-only、blocked、requires user handoff；用户级验收报告必须能引用这些状态，不能把 placeholder 当成 frame evidence。
  完成：2026-06-01；evidence refs：`packages/presentation/components/virtual-screen-viewer/render.test.tsx`、`src/ui/src/app/results/resultPaneContract.test.ts`；验证：同上；状态：attach states covered and placeholder frame evidence rejected。
- [x] 定义一个 app/window/session 绑定一块虚拟屏幕的 lifecycle。
  验收：create、attach、observe、annotate、control、pause、resume、close、handoff 都有 refs-first event；同一个 active screen 只能绑定一个 target app/window/session。
  完成：2026-06-01；evidence refs：`tools/computer-use-next/virtual-app-screen-lifecycle.ts`、`tests/smoke/virtual-app-screen-lifecycle.test.ts`；验证：`npm run smoke:virtual-app-screen-lifecycle-contract --silent`；状态：complete lifecycle events, active binding uniqueness, handoff refs, raw payload rejection covered。

### P0-CU-UA-ADAPTER-FIRST：证明等效鼠标键盘不影响用户电脑

- [x] 定义 `ActionAdapter` readiness/capability schema。
  验收：每个 adapter 必须声明 `adapterKind`、`targetScope`、`supportedActions`、`captureSupported`、`backgroundRenderable`、`affectsPhysicalDisplay`、`requiresFocusSteal`、`sharedSystemInputUsed`、`blockedReason` 和 schema refs。
  完成：2026-06-01；evidence refs：`packages/actions/computer-use/sciforge_computer_use/contracts.py`、`packages/actions/computer-use/tests/test_virtual_app_screen_user_acceptance.py`；验证：`PYTHONPATH=packages/actions/computer-use python3 -m pytest packages/actions/computer-use/tests/test_virtual_app_screen_user_acceptance.py -q`；状态：validator fail-closes unsafe adapter readiness。
- [x] 把 Screen canvas 输入投影成 `InputIntent`。
  验收：click/type/drag/scroll/hotkey/menu command 都先写 input intent ref，再经 target binding、lease、executor event、before/after evidence 和 verifier；GUI 不直接调用 backend。
  完成：2026-06-01；evidence refs：`packages/actions/computer-use/sciforge_computer_use/contracts.py`、`packages/actions/computer-use/tests/test_virtual_app_screen_user_acceptance.py`、`tools/computer-use-next/virtual-app-screen-first-scenario.ts`、`packages/presentation/components/virtual-screen-viewer/render.tsx`；验证：`PYTHONPATH=packages/actions/computer-use python3 -m pytest packages/actions/computer-use/tests/test_virtual_app_screen_user_acceptance.py -q`、`npm run smoke:virtual-app-screen-user-acceptance-contract --silent`、VirtualScreen viewer focused tests；状态：all generic input kinds require lease/adapter/executor/before-after/verifier refs and GUI remains terminal-equivalent/presentation-only。
  追加：2026-06-01；evidence refs：`packages/presentation/components/virtual-screen-viewer/render.tsx`、`packages/presentation/components/virtual-screen-viewer/render.test.tsx`、`packages/presentation/components/virtual-screen-viewer/README.md`、`src/ui/src/app/results/screenPaneHostAdapter.test.ts`、`src/ui/src/app/results/resultPaneContract.ts`；验证：`node --import tsx --test packages/presentation/components/virtual-screen-viewer/render.test.tsx src/ui/src/app/results/screenPaneHostAdapter.test.ts src/ui/src/app/results/screenPaneModel.test.ts src/ui/src/app/results/resultPaneContract.test.ts`、`npm run smoke:virtual-app-screen-user-acceptance-contract --silent`；状态：Screen frame now captures click/drag/scroll/text/hotkey only when attached screen has safe isolation, session/frame/lease/adapter/readiness refs; capture emits terminal-equivalent `/computer-use input-intent ...` text and never calls GUI/backend executor directly。
- [x] 建立 isolated 与 non-isolated 的 fail-closed gate。
  验收：需要 focus steal、物理屏弹窗、全局鼠标键盘、shared system input 的 adapter 不能作为后台隔离完成证据；当前产品路线没有 fallback pass，只能标记 `requires-handoff`、`diagnosticOnly=true` 或 `blocked`。
  完成：2026-06-01；evidence refs：`tools/virtual-app-screen-user-acceptance-manifest.ts`、`tools/computer-use-next/product-smoke-matrix.ts`、`packages/actions/computer-use/sciforge_computer_use/contracts.py`；验证：`npm run smoke:virtual-app-screen-user-acceptance-contract --silent`、`npm run smoke:cu-next-live-acceptance --silent`、Python contract tests；状态：focus/shared-input/popup/physical-display pass rejected。

### P0-CU-UA-ANNOTATION-TO-ACTION：把注释转成可验收修改

- [x] 定义 annotation overlay refs。
  验收：point、rectangle、arrow、highlight、comment、agent cursor trace、rejected target 都能绑定到 window region、AX element、DOM element、OCR text span、visual object 或 artifact/file ref。
  完成：2026-06-01；evidence refs：`packages/actions/computer-use/sciforge_computer_use/contracts.py`、`packages/actions/computer-use/tests/test_virtual_app_screen_user_acceptance.py`、`packages/presentation/components/virtual-screen-viewer/render.test.tsx`；验证：Python contract tests、VirtualScreen viewer focused tests；状态：overlay kinds/bindings validated and presented refs-first。
- [x] 支持 annotation -> proposal -> action -> verification。
  验收：用户或 agent 对窗口区域说“把这里改成 X”时，系统先生成 action proposal，包含 target ref、adapter kind、risk preview、before evidence、expected after evidence 和 approval policy；执行后必须有 after evidence 与 verification ref。
  完成：2026-06-01；evidence refs：`packages/actions/computer-use/sciforge_computer_use/contracts.py`、`packages/actions/computer-use/tests/test_virtual_app_screen_user_acceptance.py`、`tools/computer-use-next/virtual-app-screen-first-scenario.ts`；验证：Python contract tests、`npm run smoke:virtual-app-screen-user-acceptance-contract --silent`；状态：annotation/proposal/input/executor/before-after/verifier chain covered by refs-first contract and first scenario smoke。
- [x] 让 annotation 成为最终报告证据。
  验收：最终 artifact 或验收报告可以引用 annotation/proposal refs，说明“用户/agent 在窗口何处提出了什么修改、系统如何执行、结果如何验证”。
  完成：2026-06-01；evidence refs：`tools/computer-use-next/virtual-app-screen-first-scenario.ts`、`tests/smoke/virtual-app-screen-first-scenario.test.ts`；验证：`npm run smoke:virtual-app-screen-user-acceptance-contract --silent`；状态：research-note artifact includes source evidence and annotation/proposal refs, shell-only/stale artifact rejected。

### P1-CU-UA-BACKGROUND-NATIVE-WINDOW：后台原生应用能力进入验收链

- [x] 建立 native window capture provider contract。
  验收：可读取 app/window identity、bounds、frame ref、preview ref、timestamp/hash、permission diagnostics；缺 Screen Recording/Accessibility 或窗口不可渲染时给出 blocked reason。
  完成：2026-06-01；evidence refs：`packages/actions/computer-use/native-window-capability.manifest.json`、`packages/actions/computer-use/tests/test_virtual_app_screen_native_window_capability.py`；验证：`python3 -m json.tool packages/actions/computer-use/native-window-capability.manifest.json >/tmp/sciforge-native-window-capability-jsoncheck.json`、`PYTHONPATH=packages/actions/computer-use python3 -m pytest packages/actions/computer-use/tests/test_virtual_app_screen_native_window_capability.py -q`；状态：contract-only refs-first native window capability manifest landed。
- [x] 建立 AX / UIA / AT-SPI hit-test 与 action contract。
  验收：窗口坐标可绑定到 element ref 或 region ref；标准控件能执行 press/set value/scroll/menu command；自绘控件必须明确降级为 vision-grounded 或 blocked。
  完成：2026-06-01；evidence refs：`packages/actions/computer-use/native-window-capability.manifest.json`、`packages/actions/computer-use/tests/test_virtual_app_screen_native_window_capability.py`；验证：native-window capability focused pytest；状态：AX/UIA/AT-SPI hit-test/action refs require proposal, lease, before/after, verifier, no direct mutation。
- [x] 研究 offscreen / hidden display-like surface。
  验收：只有 capability probe 证明 `backgroundRenderable=true`、`affectsPhysicalDisplay=false`、`requiresFocusSteal=false` 时，才能宣称应用在后台运行且物理屏不弹窗。
  完成：2026-06-01；evidence refs：`packages/actions/computer-use/native-window-capability.manifest.json`、`packages/actions/computer-use/tests/test_virtual_app_screen_native_window_capability.py`；验证：native-window capability focused pytest；状态：offscreen/hidden/occluded/minimized probes are readiness-only and fail closed on focus steal/popup/shared input。
- [x] 定义 app lifecycle manager。
  验收：open/attach/reuse/close target app session 不污染用户当前桌面；如果必须弹窗或抢焦点，必须先返回 handoff/diagnostic 状态。
  完成：2026-06-01；evidence refs：`packages/actions/computer-use/native-window-capability.manifest.json`、`packages/actions/computer-use/tests/test_virtual_app_screen_native_window_capability.py`；验证：native-window capability focused pytest；状态：open/attach/reuse/close lifecycle contract returns handoff/diagnostic for dialogs/focus-steal/destructive close。

### P1-CU-UA-RESEARCH-WORKFLOW：从单 app 走向科研多 app 验收

- [x] 定义第一批科研 app screen profiles。
  验收：至少覆盖 Browser research、Terminal experiment、Jupyter/notebook、Editor/Cursor、PDF/Zotero/Preview、CSV/table viewer；每个 profile 有 adapter readiness、frame、input、artifact、user-level eligibility 和 blocked 策略。
  完成：2026-06-01；evidence refs：`tools/computer-use-next/virtual-app-screen-research-workflow.ts`、`tests/smoke/virtual-app-screen-research-workflow.test.ts`、`packages/actions/computer-use/adapter-registry.manifest.json`；验证：`node --import tsx --test tests/smoke/virtual-app-screen-research-workflow.test.ts`；状态：first six research profiles covered without fixture pass substitution。
- [x] 设计多 `VirtualAppScreen` 协作。
  验收：一个 task 可以同时展示文献检索、实验运行、日志观察、notebook/report 编辑等 screen；能隔离的 adapter 并行，不能隔离的 adapter 串行；user-level manifest 必须记录每个 screen 的贡献和边界。
  完成：2026-06-01；evidence refs：`tools/computer-use-next/virtual-app-screen-research-workflow.ts`、`tests/smoke/virtual-app-screen-research-workflow.test.ts`；验证：research workflow focused smoke；状态：isolated-parallel and non-isolated-serial scheduling plus cross-screen contribution boundaries covered。
- [x] 建立科研产物验收链。
  验收：final report、notebook、figure、CSV、PPT/DOCX、实验日志等产物必须有 current app screen evidence、artifact refs、validator/verifier refs 和 gui.present refs。
  完成：2026-06-01；evidence refs：`tools/computer-use-next/virtual-app-screen-research-workflow.ts`、`tests/smoke/virtual-app-screen-research-workflow.test.ts`；验证：research workflow focused smoke；状态：report/notebook/figure/CSV/PPT/DOCX/log artifact chains require artifact/verifier/gui.present refs and reject DOM/Playwright/shell-only substitutes。

### P1-CU-UA-VALIDATION：更新 product smoke 到用户级验收

- [x] 更新 Computer Use product smoke matrix。
  验收：新增 `virtual-app-screen-user-acceptance` gate；拒绝 placeholder-only、旧 frame、跨 bundle refs、GUI executor、shared system input、focus steal、physical display popup、shell direct artifact write、缺 gui.present、缺 artifact validator 和缺 user-visible Screen attach。
  完成：2026-06-01；evidence refs：`tools/computer-use-next/product-smoke-matrix.ts`、`tests/smoke/cu-next-live-acceptance-matrix.test.ts`；验证：`npm run smoke:cu-next-live-acceptance --silent`；状态：active product gate now requires VirtualAppScreen manifest。
- [x] 更新 live acceptance marker。
  验收：task evidence 能表达 app/session/window refs、adapter readiness、input intent、before/after refs、annotation/proposal refs、user control refs、artifact refs、verifier refs 和 final user-facing summary。
  完成：2026-06-01；evidence refs：`tests/smoke/cu-next-live-acceptance-matrix.test.ts`、`tools/computer-use-next/product-smoke-matrix.ts`；验证：`npm run smoke:cu-next-live-acceptance --silent`；状态：manifest-backed task evidence accepted, substitute evidence rejected。
- [x] 保留 M6/native multi-screen 为历史回归，不再作为 active product direction。
  验收：旧 M6 opt-in 仍可用于 sidecar/replay/ref hardening 回归，但新任务板、设计文档和默认产品路线不把完整虚拟桌面作为 blocker，也不能单独满足 VirtualAppScreen user-level acceptance。
  完成：2026-06-01；evidence refs：`docs/native-extension-ownership-map.json`、`packages/actions/computer-use/action-provider.manifest.json`、`tools/check-module-boundaries.ts`；验证：`npm run smoke:native-extension-ownership --silent`、`npm run smoke:module-boundaries --silent`、`npm run smoke:cu-next-live-acceptance --silent`；状态：M6 historical opt-in regression only。

### P2-CU-UA-OPERABILITY：让验收可运行、可诊断、可复验

- [x] 建立 adapter registry 文档和 manifest。
  验收：每个 adapter profile 都能被 describe/query/read，未声明 adapter 或 capability fail closed。
  完成：2026-06-01；evidence refs：`packages/actions/computer-use/adapter-registry.manifest.json`、`packages/actions/computer-use/tests/test_virtual_app_screen_adapter_registry.py`、`packages/actions/computer-use/README.md`；验证：`python3 -m json.tool packages/actions/computer-use/adapter-registry.manifest.json >/tmp/sciforge-adapter-registry-jsoncheck.json`、`PYTHONPATH=packages/actions/computer-use python3 -m pytest packages/actions/computer-use/tests/test_virtual_app_screen_adapter_registry.py packages/actions/computer-use/tests/test_virtual_app_screen_user_acceptance.py -q`；状态：registry describe/query/read + undeclared adapter/capability fail-closed。
- [x] 建立本地 app-screen user-acceptance smoke。
  验收：能启动一个低风险 app/session，attach 到 Screen tab，显示 frame，执行一个非破坏性 input intent，写 before/after evidence，生成 user-facing artifact，并输出 user-acceptance manifest；失败时输出清晰 blocked reason。
  完成：2026-06-01；evidence refs：`tools/computer-use-next/virtual-app-screen-local-smoke.ts`、`tests/smoke/virtual-app-screen-local-smoke.test.ts`、`package.json`；验证：`npm run smoke:virtual-app-screen-user-acceptance-contract --silent`、`node --import tsx tools/computer-use-next/virtual-app-screen-local-smoke.ts --out-dir /tmp/sciforge-vas-local-smoke-real-evidence --run-id cli-real-evidence-smoke --mode real-evidence`；状态：default diagnostic fail-closed smoke plus explicit complete real-evidence pass path covered。
- [x] 建立失败诊断与 repair hints。
  验收：失败时能区分 no session、adapter unavailable、background rendering unavailable、permission missing、target ambiguous、verification failed、artifact missing、isolation failed、needs confirmation 和 user handoff required。
  完成：2026-06-01；evidence refs：`packages/actions/computer-use/adapter-registry.manifest.json`、`packages/actions/computer-use/tests/test_virtual_app_screen_adapter_registry.py`；验证：同 adapter registry tests；状态：10 类失败诊断固定为 refs-first diagnostic taxonomy。
- [x] 更新 ownership map / architecture 文档。
  验收：`PROJECT.md`、`PROJECT_CU.md`、Computer Use 设计文档、NativeExtensionOwnershipMap 和 action-provider manifest 对 user-level acceptance 的命名一致。
  完成：2026-06-01；evidence refs：`PROJECT.md`、`PROJECT_CU.md`、`packages/actions/computer-use/vision_computer_use_agent_mvp.md`、`docs/NativeExtensionOwnershipMap.md`、`docs/native-extension-ownership-map.json`、`packages/actions/computer-use/action-provider.manifest.json`；验证：`git diff --check`、`npm run smoke:module-boundaries --silent`、`npm run smoke:native-extension-ownership --silent`；状态：active gate naming aligned to VirtualAppScreen user acceptance。

## 已完成基线

- [x] 定义 Computer Use L0/L1/L2 module boundary contract。
- [x] 定义 refs-first evidence ledger、replay bundle、actor cursor、scheduler lease 和 user-control contract。
- [x] 建立 Screen pane presentation-only 边界，GUI 不执行 Computer Use。
- [x] 建立 raw screenshot/base64/provider payload/secrets rejection。
- [x] 建立 M6 native multi-screen / multi-actor cursor opt-in evidence、sidecar schema、bundle-local replay 和 product smoke 回归。
- [x] 建立 BrowserRuntime DOM/AX observation refs 只能作为 hints 的 fail-closed 边界。

这些基线是新路线的安全底座；旧的 M6/native multi-screen sidecar 任务板不再作为 active backlog。新的 active product direction 是 package-owned Native VirtualAppScreen Host，而不是回到完整虚拟桌面 fallback。

## 验证规则

- 纯文档改动：运行 `git diff --check`。
- Computer Use package contract/schema 改动：运行 package-local Python tests，并补 focused schema/validator tests。
- Runtime bridge 改动：运行 package bridge focused tests、runtime event tests 和 `git diff --check`。
- GUI presentation 改动：运行 viewer/presentation focused tests、Browser visual check，并确认 GUI 没有执行 Computer Use action。
- Native Host package 改动：运行 host package contract tests、package boundary checks、runtime bootstrap tests、host grant validation tests、human fire-and-release hot-path tests、automation barrier tests 和 `git diff --check`。
- VirtualAppScreen 改动：覆盖 attach/no-session/observe-only/blocked/error、frame refs、annotation overlay、actor cursor、input intent、lease owner、replay timeline、Stop terminal-equivalent text 和 raw payload rejection。
- Adapter 改动：覆盖 readiness record、capability flags、before/after evidence、shared-system-input rejection、focus-steal/physical-display-popup rejection 和 blocked reason。
- Backend/live 改动：先跑 fixture/focused tests，再跑 opt-in native/app-screen gates；live evidence 必须 refs-first、脱敏、bundle-local。
- 每轮完成后更新本文件对应 TODO，补 evidence refs、日期、验证命令和状态。

## 暂缓集成

- 默认依赖真实 OS multi-pointer / multi-seat。
- 将完整 Docker/container/noVNC/RDP desktop 作为产品层 fallback 或并发隔离抽象。
- 将 VM / microVM / full remote desktop 作为当前科研自动化主路径或 fallback pass。
- 将 DeskPad、BetterDisplay、Mirage、Sunshine/Moonlight、noVNC/RDP/VNC 等第三方虚拟屏幕或远程桌面软件作为 SciForge product contract truth、host grant issuer、input executor 或 acceptance owner。
- 让 GUI 直接调用 Computer Use executor。
- 用 DOM、Playwright、accessibility tree、shell 直写 artifact、旧 trace 或 app private shortcut 替代 Computer Use 完成证据。
- 在默认 release gate 中运行长耗时 live Computer Use gates；native/app-screen gates 仍作为 opt-in release evidence。

## 必读文档

- [`PROJECT.md`](PROJECT.md)：总项目协议、模块化原则和验证规则。
- [`docs/Architecture.md`](docs/Architecture.md)：GUI-TUI、L0/L1/L2、Agent Host Semantic Pipeline 和 native extension 边界。
- [`docs/TuiGuiProtocol.md`](docs/TuiGuiProtocol.md)：GUI -> TUI 文本、TUI -> GUI intent tools 和只读 GUI resource tree。
- [`packages/actions/computer-use/vision_computer_use_agent_mvp.md`](packages/actions/computer-use/vision_computer_use_agent_mvp.md)：VirtualAppScreen、后台应用控制会话和 adapter-first 设计。
- [`docs/VirtualAppScreenNativeHost.md`](docs/VirtualAppScreenNativeHost.md)：终局 C Native VirtualAppScreen Host、packages 模块边界、输入热路径和 evidence barrier 设计。
- [`docs/NativeExtensionOwnershipMap.md`](docs/NativeExtensionOwnershipMap.md)：Computer Use ownership 与 GUI/runtime 边界。
- [`docs/native-extension-ownership-map.json`](docs/native-extension-ownership-map.json)：可验证 ownership manifest。
