# SciForge Browser Search 当前任务

最后更新：2026-06-08

## 用户真正要什么

用户希望 Codex 能在普通聊天中可靠完成联网搜索、网页读取、来源抽取、下载和中文/英文总结等任务，并给出可验证的当前 run 证据。

Browser 不是独立 agent，也不是搜索总结器。它只提供可迁移、可验收、可清理的网页信息 primitive runtime；Agent Host 负责理解用户任务、选择搜索策略、决定读取哪些来源、运行 verifier、判断 completion truth 和生成 final answer。

## 总体决策

- [x] Public surface 只保留 primitive：`search`、`navigate`、`observe`、`read`、`extract`、`download`。
- [x] 面向模型 / MCP provider 的直接工具名为 `browser_search`、`browser_navigate`、`browser_observe`、`browser_read`、`browser_extract`、`browser_download`。
- [x] 直接工具只是 provider-safe alias，内部必须路由回同一个 Browser module dispatcher，不形成第二条搜索、读取、总结或 completion 链路。
- [x] Browser 输出长期收敛为 `resources + evidenceState + refs-first envelope`；不继续扩展 `readInput`、`candidateReadInputs` 或搜索专用修复字段。
- [x] `browser.read` 可以消费 `url`、`sessionId` 或 `resourceRef`；resource resolver 只做机械定位转换，不做来源选择、任务策略或语义判断。
- [x] 旧 `browser.search_read`、`browser.open_read`、`browser.open`、`executeBoundedOperation` 浏览器组合入口不作为新 public surface 保留。
- [x] Search-only loop、搜索结果总结、最终回答、verifier 选择和用户级完成判断只能由 Codex / Agent Host 管理，不能放在 Browser、UI、runtime fallback 或 Model Router 旁路里。

## Invariant Audit

每次阶段打勾前都要重新确认这些不可变原则。

- [x] 旧逻辑代码和最终目标冲突时，删除旧逻辑，直接实现新版本，不做兼容，保持代码干净。
- [x] 所有修改必须通用，不能为当前页面、截图、URL、文件名、agent id 或历史 run 写硬编码补丁。
- [x] 大对象必须 refs-first；截图、图片、provider payload、trace、日志和 artifact 不得作为 raw/base64 长期进入聊天正文或主上下文。
- [x] 不使用 `git reset --hard` 或 `git checkout --` 擦除用户改动。
- [x] 所有 Runtime Codex / API 服务调用先走 Model Router；`config.local.json` 只作为 Router 成员模型 env 配置来源，不作为 Runtime Codex 直连 provider 配置。
- [x] 在能提高时间效率的前提下，尽可能使用 sub agent 并行推进；并行任务必须拆清边界，避免不同 worker 修改同一文件造成冲突。
- [x] SciForge对话、工作链路需要统一，不要额外生出旁路
- [x] **符合docs/Architecture.md设计原则, 如果你觉得继续推进会导致混乱、衍生旁路、设计方案不合理、有相互冲突的点、有更简洁通用的实现方案，需要停下来和用户讨论，澄清需求**

## 简化架构

长期只保留五层，每层职责要窄。

- [x] Primitive Contract：schema、validator、result envelope、resource contract、evidenceState、refs-first 规则。
- [x] Browser Host Runtime：BrowserHostSession / tab scope、导航、搜索页面、内容读取、下载 artifact 生命周期。
- [x] Resource Resolver：把 `resourceRef` 机械解析成 primitive 可消费 locator，不做策略、不做语义判断。
- [x] Host Adapter：把 provider-safe dynamic tools 路由到同一个 dispatcher，只做权限 / side-effect / schema 边界。
- [x] Acceptance Harness：只验证协议形状、manifest schema、refs materialization、negative guards 和真实运行证据；不承担 query planning、source selection、synthesis、completion truth 或 final answer。

## 算法简化原则

- [x] 用 primitive table 声明每个 primitive 的 required fields、side effect、consumes、produces 和 evidence requirement。
- [x] 用 ResourceRef 表达搜索候选、浏览器 session、source page、page text、extracted link 和 downloaded artifact。
- [x] 用 `evidenceState` 表达“已完成什么、还不知道什么、证据边界是什么”。
- [x] Browser 不给任务级下一步建议；Agent Host 根据 Tool Schema、ResourceRef、Evidence Ledger 和 AcceptanceSpec 自主选择下一步。
- [x] Resource resolver 只做机械转换，例如 `web_page:discovered -> browser.read({ resourceRef })` 解析到 URL。
- [x] 连续调用无进展的判断属于 Agent Host / verifier / Evidence Ledger，不属于 Browser search 专用 guard。
- [x] Product path 只能基于 current-run source page refs、page text refs、download artifact refs 和 verifier refs；搜索链接或 snippet 不能作为完成证据。

## 推荐推进策略

