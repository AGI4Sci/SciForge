# Browser Runtime 设计

最后更新：2026-06-09

## 文档目的与约束

这份文档只记录 Browser Runtime 本身的最新设计原则和沟通口径，目标是让人类和 agent 读完后能快速理解 Browser 是什么、能做什么、不能做什么。

原则约束：

- 保持简洁，避免把文档写成 TypeScript contract、JSON schema 或测试用例。
- 文档只描述 Browser 自身的稳定边界、primitive、证据原则和迁移原则。
- 外部系统只在解释边界时短提，不展开外部编排、界面呈现、模型路由或产品工作流设计。
- 精确字段、schema、MCP tool definition、validator 和测试真相源放在 `packages/actions/browser-runtime`。
- 历史路径只保留必要迁移口径，不作为新设计的主叙事。
- 如果实现细节变复杂，优先更新 package contract 和测试；本文件只补能帮助沟通和理解需求的原则。

## 定位

Browser 是可调用的网页信息输入与局部浏览器操作 runtime，不是 Browser agent，也不是搜索总结工具。

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

## Primitive Surface

Browser 新 public surface 只暴露这些 primitive：

| primitive          | 作用                                                               | 边界                             |
| ------------------ | ---------------------------------------------------------------- | ------------------------------ |
| `browser.search`   | 用调用方给定 query 做候选发现，并产出 `search_result_set` / `web_page:discovered` resources。 | 不读取结果页正文、不总结答案、不改写 query、不产出读取完成证据。 |
| `browser.navigate` | 将调用方给定 URL 绑定到一个 BrowserHostSession，并执行一次导航。                     | 不读取长正文、不判断来源是否满足任务、不代表用户级完成。   |
| `browser.observe`  | 观察现有 session 当前状态。                                               | 不导航、不读取长正文、不完成任务级判断。           |
| `browser.read`     | 读取当前页面或给定 URL 的网页内容并物化 refs。                                     | 不下载文件、不抽象成最终结论、不跨页面继续搜索。       |
| `browser.extract`  | 对已读 refs 做纯结构解析。                                                 | 不访问网络、不决定下一步、不做任务级语义验收。        |
| `browser.download` | 把调用方指定的远程资源下载为受控 artifact。                                       | 不保存到任意本地路径、不自动执行/打开文件、不总结文件内容。 |

所有 primitive 都必须使用 refs-first envelope，并在 result envelope 中返回 `resources` 与 `evidenceState`。`resources` 描述本次 primitive 发现、观察、读取、解析或下载到的对象；`evidenceState` 描述已经完成什么、仍未知什么、以及证据边界。未知字段默认拒绝或进入 diagnostics，不能静默改变语义。

面向模型或 MCP provider 的直接工具名使用安全 alias：`browser_search`、`browser_navigate`、`browser_observe`、`browser_read`、`browser_extract`、`browser_download`。这些 alias 只是调用入口名，内部必须注入对应 input schemaVersion，并路由回同一个 Browser module dispatcher intent（例如 `browser_search` -> `moduleId=browser, intent=browser.search`）。它们不能形成第二条搜索、读取或总结链路。

旧的 `browser.search_read`、`browser.open_read`、`browser.open` 和 `executeBoundedOperation` 浏览器组合入口已经退出 public surface。新实现必须拒绝这些 intent，不能把它们作为兼容 alias、内部兜底或产品 truth。

## Session 与 Artifact 原则

- 每个 primitive 只绑定一个 BrowserHostSession / tab scope，除非输入明确要求新建 session。
- `search` 只产出候选结果、search refs、候选 `resources` 和候选态 `evidenceState`；搜索结果页不是用户级完成证据。调用方要回答网页内容、新闻、论文、来源或引用问题时，必须继续调用 `read` 或说明候选不可用。
- `navigate` 只证明导航尝试和当前 session 状态。
- `read` 只证明页面内容已被物化为 source page / page text refs。
- `extract` 只解析已有 refs，不访问网络。
- `download` 只能写入受控 session artifact scope，并返回 hash、大小、MIME 和 artifact refs；调用方可声明显式 URL，或提供 `sessionId + linkSelector` 让 Host adapter 从当前 frame artifact 机械解析 `<a href>`；调用方可声明 maxBytes、timeout、allowed/blocked domain，未知 MIME 或可执行 / 安装型下载必须先返回 `needs-confirmation`。
- 下载后的内容理解属于后续 reader / parser / verifier，不属于 Browser。

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

