# SciForge - PROJECT.md

最后更新：2026-05-13

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

- 所有修改必须通用、可泛化到任何场景，不能在代码里面硬编码和为当前案例打补丁
- Agent harness 是项目级策略资产，不允许散落在 UI、gateway、prompt builder、conversation policy 或 repair 分支里；探索预算、上下文选择、skill hints、tool-use policy、验证强度和用户可见进度必须通过可版本化 harness policy 与阶段 hook 注入。
- Agent 行为治理的唯一入口是 packages/agent-harness profile registry 与声明式 stage hook；新增治理入口必须先进入 harness contract/trace，再由 gateway、prompt、UI、repair loop 消费，不能以 TODO 名义保留第二套散落规则。
- 算法相关的代码优先用Python实现，方便人类用户优化、检查算法
- 代码路径保持唯一真相源：发现冗余链路时删除、合并或降级旧链路，避免长期并行实现。
- 代码膨胀必须自动触发治理：源码文件超过 1000 行进入 watch list；超过 1500 行必须在 PROJECT.md 有模块化拆分任务、语义 part 计划或生成文件豁免；超过 2000 行优先拆分；超过 3000 行视为维护风险。后续开发若让文件越过阈值，应优先抽模块、删除冗余逻辑或补拆分 TODO，而不是继续堆主文件。
- 长文件拆分必须按职责命名，不能机械切成 part1/part2；如果暂时不能完全解耦，也要拆成有语义的文件，例如 *-event-normalizer、*-runner、*-diagnostics、*-state-machine，并保持主入口只做流程编排。
- 推进项目的时候尽可能多开sub agents，并行加速推进
- Prompt builder 不是策略真相源；策略必须来自 harness contract、capability manifest 或可信 runtime policy。
- Safety policy 继续 fail closed；latency、验证、上下文和 repair 深度必须可按层级收缩。
- 复杂任务要可审计，但审计路径不能阻塞用户看到第一份可读结果。
- 任何长任务都必须产出 structured partial/failure，而不是等总超时后只显示 runtime trace。
- 不用“无限追加上下文”换取正确性；多轮稳定性必须依赖 state digest、refs、cache、checkpoint 和按需展开。

## 任务板


### 2026-05-12 Milestone：并行网页 E2E 与通用修复落地

本轮使用多个 sub agents 并行从网页端检查 `http://127.0.0.1:5173/` 的首页、设置、聊天输入、失败 run、结果区和运行过程展示；主流程未白屏，Runtime Health 可达，输入栏禁用/启用正确。根据 E2E 暴露的问题，已完成以下通用修复：

- [x] 新增 runtime `TaskRunCard` / `FailureSignature` / `NoHardcodeReview` contract 与测试，支撑失败模式去重、protocol success 与 task success 分离、refs/下一步/归因层沉淀。
- [x] 为 AgentServer direct-text fallback 增加 guard：taskFiles、JSON、trace、日志、代码和过程输出不再被轻易包装成最终报告。
- [x] 修复 ExecutionUnit 失败态展示：`repair-needed`、`needs-human`、`failed-with-reason` 不再显示成 `Checked`，并优先展示 failureReason / recoverActions / nextStep。
- [x] 修复失败结果首屏可读性：复杂 ContractValidationFailure 首屏展示紧凑用户态原因，完整 raw trace 仍保留在 audit details。
- [x] 修复 report-viewer 对 AgentServer generation response / taskFiles 的处理：优先使用 `.md` report ref，不把后端 JSON、脚本或 stdout/stderr 当最终报告正文。
- [x] 扩展 deep manifest H022 evidence 字段：session bundle、runtime events、task inputs/outputs、stdout/stderr、verification results 和最终可见结果 ref。
- [x] 补齐网页端 favicon，避免本地 UI 启动后产生无意义资源 404。

本轮仍保留为后续通用任务的问题：

- [x] 统一 ExecutionUnit chip/table/timeline 的状态枚举、计数和文案。
- [x] 让“只看执行单元”过滤模式更纯粹，避免仍显示 notebook timeline / Inspector 的混合上下文。
- [x] 改进历史 session 列表摘要，突出失败边界、可复用 refs 和下一步。
- [x] 补充 partial/background continuation 的真实网页 fixture，验证长任务中途刷新和后台完成合并。

### 2026-05-12 Milestone：网页 E2E 二轮收敛

本轮继续开启多个 sub agents 使用 Computer Use 从网页端并行检查执行单元状态、历史恢复、partial/background、Runtime Health 和结果过滤。根据报告完成第二轮通用修复：

- [x] 新增共享 `executionStatusPresentation`，统一 EU chip、工作过程、执行表的失败/修复/人工介入文案；`blocked` execution-unit 引用不再显示成生硬的 `BLOCKED`。
- [x] 修复 timeline run 计数：只把真实 ExecutionUnit refs 计入 `units=`，不再把 skill plan、UI plan 或 package ref 混入计数。
- [x] `只看执行单元` 模式现在只展示 ExecutionUnit 表、环境定义、stdout/stderr/code/output refs；普通 artifact preview、运行摘要、notebook timeline、raw audit 和 view state 被切到其他模式。
- [x] 历史会话列表新增 compact run summary：run id 短码、失败边界/完成产物、关键 refs、恢复动作和恢复影响说明。
- [x] Runtime Health 每个 item 增加可访问分组标签，避免读屏/AX tree 把 `Model Backend` 与下一项 `optional` 文案误连。
- [x] 研究时间线增加 partial first result / background continuation demo，网页端可直接验证长任务先给 partial、后台再合并 revision 的展示入口。

本轮验证：

- [x] Computer Use：刷新首页、进入工作台、切换只看执行单元、进入研究时间线，确认 UI 行为符合预期。
- [x] `node --import tsx --test ...` 针对 ResultsRenderer、RunExecutionProcess、ArchiveDrawer、workspaceState、alignment display、scenario demo、runtime health。
- [x] `npm run typecheck`
- [x] `npm run smoke:runtime-contracts`
- [x] `npm run smoke:deep-report`
- [x] `npm run smoke:agentserver-direct-text`
- [x] `npm run build`

### 2026-05-12 Milestone：Task outcome 投影与 Run-scoped E2E 收敛

本轮继续以多个 sub agents 并行检查 TODO-GEN、网页 E2E、partial/background、active run 范围和本地服务验证；主线程使用 Computer Use 打开 `http://127.0.0.1:5173/`，确认首页、Runtime Health、Scenario Library、Workspace Writer、AgentServer 和 Model Backend 均可见且 online。根据并行报告完成以下通用修复：

- [x] task attempt ledger 自动生成 `TaskRunCard`，把 goal、round、refs、failure signatures、session bundle、protocol status、task outcome、next step 和 NoHardcodeReview 一起持久化到 attempt 记录。
- [x] gateway `resultPresentation` 同步挂载 `taskOutcomeProjection`：区分 protocol success 与 task success，生成 user satisfaction proxy 和 next-step attribution，不按 prompt、场景、文件名或 backend 写特例。
- [x] 扩展 provider-neutral transient failure 识别：`rate limited` 与已有 HTTP 429/5xx、quota、timeout、DNS/network 类失败统一归为 external transient。
- [x] partial/background completion 只要带 artifact、verification、workEvidence、refs 或失败/取消信息，就合成可审计 ExecutionUnit，并在执行面板展示 verificationRef / verificationVerdict。
- [x] 抽出 run-scoped ExecutionUnit 匹配，ResultsRenderer、RunExecutionProcess、失败审计、recover actions 和 raw audit 只展示 active run 相关执行单元，避免同 session 多 run 串上下文。
- [x] 修复 browser smoke 的本地服务隔离：离线 Runtime Health 不再被主实例 `5174/config` fallback 污染，结构场景 fixture 会写入临时 workspace state，覆盖真实刷新恢复路径。

本轮验证：

