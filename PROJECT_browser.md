# SciForge Browser Task Board

最后更新：2026-06-02

本文档只保留 SciForge 右侧 Browser pane 的当前任务。旧任务和已完成任务不在这里重复归档；需要追溯时看 Git 历史、对应 smoke manifest 或 `docs/test-artifacts/**`。任务使用 `- [ ]`，完成后改为 `- [x]`，并按 [`PROJECT.md`](PROJECT.md) 风格补充：`完成：日期；evidence：...；验证：...；状态：...`。

## 目标

- 右侧 Browser 必须像正常浏览器一样可连续冲浪：打开网页、搜索、点击、拖拽、滚动、输入、返回、前进、刷新和停止都应低延迟、可见、可预测。
- `BrowserHostSession` 是唯一 owner：导航、输入、state、refs、screenshot、DOM、AX、console、network、search refs 都归它。
- 产品 Browser pane 的唯一 live path 是同一个 `BrowserHostSession` owned `native-embedded` surface；Electron `WebContentsView` / WebView2 / WKWebView / 独立 Chromium surface 只是 display/input adapter。
- 不保留产品级 fallback：缺 native attach 时显示 blocked / needs-human / handoff / retry，不切到 host-stream、canvas、WebRTC、HTTP `/frame`、snapshot、iframe、proxy、`<webview>` 或系统 popup。

## 不可变规则
- 所有修改必须通用，不能为当前页面、截图、URL、文件名、localhost、某个站点或历史 run 写硬编码补丁。
- 代码路径保持唯一真相源；旧逻辑和最终方案冲突时删除或迁移旧逻辑，不做长期并行实现。
- 只能有一个 live truth source：`BrowserHostSession` owner + `native-embedded` display/input adapter。
- 旧 streaming transport 只能作为 evidence / diagnostic / migration audit，不能参与交互热路径。
- 输入热路径优先级最高：click/type/drag/scroll/cursor 不能被 screenshot、DOM、AX、console/network、search summary 或 state polling 阻塞。
- 大 payload、截图、DOM/AX、console/network logs 和 evidence 必须 refs-first；不得把 base64/raw DOM/raw logs 写入 GUI state 或任务文档。
- 已完成 TODO 必须打勾，并补充日期、evidence refs、验证命令和最终状态。

## 基准指标

- Open 到首个可交互画面：普通外部站点目标 < 2s；慢站点要显示 loading/progress/diagnostic。
- 输入到页面可见：普通文本输入目标 < 50ms p95；长输入不丢字、不乱序。
- 滚轮/拖拽跟手：连续事件目标 60fps 体感，至少不出现明显队列堆积和秒级延迟。
- Cursor / caret：输入框内可见 caret；按钮/链接显示 pointer；普通区域 default；文本区域 text。
- Evidence 不抢热路径：snapshot/state/DOM/AX/log/search refs 可以滞后生成，但不能阻塞冲浪。

## 当前任务板

### P0：Native-Only Live Browser 收口