## Evidence 原则

Browser evidence 必须 refs-first。可作为局部证据的对象包括：

- search result refs。
- session / navigation refs。
- frame / screenshot / DOM / AX refs。
- source page / page text / HTML refs。
- download artifact refs。
- console / network diagnostics refs。

`search` 返回的 URL 只能作为候选和下一步输入，不能作为已读取来源。`search` 成功时应通过 `resources` 标记 `search_result_set` 与 `web_page:discovered`，并通过 `evidenceState` 明确“候选已发现、页面正文仍未知、候选不是 source evidence”。调用方要继续读取候选时，应用 `browser.read` 的当前输入 schema 构造读取请求；Browser 不再维护搜索专用读取输入缓存或搜索专用预算 blocker。

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

调用方可以读取 Browser refs 后自行调用模型或 verifier；这不属于 Browser primitive 内部职责。Agent Host 可维护 current-run Evidence Ledger，把 Browser primitive 的 `resources` / `refs` 记录为状态推进，并在生成 Codex App Server assistant final message / `FinalAnswerEnvelope` 前检查 source page refs、page text refs、final-answer refs，以及由当前 turn 文本派生的 AcceptanceSpec gap（例如低信息页面、topic mismatch、recent-window temporal gap）。这些检查属于 Agent Host verifier / completion truth 边界，不进入 Browser core，也不替代更完整的多来源事实充分性 verifier。

## Agent Host 搜索与升级边界

搜索的任务级智能载体是 Agent Host。Browser / search 基础工具默认保持原子工具属性，只执行已允许的 primitive，并返回 refs-first evidence、diagnostics、耗时和 blocked reason。

如果搜索或读取遇到复杂浏览器场景，例如 JS-heavy 页面、弹窗、登录态、验证码、搜索页阻断、动态内容缺失或普通读取失败，Agent Host 可以显式升级到专用 browse/search fallback sub agent 或 local harness。这个升级必须是 Host-owned 调度，而不是基础工具内部静默启动第二个 agent。

Agent Host owns:

- 从当前用户请求抽取 intent、topic terms、时间窗口、来源数量和 source policy。
- 为 `browser.search` 生成或验收 query，并拒绝明显被旧任务、workflow 文本或其它主题污染的 query。
- 检查 search result metadata 是否和当前 topic 相关；明显不相关的候选不能触发 auto-read。
- 决定是否从纯工具路径升级到 browse/search fallback sub agent，并传入明确 query / URL、预算、允许范围和停止条件。
- 决定 repair：换 query、补充读取、停止错误来源、要求用户澄清或进入 final answer。
- 在 final answer 前检查 source page refs、page text refs、当前轮 final-answer refs、topic relevance、source count 和 temporal gap。

Browser / search does not own:

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

当前防错链路采用三道门：

1. Query boundary gate：Agent Host 在执行 `browser.search` 前检查 planned query 是否属于当前 intent。若用户主题是“伊朗局势”，query 却是旧的 Computer Use 验收任务文本，Agent Host 返回 repairable guard result，不调用 Browser dispatcher。
2. Search discovery relevance gate：Agent Host 记录 `browser.search` 的候选 refs 后，先检查候选标题、摘要和 URL 的 topic relevance。若候选明显不相关，例如全是“内蒙古农业大学研究生院”，不得 auto-read。
3. Final evidence gate：Agent Host 只允许 current-run `browser.read` 物化出的 source page / page text refs 进入最终答复验收；search result、screenshot、DOM 和历史 refs 不能单独满足用户级完成。

