# SciForge Browser Task Board

最后更新：2026-06-02

本文档维护 SciForge 右侧 Browser pane 的真实使用、流畅性和实时性任务。旧任务已清理：已完成内容移入“完成归档”，未完成内容重新整理为“活跃任务 / TODO”。

## 目标

- 右侧 Browser 必须像正常浏览器一样可连续冲浪：打开网页、搜索、点击、拖拽、滚动、输入、返回、前进、刷新和停止都应低延迟、可见、可预测。
- 必须真实使用 SciForge 自己的 Browser pane 做 dogfood 验证，不能只靠单元测试或外部浏览器判断体验。
- `BrowserHostSession` 是唯一 owner：导航、输入、state、refs、screenshot、DOM、AX、console、network、search refs 都归它。GUI / shell 只 attach surface、投递 input intent、展示 typed state。
- 产品 Browser pane 的唯一 live path 是同一个 `BrowserHostSession` owned `native-embedded` surface；Electron `WebContentsView` / WebView2 / WKWebView / 独立 Chromium surface 只是 display/input adapter。
- 不再保留产品级 fallback：缺 native attach 时显示 blocked / needs-human / handoff / retry，不切到 host-stream、canvas、WebRTC、HTTP `/frame`、snapshot、iframe、proxy、`<webview>` 或系统 popup。

## 不可变规则

- 所有修改必须通用，不能为当前页面、截图、URL、文件名、localhost、某个站点或历史 run 写硬编码补丁。
- 不允许 iframe、proxy、snapshot、旧 frame、host-stream、canvas、WebRTC、HTTP `/frame`、`<webview>`、系统 popup 或第二套 viewer 冒充 live browser。
- 只能有一个 live truth source：`BrowserHostSession` owner + `native-embedded` display/input adapter。旧 streaming transport 只能作为 evidence/diagnostic/migration audit，不能参与交互热路径。
- 输入热路径优先级最高：click/type/drag/scroll/cursor 不能被 screenshot、DOM、AX、console/network、search summary 或 state polling 阻塞。
- 大 payload、截图、DOM/AX、console/network logs 和 evidence 必须 refs-first；不得把 base64/raw DOM/raw logs 写入 GUI state 或任务文档。
- 真实 UI evidence 只能记录稳定 selector、latency、transport、refs 和脱敏 diagnostics。

## 基准指标

- Open 到首个可交互画面：普通外部站点目标 < 2s；慢站点要显示 loading/progress/diagnostic。
- 输入到页面可见：普通文本输入目标 < 50ms p95；长输入不丢字、不乱序。
- 滚轮/拖拽跟手：连续事件目标 60fps 体感，至少不出现明显队列堆积和秒级延迟。
- Cursor / caret：输入框内可见 caret；按钮/链接显示 pointer；普通区域 default；文本区域 text。
- Evidence 不抢热路径：snapshot/state/DOM/AX/log/search refs 可以滞后生成，但不能阻塞冲浪。

## 完成归档

以下能力已有 bounded evidence 和验证命令；后续不再作为活跃 TODO 重复跟踪。

- Browser dogfood runbook 与真实 Web shell 右栏三场景 dogfood smoke。
  Evidence：`docs/runbooks/browser-pane-dogfood-runbook.md`、`docs/test-artifacts/browser-pane-dogfood/manifest.json`。
  验证：`npm run smoke:browser-pane-dogfood --silent`。
- BrowserHostSession latency instrumentation 与 UI diagnostics。
  Evidence：`BrowserHostSessionState.lastActionTiming`、`BrowserHostSessionState.actionTimingSummary`、`.browser-workbench-viewer-diagnostics[data-browser-last-action]`、`data-browser-writer-url`、`data-browser-health-capability`、`data-browser-native-adapter-url`、`data-browser-last-action-timing`。
  验证：`node --import tsx --test src/runtime/browser-host-session.test.ts packages/presentation/components/browser-workbench/render.test.tsx src/ui/src/app/results/browserPaneHostAdapter.test.ts`。
- Desktop product path 使用 native embedded surface，且 strict live acceptance passed。
  Evidence：`docs/test-artifacts/desktop-browser-native-live-acceptance/manifest.json`、`liveSurfaceTransport=native-embedded`、`owner=BrowserHostSession`、`secondTruthSource=false`。
  验证：`npm run desktop:build --silent`；`npm run smoke:desktop-browser-native-live-acceptance --silent`；`npm run smoke:desktop-browser-native-live-acceptance:strict --silent`。
