# SciForge Annotation 项目协议

最后更新：2026-06-04

## 当前目标

Annotation 是 Browser Pane 和 Global Annotate 共用的标注系统。它采用 Codex 风格：

```text
用户框选 / 评论
  -> 生成 pending annotation context
  -> 暂存在 composer
  -> 用户发送消息
  -> annotation refs 随本轮 user message 进入 thread
  -> agent 基于这些 refs 回答、改代码或继续操作
  -> 如果是“把这里改成 X”，Agent Host 自动进入 WindowActionSession
```

标注不自动生成任务，不维护独立 TODO 队列，也不自己执行 action。它只产生 refs-first context 和 target binding。自动进入 WindowActionSession 由 Agent Host 在读取下一条用户消息时触发。

2026-06-04 设计修正：顶部 `Annotate` 必须明确区分三种评论模式：

1. `SciForge page`：评论 SciForge 内部 DOM / 右侧 pane / 聊天内容。
2. `Screen region`：评论用户屏幕任意可见区域，使用全屏 overlay 获取 `screenBounds`。
3. `App window`：用户先显式选真实应用窗口，再在窗口内评论，必有 `windowRef` 和 `windowLocalBounds`。

`Screen region` 完成后自动尝试窗口绑定；只有高置信度才绑定。低置信度、多窗口冲突或桌面区域默认不绑定，不弹窗打断用户。

## 不可变规则

- Browser annotation 和 Global Annotate 必须共用同一数据模型。
- annotation 大对象必须 refs-first；不得把 raw screenshot/base64/DOM/provider payload 放入主消息。
- 标注目标可以是 Browser page、真实 app window、屏幕区域或 image evidence。
- 评论取证不需要为每个 app 写专用适配；app 专用逻辑只属于后续 Action Adapter。
- `manual-bound` 或高置信度 `auto-bound` annotation + 修改意图可以自动进入 WindowActionSession；Annotation 本身不拥有 input adapter，也不执行 provider action。
- `Screen region` 的窗口绑定是增强 metadata，不是成功前提；低置信度默认不绑定。
- `App window` 是显式窗口绑定模式，不能混同为对 screen-region 的低置信度猜测。
- `screencapture -i` 不适合作为主路径，因为缺少可靠 `screenBounds`；M1 主路径应由 SciForge overlay 获取坐标，再使用 ScreenCaptureKit 或 `screencapture -R` 取图。
- 所有 ref 必须可解释、可定位、可过期处理；不能硬编码当前截图、URL、文件名或历史 run。
- 已完成 TODO 必须打勾，并补充日期、evidence refs、验证命令和最终状态。

## Annotation Ref 模型

最小字段：

```text
annotationRef
targetRef
cropRef
screenshotRef
comment
sourceKind: browser | window | screen-region | image
coordinateSpace: browser-viewport | window-local | screen-global | image-local
screenBounds
windowBounds?
windowLocalBounds?
windowBinding?
createdAt
threadId
messageDraftId
```

可选字段：

```text
windowRef
browserSessionRef
imageRef
actorCursorRef
domRef
accessibilityRef
hash
redactionRef
windowBindingCandidates
```

`windowBinding` 状态：

```text
auto-bound      // Screen region 高置信度自动绑定
manual-bound    // App window 显式窗口绑定
unbound         // 低置信度或桌面区域，默认不绑定
blocked         // 权限、窗口枚举或截图能力阻断
```

## 当前任务板

### P0：Annotate 模式入口

- [x] 顶部 `Annotate` 打开模式菜单：`SciForge page`、`Screen region`、`App window`。
- [x] `Global vision` 仅保留为全局视觉/截图取证开关，不作为评论入口。
- [x] bridge/API 使用显式 `mode`，避免把底层 overlay `begin/update/submit` 暴露成用户主路径。
- [x] bridge 不可用时，仅 `SciForge page` 可 fallback 到 DOM 评论；全屏模式必须返回 blocked/权限诊断。

完成记录（2026-06-04）：