- [x] Computer Use：打开本地主页，确认 Runtime Health 中 Web UI、Workspace Writer、AgentServer、Model Backend、Scenario Library 均 online，页面无白屏。
- [x] `node --import tsx --test src/runtime/task-attempt-history.test.ts packages/contracts/runtime/task-run-card.test.ts src/runtime/gateway/transient-external-failure.test.ts src/runtime/gateway/result-presentation-contract.test.ts`
- [x] `node --import tsx tests/smoke/smoke-result-presentation-contract.ts`
- [x] `node --import tsx --test src/ui/src/app/chat/sessionTransforms.test.ts src/ui/src/app/ResultsRenderer.test.ts src/ui/src/app/chat/RunExecutionProcess.test.ts src/ui/src/app/chat/ArchiveDrawer.test.tsx src/ui/src/app/results-renderer-execution-model.test.ts`
- [x] `npm run typecheck`
- [x] `npm run smoke:runtime-contracts`
- [x] `npm run smoke:browser`
- [x] `npm run build`

后续保留：

- [x] 建立 FailureSignature run-level registry，跨 run 去重 schema drift、timeout、repair no-op 和 external transient。
- [x] 将 TaskRunCard 暴露到 task-attempt API / 历史摘要 UI，替换当前部分自建 compact summary。
- [x] 给 schema normalization 增加显式白名单与 audit note，区分结构漂移修复和语义/安全错误 fail-closed。

### 2026-05-12 Milestone：Failure Registry、TaskRunCard API 与 Schema Normalization Fail-closed

本轮继续开启多个 sub agents 并行推进三条后续保留工程线，并使用网页端 E2E 检查 `http://127.0.0.1:5173/`。首页无白屏，Runtime Health 可见 Web UI、Workspace Writer、AgentServer、Model Backend 和 Scenario Library 状态；执行单元过滤模式保持纯净，partial/background continuation demo 可见。根据并行报告完成以下通用修复：

- [x] 新增 workspace 级 `FailureSignatureRegistry`：只追踪 `schema-drift`、`timeout`、`repair-no-op`、`external-transient` 四类通用失败，按 run-level dedupe key 跨 run 合并，同一 run 重写保持幂等。
- [x] `appendTaskAttempt` 在生成 `TaskRunCard` 后同步记录 failure registry，registry 持久化到 `.sciforge/failure-signatures/registry.json`。
- [x] task-attempt API 的 `list` / `get` 显式返回 `taskRunCards`，历史摘要 UI 优先消费 `TaskRunCard` / `taskOutcomeProjection.taskRunCard`，旧 raw compact summary 仅作为 fallback。
- [x] payload validation 在宽松 normalization 前执行 schema error 识别，只允许显式白名单结构漂移修复；缺 required envelope、invalid UI ref、语义/安全敏感字段进入 `ContractValidationFailure` fail-closed。
- [x] `ContractValidationFailure` 增加 `auditNotes`，schema normalization 的 applied/blocked 决策投影到 validation-repair audit diagnostics；成功白名单 normalization 写入 `payload-normalization-audit` log。

本轮验证：

- [x] 网页 E2E：确认首页、Runtime Health、历史/结果区、只看执行单元、partial/background continuation demo；页面无 console error/pageerror/failed request。
- [x] `node --import tsx --test packages/contracts/runtime/task-run-card.test.ts src/runtime/task-attempt-history.test.ts src/runtime/gateway/transient-external-failure.test.ts src/runtime/gateway/result-presentation-contract.test.ts`
- [x] `node --import tsx --test src/ui/src/app/chat/ArchiveDrawer.test.tsx`
- [x] `node --import tsx --test src/runtime/gateway/direct-answer-payload.test.ts src/runtime/gateway/result-presentation-contract.test.ts`
- [x] `node --import tsx tests/smoke/smoke-contract-validation-failure.ts`
- [x] `node --import tsx tests/smoke/smoke-validation-repair-audit-chain.ts`
- [x] `npm run typecheck`
- [x] `npm run smoke:runtime-contracts`
- [x] `npm run smoke:result-presentation-contract`
- [x] `npm run smoke:task-attempt-api`
- [x] `npm run smoke:browser`


### 2026-05-12 Milestone：真实任务压测、Continuation 边界与失败投影收敛

本轮按 H022 要求继续用真实任务压测，并让多个 sub agents 并行检查本地网页与 runtime 边界。浏览器侧只允许 Codex 内置/隔离 headless 路线，不使用 Edge。真实压测覆盖 R-LIT-01、R-LIT-02、R-LIT-08、R-CODE-02、R-RUN-01、R-RUN-02、R-RUN-07、R-UI-04、R-DATA-05。

- [x] R-LIT-02 低预算空结果恢复：窄 query 返回空结果后自动扩展 query，保留 empty boundary、生成中文 partial 报告、paper-list refs、verification ref 和 6 个 ExecutionUnit/log refs。
- [x] 修复 continuation token 膨胀：UI transport 对 ref-backed artifact data 改为 refs+shape summary；context envelope 增加 evidence expansion policy；AgentServer policy 明确 stdoutRef/stderrRef 默认只作审计引用，除非用户明确要求原始日志或失败诊断。
- [x] R-LIT-01 真实 arXiv/PDF 压测：AgentServer 生成真实任务并下载 4 个 PDF 后失败，保留 session bundle、task code、task input/output/log、verification 和 evidence bundle；失败不再被后续 direct-context 包装成满意答案。
- [x] direct-context fast path 遇到 expected artifacts 缺失时返回 `repair-needed` runtime diagnostic，要求先 resume/repair 生成缺失 artifact，不再把上下文摘要当作 task success。
- [x] R-CODE-02 / R-RUN-01 / R-RUN-02 / R-RUN-07 增加真实 failure-boundary smoke：schema drift 白名单、missing envelope fail-closed、repair no-op registry 聚合、failed run TaskRunCard/session bundle refs。
- [x] 修复 `TaskRunCard` 投影在 `SkillAvailability.manifest` 缺失时崩溃，避免 malformed payload 压测进入 outcome projection 时 TypeError。
- [x] 网页 E2E failed-run 投影收敛：failed run raw payload 中的真实 ExecutionUnit 会进入详情、timeline 和执行过程；timeline/artifact refs 按 active run scoped，不再串入上一轮结果。
- [x] stale artifact preview 收敛：workspace file / preview descriptor / derivative 读取增加 in-flight 去重与 400/404 stale 负缓存；缺 path/dataRef 或 stale ref 时显示 fallback，不再反复污染 console。

Failure/Improvement Notes：

- R-LIT-01：外部多 PDF 下载会耗尽 120s runner budget，失败前未写 partial ToolPayload；通用入口是 generated-task runner early checkpoint、partial lineage materialization、repair scope guard。
- R-LIT-02 continuation：把上一轮完整 result/artifact/raw run 重新塞回 handoff 会触发 AgentServer 反复读 stdout/log 并命中 convergence guard；通用入口是 refs-first transport、context evidence expansion policy、log ref cite-only contract。
- R-CODE-02：malformed payload 在 `manifest` 缺失时打崩 outcome projection；通用入口是 runtime projection 对 optional skill metadata fail-soft。
- R-UI/R-DATA：缺失 artifact 文件应 stale-check 并降级展示，不应每次 render 都打 workspace/file 400。

后续保留：

- [x] external multi-fetch generated task 必须早写 partial ToolPayload/checkpoint，并把已下载 PDF/metadata refs 投影到 failed run。
- [x] repair agent 只能修改 generated task 或允许的 adjacent files；越界源码编辑应 reject 并生成 repair-boundary diagnostic。
- [x] generated-task payload schema 可在昂贵执行前 preflight 常见 shape 错误，例如 object-shaped uiManifest、artifact 缺 id/type。
- [x] 历史恢复应直接回到最近 active failed run/workbench，而不是只在 timeline 中可见。

本轮验证：