- [x] 收口 `native-embedded` single truth。完成：2026-06-02；evidence：`src/ui/src/app/results/browserPaneHostAdapter.test.ts` source guard、`packages/presentation/components/browser-workbench/render.test.tsx` no-product-fallback assertions、`src/runtime/browser-host-session.test.ts` missing-native fail-closed test、`docs/test-artifacts/desktop-browser-native-live-acceptance/manifest.json` status=`passed` / `liveSurfaceTransport=native-embedded`、`docs/test-artifacts/browser-pane-dogfood/manifest.json`、`docs/test-artifacts/browser-search-input-dogfood/manifest.json`、`docs/test-artifacts/browser-search-visible-session-dogfood/manifest.json` 与 `docs/test-artifacts/browser-pane-product-long-session/manifest.json` liveAcceptance=`blocked` when native attach is missing；验证：`npm run smoke:desktop-browser-native-live-acceptance --silent`、`npm run smoke:desktop-browser-native-live-acceptance:strict --silent`、`npm run smoke:browser-bounded-evidence-crosscheck --silent`、`node --import tsx --test packages/presentation/components/browser-workbench/render.test.tsx src/ui/src/app/results/browserPaneHostAdapter.test.ts src/ui/src/app/results/browserPaneModel.test.ts`；状态：产品 live path 已 fail-closed 到 native-only，旧 transports 只能 diagnostic/evidence。
  验收：Browser pane 的产品 live surface 只剩 `native-embedded`；外部 HTTP/HTTPS 页面无法 attach native surface 时显示 typed blocked/handoff/retry，不出现 host-stream/canvas/WebRTC/HTTP `/frame`/snapshot/iframe/proxy/`<webview>`/system popup 交互兜底。
  当前状态：`BrowserHostSession` owner + native display/input adapter 已成为产品 live truth；desktop native acceptance passed。历史 host-stream baseline 不可用于 pass；当前 Web 右栏 dogfood / 5 分钟 manifests 为 missing-native-attach bounded blocked，已显式拒绝 live pass claim。
  子任务：
  - [x] Browser Workbench 只渲染 `native-embedded` live surface；host-stream/canvas/WebRTC/HTTP `/frame` 只能显示 evidence/diagnostic refs 或 typed blocked state。完成：2026-06-02；evidence：`render.test.tsx` `assertNoProductFallbackSurface`、legacy host-stream refs-as-state、native mount-only tests；验证：`node --import tsx --test packages/presentation/components/browser-workbench/render.test.tsx`；状态：完成。
  - [x] Workspace Writer preflight ready 条件增加 native surface attach/health 能力；仅有 `frame` / `frame-stream` 的 writer 判为 stale/blocked。完成：2026-06-02；evidence：`src/ui/src/api/workspaceClient.browser-host-preflight.test.ts` stale frame transports blocked / native readiness accepted、`src/runtime/workspace-server-health.test.ts` no native readiness without loopback adapter；验证：`node --import tsx --test src/ui/src/api/workspaceClient.browser-host-preflight.test.ts src/runtime/workspace-server-health.test.ts`；状态：完成。
  - [x] 右侧 Browser pane native attach 失败时统一显示 blocked/handoff/retry，不自动打开 snapshot、旧 frame、system popup 或 Web shell stream。完成：2026-06-02；evidence：`browserPaneHostAdapter.test.ts` attach bridge unavailable / failed attach detaches and sets host error、`browser-host-session.test.ts` default missing native adapter -> `handoff` and legacy fallback disabled；验证：`node --import tsx --test src/ui/src/app/results/browserPaneHostAdapter.test.ts src/runtime/browser-host-session.test.ts`；状态：完成。
  - [x] 删除或迁移 `frameRenderer=canvas-binary`、WebRTC candidate live rendering、host-stream input path 等产品交互分支。完成：2026-06-02；evidence：`browserPaneHostAdapter.test.ts` source rejects `canvas-binary` / `webrtc-data-channel` / `websocket-binary` / `host-stream` in adapter, `render.test.tsx` rejects websocket/canvas/WebRTC fallback claims；验证：`node --import tsx --test packages/presentation/components/browser-workbench/render.test.tsx src/ui/src/app/results/browserPaneHostAdapter.test.ts`；状态：完成。
  - [x] 更新 dogfood / acceptance / crosscheck manifests：pass 只能来自 `liveSurfaceTransport=native-embedded`、`singleInteractiveTruth=true`、`secondTruthSource=false`，Web shell 缺 native attach 只能 claim blocked。完成：2026-06-02；evidence：`tests/smoke/smoke-browser-bounded-evidence-crosscheck.test.ts` live-pass-requires-native-embedded blockers、`docs/test-artifacts/browser-pane-dogfood/manifest.json`、`docs/test-artifacts/browser-search-input-dogfood/manifest.json`、`docs/test-artifacts/browser-search-visible-session-dogfood/manifest.json`、`docs/test-artifacts/browser-pane-bottleneck-audit/manifest.json`、`docs/test-artifacts/browser-pane-product-long-session/manifest.json` all blocked/diagnostic when native attach is missing；验证：`npm run smoke:browser-bounded-evidence-crosscheck --silent`、`npm run smoke:browser-pane-dogfood --silent`、`npm run smoke:browser-search-input-dogfood --silent`、`npm run smoke:browser-search-visible-session-dogfood --silent`、`npm run smoke:browser-pane-product-long-session --silent`；状态：完成。
  验证：`npm run smoke:desktop-browser-native-live-acceptance --silent`；`npm run smoke:desktop-browser-native-live-acceptance:strict --silent`；`npm run smoke:browser-bounded-evidence-crosscheck --silent`；`node --import tsx --test packages/presentation/components/browser-workbench/render.test.tsx src/ui/src/app/results/browserPaneHostAdapter.test.ts src/ui/src/app/results/browserPaneModel.test.ts`。

