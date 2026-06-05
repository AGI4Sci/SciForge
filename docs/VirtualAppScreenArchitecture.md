# Screen Annotation / Image Evidence / Visible Window Action 架构

最后更新：2026-06-05

## 结论

旧的隔离 `VirtualAppScreen` 产品需求已废弃。SciForge 不再把目标设计为“创建一个 agent-owned virtual display 并隔离运行 app”。

新的产品形态是：

```text
真实应用窗口正常打开
  -> 用户选择 Annotate 模式：SciForge page / Screen region / App window
  -> SciForge 生成 annotation/image/target refs
  -> refs 作为 pending context 随下一条用户消息提交
  -> Agent Host 读取 refs 和用户意图
  -> 如果是回答/解释：直接使用 refs 作为上下文
  -> 如果是“把这里改成 X”：自动进入或复用 WindowActionSession
  -> actorCursor 可见地操作真实窗口
  -> 右侧 Image / Evidence Pane 展示图片证据、注释和 before/after evidence
```

右侧旧 `Screen` pane 升级为通用 Image / Evidence Pane。它只展示图片、crop、annotation、provenance 和 action evidence，不再表示远程桌面、虚拟屏幕或 live control surface。

## 三个产品模块

| 模块 | 目标 | 不做 |
| --- | --- | --- |
| Annotation | 在真实窗口/屏幕上框选、点选、评论，生成 pending context 和 target binding | 不执行 action、不拥有输入 adapter、不判定完成 |
| Image / Evidence Pane | 展示截图、crop、Browser evidence、artifact preview、annotation overlay 和 before/after evidence | 不执行鼠标键盘、不拥有 session、不判定完成 |
| Window Action Session | 让 agent 以 actorCursor 和 scoped input adapter 操作真实窗口 | 不承诺隔离虚拟显示器、不伪装多只 OS 鼠标 |

Annotation 和 Computer Use 必须分开写。Annotation 只负责上下文和绑定；Computer Use 只作为 Window Action 的 action/input adapter 来源之一。自动进入 Window Action 由 Agent Host 决定，不由 Annotation 自己执行。

## Annotation Modes

顶部 `Annotate` 入口必须显式提供三种模式。`Global vision` 只表示全局视觉/截图证据感知开关，不是评论入口。

| 模式 | 目标 | 坐标系 | 窗口绑定 | M1 要求 |
| --- | --- | --- | --- | --- |
| SciForge page | 评论 SciForge 自身 DOM、聊天、右侧 pane、内置浏览器 UI | `browser-viewport` / DOM rect | 不绑定真实 OS 窗口 | 保留 selector、DOM path、selected text、页内截图 |
| Screen region | 评论用户屏幕任意可见区域 | `screen-global` | 高置信度自动绑定；低置信度默认不绑定 | 透明全屏 overlay 框选，保存 `screenBounds` 和 refs |
| App window | 评论某个真实应用窗口内区域 | `window-local` + `screen-global` | 用户先显式选窗口，必有 `windowRef` | 记录 app/window/process metadata 和 `windowLocalBounds` |

App window 评论不意味着为每个 app 写专用评论代码。评论取证阶段使用平台级窗口枚举、bounds、pid、title、bundle id 和截图能力。每个 app 的专用适配只属于后续 Action Adapter；评论本身必须是通用能力。

## Annotation Flow

```text
User starts Annotate
  -> choose SciForge page, Screen region, or App window
  -> draw/comment
  -> desktop host captures crop and metadata
  -> create annotationRef + imageRef + targetRef
  -> attach pending context to composer
  -> user sends message
  -> Agent Host reads refs and intent
```

采用 Codex 策略：标注是下一条用户消息的上下文，不是自动任务队列。区别在于：如果下一条用户消息表达了明确修改意图，Agent Host 可以自动进入 Window Action，不再需要先问“是否允许 agent 操作这个窗口”。

## Target Binding

目标绑定是给屏幕选区附加“它属于哪个窗口”的解释信息，不是另一套截图方式，也不是 Annotation 自己的执行授权。

### 自动绑定

`Screen region` 完成后自动尝试窗口绑定，不弹窗打断用户。

自动绑定只在高置信度时成立：

- 选区中心点落在候选窗口内。
- 候选窗口与选区重叠面积达到阈值，建议 M1 使用 `>= 70%`。
- 第一候选明显强于第二候选，建议重叠面积差 `>= 20%`。
- 排除 SciForge 主窗口、overlay、菜单栏、Dock、不可见窗口、极小窗口和透明/辅助窗口。