- 输入热路径 action stream / input channel / streamed drag contract。
  Evidence：`tests/smoke/smoke-browser-host-session-action-stream-contract.test.ts`、`RightPaneBrowserHostAction.actionId`、`sendBrowserHostSessionAction({...action})`。
  验证：`npm run smoke:browser-host-session-action-stream-contract --silent`；`node --import tsx --test src/runtime/browser-host-session.test.ts`。
- Heavy capture 已移出普通冲浪热路径。
  Evidence：`browserHostDefaultCaptureMode()`、`captureFrameIfIdle()`、`browser-host-session:*` refs。
  验证：`node --import tsx --test src/runtime/browser-host-session.test.ts src/ui/src/app/results/browserPaneHostAdapter.test.ts tests/smoke/right-pane-browser-acceptance.test.ts`。
- `browser_search` 与可见 Browser session 协同完成。
  Evidence：`tests/smoke/smoke-browser-search-visible-session-handoff.test.ts`、`tests/smoke/smoke-browser-search-visible-session-dogfood.test.ts`、`docs/test-artifacts/browser-search-visible-session-dogfood/manifest.json`。
  验证：`npm run smoke:browser-search-visible-session-handoff --silent`；`npm run smoke:browser-search-visible-session-dogfood --silent`。
- 搜索页面输入完成度验收完成。
  Evidence：`tests/smoke/smoke-browser-search-input-completion.test.ts`、`tests/smoke/smoke-browser-search-input-dogfood.test.ts`、`docs/test-artifacts/browser-search-input-dogfood/manifest.json`。
  验证：`npm run smoke:browser-search-input-dogfood --silent`。
- Browser performance lab 建立完成。
  Evidence：`tests/smoke/smoke-browser-host-session-performance-lab.test.ts`、`tests/smoke/smoke-browser-host-session-public-performance-lab.test.ts`、`docs/test-artifacts/browser-host-session-performance-lab/manifest.json`、`docs/test-artifacts/browser-host-session-public-performance-lab/manifest.json`。
  验证：`npm run smoke:browser-host-session-performance-lab --silent`；`npm run smoke:browser-host-session-public-performance-lab --silent`。
- Web shell / desktop shell 验收差异已明确；后续不再把 Web shell frame-stream/canvas 当产品 live fallback。
  Evidence：`docs/runbooks/browser-pane-dogfood-runbook.md`、`tests/smoke/right-pane-browser-acceptance.test.ts`。
- Deterministic mouse / keyboard / cursor contracts 已覆盖基础能力。
  Evidence：`tests/smoke/smoke-browser-mouse-gesture-completeness.test.ts`、`tests/smoke/smoke-browser-keyboard-editing-behavior.test.ts`、`tests/smoke/smoke-browser-cursor-caret-parity.test.ts`。
- Native adapter comparison 与 platform benchmark handoff contract 已建立，但真实 benchmark 未执行。
  Evidence：`tests/smoke/smoke-browser-native-adapter-comparison.test.ts`、`tests/smoke/smoke-browser-native-adapter-platform-benchmark.test.ts`、`docs/test-artifacts/browser-native-adapter-comparison/manifest.json`、`docs/test-artifacts/browser-native-adapter-comparison/platform-benchmark-manifest.json`。

## 活跃任务 / TODO

### P0. 真实卡点复测与排序

验收：给出当前最大瓶颈排序，并用真实 SciForge Browser pane 操作证据支撑；不能只给架构猜测。

当前状态：`tests/smoke/smoke-browser-pane-bottleneck-audit.test.ts` 已扩展真实右栏产品路径 representative fixture，覆盖连续输入、caret/selection hash、slider drag、文本选择、长页滚动、tab switch return、resize/reload surface continuity，并写出 bounded manifest。2026-06-02 最新本地排序为 `surface-attach > navigation > input-routing > react-rerender > state-polling > frame-capture`；该排序来自旧 host-stream/canvas 产品路径，可作为迁移前基线，但不能再作为 native-only pass。dogfood 与 bottleneck manifests 都写入 `targetEvidence`，明确当前 evidence 是 `resolver-fixture` 右栏产品路径合约，`realExternalSiteClaim=false`、`hardcodedSitePassClaim=false`、`rawUrlCaptured=false`，不能冒充真实外网站点通过。2026-06-02 新增独立 opt-in real external dogfood smoke：`SCIFORGE_BROWSER_PANE_REAL_EXTERNAL_TARGET_JSON` 配置真实公开 URL，只记录 URL length/hash、BrowserHostSession refs、legacy fallback/refusal counts 与 action timing；本地对 `https://example.com/` 的 open/live-frame/scroll/reload 证据只能作为 legacy baseline。native-only 收口后必须重跑并要求 `liveSurfaceTransport=native-embedded`、`secondTruthSource=false`、缺 native attach 时 blocked。