性能优化必须排在防错之后。允许的提速方向包括并发读取多个已通过 relevance gate 的候选、为单来源读取设置 timeout、缓存同 query 的候选 refs，以及把 Agent Host planning / search / parse / read / repair / final synthesis 的阶段耗时投影到 UI。任何提速都不能把 query/source/final decision 下放给 Browser / search 模块。

## Web Search 基础能力建议

SciForge 的搜索能力是基础集成能力，不作为独立产品卖点。第一版建议只暴露两个原子接口；`web_extract`、`web_batch_read`、复杂 crawler 和真实用户主 profile 都暂缓。

| 接口 | 作用 | 第一版推荐实现 | 边界 |
| --- | --- | --- | --- |
| `web_search(query)` | 发现候选来源。返回 title、URL、snippet、rank、provider、search refs、timing 和错误原因。 | 首选自建 SearXNG / OpenSERP JSON provider；浏览器 SERP adapter 只作为 fallback 或验证路径。 | 不读取网页正文、不总结、不改写 query、不决定候选是否足够。 |
| `web_read(url/ref)` | 读取一个来源。返回 finalUrl、title、metadata、Markdown / text、page refs、provider、timing 和错误原因。 | 静态 fetch + trafilatura / Readability 快路径；Crawl4AI / BrowserHostSession browser render 作为 fallback。 | 不继续搜索、不跨页面扩展、不做最终事实综合。 |

`web_extract` 第一版不保留为默认工具。若未来出现批量结构化采集需求，可再增加 `web_extract(page_ref, schema)`，并限制为 selector、metadata、JSON-LD、表格或其它确定性抽取；LLM extraction 只能作为显式高级模式。

推荐执行策略：

1. `web_search` 默认走本地开源可控 search provider，减少直接打开搜索引擎页面造成的慢和不稳定。
2. `web_read` 默认走静态读取和 Markdown 抽取，失败或内容明显缺失时再进入 browser render fallback。
3. 浏览器 fallback 如果需要多步交互、用户 profile、登录态或复杂页面恢复，由 Agent Host 显式启动 browse/search fallback sub agent，并把 trace 回写为 evidence。
4. `web_health` 作为 runtime resource 或管理端 endpoint；`web_benchmark` 作为 CLI / 开发工具，不作为 Agent Host 普通业务工具。

## 迁移口径

历史路径包括 `executeBoundedOperation` 浏览器组合入口、`browser.search_read`、`browser.open_read`、`browser.open`、Browser pane dogfood、iframe / proxy render、snapshot replay 和历史 browser pane runbook。

迁移目标：

- 搜索和读取拆为 `search` / `navigate` / `read` / `extract`。
- 下载进入 `download`，不能混在 `read` 或页面解析里。
- Browser pane 只展示和控制 session，不承载任务智能。
- 旧组合路径必须删除或显式拒绝，不能转译为 primitive chain，也不能作为产品 truth。
- 查询策略、来源取舍、停止条件、验证和最终总结都移到调用方。

迁移期如果遇到旧调用，唯一允许行为是 fail closed，并返回 unsupported intent / repair hint；不允许静默兼容。

## 用户级验收

Browser 只能提供网页局部证据，不能单独提供用户级验收。

可作为 Browser 局部证据的对象：

- current-run search / navigation / read / extract / download refs。
- source page refs 和 page text refs。
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
- 只读搜索结果页。
- Browser primitive 的 `status=completed`，除非调用方另有 current-run completion truth 和必要 source / verifier refs。

## 契约真相源

长期 contract、MCP-compatible tool schema、validator 和测试应放在：

- `packages/actions/browser-runtime/index.ts`
- `packages/actions/browser-runtime/mcp.ts`
- `packages/actions/browser-runtime/action-provider.manifest.json`
- `packages/actions/browser-runtime/*.test.ts`

本文件只保留设计原则和迁移口径。

## 相关文档

- [ComputerUseRuntimeArchitecture.md](ComputerUseRuntimeArchitecture.md)：Computer Use primitive runtime 的同构设计。
- [Architecture.md](Architecture.md)：总架构和 Browser 上下游边界。