- evidence refs：`src/ui/src/app/appShell/TopBar.tsx`、`src/ui/src/app/SciForgeApp.tsx`、`src/ui/src/config.ts`、`src/desktop/preload.ts`、`src/desktop/preload.cjs`、`src/desktop/main.ts`、`src/desktop/annotation-overlay-preload.cjs`、`src/desktop/app-window-picker-preload.cjs`、`src/desktop/production-shell-planner.ts`、`src/ui/src/app/SciForgeApp.desktopAnnotation.test.ts`、`tests/smoke/smoke-desktop-electron-main.test.ts`、`tests/smoke/smoke-desktop-screen-region-overlay-bridge.test.ts`、`tests/smoke/smoke-desktop-app-window-picker.test.ts`。
- 验证命令：`node --import tsx --test src/shared/annotation-reference-contract.test.ts src/ui/src/feedback/FeedbackCaptureLayer.test.tsx src/ui/src/app/ChatPanel.test.ts packages/presentation/components/browser-workbench/render.test.tsx src/ui/src/app/results/browserPaneModel.test.ts src/ui/src/app/results/browserPaneHostAdapter.test.ts src/ui/src/app/SciForgeApp.desktopAnnotation.test.ts tests/smoke/smoke-desktop-electron-main.test.ts tests/smoke/smoke-desktop-screen-region-auto-binding.test.ts tests/smoke/smoke-desktop-annotation-overlay.test.ts tests/smoke/smoke-desktop-window-capture.test.ts`；`npm run typecheck -- --pretty false`；`git diff --check`。
- 最终状态：passed。顶部入口使用三模式菜单，Global vision 保持独立视觉/截图开关；renderer 只通过显式 `mode` 调用 `startAnnotation`/`startDesktopAnnotation`，public preload 不把低层 `begin/update/submit/capture` 作为用户主路径暴露；缺少 Desktop bridge 时，`SciForge page` 保留 DOM fallback，native 模式返回 refs-only blocked 诊断且不制造 phantom evidence refs。Desktop app 默认接入 trusted screen-region overlay 和 refs-only app-window picker。

### P0：SciForge page 评论

- [x] 保留现有 DOM selector、DOM path、selected text、component rect 和页内截图证据。
- [x] 内置 Browser Pane 的评论必须优先使用 fresh Browser evidence，不使用过期截图。
- [x] 评论 refs 进入 annotation draft，并随下一条用户消息提交。

完成记录（2026-06-04）：

- evidence refs：`src/ui/src/feedback/captureModel.ts`、`src/ui/src/feedback/FeedbackCaptureLayer.tsx`、`src/ui/src/feedback/annotationPlanModel.ts`、`src/ui/src/app/ChatPanel.test.ts`、`src/ui/src/app/results/browserPaneHostAdapter.tsx`、`src/ui/src/app/results/browserPaneModel.ts`。
- 验证命令：`node --import tsx --test src/ui/src/feedback/FeedbackCaptureLayer.test.tsx src/ui/src/app/ChatPanel.test.ts packages/presentation/components/browser-workbench/render.test.tsx src/ui/src/app/results/browserPaneModel.test.ts src/ui/src/app/results/browserPaneHostAdapter.test.ts`。
- 最终状态：passed。SciForge page DOM capture 保留 selector/path/selectedText/rect/commentPoint 和 page screenshot evidence；Browser Pane annotation 先 flush host actions 并 fresh capture BrowserHostSession，再将 refs-first composer reference 加入 pending context，下一条 user message 携带 references。

### P0：Screen region 评论

- [x] Desktop overlay 覆盖所有显示器或当前显示器，支持框选、取消、重选。
- [x] overlay 产出准确 `screenBounds`、display id、scale 和 createdAt。
- [x] 使用 ScreenCaptureKit 或 `screencapture -R` 截取用户选择区域；截图不包含 overlay。
- [x] 成功输出 refs-only `annotationRef`、`imageRef`、`screenshotRef`、`cropRef`、hash、尺寸和 provenance。
- [x] 自动窗口绑定：高置信度自动绑定；低置信度默认 `unbound`，不弹窗。
- [x] 自动绑定候选进入 bounded diagnostics/provenance，不作为 raw window list 泄漏。

完成记录（2026-06-04）：

- evidence refs：`src/desktop/annotation-overlay.ts`、`src/desktop/annotation-overlay-preload.cjs`、`src/desktop/annotation-screen-region-overlay-bridge.ts`、`src/desktop/window-capture.ts`、`src/desktop/annotation-window-capture-provider.ts`、`src/desktop/screen-region-auto-binding.ts`、`tests/smoke/smoke-desktop-annotation-overlay.test.ts`、`tests/smoke/smoke-desktop-window-capture.test.ts`、`tests/smoke/smoke-desktop-screen-region-auto-binding.test.ts`、`tests/smoke/smoke-desktop-screen-region-overlay-bridge.test.ts`、`tests/smoke/smoke-desktop-electron-main.test.ts`。
- 验证命令：`node --import tsx --test src/shared/annotation-reference-contract.test.ts src/ui/src/feedback/FeedbackCaptureLayer.test.tsx src/ui/src/app/ChatPanel.test.ts packages/presentation/components/browser-workbench/render.test.tsx src/ui/src/app/results/browserPaneModel.test.ts src/ui/src/app/results/browserPaneHostAdapter.test.ts src/ui/src/app/SciForgeApp.desktopAnnotation.test.ts tests/smoke/smoke-desktop-electron-main.test.ts tests/smoke/smoke-desktop-screen-region-auto-binding.test.ts tests/smoke/smoke-desktop-annotation-overlay.test.ts tests/smoke/smoke-desktop-window-capture.test.ts`。
- 最终状态：passed。Desktop app 默认注册 trusted screen-region overlay bridge；overlay preload/UI 支持框选、取消和评论提交，并只发送 schema/bounds/comment/thread refs 到内部 IPC。Overlay 支持 current-display screen-region 选择、取消、重选、隐藏自身后 capture；capture provider 使用 explicit ScreenCaptureKit provider 或 macOS `screencapture -R` fallback，并输出 refs-only annotation/image/screenshot/crop/hash/dimensions/provenance。Screen-region auto binding 高置信度输出 `auto-bound`，低置信度、多窗口冲突或权限失败保持 `unbound`/`blocked`，候选和 diagnostics bounded 且不泄漏 raw window list。

