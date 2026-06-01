# Built-in Browser Runtime Architecture

最后更新：2026-06-02

## 结论

SciForge 的“内置浏览器”应该实现为 **TUI agent browser runtime capability + GUI presentation surface**，而不是 GUI 自己做网页 agent。

更准确地说，它不是一个普通浏览器，而是一个面向开发智能体的可视化执行环境：把视觉问题压缩成稳定引用、终端等价命令和可验证断言，再把代码修改的副作用展开成截图、DOM、日志和验证证据。

最终性能目标选用 **host-owned native embedded live surface**：`BrowserHostSession` / `BrowserRuntime` 仍是 TUI capability / Agent Host module 和 live browser owner；桌面 shell 承载 Electron `WebContentsView`（未来可替换为 WebView2/WKWebView 或独立 Chromium surface）作为同一 session 的 display/input adapter，让用户和 agent 的鼠标键盘体验接近 Edge/Chrome。这里没有第二个 truth source，也没有替代交互路径：desktop native surface 是最终 live path；Web shell 的 websocket-binary frame-stream 只是同一 owner session 的非桌面 stream/diagnostic/evidence transport，不是 native 桌面的性能替代品；无法 attach live surface 时必须返回 blocked / needs-human / handoff，而不是切到 iframe、proxy、snapshot、旧 frame、`<webview>` 或系统 popup 继续冒充可操作浏览器。GUI 不新增 provider route，不直接调用 Playwright/MCP，不跨域读取 DOM/AX/console/network，不把 hidden completion logic 放进 renderer。

Codex in-app browser 的核心体验不是“打开一个网页控件”这么简单，而是一套可被 agent 使用的浏览器运行时：

- session / tab 管理：创建、命名、选择、关闭、列出 tab。
- 页面导航：goto、reload、back、forward。
- 多种控制面：坐标点击、DOM 节点点击、Playwright locator、键盘、滚动、输入、拖拽。
- 页面观察：截图、DOM snapshot、可见文本、accessibility/DOM 节点、console logs、network logs。
- 状态隔离：默认不污染用户主浏览器；需要登录/人工接管时才进入可见浏览器。
- 安全确认：登录、上传、下载、外部提交、授权、删除、支付、发送等动作不能静默执行。

SciForge 已经有 `playwright_browser_automation` 和 `playwright_edge_browser` 两条 provider，provider routing 由 TUI / Agent Host 侧完成：

- `playwright_browser_automation`：后台、headless、isolated，适合 agent 自动浏览、检索、截图、结构化抽取。
- `playwright_edge_browser`：可见 Edge、独立 profile，适合登录、人工接管和需要桌面可见性的验收。

历史缺口是：这两条 provider 还只是“单次浏览器调用能力”，没有形成像 Codex 内置浏览器那样稳定的 **session / tab / action / snapshot / trace / live surface** 契约，也没有给用户一个能直接打开 URL、查看页面、请求 snapshot/state/takeover 并交回 agent 的可见工作台。当前 Browser pane 已补齐 presentation / projection 中间层；桌面壳已经接入 `BrowserHostSession` 拥有的 native embedded surface adapter，Web 壳保留同一 owner 的 frame-stream transport，同时仍不把 provider routing 或 completion 判断搬进 GUI。

## 三层架构

不要把 UI 组件、工具 API 和线程协作状态混成一个“大浏览器模块”。最终实现按三层定位：

| 层级 | 职责 | 例子 |
|---|---|---|
| 运行时层 | Chromium / BrowserHostSession、native embedded view、非桌面低延迟 frame stream、Playwright session、CDP 通道、frame/dialog/network/storage/idle、HMR/dev-server 监听。 | `BrowserHostSession`、Electron `WebContentsView` adapter、WebView2/WKWebView adapter、streaming canvas、`playwright_browser_automation`、`playwright_edge_browser`。 |
| 能力层 | browser command API、StableRef、PageQuery DSL、标注引擎、DOM→源码 resolver、验证器。 | `browser_runtime`、`BrowserRuntimeStableRef`、`BrowserRuntimePageQuery`。 |
| 协作层 | 线程状态、审批流、审计日志、上下文打包、feedback inbox、代码 diff 和验证证据。 | `/browser ...` 命令、annotation record、refs-first trace、approval gate。 |

