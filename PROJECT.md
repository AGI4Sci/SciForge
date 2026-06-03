# SciForge 项目协议

最后更新：2026-06-03

## 当前目标

SciForge 是一个 **Agent Host Semantic Pipeline + Cursor-like Agent Workbench**。
Codex app-server / Desktop native host 是产品 runtime 主路径；GUI 是
presentation、confirmation、focus 和 resource projection，不是第二个 agent host。

当前 M1 收敛为三条可并行主线：

- Browser Pane：右侧栏内真实浏览器，Desktop Electron native host 承载真实网页。
- Global Annotation：像 Codex 一样把标注作为 pending context，随下一条用户消息提交。
- Window Action：真实应用窗口正常打开，agent 用自己的 actorCursor 操作目标窗口。

旧的隔离 `VirtualAppScreen` 产品需求已废弃；右侧 `Screen` pane 升级为通用
Image / Evidence 展示栏。

## 不可变规则

- 所有修改必须通用，不能为当前页面、截图、URL、文件名或历史 run 写硬编码补丁。
- 代码路径保持唯一真相源；旧逻辑和最终方案冲突时删除或迁移旧逻辑，不做长期并行实现。
- GUI -> TUI 只发送终端等价文本、focus/confirmation 结果或只读 projection；TUI -> GUI 只通过 declared GUI intents。
- 大 payload、截图、录屏、terminal transcript、DOM snapshot、artifact、audit 和 replay 必须 refs-first；不得内联 raw screenshot/base64/provider payload/secret。
- 涉及 provider URL、API key、model name、Authorization、token、secret、password、credential 的日志和 evidence 必须脱敏；ignored local config 不得提交。
- 业务代码单文件超过约 2000 行时必须拆分或登记拆分任务。
- 已完成 TODO 必须打勾，并补充日期、evidence refs、验证命令和最终状态。

## 活跃项目板

- [`PROJECT_browser.md`](PROJECT_browser.md)：内置浏览器 Browser Pane。
- [`PROJECT_annotation.md`](PROJECT_annotation.md)：统一标注和 refs。
- [`PROJECT_image.md`](PROJECT_image.md)：通用 Image / Evidence Pane。
- [`PROJECT_window_action.md`](PROJECT_window_action.md)：Window Action Session 和 actorCursor。
- [`PROJECT_desktop.md`](PROJECT_desktop.md)：Desktop Electron native host、overlay 和 native bridge。
- [`PROJECT_right.md`](PROJECT_right.md)：右侧结果栏 shell、tab、focus 和对象投影。
- [`PROJECT_left.md`](PROJECT_left.md)：左侧栏和 workspace/thread 管理。
- [`PROJECT_middle.md`](PROJECT_middle.md)：中间聊天区和过程展示。
- [`PROJECT_CU.md`](PROJECT_CU.md)：旧 Computer Use / VirtualAppScreen 兼容入口，活跃任务已迁出。

## 当前任务板

### P0：文档真相源收敛

- [ ] 将旧 `VirtualAppScreen` 术语从活跃产品文档中迁移到
  Screen Annotation、Image Evidence 和 Window Action。
- [ ] 更新代码注释、manifest 和 smoke 命名，避免把隔离虚拟屏幕作为当前或未来需求。
- [ ] 保持 `docs/README.md`、`PROJECT_*.md` 和架构文档入口互相一致。

### P1：Cursor-like Workbench 收敛

- [ ] Browser、Image、Terminal、Files、References 都按对象 refs 打开右侧 pane。
- [ ] annotation refs 随用户消息进入 chat，不自动生成任务、不自动触发 agent。
- [ ] agent actorCursor 在 Browser pane 和真实窗口目标上保持同一身份投影。

## 验收规则

- 纯文档改动：运行 `git diff --check`。
- PROJECT / docs 入口改动：运行链接和关键术语检查，确认活跃入口不再把旧隔离
  `VirtualAppScreen` 当作当前路线。
- Shared contract / TypeScript policy 改动：运行 focused Node tests 和
  `npm run typecheck --silent`。
- Runtime adapter 改动：运行 adapter normalization tests、runtime event tests 和
  `git diff --check`。
- GUI module / result pane 改动：运行 GUI protocol/controller tests、runtime events
  client tests、pane focused tests，并确认 GUI 没有越权执行 agent/provider action。

## 必读文档

- [`docs/README.md`](docs/README.md)：当前文档入口。
- [`docs/Architecture.md`](docs/Architecture.md)：总架构、Agent Host Semantic Pipeline 和 GUI-as-extension。
- [`docs/TuiGuiProtocol.md`](docs/TuiGuiProtocol.md)：GUI 输入、只读投影和执行边界。
- [`docs/BrowserRuntimeArchitecture.md`](docs/BrowserRuntimeArchitecture.md)：Browser Runtime 架构。
- [`docs/VirtualAppScreenArchitecture.md`](docs/VirtualAppScreenArchitecture.md)：Screen Annotation / Image Evidence / Window Action 架构。

## Worktree 规则

- 开发默认在 `dev` 分支；长期分支尽量只保留 `main` 和 `dev`。
- `config.local.json`、`config.computer-use.local.json`、`.sciforge/**`、package caches、runtime homes 等本地状态不得进入 Git。
- 不使用 `git reset --hard` 或 `git checkout --` 擦除用户改动。
- 只清理明确的 generated caches、temporary workspaces 和 build outputs。
