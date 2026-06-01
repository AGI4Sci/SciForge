# SciForge Browser 流畅性任务板

最后更新：2026-06-02

本文档从 [`PROJECT.md`](PROJECT.md) / [`PROJECT_right.md`](PROJECT_right.md) 拆出，专门维护 SciForge 右侧 Browser pane 的真实使用、流畅性和实时性任务。当前只登记 task / TODO，不代表已改代码。

## 当前目标

- 右侧 Browser 必须像正常浏览器一样可连续冲浪：打开网页、搜索、点击、拖拽、滚动、输入、返回、前进、刷新和停止都应低延迟、可见、可预测。
- 必须真实使用 SciForge 自己的 Browser pane 做 dogfood 验证，不能只靠单元测试或外部浏览器判断体验。
- Desktop shell 的最终高性能路径是 `BrowserHostSession` owned native embedded surface；Electron `WebContentsView` / WebView2 / WKWebView / 独立 Chromium surface 只是同一个 session 的 display/input adapter。
- `BrowserHostSession` 仍是唯一 owner：导航、输入、state、refs、screenshot、DOM、AX、console、network、search refs 都归它。GUI / shell 只 attach surface、投递 input intent、展示 typed state。
- 不允许 iframe、proxy、snapshot、旧 frame、`<webview>`、系统 popup 或第二套 viewer 冒充 live browser，也不允许在 native surface 不可用时自动切换成第二真相源。

## 不可变规则

- 所有修改必须通用，不能为当前页面、截图、URL、文件名或历史 run 写硬编码补丁。
- 代码路径保持唯一真相源；旧逻辑和最终方案冲突时删除或迁移旧逻辑，不做长期并行实现。
- 业务代码单文件超过约 2000 行时必须拆分或登记拆分任务。
- 已完成 TODO 需要打勾，并补充日期、evidence refs、验证命令和最终状态。
- 所有改动必须通用，不为 Baidu/Google、当前 localhost、当前截图、当前 run 或某次历史网络状态写硬编码。
- 大 payload、截图、DOM/AX、console/network logs 和 evidence 必须 refs-first；不得把 base64/raw DOM/raw logs 写入 GUI state 或任务文档。
- Browser 体验调优必须保持单一交互真相源：一个 `BrowserHostSession`，一个 live surface，证据 artifact 只做审计和 manual inspection。
- 输入热路径优先级最高：用户 click/type/drag/scroll/cursor 不能被 screenshot、DOM、AX、console/network、search summary 或 state polling 阻塞。
- 完成任何 TODO 后必须补：日期、bounded evidence、验证命令、状态；真实 UI evidence 只能记录稳定 selector、latency、transport、refs 和脱敏 diagnostics。

## 基准指标

这些指标用于每轮优化前后对比，不作为硬编码：

- Open 到首个可交互画面：普通外部站点目标 < 2s，慢站点要显示 loading/progress/diagnostic。
- 输入到页面可见：普通文本输入目标 < 50ms p95，长输入不丢字、不乱序。
- 滚轮/拖拽跟手：连续事件目标 60fps 体感，至少不出现明显队列堆积和秒级延迟。
- Cursor / caret：输入框内可见 caret；按钮/链接显示 pointer；普通区域 default；文本区域 text。
- Evidence 不抢热路径：snapshot/state/DOM/AX/log/search refs 可以滞后生成，但不能阻塞冲浪。

## 2026-06-02 contract / runbook 更新

- Browser pane dogfood runbook 已建立：[`docs/runbooks/browser-pane-dogfood-runbook.md`](docs/runbooks/browser-pane-dogfood-runbook.md)。
  状态：runbook 完成；真实 Web shell 右栏 Browser pane 三场景 dogfood smoke 已通过，覆盖 search submit、result click、long document scroll、form input/submit，且只通过 SciForge UI / Browser pane host surface 操作。
  Evidence refs：`docs/test-artifacts/browser-pane-dogfood/manifest.json`、`targetOriginRef`、`browser-host-session:*` refs、bounded event hashes。
  验证：`npm run smoke:browser-pane-dogfood --silent`；`git diff --check`。
- BrowserHostSession latency instrumentation 已完成 contract 覆盖：state 暴露 `lastActionTiming` / `actionTimingSummary` / `nativeAdapterUrl`，action body 接收 `actionId`、`uiEventReceivedAt`、`adapterSentAt`，UI diagnostics 展示 transport、native adapter URL、last action timing、blocked reason、p50/p95 summary。
  Evidence refs / selectors：`BrowserHostSessionState.lastActionTiming`、`BrowserHostSessionState.actionTimingSummary`、`.browser-workbench-viewer-diagnostics[data-browser-last-action]`。
  验证：`npm run typecheck --silent`；`node --import tsx --test src/runtime/browser-host-session.test.ts packages/presentation/components/browser-workbench/render.test.tsx src/ui/src/app/results/browserPaneHostAdapter.test.ts src/ui/src/api/workspaceClient.browser-host-preflight.test.ts`。
- Web shell right-pane BrowserHostSession acceptance 通过：external fixture 走 `BrowserHostSession` host-stream / `websocket-binary`，无 iframe/proxy/system popup/HTTP `/frame` live fallback。
  Evidence refs / selectors：`img[data-browser-host-surface="browser-host-session"][data-browser-frame-transport="websocket-binary"]`、`browser-host-session:*` refs。
  验证：`node --import tsx --test tests/smoke/right-pane-browser-acceptance.test.ts`。
- Desktop native adapter contract 覆盖增强：Electron `WebContentsView` adapter 记录 `native-embedded`、single owner、focus attach、scroll/type/press/cursor action、`secondTruthSource=false`；新增 native surface lifecycle contract，覆盖 attach bounds normalize/update、hidden/minimize visible=false、detach/reattach 同 session 复用、focus、close cleanup、server health/stop cleanup。
  Evidence refs / selectors：`DesktopBrowserHostSurfaceState.liveSurfaceTransport=native-embedded`、`owner=BrowserHostSession`、`adapterRole=display-input-adapter`。
  验证：`node --import tsx --test tests/smoke/smoke-desktop-electron-main.test.ts tests/smoke/smoke-desktop-browser-native-surface-lifecycle.test.ts`；`npm run smoke:desktop-browser-native-surface-lifecycle --silent`。
- Desktop Browser native live acceptance smoke 已建立：`smoke:desktop-browser-native-live-acceptance` 只在 production Electron 右栏 Browser pane 真实 attach `native-embedded` surface、`owner=BrowserHostSession`、`secondTruthSource=false`、并观测 BrowserHostSession input 更新 native fixture 后才允许 pass；缺 `dist-desktop` / native adapter 时写 blocked manifest，严格模式失败，不能把 iframe/proxy/`<webview>`/snapshot/frame-stream/system popup 当 desktop live pass。
  当前本地状态（2026-06-02）：passed；production Electron 右栏 Browser pane 使用 `Electron WebContentsView` native adapter，BrowserHostSession public state 为 `liveSurfaceTransport=native-embedded`、`singleInteractiveTruth=true`、无 frame-stream/frame/frameUrl live backing，BrowserHostSession input 经 native adapter text endpoint 观测到页面文本更新；strict smoke 还验证 native click ACK 为 `paintAckSource=native-adapter-action-state`、ACK 窗口 `screenshotRequestsDuringAck=0` / `frameStreamRequestsDuringAck=0`，并验证 action 后 lightweight `/state` heartbeat 带 `url/title/loading/canGoBack/canGoForward`。修复项包括 desktop build 相对资产路径、desktop runtime config 水合顺序、sidecar bundling 外部化 native/CJS 依赖，以及 runtime-imported CLI guard 收紧。
  Evidence refs：`docs/test-artifacts/desktop-browser-native-live-acceptance/manifest.json`、`DesktopBrowserNativeLiveAcceptanceEvidence.rejectedDesktopLiveSubstitutes`。
  验证：`npm run desktop:build --silent`；`npm run smoke:desktop-browser-native-live-acceptance --silent`；`npm run smoke:desktop-browser-native-live-acceptance:strict --silent`；`npm run typecheck --silent`。