调试也按这三层定位：页面是否加载是运行时问题；元素 ref 是否解析是能力层问题；审批、上下文和证据是否进入线程是协作层问题。

## Package 拆分和 TUI-GUI 边界

浏览器能力不能把 UI 组件、provider adapter 和共享 schema 放在同一个 owner 下。当前拆分如下：

| 模块 | Owner | 允许内容 | 禁止内容 |
|---|---|---|---|
| `@sciforge-ui/runtime-contract/browser-runtime` | shared contract | `BrowserRuntimeSession/Tab/Command/Snapshot/Trace/StableRef/PageQuery`、risk/page-query/stable-ref 等纯函数 | Playwright、MCP client、React、iframe、workspace IO、provider route |
| `packages/observe/web` | TUI capability | `browser_runtime` manifest、Playwright MCP wrapper、provider availability、TUI-facing provider adapter | React renderer、右侧结果区布局、GUI state、provider 选择以外的 GUI 控件 |
| `packages/presentation/components/browser-workbench` | GUI presentation | 右侧 browser projection renderer、typed browser state、tabs/snapshot/log refs、terminal-equivalent command events、host-owned native/streaming surface slot、blocked/error/offline 诊断状态 | provider routing、页面动作执行、跨域 DOM/console/network 读取、截图 base64/完整 DOM 保存、completion 判断、把 iframe/proxy 当 live browser 或第二画面真相源 |
| `src/ui/**` host 装配层 | GUI host | 将按钮/表单翻译成 `/browser ...` 文本或 declared GUI intent、装配 Browser page、连接反馈收件箱和结果区 placement、接入 shell 提供的 native/streaming surface handle；桌面环境只把 Browser pane bounds attach 给 `BrowserHostSession` native surface | import `@sciforge-observe/web/browser-runtime`、直接调用 Playwright/MCP/provider、判断网页任务完成、把外部网页白屏伪装成 ready、让 shell 变成 live browser owner |
| `src/desktop/browser-host-surface.ts` | desktop shell adapter | Electron `WebContentsView` attach/detach/bounds/input/screenshot/DOM/text/AX/search-results adapter；通过 loopback URL 供 workspace-server 的 BrowserHostSession driver 调用 | 创建第二个 session truth、直接绕过 BrowserHostSession route、把系统 BrowserWindow popup 当右栏 live browser、启用 `<webview>` |

Cursor Agent 右侧结果区的对齐目标不是把 browser、screen、terminal、file viewer 和 references 都塞进一个 React 页面，而是把它们变成可组合 presentation modules：`browser-workbench`、`virtual-screen-viewer`、`terminal-session-viewer`、`workspace-file-viewer` 和 references object inspector。TUI 通过 `module.invoke({ moduleId: 'gui', intent: 'present' })` 或 UI manifest slot 选择 presentation；GUI 模块只发出 view-local events、declared intent 或终端等价文本。

## 边界

### TUI / capability 侧负责

- 选择是否需要浏览器。
- 创建或复用 browser session。
- 管理 tabs、导航、点击、输入、滚动、截图、DOM snapshot、console/network logs。
- 生成 browser trace、截图 ref、DOM snapshot ref、console log ref。
- 对高风险动作 fail closed 或请求 human approval。

### GUI 侧负责

- 展示 browser session 状态、tab 列表、当前 URL、host-owned native/streaming live surface、截图/DOM/日志 refs。
- 提供 Browser Workbench projection：地址栏、native/streaming surface slot、`idle/loading/ready/blocked/error/offline` 状态、blocked reason 和显式 handoff 入口。
- 展示 refs-first feedback / evidence bundle 的摘要，例如 URL、viewport、region ref、snapshot ref、DOM/AX snapshot ref、console/network refs、trace refs 和 redacted diagnostics。
- 提供“打开浏览器视图”“查看截图”“复制 URL”“请求人工接管”等 presentation controls。
- 把用户按钮转换成 terminal-equivalent text command 或 declared GUI intent，例如 `/browser open <url>`、`/browser snapshot`、`/browser state` 或 `/browser takeover <sessionId>`。

