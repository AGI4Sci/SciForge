# SciForge - PROJECT.md

最后更新：2026-05-17

## 当前目标

用 Codex in-app browser 对 SciForge 进行真实、复杂、多轮的科研与 coding 端到端任务牵引。目标不是只让 smoke/fixture 通过，而是在真实网页交互中持续发现失败、定位通用根因、修复架构薄弱点，并提高任务成功率与收敛速度。

所有修改必须通用：不能为某个 prompt、端口、backend、provider、文件名、论文题目、错误文本或浏览器会话写特例。多轮运行时以 [`docs/SciForge-SingleAgent-Architecture.md`](docs/SciForge-SingleAgent-Architecture.md) 为最终 contract，产品/实现背景参考 [`docs/Architecture.md`](docs/Architecture.md)，harness 行为入口参考 [`docs/AgentHarnessStandard.md`](docs/AgentHarnessStandard.md)。

## 历史归档

- 2026-05-14/15 旧 CAP/PKG/GT/PSM/MEM/H022 与早期稳定性任务：[`docs/archive/PROJECT-history-2026-05-14-15.md`](docs/archive/PROJECT-history-2026-05-14-15.md)。
- 2026-05-16 Browser Multiturn Stability Sprint、PBT/P1/P2/P3/P4/ARC/MTG 长任务板与 issue 细节：[`docs/archive/PROJECT-history-2026-05-16-browser-sprint.md`](docs/archive/PROJECT-history-2026-05-16-browser-sprint.md)。

已完成可回归的能力摘要：

- Projection-only UI、status-first Projection trust、主结果优先来自 ConversationProjection / ResultPresentation / ArtifactDelivery。
- Fresh/continue direct-context 路由、answer-only continuation、policy timeout fallback、policy batch bridge。
- Provider preflight、capability manifest requiredCapabilities、empty/unavailable terminal contract、runtime-visible-state hook。
- Repair trigger 只来自真实 failure/recover refs，不来自 prompt 关键词。
- Persisted Projection restore、selected artifact refs、audit/raw boundary、真实 browser evidence final gate 基线。
- Gateway pipeline stage registry、typed policy boundary、HarnessContract Phase 1、DirectContextDecision canonical key。

## 必读边界

实现前先读：

- [`docs/SciForge-SingleAgent-Architecture.md`](docs/SciForge-SingleAgent-Architecture.md)：Workspace Kernel、AgentServer Context Core、Runtime Bridge、Capability Gateway、Projection-only UI、conformance 和长期防污染边界。
- [`docs/Architecture.md`](docs/Architecture.md)：Backend-first / Capability-driven / Harness-governed 方向、`src` 与 `packages` 边界。
- [`docs/AgentHarnessStandard.md`](docs/AgentHarnessStandard.md)：harness runtime、profile、stage hook、contract、trace、merge 规则和行为治理入口。

## 不变原则

- 真实 browser 优先：每个活动进程必须用 Codex in-app browser 完成端到端多轮任务；terminal smoke 只能作为补充验证，不能替代用户可见证据。
- 任务成功优先：`TaskSuccess=true` 必须代表用户问题被准确、完整、可核查地解决；只显示 `satisfied`、只恢复 refs、只无 raw leak、只无 Projection wait 都不是充分条件。
- 速度不能靠快失败冒充：可以更早展示计划、进度、partial answer 和 recover action，但不能跳过 provider/tool、artifact grounding、verification boundary 或最终质量。
- 所有修复必须通用：修架构薄腰、contract、profile、manifest、Projection、ArtifactDelivery、gateway、policy 或 UI boundary，不写 prompt/provider/session/端口特例。
- Capability 必须成为生成层可执行 authoring contract：已有 ready provider/tool route 时，backend prompt 必须收到标准 helper/API 签名、任务输入字段和可复制 adapter skeleton。
- 多轮记忆边界保持 Single-Agent runtime contract：Workspace Kernel ledger/ref store 是事实源；AgentServer Context Core 负责 retrieval/compaction/handoff；backend 只消费 cache-aware projection/task packet 并按需读取 refs。
- 设计和实现保持同一真相源：代码改变 contract 时同步更新相关设计文档和本文件。
- 代码路径保持唯一真相源：发现冗余链路时删除、合并；旧兼容逻辑若与最终 contract 冲突，默认移除。
- 长文件治理：源码文件超过 1000 行进入 watch list；超过 2000 行优先按职责拆分；超过 3000 行视为维护风险。