- [ ] 复测 native-only 真实卡点并重新排序。
  验收：给出当前最大瓶颈排序，并用真实 SciForge Browser pane 操作证据支撑；不能只给架构猜测，也不能使用旧 host-stream/canvas baseline 冒充 native-only pass。
  当前状态：未完成。`docs/test-artifacts/browser-pane-bottleneck-audit/manifest.json` 当前 status=`blocked`、`liveAcceptance.observed.liveSurfaceTransport=missing-native-attach`、`handoff.state=needs-native-attach`；manifest 已要求 native-embedded/frame native-embedded/single truth/same liveSurfaceRef/right-pane native evidence/no legacy fallback，并输出 `coverageGaps` native evidence 与 bounded ranking/categories，但 Web 右栏缺 native attach 时不 claim pass。`docs/test-artifacts/browser-pane-real-external-dogfood/manifest.json` status=`blocked`，targetEvidence mode=`blocked-real-external-url-config`，真实公开 URL 仅记录 length/hash，当前 blocker 是 Web 右栏未暴露 native-embedded BrowserHostSession evidence。旧排序 `surface-attach > navigation > input-routing > react-rerender > state-polling > frame-capture` 只作为迁移前 baseline，不能 claim native-only pass。
  子任务：
  - [ ] 用真实公开 URL 重跑 open、click、type、scroll、reload、back/forward。当前状态：未完成；2026-06-02 已用真实公开 URL 配置重跑，artifact 为 `blocked-real-external-url-config` / `missing-native-attach`，尚未执行真实 native open/click/type/scroll/reload/back/forward。
  - [ ] 复测 tab 切换、native surface detach/minimize/restore 后是否仍 attach 正确。当前状态：未完成；`docs/test-artifacts/browser-pane-tab-focus-retention/manifest.json` 当前为 missing-native-attach blocked diagnostic，不能覆盖真实 native detach/minimize/restore。
  - [ ] 输出新的 bounded bottleneck manifest，只记录 latency、count、hash、refs、transport、surface type、writer/native adapter health。当前状态：manifest schema 已收口为 refs-first blocked diagnostic，包含 required native evidence/coverage gaps/ranking；仍缺真实 native attach 后的 pass-grade latency 排序。
  验证：`npm run smoke:browser-pane-bottleneck-audit --silent`；`npm run smoke:browser-pane-real-external-dogfood --silent`；`npm run smoke:browser-bounded-evidence-crosscheck --silent`。

- [ ] Native Surface Paint / ACK 机制收口。
  验收：用户动作后 live surface 更新不依赖 PNG screenshot；state/refs 可以异步追上；失败显示 blocked/retry，不切到 snapshot 第二画面。
  当前状态：paint ACK / heartbeat / failure retry 机制已由 smoke 证明；但 native-only 长会话 / 5 分钟 dogfood 尚未真实运行，因此总项保持未完成。
  子任务：
  - [x] 为 Electron `WebContentsView` 路径记录 action 后是否需要显式 paint ack。完成：2026-06-02；evidence：`tests/smoke/smoke-desktop-browser-native-paint-ack-heartbeat.test.ts` asserts `paintAckSource=native-adapter-action-state`、`docs/test-artifacts/desktop-browser-native-live-acceptance/manifest.json` passed；验证：`npm run smoke:desktop-browser-native-paint-ack-heartbeat --silent`、`npm run smoke:desktop-browser-native-live-acceptance --silent`；状态：完成。
  - [x] 若 shell 无 paint ack API，强化 lightweight heartbeat：URL/title/loading/canGoBack/canGoForward 与 action completion 分离。完成：2026-06-02；evidence：`smoke-desktop-browser-native-paint-ack-heartbeat.test.ts` native `/state` heartbeat evidence；验证：`npm run smoke:desktop-browser-native-paint-ack-heartbeat --silent`；状态：完成。
  - [x] 失败态统一使用 bounded blocked/retry，不切到 snapshot 第二画面。完成：2026-06-02；evidence：`smoke-desktop-browser-native-paint-ack-heartbeat.test.ts` failed action -> `loadingProgress.state=blocked` / `canRetry=true` / no frameStream refs；验证：`npm run smoke:desktop-browser-native-paint-ack-heartbeat --silent`；状态：完成。
  - [ ] 接入 native-only 长会话 / 5 分钟 dogfood evidence。当前状态：未完成；不能用 host-stream 5 分钟 artifact 替代。
  验证：`npm run smoke:desktop-browser-native-paint-ack-heartbeat --silent`；`npm run smoke:desktop-browser-native-live-acceptance --silent`；`npm run smoke:desktop-browser-native-live-acceptance:strict --silent`。

