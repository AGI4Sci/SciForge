# Browser 模块设计

最后更新：2026-06-07

## 定位

Browser 是 Codex backend 可调用的网页信息输入与局部浏览器操作模块，不是 Browser agent，也不是搜索总结工具。

Browser 只负责：

- 执行 Host 明确请求的原子浏览器能力：search、open、read、extract、download。
- 返回结构化 observation、diagnostics 和 refs-first evidence。
- 维护 BrowserHostSession / tab scope、页面状态、导航状态和可审计 artifact。
- 对危险或越界动作 fail closed，并把 blocked reason 返回 Host。

Browser 不负责：

- 查询改写。
- 来源取舍。
- 事实综合。
- 最终总结。
- 跨模块 repair。
- 用户级 completion truth。
- 判断用户意图是否完成。
- 根据特定站点、语言或领域写场景策略。

## 产品入口

用户仍然只从普通聊天进入：

```text
用户请求网页事实
  -> Codex backend 判断需要 Browser evidence
  -> Agent Host 生成 AcceptanceSpec / action budget
  -> Agent Host 调用 Browser primitive tools
  -> Browser 返回 observation / refs / diagnostics
  -> Agent Host 基于 verifier 反馈继续 search/open/read/extract/download
  -> Agent Host 生成 completion truth 和 final answer
```

Browser pane 只是 BrowserHostSession 的展示和控制面板，不是任务入口。

## 原子能力边界

Browser module 对 Agent Host 暴露的基础能力必须是原子操作。原子操作只描述“浏览器看到了什么、做了什么、产出了哪些 refs”，不描述“这个用户任务是否完成”。

| primitive | 作用 | 不允许做的事 | 主要输出 |
| --- | --- | --- | --- |
| `browser.search` | 用 Host 给定 query 做候选发现。 | 不打开结果页、不总结答案、不改写 query。 | search result list、search URL、search result ref、diagnostics。 |
| `browser.open` | 打开 Host 给定 URL / link，建立或复用 session。 | 不读取长正文、不判断来源是否满足任务。 | session ref、requested/final URL、title、navigation state、frame/screenshot refs。 |
| `browser.read` | 读取当前页面或给定 URL 的网页内容。 | 不下载文件、不抽象成最终结论、不跨页面继续搜索。 | source page ref、page text ref、HTML ref、text preview、content metadata。 |
| `browser.extract` | 对已读 refs 做纯解析。 | 不访问网络、不决定下一步、不做任务级语义验收。 | links、forms、dates、metadata、result items、structured observations。 |
| `browser.download` | 把 Host 指定的远程资源下载为受控 artifact。 | 不保存到任意本地路径、不自动执行/打开文件、不总结文件内容。 | file ref、filename、mime type、byte size、hash、final URL、diagnostics。 |

旧的 `browser.search_read` / `browser.open_read` 只能作为兼容或测试期便捷封装存在。产品语义上它们不得承载查询改写、来源选择、跨语言策略、特定站点 repair 或 completion truth。

## Primitive Contract

所有 Browser primitive 都使用 refs-first envelope。字段命名必须稳定，未知字段默认拒绝或进入 diagnostics，不能静默改变语义。

```ts
type BrowserPrimitiveStatus =
  | "completed"
  | "partial"
  | "blocked"
  | "needs-confirmation"
  | "failed";

type BrowserDiagnostic = {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
  refs?: string[];
  retryable?: boolean;
};

type BrowserPrimitiveBudget = {
  maxTimeMs: number;
  elapsedMs?: number;
  maxBytes?: number;
  bytesRead?: number;
};

type BrowserPrimitiveEnvelope<T> = {
  schemaVersion: "sciforge.browser-runtime.primitive-result.v1";
  moduleId: "browser";
  primitive: "search" | "open" | "read" | "extract" | "download";
  status: BrowserPrimitiveStatus;
  value?: T;
  refs: string[];
  diagnostics: BrowserDiagnostic[];
  budget: BrowserPrimitiveBudget;
  blockedReason?: string;
  repairHints?: BrowserRepairHint[];
};

type BrowserRepairHint = {
  code: string;
  message: string;
  suggestedPrimitive?: "search" | "open" | "read" | "extract" | "download";
  machineReadable?: Record<string, unknown>;
};
```