新增防伪闭环：`tests/smoke/smoke-browser-bounded-evidence-crosscheck.test.ts` 读取 dogfood、real external dogfood、bottleneck、product long-session、mouse gesture、input-fidelity、WebRTC bridge、native platform benchmark bounded manifests，交叉校验 owner/session refs、selection hash/length、drag low-level route、latency p95/max、native surface evidence 与 second-truth refusal；同时拒绝 dogfood/bottleneck fixture target 冒充真实外网或站点硬编码 pass、拒绝 real external dogfood 记录 raw URL/DOM/text 或在缺同源 BrowserHostSession refs、reload continuity、native surface evidence 时 claim pass。crosscheck 还拒绝 mouse gesture 在新 tab owner contract 缺失或 OS UI audit refs 拆到不同 `BrowserHostSession` run 时 claim pass、拒绝 right click 冒充系统 popup/第二 viewer、拒绝 input-fidelity 在缺真实 OS UI / IME / clipboard / selection proof 或 proof/action/composer refs 不同源时 claim pass、拒绝 WebRTC candidate/loopback/HTTP `/frame`/second truth 冒充 fully passed live stack、拒绝 native platform benchmark 在缺真实 adapter result 或缺具体 adapter proof refs 时 claim pass。long-session crosscheck 还要求 bounded loading-progress trace 证明 UI loading/ready 与 host network-quiet 链路，并拒绝显式 30 分钟请求在 duration 不足时 claim pass。不启动 30 分钟环境，也不把 quick-contract evidence 冒充 30 分钟 pass。

TODO：

- 用公开搜索页配置 expected final URL digest，复测连续输入、Backspace/retype、Enter submit 后 URL digest、同 session/live surface continuity；DOM 输入值、搜索结果语义和像素级 caret 仍不能从当前 route-only evidence claim。
- 在真实外网/更长时间场景复测长页面连续滚动、拖动滑块、按住鼠标拖拽选择等事件完整性。
- 继续复测 tab 切换、native surface detach/minimize/restore 后是否仍 attach 正确。
- 输出新的 bounded bottleneck manifest，只记录 latency、count、hash、refs、transport、surface type、writer/native adapter health。

验证建议：

```bash
npm run smoke:browser-pane-bottleneck-audit --silent
npm run smoke:browser-pane-real-external-dogfood --silent
npm run smoke:browser-bounded-evidence-crosscheck --silent
node --import tsx --test src/ui/src/app/results/browserPaneHostAdapter.test.ts src/ui/src/app/results/browserPaneModel.test.ts
```

### P0. Native Embedded Single Truth 收口

验收：Browser pane 的产品 live surface 只剩 `native-embedded`；外部 HTTP/HTTPS 页面无法 attach native surface 时显示 typed blocked/handoff/retry，不出现 host-stream/canvas/WebRTC/HTTP `/frame`/snapshot/iframe/proxy/`<webview>`/system popup 交互兜底。

当前状态：设计决策已收口到 `BrowserHostSession` owner + native display/input adapter。桌面 Electron `WebContentsView` strict live acceptance 已有；Web 壳和部分 presentation/UI contract 仍存在 frame-stream/canvas/WebRTC 作为历史 live transport 的测试、渲染和诊断路径，必须迁移成 non-interactive evidence/diagnostic 或删除。2026-06-02 最新用户反馈表明 canvas/host-stream 交互链路点击延迟不可接受，不能继续作为产品 fallback 优化。

TODO：

- Browser Workbench 只渲染 `native-embedded` live surface；host-stream/canvas/WebRTC/HTTP `/frame` 只能显示 evidence/diagnostic refs 或 typed blocked state。
- Workspace Writer preflight ready 条件增加 native surface attach/health 能力；仅有 `frame` / `frame-stream` 的 writer 判为 stale/blocked。
- 右侧 Browser pane native attach 失败时统一显示 blocked/handoff/retry，不自动打开 snapshot、旧 frame、system popup 或 Web shell stream。
- 删除或迁移 `frameRenderer=canvas-binary`、WebRTC candidate live rendering、host-stream input path 等产品交互分支；保留必要 bounded tests 证明它们不能作为 live truth。
- 更新 dogfood / acceptance / crosscheck manifests：pass 只能来自 `liveSurfaceTransport=native-embedded`、`singleInteractiveTruth=true`、`secondTruthSource=false`，Web shell 缺 native attach 只能 claim blocked。
- 明确 implementation migration order：先 fail-closed gate，再删除渲染分支，再删旧 smoke/pass claim，最后清理 runtime transport optional capability。

