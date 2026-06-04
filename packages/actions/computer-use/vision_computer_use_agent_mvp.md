# Computer Use: Visible Window Action MVP

版本：v0.7-visible-window-action
日期：2026-06-04

## 1. 当前决定

Computer Use 不再定义独立的 `VirtualAppScreen` 产品心智，也不再追求默认后台静默执行、虚拟显示器或完整隔离桌面。

当前产品目标是：

```text
Annotation refs / user intent
  -> Agent Host
  -> WindowActionSession
  -> actorCursor(agent)
  -> ScopedInputAdapter(agent session)
  -> Action Adapter
  -> before/after evidence + Image/Evidence Pane
```

对用户来说，它像 Codex app 的可见操作体验：用户可以圈选内容作为上下文；当用户说“把这里改成 X”时，agent 自动进入对应真实窗口，用自己的 actorCursor 可见地操作窗口。目标应用可以真实打开在显示器上，也可以放在后层；不再要求目标 app 静默跑在后台或虚拟屏幕里。

Computer Use 是 Window Action 的 action/input adapter provider。它不拥有 annotation，不渲染 GUI，不判定用户级完成，不直接调用 GUI，也不再维护 `virtual-app-screen-user-acceptance` 作为 active product gate。

## 2. 非目标和边界

当前路线刻意不追求：

- 每个 agent 都有真正 OS 级独立鼠标键盘。
- 每个窗口都有独立 virtual display。
- 默认启动 VM / microVM / noVNC / Xpra / RDP / virtual desktop。
- 后台静默控制所有 app。
- 用截图、replay 或 Image pane 冒充 live control surface。
- GUI 直接执行 Computer Use action。

可以保留的历史能力：

- 旧 VirtualAppScreen、native driver、Xpra、noVNC、virtual display smoke 作为 historical compatibility、diagnostic 或 backend research。
- 历史 manifest 和 evidence validator 可以保留，但不得输出当前 product pass。
- VM / remote desktop 可以作为未来特殊 backend，用于不可信任务、高隔离复现实验或特殊 OS 依赖；不是 M1/M2 默认路线。

## 3. L2 / L1 / L0 放置

Computer Use 仍然不是第二个任务大脑。

```text
L2 Root Agent Host
  -> owns planning, intent classification, automatic WindowAction entry,
     completion, repair, approval policy if introduced later

L1 Window Action / Computer Use Adapter Layer
  -> WindowActionSession refs
  -> actorCursor refs
  -> ScopedInputAdapter refs
  -> ActionAdapter readiness
  -> FocusLease for focus-required actions
  -> before/after evidence and replay refs

L0 Handlers
  -> observe | ground | propose | execute | verify | writeTrace | emitEvent
```

Annotation 和 Computer Use 必须分开：

- Annotation 只产生 `annotationRef`、`imageRef`、`targetRef`、`windowBinding` 和 pending context。
- Agent Host 判断用户意图是否需要 action。
- WindowActionSession 管理目标窗口、actor cursor、session state 和 user control。
- Computer Use 提供 action/input adapter，不拥有产品心智。

## 4. 自动进入 Window Action

当下一条用户消息携带 annotation refs 并表达修改意图时，Agent Host 自动进入或复用 WindowActionSession：

```text
annotationRef + "把这里改成 X"
  -> target binding check
  -> manual-bound or high-confidence auto-bound windowRef
  -> create/reuse WindowActionSession
  -> attach actorCursor(agentSessionId)
  -> attach ScopedInputAdapter(agentSessionId)
  -> execute through Action Adapter
  -> write before/after evidence
```

`unbound`、`blocked`、低置信度 candidates 或纯 image/screenshot refs 不能自动升级为可操作窗口。它们仍可作为上下文；如果确实需要 action，Agent Host 应要求用户指定目标窗口或使用 App window annotation。

当前 M1 不做权限系统或高风险审批。agent 可以自由操作目标窗口；产品必须提供 pause、stop current session、remove window、visible actor status 和 evidence timeline。

## 5. WindowActionSession 模型

最小 payload：

```text
WindowActionSession
  sessionId
  workspaceId
  threadId
  targetWindowRef
  targetAppRef
  sourceAnnotationRefs?
  actorCursorRefs
  scopedInputAdapterRefs
  actionTimelineRef
  focusLeaseRef?
  beforeAfterEvidenceRefs
  pauseStopRemoveControlRefs
```

`actorCursor` 以 agent 为单位设计：

```text
ActorCursor
  actorId
  agentSessionId
  color
  label
  status: observing | acting | waiting | paused | stopped
  targetWindowRef?
  lastActionRef?
```

## 6. ScopedInputAdapter

每个 agent 会话都有自己的 `ScopedInputAdapter`。它是逻辑输入通道，负责输入队列、lease、cursor projection 和 evidence；不承诺真实 OS 里存在多只独立鼠标。

```text
ScopedInputAdapter
  adapterRef
  agentSessionId
  actorCursorRef
  targetWindowRef
  inputQueueRef
  inputLeaseRef
  focusLeaseRef?
  adapterKind
  controlMode
  lastActionRef
```

推荐 adapter 顺序：

```text
1. browser/runtime adapter: DOM/CDP/Playwright/WebContentsView
2. app-command adapter: editor extension, notebook protocol, native app command
3. terminal adapter: PTY/session command
4. accessibility adapter: macOS AX / Windows UIA / Linux AT-SPI
5. vision+OCR grounded adapter: screenshot/OCR/VLM grounding plus executable backend
6. focused system input adapter: visible focus takeover, pointer/keyboard/IME
```

