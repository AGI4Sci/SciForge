# SciForge Window Action 项目协议

最后更新：2026-06-04

## 当前目标

Window Action Session 让 agent 操作用户加入 SciForge 的真实应用窗口。应用照常打开在系统桌面上；SciForge 不创建隔离虚拟屏幕。

产品心智：

```text
agent 拥有 actorCursor
  -> actorCursor 进入目标 WindowActionSession
  -> UI 显示该 agent 正在观察、点击、输入或等待
  -> action adapter 选择最合适的底层执行方式
```

`actorCursor` 以 agent 为单位设计，不以窗口为单位设计。窗口只是 target。

2026-06-04 设计修正：Annotation 的窗口绑定不是执行层本身，但 bound annotation 可以触发自动 Window Action。

- `Screen region` 高置信度自动绑定可以产生 `windowRef` 和 `windowLocalBounds`；当下一条用户消息是修改意图时，Agent Host 可以自动创建或复用 WindowActionSession。
- `Screen region` 低置信度默认不绑定窗口，也不能把最高候选当成 action target。
- `App window` 评论是显式窗口绑定；当下一条用户消息是修改意图时，自动进入 WindowActionSession，不需要额外确认。
- 评论取证不需要每个 app 单独适配；app 专用 adapter 只属于 Action Adapter 层。

## 不可变规则

- 一个 agent 拥有一个 actorCursor；颜色、名字和状态随 agent 身份移动。
- 每个 agent session 拥有一个 `ScopedInputAdapter`，包含输入队列、lease、target window 和 evidence refs。
- WindowActionSession 只管理目标窗口、坐标转换、当前 actor、动作状态和 evidence refs。
- WindowActionSession 可消费 `manual-bound` 或高置信度 `auto-bound` 的 annotation metadata，但不得消费 `unbound` / low-confidence candidates 作为操作目标。
- `manual-bound` 或高置信度 `auto-bound` annotation + 修改意图自动进入 WindowActionSession；Annotation 本身不执行 action。
- 底层操作方式不限，但必须通过 action adapter：Browser/CDP/Playwright、app-native command、Accessibility/UI Automation/AT-SPI、system input。
- M1 不做权限系统或高风险审批；agent 可以自由操作目标窗口，但必须提供 pause、stop 和 remove window 的产品刹车。
- 非抢焦点 adapter 可并行；需要真实窗口置前、系统键盘、pointer、菜单栏或 IME 的动作进入全局 `FocusLease` 串行执行。
- GUI 不直接执行 provider action；它只显示 cursor、状态、refs 和用户显式操作入口。
- 已完成 TODO 必须打勾，并补充日期、evidence refs、验证命令和最终状态。

## Action Adapter 优先级

```text
1. Browser/CDP/Playwright/WebContentsView action
2. App-native command 或 extension command
3. Accessibility/UI Automation/AT-SPI
4. 受控 system input
```

底层是否真的移动系统鼠标不是产品承诺。产品承诺是：用户能看到哪个 agent 在哪个窗口上执行了什么。

### ScopedInputAdapter / FocusLease

每个 agent session 都有自己的逻辑输入 adapter：

```text
agentSession
  -> actorCursor
  -> ScopedInputAdapter
  -> WindowActionSession
  -> Action Adapter
```

`ScopedInputAdapter` 不承诺真实 OS 有多只独立鼠标。它负责 session-local input queue、input lease、target window、cursor projection 和 evidence。Browser/CDP、app-native command、terminal、部分 Accessibility action 可以并行；focused system input 使用全局 `FocusLease`，一次只允许一个 agent 接管真实桌面焦点。

目标窗口可以真实弹出或放到后层。需要 focus takeover 时允许短暂置前/抢焦点，但 UI 和 evidence 必须显示当前 agent、目标窗口、action status 和 focus lease。

## 当前任务板

### P0：actorCursor

- [x] 定义 actorCursor contract：agent id、颜色、label、状态、target、last action。
- [x] Browser Pane 和 WindowActionSession 共用 actorCursor identity。
- [x] 聊天过程行展示简短操作状态，接近 Codex 风格，不做复杂全局 dashboard。

完成记录（2026-06-03）：