验证建议：

```bash
npm run smoke:desktop-browser-native-live-acceptance --silent
npm run smoke:desktop-browser-native-live-acceptance:strict --silent
npm run smoke:browser-bounded-evidence-crosscheck --silent
node --import tsx --test packages/presentation/components/browser-workbench/render.test.tsx src/ui/src/app/results/browserPaneHostAdapter.test.ts src/ui/src/app/results/browserPaneModel.test.ts
```

### P0. Native Surface Paint / ACK 机制收口

验收：用户动作后 live surface 更新不依赖 PNG screenshot；state/refs 可以异步追上；失败显示 blocked/retry，不切到 snapshot 第二画面。

当前状态：`paintAckSource` 已区分 `native-adapter-action-state`、`host-stream-frame`、`none`；native paint ACK heartbeat smoke 与 desktop strict acceptance 已通过。30 分钟 native heartbeat 长测仍归入长会话任务。

TODO：

- 为 Electron `WebContentsView` 路径记录 action 后是否需要显式 paint ack。
- 若 shell 无 paint ack API，继续强化 lightweight heartbeat：URL/title/loading/canGoBack/canGoForward 与 action completion 分离。
- 失败态统一使用 bounded blocked/retry，不切到 snapshot 第二画面。
- 将 native paint ACK 纳入 30 分钟产品长会话证据。

验证建议：

```bash
npm run smoke:desktop-browser-native-paint-ack-heartbeat --silent
npm run smoke:desktop-browser-native-live-acceptance --silent
npm run smoke:desktop-browser-native-live-acceptance:strict --silent
```

### P0. React Rerender / Surface Stability

验收：地址栏输入、tab 状态、refs 更新、diagnostic 展开不会导致 native surface detach/remount 或焦点丢失。

当前状态：已有 surface rerender stability smoke 和 tab-focus retention smoke；tab-focus smoke 已验证返回 Browser tab 后 hidden keyboard input 恢复、同一 `BrowserHostSession` / live surface refs 保持一致，且等待条件只接受 host-owned surface URL evidence，不用地址栏草稿冒充 pass。更复杂的多 tab/native detach 长测仍未覆盖。

TODO：

- 对 Browser pane topbar 状态更新做局部化，避免整个 right pane 频繁重渲染。
- 真实多 tab / native detach / resize / minimize / restore 场景下复测同一 `liveSurfaceRef` 与 hidden keyboard focus。
- diagnostic 展开、refs 更新、loading 状态变化不得导致 surface remount。

验证建议：

```bash
npm run smoke:browser-pane-surface-rerender-stability --silent
npm run smoke:browser-pane-tab-focus-retention --silent
node --import tsx --test packages/presentation/components/browser-workbench/render.test.tsx src/ui/src/app/results/browserPaneHostAdapter.test.ts
```

### P0. Loading / Progress 真实状态机

验收：慢网页不是“静止旧画面”或“假 ready”；用户能看到 loading、stalled、blocked、retry、handoff；重定向后地址栏/current/final URL 不滞后。

当前状态：BrowserHostSession 已写入 bounded `loadingProgress`：发起时 `navigation-start`，可记录 `navigation-committed`、`interactive`、`load`、`network-quiet`、`stalled`，失败时 `blocked/host-error`；`stop` 会在 driver ACK 前先写入 bounded `stalled` / `host-action-timing` / `action=stop` 控制状态，ACK 后再进入 `network-quiet`。UI lifecycle projection 已新增 requested/current/final URL 的 bounded length/hash evidence，并会消费 host `loadingProgress.urls.{requested,current,final}` 的 `{length, sha1}`，避免 redirect/final URL digest 只能靠 raw URL 推导；explicit `blocked/host-error` lifecycle 优先驱动外层 projection，不落成假 ready/snapshot。product long-session manifest 的 loading-progress trace 也汇总 requested/current/final URL digest evidence，crosscheck 会拒绝缺 requested/current URL digest 的 long-session pass。UI trace 与 product long-session manifest 已记录 `idle->loading`、`loading->ready`；真实外部/原生浏览器事件覆盖仍需继续产品验证。

TODO：