### P1：App window 评论

- [x] 用户先显式选择真实应用窗口，再在该窗口内框选区域。
- [x] 输出 `windowRef`、app name、bundle id、pid、window title、`windowBounds`、`windowLocalBounds`。
- [x] 选区限制在目标窗口内；窗口移动/缩放后仍能解释 window-local 坐标。
- [x] 该模式不要求 app 专用 adapter；后续操作才由 WindowActionSession / Action Adapter 决定。

完成记录（2026-06-04）：

- evidence refs：`src/desktop/main.ts`、`src/desktop/app-window-selection-provider.ts`、`src/desktop/app-window-picker.ts`、`src/desktop/app-window-picker-preload.cjs`、`src/desktop/annotation-overlay.ts`、`src/desktop/annotation-window-capture-provider.ts`、`src/desktop/window-capture.ts`、`tests/smoke/smoke-desktop-electron-main.test.ts`、`tests/smoke/smoke-desktop-app-window-selection-provider.test.ts`、`tests/smoke/smoke-desktop-app-window-picker.test.ts`、`tests/smoke/smoke-desktop-annotation-overlay.test.ts`、`tests/smoke/smoke-desktop-window-capture.test.ts`、`src/ui/src/app/SciForgeApp.desktopAnnotation.test.ts`。
- 验证命令：`node --import tsx --test tests/smoke/smoke-desktop-app-window-selection-provider.test.ts tests/smoke/smoke-desktop-app-window-picker.test.ts tests/smoke/smoke-desktop-electron-main.test.ts`；`node --import tsx --test tests/smoke/smoke-desktop-annotation-overlay.test.ts tests/smoke/smoke-desktop-window-capture.test.ts src/ui/src/app/SciForgeApp.desktopAnnotation.test.ts src/shared/annotation-reference-contract.test.ts`；`npm exec tsc -- -p tsconfig.desktop.build.json --noEmit --pretty false`；`git diff --check`。
- 最终状态：passed。App window 模式通过默认 refs-only picker/provider 先让用户选择真实窗口，再启动 window-local overlay；provider 也支持 deterministic `windowRef`/`candidateId` 和 injected chooser。start/update/capture 路径输出 refs-only `windowRef`、app metadata、`windowBounds` 和后续 `windowLocalBounds`，无 raw window list、raw screenshot/base64/provider payload 泄漏。权限失败、无候选、取消或 picker 不可用时返回 refs-only blocked 诊断。

### P0：统一数据模型

- [x] 定义 `annotationRef`、`targetRef`、`cropRef`、`screenshotRef` 的 shared contract。
- [x] Browser pane 和 Global Annotate 输出同一 schema。
- [x] Composer 支持 pending annotation context chip。
- [x] 用户发送消息时，annotation refs 随 user message 进入 thread。

完成记录（2026-06-03）：

- evidence refs：`src/shared/annotation-reference-contract.ts`、`src/ui/src/app/results/browserPaneModel.test.ts`、`src/ui/src/app/results/browserPaneHostAdapter.test.ts`、`tests/smoke/smoke-desktop-annotation-overlay.test.ts`、`annotation:right-pane-tab-a-12345678`、`desktop-annotation:workspace/workspace-a/session/session-a/annotation/capture-fixed`。
- 验证命令：`node --import tsx --test src/ui/src/app/results/browserPaneModel.test.ts src/ui/src/app/results/browserPaneHostAdapter.test.ts tests/smoke/smoke-desktop-annotation-overlay.test.ts`。
- 最终状态：passed。Browser annotation 和 Global window annotation 共用 `sciforge.annotation-reference.v1` 展示模型，Browser pending payload 为 refs-first contract 并包含 `annotationRef`、`targetRef`、`cropRef`、`screenshotRef`、`sourceKind`、`coordinateSpace` 和 bounds；Browser adapter 将 pending reference 送入 composer，ChatPanel 随下一条 user message references 提交。

