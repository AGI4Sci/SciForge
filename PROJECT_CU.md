# SciForge Computer Use 项目协议

最后更新：2026-05-31

当前目标：把 Computer Use 从“每线程一个虚拟桌面、一个虚拟鼠标键盘”的线性模型升级为 **multi-screen actor-cursor Computer Use**。核心抽象是 task/collaboration space 下的 `VirtualDisplayGroup`、多块 `VirtualScreen`、多个 `ActorCursor`、screen/window scoped executor lease，以及 refs-first evidence/replay bundle。Docker/noVNC 不再作为后续推进方向；历史 Docker/container 路径只保留为 legacy diagnostic / 可选历史证据，不再阻塞当前产品任务。

本文件只记录新的 Computer Use 设计、任务板、TODO 和验收规则。总项目原则仍以 [`PROJECT.md`](PROJECT.md) 为准；Computer Use 详细设计以 [`packages/actions/computer-use/vision_computer_use_agent_mvp.md`](packages/actions/computer-use/vision_computer_use_agent_mvp.md) 和 [`docs/NativeExtensionOwnershipMap.md`](docs/NativeExtensionOwnershipMap.md) 为准。

## 当前范围

- `packages/actions/computer-use` 拥有 request/result schema、session contract、actor cursor contract、domain-local action loop、scheduler/executor adapter contract、safety/approval、trace contract 和 compact handoff；它是 TUI-owned Computer Use 能力主体，不是第二个 Root Agent Host。
- `packages/observe/vision` 只提供 observation、focus region、OCR/VLM/KV-Ground grounding helper、verifier feedback 和 file-ref-only visual memory；不执行真实桌面动作。
- GUI 只负责多屏/多光标 presentation、trace/replay 展示、focus、confirmation 和 terminal-equivalent text；不直接执行 Computer Use。
- 多鼠标首先是协作层概念：多个 actor cursor 可以并行移动、指向、标注和提出 action proposal；真正会改变 GUI 状态的 click/type/drag/scroll/hotkey/save/open menu 必须经过 scoped executor scheduler。
- 真实 multi-pointer / multi-seat backend 只作为未来可替换 adapter；planner、evidence 和 GUI 不依赖它。
- 真实用户级 Computer Use 必须有用户控制面：session permission、app/window allowlist、risk preview、stop/cancel path 和截图/数据可见性 refs；GUI 只能展示和回传确认，不直接扩大权限或执行动作。
- 真实平台操作必须通过 platform sidecar / MCP / backend adapter 接入；sidecar 只做 OS-specific capture/state/input/preflight，不做 planning、completion、GUI presentation 或 workspace policy。
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
- L1 resource adapter 只能整理同一资源域的 session、cache、refs、events、version compatibility 和 L0 handler；不能扩大公共 API 面，L2 看到的入口始终是 Codex native tool/plugin/MCP 或 `module.*`。
- L0 handler 只做一个具体动作，例如 capture、ground、execute、verify、writeTrace、emitEvent；不得直接调用其它模块或把自己伪装成 pipeline。
- 缺少 session permission ref、allowlist ref、risk preview/ref、stop/cancel lease path 或 platform-sidecar isolation report 的真实 mutating run，不能作为用户级完成证据。
- 已完成 TODO 必须打勾，并补充日期、evidence refs、验证命令和最终状态。

## 2026-05-31 本轮 evidence refs