## 当前 Milestone：Real Research & Coding Multiturn Gauntlet

状态：active
总控：Codex Orchestrator
工作分支：`main`

目标：并行启动多个独立 SciForge 网页进程，每个进程选择一个真实科研或 coding 场景，完成至少 4 轮用户交互，产出可审计 evidence，并用失败牵引通用修复。每个子进程可以在执行中发现并提出新的任务，但新任务必须写入本文件的 `Discovered Task Queue`，并说明为什么它是通用问题。

### Milestone Gate

- [ ] **Browser E2E Gate**：每个进程必须用 in-app browser 交互，记录 URL、run id、session id、prompt、selected refs、DOM/screenshot、console/network summary、timing 和 success/failure reason。
- [ ] **Real Task Gate**：任务必须足够复杂，面向真实科研或 coding 工作流；不能只问 toy prompt、单轮问答或纯诊断。
- [ ] **Multiturn Gate**：每个任务至少覆盖 fresh -> artifact/result -> follow-up -> selected/ref/context follow-up -> reload/reopen 或 repair/recover 中的 4 个动作。
- [ ] **Root-Cause Gate**：每个 P0/P1 失败必须定位到 policy / harness / capability / gateway / AgentServer / Projection / ArtifactDelivery / UI restore / persistence 边界。
- [ ] **General Fix Gate**：修复后必须证明没有 prompt/provider/task 特例，并补 targeted tests 或 conformance fixture。
- [ ] **Speed Gate**：记录首个有用反馈和最终收敛时间；慢路径必须进入 issue 或 discovered task。
- [ ] **Sync Gate**：完成 milestone 后更新本文件、提交并 push 到 `origin/main`。

### Sub-agent Milestone Protocol

- [ ] 每个进程尽可能使用 sub agents 加速推进：把 browser 操作、代码勘察、root-cause 定位、测试补齐、文档/evidence 整理拆给不同 sub agents 并行执行。
- [ ] 每批 sub agents 必须围绕一个明确 milestone 工作；启动前在对应 `RCG-*` 或 `DISC-*` 下写清本批目标、owner、预期 evidence 和验收项。
- [ ] Orchestrator / process owner 负责整合 sub agent 结果，避免多个 sub agents 修改同一文件或互相覆盖 evidence。
- [ ] 完成一个 milestone 后，必须更新 `PROJECT.md`：勾选完成项、补 evidence 链接、记录失败和新发现任务、更新状态与 Activity Log。
- [ ] 完成一个 milestone 后，必须同步 GitHub：提交并 push 当前通用修复、文档和 evidence；不能长期把 milestone 结果只留在本地。
- [ ] 完成一个 milestone 后，必须关闭上一批 sub agents，再启动下一批 sub agents 推进下一个 milestone，避免旧上下文继续污染新目标。
- [ ] 可以动态发现新任务、调整中间任务、重排优先级；但调整必须服务最终目标：真实科研/coding 多轮任务成功率更高、速度更快、修复更通用。
- [ ] 如果 sub agent 发现的问题不是当前 milestone blocker，也要写入 `Discovered Task Queue`，不能用临时代码绕过。

### Worker 打勾规则

- [ ] Worker 认领任务后，将对应 `状态：todo` 改为 `状态：in_progress`，并在任务下补充 evidence manifest 路径占位。
- [ ] 每完成一轮 browser 交互，立即勾选对应 Round，并补充 run id、session id 或 evidence 路径。
- [ ] 每完成一条验收，立即勾选对应验收项；不能用“后续会补”提前打勾。
- [ ] 发现新通用问题时，追加到 `Discovered Task Queue`，并至少勾选“最小复现”或说明 blocker。
- [ ] Worker 完成当前 milestone 后，确认上一批 sub agents 已关闭，并在下一批 sub agents 启动前更新本文件和 GitHub。
- [ ] 任务全绿后，将状态改为 `done`，在 Activity Log 增加一行摘要。

## 并行进程矩阵

每个进程独立端口、workspace、state 和 config。默认 6 个进程；机器资源不足时可先跑 P1-P4，P5/P6 排队。

