# SciForge Computer Use 项目协议

最后更新：2026-05-31

当前目标：把 Computer Use 稳定为 **multi-screen actor-cursor Computer Use**，并把真实虚拟屏幕接入 SciForge 右侧 `Screen` 结果栏展示。核心抽象是 task/collaboration space 下的 `VirtualDisplayGroup`、多块 `VirtualScreen`、多个 `ActorCursor`、screen/window scoped executor lease，以及 refs-first evidence/replay bundle。Docker/noVNC 不再作为后续推进方向；历史 Docker/container 路径只保留为 legacy diagnostic / optional historical evidence。

本文件只记录 Computer Use 的当前原则、任务板、TODO 和验收规则。总项目原则以 [`PROJECT.md`](PROJECT.md) 为准；详细设计参考 [`packages/actions/computer-use/vision_computer_use_agent_mvp.md`](packages/actions/computer-use/vision_computer_use_agent_mvp.md) 和 [`docs/NativeExtensionOwnershipMap.md`](docs/NativeExtensionOwnershipMap.md)。

## 当前范围

- `packages/actions/computer-use` 拥有 request/result schema、session contract、actor cursor contract、domain-local action loop、scheduler/executor adapter contract、safety/approval、trace contract 和 compact handoff；它不是第二个 Root Agent Host。
- `packages/observe/vision` 只提供 observation、focus region、OCR/VLM/KV-Ground grounding helper、verifier feedback 和 file-ref-only visual memory；不执行真实桌面动作。
- GUI 只负责多屏/多光标 presentation、trace/replay 展示、focus、confirmation 和 terminal-equivalent text；不直接执行 Computer Use。
- 多鼠标首先是协作层概念：多个 actor cursor 可以并行移动、指向、标注和提出 action proposal；真正会改变 GUI 状态的 click/type/drag/scroll/hotkey/save/open menu 必须经过 scoped executor scheduler。
- 真实 platform sidecar / MCP / backend adapter 只做 OS-specific capture/state/input/preflight，不做 planning、completion、GUI presentation 或 workspace policy。
- BrowserRuntime / DOM / accessibility / Playwright 能力可以作为 web/app observation provider，为当前 screen/window 产出 refs-first state snapshot、stable element ref、DOM/AX 摘要和 grounding hint；它不能替代 Computer Use 的 executor lease、action causality、before/after evidence、artifact validation 或用户级 completion。

## 不可变规则

- 所有修改必须通用，不能为某个 demo app、截图、窗口标题、文件名或历史 run 写硬编码补丁。
- 代码路径保持唯一真相源；旧的一线程一鼠标假设与新设计冲突时，应迁移或删除旧路径，不做长期并行实现。
- Evidence Loop 只允许只读观察；任何会改变屏幕、窗口、viewport、focus、菜单、tab 或应用状态的操作都必须进入 Action Loop。
- 完成判断必须来自当前 evidence ledger、artifact/file evidence、validator/verifier 和 action causality，不能只依赖旧截图、历史 trace 或 action history。
- 所有大对象、截图、录屏、artifact、approval、audit 和 replay 只保存 refs；不得内联 raw screenshot、base64、provider raw payload、Authorization、token、secret、password 或 credential。
- `sharedSystemInputUsed`、`systemPointerMoved`、`systemKeyboardEventsSent` 在最终用户级验收中必须为 `false`；缺少独立 input adapter 时 fail closed 或降级为 diagnostic/blocked evidence。
- 高风险动作必须返回 `needs-confirmation`、`approvalRequest`、`draftRef` 或 `auditRef`，由 TUI Host 调用 GUI confirmation 后再受控继续。
- 一个 active task 只能有一个 L2 Root Agent Host；Computer Use package、runtime bridge、GUI presentation 和 backend adapter 都不能决定跨模块下一步、repair 策略或用户级 completion。
- L1 resource adapter 只能整理同一资源域的 session、cache、refs、events、version compatibility 和 L0 handler；不能扩大公共 API 面。
- L0 handler 只做一个具体动作，例如 capture、ground、execute、verify、writeTrace、emitEvent；不得直接调用其它模块或把自己伪装成 pipeline。
- 缺少 session permission ref、allowlist ref、risk preview/ref、stop/cancel lease path 或 platform-sidecar isolation report 的真实 mutating run，不能作为用户级完成证据。
- 已完成 TODO 必须打勾，并补充日期、evidence refs、验证命令和最终状态。

