# SciForge - PROJECT.md

最后更新：2026-05-14

## 当前目标
测试、优化多轮对话机制，使得其稳定、流畅，同时优化用户在网页端的体验


## 重要
同时开启多个sub agents，并行使用computer use能力从网页端并调试、修复，实现所有的任务，并行度越高越好。完成milestone后更新PROJECT.md、同步到github，直到完成为止。然后继续同时开启多个sub agents并行工作，实现所有的任务，并行度越高越好，在一个阶段完成后，你可以删掉没用的sub agents，重启新的sub agents，持续不间断地并行实现目标。步伐越大越好，尽快实现目标。

当你觉得任务已经完成，或者觉得余下任务没必要做、不合理的时候，可以停下。不合理的任务你可以把它改得合理；你也可以加上新的任务。


## 不变原则

- 所有修改必须通用、可泛化到任何场景，不能在代码里面硬编码和为当前案例打补丁
- 有多种修改方案的时候，优先实现最简洁、通用的方案
- 算法相关的代码优先用Python实现，方便人类用户优化、检查算法
- 代码路径保持唯一真相源：发现冗余链路时删除、合并或降级旧链路，避免长期并行实现。
- 多轮记忆只复用 AgentServer session/current-work/compaction 机制；SciForge 本地只保留 context policy、refs、digest、evidence boundary 和 handoff projection，不能再扩展成第二套长期记忆系统。
- 不需要考虑旧兼容性，可以直接删除旧逻辑，然后实现最终版本，保持代码链条绝对干净
- 代码膨胀必须自动触发治理：源码文件超过 1000 行进入 watch list；超过 2000 行优先拆分；超过 3000 行视为维护风险。后续开发若让文件越过阈值，应优先抽模块、删除冗余逻辑或补拆分 TODO，而不是继续堆主文件。
- 长文件拆分必须按职责命名，不能机械切成 part1/part2；如果暂时不能完全解耦，也要拆成有语义的文件，例如 *-event-normalizer、*-runner、*-diagnostics、*-state-machine，并保持主入口只做流程编排。
- 推进项目的时候尽可能多开sub agents，并行加速推进

任何 agent 在执行本项目任务前，必须先读本文件和与任务相关的设计文档，避免凭局部代码印象破坏系统边界。
- [`docs/Architecture.md`](docs/Architecture.md)：SciForge 总体架构、Backend-first / Contract-enforced / Capability-driven / Harness-governed 方向、`src` 与 `packages` 边界。
- [`docs/AgentHarnessStandard.md`](docs/AgentHarnessStandard.md)：harness runtime、profile、stage hook、contract、trace、merge 规则和行为治理入口。

## 任务板

### 2026-05-14 Task：LLM-gated fast path 与分布式工具接入层

最终方案：direct-context fast path 必须先经过 LLM/语义 classifier 做 intent/context match；只允许在 typed context 足够时低延迟回答。工具生态拆成 Skill、Capability、Provider、Runtime Resolver 四层。新增机器提供既有 capability 时应只改 AgentServer/worker/tool-routing 配置；新增工具类型必须通过 Tool Manifest 注册 capability/provider contract，而不是只写 `SKILL.md`。

架构任务：

- [x] CAP-ARCH-01：将四层模型写入 `docs/Architecture.md`：Skill 描述方法，Capability 定义抽象能力和 schema，Provider 声明执行来源，Runtime Resolver 在 run 前绑定 provider 并记录 route。
- [x] CAP-ARCH-02：将 direct-context fast path 边界写入 `docs/Architecture.md`：fast path 可以低延迟，但不能纯模板化；必须先判断 required typed context 和 sufficiency。
- [x] CAP-ARCH-03：将分布式工具接入写入 `docs/Architecture.md`：标准 worker/capability 只改配置，全新工具类型必须通过 Tool Manifest 和 healthcheck 接入。

实现 TODO：

