# SciForge - PROJECT.md

最后更新：2026-05-14

## 当前目标

按照设计文档[`docs/Architecture.md`](docs/Architecture.md)中的最终形态去实现SciForge, 旧版本实现、旧逻辑不需要兼容，建议删除后重写，确保代码逻辑干净

## 重要
同时开启多个sub agents，并行使用computer use能力从网页端并调试、修复，实现所有的任务，并行度越高越好。完成milestone后更新PROJECT.md、同步到github，直到完成为止。然后继续同时开启多个sub agents并行工作，实现所有的任务，并行度越高越好，在一个阶段完成后，你可以删掉没用的sub agents，重启新的sub agents，持续不间断地并行实现目标。步伐越大越好，尽快实现目标。

当你觉得任务已经完成，或者觉得余下任务没必要做、不合理的时候，可以停下。不合理的任务你可以把它改得合理；你也可以加上新的任务。






## 不变原则

- 所有修改必须通用、可泛化到任何场景，不能在代码里面硬编码和为当前案例打补丁
- 有多种修改方案的时候，优先实现最简洁、通用的方案
- 算法相关的代码优先用Python实现，方便人类用户优化、检查算法
- 代码路径保持唯一真相源：发现冗余链路时删除、合并或降级旧链路，避免长期并行实现。
- 多轮记忆只复用 AgentServer session/current-work/compaction 机制；SciForge 本地只保留 context policy、refs、digest、evidence boundary 和 handoff projection，不能再扩展成第二套长期记忆系统。
- 不需要考虑旧兼容性，可以直接删除旧逻辑代码重写，保持代码链条绝对干净
- 代码膨胀必须自动触发治理：源码文件超过 1000 行进入 watch list；超过 2000 行优先拆分；超过 3000 行视为维护风险。后续开发若让文件越过阈值，应优先抽模块、删除冗余逻辑或补拆分 TODO，而不是继续堆主文件。
- 长文件拆分必须按职责命名，不能机械切成 part1/part2；如果暂时不能完全解耦，也要拆成有语义的文件，例如 *-event-normalizer、*-runner、*-diagnostics、*-state-machine，并保持主入口只做流程编排。
- 推进项目的时候尽可能多开sub agents，并行加速推进

任何 agent 在执行本项目任务前，必须先读本文件和与任务相关的设计文档，避免凭局部代码印象破坏系统边界。
- [`docs/Architecture.md`](docs/Architecture.md)：SciForge 总体架构、Backend-first / Contract-enforced / Capability-driven / Harness-governed 方向、`src` 与 `packages` 边界。
- [`docs/AgentHarnessStandard.md`](docs/AgentHarnessStandard.md)：harness runtime、profile、stage hook、contract、trace、merge 规则和行为治理入口。

## 任务板

### 2026-05-14 Task：多轮记忆管理收敛到 AgentServer

最终方案：AgentServer 是多轮对话记忆的唯一权威来源；SciForge 不再本地定制一套长期记忆，只负责把本轮意图、引用、证据边界和恢复策略投影给 AgentServer。`memoryPlan` 保留为兼容字段，但语义降级为 bounded handoff projection。

架构任务：

- [ ] MEM-ARCH-01：将 `docs/Architecture.md` 固化为“AgentServer owns memory, SciForge owns projection”的边界，删除把 `memoryPlan`、conversation ledger 或 UI recent messages 描述为本地长期记忆的旧表述。
- [ ] MEM-ARCH-02：梳理 `conversation-policy` 输出字段语义：`contextReusePolicy` 只表达 `continue/repair/isolate`，`memoryPlan` 只表达本轮可暴露摘要和 refs，不承担 recall。
- [ ] MEM-ARCH-03：把 AgentServer `/context`、`/compact`、stable `agentId`、`contextPolicy.includeCurrentWork/includeRecentTurns/persistRunSummary` 写成唯一多轮记忆 contract。

实现 TODO：

