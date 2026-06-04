# SciForge Computer Use 兼容入口

最后更新：2026-06-04

## 当前决定

旧的隔离 `VirtualAppScreen` 产品需求已废弃，不再作为 M1、M2 或 future
requirement 保留。

活跃需求已拆分到：

- [`PROJECT_annotation.md`](PROJECT_annotation.md)：全局评论和统一 annotation refs。
- [`PROJECT_image.md`](PROJECT_image.md)：通用 Image / Evidence Pane，替代旧 Screen pane 展示职责。
- [`PROJECT_window_action.md`](PROJECT_window_action.md)：agent 操作真实应用窗口。
- [`PROJECT_desktop.md`](PROJECT_desktop.md)：Desktop overlay、窗口捕获和 native bridge。

Computer Use 以后只作为 `WindowActionSession` 的 action/input adapter 来源之一；它不再定义独立的虚拟屏幕产品心智。

当前推荐路线是 **Visible Window Action Session**：

```text
annotation refs + mutating user intent
  -> Agent Host 自动进入或复用 WindowActionSession
  -> actorCursor(agent)
  -> ScopedInputAdapter(agent session)
  -> Action Adapter
  -> before/after evidence
```

目标应用可以真实打开在显示器上，也可以放到后层；不再要求 app 后台静默执行。每个 agent 会话拥有自己的逻辑输入 adapter 和 actorCursor。凡是需要真实系统焦点、键盘、pointer、菜单栏或 IME 的动作进入全局 `FocusLease` 串行执行；M1 不做权限系统或高风险审批，agent 可以自由操作目标窗口，但必须保留 pause、stop、remove、visible status 和 evidence timeline。

## 不可变规则

- 不再新增以隔离虚拟屏幕为目标的 active task。
- 旧代码或文档若与 Screen Annotation / Image Evidence / Window Action 冲突，必须删除或迁移，不做长期并行实现。
- GUI 只展示 refs、图片证据、标注和操作状态；agent/provider action 归 Window Action / Agent Host 所有。
- Annotation 只负责 pending context 和 target binding；它不执行 action，也不拥有 input adapter。
- bound annotation 携带修改意图时，由 Agent Host 自动创建或复用 WindowActionSession，不需要额外“是否允许 agent 操作窗口”的确认。
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
- [ ] 定义 agent session 级 `ScopedInputAdapter`，每个 agent 拥有独立 actorCursor、输入队列和 adapter refs。
- [ ] 定义 `FocusLease`：非抢焦点 adapter 可并行，真实系统输入/焦点接管串行。
- [ ] 保留 Accessibility/UI Automation/AT-SPI/system input 作为 adapter，而不是产品心智。
- [ ] 将 manual-bound 或高置信度 auto-bound annotation + 修改意图自动路由到 WindowActionSession。

## 验收规则

- 文档改动：`git diff --check`。
- Computer Use adapter 改动：必须证明 action 归属在 `WindowActionSession` / Agent Host，GUI 不直接执行。
- annotation-to-action 改动：必须证明 Annotation 只产生 refs，自动进入 WindowActionSession 由 Agent Host 触发。
- scoped input 改动：必须证明每个 agent session 有独立 actorCursor / input adapter refs，focus-required action 使用 FocusLease。
- 历史 smoke 保留时必须标记为 historical/compatibility，不得输出当前 product pass。

## 相关文档

- [`docs/VirtualAppScreenArchitecture.md`](docs/VirtualAppScreenArchitecture.md)
- [`PROJECT_annotation.md`](PROJECT_annotation.md)
- [`PROJECT_image.md`](PROJECT_image.md)
- [`PROJECT_window_action.md`](PROJECT_window_action.md)
- [`PROJECT_desktop.md`](PROJECT_desktop.md)
