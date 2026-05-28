# Built-in Browser Runtime Architecture

最后更新：2026-05-24

## 结论

SciForge 的“内置浏览器”应该实现为 **TUI agent browser runtime capability + GUI presentation surface**，而不是 GUI 自己做网页 agent。

更准确地说，它不是一个普通浏览器，而是一个面向开发智能体的可视化执行环境：把视觉问题压缩成稳定引用、终端等价命令和可验证断言，再把代码修改的副作用展开成截图、DOM、日志和验证证据。

Codex in-app browser 的核心体验不是“打开一个网页控件”这么简单，而是一套可被 agent 使用的浏览器运行时：

- session / tab 管理：创建、命名、选择、关闭、列出 tab。
- 页面导航：goto、reload、back、forward。
- 多种控制面：坐标点击、DOM 节点点击、Playwright locator、键盘、滚动、输入、拖拽。
- 页面观察：截图、DOM snapshot、可见文本、accessibility/DOM 节点、console logs、network logs。
- 状态隔离：默认不污染用户主浏览器；需要登录/人工接管时才进入可见浏览器。
- 安全确认：登录、上传、下载、外部提交、授权、删除、支付、发送等动作不能静默执行。

SciForge 已经有 `playwright_browser_automation` 和 `playwright_edge_browser` 两条 provider：

- `playwright_browser_automation`：后台、headless、isolated，适合 agent 自动浏览、检索、截图、结构化抽取。
- `playwright_edge_browser`：可见 Edge、独立 profile，适合登录、人工接管和需要桌面可见性的验收。

缺口是：这两条 provider 还只是“单次浏览器调用能力”，没有形成像 Codex 内置浏览器那样稳定的 **session / tab / action / snapshot / trace** 契约，也没有给用户一个能直接打开 URL、查看页面、框选问题并交回 agent 的可见工作台。本文档和本轮代码补上这个中间层。

## 三层架构

不要把 UI 组件、工具 API 和线程协作状态混成一个“大浏览器模块”。最终实现按三层定位：

| 层级 | 职责 | 例子 |
|---|---|---|
| 运行时层 | Chromium/WebContentsView 或 Playwright session、CDP 通道、frame/dialog/network/storage/idle、HMR/dev-server 监听。 | `playwright_browser_automation`、`playwright_edge_browser`、未来 Electron `WebContentsView`。 |
| 能力层 | browser command API、StableRef、PageQuery DSL、标注引擎、DOM→源码 resolver、验证器。 | `browser_runtime`、`BrowserRuntimeStableRef`、`BrowserRuntimePageQuery`。 |
| 协作层 | 线程状态、审批流、审计日志、上下文打包、feedback inbox、代码 diff 和验证证据。 | `/browser ...` 命令、annotation record、refs-first trace、approval gate。 |

调试也按这三层定位：页面是否加载是运行时问题；元素 ref 是否解析是能力层问题；审批、上下文和证据是否进入线程是协作层问题。

## 边界

### TUI / capability 侧负责

- 选择是否需要浏览器。
- 创建或复用 browser session。
- 管理 tabs、导航、点击、输入、滚动、截图、DOM snapshot、console/network logs。
- 生成 browser trace、截图 ref、DOM snapshot ref、console log ref。
- 对高风险动作 fail closed 或请求 human approval。

### GUI 侧负责

- 展示 browser session 状态、tab 列表、当前 URL、截图/DOM/日志 refs。
- 提供真实的 Browser Workbench：地址栏、嵌入式预览、后退、刷新、打开 URL、同源 DOM 摘要读取和页面区域标注。
- 将页面标注保存为 refs-first feedback bundle 意图：URL、viewport、region rect、同源可读 selector/text、comment 和 `/browser annotate ... --snapshot --dom --refs-first` 终端等价命令。
- 提供“打开浏览器视图”“查看截图”“复制 URL”“请求人工接管”等 presentation controls。
- 把用户按钮转换成 terminal-equivalent text command，例如 `/browser open <url>` 或 `/browser takeover <sessionId>`。

### GUI 侧不负责

- 不判断用户是不是“想浏览网页”。
- 不选择 browser provider。
- 不拼 browser task prompt。
- 不自己做跨域网页阅读/抽取/验证；跨域 DOM、console、network、screenshot 必须由 TUI browser runtime 生成 refs。
- 不把截图 base64、DOM 全量、console 全量塞进 workspace state。

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
  -> gui.present(browser projection)
```

GUI Browser Workbench 的本地输入链路是：

```text
User opens URL / marks region / writes comment
  -> GUI Browser Workbench
  -> same-origin DOM summary if readable, otherwise region-only target
  -> terminal-equivalent /browser command
  -> TUI/Codex browser_runtime executes snapshot/DOM/logs/action
  -> refs-first trace returns to GUI projection