### GUI 侧不负责

- 不判断用户是不是“想浏览网页”。
- 不选择 browser provider。
- 不拼 browser task prompt。
- 不自己做网页阅读/抽取/验证；DOM、AX、console、network、screenshot 和下载证据必须由 TUI browser runtime 生成 refs，GUI 只展示 ref 摘要。
- 不把截图 base64、DOM 全量、console 全量塞进 workspace state。
- 不根据 iframe load、surface attached、DOM 文本或历史 run 推断用户级完成。

## 运行时模型

```text
User text / GUI command
  -> TUI agent / Codex runtime
  -> browser_runtime capability
  -> provider route
       ├─ playwright_browser_automation  (default, headless, isolated)
       └─ playwright_edge_browser        (visible, human takeover)
  -> BrowserRuntimeResult
  -> refs-first trace / snapshot / logs
  -> host-owned native/streaming live surface + gui.present(browser projection)
```

GUI Browser Workbench 的本地输入链路是：

```text
User opens URL / clicks / types / requests snapshot / requests takeover
  -> GUI Browser Workbench
  -> host surface input adapter or terminal-equivalent /browser command
  -> BrowserHostSession / TUI browser_runtime executes action/snapshot/DOM/logs
  -> live surface updates immediately; refs-first trace returns to GUI projection
```

这个链路让用户得到真实可见预览和明确 blocked/error 状态，同时避免 GUI 自己接管 provider routing、隐藏执行网页动作，或把网页内容直接塞进 workspace state。

## BrowserHostSession Native Surface Contract

最高性能路线把“可见浏览器”拆成两个对象：

1. `BrowserHostSession` 是 owner，持有 session/tab/navigation/action/CDP/evidence/search refs。
2. shell surface 是 adapter，只承载 pixels 和 input routing，不拥有 provider、DOM 读取、动作策略、evidence truth 或 completion。

唯一可交互真相源是 owner session 的 live surface。允许的 surface transport 只有这些形态：

| 模式 | 用途 | 规则 |
|---|---|---|
| `native-embedded` | 桌面壳内嵌真实浏览器合成面，目标体验接近 Edge/Chrome。 | Electron `WebContentsView`、WebView2、WKWebView 或独立 Chromium surface 只能作为 BrowserHostSession 的 view adapter；动作和 refs 仍回到 host owner。 |
| `host-stream` | Web shell 的同一 owner live-surface transport。 | 用 WebSocket/WebRTC/canvas 等低延迟流展示同一个 host-owned session；输入事件走低延迟 host action channel；evidence refs 按状态点生成。它不是 native-embedded 的第二真相源或产品替代 live path。 |

Web shell 的当前主画面传输采用 `frame-stream` WebSocket：同一条 owner stream 先发 frame metadata，再发 PNG binary frame，GUI 只把 binary frame 转成短生命周期 `blob:` object URL 展示。`/api/sciforge/browser-host/sessions/:id/frame` 继续作为 refs-first evidence / manual inspection route 保留，但不能作为 Browser pane 的 live view 替代路径，也不能在 frame-stream 失败时自动接管主画面。

Writer preflight 必须以最终版 `/health` 为准：`capabilities` 需要包含 `browser-host-session` 和 `browser-host-search`，`endpoints.browserHostSession` 必须同时声明 `start`、`state`、`actions`、`computer-use-actions`、`frame` 和 `frame-stream`，`endpoints.browserHostSearch` 必须声明 `/api/sciforge/browser-host/search`。只声明旧版 `{start,state,actions,frame}` 的 Workspace Writer 必须判定为 stale，不能进入 ready，也不能显示没有 live pixels 的 Browser pane。

用户鼠标、键盘、滚轮、拖拽和 cursor hit-test 都必须进入同一个 `BrowserHostSession` action owner。Web 右侧栏当前通过 Workspace Writer `POST /api/sciforge/browser-host/sessions/:id/computer-use-actions` 投递这些 intent；该 route 是 BrowserHostSession 的输入通道，不是第二个 Computer Use 执行 owner。

