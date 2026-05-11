# SciForge - PROJECT.md

最后更新：2026-05-12

## 当前目标

优化 SciForge 的多轮聊天用户体验，让复杂长对话在真实使用场景中保持 **稳定、流畅、正确、token 高效、响应更快**。

稳定：重启、刷新、恢复历史、中断继续、编辑历史消息、后台任务回访等情况下，系统都能恢复清晰的任务状态，不丢失关键上下文，不重复执行危险 side effect。

流畅：用户不需要长时间等待黑盒执行；系统必须尽早产出可读 partial、明确当前进度、说明仍在后台继续的部分，并支持随时继续、暂停、恢复或改变目标。

正确：多轮追问必须引用正确的 artifact、run、execution unit 和历史分支；失败、过期、不确定、证据不足时要明确说明，而不是假装完成或只展示 raw trace。

Token 高效：每轮只携带当前任务真正需要的 state digest、refs、摘要和约束，避免重复塞入完整历史、完整 trace、完整文件或已稳定 artifact 内容；需要展开时按需读取。

响应更快：默认先走最小可行路径，优先产出 first readable result；长任务、深验证、补证据、审计和报告扩展可以后台继续，不阻塞用户看到当前可用结果。

本阶段重点不是扩展新能力，也不是为某个固定案例打补丁，而是建立通用的多轮对话状态、恢复、历史编辑、分支、token budget、回答速度、benchmark 和指标体系，让任意场景下的 agent 行为都更可预测、更可审计、更贴近用户期望。


## 开工前必读

任何 agent 在执行本项目任务前，必须先读本文件和与任务相关的设计文档，避免凭局部代码印象破坏系统边界。

- [`docs/Architecture.md`](docs/Architecture.md)：SciForge 总体架构、Backend-first / Contract-enforced / Capability-driven / Harness-governed 方向、`src` 与 `packages` 边界。
- [`docs/AgentHarnessStandard.md`](docs/AgentHarnessStandard.md)：harness runtime、profile、stage hook、contract、trace、merge 规则和行为治理入口。
- [`docs/Usage.md`](docs/Usage.md)：网页端使用流程、多 backend、论文复现/自我进化/Computer Use 操作路径。
- [`docs/Extending.md`](docs/Extending.md)：新增 capability、artifact、view、scenario、package 时的扩展方式。
- [`README.md`](README.md)：产品定位、快速启动、核心概念和当前能力范围。

## 不变原则

- 不为具体场景、prompt、论文、artifact 名称或任务类型写特例；所有修改必须通用、适应任何场景
- UI 只消费 runtime contract、artifact schema、view manifest、presentation contract 和结构化事件。
- Prompt builder 不是策略真相源；策略必须来自 harness contract、capability manifest 或可信 runtime policy。
- Safety policy 继续 fail closed；latency、验证、上下文和 repair 深度必须可按层级收缩。
- 复杂任务要可审计，但审计路径不能阻塞用户看到第一份可读结果。
- 任何长任务都必须产出 structured partial/failure，而不是等总超时后只显示 runtime trace。
- 不用“无限追加上下文”换取正确性；多轮稳定性必须依赖 state digest、refs、cache、checkpoint 和按需展开。

## 任务板


### H017 Complex Multi-turn Conversation Stress Suite

职责：建立一套复杂多轮对话压测任务，用来暴露 agent 在长任务、追问、失败恢复、上下文复用、后台继续和速度控制上的通用问题。压测不能围绕某个固定案例打补丁，fixture 可以来自文献调研、代码修复、runtime 诊断、artifact 分析、数据分析等场景，但评价目标必须是跨场景的行为质量。

任务类型：