若低置信度、多窗口冲突、选区落在桌面或无法枚举窗口，默认不绑定，仍保存纯 `screen-region` 证据。候选窗口可以作为 diagnostics/provenance 保存，但不进入 active binding，也不能自动创建 WindowActionSession。

### 手动绑定

`App window` 是显式手动绑定：用户先选窗口，再在该窗口内框选区域。该模式必须产出 `windowRef`、`windowBounds`、`windowLocalBounds`、app/process/title metadata。它适合后续 WindowActionSession；当下一条用户消息是修改意图时，Agent Host 可以自动创建或复用对应 WindowActionSession。

两者共用 annotation schema：

```text
annotationRef
targetRef
imageRef
cropRef
screenshotRef
comment
sourceKind
coordinateSpace
screenBounds
windowBounds?
windowLocalBounds?
windowBinding?
createdAt
```

`windowBinding` 最小状态：

```text
status: auto-bound | unbound | manual-bound | blocked
confidence?
reason?
windowRef?
appName?
bundleId?
pid?
title?
windowBounds?
windowLocalBounds?
candidates?
```

## Automatic Window Action

当用户把 annotation refs 带入下一条消息，并表达修改意图时，Agent Host 自动进入 Window Action：

```text
annotationRef + user mutating intent
  -> resolve targetBinding
  -> if manual-bound or high-confidence auto-bound:
       create/reuse WindowActionSession(windowRef)
       assign actorCursor(agentSessionId)
       attach ScopedInputAdapter(agentSessionId)
       dispatch action through Action Adapter
       write before/after evidence and action timeline
  -> if unbound/blocked/low-confidence:
       use annotation as context only, or ask for a target window when needed
```

这条规则只取消“进入 Window Action 前的普通确认”，不取消风险治理。产品默认采用高自主：普通低风险窗口动作可以在预检通过后自动执行；支付、发送、提交、删除、上传、账号/安全、法律合规和外部系统执行等动作必须 hard-confirm；captcha/访问控制绕过、身份伪装、批量注册、不可逆批量删除、敏感数据发往不明确目的地和第三方高风险指令默认 blocked。

Window Action 必须携带 authorization profile、permission refs、risk decision、confirmation refs、fresh observation、before/after evidence 和 stop/take-over path。网页内容、模型输出或 tool result 不能扩大授权。缺少 target binding、fresh observation、permission ref 或 cancel path 时，系统必须 fail closed 并返回可恢复 diagnostics。

## Window Action Session

用户可以把真实应用窗口加入 SciForge，或者由 bound annotation + 修改意图自动创建 WindowActionSession。agent 可以用自己的 actorCursor 操作该窗口。

`actorCursor` 以 agent 为单位设计：

```text
agentSession
  -> actorCursor(color, label, status)
  -> ScopedInputAdapter(session-local input queue and lease)
  -> enters target window
  -> performs action through adapter
  -> leaves or switches target
```

WindowActionSession 管理：

- `windowRef`
- app/process metadata
- bounds / scale / screen id
- active actor cursors
- scoped input adapter refs
- action events
- authorization profile / risk decision / confirmation refs
- focus lease events
- pause / stop / remove window
- before/after evidence refs

## Surface Transport

Surface Transport 只描述 WindowActionSession / host-owned surface 如何把真实窗口或宿主拥有的 live presentation 投到 SciForge UI。它不是旧隔离 `VirtualAppScreen` 的回归，也不把 Image / Evidence Pane 升级成第二套可交互控制面。

候选 transport 必须作为能力评估对象，而不是产品承诺：

| 候选 | 适用边界 |
| --- | --- |
| `native-presented-surface` | 宿主进程直接提供可呈现 surface 或 OS/window capture handle，适合首选 live path。 |
| `webrtc` | 适合跨进程或远端 host 的低延迟 stream；signaling、metrics 和 media refs 必须保持 bounded。 |
| `webcodecs` | 适合本地 encode/decode 或 worker pipeline；仍由 host/session owner 决定输入与焦点。 |
| `mjpeg-png-delta` | 只作为诊断和兜底帧序列，用于 evidence、debug 或弱实时预览。 |