- 接入可验证的 `navigation-committed`、DOMContentLoaded/interactive、load、network quiet 事件；没有真实信号时只能写 typed blocked/handoff，不伪造。
- stop/reload/back/forward 操作必须立即反映在地址栏和 loading 控件。
- 记录 requested/current/final URL 的 bounded hash/length，避免重定向导致地址栏滞后。
- 慢网页和失败网页需要明确 stalled/blocked/retry/handoff 状态。

验证建议：

```bash
npm run smoke:browser-loading-progress-lifecycle --silent
npm run smoke:browser-pane-product-long-session --silent
node --import tsx --test src/runtime/browser-host-session.test.ts src/ui/src/app/results/browserPaneModel.test.ts src/ui/src/app/results/browserPaneHostAdapter.test.ts
```

### P1. Cursor / Pointer / Caret 真实产品 Parity

验收：输入框 text cursor/caret 可见；按钮链接 pointer；可拖动元素、文本选择、普通区域符合浏览器行为。

当前状态：deterministic cursor/caret parity smoke 已覆盖 pointer/text/default、mouseleave/mouseenter、window blur/focus restore bounded contract。真实 OS window-manager focus signal 仍是 typed blocked policy。

TODO：

- 用产品 UI 或 native shell evidence 验证真实 OS 窗口失焦/恢复后的 cursor/caret/focus。
- 验证真实页面文本选择 caret、input caret、contenteditable caret 的可见性。
- 与 IME/clipboard/selection range 的真实证据一起收口。

验证建议：

```bash
npm run smoke:browser-cursor-caret-parity --silent
```

### P1. 鼠标操作真实 Fidelity

验收：left/right/middle click、double click、context menu、mouse down/up、continuous move、drag/drop、文本选择、滚轮/横向滚轮、滚动条拖动都走 BrowserHostSession 且可预测。

当前状态：deterministic smoke 已覆盖基础 mouse gestures、drag/drop path、文本选择 path、页面滚动条 thumb drag；middle/modifier click 新 tab 当前是 typed bounded blocked policy。`smoke-browser-mouse-gesture-completeness` manifest 现在包含 `productAcceptance` blocked/pass-proof gate：deterministic fixture 不能 claim 真实产品 mouse fidelity pass；除非真实 OS UI audit proofs 覆盖 window focus、right-click context menu owner、middle-click tab owner/handoff、selection range、scrollbar thumb、shell composer not-targeted，且 audit proofs / composer audit refs 全部归同一个 `BrowserHostSession` OS UI run 前缀，否则保持 blocked、refs-first、无 raw selection/context menu/tab payload。crosscheck 已读取该 manifest 并拒绝 forged pass。

TODO：

- 为真实产品滑块拖动和复杂页面 drag/drop 建立 product acceptance fixture。
- right click 应生成浏览器上下文行为或 typed blocked policy，不能被页面外层吞掉。
- middle click / modifier click 的新 tab 行为需要明确：BrowserHostSession tab owner 还是 handoff。
- 真实文本选择和页面滚动条拖动需要 product dogfood evidence。

验证建议：

```bash
npm run smoke:browser-mouse-gesture-completeness --silent
node --import tsx --test src/runtime/browser-host-session.test.ts
```

### P1. 键盘 / IME / Clipboard / Selection 真实行为

验收：连续输入、Backspace/Delete、Enter、Tab、方向键、Home/End、PageUp/PageDown、Ctrl/Cmd+A/C/V/X、Escape 可用，且不进入聊天输入框；IME、clipboard、selection range 有明确 owner 与审计。

当前状态：deterministic keyboard editing smoke 已覆盖常见编辑键、地址栏 focus -> 页面 focus 切换、hidden-input route、composer 捕获为 0。`tests/smoke/smoke-browser-input-fidelity-product-acceptance-contract.test.ts` 会写出 bounded blocked manifest，并要求真实 OS UI run、IME composition/candidate、clipboard round-trip、selection range refs/hash/length、`composerAudit`、OS UI audit proofs 同时存在才允许 product input-fidelity pass；`composerAudit` 必须证明 shell composer captured characters/actions 都为 0，且浏览器输入 refs、capability product action refs、IME/clipboard/selection detail refs、audit proof refs 都归同一个 `BrowserHostSession` OS UI run 前缀。OS UI audit proofs 必须覆盖 window focus owner、IME candidate window owner、system clipboard owner、selection range owner，且全部 refs-first、无 raw payload、shell composer `not-targeted`。crosscheck 已接入该 manifest 并拒绝 forged pass。真实 IME 候选窗、真实系统剪贴板 round-trip、真实产品 selection range 仍未验证。