- [x] 每项能力按 `contracted -> unit-proven -> live-diagnostic -> product-ready` 推进，不能跳级宣传。
- [x] 新增或修改 primitive 必须先补 validator、MCP schema、service delegation test、resource/evidenceState test 和 host adapter test。
- [x] live test 只证明真实网页 / 真实浏览器行为；package probe、fixture、旧 run 和 UI screenshot 不能证明用户级完成。
- [x] 复杂需求优先拆到 Agent Host、Verifier、Evidence Ledger 或 Acceptance Harness；Browser core 只保留 primitive 管线。
- [x] 如果实现里出现搜索总结器、query planner、source ranker、search-only repair、final answer 或 verifier port，直接删除或迁移出 Browser。
- [x] 每轮实现结束都更新本文件的成熟度和验收缺口，避免“单测通过”和“桌面 App 可完成用户搜索任务”混在一起。

## 近期聚焦：P0 / P1 / P3 / P4 / P5 / P6 / P7

这几个阶段按顺序推进，避免一边改 Browser contract，一边继续保留旧 search-only 旁路。

- [x] P0 先清理冲突路径：删除 `readInput`、`candidateReadInputs`、search-only guard 和旧组合入口兼容。
- [x] P1 固化最终 Browser resource / evidenceState contract。
- [x] P4 确保 Agent Host 看到的是直接 browser primitive tools，且全部走同一个 dispatcher。
- [x] P7 用桌面 SciForge App 真实搜索任务验收：必须读取具体网页正文，由 Agent Host / App Server 生成 verified assistant final-message projection，SciForge UI 只消费该 projection；legacy `gui.present` dynamic tool 不能作为产品验收路径。

## P0：唯一链路与旧旁路清理

目标：Browser 只能作为 Agent Host 可调用的 primitive 工具存在，不能留下第二条搜索、读取、总结或 completion 链路。

Build Tasks：

- [x] 删除 `readInput`、`candidateReadInputs` 和搜索专用 repair hint 逻辑。
- [x] 删除 Host adapter 里的 `browser_search_only_budget_exhausted`、search-only progress guard 和 candidateReadInputs 缓存。
- [x] 删除或显式拒绝 `browser.search_read`、`browser.open_read`、`browser.open`、`executeBoundedOperation` 浏览器组合入口。
- [x] 删除旧 `browser_search` raw service / runtime fallback / slash command product path，保留时只能作为 fail-closed diagnostic。
- [x] 确认 `SciForge UI -> Model Router -> 用户可见 final answer` 和 `Runtime Codex -> Model Router -> message/done 直答` 不存在于 Browser 搜索路径。
- [x] 更新文档、README、manifest、tool descriptions 和 tests，不能再宣传旧路径。

Acceptance Gates：

- [x] 代码搜索找不到 `readInput`、`candidateReadInputs`、`browser_search_only_budget_exhausted` 作为产品逻辑。
- [x] 旧组合 intent 调用必须 fail closed，不能静默转译为 primitive chain。
- [x] Host adapter 对 browser direct tools 只做 schema 注入、权限边界和 dispatcher 路由，不做搜索策略或完成判断。
- [x] Architecture 文档、Browser Runtime 文档和 package README 口径一致。

## P1：ResourceRef + EvidenceState Contract

目标：所有 Browser primitive 都返回统一的资源状态和证据边界，让 Agent Host 基于 Evidence Ledger 自主规划。

Build Tasks：

- [x] 定义 `BrowserResource`：`ref`、`kind`、`status`、`originTool`、`locator`、`refs`、`confidence`、`metadata`。
- [x] 定义 `BrowserEvidenceState`：`completed`、`unknown`、`boundary`。
- [x] `browser.search` 产出 `search_result_set` 和 `web_page:discovered` resources。
- [x] `browser.navigate` 产出 `browser_session:accessed/observed` 和当前 `web_page` resource。
- [x] `browser.observe` 产出 session/state/visual/DOM refs，不伪装成页面正文读取。
- [x] `browser.read` 产出 `web_page:read`、`source_page:read`、`page_text:read` resources。
- [x] `browser.extract` 只解析已有 refs，并把链接产出为 `web_page:discovered` resources。
- [x] `browser.download` 产出 `download_artifact:downloaded` resource。
- [x] envelope 必须 refs-first，不能把 raw HTML、raw screenshot、download bytes、base64 或 secret 放入主输出。

Acceptance Gates：

- [x] Package tests 覆盖每个 primitive 的 resources 和 evidenceState。
- [x] `browser.search` 的 successful result 不再包含 `readInput` 或 `candidateReadInputs`。
- [x] 搜索链接和 snippet 的 evidenceState 明确标记为“候选，不是已读取来源”。
- [x] `browser.read({ resourceRef })` 能从 `web_page:discovered` 机械解析到 URL 并读取正文。
- [x] `browser.read({ resourceRef })` 对未知 ref、非 web_page ref 或无 URL locator 必须 fail closed。

## P2：Primitive Schema 与 Validator 完备性

目标：每个 Browser 原子操作都有清晰输入边界、输出边界和失败语义。

Build Tasks：

- [x] `search` validator 覆盖 query、engine、locale、region、limit、budget、constraints。
- [x] `navigate` validator 只接受 HTTP(S) URL、sessionId、timeout、capture 和 constraints。
- [x] `observe` validator 要求 sessionId，capture 只能是受控枚举。
- [x] `read` validator 支持 `resourceRef | sessionId | url`，URL 直读必须显式 ephemeral，且三种 locator 必须三选一。
- [x] `extract` validator 只接受已物化 ref 和明确 extract targets。
- [x] `download` validator 只允许受控 URL 或 session/linkSelector，保存范围固定为 `session-artifacts`，且两种 locator 必须二选一。
- [x] 未知字段必须拒绝或 diagnostics，不能静默改变语义。