- 输入热路径继续收紧：右栏 Browser host 启动 pending 时投影为 loading，拖拽不再降级成 first/last point generic Computer Use action，而是保留完整 `drag.path` 交给 `BrowserHostSession`。
  Evidence refs / selectors：`RightPaneBrowserProjectionOptions.hostBusy`、`RightPaneBrowserHostAction.action='drag'`、`sendBrowserHostSessionAction({...action})`。
  验证：`node --import tsx --test src/ui/src/app/results/browserPaneModel.test.ts src/ui/src/app/results/browserPaneHostAdapter.test.ts`；`npm run typecheck --silent`。
- 补充 smoke：`npm run smoke:browser --silent` 通过；`npm run smoke:runtime-codex-browser-acceptance --silent` 生成 blocked evidence，blocker 为 Runtime Codex workspace server route 缺失，不作为 Browser pane live pass。
  Evidence refs：`docs/test-artifacts/runtime-codex-browser-acceptance/manifest.json`、`docs/test-artifacts/runtime-codex-browser-acceptance/blocked-runtime-config.md`。
- Host-stream 键盘热路径继续修复：点击 host frame 时 capture 阶段聚焦 hidden keyboard input，并在 `requestAnimationFrame` / `setTimeout(0)` 复核焦点；`press` 会先 flush buffered `type`，再以 `capture: none` 进入 BrowserHostSession，降低 Enter/快捷键落回聊天 composer 的风险。
  Evidence refs / selectors：`.browser-workbench-host-keyboard-input[data-browser-host-keyboard-focus="active"]`、`.browser-workbench-host-frame[data-browser-host-keyboard-focus="hidden-input"]`、`RightPaneBrowserHostAction.action='press'`。
  验证：`node --import tsx --test packages/presentation/components/browser-workbench/render.test.tsx src/ui/src/app/results/browserPaneHostAdapter.test.ts`。
- `browser_search` 与可见 Browser session 协同继续推进：`BrowserHostSearchInput` / REST route / UI client 支持可选 `sessionId`，可在现有 BrowserHostSession 内执行搜索；`browser_search` payload 显式输出 `browserSessionRef` / `projectionRef`，右栏 Browser 聚焦 `browser-runtime-projection` artifact 时复用同一个 `hostSession`。
  Evidence refs / selectors：`BrowserHostSearchInput.sessionId`、`browser-search-results-*.data.browserSessionRef`、`browser-host-projection-*.data.hostSession.id`。
  验证：`node --import tsx --test src/runtime/browser-host-session.test.ts src/runtime/browser-host-search-runtime.test.ts src/ui/src/app/results/browserPaneModel.test.ts src/ui/src/app/results/browserPaneHostAdapter.test.ts`。
- `browser_search` 产品流 smoke 补强：runtime 会从当前 Browser-specific refs / `uiState.currentReferences` 提取 `browser-host-session:*` 并复用；projection object reference 显式声明 `artifactType=browser-runtime-projection` / `preferredView=browser-workbench`；right-pane SSR product smoke 证明聚焦后 Browser workbench 复用同一 `browser-host-session:*`，且无 iframe/proxy/system window/base64 第二真相源。
  Evidence refs / selectors：`objectReferences[].preferredView=browser-workbench`、`provenance.browserSessionRef`、`data-browser-live-surface-ref="browser-host-session:*"`。
  验证：`node --import tsx --test src/runtime/browser-host-search-runtime.test.ts src/ui/src/app/results/rightPaneSurfaceAdapter.test.ts`。
- Browser performance lab 本地雏形已建立：deterministic BrowserHostSession fixture 覆盖 navigation/type/scroll/drag/search timing summary，并输出 bounded before/after summary；只输出 bounded timing/ref summary，不记录 raw DOM/base64。
  Evidence refs：`tests/smoke/smoke-browser-host-session-performance-lab.test.ts`。
  验证：`node --import tsx --test tests/smoke/smoke-browser-host-session-performance-lab.test.ts`。
- Web shell frame-stream metrics lab 已建立：现有 `websocket-binary` stream metadata 聚合 bounded `frameStreamMetrics`，包含 sequence、captureMs、frameBytes、maxBufferedBytes、skippedBusy、skippedRecentInput、skippedBackpressure、droppedSinceLastFrame；deterministic lab 进一步输出 bounded p95 capture 与 dropped frame summary；backpressure/skip 计数只作为 stream-local diagnostics，不写入 BrowserHostSession truth。
  Evidence refs：`tests/smoke/smoke-browser-host-session-frame-stream-backpressure-lab.test.ts`、`frameStreamMetrics` metadata、`sciforge.browser-host-session.frame-stream-p95-drop-lab.v1`。
  验证：`npm run smoke:browser-host-session-frame-stream-lab --silent`；`node --import tsx --test tests/smoke/smoke-browser-host-session-frame-stream-backpressure-lab.test.ts src/runtime/browser-host-session.test.ts src/ui/src/api/workspaceClient.browser-host-preflight.test.ts`。
- Web shell canvas renderer contract experiment 已建立：`browser-workbench` 的 opt-in `frameRenderer='canvas-binary'` 只有在同一个 `BrowserHostSession` 的 `frameStreamRef=browser-host-session:<sessionId>/frame-stream`、`liveSurfaceTransport=host-stream`、`singleInteractiveTruth=true` 且 transport 为 `websocket-binary` 时才渲染 `<canvas>`；mismatched stream ref 降回 typed state；canvas host frame 使用 canvas bitmap size 映射坐标，并补齐 hidden keyboard path / keyboard forwarding；不使用 html2canvas/DOM capture、不新开 browser/proxy/iframe/第二 viewer。
  Evidence refs / selectors：`canvas.browser-workbench-host-canvas[data-browser-frame-renderer="canvas-binary"][data-browser-frame-source="browser-host-session-frame-stream-binary"]`、`data-browser-frame-session-id`、`data-browser-frame-stream-ref`、`data-browser-host-keyboard-path="hidden-input"`。
  验证：`node --import tsx --test packages/presentation/components/browser-workbench/render.test.tsx src/ui/src/app/results/browserPaneHostAdapter.test.ts`。
- BrowserHostSession runtime 已机械拆分：public constants/types、timing helpers、search helpers 分离到 `browser-host-session-types.ts` / `browser-host-session-timing.ts` / `browser-host-session-search.ts`，`browser-host-session.ts` 保持 re-export 且降至 1526 行。
  验证：`npm run typecheck --silent`；`node --import tsx --test src/runtime/browser-host-session.test.ts src/runtime/browser-host-search-runtime.test.ts tests/smoke/smoke-browser-host-session-performance-lab.test.ts`。
- 当前仍未关闭：真实卡点排序复测、30 分钟真实产品长会话、真实 WebRTC transport stack、Electron/WebView2/WKWebView 真实性能对比。已关闭的 contract smoke 包括 loading/progress lifecycle、native paint ACK heartbeat、WebRTC transport candidate schema；这些 contract 不冒充真实长测或平台 benchmark。