性能优先级是 input > live-frame refresh > heavy evidence。`host-stream` 的 frame capture 必须是低优先级、可跳帧的刷新：如果同一 session 的 action queue 正在处理 click/type/drag/scroll/cursor，或刚刚有输入，stream 应跳过本轮 capture，而不是把截图排到用户输入前面。Snapshot/State/DOM/AX/console/network 属于显式 evidence request，不能混进连续冲浪的热路径。

非 surface artifact，例如 screenshot、PDF、document、DOM/AX/log 导出和离线诊断，只能作为只读证据或独立静态对象打开，不参与 Browser pane 的交互真相，不能替代 live surface。

禁止的 live browser 伪装：

- 外部 HTTP/HTTPS HTML 不能用 iframe/proxy/`<webview>` 冒充 live browser。
- shell 可以承载 native surface，但不能成为 BrowserRuntime provider 或 evidence owner。
- surface attach、image complete 或 iframe load 不能被当成浏览任务成功。
- static snapshot、PDF、document、proxy materialization 不能作为 Browser pane 的第二画面真相源。
- native surface attach 失败时不能自动切到 proxy/snapshot/iframe/old-frame；只能显示 blocked/handoff/retry diagnostics 并等待 owner session 恢复。
- screenshot/DOM/AX/console/network/search refs 必须由 BrowserHostSession 或 browser runtime 生成。

## BrowserRuntime Contract

浏览器运行时的最小对象：

```ts
type BrowserRuntimeSession = {
  id: string;
  mode: 'agent-headless' | 'visible-takeover';
  providerId: string;
  tabs: BrowserRuntimeTab[];
  activeTabId?: string;
};

type BrowserRuntimeTab = {
  id: string;
  url?: string;
  title?: string;
  status: 'new' | 'loading' | 'ready' | 'failed' | 'closed';
};

type BrowserRuntimeCommand =
  | { type: 'session.open'; startUrl?: string }
  | { type: 'browser.list_frames' }
  | { type: 'browser.switch_frame'; target: string }
  | { type: 'browser.list_dialogs' }
  | { type: 'browser.handle_dialog'; text?: string }
  | { type: 'browser.get_network_log' }
  | { type: 'browser.wait_for_idle'; timeoutMs?: number }
  | { type: 'browser.get_storage' }
  | { type: 'browser.upload_file'; target: string; text?: string }
  | { type: 'browser.emulate_media'; target: string }
  | { type: 'tab.new'; url?: string }
  | { type: 'tab.navigate'; tabId?: string; url: string }
  | { type: 'tab.snapshot'; tabId?: string; screenshot?: boolean; dom?: boolean; logs?: boolean }
  | { type: 'page.click'; tabId?: string; target: string }
  | { type: 'page.type'; tabId?: string; target: string; text: string }
  | { type: 'page.keypress'; tabId?: string; key: string }
  | { type: 'page.scroll'; tabId?: string; deltaX?: number; deltaY?: number }
  | { type: 'browser.close'; sessionId: string };
```

输出必须 refs-first：

```ts
type BrowserRuntimeTrace = {
  screenshotRef?: string;
  domSnapshotRef?: string;
  consoleLogRef?: string;
  networkLogRef?: string;
  diagnostics: string[];
};
```

GUI 只消费 projection，不消费 executor payload：

```ts
type BrowserRuntimeProjection = {
  schemaVersion: 'sciforge.browser-runtime.projection.v1';
  session: BrowserRuntimeSession;
  activeTab?: BrowserRuntimeTab;
  snapshot?: BrowserRuntimeSnapshot;
  traceRefs: BrowserRuntimeTraceRef[];
  guiBoundary: {
    taskReasoning: false;
    providerRouting: false;
    promptAssembly: false;
    presentationOnly: true;
  };
};
```

`guiBoundary` 是契约的一部分：Browser pane 可以据此渲染 session、tab、snapshot、trace refs 和 typed state，但不能把 iframe load、DOM/AX observation、console/network 摘要或页面文本升级为 executor lease、action causality、artifact validation、用户级 completion、provider route 或 hidden completion 信号。

### StableRef