- [ ] React Rerender / Surface Stability 收口。
  验收：地址栏输入、tab 状态、refs 更新、diagnostic 展开不会导致 native surface detach/remount 或焦点丢失。
  当前状态：native surface stability key、diagnostic/refs/loading 更新不 remount 的 render contract 已完成；`docs/test-artifacts/browser-pane-surface-rerender-stability/manifest.json` 当前 `status=blocked`、`claimScope=contract-diagnostic-only`，已记录 initial/topbar address draft/tab state/refs update/diagnostic expansion/loading state 6 phases 中同一 `BrowserHostSession` id、同一 `liveSurfaceRef`、同一 native surface stability key、identity changes=0、inferred remounts=0、repeated focus requests=0；真实 native attach/remount/focus dogfood proof 仍未覆盖。
  子任务：
  - [x] 对 Browser pane topbar 状态更新做局部化，避免整个 right pane 频繁重渲染。完成：2026-06-02；evidence：`docs/test-artifacts/browser-pane-surface-rerender-stability/manifest.json` topbar/tab/refs/diagnostic/loading phase counts with stable native surface key and zero inferred remounts；验证：`npm run smoke:browser-pane-surface-rerender-stability --silent`、`npm run smoke:browser-bounded-evidence-crosscheck --silent`；状态：完成为 render contract，真实 native attach/remount/focus dogfood 仍未完成。
  - [ ] 真实多 tab / native detach / resize / minimize / restore 场景下复测同一 `liveSurfaceRef` 与 keyboard focus。当前状态：未完成；`docs/test-artifacts/browser-pane-tab-focus-retention/manifest.json` 当前 status=`blocked`、`claimScope=diagnostic-only`、`nativeAttach.observed=missing-native-attach`，已要求 real native attach proof、focus/keyboard owner proof refs、tab return/native detach/reattach/resize/minimize/restore lifecycle proof refs，缺 proof 时不 claim pass。
  - [x] diagnostic 展开、refs 更新、loading 状态变化不得导致 surface remount。完成：2026-06-02；evidence：`render.test.tsx` `browser-workbench keeps native surface stable across loading refs diagnostics and topbar state changes`；验证：`node --import tsx --test packages/presentation/components/browser-workbench/render.test.tsx`；状态：完成。
  验证：`npm run smoke:browser-pane-surface-rerender-stability --silent`；`npm run smoke:browser-pane-tab-focus-retention --silent`；`node --import tsx --test packages/presentation/components/browser-workbench/render.test.tsx src/ui/src/app/results/browserPaneHostAdapter.test.ts`。

- [ ] Loading / Progress 真实状态机收口。
  验收：慢网页不是“静止旧画面”或“假 ready”；用户能看到 loading、stalled、blocked、retry、handoff；重定向后地址栏/current/final URL 不滞后。
  当前状态：BrowserHostSession 与右栏 projection 的 bounded lifecycle / URL digest / navigation control contract 已完成；真实外部慢网页和真实 native 产品事件覆盖仍需继续 dogfood。
  子任务：
  - [x] 接入可验证的 `navigation-committed`、DOMContentLoaded/interactive、load、network quiet 事件；没有真实信号时只能写 typed blocked/handoff，不伪造。完成：2026-06-02；evidence：`src/runtime/browser-host-session.test.ts` host lifecycle/native loading signal tests、`tests/smoke/smoke-browser-loading-progress-lifecycle.test.ts` state/reason projection contract；验证：`node --import tsx --test src/runtime/browser-host-session.test.ts tests/smoke/smoke-browser-loading-progress-lifecycle.test.ts`；状态：完成。
  - [x] stop/reload/back/forward 操作必须立即反映在地址栏和 loading 控件。完成：2026-06-02；evidence：`src/runtime/browser-host-session.test.ts` immediate stop/control progress tests；验证：`node --import tsx --test src/runtime/browser-host-session.test.ts`；状态：完成。
  - [x] 记录 requested/current/final URL 的 bounded hash/length，避免重定向导致地址栏滞后。完成：2026-06-02；evidence：`browser-host-session.test.ts` loadingProgress URL hints and sha1, `browserPaneModel.test.ts` requested/current/final `urlDigests`；验证：`node --import tsx --test src/runtime/browser-host-session.test.ts src/ui/src/app/results/browserPaneModel.test.ts`；状态：完成。
  - [ ] 真实外部/原生慢网页和失败网页 dogfood，确认 loading/stalled/blocked/retry/handoff 与最终 URL 不滞后。当前状态：未完成；不能用 model/driver contract 冒充真实产品体验。
  验证：`npm run smoke:browser-loading-progress-lifecycle --silent`；`npm run smoke:browser-pane-product-long-session --silent`；`node --import tsx --test src/runtime/browser-host-session.test.ts src/ui/src/app/results/browserPaneModel.test.ts src/ui/src/app/results/browserPaneHostAdapter.test.ts`。