## 目标架构

```text
Task / Collaboration Space
-> VirtualDesktopSession
   -> VirtualDisplayGroup
      -> VirtualScreen A
         -> ActorCursor(user)
         -> ActorCursor(agent-1)
         -> ScreenExecutor(pointer/keyboard/focus adapter)
      -> VirtualScreen B
         -> ActorCursor(agent-2)
         -> ScreenExecutor(pointer/keyboard/focus adapter)
   -> EvidenceLedger
   -> ReplayBundle
   -> ArtifactObserver
   -> UserControlPlane(permission/allowlist/risk/stop/data-visibility refs)
   -> PlatformSidecarAdapter(optional OS-specific backend)
```

L0/L1/L2 放置：

```text
L2 Root Agent Host
  -> Codex app-server production path
  -> Codex CLI/native plugin debug path
  -> owns cross-module planning, approval, repair, completion, pipeline trace
L1 Computer Use Resource Adapter
  -> display group/session/cursor/lease/evidence/replay refs
  -> session permission/allowlist/risk/sidecar readiness refs
  -> adapts backend/provider/version/resource lifecycle
  -> exposes only Codex native tool/plugin/MCP or module.* surface
L0 Computer Use Handlers
  -> capture | crop | ground | propose scoped action | execute | verify | writeTrace | emitEvent | sidecar preflight
GUI Module
  -> present replay/overlay/permission/risk/stop controls, ask_user, notify, set_status, focus
```

## 当前任务板：Virtual Screen Product Integration

### P0-CU-SCREEN：把虚拟屏幕接入 SciForge 右侧 Screen tab

- [x] 定义 `Screen` result pane 的 Computer Use presentation contract。
  验收：pane 输入只接受 refs-first payload，例如 `visibleScreenRefs`、`visibleCursorRefs`、`replayRef`、`frameRefs`、`cursorOverlayRefs`、`leaseOwnerRefs`、`before/after evidence refs`、`completionEvidenceRef`、`blockedRef` 和 `errorRef`；不接受 raw screenshot/base64/raw trace dump。
  完成：2026-05-31；evidence：`computer-use-virtual-screen-*` runtime artifact、`virtual-screen-viewer` slot、`visual-regression` fixture、`ResultsRenderer screen tab derives Computer Use frame and replay refs from current run artifacts`；验证：`node --import tsx --test src/ui/src/app/ResultsRenderer.test.ts src/ui/src/api/sciforgeToolsClient/runtimeEvents.client.test.ts packages/presentation/components/virtual-screen-viewer/render.test.tsx`、`npx tsc --noEmit --pretty false`；状态：passed。
- [x] 让 `Screen` tab 从真实 Computer Use replay/evidence refs 加载 frame。
  验收：用户在右侧结果栏看到真实 virtual screen frame，而不是 placeholder 网格或单独的 `frame ref` 文本；没有 frame 时必须显示明确 blocked/error/empty state。
  完成：2026-05-31；evidence：`ResultsRenderer screen tab derives Computer Use frame and replay refs from current run artifacts`、`ResultsRenderer screen tab does not reuse old session screen when active run has no screen artifact`、`virtual-screen-viewer keeps replay preview, overlays, timeline, and lease status visually materialized`；验证：`node --import tsx --test src/ui/src/app/ResultsRenderer.test.ts packages/presentation/components/virtual-screen-viewer/render.test.tsx`；状态：passed。
- [x] 渲染 actor cursor overlay 和 lease/proposal 状态。
  验收：同一 screen 上能区分 user、agent、sub-agent cursor；move/point/annotate 是只读 overlay；click/type/drag/scroll/hotkey/open menu/save 只显示 scheduler/executor 已确认的 action causality。
  完成：2026-05-31；evidence：`packages/presentation/components/virtual-screen-viewer/render.tsx` actor cursor overlay、`cursorOverlayRefs`、`leaseOwnerRefs`、`proposalRefs` timeline；验证：`node --import tsx --test packages/presentation/components/virtual-screen-viewer/render.test.tsx`；状态：passed。
- [x] 实现 Observe / Replay / Stop 的 GUI 边界。
  验收：Observe 只请求只读观察或聚焦最新 frame；Replay 只播放 replay bundle；Stop 只发送 terminal-equivalent stop/cancel/confirmation intent 给 TUI Host，不直接杀 package state 或执行 action。
  完成：2026-05-31；evidence：viewer emits only `virtual-screen-terminal-equivalent-text` for Observe/Replay/Stop；验证：`node --import tsx --test packages/presentation/components/virtual-screen-viewer/render.test.tsx`；状态：passed。
