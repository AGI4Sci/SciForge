# Screen Annotation / Image Evidence / Window Action 架构

最后更新：2026-06-03

## 结论

旧的隔离 `VirtualAppScreen` 产品需求已废弃。SciForge 不再把目标设计为“创建一个 agent-owned virtual display 并隔离运行 app”。

新的产品形态是：

```text
真实应用窗口正常打开
  -> 用户用全局 Annotate 在原始窗口或屏幕区域上评论
  -> SciForge 生成 annotation/image/window refs
  -> refs 作为 pending context 随下一条用户消息提交
  -> agent 用自己的 actorCursor 操作目标窗口或 Browser Pane
  -> 右侧 Image / Evidence Pane 展示图片证据和注释
```

右侧旧 `Screen` pane 升级为通用 Image / Evidence Pane。它只展示图片、crop、annotation 和 provenance，不再表示远程桌面、虚拟屏幕或 live control surface。

## 三个产品模块

| 模块 | 目标 | 不做 |
| --- | --- | --- |
| Global Annotation | 在真实窗口/屏幕上框选、点选、评论，生成 pending context | 不自动触发 agent、不生成任务队列 |
| Image / Evidence Pane | 展示截图、crop、Browser evidence、artifact preview 和 annotation overlay | 不执行鼠标键盘、不拥有 session、不判定完成 |
| Window Action Session | 让 agent 以 actorCursor 操作用户加入的真实窗口 | 不承诺隔离虚拟显示器、不伪装多只 OS 鼠标 |

## Annotation Flow

```text
User starts Annotate
  -> choose window-bound region or screen region
  -> draw/comment
  -> desktop host captures crop and metadata
  -> create annotationRef + imageRef + targetRef
  -> attach pending context to composer
  -> user sends message
  -> agent reads refs and acts
```

采用 Codex 策略：标注是下一条用户消息的上下文，不是自动任务。

## Target Binding

M1 实现顺序：

1. 窗口绑定评论：使用 window-local 坐标，窗口移动/缩放后仍可解释。
2. 屏幕区域评论：使用 screen-global 坐标，用于无法识别窗口或用户主动选择整屏区域。

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
bounds
createdAt
```

## Desktop Overlay

Desktop host 使用透明、置顶 overlay 进入全局评论模式。

要求：

- overlay 可进入/退出评论模式。
- 支持框选、取消、重选、提交。
- 捕获 crop 时避免把 overlay 自己截进图片。
- 默认只捕获用户选择的窗口或区域。
- 输出 refs、hash、尺寸、bounds、source，不输出 raw base64 到主 payload。

macOS M1 优先使用 ScreenCaptureKit 做窗口/屏幕捕获；Windows/Linux 后续通过 platform adapter 接入。

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

用户可以把真实应用窗口加入 SciForge。agent 可以用自己的 actorCursor 操作该窗口。

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