- [x] CAP-P0-01：把 `direct-context-fast-path` 改成 LLM-gated 或 semantic-classifier-gated 路径；输出必须记录 intent、required context、context ids、sufficiency 和 skipped-task reason。
- [x] CAP-P0-02：新增 `skill/tool/capability/provider status` intent，禁止进入 artifact-summary direct-context；必须查询 Capability Registry / Tool Registry / AgentServer worker registry。
- [x] CAP-P0-03：实现 capability preflight：scenario/skill requires 的 capability 缺失、provider offline、未授权或限流时，发送前阻断并给出用户可操作提示。
- [x] CAP-P0-04：为 `web_search` / `web_fetch` 建立标准 capability/provider contract，禁止任务在无 provider 时生成临时网页 scraper 充当搜索工具。
- [x] CAP-P0-05：配置页 Tools/Skills 展示 provider 来源、运行位置、健康状态、授权状态、权限、primary/fallback route 和依赖关系。
- [x] CAP-P1-01：定义 Tool Manifest schema：capability id、transport、endpoint/command/mcp server、input/output schema、permissions、healthcheck、fallback eligibility、rate-limit metadata。
- [x] CAP-P1-02：接入 AgentServer worker/tool-routing discovery，把 `backend-server`、`server`、`client-worker`、`ssh`、`remote-service` 映射为 SciForge provider registry。
- [x] CAP-P1-03：Runtime Resolver 在每次 run 前把 required capabilities 解析为 provider route，并写入 handoff、ExecutionUnit、TaskRunCard 和 audit trace。
- [x] CAP-P1-04：统一 zero-result、HTTP 429、provider offline、permission denied、missing capability 的 failure classification 和恢复建议。
- [x] CAP-P2-01：支持 worker/tool server 暴露 manifests 后自动注册到 Capability Registry；新增标准工具机器只改配置，不改 SciForge 代码。
- [ ] CAP-P2-02：增加真实网页 E2E：无 web search provider 时阻断；启用 AgentServer server-side search 后同一文献任务可检索、下载、总结并保留 provider route trace。

### 2026-05-14 Task：多轮记忆管理收敛到 AgentServer

最终方案：AgentServer 是多轮对话记忆的唯一权威来源；SciForge 不再本地定制一套长期记忆，只负责把本轮意图、引用、证据边界和恢复策略投影给 AgentServer。旧 `memoryPlan` 链路已删除，最终字段统一为 `handoffMemoryProjection`。

架构任务：

- [x] MEM-ARCH-01：将 `docs/Architecture.md` 固化为“AgentServer owns memory, SciForge owns projection”的边界，删除把 `memoryPlan`、conversation ledger 或 UI recent messages 描述为本地长期记忆的旧表述。
- [x] MEM-ARCH-02：梳理 `conversation-policy` 输出字段语义：`contextReusePolicy` 只表达 `continue/repair/isolate`，`handoffMemoryProjection` 只表达本轮可暴露摘要和 refs，不承担 recall。
- [x] MEM-ARCH-03：把 AgentServer `/context`、`/compact`、stable `agentId`、`contextPolicy.includeCurrentWork/includeRecentTurns/persistRunSummary` 写成唯一多轮记忆 contract。

实现 TODO：

- [x] MEM-P0-01：修正 continuation 判定链路，用户问“你还记得一开始的问题吗”这类纯多轮指代时必须稳定复用 AgentServer session/current-work，而不是 fresh agent scope。
- [x] MEM-P0-02：检查 `agentServerContextPolicy()` 与 `agentServerAgentId()`：fresh task 隔离旧记忆，continue/repair 使用稳定 scope，并打开 AgentServer recent turns/current work。
- [x] MEM-P0-03：`contextEnvelope` 只携带 current turn snapshot、refs、digest、artifact/run refs 和 policy summary；禁止把完整历史、raw logs 或大 artifact body 作为本地记忆塞回 handoff。
- [x] MEM-P0-04：AgentServer context/compact API 不可用时只降级为 refs-first handoff slimming，并在 UI/runtime event 中说明“记忆服务不可用”，不静默启用本地长期记忆 fallback。
- [x] MEM-P1-01：为多轮记忆增加 smoke/browser case：先问 A，再跑文献/计算任务，再问“我一开始问的是什么”，验证 AgentServer 记忆能回答且不会被当前 artifact refs 污染。
- [x] MEM-P1-02：增加 isolate case：新任务带显式 current refs 时不得复用旧 AgentServer recent turns，避免旧研究目标污染当前结论。
- [x] MEM-P1-03：增加 repair case：只复用目标 failed run、failure evidence refs 和 AgentServer current work，不读取无关历史 run。
- [x] MEM-P1-04：UI 显示 context/memory 状态时区分 AgentServer memory、SciForge projection、handoff slimming 和 audit refs，避免让用户误以为本地 UI ledger 就是完整记忆。
- [x] MEM-P2-01：删除 `memoryPlan` 旧链路并统一为 `handoffMemoryProjection`，在类型、测试和文档中消除“本地记忆系统”误解。


