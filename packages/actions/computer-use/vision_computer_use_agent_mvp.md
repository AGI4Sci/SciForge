# Computer Use: VirtualAppScreen 设计文档

版本：v0.6-native-live-surface
日期：2026-06-02

---

## 1. 核心目标

Computer Use 的产品目标调整为 **科研应用级虚拟屏幕 + package-owned Native Host + native/streaming live surface 单一真相源**，而不是完整虚拟电脑或多物理显示器模拟。

每个虚拟屏幕绑定一个 app/session/window，用户和 agent 在 SciForge 右侧 `Screen` 里看到它、注释它、介入它，并用看起来等效鼠标键盘的方式操纵它。这个 Screen 的唯一交互真相源是 `NativeVirtualAppScreenHost` 拥有的 native/streaming live surface；截图、replay、PDF、document export 或旧 frame 只能是 evidence/artifact，不能成为第二个可交互画面，也不能作为替代交互路径。底层执行优先走 Host 背后的 app-scoped / window-scoped adapter，不移动用户真实鼠标，不抢用户当前物理屏焦点，不把应用窗口弹到用户正在使用的桌面上。

推荐抽象：

```text
Task / Collaboration Space
-> VirtualAppScreen session group
   -> VirtualAppScreen A
      -> targetAppRef / targetWindowRef / sessionRef
      -> liveSurfaceRef / surfaceTransport
      -> frameStreamRef / currentFrameRef evidence
      -> virtualCursor(user)
      -> virtualCursor(agent)
      -> annotationOverlayRefs
      -> inputLeaseRef
      -> actionAdapterRef
   -> VirtualAppScreen B
      -> another app/session/window
EvidenceLedger
ReplayBundle
UserControlPlane
```

对用户来说，它像远程桌面窗口；对系统来说，它是一个 refs-first、可审计、可回放的后台应用控制会话。

单一真相源规则：

- `liveSurfaceRef` 是当前 Screen 的唯一可交互画面。
- `frameStreamRef` 是同一 live surface 的 transport，不是第二个屏幕，也不是替代 surface。
- `currentFrameRef`、`beforeFrameRef`、`afterFrameRef`、PDF、document、replay 只能作为证据和审计材料。
- 无法 attach live surface 时必须返回 `blocked`、`needs-permission`、`requires-handoff` 或 `observe-only`，不能自动切到截图/proxy/replay 来冒充可操作屏幕。

性能路线和 Browser pane 一致：桌面 shell 优先采用 native embedded/presented surface（Browser 对应 Electron `WebContentsView`，Screen 对应 Host-owned app/window/session scoped native surface、WebView/WebContents、offscreen display 或独立 surface）；Web shell 只能采用同一 Host owner stream 的 binary frame / WebRTC / canvas transport，而不是让 viewer 反复拉静态 frame URL。静态 frame route 只能服务 evidence、manual inspection 和 replay materialization；如果 native/live stream 不可用，Screen 必须进入 blocked/handoff/retry 状态，不能启用第二个截图 viewer 作为替代交互路径。

这个方向服务自动化科研场景：

- Browser：论文网站、数据库、仪器 Web UI、内部 dashboard。
- Terminal：脚本、环境、batch job、实验日志。
- Jupyter / notebook：运行、检查、编辑、导出。
- Editor / Cursor / VSCode：代码、配置、实验文档。
- PDF / Zotero / Preview：阅读、标注、抽取证据。
- 表格、CSV、实验记录和自研 GUI。

不把 VM / 完整独立桌面作为默认路线。VM 可以作为未来高隔离或不可信任务 backend，但不是当前产品主路径。

当前 active gate 命名为 `virtual-app-screen-user-acceptance`。它不是单次 click smoke，也不是 M6/native multi-screen 的继续推进；只有当前 run bundle 内的 Native Host session、live surface readiness、adapter readiness、human input accepted 或 automation barrier、frame/input/before-after evidence、artifact/verifier refs、`gui.present` 记录、single-interactive-truth flags 和 isolation flags 同时成立，才可写入用户级验收 manifest。

---

## 2. 非目标和边界

当前路线刻意不追求：

- 每个虚拟屏幕都是完整 OS desktop。
- 每个虚拟屏幕都有真正 OS 级独立鼠标键盘设备。
- 默认运行 VM / microVM / 远程桌面 session。
- 用系统全局鼠标键盘模拟来冒充隔离后台控制。
- 让 GUI 直接调用 Computer Use executor。

可以保留的历史能力：