### P1：输入 Fidelity 和旧 Transport 删除

- [ ] Cursor / Pointer / Caret 真实产品 parity。
  验收：输入框 text cursor/caret 可见；按钮链接 pointer；可拖动元素、文本选择、普通区域符合浏览器行为。
  当前状态：`tests/smoke/smoke-browser-cursor-caret-parity.test.ts` 与 `docs/test-artifacts/browser-cursor-caret-parity/manifest.json` 已改成 native-host-owned deterministic contract，包含 `realOsUiRunHandoff`、required proof refs、`liveSurfaceTransport=native-embedded`、`secondTruthSource=false`；真实 OS window-manager focus、真实页面 caret 和 IME/clipboard/selection 联合证据仍未完成，manifest 保持 `status=blocked`。
  子任务：
  - [ ] 用产品 UI 或 native shell evidence 验证真实 OS 窗口失焦/恢复后的 cursor/caret/focus。
  - [ ] 验证真实页面文本选择 caret、input caret、contenteditable caret 的可见性。
  - [ ] 与 IME/clipboard/selection range 的真实证据一起收口。
  验证：`npm run smoke:browser-cursor-caret-parity --silent`。

- [ ] 鼠标操作真实 fidelity。
  验收：left/right/middle click、double click、context menu、mouse down/up、continuous move、drag/drop、文本选择、滚轮/横向滚轮、滚动条拖动都走 BrowserHostSession 且可预测。
  当前状态：`tests/smoke/smoke-browser-mouse-gesture-completeness.test.ts` 与 `docs/test-artifacts/browser-mouse-gesture-completeness/manifest.json` 覆盖 deterministic native-embedded BrowserHostSession route、middle/modifier click owner/handoff required proofs、context menu policy 和 no second truth；real product OS UI run 仍未完成，manifest 保持 `status=blocked`。
  子任务：
  - [ ] 为真实产品滑块拖动和复杂页面 drag/drop 建立 product acceptance fixture。当前状态：deterministic fixture/contract 已有，真实产品 fixture 未完成。
  - [x] right click 应生成浏览器上下文行为或 typed blocked policy，不能被页面外层吞掉。完成：2026-06-02；evidence：`tests/smoke/smoke-browser-mouse-gesture-completeness.test.ts` browser-owned context menu policy and system-input/second-truth refusal；验证：`npm run smoke:browser-mouse-gesture-completeness --silent`；状态：完成为 contract/policy，真实 OS menu 仍归产品 dogfood。
  - [x] middle click / modifier click 的新 tab 行为需要明确：BrowserHostSession tab owner 还是 handoff。完成：2026-06-02；evidence：`docs/test-artifacts/browser-mouse-gesture-completeness/manifest.json` `newTabSemantics.ownerContract` includes middle/modifier click required proof refs and typed handoff policy；验证：`npm run smoke:browser-mouse-gesture-completeness --silent`、`npm run smoke:browser-bounded-evidence-crosscheck --silent`；状态：完成为 owner/handoff contract，真实 OS tab behavior 仍归 product dogfood。
  - [ ] 真实文本选择和页面滚动条拖动需要 product dogfood evidence。
  验证：`npm run smoke:browser-mouse-gesture-completeness --silent`；`node --import tsx --test src/runtime/browser-host-session.test.ts`。