- [ ] MEM-P0-01：修正 continuation 判定链路，用户问“你还记得一开始的问题吗”这类纯多轮指代时必须稳定复用 AgentServer session/current-work，而不是 fresh agent scope。
- [ ] MEM-P0-02：检查 `agentServerContextPolicy()` 与 `agentServerAgentId()`：fresh task 隔离旧记忆，continue/repair 使用稳定 scope，并打开 AgentServer recent turns/current work。
- [ ] MEM-P0-03：`contextEnvelope` 只携带 current turn snapshot、refs、digest、artifact/run refs 和 policy summary；禁止把完整历史、raw logs 或大 artifact body 作为本地记忆塞回 handoff。
- [ ] MEM-P0-04：AgentServer context/compact API 不可用时只降级为 refs-first handoff slimming，并在 UI/runtime event 中说明“记忆服务不可用”，不静默启用本地长期记忆 fallback。
- [ ] MEM-P1-01：为多轮记忆增加 smoke/browser case：先问 A，再跑文献/计算任务，再问“我一开始问的是什么”，验证 AgentServer 记忆能回答且不会被当前 artifact refs 污染。
- [ ] MEM-P1-02：增加 isolate case：新任务带显式 current refs 时不得复用旧 AgentServer recent turns，避免旧研究目标污染当前结论。
- [ ] MEM-P1-03：增加 repair case：只复用目标 failed run、failure evidence refs 和 AgentServer current work，不读取无关历史 run。
- [ ] MEM-P1-04：UI 显示 context/memory 状态时区分 AgentServer memory、SciForge projection、handoff slimming 和 audit refs，避免让用户误以为本地 UI ledger 就是完整记忆。
- [ ] MEM-P2-01：把 `memoryPlan` 字段逐步重命名或包一层别名为 `handoffMemoryProjection`，保留 contract 兼容时也要在类型注释和文档中消除“本地记忆系统”误解。

### 2026-05-14 Observation：真实网页多轮复杂任务稳定性压测

本轮目标：不改实现代码，只从真实网页状态观察用户体验与系统稳定性，并把后续任务/TODO 沉淀到本文件。已确认 `Workspace Writer` 在 `127.0.0.1:5174` 可用，前端可在 `127.0.0.1:5173` 打开；但 `AgentServer` 的 `127.0.0.1:18080/health` 持续 `connection refused`，导致新复杂任务无法真正进入生成阶段。

已执行观察：

- [ ] WEB-OBS-20260514-01：刷新工作台并观察旧失败 run。现象：页面恢复到最近 failed run，但首屏仍混杂旧 preflight 错误、raw ref、audit 文案和恢复建议，用户很难判断“这是旧错误、服务不可达、还是刚才代码仍未修好”。
- [ ] WEB-OBS-20260514-02：从网页发起真实本地文档任务：“阅读 PROJECT.md 和 docs/Architecture.md，生成 Markdown 风险报告和 P0/P1/P2 TODO”。结果：任务失败，根因是 `AgentServer generation request failed: fetch failed`，浏览器同时持续请求 `127.0.0.1:18080/health` 并失败。
- [ ] WEB-OBS-20260514-03：在失败后继续发送 follow-up：“继续上一轮，只保留用户体验相关风险并重排 TODO”。结果：再次创建新的 failed run，仍然是同一个 AgentServer 不可达原因；系统没有在发送前阻止重复失败，也没有把 follow-up 合并为“等待服务恢复后重试”的排队状态。
- [ ] WEB-OBS-20260514-04：刷新页面后检查状态恢复和结果过滤。结果：能恢复最新 failed run；“只看执行单元”过滤能收窄到运行事件，但默认“全部”视图仍重复显示 `Repair runtime execution inputs...`、`artifact:` chip、`runtime://...` contract refs 和 `CODE ARTIFACT`，用户态信息密度偏低。
- [ ] WEB-OBS-20260514-05：观察 object/reference 展示。结果：本轮未复现旧的长路径 markdown ref，但失败场景中仍出现多组重复“失败的 execution unit / 产物 / runtime-diagnostic”链接；同一失败原因在左侧消息、右侧摘要、执行详情里多次重复。

