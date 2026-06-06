# Computer Use Native GUI 与 Adapter 工作包

> **给并行 worker：** 必须按 `superpowers:subagent-driven-development` 或等价的逐任务执行方式推进。所有任务用 checkbox（`- [ ]` / `- [x]`）记录状态。

**目标：** 提供真实 Desktop/native action surface 和 GUI control projection，但不让 GUI 成为 executor 或 Agent Host。

**架构：** Desktop native host 拥有 capture 和安全 input adapters。Runtime 拥有 WindowActionSession 和 action evidence。GUI 只展示状态、actor cursor、evidence、confirmation、stop/takeover controls。

**技术栈：** Electron Desktop、BrowserHostSession、WindowActionSession、accessibility/PTY/editor/file-manager adapter contracts、React UI projection。

---

## 写域

只修改：

- `src/desktop/**`
- `src/runtime/browser-host-*.ts`
- `src/runtime/window-action-session.ts`
- `src/runtime/codex/agent-host-browser-computer-use-act-materializer*.ts`
- `src/runtime/codex/agent-host-window-action-computer-use-act-materializer*.ts`
- `src/ui/src/**` 中只负责 status、confirmation、stop/cancel/takeover、actor cursor 或 evidence refs 展示的文件
- 上述文件对应的 focused tests

不要修改：

- `packages/backend/**`
- Model Router/provider config
- `packages/actions/computer-use/live-acceptance-validator.ts`
- package bridge core，除非 runtime owner 暴露的类型需要协调

## 任务

### 1. BrowserHostSession live action

- [x] 使用 `src/runtime/browser-host-computer-use.ts` 作为 BrowserHostSession 低风险 L0 handler。
  - 证据：`src/runtime/browser-host-computer-use.test.ts` 的 `BrowserHostSession Computer Use L0 handler returns refs-first action evidence and freshness invalidation` 覆盖 `executeBrowserHostComputerUseAction`；`src/runtime/codex/agent-host-browser-computer-use-act-materializer.test.ts` 的 `executes a planned low-risk action through BrowserHostSession` 证明 Agent Host Act 使用该 handler。
- [x] 为 click/type/scroll/press 补齐 before evidence、grounding evidence、executor event、after evidence、verification refs 和 freshness invalidation。
  - 证据：`src/runtime/codex/agent-host-browser-computer-use-act-materializer.test.ts` 的 `returns complete action evidence refs for scroll, type, and click` 覆盖 scroll/type/click/press 的 before、after、verification、freshness invalidation、action-state refs；同文件 `fails closed when mutating action lacks after evidence`、`fails closed when mutating action lacks verifier or freshness invalidation evidence`、`ignores verifier and freshness refs from a previous action` 覆盖缺失和 stale completion evidence。
- [x] 确保普通聊天能通过 Guard -> Act 触发至少一个低风险可见 BrowserHostSession action，而不是只能走 slash route。
  - 证据：`src/runtime/codex/agent-host-browser-computer-use-act-materializer.test.ts` 的 `ordinary chat GUI intent routes Guard to a visible BrowserHostSession action through Act` 经 `evaluateCodexAgentHostTurnLoop` 执行可见 BrowserHostSession scroll，并断言不是 slash-route-only。
- [x] BrowserHostSession 缺失、stale、hidden、diagnostic-only、缺 permission 或缺 cancel path 时必须 blocked。
  - 证据：`src/runtime/browser-host-computer-use.test.ts` 的 `BrowserHostSession Computer Use readiness blocks missing unsafe live-action preconditions` 覆盖 missing/stale/hidden/diagnostic-only/permission/cancel；`src/runtime/codex/agent-host-browser-computer-use-act-materializer.test.ts` 覆盖 missing/stale/hidden/diagnostic-only live session before input。

### 2. Desktop native capture adapter

- [x] 实现 app window capture adapter，产出 windowRef、bounds、scale、screen id、window-local crop 和 fresh screenshot refs。
  - 证据：`src/desktop/annotation-window-capture-provider.test.ts` 的 `desktop annotation window capture metadata keeps fresh screenshot and window-local crop refs distinct` 覆盖 fresh screenshot/crop refs、windowRef、screenId、scale、windowLocalBounds；`src/desktop/window-capture.ts` 的 `windowActionSessionForCapturedSelection` 将 window capture 产物转换为 WindowActionSession evidence refs。
