# SciForge Computer Use 兼容入口

最后更新：2026-06-03

## 当前决定

旧的隔离 `VirtualAppScreen` 产品需求已废弃，不再作为 M1、M2 或 future
requirement 保留。

活跃需求已拆分到：

- [`PROJECT_annotation.md`](PROJECT_annotation.md)：全局评论和统一 annotation refs。
- [`PROJECT_image.md`](PROJECT_image.md)：通用 Image / Evidence Pane，替代旧 Screen pane 展示职责。
- [`PROJECT_window_action.md`](PROJECT_window_action.md)：agent 操作真实应用窗口。
- [`PROJECT_desktop.md`](PROJECT_desktop.md)：Desktop overlay、窗口捕获和 native bridge。

Computer Use 以后只作为 `WindowActionSession` 的 action adapter 来源之一；它不再定义独立的虚拟屏幕产品心智。

## 不可变规则

- 不再新增以隔离虚拟屏幕为目标的 active task。
- 旧代码或文档若与 Screen Annotation / Image Evidence / Window Action 冲突，必须删除或迁移，不做长期并行实现。
- GUI 只展示 refs、图片证据、标注和操作状态；agent/provider action 归 Window Action / Agent Host 所有。
- 大 payload、截图、录屏、provider payload、clipboard、IME、secret 必须 refs-first 并脱敏。
- 已完成 TODO 必须打勾，并补充日期、evidence refs、验证命令和最终状态。

## 当前任务板

### P0：旧路线迁移

- [ ] 将 UI 文案中的 `VirtualAppScreen` 迁移为 Image / Evidence、Annotation 或 Window Action。
- [ ] 将 smoke/manifest 中的隔离虚拟屏幕验收降级为 historical compatibility，不能阻塞当前路线。
- [ ] 删除 noVNC、Xvfb、Xpra、virtual display、driver-first 等旧 product pass 叙述。

### P1：Computer Use 重新定位

- [ ] 将 Computer Use executor 接入 `WindowActionSession` action router。
- [ ] Computer Use evidence 输出统一为 annotation/image/window action refs。
- [ ] 保留 Accessibility/UI Automation/AT-SPI/system input 作为 adapter，而不是产品心智。

## 验收规则

- 文档改动：`git diff --check`。
- Computer Use adapter 改动：必须证明 action 归属在 `WindowActionSession` / Agent Host，GUI 不直接执行。
- 历史 smoke 保留时必须标记为 historical/compatibility，不得输出当前 product pass。

## 相关文档

- [`docs/VirtualAppScreenArchitecture.md`](docs/VirtualAppScreenArchitecture.md)
- [`PROJECT_annotation.md`](PROJECT_annotation.md)
- [`PROJECT_image.md`](PROJECT_image.md)
- [`PROJECT_window_action.md`](PROJECT_window_action.md)
- [`PROJECT_desktop.md`](PROJECT_desktop.md)
