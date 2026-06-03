# SciForge 文档

最后更新：2026-06-03

## 当前结论

SciForge GUI 是 Agent Host 的确定性体验扩展。Agent Host 拥有 planning、provider routing、action、verification 和 trace；GUI 负责 presentation、annotation、focus、confirmation 和 refs projection。

M1 当前主线：

- Browser Pane：Desktop Electron native host 内的真实浏览器。
- Global Annotation：像 Codex 一样把标注作为下一条用户消息的 pending context。
- Image / Evidence Pane：右侧通用图片证据展示区，替代旧 Screen pane。
- Window Action Session：agent 以 actorCursor 操作用户加入的真实窗口。

旧的隔离 `VirtualAppScreen` 产品需求已废弃。

## 权威文档

| 文档 | 状态 | 用途 |
| --- | --- | --- |
| [`Architecture.md`](Architecture.md) | 当前总架构 | Agent Host Semantic Pipeline、GUI-as-extension、模块归属。 |
| [`TuiGuiProtocol.md`](TuiGuiProtocol.md) | 当前协议 | GUI 输入、只读投影、declared GUI intents 和执行边界。 |
| [`SemanticModuleEngineering.md`](SemanticModuleEngineering.md) | 模块工程范式 | `module.describe/query/read/invoke`、Root Agent Host、L1 Module Host。 |
| [`BrowserRuntimeArchitecture.md`](BrowserRuntimeArchitecture.md) | Browser 架构 | BrowserHostSession、Electron `WebContentsView`、workspace profile、annotation/evidence。 |
| [`VirtualAppScreenArchitecture.md`](VirtualAppScreenArchitecture.md) | Screen/Annotation/Image/Window 架构 | 说明旧 VirtualAppScreen 废弃，并定义 Global Annotation、Image Evidence 和 Window Action。 |
| [`NativeExtensionOwnershipMap.md`](NativeExtensionOwnershipMap.md) / [`native-extension-ownership-map.json`](native-extension-ownership-map.json) | 归属图 | native extension 和 module ownership。若旧 VirtualAppScreen 叙述与当前 PROJECT 冲突，以当前 PROJECT 和本 README 为准并登记迁移。 |
| [`Usage.md`](Usage.md) | 操作手册 | 当前启动、配置、验证命令；描述现状，不覆盖产品职责边界。 |
| [`FeedbackInboxDesignPrinciples.md`](FeedbackInboxDesignPrinciples.md) | 反馈原则 | annotation、feedback inbox、repair 和审计边界。 |

## 活跃 PROJECT 入口

- [`../PROJECT.md`](../PROJECT.md)：总协议。
- [`../PROJECT_browser.md`](../PROJECT_browser.md)：Browser Pane。
- [`../PROJECT_annotation.md`](../PROJECT_annotation.md)：统一 Annotation。
- [`../PROJECT_image.md`](../PROJECT_image.md)：Image / Evidence Pane。
- [`../PROJECT_window_action.md`](../PROJECT_window_action.md)：Window Action Session。
- [`../PROJECT_desktop.md`](../PROJECT_desktop.md)：Desktop native host。
- [`../PROJECT_CU.md`](../PROJECT_CU.md)：旧 Computer Use / VirtualAppScreen 兼容入口。

## 核心规则

1. 所有修改必须通用，不能为当前页面、截图、URL、文件名或历史 run 写硬编码补丁。
2. 代码路径保持唯一真相源；旧逻辑和最终方案冲突时删除或迁移旧逻辑，不做长期并行实现。
3. GUI 不做 provider route、capability ranking、completion 判断、workspace 写入、Computer Use 执行或隐藏 prompt assembly。
4. 大 payload 和敏感材料必须 refs-first；日志和 evidence 必须脱敏。
5. 业务代码单文件超过约 2000 行时必须拆分或登记拆分任务。
6. 已完成 TODO 必须打勾，并补充日期、evidence refs、验证命令和最终状态。

## 当前验证入口

- 纯文档改动：`git diff --check`。
- JSON manifest 改动：`node -e "JSON.parse(require('fs').readFileSync('<file>','utf8'))"`。
- Browser runtime 改动：Browser focused tests + Desktop native smoke。
- Annotation/Image/Window Action 改动：focused projection/contract tests + Desktop overlay/capture evidence。

迁移前旧方案保存在 [`../docs_old`](../docs_old)，只作为历史对照和迁移输入；不要再把它当作当前架构真相源。