- `E-CU-PY-CONTRACT`：`packages/actions/computer-use/tests/test_multi_screen_actor_cursor_contracts.py`、`test_native_tool.py`、`test_plugin_probe.py`、`test_virtual_desktop_session.py`、`test_evidence_ledger.py`、`test_visible_run.py`、`test_trace_multi_screen.py`；命令 `python -m pytest packages/actions/computer-use/tests/test_multi_screen_actor_cursor_contracts.py packages/actions/computer-use/tests/test_native_tool.py packages/actions/computer-use/tests/test_plugin_probe.py packages/actions/computer-use/tests/test_virtual_desktop_session.py packages/actions/computer-use/tests/test_evidence_ledger.py packages/actions/computer-use/tests/test_visible_run.py packages/actions/computer-use/tests/test_trace_multi_screen.py`，最终状态：55 passed；新增 G9 focused guard 后 `python -m pytest packages/actions/computer-use/tests/test_native_tool.py -q`，最终状态：9 passed。
- `E-CU-RUNTIME`：`src/runtime/computer-use/*`、`packages/actions/computer-use/host-adapter-contract.ts`、runtime bridge/host/scheduler/input adapter focused tests；命令 `node --import tsx --test packages/actions/computer-use/provider-policy.test.ts packages/actions/computer-use/host-adapter-contract.test.ts src/runtime/computer-use/host-adapter.test.ts src/runtime/computer-use/package-bridge-host-ports.test.ts src/runtime/computer-use/package-bridge-request.test.ts src/runtime/computer-use/package-bridge-trace.test.ts src/runtime/computer-use/package-bridge-stdio.test.ts src/runtime/computer-use/package-bridge-process.test.ts src/runtime/computer-use/package-bridge-presentation.test.ts src/runtime/computer-use/package-bridge.test.ts src/runtime/computer-use/independent-input-adapter.test.ts src/runtime/computer-use/scheduler.test.ts`，最终状态：76 passed。
- `E-CU-GUI-MODULE`：`src/ui/src/api/sciforgeToolsClient/*`、`src/runtime/modules/dispatcher.ts`、GUI/module/user-acceptance focused tests；命令 `node --import tsx --test tests/smoke/cu-next-live-acceptance-matrix.test.ts tests/smoke/smoke-computer-use-import-boundary-guard.test.ts src/runtime/modules/dispatcher.test.ts src/ui/src/api/sciforgeToolsClient/computerUseWorkspaceGatewayRequest.test.ts src/ui/src/api/sciforgeToolsClient/runtimeEvents.client.test.ts src/ui/src/api/sciforgeToolsClient.policy.test.ts tests/smoke/cu-user-acceptance-manifest.test.ts`，最终状态：86 passed、13 skipped。
- `E-CU-ACCEPTANCE`：`tools/computer-use-next/live-acceptance-validator.ts`、`tests/smoke/cu-next-live-acceptance-matrix.test.ts`；命令 `node --import tsx --test tests/smoke/cu-next-live-acceptance-matrix.test.ts`，最终状态：25 passed。
- `E-CU-BOUNDARY`：`tools/check-module-boundaries.ts`、`tests/smoke/smoke-computer-use-import-boundary-guard.test.ts`、`docs/native-extension-ownership-map.json`；命令 `node --import tsx --test tests/smoke/smoke-computer-use-import-boundary-guard.test.ts`、`npm run smoke:module-boundaries --silent`、`npm run smoke:native-extension-ownership --silent`，最终状态：通过。
- `E-CU-DOCS`：`docs/SemanticModuleEngineering.md`、`docs/Architecture.md`、`docs/TuiGuiProtocol.md`、`docs/NativeExtensionOwnershipMap.md`、`packages/actions/computer-use/README.md`、`packages/actions/computer-use/vision_computer_use_agent_mvp.md`；命令 `git diff --check` 与 `rg -n "virtual mouse|virtual keyboard|one user-visible thread|one docker|one Docker|一线程|一个虚拟鼠标|一个虚拟键盘" docs packages/actions/computer-use src tests PROJECT_CU.md`，最终状态：whitespace 通过；旧词只剩本协议的历史目标/验收描述与 explicit historical evidence note。
- `E-CU-FINAL-GATES`：最终门禁；命令 `npm run typecheck --silent`、`npm run smoke:module-boundaries --silent`、`npm run smoke:native-extension-ownership --silent`、`git diff --check`，最终状态：全部通过。
- `E-CU-PY-FULL-20260531`：package-local Computer Use 全量 Python suite；命令 `PYTHONPATH=packages/actions/computer-use python3 -m pytest packages/actions/computer-use/tests -q`，最终状态：448 passed、1 skipped。
- `E-CU-CODEX-PRODUCT-20260531`：Runtime Codex app-server/native-route、approval retry、continuation sidecar hydration 和 product smoke；命令 `node --import tsx --test src/runtime/codex/codex-runtime-server.test.ts src/runtime/codex/backend-adapters.test.ts src/runtime/codex/codex-app-server-client.test.ts src/runtime/codex/computer-use-text-planner.test.ts src/runtime/computer-use/host-adapter.test.ts src/ui/src/api/sciforgeToolsClient.policy.test.ts tests/smoke/computer-use-chat-live-e2e.test.ts`，最终状态：108 tests、95 passed、13 skipped；命令 `node --import tsx --test tests/smoke/computer-use-chat-live-e2e.test.ts`，最终状态：27 passed；命令 `SCIFORGE_WORKSPACE_PORT=5176 SCIFORGE_WORKSPACE_WRITER_URL=http://127.0.0.1:5176/health SCIFORGE_WORKSPACE_WRITER_BASE_URL=http://127.0.0.1:5176 npm run smoke:computer-use-chat-live-confirmed-approval:opt-in --silent`，最终状态：passed、issues=0、submitted=true、secondSubmitted=true。
- `E-CU-SCOPE-UPDATE-20260531`：用户明确要求 Docker 相关不用继续推进，后续聚焦多屏幕、多鼠标/actor cursor，并确认 BrowserRuntime/DOM 读取能力的接入边界；本次只更新任务板，不改代码。
- `E-CU-M5-M7-NATIVE-DOM-20260531`：native multi-screen / multi-actor cursor gate harness、scheduler screen-serial lease、BrowserRuntime DOM/AX observation refs 和 DOM-aware acceptance matrix；涉及 `packages/actions/computer-use/sciforge_computer_use/native_multi_screen_demo.py`、`browser_runtime_dom_ax_observation.py`、`src/runtime/computer-use/browser-runtime-observation.ts`、`package-bridge-capture-port.ts`、`package-bridge-execute-port.ts`、`scheduler.ts`、`tools/computer-use-next/live-acceptance-validator.ts`、`product-smoke-matrix.ts`、`task-map.ts`、`tests/smoke/cu-next-live-acceptance-matrix.test.ts`、`tests/smoke/helpers/cu-next-runner-fixtures.ts`；命令 `PYTHONPATH=packages/actions/computer-use python3 -m pytest packages/actions/computer-use/tests/test_browser_runtime_dom_ax_observation.py packages/actions/computer-use/tests/test_native_multi_screen_demo.py packages/actions/computer-use/tests/test_multi_screen_actor_cursor_contracts.py packages/actions/computer-use/tests/test_trace_multi_screen.py packages/actions/computer-use/tests/test_evidence_ledger.py -q`，最终状态：24 passed；命令 `node --import tsx --test src/runtime/computer-use/package-bridge-capture-port.test.ts src/runtime/computer-use/package-bridge-execute-port.test.ts src/runtime/computer-use/scheduler.test.ts tests/smoke/cu-next-live-acceptance-matrix.test.ts tests/smoke/cu-user-acceptance-manifest.test.ts tests/smoke/cu-next-user-acceptance-harness.test.ts tests/smoke/cu-next-runner.test.ts tests/smoke/smoke-computer-use-import-boundary-guard.test.ts`，最终状态：88 passed；命令 `npm run typecheck --silent`、`npm run smoke:module-boundaries --silent`、`npm run smoke:native-extension-ownership --silent`、`git diff --check`，最终状态：全部通过。
- `E-CU-M6-LIVE-RUNNER-20260531`：native multi-screen live demo runner、strict DOM/AX hints-only projection、product/live acceptance matrix hardening 和 public surface parity guard；涉及 `packages/actions/computer-use/sciforge_computer_use/native_multi_screen_live_demo.py`、`test_native_multi_screen_live_demo.py`、`api.py`、`__init__.py`、`action-provider.manifest.json`、`src/runtime/computer-use/browser-runtime-observation.ts`、`package-bridge-capture-port.ts`、`package-bridge-execute-port.ts`、`tools/computer-use-next/live-acceptance-validator.ts`、`product-smoke-matrix.ts`、`tests/smoke/cu-next-live-acceptance-matrix.test.ts`、`tests/smoke/helpers/cu-next-runner-fixtures.ts`、`tools/check-module-boundaries.ts`；命令 `PYTHONPATH=packages/actions/computer-use python3 -m pytest packages/actions/computer-use/tests/test_browser_runtime_dom_ax_observation.py packages/actions/computer-use/tests/test_native_multi_screen_demo.py packages/actions/computer-use/tests/test_native_multi_screen_live_demo.py packages/actions/computer-use/tests/test_multi_screen_actor_cursor_contracts.py packages/actions/computer-use/tests/test_trace_multi_screen.py packages/actions/computer-use/tests/test_evidence_ledger.py -q`，最终状态：29 passed；命令 `node --import tsx --test src/runtime/computer-use/package-bridge-capture-port.test.ts src/runtime/computer-use/package-bridge-execute-port.test.ts src/runtime/computer-use/scheduler.test.ts tests/smoke/cu-next-live-acceptance-matrix.test.ts tests/smoke/cu-user-acceptance-manifest.test.ts tests/smoke/cu-next-user-acceptance-harness.test.ts tests/smoke/cu-next-runner.test.ts tests/smoke/smoke-computer-use-import-boundary-guard.test.ts`，最终状态：92 passed；命令 `PYTHONPATH=packages/actions/computer-use python3 -m sciforge_computer_use.native_multi_screen_live_demo --output-dir /tmp/sciforge-cu-native-live-demo-20260531 --run-id live-demo-diagnostic-20260531 --platform macos`，最终状态：expected blocked exit 1，validation accepted，`realNativeSidecarExecuted=false`；命令 `npm run typecheck --silent`、`npm run smoke:module-boundaries --silent`、`npm run smoke:native-extension-ownership --silent`、`git diff --check`，最终状态：全部通过。
- `E-CU-M6-SIDECAR-BINDING-20260531`：M6 opt-in live runner 增加 external native sidecar command binding、stdin/stdout JSON dispatch protocol、sidecar binding ref、cursor event log、after capture/state refs、per-screen screenshot replay frames、lease owner refs、runner validation summary、product smoke validation cross-check、bundle-local product refs 和 boundary probe/provenance guard；涉及 `packages/actions/computer-use/sciforge_computer_use/native_multi_screen_live_demo.py`、`test_native_multi_screen_live_demo.py`、`api.py`、`__init__.py`、`action-provider.manifest.json`、`src/runtime/computer-use/package-bridge-capture-port.ts`、`package-bridge-execute-port.ts`、`package-bridge-execute-port.test.ts`、`tools/computer-use-next/product-smoke-matrix.ts`、`tests/smoke/cu-next-live-acceptance-matrix.test.ts`、`tools/check-module-boundaries.ts`、`tests/smoke/smoke-computer-use-import-boundary-guard.test.ts`；命令 `PYTHONPATH=packages/actions/computer-use python3 -m pytest packages/actions/computer-use/tests/test_browser_runtime_dom_ax_observation.py packages/actions/computer-use/tests/test_native_multi_screen_demo.py packages/actions/computer-use/tests/test_native_multi_screen_live_demo.py packages/actions/computer-use/tests/test_multi_screen_actor_cursor_contracts.py packages/actions/computer-use/tests/test_trace_multi_screen.py packages/actions/computer-use/tests/test_evidence_ledger.py -q`，最终状态：34 passed；命令 `node --import tsx --test src/runtime/computer-use/package-bridge-capture-port.test.ts src/runtime/computer-use/package-bridge-execute-port.test.ts src/runtime/computer-use/scheduler.test.ts tests/smoke/cu-next-live-acceptance-matrix.test.ts tests/smoke/smoke-computer-use-import-boundary-guard.test.ts`，最终状态：51 passed；命令 `npm run typecheck --silent`、`npm run smoke:module-boundaries --silent`、`npm run smoke:native-extension-ownership --silent`、`git diff --check`，最终状态：全部通过。
- `E-CU-M6-DISCOVERY-CONTRACT-20260531`：M6 opt-in live runner 增加 native sidecar `capabilities` / `discover` discovery gate，completed run 必须有 `sidecarCapabilitiesRef`、`sidecarDiscoveryRef`、required tools/features、discovered 2+ screens 与 3 actor cursor plan；product smoke validator 现在要求加载 `validationRef` record，并校验 product refs 位于 current-run bundle；live acceptance 拒绝 DOM/AX claim-only hints，必须有 structured BrowserRuntime observation；action manifest 记录 native multi-screen sidecar protocol。涉及 `packages/actions/computer-use/sciforge_computer_use/native_multi_screen_live_demo.py`、`test_native_multi_screen_live_demo.py`、`test_platform_sidecar.py`、`action-provider.manifest.json`、`tools/computer-use-next/product-smoke-matrix.ts`、`tools/computer-use-next/live-acceptance-validator.ts`、`tests/smoke/cu-next-live-acceptance-matrix.test.ts`；命令 `PYTHONPATH=packages/actions/computer-use python3 -m pytest packages/actions/computer-use/tests/test_browser_runtime_dom_ax_observation.py packages/actions/computer-use/tests/test_native_multi_screen_demo.py packages/actions/computer-use/tests/test_native_multi_screen_live_demo.py packages/actions/computer-use/tests/test_multi_screen_actor_cursor_contracts.py packages/actions/computer-use/tests/test_trace_multi_screen.py packages/actions/computer-use/tests/test_evidence_ledger.py packages/actions/computer-use/tests/test_platform_sidecar.py -q`，最终状态：44 passed；命令 `node --import tsx --test src/runtime/computer-use/package-bridge-capture-port.test.ts src/runtime/computer-use/package-bridge-execute-port.test.ts src/runtime/computer-use/scheduler.test.ts tests/smoke/cu-next-live-acceptance-matrix.test.ts tests/smoke/smoke-computer-use-import-boundary-guard.test.ts`，最终状态：52 passed；命令 `PYTHONPATH=packages/actions/computer-use python3 -m sciforge_computer_use.native_multi_screen_live_demo --output-dir /tmp/sciforge-cu-native-live-demo-discovery-20260531 --run-id live-demo-discovery-diagnostic-20260531 --platform macos`，最终状态：expected blocked exit 1，validation accepted，`sidecarCapabilitiesRef=null`、`sidecarDiscoveryRef=null`、`realNativeSidecarExecuted=false`；命令 `npm run typecheck --silent`、`npm run smoke:module-boundaries --silent`、`npm run smoke:native-extension-ownership --silent`、`git diff --check`，最终状态：全部通过。
- `E-CU-M6-TARGET-DOM-BINDING-20260531`：M6 opt-in live runner 把 per-screen preflight `allowedWindowRefs` 绑定到 native sidecar discovery windows 与 user-control allowlist，execute target 改为 discovery/state/capture-backed `targetRef` / `regionRef` / `discoveryRef` / `stateRef`，并把 `targetRefs` 写入 current bundle；completed validator 拒绝缺 discovery window、preflight window 越过 discovery allowlist、固定 magic execute target。live acceptance 进一步要求 DOM/AX claim refs 必须来自 structured BrowserRuntime observation refs，且每个 structured observation ref 必须绑定 observe-before-mutate 或 mutating action；module boundary guard 校验 native sidecar protocol required tools、capabilities 与 completed refs。涉及 `packages/actions/computer-use/sciforge_computer_use/native_multi_screen_live_demo.py`、`packages/actions/computer-use/tests/test_native_multi_screen_live_demo.py`、`tools/computer-use-next/live-acceptance-validator.ts`、`tests/smoke/cu-next-live-acceptance-matrix.test.ts`、`tools/check-module-boundaries.ts`、`tests/smoke/smoke-computer-use-import-boundary-guard.test.ts`；命令 `PYTHONPATH=packages/actions/computer-use python3 -m pytest packages/actions/computer-use/tests/test_browser_runtime_dom_ax_observation.py packages/actions/computer-use/tests/test_native_multi_screen_demo.py packages/actions/computer-use/tests/test_native_multi_screen_live_demo.py packages/actions/computer-use/tests/test_multi_screen_actor_cursor_contracts.py packages/actions/computer-use/tests/test_trace_multi_screen.py packages/actions/computer-use/tests/test_evidence_ledger.py packages/actions/computer-use/tests/test_platform_sidecar.py -q`，最终状态：47 passed；命令 `node --import tsx --test src/runtime/computer-use/package-bridge-capture-port.test.ts src/runtime/computer-use/package-bridge-execute-port.test.ts src/runtime/computer-use/scheduler.test.ts tests/smoke/cu-next-live-acceptance-matrix.test.ts tests/smoke/smoke-computer-use-import-boundary-guard.test.ts`，最终状态：54 passed；命令 `node --import tsx --test tests/smoke/cu-next-live-acceptance-matrix.test.ts`，最终状态：32 passed；命令 `node --import tsx --test tests/smoke/smoke-computer-use-import-boundary-guard.test.ts`，最终状态：4 passed；命令 `PYTHONPATH=packages/actions/computer-use python3 -m sciforge_computer_use.native_multi_screen_live_demo --output-dir /tmp/sciforge-cu-native-live-demo-targets-20260531 --run-id live-demo-targets-diagnostic-20260531 --platform macos`，最终状态：expected blocked exit 1，validation accepted，`targetRefs` present，`realNativeSidecarExecuted=false`；命令 `npm run typecheck --silent`、`npm run smoke:module-boundaries --silent`、`npm run smoke:native-extension-ownership --silent`、`git diff --check`，最终状态：全部通过。
- `E-CU-M7-REF-HYGIENE-PRODUCT-DEEP-20260531`：BrowserRuntime DOM/AX observation 接入补强 ref hygiene：TS capture materializer canonicalize object-form stable refs、丢弃带 `ref/refs` 或 raw DOM/inline payload 的 stable ref、限制 PageQuery `ref/withinRef` 为 stable token，并对 session/tab/snapshot refs 执行 bundle-local guard；Python validator 要求 `refsFirst=true`、`currentBundleOnly=true`、bundle-local refs，并拒绝外部 PageQuery refs 与 stableRef 内嵌 refs。product smoke `multi-screen-live-demo` validationRef 从 summary 投影升级为深校验：validation record 必须证明 runId/currentBundleRef、sidecar binding/capabilities/discovery refs、scheduler lease refs、replayRef、targetRefs、current bundle membership 和非 diagnostic native sidecar binding。涉及 `src/runtime/computer-use/browser-runtime-observation.ts`、`src/runtime/computer-use/package-bridge-capture-port.test.ts`、`packages/actions/computer-use/sciforge_computer_use/browser_runtime_dom_ax_observation.py`、`packages/actions/computer-use/sciforge_computer_use/native_multi_screen_demo.py`、`packages/actions/computer-use/tests/test_browser_runtime_dom_ax_observation.py`、`tools/computer-use-next/product-smoke-matrix.ts`、`tests/smoke/cu-next-live-acceptance-matrix.test.ts`；命令 `node --import tsx --test src/runtime/computer-use/package-bridge-capture-port.test.ts`，最终状态：4 passed；命令 `PYTHONPATH=packages/actions/computer-use python3 -m pytest packages/actions/computer-use/tests/test_browser_runtime_dom_ax_observation.py -q`，最终状态：5 passed；命令 `npm run smoke:cu-next-live-acceptance --silent`，最终状态：32 passed；命令 `PYTHONPATH=packages/actions/computer-use python3 -m pytest packages/actions/computer-use/tests/test_browser_runtime_dom_ax_observation.py packages/actions/computer-use/tests/test_native_multi_screen_demo.py packages/actions/computer-use/tests/test_native_multi_screen_live_demo.py packages/actions/computer-use/tests/test_multi_screen_actor_cursor_contracts.py packages/actions/computer-use/tests/test_trace_multi_screen.py packages/actions/computer-use/tests/test_evidence_ledger.py packages/actions/computer-use/tests/test_platform_sidecar.py -q`，最终状态：48 passed；命令 `node --import tsx --test src/runtime/computer-use/package-bridge-capture-port.test.ts src/runtime/computer-use/package-bridge-execute-port.test.ts src/runtime/computer-use/scheduler.test.ts tests/smoke/cu-next-live-acceptance-matrix.test.ts tests/smoke/smoke-computer-use-import-boundary-guard.test.ts`，最终状态：55 passed；命令 `PYTHONPATH=packages/actions/computer-use python3 -m pytest packages/actions/computer-use/tests -q`，最终状态：472 passed、1 skipped；命令 `npm run typecheck --silent`、`npm run smoke:module-boundaries --silent`、`npm run smoke:native-extension-ownership --silent`、`git diff --check`，最终状态：全部通过。
- `E-CU-M6-MACOS-VIRTUAL-LIVE-20260531`：M6 真实 macOS native sidecar live pass。新增 `sciforge_computer_use.macos_native_sidecar` stdin/stdout sidecar command，使用 CoreGraphics display discovery、CGWindowList window discovery、`screencapture` per-virtual-screen capture、refs-first state/preflight 和 independent virtual-screen input event log；screen 是 task-space virtual screen，`physicalMultiDisplayRequired=false`，没有多块物理屏时会把一个 native capture backing split 成 2 个 virtual screens，不依赖 Docker/noVNC、fixture、diagnostic sidecar、demo app/window title 或历史 run。runner 现在写 `validationRef` record，包含 runId/currentBundleRef、sidecar binding/capabilities/discovery、scheduler lease refs、replayRef、targetRefs、currentBundle 和 refs 深证明。真实 run：`PYTHONPATH=packages/actions/computer-use python3 -m sciforge_computer_use.native_multi_screen_live_demo --output-dir /tmp/sciforge-cu-m6-macos-virtual-live-20260531b --run-id m6-macos-virtual-live-20260531b --platform macos --sidecar-command "python3 -m sciforge_computer_use.macos_native_sidecar" --sidecar-timeout-seconds 20`，最终状态：exit 0，`status=completed`、`realNativeSidecarExecuted=true`、`completionEligible=true`、2 virtual screens、3 actor cursors、3 discovered window/window refs、per-screen `allowedWindowRefs`、3 scheduler lease refs、3 target refs、move/point/annotate cursor events、before/after capture/state refs、6 executor/input event refs、2 non-placeholder replay frames、`validationRef=/private/tmp/sciforge-cu-m6-macos-virtual-live-20260531b/m6-live-demo-validation.json`、`currentBundleRef=/private/tmp/sciforge-cu-m6-macos-virtual-live-20260531b/current-bundle.json`；execute 使用 independent virtual-screen adapter，`sharedSystemInputUsed=false`、`systemPointerMoved=false`、`systemKeyboardEventsSent=false`，不宣称真实 GUI mutation。命令 `PYTHONPATH=packages/actions/computer-use python3 -m pytest packages/actions/computer-use/tests/test_macos_native_sidecar.py packages/actions/computer-use/tests/test_native_multi_screen_live_demo.py packages/actions/computer-use/tests/test_platform_sidecar.py -q`，最终状态：25 passed；命令 `validate_native_multi_screen_live_demo_run('/tmp/sciforge-cu-m6-macos-virtual-live-20260531b/native-multi-screen-live-demo-run.json', require_existing_refs=True)`，最终状态：`ok=True`、`status=accepted`。