浏览器工具不能长期依赖单一 CSS selector。标注、AI 思考、代码修改、HMR 刷新和组件重渲染之后，同一个 UI 对象需要通过复合信号重新定位：

```ts
type BrowserRuntimeStableRef = {
  schemaVersion: 'sciforge.browser-runtime.stable-ref.v1';
  primary: string;
  resolveStrategy: 'exact' | 'best-match';
  signals: {
    testId?: string;
    id?: string;
    selector?: string;
    domPath: string;
    role?: string;
    accessibleName?: string;
    textHash?: string;
    bbox: { x: number; y: number; width: number; height: number };
    componentPath?: string;
    visualHash?: string;
  };
};
```

解析优先级是：`data-testid` / `id` / explicit selector → framework component path → role + accessible name → DOM path → visual hash / bbox 兜底。匹配分过低时必须重新观察页面，不能硬猜。

### PageQuery DSL

`read-only JS` 不应该把任意模型生成 JS 放进页面执行。默认只开放查询 DSL：

```ts
type BrowserRuntimePageQuery = {
  schemaVersion: 'sciforge.browser-runtime.page-query.v1';
  select:
    | { ref: string }
    | { selector: string }
    | { role?: string; name?: string; visible?: boolean; withinRef?: string };
  fields: Array<
    | 'tagName' | 'role' | 'ariaLabel' | 'innerText' | 'bbox'
    | 'isVisible' | 'isFocusable' | 'value' | 'href' | 'src' | 'alt'
    | `computedStyle.${string}`
    | `attribute.${string}`
    | `dataset.${string}`
  >;
  limit: number;
};
```

执行端使用固定、审计过的只读采集代码；模型只能填 schema 参数。新增能力通过扩展字段白名单完成，不通过开放 `eval` 完成。

禁止把 `data:image/...;base64,...`、完整 DOM、完整 console log 作为 workspace state 内联内容。大对象必须先写 blob/ref store，再在 projection 中保存 ref、尺寸、hash、targetRect 和摘要。

## Codex In-App Browser 功能映射

| Codex in-app browser 能力 | SciForge 对应实现 |
|---|---|
| `browser.tabs.new/list/selected/get` | `browser_runtime` session/tab projection，底层用 Playwright MCP `browser_tabs`。 |
| `tab.goto/reload/back/forward/close` | `browser_runtime` command，映射到 MCP navigation / tabs action。 |
| CUA 坐标点击、拖拽、键盘、滚动、输入 | 作为 `page.*` action 进入 browser runtime；坐标动作保留在 Computer Use，高优先使用 DOM/Playwright。 |
| iframe 枚举和切换 | `browser.list_frames` / `browser.switch_frame`，跨源 frame 标记 inaccessible，不伪装可读。 |
| 原生 dialog | `browser.list_dialogs` / `browser.handle_dialog`，处理 dialog 属高风险，需要审批或明确上下文。 |
| network/storage/idle | `browser.get_network_log` / `browser.get_storage` / `browser.wait_for_idle`。 |
| DOM CUA node id 操作 | 作为 observation / grounding hint，用 Playwright MCP snapshot/click target 表达，trace 记录 target；不能替代 executor lease、action causality、artifact validation 或 completion evidence。 |
| Playwright locator 子集 | 通过 generic actions 和 PageQuery DSL 暴露，不把 site-specific 逻辑写死。 |
| 截图 | 写入 screenshot ref，不进入 workspace state。 |
| console logs | 写入 console log ref 或 bounded summary。 |
| clipboard | 默认只读/展示；写剪贴板属于 high-risk，需要显式确认。 |
| 后台运行 | 默认 `playwright_browser_automation` headless isolated。 |
| 可见接管 | 显式 `playwright_edge_browser`，需要 human approval。 |

## Browser Workbench Live Surface Target

GUI 侧提供的不是静态说明页，而是一个可操作的浏览器工作台。最终目标是右侧 Browser pane 只保留必要导航 chrome，其余空间交给 host-owned native/streaming live surface：