- 深度调研链路：多轮提出主题、限定时间范围、要求检索/下载/阅读全文/总结/补引用/生成报告。
- 失败恢复链路：第一次 run 超时或失败后，用户要求诊断、恢复、复用已有证据、继续未完成部分。
- 长报告迭代链路：先产出 partial，再根据用户反馈扩展结构、增加证据、重排章节、修正引用。
- 多 artifact 链路：同一会话中生成、打开、修改、比较多个 artifact，后续追问必须引用正确对象。
- 跨能力链路：检索、文件读写、代码执行、runtime state、artifact refs、verifier、后台 continuation 混合出现。
- 约束变化链路：用户中途改变范围、格式、深度、预算、截止时间或隐私要求。
- 多失败模式链路：网络失败、下载失败、schema failure、empty result、timeout、backend unavailable、verification failure 连续出现。
- 速度敏感链路：用户明确要求“先给结论/不要等完整结果/继续后台跑”，系统必须快速给可读 partial。
- 会话生命周期链路：重启、恢复历史、中断继续、编辑历史消息、分支对话、跨设备/跨 session 继续。
- 历史一致性链路：同一历史节点支持 revert 和 continue 两种模式，必须明确状态来源、废弃范围和 artifact lineage。

暂缓范围：

- [ ] Computer Use / 视觉 GUI grounding 相关压测暂缓，等 grounding 模型部署后再恢复。
- [ ] 当前阶段不要求测试视觉定位、桌面点击、跨页面视觉操作、屏幕元素 grounding 或纯视觉 GUI 自动化。

范围保留：

- [x] 浏览器刷新、关闭标签、恢复历史会话等非视觉生命周期任务继续保留，因为它们测试持久化状态和会话恢复，不依赖视觉 grounding。

分级压测任务：

5 轮任务：验证 agent 是否能在短多轮里保持目标、复用上下文、快速给结果。

- [x] T5-01 快速调研到报告：用户给主题，agent 给候选资料；用户要求筛选 Top-K；用户要求补证据；用户要求 markdown 报告；用户要求列未完成风险。
- [x] T5-02 失败后继续：第 1 轮启动长任务，第 2 轮注入 timeout，第 3 轮要求诊断，第 4 轮要求复用已完成部分继续，第 5 轮要求输出 final + recovery notes。
- [x] T5-03 约束逐步收紧：先宽泛回答，再要求只看最近时间窗口，再要求只保留高可信来源，再要求压缩成表格，再要求生成可审计引用列表。
- [x] T5-04 多 artifact 追问：生成 artifact A，再生成 artifact B，再比较 A/B，再修改 B，再追问 A 中原始结论，测试引用不漂移。
- [x] T5-05 代码任务追问：定位问题，给 patch 计划，执行修改，运行测试失败，恢复并解释下一步。
- [x] T5-06 数据分析追问：读取表格摘要，生成统计结果，用户要求换分组，用户要求解释异常值，用户要求导出结论。
- [x] T5-07 Runtime 诊断追问：读取 run 状态，定位失败阶段，用户要求查看 execution summary，用户要求导出诊断，用户要求提出通用修复任务。
- [x] T5-08 速度优先：用户要求先给答案，agent 给 partial；用户要求继续后台；后台结果回访；用户要求合并；用户要求列证据缺口。
- [x] T5-09 隐私约束切换：普通任务开始，中途用户要求不上传敏感内容，agent 重新规划上下文和工具，最后解释哪些步骤被跳过。
- [x] T5-10 空结果恢复：检索返回 empty，agent 给替代 query，用户缩小范围，agent 复用新 refs，最后输出 uncertainty-aware 结果。

10 轮任务：验证 agent 是否能承受中等长度任务状态、范围变化、重复失败和多 artifact 演化。