- [x] `node --import tsx --test src/ui/src/api/sciforgeToolsClient.policy.test.ts src/runtime/gateway/context-envelope.test.ts src/runtime/gateway/direct-context-fast-path.test.ts`
- [x] `node --import tsx tests/smoke/smoke-real-task-attempt-failure-boundaries.ts`
- [x] `node --import tsx --test src/ui/src/api/workspaceClient.preview-cache.test.ts src/ui/src/app/results/WorkspaceObjectPreview.test.ts src/ui/src/api/workspaceClient.feedback.test.ts src/ui/src/app/results/previewDescriptor.test.ts src/ui/src/app/ResultsRenderer.test.ts src/ui/src/app/appShell/workspaceState.test.ts src/ui/src/app/chat/RunExecutionProcess.test.ts src/ui/src/app/results-renderer-execution-model.test.ts src/ui/src/app/results/viewPlanResolver.test.ts`
- [x] `npm run typecheck`

### 2026-05-12 Milestone：Partial Checkpoint、Repair Boundary 与失败恢复直达

本轮继续开启多个 sub agents 并行推进 H022 暴露出的四条通用修复线，并用真实 smoke 压测 runtime、repair、payload preflight 和网页恢复路径。浏览器侧遵守“不占用 Edge”：`npm run smoke:browser` 使用隔离 Chrome for Testing；Codex in-app browser 本轮两次握手超时，已记录为工具链风险，未切到 Edge。

- [x] generated workspace task 在失败/超时且未写 final output 时，会在 session bundle 中扫描新增 partial 文件并写入标准 `partial-checkpoint` ToolPayload；failed run、TaskRunCard 和 attempt ledger 都能投影 partial artifact refs。
- [x] AgentServer repair 增加 repair-boundary 前后快照：repair 只能修改当前 generated task 与允许的 session bundle debug/handoff 文件；越界改 `PROJECT.md`、`src/`、`docs/`、`package*` 等源码/配置时拒绝 rerun，返回 `repair-boundary` diagnostic 并落盘审计。
- [x] generated-task payload 增加执行前 preflight：常见 envelope 缺失、object-shaped `uiManifest`、artifact 缺 id/type 等 shape 错误会在昂贵下载/分析前进入 repair-needed，而不是先浪费 runner budget。
- [x] pre-output / parse / external dependency failure payload 会携带 session-bundle partial evidence refs，`failedTaskPayload`、repair diagnostics 和 TaskRunCard 不再只剩 stdout/stderr。
- [x] 历史恢复会优先定位最近 recoverable failed/repair-needed run，刷新后直接回到 workbench 的 active run，而不是只在 timeline 中留下失败痕迹。
- [x] workspace state/session compaction 保留最近 repair-needed refs，避免 quota compact 后丢掉失败恢复入口。
- [x] browser workflow fixture 增加 failed-run restore 压测，并移除 Edge executable candidate，避免与用户浏览器冲突。
- [x] repair smoke 与 compact repair smoke 统一走 task-attempt API 读取 attempt history，覆盖 root `.sciforge/task-attempts` 与 session bundle `records/task-attempts` 两种存储路径。

Failure/Improvement Notes：

- Codex in-app browser 插件本轮连接 `http://127.0.0.1:23917/` 两次超时；网页端实际压测由隔离 Chrome for Testing 完成。后续需要把 in-app browser 连接稳定性纳入工具链 smoke，或给项目侧增加可观测的 browser-connection diagnostic。
- partial checkpoint 当前只扫描 session bundle 内新增/更新文件；如果任务把 partial 写到任意 workspace 路径，仍需要显式 ref 或后续扩大受控扫描范围。
- repair-boundary 采用 repair 前后快照比对；如果越界文件被改后又完全恢复，当前审计不会保留违规痕迹。
- `direct-answer-payload.ts`、`generated-task-runner-validation-lifecycle.ts` 进入 1000 行 watch list；当前低于 1500 行阈值，但后续应继续把 payload preflight、diagnostic projection、repair audit sink 拆到语义模块。

本轮验证：

- [x] `node --import tsx tests/smoke/smoke-workspace-server-agentserver-repair.ts`
- [x] `node --import tsx tests/smoke/smoke-agentserver-compact-repair.ts`
- [x] `node --import tsx tests/smoke/smoke-agentserver-repair.ts`
- [x] `node --import tsx tests/smoke/smoke-generated-task-failed-payload-repair.ts`
- [x] `node --import tsx tests/smoke/smoke-repair-boundary-guard.ts`
- [x] `node --import tsx tests/smoke/smoke-generated-task-payload-preflight.ts`
- [x] `node --import tsx tests/smoke/smoke-runtime-gateway-modules.ts`
- [x] `node --import tsx tests/smoke/smoke-contract-validation-failure.ts`
- [x] `node --import tsx tests/smoke/smoke-validation-repair-audit-chain.ts`
- [x] `node --import tsx --test src/runtime/gateway/generated-task-runner-execution-lifecycle.test.ts src/runtime/gateway/generated-task-runner-output-lifecycle.test.ts src/runtime/gateway/direct-answer-payload.test.ts src/ui/src/app/appShell/workspaceState.test.ts src/ui/src/app/chat/sessionTransforms.test.ts src/ui/src/sessionStore.test.ts`
- [x] `npm run smoke:task-attempt-api`
- [x] `npm run smoke:browser`
- [x] `npm run smoke:long-file-budget`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `git diff --check`


### 2026-05-13 Milestone：Ownership Layer、Session Bundle Checklist 与 Verification UI 收敛

本轮继续开启多个 sub agents 并行推进 runtime contract、session bundle、网页 E2E 和 UI presentation。Codex/Computer Use 手动打开 `http://127.0.0.1:5173/` 检查首页、Runtime Health、聊天输入、失败 run、结果区过滤；并行 E2E worker 运行 `npm run smoke:browser`，覆盖 onboarding、Settings、Workspace、Timeline、failed-run restore、Builder publish/open flow、mobile layout、partial/background demo 和 reference follow-up preview。

- [x] `TaskRunCard` 新增 `ownershipLayerSuggestions`：真实任务结束后按稳定 runtime 信号自动建议归属层，覆盖 harness、runtime-server、AgentServer parser、payload normalization、presentation、verification、resume、UI、external-provider、workspace，不依赖 prompt、文件名、论文名或 backend 特例。
- [x] gateway `taskOutcomeProjection` 同步暴露 ownership layer suggestions，task-attempt history 会把 runtime profile、UI plan 和 route fallback 等通用元数据纳入建议。
- [x] session bundle manifest 增加 pack/restore/audit checklist：声明 session/messages/runs/execution-units/task-attempts、generated work、handoff、verification、debug、version、README 和 runtime event refs。
- [x] 新增 `auditSessionBundle` / `writeSessionBundleAudit`，workspace snapshot 和 task-attempt API 会生成并返回 `records/session-bundle-audit.json`，TaskRunCard refs 中保留 audit ref，支撑一键打包/恢复/审计。
- [x] UI 执行表和运行过程展示独立 verification 状态，区分 `No verification requested`、`Unverified`、`Verifying`、`Verification failed`、`Verification passed`，不再把 release verification 与 execution success 混在一个 chip 里。
- [x] stale artifact preview 收敛：artifact 已携带可读 inline payload 时，WorkspaceObjectPreview 先展示 artifact 记录本身，不抢先请求可能 stale 的 workspace dataRef，避免真实 workspace 首屏产生无意义 400。

Failure/Improvement Notes：

- Safari 现有 tab 的 localStorage 残留旧 Workspace Writer 端口 `21431`，Runtime Health 显示 offline；隔离浏览器和 smoke 使用当前 `5174` 正常 online。归因层是 UI/local config persistence，后续可增加“本地配置端口漂移”诊断或一键恢复默认 writer URL。
- 当前真实 workspace 中 `bad-report` 指向 `.sciforge/artifacts/no-such.md` 的 stale dataRef；已通过 inline artifact fallback 避免首屏 400，但仍应继续保留 stale negative cache 与用户可见 fallback 作为通用策略。
- `R-RUN-09` 版本漂移恢复需要 capability/schema/runtime fingerprint 与迁移策略，不适合作为小 milestone；先保留为后续架构项。
- 真实 `R-LIT-03` 多来源检索外部依赖较重，后续应先 fixture 化 provider-neutral provenance/dedupe contract，再跑真实网络版本。