## P0：真实使用与问题定位

- [x] 建立 Browser dogfood runbook。
  验收：用 SciForge 右侧 Browser pane 真实完成至少 3 个连续冲浪任务：搜索资料、打开多个结果、返回/前进、页面内输入、滚动阅读、复制 URL、open-external handoff；记录 bounded evidence，不记录 raw DOM/screenshot/base64。
  完成（2026-06-02）：runbook 文档已完成；新增真实 Web shell 右栏 Browser pane dogfood smoke，启动 SciForge UI + Workspace Writer + `.test` fixture，Playwright 只操作 SciForge UI、Browser pane 地址栏、visible BrowserHostSession host frame/keyboard path，不直接读取 fixture DOM；覆盖搜索提交、结果导航、长文档滚动、表单 input/textarea/submit；manifest 只记录 session/transport/refs、timing summary、bounded event length/hash，拒绝 iframe/proxy/system popup/HTTP frame live fallback/raw DOM/data image。
  Evidence：[`docs/runbooks/browser-pane-dogfood-runbook.md`](docs/runbooks/browser-pane-dogfood-runbook.md)、`docs/test-artifacts/browser-pane-dogfood/manifest.json`。
  验证命令：`npm run smoke:browser-pane-dogfood --silent`；`git diff --check`。
  最终状态：Web shell 三场景 dogfood smoke passed；公网/人工探索 dogfood 仍可作为后续扩展，不阻塞此 runbook 父项。
  TODO：
  - 设计固定但非站点硬编码的 dogfood 场景：搜索公开技术资料、阅读文档页、填写普通搜索框、滚动长页面。
  - 每次 run 记录 `sessionId`、transport、surface type、首帧时间、输入延迟、滚动/拖拽卡顿点、state/refs 是否滞后。
  - 明确“用户可感知卡顿”来自输入路由、surface attach、frame capture、state polling、network/navigation、React rerender 还是 workspace writer。

- [x] 建立 Browser latency instrumentation。
  验收：每个 BrowserHostSession action 都有轻量 timing：UI event received、adapter sent、host action start/end、surface paint/ack、evidence capture start/end；日志 refs-first 且脱敏。
  完成（2026-06-02）：`BrowserHostSessionState.lastActionTiming` 记录 `uiEventReceivedAt`、`adapterSentAt`、`hostReceivedAt`、`hostStartedAt`、`hostActionEndedAt`、`evidenceCaptureStartedAt`、`evidenceCaptureEndedAt`、`totalMs`、`paintAckSource`、`blockedReason`；`actionTimingSummary` 按 action 汇总 p50/p95；UI adapter 透传 action timing；Browser Workbench diagnostics 展示 transport、native adapter URL、last action timing 和 latency summary。补充 blocked/error/offline actionable diagnostics：只展示本地 writer/native adapter origin、health capability、transport、last action timing、last blocked reason、bounded diagnostics；错误 state 的 reason/detail 同样走清洗，不输出 raw DOM/base64/screenshot/secrets/provider payload。
  Evidence：`browser-host-session:*` state refs；`.browser-workbench-viewer-diagnostics[data-browser-last-action]`；`.browser-workbench-viewer-diagnostics[data-browser-writer-url]`；`data-browser-health-capability`；`data-browser-native-adapter-url`；`data-browser-last-action-timing`；`nativeAdapterUrl` 只接受 local HTTP adapter URL。
  验证命令：`npm run typecheck --silent`；`node --import tsx --test src/runtime/browser-host-session.test.ts packages/presentation/components/browser-workbench/render.test.tsx src/ui/src/app/results/browserPaneHostAdapter.test.ts src/ui/src/api/workspaceClient.browser-host-preflight.test.ts`。
  最终状态：contract / UI diagnostics / blocked-state actionable diagnostics complete；真实 p50/p95 dogfood 数据待真实 runbook 记录。
  TODO：
  - 为 open/click/type/press/scroll/drag/cursor 分别记录 p50/p95。
  - 区分 live surface paint latency 和 evidence refs latency。
  - [x] 在 UI 错误态展示可执行诊断：writer URL、health capability、native adapter URL、transport、last action timing、last blocked reason。

- [ ] 真实复测当前“右侧栏浏览器不够流畅、实时性不好”的卡点。
  验收：给出当前最大瓶颈排序，并用真实 SciForge Browser pane 操作证据支撑；不能只给架构猜测。
  状态（2026-06-02）：新增真实 SciForge UI bottleneck audit smoke，启动 Workspace Writer + SciForge UI + `.test` fixture，只通过右栏 Browser pane 做连续输入、长页面滚动、drag/mouse route、address navigation + Back/Forward/Reload，并输出 bounded bottleneck ranking artifact；证据只记录耗时、计数、hash、refs 和 action 类型。本地样例排序为 `surface-attach > navigation > input-routing > react-rerender > state-polling > frame-capture`。公网/人工复测仍可继续扩展，父项保留未关闭。
  Evidence：`tests/smoke/smoke-browser-pane-bottleneck-audit.test.ts`、`docs/test-artifacts/browser-pane-bottleneck-audit/manifest.json`、`sciforge.browser-pane-bottleneck-audit.v1` bounded ranking、`data-browser-live-surface-ref="browser-host-session:*"`。
  验证命令：`npm run smoke:browser-pane-bottleneck-audit --silent`；`node --import tsx --test src/ui/src/app/results/browserPaneHostAdapter.test.ts src/ui/src/app/results/browserPaneModel.test.ts`。
  TODO：
  - 复测 Google/Baidu 类搜索框连续输入是否完整、是否能看到 caret、是否有输入丢失。
  - 复测长页面连续滚动、拖动滑块、按住鼠标拖拽选择/验证码滑块类动作的事件完整性。
  - 复测右栏 resize、tab 切换、reload 后 native surface 是否仍 attach 正确。

## P0：Desktop Native Surface 热路径

- [x] 确认桌面产品路径真正使用 native embedded surface。
  验收：桌面 shell 中右侧 Browser pane 显示 `native-embedded` surface；DOM 中不出现 iframe/proxy/`<webview>`/`img /frame` live view；`frameStreamRef` 不作为 desktop live 替代路径。
  完成（2026-06-02）：production Electron 右栏 Browser pane strict smoke 通过；`SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL` 由 Electron main 注入 workspace writer sidecar，BrowserHostSession 创建 native adapter session，Workbench 只渲染 `data-browser-native-surface="true"` 的 native mount，不渲染 iframe/proxy/`<webview>`/host-stream frame/img/canvas 作为 desktop live backing；typed token 通过 BrowserHostSession input 写入 native fixture 并由 native adapter text endpoint 读回。
  Evidence：`DesktopBrowserHostSurfaceState.owner=BrowserHostSession`、`liveSurfaceTransport=native-embedded`、`secondTruthSource=false`、`docs/test-artifacts/desktop-browser-native-live-acceptance/manifest.json`。
  验证命令：`npm run desktop:build --silent`；`npm run smoke:desktop-browser-native-live-acceptance --silent`；`npm run smoke:desktop-browser-native-live-acceptance:strict --silent`；`node --import tsx --test src/runtime/browser-host-session.test.ts`。
  最终状态：desktop native live product path pass；resize/detach/minimize/restart 持久性继续归入长会话稳定性项。