- [x] T10-01 深度文献调研：主题定义、检索、去重、下载、阅读全文摘要、证据矩阵、冲突结论、引用修正、报告重写、最终审计摘要。
- [x] T10-02 从失败 run 到可交付：启动、timeout、诊断、恢复计划、继续、schema failure、repair、partial 报告、补验证、最终报告。
- [x] T10-03 代码修复迭代：读需求、定位模块、实现、测试失败、缩小范围、二次修复、补测试、解释 diff、处理用户变更、最终总结。
- [x] T10-04 多数据源分析：导入 A、导入 B、合并、发现字段冲突、用户给映射、重算、可视化、异常解释、导出 markdown、列复现步骤。
- [x] T10-05 Runtime + artifact 混合：读取 task state、查看 execution unit、导出 bundle、解析失败、提出通用代码任务、用户改优先级、生成 TODO、复查 artifact refs、最终验收。
- [x] T10-06 长报告编辑：生成提纲、写初稿、用户改受众、补技术细节、补风险、压缩篇幅、加表格、改标题、生成 changelog、最终版本。
- [x] T10-07 多 backend 对比：同任务在 backend A 失败，切 backend B，复用 state，比较输出，修正引用，保留 provenance，最终推荐策略。
- [x] T10-08 预算耗尽降级：深任务开始，工具预算接近耗尽，agent 产出 partial，用户允许继续但不下载全文，agent 改用 metadata，最后列升级路径。
- [x] T10-09 用户多次改范围：宽主题、缩小领域、排除来源、增加时间范围、改输出格式、要求中英文、要求更短、要求补证据、要求删除低可信、最终审计。
- [x] T10-10 复杂 recovery：网络失败、下载失败、验证失败、artifact 缺失连续出现，agent 每次都要保存 checkpoint 并避免重跑已完成步骤。
- [x] T10-11 记忆复用：第一轮建立索引，后续多轮反复追问同一对象的不同角度，要求 agent 明确复用哪些 refs。
- [x] T10-12 互斥约束：用户同时要求快、全、严格验证、低成本，agent 必须解释 tradeoff 并按优先级执行。

20 轮任务：验证 agent 在高强度长会话中是否能保持任务图、避免上下文腐烂、持续产出 partial、稳定恢复失败。

- [x] T20-01 端到端研究项目：选题、检索、筛选、下载、阅读、证据抽取、冲突处理、方法比较、图表生成、报告初稿、多轮修订、最终审计包。
- [x] T20-02 连续失败韧性：在 20 轮中依次注入 timeout、empty result、tool stderr、backend delay、schema failure、artifact missing、verification failure，要求每次都有可执行 recovery。
- [x] T20-03 大型代码改造对话：需求澄清、架构读取、拆任务、并行计划、实现、测试、失败、回滚计划、二次实现、文档更新、性能检查、最终总结。
- [x] T20-04 多 artifact 生命周期：创建 5 个 artifact，跨 20 轮修改、比较、引用、废弃、恢复、合并，测试 artifact identity 和 provenance 稳定性。
- [x] T20-05 长数据分析项目：多文件载入、清洗、特征定义、统计、可视化、异常分析、用户多次改口径、导出报告、复现实验记录。
- [x] T20-06 Runtime 长流程：跨多个 run/artifact 检查状态、导出诊断、失败分析、重试规划、后台任务检查、结果回访，要求 presentation state 和 runtime state 对齐。
- [x] T20-07 背景任务回访：前 5 轮启动多个 background continuation，中间 10 轮处理其他任务，最后 5 轮回收后台结果并合并 revision。
- [x] T20-08 多目标冲突：用户交替提出调研、代码、数据、runtime/artifact 四类目标，agent 必须维护任务队列，不能把不同目标互相污染。
- [x] T20-09 超长报告协作：从 outline 到 3 次大改、5 次局部修订、引用修复、证据缺口处理、最终生成 markdown 和变更摘要。
- [x] T20-10 上下文压缩抗性：中途模拟 compaction，只保留 state digest 和 refs，后续仍要恢复任务图、artifact refs、未完成队列。
- [x] T20-11 高并发 sidecar：主任务推进时并行检索、验证、预检、artifact scan，测试 cancellation、merge、early stop 和 first result SLA。
- [x] T20-12 用户反馈驱动修复：用户多次指出结果不对、引用错、格式错、速度慢，agent 必须把反馈转成通用 task/todo，而不是临时道歉重跑。
- [x] T20-13 跨 session 继续：保存 checkpoint，模拟新会话恢复，继续未完成任务并解释复用状态。
- [x] T20-14 质量与速度拉扯：每隔几轮用户切换“快一点”和“更严谨”，agent 动态调整 verification layers、tool budget 和 presentation。
- [x] T20-15 审计包生成：20 轮结束后自动生成 task graph、decision trace、artifact refs、失败恢复记录、重复工作统计、最终报告。

