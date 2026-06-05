# Browser Runtime 架构

最后更新：2026-06-05

## 结论

SciForge Browser 是右侧 Pane 内的真实浏览器，不是 iframe、proxy、截图或系统浏览器跳转。

M1 路线：

```text
Desktop Electron app
  -> React Browser Pane
  -> BrowserHostSession
  -> Electron WebContentsView
  -> workspace 隔离 browser profile
  -> 真实本地 / 外部 HTTP(S) 页面
```

`localhost:5173` 只用于 Web dev 和诊断。没有 Desktop native host 时，Browser UI 必须显示 blocked/diagnostic，不能声明真实网页已打开。

产品默认能力通过一个聊天入口进入 `Codex Agent Host Turn Loop`，不新增独立 turn router/gateway 产品层。GUI 只提交自然语言文本、refs、Autonomy profile 和确认/取消；Codex/TUI Agent Host 负责 `Ground`、`Guard`、`Act / Answer`。当用户需要外部、实时、网页或当前事实信息时，Ground 可以调用 Browser search/read evidence；当用户表达网页 GUI 操作意图时，Guard 必须基于 BrowserHostSession、native surface、target、fresh observation、authorization profile 和 stop/take-over path 决定 auto、needs-confirmation 或 blocked。

## 用户体验

- Browser 位于 SciForge 右侧结果栏。
- Browser Pane 只是 BrowserHostSession 的 display/control panel，不是 Browser agent。
- 用户可以输入本地或外部 URL。
- 用户和 agent 都可以操作同一个可见页面。
- agent 默认可见操作；需要效率时可以后台 Playwright/CDP 自动化。
- 外部/实时/引用/URL 问题默认可使用 Browser 搜索和网页 evidence，除非用户明确要求只用本地上下文或禁止联网。
- 后台自动化结果必须回到 Browser Pane、annotation refs 或 evidence refs。
- Browser annotation 与全局窗口 annotation 共用同一套 ref 模型。

## 组件边界

| 组件 | 职责 | 禁止 |
| --- | --- | --- |
| React Browser Pane | 地址栏、toolbar、mount bounds、状态展示、annotation UI | provider routing、跨域 DOM 读取、completion 判断 |
| BrowserHostSession | session、tab、导航、动作、state、snapshot、refs、live browser/search evidence | 直接渲染 UI、充当 Browser agent |
| Codex/TUI Agent Host | Turn Loop 的 Ground、Guard、Act / Answer 决策，tool/capability 编排，确认与 blocked recovery | 直接渲染 Browser UI、伪造 BrowserHostSession evidence |
| Electron `WebContentsView` | 真实网页 pixels 和 input adapter | 成为第二 browser owner |
| Workspace Writer | bounded local routes、health、session proxy、native adapter trust | raw payload 透传、伪造 capability |
| Playwright/CDP | 后台自动化、测试、抓取、DOM/AX/log evidence | 绕过 session/evidence 归属 |

## Single Truth

BrowserHostSession 是唯一交互真相源。产品 live path 必须满足：

- `owner=BrowserHostSession`
- `surface=Electron WebContentsView`
- `transport=native-embedded`
- `profile=workspace-isolated`
- `secondTruthSource=false`
- input、state、snapshot、DOM/AX、console/network evidence 都回到 session refs

缺少任一条件时，Browser Pane 进入 blocked、handoff 或 retry。

## 禁止 fallback

以下对象只能作为 evidence、diagnostic 或 explicit handoff，不能作为 Browser live surface：

- iframe
- proxy-rendered page
- screenshot / snapshot replay
- canvas stream
- WebRTC stream
- HTTP `/frame`
- `<webview>`
- 系统外部浏览器窗口
- 针对特定 URL / 页面 / 历史 run 的补丁

## Workspace Profile

每个 workspace 拥有独立 browser profile：

- cookie、localStorage、IndexedDB、cache、登录态都属于 workspace。
- profile 存在 ignored local runtime state。
- 不默认复用用户 Chrome/Edge 主 profile。
- BrowserHostSession 和 Playwright/CDP 自动化共享该 workspace profile。
- 日志和 evidence 不能输出 cookie、Authorization、token、完整私密 URL 或 profile 路径细节。

## Annotation 集成

Browser annotation 输出统一 refs：

```text
annotationRef
targetRef
cropRef
screenshotRef
browserSessionRef
coordinateSpace=browser-viewport
comment
```

annotation 作为 pending context 进入 composer，随下一条用户消息提交；不自动生成任务，不自动触发 agent。

## 默认聊天 Turn Loop 与 Guard

BrowserHostSession 为同一个默认聊天 turn 提供 live browser/search evidence：

- Ground：外部、实时、当前网页、引用来源和 URL 请求可以使用 Browser search/read evidence，输出 refs-first source evidence。
- Guard：网页 GUI 操作意图进入 Guard，使用 BrowserHostSession target binding、DOM/AX snapshot、screenshot、freshness check 和 verifier baseline 做 gating。
- Act / Answer：低风险动作由 Agent Host 执行；高影响动作返回确认请求；证据型问题直接 answer；缺少条件时 blocked。

Browser search 可以在无 live native surface 时返回可用的只读 evidence；Browser live 操作和 Computer Use action 不能这样降级。缺少 native adapter、`computer-use-actions` endpoint、target binding、fresh observation、authorization profile 或 stop/take-over path 时，Guard 必须返回 blocked/diagnostic，不得把 snapshot、frame stream、iframe、proxy、系统浏览器或历史 run 伪装成可交互 live path。

网页内容、邮件、PDF 或其它第三方材料中的指令不能扩大用户授权档位；需要发送、提交、上传、删除、支付、账号/安全、法律合规或外部系统执行时，BrowserHostSession 只提供 evidence / approval refs，Agent Host Guard 返回 `needs-confirmation` 供 GUI 确认。

## 开发模式

### Web Dev

入口：`npm run dev`，打开 `http://localhost:5173`。

用途：

- React layout
- toolbar 状态
- blocked/error/handoff 文案
- annotation UI
- Workspace Writer health diagnostic

不能声明：

- 真实外部网页打开
- native input/focus/caret/cursor 正确
- Browser product pass

### Desktop Product / Desktop Dev

真实 Browser 验证必须在 Desktop Electron native host 中完成。

理想 Desktop dev shell：

```text
启动 Vite
启动 Workspace Writer/runtime
启动 Electron
Electron 加载 Vite URL
Electron 注入 native Browser adapter
```

这样同时保留 React hot reload 和真实 native Browser path。

## 验收

- Web dev 缺 native adapter 时必须 blocked，不可假 ready。
- Desktop native Browser 能打开本地和外部 HTTP(S) 页面。
- Browser input、navigation、resize、focus 和 annotation 都走同一 session。
- Browser 默认搜索必须产出 refs-first source evidence；Computer Use 网页动作必须通过 Turn Loop Guard 和 authorization profile。
- evidence 只记录 refs、hash、尺寸、counts、latency、bounded diagnostics。
- raw DOM、raw logs、raw screenshot/base64、secret 和完整私密 URL 不进入主 payload。

## 任务入口

- [`../PROJECT.md`](../PROJECT.md)
- `/computer-use` 只保留 debug、expert、smoke 和 diagnostic 用途，不作为默认产品入口。