- evidence refs：`browser-host-session:visible-action-session/actor-cursors/cursor-shared-browser.json`、`browser-host-session:visible-action-session/visible-actions/agent-click-visible.json`、`window-action-ref:screenshot-1`、`window-action-ref:actor-cursor-1`。
- 验证命令：`node --import tsx --test src/runtime/window-action-session.test.ts`；`node --import tsx --test src/ui/src/app/results/browserPaneModel.test.ts`；`node --import tsx --test --test-name-pattern "native stream action rows expose kind and status accessibility contract|native stream renders window action events|native stream renders approval choices" src/ui/src/app/chat/RunExecutionProcess.test.ts`。
- 最终状态：passed，actorCursor contract、Browser Pane projection、聊天过程行均为 bounded/ref-first 表达。

### P0：WindowActionSession

- [x] 支持用户把真实窗口加入 SciForge session。
- [x] 记录 windowRef、process/app 信息、bounds、scale、screen id。
- [x] 支持 actor enter/leave、observe、click、type、scroll、wait 等 action event。
- [x] 提供 pause、stop current session、remove window。

完成记录（2026-06-03）：

- evidence refs：`window:chrome:main`、`desktop-window:app:paper-reader:window-42`、`window-action-session:window-action-desktop-window:app:paper-reader:window-42`、`window-action-ref:artifact-0`、`window-action-ref:screenshot-1`。
- 验证命令：`node --import tsx --test src/runtime/window-action-session.test.ts`；`node --import tsx --test tests/smoke/smoke-desktop-window-capture.test.ts`。
- 最终状态：passed，显式 user-selected desktop window capture 会创建 WindowActionSession；WindowActionSession 记录真实窗口引用、窗口几何与 actor/action lifecycle；pause、stop、remove window 均生成 bounded control event，并阻止后续 actor enter/action 把已暂停、停止或移除的 session 重新激活。

### P1：Action Router

- [x] Browser target 路由到 BrowserHostSession / CDP / Playwright adapter。
- [x] VS Code / editor target 优先路由到 extension/app-native command adapter。
- [x] 普通 app target 路由到 Accessibility/UI Automation/AT-SPI adapter。
- [x] system input adapter 必须显式标记为 shared-system-input evidence。

完成记录（2026-06-03）：

- evidence refs：`browser-host-session:visible-action-session/visible-actions/ui-click-visible.json`、`browser-host-session:visible-action-session/actor-cursors/cursor-shared-browser.json`、`app-native-command:vscode:type-1`、`shared-system-input:legacy.canvas:click`。
- 验证命令：`node --import tsx --test src/runtime/window-action-session.test.ts`；`node --import tsx --test src/runtime/browser-host-session.test.ts --test-name-pattern "visible action"`。
- 最终状态：passed，`dispatchWindowAction` 将 route 交给 Agent Host adapter handler，action owner 固定为 Agent Host / adapter，GUI 标记为 `guiExecutable: false`；system input evidence 明确为 `shared-system-input` 且受 bounded refs 限制。

### P1：Annotation Window Binding 消费

- [x] 接收 `App window` 的 `manual-bound` annotation metadata 作为可创建 WindowActionSession 的候选 target。
- [x] 接收 `Screen region` 的高置信度 `auto-bound` metadata 时，只作为解释性 target；进入操作前仍需显式 action flow。
- [x] 拒绝把 `unbound`、`blocked`、low-confidence candidates 或纯 screenshot ref 升级为可操作窗口。
- [x] Action Router 根据 window/app metadata 选择 adapter；没有 app 专用 adapter 时走 Accessibility/UI Automation 或 shared-system-input fallback，并明确标记 evidence。

完成记录（2026-06-04）：

- evidence refs：`desktop-annotation:workspace/workspace-a/session/session-a/annotation/capture-fixed`、`desktop-annotation:workspace/workspace-a/session/session-a/crop/capture-fixed`、`desktop-window:app:paper-reader:window-42`、`window-action-session:annotation-manual-window`、`accessibility-ui-automation:org.sciforge.paper-reader:click`、`shared-system-input:legacy.canvas:click`。
- 验证命令：`node --import tsx --test src/runtime/window-action-session.test.ts src/shared/annotation-reference-contract.test.ts tests/smoke/smoke-desktop-window-capture.test.ts tests/smoke/smoke-desktop-annotation-overlay.test.ts tests/smoke/smoke-desktop-screen-region-auto-binding.test.ts src/ui/src/app/results/imagePaneModel.test.ts src/ui/src/app/SciForgeApp.desktopAnnotation.test.ts packages/presentation/components/image-evidence-viewer/render.test.tsx`；`node --import tsx --test tests/smoke/smoke-desktop-electron-main.test.ts --test-name-pattern "annotation|preload"`；`node --import tsx --test src/runtime/browser-host-session.test.ts --test-name-pattern "visible action"`；`npm run typecheck --silent`。
- 最终状态：passed，annotation metadata 只作为 refs-first 候选/解释性 target 保存；创建 WindowActionSession 必须带显式 action flow；`unbound`、`blocked`、low-confidence candidate 和 image-only refs 均 fail closed；router fallback evidence 明确标记为 Accessibility/UI Automation 或 `shared-system-input`。