本轮验证：

- [x] Computer Use / Safari：打开本地 5173，检查工作台、Runtime Health、失败 run、只看执行单元过滤和设置弹窗；发现并记录本地端口配置漂移。
- [x] `npm run smoke:browser`
- [x] `node --import tsx --test packages/contracts/runtime/task-run-card.test.ts src/runtime/task-attempt-history.test.ts src/runtime/gateway/result-presentation-contract.test.ts src/runtime/session-bundle.test.ts`
- [x] `node --import tsx --test src/ui/src/app/results/WorkspaceObjectPreview.test.ts src/ui/src/api/workspaceClient.preview-cache.test.ts src/ui/src/app/chat/RunExecutionProcess.test.ts src/ui/src/app/ResultsRenderer.test.ts src/ui/src/app/results-renderer-execution-model.test.ts src/ui/src/app/results/viewPlanResolver.test.ts`
- [x] `npm run smoke:runtime-contracts`
- [x] `npm run smoke:task-attempt-api`
- [x] `npm run smoke:workspace-file-api`
- [x] `npm run smoke:bundle-import`
- [x] `npm run typecheck`
- [x] `git diff --check`


### 2026-05-13 Milestone：Refs-first 恢复、Cancel Boundary 与 Run-scoped 导出收敛

本轮继续开启多个 sub agents 并行推进大文件/压缩恢复、active run 导出、PDF 部分下载失败、历史文献诊断和取消边界；网页端 smoke 覆盖 failed-run restore、reference follow-up preview、context meter compact UX 和运行过程折叠。根据并行报告完成以下通用修复：

- [x] refs-first 大文件恢复：Backend handoff 和 context envelope 对 stdout/stderr、ref-backed markdown/log/raw text 只携带摘要、hash、schema 和 durable refs，不再把 head/tail 原文塞回 prompt；压缩后 `stateDigest` 的 run/artifact/file refs 会进入 long-term refs、startup context 和 capability broker object refs。
- [x] cancel boundary 收敛：用户显式 cancel 后，下一轮 payload 携带 `sciforge.cancel-boundary.v1`，side effect policy 为 `do-not-auto-resume`；运行中排队的 guidance 会被拒绝并写入 UI message/event transcript，不会跨 cancel boundary 自动重放。
- [x] active-run 审计导出：ExecutionPanel 导出 JSON bundle 时以当前 active run 和已 scoped ExecutionUnit 为准，导出 session bundle refs、task graph、data lineage、execution commands、artifact refs 和 audit refs，不再被同 session 后续空 run 或 blocked artifact 污染。
- [x] PDF partial failure 边界：PDF 下载遇到 timeout、HTTP 403、413/过大或 content-length 超限时，进入外部 provider 失败诊断，保留已下载全文、metadata、partial report refs，并提示先复用 retained refs，只有用户明确确认后才重跑失败下载。
- [x] 历史文献恢复只诊断：ArchiveDrawer 和 browser failed-run restore fixture 展示失败边界、file refs、partial artifact 和下一步选项，并明确恢复历史会话不会自动重跑历史任务。
- [x] export bundle 补强 compact run：导出策略能从 `TaskRunCard` ref 对象数组提取 bundle/artifact/audit refs；单 run compact session 即使缺少显式 run refs，也会导出可用 ExecutionUnit 和 artifact，而不是生成空 bundle。

Failure/Improvement Notes：

- Browser smoke 发现 active failed run 显示 `0 EU / empty` 时导出的 JSON 仍混入旧 run 的 executionUnits/artifacts；已将导出入口改为 active-run scoped，并把 later empty state 作为回归测试。
- PDF 403/过大不应触发 repair rerun；通用归因层是 external-provider/download boundary，恢复策略是 retained refs first、explicit retry second。
- Cancel 后继续不是普通 continuation；任何 queued guidance 都必须先跨 cancel boundary 变成 rejected/needs-confirmation，而不是静默变成下一轮 prompt。
- `R-RUN-09` 仍保留为后续架构项：版本漂移恢复需要 capability/schema/runtime fingerprint 和迁移策略，不应混入本轮 cancel/refs-first 修复。

本轮验证：

- [x] `node --import tsx --test src/ui/src/app/chat/sessionTransforms.test.ts src/ui/src/processProgress.test.ts`
- [x] `node --import tsx --test src/ui/src/exportPolicy.test.ts src/runtime/session-bundle.test.ts src/ui/src/app/ResultsRenderer.test.ts src/ui/src/app/results-renderer-execution-model.test.ts`
- [x] `node --import tsx --test src/runtime/workspace-task-input.test.ts src/runtime/gateway/context-envelope.test.ts packages/contracts/runtime/task-run-card.test.ts src/runtime/gateway/generated-task-runner-output-lifecycle.test.ts`
- [x] `node --import tsx --test src/ui/src/app/chat/ArchiveDrawer.test.tsx`
- [x] `node --import tsx tests/smoke/smoke-refs-first-large-file-recovery.ts`
- [x] `node --import tsx tests/smoke/smoke-workspace-task-input-compaction.ts`
- [x] `node --import tsx tests/smoke/smoke-current-reference-prompt-path-digests.ts`
- [x] `npm run typecheck`
- [x] `npm run smoke:runtime-contracts`
- [x] `npm run smoke:long-file-budget`
- [x] `npm run smoke:browser`
- [x] `npm run build`
- [x] `npm run test`（706 tests pass）
- [x] `git diff --check`


### 2026-05-13 Milestone：历史编辑、多标签冲突、Artifact 引用与结果空态收敛

本轮继续开启多个 sub agents 并行推进会话分支、结果区 presentation、reference authority、多标签写入冲突、后台 continuation、literature provenance 和网页端回归；主线程补齐 Runtime Health 对旧 Workspace Writer 端口漂移的诊断。根据并行报告完成以下通用修复：

- [x] 历史消息编辑新增 `applyHistoricalUserMessageEdit`：`revert` 会废弃编辑边界后的派生 messages/runs/artifacts/executionUnits/claims 并记录 invalidated refs；`continue` 会保留已有结果，同时标注 affected refs、affected conclusions、conflicts、requiresUserConfirmation 和 next step。
- [x] 多标签并发写入增加 session revision/base revision guard：localStorage 或 workspace state 写入前会检测 stale base / ordering conflict，保留当前状态并记录 recoverable `SessionWriteConflictDiagnostic`，不再静默覆盖另一个 tab 的同 session 更新。
- [x] Artifact 选择追问改为 selected ObjectReference authoritative：inline link 和 object chip 的 `data-sciforge-reference` 携带被点选对象本身，composer payload 写入 `currentReference/objectReference`，避免“基于这个继续”被最近 artifact 抢权。
- [x] 结果区新增 `runPresentationState`：失败、recoverable、empty、partial、needs-human、running、ready 被投影为首屏可读状态；completed 但无 artifact 不再显示成 ready，raw JSON 仍留在审计细节。
- [x] `resultPresentation.artifactActions` 参与 active-run scoped view plan：report、paper-list、diagnostic、verification 混合存在时按 presentation action 稳定排序，focus mode 切换不混入其他 run 的 artifact。
- [x] background continuation smoke 覆盖 artifact revision 合并与 passive disconnect：前端断开不会 abort 后端 long task，后台完成后保留 revision 标注和下一轮 payload refs。
- [x] literature retrieval offline runner 增加 `sourceProvenance`：多 provider 结果按 DOI/PMID/arXiv/title-year 去重，记录来源差异、trust level、被用户移除的低可信来源，并在重写报告时排除低可信来源内容。
- [x] Runtime Health 在配置的 Workspace Writer URL 离线但默认 writer 在线时，展示端口漂移诊断和 Settings 修复动作；browser smoke 允许该更具体的恢复路径。

Failure/Improvement Notes：