- [x] 与 Right Pane 任务板保持同步。
  验收：`PROJECT_right.md` 的 P0 Screen pane TODO 和本文件任务一一对应；完成时两个文件都补 evidence 和验证命令。
  完成：2026-05-31；evidence：`PROJECT_right.md` P0 Screen pane 同步勾选；验证：`git diff --check`；状态：passed。

### P0-CU-CONTRACT：防止 Screen pane 变成 GUI executor

- [x] 增加或补齐 boundary guard。
  验收：`src/ui/**` 不能 import Computer Use action provider、runtime bridge、platform sidecar 或 observe provider implementation；GUI 只能 import shared contract 与 presentation package。
  完成：2026-05-31；evidence：`render.test.tsx` import guard、`runtimeEvents.client.test.ts` sanitizer、`rg -n "packages/actions/computer-use|src/runtime/computer-use|observe/vision|runComputerUse|executeScoped|macos_native_sidecar" src/ui packages/presentation/components/virtual-screen-viewer -g '*.ts' -g '*.tsx'` only matches guard text；验证：`node --import tsx --test packages/presentation/components/virtual-screen-viewer/render.test.tsx`；状态：passed。
- [x] 增加 Screen pane focused tests。
  验收：覆盖真实 frame refs、missing frame、blocked ref、error ref、multi-cursor overlay、lease owner、timeline replay、Stop terminal-equivalent text，以及 raw screenshot/raw JSON rejection。
  完成：2026-05-31；evidence：`ResultsRenderer.test.ts` Screen tab tests、`render.test.tsx` refs contract/raw rejection tests、`runtimeEvents.client.test.ts` materialized Screen artifact test；验证：`node --import tsx --test src/ui/src/app/ResultsRenderer.test.ts src/ui/src/api/sciforgeToolsClient/runtimeEvents.client.test.ts packages/presentation/components/virtual-screen-viewer/render.test.tsx`；状态：passed。
- [x] 更新 validator。
  验收：completed/user-acceptance evidence 必须证明 Screen pane 展示来自 current-bundle replay/evidence refs；placeholder-only viewer、旧截图、跨 bundle refs、GUI private state 和 raw inline payload 均 fail closed。
  完成：2026-05-31；evidence：M6 product smoke loads `validationRef/currentBundleRef/replayRef/targetRefs/schedulerLeaseRefs/sidecar capabilities/discovery/frame refs` and rejects placeholder/cross-bundle/raw/DOM substitutes；验证：`npm run smoke:cu-next-live-acceptance`；状态：passed。

### P1-CU-BROWSER：BrowserRuntime observation 与 Screen pane 的关系

- [x] 继续保留 BrowserRuntime DOM/AX 为 observation/grounding hints。
  验收：DOM/AX refs 可以帮助定位 web element，但不能替代 virtual screen frame、executor lease、before/after evidence、artifact validation 或用户级 completion。
  完成：2026-05-31；evidence：live acceptance matrix rejects DOM/AX substitutes outside structured BrowserRuntime observation refs；验证：`npm run smoke:cu-next-live-acceptance`；状态：passed。
- [x] Browser pane 与 Screen pane 不共享含糊状态。
  验收：Browser tab 负责网页/BrowserRuntime presentation；Screen tab 负责 Computer Use virtual screen/replay。两者可以通过 refs 关联，但不能把 Browser iframe 白屏误报为 Computer Use screen 成功。
  完成：2026-05-31；evidence：Right pane Browser/Screen are separate package-owned modules and Screen uses `computer-use-virtual-screen` artifact only when explicit Screen signals exist；验证：`node --import tsx --test src/ui/src/app/ResultsRenderer.test.ts src/ui/src/api/sciforgeToolsClient/runtimeEvents.client.test.ts`；状态：passed。

### P1-CU-LIVE-EVIDENCE：把 M6 live evidence 接入产品路径