TODO：

- 验证真实 IME candidate window / compositionupdate / compositionend 行为。
- 高风险 clipboard 写入走 confirmation；普通页面内粘贴/复制需要明确 owner 和审计。
- 验证真实系统 clipboard round-trip，manifest 不记录 raw clipboard payload。
- 验证真实产品 selection range，只记录 refs/长度/hash，不记录 raw selection/DOM。

验证建议：

```bash
npm run smoke:browser-input-fidelity-product-acceptance-contract --silent
npm run smoke:browser-bounded-evidence-crosscheck --silent
npm run smoke:browser-keyboard-editing-behavior --silent
node --import tsx --test packages/presentation/components/browser-workbench/render.test.tsx src/ui/src/app/results/browserPaneHostAdapter.test.ts
```

### P1. Legacy Host-Stream / WebRTC Live Path Removal

验收：host-stream、frame-stream、canvas-binary、WebRTC candidate/loopback/bridge 和 HTTP `/frame` 不能作为 Browser pane 产品 live surface，也不能在 native attach 失败时 fallback；它们只允许作为 refs-first evidence、diagnostic、manual inspection 或 migration audit。

当前状态：`websocket-binary` frame-stream、canvas-binary opt-in、WebRTC candidate/loopback/bridge contracts 已有，但它们现在是 legacy live-path evidence，不再是未来产品路线。presentation/UI 已经有多处拒绝 second truth 的 guard；下一步要把“candidate-only live transport”语义进一步降级为 non-interactive evidence/diagnostic，并删除 Browser Workbench 对 canvas/WebRTC 的交互渲染。2026-06-02 用户反馈确认 host-stream/canvas 点击延迟不能达到正常浏览器手感，继续优化该路径会和 native-only 目标冲突。

TODO：

- 删除 Browser Workbench 的 canvas-binary / WebRTC live page 渲染分支，或改成只读 evidence viewer。
- Workspace Writer `/health` 中的 `frame-stream` 不再作为 Browser pane ready 条件；只作为 optional diagnostic capability。
- 更新 WebRTC loopback/bridge smoke：只能证明 transport feasibility 或 legacy path refusal，不能 claim right-pane UI live pass。
- crosscheck 继续拒绝 candidate、loopback、HTTP `/frame`、跨 session refs、second truth 或 fallback path 伪造 pass。
- 删除 object URL lifecycle / decode p95 作为产品 live 指标的必跑项；保留 bounded artifact 仅用于证明旧路径未被使用。

验证建议：

```bash
npm run smoke:browser-bounded-evidence-crosscheck --silent
node --import tsx --test packages/presentation/components/browser-workbench/render.test.tsx src/ui/src/app/results/browserPaneHostAdapter.test.ts
```

仅在触碰旧 transport 代码时运行的 legacy regression 命令：

```bash
npm run smoke:browser-host-session-frame-stream-lab --silent
npm run smoke:browser-host-webrtc-loopback --silent
npm run smoke:browser-host-webrtc-transport-bridge --silent
node --import tsx --test packages/presentation/components/browser-workbench/render.test.tsx src/ui/src/app/results/browserPaneHostAdapter.test.ts
```

### P2. Native Adapter Platform Benchmark

验收：给出 Electron `WebContentsView`、独立 Chromium surface、WebView2、WKWebView 的真实操作延迟、CPU、内存、稳定性、输入完整性和长期会话表现；不足时提出替代 adapter 方案。