真实会话生命周期任务：覆盖用户在真实产品里会发生的重启、恢复、中断、编辑、分支、回滚和继续。

- [x] TS-01 服务重启后继续当前对话：任务进行到 partial 后关闭并重启 UI/runtime，恢复同一会话，agent 必须识别 last stable checkpoint、pending work 和可继续动作。
- [x] TS-02 服务重启后后台任务回访：重启前启动 background continuation，重启后用户询问进度，系统必须恢复 background job 状态或给出可审计的丢失/重建说明。
- [x] TS-03 浏览器刷新后继续：前端刷新导致内存状态丢失，但 workspace/session store 仍在，agent 必须从持久化 state 恢复，而不是重新开始。
- [x] TS-04 关闭浏览器标签后继续：用户重新打开同一 workspace，选择历史会话，继续上次未完成任务，必须恢复 artifact refs 和 execution unit refs。
- [x] TS-05 恢复历史会话继续：用户打开昨天/上周的历史任务，要求“接着做”，agent 必须先判断状态是否过期、依赖是否变化、哪些证据可复用。
- [x] TS-06 恢复历史失败任务：历史任务以 failed 结束，用户要求继续，agent 必须生成 recovery plan，区分可复用 output、需要重跑步骤和已失效步骤。
- [x] TS-07 恢复历史成功任务追加追问：历史任务已 complete，用户追加新问题，agent 必须基于旧 artifact 回答，同时不把新问题错误归入旧 completion。
- [x] TS-08 恢复被取消任务：用户手动 cancel 后回来继续，agent 必须确认 cancel boundary，不能悄悄恢复已取消的 side effect。
- [x] TS-09 中断生成后继续：assistant 正在流式输出时被 stop，用户点继续，agent 必须从已生成内容和 run state 续写，避免重复前文或丢失引用。
- [x] TS-10 中断工具调用后继续：工具仍在运行或状态未知时用户中断，继续时必须检查实际工具结果、避免重复 side effect。
- [x] TS-11 中断 repair 后继续：repair 执行到一半被暂停，继续时必须识别 last repair attempt、patch state、test state 和是否允许重试。
- [x] TS-12 编辑最近用户消息并 revert：用户编辑最后一条需求并选择 revert 模式，系统必须废弃编辑点之后的 assistant/run/artifact 分支，基于编辑后的历史重新执行。
- [x] TS-13 编辑最近用户消息并 continue：用户编辑最后一条需求并选择 continue 模式，系统必须保留已有结果作为上下文，同时明确哪些结论受新需求影响。
- [x] TS-14 编辑较早用户消息并 revert：用户修改第 N 轮原始目标，系统必须回滚该节点之后的派生 task state、artifact refs 和 background jobs。
- [x] TS-15 编辑较早用户消息并 continue：用户修改第 N 轮原始目标但要求继续当前分支，系统必须创建 branch state，保留旧结果并标注与新目标的冲突。
- [x] TS-16 编辑 assistant 历史回答后继续：用户修正 assistant 输出中的事实/格式/引用，agent 必须把它当作用户反馈约束，而不是伪造历史 run 真的如此发生。
- [x] TS-17 同一历史点多分支继续：从同一 turn fork 出 A/B 两个方案，后续必须隔离 task state、artifact refs、后台任务和 verification 结果。
- [x] TS-18 合并两个历史分支：用户要求合并 A/B 分支结论，agent 必须检测冲突、重复证据和 artifact lineage，生成 merge summary。
- [x] TS-19 跨设备继续：模拟另一个客户端打开同一会话继续，agent 必须处理本地 UI state 缺失，只依赖持久化 workspace state。
- [x] TS-20 多标签并发继续：两个标签同时对同一会话发消息，系统必须有 conflict detection 或 serial ordering，不能交叉污染。
- [x] TS-21 版本升级后继续：代码或 capability registry 更新后恢复旧会话，agent 必须检测 capability version drift，并决定复用、迁移或重跑。
- [x] TS-22 配置变化后继续：用户更换 backend/model/API key/workspace path 后恢复会话，agent 必须解释哪些状态仍可用，哪些需要重新验证。
- [x] TS-23 权限变化后继续：恢复历史任务时权限更严格，agent 必须降级能力、保护敏感 refs，并说明被跳过的步骤。
- [x] TS-24 文件系统变化后继续：历史 artifact 或输入文件被移动/删除/修改，agent 必须 stale-check，避免引用不存在或过期文件。
- [x] TS-25 历史压缩后继续：只保留 summary/state digest/refs，不保留完整消息，agent 必须从摘要恢复任务图并列出不确定项。
- [x] TS-26 长时间离线后继续：历史会话过期很久，外部资料可能变化，agent 必须标注 stale risk，并询问或自动执行最小刷新。
- [x] TS-27 恢复后用户改目标：继续历史任务后用户立即改变目标，agent 必须把“恢复”和“范围变更”同时纳入规划。
- [x] TS-28 恢复后要求不要继续：用户打开历史失败任务但只想看诊断，不想重跑，agent 必须只 materialize explanation，不触发 side effect。
- [x] TS-29 恢复后要求导出审计：用户不继续执行，只要求导出历史 task graph、artifact refs、失败原因和可复现命令。
- [x] TS-30 恢复未知状态任务：session/run/artifact 三者状态不一致，agent 必须进入 needs-human 或 safe recovery，不得猜测成功。