- [x] 把 M6 native virtual-screen live run 接入产品 smoke artifact loader。
  验收：product smoke 能从当前 run bundle 加载 `validationRef`、`currentBundleRef`、`replayRef`、`targetRefs`、`schedulerLeaseRefs`、sidecar capabilities/discovery refs 和 frame refs；缺任一关键 ref 时 fail closed。
  完成：2026-05-31；evidence：`tools/computer-use-next/product-smoke-matrix.ts` current-bundle/replay loader；验证：`npm run smoke:cu-next-live-acceptance`；状态：passed。
- [x] 定义 live evidence retention / redaction 策略。
  验收：截图、window refs、title/owner hash、cursor overlay、executor event 和 validation record 均只保存 refs/脱敏摘要；过期 evidence 可以按 run bundle 清理，不破坏当前 validation replay。
  完成：2026-05-31；evidence：`native_multi_screen_live_demo.py` 写入 bundle-local `evidenceIndexRef` 和 `retentionRedaction`，截图/window/cursor/executor/validation 均为 ref/hash-only，validator 拒绝 raw/secret field；验证：`PYTHONPATH=packages/actions/computer-use pytest -q packages/actions/computer-use/tests/test_native_multi_screen_live_demo.py packages/actions/computer-use/tests/test_macos_native_sidecar.py packages/actions/computer-use/tests/test_platform_sidecar.py`、`npm run smoke:cu-next-live-acceptance`；状态：passed。
- [x] 增加真实 run summary 投影到 GUI/报告层。
  验收：用户能看到 screen count、actor cursor count、sidecar binding kind、blocked/completed status、replay frames、validation status 和关键 ref 链；报告层不内联截图或原始窗口标题。
  完成：2026-05-31；evidence：`computer-use-virtual-screen` artifact carries sanitized `runSummary`; `virtual-screen-viewer` 渲染 screens/actor cursors/sidecar/validation/evidence index/ref 链；报告层 `Computer Use result` 输出 summary 但不内联截图/窗口标题；验证：`node --import tsx --test src/ui/src/app/ResultsRenderer.test.ts src/ui/src/api/sciforgeToolsClient/runtimeEvents.client.test.ts packages/presentation/components/virtual-screen-viewer/render.test.tsx`、`npx tsc --noEmit --pretty false`；状态：passed。
- [x] 固化 M6 completed/blocked 双路径回归。
  验收：同一 suite 同时覆盖真实 sidecar pass、无 sidecar blocked、缺 capabilities/discovery blocked、缺 target/window refs fail-closed 和跨 bundle ref rejection。
  完成：2026-05-31；evidence：`test_native_multi_screen_live_demo.py`、`cu-next-live-acceptance-matrix.test.ts` completed/blocked/fail-closed cases；验证：`PYTHONPATH=packages/actions/computer-use pytest -q packages/actions/computer-use/tests/test_native_multi_screen_live_demo.py`、`npm run smoke:cu-next-live-acceptance`；状态：passed。

### P1-CU-SIDECAR-HARDENING：硬化 macOS virtual-screen sidecar

- [x] 给 virtual-screen discovery 增加跨机器兼容探针。
  验收：多物理屏、单物理屏 split、无 Screen Recording 权限、无 Swift、无 `screencapture`、CGWindowList 为空等场景都有明确 `blockedReason` 和 refs-first diagnostic record。
  完成：2026-05-31；evidence：`macos_native_sidecar.py` blocked diagnostic records；验证：`PYTHONPATH=packages/actions/computer-use pytest -q packages/actions/computer-use/tests/test_macos_native_sidecar.py packages/actions/computer-use/tests/test_platform_sidecar.py packages/actions/computer-use/tests/test_native_multi_screen_live_demo.py`；状态：passed。
- [x] 明确 virtual-screen input adapter 的产品边界。
  验收：文档和 validator 都区分 `virtualInputExecuted=true` 与 `realOsInputExecuted=false`；用户级完成不能把 virtual input event log 误读成真实 OS pointer/keyboard mutation。
  完成：2026-05-31；evidence：sidecar `execute` result/executor/input-event flags and M6 validator fail-closed checks；验证：`PYTHONPATH=packages/actions/computer-use pytest -q packages/actions/computer-use/tests/test_macos_native_sidecar.py packages/actions/computer-use/tests/test_platform_sidecar.py packages/actions/computer-use/tests/test_native_multi_screen_live_demo.py`、`npm run smoke:cu-next-live-acceptance`；状态：passed。
