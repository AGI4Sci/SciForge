# Browser Runtime 设计

最后更新：2026-06-10

## 文档目的与约束

这份文档只记录 Browser Runtime 本身的稳定边界和沟通口径，目标是让人类和 agent 读完后能快速理解 Browser 是什么、能做什么、不能做什么。

原则约束：

- Browser 是网页信息输入与局部浏览器操作 runtime，不是 Browser agent，也不是搜索总结工具。
- 精确字段、schema、MCP tool definition、validator 和测试真相源放在 `packages/actions/browser-runtime` 和 runtime tests。
- 本文只描述边界、primitive、证据原则和迁移口径；不展开 UI、模型路由或产品工作流实现细节。
- 历史路径只保留必要迁移口径，不作为新设计的主叙事。

## 定位

Browser 只负责：

- 执行调用方明确请求的浏览器 primitive。
- 维护 BrowserHostSession / tab scope、页面状态、导航状态和可审计 artifact。
- 返回结构化 observation、diagnostics 和 refs-first evidence。
- 对危险、越界、预算不足或证据不足的请求 fail closed。

Browser 不负责：

- 查询改写。
- 来源取舍。
- 事实综合。
- 最终总结。
- 跨模块 repair。
- 用户级 completion truth。
- 判断用户意图是否完成。
- 根据特定站点、语言或领域写场景策略。

## 外部边界

Browser 不直接面向用户表达的完整任务。调用方必须先给出明确 query、URL、session、ref、budget、risk policy 或下载约束。

Browser 返回网页状态、页面内容 refs、下载 artifact refs、diagnostics、blocked reason 和 repair hints；调用方负责继续推理、修复、验证和生成最终答复。

Browser pane 只能作为 BrowserHostSession 的展示和控制面板，不能成为 Browser 的任务语义入口。

## Ordinary Web Search Surface

SciForge 普通搜索工具面收敛为 Codex-compatible `web_search`。

优先级：

1. Codex native `web_search` 可用时，SciForge 优先使用 native search，不注册同名 direct fallback。
2. Native 不可用、被禁用或能力不足时，SciForge fallback 才注册为同名 `web_search`。
3. Fallback 的事件流、返回结构、引用形态、source links 和 diagnostics 尽量模拟 Codex native search。
4. `web_read` 不再作为普通搜索任务的默认 model-visible 工具；它保留为 internal / advanced read strategy。

普通“搜索一下 X，至少给 N 条信息”类任务可以由 current-run `web_search` 结果和最终回答 source links 满足。只有 URL 摘要、页面正文细节、直接引用、低信息搜索结果、来源冲突、精确核验或 JS-heavy / login / captcha 等场景，才进入 read-required escalation。

### Native / fallback compatibility contract

第一阶段不新增 `web_search_custom` 或其它搜索别名。对 Agent Host 来说，普通搜索就是一个 Codex-compatible `web_search` capability：

- native route：Codex native `web_search` 可用且通过 contract probe 时，SciForge 消费 native 事件、refs、source links 和 diagnostics，不注册同名 fallback direct tool。
- fallback route：native 不可用、显式禁用或 contract 不满足时，SciForge 注册同名 fallback `web_search`，并把 provider result 投影到同一 SearchEvidence 模型。
- read route：`web_read` / Browser `read` / browser render fallback 只在 read-required escalation 中使用，不是普通搜索回答的必经步骤。

Compatibility 只能通过 capability detection、配置、provider registry 和 contract tests 保持；不能硬编码 Codex CLI flag、native event 字段、query、prompt、URL、provider endpoint、新闻主题或历史 run。

Search Runtime 可以在 fallback 内部组合确定性代码、LLM call、sub agent、Playwright / browser-use-like harness 或第三方 extractor，但这些实现细节必须被封装在稳定工具结果里。它们不能改写用户任务目标，不能决定 final answer，也不能绕过 Agent Host 的 source policy 和 completion truth。

## Browser Primitive Surface

Browser primitive surface 是 Browser Runtime 的内部、fallback 或 diagnostic 能力面；它不能被写成默认产品搜索路径，也不能替代 Agent Host 的验收链路。

Browser primitive surface 保留这些原子能力：