### P0：Browser Annotation

- [x] Browser Pane 支持框选、点选、评论。
- [x] Browser annotation 使用 browser viewport 坐标，并可关联 DOM/AX refs。
- [x] Browser annotation 不依赖页面 iframe/proxy/snapshot fallback。

完成记录（2026-06-04）：

- evidence refs：`packages/presentation/components/browser-workbench/render.tsx`、`packages/presentation/components/browser-workbench/render.test.tsx`、`src/ui/src/app/results/browserPaneHostAdapter.tsx`、`src/ui/src/app/results/browserPaneHostAdapter.test.ts`、`src/ui/src/app/results/browserPaneModel.ts`、`src/ui/src/app/results/browserPaneModel.test.ts`。
- 验证命令：`node --import tsx --test packages/presentation/components/browser-workbench/render.test.tsx src/ui/src/app/results/browserPaneModel.test.ts src/ui/src/app/results/browserPaneHostAdapter.test.ts`。
- 最终状态：passed。Browser Workbench `Annotate` command enters annotation mode, captures point/box selection and comment in browser-viewport coordinates, routes selection through BrowserHostSession fresh capture into composer refs, keeps DOM/AX as refs, and tests reject iframe/proxy/snapshot fallback paths.

### P0：Global Annotate

- [x] Desktop overlay 支持窗口绑定评论。
- [x] 窗口绑定评论使用 window-local 坐标，窗口移动/缩放后仍可解释。
- [x] Desktop overlay 支持取消、重选、提交到 composer。

完成记录（2026-06-03）：

- evidence refs：`tests/smoke/smoke-desktop-annotation-overlay.test.ts`、`annotation:desktop-overlay/comment-1`、`image:desktop-overlay/crop-1`、`desktop-window:app:paper-reader:window-42`。
- 验证命令：`node --import tsx --test tests/smoke/smoke-desktop-annotation-overlay.test.ts tests/smoke/smoke-desktop-window-capture.test.ts`；`node --import tsx --test tests/smoke/smoke-desktop-electron-main.test.ts tests/smoke/smoke-desktop-browser-native-surface-lifecycle.test.ts tests/smoke/smoke-desktop-browser-native-paint-ack-heartbeat.test.ts tests/smoke/smoke-desktop-annotation-overlay.test.ts tests/smoke/smoke-desktop-window-capture.test.ts tests/smoke/smoke-desktop-dev-shell.test.ts`。
- 最终状态：passed。Desktop overlay 支持窗口绑定选择、取消、重选、提交；捕获 crop 时隐藏/恢复 overlay，并只输出 owned refs，不输出 raw screenshot/base64。

2026-06-04 修正：以上完成记录只证明 controller/model 层可产出 refs-first window annotation，不代表产品入口已满足三种模式。当前剩余验收以 `Annotate 模式入口`、`Screen region 评论` 和 `App window 评论` 为准。

### P1：Screen Region Annotation

- [x] 迁移到 P0 `Screen region 评论`，并保留多显示器、Retina scale、截图 overlay 污染和隐私遮挡验收。

完成记录（2026-06-04）：

- evidence refs：`tests/smoke/smoke-desktop-screen-region-auto-binding.test.ts`、`tests/smoke/smoke-desktop-annotation-overlay.test.ts`、`tests/smoke/smoke-desktop-window-capture.test.ts`。
- 验证命令：`node --import tsx --test tests/smoke/smoke-desktop-screen-region-auto-binding.test.ts tests/smoke/smoke-desktop-annotation-overlay.test.ts tests/smoke/smoke-desktop-window-capture.test.ts`。
- 最终状态：passed。Screen region 验收迁入 P0，覆盖 negative-coordinate/Retina metadata、overlay hidden-and-click-through capture、privacy refs-only、ScreenCaptureKit/fallback capture 和 bounded auto-binding diagnostics。

## 验收规则

- 文档改动：`git diff --check`。
- Annotation contract 改动：运行 focused schema/normalizer tests。
- Browser annotation 改动：验证 Browser Pane 内可产生 pending context。
- Global Annotate 改动：验证三种模式入口、真实 Desktop overlay、screen-region 自动绑定和 refs-only capture。

## 相关文档

- 已删除的历史 VirtualAppScreen 设计文档。
- [`docs/BrowserRuntimeArchitecture.md`](docs/BrowserRuntimeArchitecture.md)
- [`PROJECT_browser.md`](PROJECT_browser.md)
- [`PROJECT_image.md`](PROJECT_image.md)
- [`PROJECT_desktop.md`](PROJECT_desktop.md)