| 进程 | 主题 | UI | Writer | AgentServer | Workspace | State | Config |
|---|---|---:|---:|---:|---|---|---|
| P1 | 文献综述与证据矩阵 | 5173 | 5174 | 18080 | `workspace/parallel/p1` | `.sciforge/parallel/p1` | `.sciforge/parallel/p1/config.local.json` |
| P2 | 数据分析与可复现实验 | 5273 | 5274 | 18180 | `workspace/parallel/p2` | `.sciforge/parallel/p2` | `.sciforge/parallel/p2/config.local.json` |
| P3 | 论文复现与代码调试 | 5373 | 5374 | 18280 | `workspace/parallel/p3` | `.sciforge/parallel/p3` | `.sciforge/parallel/p3/config.local.json` |
| P4 | 科研软件架构与补丁 | 5473 | 5474 | 18380 | `workspace/parallel/p4` | `.sciforge/parallel/p4` | `.sciforge/parallel/p4/config.local.json` |
| P5 | 方法学评审与实验设计 | 5573 | 5574 | 18480 | `workspace/parallel/p5` | `.sciforge/parallel/p5` | `.sciforge/parallel/p5/config.local.json` |
| P6 | 长上下文项目记忆与交付物迭代 | 5673 | 5674 | 18580 | `workspace/parallel/p6` | `.sciforge/parallel/p6` | `.sciforge/parallel/p6/config.local.json` |

启动模板：

```bash
SCIFORGE_INSTANCE=p2 \
SCIFORGE_INSTANCE_ID=p2 \
SCIFORGE_UI_PORT=5273 \
SCIFORGE_WORKSPACE_PORT=5274 \
SCIFORGE_AGENT_SERVER_PORT=18180 \
SCIFORGE_WORKSPACE_PATH=workspace/parallel/p2 \
SCIFORGE_STATE_DIR=.sciforge/parallel/p2 \
SCIFORGE_LOG_DIR=.sciforge/parallel/p2/logs \
SCIFORGE_CONFIG_PATH=.sciforge/parallel/p2/config.local.json \
SCIFORGE_WORKSPACE_WRITER_URL=http://127.0.0.1:5274 \
SCIFORGE_AGENT_SERVER_URL=http://127.0.0.1:18180 \
npm run dev
```

## Active Task Board

### RCG-001 Literature Evidence Matrix Agent

状态：todo
Owner：P1
环境：Browser `http://127.0.0.1:5173/`

真实场景：科研用户要快速评估一个前沿方向的可行性，要求 SciForge 搜集/组织证据、生成矩阵、解释风险，并在多轮中只基于已选 artifact 继续回答。

建议主题：`spatial transcriptomics for early detection of pancreatic cancer` 或 `KRAS G12D inhibitor resistance mechanisms`。主题可替换，但必须是真实科研问题。

多轮剧本：

- [ ] Round 1 fresh：要求生成 6-8 篇关键论文/证据的 evidence matrix，字段包括 claim、model/system、method、main result、limitations、confidence、citation/ref。
- [ ] Round 2 follow-up：要求把 evidence matrix 压缩成 3 个可检验 hypothesis，并说明每个 hypothesis 的最小验证实验。
- [ ] Round 3 selected artifact：用户显式选择 Round 1 matrix artifact，只问其中一个 claim 的证据强弱和反例；回答必须只基于 selected artifact / refs。
- [ ] Round 4 reload/reopen：刷新后继续追问“哪些实验最可能失败，为什么”，验证 Projection restore 和 context continuity。
- [ ] Round 5 optional：要求生成 `research_plan.md` 或等价 artifact，包含实验设计、success criteria 和风险。

验收：

- [ ] `TaskSuccess=true` 必须有具体论文/证据/claim 结构，不接受空泛综述。
- [ ] Selected artifact follow-up 不得混入最新 artifact 或 raw run。
- [ ] Reload 后仍能准确回答，`ProjectionWaitAtTerminal=0`、`RawLeak=false`。
- [ ] 记录 evidence manifest，包含回答质量人工判定理由。
- [ ] Worker 回写：状态、打勾项、evidence manifest、run/session/artifact refs 已更新到本任务。