非抢焦点 adapter 可以并行。凡是需要真实窗口置前、系统键盘、系统 pointer、菜单栏或 IME 的动作，进入全局 `FocusLease`，串行执行。允许短暂抢焦点或把目标窗口置前，但必须在 UI 和 evidence 中记录：

```text
controlMode: visible-window-control
requiresFocus: true
focusStealAllowed: true
focusLeaseRef
actorCursorRef
targetWindowRef
```

## 7. Evidence 和 Replay

所有大对象都必须 refs-first。禁止把 raw screenshot、base64、provider raw payload、secret、Authorization、token、password 写入 pane state、trace 或长期 evidence。

核心 evidence：

```text
annotationRef
imageRef
targetRef
targetWindowRef
actorCursorRef
scopedInputAdapterRef
inputIntentRef
focusLeaseRef
executorEventRef
beforeFrameRef
afterFrameRef
verificationRef
artifactRef
actionTimelineRef
replayRef
```

每次 mutating action 至少需要：

- target binding ref。
- actor cursor ref。
- scoped input adapter ref。
- executor event ref。
- before/after refs。
- focus lease ref when focus takeover is used。
- verification or result evidence。

Replay viewer 展示 action timeline、actor cursor、target window identity、before/after evidence、pause/stop state 和 refs。Replay、截图或 Image pane 只能作为 evidence，不能成为第二个可交互 surface。

## 8. 完成判断

Computer Use 只能给 domain-local verdict；用户级完成仍由 L2 Root Agent Host 结合 artifact、workflow、verifier 和用户意图判断。

用户级完成至少需要：

- 当前 run bundle 内的 action / verifier / artifact refs。
- 与目标 window/session 匹配的 current evidence。
- action causality，证明结果来自本轮 adapter 执行。
- before/after evidence 或外部系统状态 evidence。
- 如果使用 focus takeover，要有 focus lease 和 actor cursor evidence。

当前 M1 不做权限和风险审批。未来若引入风险策略，应作为 Agent Host policy，而不是 Annotation 或 GUI 直接执行层。

## 9. 当前推荐路线

### 阶段 0：协议收敛

- 删除 active docs 中的 VirtualAppScreen product pass 叙述。
- 定义 `WindowActionSession`、`ActorCursor`、`ScopedInputAdapter`、`FocusLease` schema。
- 定义 annotation-to-window-action 自动触发规则。
- 保持 Image / Evidence Pane presentation-only。

### 阶段 1：核心应用 adapter

- Browser research session：BrowserHostSession / CDP / Playwright / WebContentsView。
- Terminal session：PTY + transcript + command causality。
- Editor / VSCode / Cursor：extension or app-native command adapter。
- Jupyter/notebook：kernel/notebook protocol + rendered evidence。
- PDF/Zotero/Preview：window capture + AX/OCR/vision grounding first。

### 阶段 2：Visible focus takeover

- Window inventory and target binding。
- Accessibility hit test / action provider。
- FocusLease scheduler for system input。
- Actor cursor projection and action timeline。
- Pause / stop / remove controls。

### 阶段 3：科研协作工作流

- 一个 task 下多个 Browser/Terminal/WindowAction sessions。
- 多 agent 分工：查文献、跑实验、看日志、改 notebook、整理报告。
- 非抢焦点 adapter 并行；focus-required action 串行。
- 所有结果投影回 Image/Evidence Pane、Browser Pane、artifact refs 或 chat process rows。

### 阶段 4：强隔离补充

- VM / microVM / remote desktop 仅用于不可信任务、高隔离复现实验或特殊 OS 依赖。
- 不作为默认科研自动化路线。

## 10. 验收分层

### Package-local contract

证明 schema、ledger、adapter facade、sanitizer 和 validator 正确。

### Adapter smoke

每个 adapter 必须证明：

- readiness record 存在。
- target window/session ref 可解析。
- input intent 能转成 executor event。
- before/after evidence 当前且 bundle-local。
- focus takeover 如果发生，必须有 FocusLease evidence。

### Visible Window Action acceptance

证明：

- bound annotation + mutating user intent 能自动进入 WindowActionSession。
- 每个 agent session 拥有独立 actorCursor 和 ScopedInputAdapter。
- Browser/app-native/AX 等非抢焦点 adapter 可以并行。
- focused system input 通过 FocusLease 串行。
- UI 展示当前 agent、目标窗口、动作状态、pause/stop/remove。
- Image/Evidence Pane 展示 before/after evidence，不成为 live control surface。

验收拒绝：

- GUI direct executor。
- annotation 自己执行 action。
- unbound/low-confidence image ref 自动升级为可操作窗口。
- shell 直写 artifact 冒充应用操作。
- old VirtualAppScreen、fixture、noVNC/Xpra/driver smoke 单独写 active product pass。

## 11. 最终判断

推荐产品路线是：

```text
Annotation as context
-> automatic visible WindowActionSession for mutating intent
-> agent-scoped cursor and input adapter
-> adapter-first execution
-> FocusLease for physical desktop takeover
-> refs-first evidence/replay
```

这条路线更接近 Codex app 的用户体验，也更符合当前需求：能圈选内容变成上下文，能让 agent 可见地操作窗口，不再把后台隔离虚拟屏作为默认承诺。