- URL bar：支持 `localhost`、`127.0.0.1`、`http` 和 `https` 输入归一化；无效 URL 进入 typed error。
- Live surface：优先接入 host-owned native embedded browser view；Web shell 使用同一 BrowserHostSession 的 host-owned frame stream（当前 route 是 `/api/sciforge/browser-host/sessions/:id/frame-stream`，主画面 transport 为 metadata + websocket-binary pixels + `blob:` object URL）。这两者是同一 owner surface 的不同 transport，不形成替代真相链。frame-stream 必须支持 input-priority / skip-frame backpressure；`/frame` HTTP route 和截图图片只作为证据 artifact / manual inspection，不作为可交互画面或 live view 替代路径。
- Navigation controls：Open、Back、Forward、Reload/Stop、Snapshot、State、Takeover、Copy URL、Open External。
- Blocked controls：无法 attach native/streaming surface、站点阻塞或安全策略限制时必须给出原因和下一步，例如 retry host、needs-human、Open External handoff 或 takeover；这些动作离开或恢复唯一 live surface，不创建第二个浏览画面。
- Command surface：所有按钮生成终端等价文本或 declared GUI intent，例如 `/browser open`、`/browser back`、`/browser forward`、`/browser reload`、`/browser stop`、`/browser snapshot`、`/browser state`、`/browser takeover`、`/browser copy-url`、`/browser open-external`。

Web GUI 版本的硬边界仍然存在：

- 不能像 Electron/WebContentsView 那样绕过 iframe/X-Frame-Options/CSP 限制。
- 不能跨域读取 DOM、console、network 或截图。
- 不能复用用户 Chrome profile、Cookie、扩展或登录态。
- 不能把 iframe 内容当作高优先级 prompt。

因此，Web GUI 不能把 iframe 当产品浏览器。桌面壳优先走 native embedded surface；Web 壳只能展示同一 BrowserHostSession 的 host-owned frame stream。真正的跨域截图、DOM snapshot、console/network logs、搜索摘要和自动点击输入由 `BrowserHostSession` / `browser_runtime` 执行；如果该 owner surface 不可用，结果是 blocked/handoff，而不是替代交互路径。

## 七个硬问题

### 1. 元素 ref 稳定性

StableRef 是工具层地基。每个标注目标必须尽量同时记录 selector、DOM path、role、accessible name、text hash、bbox、component path 和 visual hash。单一 selector 不允许成为唯一事实源。HMR/reload 后无法高置信解析时，下一步应该是重新 `get_state`，而不是继续点击旧坐标。

### 2. DOM → 源码映射

源码映射应做成独立 resolver 服务，不塞进 browser tool：

- React：读取 dev build 下 fiber `_debugSource`。
- Vue：读取 `__VUE_DEVTOOLS_GLOBAL_HOOK__` 和 component `__file`。
- Svelte：读取 dev metadata。
- CSS：用 CSS source map 将 computed style 的生效规则映射回源码。
- Bundler：Vite `/__inspect/`、Next/Webpack manifest/stats 作为二次源。

冲突时不要二选一：结构文件和样式文件常常都需要交给 agent。

### 3. Prompt injection 防御

页面内容必须打上 `trust="untrusted"`。页面 DOM、截图 OCR、console 和 network 返回值都只能作为观察数据，不能作为指令。执行 tool call 前还要检查高风险关键词、外部 host、剪贴板/secret/submit/delete/pay 等动作；命中时退回审批。

### 4. 验证闭环

默认用结构断言，不把截图主观判断作为唯一标准：

- 结构断言：元素存在、bbox 在视口内、computed style 满足条件。
- 行为断言：点击、输入、弹窗、路由变化。
- 视觉断言：截图 diff，必须支持 mask。
- AI 断言：只做兜底，并且要附结构证据。

### 5. iframe / Shadow DOM / 跨 origin

TUI `browser_runtime` 可以对同源 iframe 做独立采集；跨源 iframe 只能记录 bbox、origin 和 inaccessible reason；open shadow DOM 可递归读；closed shadow DOM 等同 inaccessible。`get_state` 的返回结构必须显式表达这些边界，GUI 只展示这些 refs 和摘要。

### 6. 上下文经济学