| primitive | 作用 | 边界 |
| --- | --- | --- |
| `browser.search` | 作为 diagnostic 或显式 fallback，用调用方给定 query 做候选发现，并产出 search result / discovered page resources。 | 不是默认产品搜索路径；不读取结果页正文、不总结答案、不改写 query。 |
| `browser.navigate` | 将调用方给定 URL 绑定到一个 BrowserHostSession，并执行一次导航。 | 不读取长正文、不判断来源是否满足任务、不代表用户级完成。 |
| `browser.observe` | 观察现有 session 当前状态。 | 不导航、不读取长正文、不完成任务级判断。 |
| `browser.read` | 读取当前页面或给定 URL 的网页内容并物化 refs。 | 不下载文件、不抽象成最终结论、不跨页面继续搜索。 |
| `browser.extract` | 对已读 refs 做纯结构解析。 | 不访问网络、不决定下一步、不做任务级语义验收。 |
| `browser.download` | 把调用方指定的远程资源下载为受控 artifact。 | 不保存到任意本地路径、不自动执行/打开文件、不总结文件内容。 |

所有 primitive 都必须使用 refs-first envelope，并在 result envelope 中返回 `resources` 与 `evidenceState`。未知字段默认拒绝或进入 diagnostics，不能静默改变语义。

旧的 `browser.search_read`、`browser.open_read`、`browser.open` 和 `executeBoundedOperation` 浏览器组合入口已经退出 public surface。新实现必须拒绝这些 intent，不能把它们作为兼容 alias、内部兜底或产品 truth。

## Session 与 Artifact 原则

- 每个 primitive 只绑定一个 BrowserHostSession / tab scope，除非输入明确要求新建 session。
- `search` 只证明候选发现；它可以作为 ordinary `web_search` fallback 的组成部分，但 Browser 自身不生成用户级完成。
- `navigate` 只证明导航尝试和当前 session 状态。
- `read` 只证明页面内容已被物化为 source page / page text refs。
- `extract` 只解析已有 refs，不访问网络。
- `download` 只能写入受控 session artifact scope，并返回 hash、大小、MIME 和 artifact refs。

下载后的内容理解属于后续 reader / parser / verifier，不属于 Browser。

## Evidence 原则

Browser evidence 必须 refs-first。可作为局部证据的对象包括：

- search result refs。
- session / navigation refs。
- frame / screenshot / DOM / AX refs。
- source page / page text / HTML refs。
- download artifact refs。
- console / network diagnostics refs。

普通搜索任务的用户级完成可以由 Agent Host 基于 current-run `web_search` results、source links、topic relevance 和 source count 判定；Browser 本身不做这个判定。

Read-required 任务必须有 current-run source page / page text refs。典型 read-required 场景包括：

- 用户给定 URL 并要求总结或核验。
- 用户要求网页正文细节、逐字引用或页面级内容判断。
- Search result metadata 低信息、不足以回答。
- 多来源冲突，需要打开来源核验。
- JS-heavy、登录态、验证码、付费墙或动态内容导致普通 search 证据不足。

raw HTML 大 payload、cookies、credentials、downloaded bytes、raw screenshot、data URL、base64、API key 和 secret 不得进入 primitive body 或 public diagnostics。

## 局部感知原则

Browser primitive 默认不做任务级语义判断。

如果某个 adapter 需要模型或其它感知组件做局部辅助，它只能输出 refs-first observation，例如页面片段摘要、候选结果质量解释、视觉 / 文本消歧或 before / after 差异说明。

这类局部感知组件不能在 Browser 内部：

- 改写 query。
- 决定下一页要打开什么。
- 判断何时停止。
- 改变 risk policy。
- 自动 repair。
- 产出 completion truth。
- 生成 final answer。

调用方可以读取 Browser refs 后自行调用模型或 verifier；这不属于 Browser primitive 内部职责。

## Agent Host 搜索与升级边界

搜索的任务级智能载体是 Agent Host。

Agent Host owns:

- 从当前用户请求抽取 intent、topic terms、时间窗口、来源数量和 source policy。
- 决定是否优先使用 Codex native `web_search`，以及 native 不可用时是否启用 SciForge fallback。
- 为 `web_search` 生成或验收 query，并拒绝明显被旧任务、workflow 文本或其它主题污染的 query。
- 检查 search result metadata 是否和当前 topic 相关。
- 判断 ordinary search 是否已可回答，或是否需要 read-required escalation。
- 决定 repair：换 query、补充读取、停止错误来源、要求用户澄清或进入 final answer。
- 在 final answer 前检查 current-run evidence、source links、topic relevance、source count 和 temporal gap。

Browser / search runtime does not own:

- 任务意图抽取。
- query 改写或 query 污染判断。
- 来源相关性裁决。
- 多来源充分性裁决。
- 静默启动 autonomous browse agent。
- repair 策略。
- final answer permission。

Browse/search fallback sub agent 或 local harness owns only execution recovery:

- 在 Host 给定的 query、URL、domain policy、profile policy、time budget、step budget 内处理浏览器执行细节。
- 可以使用真实浏览器、workspace profile、Playwright、browser-use-like 操作经验、局部页面感知或规则重试。
- 必须返回结构化 search/read evidence、actions trace、timings、failure reason 和 refs。
- 不能改写用户任务目标，不能决定最终来源充分性，不能直接生成 final answer。

性能优化必须排在防错之后。允许的提速方向包括并发处理候选、为单来源读取设置 timeout、缓存同 query 的候选 refs，以及把 planning / search / parse / optional read / repair / final synthesis 的阶段耗时投影到 UI。任何提速都不能把 query/source/final decision 下放给 Browser / search 模块。

## Web Search 基础能力建议

| 能力 | 第一阶段推荐 | 边界 |
| --- | --- | --- |
| `web_search` | Codex native first；native 不可用时使用 SciForge fallback。Fallback 首选 SearXNG JSON，可按需内部组合 Readability / trafilatura / Crawl4AI / Playwright。 | Agent Host 普通搜索唯一入口；Search Runtime 不生成 final answer。 |
| internal `web_read` | Readability.js + jsdom static extraction；trafilatura / Crawl4AI / Playwright render 作为 adapter / fallback。 | 不作为普通搜索默认 model-visible 工具；只读取一个来源，不继续搜索。 |
| `web_health` | runtime resource 或管理端 endpoint。 | 不作为 Agent Host 普通业务工具。 |
| `web_benchmark` | CLI / 开发工具。 | 不作为 Agent Host 普通业务工具。 |

推荐执行策略：

1. Ordinary search 优先走 Codex native `web_search`。
2. Native 不可用或不足时，SciForge fallback 同名 `web_search` 接管。
3. Fallback 内部优先用可控 JSON provider，减少直接打开搜索引擎页面造成的慢和不稳定。
4. 需要页面级读取时，内部 read 默认走静态读取和 Markdown 抽取，失败或内容缺失时再进入 browser render fallback。
5. 浏览器 fallback 如果需要多步交互、用户 profile、登录态或复杂页面恢复，由 Agent Host 显式启动 BrowserHostSession / browse-search fallback sub agent 或 local harness，并把 trace 回写为 evidence。

## 风险与确认

Browser 可以识别浏览器动作风险并返回 `needs-confirmation`，但不能自己决定高风险动作是否应该执行。

必须返回 `needs-confirmation` 的典型情况：

- 跨站点表单提交。
- credential-like 输入。
- 上传、删除、支付、账号或安全设置变更。
- 下载超过调用方声明的预算、domain 约束或类型约束。
- 下载 MIME 未知，或响应 / 文件名表现为可执行、安装包、脚本等高风险文件。
- 调用方没有提供有效 approval ref。

确认由调用方收集。Browser 只验证 approval ref 是否匹配当前 action risk envelope。

## 迁移口径

历史路径包括 `executeBoundedOperation` 浏览器组合入口、`browser.search_read`、`browser.open_read`、`browser.open`、Browser pane dogfood、iframe / proxy render、snapshot replay 和历史 browser pane runbook。

迁移目标：

- 普通产品搜索统一迁移到 Codex-compatible `web_search`。
- `web_read` 迁移为 internal / advanced read strategy，不作为普通搜索任务默认第二工具。
- Browser primitive 的 `search` / `navigate` / `read` / `extract` 只保留为内部、fallback 或 diagnostic 路径。
- 下载进入 `download`，不能混在 `read` 或页面解析里。
- Browser pane 只展示和控制 session，不承载任务智能。
- 旧组合路径必须删除或显式拒绝，不能转译为 primitive chain，也不能作为产品 truth。
- 查询策略、来源取舍、停止条件、验证和最终总结都移到 Agent Host。

迁移期如果遇到旧调用，唯一允许行为是 fail closed，并返回 unsupported intent / repair hint；不允许静默兼容。

## 用户级验收

用户级验收只能由 Agent Host 基于 current-run evidence 产出，并通过 Codex App Server assistant final message / events 进入 `FinalAnswerEnvelope`。

可作为 Browser / search 局部证据的对象：

- current-run `web_search` result refs 和 source links。
- read-required 场景下的 source page refs 和 page text refs。
- download artifact refs。
- diagnostics 和 blocked reason refs。
- 必要时由调用方关联的 verifier refs。

禁止把这些对象当作产品 truth：

- iframe。
- proxy render。
- screenshot / snapshot replay。
- frame stream。
- 系统外部浏览器。
- 历史 run。
- fixture refs。
- Browser primitive 的 `status=completed`，除非调用方另有 current-run completion truth 和必要 source / verifier refs。