- [x] 任何 full-screen fallback 前，必须记录 target missing、occlusion、multi-window conflict 或 user-selected screen-region reason。
  - 证据：`src/desktop/window-capture.test.ts` 的 `desktop window capture blocks full-screen fallback unless a bounded reason is recorded` 覆盖未记录 reason 必须 blocked、记录 `occlusion` 才可继续；`src/desktop/window-capture.ts` 的 `normalizeFullScreenFallbackReason`/`fullScreenFallbackReasonMessage` 覆盖四类 bounded reason。
- [x] Screenshot/crop 必须 refs-first 且 bounded；raw/base64 screenshot 不能进入 chat 或 long-lived trace。
  - 证据：`src/desktop/window-capture.test.ts` 和 `src/desktop/annotation-window-capture-provider.test.ts` 均断言结果中不含 `data:image`/`base64`/原始 png bytes，且 capture metadata 使用 screenshotRef/cropRef。

### 3. Scoped input adapters

- [x] Accessibility/UIA/AT-SPI adapter 只提供 target hints、state snapshot 和 non-private action binding；不能绕过 action loop。
  - 证据：`src/runtime/window-action-session.test.ts` 的 `Accessibility scoped input adapter exposes only target hints, state snapshots, and non-private bindings` 断言 route evidence 和 `guiExecutable: false`，并通过 `dispatchWindowAction` 交给 Agent Host adapter。
- [x] Terminal/PTY adapter 记录 command intent、可见 terminal session refs、transcript refs、exit code 和 artifact refs；除非任务明确选择 terminal workflow，否则 shell-written artifact 不能伪装成 GUI artifact。
  - 证据：`src/runtime/window-action-session.test.ts` 的 `Terminal scoped input adapter records PTY evidence and blocks shell artifacts outside explicit terminal workflows` 覆盖 command intent、visible terminal、transcript、exit-code、artifact refs 和非 explicit terminal workflow blocked；`src/runtime/codex/agent-host-window-action-computer-use-act-materializer.test.ts` 覆盖 materializer 层同样的 blocked/allowed explicit workflow。
- [x] Editor/local document adapter 优先 app-native/editor extension 或 Accessibility；save action 必须有 input event 和 artifact validator。
  - 证据：`src/runtime/window-action-session.test.ts` 的 `Editor save actions require visible input event and artifact validator refs` 覆盖缺少 input-event/artifact-validator blocked、补齐后 completed；`src/runtime/codex/agent-host-window-action-computer-use-act-materializer.test.ts` 覆盖 materializer 层 editor save blocked。
- [x] File manager adapter 支持可见文件选择、重命名、移动和 directory evidence；destructive remote/delete 必须 hard-confirm。
  - 证据：`src/runtime/window-action-session.test.ts` 的 `File manager adapter requires visible selection and directory evidence, and remote deletes hard-confirm first` 覆盖 remote delete hard-confirm before handler、rename completed 且包含 visible-file-selection/directory-evidence refs。
- [x] Shared system input fallback 只允许 diagnostic 或 explicit handoff，不是默认 product pass。
  - 证据：`src/runtime/window-action-session.test.ts` 的 `Shared system input fallback is blocked by default and only runs for diagnostics or explicit handoff` 覆盖默认 blocked 和 diagnostic-only；`src/runtime/codex/agent-host-window-action-computer-use-act-materializer.test.ts` 的 `fails closed for shared system input routes` 覆盖 product/default Act 不接受 shared system input。

### 4. GUI projection 与 control plane

- [x] Composer 只提交自然语言、refs 和 Autonomy profile。
  - 证据：`src/ui/src/api/sciforgeToolsClient.policy.test.ts` 的 `normal composer submit exposes only intent text refs and Autonomy profile to Agent Host input` 断言 Agent Host input keys 仅包含 intentText、refs、authorization profile/scope/source 等，并过滤 native executor commands、selectedActionIds、selectedToolIds、windowActionHandoff 和 raw/base64/provider payload。
- [x] Hard-confirm surface 展示 action、target、impact、evidence refs、authorization profile、Confirm 和 Cancel。
  - 证据：`src/ui/src/app/chat/RuntimeGuiPanel.test.tsx` 的 `runtime gui hard-confirm renders required public fields and controls without raw commands` 覆盖 public fields、Confirm/Cancel，并过滤 raw command/private refs。