当前状态：comparison contract、opt-in platform benchmark manifest 与 runner result schema 已建立；默认 result 为 `status=blocked` / `benchmarkClaim=false` / `runner.status=not-run`，opt-in 缺失/无效 adapter command 会写出 bounded `blocked`/`failed` result 且 `benchmarkClaim=false`。comparison manifest 与 runner 都强制 candidate canonical platform（例如 WebView2 只能是 `windows`、WKWebView 只能是 `macos`），防止把 unsupported 平台漂移成 `cross-platform` 后绕过 blocked gate。外部 adapter 只有同时提供 `adapterRun.resultKind=real-native-adapter-run`、`realAdapterResult=true`、同源 BrowserHostSession/live surface refs、candidate-scoped `native-adapter-surface` / `action-trace` / `platform-summary` adapter proof refs、`secondTruthSource=false`、`rawPayloadsCaptured=false`，并为每个 required metric section 提供 candidate-scoped result refs 与 typed bounded aggregate summary keys 时才允许 candidate / run claim benchmark pass；runner result 保留 bounded `adapterProofRefs`，用于审计 blocked/invalid 与 real proof。runner/result manifest 同时记录 current process platform、per-candidate command env、`supportedOnCurrentPlatform`、real proof refusal policy（unsupported/missing command/schema fixture blocked、failed command failed、partial platform results 不通过、必须 every candidate real result）。passed metric refs 也必须是该 candidate/section 的真实 `benchmark-result:<candidate>:<section>:` ref，不能是 fixture、partial、schema-only、schema-validation-only 或 no-real-native-adapter ref。crosscheck 使用同一套 proof/refusal gate。fixture/schema-validation-only、platform drift、缺 metric summary 或 wrong-type summary result 保持 blocked/failed，不会被当作真实 benchmark。2026-06-02 新增 Electron `WebContentsView` external result command：`browser-native-adapter:electron-web-contents-view:external-result` 可读取/触发 desktop native live acceptance，将 production Electron `native-embedded` live pass 映射为 runner 可消费的 `real-native-adapter-run` proof refs；runner 现在会把自定义 env 传给 adapter command，并能区分“Electron 已有真实 adapter proof”与“required metric sections 尚未完成”。该 handoff 当前仍输出/归一化为 `status=blocked` / `benchmarkClaim=false`，不会把单个 Electron proof 冒充完整 platform benchmark。

TODO：

- 接入 `SCIFORGE_BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK=1` 下各平台真实 adapter command/result。
- 为 Electron `WebContentsView` 补齐 latency/cpu/memory/inputCompleteness/lifecycle/reconnect required metric sections；当前只有真实 native live adapter proof refs，不足以 claim candidate benchmark pass。
- 为独立 Chromium surface、WebView2、WKWebView 输出真实 `real-native-adapter-run` bounded proof refs；缺任一平台真实 result 时整个 benchmark 仍保持 blocked。
- 对比 Electron `WebContentsView`、独立 Chromium surface、WebView2、WKWebView。
- 评估同 session ownership、refs 采集、input routing、security isolation、lifecycle 的实现成本。
- 决策是否需要 platform-specific native sidecar。

验证建议：

```bash
npm run smoke:browser-native-adapter-comparison --silent
npm run smoke:browser-native-adapter-platform-benchmark --silent
SCIFORGE_BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK=1 SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_WEB_CONTENTS_VIEW_COMMAND="$(pwd)/node_modules/.bin/tsx" SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_WEB_CONTENTS_VIEW_ARGS_JSON='["tools/browser-native-adapter-electron-web-contents-view-external-result.ts"]' npm run browser-native-adapter-platform-benchmark:runner --silent
```

### P2. 30 分钟产品长会话稳定性

验收：连续 30 分钟冲浪、多 tab、reload、back/forward、右栏 resize、workspace writer restart 后不丢 session；否则给出明确恢复状态。

当前状态：deterministic long-session smoke 已覆盖 quick loop、close/reopen、tab close resource guard、native surface close、object URL revoke/surface detach guard。真实 Web 右栏 product long-session 默认 quick smoke 与一次 30 分钟 run 已写出 bounded artifact，但其中 `frame-stream frames` 属于 legacy baseline；native-only 收口后必须重跑并只允许 `native-embedded` claim pass。artifact 已裁剪为 refs-first bounded summary（约 51KB），只保留 recent recovery/network samples 与 `outcomeCount`，crosscheck 通过；不再把 30 分钟每轮细节写成 unbounded manifest。本轮修复了两个真实卡点：非导航 `interactive/load` heartbeat 不再把 ready session 卡成 loading；wheel/scroll 会把 frame 内坐标透传到同一个 `BrowserHostSession`，host 在滚动前定位虚拟鼠标，避免滚轮落在错误目标。cleanup 受 bounded timeout 保护，避免证据写入后卡在 open server/browser handles。address-details 阶段已加入 bounded retry/recovery：首次等待失败会执行 typed reload ACK + retry-open-url，并记录 `not-needed/succeeded/blocked` outcome、initial failure hash、reload ACK 状态、retry reason hash、session/live/frame refs、host/loading 状态。product long-session manifest 还记录 bounded loading-progress trace 与 requested/current/final URL digest evidence；runner contract 要求 quick artifact 不能 claim 30 分钟，requested minutes artifact 必须在 `verificationCommand` 带对应 env，且 `requestedMinutes>=30` / `status=passed` 必须证明 `durationMs >= requestedMinutes*60_000`，duration 不足只能保持 blocked。crosscheck 要求 UI loading->ready、ready/network-quiet completion、requested/current URL digest evidence，且显式 30 分钟请求必须有足额 duration 才能 claim。一次复测曾暴露 tab switch 后 BrowserHostSession continuity flake，现已新增 `browser-host-session-continuity-break` blocked 分类；cleanup timeout 单独归为 `product-long-session-cleanup-blocked`，不混成 product continuity flake。该 30 分钟产品长会话通过不等同于 native adapter platform benchmark 或 native-only live acceptance。