- R-LIT-03 本轮采用 provider-neutral fixture contract，不再把真实 arXiv/Semantic Scholar/PubMed/网页网络调用作为工程收敛阻塞；真实网络版本后续只作为 provider availability 验证。
- 多标签冲突不能用浏览器 tab 名、焦点或 localStorage 写入顺序判断；本轮只基于 session revision、base revision 和集合级变更判断。
- 历史编辑 `continue` 不应自动宣称旧结论仍成立；需要用户确认后才能把受影响 refs 当作 current conclusions。
- `src/ui/src/app/chat/sessionTransforms.ts` 已到 1459 行 watch 区，下一次继续追加历史/分支逻辑前应优先拆出 `historyEditTransforms` 或相关语义模块，避免越过 1500 行阈值。

本轮验证：

- [x] `node --import tsx --test src/ui/src/app/chat/sessionTransforms.test.ts src/ui/src/sessionStore.test.ts src/ui/src/app/appShell/workspaceState.test.ts`
- [x] `node --import tsx --test src/ui/src/app/chat/composerReferences.test.ts src/ui/src/app/chat/MessageContent.test.tsx src/ui/src/app/chat/finalMessagePresentation.test.tsx src/ui/src/app/chat/RunExecutionProcess.test.ts`
- [x] `node --import tsx --test src/ui/src/app/ResultsRenderer.test.ts src/ui/src/app/results-renderer-execution-model.test.ts src/ui/src/app/results/viewPlanResolver.test.ts`
- [x] `npm run smoke:background-completion`
- [x] `npm run smoke:literature-retrieval-capability`
- [x] `node --import tsx --test src/ui/src/runtimeHealth.test.ts`
- [x] `npm run smoke:runtime-contracts`
- [x] `npm run smoke:long-file-budget`
- [x] `npm run smoke:browser`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run test`（717 tests pass）
- [x] `git diff --check`


### 2026-05-13 Milestone：Partial-first 运行态、版本漂移恢复与服务生命周期收敛

本轮继续开启新一批 sub agents 并行复核 partial presentation、runtime drift、service lifecycle 和剩余真实场景 backlog；主线程吸收复核约束后落地三条通用修复线：

- [x] R-UI-02 partial-first 运行态：`runPresentationState` 增加结构化 `progress`，展示已完成部分、当前阶段、后台状态和 safe actions；running run 已有 artifact / done ExecutionUnit / background stage 时优先呈现 `partial`，而不是只显示“仍在运行”。
- [x] R-RUN-09 版本漂移恢复：session 持久化增加 `RuntimeCompatibilityFingerprint` 与 `RuntimeCompatibilityDiagnostic`，基于 schema/capability/runtime contract fingerprint 检测 missing fingerprint、schema drift 和 capability drift；诊断在结果区可见，建议先检查 refs、迁移 payload 或明确重跑，不自动恢复旧 side effect。
- [x] R-CODE-10 服务生命周期验证：Workspace Writer `/health` 暴露 pid、startedAt、instanceId 和 lifecycle token；新增动态端口 `smoke:service-lifecycle`，验证旧 writer 退出、新 writer ready、同端口 health identity 更新；Vite runtime launcher 对 Workspace Writer 要求 `workspace-snapshot` capability，避免把未知 `/health` 服务误判为在线。
- [x] `PROJECT.md` 补充本轮 milestone 与 backlog 状态，记录剩余场景中哪些适合 fixture/smoke 化，哪些继续作为真实任务 backlog。

Failure/Improvement Notes：

- R-UI-02 不能依赖 `ExecutionUnitStatus='partial'` 的非 contract 字段；本轮改为从 TaskRun/resultPresentation、backgroundCompletion、已完成 ExecutionUnit 和 artifact refs 投影 partial progress。
- R-RUN-09 fingerprint 不能使用时间戳、workspace 绝对路径、模型配置或 backend URL；本轮只哈希稳定 runtime contract/schema/enum/capability 信号，且 fingerprint 更新不进入 session content revision，避免制造多标签写冲突。
- R-CODE-10 不应 `pkill node` 或按固定端口清理残留进程；本轮 smoke 只停止自己用 lifecycle token 启动的进程。
- `src/ui/src/sessionStore.ts` 已进入 1063 行 watch 区；下一轮继续扩展 session migration/write-guard/drift 时，应优先拆出 runtime compatibility 与 write guard helper 模块。
- 适合下一轮 fixture/smoke 化的 backlog：R-LIT-05、R-LIT-10、R-DATA-01/02/04；R-WF-01/02/06、R-DATA-06 和真实 R-LIT-06/07 质量评估继续保留为真实场景压测。

本轮验证：

- [x] `node --import tsx --test src/ui/src/sessionStore.test.ts src/ui/src/app/results-renderer-execution-model.test.ts src/ui/src/app/ResultsRenderer.test.ts`
- [x] `npm run smoke:service-lifecycle`
- [x] `npm run smoke:runtime-contracts`
- [x] `npm run smoke:long-file-budget`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run test`（722 tests pass）
- [x] `npm run smoke:browser`
- [x] `git diff --check`


### 2026-05-13 Milestone：证据模式、外部瞬时失败与网页状态漂移收敛

本轮继续开启 5 个 sub agents 并行复核 literature correction、workflow policy、CSV/mapping、chart lineage 与网页 smoke；主线程使用 Computer Use 在 `http://127.0.0.1:5173/` 复现并修复 Runtime Health 已恢复但 Scenario Library / Skill Proposals 仍显示旧 Workspace Writer 端口错误的问题。落地以下通用修复：

- [x] R-WF-08 低预算 / metadata-first：`ConversationBehaviorOptimization` 增加结构化 `evidenceMode.fullTextPolicy`，从 `budget`、`executionModePlan.policyOverrides`、`contextPolicy` 和显式 `fullTextPolicy` 归一化；低预算降级会禁用 `full-text-download`，保留 `metadata-search`、`citation-metadata`、`durable-refs` 和用户可见 partial，并给出 `allow-bounded-full-text` escalation path。
- [x] R-WF-09 严格证据模式：新增 `evidenceMode.evidenceGaps` 与 `confidencePolicy`，严格证据或 evidence gap 存在时要求 gap disclosure，并把 claim confidence ceiling 降到结构化上限；backend handoff directive 追加 `handoff:strict-evidence` / `handoff:evidence-gaps-required`，禁止 inline claim-beyond-evidence。
- [x] R-DATA-07 外部数据源限流：`transientExternalDependencyPayload` 与 partial artifact 降级路径都写出 provider-neutral `workEvidence`、`transientPolicy`、`providerAttemptRefs`、`preservedRefs` 和 retry actions；pre-output 与 partial-output 两类 transient failure 都保持 `needs-human` + `externalDependencyStatus='transient-unavailable'`。
- [x] 网页配置漂移状态清理：Scenario Library 和 Skill Proposals 在成功刷新后清空旧错误状态，避免 Workspace Writer 从旧端口恢复到新端口后继续显示 stale diagnostic。

Failure/Improvement Notes：

- R-WF-08/09 不能只靠中文 prompt 特判；本轮以结构化 policy 为主，prompt token 只作为兜底输入，handoff 仍输出 backend-neutral policy/directive code。
- R-DATA-07 不能把所有 429/timeout 都包装为成功；只有 pre-output diagnostic payload 或已有 readable artifact 的 partial run 会被降级为 transient-unavailable，schema/code 错误仍保持 blocking。
- 网页 runtime health 成功不代表所有派生面板状态已收敛；面板级 `status` 必须在成功刷新时主动清空。
- `src/runtime/gateway/conversation-behavior-optimization.ts` 本轮进入 1084 行 watch 区；下一轮继续扩展 workflow/evidence policy 时应优先抽出 evidence mode / handoff directive helper，不能继续堆主文件。

本轮验证：

- [x] Computer Use：Safari 打开并刷新 `http://127.0.0.1:5173/`，确认 Runtime Health online，Scenario Library / Skill Proposals 不再显示旧 `127.0.0.1:21431` Workspace Writer 错误。
- [x] `node --import tsx --test src/runtime/gateway/conversation-behavior-optimization.test.ts src/runtime/gateway/transient-external-failure.test.ts`
- [x] `npm run typecheck`
- [x] `npm run smoke:browser`
- [x] `npm run test`（723 tests pass）
- [x] `git diff --check`