### H022 Real-world Complex Task Backlog for SciForge Hardening

职责：沉淀更多真实、多轮、可复现的用户任务，用这些任务持续压测 SciForge 的通用能力边界。每个任务都必须像真实用户一样提出目标、补充约束、引用中间结果、追问失败原因、要求继续或导出，而不是只跑单轮 happy path。后续修复必须从任务暴露的问题中抽象出通用 runtime、harness、payload、artifact、verification、resume、presentation 或 backend handoff 改造，禁止为某个 prompt、某篇论文、某个文件名、某个 backend 写硬编码。

执行规则：

- 每个真实任务都要保留 session bundle、runtime events、task inputs、task outputs、stdout/stderr、artifact refs、executionUnits、verification verdict 和最终用户可见结果。
- 每个任务结束后必须补一条 `Failure/Improvement Note`：问题现象、最小复现步骤、通用归因层、建议修复入口、不能采用的特例修复。
- 如果任务失败但产生了可用 partial，必须继续追问一次“复用已有结果继续”，测试 checkpoint 和 artifact lineage。
- 如果任务成功，必须继续追问一次“换范围/换格式/补证据/导出审计”，测试多轮引用和状态继承。
- 每类任务至少覆盖一个长任务、一个外部依赖不稳定、一个 schema/payload 漂移、一个用户中途改范围、一个历史恢复或刷新继续。
- 所有 TODO 默认是待跑真实任务，不代表已经实现修复；跑完后再把发现的问题拆成 H018-H021 或新 H 项下的通用工程任务。

文献与科研调研真实任务：

- [ ] R-LIT-01 今日 arXiv agent 论文深调研：检索今日/最近 agent 论文，下载 PDF，阅读全文，产出中文 markdown 报告；随后要求按方法、数据集、评测指标、主要结论重排；再要求导出审计包。已压测真实失败边界，保留 evidence bundle；后续修复见本轮 notes。
- [ ] R-LIT-02 arXiv 空结果恢复：限定一个很窄主题和当天日期，预期可能空结果；要求系统自动说明 empty result、扩展 query、保留不确定性，并继续生成 partial 报告。
- [ ] R-LIT-03 多来源文献对照：同一主题分别检索 arXiv、Semantic Scholar/PubMed/网页来源，去重并标注来源差异；用户要求删除低可信来源后重写结论。
- [ ] R-LIT-04 全文下载失败恢复：要求下载 10 篇论文全文，其中部分 PDF 超时/403/过大；系统必须保留已下载全文、标注失败原因、继续基于 metadata 补 partial。
- [ ] R-LIT-05 引用修正多轮：先生成报告，再让用户指出某条引用不可信；系统必须定位原 artifact/ref，修正该段，不污染其他结论。
- [ ] R-LIT-06 研究方向综述迭代：先做宽泛综述，再要求缩小到 robotics agent，再要求排除 benchmark 论文，再要求只保留开源代码论文。
- [ ] R-LIT-07 论文复现可行性筛选：检索论文后按代码可用性、数据集可用性、计算成本、复现风险排序，并导出复现计划。
- [ ] R-LIT-08 反事实追问：报告完成后用户问“如果只看非 LLM agent 呢”，系统必须复用已有检索 refs 并说明哪些需要刷新。已覆盖“缺少可用 paper-list/report 时必须先 repair/resume”的失败边界。
- [ ] R-LIT-09 历史文献任务恢复：打开昨天失败的 literature session，要求只看诊断不重跑；系统必须展示失败边界、可复用 refs 和下一步选项。
- [ ] R-LIT-10 双语报告：同一调研先生成中文报告，再要求英文 executive summary，再要求中英术语表，验证 artifact 派生关系。

代码修复与工程任务：

