# SciForge Window Action 项目协议

最后更新：2026-06-03

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

## 不可变规则

- 一个 agent 拥有一个 actorCursor；颜色、名字和状态随 agent 身份移动。
- WindowActionSession 只管理目标窗口、坐标转换、当前 actor、动作状态和 evidence refs。
- 底层操作方式不限，但必须通过 action adapter：Browser/CDP/Playwright、app-native command、Accessibility/UI Automation/AT-SPI、system input。
- M1 不把权限系统作为核心阻塞；但必须提供 pause、stop 和 remove window 的产品刹车。
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

## 验收规则

- 文档改动：`git diff --check`。
- actorCursor 改动：运行 Browser/Window projection focused tests。
- action router 改动：验证 GUI 不直接执行 action，action owner 在 Agent Host / adapter。
- system input 改动：必须有 pause/stop/remove window 和 bounded evidence。

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

## 相关文档

- [`PROJECT_annotation.md`](PROJECT_annotation.md)
- [`PROJECT_image.md`](PROJECT_image.md)
- [`PROJECT_desktop.md`](PROJECT_desktop.md)
- [`docs/VirtualAppScreenArchitecture.md`](docs/VirtualAppScreenArchitecture.md)
