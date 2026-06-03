# SciForge Annotation 项目协议

最后更新：2026-06-03

## 当前目标

Annotation 是 Browser Pane 和 Global Annotate 共用的标注系统。它采用 Codex 风格：

```text
用户框选 / 评论
  -> 生成 pending annotation context
  -> 暂存在 composer
  -> 用户发送消息
  -> annotation refs 随本轮 user message 进入 thread
  -> agent 基于这些 refs 回答、改代码或继续操作
```

标注不自动生成任务，不自动触发 agent，不维护独立 TODO 队列。

## 不可变规则

- Browser annotation 和 Global Annotate 必须共用同一数据模型。
- annotation 大对象必须 refs-first；不得把 raw screenshot/base64/DOM/provider payload 放入主消息。
- 标注目标可以是 Browser page、真实 app window、屏幕区域或 image evidence。
- 标注绑定优先级：先实现窗口绑定，再实现屏幕坐标绑定。
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
bounds
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
```

## 当前任务板

### P0：统一数据模型

- [ ] 定义 `annotationRef`、`targetRef`、`cropRef`、`screenshotRef` 的 shared contract。
- [ ] Browser pane 和 Global Annotate 输出同一 schema。
- [ ] Composer 支持 pending annotation context chip。
- [ ] 用户发送消息时，annotation refs 随 user message 进入 thread。

### P0：Browser Annotation

- [ ] Browser Pane 支持框选、点选、评论。
- [ ] Browser annotation 使用 browser viewport 坐标，并可关联 DOM/AX refs。
- [ ] Browser annotation 不依赖页面 iframe/proxy/snapshot fallback。

### P0：Global Annotate

- [x] Desktop overlay 支持窗口绑定评论。
- [x] 窗口绑定评论使用 window-local 坐标，窗口移动/缩放后仍可解释。
- [x] Desktop overlay 支持取消、重选、提交到 composer。

完成记录（2026-06-03）：

- evidence refs：`tests/smoke/smoke-desktop-annotation-overlay.test.ts`、`annotation:desktop-overlay/comment-1`、`image:desktop-overlay/crop-1`、`desktop-window:app:paper-reader:window-42`。
- 验证命令：`node --import tsx --test tests/smoke/smoke-desktop-annotation-overlay.test.ts tests/smoke/smoke-desktop-window-capture.test.ts`；`node --import tsx --test tests/smoke/smoke-desktop-electron-main.test.ts tests/smoke/smoke-desktop-browser-native-surface-lifecycle.test.ts tests/smoke/smoke-desktop-browser-native-paint-ack-heartbeat.test.ts tests/smoke/smoke-desktop-annotation-overlay.test.ts tests/smoke/smoke-desktop-window-capture.test.ts tests/smoke/smoke-desktop-dev-shell.test.ts`。
- 最终状态：passed。Desktop overlay 支持窗口绑定选择、取消、重选、提交；捕获 crop 时隐藏/恢复 overlay，并只输出 owned refs，不输出 raw screenshot/base64。

### P1：Screen Region Annotation

- [ ] 支持用户选择屏幕区域评论。
- [ ] 屏幕区域评论使用 screen-global 坐标。
- [ ] 多显示器、Retina scale、截图 overlay 污染和隐私遮挡需要进入验收。

## 验收规则

- 文档改动：`git diff --check`。
- Annotation contract 改动：运行 focused schema/normalizer tests。
- Browser annotation 改动：验证 Browser Pane 内可产生 pending context。
- Global Annotate 改动：验证真实 Desktop overlay 能产生 crop/image refs，并且 overlay 本身不污染截图。

## 相关文档

- [`docs/VirtualAppScreenArchitecture.md`](docs/VirtualAppScreenArchitecture.md)
- [`docs/BrowserRuntimeArchitecture.md`](docs/BrowserRuntimeArchitecture.md)
- [`PROJECT_browser.md`](PROJECT_browser.md)
- [`PROJECT_image.md`](PROJECT_image.md)
- [`PROJECT_desktop.md`](PROJECT_desktop.md)