- [ ] R-CODE-01 端到端 bug 修复：用户贴浏览器失败截图，要求定位原因、写通用修复、跑测试、重启服务、同步 GitHub；过程中用户中断一次后继续。
- [ ] R-CODE-02 Schema drift 修复：构造 backend 返回宽松 JSON、fenced JSON、缺字段 payload、空 artifactRef 等情况，要求系统统一归一化而非 repair loop。
- [ ] R-CODE-03 长任务 stream 稳定性：运行超过前端 timeout 的任务，刷新浏览器、关闭标签、恢复历史，验证后端不被 passive disconnect 杀掉。
- [ ] R-CODE-04 多模块改造：让 agent 同时改 gateway、UI presentation、runtime contract、tests；用户中途要求缩小范围，只保留 runtime 修复。
- [ ] R-CODE-05 测试失败恢复：第一次 patch 后 typecheck/test 失败，用户要求解释失败并做最小通用修复，不能回滚无关改动。
- [ ] R-CODE-06 Dirty worktree 协作：预先放入用户未提交改动，再让 agent 修复另一区域，验证不会 reset/revert 用户改动。
- [ ] R-CODE-07 Release verify 请求：用户要求“等完整验证再推 GitHub”，系统必须阻塞到指定测试完成，失败时不推送。
- [ ] R-CODE-08 Backend handoff 漂移：AgentServer 返回 taskFiles、direct ToolPayload、plain text、malformed generation response 四类输出，要求统一分类和可恢复。
- [ ] R-CODE-09 多 backend 对比修复：同一任务用 Codex/OpenTeam 两个 backend 跑，比较失败模式，提炼 backend-neutral 修复。
- [ ] R-CODE-10 项目服务生命周期：修改代码后自动重启 dev server，确认端口占用、旧进程退出、新服务 ready、浏览器页面可刷新。

数据分析与文件 artifact 任务：

- [ ] R-DATA-01 CSV 多轮分析：上传/引用 CSV，先做摘要统计，再改分组口径，再要求异常值解释，再导出 markdown 报告和复现代码。
- [ ] R-DATA-02 两表合并冲突：A/B 两个表字段不一致，用户给映射规则，系统重算并保留 mapping artifact。
- [ ] R-DATA-03 大文件摘要：读取大文本/日志文件，只允许摘要和 refs，不允许把全文塞入 prompt；后续追问必须按需读取片段。
- [ ] R-DATA-04 图表迭代：先生成图表 artifact，再要求换坐标、换颜色、筛选子集、导出最终报告，测试 artifact identity。
- [ ] R-DATA-05 缺失文件恢复：历史 artifact 指向的文件被删除/移动，用户要求继续，系统必须 stale-check 并进入安全恢复。
- [ ] R-DATA-06 Notebook 风格任务：连续执行多个分析步骤，每步都有中间文件；用户要求回到第 2 步换参数后继续生成分支结果。
- [ ] R-DATA-07 外部数据源限流：调用外部 API 拉数据遇到 429/timeout，系统必须输出 transient-unavailable 诊断和重试建议。
- [ ] R-DATA-08 审计导出：分析完成后用户只要求导出 task graph、数据 lineage、执行命令和 artifact refs，不重新计算。

Runtime、恢复与会话生命周期任务：

- [ ] R-RUN-01 失败 run 诊断：用户点选 failed run，要求解释为什么失败、哪些文件可用、是否能继续、下一步怎么做。
- [ ] R-RUN-02 Repair loop 防护：制造 repeated repair no-op，要求系统停止重复修复并给通用失败分类。
- [ ] R-RUN-03 Background continuation：启动长任务后用户继续问另一个问题，后台完成后要求合并结果并标注 revision。
- [ ] R-RUN-04 多标签并发：两个浏览器标签对同一 session 发送消息，验证 ordering/conflict guard。
- [ ] R-RUN-05 编辑历史 revert：修改早期用户目标并选择 revert，系统必须废弃后续派生 runs/artifacts。
- [ ] R-RUN-06 编辑历史 continue：修改早期目标但保留已有结果，系统必须标注冲突和受影响结论。
- [ ] R-RUN-07 跨 session 恢复：新开页面恢复旧 session，只依赖持久化 state，不依赖前端内存。
- [ ] R-RUN-08 取消边界：用户显式 cancel 后要求继续，系统必须说明 cancel boundary，不自动恢复不可逆 side effect。
- [ ] R-RUN-09 版本漂移恢复：代码更新后打开旧 session，系统检测 capability/schema/version drift 并建议迁移或重跑。
- [ ] R-RUN-10 压缩后恢复：模拟只剩 state digest 和 refs，继续多轮任务，检查 artifact/run/ref 是否仍能命中。

UI 与 presentation 真实任务：