### RCG-002 Data Analysis & Reproducible Notebook Agent

状态：todo
Owner：P2
环境：Browser `http://127.0.0.1:5273/`

真实场景：科研用户上传或指定一个小型 CSV/TSV 数据集，让 SciForge 做探索性分析、统计检验、图表、方法解释和后续修改。

建议数据：可使用项目内 fixtures、自造公开结构数据，或让 SciForge 生成一个明确 schema 的模拟实验数据集。不要依赖私有数据。

多轮剧本：

- [ ] Round 1 fresh：要求创建或读取一个包含 treatment/control、batch、timepoint、measurement 的数据集，并完成 EDA、QC、效应量和统计检验。
- [ ] Round 2 artifact follow-up：要求解释一个图或表的结论，指出可能 confounder 和 robustness check。
- [ ] Round 3 modification：要求增加一个 sensitivity analysis 或 bootstrap CI，并更新 artifact。
- [ ] Round 4 coding/debug：故意要求导出 notebook/script；若执行失败，使用 recover/repair 完成原目标。
- [ ] Round 5 reload：刷新后要求概括最终结论和可复现实验命令。

验收：

- [ ] 必须产出可检查的 data/script/report artifact，不接受只有聊天文字。
- [ ] 统计结论需包含样本量、效应方向、检验假设或限制。
- [ ] Repair 不得靠 prompt 关键词触发，必须基于真实 failure refs。
- [ ] Provider/tool unavailable 或 empty 时必须给出真实 blocker 和 recover action。
- [ ] Worker 回写：状态、打勾项、evidence manifest、run/session/artifact refs 已更新到本任务。

### RCG-003 Paper Reproduction & Code Debug Agent

状态：todo
Owner：P3
环境：Browser `http://127.0.0.1:5373/`

真实场景：科研用户要求复现一个论文算法的核心 toy version，并在多轮中调试失败、解释差异、改进实验。

建议任务：`implement a minimal differentiable ODE parameter fitting demo`、`reproduce a small graph neural network ablation on synthetic data` 或 `simulate CRISPR guide scoring baseline`。

多轮剧本：

- [ ] Round 1 fresh：要求生成最小可运行复现实验，包括代码、数据生成、评价指标和 expected output。
- [ ] Round 2 run/debug：要求运行或检查代码，如果失败必须定位错误并 repair。
- [ ] Round 3 analysis：要求解释结果与论文主张的差异，并列出至少 3 个可能原因。
- [ ] Round 4 change request：要求加入一个 ablation 或 baseline，并比较结果。
- [ ] Round 5 selected artifact：选择最终 script/report，要求给出可复现实验步骤和风险。

验收：

- [ ] 代码/报告 artifact 必须可读，且回答不能只列 refs。
- [ ] 如果运行失败，repair 必须 bounded，不得无限循环。
- [ ] Direct-context sufficient 时不得重新 dispatch AgentServer。
- [ ] 最终回答必须说明复现是否成功、差异在哪里、下一步怎么验证。
- [ ] Worker 回写：状态、打勾项、evidence manifest、run/session/artifact refs 已更新到本任务。

### RCG-004 SciForge Self-Improvement Coding Agent

状态：todo
Owner：P4
环境：Browser `http://127.0.0.1:5473/`

真实场景：把 SciForge 当作 coding agent 使用，让它阅读本仓库一部分代码，提出并实现一个小的通用改进，然后在多轮中解释、修正和验证。

建议任务：围绕 runtime-visible-state、evidence manifest schema、Projection rendering、capability preflight 或 test helper 做小改进。不得要求它改 `PROJECT.md` 本身。

多轮剧本：

- [ ] Round 1 fresh：要求分析一个具体模块的职责和已知风险，产出设计说明或 patch plan。
- [ ] Round 2 implementation：要求实现一个小的通用修复或测试 helper。
- [ ] Round 3 review/follow-up：要求解释 patch 如何避免 prompt/provider 特例，并列出验证命令。
- [ ] Round 4 selected artifact：选择 patch/report artifact，只基于它写 PR summary 或 risk checklist。
- [ ] Round 5 reload/reopen：刷新后继续追问某个设计细节，验证代码任务记忆。

验收：

