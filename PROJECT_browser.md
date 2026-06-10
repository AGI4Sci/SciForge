# SciForge Web Search 当前任务

最后更新：2026-06-10

## 当前结论

搜索是 SciForge 的基础能力，不是独立产品、不是 browser-use 竞品，也不是第二个 agent。

当前产品工具面推荐收敛为一个普通搜索入口：

- `web_search(query)`：Codex-compatible 的网页搜索入口。优先使用 Codex native `web_search`；当 native 不可用或不足时，SciForge 才注册同名 fallback。
- `web_read(url/ref)`：不再作为普通搜索任务的默认 model-visible 工具。它保留为内部读取策略、fallback adapter、诊断能力或高级显式能力，用于 page-level detail、URL 摘要、直接引用、冲突核验、低信息搜索结果补证等场景。

Agent Host 仍是唯一智能决策载体。Agent Host 负责用户意图、query 是否合理、source policy、证据是否足够、何时升级 fallback、最终回答和 completion truth。Search / Read / Browser Runtime 只负责执行、返回结构化 evidence、timing、refs、failure reason 和可复核 artifact。

## 已确认接口决策

- 不新增 `web_search_custom`。普通模型可见入口继续叫 `web_search`，并尽量保持 Codex native search 的调用心智、事件形态、引用形态和失败诊断。
- Codex native search 是第一优先级。SciForge 只在 native 不可用、被显式禁用、或 contract probe 判定不足时，才注册同名 fallback `web_search`。
- `web_read` 继续存在，但定位是 internal / advanced capability。普通“搜索一下 X，提供 N 条信息”不要求模型手动串联 `web_search -> web_read`。
- SciForge fallback 内部可以使用确定性代码、LLM call、sub agent、真实浏览器或已有开源 adapter；对外必须表现为稳定、可验收的工具调用，不得绕过 Agent Host 生成 final answer。
- 所有 native/fallback/provider/browser 策略必须由 capability detection、配置和 provider registry 控制；不能硬编码 query、prompt、URL、provider endpoint、CLI flag、事件字段、新闻主题或历史 run。
- 防错优先于提速。先保证 query/topic/current-run/source-link/read-required 判断不会误放行，再优化 timeout、并发、缓存和 provider preset。

## 设计原则

- [x] Codex native first：如果 Codex App Server 已提供 native `web_search`，SciForge 不注册同名 direct fallback，避免 duplicate / conflict。
- [x] Fallback compatible：如果 native search 不存在、被禁用或能力不足，SciForge fallback 也暴露为 `web_search`，并尽量模拟 Codex native 的事件流、返回结构、引用形态和 diagnostics。
- [x] Search result can answer ordinary search tasks：普通“搜索一下 X，给我 N 条信息”可以由 current-run `web_search` 结果和最终答案 source links 满足，不强制 `web_read`。
- [x] Read-required escalation only：URL 摘要、网页正文细节、直接引用、精确信息核验、search metadata 低信息或来源冲突时，才进入 internal read / browser fallback / Host-owned browse harness。
- [x] `web_extract` 不进入第一版默认工具面；需要结构化抽取时再单独设计高级接口。
- [x] `web_batch_read` 不进入默认工具面；批量读取优先由 Agent Host 或调用方并发调度内部 read strategy。
- [x] `web_health` 作为 runtime resource / 管理端 endpoint，不作为普通 Agent tool。
- [x] `web_benchmark` 作为 CLI / 开发验收工具，不作为普通 Agent tool。
- [x] 不能硬编码 query、prompt、新闻主题、URL、provider endpoint、agent id、thread id、历史 run 或截图内容。
- [x] 本地开发和验收默认不使用 Docker。SearXNG sidecar 如需本地运行，使用源码 clone + Python venv + Granian。

## 当前 Tool Surface

### Model-visible 普通工具

#### `web_search(query)`

作用：完成网页搜索，返回足够让 Agent Host 生成普通搜索答案的候选来源、摘要、链接、引用 refs、timing 和 diagnostics。

策略：

1. 运行时探测 Codex native `web_search` 是否可用。
2. 可用时优先走 native；SciForge 只消费 native 事件和 refs，不注册重复同名工具。
3. 不可用或显式禁用时，注册 SciForge fallback `web_search`。
4. fallback 内部可组合可控 search provider、static read、browser render 或 Host-owned fallback harness，但对 Agent Host 的普通入口仍是 `web_search`。

输出要求：