本轮归因：

- [ ] P0-STABILITY-AGENTSERVER-GATE：复杂任务入口缺少 capability readiness gate。当前 `Scenario Runtime · ready` 容易让用户以为系统可运行，但关键生成服务 `AgentServer` 不可达时仍允许发送任务。应在发送前统一检查 selected runtime 的 readiness，并把按钮/提示切到“服务未就绪，可启动/重试/离线降级”。
- [ ] P0-STABILITY-RETRY-DEDUP：同一个 service-unavailable 失败不应在 follow-up 时继续新建等价 failed run。应基于 `FailureSignature` 和 active failed run，把后续用户输入归并为 queued guidance 或 retry intent，直到依赖服务恢复。
- [ ] P0-UX-FAILURE-FIRST-SCREEN：失败首屏必须只回答三个问题：哪里不可用、用户还能用什么、下一步按钮是什么。raw `runtime://`、`artifact:`、`CODE ARTIFACT`、contract trace 和重复 repair 文案默认折叠到审计区。
- [ ] P1-UX-RUN-DRIFT-BANNER：页面刷新后如果展示的是旧 failed run，需要明确标注“这是历史失败结果”，并区分“旧 schema/preflight 失败”和“当前服务不可达”。代码或服务重启后应提示可重跑，而不是把旧错误当作当前结论。
- [ ] P1-UX-REFERENCE-DEDUP：message prose、结果摘要、object chips、ExecutionUnit 表需要共享同一套 ref dedupe/presentation contract。同一 ref 或同一失败 signature 在一个可见区域只出现一次，必要时显示“+N 审计引用”。
- [ ] P1-UX-FILTER-PURITY：`全部`、`只看证据`、`只看执行单元` 应有严格信息层级。`只看执行单元` 保留 code/stdout/stderr/output refs；默认 `全部` 只展示用户可读 summary、可用 artifact、下一步 action。
- [ ] P1-STABILITY-SERVICE-LIFECYCLE：本地 dev 启动应把 Web UI、Workspace Writer、AgentServer 作为一个可观测 service graph；任一关键节点掉线时 UI、runtime gateway、history restore 使用同一 health truth source。
- [ ] P2-E2E-VISIBLE-BROWSER-MATRIX：增加可复现的真实网页压测矩阵：本地文档任务、低预算文献任务、长任务刷新、失败 run 诊断、follow-up 去重、artifact 点击预览、filter 切换。每轮保留 screenshot、console/request failed 摘要、session bundle 和 TaskRunCard。

后续真实任务队列：

- [ ] WEB-E2E-01 本地文档多轮：读 `PROJECT.md` + `docs/Architecture.md`，生成 markdown 风险报告；follow-up 改成只看 UX；验证不依赖外网也能完成或清晰说明缺失能力。
- [ ] WEB-E2E-02 服务不可达恢复：关闭/开启 AgentServer 前后各发一次任务，验证发送前 gate、失败去重、服务恢复后的 retry action。
- [ ] WEB-E2E-03 文献低预算任务：只用 metadata 快速调研，不下载 PDF；follow-up 再允许补全文，验证 budget escalation 和 artifact lineage。
- [ ] WEB-E2E-04 旧失败 run 诊断：打开历史 schema/preflight failed run，要求只解释失败不重跑；验证旧错误不会污染新任务。
- [ ] WEB-E2E-05 多 artifact 呈现：构造 report、paper-list、evidence-matrix、runtime-diagnostic 同时存在的 run，验证默认视图排序、Markdown/GFM 渲染和引用去重。
- [ ] WEB-E2E-06 刷新与多标签：任务运行中刷新页面、另开标签追问，验证 active run、queued guidance、conflict guard 和后台状态。