### 2026-05-13 Milestone：图表派生视图 identity 与 action lineage 收敛

本轮在上一阶段推送后重启 worker/explorer，优先落地 R-DATA-04 的最小通用 contract。主线程吸收 chart lineage 复核结论后，把图表迭代从“同一 artifact 只保留一个视图”改为“同一 artifact 可以有多个结构化 action identity / view composition”：

- [x] R-DATA-04 图表迭代：`ResultPresentationArtifactAction` 增加 `presentationKey`、`parentArtifactRef`、`revision`、`revisionRef`、`encoding`、`layout`、`selection`、`sync`、`transform`、`compare`、`exportProfile`，用于表达换坐标、换颜色、筛选子集、导出 profile 等派生视图。
- [x] `viewPlanResolver` 从 resultPresentation action 中保留上述 view params，写入 slot 与 `slot.props.artifactIdentity`，并把 action/revision/transform digest 纳入 item identity，避免同一 `artifact:base-plot` 的多个 revision 被去重吞掉。
- [x] interactive view presentation dedupe 优先读取 `slot.props.artifactIdentity`，让 action-level identity 可以覆盖 artifact-level semantic identity，同时保持普通 artifact dedupe 逻辑不变。

Failure/Improvement Notes：

- R-DATA-04 不应写成 chart 专用字段或依赖颜色/坐标文案；本轮使用通用 resultPresentation action + UIManifestSlot view params，结构上适用于 plot、figure、table-like view 和 export bundle。
- 同一 artifact 的多个派生 action 必须以 action/revision/transform identity 区分；只按 artifact id 去重会丢失用户“换坐标/筛选/导出”的历史意图。
- `src/ui/src/app/results/viewPlanResolver.ts` 本轮 636 行，仍低于 PROJECT watch 阈值；后续继续扩展 result presentation action 时再考虑抽 action normalization helper。

本轮验证：

- [x] `node --import tsx --test src/ui/src/app/results/viewPlanResolver.test.ts packages/presentation/interactive-views/index.test.ts packages/contracts/runtime/result-presentation.test.ts`
- [x] `npm run typecheck`
- [x] `npm run smoke:view`
- [x] `npm run test`（724 tests pass）
- [x] `npm run smoke:browser`
- [x] `git diff --check`


### 2026-05-13 Milestone：文献引用修正派生 artifact 收敛

本轮继续利用 R-LIT-05 explorer 的字段复核结果，落地 literature retrieval 的纯派生 citation correction contract。修复目标是不重写原检索输出、不靠标题/数组序号/文本切段硬匹配，而是从 artifact/ref 层定位目标 paper 与 provider record：

- [x] R-LIT-05 引用修正多轮：新增 `deriveLiteratureCitationCorrection()`，输入 `OfflineLiteratureRetrievalOutput` 与 `paperId/providerRecordRef/evidenceRef` target，输出 `artifact:citation-correction`，包含 `targetPaperId`、`targetProviderRecordRefs`、`sourceRefs`、`verificationStatus`、`correctedSegment`、`affectedEvidenceRows`、`untouchedPaperIds` 与 diagnostics。
- [x] 引用修正只派生目标 paper 的 correction segment/report；原 `paperList`、`evidenceMatrix`、`researchReport.boundedSummary` 不被突变，其他 paper 的 evidence row 不进入 correction artifact。
- [x] smoke fixture 覆盖低可信 `web-search` 与高可信 `pubmed` 命中同一 DOI、另有 `arxiv` 对照 paper 的场景，断言 providerRecordRef 精确命中目标，控制 paper 保持 untouched。

Failure/Improvement Notes：

- R-LIT-05 不能依赖论文标题、报告句子或“第 N 条引用”；本轮定位只基于 `paperId`、`providerRecordRef`、evidence ref、`sourceProvenance` 和 `citationVerificationResults`。
- 当前 `researchReport.boundedSummary` 仍没有段落级锚点；citation correction 先输出结构化 correction artifact，后续若要 UI 内联替换，应从 `targetPaperId/sourceRefs` 派生段落 anchor，而不是文本搜索报告内容。

本轮验证：

- [x] `npm run smoke:literature-retrieval-capability`
- [x] `npm run typecheck`
- [x] `npm run test`（724 tests pass）
- [x] `git diff --check`


### 2026-05-13 Milestone：CSV refs-first 摘要与 Field Mapping artifact refs 收敛

本轮继续吸收 R-DATA-01/02 explorer 对 CSV 多轮分析与两表字段映射的复核结果，优先收敛 refs-first 与 artifact lineage 这两个通用边界，避免后续多轮分析靠 raw table 内容、临时映射文本或最近 artifact 猜测上下文：

- [x] R-DATA-01 CSV 多轮分析：`ConversationReferenceDigest` 的 CSV 摘要改为 schema/profile digest，只保留 header、列数、行宽采样、headerHash/schemaFingerprint 和 omitted policy；行值不再内联进 prompt digest，敏感单元格只能通过 ref 按需读取。
- [x] R-DATA-02 两表合并冲突：TaskProject stage 现在从 ToolPayload `artifacts`、`objectReferences`、`metadata`、`provenance` 中统一收集 `artifactRef/ref/dataRef/path/outputRef/rawRef`，裸 `.sciforge/...` 路径归一化为 `file:` ref，field-mapping artifact 可以随 stage 持久化并被下一轮复用。
- [x] 复杂多轮 fixture 的 `T10-04` 增加 field-mapping artifact、required object ref、lineage 与 identity assertion，要求 mapping artifact 保留 source table refs、`dataRef/path`、column identity 与 provenance。

Failure/Improvement Notes：

- CSV digest 不能用“采样前几行 JSON”换 token，因为真实用户表格常含隐私、密钥、实验 ID 或异常值；默认只暴露 schema/profile，具体行值必须通过 workspace ref 受控展开。
- field mapping 不能只靠 artifact title、最近输出或用户文本规则恢复；mapping 的 `dataRef/path/provenance` 必须进入 stage artifact refs，否则多轮重算会丢失两表合并的列身份和来源。

本轮验证：

- [x] `npx tsx tests/smoke/smoke-current-reference-prompt-path-digests.ts`
- [x] `node --import tsx --test src/runtime/task-projects.test.ts src/runtime/gateway/context-envelope.test.ts`
- [x] `npm run smoke:complex-multiturn-fixtures`
- [x] `npm run smoke:complex-multiturn-chat`
- [x] `npm run typecheck`
- [x] `npm run test`（725 tests pass）
- [x] `git diff --check`


### 2026-05-13 Milestone：Evidence Mode 语义模块拆分

本轮按前一阶段 long-file watch note 做代码膨胀治理，把 evidence mode 的 full-text policy、evidence gap 和 confidence ceiling 规则从 `conversation-behavior-optimization.ts` 抽到独立语义模块，主入口回到行为编排职责：

- [x] 新增 `conversation-behavior-evidence-mode.ts`，集中导出 `decideEvidenceMode`、`EvidenceModeDecision`、`FullTextPolicyDecision`、`EvidenceGapDecision`、`EvidenceConfidencePolicy` 与 full-text/evidence gap 类型。
- [x] `conversation-behavior-optimization.ts` 只 import/re-export evidence mode contract，保留 backend handoff、latency、budget、parallel plan 等编排逻辑；文件从 1084 行降到 875 行，退出 1000 行 watch list。
- [x] `smoke:long-file-budget` 确认 evidence 主入口不再出现在 watch 列表，后续扩 evidence policy 应优先进入新模块而不是回堆主文件。

Failure/Improvement Notes：

- evidence mode 是可继续扩展的策略资产，不能和 latency、parallel plan、handoff 拼在一个大函数文件里；否则后续严格证据、metadata-first、confidence ceiling 会再次制造隐式第二入口。
- 本轮只做语义模块拆分，不改 policy 行为；backend handoff directive 暂留主文件，因为它同时依赖 intent、budget、state refs 与 evidence mode，后续若继续膨胀再按 `*-handoff-directive` 单独抽。