- [ ] R-UI-01 失败结果可读性：失败时右侧结果必须先展示用户可理解的原因、可用产物、下一步，而不是 raw trace 优先。
- [ ] R-UI-02 Partial 优先：长任务运行中必须展示已完成部分、当前阶段、后台状态和可安全中止/继续的操作。
- [ ] R-UI-03 Artifact 选择追问：用户点选某个 file/artifact 后追问“基于这个继续”，系统必须使用被点选对象而不是最近对象。
- [ ] R-UI-04 ExecutionUnit 展示：运行结果中 execution unit 必须包含 codeRef/stdoutRef/stderrRef/outputRef、状态、失败原因和 recoverActions。
- [ ] R-UI-05 Verification 状态：普通结果、未验证结果、后台验证中、验证失败、release verify 通过五种状态 UI 必须可区分。
- [ ] R-UI-06 空结果页面：没有 artifact 时不能显示误导性 completed；必须展示 empty/needs-human/recoverable 的准确状态。
- [ ] R-UI-07 多 artifact 比较：结果区同时出现 report、paper-list、diagnostic、verification，用户切换 focus mode 后仍保持正确排序。
- [ ] R-UI-08 导出 bundle：用户要求导出 JSON bundle/审计包，UI 必须能引用正确 session bundle 而不是当前空状态。

真实用户工作流任务：

- [ ] R-WF-01 科研选题助手：用户从模糊方向开始，逐步要求找热点、筛论文、列可做实验、评估新颖性、生成计划。
- [ ] R-WF-02 论文审稿助手：上传/引用论文 PDF，要求总结贡献、找弱点、查相关工作、生成审稿意见，再要求改成温和语气。
- [ ] R-WF-03 复现实验计划：从论文出发，提取环境、数据、训练命令、评测指标、风险，生成 step-by-step 复现 checklist。
- [ ] R-WF-04 项目周报：读取 workspace 最近任务、失败 run、已完成 artifact，生成周报；用户要求隐藏敏感路径后重写。
- [ ] R-WF-05 多同学协作分工：基于当前 PROJECT 和代码结构，给 3-5 个同学拆分任务；后续要求按风险/收益重排。
- [ ] R-WF-06 调研到代码任务：先调研某技术方案，再要求在 SciForge 中实现最小通用修复，再生成测试计划。
- [ ] R-WF-07 用户反馈收敛：用户连续指出“慢、崩、看不懂、引用错、重复跑”，系统把反馈归类到通用 TODO，而不是逐条道歉。
- [ ] R-WF-08 低预算模式：用户要求“不要下载全文，先用 metadata 快速判断”，后续再允许补全文，测试 budget escalation。
- [ ] R-WF-09 严格证据模式：用户要求“不要猜，不确定就标注”，系统必须降低 claim confidence 并输出 evidence gaps。
- [ ] R-WF-10 发布前检查：用户要求把本地改动推 GitHub 前做 release verify、写变更摘要、重启服务，并保留审计记录。

通用修复 TODO 池：

- [ ] TODO-GEN-01 为每个真实任务自动生成 `TaskRunCard`：目标、轮次、状态、refs、失败模式、通用归因层、下一步。
- [ ] TODO-GEN-02 建立 `FailureSignature` 去重：相同 schema drift、timeout、repair no-op、external transient 不重复开新诊断。
- [ ] TODO-GEN-03 建立 `NoHardcodeReview` checklist：每次修复必须说明适用场景、反例、为什么不是 prompt/file/backend 特例。
- [ ] TODO-GEN-04 让真实任务跑完后自动建议归属：harness、runtime server、AgentServer parser、payload normalization、presentation、verification、resume、UI。
- [ ] TODO-GEN-05 为“成功但不满足用户真实目标”的情况增加状态：protocol success 不等于 task success，必须进入 needs-work/needs-human。
- [ ] TODO-GEN-06 为 direct-text fallback 增加 guard：像代码、taskFiles、JSON、trace、日志的内容不能轻易包装成最终报告。
- [ ] TODO-GEN-07 为 schema normalization 建立白名单边界：只修复结构漂移，不吞掉真实语义错误或安全错误。
- [ ] TODO-GEN-08 为 external transient 建立 provider-neutral policy：HTTP、DNS、timeout、rate limit、quota、service unavailable 统一分类。
- [ ] TODO-GEN-09 为 session bundle 增加“一键打包/恢复/审计”检查清单，确保每个多轮任务可独立迁移。
- [ ] TODO-GEN-10 为复杂任务新增“用户满意度 proxy”：是否回答了最新请求、是否展示可用结果、是否给出下一步、是否避免重复劳动。
