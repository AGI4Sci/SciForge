# SciForge Image / Evidence Pane 项目协议

最后更新：2026-06-04

## 当前目标

右侧旧 `Screen` pane 升级为通用 **Image / Evidence Pane**。它不再表示隔离虚拟屏幕或远程桌面，而是一个图片和视觉证据展示区。

它展示：

- annotation crop
- screenshot
- Browser evidence image
- window capture
- screen region capture
- screen region 的自动窗口绑定状态
- artifact preview image
- replay frame 或历史证据图片

它不执行 agent action，不拥有 live app session，不声明任务完成。

## 不可变规则

- Image pane 只展示图片、标注、refs、provenance 和处理状态。
- 图片证据必须 refs-first；主 payload 只保留尺寸、hash、mime、bounds、source 和 ref。
- Image pane 可以展示 annotation overlay，但不执行鼠标键盘或 provider action。
- 旧 Screen / VirtualAppScreen 逻辑若与通用 Image pane 冲突，必须迁移或删除。
- 已完成 TODO 必须打勾，并补充日期、evidence refs、验证命令和最终状态。

## 数据模型

最小对象：

```text
imageRef
sourceKind: annotation-crop | screenshot | browser-evidence | window-capture | screen-region | artifact | replay
mime
width
height
sha256
createdAt
provenanceRef
```

可选对象：

```text
annotationRefs
targetRef
windowRef
browserSessionRef
artifactRef
redactionRef
screenBounds
windowBinding
```

`windowBinding` 只用于解释图片证据，不让 Image pane 拥有或执行窗口操作：

```text
status: auto-bound | manual-bound | unbound | blocked
confidence?
reason?
windowRef?
appName?
bundleId?
pid?
title?
windowBounds?
windowLocalBounds?
candidates?       // bounded summary only
```

## 当前任务板

### P0：替代旧 Screen Pane

- [x] 将右侧 `Screen` tab 产品文案迁移为 Image / Evidence。
- [x] 旧 screen payload normalizer 保留兼容读取，但输出统一 image evidence model。
- [x] UI 中不再把 screenshot/replay/frame 显示成 live control surface。

完成记录（2026-06-03）：

- evidence refs：`computer-use:session/run-screen/frames/latest.png`、`computer-use:session/run-screen/replay.json`、`ledger:computer-use/run-screen/evidence.json`、`browser-session:abc/dom.json`、`artifact:figure-1/manifest.json`。
- 验证命令：`node --import tsx --test packages/presentation/components/image-evidence-viewer/render.test.tsx src/ui/src/app/results/imagePaneModel.test.ts src/ui/src/app/results/rightPaneSurfaceAdapter.test.ts src/ui/src/app/ResultsRenderer.test.ts`。
- 最终状态：passed。旧 screen/frame/replay payload 只被兼容读取并投影为 refs-first image evidence；Image pane 不保留 live control、provider route 或 action truth。

### P0：图片展示能力

- [x] 支持 zoom、pan、fit、actual size。
- [x] 支持 annotation overlay 和 crop bounds 高亮。
- [x] 支持复制 ref、打开原图、下载图片。
- [x] 支持 image provenance 展示：来源、时间、尺寸、hash、target。

完成记录（2026-06-03）：

- evidence refs：`prov:evidence/crop-001.json`、`ledger:evidence/crop-001.json`、`image-evidence:crop-001.png`。
- 验证命令：`node --import tsx --test packages/presentation/components/image-evidence-viewer/render.test.tsx src/ui/src/app/results/imagePaneModel.test.ts`。
- 最终状态：passed。图片 viewer 暴露 zoom/pan/fit/actual-size/copy/open/download/provenance 控件，annotation/crop metadata 只作为 refs 和 bounded scalar state 展示。

### P1：Thread Evidence 集成

- [x] 用户消息关联 annotation/image refs 时，点击 ref 打开 Image pane。
- [x] Browser / Global Annotate / artifact preview 都能投影到 Image pane。
- [x] Image pane 不把图片证据升级为完成判定或 action truth。

完成记录（2026-06-03）：