- M6 native multi-screen evidence、sidecar schema、replay/validator 和 opt-in smoke 是历史基线与回归材料。
- Docker/noVNC/RDP 只作为 legacy diagnostic、historical evidence 或 backend packaging 讨论，不再作为 active product direction。
- 完整 native virtual display、WebContents/WebView surface、offscreen display 或低延迟 stream 是当前高性能 adapter 候选；它们必须绑定到同一个 `VirtualAppScreen` owner session，不能形成第二个执行 owner 或第二个可交互画面。

---

## 3. L2 / L1 / L0 放置

Computer Use 仍然不是第二个任务大脑。

```text
L2 Root Agent Host
  -> Codex app-server production path
  -> Codex CLI/native plugin debug path
  -> owns cross-module planning, approval, repair, completion, pipeline trace

L1 Computer Use Resource Adapter
  -> packages/actions/computer-use/virtual-app-screen-host Native Host
  -> VirtualAppScreen session refs
  -> target app/window/session refs
  -> single live surface / frame / input / replay / evidence refs
  -> adapter readiness and lifecycle
  -> scheduler lease and user-control refs

L0 Handlers
  -> capture | crop | ground | propose | execute | verify | writeTrace | emitEvent
```

L1 可以管理同一 Computer Use 资源域内的 session、cache、refs、events、Host grant、human input queue、automation barrier、adapter readiness、backend lifecycle 和 L0 routing。L1 不做跨模块 planning，不做 capability ranking，不选择跨模块 provider，不直接调用 GUI renderer，不宣布用户级完成。

GUI 只渲染 `VirtualAppScreen` 的 single live surface、overlay、cursor、timeline、approval/control refs 和 terminal-equivalent text。GUI 不执行 Computer Use action，也不把 snapshot/replay 变成第二个可交互屏幕。

`gui.present` 是用户可见 evidence 的一部分，但只证明 Screen viewer 已展示 refs-first projection；它不能替代 action causality、artifact validator、adapter readiness 或 isolation 检查。

---

## 4. VirtualAppScreen 模型

`VirtualAppScreen` 是一个“应用窗口级远程控制面”。它可以显示一个真实原生窗口、一个 browser session、一个 terminal session、一个 notebook、一个 editor buffer，或者一个 app-specific offscreen surface。

最小 payload：

```text
VirtualAppScreen
  screenId
  displayGroupId
  targetAppRef
  targetWindowRef?
  sessionRef
  liveSurfaceRef
  surfaceTransport
  frameStreamRef
  currentFrameRef evidence
  actorCursorRefs
  annotationOverlayRefs
  inputLeaseRef
  actionAdapterRef
  evidenceLedgerRef
  replayRef
  isolation
```

关键 isolation flags：

```text
affectsPhysicalDisplay: false
requiresFocusSteal: false
sharedSystemInputUsed: false
systemPointerMoved: false
systemKeyboardEventsSent: false
backgroundRenderable: true | false
singleInteractiveTruth: true
secondInteractiveSurfacePresent: false
```

如果某个 backend 做不到这些，就必须降级为 `diagnostic`、`observe-only` 或 `requires-user-handoff`，不能作为 isolated background control 通过验收。

---

## 5. Adapter-first 执行模型

用户在 Screen tab 里点击、拖动、输入或按快捷键；这些交互先变成结构化 input intent，然后按真人热路径或自动化 barrier 路径执行：

```text
Human Screen canvas input
-> InputIntent
-> Host sendHumanInput
-> inputAcceptedRef / inputSequence immediately
-> background frame/evidence worker
```

```text
Automation action
-> InputIntent
-> target binding / hit test
-> scheduler lease
-> Host executeAutomationIntent
-> automationBarrierRef
-> before/after capture
-> verifier + evidence ledger + replay
```

推荐 adapter 顺序：

1. **app-command adapter**：应用或插件原生命令，例如 editor extension、notebook protocol、自研 app command bridge。
2. **browser/runtime adapter**：DOM/CDP/BrowserRuntime，用于 web app、论文站点、仪器 Web UI。
3. **terminal adapter**：PTY session、shell command、terminal buffer，不模拟 GUI 键盘。
4. **accessibility adapter**：macOS Accessibility / Windows UIA / Linux AT-SPI，用于标准原生控件。
5. **vision+OCR grounded adapter**：窗口截图 + OCR/VLM/KV-Ground 找目标，再交给可用执行 backend。
6. **Native Host surface adapter**：WebContents/WebView、offscreen display、window compositor stream、WebRTC/canvas stream，用于提供高性能 live surface；真人输入 fire-and-release，自动化输入走 barrier。
7. **system-input handoff / diagnostic escape**：最后手段，必须显式标记非隔离、需要授权、全局串行，不得作为后台隔离成功证据，也不得替代 live surface。