Todo：

- [x] 定义 `ComplexMultiTurnFixture` contract：turns、expected state、allowed tools、latency budget、memory expectations、artifact expectations、failure injections、success criteria。
- [x] 建立不少于 67 个跨场景 fixture：10 个 5 轮、12 个 10 轮、15 个 20 轮、30 个真实会话生命周期任务，并覆盖 success、partial、failure、recovery、background revision、revert、continue、branch、merge。
- [x] 为每轮标注 expected `latencyTier`、expected escalation、max first result time、max repeated exploration、required presentation status。
- [x] 增加 failure injection 机制：timeout、empty search result、download unavailable、schema validation failure、backend delay、tool stderr。
- [x] 为多轮上下文复用增加断言：不得重复下载/读取/验证已稳定 refs，除非用户要求刷新或输入已失效。
- [x] 为引用和 artifact 绑定增加断言：后续追问必须解析到正确 artifact/run/execution unit，不能漂移到最近但无关对象。
- [x] 每个 10 轮任务至少包含 2 次用户范围变化、1 次失败注入、1 次 artifact 引用追问、1 次 recovery 或 background continuation。
- [x] 每个 20 轮任务至少包含 4 次范围变化、3 次失败注入、2 次后台继续、2 次 artifact 身份校验、1 次 context compaction/resume。
- [x] 每个真实会话生命周期任务必须标注 resume source、state authority、side effect policy、history mutation mode、artifact lineage expectation。
- [x] 为编辑历史消息定义两类 fixture：`revert` 废弃编辑点之后派生状态，`continue` 保留派生状态但标注冲突和不确定性。
- [x] 输出每个 fixture 的 replay trace、presentation snapshots、latency summary 和 behavior notes，便于做横向比较。
- [x] 把 suite 做成可单独运行的 smoke/benchmark，不进入默认 fast verify，避免日常开发被长任务拖慢。

验收：