本轮验证：

- [x] `node --import tsx --test src/runtime/gateway/conversation-behavior-optimization.test.ts`
- [x] `npm run typecheck`
- [x] `npm run smoke:long-file-budget`
- [x] `npm run test`（725 tests pass）
- [x] `git diff --check`


### 2026-05-13 Milestone：通用 artifact derivation 与双语报告 lineage 收敛

本轮落地 R-LIT-10 的最小通用 contract，同时补齐通用 artifact derivation 元数据与结果展示传播：双语报告不是重写原检索输出，也不是靠最近报告文本生成孤立摘要，而是从 `artifact:research-report` 派生英文 executive summary 与中英术语表，并保留 paper/provider/evidence refs：

- [x] 新增 `deriveLiteratureBilingualReport()`，输入 `OfflineLiteratureRetrievalOutput`、目标语言、executive summary 和 glossary terms，输出 `artifact:bilingual-literature-report`。
- [x] `RuntimeArtifact.metadata.derivation` 增加 `sciforge.artifact-derivation.v1` 通用元数据，覆盖 `summary`、`translation`、`glossary`、`correction`、`rewrite` 等派生关系；ResultPresentation action 和 legacy gateway adapter 会传播 `parentArtifactRef`、`sourceRefs`、`derivationKind`。
- [x] Artifact Inspector lineage 展示 derivation kind、parent 和 sources，避免派生摘要/术语表只显示 producer skill 而丢掉来源 artifact。
- [x] 派生 artifact 显式包含 `parentArtifactRef='artifact:research-report'`、`derivedArtifactRefs`、`sourceArtifactRefs`、source report snapshot、paperIds、sourceRefs、metadata.derivation 和 lineage，确保中文报告、英文摘要、术语表之间可审计。
- [x] literature capability manifest 补齐 runner 已实际产出的 `sourceProvenance` output schema / expectedRefs / metadata producesArtifactTypes。
- [x] smoke fixture 验证英文 executive summary 和 bilingual glossary 都携带 `artifact:research-report` / provider refs / evidence-matrix refs，且不突变原 `researchReport.boundedSummary`。

Failure/Improvement Notes：

- R-LIT-10 不应把翻译结果覆盖回原 `researchReport`，否则后续引用修正、审计导出和中文报告恢复都会丢失原始 artifact 身份；本轮采用纯派生 artifact。
- glossary 不能只是一段 markdown 文本；每个 term 必须有 sourceRefs、paperIds 与 confidence，方便后续用户要求“只改术语表”或“按某篇论文改术语”时命中正确来源。

本轮验证：

- [x] `npm run smoke:literature-retrieval-capability`
- [x] `node --import tsx --test packages/contracts/runtime/capability-evolution.test.ts`
- [x] `node --import tsx --test packages/contracts/runtime/result-presentation.test.ts src/runtime/gateway/result-presentation-adapter.test.ts src/ui/src/app/ResultsRenderer.test.ts`
- [x] `npm run typecheck`
- [x] `npm run smoke:runtime-contracts`
- [x] `npm run test`（727 tests pass）
- [x] `git diff --check`



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

- [x] R-LIT-01 今日 arXiv agent 论文深调研：检索今日/最近 agent 论文，下载 PDF，阅读全文，产出中文 markdown 报告；随后要求按方法、数据集、评测指标、主要结论重排；再要求导出审计包。已压测真实失败边界，保留 evidence bundle；后续修复见本轮 notes。
- [x] R-LIT-02 arXiv 空结果恢复：限定一个很窄主题和当天日期，预期可能空结果；要求系统自动说明 empty result、扩展 query、保留不确定性，并继续生成 partial 报告。
- [x] R-LIT-03 多来源文献对照：同一主题分别检索 arXiv、Semantic Scholar/PubMed/网页来源，去重并标注来源差异；用户要求删除低可信来源后重写结论。已完成 provider-neutral fixture contract；真实网络调用仅作为后续 provider availability 验证。
- [x] R-LIT-04 全文下载失败恢复：要求下载 10 篇论文全文，其中部分 PDF 超时/403/过大；系统必须保留已下载全文、标注失败原因、继续基于 metadata 补 partial。
- [x] R-LIT-05 引用修正多轮：先生成报告，再让用户指出某条引用不可信；系统必须定位原 artifact/ref，修正该段，不污染其他结论。已覆盖 providerRecordRef/paperId 定位、citation-correction 派生 artifact、目标 evidence row 修正和非目标 paper untouched。
- [ ] R-LIT-06 研究方向综述迭代：先做宽泛综述，再要求缩小到 robotics agent，再要求排除 benchmark 论文，再要求只保留开源代码论文。
- [ ] R-LIT-07 论文复现可行性筛选：检索论文后按代码可用性、数据集可用性、计算成本、复现风险排序，并导出复现计划。
- [x] R-LIT-08 反事实追问：报告完成后用户问“如果只看非 LLM agent 呢”，系统必须复用已有检索 refs 并说明哪些需要刷新。已覆盖“缺少可用 paper-list/report 时必须先 repair/resume”的失败边界。
- [x] R-LIT-09 历史文献任务恢复：打开昨天失败的 literature session，要求只看诊断不重跑；系统必须展示失败边界、可复用 refs 和下一步选项。
- [x] R-LIT-10 双语报告：同一调研先生成中文报告，再要求英文 executive summary，再要求中英术语表，验证 artifact 派生关系。已覆盖通用 `metadata.derivation`、`artifact:research-report` 到 bilingual executive summary / glossary / report 的派生 lineage、source refs、paperIds 和原报告不突变。

代码修复与工程任务：

- [ ] R-CODE-01 端到端 bug 修复：用户贴浏览器失败截图，要求定位原因、写通用修复、跑测试、重启服务、同步 GitHub；过程中用户中断一次后继续。
- [x] R-CODE-02 Schema drift 修复：构造 backend 返回宽松 JSON、fenced JSON、缺字段 payload、空 artifactRef 等情况，要求系统统一归一化而非 repair loop。
- [x] R-CODE-03 长任务 stream 稳定性：运行超过前端 timeout 的任务，刷新浏览器、关闭标签、恢复历史，验证后端不被 passive disconnect 杀掉。
- [ ] R-CODE-04 多模块改造：让 agent 同时改 gateway、UI presentation、runtime contract、tests；用户中途要求缩小范围，只保留 runtime 修复。
- [ ] R-CODE-05 测试失败恢复：第一次 patch 后 typecheck/test 失败，用户要求解释失败并做最小通用修复，不能回滚无关改动。
- [ ] R-CODE-06 Dirty worktree 协作：预先放入用户未提交改动，再让 agent 修复另一区域，验证不会 reset/revert 用户改动。
- [ ] R-CODE-07 Release verify 请求：用户要求“等完整验证再推 GitHub”，系统必须阻塞到指定测试完成，失败时不推送。
- [ ] R-CODE-08 Backend handoff 漂移：AgentServer 返回 taskFiles、direct ToolPayload、plain text、malformed generation response 四类输出，要求统一分类和可恢复。
- [ ] R-CODE-09 多 backend 对比修复：同一任务用 Codex/OpenTeam 两个 backend 跑，比较失败模式，提炼 backend-neutral 修复。
- [x] R-CODE-10 项目服务生命周期：修改代码后自动重启 dev server，确认端口占用、旧进程退出、新服务 ready、浏览器页面可刷新。已覆盖 Workspace Writer health identity、动态端口 restart smoke 和 Vite capability gate；真实 UI dev server 热更新仍由 `npm run smoke:browser` 持续覆盖。

数据分析与文件 artifact 任务：

