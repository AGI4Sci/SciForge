# SciForge Web Search 当前任务

最后更新：2026-06-09

## 用户真正要什么

搜索只是 SciForge 的基础能力，不是独立产品、不是第二个 agent，也不是浏览器自动化展示项目。

当前目标是把两个原子工具做扎实：

- `web_search(query)`：稳定发现候选来源。
- `web_read(url/ref)`：稳定读取单个来源正文。

Agent Host 负责用户意图、query 是否合理、读哪些来源、证据是否足够、是否升级 fallback、最终回答和 completion truth。Web Search Runtime 只负责执行、返回结构化 evidence、timing、refs、failure reason 和可复核 artifact。

## 总体决策

- [ ] 第一版只暴露 `web_search` 和 `web_read` 两个普通业务工具。
- [ ] `web_extract` 不进入第一版默认工具面；后续有批量结构化采集需求时再单独设计。
- [ ] `web_batch_read` 不进入默认工具面；需要批量时由 Agent Host 或调用方并发调用 `web_read`。
- [ ] `web_health` 作为 runtime resource / 管理端 endpoint，不作为普通 Agent tool。
- [ ] `web_benchmark` 作为 CLI / 开发验收工具，不作为普通 Agent tool。
- [ ] `web_search` 首选自建、开源可控的 JSON search provider，例如 SearXNG；OpenSERP 可作为备选 provider。
- [ ] `web_read` 首选 static fetch + Markdown 抽取；trafilatura / Readability 作为静态正文抽取主路径。
- [ ] Browser render 只作为 fallback：Crawl4AI / BrowserHostSession / Playwright path 可用于 JS-heavy、静态读取失败或正文缺失场景。
- [ ] 复杂 browse fallback 需要智能时，由 Agent Host 显式启动 browse/search fallback sub agent 或 local harness；基础工具内部不能静默启动 autonomous agent。

## 可复用开源工作与参考

实现前优先复用或适配已有开源组件；不要重新实现通用搜索引擎、网页正文抽取器、浏览器自动化框架或 MCP 基础协议。

### Search Provider