### 2026-05-12 Milestone：并行网页 E2E 与通用修复落地

本轮使用多个 sub agents 并行从网页端检查 `http://127.0.0.1:5173/` 的首页、设置、聊天输入、失败 run、结果区和运行过程展示；主流程未白屏，Runtime Health 可达，输入栏禁用/启用正确。根据 E2E 暴露的问题，已完成以下通用修复：

- [ ] 新增 runtime `TaskRunCard` / `FailureSignature` / `NoHardcodeReview` contract 与测试，支撑失败模式去重、protocol success 与 task success 分离、refs/下一步/归因层沉淀。
- [ ] 为 AgentServer direct-text fallback 增加 guard：taskFiles、JSON、trace、日志、代码和过程输出不再被轻易包装成最终报告。
- [ ] 修复 ExecutionUnit 失败态展示：`repair-needed`、`needs-human`、`failed-with-reason` 不再显示成 `Checked`，并优先展示 failureReason / recoverActions / nextStep。
- [ ] 修复失败结果首屏可读性：复杂 ContractValidationFailure 首屏展示紧凑用户态原因，完整 raw trace 仍保留在 audit details。
- [ ] 修复 report-viewer 对 AgentServer generation response / taskFiles 的处理：优先使用 `.md` report ref，不把后端 JSON、脚本或 stdout/stderr 当最终报告正文。
- [ ] 扩展 deep manifest H022 evidence 字段：session bundle、runtime events、task inputs/outputs、stdout/stderr、verification results 和最终可见结果 ref。
- [ ] 补齐网页端 favicon，避免本地 UI 启动后产生无意义资源 404。

本轮仍保留为后续通用任务的问题：

- [ ] 统一 ExecutionUnit chip/table/timeline 的状态枚举、计数和文案。
- [ ] 让“只看执行单元”过滤模式更纯粹，避免仍显示 notebook timeline / Inspector 的混合上下文。
- [ ] 改进历史 session 列表摘要，突出失败边界、可复用 refs 和下一步。
- [ ] 补充 partial/background continuation 的真实网页 fixture，验证长任务中途刷新和后台完成合并。

### 2026-05-12 Milestone：网页 E2E 二轮收敛

本轮继续开启多个 sub agents 使用 Computer Use 从网页端并行检查执行单元状态、历史恢复、partial/background、Runtime Health 和结果过滤。根据报告完成第二轮通用修复：

- [ ] 新增共享 `executionStatusPresentation`，统一 EU chip、工作过程、执行表的失败/修复/人工介入文案；`blocked` execution-unit 引用不再显示成生硬的 `BLOCKED`。
- [ ] 修复 timeline run 计数：只把真实 ExecutionUnit refs 计入 `units=`，不再把 skill plan、UI plan 或 package ref 混入计数。
- [ ] `只看执行单元` 模式现在只展示 ExecutionUnit 表、环境定义、stdout/stderr/code/output refs；普通 artifact preview、运行摘要、notebook timeline、raw audit 和 view state 被切到其他模式。
- [ ] 历史会话列表新增 compact run summary：run id 短码、失败边界/完成产物、关键 refs、恢复动作和恢复影响说明。
- [ ] Runtime Health 每个 item 增加可访问分组标签，避免读屏/AX tree 把 `Model Backend` 与下一项 `optional` 文案误连。
- [ ] 研究时间线增加 partial first result / background continuation demo，网页端可直接验证长任务先给 partial、后台再合并 revision 的展示入口。

本轮验证：

- [ ] Computer Use：刷新首页、进入工作台、切换只看执行单元、进入研究时间线，确认 UI 行为符合预期。
- [ ] `node --import tsx --test ...` 针对 ResultsRenderer、RunExecutionProcess、ArchiveDrawer、workspaceState、alignment display、scenario demo、runtime health。
- [ ] `npm run typecheck`
- [ ] `npm run smoke:runtime-contracts`
- [ ] `npm run smoke:deep-report`
- [ ] `npm run smoke:agentserver-direct-text`
- [ ] `npm run build`