- [x] 压测能稳定复现“长任务失败后只显示 trace/没有可读恢复路径”等通用问题。
- [x] 每个问题都能映射到 harness、memory、presentation、progress、verification 或 repair 的通用改造点。
- [x] fixture 文案可替换成任意领域，不依赖 arXiv、论文、具体 backend 或固定 artifact 名称。
- [x] 5 轮任务用于日常 smoke，10 轮任务用于 PR 前 benchmark，20 轮任务用于高强度 nightly/stress benchmark。
- [x] 20 轮任务结束时必须能生成完整 task state summary，包含已完成、未完成、失败、复用、后台、artifact refs 和推荐下一步。
- [x] 重启、刷新、恢复历史、中断继续、编辑历史消息、分支和合并都能保持可解释状态边界，不产生静默重复 side effect。
- [x] revert 和 continue 两种历史编辑模式行为可预测、可审计，并且 UI 能明确展示当前所处历史分支。

### H018 Multi-turn State, Recovery, and Continuation Policy

职责：把复杂多轮任务中的状态推进、失败恢复和继续执行变成通用策略，避免 agent 每轮重新猜“已经完成什么、还能继续什么、用户现在要什么”。

Todo：

- [x] 定义 `ConversationTaskState`：user goal、current subgoals、completed evidence、pending work、blocked work、last failure、recoverable actions、background jobs。
- [x] 定义 `ConversationResumeState`：session id、thread id、last durable turn、last stable checkpoint、pending runs、background jobs、artifact lineage、client state freshness。
- [x] 定义 `HistoryMutationPolicy`：支持 `revert`、`continue`、`branch`、`merge` 四类历史变更模式，并声明各自的状态继承和废弃规则。
- [x] 每轮开始前由 harness 生成 state digest，区分“用户新需求”“对上轮结果追问”“失败恢复”“后台结果回访”“范围变更”。
- [x] 每次恢复历史前运行 resume preflight：检查 workspace path、session store、artifact refs、execution units、capability versions、file hashes、permissions。
- [x] 给失败结果生成通用 `RecoveryPlan`：可复用证据、需要重跑的步骤、可跳过步骤、用户可选操作、推荐下一步。
- [x] 对超时任务保存 checkpoint：已完成 artifact、已下载 refs、已读取文档、已验证 claim、未完成队列、失败原因。
- [x] 支持 continuation prompt 只携带 state digest 和 refs，不重新塞入完整历史、完整 trace 或完整文件内容。
- [x] 增加 stale/invalidated state 检测：用户改范围、文件变化、artifact 删除、capability 版本变化时重新规划。
- [x] 编辑历史消息时必须生成 history branch record：编辑前后消息、受影响 turns、废弃 runs、保留 refs、冲突 refs、推荐继续策略。
- [x] 中断后继续时必须区分 interrupted output、interrupted tool、interrupted repair、interrupted background job，分别采用不同恢复策略。
- [x] 多客户端/多标签继续时必须有 ordering/conflict guard：同一会话并发写入要串行化、分支化或进入 needs-human。
- [x] UI presentation 中优先展示“已完成/可继续/需要用户选择”，raw diagnostics 默认折叠。
- [x] 增加多轮 recovery smoke：失败后第二轮必须能继续未完成部分，而不是新开一个无关 run。
- [x] 增加 lifecycle smoke：重启继续、历史恢复、中断继续、编辑历史 revert、编辑历史 continue、分支合并分别有独立 fixture。

验收：

- [x] 失败、超时、取消、后台化之后，用户能看到可执行的下一步，而不是只有“任务未完成”。
- [x] 多轮任务不会把同一目标重复拆解、重复探索、重复下载或重复验证。
- [x] continuation 可以跨 backend 和 profile 保持稳定的任务状态语义。
- [x] 重启/刷新/跨 session 恢复后，agent 能说明状态来源和不确定项，而不是假装内存上下文仍完整。
- [x] 编辑历史消息不会静默污染已有 artifact；revert 会废弃派生状态，continue 会保留但标注冲突。

### H019 General Agent Behavior Optimization

职责：针对复杂多轮压测暴露的问题做通用 agent 行为优化，重点提升“先给可读结果、少做重复工作、按收益升级、失败可恢复、后台不中断”的默认行为。

Todo：

