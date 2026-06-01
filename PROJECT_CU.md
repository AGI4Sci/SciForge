# SciForge Computer Use 项目协议

最后更新：2026-06-01

当前目标：把 Computer Use 从“完整虚拟桌面 / 多物理屏模拟”收敛为 **VirtualAppScreen：科研应用级后台控制会话**。每个虚拟屏幕绑定一个 app/session/window，右侧 `Screen` 结果栏像远程桌面一样展示、注释和接管它；底层执行优先走 app-scoped / window-scoped adapter，做到视觉上等效鼠标键盘，但不移动用户真实鼠标、不抢用户当前焦点、不把应用窗口弹到物理屏幕。

本文件只记录 Computer Use 的当前原则、任务板、TODO 和验收规则。总项目原则以 [`PROJECT.md`](PROJECT.md) 为准；详细设计参考 [`packages/actions/computer-use/vision_computer_use_agent_mvp.md`](packages/actions/computer-use/vision_computer_use_agent_mvp.md) 和 [`docs/NativeExtensionOwnershipMap.md`](docs/NativeExtensionOwnershipMap.md)。

## 当前范围

- `packages/actions/computer-use` 拥有 request/result schema、VirtualAppScreen/session contract、actor cursor contract、domain-local action loop、scheduler/executor adapter contract、safety/approval、trace contract 和 compact handoff；它不是第二个 Root Agent Host。
- `packages/observe/vision` 提供 observation、focus region、OCR/VLM/KV-Ground grounding helper、verifier feedback 和 file-ref-only visual memory；不直接执行真实桌面动作。
- GUI 只负责 VirtualAppScreen presentation、annotation overlay、trace/replay 展示、focus、confirmation 和 terminal-equivalent text；不直接执行 Computer Use。
- BrowserRuntime / DOM / accessibility / Playwright 可以作为 observation、target hint 或 adapter source，但不能绕过 Computer Use 的 executor lease、action causality、before/after evidence、artifact validation 或用户级 completion。
- Platform sidecar / MCP / backend adapter 只做 app/window capture、state、input/preflight 和 adapter readiness；不做 planning、completion、GUI presentation 或 workspace policy。
- VM / microVM / 完整 remote desktop 只作为未来强隔离或不可信任务 backend，不作为当前科研自动化主路线。

## 不可变规则

- 所有修改必须通用，不能为当前页面、截图、URL、文件名或历史 run 写硬编码补丁。
- 代码路径保持唯一真相源；旧逻辑和最终方案冲突时删除或迁移旧逻辑，不做长期并行实现。
- GUI -> TUI 只发送终端等价文本、focus/confirmation 结果或只读 projection；TUI -> GUI 只通过 declared GUI intents。
- 右侧结果栏不是日志 dump。它必须按对象类型展示 Browser、Screen、Terminal、Files、References 等 Cursor-like panes，并以可点击 refs 驱动。
- 大 payload、截图、录屏、terminal transcript、DOM snapshot、artifact、audit 和 replay 必须 refs-first；不得内联 raw screenshot/base64/provider payload/secret。
- 涉及 provider URL、API key、model name、Authorization、token、secret、password、credential 的日志和 evidence 必须脱敏；ignored local config 不得提交。
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
  -> VirtualAppScreen session/app/window/frame/input/replay/evidence refs
  -> session permission/allowlist/risk/adapter readiness refs
  -> adapts backend/provider/version/resource lifecycle
  -> exposes only Codex native tool/plugin/MCP or module.* surface

L0 Computer Use Handlers
  -> capture | crop | ground | propose scoped action | execute | verify | writeTrace | emitEvent | adapter preflight

GUI Module
  -> present frame/replay/overlay/permission/risk/stop controls, ask_user, notify, set_status, focus
```

## 当前任务板：VirtualAppScreen User-Level Acceptance

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
  验收：需要 focus steal、物理屏弹窗、全局鼠标键盘、shared system input 的 adapter 不能作为后台隔离完成证据；可以作为 explicit fallback，但 user-level manifest 必须标记 `requires-handoff` 或 `diagnosticOnly=true`。
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

这些基线是新路线的安全底座；旧的完整虚拟桌面任务板不再作为 active backlog。

## 验证规则

- 纯文档改动：运行 `git diff --check`。
- Computer Use package contract/schema 改动：运行 package-local Python tests，并补 focused schema/validator tests。
- Runtime bridge 改动：运行 package bridge focused tests、runtime event tests 和 `git diff --check`。
- GUI presentation 改动：运行 viewer/presentation focused tests、Browser visual check，并确认 GUI 没有执行 Computer Use action。
- VirtualAppScreen 改动：覆盖 attach/no-session/observe-only/blocked/error、frame refs、annotation overlay、actor cursor、input intent、lease owner、replay timeline、Stop terminal-equivalent text 和 raw payload rejection。
- Adapter 改动：覆盖 readiness record、capability flags、before/after evidence、shared-system-input rejection、focus-steal/physical-display-popup rejection 和 blocked reason。
- Backend/live 改动：先跑 fixture/focused tests，再跑 opt-in native/app-screen gates；live evidence 必须 refs-first、脱敏、bundle-local。
- 每轮完成后更新本文件对应 TODO，补 evidence refs、日期、验证命令和状态。

## 暂缓集成

- 默认依赖真实 OS multi-pointer / multi-seat。
- 将完整 Docker/container/noVNC/RDP desktop 作为产品层并发隔离抽象。
- 默认使用 VM / microVM / full remote desktop 作为科研自动化主路径。
- 让 GUI 直接调用 Computer Use executor。
- 用 DOM、Playwright、accessibility tree、shell 直写 artifact、旧 trace 或 app private shortcut 替代 Computer Use 完成证据。
- 在默认 release gate 中运行长耗时 live Computer Use gates；native/app-screen gates 仍作为 opt-in release evidence。

## 必读文档

- [`PROJECT.md`](PROJECT.md)：总项目协议、模块化原则和验证规则。
- [`docs/Architecture.md`](docs/Architecture.md)：GUI-TUI、L0/L1/L2、Agent Host Semantic Pipeline 和 native extension 边界。
- [`docs/TuiGuiProtocol.md`](docs/TuiGuiProtocol.md)：GUI -> TUI 文本、TUI -> GUI intent tools 和只读 GUI resource tree。
- [`packages/actions/computer-use/vision_computer_use_agent_mvp.md`](packages/actions/computer-use/vision_computer_use_agent_mvp.md)：VirtualAppScreen、后台应用控制会话和 adapter-first 设计。
- [`docs/NativeExtensionOwnershipMap.md`](docs/NativeExtensionOwnershipMap.md)：Computer Use ownership 与 GUI/runtime 边界。
- [`docs/native-extension-ownership-map.json`](docs/native-extension-ownership-map.json)：可验证 ownership manifest。