- [x] 把 sidecar command 做成稳定可发现入口。
  验收：plugin/MCP/manifest 中有 canonical command、required env、platform guard、schema refs 和 opt-in 标记；不需要开发者记住临时 `PYTHONPATH` 拼法。
  完成：2026-05-31；evidence：`package.json` 增加 `smoke:cu-native-m6:opt-in`，`action-provider.manifest.json` 暴露 `nativeM6OptIn` / `nativeM6OptInHelp` / schema refs / opt-in claim limit，`README.md` 记录 env 覆盖和 macOS fail-closed guard；验证：`npm run smoke:cu-native-m6:opt-in -- --help`、manifest/script consistency `node -e` check、`git diff --check`；状态：passed。
- [x] 增加 sidecar 输出 schema 兼容测试。
  验收：`capabilities` / `discover` / `preflight` / `capture` / `state` / `execute` 的 result records 都有 schema tests，且禁止 planning/completion、GUI import、workspace write policy 和 shared system input。
  完成：2026-05-31；evidence：`test_macos_native_sidecar.py` schema/boundary tests；验证：`PYTHONPATH=packages/actions/computer-use pytest -q packages/actions/computer-use/tests/test_macos_native_sidecar.py`；状态：passed。

### P2-CU-REPLAY-QUALITY：提升多屏 replay 可用性

- [x] 优化多屏 replay 帧体积和加载速度。
  验收：大分辨率截图有可选缩略图/preview refs，原始 frame refs 仍保留；Screen tab 首屏加载不需要一次性读完整 bundle。
  完成：2026-05-31；evidence：viewer accepts `framePreviewUrl`/`thumbnailPreviewUrl`/`rawUrl` while preserving frame refs; Right Pane generates `/api/sciforge/preview/raw?ref=...` for workspace-local frame refs；验证：`node --import tsx --test src/ui/src/app/ResultsRenderer.test.ts packages/presentation/components/virtual-screen-viewer/render.test.tsx`；状态：passed。
- [x] 增加 replay timeline 可视化状态。
  验收：timeline 能显示 before/after frame、cursor move/point/annotate、proposal、lease acquired/released、execute event 和 blocked/error markers。
  完成：2026-05-31；evidence：`virtual-screen-timeline` renders frame/events/proposal/lease refs；验证：`node --import tsx --test packages/presentation/components/virtual-screen-viewer/render.test.tsx`；状态：passed。
- [x] 增加视觉回归检查。
  验收：Browser/Screen pane screenshot test 能证明真实 frame 非空、cursor overlay 可见、文本不重叠、blocked/error/empty state 清楚，且 GUI 没有执行 Computer Use action。
  完成：2026-05-31；evidence：`visual-regression` Screen fixture 覆盖 active frame preview、cursor overlay、timeline、lease/proposal、summary refs 和 raw payload rejection；headless visual assertion confirms frame image nonblank, cursor/summary/timeline visible, and no error boundary without retaining `/tmp` screenshot paths as durable evidence；验证：`node --import tsx --test packages/presentation/components/virtual-screen-viewer/render.test.tsx src/ui/src/app/ResultsRenderer.test.ts`；状态：passed。

### P2-CU-OPERABILITY：运维和开发者体验

- [x] 增加一键本地 M6 opt-in 命令。
  验收：提供 `npm` 或 repo-local script 包装当前 macOS sidecar live demo，输出 manifest/currentBundle/validation 路径和最小 summary；失败时打印可操作 blocked reason。
  完成：2026-05-31；evidence：`npm run smoke:cu-native-m6:opt-in` 包装 native sidecar live demo，CLI 输出 manifest/validation JSON，blocked 路径返回明确 reason 且不 claim completion；验证：`npm run smoke:cu-native-m6:opt-in -- --help`、`PYTHONPATH=packages/actions/computer-use pytest -q packages/actions/computer-use/tests/test_native_multi_screen_live_demo.py`；状态：passed。
- [x] 建立 evidence bundle index。
  验收：每次 opt-in live run 可写入本地 index，记录 runId、日期、status、platform、sidecar binding、screen count、validationRef 和清理状态；index 不能成为 completion evidence 的替代。
  完成：2026-05-31；evidence：`evidenceIndexRef` 记录 runId/observedAt/status/platform/sidecarBindingKind/screenCount/actorCursorCount/validationRef/cleanup，validator 拒绝把 index 当 completion substitute；验证：`PYTHONPATH=packages/actions/computer-use pytest -q packages/actions/computer-use/tests/test_native_multi_screen_live_demo.py`、`npm run smoke:cu-next-live-acceptance`；状态：passed。