Acceptance Gates：

- [x] 每个 primitive 都有 validator、MCP schema、service delegation 和 error path test。
- [x] 缺字段、错 schemaVersion、非 HTTP URL、越界 limit/maxBytes、未知字段全部 fail closed。
- [x] MCP facade 注入 schemaVersion 和默认机械字段时，不引入第二条逻辑链路。

## P3：BrowserHostSession Runtime

目标：真实内置浏览器能稳定执行搜索、导航、观察、读取、抽取和下载，并把 evidence 落盘为 refs。

Build Tasks：

- [x] `browser.search` 使用 BrowserHostSessionManager 做候选发现，只打开搜索页或搜索服务，不自动读取结果页正文。
- [x] `browser.navigate` 建立或复用 BrowserHostSession / tab scope，返回 session/navigation refs。
- [x] `browser.observe` 能捕获当前 session 状态、screenshotRef、DOM/AX refs、console/network diagnostics refs。
- [x] `browser.read` 能读取当前 session URL、ephemeral URL 或 `resourceRef` 对应网页正文。
- [x] 网页正文必须落盘为 source page refs / page text refs，并记录 finalUrl、title、contentType、textSha。
- [x] `browser.extract` 对已读 refs 做本地解析，不访问网络。
- [x] `browser.download` 只能写入 session artifact scope，返回 hash、大小、MIME 和 artifact refs。

Acceptance Gates：

- [x] 真实网页 smoke test 能 `search -> read(resourceRef/url) -> extract -> download`。（2026-06-08 `smoke:browser-runtime-live-download-chain:opt-in` 通过：native adapter `http://127.0.0.1:5177`、DuckDuckGo search、受控公共 HTML source page read、local extract、CSV/PDF download 均走 Browser primitive dispatcher；manifest 只作为 live-diagnostic，不是 release/product proof。）
- [x] arXiv、新闻网页、普通 HTML 页面至少各有一个 live-diagnostic 验收样例。（2026-06-08 三类 clean desktop ordinary-chat product proof 均包含 current-run BrowserHostSession source/page-text refs。）
- [x] 搜索结果不可用、登录墙 / forbidden HTTP 状态、网络失败、下载超预算时能返回 blocked/partial diagnostics 和 refs。（本轮补 local deterministic diagnostic：搜索候选存在但 read blocked、download content-length 超预算时返回 refs-first blocked diagnostics，且 search snippet / download artifact 不会成为 completion evidence；2026-06-08 P3/P6 opt-in live 已补 download 超预算、domain-not-allowed、公共 PDF source-read blocked、HTTP 401 auth-wall surrogate、HTTP 403 forbidden surrogate 和 `.invalid` network source-read blocked cases。当前 Browser Runtime 仍没有 robots/login 语义 detector，因此不把 robots/login semantic classification 冒充为已完成；robots/login 的用户级 final-message 收束仍列在未完成项。）
- [x] BrowserHostSession artifacts 可审计，且没有 raw secret / cookie / base64 泄露到聊天正文。（Browser evidence tests、ordinary-chat writer validation 和 P3/P6 live manifest policyScan 均要求 refs-first source/page-text/download artifacts，不内联 bytes/base64/本地路径；P7 final-answer projection 只消费 assistant final message + evidence refs。）

## P4：Agent Host / MCP 集成

目标：Browser package 能被 Agent Host 和 MCP-style caller 稳定调用，同时保持唯一智能链路。

Build Tasks：

- [x] `browser_search`、`browser_navigate`、`browser_observe`、`browser_read`、`browser_extract`、`browser_download` 作为 provider-safe dynamic tools 暴露。
- [x] 直接工具内部路由回 `moduleId=browser, intent=browser.*`，使用同一个 dispatcher。
- [x] `module.invoke(moduleId="browser")` 只作为通用模块调用入口，不是 Browser 主要认知入口，也不隐藏 primitive 能力。
- [x] Agent Host developer instructions 明确：search 只发现候选，read 才产生 source/page text evidence；final answer / completion truth 属于 Agent Host / App Server，SciForge UI 只消费 assistant final-message / App Server event projection。
- [x] Host adapter 不做 query rewrite、来源取舍、search-only loop repair、用户级 verifier 或 final answer。

Acceptance Gates：

- [x] Runtime dynamic tool specs 包含六个 direct Browser tools。
- [x] Direct tool 和 `module.invoke` 调用同一个 dispatcher，trace / refs 一致。
- [x] 重复 search 不被 Host adapter 特例拦截；是否 replan 由 Agent Host / verifier 基于 Evidence Ledger 决策。
- [x] 普通聊天中模型能够直接调用 `browser_search` 和 `browser_read`，而不需要从自然语言描述猜 `module.invoke` 参数。

## P5：Evidence Ledger 与 Verifier 对接

目标：Browser 产出的局部证据能被 Agent Host 的 Evidence Ledger 和 verifier 使用，但 Browser 不拥有 verifier。