| 项目 | 用途 | 推荐状态 | 注意事项 |
| --- | --- | --- | --- |
| [SearXNG](https://github.com/searxng/searxng) | 自建 metasearch，提供 `/search?...&format=json` 候选发现。 | 第一版首选 search provider。 | AGPL；作为独立 sidecar / 外部服务接入，不 vendoring 到 SciForge core。JSON 输出需要实例配置开启。 |
| [OpenSERP](https://github.com/karust/openserp) | API-first SERP 聚合，支持多引擎、JSON / OpenAPI / MCP。 | 第一版备选 provider，env-gated。 | 页面级 SERP 抽取仍可能遇到 captcha / 503；适合作 SearXNG 备援。 |
| [4get](https://git.lolcat.ca/lolcat/4get) | 自托管 metasearch，覆盖较广，有 API。 | 实验 provider。 | AGPLv3-only；项目和安全边界需要先审计。 |
| [YaCy](https://github.com/yacy/yacy_search_server) | 本地 / 垂直 corpus 搜索引擎和 P2P 索引。 | 后续 local_index provider。 | 不适合作通用 Web metasearch 主源；部署和索引成本较高。 |

不推荐第一版主线：Whoogle、MetaGer、商业 SERP API。Whoogle 已不适合作稳定主源；商业 API 不符合“完全自建 / 开源可控”的第一版约束。

### Read / Markdown Extraction

| 项目 | 用途 | 推荐状态 | 注意事项 |
| --- | --- | --- | --- |
| [Crawl4AI](https://github.com/unclecode/crawl4ai) | URL -> LLM-friendly Markdown，支持 browser render、session、多 URL、cache。 | `web_read` browser render fallback 首选；也可作为 read 主后端实验。 | Apache-2.0；LLM extraction 不作为第一版默认能力。 |
| [trafilatura](https://github.com/adbar/trafilatura) | 静态 HTML 正文 / metadata 抽取，支持 Markdown / JSON / XML 输出。 | `web_read` static extraction 首选。 | Apache-2.0；不执行 JS。 |
| [Readability.js](https://github.com/mozilla/readability) | 已获取 HTML / DOM 后提取正文。 | `web_read` 静态 fallback 或 DOM 后处理。 | Apache-2.0；需要外层 fetch / render 和 Markdown 转换。 |
| [newspaper4k](https://github.com/AndyTheFactory/newspaper4k) | 新闻文章专项抽取。 | 新闻专项可选 fallback。 | MIT；不作为通用默认。 |

后续文档 / PDF 读取可接 [Apache Tika](https://github.com/apache/tika) 和 [GROBID](https://github.com/kermitt2/grobid)，但它们不进入第一版 `web_read` 普通网页 scope。

### Browser Fallback / Harness

| 项目 | 用途 | 推荐状态 | 注意事项 |
| --- | --- | --- | --- |
| [Playwright](https://github.com/microsoft/playwright) | 浏览器 render、DOM / network / screenshot / context / profile 管理。 | 基础 browser fallback 底座。 | Apache-2.0；浏览器二进制分发和 profile 隔离要单独处理。 |
| [browser-use](https://github.com/browser-use/browser-use) | Browser agent / 操作容错 / real browser 连接经验。 | 参考或 Host-owned fallback harness 候选。 | 不作为基础工具内部静默 agent；只能在 Agent Host 显式升级时使用。 |
| [Stagehand](https://github.com/browserbase/stagehand) | AI-friendly browser `act/extract/observe` 模式。 | 参考页面观察、抽取和动作容错设计。 | Browserbase 云能力不是第一版依赖。 |
| [Crawlee](https://github.com/apify/crawlee) | request queue、session pool、proxy、Playwright / Puppeteer crawler 编排。 | 后续批量 / crawler / browser fallback 编排。 | Apache-2.0；第一版不做 `web_batch_read`。 |
| [Browsertrix Crawler](https://github.com/webrecorder/browsertrix-crawler) | WARC / WACZ 归档和可复现网页抓取。 | 后续证据归档可选。 | AGPL；不是正文抽取主工具。 |

不推荐默认采用：CloakBrowser、Browserless OSS / Enterprise stealth、undetected / stealth 插件。它们存在不可审计二进制、SSPL / 商业许可、长期稳定性或合规风险，不符合第一版“开源可控基础能力”的目标。

### MCP / Tool Surface 参考

| 项目 | 可借鉴点 | 注意事项 |
| --- | --- | --- |
| [mcp-server-fetch](https://github.com/modelcontextprotocol/servers/tree/main/src/fetch) | `fetch(url, max_length, start_index, raw)` 的分块读取、robots/user-agent/proxy、安全边界。 | 只有 fetch/read，没有 search；需要补 SSRF guard。 |
| [mcp-searxng](https://github.com/ihor-sokoliuk/mcp-searxng) | SearXNG MCP tool / HTTP health / Docker 接入形态。 | 可借鉴接口，不必 MCP 套 MCP；SciForge 内部优先 provider adapter。 |
| [mcp-crawl4ai](https://pypi.org/project/mcp-crawl4ai/) | Crawl4AI 的 scrape / crawl / artifact tool 设计。 | 第一版只借鉴 read / artifact，不做 autonomous crawl。 |
| [Firecrawl MCP](https://github.com/mcp/firecrawl/firecrawl-mcp-server) | scrape / search / map / crawl / extract 工具命名和任务拆分。 | Firecrawl 主仓库 AGPL；只借鉴接口，不作为默认依赖。 |

## 不可变原则

每次打勾前都要重新确认这些原则。

- [x] 旧逻辑代码和最终目标冲突时，删除旧逻辑，直接实现新版本，不做兼容，保持代码干净。
- [x] 所有修改必须通用，不能为当前页面、截图、URL、文件名、agent id 或历史 run 写硬编码补丁。
- [x] 大对象必须 refs-first；截图、图片、provider payload、trace、日志和 artifact 不得作为 raw/base64 长期进入聊天正文或主上下文。
- [x] LLM API 配置使用 `/Applications/workspace/ailab/research/app/SciForge/config.local.json`。
- [x] 在能提高时间效率的前提下，尽可能使用 sub agent 并行推进；并行任务必须拆清边界，避免不同 worker 修改同一文件造成冲突。
- [x] SciForge 对话、工作链路需要统一，不要额外生出旁路。
- [x] 符合 `docs/Architecture.md` 设计原则；如果继续推进会导致混乱、衍生旁路、设计方案不合理、有相互冲突的点，或有更简洁通用的实现方案，需要停下来和用户讨论。
- [x] Agent Host owns intent, source policy, evidence sufficiency, repair, final answer and completion truth.
- [x] Web Search Runtime owns execution only: provider call, browser render, extraction, refs, timing, diagnostics and blocked reason.
- [x] `web_search` 结果只是候选，不能作为已读取来源 evidence。
- [x] `web_read` 只读取一个 URL / ref，不能继续搜索、跨站 crawl、改写任务目标或生成最终回答。
- [x] 工具结果必须 refs-first；raw HTML、长文本、截图、cookies、credentials、download bytes、base64、secret 不得进入主聊天正文。
- [x] 所有 URL 访问必须 fail closed：只允许 HTTP(S)，默认拒绝 `localhost`、私网 IP、link-local、metadata endpoint、`file:` 和特殊协议。
- [x] 登录态、验证码、付费墙、敏感域名和用户 profile 必须显式 policy / approval，不得自动绕过。
- [x] 不能为当前截图、URL、query、thread、agent id 或历史 run 写硬编码补丁。
- [x] 旧 `browser.search_read`、`browser.open_read`、`browser.open`、search-only summary path 不能作为新实现兼容层回流。
- [x] 如果实现方案开始制造第二条 Agent Host、第二套 final answer 或第二套 verifier，必须停下来重新讨论。

## 目标接口

### `web_search(query)`

作用：发现候选来源。

输入：

- `query`：Agent Host 给定的搜索 query。
- 可选：`limit`、`language`、`region`、`time_range`、`safe_search`、`provider`、`timeout_ms`、`constraints`。

输出：

- normalized results：`rank`、`title`、`url`、`snippet`、`source`、`publishedAt?`、`provider`。
- refs：search result set ref、per-result discovered page refs。
- evidence boundary：候选已发现，页面正文未知。
- timings：provider latency、parse latency、total latency。
- diagnostics：provider degraded、timeout、rate limited、blocked、no results、fallback used。

边界：

- 不读取正文。
- 不总结。
- 不改写 query。
- 不决定候选是否足够回答用户。

### `web_read(url/ref)`

作用：读取一个来源正文。

输入：

- `url` 或 `resourceRef`，二选一。
- 可选：`format=markdown|text|html|metadata`、`render=auto|static|browser`、`max_chars`、`timeout_ms`、`cache_policy`、`constraints`。

输出：

- source metadata：`requestedUrl`、`finalUrl`、`title`、`author?`、`publishedAt?`、`contentType`、`language?`。
- content：Markdown / text preview 或 bounded content ref。
- refs：source page ref、page text ref、HTML ref if allowed。
- evidence boundary：页面正文已物化，是否低信息 / blocked / partial。
- timings：fetch、render、extract、persist、total。
- diagnostics：HTTP status、network error、blocked reason、needs browser、needs user browser、extract failed。

边界：

- 只读取一个来源。
- 不继续搜索。
- 不跨页面扩展。
- 不做任务级事实综合。

## P0：Contract 与 Tool Surface

目标：先把 `web_search` / `web_read` 的输入、输出、refs 和失败语义定死，避免实现过程中继续长出旧 Browser 旁路。

Build Tasks：

- [ ] 定义 `web_search` input / output schema。
- [ ] 定义 `web_read` input / output schema。
- [ ] 定义统一 result envelope：`ok`、`status`、`tool`、`provider`、`data`、`refs`、`timings`、`warnings`、`error`。
- [ ] 定义 resource refs：`web-search:{id}`、`web-page:{id}`、`web-source:{id}`、`web-text:{id}`。
- [ ] 定义稳定 error codes：`invalid_input`、`unsafe_url`、`provider_unavailable`、`timeout`、`rate_limited`、`no_results`、`read_failed`、`extract_failed`、`needs_browser`、`needs_user_browser`。
- [ ] 明确 `web_health` resource / endpoint 和 `web_benchmark` CLI 不进入普通 Agent tool list。
- [ ] 更新 Browser / Agent Host 文档和 tool descriptions，统一使用 `web_search` / `web_read` 口径。

Acceptance Gates：

- [ ] Schema tests 覆盖必填、未知字段、越界 limit/max_chars/timeout、非 HTTP(S) URL、resourceRef 类型不匹配。
- [ ] Direct tool specs 只出现 `web_search` / `web_read`，不出现 `web_extract` / `web_batch_read` 作为第一版工具。
- [ ] `web_search` output 明确声明 search result 不是 source evidence。
- [ ] `web_read` output 明确声明 source/page text refs 才是读取 evidence。

## P1：`web_search` Provider Path

目标：搜索候选发现不再默认依赖真实浏览器打开搜索页，优先走可控 JSON provider，降低慢和不稳定。

Build Tasks：

- [ ] 新增 `SearchCandidateProvider` 抽象。
- [ ] 实现 SearXNG JSON provider adapter。
- [ ] 预留 OpenSERP provider adapter，但第一版可以 env-gated / disabled。
- [ ] 实现 result normalization：title、URL、snippet、rank、provider、publishedAt?。
- [ ] 实现 URL canonicalization、去重、搜索引擎自链接过滤和 unsafe URL 过滤。
- [ ] 实现 provider timeout、rate limit / 429 分类、retry / fallback diagnostics。
- [ ] 搜索结果落盘为 refs-first artifact，不能把大 payload 放入聊天正文。
- [ ] Browser SERP adapter 只作为 fallback provider，不作为默认主路径。

Acceptance Gates：

- [ ] Local fixture test 覆盖 SearXNG JSON 正常结果、空结果、429、5xx、malformed JSON、重复 URL、搜索引擎自链接。
- [ ] Live diagnostic 在配置了本地 SearXNG 时，至少 5 个多语言 query 每个返回可解析候选和 timing。
- [ ] `web_search` 不触发 `web_read`、不产出 page text refs、不把 snippet 标记为 source evidence。
- [ ] Provider 不可用时返回 `provider_unavailable` / `timeout`，不能静默改走旧 search summary。
- [ ] 浏览器 fallback 被调用时必须在 result 中标记 `fallbackUsed=true`、fallback provider、fallback reason 和 timing。

## P2：`web_read` Static Read Path

目标：给定 URL / ref 后，能快速、稳定地读取公开网页正文并物化 refs。

Build Tasks：

- [ ] 实现 `resourceRef -> URL` 机械解析，只解析 `web_search` 产出的 discovered web page refs。
- [ ] 实现 static fetch，带 timeout、redirect policy、content-type、max bytes 和 unsafe URL guard。
- [ ] 接入 trafilatura / Readability 静态正文抽取。
- [ ] 输出 Markdown / text，并保留 bounded preview。
- [ ] 物化 source page metadata ref 和 page text ref，记录 finalUrl、title、contentType、textSha1、openedAt。
- [ ] 对低信息页面、403/401、网络失败、非 HTML、正文为空等返回 partial / blocked diagnostics。
- [ ] 缓存策略显式化：cache hit / miss / revalidated 必须进入 timings 或 metadata。

Acceptance Gates：

- [ ] Local fixture test 覆盖普通 HTML、新闻页结构、文档页、重定向、乱码/编码、正文为空、403、401、404、网络失败。
- [ ] `web_read({ resourceRef })` 能读取 `web_search` 发现的候选；未知 ref、非 web page ref、无 URL locator 必须 fail closed。
- [ ] 读取成功必须产生 source page ref 和 page text ref，并能从磁盘重新打开验证 textSha1。
- [ ] 读取失败不能产出伪 source evidence，final answer gate 不能 satisfied。
- [ ] Markdown 不得包含明显 nav/script/style/cookie banner 主体噪声作为主要内容。

## P3：Browser Render Fallback

目标：静态读取失败或内容明显缺失时，能通过受控浏览器 render 补齐正文，但不把基础工具变成自主 agent。

Build Tasks：

- [ ] 定义 fallback policy：何时允许 browser render，何时返回 `needs_browser` / `needs_user_browser`。
- [ ] 接入 Crawl4AI / BrowserHostSession / Playwright browser render path。
- [ ] 默认使用 workspace profile，不使用用户主 profile。
- [ ] 记录 browser fallback trace：navigation URL、finalUrl、wait reason、extract method、timing、blocked reason。
- [ ] 对 JS-heavy 页面、懒加载正文、cookie banner、搜索页阻断、验证码、登录态分别给出明确 status。
- [ ] 多步交互、真实用户 profile、验证码/登录态必须升级为 Host-owned browse/search fallback sub agent；基础 `web_read` 只能返回 `needs_user_browser` 或 explicit escalation hint。
- [ ] 参考 browser-use / Stagehand / Playwright MCP 的会话管理、页面观察和动作容错经验，但不能引入静默二级 Agent。

Acceptance Gates：

- [ ] Local JS fixture：static read 内容缺失时 browser render fallback 成功，并记录 fallback trace。
- [ ] CAPTCHA/login surrogate fixture：不能自动绕过，必须返回 `needs_user_browser` 或 blocked。
- [ ] Browser fallback 成功时仍只返回 `web_read` source/page text refs，不生成 final answer。
- [ ] Browser fallback 失败时必须有可读 failure reason，不能卡住直到全局超时。
- [ ] 所有 fallback timing 必须能解释总耗时花在哪里。

## P4：Agent Host 集成

目标：Agent Host 可以像调用基础工具一样使用搜索能力，同时保留任务级智能和验收权。

Build Tasks：

- [ ] 在 Agent Host dynamic tools / MCP-style surface 暴露 `web_search` 和 `web_read`。
- [ ] Agent Host prompt / tool descriptions 明确：search 只发现候选，read 才产生 source evidence。
- [ ] Evidence Ledger 能记录 `web_search` discovered refs 和 `web_read` source/page text refs。
- [ ] Final answer gate 必须要求 current-run `web_read` source/page text refs；search result / snippet 不能单独满足。
- [ ] Query 污染、source relevance、source count、temporal gap 继续由 Agent Host verifier 负责。
- [ ] 复杂场景升级 browse/search fallback sub agent 时，必须由 Agent Host 显式发起，并把 trace 纳入 evidence。

Acceptance Gates：

- [ ] Direct `web_search` / `web_read` tool call 和 module dispatcher path 结果一致。
- [ ] 普通聊天搜索任务必须至少出现一次 `web_search` 和一次 `web_read`，最终回答来源必须来自实际读取 refs。
- [ ] 模型重复 search 而不 read 时，Agent Host 必须 repair / auto-read / block，不能给 search snippet answer。
- [ ] 模型读到低信息或不相关来源时，Agent Host 必须继续 repair 或 partial/block。

## P5：Strict Acceptance Harness

目标：严格区分 unit、local diagnostic、live diagnostic 和 product proof；不能用 fixture 或旧 run 冒充产品完成。

Proof 层级：

- `unit proof`：函数 / adapter / schema 级测试，只证明局部逻辑。
- `local diagnostic`：本地 fixture HTTP server / fake provider / local browser fixture，只证明协议和 fallback 形状。
- `live diagnostic`：真实 provider、真实网页、真实 BrowserHostSession / browser render refs，只证明能力可用。
- `product proof`：桌面 SciForge App 普通聊天入口，current-run `web_search -> web_read -> verified final answer`，用户可见来源来自实际读取 refs。

Build Tasks：

- [ ] 建立 `web_search` / `web_read` local fixture suite。
- [ ] 建立 live diagnostic script，要求本地 SearXNG 或明确 configured provider。
- [ ] 建立 product acceptance writer，验证普通聊天入口的 current-run evidence。
- [ ] 建立 negative fixture：search-only、read blocked、low-info page、topic mismatch、stale refs、historical manifest。
- [ ] 建立 timing report：planning、search provider、parse、read fetch、render、extract、persist、final synthesis。

Strict Gates：

- [ ] `npm run typecheck` 通过。
- [ ] `git diff --check` 通过。
- [ ] Unit tests 覆盖 P0/P1/P2/P3 error paths。
- [ ] Live diagnostic 至少覆盖：新闻网页、普通文档页、JS-heavy 页面、403/401 surrogate、network failure。
- [ ] Product proof 至少覆盖三类普通聊天任务：新闻 / 最新情况、普通网页资料检索、学术或技术文档检索。
- [ ] Product proof 必须验证 source page JSON、page text 文件、textSha1、openedAt、finalUrl、source link in final answer。
- [ ] Search-only answer、snippet-only answer、历史 refs、fixture refs、GUI projection、screenshot replay 一律不能 pass。
- [ ] 如果返回 blocked/partial，也必须有 current-run refs、failure reason 和用户可恢复路径。

## P6：迁移与清理

目标：新的 Web Search 基础能力落地后，旧 Browser 搜索路径只保留为内部 fallback 或 diagnostic，不再污染普通工具面。

Build Tasks：

- [ ] 清理旧 Browser search task 文档和旧验收证据，避免已完成历史误导当前任务。
- [ ] 确认 `browser_search` / `browser_read` 与新 `web_search` / `web_read` 的关系：迁移、兼容 alias 或保留 Browser primitive internal path 必须有明确 owner。
- [ ] 删除或 fail closed 旧 search summary、search_read、open_read、search-only product path。
- [ ] 更新 docs、README、tool descriptions、runbooks 和 smoke naming。
- [ ] 把 BrowserHostSession 作为 browser render fallback owner，而不是默认 search provider owner。

Acceptance Gates：

- [ ] 代码搜索确认旧组合入口没有作为 product path 回流。
- [ ] 文档只宣传 `web_search` / `web_read` 第一版能力。
- [ ] Browser Runtime Architecture、PROJECT.md、PROJECT_browser.md 口径一致。
- [ ] 没有第二个 Agent Host、第二套 final-answer path 或 Browser-side verifier。

## 非目标

- 不把搜索做成独立产品。
- 不做 browser-use 竞品。
- 不做通用 crawler / deep research agent。
- 不做默认 `web_extract`。
- 不做默认 `web_batch_read`。
- 不默认使用用户主浏览器 profile。
- 不自动绕过 CAPTCHA、登录墙、付费墙或账号权限。
- 不把搜索结果、snippet、screenshot、历史 run、fixture 或 package probe 当作用户级完成证据。

## 打勾规则

- `[x]` 只能在对应 Build Tasks、Acceptance Gates 和不可变原则都满足后打。
- Unit proof 不能升级为 live diagnostic。
- Live diagnostic 不能升级为 product proof。
- Product proof 必须来自普通聊天入口 current-run evidence。
- 任何 pass manifest 都必须能重新打开 refs 指向的 artifact 并复核 hash / finalUrl / openedAt。
- 如果验收只证明协议形状，应标记 diagnostic-only，不能写成用户级完成。

## 文档地图

- [`PROJECT.md`](PROJECT.md)：SciForge 总体 Agent Host 与工具边界。
- [`docs/Architecture.md`](docs/Architecture.md)：唯一 Agent Host 产品链路。
- [`docs/BrowserRuntimeArchitecture.md`](docs/BrowserRuntimeArchitecture.md)：Browser / search 工具边界。
- [`packages/actions/browser-runtime`](packages/actions/browser-runtime)：当前 Browser primitive contract、MCP adapter 和测试。