## 当前实现偏差与守护任务

当前判断：现有 Computer Use 实现有可运行雏形，但还没有严格遵守 `docs/Architecture.md`、`docs/TuiGuiProtocol.md` 和 Native Extension ownership 的边界。先完成本节 P0 偏差整改，再继续做真实多屏/多光标能力。

P0 审计分类（2026-05-31，evidence: `E-CU-PY-CONTRACT`, `E-CU-RUNTIME`, `E-CU-GUI-MODULE`, `E-CU-BOUNDARY`, `E-CU-DOCS`）：

| P0 | 分类 | 最终状态 |
| --- | --- | --- |
| P0-CU-01 | `legacy-shim` + `must-fix` | 已封为显式 diagnostic shim；默认 GUI 只发 terminal-equivalent text。 |
| P0-CU-02 | `must-fix` | 已抽出 host adapter/host-port contract。 |
| P0-CU-03 | `diagnostic-only` | package-local native tool/debug 闭环已完成，真实 production host 仍由 app-server 接入。 |
| P0-CU-04 | `must-fix` | multi-screen/actor-cursor provenance 已进入 Python/TS/trace/replay/validator。 |
| P0-CU-05 | `must-fix` | scheduler ownership/lease/action causality 已重写。 |
| P0-CU-06 | `must-fix` | independent input adapter 已转为 actor cursor log + scoped executor projection。 |
| P0-CU-07 | `must-fix` | evidence/replay/validator 已按 screen/window scope 和 bundle-local refs 校验。 |
| P0-CU-08 | `already-compliant-after-doc-fix` | Docker/container 已降级为 backend packaging。 |
| P0-CU-09 | `must-fix` | `module.*` actions/gui intent 和 fail-closed tests 已补齐。 |
| P0-CU-10 | `must-fix` | L0/L1/L2 责任表和 import guard 已补齐。 |
| P0-CU-11 | `must-fix` | Runtime Codex app-server/native-route 已接入 Computer Use package bridge；confirmed approval product smoke 已通过。 |
| P0-CU-12 | `must-fix` | shared contract / TUI provider / GUI presentation import 边界已守护。 |
| P0-CU-13 | `must-fix` | package result no-internal-task-brain guard 已补齐。 |
| P0-CU-14 | `must-fix` | L1 allowed/forbidden matrix 已文档化并由 boundary guard 覆盖。 |

- [x] P0-CU-01：收敛 GUI 直达 `/computer-use` 的特殊入口。
  现状：`src/ui/src/api/sciforgeToolsClient/computerUseWorkspaceGatewayRequest.ts` 和 `client.ts` 将 Computer Use 作为 Workspace Gateway 特殊请求发送。
  TODO：把该路径标记为 legacy/diagnostic shim；正式路径必须是 user text -> Codex app-server/CLI -> native Computer Use plugin/tool -> package action loop -> TUI Host events -> GUI presentation/confirmation。GUI 不拥有 Computer Use 执行入口。
  状态（2026-05-31，evidence: `E-CU-GUI-MODULE`）：已完成。默认 `/computer-use` 与选中 CU action 均保留为 terminal-equivalent text；legacy Workspace Gateway 仅允许显式 diagnostic flag，且不注入 provider route、shared executor 参数或 Computer Use 执行策略。

- [x] P0-CU-02：抽离 SciForge runtime 私有 package bridge。
  现状：`src/runtime/computer-use/package-bridge.ts` 和 `package-bridge-host-port.ts` 同时承担 host ports、trace、callbacks、workspace runtime glue。
  TODO：抽出无 GUI 依赖的 `ComputerUseHostAdapter` / host-port contract；Codex CLI plugin 和 SciForge runtime 复用同一 adapter，SciForge 只负责注入 workspace/session context 和展示事件。
  状态（2026-05-31，evidence: `E-CU-RUNTIME`）：已完成。新增 package/shared host adapter contract 与 runtime host adapter tests；SciForge runtime 只做 workspace/session/callback 注入与事件适配。

- [x] P0-CU-03：先稳定 Codex CLI + Computer Use plugin，再迁移 SciForge。
  现状：Computer Use action provider 主要由 SciForge runtime 触发，不是 Codex native tool/plugin 的首选执行面。
  TODO：在 `packages/actions/computer-use` 内增加 Codex native MCP/tool/plugin 调试入口，支持 `observe`、`move_cursor`、`propose_action`、`execute_scoped_action`、`get_replay_refs` 等最小闭环；先跑 CLI smoke，再接 SciForge app-server 注入。
  状态（2026-05-31，evidence: `E-CU-PY-CONTRACT`）：已完成 package-local native tool/debug 面。`sciforge_computer_use.native_tool` 提供五个 refs-first debug tools、manifest/validator/CLI，并在缺 host-bound executor 时 fail closed 为 diagnostic/blocked。

- [x] P0-CU-04：补齐 multi-screen / actor-cursor provenance。
  现状：`packages/actions/computer-use/sciforge_computer_use/contracts.py`、`src/runtime/computer-use/types.ts` 和 runtime trace 仍偏单 screen/display；缺少稳定的 `displayGroupId`、`screenId`、`actorId`、`cursorId`、`leaseScope`。
  TODO：所有 request、observation、grounding、proposal、executor event、verification、result 和 replay frame 都必须携带 screen/window/actor/cursor provenance；旧字段只能作为兼容 projection。
  状态（2026-05-31，evidence: `E-CU-PY-CONTRACT`, `E-CU-RUNTIME`, `E-CU-ACCEPTANCE`）：已完成。Python contract、TS runtime type、trace/result/replay、acceptance manifest 均要求 display group/screen/window/actor/cursor/lease provenance；旧字段只保留 projection。

- [x] P0-CU-05：重写 scheduler ownership 语义。
  现状：`src/runtime/computer-use/scheduler.ts` 的 lock 主要按 target/window/shared input 推导，没有完整表达 screen/window scoped lease、actor owner、cursor owner 和 action causality。
  TODO：实现 screen-global lease、window-local lease、approval stop、取消/超时/拒绝原因、executor event ref 和 stale evidence invalidation；裸全局坐标 action 必须 fail closed。
  状态（2026-05-31，evidence: `E-CU-RUNTIME`）：已完成。scheduler tests 覆盖 screen/window lease、actor/cursor owner、approval stop、取消/拒绝/超时、executor event ref、stale invalidation 与裸全局坐标 fail closed。

- [x] P0-CU-06：把 independent input adapter 从单指针状态改成 actor cursor + executor projection。
  现状：`src/runtime/computer-use/independent-input-adapter.ts` 仍以单个 `virtualPointer` / `virtualKeyboard` 表达隔离输入。
  TODO：维护 append-only actor cursor log；presentation 可显示多个 cursor，但真实 mutating input 只通过 scoped executor projection 执行。
  状态（2026-05-31，evidence: `E-CU-RUNTIME`）：已完成。adapter 维护 actor cursor log 与 executor projection；模拟 provider 仅在无显式 window/lease 时做 package-owned virtual window projection，显式裸全局 pointer 仍 fail closed。