- normalized results：`rank`、`title`、`url`、`snippet`、`source`、`publishedAt?`、`provider?`。
- refs：search result set ref、per-result page/source refs 或与 Codex native 等价的引用对象。
- timings：planning / provider / parse / optional read / fallback / total。
- diagnostics：native/fallback provider、timeout、rate limited、blocked、no results、fallback used、read escalation reason。
- final-answer usable source links：普通搜索答案必须能在最终回答里呈现可点击来源。

边界：

- 不在 Search Runtime 内生成用户级最终回答。
- 不静默启动 autonomous browser agent。
- 不绕过验证码、登录墙、付费墙或账号权限。
- 不把 cookies、credentials、raw HTML、大截图、download bytes、base64 或 secret 放入主上下文。

### Internal / advanced capability

#### `web_read(url/ref)`

作用：读取一个指定来源正文，作为 `web_search` fallback 内部策略、URL 读取高级能力、diagnostic 或 page-level verification 使用。

保留原因：

- Codex native `web_search` 通常足够完成普通搜索问题，但它不一定适合直接 URL 摘要、长网页正文读取、引用级核验、低信息 SERP 补证或 JS-heavy 页面恢复。
- `web_read` 作为内部 atomic capability 能让 fallback 策略稳定复用静态抽取和 browser render，而不把普通工具面重新拆成两个模型必须手动编排的工具。

边界：

- 只读取一个 URL / ref。
- 不继续搜索。
- 不跨站 crawl。
- 不改写任务目标。
- 不生成最终回答。

## 可复用开源工作与参考

实现前优先复用或适配已有开源组件；不要重新实现通用搜索引擎、网页正文抽取器、浏览器自动化框架或 MCP 基础协议。

### Search Provider