### 2026-05-12 Milestone：Task outcome 投影与 Run-scoped E2E 收敛

本轮继续以多个 sub agents 并行检查 TODO-GEN、网页 E2E、partial/background、active run 范围和本地服务验证；主线程使用 Computer Use 打开 `http://127.0.0.1:5173/`，确认首页、Runtime Health、Scenario Library、Workspace Writer、AgentServer 和 Model Backend 均可见且 online。根据并行报告完成以下通用修复：

- [ ] task attempt ledger 自动生成 `TaskRunCard`，把 goal、round、refs、failure signatures、session bundle、protocol status、task outcome、next step 和 NoHardcodeReview 一起持久化到 attempt 记录。
- [ ] gateway `resultPresentation` 同步挂载 `taskOutcomeProjection`：区分 protocol success 与 task success，生成 user satisfaction proxy 和 next-step attribution，不按 prompt、场景、文件名或 backend 写特例。
- [ ] 扩展 provider-neutral transient failure 识别：`rate limited` 与已有 HTTP 429/5xx、quota、timeout、DNS/network 类失败统一归为 external transient。
- [ ] partial/background completion 只要带 artifact、verification、workEvidence、refs 或失败/取消信息，就合成可审计 ExecutionUnit，并在执行面板展示 verificationRef / verificationVerdict。
- [ ] 抽出 run-scoped ExecutionUnit 匹配，ResultsRenderer、RunExecutionProcess、失败审计、recover actions 和 raw audit 只展示 active run 相关执行单元，避免同 session 多 run 串上下文。
- [ ] 修复 browser smoke 的本地服务隔离：离线 Runtime Health 不再被主实例 `5174/config` fallback 污染，结构场景 fixture 会写入临时 workspace state，覆盖真实刷新恢复路径。

本轮验证：

- [ ] Computer Use：打开本地主页，确认 Runtime Health 中 Web UI、Workspace Writer、AgentServer、Model Backend、Scenario Library 均 online，页面无白屏。
- [ ] `node --import tsx --test src/runtime/task-attempt-history.test.ts packages/contracts/runtime/task-run-card.test.ts src/runtime/gateway/transient-external-failure.test.ts src/runtime/gateway/result-presentation-contract.test.ts`
- [ ] `node --import tsx tests/smoke/smoke-result-presentation-contract.ts`
- [ ] `node --import tsx --test src/ui/src/app/chat/sessionTransforms.test.ts src/ui/src/app/ResultsRenderer.test.ts src/ui/src/app/chat/RunExecutionProcess.test.ts src/ui/src/app/chat/ArchiveDrawer.test.tsx src/ui/src/app/results-renderer-execution-model.test.ts`
- [ ] `npm run typecheck`
- [ ] `npm run smoke:runtime-contracts`
- [ ] `npm run smoke:browser`
- [ ] `npm run build`

后续保留：

- [ ] 建立 FailureSignature run-level registry，跨 run 去重 schema drift、timeout、repair no-op 和 external transient。
- [ ] 将 TaskRunCard 暴露到 task-attempt API / 历史摘要 UI，替换当前部分自建 compact summary。
- [ ] 给 schema normalization 增加显式白名单与 audit note，区分结构漂移修复和语义/安全错误 fail-closed。

### 2026-05-12 Milestone：Failure Registry、TaskRunCard API 与 Schema Normalization Fail-closed

本轮继续开启多个 sub agents 并行推进三条后续保留工程线，并使用网页端 E2E 检查 `http://127.0.0.1:5173/`。首页无白屏，Runtime Health 可见 Web UI、Workspace Writer、AgentServer、Model Backend 和 Scenario Library 状态；执行单元过滤模式保持纯净，partial/background continuation demo 可见。根据并行报告完成以下通用修复：