Build Tasks：

- [x] 每个 Browser tool result 都能被 Evidence Ledger 记录为 resource 状态推进。（direct Browser tools 和 `module.invoke(moduleId="browser")` 都已覆盖。）
- [x] Verifier 可检查当前 run 是否有 source page refs / page text refs，而不是只看搜索链接。（结构性 source/page-text/current-run gate 已覆盖，并接入 Agent Host AcceptanceSpec 的低信息、相关性和时间约束检查。）
- [x] 对“今天 / 最新 / 最近一周 / 来源链接 / 系统报告”等需求，由 Agent Host 生成 AcceptanceSpec 和 verifier requirement。（当前实现为 prompt-derived source/page-text requirement、低信息拒绝、topic terms 和 temporal window；更完整的外部 verifier / ref 文件正文读取可继续扩展。）
- [x] Browser 只暴露 resources/evidenceState，不基于关键词判断用户意图。（关键词/时间窗口只在 Agent Host evidence verifier 中使用，不进入 Browser primitive core。）
- [x] 如果用户禁止联网或要求只用本地上下文，Agent Host 不调用 Browser，Browser 不承担该决策。（Agent Host local tool Act policy 会在 app-server direct Browser tool / `module.invoke` 前 blocked。）

Acceptance Gates：

- [x] 搜索总结类任务没有 page text refs 时 verifier 必须失败或 uncertain。（Agent Host final answer / App Server projection 会被 Browser evidence gate 拦截为 blocked/repairable。）
- [x] 有 search refs 但没有 read refs 时，final answer 不能宣称已读取来源。（direct tool 和 generic `module.invoke` search-only 都会 blocked。）
- [x] 有 read refs 但来源不足、时间不满足或内容不相关时，verifier 能把 gap 返回给 Agent Host。（覆盖低信息/登录页、topic mismatch、recent-window temporal gap；动态多来源数量要求仍属于后续 verifier 增强。）
- [x] verifier 结论能被 Agent Host 看到，并驱动继续调用工具、请求澄清或 blocked final projection。（当前已驱动 blocked completionTruth / final-message projection；更主动的 autonomous replan 由 Agent Host 模型策略继续承担。）

## P6：下载与文件型来源

目标：下载能力覆盖 PDF、CSV、图片、压缩包等远程资源，但不把下载和语义理解混进 Browser。

Build Tasks：

- [x] `browser.download` 支持 Host 指定 URL 或 session/linkSelector。（URL 路径已实现；session/linkSelector 会从当前 BrowserHostSession frame artifact 机械解析匹配 `<a href>`，不做来源选择或语义判断。）
- [x] 下载必须受 maxBytes、timeout、allowed/blocked domain 和 saveScope 约束。
- [x] 下载结果返回 artifactRef、filename、mimeType、byteLength、sha256、finalUrl。
- [x] 下载后的 PDF/CSV/图片/压缩包解析交给后续 reader / parser / verifier，不属于 Browser。
- [x] 对可执行文件、超预算、未知 MIME 或高风险下载返回 `needs-confirmation` / `blocked`。（超预算 blocked、未知 MIME 和可执行/安装型 MIME/扩展名 `needs-confirmation` 已覆盖；live policy case 待 P7/P3 live 环境补。）

Acceptance Gates：

- [x] 下载普通 CSV/PDF 的 live-diagnostic 验收通过，artifact hash 和大小可复核。（2026-06-08 opt-in live manifest `docs/test-artifacts/browser-runtime-live-download-chain/manifest.json`：CSV `airtravel.csv` 321 bytes、sha256 `f6a5fc622a83ef040fe708b7305fb6f34b8725a62e19da03a9bc8ff8592d8054`、MIME `text/csv`；PDF `dummy.pdf` 13264 bytes、sha256 `3df79d34abbca99308e79cb94461c1893582604d68329a41fd4bec1885e6adb4`、MIME `application/pdf; qs=0.001`；manifest scan 无 inline bytes/base64/本地路径。）
- [x] 超预算下载不会写入不完整 artifact 或会明确标记 partial/blocked。
- [x] Browser final result 不内联 downloaded bytes、base64 或任意本地路径。
- [x] 下载 artifact 不能被 Browser primitive status 直接当作用户任务完成。

## P7：用户级搜索验收链路

目标：证明 Browser 能服务普通聊天搜索请求，但不自己宣布用户任务完成。

Build Tasks：

