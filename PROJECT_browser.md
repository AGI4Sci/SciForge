# SciForge Browser Pane 项目协议

最后更新：2026-06-03

## 当前目标

Browser Pane 是 SciForge 右侧栏里的真实内置浏览器。M1 目标是：

```text
Desktop Electron app
  -> React Workbench
  -> BrowserHostSession
  -> Electron WebContentsView
  -> 真实 HTTP/HTTPS 或本地开发网页
```

`localhost:5173` 只能调试 React UI、状态和诊断；真实网页打开和使用必须在
Desktop Electron native host 中验证。

## 不可变规则

- BrowserHostSession 是唯一 browser session/action/evidence owner。
- Electron `WebContentsView` 只是 display/input adapter，不是第二个浏览器 owner。
- 支持本地地址和任意 HTTP/HTTPS 外部网页；不能用 iframe、proxy、snapshot、PDF、旧 frame、`<webview>` 或系统浏览器冒充内置浏览器。
- 每个 workspace 使用独立 browser profile；profile、cookie、storage、cache 都是 ignored local runtime state。
- agent 操作采用可见操作 + 后台 Playwright/CDP 自动化结合；后台结果必须投影回 Browser Pane 或 annotation/evidence refs。
- annotation/ref 系统与 Global Annotation 统一。
- 已完成 TODO 必须打勾，并补充日期、evidence refs、验证命令和最终状态。

## 当前任务板

### P0：Desktop 真实 Browser Pane

- [x] 保证 Desktop shell 使用 `WebContentsView` 作为 Browser Pane 的真实网页 surface。
- [x] Web dev shell 缺 native host 时显示 typed blocked/diagnostic，不声明打开成功。
- [x] Browser toolbar 支持 URL、Open、Back、Forward、Reload、Stop 和 loading/error/blocked 状态。
- [x] Browser pane 支持本地开发地址、HTTP、HTTPS 和 scheme-less URL normalization。
- [x] 删除或迁移与最终方案冲突的 iframe/proxy/snapshot live path。

完成记录（2026-06-03）：

- evidence refs：`docs/test-artifacts/desktop-browser-native-live-acceptance/manifest.json`、`browser-host-session:visible-action-session/actor-cursors/cursor-shared-browser.json`、`browser-host-session:visible-action-session/visible-actions/agent-click-visible.json`。
- 验证命令：`SCIFORGE_REQUIRE_DESKTOP_BROWSER_NATIVE_LIVE_ACCEPTANCE=1 SCIFORGE_DESKTOP_BROWSER_NATIVE_REAL_EXTERNAL_TARGET_JSON='{"url":"https://example.com/","secondUrl":"https://www.iana.org/domains/example"}' npm run smoke:desktop-browser-native-live-acceptance --silent`；`node --import tsx --test packages/presentation/components/browser-workbench/render.test.tsx packages/presentation/components/image-evidence-viewer/render.test.tsx src/ui/src/app/results/browserPaneModel.test.ts src/ui/src/app/results/browserPaneHostAdapter.test.ts src/ui/src/app/results/rightPaneSurfaceAdapter.test.ts src/ui/src/app/results/imagePaneModel.test.ts src/runtime/browser-host-session.test.ts src/runtime/playwright-edge-browser-runtime.test.ts src/runtime/window-action-session.test.ts`；`node --import tsx --test src/ui/src/app/ResultsRenderer.test.ts`；`node --import tsx --test tests/smoke/smoke-desktop-electron-main.test.ts tests/smoke/smoke-desktop-browser-native-surface-lifecycle.test.ts tests/smoke/smoke-desktop-browser-native-paint-ack-heartbeat.test.ts tests/smoke/smoke-desktop-annotation-overlay.test.ts tests/smoke/smoke-desktop-window-capture.test.ts tests/smoke/smoke-desktop-dev-shell.test.ts`；`npm run typecheck --silent`。
- 最终状态：passed。Desktop native Browser live acceptance 已真实打开外部 HTTPS；local/external HTTP(S) 在 React pane 中统一要求 host-owned BrowserHostSession，不再以 iframe/proxy/snapshot/旧 frame 或系统浏览器冒充 live Browser。

### P1：Workspace Profile

- [ ] 为每个 workspace 创建独立 browser profile 目录。
- [ ] 将 profile 路径加入 ignored runtime state，禁止进入 Git 和长期 trace。
- [ ] BrowserHostSession 和后台 Playwright/CDP 自动化使用同一 workspace profile。
- [ ] 登录态复用只限当前 workspace；不默认复用用户 Chrome/Edge 主 profile。

### P1：可见操作 + 后台自动化

- [ ] 可见操作显示 agent actorCursor、点击、滚动、输入和加载状态。
- [ ] 后台自动化可执行批量检查、抓取、测试，但必须返回 bounded refs 和摘要。
- [ ] 高风险页面动作先记录为风险类型；权限系统不是 M1 阻塞项。

### P1：Browser Annotation

- [ ] Browser pane 内标注生成统一 `annotationRef`、`targetRef`、`cropRef` 和 `screenshotRef`。
- [ ] 标注作为 pending context 进入 composer，随下一条用户消息提交。
- [ ] Browser annotation 与全局窗口 annotation 在 thread 中使用同一展示模型。

未完成说明（2026-06-03）：Browser annotation 已有 pending refs 适配测试，但 Browser Pane 内真实框选/点选 E2E 和与 Global Annotate 的同模型 thread 展示尚未完成，不能勾选。

## 验收规则

- 文档改动：`git diff --check`。
- Browser UI 改动：运行 Browser pane focused tests 和 right-pane smoke。
- Desktop native Browser 改动：必须在 Desktop Electron native host 中验证真实外部网页打开。
- Profile 改动：确认 profile 路径 ignored，日志和 evidence 不泄漏 cookie、token、Authorization 或完整私密 URL。

## 相关文档

- [`docs/BrowserRuntimeArchitecture.md`](docs/BrowserRuntimeArchitecture.md)
- [`PROJECT_desktop.md`](PROJECT_desktop.md)
- [`PROJECT_annotation.md`](PROJECT_annotation.md)
- [`PROJECT_image.md`](PROJECT_image.md)