- [ ] 新增 workspace 级 `FailureSignatureRegistry`：只追踪 `schema-drift`、`timeout`、`repair-no-op`、`external-transient` 四类通用失败，按 run-level dedupe key 跨 run 合并，同一 run 重写保持幂等。
- [ ] `appendTaskAttempt` 在生成 `TaskRunCard` 后同步记录 failure registry，registry 持久化到 `.sciforge/failure-signatures/registry.json`。
- [ ] task-attempt API 的 `list` / `get` 显式返回 `taskRunCards`，历史摘要 UI 优先消费 `TaskRunCard` / `taskOutcomeProjection.taskRunCard`，旧 raw compact summary 仅作为 fallback。
- [ ] payload validation 在宽松 normalization 前执行 schema error 识别，只允许显式白名单结构漂移修复；缺 required envelope、invalid UI ref、语义/安全敏感字段进入 `ContractValidationFailure` fail-closed。
- [ ] `ContractValidationFailure` 增加 `auditNotes`，schema normalization 的 applied/blocked 决策投影到 validation-repair audit diagnostics；成功白名单 normalization 写入 `payload-normalization-audit` log。

本轮验证：

- [ ] 网页 E2E：确认首页、Runtime Health、历史/结果区、只看执行单元、partial/background continuation demo；页面无 console error/pageerror/failed request。
- [ ] `node --import tsx --test packages/contracts/runtime/task-run-card.test.ts src/runtime/task-attempt-history.test.ts src/runtime/gateway/transient-external-failure.test.ts src/runtime/gateway/result-presentation-contract.test.ts`
- [ ] `node --import tsx --test src/ui/src/app/chat/ArchiveDrawer.test.tsx`
- [ ] `node --import tsx --test src/runtime/gateway/direct-answer-payload.test.ts src/runtime/gateway/result-presentation-contract.test.ts`
- [ ] `node --import tsx tests/smoke/smoke-contract-validation-failure.ts`
- [ ] `node --import tsx tests/smoke/smoke-validation-repair-audit-chain.ts`
- [ ] `npm run typecheck`
- [ ] `npm run smoke:runtime-contracts`
- [ ] `npm run smoke:result-presentation-contract`
- [ ] `npm run smoke:task-attempt-api`
- [ ] `npm run smoke:browser`


### 2026-05-12 Milestone：真实任务压测、Continuation 边界与失败投影收敛

本轮按 H022 要求继续用真实任务压测，并让多个 sub agents 并行检查本地网页与 runtime 边界。浏览器侧只允许 Codex 内置/隔离 headless 路线，不使用 Edge。真实压测覆盖 R-LIT-01、R-LIT-02、R-LIT-08、R-CODE-02、R-RUN-01、R-RUN-02、R-RUN-07、R-UI-04、R-DATA-05。

- [ ] R-LIT-02 低预算空结果恢复：窄 query 返回空结果后自动扩展 query，保留 empty boundary、生成中文 partial 报告、paper-list refs、verification ref 和 6 个 ExecutionUnit/log refs。
- [ ] 修复 continuation token 膨胀：UI transport 对 ref-backed artifact data 改为 refs+shape summary；context envelope 增加 evidence expansion policy；AgentServer policy 明确 stdoutRef/stderrRef 默认只作审计引用，除非用户明确要求原始日志或失败诊断。
- [ ] R-LIT-01 真实 arXiv/PDF 压测：AgentServer 生成真实任务并下载 4 个 PDF 后失败，保留 session bundle、task code、task input/output/log、verification 和 evidence bundle；失败不再被后续 direct-context 包装成满意答案。
- [ ] direct-context fast path 遇到 expected artifacts 缺失时返回 `repair-needed` runtime diagnostic，要求先 resume/repair 生成缺失 artifact，不再把上下文摘要当作 task success。
- [ ] R-CODE-02 / R-RUN-01 / R-RUN-02 / R-RUN-07 增加真实 failure-boundary smoke：schema drift 白名单、missing envelope fail-closed、repair no-op registry 聚合、failed run TaskRunCard/session bundle refs。
- [ ] 修复 `TaskRunCard` 投影在 `SkillAvailability.manifest` 缺失时崩溃，避免 malformed payload 压测进入 outcome projection 时 TypeError。
- [ ] 网页 E2E failed-run 投影收敛：failed run raw payload 中的真实 ExecutionUnit 会进入详情、timeline 和执行过程；timeline/artifact refs 按 active run scoped，不再串入上一轮结果。
- [ ] stale artifact preview 收敛：workspace file / preview descriptor / derivative 读取增加 in-flight 去重与 400/404 stale 负缓存；缺 path/dataRef 或 stale ref 时显示 fallback，不再反复污染 console。