- [x] 从普通聊天入口触发“搜索一下伊朗局势”这类开放网页搜索任务。（2026-06-08 已完成三类 clean desktop ordinary-chat product proof：普通网页 OpenAI docs、arXiv/论文、新闻/最新动态。）
- [x] Agent Host 生成搜索 query，调用 `browser_search` 得到候选 resources。（direct tool contract、app-server writer unit proof、producer protocol-only diagnostic 和三类桌面 UI run 均覆盖。）
- [x] Agent Host 基于候选 resources 调用 `browser_read` 读取具体网页正文。（三类桌面 UI run 均有 completed `browser_read`、current-run source/page-text refs、source JSON/page text artifacts、textSha1 和 `openedAt`。）
- [x] Agent Host 基于 source page refs / page text refs 综合回答，并列出实际读取过的来源链接。（三类桌面 UI run 的 final answer 均含实际读取 source URL；refs 来自 BrowserHostSession source/page-text artifacts。）
- [x] Agent Host 运行适当 verifier，确认有 current-run source evidence。（app-server finalizer 只有 `agent-host-browser-acceptance` satisfied 后才投影 final answer；单测覆盖 relevance/latest/temporal gap、blocked read 和低信息页面。）
- [x] 最终回答必须来自 Agent Host / App Server 的 verified assistant final-message projection，并携带 satisfied completionTruth evidenceRefs；legacy `gui.present` dynamic tool 不能单独构成产品 final answer。（writer 要求 completed projection + satisfied `agent-host-browser-acceptance` completionTruth，desktop ordinary-chat 使用 assistant final-message projection。）

Acceptance Gates：

- [x] 桌面 SciForge App 能完成至少三类用户搜索任务：新闻最新情况、arXiv / 学术论文、普通网页资料检索。
- [x] final answer 中的来源必须来自实际 `browser_read` 的 source/page text refs，不能来自 search snippet。
- [x] 对“今天 / 最新 / 最近一周”这类时间约束，Agent Host 必须基于来源内容和 verifier 判断，不靠 Browser 关键词硬编码。（单测覆盖 relative-window/latest temporal gap 和中文日期识别；新闻 product proof 的 source text 包含 2026-06-04/2026-06-06 更新证据。）
- [x] 如果搜索服务返回候选但无法读取正文，final answer 必须 partial / blocked，并说明未读到哪些来源。（Agent Host Browser evidence 单测覆盖 candidate read blocked 后不能 satisfied，local Browser runtime diagnostic 覆盖 read blocked refs-first envelope。）
- [x] Harness / fixture contract 必须要求 `browser_search`、至少一个 `browser_read` 和一次 final-answer projection。（producer 已强制为 protocol-only blocked diagnostic；只证明协议形状、schema 和 negative guards，strict 不能当 release/live/product proof。）
- [x] Ordinary-chat writer 只能从 app-server Browser evidence path 判定 pass，且必须验证 completed `browser_search` / `browser_read` / final-answer projection、结构化 Browser read refs、workspace 内真实 BrowserHostSession source/page-text artifacts、textSha1、current-run `openedAt` 和 completionTruth evidenceRefs。
- [x] Strict validate-only smoke 必须重新打开 manifest 中的 BrowserHostSession source/page-text refs，验证 source JSON schema/status/openedAt/finalUrl/textRef/textSha1 和 text 文件实体；伪装成 historical negative fixture 的 passed manifest 也必须失败。
- [x] 真实桌面 live run 记录中必须有 `browser_search`、至少一个 `browser_read` 和一次 verified final-answer projection。（2026-06-08 三类 clean ordinary-chat desktop run 均通过，baseline=0、`browserSearchMentions=1`、`browserReadMentions=1`、`sourceEvidenceOk=true`、`sourceLinkInFinal=true`。）

## P8：迁移与清理

目标：旧 Browser 路径不再污染新设计。

Build Tasks：

- [x] 清理 docs、README、manifest、tool description、tests 中旧 `readInput` / `candidateReadInputs` 口径。
- [x] 清理 runtime gateway、slash command、module fallback、Browser pane dogfood 中能绕过 Agent Host 的产品路径。
- [x] 清理旧 BrowserHostSearch / search_read / open_read / open 兼容 wrapper。（`search_read/open_read/open` task-facing wrappers 已 fail closed；host implementation 类型已改为 `BrowserHostDiscovery*` / `BrowserHostPageRead*`。）
- [x] 清理把 Model Router 当作 Browser task upstream 或 final answer 生成器的路径。
- [x] 防止 legacy path 回流到 package scripts、runtime registry、Agent Host 工具名或 product claim。

Acceptance Gates：

- [x] legacy path 检查通过。
- [x] 新文档和 package README 不再把旧路径描述成目标能力。
- [x] 没有 compatibility wrapper 被当成 completion truth。
- [x] 没有 Browser/UI/Model Router 旁路能生成用户可见 final answer。

## 非目标

- 不做 Browser agent。
- 不做搜索总结器。
- 不做 query planner、source ranker、semantic verifier 或 final answer generator。
- 不在 Browser 内做 task planning、repair、verification、AcceptanceSpec 或 completion truth。
- 不用搜索链接、snippet、GUI projection、screenshot replay、fixture、历史 run 或 package probe 替代真实产品验收。
- 不让 Browser pane 成为用户任务语义入口。

## 打勾规则

- `[x]` 只能表示该阶段的 Build Tasks、Acceptance Gates 和 Invariant Audit 都通过。
- 单元测试通过但没有真实搜索 / 真实读取验收，不能打 live-diagnostic 完成勾。
- live acceptance 通过但没有普通聊天 final-answer projection，不能打用户级搜索验收完成勾。
- 如果 final answer 不能列出实际读取过的 source page/page text refs，不能打搜索总结任务完成勾。
- 搜索结果页、搜索 snippet、旧 run、fixture 或 package probe 不能替代 source evidence。
- blocked 也可以作为验收结果，但必须说明缺失条件、保留 refs，并给出恢复路径。