这意味着“虚拟鼠标键盘”是统一交互模型，不要求底层真的存在独立 OS 鼠标键盘。

---

## 6. 后台原生应用窗口

目标体验：

- 用户物理屏幕上不弹出被控应用窗口。
- 应用仍然能渲染、被 capture、被命中控件。
- 用户或 agent 可以在 SciForge Screen tab 中观察或介入。
- 多个 `VirtualAppScreen` 可同时存在，互不污染 evidence 和 input queue。

实现路径按优先级：

```text
app protocol / plugin surface
-> native app/window live surface binding
-> offscreen / hidden display-like surface
-> low-latency streaming surface
-> explicit non-isolated handoff or blocked diagnostic
```

macOS 特别注意：

- hidden/minimized window 不一定持续渲染，也不一定可截图。
- Accessibility 能操作很多标准控件，但并非所有自绘 App 都暴露结构。
- 如果必须 bring-to-front 或 steal focus，就不是后台隔离控制。
- Native/WebContents/WebView/offscreen/streaming live surface 需要单独 capability probe，不能靠文档声明。

因此每个 native adapter 必须先产出 readiness record：

```text
adapterReadinessRef
  appIdentity
  windowIdentity
  captureSupported
  actionSupported
  backgroundRenderable
  liveSurfaceSupported
  surfaceTransport
  singleInteractiveTruth
  affectsPhysicalDisplay
  requiresFocusSteal
  sharedSystemInputUsed
  blockedReason?
```

---

## 7. 注释和修改

VirtualAppScreen 同时承担“注释层”和“控制层”。

注释层是只读 presentation：

- point
- rectangle
- arrow
- highlight
- comment
- agent cursor trace
- target candidate rejection

修改层必须走 Action Loop：

- click
- type_text
- drag
- scroll
- press_key
- menu command
- editor command
- browser command
- notebook run/edit command

注释可以绑定到：

```text
window region ref
AX element ref
DOM element ref
OCR text span ref
visual object ref
artifact/file ref
```

当用户说“把这里改成 X”时，系统应先生成 proposal，说明目标 ref、adapter kind、风险、before evidence 和预期 after evidence。只有低风险且 adapter 支持的修改才能自动执行；高风险动作返回 `needs-confirmation`。

---

## 8. Evidence Ledger 和 Replay

所有大对象都必须 refs-first。禁止把 raw screenshot、base64、provider raw payload、secret、Authorization、token、password 写入 pane state、trace 或长期 evidence。

核心 evidence：

```text
frameRef
framePreviewRef
liveSurfaceRef
surfaceTransportRef
targetAppRef
targetWindowRef
adapterReadinessRef
inputIntentRef
executorEventRef
beforeFrameRef
afterFrameRef
annotationOverlayRef
approvalRequestRef
riskAuditRef
artifactRef
validationRef
replayRef
```

每次 mutating action 至少需要：

- current live surface / state ref
- target binding ref
- input lease ref
- executor event ref
- before/after refs
- verification record
- stale evidence invalidation

Replay viewer 必须能展示：

- app/window identity
- current live surface and current frame evidence
- actor cursor
- annotation overlay
- input timeline
- lease owner
- blocked/error/approval state
- evidence refs

Placeholder、旧截图、replay 或 “refs not attached” 只能说明没有 attach 到 session，不能被当作 live surface、视觉证据或用户级完成证据。

---

## 9. 完成判断

完成判断必须 fail closed。Computer Use 只能给 domain-local verdict；用户级完成仍由 L2 Root Agent Host 结合 verifier、artifact、workflow 和用户意图判断。

用户级完成至少需要：

- 当前 run bundle 内的 live surface / frame / action / verifier refs。
- 与目标 app/window/session 匹配的 current evidence，且没有第二交互 surface。
- action causality，证明结果来自本轮 adapter 执行。
- artifact/file evidence 或外部系统状态 evidence。
- high-risk confirmation chain，如果涉及发送、上传、删除、安装、权限或敏感数据。
- isolation flags 证明没有影响用户物理桌面；否则必须明确标记为 non-isolated diagnostic。

DOM、Playwright、Accessibility、shell 直写文件或 app private API 可以作为 adapter 或 observation source，但不能绕过 Computer Use 的 lease、before/after evidence、approval、validator 和 single-live-surface truth。