- [ ] 键盘 / IME / Clipboard / Selection 真实行为。
  验收：连续输入、Backspace/Delete、Enter、Tab、方向键、Home/End、PageUp/PageDown、Ctrl/Cmd+A/C/V/X、Escape 可用，且不进入聊天输入框；IME、clipboard、selection range 有明确 owner 与审计。
  当前状态：`tests/smoke/smoke-browser-keyboard-editing-behavior.test.ts` 与 `docs/test-artifacts/browser-keyboard-editing-behavior/manifest.json` 已证明 deterministic native-embedded keyboard/edit-key routing、composer isolation、clipboard confirmation audit refs 和 selection length/hash proof schema；`docs/test-artifacts/browser-input-fidelity-product-acceptance/manifest.json` 仍为 `blocked`，真实 IME/clipboard/selection OS UI 证据未完成。
  子任务：
  - [ ] 验证真实 IME candidate window / compositionupdate / compositionend 行为。
  - [x] 高风险 clipboard 写入走 confirmation；普通页面内粘贴/复制需要明确 owner 和审计。完成：2026-06-02；evidence：`docs/test-artifacts/browser-input-fidelity-product-acceptance/manifest.json` `clipboard-confirmation-audit` required proof, `docs/test-artifacts/browser-keyboard-editing-behavior/manifest.json` clipboard confirmation/round-trip audit refs；验证：`npm run smoke:browser-input-fidelity-product-acceptance-contract --silent`、`npm run smoke:browser-keyboard-editing-behavior --silent`、`npm run smoke:browser-bounded-evidence-crosscheck --silent`；状态：完成为 owner/audit contract，真实 system clipboard round-trip 仍未完成。
  - [ ] 验证真实系统 clipboard round-trip，manifest 不记录 raw clipboard payload。
  - [ ] 验证真实产品 selection range，只记录 refs/长度/hash，不记录 raw selection/DOM。
  验证：`npm run smoke:browser-input-fidelity-product-acceptance-contract --silent`；`npm run smoke:browser-bounded-evidence-crosscheck --silent`；`npm run smoke:browser-keyboard-editing-behavior --silent`。

- [x] 删除 Legacy Host-Stream / WebRTC live path。完成：2026-06-02；evidence：`src/ui/src/app/results/browserPaneHostAdapter.test.ts` adapter source rejects legacy live transport, `packages/presentation/components/browser-workbench/render.test.tsx` no fallback DOM/input transport, `docs/test-artifacts/browser-host-webrtc-loopback/manifest.json` 与 `docs/test-artifacts/browser-host-webrtc-transport-bridge/manifest.json` claimScope=`legacy-transport-diagnostic-only`；验证：`npm run smoke:browser-bounded-evidence-crosscheck --silent`、`node --import tsx --test packages/presentation/components/browser-workbench/render.test.tsx src/ui/src/app/results/browserPaneHostAdapter.test.ts`；状态：完成，旧 transport 仅 diagnostic/evidence。
  验收：host-stream、frame-stream、canvas-binary、WebRTC candidate/loopback/bridge 和 HTTP `/frame` 不能作为 Browser pane 产品 live surface，也不能在 native attach 失败时 fallback；它们只允许作为 refs-first evidence、diagnostic、manual inspection 或 migration audit。
  当前状态：`websocket-binary` frame-stream、canvas-binary opt-in、WebRTC candidate/loopback/bridge 已降级为 diagnostic / migration evidence，不再参与右栏产品 live path。
  子任务：
  - [x] 删除 Browser Workbench 的 canvas-binary / WebRTC live page 渲染分支，或改成只读 evidence viewer。完成：2026-06-02；evidence：`render.test.tsx` rejects websocket/canvas/WebRTC fallback claims and source has no `<canvas>`/`<img>`/`<iframe>` live fallback；验证：`node --import tsx --test packages/presentation/components/browser-workbench/render.test.tsx`；状态：完成。
  - [x] Workspace Writer `/health` 中的 `frame-stream` 不再作为 Browser pane ready 条件；只作为 optional diagnostic capability。完成：2026-06-02；evidence：`workspaceClient.browser-host-preflight.test.ts` stale diagnostic frame transports blocked、`workspace-server-health.test.ts` diagnostics endpoint separate from native surface capability；验证：`node --import tsx --test src/ui/src/api/workspaceClient.browser-host-preflight.test.ts src/runtime/workspace-server-health.test.ts`；状态：完成。
  - [x] 更新 WebRTC loopback/bridge smoke：只能证明 transport feasibility 或 legacy path refusal，不能 claim right-pane UI live pass。完成：2026-06-02；evidence：`tests/smoke/smoke-browser-host-webrtc-loopback.test.ts`、`tests/smoke/smoke-browser-host-webrtc-transport-bridge.test.ts`、corresponding manifests claimScope=`legacy-transport-diagnostic-only`；验证：`npm run smoke:browser-host-webrtc-loopback --silent`、`npm run smoke:browser-host-webrtc-transport-bridge --silent`；状态：完成。
  - [x] crosscheck 继续拒绝 candidate、loopback、HTTP `/frame`、跨 session refs、second truth 或 fallback path 伪造 pass。完成：2026-06-02；evidence：`tests/smoke/smoke-browser-bounded-evidence-crosscheck.test.ts` allBlockers include live-pass-requires-native-embedded / second-truth / WebRTC refusal checks；验证：`npm run smoke:browser-bounded-evidence-crosscheck --silent`；状态：完成。
  验证：`npm run smoke:browser-bounded-evidence-crosscheck --silent`；`node --import tsx --test packages/presentation/components/browser-workbench/render.test.tsx src/ui/src/app/results/browserPaneHostAdapter.test.ts`。
  仅在触碰旧 transport 代码时运行：`npm run smoke:browser-host-session-frame-stream-lab --silent`；`npm run smoke:browser-host-webrtc-loopback --silent`；`npm run smoke:browser-host-webrtc-transport-bridge --silent`。