默认只给 agent 1-2K token 的页面摘要：URL、title、viewport 和 interactable refs。截图、完整 DOM、AX tree、console/network 必须按需请求，并限制 scope。历史截图降级成 ref、hash、缩略描述和摘要，不无限塞进上下文。

### 7. Eval 和遥测

M3 之前要建立 30-50 个固定 browser regression tasks，每个任务包含 starter repo、标注、期望结构断言和成功标准。遥测分三层：tool call 成功率/ref 解析退化率、任务 turn/token/latency、approval allow/deny/blocklist 曲线。

## 安全规则

默认允许：

- 打开公开 URL。
- 读取页面标题、URL、可见文本。
- 截图、DOM snapshot、console/network bounded logs。
- 在公开页面上做无副作用导航、点击、滚动。

必须确认：

- 登录、授权、验证码、2FA、账户切换。
- 上传文件、下载大文件或写入用户下载目录。
- 外部提交、发送消息、发帖、支付、下单、删除、覆盖。
- 写剪贴板、读取敏感剪贴板内容。
- 使用持久 profile 或附着到用户主浏览器。

站点阻塞、验证码、paywall、rate limit 必须返回 `needs-human` 或 `partial`，不能伪装成成功。

## Milestone

| 阶段 | 名称 | 关键交付 | 出货门槛 |
|---|---|---|---|
| M1 | Host-owned live surface | BrowserHostSession session/action/ref contract、desktop native surface adapter、Web frame stream transport、dev server URL 检测、线程级状态。 | App 内可打开 localhost 和外部 HTTP/HTTPS；Browser pane 不使用 iframe/proxy/snapshot/旧 frame/系统 popup 作为 live browser、第二真相源或替代交互路径。 |
| M2 | 标注引擎 | 元素/区域选择、截图 crop/ref、StableRef、annotation 入线程。 | reload 后 80% 常见标注能重新定位或明确要求重新观察。 |
| M3 | 页面观察 | 分层 `get_state`、AX/DOM/frames、PageQuery DSL、上下文压缩。 | 单次任务平均 browser context < 30K token。 |
| M4 | 页面操作 | click/type/scroll/wait/dialog/upload/media，ref 解析和 host approval。 | 100 个典型操作脚本通过率 > 90%。 |
| M5 | 源码映射 + 验证闭环 | DOM→源码 resolver、结构/行为/视觉断言、代码 diff 验证。 | “标注→改码→刷新→验证”端到端可用。 |
| M6 | 样式反馈 + 高级体验 | style inspector、live preview、visual diff、responsive presets。 | 15 个前端常见任务成功率 > 70%。 |

当前实现已补齐右侧结果栏可用性边界：外部页面不再以 iframe/proxy 冒充 live browser，Browser pane 有明确状态机、writer preflight、`computer-use-actions` 输入通道、桌面 Electron `WebContentsView` native embedded adapter、Web 壳 `frame-stream` transport 和 command surface；`/frame` route 仅保留 evidence/manual inspection，不作为右栏 live view 替代路径。桌面 M1 live path 已经从截图投影升级为 native embedded surface，让连续输入、拖拽和滚动走真实浏览器合成面；跨域观察、截图、DOM/AX、console/network 和深度自动化继续交给 BrowserHostSession / TUI browser runtime。

## 后续路线

1. 把 `browser_runtime` 接入 Codex GUI extension resource tree，例如 `/gui/browser/sessions.json`，resource 内容只包含 projection/ref 摘要。
2. 将 Browser Workbench 的 `/browser ...` 命令直接接入 TUI/Codex command executor，而不是只复制命令。
3. 为 Runtime Codex 暴露 `/browser` slash command 或 MCP tool，并把高风险动作统一落到 approval request。
4. 增加 live acceptance：在桌面 shell 中打开 SciForge Browser Workbench，完成 `open external URL -> native embedded surface attached -> click/type/drag/scroll -> snapshot/state refs -> takeover/open-external intent`；Web shell 另测同一 owner frame-stream transport。
5. 将当前 Electron `WebContentsView` adapter 抽象成可替换边界，后续可接 WebView2 / WKWebView / 独立 Chromium surface；Web GUI 使用 host-owned frame stream，不能伪装成拥有 native 浏览器权限。