---

## 10. 当前推荐路线

### 阶段 0：协议收敛

- 定义 `VirtualAppScreen` schema。
- 定义 `ActionAdapter` readiness/capability schema。
- 定义 native/streaming live surface、frame/input/replay/evidence refs。
- 定义 isolated vs non-isolated capability flags。
- 保持 Screen tab presentation-only。

### 阶段 1：科研核心应用 adapter

- Browser research session：BrowserHostSession/BrowserRuntime/CDP/DOM refs + native/streaming live surface。
- Terminal session：PTY + transcript + command causality。
- Editor session：extension/editor command adapter。
- Jupyter/notebook：kernel/notebook protocol + rendered frame。
- PDF/Zotero/Preview：window capture + AX/OCR annotation first。

### 阶段 2：后台原生窗口

- window capture provider。
- AX hit test / action provider。
- native WebContents/WebView/offscreen/hidden display/streaming surface capability probe；这些 surface 只能绑定同一个 VirtualAppScreen owner，不形成替代真相链。
- app lifecycle manager，尽力避免物理屏弹窗。
- 明确 blocked reason：无法后台渲染、需要 focus steal、缺权限、黑盒自绘控件等。

### 阶段 3：多屏科研协作

- 一个 task 下多个 `VirtualAppScreen`。
- agent 分工：查文献、跑实验、看日志、改 notebook、整理报告。
- 用户可在任意 Screen 观察、注释、接管。
- 只要 adapter 能隔离就并行；需要全局资源就串行。

### 阶段 4：强隔离补充

- VM / microVM / remote desktop 仅用于不可信任务、高隔离复现实验或特殊 OS 依赖。
- 不作为默认科研自动化路线。

---

## 11. 验收分层

### Package-local contract

证明 schema、ledger、viewer、scheduler、approval、sanitizer 和 validator 正确。

### Adapter smoke

每个 adapter 必须证明：

- readiness record 存在。
- frame ref 可渲染。
- input intent 能转成 executor event。
- before/after evidence 当前且 bundle-local。
- isolation flags 真实可信。

### `virtual-app-screen-user-acceptance` active gate

证明 Screen tab 可以 attach 到一个 app/window/session，并展示同一 owner session 的 native/streaming live surface、cursor、annotation、timeline 和 refs。这个 gate 生成 `virtual-app-screen-user-acceptance-manifest`，字段至少覆盖 task/scenario/user intent、target app/window/session refs、liveSurfaceRef/surfaceTransport、adapter readiness refs、screen frame evidence refs、input intent/executor event refs、before/after frame refs、annotation proposal refs、artifact/verification refs、gui present refs、replay/evidence ledger refs、single-interactive-truth flags、isolation flags 和 blocked reason。

`passed` 只能在产物、live surface evidence、action causality、validator/verifier、single-interactive-truth 和 isolation flags 全部满足时出现；缺权限、后台渲染不可用、live surface 不可 attach、需要 focus steal、shared system input、目标歧义或高风险未确认时必须是 `blocked`、`needs-confirmation` 或 `requires-handoff`。

### Research workflow acceptance

证明多个科研 app screen 组合成一个工作流，例如：

```text
Browser paper search
-> PDF / Zotero evidence annotation
-> Jupyter or terminal experiment
-> editor/report artifact
-> verifier and gui.present
```

验收拒绝：

- shared system input 伪装成后台隔离。
- 旧 frame 或跨 bundle ref。
- placeholder-only viewer。
- snapshot/replay/PDF/document/proxy 被当作第二交互真相源或替代交互路径。
- GUI direct executor。
- shell 直写 artifact 冒充应用操作。
- DOM/AX/Playwright shortcut 绕过 Computer Use evidence。
- package-local contract、M6 opt-in、target-bound fixture、历史 Docker/noVNC evidence 或单次 click smoke 单独写 `userAcceptanceEligible=true`。

---

## 12. 最终判断

推荐产品路线是：

```text
VirtualAppScreen
-> adapter-first native/streaming background app control
-> single interactive live surface truth
-> annotation + equivalent mouse/keyboard UX
-> refs-first evidence/replay
-> research workflow acceptance
```

这条路线不依赖完整 OS desktop，也比系统全局输入更安全。它能让用户和 agent 在 SciForge 里像操作远程应用一样工作，同时保持科研自动化最需要的可观察、可介入、可回放、可验证和不打扰用户电脑。
