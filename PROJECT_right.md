# SciForge Right Pane 项目协议

最后更新：2026-06-03

## 当前目标

Right Pane 是 SciForge 的对象展示 shell。它负责 tab、focus、对象路由和 presentation slot，不拥有 Browser、Image、Terminal、Files、References 或 Window Action 的执行逻辑。

当前 pane 类型：

- Browser：真实内置浏览器，详见 [`PROJECT_browser.md`](PROJECT_browser.md)。
- Image：通用图片和视觉证据展示，详见 [`PROJECT_image.md`](PROJECT_image.md)。
- Terminal：host-owned PTY 展示和输入豁免。
- Files：workspace file viewer/editor projection。
- References：对象 refs、trace、provenance inspector。

旧 `Screen` tab 产品心智迁移为 Image / Evidence Pane；历史 Screen/VirtualAppScreen 完成记录保留在 Git 历史中。

## 不可变规则

- Right Pane 不是日志 dump，必须按对象类型展示。
- 点击对象 ref 只能打开或聚焦对应 pane；把 ref 插回 composer 只能通过显式引用/上下文菜单完成。
- GUI -> TUI 只发送终端等价文本、focus/confirmation 结果或只读 projection；TUI -> GUI 只通过 declared GUI intents。
- Browser、Image、Files、References 不执行 provider action；Terminal 只有 host-owned PTY 豁免。
- 大 payload、截图、terminal transcript、DOM snapshot、artifact、audit 和 replay 必须 refs-first。
- 业务代码单文件超过约 2000 行时必须拆分或登记拆分任务。
- 已完成 TODO 必须打勾，并补充日期、evidence refs、验证命令和最终状态。

## 当前任务板

### P0：Pane 类型迁移

- [x] 将旧 `Screen` tab 文案、路由和模型迁移为 Image / Evidence。
- [x] 保留 legacy screen refs 兼容读取，但输出统一 image evidence projection。
- [x] Right Pane shell 不再把 screenshot/replay/frame 宣称为 live control surface。

完成记录（2026-06-03）：

- evidence refs：`computer-use:session/run-screen/frames/latest.png`、`computer-use:session/run-frame-array/frames/1.png`、`browser-session:abc/dom.json`、`artifact:figure-1/manifest.json`。
- 验证命令：`node --import tsx --test packages/presentation/components/image-evidence-viewer/render.test.tsx src/ui/src/app/results/imagePaneModel.test.ts src/ui/src/app/results/rightPaneSurfaceAdapter.test.ts src/ui/src/app/ResultsRenderer.test.ts`。
- 最终状态：passed。Right Pane 将视觉证据路由到 Image / Evidence，不再把 legacy frame/replay 当作 live control surface；旧 `virtual-screen-viewer` 仅保留 deprecated compatibility renderer，不作为新产品 pane。

### P0：对象路由

- [x] `browser:*` / URL refs 聚焦 Browser pane。
- [x] `annotation:*` / `image:*` / `screenshot:*` / `crop:*` refs 聚焦 Image pane。
- [x] `terminal:*` / `terminal-transcript:*` refs 聚焦 Terminal pane。
- [x] `file:*` / workspace path refs 聚焦 Files pane。
- [x] `trace:*` / `run:*` / `subagent:*` refs 聚焦 References pane。

完成记录（2026-06-03）：

- evidence refs：`browser:*`、`url:*`、`annotation:*`、`image:*`、`terminal:*`、`file:*`、`trace:*`。
- 验证命令：`node --import tsx --test src/ui/src/app/ResultsRenderer.test.ts src/ui/src/app/results/rightPaneSurfaceAdapter.test.ts src/ui/src/app/results/imagePaneModel.test.ts src/ui/src/app/results/browserPaneModel.test.ts`。
- 最终状态：passed。对象 refs 通过 typed focus/open action 路由到对应 pane；点击 ref 不会隐式插入 composer 或触发 provider action。

### P1：Shell 简化

- [ ] Right Pane shell 只保留 tab lifecycle、active pane、focus dispatch 和 empty state。
- [ ] Browser/Image/Terminal/Files/References 的 projection adapter 都在各自 focused helper 中维护。
- [ ] 如果 `ResultsRenderer.tsx` 或相关业务文件超过约 2000 行，必须继续拆分或登记。

拆分登记（2026-06-03）：`ResultsRenderer.tsx` 当前约 258 行，不触发阈值；`src/ui/src/app/chat/cursorAgentProcess.ts` 和 `src/ui/src/api/sciforgeToolsClient/runtimeEvents.ts` 超过约 2000 行，已在 [`PROJECT_middle.md`](PROJECT_middle.md) 登记。

## Terminal Live PTY 豁免

Terminal pane 可以连接 Workspace Writer 管理的 shell PTY，输入、resize、stop 走 terminal WebSocket 控制面。

豁免边界：

- 只适用于 Terminal pane。
- 进程生命周期、cwd、transcript mirror 和 stop 仍由 host 拥有。
- terminal transcript 只能作为 terminal/provenance ref，不作为任务完成判定。
- Browser/Image/Files/References 不继承这个豁免。

## 验收规则

- 文档改动：`git diff --check`。
- Right Pane shell 改动：运行 result pane lifecycle / focus route focused tests。
- Image 迁移改动：运行 Image pane focused tests，并确认旧 Screen 不再宣称 live control。
- Terminal 改动：覆盖 running/completed/error/stopped PTY lifecycle。

## 相关文档

- [`PROJECT_browser.md`](PROJECT_browser.md)
- [`PROJECT_image.md`](PROJECT_image.md)
- [`PROJECT_annotation.md`](PROJECT_annotation.md)
- [`PROJECT_window_action.md`](PROJECT_window_action.md)
- [`docs/BrowserRuntimeArchitecture.md`](docs/BrowserRuntimeArchitecture.md)
- [`docs/VirtualAppScreenArchitecture.md`](docs/VirtualAppScreenArchitecture.md)