- [x] 将输入事件从“请求-等待-刷新”改成真正低延迟 action stream。
  验收：click/type/press/scroll/mousemove/drag/cursor 可以连续发送，不等待 screenshot/state/evidence；action ACK 与 evidence capture 解耦。
  状态（2026-06-02）：UI 已为 action 记录 `actionId` / `uiEventReceivedAt` / `adapterSentAt`，type/scroll/cursor 走轻量 capture；drag 保留完整 path 到 BrowserHostSession，不降级为 first/last point；BrowserHostSession 新增 per-session input channel，同 session 保持串行语义，`type` delta 合并、`scroll` burst 合并、`mouse-move` stale 只保留最新点，close 后 input 明确拒绝；用户输入即使请求 `frame/full` capture 也先 ACK，证据采集 deferred。action-stream smoke 覆盖 deferred capture 未完成时 type/scroll/cursor/press bounded ACK、burst skip、close reject、capture full ACK-before-evidence。补充 composition-aware text delta contract，证明多段输入同 session 合并为一次 host `type`、不触发 screenshot/DOM/AX 刷新、report 只记录 refs/count/policy；runtime drag 现在优先走 `mouseDown -> mouseMove* -> mouseUp` streamed path，低层 API 缺失才 fallback 到 one-shot `drag()`，并有 smoke 断言 ACK 与 evidence capture 解耦。真实产品长链路体感仍归入 bottleneck / long-session 父项。
  Evidence：`RightPaneBrowserHostAction.actionId`、`sendBrowserHostComputerUseAction(...adapterSentAt...)`、`sendBrowserHostSessionAction({...action})`、`tests/smoke/smoke-browser-host-session-action-stream-contract.test.ts`、`sciforge.browser-host-session.action-stream-backpressure-smoke.v1`。
  验证命令：`node --import tsx --test src/ui/src/app/results/browserPaneHostAdapter.test.ts src/runtime/browser-host-session.test.ts`；`npm run smoke:browser-host-session-action-stream-contract --silent`。
  最终状态：BrowserHostSession action stream / input channel / streamed drag contract complete；真实产品体感回归继续归入 bottleneck 与长会话项。
  TODO：
  - 设计 BrowserHostSession input channel：同 session 串行保证语义，但允许 mousemove/scroll 合并和丢弃过时事件。
  - [x] 对 text input 使用 composition-aware delta，不按每个字符触发重型 state 更新。
  - [x] 对 drag 使用 pointerdown/move/up path streaming，保证按住鼠标连续移动不丢事件。

- [ ] 明确 native surface paint/ack 机制。
  验收：用户动作后 live surface 更新不依赖 PNG screenshot；state/refs 可以异步追上。
  状态（2026-06-02）：`paintAckSource` 已区分 `native-adapter-action-state`、`host-stream-frame`、`none`；native paint ACK heartbeat smoke 证明 native embedded action ACK 使用 adapter action/state，不依赖 PNG screenshot 或 frame-stream，action 后 lightweight `/state` heartbeat 更新 URL/title/back/forward，失败以 bounded blocked + retry-same-native-surface 暴露，且不渲染 snapshot 第二 viewer。production Electron strict acceptance 现在也要求 native click ACK 使用 `native-adapter-action-state`、ACK 窗口无 screenshot/frame-stream request，并要求 `/state` heartbeat 包含 `url/title/loading/canGoBack/canGoForward`；manifest 当前 `status=passed`、`canClaim=true`。30 分钟 native heartbeat 长测仍归入长会话父项。
  Evidence：`tests/smoke/smoke-desktop-browser-native-paint-ack-heartbeat.test.ts`、`tests/smoke/smoke-desktop-browser-native-live-acceptance.ts`、`docs/test-artifacts/desktop-browser-native-live-acceptance/manifest.json`、`BrowserHostSessionActionTiming.paintAckSource='native-adapter-action-state'`、`snapshotSecondViewerRendered=false`。
  验证命令：`npm run smoke:desktop-browser-native-paint-ack-heartbeat --silent`；`npm run smoke:desktop-browser-native-live-acceptance --silent`；`npm run smoke:desktop-browser-native-live-acceptance:strict --silent`；`node --import tsx --test src/runtime/browser-host-session.test.ts tests/smoke/smoke-desktop-browser-native-surface-lifecycle.test.ts`。
  TODO：
  - 为 Electron `WebContentsView` 路径记录 action 后是否需要显式 paint ack。
  - 若 shell 无 paint ack API，定义 lightweight heartbeat：URL/title/loading/canGoBack/canGoForward 与 action completion 分离。
  - 失败时显示 blocked/retry，不切到 snapshot 第二画面。

## P0：渲染与状态更新去耦

- [x] 去除冲浪热路径中的 heavy capture。
  验收：普通 click/type/scroll/drag 不触发 DOM/AX/console/network 全量刷新；snapshot/state/search 才生成重型 refs。
  完成（2026-06-02）：BrowserHostSession default capture mode 将 cursor / mouse-down / mouse-move 设为 `none`，普通输入和滚动由 UI 以 `capture: none` 合并发送，full DOM/AX/log capture 只在 snapshot/state/search 或显式 full capture 发生；frame-stream 使用 `captureFrameIfIdle()`，忙或 recent input 时跳过 capture。
  Evidence：`browserHostDefaultCaptureMode()`、`captureFrameIfIdle()`、`browser-host-session:*` refs；没有 raw DOM/base64 写入 GUI state。
  验证命令：`node --import tsx --test src/runtime/browser-host-session.test.ts src/ui/src/app/results/browserPaneHostAdapter.test.ts tests/smoke/right-pane-browser-acceptance.test.ts`。
  最终状态：contract complete；真实体感 p95 仍由 dogfood runbook 记录。
  TODO：
  - 审计 BrowserHostSession action 默认 capture mode。
  - 把 evidence generation 放入 idle/background 队列，且可取消过期任务。
  - Browser pane UI 只根据轻量 state 更新 loading/url/title，不因 refs 刷新导致 surface remount。

- [ ] 防止 React rerender 破坏 Browser surface。
  验收：地址栏输入、tab 状态、refs 更新、diagnostic 展开不会导致 native surface detach/remount 或焦点丢失。
  状态（2026-06-02）：新增 Browser pane surface rerender stability smoke，SSR 覆盖 host-stream/canvas-binary/native-embedded 在 React rerender、config refresh、focused object refresh、loading/busy 状态变化下保持同一个 `browser-host-session:*` owner、同一 `liveSurfaceRef`、不切到 iframe/proxy/system popup/raw payload，并锁住 object URL revoke guard 与 native attach focus guard。新增真实 UI tab-focus retention smoke，验证点击 Browser host frame 后 hidden keyboard input 接管，切到 Results 再回 Browser 后，不二次点击 host frame 也能继续把 typing/Enter 路由到 BrowserHostSession，聊天 composer 捕获字符数为 0；实现上按 browser runtime tab key 记住/恢复 hidden keyboard focus，并为右栏 Browser tab 加 scoped in-memory BrowserHostSession cache。更复杂的多 tab/native detach 长测仍归入长会话父项。
  Evidence：`tests/smoke/smoke-browser-pane-surface-rerender-stability.test.ts`、`tests/smoke/smoke-browser-pane-tab-focus-retention.test.ts`、`docs/test-artifacts/browser-pane-tab-focus-retention/manifest.json`、`data-browser-live-surface-ref`、`data-browser-single-interactive-truth`、`data-browser-frame-renderer="canvas-binary"`、`data-browser-native-surface="true"`。
  验证命令：`npm run smoke:browser-pane-surface-rerender-stability --silent`；`npm run smoke:browser-pane-tab-focus-retention --silent`；`node --import tsx --test src/ui/src/app/results/browserPaneHostAdapter.test.ts packages/presentation/components/browser-workbench/render.test.tsx`。
  TODO：
  - 右栏 tab 切换回来后恢复 focus/keyboard target，不把输入送回聊天 composer。
  - 对 Browser pane topbar 状态更新做局部化，避免整个 right pane 频繁重渲染。