TODO：

- 定期复跑 30 分钟产品长会话，确认 address-details retry/recovery、writer restart reconnect、tab switch continuity 没有回归。
- 继续观察真实产品 memory growth、object URL revoke、surface detach leak，并保持 artifact bounded。
- 扩展多 tab close / reopen / resize / reload / back-forward 的更复杂真实产品长测 evidence。
- 30 分钟 run 不得声称 native adapter benchmark 或 native-only live acceptance pass，除非对应独立 benchmark/live acceptance evidence 真实完成并有 bounded manifest。

验证建议：

```bash
npm run smoke:browser-host-session-long-session --silent
npm run smoke:browser-pane-product-long-session --silent
SCIFORGE_BROWSER_PRODUCT_LONG_SESSION_ITERATIONS=4 npm run smoke:browser-pane-product-long-session --silent
SCIFORGE_BROWSER_PRODUCT_LONG_SESSION_MINUTES=30 npm run smoke:browser-pane-product-long-session --silent
```

### P2. Runtime Codex Browser Acceptance Route

验收：Runtime Codex workspace server route 可用于 Browser acceptance；blocked evidence 不再因为 route 缺失而停在 runtime config。

当前状态：workspace server 已显式暴露并校验 Runtime Codex stream route；workspace manifest reader 现在 fail-closed 校验真实 schema `sciforge.runtime-codex.browser-acceptance.v1`、source `codex-in-app-browser` 与 known status（`passed`/`blocked`/`failed`/`partial`），避免坏 manifest 被 workspace API 当成 ok 暴露。browser acceptance smoke 每次都会重写 current-env provider preflight，不再复用 stale provider preflight artifact；最新本地 evidence 中 browser manifest `observedAt` 与 provider preflight `checkedAt` 同一秒。`npm run smoke:runtime-codex-browser-acceptance --silent` 不再停在 route 缺失，而是生成 bounded blocked evidence，当前 blocker 为 Runtime Codex service env 缺少 release-acceptance 所需的 `SCIFORGE_RUNTIME_API_KEY`，同时缺少 `SCIFORGE_PROXY_UPSTREAM_BASE_URL` 或等价 runtime proxy upstream config（config-file secret fallback 只作 diagnostic）。当前 blocked 不作为 Browser pane live pass。

TODO：

- 保持 Runtime Codex workspace server stream route 与 runtime server/UI route 一致，防止 route drift。
- blocked manifest 保持 bounded，不记录 raw DOM/base64/provider payload。
- service env 配齐后重新跑 Runtime Codex browser acceptance，不冒充右栏 Browser live pass。

验证建议：

```bash
npm run smoke:runtime-codex-browser-acceptance --silent
```

## 默认验证命令

文档改动只需：

```bash
git diff --check
```

Browser 代码或契约改动至少运行：

```bash
npm run typecheck --silent
git diff --check
node --import tsx --test src/runtime/browser-host-session.test.ts src/runtime/browser-host-search-runtime.test.ts
node --import tsx --test packages/presentation/components/browser-workbench/render.test.tsx src/ui/src/app/results/browserPaneModel.test.ts src/ui/src/app/results/browserPaneHostAdapter.test.ts
npm run smoke:browser-loading-progress-lifecycle --silent
npm run smoke:browser-host-session-action-stream-contract --silent
npm run smoke:desktop-browser-native-live-acceptance --silent
npm run smoke:desktop-browser-native-live-acceptance:strict --silent
npm run smoke:browser-bounded-evidence-crosscheck --silent
npm run smoke:browser-pane-product-long-session --silent
```

Desktop native surface 改动还需要：

```bash
node --import tsx --test tests/smoke/smoke-desktop-electron-main.test.ts
npm run smoke:desktop-browser-native-paint-ack-heartbeat --silent
npm run smoke:desktop-browser-native-live-acceptance --silent
```

真实体验验收必须补充：

- 使用 SciForge 右侧 Browser pane 完成 dogfood run。
- 记录 transport、surface、latency、卡顿点、bounded refs、writer/native adapter health。
- 不记录 raw DOM、raw screenshot、base64、provider payload、secret 或一次性页面内容。