- [ ] 修改必须小而通用，有明确 module boundary。
- [ ] 不能改本文件来伪造成功，不能只输出建议不产出 artifact。
- [ ] 如生成 patch 失败，必须有真实 recover action。
- [ ] 最终 evidence 要说明是否需要人工接管本地代码修改。
- [ ] Worker 回写：状态、打勾项、evidence manifest、run/session/artifact refs 已更新到本任务。

### RCG-005 Methodology Review & Experimental Design Agent

状态：todo
Owner：P5
环境：Browser `http://127.0.0.1:5573/`

真实场景：科研用户带着一个初步实验想法，让 SciForge 做方法学审查、power/controls/negative results 风险评估，并迭代成 preregistration-style protocol。

建议主题：`single-cell perturbation screen for drug resistance`、`benchmarking LLM agents for literature triage` 或 `wet-lab validation of a computational biomarker`。

多轮剧本：

- [ ] Round 1 fresh：要求审查实验问题、变量、controls、sample size、bias、failure modes。
- [ ] Round 2 refine：用户给出资源约束，要求重写 protocol。
- [ ] Round 3 critique：要求列出最可能被 reviewer 攻击的 5 个点，并给 mitigation。
- [ ] Round 4 artifact：生成 preregistration/protocol artifact。
- [ ] Round 5 restore：刷新后继续要求生成执行 checklist。

验收：

- [ ] 回答必须包含可执行 protocol，不只是建议清单。
- [ ] 资源约束必须真实影响设计。
- [ ] 多轮后不丢失 hypothesis、controls 和 constraints。
- [ ] Worker 回写：状态、打勾项、evidence manifest、run/session/artifact refs 已更新到本任务。

### RCG-006 Long-Context Delivery & Memory Agent

状态：todo
Owner：P6
环境：Browser `http://127.0.0.1:5673/`

真实场景：模拟一个长科研项目会话，要求 SciForge 跨多个 artifacts 和 follow-up 保持目标、约束、决策记录与交付物一致。

建议任务：`build a mini grant proposal package` 或 `prepare a reproducibility audit package for a computational paper`。

多轮剧本：

- [ ] Round 1 fresh：创建项目 brief，包括目标、背景、deliverables、constraints。
- [ ] Round 2 artifact：生成一个主文档 artifact。
- [ ] Round 3 selected refs：选择主文档，要求生成 budget/timeline/risk register。
- [ ] Round 4 conflicting update：用户改变一个关键约束，要求更新所有相关结论并指出受影响部分。
- [ ] Round 5 reload/reopen：刷新后要求总结最终版本和未解决风险。
- [ ] Round 6 audit：打开或请求 audit/debug，确认 raw details 不污染主结果。

验收：

- [ ] 必须追踪变更影响，不得把旧约束当新结论。
- [ ] Artifact follow-up 必须基于 selected refs。
- [ ] 长上下文压缩后仍要回答具体、准确、可核查。
- [ ] Worker 回写：状态、打勾项、evidence manifest、run/session/artifact refs 已更新到本任务。

## Discovered Task Queue

子进程执行时可以自行发现新任务，但必须按模板写入这里，不能直接把偶发现象塞进代码特例。

模板：

```markdown
### DISC-YYYYMMDD-NNN 简短标题

状态：todo
发现者：P?
证据：URL/run/session/DOM/screenshot/manifest
通用性说明：为什么这不是单个 prompt 或单个 provider 的偶发问题
疑似边界：policy / harness / capability / gateway / AgentServer / Projection / ArtifactDelivery / UI restore / persistence / docs

Todo：
- [ ] 最小复现
- [ ] 定位 root boundary
- [ ] 通用修复
- [ ] targeted tests / browser evidence
- [ ] 更新对应 `RCG-*` / `DISC-*` 打勾状态和 Activity Log
```

当前发现队列：

- 暂无。新并行进程启动后追加。

## 统一 Evidence Schema

每条真实 browser case 至少记录：

- [ ] `owner`、`caseId`、`category`、`url`、`ports`、`workspacePath`、`stateDir`。
- [ ] `runId`、`sessionId`、每轮 prompt、selected refs、artifact ids。
- [ ] DOM 文件、截图、console warning/error summary、network failure summary。
- [ ] `TaskSuccess`、`AnswerQuality`、`UsefulPartial`、`BlockingTruth`、`MultiturnContinuity`、`ProjectionWaitAtTerminal`、`RawLeak`。
- [ ] `T_first_progress`、`T_first_backend_event`、`T_terminal_projection`、`T_readable_answer`、`T_stall_bound`。
- [ ] failure reason 和 suspected root boundary。