- [x] 增强 intent classifier：识别长任务、报告任务、调研任务、恢复任务、追问任务、范围变更任务、速度优先任务。
- [x] 增强 escalation stop rule：当已有 partial 足够回答当前轮时停止扩展，把剩余工作转为可选继续项。
- [x] 增强 evidence sufficiency rule：按用户要求的结论粒度判断证据是否足够，而不是默认追求完整搜集。
- [x] 增强 repeated-work guard：同 query、同 URL/ref、同 artifact hash、同 failure signature、同 verifier result 在同会话中默认复用。
- [x] 增强 tool batching/parallelism：独立检索、下载 metadata、artifact scan、引用检查可并行，关键路径优先返回。
- [x] 增强 progress wording：长任务在 deadline 前必须说明当前阶段、已完成内容、下一步和是否会后台继续。
- [x] 增强 partial report format：复杂任务先输出结构化摘要、证据表、缺口和后续计划，再逐步补全全文报告。
- [x] 增强 budget downgrade：预算接近耗尽时自动降级验证/下载/重试深度，并保留用户可手动升级路径。
- [x] 增强 backend handoff directive：prompt 只渲染通用策略和当前 state，不写具体案例硬编码规则。

验收：

- [x] 同一套优化能改善文献调研、代码任务、runtime 诊断任务、artifact 任务和数据任务的多轮表现。
- [x] 首个可读结果延迟下降，重复工具调用下降，失败后可继续率上升。
- [x] 行为改变可以从 harness trace 和 benchmark summary 中解释。

### H020 Complex Dialogue Speed and Quality Metrics

职责：为复杂多轮任务建立可量化指标，防止优化只停留在主观体验；速度优化不能牺牲必要证据、引用正确性和恢复能力。

指标：

- First readable result latency：第一份 answer/partial/failure presentation 的时间。
- Turn completion latency：每轮达到可用状态的时间。
- Redundant work rate：重复检索、重复下载、重复读取、重复验证比例。
- Recovery success rate：失败后一轮能否继续并复用已有状态。
- Artifact reference accuracy：后续追问是否命中正确 artifact/run/ref。
- Evidence sufficiency：关键结论是否有足够证据或明确 uncertainty。
- Background revision quality：后台补全是否生成 revision/provenance，而不是覆盖旧结果。
- User-visible dead-end rate：用户是否看到只有 raw trace、empty result 或不可执行失败。
- Resume correctness：重启、刷新、恢复历史后是否命中正确 checkpoint、pending work 和 artifact refs。
- History mutation correctness：编辑历史消息后 revert/continue/branch/merge 的状态边界是否正确。
- Side effect duplication rate：恢复或中断继续后是否重复执行下载、写文件、提交、外部调用等 side effect。
- State authority clarity：用户是否能看懂当前状态来自内存、持久化 checkpoint、历史摘要、artifact refs 还是重新探测。

Todo：

- [x] 定义 `ComplexDialogueBenchmarkReport` schema，输出 latency、cost、tool count、reuse count、failure mode、quality score。
- [x] 增加每轮 event timeline 聚合，把 first result、partial、background start、revision、failure、recovery 串成可读报告。
- [x] 对每个 fixture 建立 baseline 和 optimized 对比，记录改善比例和退化项。
- [x] 设置性能门槛：first readable result、重复工作率、dead-end rate、recovery success rate 至少满足最低线。
- [x] 增加 lifecycle metrics：resume hit rate、stale detection rate、history branch correctness、duplicate side effect prevention、state explanation completeness。
- [x] 将 benchmark 结果写入 artifacts/debug report，便于 UI 展示和人工审查。
- [x] 增加 regression guard：通用策略改动不得让简单任务变慢，不得让 deep 任务丢失审计证据。

验收：

- [x] 每次复杂多轮优化都能用数据说明速度、质量和恢复能力变化。
- [x] benchmark 能指出退化来自 context、capability、tool、presentation、repair 还是 backend handoff。
- [x] 指标适用于任意 scenario，不绑定具体 prompt 或固定任务文案。

## 当前里程碑