Proof 层级：

- `unit proof`：函数 / 模块级测试或 appServerClient DI，只证明逻辑。
- `protocol proof`：producer / fixture 合成 `browser_search -> browser_read -> final-answer projection` 形状，只证明协议字段、validator 和 negative guards。
- `local diagnostic`：local HTTP fixture、local dogfood 或本地配置诊断；不能宣传为 live/product proof。
- `live diagnostic`：service runtime ready、真实网页、真实 BrowserHostSession source/page text/download refs；证明能力，不等于普通聊天入口完成。
- `product proof`：桌面 SciForge App 普通聊天入口，current-run Browser evidence，Agent Host / App Server verified final answer 可见，三类真实搜索任务完成。

## 当前 Run 证据（2026-06-08）

- [x] `node --import tsx --test packages/actions/browser-runtime/index.test.ts packages/actions/browser-runtime/mcp.test.ts src/runtime/modules/bounded-operation-module-handlers.test.ts src/runtime/modules/browser-runtime-user-acceptance.test.ts`：29 tests passed，覆盖 primitive validator、resources/evidenceState、`resourceRef` resolver、MCP direct tools、download constraints/risk、local PDF refs-first artifact evidence、sessionId+linkSelector local frame artifact 解析、local search-to-download flow 和 blocked diagnostic flow。
- [x] `node --import tsx --test src/runtime/modules/browser-runtime-user-acceptance.test.ts`：2 tests passed，覆盖 local search-to-download happy path，以及搜索候选存在但 `browser.read(resourceRef)` 无法读取正文、`browser.download` content-length 超预算时的 refs-first blocked diagnostics；断言 search snippet 不会进入 blocked read envelope，超预算 download 不产出 `download_artifact` resource / `artifactRef` completion evidence。
- [x] `node --import tsx --test src/runtime/codex/agent-host-local-tool-act-orchestrator.test.ts src/runtime/codex/agent-host-browser-evidence.test.ts src/runtime/codex/codex-app-server-client.test.ts`：60 tests passed，覆盖 Browser evidence ledger、direct browser tools、`module.invoke(moduleId="browser")` evidence recording、`browser_read({ resourceRef })`、local-only/no-network Browser block、search-only / blocked-read / low-information final projection block、AcceptanceSpec relevance/latest/temporal gaps 和 completionTruth projection。
- [x] `node --import tsx --test tests/smoke/runtime-codex-browser-ordinary-chat-acceptance-writer.test.ts tests/smoke/runtime-codex-browser-ordinary-chat-local-dogfood.test.ts tests/smoke/smoke-runtime-codex-browser-local-dogfood.test.ts`：14 tests passed，ordinary-chat writer 走 app-server client DI、要求 completed Browser search/read/final projection、结构化 Browser read refs、completionTruth evidenceRefs、真实 BrowserHostSession source JSON + page text 文件、textSha1 和 current-run openedAt；local dogfood 不注入 Browser manager 旁路。
- [x] Model Router 链路收敛：Runtime Codex / API 服务只拿 `SCIFORGE_MODEL_ROUTER_BASE_URL` `/v1` 和 public alias `sciforge-router`；`config.local.json` 的 `llm/textLLM.env.SCIFORGE_TEXT_*` 只进入 Model Router 成员模型 env；`codexProxy` / `runtimeCodexProxy` 存储配置被丢弃，`backend:codex-proxy` / `packages/backend codex:proxy` 只剩 fail-closed alias，所有 `SCIFORGE_PROXY_*` / `SCIFORGE_RUNTIME_BASE_URL` 在桌面 launcher、dev shell、workspace local config 和 standalone Runtime Codex server 中被剥离；gateway request、runtime contract、Settings UI 和 backend prompt policy 均不再接受 / 转发 raw `llmEndpoint`、Provider Base URL 或 UI API Key。
- [x] `node --import tsx --test packages/contracts/runtime/agent-backend-policy.test.ts packages/contracts/runtime/backend-prompt-policy.test.ts src/runtime/gateway/gateway-request.test.ts src/runtime/gateway/agent-backend-config.test.ts src/runtime/gateway/backend-prompt-policy.test.ts src/runtime/codex/agent-host-browser-evidence.test.ts`：43 tests passed，覆盖 raw LLM endpoint normalizer 变为 fail-closed、gateway request 丢弃 legacy `llmEndpoint`、backend policy 不再从 request/config.local/workspace raw endpoint 读取成员模型，以及 candidate read blocked 不允许 final answer satisfied。
- [x] `node --import tsx --test tests/smoke/smoke-agent-harness-contract.ts tests/smoke/smoke-contract-driven-handoff.ts`：2 tests passed，legacy harness smoke 改为当前架构 tripwire：mock AgentServer context/run endpoints 调用次数必须为 0，harness metadata 可离线重建，backend selection owner 为 AgentHost，raw `llmEndpointConfigured=false`，Runtime Codex fail-closed 不会回落到旧 AgentServer generation。
- [x] `node --import tsx tests/smoke/smoke-model-router-no-active-legacy-proxy.ts`：通过；active scripts 和 desktop sidecar bundle 不启动 legacy `sciforge-goose-proxy.mjs` / codex-responses-proxy。2026-06-08 额外清理用户目录残留 LaunchAgent：`/Users/zhangyanggao/Library/LaunchAgents/com.sciforge.gooseproxy.plist` 已 `bootout`/删除，`launchctl print gui/501/com.sciforge.gooseproxy` 已不可用。
- [x] `node --import tsx --test src/ui/src/api/sciforgeToolsClient/runtimeEvents.client.test.ts src/ui/src/api/sciforgeToolsClient/codexRealtimeSession.test.ts src/ui/src/api/sciforgeToolsClient/runtimeEvents.test.ts`：94 tests passed，覆盖 stale native resume 缺失 rollout 时自动重建 fresh Runtime Codex request（attempt-2、无 `codexSessionId`、无 resume prefix）和 Browser WebSocket 错误关闭使用浏览器合法 private close code `4000`。
- [x] `node --import tsx --test src/runtime/desktop/runtime-launcher.test.ts src/runtime/workspace-server-local-config.test.ts tests/smoke/smoke-desktop-dev-shell.test.ts src/runtime/codex/codex-runtime-server.test.ts src/runtime/codex/codex-app-server-client.test.ts`：121 tests passed，覆盖 packaged launcher 只把 `textLLM.env.SCIFORGE_TEXT_*` 暴露给 Model Router、wildcard host 发布为 loopback URL、Runtime Codex service env 不继承 legacy proxy/direct-provider env、standalone server sanitize。
- [x] `node --import tsx --test src/runtime/desktop/runtime-launcher.test.ts src/runtime/codex/codex-runtime-config.test.ts src/runtime/codex/codex-app-server-client.test.ts packages/backend/src/local-provider-config.test.ts tests/smoke/smoke-desktop-dev-shell.test.ts src/runtime/desktop/desktop-dev-shell-model-router.test.ts src/runtime/workspace-server-local-config.test.ts src/runtime/codex/codex-runtime-server.test.ts`：161 tests passed，覆盖 production launcher 读取 `llm/textLLM.env.SCIFORGE_TEXT_*` 作为 Model Router member-model env、成员模型 key/env 只进 Model Router、Runtime Codex / Codex app-server 子进程剥离 `SCIFORGE_RUNTIME_BASE_URL` 和所有 `SCIFORGE_PROXY_*`、standalone server sanitize、workspace local config 只暴露 member models 给 Router role env。
- [x] `npm run desktop:build`：通过；生成新的 `dist-ui` 和 bundled desktop sidecars。Vite 仍提示既有 xterm default import/chunk size warning，不影响本轮 Browser/Router 验收。
- [x] P7 真实桌面 SciForge ordinary-chat UI clean product proof（三类均 baseline=0、`status=passed`、`finalAnswerObserved=true`、`sourceEvidenceOk=true`、`sourceLinkInFinal=true`、`browserSearchMentions=1`、`browserReadMentions=1`）：普通网页 `docs/test-artifacts/desktop-browser-ordinary-chat-ui-live-openai-docs-clean-chat/manifest.json`，runId `desktop-browser-ui-live-openai-docs-clean-chat-2026-06-08T09-52-07-426Z`，source `https://developers.openai.com/api/docs`，textSha1 `459f78e7b14c01a30df895681dd46af4a5c7ebec`；arXiv/论文 `docs/test-artifacts/desktop-browser-ordinary-chat-ui-live-arxiv-summary-clean-chat/manifest.json`，runId `desktop-browser-ui-live-arxiv-summary-clean-chat-2026-06-08T10-01-30-033Z`，source `https://arxiv.org/html/2402.06196v3`，textSha1 `76a4d08061935c94e4c08f5663e7cfbd46fa7af8`；新闻/最新动态 `docs/test-artifacts/desktop-browser-ordinary-chat-ui-live-news-accepted-clean-chat/manifest.json`，runId `desktop-browser-ui-live-news-accepted-clean-chat-2026-06-08T10-17-06-870Z`，source `https://releasebot.io/updates/openai`，sourceRef `browser-host-session:browser-host-075e6bc1ddbe/source-pages/source-1-8af9285de5.source.json`，textRef `browser-host-session:browser-host-075e6bc1ddbe/source-pages/source-1-8af9285de5.txt`，openedAt `2026-06-08T10:19:16.376Z`，textSha1 `8af9285de50eef5d551fb29c6b373b493d20c278`，source text includes `Last updated: 2026年6月6日` 和 `2026年6月4日`。
- [x] P7 真实桌面 negative diagnostic 已记录但不计入 product pass：`docs/test-artifacts/desktop-browser-ordinary-chat-ui-live-news-final-clean-chat/manifest.json`，runId `desktop-browser-ui-live-news-final-clean-chat-2026-06-08T10-52-31-573Z`，`status=failed`，runtime ready，WebSocket 652 frames；模型多次调用 `browser_search` / auto-read，读到当前 run `browser-host-session:browser-host-f5c20f91a5cf/source-pages/source-1-fa7aa5950b.source.json` / `.txt`，正文是 Zhihu 403 异常 JSON，12 分钟内未形成合格 assistant final-message projection。该样本证明 live blocked/partial 收束仍需产品化，不能作为 P7 正向 evidence。
- [x] `node --import tsx --test src/runtime/browser-host-session.test.ts src/runtime/browser-host-session-source-pages.test.ts src/runtime/browser-host-session-search.test.ts src/runtime/modules/bounded-operation-module-handlers.test.ts src/ui/src/app/results/browserPaneModel.test.ts`：76 tests passed，覆盖 host-internal discovery/pageRead rename、OpenAI changelog / arXiv source-page local summaries、旧 host HTTP search/open-read route fail closed、download selector/redirect/domain constraints 和 Browser pane refs-first projection。
- [x] `node --import tsx --test packages/contracts/runtime/modules.test.ts`：11 tests passed，generic bounded-operation 正向样例已改为 neutral `knowledge.*`，旧 `browser.search_read/open_read` 只保留在负向拒绝样例中。
- [x] `node --import tsx --test tests/smoke/smoke-runtime-codex-browser-acceptance-producer.test.ts`：4 tests passed，producer protocol-only diagnostic 要求 `browser_search`、`browser_read`、source/page-text refs 和 final-answer projection，并拒绝旧 `search_read/open_read/executeBoundedOperation` product proof；strict smoke 会拒绝 fixture producer、缺失 materialized source artifacts 的 passed manifest，以及伪装 `codex-command-negative-* + artifact:negative-fixture` 的 passed manifest。该 producer 只在 test env 合成协议证据，不能替代 desktop SciForge App live ordinary-chat acceptance。
- [x] `npm run smoke:capability-manifest-package-discovery --silent`：通过；package-discovery audit count 使用 core registry + discovered package 增量断言，不再依赖硬编码目录数量。
- [x] `npm run smoke:no-legacy-paths --silent`：通过；仅保留既有 T120 tracked warnings，无 Browser legacy structural errors。
- [x] `npm run smoke:runtime-contracts --silent`：通过。
- [x] `npm run smoke:package-runtime-boundary --silent`：通过。
- [x] `node --import tsx --test tests/smoke/smoke-browser-runtime-live-download-chain.test.ts`：2 tests passed，覆盖 P3/P6 live diagnostic manifest 默认 opt-in blocked 状态，以及 passed manifest 必须包含 refs-first bounded search/source/page-text/download refs、CSV/PDF sha256/size/MIME、negative download blocked checks、primitive trace、无 inline payload / 本地路径。
- [x] `npm run smoke:browser-runtime-live-download-chain:opt-in --silent`：通过；脚本默认使用 desktop dev shell loopback native adapter `http://127.0.0.1:5177`（也可由 `SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL` 覆盖），写入 `docs/test-artifacts/browser-runtime-live-download-chain/manifest.json`，status=`passed`，traceIntents=`browser.search -> browser.navigate -> browser.read -> browser.extract -> browser.read -> browser.download x4`，searchResultCount=8，source page/text refs 和 CSV/PDF download refs 均为 current-run `browser-host-session:` refs；negative read check `pdf-source-read` 为 blocked / `source_page_read_failed` / `outputPresent=false`，negative download checks `csv-overbudget` / `csv-domain-not-allowed` 均为 blocked，`refsCount=0`，`artifactRefPresent=false`。
- [x] `npm run typecheck --silent`：通过。
- [x] `npm run desktop:build`：通过 fresh build；生成 `dist-ui` 和 bundled desktop sidecars，仍只有既有 xterm default import / chunk-size warnings。
- [x] `git diff --check`：通过。