2026-06-04 后续修正：产品路线改为 `manual-bound` 或高置信度 `auto-bound` annotation + 修改意图自动进入 WindowActionSession。以上完成记录仍证明旧边界下不会从 `unbound`/low-confidence/image-only refs 升级为可操作窗口；新的自动进入规则需要单独实现和验收。

### P0：Automatic Window Action

- [ ] Agent Host 识别携带 annotation refs 的修改意图，并自动创建或复用 WindowActionSession。
- [ ] `manual-bound` annotation 自动路由到目标 windowRef。
- [ ] 高置信度 `auto-bound` annotation 自动路由到目标 windowRef。
- [ ] `unbound`、`blocked`、low-confidence candidates 和 image-only refs 不自动执行，只作为上下文。
- [ ] 自动进入 WindowActionSession 时写入 source annotation refs、actorCursor refs、ScopedInputAdapter refs 和 before/after evidence refs。

### P0：ScopedInputAdapter / FocusLease

- [ ] 为每个 agent session 定义 `ScopedInputAdapter` contract。
- [ ] WindowActionSession action event 记录 `scopedInputAdapterRef`。
- [ ] Browser/app-native/Accessibility 等非抢焦点 adapter 支持并行调度。
- [ ] focused system input 使用全局 `FocusLease` 串行。
- [ ] UI/action evidence 展示 focus takeover 的 actor、target window、开始/结束和 action refs。

## 验收规则

- 文档改动：`git diff --check`。
- actorCursor 改动：运行 Browser/Window projection focused tests。
- action router 改动：验证 GUI 不直接执行 action，action owner 在 Agent Host / adapter。
- annotation window binding 改动：验证 `unbound` 不会创建 WindowActionSession。
- automatic window action 改动：验证 bound annotation + 修改意图自动进入 WindowActionSession，且 Annotation 不直接执行 action。
- scoped input 改动：验证每个 agent session 有独立 actorCursor / ScopedInputAdapter refs。
- system input 改动：必须有 FocusLease、pause/stop/remove window 和 bounded evidence。

验收记录（2026-06-03）：

- `node --import tsx --test src/runtime/window-action-session.test.ts`
- `node --import tsx --test src/runtime/browser-host-session.test.ts --test-name-pattern "visible action"`
- `node --import tsx --test src/ui/src/app/results/browserPaneModel.test.ts`
- `node --import tsx --test --test-name-pattern "native stream action rows expose kind and status accessibility contract|native stream renders window action events|native stream renders approval choices" src/ui/src/app/chat/RunExecutionProcess.test.ts`
- `node --import tsx --test src/ui/src/app/results/imagePaneModel.test.ts`
- `node --import tsx --test tests/smoke/smoke-desktop-window-capture.test.ts`
- `npm run typecheck`
- `git diff --check`
- 最终状态：passed，focused tests、typecheck 和 diff whitespace check 均已通过。

验收记录（2026-06-04）：

- `node --import tsx --test src/runtime/window-action-session.test.ts src/shared/annotation-reference-contract.test.ts tests/smoke/smoke-desktop-window-capture.test.ts tests/smoke/smoke-desktop-annotation-overlay.test.ts tests/smoke/smoke-desktop-screen-region-auto-binding.test.ts src/ui/src/app/results/imagePaneModel.test.ts src/ui/src/app/SciForgeApp.desktopAnnotation.test.ts packages/presentation/components/image-evidence-viewer/render.test.tsx`
- `node --import tsx --test tests/smoke/smoke-desktop-electron-main.test.ts --test-name-pattern "annotation|preload"`
- `node --import tsx --test src/runtime/browser-host-session.test.ts --test-name-pattern "visible action"`
- `npm run typecheck --silent`
- `git diff --check`
- 最终状态：passed，P1 Annotation Window Binding 消费完成并通过 focused tests、typecheck 和 diff whitespace check。

## 相关文档

- [`PROJECT_annotation.md`](PROJECT_annotation.md)
- [`PROJECT_image.md`](PROJECT_image.md)
- [`PROJECT_desktop.md`](PROJECT_desktop.md)
- 已删除的历史 VirtualAppScreen 设计文档。