`repairHints` 是给 Agent Host 的反馈，不是 Browser 自己继续执行的指令。Browser primitive 不得自动 repair。

### `browser.search`

`search` 只发现候选页面。query 的生成、翻译、放宽、站点选择和多轮搜索策略由 Agent Host 决定。

```ts
type BrowserSearchInput = {
  schemaVersion: "sciforge.browser-runtime.search-input.v1";
  query: string;
  engine?: "bing" | "duckduckgo";
  locale?: string;
  region?: string;
  limit: number;
  budget: BrowserPrimitiveBudget;
  constraints?: {
    allowedDomains?: string[];
    blockedDomains?: string[];
    safeSearch?: "off" | "moderate" | "strict";
  };
};

type BrowserSearchOutput = {
  queryUsed: string;
  engine: string;
  searchUrl: string;
  searchedAt: string;
  results: Array<{
    rank: number;
    title: string;
    url: string;
    snippet?: string;
    displayedUrl?: string;
  }>;
  refs: {
    searchResultRef: string;
  };
};
```

### `browser.open`

`open` 只负责导航和 session 状态，不负责读取长正文。

```ts
type BrowserOpenInput = {
  schemaVersion: "sciforge.browser-runtime.open-input.v1";
  url: string;
  sessionId?: string;
  timeoutMs: number;
  capture?: "none" | "frame" | "screenshot";
  constraints?: {
    allowedDomains?: string[];
    requireUserConfirmationForCrossOrigin?: boolean;
  };
};

type BrowserOpenOutput = {
  sessionRef: string;
  requestedUrl: string;
  finalUrl: string;
  title?: string;
  openedAt: string;
  navigation: {
    redirected: boolean;
    blockedByLogin?: boolean;
    blockedByConsent?: boolean;
    errorCode?: string;
  };
  refs: {
    frameRef?: string;
    screenshotRef?: string;
    domSnapshotRef?: string;
    axSnapshotRef?: string;
  };
};
```

### `browser.read`

`read` 读取网页内容并物化 refs。它可以从现有 session 读取，也可以读取给定 URL，但不能把文件下载当作网页正文。

```ts
type BrowserReadInput = {
  schemaVersion: "sciforge.browser-runtime.read-input.v1";
  sessionId?: string;
  url?: string;
  includeText: boolean;
  includeHtml?: boolean;
  maxTextChars: number;
  timeoutMs: number;
};

type BrowserReadOutput = {
  page: {
    url: string;
    finalUrl: string;
    title?: string;
    contentType?: string;
    textCharCount?: number;
    textSha1?: string;
  };
  textPreview?: string;
  refs: {
    sourcePageRef: string;
    pageTextRef?: string;
    htmlRef?: string;
  };
};
```

### `browser.extract`

`extract` 是纯解析能力。输入必须是 Browser 或其他受信模块产生的 ref；它不能访问网络。

```ts
type BrowserExtractInput = {
  schemaVersion: "sciforge.browser-runtime.extract-input.v1";
  ref: string;
  extract: Array<"links" | "forms" | "dates" | "metadata" | "resultItems">;
  maxItems?: number;
};

type BrowserExtractOutput = {
  sourceRef: string;
  links?: Array<{
    url: string;
    text?: string;
    rel?: string;
    confidence?: number;
  }>;
  forms?: Array<{
    action?: string;
    method?: "get" | "post";
    controls: Array<{ name?: string; type?: string; value?: string }>;
  }>;
  dates?: Array<{
    value: string;
    label?: string;
    context?: string;
  }>;
  metadata?: Record<string, string>;
  resultItems?: Array<{
    title?: string;
    url?: string;
    snippet?: string;
    date?: string;
  }>;
};
```

是否需要“轻量语义抽取”由 Agent Host 决定。默认 `browser.extract` 只做通用结构抽取；不根据用户任务做语义取舍。

### `browser.download`