Failure/Improvement Notes：

- R-LIT-01：外部多 PDF 下载会耗尽 120s runner budget，失败前未写 partial ToolPayload；通用入口是 generated-task runner early checkpoint、partial lineage materialization、repair scope guard。
- R-LIT-02 continuation：把上一轮完整 result/artifact/raw run 重新塞回 handoff 会触发 AgentServer 反复读 stdout/log 并命中 convergence guard；通用入口是 refs-first transport、context evidence expansion policy、log ref cite-only contract。
- R-CODE-02：malformed payload 在 `manifest` 缺失时打崩 outcome projection；通用入口是 runtime projection 对 optional skill metadata fail-soft。
- R-UI/R-DATA：缺失 artifact 文件应 stale-check 并降级展示，不应每次 render 都打 workspace/file 400。

后续保留：

- [ ] external multi-fetch generated task 必须早写 partial ToolPayload/checkpoint，并把已下载 PDF/metadata refs 投影到 failed run。
- [ ] repair agent 只能修改 generated task 或允许的 adjacent files；越界源码编辑应 reject 并生成 repair-boundary diagnostic。
- [ ] generated-task payload schema 可在昂贵执行前 preflight 常见 shape 错误，例如 object-shaped uiManifest、artifact 缺 id/type。
- [ ] 历史恢复应直接回到最近 active failed run/workbench，而不是只在 timeline 中可见。

本轮验证：

- [ ] `node --import tsx --test src/ui/src/api/sciforgeToolsClient.policy.test.ts src/runtime/gateway/context-envelope.test.ts src/runtime/gateway/direct-context-fast-path.test.ts`
- [ ] `node --import tsx tests/smoke/smoke-real-task-attempt-failure-boundaries.ts`
- [ ] `node --import tsx --test src/ui/src/api/workspaceClient.preview-cache.test.ts src/ui/src/app/results/WorkspaceObjectPreview.test.ts src/ui/src/api/workspaceClient.feedback.test.ts src/ui/src/app/results/previewDescriptor.test.ts src/ui/src/app/ResultsRenderer.test.ts src/ui/src/app/appShell/workspaceState.test.ts src/ui/src/app/chat/RunExecutionProcess.test.ts src/ui/src/app/results-renderer-execution-model.test.ts src/ui/src/app/results/viewPlanResolver.test.ts`
- [ ] `npm run typecheck`

### 2026-05-12 Milestone：Partial Checkpoint、Repair Boundary 与失败恢复直达

本轮继续开启多个 sub agents 并行推进 H022 暴露出的四条通用修复线，并用真实 smoke 压测 runtime、repair、payload preflight 和网页恢复路径。浏览器侧遵守“不占用 Edge”：`npm run smoke:browser` 使用隔离 Chrome for Testing；Codex in-app browser 本轮两次握手超时，已记录为工具链风险，未切到 Edge。