当前未完成的 live/product 验收：

- [x] P3/P6 live diagnostics 已覆盖正向 opt-in live chain、CSV/PDF hash/size/MIME、download negative blocked cases，以及 PDF / HTTP 401 / HTTP 403 / `.invalid` source-read blocked cases；该结果仍只是 `diagnosticOnly=true`，不能升级为 release/product proof。
- [ ] broader source-read blocked product 收束尚未完成：Browser Runtime 当前只统一返回 `source_page_read_failed`，还没有 robots/login semantic detector；仍需证明 app-server / desktop ordinary-chat 的最终 assistant final-message 能把这些 blocked/partial negative case 稳定收束为用户可理解的 partial/blocked，而不是把诊断或搜索 snippet 当完成。
- [ ] `smoke:runtime-codex-browser-ordinary-chat-local-dogfood` 仍只能作为 local diagnostic；release/product claim 必须来自 app-server / desktop ordinary-chat path 的 current-run Browser evidence。
- [x] Fixture / producer 的 manifest 必须保持 protocol-only blocked diagnostic，不能复制或解释为 release/live proof；真实验收必须来自 app-server / desktop ordinary-chat path 的 current-run Browser evidence。

## 文档地图

- [`PROJECT.md`](PROJECT.md)：SciForge 总体用户级验收边界。
- [`docs/Architecture.md`](docs/Architecture.md)：唯一 Agent Host 产品链路。
- [`docs/BrowserRuntimeArchitecture.md`](docs/BrowserRuntimeArchitecture.md)：Browser 最新设计原则。
- [`packages/actions/browser-runtime`](packages/actions/browser-runtime)：Browser contract、MCP adapter、tests 和 package metadata。