- [ ] 建立 loading/progress 的真实状态机。
  验收：慢网页不是“静止旧画面”或“假 ready”；用户能看到 loading、stalled、blocked、retry、handoff。
  状态（2026-06-02）：外部页 BrowserHostSession 启动 pending 时，右栏 projection 已通过 `hostBusy` 显示 loading；back/forward/reload 命令会立即设置 loading，ACK 后解除，stop 会立即解除 busy；旧 `hostSession.status='ready'` 若 requested/final URL 不匹配当前目标，不再冒充新目标 ready。新增 typed `loadingProgress` lifecycle contract，覆盖 `navigation-start`、`navigation-committed`、`interactive`、`load`、`network-quiet`、`stalled`、`blocked`、`retry`、`handoff`，并支持通用 host `lifecycle/progress/navigation` alias mapping；bounded reason 不泄露 raw URL/DOM。BrowserHostSession runtime 已为 open/navigate/back/forward/reload 写入 bounded host lifecycle progress：发起时 `navigation-start`，ready 时 `network-quiet/host-ready`，失败时 `blocked/host-error`，且 refs 只使用 `browser-host-session:*` 等稳定引用。真实 product long-session manifest 现在记录右栏 `.browser-workbench-viewer` bounded UI 状态 trace和 host `loadingProgress` sample；本次观测到 `idle->loading`、`loading->ready`、`ready`、host ready/network-quiet。更细的 committed/interactive/load 分段仍未完全接入真实浏览器事件，父项保持未关闭。
  Evidence：`BROWSER_HOST_LOADING_PROGRESS_SCHEMA`、`BrowserHostSessionState.loadingProgress`、`RightPaneBrowserProjectionOptions.hostBusy`、`rightPaneBrowserProjectionForUrl(...).loadingProgress`、`RIGHT_PANE_BROWSER_LOADING_PROGRESS_LIFECYCLE_SCHEMA`、`tests/smoke/smoke-browser-loading-progress-lifecycle.test.ts`、`src/runtime/browser-host-session.test.ts`、`src/ui/src/app/results/browserPaneModel.test.ts`、`docs/test-artifacts/browser-pane-product-long-session/manifest.json#boundedMetrics.loadingProgressLifecycle`。
  验证命令：`npm run smoke:browser-loading-progress-lifecycle --silent`；`npm run smoke:browser-pane-product-long-session --silent`；`node --import tsx --test src/runtime/browser-host-session.test.ts src/ui/src/app/results/browserPaneModel.test.ts src/ui/src/app/results/browserPaneHostAdapter.test.ts`。
  TODO：
  - 区分 navigation committed、DOMContentLoaded、load、network quiet、user-interactive。
  - stop/reload/back/forward 操作必须立即反映在地址栏和 loading 控件。
  - 记录当前 URL 与 finalUrl 的变化，不因重定向导致地址栏滞后。

## P1：正常浏览器交互细节

- [ ] Cursor / pointer / caret parity。
  验收：输入框 text cursor/caret 可见；按钮链接 pointer；可拖动元素、文本选择、普通区域符合浏览器行为。
  状态（2026-06-02）：新增 cursor/caret parity smoke，runtime 通过 single-owner `BrowserHostSession` host hit-test 返回 pointer/text/default，cursor action 默认 `capture:none` 且不触发第二 live surface；Web host-stream / canvas-binary 路径只投影 allowlisted CSS cursor 与 hidden keyboard caret，native embedded 路径保持平台真实 cursor，不伪造 Web cursor style。补充右栏 `mouseleave`/`mouseenter` 与窗口 `blur`/focus restore bounded contract，保持同一 `BrowserHostSession`、同一 live surface、`singleInteractiveTruth=true`；真实 OS window-manager focus signal 在 Node smoke 中记录为 typed bounded `blocked` policy。IME/clipboard/selection range 与真实产品 tab/focus 恢复仍未关闭。
  Evidence：`tests/smoke/smoke-browser-cursor-caret-parity.test.ts`、`cursorSequence=["pointer","text","default"]`、`edgeTransitions=["right-pane-mouseleave","right-pane-mouseenter","window-blur","window-focus-restore"]`、`focusLifecyclePolicy.blockedReasonCode="node-smoke-no-real-window-focus-signal"`、`captureModes=["none","none","none"]`、`.browser-workbench-host-keyboard-input`、`data-browser-native-surface="true"`。
  验证命令：`npm run smoke:browser-cursor-caret-parity --silent`。
  TODO：
  - 验证输入焦点、IME/composition、复制粘贴、快捷键、Tab focus。
  - [x] 鼠标离开/进入右栏、窗口失焦/恢复后 cursor 状态 deterministic contract。
  - 真实 OS 窗口失焦/恢复需要产品 UI dogfood 或 native shell evidence。

- [ ] 支持所有鼠标操作。
  验收：left/right/middle click、double click、context menu、mouse down/up、continuous move、drag、wheel、horizontal wheel 都走 BrowserHostSession。
  状态（2026-06-02）：新增 mouse gesture completeness smoke，deterministic BrowserHostSession 覆盖 left/right/middle click、double click、right click context policy、mouse down/up、连续 mouse move、完整 drag path、drag/drop path、文本选择 path、页面滚动条 thumb drag、vertical/horizontal wheel；全部断言 `BrowserHostSession` 单 owner、`capture:none` ACK、refs-first、不走系统输入、不引入 iframe/proxy/webview/raw DOM/base64。middle/modifier click 新 tab 语义已明确为 typed bounded `blocked` policy，不冒充已支持；真实产品滑块/复杂站点 drag-drop 和多 tab owner 仍未关闭。
  Evidence：`tests/smoke/smoke-browser-mouse-gesture-completeness.test.ts`、`docs/test-artifacts/browser-mouse-gesture-completeness/manifest.json`、`BrowserHostComputerUseActionResult.inputChannel='browser-host-session'`、`systemMouseEvents='not-sent'`。
  验证命令：`npm run smoke:browser-mouse-gesture-completeness --silent`；`node --import tsx --test src/runtime/browser-host-session.test.ts`。
  TODO：
  - [x] 为 drag/drop、文本选择、页面滚动条拖动建立 deterministic acceptance fixture。
  - 为真实产品滑块拖动和复杂页面 drag/drop 建立 acceptance fixture。
  - right click 应生成浏览器上下文行为或 typed blocked policy，不能被页面外层吞掉。
  - middle click / modifier click 的新 tab 行为需要明确：BrowserHostSession tab owner 还是 handoff。

