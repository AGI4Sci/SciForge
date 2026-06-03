# SciForge Desktop Native Host 项目协议

最后更新：2026-06-03

## 当前目标

Desktop Electron native host 是 M1 真实产品能力的承载层。它负责把 Web dev UI 做不到的能力接入 SciForge：

- Browser Pane 的 `WebContentsView` 真网页 surface。
- Global Annotate 的透明 overlay。
- 窗口/屏幕捕获。
- WindowActionSession 的窗口定位、bounds、scale 和 native bridge。

`localhost:5173` 仍然用于 React UI 开发；真实 native 能力必须在 Desktop app 中验证。

## 不可变规则

- Desktop shell 是 native adapter，不是第二个 Agent Host。
- Desktop shell 不拥有 BrowserHostSession、annotation truth、action completion 或 provider routing。
- Native bridge 必须 bounded、loopback、trusted；不得暴露 raw secrets、raw screenshots、raw DOM 或 unbounded provider payload。
- Overlay、capture、window action 和 Browser surface 都必须按 workspace/session/ref 归属。
- 已完成 TODO 必须打勾，并补充日期、evidence refs、验证命令和最终状态。

## 当前任务板

### P0：Desktop Browser Host

- [x] 在 Desktop app 中稳定 attach/detach/resize `WebContentsView` Browser surface。
- [x] Workspace Writer 只有在 trusted native adapter 存在时才广告 browser native capability。
- [x] Web dev 模式缺 native adapter 时返回明确 blocked diagnostic。

完成证据（2026-06-03）：
- evidence refs：`docs/test-artifacts/desktop-browser-native-live-acceptance/manifest.json`（strict live smoke passed；real external HTTPS navigation passed；raw URL/DOM/screenshot strings absent）。
- 验证命令：`SCIFORGE_REQUIRE_DESKTOP_BROWSER_NATIVE_LIVE_ACCEPTANCE=1 SCIFORGE_DESKTOP_BROWSER_NATIVE_REAL_EXTERNAL_TARGET_JSON='{"url":"https://example.com/","secondUrl":"https://www.iana.org/domains/example"}' npm run smoke:desktop-browser-native-live-acceptance --silent`；`node --import tsx --test tests/smoke/smoke-desktop-electron-main.test.ts tests/smoke/smoke-desktop-browser-native-surface-lifecycle.test.ts tests/smoke/smoke-desktop-browser-native-paint-ack-heartbeat.test.ts tests/smoke/smoke-desktop-annotation-overlay.test.ts tests/smoke/smoke-desktop-window-capture.test.ts tests/smoke/smoke-desktop-dev-shell.test.ts`；`npm run typecheck --silent`。
- 最终状态：passed。Native bridge evidence route 使用 POST `outputPath` 和 bounded metadata；Workspace Writer 只通过 loopback trust 与 session-scoped refs 代理 health/attach/resize/detach/state。

### P0：Global Annotate Overlay

- [x] 创建透明、置顶、可切换 click-through 的 Electron overlay。
- [x] 支持窗口绑定框选、评论和取消。
- [x] 捕获 crop 时避免 overlay 自己进入截图。
- [x] 输出 annotation/image refs，而不是 raw screenshot payload。

完成证据（2026-06-03）：
- evidence refs：`tests/smoke/smoke-desktop-annotation-overlay.test.ts`。
- 验证命令：`node --import tsx --test tests/smoke/smoke-desktop-annotation-overlay.test.ts`。
- 最终状态：passed。捕获时会隐藏/恢复 overlay，并拒绝 raw `dataUrl` / base64 payload。

### P0：Window Capture

- [x] macOS 优先使用 ScreenCaptureKit 捕获窗口或屏幕区域。
- [x] 记录 windowRef、screen id、bounds、scale、capture time、hash。
- [x] 隐私边界：用户必须明确选择窗口或区域；无关区域默认不进入 refs。

完成证据（2026-06-03）：
- evidence refs：`tests/smoke/smoke-desktop-window-capture.test.ts`。
- 验证命令：`node --import tsx --test tests/smoke/smoke-desktop-window-capture.test.ts`。
- 最终状态：passed。macOS provider selection 优先 ScreenCaptureKit，阻断 ambient/display fallback，并返回 refs/metadata，不返回 raw screenshot payload。

### P1：Desktop Dev Shell

- [x] 提供 Desktop dev shell：启动 Vite、Workspace Writer/runtime、Electron，并注入 native adapter。
- [x] 保持 React hot reload，同时走真实 Desktop native path。
- [x] 给 Browser、Annotation、Image、Window Action 提供统一 native readiness diagnostics。

完成证据（2026-06-03）：
- evidence refs：`tools/desktop-dev-shell.ts`、`src/desktop/native-readiness.ts`、`tests/smoke/smoke-desktop-dev-shell.test.ts`。
- 验证命令：`node --import tsx --test tests/smoke/smoke-desktop-dev-shell.test.ts`。
- 最终状态：passed。Dev shell 规划 Vite + sidecars + Electron，通过 Desktop main 加载 Vite，脱敏 secrets，并只向 sidecars 注入 native adapter / config-local runtime env。

## 验收规则

- 文档改动：`git diff --check`。
- Desktop native Browser 改动：运行 desktop Electron focused smoke，并实际验证外部 HTTP/HTTPS 页面。
- Overlay/capture 改动：验证截图不包含 overlay，refs 不包含 raw base64。
- Native bridge 改动：验证 bounded response、loopback trust、secret redaction。

## 相关文档

- [`PROJECT_browser.md`](PROJECT_browser.md)
- [`PROJECT_annotation.md`](PROJECT_annotation.md)
- [`PROJECT_image.md`](PROJECT_image.md)
- [`PROJECT_window_action.md`](PROJECT_window_action.md)
- [`docs/BrowserRuntimeArchitecture.md`](docs/BrowserRuntimeArchitecture.md)
- [`docs/VirtualAppScreenArchitecture.md`](docs/VirtualAppScreenArchitecture.md)