### P2：平台 Benchmark、长会话和 Runtime Acceptance

- [ ] Native Adapter Platform Benchmark。
  验收：给出 Electron `WebContentsView`、独立 Chromium surface、WebView2、WKWebView 的真实操作延迟、CPU、内存、稳定性、输入完整性和长期会话表现；不足时提出替代 adapter 方案。
  当前状态：未完成。`docs/test-artifacts/browser-native-adapter-comparison/manifest.json` status=`passed` 但 benchmarkScope=`contract-fixture` / `livePlatformBenchmark=not-run-by-this-smoke`，不能作为真实 benchmark pass。2026-06-02 已 opt-in 跑 Electron `WebContentsView` external result runner：`platform-benchmark-results.json` 保持 status=`blocked`、benchmarkClaim=`false`；Electron candidate 有 bounded `real-native-adapter-run` proof refs（`browser-host-session:*`、`benchmark-result:electron-web-contents-view:{native-adapter-surface,action-trace,platform-summary}:*`）和 real metric summary refs，`latency`、`cpu`、`memory`、`inputCompleteness` sections passed；`lifecycle`、`reconnect` required metric sections 仍 blocked，blocker=`benchmark-result:electron-web-contents-view:missing-required-metric-section-results`。WebView2 当前平台 unsupported-on-darwin 且缺 command，WKWebView 与 standalone Chromium surface 也缺 real adapter command，因此没有真实多平台 benchmark run。
  子任务：
  - [ ] 为 Electron `WebContentsView` 补齐 latency/cpu/memory/inputCompleteness/lifecycle/reconnect required metric sections。当前状态：`docs/test-artifacts/desktop-browser-native-live-acceptance/manifest.json` `benchmarkMetrics` 已提供 latency/cpu/memory/inputCompleteness bounded numeric summaries，并由 external runner 写入 `platform-benchmark-results.json`；lifecycle/reconnect 仍 blocked，不能 claim benchmark pass。
  - [ ] 为独立 Chromium surface、WebView2、WKWebView 输出真实 `real-native-adapter-run` bounded proof refs。当前状态：缺 real adapter command；WebView2 在当前 darwin 环境也 unsupported。
  - [ ] 评估同 session ownership、refs 采集、input routing、security isolation、lifecycle 的实现成本。
  - [ ] 决策是否需要 platform-specific native sidecar。
  验证：`npm run smoke:browser-native-adapter-comparison --silent`；`npm run smoke:browser-native-adapter-platform-benchmark --silent`；`SCIFORGE_BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK=1 SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_WEB_CONTENTS_VIEW_COMMAND="$(pwd)/node_modules/.bin/tsx" SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_WEB_CONTENTS_VIEW_ARGS_JSON='["tools/browser-native-adapter-electron-web-contents-view-external-result.ts"]' SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_RUN_LIVE_SMOKE=1 npm run browser-native-adapter-platform-benchmark:runner --silent`。