- [ ] 支持常见键盘与编辑行为。
  验收：连续输入、Backspace/Delete、Enter、Tab、方向键、Home/End、PageUp/PageDown、Ctrl/Cmd+A/C/V/X、Escape 可用，且不进入聊天输入框。
  状态（2026-06-02）：Web host-stream path 已强化点击后 hidden keyboard input focus，`press` 先 flush buffered `type` 再以 `capture: none` 发送；新增 keyboard editing behavior smoke，覆盖普通文本走 `type_text` delta，Backspace/Delete/Enter/Tab/Arrow/Home/End/PageUp/PageDown/Escape 和 Meta/Control A/C/V/X 均走 BrowserHostSession `press`，且不进入聊天 composer、不触发系统键盘输入。补充 IME/clipboard/selection bounded policy：composition 事件声明 hidden-input buffer 到 compositionend、不落入聊天 composer；copy/paste/cut 只作为 BrowserHostSession-owned press intent，系统剪贴板读写为 `not-performed`，高风险 payload `blocked` / confirmation-required；selection range 只记录 refs/长度，不记录 raw selection/DOM。补充地址栏 focus -> 页面 host frame focus contract：地址栏输入、Meta/Control+A、Enter 只属于 address bar owner，重新点击页面后普通输入和快捷键回到 `BrowserHostSession` / hidden-input，聊天 composer 捕获字符和按键均为 0。真实 IME 候选窗、真实系统剪贴板 round-trip 与真实产品 selection range 仍未关闭。
  Evidence：`tests/smoke/smoke-browser-keyboard-editing-behavior.test.ts`、`.browser-workbench-host-keyboard-input[data-browser-host-keyboard-focus="active"]`、`browserWorkbenchKeyboardPressAction()`、`RightPaneBrowserHostAction.action='press'`、`focusContract.addressToPageSwitchCovered=true`、`focusContract.addressBar.owner='browser-address-bar'`、`focusContract.pageFocus.owner='BrowserHostSession'`、`imePolicy.realImeCandidateWindowVerified=false`、`clipboardPolicy.systemClipboardReadWrite='not-performed'`、`selectionRangePolicy.refsFirst=true`。
  验证命令：`npm run smoke:browser-keyboard-editing-behavior --silent`；`node --import tsx --test packages/presentation/components/browser-workbench/render.test.tsx src/ui/src/app/results/browserPaneHostAdapter.test.ts`。
  TODO：
  - 处理 IME、compositionupdate、paste、selection range。
  - 高风险 clipboard 写入走 confirmation；普通页面内粘贴/复制需要明确 owner 和审计。
  - [x] 地址栏 focus 与页面 focus 切换 deterministic contract。
  - 真实产品/OS 输入法与剪贴板 round-trip 需要 live dogfood evidence。

## P1：搜索与 browser_search

- [x] browser_search 与可见 Browser session 协同。
  验收：`browser_search` 返回 bounded summary、finalUrl、searchResultRef、screenshotRef、domSnapshotRef、axSnapshotRef、consoleLogRef、networkLogRef，同时可选择把同一个 BrowserHostSession 显示在右栏。
  状态（2026-06-02）：`browser_search` runtime 已保持 refs-first payload，并显式输出 `browserSessionRef` / `projectionRef`；search API 可选 `sessionId` 以复用当前 BrowserHostSession；runtime 会从当前 Browser-specific refs 提取 `sessionId`；visible-session handoff smoke 证明 manager 收到同一个 visible `browser-host-session:*`，projection object reference 声明 `preferredView=browser-workbench`，右栏 Browser 聚焦后 SSR 只渲染同一个 hostSession owner，不开第二 live surface。新增真实 SciForge UI dogfood，先用右栏 Browser pane 打开 `.test` fixture 并拿到 visible `BrowserHostSession`，再通过 message object reference 聚焦 `browser_search` projection；最终右栏复用同一个 live surface，projection focus 本身不新增 session start，且拒绝 iframe/proxy/webview/system popup/raw DOM/base64。补充 visible-session owner continuation contract：`browser_search` summary promise 未完成时，同一 visible `BrowserHostSession` 仍能接收 `type`；summary 返回后，搜索结果点击对应 `navigate` 和后续 `type` 继续使用同一 owner。真实搜索摘要的长期体感仍归入 performance lab / 卡点复测父项。
  Evidence：`tests/smoke/smoke-browser-search-visible-session-handoff.test.ts`、`tests/smoke/smoke-browser-search-visible-session-dogfood.test.ts`、`docs/test-artifacts/browser-search-visible-session-dogfood/manifest.json`、`browser-search-results-*.data.browserSessionRef`、`browser-host-projection-*.data.hostSession.id`、`BrowserHostSearchInput.sessionId`、`objectReferences[].preferredView=browser-workbench`、`data-browser-live-surface-ref="browser-host-session:*"`。
  验证命令：`npm run smoke:browser-search-visible-session-handoff --silent`；`npm run smoke:browser-search-visible-session-dogfood --silent`；`node --import tsx --test src/runtime/browser-host-session.test.ts src/runtime/browser-host-search-runtime.test.ts src/ui/src/app/results/browserPaneModel.test.ts src/ui/src/app/results/browserPaneHostAdapter.test.ts`。
  最终状态：visible BrowserHostSession reuse / focused projection / result-click navigation / nonblocking summary contract complete；后续体感优化归入 performance lab / bottleneck 项。
  TODO：
  - [x] 搜索结果点击后的页面 navigation 必须继续使用同一 owner。
  - [x] 搜索摘要生成不能阻塞用户继续浏览。

- [x] 搜索页面输入完成度验收。
  验收：在真实搜索框中输入长查询不丢字、不提前提交、不被聊天 composer 捕获。
  状态（2026-06-02）：deterministic 搜索输入 smoke 已覆盖长 query、中文/英文/符号混合输入、Backspace 删除重输、Enter 提交；新增真实 SciForge UI + Workspace Writer + `.test` fixture dogfood，只通过右栏 Browser pane 地址栏、visible BrowserHostSession host frame 和 hidden keyboard path 操作，覆盖长 mixed query、Backspace 删除重输、Enter 提交；输入经 `BrowserHostSession` / `browser-host-session` channel，`systemKeyboardEvents=not-sent`、`shellComposerCapturedCharacters=0`，bounded report 只记录长度/hash/refs/timing summary/inputChannel，不记录 raw DOM/base64。补充 failure-focused diagnostics：deterministic 与真实 dogfood manifest 都记录 focused element/hidden-input state、action timing summary、recent action types、fixture event trace 和 hash/length，不记录 raw query/DOM/base64/screenshot。真实搜索输入 dogfood passed；IME/clipboard/selection range 仍归入键盘编辑项。
  Evidence refs / selectors：`tests/smoke/smoke-browser-search-input-completion.test.ts`、`tests/smoke/smoke-browser-search-input-dogfood.test.ts`、`docs/test-artifacts/browser-search-input-dogfood/manifest.json`、`.browser-workbench-host-keyboard-input[data-browser-host-keyboard-input="true"]`、`BrowserHostComputerUseActionResult.inputChannel='browser-host-session'`、`failureFocusedDiagnostic.focusedElement.kind`、`failureFocusedDiagnostic.actionTrace.recentActionTypes`。
  验证命令：`npm run smoke:browser-search-input-dogfood --silent`；`node --import tsx --test tests/smoke/smoke-browser-search-input-completion.test.ts packages/presentation/components/browser-workbench/render.test.tsx src/ui/src/app/results/browserPaneHostAdapter.test.ts`；`npm run typecheck --silent`。
  最终状态：deterministic + product dogfood search input completion passed；failure diagnostics bounded；IME/clipboard/selection live evidence remains under keyboard editing item.
  TODO：
  - [x] 设计长 query、中文输入、英文输入、符号输入、删除重输的 fixture（deterministic BrowserHostSession searchbox smoke）。
  - [x] 记录 query 字符串与页面内实际 value 的一致性（测试内断言 raw value；bounded report 只输出长度/hash/match）。
  - [x] 失败时输出 action timing 和 focused element diagnostic。

## P1：Web Shell Transport