- [x] 写清跨平台策略。
  验收：macOS 当前走 native virtual-screen sidecar；Linux/Windows 只列 future backend adapter 条件，不重新引入 Docker/noVNC 作为 product blocker。
  完成：2026-05-31；evidence：`README.md` 和 manifest 将 macOS native sidecar 作为当前 opt-in 入口，非 macOS/缺权限/缺工具 fail closed，Docker/noVNC/RDP 仅保留 legacy diagnostic/historical evidence；验证：`rg -n "smoke:cu-native-m6|nativeM6OptIn|Docker/noVNC/RDP" package.json packages/actions/computer-use/action-provider.manifest.json packages/actions/computer-use/README.md`、`git diff --check`；状态：passed。

## 已完成基线

- [x] 定义 Computer Use L0/L1/L2 module boundary contract。
- [x] 定义 multi-screen session schema、`VirtualDisplayGroup` / `VirtualScreen`、`ActorCursor`、action proposal 和 scoped executor lease contract。
- [x] 定义 user control / session permission contract。
- [x] 定义 Codex-style local plugin / MCP contract，并收敛 public tool surface。
- [x] 实现 session skeleton、actor cursor log、screen/window scoped lease manager 和 old single-screen diagnostic projection。
- [x] 实现 scheduler queue、stop/cancel、approval gate、executor adapter contract 和 observe-before-mutate。
- [x] 扩展 evidence ledger freshness、grounding metadata、planner brief、multi-screen replay manifest 和 cursor overlay contract。
- [x] 将 Docker/noVNC/container 从 active product roadmap 退役。
- [x] 建立 native multi-screen / multi-actor cursor product gate、platform sidecar MVP、BrowserRuntime DOM/AX observation refs 和 live/product validators。

基线 evidence 归档在 Git 历史和 2026-05-31 之前的 `PROJECT_CU.md` 版本中；本文件当前只追踪未完成的 product integration 缺口。

## 验证规则

- 纯文档改动：运行 `git diff --check`。
- Computer Use package contract/schema 改动：运行 package-local Python tests，并补 focused schema/validator tests。
- Runtime bridge 改动：运行 package bridge focused tests、runtime event tests 和 `git diff --check`。
- GUI presentation 改动：运行 viewer/presentation focused tests、Browser visual check，并确认 GUI 没有执行 Computer Use action。
- Screen pane 改动：覆盖真实 frame refs、multi-cursor overlay、lease owner、replay timeline、blocked/error/empty state、Stop terminal-equivalent text 和 raw payload rejection。
- Backend/live 改动：先跑 fixture/focused tests，再跑 opt-in native multi-screen live gates；live evidence 必须 refs-first、脱敏、bundle-local。
- 每轮完成后更新本文件对应 TODO，补 evidence refs、日期、验证命令和状态。

## 暂缓集成

- 默认依赖真实 OS multi-pointer / multi-seat。
- 将 Docker/container 作为产品层并发隔离抽象。
- 让 GUI 直接调用 Computer Use executor。
- 用 DOM、Playwright、accessibility tree、shell 直写 artifact 或旧 trace 替代 Computer Use 完成证据。
- 在默认 release gate 中运行长耗时 live Computer Use gates；native multi-screen / multi-actor gates 仍作为 opt-in release evidence。

## 必读文档

- [`PROJECT.md`](PROJECT.md)：总项目协议、模块化原则和验证规则。
- [`docs/Architecture.md`](docs/Architecture.md)：GUI-TUI、L0/L1/L2、Agent Host Semantic Pipeline 和 native extension 边界。
- [`docs/TuiGuiProtocol.md`](docs/TuiGuiProtocol.md)：GUI -> TUI 文本、TUI -> GUI intent tools 和只读 GUI resource tree。
- [`packages/actions/computer-use/vision_computer_use_agent_mvp.md`](packages/actions/computer-use/vision_computer_use_agent_mvp.md)：Computer Use 视觉 agent 与 multi-screen actor-cursor 设计。
- [`docs/NativeExtensionOwnershipMap.md`](docs/NativeExtensionOwnershipMap.md)：Computer Use ownership 与 GUI/runtime 边界。
- [`docs/native-extension-ownership-map.json`](docs/native-extension-ownership-map.json)：可验证 ownership manifest。