- [x] P0-CU-07：修正 evidence/replay 的单屏假设。
  现状：trace、viewer、acceptance 仍容易把 `displayId` 或最新截图当成全局当前状态。
  TODO：evidence freshness 必须按 screen/window scope 失效；replay manifest 必须支持 multi-screen frame、cursor overlay、lease owner、before/after evidence refs；validator 拒绝 placeholder-only、缺 provenance、跨 bundle refs。
  状态（2026-05-31，evidence: `E-CU-PY-CONTRACT`, `E-CU-ACCEPTANCE`）：已完成。ledger freshness、planner brief、trace/replay viewer 与 validator 均按 screen/window scope、multi-screen frame、cursor overlay、lease owner、before/after refs 与 bundle-local refs 校验。

- [x] P0-CU-08：降级 Docker/container 的产品语义。
  现状：历史方案容易把 one Docker/process 当作并发隔离模型。
  TODO：Docker 只保留为 sandbox/backend packaging/resource lifecycle；并发协作模型只能来自 display group、actor cursor、scheduler 和 executor adapter contract。
  状态（2026-05-31，evidence: `E-CU-DOCS`, `E-CU-BOUNDARY`）：已完成。Architecture、ownership map、README 和 Computer Use MVP 文档均把 container 限定为 sandbox/backend lifecycle；并发模型固定为 display group、actor cursor、scheduler 和 executor adapter。

- [x] P0-CU-09：补齐 GUI-TUI / `module.*` 接口合规层。
  现状：`src/runtime/modules/dispatcher.ts` 已有 `module.describe/query/read/invoke` skeleton，但 Computer Use 当前主要经 `vision-sense-runtime` -> `runComputerUsePackageBridge` 特殊路径进入；`actions` module 仍是 describe-only，尚未成为 Computer Use 的 canonical action boundary。
  TODO：Computer Use 的正式执行面必须能表达为 Codex native tool/plugin/MCP 或 `module.invoke({ moduleId: 'actions', intent: 'execute' })`；TUI Host 再把结果映射为 `module.invoke({ moduleId: 'gui', intent: 'present|ask_user|notify|set_status' })` 或迁移期 `gui.*` alias。任何未声明 module function/intent 的调用必须 fail closed。
  状态（2026-05-31，evidence: `E-CU-GUI-MODULE`, `E-CU-RUNTIME`）：已完成。dispatcher actions execute intent 和 fail-closed tests 已覆盖；TUI -> GUI 通过 declared GUI intents/迁移 alias，GUI -> TUI 仅输出 terminal-equivalent text。

- [x] P0-CU-10：按 L0/L1/L2 重新标注 Computer Use 文件和责任。
  现状：`package-bridge`、`host-adapter`、`plan` host port、scheduler、executor、evidence writer 和 verifier 边界混在 `src/runtime/computer-use` 与 package 内，容易让 runtime 或 action provider 变成半个 L2。
  TODO：建立责任表：L2 是 Codex app-server/CLI Agent Host；L1 是 Computer Use resource/session adapter；L0 是 capture、ground、execute、verify、trace、emit event 等 handlers。任何会选择跨模块下一步、组合 browser/file/verifier/gui、判断用户级 completion 的逻辑必须回到 L2。
  状态（2026-05-31，evidence: `E-CU-DOCS`, `E-CU-BOUNDARY`）：已完成。新增/更新 ownership map、SemanticModuleEngineering 和 architecture 责任表；module/import boundary guard 阻止 GUI/runtime/provider 混层。

- [x] P0-CU-11：收敛生产运行目标到 Codex app-server。
  现状：Computer Use 调试可以先走 Codex CLI/native plugin，但历史 `AgentServer`、runtime gateway、`codex exec --json` 路径仍容易被当作产品 fallback。
  TODO：生产默认目标是 `CodexAppServerAdapter` + Codex native plugin/tool/MCP；`CodexExecJsonAdapter`、runtime gateway 和 `/computer-use` Workspace Gateway 只能作为 legacy/test-only/diagnostic adapter，不得出现在新增 public API 中。
  状态（2026-05-31，evidence: `E-CU-CODEX-PRODUCT-20260531`, `E-CU-GUI-MODULE`）：已完成。`CodexAppServerClient` 在顶层 `/computer-use` slash command 上走 Runtime Codex native package bridge，GUI 只发送 terminal-equivalent text；`/computer-use approve` 在 resume 场景仍保持 slash command 首行并携带 bounded approval metadata。真实 confirmed approval retry product smoke 已通过；`CodexExecJsonAdapter`、runtime gateway 与 Workspace Gateway 仅保留 legacy/test-only/diagnostic 语义。

- [x] P0-CU-12：按 shared contract / TUI provider / GUI presentation 三层拆包。
  现状：Computer Use presentation、runtime glue、host-port policy、trace sidecar 和 action contract 的 import 边界需要重新审计。
  TODO：纯 schema/helper 放在 package-owned contract 或 shared runtime contract；TUI action provider、manifest、host-port adapter 放在 `packages/actions/computer-use`；多屏 replay/overlay/workbench 展示放在 `packages/presentation/components` 或 `src/ui` host 装配层。`src/ui/**` 只能 import shared contract 与 GUI presentation package，不得 import Computer Use action provider、runtime bridge 或 observe provider implementation。
  状态（2026-05-31，evidence: `E-CU-BOUNDARY`, `E-CU-RUNTIME`）：已完成。shared contract、TUI provider/host-port adapter、GUI presentation imports 已拆分并由 smoke import boundary guard 覆盖。

- [x] P0-CU-13：禁止 Computer Use 内部任务大脑。
  现状：Computer Use 需要 domain-local observe/ground/execute/verify loop，但 loop、planner host port、completion guard 和 repair hints 容易越界成独立 task agent。
  TODO：Computer Use 只能输出 evidence、blocked、approval request、repair hint、candidate completion refs 和 compact result；用户级 completion、跨模块下一步、browser/file/gui/verifier 串联、retry/repair policy 必须由 L2 Root Agent Host 决定。
  状态（2026-05-31，evidence: `E-CU-PY-CONTRACT`, `E-CU-RUNTIME`）：已完成。新增 native tool focused guard，确认 package result 不输出 next-step/cross-module/user-level completion/gui intent；runtime bridge 仅透传 evidence/blocked/approval/candidate refs。

- [x] P0-CU-14：写清 L1 允许/禁止矩阵。
  现状：`resource adapter` 容易变成模糊口袋，把 session 管理、backend lifecycle、planning、completion 和 GUI presentation 混在一起。
  TODO：L1 允许管理 display group、screen、actor cursor、lease、evidence、replay refs、adapter readiness、backend lifecycle、version compatibility 和 L0 handler routing；禁止 planning、capability ranking、prompt route、cross-module calls、GUI renderer dependency、workspace write policy 和用户级 completion。
  状态（2026-05-31，evidence: `E-CU-DOCS`, `E-CU-BOUNDARY`）：已完成。L1 allowed/forbidden matrix 写入 architecture/ownership docs 和 manifest，并由 module-boundary/import guard 覆盖禁止项。

## 设计规范 Gate

- [x] GUI -> TUI 只发送终端等价文本；GUI 不注入 provider route、action policy、capability ranking、desktop bridge policy 或 Computer Use executor 参数。
- [x] TUI -> GUI 只通过 `module.invoke({ moduleId: 'gui', intent })`；迁移期 `gui.*` 只能是 adapter alias，不能成为 package/runtime 直接依赖。
- [x] 所有 public module surface 必须从 `module.describe/query/read/invoke` 进入；`module.describe` 未声明的 function、intent、facet 或 ref prefix 必须 fail closed。
- [x] L2/L1/L0 不能混层：L2 负责任务规划和跨模块 pipeline，L1 负责 Computer Use session/resource adapter，L0 负责单个 desktop/capture/ground/verify/trace 动作。
- [x] 一个 active Computer Use task 不得同时存在两个会决定下一步的 L2；内部 action loop 只能做 domain-local scheduling 和 verification，不能替代 Root Agent Host。
- [x] Computer Use 的 `complete` 只能是 domain-local verdict 或 candidate completion refs；用户级 success 必须由 L2 结合 artifact/verifier/pipeline evidence 判断。
- [x] 多鼠标默认只能是 actor cursor、intent proposal、lease owner 和 replay overlay；真实 OS multi-pointer/multi-seat 只能作为可替换 executor backend。
- [x] 不新增 GUI 直接执行 Computer Use action 的路径；GUI 只做 presentation、focus、confirmation 和 terminal-equivalent text。
- [x] 不新增仅存在于 `src/runtime/computer-use` 的核心 Computer Use policy；新 policy 必须落到 `packages/actions/computer-use` 的 contract/test，runtime 只做 host adaptation。
- [x] 每个 mutating action 必须有 actor/cursor/screen/window provenance、before/after evidence refs、grounding refs、executor event ref、verification refs 和 lease scope。
- [x] Cursor move、point、annotate 不能被记录为真实 GUI mutating action；click/type/drag/scroll/hotkey/open menu/save 必须经过 scheduler。
- [x] 新 completed/user-acceptance evidence 不能依赖 shared system input、placeholder viewer、旧截图、裸全局坐标或 GUI 私有状态。
- [x] 每轮 Computer Use 代码变更后运行对应 focused tests、`git diff --check`，并更新本文件 TODO 状态；`npm run smoke:native-extension-ownership` 若因既有无关问题失败，必须记录具体阻塞点。

状态（2026-05-31，evidence: `E-CU-PY-CONTRACT`, `E-CU-RUNTIME`, `E-CU-GUI-MODULE`, `E-CU-ACCEPTANCE`, `E-CU-BOUNDARY`, `E-CU-FINAL-GATES`）：本节 Gate 已完成。focused package/runtime/gui/validator/boundary tests、whitespace、typecheck 和 smoke gates 均通过。

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

输入模型：