- [ ] Web shell frame-stream 只作为同一 owner transport，并做到低延迟。
  验收：Web shell 没有 native embedded surface 时，frame-stream 使用 binary/WebRTC/canvas 低延迟 transport；`/frame` HTTP route 只做 evidence/manual inspection。
  状态（2026-06-02）：Web shell `websocket-binary` frame-stream acceptance 已通过，`/frame` HTTP route 未作为 live path；frame-stream metadata 已输出 stream-local `frameStreamMetrics`，deterministic smoke 覆盖 busy/recent-input drop 聚合、bounded p95/drop summary 和 refs-only report；新增 input-priority frame-stream contract，覆盖 `mouse-move` / `scroll` / `type` 均走 `capture:none`，过期 frame capture 以 `recent-input` skip/drop 聚合，且断言截图 capture 排在输入之后、不阻塞热路径；canvas-binary renderer 已作为同 session frame-stream opt-in draw loop 接入。WebRTC transport candidate contract 覆盖 `webrtc-data-channel` 与 `webrtc-video-track` 两类 refs-first adapter、bounded p95/drop/backpressure metrics、single `BrowserHostSession` owner、input hot path capture none，并拒绝 inline SDP/raw payload、iframe/proxy/DOM capture/第二 viewer。真实 Chromium data-channel loopback smoke 通过，浏览器内建立 `RTCPeerConnection`，Node 侧只写 bounded metrics/report，本次实测 12/12 ACK、0 drop、无 inline SDP/raw ICE/raw frame/base64/DOM payload。WebRTC transport bridge contract 把 candidate/report 转成 product bridge manifest，覆盖 signaling refs、metrics refs、data-channel frame-ref messages、action channel 到 `BrowserHostSessionManager.act` 的集成点，并拒绝 inline SDP/ICE、raw frame payload、second viewer；同时写入真实 UI WebRTC stack 与真实 p95/drop/backpressure 长测 handoff 为 `blocked` / `benchmarkClaim=false`。完整 UI WebRTC live transport stack 与真实 p95/drop 长测仍未完成，父项保持未关闭。
  Evidence：`frameTransport=websocket-binary`、`frameStreamRef=browser-host-session:*`、`frameStreamMetrics.skippedBackpressure`、`src/runtime/browser-host-webrtc-transport-contract.ts`、`src/runtime/browser-host-webrtc-transport.ts`、`tests/smoke/smoke-browser-host-webrtc-transport-contract.test.ts`、`tests/smoke/smoke-browser-host-webrtc-loopback.test.ts`、`tests/smoke/smoke-browser-host-webrtc-transport-bridge.test.ts`、`docs/test-artifacts/browser-host-webrtc-loopback/manifest.json`、`docs/test-artifacts/browser-host-webrtc-transport-bridge/manifest.json`、`BROWSER_HOST_WEBRTC_TRANSPORT_CONTRACT_SCHEMA`。
  验证命令：`node --import tsx --test tests/smoke/right-pane-browser-acceptance.test.ts src/runtime/browser-host-session.test.ts tests/smoke/smoke-browser-host-session-frame-stream-backpressure-lab.test.ts`；`npm run smoke:browser-host-session-frame-stream-lab --silent`；`npm run smoke:browser-host-webrtc-transport-contract --silent`；`npm run smoke:browser-host-webrtc-loopback --silent`；`npm run smoke:browser-host-webrtc-transport-bridge --silent`。
  TODO：
  - 将 deterministic frame-stream 指标扩展为真实 p95/drop/backpressure 长测。
  - [x] mousemove/scroll/input 时跳过过期 frame capture，不把截图排在输入前。
  - 探索 WebRTC transport 与更低抖动 canvas decode path，避免反复创建 `blob:` object URL 造成 GC 抖动。

- [x] 明确 Web shell 与 desktop shell 的验收差异。
  验收：desktop 验收以 native embedded surface 为准；Web shell 验收以同 owner low-latency stream 为准；两者都不得出现第二真相源。
  完成（2026-06-02）：runbook 与 docs 明确 desktop `native-embedded`、web `host-stream` / `websocket-binary` 的验收差异；desktop live evidence tests 明确 preflight/contract 不能冒充 live pass；right-pane Browser acceptance 只声明 Web transport coverage。
  Evidence：[`docs/runbooks/browser-pane-dogfood-runbook.md`](docs/runbooks/browser-pane-dogfood-runbook.md)、`tests/smoke/smoke-desktop-live-acceptance-evidence.test.ts`、`tests/smoke/right-pane-browser-acceptance.test.ts`。
  验证命令：`npm run smoke:desktop-live-acceptance-evidence --silent`；`node --import tsx --test tests/smoke/right-pane-browser-acceptance.test.ts`。
  最终状态：documented / contract complete；desktop live dogfood remains separately open.
  TODO：
  - 分离 desktop acceptance 与 web acceptance。
  - 文档和测试命名避免把 Web frame-stream 描述成 desktop fallback。
  - CI 中不具备 native shell 时只声明 Web transport coverage，不冒充 desktop live pass。

## P2：性能实验与架构决策

- [ ] 评估 Electron `WebContentsView` 是否足够接近 Chrome/Edge。
  验收：给出真实操作延迟、CPU、内存、稳定性、输入完整性和长期会话表现；不足时提出替代 adapter 方案。
  状态（2026-06-02）：新增 refs-first comparison contract，列出 Electron `WebContentsView`、WebView2、WKWebView、standalone Chromium surface 候选维度、decision 字段和 single `BrowserHostSession` owner invariant；contract 进一步补齐 30 分钟 product long-session schema 与 `latency/cpu/memory/inputCompleteness/lifecycle/reconnect/secondTruthSource=false` 指标字段，positive/negative fixture 覆盖 raw payload、第二真相源、候选矩阵缺失、product metrics 缺失等拒绝条件；smoke 写出 bounded artifact，总结 4 个候选、`decision=undecided`、product long-session schema coverage 和 3 个 negative fixture rejection，且明确 `contract-only-no-real-benchmark`。新增 opt-in platform benchmark manifest smoke，默认只写 `status=blocked` / `benchmarkClaim=false` / `runner.status=not-run` 的 refs-first handoff artifact，并定义真实 runner 需要产出的 latency、cpu、memory、inputCompleteness、lifecycle、reconnect 字段；通过 `SCIFORGE_BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK=1` 作为未来真实 runner 接入口。真实平台 benchmark / CPU / memory / long-session comparison 尚未执行，父项保持未关闭。
  Evidence：`src/desktop/browser-native-adapter-comparison.ts`、`tests/smoke/smoke-browser-native-adapter-comparison.test.ts`、`tests/smoke/smoke-browser-native-adapter-platform-benchmark.test.ts`、`docs/test-artifacts/browser-native-adapter-comparison/manifest.json`、`docs/test-artifacts/browser-native-adapter-comparison/platform-benchmark-manifest.json`。
  验证命令：`npm run smoke:browser-native-adapter-comparison --silent`；`npm run smoke:browser-native-adapter-platform-benchmark --silent`；`npm run smoke:browser-host-session-long-session --silent`。
  TODO：
  - 对比 Electron `WebContentsView`、独立 Chromium surface、WebView2/WKWebView 的可行性。
  - 评估同 session ownership、refs 采集、input routing、security isolation、lifecycle 的实现成本。
  - 决策是否需要 platform-specific native sidecar。