- [x] Computer Use control plane 只输出 confirmation/debug-equivalent text 或 control result；不执行动作。
  - 证据：`src/ui/src/app/chat/RuntimeGuiPanel.test.tsx` 的 `runtime gui choices keep Computer Use controls but reject executable native actions` 和 `src/ui/src/app/guiProtocol.test.ts` 的 `GuiProtocol ask_user filters native executable action commands while preserving control-plane commands` 只保留 stop/takeover/cancel 等 control-plane commands，过滤 click/type/browser-click 执行动作。
- [x] Image/Evidence pane 展示 annotation crop、before/after screenshot refs、artifact preview、action timeline 和 provenance。
  - 证据：`src/ui/src/app/results/imagePaneModel.test.ts` 的 `image pane model projects Computer Use evidence refs for crop before after artifact timeline and provenance` 覆盖 annotationRefs、before/after screenshot refs、artifactPreviewRef、actionTimelineRefs、provenanceRefs；`src/ui/src/app/results/rightPaneSurfaceAdapter.test.ts` 覆盖右 pane host 渲染这些 refs-first evidence groups。
- [x] Browser pane / WindowActionSession surface 展示 actor cursor、focus/lease 状态、stop 和 takeover。
  - 证据：`src/runtime/window-action-session.test.ts` 的 `GUI projection exposes only session status, actor cursor, confirmation, and stop/cancel controls` 覆盖 WindowActionSession GUI projection；`src/ui/src/api/sciforgeToolsClient/runtimeEvents.client.test.ts` 的 `Runtime Codex Computer Use host actions materialize user control plane as presentation-only slot` 覆盖 visible cursor refs、actorCursorCount、leaseStatus、stopRef、takeoverRef；`src/ui/src/app/ResultsRenderer.test.ts` Browser pane tests 覆盖 BrowserHostSession surface projection。
- [x] `gui.present` refs 不参与 action-ready 或 completion 判定。
  - 证据：`src/runtime/codex/agent-host-browser-computer-use-act-materializer.test.ts` 和 `src/runtime/codex/agent-host-window-action-computer-use-act-materializer.test.ts` 的 unsafe-ref sanitizer tests 均断言 `gui.present`/`ui:` refs 不进入 action/completion evidence。

## 验证命令

- [x] `node --import tsx --test src/desktop/browser-host-surface.test.ts src/runtime/browser-host-search-runtime.test.ts src/runtime/browser-host-session-search.test.ts`
  - 2026-06-06 验证：13 pass, 0 fail。
- [x] `node --import tsx --test src/runtime/codex/agent-host-browser-computer-use-act-materializer.test.ts src/runtime/codex/agent-host-window-action-computer-use-act-materializer.test.ts`
  - 2026-06-06 验证：35 pass, 0 fail。
- [x] `npm run smoke:desktop-computer-use-hard-confirm-product`
  - 2026-06-06 验证：exit 0；写入 `docs/test-artifacts/desktop-computer-use-hard-confirm-product/manifest.json`。非 strict 运行按设计只产出 diagnostic blocked manifest，`canClaimPass=false`，blockers 为 opt-in/real Electron product evidence missing；不声明 product pass。
- [x] `npm run smoke:desktop-computer-use-hard-confirm-product:strict`
  - 2026-06-06 验证：exit 0；`[passed] Desktop Computer Use hard-confirm product smoke`，`canClaimPass=true`，`blockers=none`。manifest 记录 `electron-product-runtime-codex-transport-run`，observed requirements 覆盖 Electron product shell、dynamic workspace writer、native host、runtime Codex SSE transport、guard/preflight surface 和 hard-confirm surface。
- [x] `npm run smoke:desktop-browser-native-live-acceptance:strict`
  - 2026-06-06 验证：exit 0；`[ok] desktop Browser native live acceptance passed`，写入 `docs/test-artifacts/desktop-browser-native-live-acceptance/manifest.json`。manifest 记录 `canClaimDesktopNativeLivePass=true`、`liveSurfaceTransport=native-embedded`、single interactive truth、typed token observed、M0 open/click/type/scroll/drag/reload/back/forward/stop 均 passed，且 action ack 不依赖 screenshot/frame stream。
- [x] `npm run typecheck --silent`
  - 2026-06-06 rerun passed after integration.

## 必须用户协助

- [x] Contract 和 projection 工作预计不需要用户协助。
- [x] 只有 macOS/Electron native 权限弹窗、真实登录态 Browser action、或真实高风险 Confirm 决策时，才必须用户协助。
  - 2026-06-06 验证：本轮 strict Desktop/native smoke 未遇到 permission、login 或 high-risk confirmation blocker；无需用户协助。
