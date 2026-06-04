# Screen Annotation / Image Evidence / Window Action 架构

最后更新：2026-06-04

## 结论

旧的隔离 `VirtualAppScreen` 产品需求已废弃。SciForge 不再把目标设计为“创建一个 agent-owned virtual display 并隔离运行 app”。

新的产品形态是：

```text
真实应用窗口正常打开
  -> 用户选择 Annotate 模式：SciForge page / Screen region / App window
  -> SciForge 生成 annotation/image/target refs
  -> refs 作为 pending context 随下一条用户消息提交
  -> agent 读取 refs；需要执行时再进入 Browser Pane 或 WindowActionSession
  -> 右侧 Image / Evidence Pane 展示图片证据和注释
```

右侧旧 `Screen` pane 升级为通用 Image / Evidence Pane。它只展示图片、crop、annotation 和 provenance，不再表示远程桌面、虚拟屏幕或 live control surface。

## 三个产品模块

| 模块 | 目标 | 不做 |
| --- | --- | --- |
| Global Annotation | 在真实窗口/屏幕上框选、点选、评论，生成 pending context | 不自动触发 agent、不生成任务队列 |
| Image / Evidence Pane | 展示截图、crop、Browser evidence、artifact preview 和 annotation overlay | 不执行鼠标键盘、不拥有 session、不判定完成 |
| Window Action Session | 让 agent 以 actorCursor 操作用户加入的真实窗口 | 不承诺隔离虚拟显示器、不伪装多只 OS 鼠标 |

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
  -> agent reads refs and acts
```

采用 Codex 策略：标注是下一条用户消息的上下文，不是自动任务。

## Target Binding

目标绑定是给屏幕选区附加“它属于哪个窗口”的解释信息，不是另一套截图方式。

### 自动绑定

`Screen region` 完成后自动尝试窗口绑定，不弹窗打断用户。

自动绑定只在高置信度时成立：

- 选区中心点落在候选窗口内。
- 候选窗口与选区重叠面积达到阈值，建议 M1 使用 `>= 70%`。
- 第一候选明显强于第二候选，建议重叠面积差 `>= 20%`。
- 排除 SciForge 主窗口、overlay、菜单栏、Dock、不可见窗口、极小窗口和透明/辅助窗口。

若低置信度、多窗口冲突、选区落在桌面或无法枚举窗口，默认不绑定，仍保存纯 `screen-region` 证据。候选窗口可以作为 diagnostics/provenance 保存，但不进入 active binding。

### 手动绑定

`App window` 是显式手动绑定：用户先选窗口，再在该窗口内框选区域。该模式必须产出 `windowRef`、`windowBounds`、`windowLocalBounds`、app/process/title metadata。它适合后续 WindowActionSession，但不要求当前评论阶段已经能操作该 app。

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

## Desktop Overlay

Desktop host 使用透明、置顶 overlay 进入全局评论模式。

要求：

- overlay 可进入/退出评论模式。
- 支持框选、取消、重选、提交。
- `Screen region` 使用 overlay 捕获准确 `screenBounds`，再用 ScreenCaptureKit 或 `screencapture -R` 捕获区域。
- `App window` 使用 overlay 或平台窗口选择器先绑定窗口，再限制选区在窗口内。
- 捕获 crop 时避免把 overlay 自己截进图片。
- 默认只捕获用户选择的窗口或区域。
- 输出 refs、hash、尺寸、bounds、source，不输出 raw base64 到主 payload。

macOS M1 优先使用 ScreenCaptureKit 做窗口/屏幕捕获；`screencapture -R` 可以作为选区截图 fallback。`screencapture -i` 不适合作为主路径，因为它通常不可靠返回用户选区的 `screenBounds`，无法支撑自动窗口绑定。

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

它提供：

- zoom / pan / fit / actual size
- annotation overlay
- crop bounds 高亮
- provenance
- copy ref / open original / download

它不提供：

- live app control
- provider action execution
- completion 判断
- 隔离性声明

## Window Action Session

用户可以把真实应用窗口加入 SciForge。agent 可以用自己的 actorCursor 操作该窗口。WindowActionSession 可以消费 `App window` 评论或高置信度自动绑定产生的 `windowRef`，但不会从纯 `screen-region` 自动推断可操作目标。

`actorCursor` 以 agent 为单位设计：

```text
agent
  -> actorCursor(color, label, status)
  -> enters target window
  -> performs action through adapter
  -> leaves or switches target
```

WindowActionSession 管理：

- `windowRef`
- app/process metadata
- bounds / scale / screen id
- active actor cursors
- action events
- pause / stop / remove window
- evidence refs

## Action Adapter

底层执行方式按能力选择：

```text
1. Browser/CDP/Playwright/WebContentsView action
2. App-native command 或 extension command
3. Accessibility/UI Automation/AT-SPI
4. 受控 system input
```

产品不承诺每个窗口真的有独立 OS 鼠标键盘。产品承诺是：用户看到哪个 agent 正在哪个窗口上执行什么。

M1 暂不做复杂权限系统；但必须提供 pause、stop current session、remove window。

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

禁止进入主 payload：

- raw screenshot/base64
- raw clipboard/IME/user text
- raw provider payload
- secret/token/Authorization
- 无关窗口内容
- 未经用户选择的全屏敏感内容

## 验收

- Global Annotate 能在真实 Desktop app 窗口上产生 annotation/image refs。
- `Screen region` 能在任意可见屏幕区域上产生 annotation/image refs，并在高置信度时自动绑定窗口。
- 低置信度自动绑定默认不绑定窗口，不弹窗打断用户。
- `App window` 能显式选择窗口并产生 `windowRef` + `windowLocalBounds`。
- annotation 作为 pending context 随下一条用户消息提交。
- Image pane 能打开 annotation crop 并显示 provenance。
- agent actorCursor 能以 agent 身份投影到 Browser Pane 或 WindowActionSession。
- 旧隔离虚拟屏幕路线不再出现在 active PROJECT 任务中。

## 任务入口

- [`../PROJECT_annotation.md`](../PROJECT_annotation.md)
- [`../PROJECT_image.md`](../PROJECT_image.md)
- [`../PROJECT_window_action.md`](../PROJECT_window_action.md)
- [`../PROJECT_desktop.md`](../PROJECT_desktop.md)
- [`../PROJECT_CU.md`](../PROJECT_CU.md)