- [x] R-DATA-01 CSV 多轮分析：上传/引用 CSV，先做摘要统计，再改分组口径，再要求异常值解释，再导出 markdown 报告和复现代码。已覆盖 CSV refs-first schema/profile digest、敏感行值不内联、按 ref 受控展开边界。
- [x] R-DATA-02 两表合并冲突：A/B 两个表字段不一致，用户给映射规则，系统重算并保留 mapping artifact。已覆盖 ToolPayload/objectReferences/provenance 中 mapping artifact refs 的 stage 持久化与复杂多轮 fixture lineage。
- [x] R-DATA-03 大文件摘要：读取大文本/日志文件，只允许摘要和 refs，不允许把全文塞入 prompt；后续追问必须按需读取片段。
- [x] R-DATA-04 图表迭代：先生成图表 artifact，再要求换坐标、换颜色、筛选子集、导出最终报告，测试 artifact identity。已覆盖 resultPresentation action-level lineage、revisionRef、view transform/exportProfile 和同一 artifact 多派生视图保留。
- [x] R-DATA-05 缺失文件恢复：历史 artifact 指向的文件被删除/移动，用户要求继续，系统必须 stale-check 并进入安全恢复。
- [ ] R-DATA-06 Notebook 风格任务：连续执行多个分析步骤，每步都有中间文件；用户要求回到第 2 步换参数后继续生成分支结果。
- [x] R-DATA-07 外部数据源限流：调用外部 API 拉数据遇到 429/timeout，系统必须输出 transient-unavailable 诊断和重试建议。已覆盖 pre-output diagnostic payload、partial artifact 降级、provider-neutral workEvidence、transientPolicy 和 retry refs。
- [x] R-DATA-08 审计导出：分析完成后用户只要求导出 task graph、数据 lineage、执行命令和 artifact refs，不重新计算。

Runtime、恢复与会话生命周期任务：

- [x] R-RUN-01 失败 run 诊断：用户点选 failed run，要求解释为什么失败、哪些文件可用、是否能继续、下一步怎么做。
- [x] R-RUN-02 Repair loop 防护：制造 repeated repair no-op，要求系统停止重复修复并给通用失败分类。
- [x] R-RUN-03 Background continuation：启动长任务后用户继续问另一个问题，后台完成后要求合并结果并标注 revision。
- [x] R-RUN-04 多标签并发：两个浏览器标签对同一 session 发送消息，验证 ordering/conflict guard。
- [x] R-RUN-05 编辑历史 revert：修改早期用户目标并选择 revert，系统必须废弃后续派生 runs/artifacts。
- [x] R-RUN-06 编辑历史 continue：修改早期目标但保留已有结果，系统必须标注冲突和受影响结论。
- [x] R-RUN-07 跨 session 恢复：新开页面恢复旧 session，只依赖持久化 state，不依赖前端内存。
- [x] R-RUN-08 取消边界：用户显式 cancel 后要求继续，系统必须说明 cancel boundary，不自动恢复不可逆 side effect。
- [x] R-RUN-09 版本漂移恢复：代码更新后打开旧 session，系统检测 capability/schema/version drift 并建议迁移或重跑。已完成 provider-neutral runtime compatibility fingerprint、drift diagnostic、compact 持久化和结果区建议展示。
- [x] R-RUN-10 压缩后恢复：模拟只剩 state digest 和 refs，继续多轮任务，检查 artifact/run/ref 是否仍能命中。

UI 与 presentation 真实任务：

- [x] R-UI-01 失败结果可读性：失败时右侧结果必须先展示用户可理解的原因、可用产物、下一步，而不是 raw trace 优先。
- [x] R-UI-02 Partial 优先：长任务运行中必须展示已完成部分、当前阶段、后台状态和可安全中止/继续的操作。已由 `runPresentationState.progress` 与 ResultsRenderer 首屏 partial-first summary 覆盖。
- [x] R-UI-03 Artifact 选择追问：用户点选某个 file/artifact 后追问“基于这个继续”，系统必须使用被点选对象而不是最近对象。
- [x] R-UI-04 ExecutionUnit 展示：运行结果中 execution unit 必须包含 codeRef/stdoutRef/stderrRef/outputRef、状态、失败原因和 recoverActions。
- [x] R-UI-05 Verification 状态：普通结果、未验证结果、后台验证中、验证失败、release verify 通过五种状态 UI 必须可区分。
- [x] R-UI-06 空结果页面：没有 artifact 时不能显示误导性 completed；必须展示 empty/needs-human/recoverable 的准确状态。
- [x] R-UI-07 多 artifact 比较：结果区同时出现 report、paper-list、diagnostic、verification，用户切换 focus mode 后仍保持正确排序。
- [x] R-UI-08 导出 bundle：用户要求导出 JSON bundle/审计包，UI 必须能引用正确 session bundle 而不是当前空状态。

真实用户工作流任务：

- [ ] R-WF-01 科研选题助手：用户从模糊方向开始，逐步要求找热点、筛论文、列可做实验、评估新颖性、生成计划。
- [ ] R-WF-02 论文审稿助手：上传/引用论文 PDF，要求总结贡献、找弱点、查相关工作、生成审稿意见，再要求改成温和语气。
- [ ] R-WF-03 复现实验计划：从论文出发，提取环境、数据、训练命令、评测指标、风险，生成 step-by-step 复现 checklist。
- [ ] R-WF-04 项目周报：读取 workspace 最近任务、失败 run、已完成 artifact，生成周报；用户要求隐藏敏感路径后重写。
- [ ] R-WF-05 多同学协作分工：基于当前 PROJECT 和代码结构，给 3-5 个同学拆分任务；后续要求按风险/收益重排。
- [ ] R-WF-06 调研到代码任务：先调研某技术方案，再要求在 SciForge 中实现最小通用修复，再生成测试计划。
- [ ] R-WF-07 用户反馈收敛：用户连续指出“慢、崩、看不懂、引用错、重复跑”，系统把反馈归类到通用 TODO，而不是逐条道歉。
- [x] R-WF-08 低预算模式：用户要求“不要下载全文，先用 metadata 快速判断”，后续再允许补全文，测试 budget escalation。已覆盖结构化 fullTextPolicy、低预算 disabled/retained work 与 handoff metadata-first directive。
- [x] R-WF-09 严格证据模式：用户要求“不要猜，不确定就标注”，系统必须降低 claim confidence 并输出 evidence gaps。已覆盖 evidenceMode.evidenceGaps、confidencePolicy ceiling 与 strict-evidence handoff。
- [ ] R-WF-10 发布前检查：用户要求把本地改动推 GitHub 前做 release verify、写变更摘要、重启服务，并保留审计记录。

通用修复 TODO 池：

- [x] TODO-GEN-01 为每个真实任务自动生成 `TaskRunCard`：目标、轮次、状态、refs、失败模式、通用归因层、下一步。
- [x] TODO-GEN-02 建立 `FailureSignature` 去重：相同 schema drift、timeout、repair no-op、external transient 不重复开新诊断。
- [x] TODO-GEN-03 建立 `NoHardcodeReview` checklist：每次修复必须说明适用场景、反例、为什么不是 prompt/file/backend 特例。
- [x] TODO-GEN-04 让真实任务跑完后自动建议归属：harness、runtime server、AgentServer parser、payload normalization、presentation、verification、resume、UI。
- [x] TODO-GEN-05 为“成功但不满足用户真实目标”的情况增加状态：protocol success 不等于 task success，必须进入 needs-work/needs-human。
- [x] TODO-GEN-06 为 direct-text fallback 增加 guard：像代码、taskFiles、JSON、trace、日志的内容不能轻易包装成最终报告。
- [x] TODO-GEN-07 为 schema normalization 建立白名单边界：只修复结构漂移，不吞掉真实语义错误或安全错误。
- [x] TODO-GEN-08 为 external transient 建立 provider-neutral policy：HTTP、DNS、timeout、rate limit、quota、service unavailable 统一分类。
- [x] TODO-GEN-09 为 session bundle 增加“一键打包/恢复/审计”检查清单，确保每个多轮任务可独立迁移。
- [x] TODO-GEN-10 为复杂任务新增“用户满意度 proxy”：是否回答了最新请求、是否展示可用结果、是否给出下一步、是否避免重复劳动。