```text
ActorCursor
  -> presence / pointer movement / intent proposal
ActionTarget
  -> screen | window | element | region | artifact intent
ActionScheduler
  -> screen lease | window lease | approval gate
ExecutorAdapter
  -> host-specific click/type/drag/scroll/hotkey
EvidenceLedger
  -> actor/cursor/screen/window/action causality
UserControlPlane
  -> session permission | app/window allowlist | risk preview | stop/cancel
PlatformSidecarAdapter
  -> OS capture/state/input/preflight refs
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

scope 规则：

- `cursor move`、`point`、`annotate`、`observe`、`crop`、`OCR`、`VLM describe` 是只读或 presentation 行为，不需要 executor lease。
- window-local 的 click/type/scroll/drag 可以申请 window lease，但执行时必须证明 target window、bounds、focus、before/after evidence 和 executor outcome。
- screen-global 的 app switch、window switch、system menu、global hotkey、save dialog、permission prompt 和高风险确认必须申请 screen lease。
- 同一 screen 的真实 GUI focus 默认只有一个；多个 actor 可以同时提出 proposal，但 mutating action 必须排队、可取消、可回放。

## 任务板：Multi-Screen Actor-Cursor Computer Use

### Contract / Schema

- [x] 定义 Computer Use L0/L1/L2 module boundary contract。
  验收：`module.describe` 或 Codex native tool manifest 能声明 Computer Use 的 L1 adapter、L0 handler intents、side effects、approval、events、refs、limits 和 unsupported functions；未声明 intent fail closed。

- [x] 定义 multi-screen session schema。
  验收：`VirtualDesktopSession` manifest 能声明 `displayGroupRef`、`screenRefs`、`actorCursorLogRef`、`inputQueueRef`、`executorLeaseRefs`、`captureStreamRef`、`replayBundleRef` 和 isolation flags；旧单 display 字段只作为兼容 projection。

- [x] 定义 `VirtualDisplayGroup` / `VirtualScreen` contract。
  验收：screen identity、geometry、scale、backend binding、capture source、window namespace 和 resource allocation refs 可被 validator 读取；多 screen 不共享模糊坐标空间。

- [x] 定义 `ActorCursor` / cursor event contract。
  验收：每个 cursor event 至少包含 `actorId`、`cursorId`、`screenId`、可选 `windowId`、颜色/label、position、state、timestamp、source 和 refs；cursor move 不被误记为 mutating GUI action。

- [x] 定义 action proposal 和 scoped executor lease contract。
  验收：mutating action 必须携带 actor/cursor provenance、target scope、risk level、approval state、lease id、executor event ref、before/after evidence refs 和 verification refs。

- [x] 定义 user control / session permission contract。
  验收：每个真实 mutating run 都能声明 `sessionPermissionRef`、`allowedAppRefs`、`allowedWindowRefs`、`forbiddenAppRefs`、`inputModalityPolicy`、`riskPreviewRef`、`dataVisibilityRef`、`stopRef` / `cancelLeaseRef` 和 approval mode；缺任一项时 validator fail closed 为 diagnostic/blocked。
  状态（2026-05-31，evidence: `E-CU-PY-FULL-20260531`）：已完成。`user_control.py` 与 focused contract/validator tests 覆盖 permission、allowlist、risk preview、data visibility、stop/cancel refs 和第三方指令不可替代用户确认。

- [x] 定义 Codex-style local plugin / MCP contract。
  验收：repo-local `plugin.json`、`.mcp.json` 和 skill 文档能声明 `sciforge.computer-use`，Codex CLI/app-server 可发现；plugin 只转发到 package host ports、scheduler、evidence ledger 和 validator，不引入 GUI direct action 或 runtime-only policy。
  状态（2026-05-31，evidence: `E-CU-PY-FULL-20260531`, `E-CU-CODEX-PRODUCT-20260531`）：已完成。repo 根 `plugin.json`、`.mcp.json` 与 `packages/actions/computer-use/skills/` 已声明 `sciforge.computer-use`；plugin probe 和 native tool tests 通过，GUI/runtime private policy 未进入 public manifest。

- [x] 定义小而稳定的 public tool surface。
  验收：公共工具面只包含 `get_app_state` / `observe`、`click`、`type_text`、`scroll`、`press_key`、`propose_action`、`execute_scoped_action`、`get_replay_refs` 等稳定原语；click/type/scroll/press_key 必须内部投影为 scoped proposal + lease + executor event + evidence refs；裸全局坐标、provider route、GUI private state 和 scheduler internals 不得出现在公共参数里。
  状态（2026-05-31，evidence: `E-CU-PY-FULL-20260531`）：已完成。`native_tool.py` / MCP server 仅暴露窄工具面；mutating facade 进入 proposal/lease/evidence 路径，裸全局坐标、provider route、GUI private state 和 scheduler internals 均由 schema/probe fail closed。

- [x] 定义 platform sidecar / MCP adapter contract。
  验收：sidecar manifest 声明 platform、capture/state/input/preflight tools、permission requirements、isolation flags、supported input modalities、executor event schema、unsupported actions 和 no-planning/no-completion policy；GUI/runtime 不能 import sidecar implementation。
  状态（2026-05-31，evidence: `E-CU-PY-FULL-20260531`, `E-CU-BOUNDARY`, `E-CU-SCOPE-UPDATE-20260531`）：已完成 contract/diagnostic MVP。`platform_sidecar.py` 声明 capture/state/input/preflight、permission/isolation/no-planning/no-completion，并由 boundary tests 确认 GUI/runtime 不 import sidecar implementation；真实推进已转向 native multi-screen / multi-actor cursor gate。

- [x] 更新 ownership manifest。
  验收：`docs/native-extension-ownership-map.json` 的 Computer Use migration subtasks 覆盖 multi-screen、actor cursor、scheduler lease、executor adapter、viewer overlay 和 validator；`npm run smoke:native-extension-ownership` 只因无关既有问题失败时必须记录阻塞点。

状态（2026-05-31，evidence: `E-CU-PY-CONTRACT`, `E-CU-RUNTIME`, `E-CU-BOUNDARY`）：Contract / Schema 本节已完成。schema/validator、native tool manifest、runtime TS types、ownership manifest 与 fail-closed tests 均通过。

### Session / State

- [x] 实现 session permission store。
  验收：run root 写出 `session-permission.json`、`app-window-allowlist.json`、`risk-preview.json`、`data-visibility.json` 和 `stop-cancel-lease.json`；记录来源、用户确认、过期时间、allowed/forbidden scope、读取/输入范围和 current lease cancellation refs。
  状态（2026-05-31，evidence: `E-CU-PY-FULL-20260531`）：已完成。user-control store/validator tests 覆盖 session permission、allowlist、risk/data visibility、stop/cancel lease refs、过期和缺 ref fail closed。

- [x] 扩展 `SessionManager` skeleton。
  验收：创建 session root 时写出 `virtual-display-group.json`、`virtual-screens.json`、`actor-cursors.jsonl`、`virtual-input-queue.jsonl`、`leases/*.json`、blocked manifest 和 no-secret diagnostics。

- [x] 实现 actor cursor state store。
  验收：cursor presence、move、point、annotate、proposal、takeover/release 都 append-only 记录；可从 log 重建当前 screen 上所有 cursor 状态。

- [x] 实现 screen/window scoped lease manager。
  验收：screen-global action 与 window-local action 的互斥规则可测试；错误 lease、重复 lease、stale lease、跨 screen lease 都 fail closed。

- [x] 保留旧 single-screen diagnostic compatibility。
  验收：现有 L1/L3 diagnostic harness 不因缺 multi-screen backend 失效，但所有 completed/user-acceptance 证据必须显式声明 screen identity 和 executor scope。

状态（2026-05-31，evidence: `E-CU-PY-CONTRACT`, `E-CU-RUNTIME`）：Session / State 本节已完成。session skeleton、append-only actor cursor log、scoped lease refs、blocked manifest、no-secret diagnostics 与旧 single-screen projection compatibility 均有 focused tests 覆盖。

### Scheduler / Executor

- [x] 接入 stop/cancel lease path。
  验收：GUI/TUI stop signal 只能取消或拒绝 scheduler lease，不能直接杀 package state；取消后 executor event、blocked/aborted manifest、trace 和 replay refs 可证明动作没有继续执行。
  状态（2026-05-31，evidence: `E-CU-RUNTIME`, `E-CU-PY-FULL-20260531`）：已完成。scheduler/user-control tests 覆盖 stop/cancel 只作用于 lease/queue，输出 blocked/aborted refs 和未继续执行证明。

- [x] 实现 action scheduler queue。
  验收：多个 actor 同时提交 proposal 时，scheduler 输出确定性顺序、状态变化、取消/拒绝原因和 action causality refs。

- [x] 更新 executor adapter contract。
  验收：executor 不接受裸全局坐标；pointer action 必须绑定 screen/window target、target bounds、coordinate space、executor command event 和 actor/cursor provenance。

- [x] 区分只读 cursor movement 与 mutating input。
  验收：cursor move/point/annotate 不 invalidate visible evidence；click/type/drag/scroll/hotkey/open menu/save 默认 invalidate 对应 screen/window 的 stale visible evidence。

- [x] 接入 approval gate。
  验收：高风险 proposal 在 scheduler 阶段停为 `needs-confirmation`，未确认不产生 executor event；confirmed retry 绑定原 approval sidecars 和同一 risk action hash。

状态（2026-05-31，evidence: `E-CU-RUNTIME`, `E-CU-PY-CONTRACT`）：Scheduler / Executor 本节已完成。queue、lease、executor adapter、只读 cursor movement、mutating stale invalidation 和 approval stop/retry 均在 focused tests 中通过。

### Capture / Grounding / Evidence

- [x] 强制 observe-before-mutate contract。
  验收：任何 click/type/drag/scroll/hotkey/save/open menu 前必须有同 screen/window scope 的当前 app state ref、screenshot/capture ref、accessibility/state snapshot ref、grounding ref 和 freshness check；缺失、过期或 scope 不匹配时返回 `blocked` / `needs-observation`。
  状态（2026-05-31，evidence: `E-CU-PY-FULL-20260531`, `E-CU-RUNTIME`）：已完成。scheduler、evidence ledger、native tool 和 acceptance validator 覆盖 mutating action 前 observation/grounding/freshness/scope refs；缺失或 stale 时 fail closed 为 `needs-observation` / `blocked`。

- [x] 让 observation/crop 支持 `screenId` 和 `windowId`。
  验收：整屏截图、窗口截图、focus crop、OCR/VLM claim 都能追溯到具体 screen/window；planner brief 不混用不同 screen 的 current evidence。

- [x] 更新 grounding metadata。
  验收：grounder 输出 screen/window-local target、bounds、confidence、focus region、diagnostics 和 source observation refs；不能让 planner 直接输出最终坐标。

- [x] 扩展 evidence ledger freshness 规则。
  验收：staleBy 按 screen/window scope 失效；只读 evidence enrichment 不失效；mutating action 只失效相关 visible state，不错误清空 artifact/verifier evidence。

- [x] 更新 planner brief。
  验收：brief 可按 screen/window 查询 latest observation、current text/object、candidate targets、blocking uncertainty、recent actions、artifact evidence 和 completion gaps。

状态（2026-05-31，evidence: `E-CU-PY-CONTRACT`, `E-CU-ACCEPTANCE`）：Capture / Grounding / Evidence 本节已完成。observation/crop/grounding/evidence ledger/planner brief 均带 screen/window scope；validator 拒绝缺 provenance、裸全局坐标、stale evidence 与跨 bundle refs。

### Replay / GUI Presentation

- [x] 实现用户控制面 presentation contract。
  验收：GUI 能展示 session permission、app/window allowlist、risk preview、data visibility、stop/cancel 和 confirmation 状态；GUI 发出的只有 terminal-equivalent text 或 confirmation result，不包含 executor 参数或 provider route。
  状态（2026-05-31，evidence: `E-CU-GUI-MODULE`, `E-CU-PY-FULL-20260531`）：已完成。`computer-use-control-plane` presentation contract 显示 permission/allowlist/risk/data/stop/approval refs；GUI 只回传 confirmation/stop/cancel terminal-equivalent refs。

- [x] 定义 multi-screen replay manifest。
  验收：viewer frame 可声明 screen id、screenshot ref、cursor overlay refs、input events、timeline event 和 source evidence refs；placeholder frame 仍不能作为 completion evidence。

- [x] 实现多光标 overlay presentation contract。
  验收：GUI 可渲染不同颜色和 ID 的 actor cursor、轨迹、click pulse、proposal 状态和 lease owner；GUI 不执行 action，只发 terminal-equivalent text 或 confirmation result。

- [x] 更新 trace/result presentation。
  验收：result payload 暴露 `visibleScreenRefs`、`visibleCursorRefs`、`finalArtifactRef(s)`、`completionEvidenceRef` 和 replay refs；不把 raw screenshot/log payload 放入主结果或长期 trace。

状态（2026-05-31，evidence: `E-CU-PY-CONTRACT`, `E-CU-GUI-MODULE`, `E-CU-ACCEPTANCE`）：Replay / GUI Presentation 本节已完成。multi-screen replay manifest、cursor overlay refs、lease owner refs、visible screen/cursor refs、completion evidence refs 与 placeholder fail-closed validator 均已覆盖。

### Backend / Runtime

- [x] 明确 Codex app-server 生产路径。
  验收：Computer Use 能作为 Codex native plugin/tool/MCP 或 `module.invoke(actions, execute)` 被 Codex app-server 调用；`codex exec --json`、AgentServer 和 Workspace Gateway 入口标记为 legacy/test-only/diagnostic，不能成为新增功能依赖。
  状态（2026-05-31，evidence: `E-CU-CODEX-PRODUCT-20260531`, `E-CU-GUI-MODULE`）：已完成。Runtime Codex app-server/native-route 接入 package bridge；default `/computer-use` 与 `/computer-use approve` 均走 Codex Runtime terminal-equivalent path，legacy gateway 仅 diagnostic-only；confirmed approval retry product smoke 通过。

- [x] 建立 SciForge Computer Use local plugin / MCP packaging。
  验收：repo-local `sciforge.computer-use` 能被 Codex CLI/app-server 以 `plugin.json` + `.mcp.json` + skill 形态发现；tool surface 保持 `get_app_state` / `observe`、`click`、`type_text`、`scroll`、`press_key`、`propose_action`、`execute_scoped_action`、`get_replay_refs` 等窄入口；内部仍走 package host ports、scheduler、evidence ledger 和 validator。
  状态（2026-05-31，evidence: `E-CU-PY-FULL-20260531`）：已完成。repo-local manifest、MCP config、skill wrapper 和 plugin probe tests 覆盖 discoverability、窄工具面、host-port 转发与 no GUI direct action。

- [x] 建立 platform sidecar MVP。
  验收：至少一个平台 backend sidecar 能完成 capture/state/preflight/execute 的 typed host-port 或 MCP 调用，返回 refs-first snapshot、executor event、permission/preflight refs、isolation flags 和 blocked diagnostics；sidecar 不做 planning/completion，不 import GUI/runtime private implementation。
  状态（2026-05-31，evidence: `E-CU-PY-FULL-20260531`, `E-CU-BOUNDARY`）：已完成 package/platform diagnostic MVP。sidecar contract/preflight/state/input tests 返回 refs-first snapshot、executor event、permission/preflight refs、isolation flags 和 blocked diagnostics；后续真实推进转向 native 多屏/多 actor cursor backend，不再等待 noVNC。

- [x] 将 Docker/noVNC/container 从 active product roadmap 退役。
  验收：文档和任务板不再把 Docker/noVNC L1/L3 当作后续阻塞项；历史 Docker/container code 和 evidence 只能作为 legacy diagnostic / optional historical artifact，不进入当前产品完成定义。
  状态（2026-05-31，evidence: `E-CU-SCOPE-UPDATE-20260531`）：已完成路线调整。后续不再推进 `smoke:cu-isolated-l1:*` / `smoke:cu-isolated-l3:*`，也不再把 Docker daemon 状态当作 Computer Use roadmap 阻塞。

- [x] 扩展 simulated remote desktop provider。
  验收：provider 能报告 display group、screen、cursor、executor readiness 和 isolated input capability；未注册 provider 或 shared input provider 仍 fail closed。

- [x] 建立 native multi-screen / multi-actor cursor smoke。
  验收：不依赖 Docker/noVNC；同一 task space 至少创建两块 screen、三个 actor cursor，支持只读并行 cursor move/point/annotate、window-local proposal、screen-global queue、executor lease 串行化、before/after refs、replay cursor overlay 和 current-bundle evidence。
  状态（2026-05-31，evidence: `E-CU-M5-M7-NATIVE-DOM-20260531`）：已完成 package/native evidence harness 和 validator。`native_multi_screen_demo.py` 生成/校验 2 screens、3 actor cursors、read-only move/point/annotate、window-local proposal、screen-global queue、serial executor lease、before/after refs、replay overlay/current-bundle refs，并拒绝 Docker/noVNC、单屏/单 actor、缺 overlay 和 DOM/AX completion substitute；scheduler 默认 native same-screen window-local 串行，cross-screen 可并行。

- [x] 接入 BrowserRuntime DOM/AX observation refs。
  验收：学习并复用 Codex/Browser 类 DOM 读取方式，把 `BrowserRuntimePageQuery`、stable ref、`dom_cua.visible_dom`、accessibility snapshot 和 Playwright evaluate 产物转换为 refs-first observation/grounding hints；validator 必须证明这些 refs 只参与 observe-before-mutate，不可替代 executor lease、GUI action、artifact causality 或 completion evidence。
  状态（2026-05-31，evidence: `E-CU-M5-M7-NATIVE-DOM-20260531`, `E-CU-M6-TARGET-DOM-BINDING-20260531`, `E-CU-M7-REF-HYGIENE-PRODUCT-DEEP-20260531`）：已完成。runtime capture port materialize `browserRuntimeObservation` 为 BrowserRuntime PageQuery、stable refs、visible DOM、accessibility snapshot、Playwright evaluate 和 grounding hint refs；execute port 只把这些 refs 放入 `observeBeforeMutate` / `groundingRefs`，并显式标记不能替代 executor lease、GUI action、artifact causality 或 completion evidence。Python/TS validators 均覆盖 refs-first/hints-only fail-closed；live acceptance 还要求 DOM/AX claim refs 来自 structured BrowserRuntime observation refs，且 observation refs 必须绑定 observe-before-mutate/action。object-form stable refs 会 canonicalize，外部/路径型 PageQuery refs、inline/raw DOM/AX payload 和非 bundle-local refs 均 fail closed。

- [x] 更新 multi-app workflow 为 native multi-screen product gate。
  验收：source -> writer -> file-preview 在同一 virtual display group/session 内完成；每个 app transition、save、directory preview 和 artifact validation 都绑定 screen/window/action provenance；web/app 页面可附加 DOM/AX observation refs，但最终完成仍由 GUI action causality、artifact validator 和 replay/evidence bundle 判定。
  状态（2026-05-31，evidence: `E-CU-M5-M7-NATIVE-DOM-20260531`, `E-CU-M6-LIVE-RUNNER-20260531`, `E-CU-M6-SIDECAR-BINDING-20260531`, `E-CU-M6-DISCOVERY-CONTRACT-20260531`, `E-CU-M6-TARGET-DOM-BINDING-20260531`, `E-CU-M7-REF-HYGIENE-PRODUCT-DEEP-20260531`, `E-CU-M6-MACOS-VIRTUAL-LIVE-20260531`）：已完成 product gate/validator 迁移。product smoke / live acceptance matrix 已改为 native multi-screen + DOM-aware observation 方向，并要求 source/writer/preview 证据绑定 current bundle、GUI causality、artifact/verifier refs、read-only actor cursor events、非 placeholder per-screen replay frames、window-local/screen-global queue、strict BrowserRuntime hints-only flags、runner validation summary、加载 validationRef record、bundle-local product refs、discovery-backed allowedWindowRefs 和 targetRefs；validationRef record 还必须深证明确认 sidecar binding/capabilities/discovery、scheduler lease、replay、targetRefs 和 current-bundle membership。M6 真实 macOS native virtual-screen sidecar live run 已通过；旧 Docker/noVNC L3 gate 不再推进。

- [x] 研究真实 multi-pointer backend。
  验收：输出 design note，比较 XInput MPX、Wayland seats、RDP/remote protocols 和 app compatibility；结论必须保持 adapter 可选，不改变 actor cursor + scheduler 核心 contract。

状态（2026-05-31，evidence: `E-CU-DOCS`, `E-CU-RUNTIME`, `E-CU-CODEX-PRODUCT-20260531`, `E-CU-SCOPE-UPDATE-20260531`, `E-CU-M5-M7-NATIVE-DOM-20260531`, `E-CU-M6-LIVE-RUNNER-20260531`, `E-CU-M6-SIDECAR-BINDING-20260531`, `E-CU-M6-DISCOVERY-CONTRACT-20260531`, `E-CU-M6-TARGET-DOM-BINDING-20260531`, `E-CU-M7-REF-HYGIENE-PRODUCT-DEEP-20260531`, `E-CU-M6-MACOS-VIRTUAL-LIVE-20260531`）：Backend / Runtime 已完成 simulated provider、真实 multi-pointer design note、Codex app-server/native-route production smoke、plugin/MCP packaging、platform sidecar diagnostic MVP、native multi-screen package gate、BrowserRuntime DOM/AX observation refs、opt-in native live runner/validator、external native sidecar command binding、capabilities/discovery fail-closed gate、discovery-backed target/allowlist contract、DOM/AX observation action-binding validator、BrowserRuntime ref hygiene、product validationRef 深校验和 M6 macOS native virtual-screen sidecar live pass；Docker/noVNC live gates 已从 active roadmap 移除，且没有作为 M6 阻塞。

### Validation / Acceptance

- [x] 建立 user-control validator。
  验收：用户级 Computer Use evidence 缺 session permission、app/window allowlist、risk preview、data visibility、stop/cancel path、approval refs 或 platform-sidecar isolation report 时拒绝通过；第三方页面/文档里的指令不能替代用户确认。
  状态（2026-05-31，evidence: `E-CU-PY-FULL-20260531`, `E-CU-ACCEPTANCE`）：已完成。user-control validator 和 live acceptance validator 均 fail closed 缺 permission/allowlist/risk/data/stop/sidecar/approval refs，第三方内容不能替代用户确认。

- [x] 建立 observe-before-mutate validator。
  验收：validator 拒绝没有当前 app state/screenshot/accessibility snapshot/grounding/freshness refs 的 mutating action；拒绝用旧截图、历史 trace、action history 或 GUI private state 替代当前 observation。
  状态（2026-05-31，evidence: `E-CU-PY-FULL-20260531`, `E-CU-ACCEPTANCE`）：已完成。validator 拒绝缺当前 observation/grounding/freshness refs、旧截图、历史 trace、action history 和 GUI private state 替代。

- [x] 建立 platform sidecar boundary tests。
  验收：sidecar 只能暴露 capture/state/input/preflight L0 tools；测试禁止 sidecar import GUI、workspace write policy、planner、capability ranking 或 completion validator；sidecar 产生的 executor event 必须绑定 scheduler lease。
  状态（2026-05-31，evidence: `E-CU-PY-FULL-20260531`, `E-CU-BOUNDARY`）：已完成。platform sidecar tests 和 import boundary guard 覆盖 L0-only tools、禁止 GUI/runtime/workspace/planner/capability/completion imports，以及 executor event 绑定 scheduler lease。

- [x] 建立 L0/L1/L2 边界测试。
  验收：测试证明 L0 handler 不直接调用其它模块、不判断 completion；L1 adapter 不做跨模块 planning；L2 pipeline trace 记录 module 调用顺序；双 L2 或未声明 module intent fail closed。

- [x] 建立 package-local schema tests。
  验收：新增或更新 Python tests 覆盖 display group、screen、actor cursor、proposal、lease、executor event、replay manifest 和 no-secret validation。

- [x] 建立 focused runtime/bridge tests。
  验收：package bridge 能把 actor/cursor/screen/window provenance 投影到 trace、tool payload、gui.present sidecar 和 acceptance manifest。

- [x] 更新 acceptance validators。
  验收：L1/L2/L3 validator 拒绝缺 screen identity、缺 executor lease、裸全局坐标、shared system input、placeholder-only viewer、旧 evidence 或跨 bundle refs。

- [x] 建立 live acceptance matrix。
  验收：至少覆盖单屏单 actor、单屏多 actor、多屏单 actor、多屏多 actor、window-local queue、screen-global queue、高风险 confirmation、artifact save、directory preview 和 blocked recovery。
  状态（2026-05-31，evidence: `E-CU-M5-M7-NATIVE-DOM-20260531`, `E-CU-M6-LIVE-RUNNER-20260531`, `E-CU-M6-SIDECAR-BINDING-20260531`, `E-CU-M6-DISCOVERY-CONTRACT-20260531`, `E-CU-M6-TARGET-DOM-BINDING-20260531`, `E-CU-M7-REF-HYGIENE-PRODUCT-DEEP-20260531`）：已完成 validator/smoke matrix。`tests/smoke/cu-next-live-acceptance-matrix.test.ts` 和 product smoke matrix 覆盖 native multi-screen / multi-actor cursor、read-only cursor event log、非 placeholder per-screen replay、window-local queue、screen-global queue、BrowserRuntime DOM/AX hints-only observation、高风险 confirmation、artifact save、directory preview、blocked recovery、M6 runner validationRef record cross-check、validationRef 深证明、current-bundle product refs、unsafe product ref rejection、DOM/AX claim ref 必须来自 structured observation refs，以及 BrowserRuntime observation ref 必须绑定 observe-before-mutate/action；dry-run/product classification 默认 `opt-in-required`，不再把 Docker/noVNC/RDP 当 active gate。

- [x] 建立产品化 smoke matrix。
  验收：opt-in gate 覆盖 Codex app-server/native plugin 调 SciForge Computer Use、真实单 app 输入、真实 artifact 产物、高风险 confirmation stop、blocked recovery、viewer real frames、multi-app workflow 和 current-bundle evidence；package diagnostic 不得冒充 product smoke。
  状态（2026-05-31，evidence: `E-CU-CODEX-PRODUCT-20260531`, `E-CU-ACCEPTANCE`, `E-CU-SCOPE-UPDATE-20260531`, `E-CU-M6-LIVE-RUNNER-20260531`, `E-CU-M6-SIDECAR-BINDING-20260531`, `E-CU-M6-DISCOVERY-CONTRACT-20260531`, `E-CU-M6-TARGET-DOM-BINDING-20260531`, `E-CU-M7-REF-HYGIENE-PRODUCT-DEEP-20260531`）：已完成 matrix/validator 与 confirmed approval product smoke。product smoke matrix 明确区分 package diagnostic、platform smoke 和 product smoke；真实 confirmed approval retry gate 通过，并新增 `multi-screen-live-demo` case，要求 structured native multi-screen summary、加载 runner validationRef record、2+ screens、3+ actor cursors、move/point/annotate cursor events、window-local/screen-global queues、非 placeholder replay frames、current-bundle evidence、sidecar discovery/capability refs、discovery-backed target refs 和 validationRef 深证明。后续 product smoke pass 条件改为 native multi-screen / multi-actor cursor + platform sidecar evidence，不再要求 noVNC/RDP。

状态（2026-05-31，evidence: `E-CU-PY-FULL-20260531`, `E-CU-RUNTIME`, `E-CU-GUI-MODULE`, `E-CU-ACCEPTANCE`, `E-CU-BOUNDARY`, `E-CU-CODEX-PRODUCT-20260531`, `E-CU-SCOPE-UPDATE-20260531`, `E-CU-M5-M7-NATIVE-DOM-20260531`, `E-CU-M6-LIVE-RUNNER-20260531`, `E-CU-M6-SIDECAR-BINDING-20260531`, `E-CU-M6-DISCOVERY-CONTRACT-20260531`, `E-CU-M6-TARGET-DOM-BINDING-20260531`, `E-CU-M7-REF-HYGIENE-PRODUCT-DEEP-20260531`, `E-CU-M6-MACOS-VIRTUAL-LIVE-20260531`）：Validation / Acceptance 已完成边界、schema、runtime bridge、user-control/observe-before-mutate/platform-sidecar validators、product smoke matrix、native multi-screen / multi-actor acceptance matrix、DOM-aware observation validator、confirmed approval product smoke、M6 live runner blocked/complete validation contract、external sidecar command binding validation、capabilities/discovery fail-closed validation、discovery-backed target/allowlist validation、BrowserRuntime observation action-binding validation、BrowserRuntime ref hygiene、product validationRef 深证明和 M6 live evidence 验收；M6 已在真实 macOS sidecar + independent virtual-screen input adapter 下完成环境执行。

### Docs / Migration

- [x] 补齐或修复 `SemanticModuleEngineering.md` 引用。
  验收：`docs/Architecture.md` 引用的 `docs/SemanticModuleEngineering.md` 存在且能说明 resource graph / module engineering 与 Computer Use 的关系，或 Architecture 移除该死链；文档链接检查通过。

- [x] 更新 Computer Use 用户文档。
  验收：`docs/Architecture.md`、`docs/Usage.md` 和相关 README 不再使用旧“一线程一鼠标键盘”作为最终模型；所有新描述都区分 actor cursor 和 executor adapter。

- [x] 清理旧术语和旧假设。
  验收：`rg` 审计旧 `virtual mouse` / `virtual keyboard` / `one user-visible thread` / `one docker` 方向，保留历史 evidence 时必须标注 diagnostic/historical。

- [x] 制定迁移兼容策略。
  验收：旧 single-screen traces 可以被读取为 projection，但新 completed evidence 必须使用 multi-screen aware schema；不能让兼容层绕过新 validator。

状态（2026-05-31，evidence: `E-CU-DOCS`, `E-CU-BOUNDARY`）：Docs / Migration 本节已完成。`SemanticModuleEngineering.md` 已补齐；Architecture/Usage/README 区分 actor cursor 与 executor adapter；`rg` 旧词审计仅剩本协议中的历史目标/验收描述和 `vision_computer_use_agent_mvp.md` 的 explicit historical evidence note；兼容策略以 projection + validator fail-closed 约束。

## 近期 TODO

- [x] G0：完成当前实现偏差审计。
  范围：按 P0-CU-01 到 P0-CU-14 审计现有代码，给每项标注 `must-fix`、`legacy-shim`、`diagnostic-only` 或 `already-compliant`，并记录到本文件。

- [x] G1：建立 Codex CLI + Computer Use plugin 最小闭环。
  范围：先在 `packages/actions/computer-use` 内实现 Codex native tool/plugin 调试入口；CLI 可作为 debug/smoke，生产目标必须能迁移到 Codex app-server，不依赖 SciForge GUI special route 也能 observe -> propose -> execute scoped action -> write trace/replay refs。

- [x] G2：抽出 host adapter。
  范围：把 `src/runtime/computer-use/package-bridge-*` 中的 host-port contract、trace writing、event emission 整理为 package-owned 或 shared adapter；SciForge runtime 只提供 workspace/session/callback 注入。

- [x] G3：封存旧 `/computer-use` gateway 入口。
  范围：保留为 legacy diagnostic shim 或迁移桥；默认新路径走 Codex app-server/CLI native plugin，不让 GUI 直接拥有执行入口。

- [x] G4：补齐 provenance schema。
  范围：为 Python contracts、TS types、trace/result/replay payload 增加 `displayGroupId`、`screenId`、`windowId`、`actorId`、`cursorId`、`leaseScope`，旧字段只做兼容 projection。

- [x] G5：增加 GUI-TUI / `module.*` 合规测试。
  范围：测试 GUI 侧 Computer Use affordance 只生成 `/computer-use ...` 文本；runtime/module dispatcher 对未声明 Computer Use intent fail closed；Computer Use package host ports 不包含 `gui.present`、`gui.ask_user` 或直接 approval UI；正式执行路径有 Codex native plugin/tool 或 `module.invoke(actions, execute)` 覆盖。

- [x] G6：完成 L0/L1/L2 文件责任表。
  范围：列出 `packages/actions/computer-use`、`packages/observe/vision`、`src/runtime/computer-use`、`src/runtime/modules`、`src/ui`、future presentation package 中每个 Computer Use 相关文件的层级和允许 imports；发现混层先记录再迁移。

- [x] G7：增加 import boundary guard。
  范围：禁止 `src/ui/**` import Computer Use action provider、runtime bridge、observe provider implementation；GUI 只能 import shared contract 与 presentation package。禁止 L0 handler import GUI、renderer registry、Workbench 或 AnnotationSidebar。

- [x] G8：补齐 Architecture 新引用的文档依赖。
  范围：处理 `docs/SemanticModuleEngineering.md` 当前缺失问题，并把其中的 resource graph 规则映射到 Computer Use display group、screen、cursor、lease、evidence 和 replay refs。

- [x] G9：建立 no-internal-task-brain 测试。
  范围：focused tests 检查 Computer Use package result 只输出 evidence/blocked/approval/candidate refs；不输出跨模块 next-step 决策、不直接调用 GUI、不把 domain-local completion 当用户级 success。

- [x] G10：建立 L1 allowed/forbidden import 与行为矩阵。
  范围：列出 L1 可管理的 Computer Use resource lifecycle 和明确禁止项；用 lint/test 防止 L1 adapter import GUI renderer、workspace policy、capability ranking 或跨模块 planner。

- [x] M0：补齐 multi-screen contract 草案。
  范围：在 `packages/actions/computer-use` 中先落地 schema/validator 草案和 tests，不接真实 backend。

- [x] M1：扩展 session skeleton。
  范围：写出 display group、screen、actor cursor、scoped lease refs 和 blocked manifest；证明 no secrets / no inline payload。

- [x] M2：实现 scheduler 纯逻辑。
  范围：多 actor proposal 排队、screen/window lease、approval stop、action cancellation 和 stale evidence invalidation policy。

- [x] M3：更新 replay/viewer contract。
  范围：multi-screen frame + cursor overlay + timeline manifest；placeholder 仍 fail closed。

- [x] M4：打通 simulated remote desktop provider。
  范围：先用模拟 provider 证明 action adapter、cursor overlay、executor event、trace 和 evidence ledger 能闭环。

- [x] M5：实现 native multi-screen / multi-actor cursor product gate。
  范围：不依赖 Docker/noVNC；同一 task space 中管理多 screen、多 actor cursor、window-local proposal、screen-global lease、executor projection、before/after evidence、replay overlay 和 current-bundle refs。
  状态（2026-05-31，evidence: `E-CU-M5-M7-NATIVE-DOM-20260531`, `E-CU-M6-MACOS-VIRTUAL-LIVE-20260531`）：已完成 gate contract/harness 和 validators。Python native demo bundle、runtime scheduler same-screen serial policy、live/product smoke matrix 和 import boundary guard 均覆盖 2 screens / 3 actor cursors / scoped lease / replay current-bundle refs；M6 已用真实 macOS sidecar 产出 native capture/discovery 与 virtual-screen live evidence。

- [x] M6：做多屏多 actor live demo。
  范围：同一 task space 内至少两块 virtual screen、三个 actor cursor；两个 actor 同屏提出 proposal，scheduler 串行执行低风险 GUI action，并生成 replay/evidence bundle。
  状态（2026-05-31，evidence: `E-CU-M5-M7-NATIVE-DOM-20260531`, `E-CU-M6-LIVE-RUNNER-20260531`, `E-CU-M6-SIDECAR-BINDING-20260531`, `E-CU-M6-DISCOVERY-CONTRACT-20260531`, `E-CU-M6-TARGET-DOM-BINDING-20260531`, `E-CU-M7-REF-HYGIENE-PRODUCT-DEEP-20260531`, `E-CU-M6-MACOS-VIRTUAL-LIVE-20260531`）：已完成。`native_multi_screen_live_demo` 通过 `--sidecar-command "python3 -m sciforge_computer_use.macos_native_sidecar"` 绑定真实 macOS sidecar；sidecar 只做 L0 `capabilities` / `discover` / `preflight` / `capture` / `state` / `execute`，用 CoreGraphics/CGWindowList 做 discovery、`screencapture` 做 per-virtual-screen native capture，用 independent virtual-screen adapter 记录 input/executor event，不做 planning/completion，也不宣称系统指针移动或真实 GUI mutation。screen 是 task-space virtual screen；没有多块物理屏时会 split 一个 native capture backing 形成 2 个 virtual screens。真实 run 已产出 `status=completed`、`realNativeSidecarExecuted=true`、`completionEligible=true`、2+ virtual screens、3 actor cursors、discovered windows/windowRefs、per-screen `allowedWindowRefs`、targetRefs、scheduler lease refs、cursor event log、before/after capture/state refs、executor/input event refs、2 non-placeholder replay frames、`currentBundleRef` 和深校验 `validationRef`。未绑定真实 native sidecar 时仍按预期 blocked，completed sidecar calls 缺 discovery/capability/windowRef/targetRef 时仍 fail closed；fixture、diagnostic sidecar 和 Docker/noVNC 不能冒充 live pass。

- [x] M7：把 BrowserRuntime DOM/AX 读取并入 Computer Use observation。
  范围：复用 `@sciforge-ui/runtime-contract/browser-runtime` 的 PageQuery、stable ref、DOM CUA 和 Playwright evaluate 能力；把 DOM/AX 结果写成 screen/window-scoped observation refs、state snapshot refs 和 grounding hint refs。
  状态（2026-05-31，evidence: `E-CU-M5-M7-NATIVE-DOM-20260531`, `E-CU-M6-TARGET-DOM-BINDING-20260531`, `E-CU-M7-REF-HYGIENE-PRODUCT-DEEP-20260531`）：已完成。capture/execute host ports、Python package validator、CU-NEXT acceptance/product smoke 和 user acceptance guard 都已接受 BrowserRuntime DOM/AX/Playwright refs 作为 observe-before-mutate / grounding hints，并拒绝 completion/executor/GUI/artifact substitute；live acceptance 还会拒绝不在 structured BrowserRuntime observation 中的 DOM/AX claim ref，以及未绑定 observe-before-mutate/action 的 floating BrowserRuntime observation ref；object-form stableRefs、PageQuery refs、session/tab/snapshot refs 和 Python validation 均有 refs-first/current-bundle hygiene guard。

- [x] C0：补齐用户控制面 contract。
  范围：定义 session permission、app/window allowlist、risk preview、data visibility、stop/cancel lease refs、approval mode；GUI 只展示和回传确认，不能直接扩大权限或执行动作。
  状态（2026-05-31，evidence: `E-CU-PY-FULL-20260531`, `E-CU-GUI-MODULE`）：已完成。user-control contract、store、presentation refs 与 GUI terminal-equivalent confirmation/stop/cancel 边界均有 focused tests。

- [x] C1：实现 user-control validator。
  范围：用户级 evidence 缺 permission/allowlist/risk/data visibility/stop-cancel/platform isolation 任一关键 ref 时 fail closed；第三方内容不能作为用户授权。
  状态（2026-05-31，evidence: `E-CU-PY-FULL-20260531`, `E-CU-ACCEPTANCE`）：已完成。缺用户控制 refs、platform isolation 或 action-time approval refs 均 fail closed；第三方页面/文档指令不能替代用户确认。

- [x] C2：建立 SciForge Computer Use local plugin / MCP packaging。
  范围：把 `sciforge.computer-use` repo-local action provider 包装成 Codex CLI/app-server 可发现的 `plugin.json` + `.mcp.json` + skill plugin/MCP；内部继续走 package host ports 和 scheduler/evidence。
  状态（2026-05-31，evidence: `E-CU-PY-FULL-20260531`）：已完成。`plugin.json`、`.mcp.json`、MCP server、native tool 和 skill wrapper 已落地并通过 plugin probe/package tests。

- [x] C3：实现 platform sidecar MVP。
  范围：platform sidecar 提供 capture/state/preflight/execute typed calls、permission refs、executor events 和 isolation report；sidecar 不做 planning/completion。后续真实 backend 优先 macOS Accessibility / native sidecar / BrowserRuntime observation，不再推进 Linux noVNC/RDP。
  状态（2026-05-31，evidence: `E-CU-PY-FULL-20260531`, `E-CU-BOUNDARY`, `E-CU-SCOPE-UPDATE-20260531`）：已完成 platform diagnostic MVP。typed capture/state/preflight/input、permission refs、executor events、isolation report 和 no-planning/no-completion policy 已有 tests；真实 execution 转由 M5 native multi-screen / multi-actor cursor gate 承接。

- [x] C4：接入 stop/cancel lease path。
  范围：用户 stop 从 GUI/TUI 进入 scheduler，取消当前 lease 或阻止队列继续执行，并写 aborted/blocked manifest 与 replay refs。
  状态（2026-05-31，evidence: `E-CU-RUNTIME`, `E-CU-PY-FULL-20260531`）：已完成。stop/cancel 进入 scheduler/user-control contract，写 blocked/aborted refs，GUI 不直接杀 package state。

- [x] C5：建立产品化 smoke matrix。
  范围：Codex app-server/native plugin -> SciForge Computer Use -> platform sidecar 跑真实单 app 输入、真实 artifact、高风险 stop、blocked recovery、viewer real frames、多屏多 actor 和 multi-app workflow；package diagnostic 只作为前置，不算产品通过。
  状态（2026-05-31，evidence: `E-CU-CODEX-PRODUCT-20260531`, `E-CU-ACCEPTANCE`, `E-CU-SCOPE-UPDATE-20260531`, `E-CU-M6-LIVE-RUNNER-20260531`, `E-CU-M6-SIDECAR-BINDING-20260531`, `E-CU-M6-DISCOVERY-CONTRACT-20260531`, `E-CU-M6-TARGET-DOM-BINDING-20260531`, `E-CU-M7-REF-HYGIENE-PRODUCT-DEEP-20260531`）：已完成 matrix/validator 与真实 confirmed approval retry product smoke；matrix 区分 package diagnostic、platform smoke 和 product smoke，并新增 native `multi-screen-live-demo` case、runner validationRef record cross-check、current-bundle product ref guard、unsafe ref fail-closed、sidecar discovery/capability refs、discovery-backed target refs 和 validationRef 深证明。后续真实 coverage 转向 M5/M6/M7，不再追踪 noVNC/RDP。

- [x] C6：把 Codex confirmation taxonomy 映射到 SciForge policy。
  范围：按删除、上传、发送消息、登录、权限、支付、安装软件、敏感数据传输、系统设置等类别落到 `approvalRequest` / `needs-confirmation` / hand-off required，并保证确认发生在 action-time。
  状态（2026-05-31，evidence: `E-CU-PY-FULL-20260531`, `E-CU-CODEX-PRODUCT-20260531`）：已完成。confirmation taxonomy 映射到 action-time `needs-confirmation` / hand-off required；confirmed retry 绑定 approval sidecars 和 risk action hash；邮箱字段误判已用 focused test 修复。

- [x] C7：收敛 public tool surface。
  范围：对 Codex app-server/MCP 只暴露 `get_app_state` / `observe`、`click`、`type_text`、`scroll`、`press_key`、`propose_action`、`execute_scoped_action`、`get_replay_refs`；mutating facade 内部投影到 scheduler/lease/evidence，不暴露 provider route、裸坐标或 GUI state。
  状态（2026-05-31，evidence: `E-CU-PY-FULL-20260531`, `E-CU-CODEX-PRODUCT-20260531`）：已完成。public tool surface 仅保留窄入口；Runtime Codex request boundary 拒绝 provider route、legacy GUI handoff、裸 executor params 和 GUI private state。

- [x] C8：强制先观察再动作。
  范围：scheduler/validator 要求 mutating action 前存在当前 app state、screenshot/accessibility snapshot、grounding 和 freshness refs；缺失时返回 `needs-observation` / `blocked`。
  状态（2026-05-31，evidence: `E-CU-PY-FULL-20260531`, `E-CU-RUNTIME`, `E-CU-ACCEPTANCE`）：已完成。observe-before-mutate contract 在 scheduler、native tool、evidence ledger 和 acceptance validator 中 fail closed。

状态（2026-05-31，evidence: `E-CU-PY-FULL-20260531`, `E-CU-RUNTIME`, `E-CU-GUI-MODULE`, `E-CU-ACCEPTANCE`, `E-CU-BOUNDARY`, `E-CU-DOCS`, `E-CU-CODEX-PRODUCT-20260531`, `E-CU-SCOPE-UPDATE-20260531`, `E-CU-M5-M7-NATIVE-DOM-20260531`, `E-CU-M6-LIVE-RUNNER-20260531`, `E-CU-M6-SIDECAR-BINDING-20260531`, `E-CU-M6-DISCOVERY-CONTRACT-20260531`, `E-CU-M6-TARGET-DOM-BINDING-20260531`, `E-CU-M7-REF-HYGIENE-PRODUCT-DEEP-20260531`, `E-CU-M6-MACOS-VIRTUAL-LIVE-20260531`）：近期 TODO 中 G0-G10、M0-M7、C0-C8 已完成；M6 已通过真实 macOS native virtual-screen sidecar live demo，包含 external sidecar command binding、capabilities/discovery gate、discovery-backed allowedWindowRefs/targetRefs、refs-first replay/cursor/lease evidence、independent virtual-screen input event log、BrowserRuntime ref hygiene 和 product validationRef/current-bundle 深证明；fixture、diagnostic sidecar 和 Docker/noVNC evidence 仍不能替代 live pass。

## 验证规则

- 纯文档改动：运行 `git diff --check`。
- Computer Use package contract/schema 改动：运行 package-local Python tests，并补 focused schema/validator tests。
- Runtime bridge 改动：运行 package bridge focused tests、runtime event tests 和 `git diff --check`。
- GUI presentation 改动：运行 viewer/presentation focused tests、Browser visual check，并确认 GUI 没有执行 Computer Use action。
- Backend/live 改动：先跑 fixture/focused tests，再跑 opt-in L1/L3 live gates；live evidence 必须 refs-first、脱敏、bundle-local。
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