- evidence refs：`annotation:crop-001`、`image-evidence:crop-001.png`、`artifact:window-action-evidence`、`artifact:figure-1/manifest.json`、`browser-session:abc/dom.json`。
- 验证命令：`node --import tsx --test src/ui/src/app/chat/RunExecutionProcess.test.ts src/ui/src/app/chat/RuntimeGuiPanel.test.tsx packages/presentation/interactive-views/index.test.ts packages/presentation/components/index.test.ts`、`node --import tsx --test --test-name-pattern "image evidence artifacts do not upgrade projectionless runs to completion truth" src/ui/src/app/results-renderer-execution-model.test.ts`。
- 最终状态：passed。annotation/image refs 通过 artifact image-evidence preferred view 打开 Image pane；Browser、Global Annotate、artifact preview 仅投影 refs-first image evidence；图片证据不会填充 projection completion 或 action truth。

2026-06-04 修正：以上完成记录证明通用 image evidence 投影能力，但三种 Annotate 模式的窗口绑定状态仍需专项验收。

### P0：Annotation Mode Evidence

- [x] `SciForge page` 证据显示 DOM target、selector、页内截图和 annotation refs。
- [x] `Screen region` 证据显示 `screenBounds`、display/scale、image dimensions、hash 和 capture provenance。
- [x] 高置信度自动绑定时显示 `auto-bound`、app/window summary、`windowRef`、`windowLocalBounds`。
- [x] 低置信度时显示 `unbound` 和 reason，不把最高候选伪装成绑定窗口。
- [x] `App window` 证据显示 `manual-bound`、窗口 metadata、window-local crop bounds。
- [x] Image pane 不执行重新绑定、窗口操作或 provider action；后续“更改绑定”必须通过显式用户操作入口完成。

完成记录（2026-06-04）：

- evidence refs：`browser-session:abc/screenshots/annotation-1.png`、`browser-session:abc/dom.json`、`annotation:evidence/box-1.json`、`desktop-annotation:workspace/workspace-a/session/session-a/screenshot/capture-fixed`、`desktop-annotation:workspace/workspace-a/session/session-a/crop/capture-fixed`、`desktop-annotation:workspace/workspace-a/session/session-a/image/capture-fixed`、`capture:desktop-window-capture:test-window-capture-provider:window`、`image:desktop-window-capture:test-window-capture-provider:window`、`screen-region:workspace-a/session-a/region-1`、`desktop-window:app:plotter:window-7`、`desktop-window:app:paper-reader:window-42`。
- 验证命令：`node --import tsx --test src/ui/src/app/results/imagePaneModel.test.ts packages/presentation/components/image-evidence-viewer/render.test.tsx src/ui/src/app/SciForgeApp.desktopAnnotation.test.ts`、`node --import tsx --test src/shared/annotation-reference-contract.test.ts tests/smoke/smoke-desktop-annotation-overlay.test.ts tests/smoke/smoke-desktop-electron-main.test.ts tests/smoke/smoke-desktop-screen-region-auto-binding.test.ts tests/smoke/smoke-desktop-window-capture.test.ts`、`npm run typecheck --silent`、`git diff --check`。
- 最终状态：passed。三种 Annotate 模式都投影为 refs-first image evidence；SciForge page 保留 DOM target/selector/annotation refs；screen region 保留 screen/display/scale/dimensions/hash/provenance；`auto-bound`/`manual-bound` 只显示绑定证据；低置信度保持 `unbound` 和 bounded candidates；Image pane 只提供 host-policy view/export 请求，不执行 rebind、provider 或窗口操作。

## 验收规则

- 文档改动：`git diff --check`。
- Image pane 改动：运行 focused right-pane/image viewer tests。
- 图片证据改动：确认 raw base64 不进入主 thread payload。
- Window binding 证据改动：确认 low-confidence 默认 `unbound`，不升级为 WindowActionSession。
- 旧 Screen 迁移：确认 UI 文案、tab type、refs 和 tests 不再宣称隔离虚拟屏幕。

## 相关文档

- [`PROJECT_annotation.md`](PROJECT_annotation.md)
- [`PROJECT_browser.md`](PROJECT_browser.md)
- [`PROJECT_window_action.md`](PROJECT_window_action.md)
- [`docs/VirtualAppScreenArchitecture.md`](docs/VirtualAppScreenArchitecture.md)