| 项目 | 用途 | 推荐状态 | 注意事项 |
| --- | --- | --- | --- |
| Codex native `web_search` | Codex 原生联网搜索能力，作为 SciForge 普通搜索第一优先级。 | 第一优先级，以运行时能力探测为准。 | 不硬编码 CLI flag 或事件字段；实现时通过 capability detection 和 contract tests 锁定。 |
| [SearXNG](https://github.com/searxng/searxng) | 自建 metasearch，提供 `/search?...&format=json` 候选发现。 | fallback search provider 首选。 | AGPL；作为独立 sidecar / 外部服务接入，不 vendoring 到 SciForge core。JSON 输出需要实例配置开启。 |
| [OpenSERP](https://github.com/karust/openserp) | API-first SERP 聚合，支持多引擎、JSON / OpenAPI / MCP。 | env-gated 备选研究对象。 | 当前通用 provider 默认 `q` 参数，OpenSERP 常用 `text` 参数；补专门 adapter 前不能宣传成同等可用 provider。 |
| [4get](https://git.lolcat.ca/lolcat/4get) | 自托管 metasearch，覆盖较广，有 API。 | 实验 provider。 | AGPLv3-only；安全和稳定性需审计。 |
| [YaCy](https://github.com/yacy/yacy_search_server) | 本地 / 垂直 corpus 搜索引擎和 P2P 索引。 | 后续 local_index provider。 | 不适合作通用 Web metasearch 主源；部署和索引成本较高。 |

不推荐第一版主线：Whoogle、MetaGer、商业 SERP API。Whoogle 已不适合作稳定主源；商业 API 不符合“完全自建 / 开源可控”的 fallback 约束。

### Read / Markdown Extraction

| 项目 | 用途 | 推荐状态 | 注意事项 |
| --- | --- | --- | --- |
| [Readability.js](https://github.com/mozilla/readability) | 已获取 HTML / DOM 后提取正文。 | internal `web_read` static extraction 主路径。 | Apache-2.0；需要外层 fetch / render 和 Markdown 转换。 |
| [trafilatura](https://github.com/adbar/trafilatura) | 静态 HTML 正文 / metadata 抽取，支持 Markdown / JSON / XML 输出。 | internal read adapter 备选或专项后端。 | Apache-2.0；不执行 JS。 |
| [Crawl4AI](https://github.com/unclecode/crawl4ai) | URL -> LLM-friendly Markdown，支持 browser render、session、多 URL、cache。 | browser render fallback 首选参考。 | Apache-2.0；LLM extraction 不作为第一版默认能力。 |
| [newspaper4k](https://github.com/AndyTheFactory/newspaper4k) | 新闻文章专项抽取。 | 新闻专项可选 fallback。 | MIT；不作为通用默认。 |

后续文档 / PDF 读取可接 [Apache Tika](https://github.com/apache/tika) 和 [GROBID](https://github.com/kermitt2/grobid)，但不进入普通网页搜索第一阶段。

### Browser Fallback / Harness

| 项目 | 用途 | 推荐状态 | 注意事项 |
| --- | --- | --- | --- |
| [Playwright](https://github.com/microsoft/playwright) | 浏览器 render、DOM / network / screenshot / context / profile 管理。 | browser fallback 底座。 | Apache-2.0；profile 隔离和风险策略要由 Host 显式控制。 |
| [Playwright MCP](https://github.com/microsoft/playwright-mcp) | Playwright 能力暴露成 MCP tool 的接口和会话形态。 | MCP / tool surface 参考。 | 只借鉴工具粒度、trace 和 session 边界；SciForge 仍由 Agent Host 统一调度。 |
| [browser-use](https://github.com/browser-use/browser-use) | Browser agent / 操作容错 / real browser 连接经验。 | Host-owned fallback harness 参考。 | 不作为基础工具内部静默 agent；只能在 Agent Host 显式升级时使用。 |
| [Stagehand](https://github.com/browserbase/stagehand) | AI-friendly browser `act/extract/observe` 模式。 | 页面观察、抽取和动作容错参考。 | Browserbase 云能力不是第一版依赖。 |
| [Crawlee](https://github.com/apify/crawlee) | request queue、session pool、proxy、Playwright / Puppeteer crawler 编排。 | 后续批量 / crawler 编排参考。 | 第一阶段不做默认 crawler。 |
| [Browsertrix Crawler](https://github.com/webrecorder/browsertrix-crawler) | WARC / WACZ 归档和可复现网页抓取。 | 后续证据归档可选。 | AGPL；不是正文抽取主工具。 |

不推荐默认采用：CloakBrowser、Browserless stealth、undetected / stealth 插件。它们存在不可审计二进制、许可、长期稳定性或合规风险，不符合第一阶段基础能力目标。

### MCP / Tool Surface 参考

| 项目 | 可借鉴点 | 注意事项 |
| --- | --- | --- |
| [mcp-server-fetch](https://github.com/modelcontextprotocol/servers/tree/main/src/fetch) | `fetch(url, max_length, start_index, raw)` 的分块读取、robots/user-agent/proxy、安全边界。 | 只有 fetch/read，没有 search；需要补 SSRF guard。 |
| [mcp-searxng](https://github.com/ihor-sokoliuk/mcp-searxng) | SearXNG MCP tool / HTTP health / provider 包装。 | 可借鉴接口，不必 MCP 套 MCP；SciForge 内部优先 provider adapter。 |
| [mcp-crawl4ai](https://pypi.org/project/mcp-crawl4ai/) | Crawl4AI 的 scrape / crawl / artifact tool 设计。 | 第一阶段只借鉴 read / artifact，不做 autonomous crawl。 |
| [Firecrawl MCP](https://github.com/mcp/firecrawl/firecrawl-mcp-server) | scrape / search / map / crawl / extract 工具命名和任务拆分。 | Firecrawl 主仓库 AGPL；只借鉴接口，不作为默认依赖。 |

## 当前待实现任务

实施顺序必须先文档锁定，再做最小代码改动：

1. P0：锁定 Codex-native first contract 和 fallback 注册规则。
2. P1：让 ordinary search completion 可以由 current-run `web_search` source links 通过。
3. P2：补稳定 fallback provider path，但保持同名 `web_search` facade。
4. P3：补 internal read / browser fallback，只作为 read-required escalation。
5. P4：用普通聊天入口做 native product proof、fallback product proof 和 negative proof。

任何阶段都不能把 fixture、历史 run、截图、package probe 或诊断脚本伪装成普通用户任务完成。

### P0：Codex-native first contract

目标：让 SciForge 普通搜索入口在 Codex 看来就是 native `web_search` 策略；SciForge fallback 只是 native 不可用或不足时的同名兼容实现。

Build Tasks：

- [x] 任务栏固定参考 Codex native `web_search` 的真实事件流、tool-call shape、source citation shape 和 failure/diagnostic shape；以运行时观测和 contract tests 为准，不硬编码某个版本字段。
- [x] 定义 `WebSearchCapability` 探测结果：`native_available`、`native_enabled`、`fallback_registered`、`conflict_detected`、`reason`。
- [x] Codex native 可用时，不向 ordinary Agent Host direct tools 注册 SciForge fallback `web_search`。
- [x] Codex native 不可用、被禁用或 contract 不满足时，注册 SciForge fallback `web_search`。
- [x] fallback `web_search` 的输入、事件、结果、refs、source links、timing 和 diagnostics 尽量对齐 native shape。
- [x] 保留 `web_read` 为 internal / advanced capability，不进入 ordinary search direct tool list。
- [x] 所有策略通过配置、capability detection 和 provider registry 控制；禁止硬编码 query、prompt、URL、provider endpoint 或新闻主题。
- [x] 明确不实现 `web_search_custom`，也不新增第二个普通搜索入口。

Acceptance Gates：

- [x] Unit test：native available 时 ordinary direct tool list 不包含 SciForge fallback duplicate。
- [x] Unit test：native unavailable 时 fallback `web_search` 被注册，且 tool name 与 native 保持一致。
- [x] Unit test：检测到 native / fallback 同名冲突时 fail closed，并输出可读 diagnostics。
- [x] Contract test：native 与 fallback 都能投影到同一个内部 `SearchEvidence` 模型。
- [x] Static / config audit：无硬编码 query、prompt、URL、provider endpoint、CLI flag、事件字段、新闻主题或历史 run。

### P1：Ordinary search completion

目标：普通搜索任务不再强制 `web_read`；只要 current-run `web_search` 给出足够结果和 source links，Agent Host 可以完成用户任务。

Build Tasks：

- [x] 更新 Agent Host evidence ledger：记录 current-run `web_search` result refs、source links、query、provider/native/fallback、timing 和 diagnostics。
- [x] 更新 completion gate：普通搜索答案允许由 search evidence + final answer source links 满足。
- [x] 定义 read-required escalation 条件：用户给 URL、要求页面正文/长摘要/直接引用、搜索结果低信息、来源冲突、高精度事实核验、paywall/login/captcha/JS-heavy。
- [x] 对“至少 N 条信息”类任务，验收 source count、topic relevance、time window 和 final answer links，不要求每条都先 `web_read`。
- [x] 保留 repair 策略：query 污染、source mismatch、结果不足、provider timeout、rate limit 时由 Agent Host 决定换 query、重试、fallback 或 blocked。

Acceptance Gates：

- [x] Product acceptance：`搜索一下伊朗局势，至少提供5条信息` 可以用 native `web_search` + final source links 完成，不因缺少 `web_read` 被判 failed。
- [x] Negative fixture：search 结果明显偏题时不能 pass。
- [x] Negative fixture：用户明确要求“打开并总结这个 URL”时，search-only 不能 pass，必须进入 read-required path。
- [x] Negative fixture：历史 refs、fixture refs、截图和旧 run 不能满足 current-run completion。
- [x] Regression：普通搜索任务中，缺 `web_read` 不应单独触发 failed / incomplete。

### P2：Fallback provider path

目标：native 不可用或不足时，SciForge fallback `web_search` 仍能稳定完成普通搜索，不把用户暴露给复杂多工具编排。

Build Tasks：

- [x] fallback provider 首选 SearXNG JSON；本地 sidecar 继续使用源码 clone + Python venv + Granian，不使用 Docker。
- [x] SearXNG presets 保留 `docs`、`science`、`stable`，但只作为 provider 参数配置，不改变 Agent Host source policy。
- [x] OpenSERP 继续作为 env-gated 研究对象；补专门 adapter 处理 `text` 参数 / endpoint shape 前，不宣传成同等可用 provider。
- [x] fallback 内部可按需调用 internal `web_read` / Readability / trafilatura / Crawl4AI / Playwright render，但对 ordinary Agent Host 仍返回 `web_search` 结果。
- [x] fallback 必须记录 provider latency、parse latency、optional read latency、fallback reason、blocked reason 和 retry count。

Acceptance Gates：

- [x] Local fixture：SearXNG JSON 正常结果、空结果、429、5xx、malformed JSON、重复 URL、unsafe URL 过滤。
- [x] Live diagnostic：本地 SearXNG sidecar 通过至少 5 个 query，manifest 标记 `dockerUsed=false`。
- [x] Timeout diagnostic：默认通用搜索引擎 timeout 时能解释耗时来源，并建议切 preset / engine，不悬挂到全局超时。

### P3：Internal read and browser fallback

目标：把最难的 browser fallback 调通，但只作为 search/read strategy 的执行恢复能力，不变成第二个 Agent Host。

Build Tasks：

- [x] internal read 默认复用 Readability.js + jsdom；deterministic HTML clean 只作为 fallback。
- [x] trafilatura / newspaper4k / Crawl4AI 作为可插拔 adapter 候选，不进入 ordinary direct tool list。
- [x] Playwright / BrowserHostSession 作为 browser render fallback 底座，记录 trace、screenshot refs、network diagnostics 和 timing。
- [x] 需要多步交互、登录态、验证码、用户 profile 时，必须由 Agent Host 显式升级到 browse/search fallback harness；基础工具只返回 `needs_user_browser` 或 escalation hint。
- [x] browser-use / Stagehand / Playwright MCP 只作为 harness 经验参考；不得在基础工具内部静默启动 autonomous agent。

Acceptance Gates：

- [x] JS-heavy fixture：static extraction 低信息时，browser render fallback 能产出 page/source refs 或明确 blocked reason。
- [x] CAPTCHA/login surrogate fixture：不能自动绕过，必须返回 `needs_user_browser` 或 blocked。
- [x] Fallback timing report 能解释 navigation / wait / extract / persist / total 的耗时。

### P4：Strict product proof

目标：验收从“两个原子函数机械跑通”升级为“普通用户任务真的能完成”，并严格区分 unit、diagnostic、live 和 product proof。

Build Tasks：

- [x] 保留 atomic live test 作为 internal function proof，但不再把 `web_search -> web_read` 视为普通搜索产品必需路径。
- [ ] 新增 native-first product proof：真实 SciForge ordinary chat，优先走 Codex native `web_search`，完成普通搜索任务并展示 source links。
- [ ] 新增 fallback product proof：禁用 native 后，fallback `web_search` 完成同类任务，事件和 refs 能投影到同一 `SearchEvidence`。
- [x] Product proof manifest 必须记录 native/fallback route、tool trace、source links、topic relevance、source count、timings、failure reason 和 UI-visible final answer。
- [x] 所有 blocked/partial 也必须有 current-run refs、failure reason 和用户可恢复路径。

Acceptance Gates：

- [x] `git diff --check` 通过。
- [x] Typecheck / unit tests 通过。
- [ ] Native product proof、fallback product proof、read-required negative proof 均可复现。
- [x] Search-only answer、历史 refs、fixture refs、GUI projection、screenshot replay 不能 pass。

当前 live product proof 状态：

- Runtime Codex 普通 app-server client 已在启动边界接入 `config.local.json -> Model Router` bootstrap：`config.local.json` 的 member-model secret 只进入 `SCIFORGE_TEXT_*` / Router role env，Runtime Codex 仍只使用 `sciforge-model-router` / `sciforge-router` 和本地 Router key。
- 已补 route-specific CLI：`npm run web-search-product-acceptance:native` / `npm run web-search-product-acceptance:fallback` 和 desktop 对应脚本；下一步以这两条 live command 的 current-run manifest 决定 native/fallback product proof 是否可勾。

## 非目标

- 不把搜索做成独立产品。
- 不做 browser-use 竞品。
- 不做通用 crawler / deep research agent。
- 不做默认 `web_extract`。
- 不做默认 `web_batch_read`。
- 不默认使用用户主浏览器 profile。
- 不自动绕过 CAPTCHA、登录墙、付费墙或账号权限。
- 不把历史 run、fixture、截图或 UI projection 当作用户级完成证据。
- 不把 internal `web_read` 重新暴露成普通搜索任务必须手动调用的第二个 model-visible 工具。

## 打勾规则

- `[x]` 只能在对应 Build Tasks、Acceptance Gates 和设计原则都满足后打。
- Unit proof 不能升级为 live diagnostic。
- Live diagnostic 不能升级为 product proof。
- Product proof 必须来自普通聊天入口 current-run evidence。
- 任何 pass manifest 都必须能重新打开 refs 指向的 artifact 并复核 source links / hash / timing / route。
- 如果验收只证明协议形状，应标记 diagnostic-only，不能写成用户级完成。

## 文档地图

- [`PROJECT.md`](PROJECT.md)：SciForge 总体 Agent Host 与工具边界。
- [`docs/Architecture.md`](docs/Architecture.md)：唯一 Agent Host 产品链路。
- [`docs/BrowserRuntimeArchitecture.md`](docs/BrowserRuntimeArchitecture.md)：Browser / search / read / fallback 边界。
- [`packages/actions/browser-runtime`](packages/actions/browser-runtime)：Browser primitive contract、MCP adapter 和测试。
- [`tools/start-searxng-sidecar.ts`](tools/start-searxng-sidecar.ts)：非 Docker SearXNG sidecar 启动器。
- [`tools/web-search-atomic-live.ts`](tools/web-search-atomic-live.ts)：internal atomic live CLI，证明 fallback search/read capability，不代表 ordinary product path 必须 `web_read`。
- [`tools/web-search-live-diagnostic.ts`](tools/web-search-live-diagnostic.ts)：live diagnostic CLI。
- [`tools/web-search-product-acceptance.ts`](tools/web-search-product-acceptance.ts)：普通聊天入口 product acceptance CLI。
- [`tools/desktop-web-search-product-acceptance.ts`](tools/desktop-web-search-product-acceptance.ts)：真实 Electron 桌面 wrapper。