选择策略必须保持平台中立：不把选择硬编码到 macOS/Linux/Windows，而是读取 shell/provider/runtime capability refs，结合窗口可捕获性、编码能力、输入 adapter、焦点租约、延迟、功耗和可观测 metrics 选择 transport。平台差异只能进入 capability refs 和 diagnostics，不能进入产品级分支。

live path 必须是 refs-first。UI 只接收 `liveSurfaceRef`、`frameStreamRef`、`transportTelemetryRef`、尺寸、scale、bounds、session owner 和 bounded diagnostics；原始帧、SDP、provider URL、token、raw screenshot/base64 不进入主 payload。WindowActionSession / host owner 保持 single interactive truth：用户看到的 live surface、actorCursor、ScopedInputAdapter 和 action evidence 必须指向同一个 owner/session，不能让 replay、Image pane artifact 或 fallback stream 成为第二个可操作目标。

如果没有任何候选满足实时交互、输入归属、focus lease 和 bounded evidence 要求，系统必须 fail-closed。有效输出是 `blocked/handoff/retry`、明确 block reason、可重试 capability probe、或 `fallbackRequired=true` 的非通过 evidence；不能把弱预览伪装成可交互 live pass。

`mjpeg-png-delta` 明确是 diagnostic/fallback only。它可以帮助记录 before/after、低频截图、transport 对比和 provider debug，但不能作为 user-level live pass，也不能改变 WindowActionSession 对输入、焦点和完成判断的所有权。

## Scoped Input Adapter

每个 agent 会话都有自己的 `ScopedInputAdapter`。它是逻辑输入通道，不承诺每个 agent 都有一套真实 OS 级独立鼠标键盘。

推荐字段：

```text
scopedInputAdapterRef
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

底层能力按优先级选择：

```text
1. Browser/CDP/Playwright/WebContentsView action
2. App-native command 或 extension command
3. Terminal / PTY command
4. Accessibility/UI Automation/AT-SPI
5. focused system input
```

非抢焦点 adapter 可以并行。凡是需要真实窗口置前、系统键盘、系统 pointer、菜单栏或 IME 的动作，进入全局 `FocusLease`，串行执行。窗口可以弹出在显示器上，也可以放到后层；当动作需要焦点时允许短暂置前或接管焦点，UI 必须显示当前 agent、目标窗口和动作状态。

## Image / Evidence Pane

Image pane 是右侧结果栏的通用图片展示区。

它展示：

- annotation crop
- screenshot
- Browser evidence image
- window capture
- screen region capture
- artifact preview image
- replay/history image
- WindowActionSession before/after evidence

它提供：

- zoom / pan / fit / actual size
- annotation overlay
- crop bounds 高亮
- provenance
- copy ref / open original / download
- action timeline evidence link

它不提供：

- live app control
- provider action execution
- completion 判断
- 隔离性声明

## Evidence 规则

允许进入主 payload：

- refs
- hash
- mime
- image dimensions
- bounds
- coordinate space
- target summary
- createdAt
- bounded diagnostics
- action status summary

禁止进入主 payload：

- raw screenshot/base64
- raw clipboard/IME/user text
- raw provider payload
- secret/token/Authorization
- 无关窗口内容
- 未经用户选择的全屏敏感内容

每次 mutating action 至少产生：

- target window/session refs
- actor cursor ref
- scoped input adapter ref
- action event ref
- before/after evidence refs
- focus lease ref when focus takeover is used
- result/evidence timeline refs

## 验收

- Global Annotate 能在真实 Desktop app 窗口上产生 annotation/image refs。
- `Screen region` 能在任意可见屏幕区域上产生 annotation/image refs，并在高置信度时自动绑定窗口。
- 低置信度自动绑定默认不绑定窗口，不弹窗。
- `App window` 能显式选择窗口并产生 `windowRef` + `windowLocalBounds`。
- annotation 作为 pending context 随下一条用户消息提交。
- 用户说“把这里改成 X”时，manual-bound 或高置信度 auto-bound annotation 自动进入或复用 WindowActionSession。
- 每个 agent session 有独立 actorCursor 和 ScopedInputAdapter。
- focus-required action 通过全局 FocusLease 串行执行，并在 UI/evidence 中可见。
- Image pane 能打开 annotation crop、before/after evidence 并显示 provenance。
- 旧隔离虚拟屏幕路线不再出现在 active PROJECT 任务中。

## 任务入口

- [`../PROJECT.md`](../PROJECT.md)