- [x] 建立 Browser performance lab。
  验收：有一套本地 deterministic 页面和真实公网 smoke，能重复测量 navigation/input/scroll/drag/search。
  状态（2026-06-02 Worker E + follow-up）：本地 deterministic BrowserHostSession performance-lab smoke 使用内存 fixture driver 覆盖 navigation/type(input)/scroll/drag/search timing summary，并输出 bounded before/after manifest；本地 fixture coverage 进一步覆盖 contenteditable、iframe target、shadow DOM control、deterministic slow-network navigation 四类 capability matrix，均为 refs-first timing summary，不记录 raw DOM/base64/screenshot bytes，也不声称公网或真实长测。frame-stream metrics/backpressure lab 覆盖 bounded `websocket-binary` drop/skip summary 与 p95/drop summary；新增公网/可配置 URL smoke，从 `SCIFORGE_BROWSER_PUBLIC_SMOKE_URLS` 读取目标（默认 example.com + IANA 文档 URL），真实 BrowserHostSession 覆盖 open/navigate/type/scroll/search/frame-drop probe，公网或浏览器不可用时写 typed blocked/skipped evidence，不记录 raw DOM/base64/screenshot bytes；manifest 补充 bounded `finalStatus` guard，记录 requested/ready/blocked counts、search status、timing/drop refs 和 reason hash，禁止 raw payload。本次实测 2 个 URL ready，search passed，frame-drop probe 记录 recent-input skip；本地 deterministic manifest 明确 `publicNetworkUsed=false`、`realThirtyMinuteBenchmark=false`。
  Evidence：`tests/smoke/smoke-browser-host-session-performance-lab.test.ts`、`tests/smoke/smoke-browser-host-session-frame-stream-backpressure-lab.test.ts`、`tests/smoke/smoke-browser-host-session-public-performance-lab.test.ts`、`docs/test-artifacts/browser-host-session-performance-lab/manifest.json`、`docs/test-artifacts/browser-host-session-public-performance-lab/manifest.json`。
  验证命令：`npm run smoke:browser-host-session-performance-lab --silent`；`npm run smoke:browser-host-session-frame-stream-lab --silent`；`npm run smoke:browser-host-session-public-performance-lab --silent`。
  最终状态：local deterministic lab + public/configurable bounded smoke complete；真实 30 分钟 benchmark 与平台对比仍归入对应父项。
  TODO：
  - 本地 fixture：输入框、长列表、canvas/drag、contenteditable、iframe、shadow DOM、slow network。
  - [x] 公网 smoke：只记录 bounded timing 和最终状态，不依赖具体搜索结果排名。

- [ ] 长会话稳定性。
  验收：连续 30 分钟冲浪、多 tab、reload、back/forward、右栏 resize、workspace writer restart 后不丢 session 或给出明确恢复状态。
  状态（2026-06-02）：新增 deterministic BrowserHostSession long-session stability smoke，默认快速 loop 覆盖 `open -> navigate -> type -> scroll -> drag -> back -> forward -> reload -> close` 和 `reopen -> type -> close` 生命周期；支持 `SCIFORGE_BROWSER_LONG_SESSION_ITERATIONS=<n>` 与 `SCIFORGE_BROWSER_LONG_SESSION_MINUTES=30` 扩展为长测；bounded report 只记录 refs、bytes/hash、timing summary 和状态，不含 raw DOM/base64；resource guards 断言每个 driver 只注册一次 console/network listener、close 后拒绝继续输入、reopen 使用独立 driver 且全部关闭。补充 tab close deterministic contract：close 后 driver 释放、session 拒绝继续输入、surface detach 计数归零；补充 native-embedded session close contract，确认 native surface detach 且不依赖 host-stream object URL；补充 host-stream object URL resource guard，frame object URL create/revoke 计数一致、outstanding 为 0、report 不记录 `blob:` raw URL。新增真实 Web 右栏 Browser pane product long-session harness，默认 `quick-contract` 两轮启动 SciForge UI + Workspace Writer + `.test` fixture，只操作右栏 Browser pane，覆盖连续 navigation/type/scroll/drag/back/forward/reload、右栏 tab switch、workspace writer restart/reconnect；manifest 记录 refs、latency summary、memory-ish counts、single session/live surface continuity 和 typed retry/blocked，不记录 raw DOM/base64/screenshot，且 `defaultSmokeIsThirtyMinuteBenchmark=false`。实现上区分地址栏 draft 和 committed URL，避免 draft 输入触发多余 `BrowserHostSession` start；4-iteration 扩展 smoke 通过并保持单 session。harness 现在还会在 timeout/失败时写 `status=blocked` bounded manifest（phase、reasonHash、UI state、session refs、recent network samples），然后原样抛错，避免 30 分钟失败只留下 Playwright timeout。该 smoke 现在还接入 platform/product long-session comparison contract，明确 30 分钟真实 benchmark 所需指标字段并保持 `benchmarkClaim=false`，不冒充真实平台长测。真实 30 分钟产品右栏长会话已尝试但未通过，失败点为某轮 address-details 等待 ready timeout；父项保持未关闭。
  Evidence：`tests/smoke/smoke-browser-host-session-long-session-stability.test.ts`、`tests/smoke/smoke-browser-pane-product-long-session.test.ts`、`docs/test-artifacts/browser-pane-product-long-session/manifest.json`。
  验证命令：`npm run smoke:browser-host-session-long-session --silent`；`npm run smoke:browser-pane-product-long-session --silent`；`SCIFORGE_BROWSER_PRODUCT_LONG_SESSION_ITERATIONS=4 npm run smoke:browser-pane-product-long-session --silent`；`npm run smoke:browser-native-adapter-comparison --silent`。
  TODO：
  - 测试真实产品 memory growth、object URL revoke、surface detach leak。
  - writer/native adapter 重启后支持 reconnect 或明确 blocked/retry。
  - [x] tab close 必须释放 BrowserHostSession/native surface deterministic contract。

## 验证命令清单

文档改动只需：

```bash
git diff --check
```

Browser 代码或契约改动至少运行：

```bash
npm run typecheck --silent
git diff --check
npm run smoke:browser-loading-progress-lifecycle --silent
npm run smoke:browser-host-webrtc-transport-contract --silent
npm run smoke:browser-host-webrtc-loopback --silent
npm run smoke:browser-host-webrtc-transport-bridge --silent
npm run smoke:browser-host-session-public-performance-lab --silent
npm run smoke:native-extension-ownership --silent
node --import tsx --test src/runtime/browser-host-session.test.ts src/runtime/browser-host-search-runtime.test.ts
node --import tsx --test packages/observe/web/browser-runtime.test.ts packages/presentation/components/browser-workbench/render.test.tsx
node --import tsx --test src/ui/src/app/results/browserPaneModel.test.ts src/ui/src/app/results/resultPaneContract.test.ts src/ui/src/app/results/browserPaneHostAdapter.test.ts
node --import tsx --test src/ui/src/app/ResultsRenderer.test.ts --test-name-pattern "Browser pane|browser tool|URL object|focused refs|restores right pane tabs"
node --import tsx --test tests/smoke/right-pane-browser-acceptance.test.ts
```

Desktop native surface 改动还需要：

```bash
node --import tsx --test tests/smoke/smoke-desktop-electron-main.test.ts
npm run smoke:desktop-browser-native-paint-ack-heartbeat --silent
```

真实体验验收必须补充：

- 使用 SciForge 右侧 Browser pane 完成 dogfood run。
- 记录 transport、surface、latency、卡顿点、bounded refs、writer/native adapter health。
- 不记录 raw DOM、raw screenshot、base64、provider payload、secret 或一次性页面内容。