- [x] M13：建立复杂多轮对话压测任务板、fixture contract 和 benchmark 指标。
- [x] M14：把 M13 contract 接入 harness runtime trace、UI presentation 和 contract replay runner。
  - [x] Trace 接入：将 `tests/fixtures/complex-multiturn` 的 required events/metrics 映射到 agent harness runtime trace，并保留 contract/trace refs、state digest、first readable result、resume preflight 和 recovery 边界。
  - [x] Presentation 接入：把 fixture 的 `presentationSnapshots` 转成用户可见结果约束，默认展开 answer/evidence/artifacts，折叠 raw trace/diagnostics，并覆盖 partial、failure、background revision、history mutation 状态。
  - [x] Replay runner 接入：提供 contract replay runner 聚合入口，能按 fixture tier/domain/lifecycle 场景重放 harness trace、验证 artifact/run/ref 命中和 side effect 去重。
  - [x] 指标聚合：将 replay/runtime/presentation 输出汇总到 `ComplexDialogueBenchmarkReport`，覆盖 first readable latency、turn completion、redundant work、recovery、artifact reference accuracy、resume/history/side-effect 指标。
  - [x] Smoke 审计：维护 M14 integration smoke，校验 harness projection、presentation、replay runner 模块可 import 且暴露可调用聚合入口或 contract 常量。
  - [x] 验收证据：主线程验收前运行独立 M14 smoke、typecheck，以及 E/F/G 各自 smoke；确认 checklist 后再标完成。
- [x] M15：把复杂多轮 fixture replay 输出为可审计 benchmark/debug artifact。
  - [x] Export contract：新增 `ComplexMultiturnBenchmarkExport`，聚合 67 个 fixture 的 replay summary、contract summary、fixture summaries 和 `ComplexDialogueBenchmarkReport`。
  - [x] CLI 接入：新增 `npm run bench:complex-multiturn`，默认写入 `.sciforge/reports/complex-multiturn-benchmark-export.json`，并支持 tier 过滤和稳定时间戳。
  - [x] Smoke 审计：新增 `npm run smoke:complex-multiturn-benchmark-export`，校验 67 fixtures、620 turns、recovery/lifecycle/side-effect 指标和 aggregate gates。
  - [x] UI 接入防护：gateway 在 payload 已携带合法 `resultPresentation` 时保留原 contract，避免 complex multiturn presentation 被通用 fallback 覆盖。
  - [x] Verify 边界：M15 benchmark export 保持为显式脚本，不加入默认 `verify:fast`，避免日常开发被完整复杂多轮 benchmark 拖慢。
- [x] M16：把真实形态 runtime/session events 接入复杂多轮 replay 审计。
  - [x] Runtime replay contract：新增 `ComplexMultiturnRuntimeReplayReport`，从 `WorkspaceRuntimeEvent[]` 生成 `ComplexDialogueBenchmarkReport`、coverage 和 recovery/resume/history/side-effect 指标。
  - [x] CLI 接入：新增 `npm run bench:complex-multiturn-runtime-replay`，读取 runtime event JSON 或 `{ session: { runtimeEvents } }`，输出 `.sciforge/reports/complex-multiturn-runtime-replay.json`。
  - [x] Event recorder：新增 runtime event recorder helper，将 callback 事件规范化为 session-scoped NDJSON，并补稳定 event id、timestamp、session/run metadata，供 replay CLI 读取。
  - [x] Smoke 审计：新增 `npm run smoke:complex-multiturn-runtime-replay` 并纳入 `smoke:complex-multiturn`，覆盖 artifact/run/execution-unit refs、resume preflight、history branch record、recovery plan 和 side-effect guard。
  - [x] 边界声明：M16 只验证非视觉 runtime/session event replay，不恢复 Computer Use / 视觉 GUI grounding 压测。

## 已清理内容

旧的科研复现、论文、raw-data、UI 缺口等任务板已从当前 PROJECT backlog 中移除。相关历史仍保留在 git 历史、docs、fixtures、smoke 和已提交代码中；当前 PROJECT 只追踪下一阶段的通用 harness 分层与提速工作。