- [ ] 5 分钟产品长会话稳定性。
  验收：连续 5 分钟冲浪、多 tab、reload、back/forward、右栏 resize、workspace writer restart 后不丢 session；否则给出明确恢复状态。
  当前状态：未完成 native-only 5 分钟。2026-06-02 已用 `SCIFORGE_BROWSER_PRODUCT_LONG_SESSION_MINUTES=5` 触发 requested-minutes/runUntilDeadline bounded attempt；`docs/test-artifacts/browser-pane-product-long-session/manifest.json` 当前 status=`blocked`、`runner.requestedMinutes=5`、`runner.durationTargetMs=300000`、`liveAcceptance.observed.liveSurfaceTransport=missing-native-attach`、iterations=0，只能作为 typed blocked diagnostic；manifest 已记录 `nativeOnlyAttempt` 的 duration target、elapsed/iterations、address-details recovery expectation、tab continuity expectation、workspace-writer reconnect/retry expectation、bounded memory/surface counters 和 no-legacy-fallback booleans；没有 5 分钟 native dogfood pass。
  子任务：
  - [ ] 定期复跑 5 分钟产品长会话，确认 address-details retry/recovery、writer restart reconnect、tab switch continuity 没有回归。当前状态：5 分钟 env 已尝试但缺 native attach 后在 iteration 0 bounded blocked；artifact 只记录 expectation/blocked counters，host-stream 5 分钟不计完成。
  - [ ] 继续观察真实产品 memory growth、surface detach leak，并保持 artifact bounded。当前状态：`nativeOnlyAttempt.boundedCounters` 已建立 bounded schema；native surface memory/detach leak 未用 5 分钟 dogfood 证明。
  - [ ] 扩展多 tab close / reopen / resize / reload / back-forward 的更复杂真实产品长测 evidence。当前状态：未完成。
  验证：`npm run smoke:browser-host-session-long-session --silent`；`npm run smoke:browser-pane-product-long-session --silent`；`SCIFORGE_BROWSER_PRODUCT_LONG_SESSION_MINUTES=5 npm run smoke:browser-pane-product-long-session --silent`。

- [x] Runtime Codex Browser Acceptance Route。完成：2026-06-02；evidence：`docs/test-artifacts/runtime-codex-browser-acceptance/manifest.json` schema=`sciforge.runtime-codex.browser-acceptance.v1` status=`blocked` with current-env bounded preflight, `docs/test-artifacts/runtime-codex-browser-acceptance/blocked-runtime-config.md`, `tests/smoke/smoke-runtime-codex-browser-acceptance.ts` shared `CODEX_RUNTIME_STREAM_PATH` and bounded-manifest guard；验证：`npm run smoke:runtime-codex-browser-acceptance --silent`；状态：route/config evidence worker no longer fails on missing route; live acceptance remains blocked on service env and does not claim Browser pane pass。
  验收：Runtime Codex workspace server route 可用于 Browser acceptance；blocked evidence 不再因为 route 缺失而停在 runtime config。
  当前状态：route/config smoke 当前会生成 bounded blocked evidence；当前 blocker 是 service env 缺 `SCIFORGE_RUNTIME_API_KEY`，blocked 不作为 Browser pane live pass。
  子任务：
  - [x] 保持 Runtime Codex workspace server stream route 与 runtime server/UI route 一致，防止 route drift。完成：2026-06-02；evidence：`tests/smoke/smoke-runtime-codex-browser-acceptance.ts` imports shared `CODEX_RUNTIME_STREAM_PATH` from `@sciforge-ui/runtime-contract/codex-realtime-session`；验证：`npm run smoke:runtime-codex-browser-acceptance --silent`；状态：完成。
  - [x] blocked manifest 保持 bounded，不记录 raw DOM/base64/provider payload。完成：2026-06-02；evidence：`assertBoundedManifestPayload` guard in `tests/smoke/smoke-runtime-codex-browser-acceptance.ts` and current `manifest.json` / `blocked-runtime-config.md` refs-only blocked evidence；验证：`npm run smoke:runtime-codex-browser-acceptance --silent`；状态：完成。
  - [ ] service env 配齐后重新跑 Runtime Codex browser acceptance，不冒充右栏 Browser live pass。
  验证：`npm run smoke:runtime-codex-browser-acceptance --silent`。

## 验证规则

- 纯文档改动：运行 `git diff --check`。
- Browser 代码或契约改动至少运行：`npm run typecheck --silent`；`git diff --check`；`node --import tsx --test src/runtime/browser-host-session.test.ts src/runtime/browser-host-search-runtime.test.ts`；`node --import tsx --test packages/presentation/components/browser-workbench/render.test.tsx src/ui/src/app/results/browserPaneModel.test.ts src/ui/src/app/results/browserPaneHostAdapter.test.ts`。
- Native Browser live path 改动：运行 `npm run smoke:desktop-browser-native-live-acceptance --silent`、`npm run smoke:desktop-browser-native-live-acceptance:strict --silent` 和 `npm run smoke:browser-bounded-evidence-crosscheck --silent`。
- 真实体验验收必须使用 SciForge 右侧 Browser pane 完成 dogfood run，并只记录 transport、surface、latency、卡顿点、bounded refs、writer/native adapter health；不记录 raw DOM、raw screenshot、base64、provider payload、secret 或一次性页面内容。
