# SciForge Desktop / Action 任务板

最后更新：2026-06-04

## 当前目标

本文件合并 Desktop native host、Annotation、Image evidence 接入、Window Action 和 Computer Use adapter 任务。目标是实现 Codex-like 的两件事：

```text
圈选内容变成上下文
agent 可见地操作真实窗口
```

目标应用可以真实打开在显示器上，也可以放到后层。需要真实系统焦点、键盘、pointer、菜单栏或 IME 时，agent 可以短暂接管焦点；多个非抢焦点 adapter 可以并行，抢焦点动作通过全局 FocusLease 串行。

## 设计原则

- Annotation 只产生 refs-first context 和 target binding，不执行 action，不拥有 input adapter。
- bound annotation + 修改意图由 Agent Host 自动进入或复用 WindowActionSession。
- WindowActionSession 管理 target window、actorCursor、ScopedInputAdapter、pause/stop/remove 和 evidence refs。
- Computer Use 只是 action/input adapter provider；算法文档见 `packages/actions/computer-use/vision_computer_use_agent_mvp.md`。
- M1 不做权限系统或高风险审批；agent 可以自由操作目标窗口，但 UI 必须保留 pause、stop、remove 和 action timeline。
- Browser/CDP、app-native command、terminal、部分 Accessibility action 优先于 focused system input。
- 大 payload、截图、录屏、provider payload、clipboard、IME、secret 必须 refs-first 并脱敏。
- 旧 VirtualAppScreen、noVNC、Xpra、virtual display、driver-first product pass 只保留为 historical compatibility 或 backend research。

## 当前任务

### P0：Annotation Context

- [x] 顶部 Annotate 提供 `SciForge page`、`Screen region`、`App window` 三种模式。
- [x] Screen region 使用 overlay 获取准确 `screenBounds`，并在高置信度时自动绑定窗口。
- [x] App window 先显式选择真实窗口，再在窗口内框选并产生 `windowRef` / `windowLocalBounds`。
- [x] annotation refs 随下一条用户消息进入 thread。
- [ ] `manual-bound` 或高置信度 `auto-bound` annotation + 修改意图自动进入 WindowActionSession。
- [ ] `unbound`、`blocked`、low-confidence candidates 和 image-only refs 不自动执行，只作为上下文。

### P0：Window Action

- [x] actorCursor contract 覆盖 agent id、颜色、label、状态、target、last action。
- [x] WindowActionSession 记录 windowRef、app/process metadata、bounds、scale、screen id。
- [x] pause、stop current session、remove window 阻止后续 action 继续激活目标。
- [ ] 为每个 agent session 定义 `ScopedInputAdapter` contract。
- [ ] WindowActionSession action event 记录 `scopedInputAdapterRef`。
- [ ] 自动进入 WindowActionSession 时写入 source annotation refs、actorCursor refs、ScopedInputAdapter refs 和 before/after evidence refs。

### P0：FocusLease / Visible Takeover

- [ ] Browser/app-native/terminal/Accessibility 等非抢焦点 adapter 支持并行调度。
- [ ] focused system input 使用全局 `FocusLease` 串行。
- [ ] UI/action evidence 展示 focus takeover 的 actor、target window、开始/结束和 action refs。
- [ ] 目标窗口可以弹出或放到后层；需要真实焦点时允许短暂置前/抢焦点。

### P1：Desktop Native Host

- [x] Desktop app 稳定 attach/detach/resize `WebContentsView` Browser surface。
- [x] Desktop preload 暴露 bounded annotation bridge，不暴露 raw screenshot/base64/provider payload/unbounded window list。
- [x] macOS window/screen capture 优先 ScreenCaptureKit，fallback 使用 bounded `screencapture -R`。
- [x] Desktop dev shell 支持 Vite + Workspace Writer/runtime + Electron native adapter。
- [ ] 每轮 action/annotation/browser native 改动都在 Desktop app 验证真实 native path。

### P1：Computer Use Adapter

- [ ] 将 Computer Use executor 接入 WindowActionSession action router。
- [ ] Computer Use evidence 输出统一为 annotation/image/window action refs。
- [ ] Host adapter 返回 current observation、target/session refs、executor event、before/after evidence、verification/artifact refs 和 side-effect flags。
- [ ] 旧 virtual-screen smoke/manifest 降级为 historical compatibility，不阻塞当前路线。

## 验收规则

- 文档改动：`git diff --check`。
- Annotation 改动：验证 pending context、refs-first capture、高置信度 auto-bound、低置信度 unbound。
- Automatic Window Action 改动：验证 bound annotation + 修改意图自动进入 WindowActionSession，且 Annotation 不直接执行 action。
- ScopedInputAdapter 改动：验证每个 agent session 有独立 actorCursor / input adapter refs。
- FocusLease 改动：验证 focus-required action 串行，并有 pause/stop/remove 与 bounded evidence。
- Desktop native 改动：运行 desktop focused smoke；真实 Browser/overlay/capture 不能用 Web dev 截图冒充。
- Computer Use 改动：验证 action 归属 WindowActionSession / Agent Host，GUI 不直接执行。

## 历史任务板

旧分散任务板已归档到 `docs/archive/project-tasks-2026-06-04/`。