质量口径：

- `AnswerQuality=accurate`：具体回答当前问题，正确使用证据/selected refs/provider/tool/artifact，能被 DOM/record/artifact 检查。
- `AnswerQuality=partial`：有有用部分但缺关键结论、证据或交付物。
- `AnswerQuality=diagnostic-only`：只解释系统状态、refs、错误或 recover action，没有完成用户任务。
- `AnswerQuality=failed`：答非所问、空泛、不可读 ref、failed/repair-needed 污染主结果或 raw leak。

速度目标：

- `T_first_progress <= 3s`。
- `T_first_backend_event <= 15s`；超过必须有 visible waiting reason。
- 普通 fresh/continue `T_terminal_projection <= 60s`。
- provider/tool/repair `T_terminal_projection <= 120s`。
- terminal 时 `ProjectionWaitAtTerminal=0`。

## Browser Test Matrix

每轮至少覆盖一个矩阵路径；每个 milestone 至少覆盖前三个。

- [ ] Multiturn Golden Path：fresh 生成准确结果 -> artifact/result -> selected-ref follow-up -> reload/reopen -> 再 follow-up。
- [ ] Provider/tool ready path：ready route 进入 capability-first helper，不生成 raw network / worker endpoint 直连代码。
- [ ] Repair from failure：真实 provider/schema/validation failure 后 recover，repair refs/digests-only 且 bounded。
- [ ] Direct-context-first：Projection/ArtifactDelivery refs 足够时直接回答，不 dispatch AgentServer。
- [ ] Refresh/reopen restore：主结果、recover actions、artifact refs 来自 persisted Projection。
- [ ] Artifact selection：显式选择旧 artifact 后追问，只使用 selected refs。
- [ ] Audit/debug：raw details 可审计但不驱动主结果。
- [ ] Long-context mutation：用户改变约束后，系统更新受影响结论，不把旧约束当事实。

## 验证命令

常用：

```bash
npm run typecheck
npm run smoke:single-agent-runtime-contract
npm run smoke:no-legacy-paths
npm run smoke:web-final-conformance
```

Milestone 完成门：

```bash
npm run verify:single-agent-final
```

Browser 验证必须使用 Codex in-app browser，不用普通 terminal smoke 替代。

## Activity Log

- 2026-05-17 - Orchestrator - 将 2026-05-16 Browser Multiturn Stability Sprint 长任务板归档到 `docs/archive/PROJECT-history-2026-05-16-browser-sprint.md`；重构当前 `PROJECT.md` 为 Real Research & Coding Multiturn Gauntlet，看板包含 P1-P6 真实科研/coding 多轮任务、统一 evidence schema、discovered task queue 和 browser test matrix。
- 2026-05-17 - Orchestrator - 将 milestone gates、RCG-001..006 多轮剧本、验收项、evidence schema、browser test matrix 和 discovered task 模板改为 checklist；新增 Worker 打勾规则，要求 worker 完成每轮/验收后回写勾选状态和 evidence。
- 2026-05-17 - Orchestrator - 新增 Sub-agent Milestone Protocol：每个进程尽可能用 sub agents 并行推进；每个 milestone 完成后更新 `PROJECT.md`、提交并 push GitHub、关闭上一批 sub agents，再启动下一批推进。

## Current Handoff

下一步启动并行进程 P1-P6。每个进程先确认自己的端口、workspace、state/config 隔离，然后尽可能启动一批 sub agents 并行推进对应 `RCG-*` milestone。每个 milestone 完成后：整合 sub agent 结果、更新 `PROJECT.md` 打勾状态和 Activity Log、提交并 push 到 GitHub、关闭上一批 sub agents，再启动下一批 sub agents 推进下一个 milestone。失败时先记录 evidence 和 root boundary，再做通用修复；成功时也要记录 timing、answer quality 和 artifacts。优先让 P1/P2/P3/P4 先各跑一条完整链路，P5/P6 用来扩展方法学和长上下文压力。