`download` 是受控远程资源获取。它必须产出本地 artifact ref，不允许让 Agent Host 指定任意文件系统路径。

```ts
type BrowserDownloadInput = {
  schemaVersion: "sciforge.browser-runtime.download-input.v1";
  url?: string;
  sessionId?: string;
  linkSelector?: string;
  expectedMimeTypes?: string[];
  maxBytes: number;
  saveScope: "session-artifacts";
  filenameHint?: string;
  requireUserConfirmation?: boolean;
};

type BrowserDownloadOutput = {
  requestedUrl?: string;
  finalUrl?: string;
  fileRef?: string;
  filename?: string;
  mimeType?: string;
  byteSize?: number;
  sha256?: string;
  contentDisposition?: string;
  refs: {
    fileRef?: string;
    downloadRecordRef: string;
  };
};
```

下载后的内容理解属于后续模块，例如 files、PDF、documents、spreadsheets 或专门 parser。`browser.download` 不总结文件内容。

## Agent Host 闭环

Agent Host 是唯一的网页任务智能控制器：

```text
用户请求
  -> Agent Host 生成 AcceptanceSpec
  -> Agent Host 选择 primitive + 输入 contract
  -> Browser 返回 observation / diagnostics / refs
  -> Verifier 根据 AcceptanceSpec 判断 satisfied / partial / blocked
  -> Agent Host 根据 verifier 反馈继续行动或停止
  -> Agent Host 生成 completionTruth / final answer
```

Agent Host 可以基于反馈动态决定：

- 改写、翻译、放宽或收紧 query。
- 打开哪个结果。
- 读取多少页面。
- 是否抽取链接、日期、表单或 result items。
- 是否下载远程文件。
- 何时停止并给出 blocked / partial / satisfied。

这些策略不得下沉到 Browser primitive。

## 边界规则

- 每个 primitive 调用只绑定一个 BrowserHostSession / tab scope，除非输入 contract 明确声明新建 session。
- 输入 contract 只声明当前 primitive 所需字段、预算、风险和约束。
- 不允许配置 `if/else/loop` 工作流。
- primitive 内部不得调用另一个 primitive 来完成任务级目标。
- 搜索结果页不是用户级完成证据；必须由 Agent Host 决定是否继续 open/read。
- 登录、跨站点高风险动作、提交、上传、删除、支付和账号 / 安全动作必须停止并返回 Host。
- 下载必须走 `browser.download`，并受 `maxBytes`、MIME、hash、saveScope 和 confirmation policy 约束。
- 自动 repair 禁止；打不开页面、来源不相关、结果不足或证据冲突时，只返回 diagnostics / repair hints。
- Browser 返回的 screenshot、DOM、AX、HTML、page text、download record 都是 evidence，不是 completion truth。

## Model Router 使用

Browser 可以调用 Model Router 做局部辅助：

- 页面片段摘要。
- 候选结果质量解释。
- 视觉 / 文本消歧。
- before / after 差异说明。

Model Router 不能生成用户最终总结，不能决定继续扩大搜索，不能改变 risk policy，不能产出 completion truth。

## 用户级验收

检索类用户级验收必须满足：

- 普通聊天请求触发 Agent Host 使用 Browser primitive，而不是直接进入 Browser agent。
- Browser 返回当前 run 产生的 search refs、source page refs、page text refs、download refs 或 diagnostics。
- Agent Host 基于 refs-first evidence 和 verifier 结论生成 final answer，并给出来源。
- 来源不足、页面打不开、证据冲突或结果不相关时，final answer 必须是 partial / blocked，不能编造完成。
- 用户禁止联网或要求只用本地上下文时，不调用 Browser。

## 禁止作为产品 truth 的对象

- iframe。
- proxy render。
- screenshot / snapshot replay。
- frame stream。
- 系统外部浏览器。
- 历史 run。
- 只读搜索结果页。

这些对象只能作为 diagnostic、evidence 或 handoff，不能证明 Browser 产品通过。

## 相关文档

- [`../PROJECT.md`](../PROJECT.md)：当前需求和验收标准。
- [`Architecture.md`](Architecture.md)：总架构和 Bounded Operation。