- [ ] generated workspace task 在失败/超时且未写 final output 时，会在 session bundle 中扫描新增 partial 文件并写入标准 `partial-checkpoint` ToolPayload；failed run、TaskRunCard 和 attempt ledger 都能投影 partial artifact refs。
- [ ] AgentServer repair 增加 repair-boundary 前后快照：repair 只能修改当前 generated task 与允许的 session bundle debug/handoff 文件；越界改 `PROJECT.md`、`src/`、`docs/`、`package*` 等源码/配置时拒绝 rerun，返回 `repair-boundary` diagnostic 并落盘审计。
- [ ] generated-task payload 增加执行前 preflight：常见 envelope 缺失、object-shaped `uiManifest`、artifact 缺 id/type 等 shape 错误会在昂贵下载/分析前进入 repair-needed，而不是先浪费 runner budget。
- [ ] pre-output / parse / external dependency failure payload 会携带 session-bundle partial evidence refs，`failedTaskPayload`、repair diagnostics 和 TaskRunCard 不再只剩 stdout/stderr。
- [ ] 历史恢复会优先定位最近 recoverable failed/repair-needed run，刷新后直接回到 workbench 的 active run，而不是只在 timeline 中留下失败痕迹。
- [ ] workspace state/session compaction 保留最近 repair-needed refs，避免 quota compact 后丢掉失败恢复入口。
- [ ] browser workflow fixture 增加 failed-run restore 压测，并移除 Edge executable candidate，避免与用户浏览器冲突。
- [ ] repair smoke 与 compact repair smoke 统一走 task-attempt API 读取 attempt history，覆盖 root `.sciforge/task-attempts` 与 session bundle `records/task-attempts` 两种存储路径。

Failure/Improvement Notes：

- Codex in-app browser 插件本轮连接 `http://127.0.0.1:23917/` 两次超时；网页端实际压测由隔离 Chrome for Testing 完成。后续需要把 in-app browser 连接稳定性纳入工具链 smoke，或给项目侧增加可观测的 browser-connection diagnostic。
- partial checkpoint 当前只扫描 session bundle 内新增/更新文件；如果任务把 partial 写到任意 workspace 路径，仍需要显式 ref 或后续扩大受控扫描范围。
- repair-boundary 采用 repair 前后快照比对；如果越界文件被改后又完全恢复，当前审计不会保留违规痕迹。
- `direct-answer-payload.ts`、`generated-task-runner-validation-lifecycle.ts` 进入 1000 行 watch list；当前低于 1500 行阈值，但后续应继续把 payload preflight、diagnostic projection、repair audit sink 拆到语义模块。

本轮验证：

- [ ] `node --import tsx tests/smoke/smoke-workspace-server-agentserver-repair.ts`
- [ ] `node --import tsx tests/smoke/smoke-agentserver-compact-repair.ts`
- [ ] `node --import tsx tests/smoke/smoke-agentserver-repair.ts`
- [ ] `node --import tsx tests/smoke/smoke-generated-task-failed-payload-repair.ts`
- [ ] `node --import tsx tests/smoke/smoke-repair-boundary-guard.ts`
- [ ] `node --import tsx tests/smoke/smoke-generated-task-payload-preflight.ts`
- [ ] `node --import tsx tests/smoke/smoke-runtime-gateway-modules.ts`
- [ ] `node --import tsx tests/smoke/smoke-contract-validation-failure.ts`
- [ ] `node --import tsx tests/smoke/smoke-validation-repair-audit-chain.ts`
- [ ] `node --import tsx --test src/runtime/gateway/generated-task-runner-execution-lifecycle.test.ts src/runtime/gateway/generated-task-runner-output-lifecycle.test.ts src/runtime/gateway/direct-answer-payload.test.ts src/ui/src/app/appShell/workspaceState.test.ts src/ui/src/app/chat/sessionTransforms.test.ts src/ui/src/sessionStore.test.ts`
- [ ] `npm run smoke:task-attempt-api`
- [ ] `npm run smoke:browser`
- [ ] `npm run smoke:long-file-budget`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `git diff --check`



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