```

这个链路让用户得到真实可见预览和直观标注，同时避免 GUI 自己接管 provider routing 或把跨域网页内容直接塞进 workspace state。

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
| DOM CUA node id 操作 | 用 Playwright MCP snapshot/click target 表达，trace 记录 target。 |
| Playwright locator 子集 | 通过 generic actions 和 PageQuery DSL 暴露，不把 site-specific 逻辑写死。 |
| 截图 | 写入 screenshot ref，不进入 workspace state。 |
| console logs | 写入 console log ref 或 bounded summary。 |
| clipboard | 默认只读/展示；写剪贴板属于 high-risk，需要显式确认。 |
| 后台运行 | 默认 `playwright_browser_automation` headless isolated。 |
| 可见接管 | 显式 `playwright_edge_browser`，需要 human approval。 |

## Browser Workbench v0

当前 GUI 侧提供的不是静态说明页，而是一个可操作的浏览器工作台：

- URL bar：支持 `localhost:5173`、`127.0.0.1:3000`、`https://...` 自动补全协议。
- Embedded preview：通过 iframe 预览本地 dev server 或公开页面；网页自身交互仍由用户手动或 TUI browser runtime 执行。
- Navigation controls：后退、刷新、打开 URL。
- Same-origin inspection：当 iframe 与 SciForge 同源时，GUI 可读取 bounded DOM 摘要、链接、控件和 assets；跨域时显示明确 blocked reason，并提示使用 `/browser snapshot`。
- Annotation mode：用户在预览区域拖拽框选元素/区域，保存评论后生成本地 annotation record 和 `/browser annotate ... --refs-first` 命令。
- Command surface：所有按钮生成终端等价文本，例如 `/browser open`、`/browser snapshot`、`/browser state`、`/browser action page.scroll`、`/browser takeover`。

Web GUI 版本的硬边界：

- 不能像 Electron/WebContentsView 那样绕过 iframe/X-Frame-Options/CSP 限制。
- 不能跨域读取 DOM、console、network 或截图。
- 不能复用用户 Chrome profile、Cookie、扩展或登录态。
- 不能把 iframe 内容当作高优先级 prompt。

因此，v0 的正确产品形态是“共享预览 + 标注 + TUI browser runtime 命令桥”。真正的跨域截图、DOM snapshot、console/network logs 和自动点击输入由 `browser_runtime` provider 执行。

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

同源 iframe 可独立采集；跨源 iframe 只能记录 bbox、origin 和 inaccessible reason；open shadow DOM 可递归读；closed shadow DOM 等同 inaccessible。`get_state` 的返回结构必须显式表达这些边界。

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
| M1 | 嵌入式预览器 | Web/Electron browser surface、dev server URL 检测、线程级状态。 | App 内可打开 localhost 并保持状态。 |
| M2 | 标注引擎 | 元素/区域选择、截图 crop/ref、StableRef、annotation 入线程。 | reload 后 80% 常见标注能重新定位或明确要求重新观察。 |
| M3 | 页面观察 | 分层 `get_state`、AX/DOM/frames、PageQuery DSL、上下文压缩。 | 单次任务平均 browser context < 30K token。 |
| M4 | 页面操作 | click/type/scroll/wait/dialog/upload/media，ref 解析和 host approval。 | 100 个典型操作脚本通过率 > 90%。 |
| M5 | 源码映射 + 验证闭环 | DOM→源码 resolver、结构/行为/视觉断言、代码 diff 验证。 | “标注→改码→刷新→验证”端到端可用。 |
| M6 | 样式反馈 + 高级体验 | style inspector、live preview、visual diff、responsive presets。 | 15 个前端常见任务成功率 > 70%。 |

当前实现达到 M1/M2 的 Web GUI 起点：可打开本地页面、可预览、可区域标注、可生成 refs-first `/browser` 命令；跨域和深度自动化交给 TUI browser runtime。

## 后续路线

1. 把 `browser_runtime` 接入 Codex GUI extension resource tree，例如 `/gui/browser/sessions.json`。
2. 将 Browser Workbench 的 `/browser ...` 命令直接接入 TUI/Codex command executor，而不是只复制命令。
3. 为 Runtime Codex 暴露 `/browser` slash command 或 MCP tool。
4. 增加 live acceptance：用 Codex in-app browser 打开 SciForge 内置 Browser Workbench，完成 `open -> annotate -> snapshot command -> scroll command -> inspect same-origin state`。
5. 如果未来需要真正突破 iframe 限制，应在桌面壳里实现 Electron `WebContentsView`/独立 Chromium surface；Web GUI 不应伪装成具备这种权限。
