# SciForge Desktop Native Host 项目协议

最后更新：2026-06-04

## 当前目标

Desktop Electron native host 是 M1 真实产品能力的承载层。它负责把 Web dev UI 做不到的能力接入 SciForge：

- Browser Pane 的 `WebContentsView` 真网页 surface。
- Global Annotate 的透明 overlay。
- 窗口/屏幕捕获。
- 屏幕区域到窗口的自动高置信度绑定。
- WindowActionSession 的窗口定位、bounds、scale 和 native bridge。

`localhost:5173` 仍然用于 React UI 开发；真实 native 能力必须在 Desktop app 中验证。

## 不可变规则

- Desktop shell 是 native adapter，不是第二个 Agent Host。
- Desktop shell 不拥有 BrowserHostSession、annotation truth、action completion 或 provider routing。
- Native bridge 必须 bounded、loopback、trusted；不得暴露 raw secrets、raw screenshots、raw DOM 或 unbounded provider payload。
- Overlay、capture、window action 和 Browser surface 都必须按 workspace/session/ref 归属。
- Global Annotate 主路径必须由 overlay 产生可靠 `screenBounds`；不能把 `screencapture -i` 当作需要自动窗口绑定的主实现。
- 窗口自动绑定只能在高置信度时成立；低置信度默认 `unbound`。
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

2026-06-04 修正：原 2026-06-03 完成记录只覆盖 overlay controller/model 验证；当前产品入口已补齐 `SciForge page`、`Screen region`、`App window` 三种模式的默认 Desktop bridge 接线。

### P0：Annotation Mode Native Bridge

- [x] Desktop preload 暴露 bounded annotation bridge：`startAnnotation({ mode, context })`、`cancelAnnotation()`、`getAnnotationState()`。
- [x] `mode=sciforge-page` 不走 native screen capture，只保留 web DOM fallback。
- [x] `mode=screen-region` 启动 native overlay 获取 `screenBounds`，再 capture selected region。
- [x] `mode=app-window` 先显式选择窗口，再在窗口内框选。
- [x] bridge 返回 refs-only result：`annotationRef`、`imageRef`、`screenshotRef`、`cropRef`、bounds、binding status、diagnostics。
- [x] bridge 不向 renderer 暴露 raw screenshot、base64、raw provider payload、unbounded window list。

完成证据（2026-06-04）：
- evidence refs：`src/desktop/preload.ts`、`src/desktop/preload.cjs`、`src/desktop/main.ts`、`src/desktop/annotation-overlay.ts`、`src/desktop/annotation-overlay-preload.cjs`、`src/desktop/app-window-picker.ts`、`src/desktop/app-window-picker-preload.cjs`、`src/desktop/app-window-selection-provider.ts`、`src/ui/src/app/SciForgeApp.tsx`、`src/ui/src/app/appShell/TopBar.tsx`、`src/ui/src/app/SciForgeApp.desktopAnnotation.test.ts`、`tests/smoke/smoke-desktop-electron-main.test.ts`、`tests/smoke/smoke-desktop-app-window-picker.test.ts`、`tests/smoke/smoke-desktop-app-window-selection-provider.test.ts`、`tests/smoke/smoke-desktop-screen-region-overlay-bridge.test.ts`。
- 验证命令：`node --import tsx --test tests/smoke/smoke-desktop-app-window-selection-provider.test.ts tests/smoke/smoke-desktop-app-window-picker.test.ts tests/smoke/smoke-desktop-electron-main.test.ts`；`node --import tsx --test tests/smoke/smoke-desktop-annotation-overlay.test.ts tests/smoke/smoke-desktop-electron-main.test.ts`；`npm exec tsc -- -p tsconfig.desktop.build.json --noEmit --pretty false`。
- 最终状态：passed。Renderer public preload 只暴露 one-shot annotation bridge；Screen region 由默认 trusted overlay preload/UI 产出 screen-global bounds 并走 refs-only capture；App window 由默认 refs-only picker/provider 先选择真实窗口，再进入 window-local overlay。内部 picker/overlay IPC 不暴露给主 renderer，且 raw screenshot/base64/provider/window-list payload 被清洗。

### P0：Window Capture

- [x] macOS 优先使用 ScreenCaptureKit 捕获窗口或屏幕区域。
- [x] 记录 windowRef、screen id、bounds、scale、capture time、hash。
- [x] 隐私边界：用户必须明确选择窗口或区域；无关区域默认不进入 refs。

完成证据（2026-06-03）：
- evidence refs：`tests/smoke/smoke-desktop-window-capture.test.ts`。
- 验证命令：`node --import tsx --test tests/smoke/smoke-desktop-window-capture.test.ts`。
- 最终状态：passed。macOS provider selection 优先 ScreenCaptureKit，阻断 ambient/display fallback，并返回 refs/metadata，不返回 raw screenshot payload。

### P0：Screen Region Capture + Auto Binding

- [x] 使用 overlay `screenBounds` 执行 ScreenCaptureKit region capture 或 `screencapture -R x,y,w,h` fallback。
- [x] 截图前隐藏/穿透 overlay，避免 overlay 污染图片。
- [x] 枚举当前窗口，排除 SciForge 主窗口、overlay、菜单栏、Dock、不可见/极小窗口。
- [x] 自动绑定规则：中心点在窗口内、重叠面积 `>= 70%`、第一候选比第二候选高 `>= 20%`。
- [x] 低置信度、多窗口冲突、桌面区域或权限失败默认不绑定，返回 bounded diagnostics。
- [x] 多显示器、Retina scale、负坐标显示器布局必须进入测试矩阵。

完成证据（2026-06-04）：
- evidence refs：`src/desktop/window-capture.ts`、`src/desktop/annotation-window-capture-provider.ts`、`src/desktop/screen-region-auto-binding.ts`、`src/desktop/macos-window-inventory.ts`、`tests/smoke/smoke-desktop-window-capture.test.ts`、`tests/smoke/smoke-desktop-annotation-overlay.test.ts`、`tests/smoke/smoke-desktop-screen-region-auto-binding.test.ts`、`tests/smoke/smoke-desktop-macos-window-inventory.test.ts`。
- 验证命令：`node --import tsx --test tests/smoke/smoke-desktop-window-capture.test.ts tests/smoke/smoke-desktop-annotation-overlay.test.ts tests/smoke/smoke-desktop-screen-region-auto-binding.test.ts tests/smoke/smoke-desktop-macos-window-inventory.test.ts`。
- 最终状态：passed。Region capture 支持 explicit ScreenCaptureKit provider 或 bounded macOS `screencapture -R` fallback；capture 前 overlay hide/click-through，输出 hash/refs，不返回 raw image bytes。窗口 inventory 与 auto-binding 覆盖过滤系统/SciForge/overlay/tiny/invisible 窗口、70% overlap、20% lead、低置信度/冲突/桌面/权限 blocked，以及 negative-coordinate/Retina/multi-display candidate metadata。

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
- Auto binding 改动：验证 high-confidence 自动绑定、low-confidence 默认 unbound。
- Native bridge 改动：验证 bounded response、loopback trust、secret redaction。

## 相关文档

- [`PROJECT_browser.md`](PROJECT_browser.md)
- [`PROJECT_annotation.md`](PROJECT_annotation.md)
- [`PROJECT_image.md`](PROJECT_image.md)
- [`PROJECT_window_action.md`](PROJECT_window_action.md)
- [`docs/BrowserRuntimeArchitecture.md`](docs/BrowserRuntimeArchitecture.md)
- 已删除的历史 VirtualAppScreen 设计文档。
