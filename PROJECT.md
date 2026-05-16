# SciForge - PROJECT.md

最后更新：2026-05-17

## 当前目标

用 Codex in-app browser 对 SciForge 进行真实、复杂、多轮的科研与 coding 端到端任务牵引。P1-P6 不是替项目“找通过证据”，而是代替真实用户严格使用、评测和挑战 SciForge：只要网页主回复没有真正解决用户问题，就必须判失败、记录证据、用 sub agents 定位并修复通用根因。

所有修改必须通用：不能为某个 prompt、端口、backend、provider、文件名、论文题目、错误文本或浏览器会话写特例。多轮运行时以 [`docs/SciForge-SingleAgent-Architecture.md`](docs/SciForge-SingleAgent-Architecture.md) 为最终 contract，产品/实现背景参考 [`docs/Architecture.md`](docs/Architecture.md)，harness 行为入口参考 [`docs/AgentHarnessStandard.md`](docs/AgentHarnessStandard.md)。

## 历史归档

- 2026-05-14/15 旧 CAP/PKG/GT/PSM/MEM/H022 与早期稳定性任务：[`docs/archive/PROJECT-history-2026-05-14-15.md`](docs/archive/PROJECT-history-2026-05-14-15.md)。
- 2026-05-16 Browser Multiturn Stability Sprint、PBT/P1/P2/P3/P4/ARC/MTG 长任务板与 issue 细节：[`docs/archive/PROJECT-history-2026-05-16-browser-sprint.md`](docs/archive/PROJECT-history-2026-05-16-browser-sprint.md)。

## 必读边界

实现前先读：

- [`docs/SciForge-SingleAgent-Architecture.md`](docs/SciForge-SingleAgent-Architecture.md)：Workspace Kernel、AgentServer Context Core、Runtime Bridge、Capability Gateway、Projection-only UI、conformance 和长期防污染边界。
- [`docs/Architecture.md`](docs/Architecture.md)：Backend-first / Capability-driven / Harness-governed 方向、`src` 与 `packages` 边界。
- [`docs/AgentHarnessStandard.md`](docs/AgentHarnessStandard.md)：harness runtime、profile、stage hook、contract、trace、merge 规则和行为治理入口。

## 不变原则

- 真实 browser 优先：每个活动进程必须用 Codex in-app browser 完成端到端多轮任务；terminal smoke 只能作为补充验证，不能替代用户可见证据。
- 任务成功优先：`TaskSuccess=true` 必须代表用户问题被准确、完整、可核查地解决；只显示 `satisfied`、只恢复 refs、只无 raw leak、只无 Projection wait 都不是充分条件。
- 反假成功优先：网页里“有回答”不等于成功。如果用户要求调研、下载、阅读全文、写报告、复现实验、修改代码或生成 artifact，主回复必须证明这些动作实际完成、内容是否正确；只给概述、计划、空泛引用、`Verification: 未验证`、recover action、refs 列表或错误包装，全部算 `TaskSuccess=false`。
- 速度不能靠快失败冒充：可以更早展示计划、进度、partial answer 和 recover action，但不能跳过 provider/tool、artifact grounding、verification boundary 或最终质量。
- 所有修复必须通用：修架构薄腰、contract、profile、manifest、Projection、ArtifactDelivery、gateway、policy 或 UI boundary，不写 prompt/provider/session/端口特例。
- Capability 必须成为生成层可执行 authoring contract：已有 ready provider/tool route 时，backend prompt 必须收到标准 helper/API 签名、任务输入字段和可复制 adapter skeleton。
- 多轮记忆边界保持 Single-Agent runtime contract：Workspace Kernel ledger/ref store 是事实源；AgentServer Context Core 负责 retrieval/compaction/handoff；backend 只消费 cache-aware projection/task packet 并按需读取 refs。
- 设计和实现保持同一真相源：代码改变 contract 时同步更新相关设计文档和本文件。
- 代码路径保持唯一真相源：发现冗余链路时删除、合并；旧兼容逻辑若与最终 contract 冲突，默认移除。
- 长文件治理：源码文件超过 1000 行进入 watch list；超过 2000 行优先按职责拆分；超过 3000 行视为维护风险。

## 当前 Milestone：Strict User-Proxy Evaluation Gauntlet

状态：active
总控：Codex Orchestrator
工作分支：`main`

目标：并行启动 P1-P6 独立网页进程，由每个进程代替真实用户严格使用 SciForge。每个进程必须完成“真实任务 -> 严格评测 -> 失败复现 -> sub-agent 通用修复 -> browser 复验 -> 更新 PROJECT.md -> 同步 GitHub”的闭环。历史残余 run、旧 evidence 和旧 `done` 结论不作为本轮成功依据。

### Milestone Gates

- [ ] **Browser E2E Gate**：每个进程必须像真实人类一样在 in-app browser 中点击、查看、选择 artifact、reload 和继续追问；默认直接从 Web UI 与 workspace 产物判断结果，不为每轮维护第二份 evidence。
- [ ] **Lightweight Trace Gate**：每个自主探索 milestone 只需在 `PROJECT.md` 记录结论级信息：用户目标、当前状态、关键 run/session 或 workspace artifact、success/failure reason、root boundary 和下一步。
- [ ] **Escalated Evidence Gate**：只有失败、假成功、修复前后对比、UI 与 workspace 证据不一致、或 milestone 提交前需要验收凭据时，才保存截图/DOM/console/network/timing 等完整 evidence。
- [ ] **Hard Requirements Gate**：每轮先列出用户 hard requirements；只有逐条证明完成，才可判 `TaskSuccess=true`。
- [ ] **Strict Evaluation Gate**：P1-P6 必须代替用户判断主回复是否真的解决问题；“有文字输出但未完成动作”必须判失败。
- [ ] **Root-Cause Gate**：每个 P0/P1 失败必须定位到 policy / harness / capability / gateway / AgentServer / Projection / ArtifactDelivery / UI restore / persistence 边界。
- [ ] **General Fix Gate**：修复后必须证明没有 prompt/provider/task 特例，并补 targeted tests 或 conformance fixture。
- [ ] **Speed Gate**：记录首个有用反馈和最终收敛时间；慢路径必须进入 discovered task。
- [ ] **Sync Gate**：完成一个 milestone 后更新本文件、提交并 push 到 `origin/main`。

### Sub-agent Protocol

- [ ] 每个进程尽可能使用 sub agents 加速推进：browser 复现、代码勘察、root-cause 定位、通用修复、测试补齐、workspace 证据核查可以并行拆分。
- [ ] 每批 sub agents 必须围绕一个明确 milestone 工作；启动前在对应 `P*-TASK` 或 `DISC-*` 下写清目标、owner、预期验收方式。
- [ ] Process owner 负责整合 sub agent 结果，避免多个 sub agents 修改同一文件、重复记录证据或覆盖 workspace 产物。
- [ ] 完成一个 milestone 后，必须更新 `PROJECT.md`、提交并 push GitHub、关闭上一批 sub agents，再启动下一批 sub agents。
- [ ] 可以动态发现新任务、调整中间任务和重排优先级；调整必须服务最终目标：真实用户任务成功率更高、速度更快、修复更通用。
- [ ] 如果 sub agent 发现的问题不是当前 milestone blocker，也要写入 `Discovered Task Queue`，不能用临时代码绕过。

### Worker 打勾规则

- [ ] Worker 认领任务后，将对应状态改为 `in_progress`，并写清本批自主探索目标。
- [ ] 每完成一个有意义的探索 milestone，更新任务状态和结论；不要求每轮都截图、dump DOM 或维护 evidence manifest。
- [ ] 每完成一条验收，立即勾选对应验收项；不能用“后续会补”提前打勾。
- [ ] 发现新通用问题时，追加到 `Discovered Task Queue`，并至少勾选“最小复现”或说明 blocker。
- [ ] 任务全绿后，将状态改为 `done`，在 Activity Log 增加一行摘要，并同步 GitHub。

## 并行进程矩阵

每个进程独立端口、workspace、state 和 config。机器资源不足时先跑 P1-P4，P5/P6 排队。

| 进程 | 严评主题 | UI | Writer | AgentServer | Workspace | State | Config |
|---|---|---:|---:|---:|---|---|---|
| P1 | 今日 arXiv / 全文科研调研 | 5173 | 5174 | 18080 | `workspace/parallel/p1` | `.sciforge/parallel/p1` | `.sciforge/parallel/p1/config.local.json` |
| P2 | 数据分析 / 可复现实验 | 5273 | 5274 | 18180 | `workspace/parallel/p2` | `.sciforge/parallel/p2` | `.sciforge/parallel/p2/config.local.json` |
| P3 | 论文复现 / 代码调试 | 5373 | 5374 | 18280 | `workspace/parallel/p3` | `.sciforge/parallel/p3` | `.sciforge/parallel/p3/config.local.json` |
| P4 | SciForge 自我改进 coding | 5473 | 5474 | 18380 | `workspace/parallel/p4` | `.sciforge/parallel/p4` | `.sciforge/parallel/p4/config.local.json` |
| P5 | 方法学评审 / 实验设计 | 5573 | 5574 | 18480 | `workspace/parallel/p5` | `.sciforge/parallel/p5` | `.sciforge/parallel/p5/config.local.json` |
| P6 | 长上下文记忆 / 交付物迭代 | 5673 | 5674 | 18580 | `workspace/parallel/p6` | `.sciforge/parallel/p6` | `.sciforge/parallel/p6/config.local.json` |

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

P1-P6 不再使用固定剧本。每个进程只给定人类使用者角色和探索方向，由 worker 自主选择真实任务、调整中间任务、提出新问题，并代表用户严格验收 SciForge。任务可以成功，也可以失败；失败更有价值，但必须转化为通用修复或明确 discovered task。

每个进程至少完成一个自主探索 milestone。一个 milestone 的最小闭环是：

- [ ] 选择一个真实用户目标，并写清为什么它属于本进程方向。
- [ ] 用 in-app browser 自然使用 SciForge，不预设“为了通过测试”的提示词。
- [ ] 记录用户 hard requirements，并用网页主回复、artifact、refs、运行结果逐条验收。
- [ ] 判定 `TaskSuccess` 与 `AnswerQuality`，允许判失败。
- [ ] 对失败启动 sub agents：复现、定位、修复、测试、evidence、PROJECT 回写。
- [ ] 完成后更新本文件、提交并 push GitHub、关闭当前 sub agents。

### P1 Human Researcher - Literature / Full-text Discovery

状态：in_progress
Owner：P1
Browser：`http://127.0.0.1:5173/`
证据策略：默认使用 Web UI 与 workspace 直接核查；必要时才升级保存截图/DOM/console/manifest

本批自主探索目标：以真实科研用户身份要求 SciForge 调研今日/最新 arXiv 上 agentic RL 相关论文，明确硬需求为检索来源、论文身份、全文/PDF 获取、证据位置、中文报告 artifact 和后续 selected artifact 追问；若主回复把摘要/计划/未验证文本冒充全文调研，则判 `TaskSuccess=false` 并定位通用边界。

P1-TASK-20260517-agentic-rl-arxiv-fulltext：

- 用户目标：调研 2026-05-17 最近 48 小时 arXiv 上 agentic RL / agentic reinforcement learning 新论文，生成中文报告 artifact。
- Hard requirements：列出检索来源/query、arXiv ID/标题/作者/提交或更新日期/链接；必须打开 PDF/全文并给章节/页码/段落证据；若为空或未读全文必须如实失败；不得把 provider metadata 或摘要冒充完成。
- 首轮严格判定：`TaskSuccess=false`，`AnswerQuality=fake-success`。旧 run `project-literature-evidence-review-mp8tloty-oud91r` / session `session-literature-evidence-review-mp8tihhb-wtv54f` / task `generated-literature-6a700e26bab3` 在 Web UI 显示 `satisfied`，但主回复和 report 只写 `provider-grounded metadata until full-text verification`，verification 为 `unverified`，artifact rows 还混入无关 Crossref 中文教育/党建结果并残留旧 pancreatic/spatial 默认字段。
- Root boundary：Gateway generated-task provider-first recovery adapter 在只拿到 candidate metadata、无全文/PDF/引用验证证据时仍写 `executionUnits.status=done`、`claimType=evidence-matrix`，导致 TaskOutcome/Projection 把未完成科研任务标成 satisfied。
- 通用修复：`src/runtime/gateway/generated-task-runner-generation-lifecycle.ts` 的 deterministic provider-route recovery adapter 现在 fail-closed：metadata-only recovery 输出 `claimType=failed-with-reason`、`executionUnits.status=failed-with-reason`、保留 evidence/report artifacts 为诊断材料，去掉旧领域默认值，并改善 query 抽取以过滤硬要求文本；不含 prompt/端口/provider/论文题目特例。
- Browser 复验：重新启动 P1 后，同类请求恢复到 run `run:task-card:23z332` / session `session-literature-evidence-review-mp8tqrn8-hj97yf` / task `generated-literature-24bfd7f7036b`；Web UI 显示 `运行需要恢复` / `recoverable`，Projection `visibleAnswer.status=repair-needed`，`protocol=protocol-failed; task=needs-work`，reload 后仍保持 recoverable，旧 satisfied 文本未覆盖最新失败状态。
- Workspace refs：`workspace/parallel/p1/.sciforge/sessions/2026-05-16_literature-evidence-review_session-literature-evidence-review-mp8tqrn8-hj97yf/task-results/generated-literature-24bfd7f7036b.json`、`.../task-results/generated-literature-24bfd7f7036b-research-report-provider-recovery.md`、`.../tasks/generated-literature-24bfd7f7036b/.sciforge/generated-tasks/provider-first-recovery-6285a0364c41.py`。
- 验证：`node --import tsx --test src/runtime/gateway/generated-task-runner-generation-lifecycle.test.ts` 通过；`node --import tsx --test src/runtime/gateway/generated-task-runner-output-lifecycle.test.ts src/runtime/gateway/generated-task-runner-execution-lifecycle.test.ts` 通过；`npm run typecheck` 当前失败在既有/并行改动的 `direct-answer-payload.test.ts`、`task-attempt-history.ts`、`appStateModels.test.ts` 等类型问题，非本 P1 修改边界。

P1-TASK-20260517-selected-report-followup：

- 用户目标：选中上一轮 `research-report-provider-recovery` / provider metadata diagnostic artifact 后追问“仅基于选中报告，哪些全文证据已读取、哪些没有读取、下一步如何恢复”，验证 selected artifact follow-up 是否只用被选 artifact。
- Hard requirements：必须明确基于 selected artifact；不得混入旧 satisfied DOM、未选中的最新 artifact 或外部新检索；如果选中报告只有 metadata diagnostic，必须回答“未完成全文阅读/不可判成功”，不能补造 arXiv/PDF 证据。
- 当前状态：准备 browser 复验。

人类角色：一个真实科研用户，希望 SciForge 帮自己完成前沿文献发现、全文阅读、证据整理和研究判断。

探索方向：arXiv / bioRxiv / PubMed / Europe PMC / 论文 PDF / citation grounding / 中文或英文系统报告。

自主任务建议，worker 可自由选择或改写：

- [x] 今日 arXiv 上 agentic RL 相关论文调研、下载、阅读全文、中文总结报告。
- [ ] 某个生物医学主题的最新论文证据矩阵与研究假设生成。
- [ ] 对一组论文 PDF 做对比阅读，输出方法、实验、局限和复现实验建议。

严评重点：

- [x] 不能把摘要阅读冒充全文阅读。
- [x] 不能把 `Verification: 未验证` 或空泛综述算成功。
- [x] 必须证明检索来源、论文身份、全文获取、证据位置和报告 artifact。
- [ ] selected artifact follow-up 必须只基于被选中的报告/论文证据。

### P2 Human Data Scientist - Data Analysis / Reproducibility

状态：in_progress
Owner：P2
Browser：`http://127.0.0.1:5273/`
证据策略：默认使用 Web UI 与 workspace 直接核查；必要时才升级保存截图/DOM/console/manifest

当前自主探索目标（P2，2026-05-17）：作为真实数据科学用户，要求 SciForge 生成一个含 batch/timepoint/treatment 的实验数据集，完成 EDA、统计检验、图表、可复跑脚本和后续基于 selected artifact 的解释；严格检查样本量、效应方向、检验假设、限制、artifact 与复跑命令。

人类角色：一个需要快速分析实验数据并复现结论的数据科学/科研用户。

探索方向：CSV/TSV 数据读取、EDA、统计检验、图表、脚本/notebook、复跑命令、敏感性分析。

自主任务建议，worker 可自由选择或改写：

- [ ] 生成或导入一个含 batch/timepoint/treatment 的实验数据集并分析。
- [ ] 让 SciForge 对一个有 confounder 的数据场景做统计解释和 robustness check。
- [ ] 要求导出可复跑 notebook/script，再基于 selected artifact 解释结论。

严评重点：

- [ ] 不能只有聊天文字，必须有可打开的数据、报告、图表或脚本 artifact。
- [ ] 统计结论必须包含样本量、效应方向、检验假设和限制。
- [ ] 复跑命令必须真实可执行或给出真实 blocker。
- [ ] 图表/报告 follow-up 必须基于 selected artifact 内容。

### P3 Human Reproducer - Paper Reproduction / Code Debug

状态：in_progress
Owner：P3
Browser：`http://127.0.0.1:5373/`
证据策略：默认使用 Web UI 与 workspace 直接核查；必要时才升级保存截图/DOM/console/manifest

人类角色：一个尝试复现论文核心方法、调试失败并判断复现可信度的研究者。

探索方向：最小可运行 demo、代码生成、运行验证、metric consistency、repair loop、ablation/baseline。

本批自主探索目标（P3，2026-05-17）：

- [ ] 真实用户目标：让 SciForge 复现一个 Logistic growth ODE 参数估计 toy experiment，生成最小可运行 Python demo、实际运行、报告拟合指标和复现可信度。
- [ ] Hard requirements：必须生成代码 artifact；必须实际运行或给出真实 blocker；必须报告参数估计、RMSE/误差等 metric；若运行失败必须 bounded repair 并重新验证；最终网页主回复、代码、workspace 产物和指标必须一致。
- [ ] 验收方式：用 in-app browser 在 `http://127.0.0.1:5373/` 自然提交任务、打开/查看产物、选择 artifact 追问复现可信度、reload 后继续追问；必要时保存升级 evidence。
- [ ] Sub-agent 分工：P3 owner 负责 browser 操作和最终严格判定；sidecar agents 并行做 P3 环境/产物核查、失败 root-boundary 定位和 targeted tests 建议。

自主任务建议，worker 可自由选择或改写：

- [ ] 复现一个小型 ODE / optimization / ML toy experiment。
- [ ] 让 SciForge 生成代码后主动运行、发现失败、修复并重新验证。
- [ ] 选择失败报告 artifact，要求判断复现是否成功并提出下一步实验。

严评重点：

- [ ] 不能声称代码可运行但没有运行/验证证据。
- [ ] 指标失败时不能宣称成功。
- [ ] Repair 必须 bounded，不得无限循环。
- [ ] 代码、指标、报告和网页主回复必须一致。

### P4 Human Developer - SciForge Coding / Self-improvement

状态：done
Owner：P4
Browser：`http://127.0.0.1:5473/`
证据策略：默认使用 Web UI 与 workspace 直接核查；必要时才升级保存截图/DOM/console/manifest

本批自主探索目标：以真实开发者身份要求 SciForge 阅读自身 runtime/gateway 与 task-attempt 相关代码，找出一个能提升 coding-agent 交付可信度的通用小改进，形成补丁/测试/PR summary 与 risk checklist；若主回复只给建议、未真实读取代码、未生成可核查 patch 或未说明验证边界，则判 `TaskSuccess=false` 并定位到 gateway / AgentServer / ArtifactDelivery / UI restore 等通用边界。

本轮结论（P4，2026-05-17）：`TaskSuccess=false` / `AnswerQuality=failed` for the Web UI attempt, because run `project-literature-evidence-review-mp8tl06x-50de0d` in session `session-literature-evidence-review-mp8tjlyj-zuo9g4` failed with recoverable `AgentServer generation stopped by convergence guard after 147091 total tokens (limit 80000)` and produced no patch artifact. Browser reload after restart still showed `failed` / `运行需要恢复`, not fake satisfied. P4 owner completed the coding hard requirements directly in repo with a generic runtime contract patch: `TaskAttemptRecord` and `TaskRunCard` now carry `codingDeliverySummary` with read files, planned/modified files, patch refs, verification commands, risk checklist and generality statement; summaries are hydrated from attempt records or task output payloads and projected as durable refs.

P4 验收：

- [x] 真实用户目标：把 SciForge 当 coding agent，要求它阅读自身 task-attempt / task-run-card 代码并生成通用交付可信度补丁。
- [x] Hard requirements：网页主回复未完成 patch，严格判失败；P4 owner 实际读取并修改 `src/runtime/task-attempt-history.ts`、`src/runtime/runtime-types.ts`、`packages/contracts/runtime/task-run-card.ts`、`packages/contracts/runtime/index.ts` 及对应测试。
- [x] 通用修复：新增 `sciforge.coding-delivery-summary.v1` contract，不绑定 prompt、P4、端口、backend 或文件名；非 coding task 可缺省该字段。
- [x] Targeted tests：`npx tsx src/runtime/task-attempt-history.test.ts` 9/9 pass；`npx tsx packages/contracts/runtime/task-run-card.test.ts` 10/10 pass；`npm run typecheck` pass。
- [x] Browser 复验：`http://127.0.0.1:5473/` reload 后原失败 run 仍显示 `failed` / `运行需要恢复`，没有把失败包装成满意结果。
- [x] Sub-agent 勘察完成：direct-answer 伪成功、workspace file containment、repair fixed evidence gate 等非当前 blocker 已进入 Discovered Task Queue。

人类角色：一个把 SciForge 当 coding agent 使用的开发者，要求它阅读本仓库、提出通用改进、实现补丁并说明风险。

探索方向：代码理解、selected file grounding、patch planning、测试生成、PR summary、artifact presentation。

自主任务建议，worker 可自由选择或改写：

- [ ] 让 SciForge 分析某个 runtime/gateway/UI 模块并提出小改进。
- [ ] 让 SciForge 实现一个测试 helper 或修复一个通用边界。
- [ ] 选择 patch/report artifact，要求生成 PR summary 和 risk checklist。

严评重点：

- [x] 不能通过修改 `PROJECT.md` 或输出建议来伪造 coding 成功。
- [x] SciForge 必须真实读取目标代码或 selected file 内容。
- [x] 生成 patch 时必须说明通用性、验证命令和风险。
- [x] 如果需要人工接管，必须给出真实 blocker 和可执行下一步。

### P5 Human Methodologist - Experimental Design / Review

状态：in_progress
Owner：P5
Browser：`http://127.0.0.1:5573/`
证据策略：默认使用 Web UI 与 workspace 直接核查；必要时才升级保存截图/DOM/console/manifest

当前自主探索目标（P5，2026-05-17）：作为真实 PI / 方法学 reviewer，要求 SciForge 审查一个受预算和样本获取限制的 single-cell perturbation biomarker 实验设计，并交付可执行 protocol、reviewer critique、mitigation checklist；严格检查用户约束是否改变设计、controls/bias/failure modes/sample size 假设是否具体、reload 后最终 protocol 与约束是否保持。

人类角色：一个希望 SciForge 帮自己审查实验设计、发现偏差和改写 protocol 的 PI / reviewer / 方法学研究者。

探索方向：hypothesis、controls、sample size、power、bias、negative results、reviewer critique、preregistration protocol。

自主任务建议，worker 可自由选择或改写：

- [ ] 审查一个 single-cell / perturbation / biomarker 实验设计。
- [ ] 给出资源约束，要求 SciForge 重写 protocol。
- [ ] 让 SciForge 生成 reviewer critique、mitigation 和执行 checklist。

严评重点：

- [ ] 不能只有泛泛建议，必须形成可执行 protocol 或 checklist。
- [ ] 用户约束必须真实改变设计。
- [ ] controls、bias、failure modes 和 sample size 假设必须具体。
- [ ] reload 后必须保持最终 protocol 和约束。

### P6 Human Project Owner - Long-context Memory / Deliverable Iteration

状态：in_progress
Owner：P6
Browser：`http://127.0.0.1:5673/`
证据策略：默认使用 Web UI 与 workspace 直接核查；必要时才升级保存截图/DOM/console/manifest

当前自主探索目标（P6，2026-05-17）：作为长期项目 owner，要求 SciForge 多轮构建一个可复现实验 mini grant/research package，包含 brief、决策记录、risk register、timeline/budget、约束变更后的全局更新，以及 reload 后继续追问；严格检查旧约束是否污染新结论、selected artifact follow-up 是否基于选中交付物、audit/raw 是否只作为可审计细节而不污染主回复。

人类角色：一个长期项目 owner，希望 SciForge 跨多轮保留目标、约束、决策记录和交付物，并能处理变更。

探索方向：长上下文、多 artifact、selected refs、约束变更、risk register、reload restore、audit/raw boundary。

自主任务建议，worker 可自由选择或改写：

- [ ] 构建一个 mini grant / reproducibility audit / research package。
- [ ] 多轮生成 brief、主文档、risk register、timeline、budget。
- [ ] 中途改变关键约束，要求 SciForge 更新所有受影响结论。

严评重点：

- [ ] 历史 DOM 成功片段不能覆盖最新 failed/recoverable 主回复。
- [ ] 旧约束不得被当作新事实。
- [ ] selected refs follow-up 必须基于选中 artifact。
- [ ] audit/raw details 可审计但不得污染主结果。

## Discovered Task Queue

子进程执行时可以自行发现新任务，但必须按模板写入这里，不能直接把偶发现象塞进代码特例。

模板：

```markdown
### DISC-YYYYMMDD-NNN 简短标题

状态：todo
发现者：P?
轻量证据：URL 或 workspace 路径、关键 run/session/artifact、用户可见现象、为什么失败
升级证据：仅在需要复现/修复/对比时补 DOM/screenshot/console/network/manifest
通用性说明：为什么这不是单个 prompt 或单个 provider 的偶发问题
疑似边界：policy / harness / capability / gateway / AgentServer / Projection / ArtifactDelivery / UI restore / persistence / docs

Todo：
- [ ] 最小复现
- [ ] 定位 root boundary
- [ ] 通用修复
- [ ] targeted tests / 必要的 browser 复验证据
- [ ] 更新对应任务打勾状态和 Activity Log
```

当前发现队列：

### DISC-20260517-P1-001 Provider metadata recovery was marked satisfied

状态：done
发现者：P1
轻量证据：Browser `http://127.0.0.1:5173/`；失败 run `project-literature-evidence-review-mp8tloty-oud91r` / session `session-literature-evidence-review-mp8tihhb-wtv54f` / task `generated-literature-6a700e26bab3`；用户可见现象为全文/PDF arXiv 调研请求被 `satisfied`，但主回复只说明 candidate provider metadata，verification 为 `unverified`，workspace artifact 含无关 Crossref metadata。
升级证据：修复后 run `run:task-card:23z332` / session `session-literature-evidence-review-mp8tqrn8-hj97yf` / task `generated-literature-24bfd7f7036b`；Web UI 与 workspace Projection 均为 `repair-needed` / `protocol-failed; task=needs-work`，reload 后仍 recoverable。
通用性说明：任何 provider-first recovery adapter 只获得 metadata、无全文/PDF/引用验证证据时都不能关闭科研任务；问题不依赖 agentic RL、arXiv 日期、Crossref、端口或具体 prompt。
疑似边界：gateway / verification / Projection / ArtifactDelivery

Todo：
- [x] 最小复现
- [x] 定位 root boundary
- [x] 通用修复
- [x] targeted tests / 必要的 browser 复验证据
- [x] 更新对应任务打勾状态和 Activity Log

### DISC-20260517-P4-002 Plain coding prose can be wrapped as satisfied without patch evidence

状态：todo
发现者：P4
轻量证据：P4 sub-agent code review；`src/runtime/gateway/direct-answer-payload.ts` 的 plain text recovery can wrap ordinary backend prose as a ToolPayload with done/completed status, while coding prompts may lack `codeRef` / `diffRef` / `patchRefs` / `workEvidence`.
升级证据：未保存额外 DOM；当前 P4 browser run already failed instead of fake success, so this is a forward hardening task.
通用性说明：任何 coding/repair/PR-summary task that receives plain text like “fixed it” can be over-promoted unless completion requires durable patch/test evidence; not tied to P4 prompt, backend, or file names.
疑似边界：gateway / verification / ArtifactDelivery / Projection

Todo：
- [ ] 最小复现
- [ ] 定位 root boundary
- [ ] 通用修复
- [ ] targeted tests / 必要的 browser 复验证据
- [ ] 更新对应任务打勾状态和 Activity Log

### DISC-20260517-P4-003 Workspace file API needs active-workspace containment for write actions

状态：todo
发现者：P4
轻量证据：P4 sub-agent code review；`src/runtime/server/workspace-file-api.ts` write/action routes resolve submitted paths directly, while coding-agent evidence depends on writes being inside the active workspace and auditable.
升级证据：未执行 destructive browser/file repro；needs targeted API smoke with temporary workspace paths.
通用性说明：Any workspace write/delete/rename route can affect trust in generated patch/artifact evidence if path containment is not enforced; not specific to SciForge self-improvement prompt.
疑似边界：workspace / gateway / persistence

Todo：
- [ ] 最小复现
- [ ] 定位 root boundary
- [ ] 通用修复
- [ ] targeted tests / 必要的 browser 复验证据
- [ ] 更新对应任务打勾状态和 Activity Log

## 工作记录与证据策略

默认策略：worker 像真实用户一样直接在 Web UI 和 workspace 中查证据，不为每轮维护第二份 evidence。`PROJECT.md` 只记录任务管理和交接所需的结论级信息。

轻量记录，每个自主探索 milestone 至少写：

- [ ] owner / 进程 / URL 或 workspace。
- [ ] 用户目标和 hard requirements。
- [ ] 当前结论：`TaskSuccess`、`AnswerQuality`、success/failure reason。
- [ ] 关键 run/session/artifact 或 workspace 路径，仅记录足够后续找到上下文的信息。
- [ ] root boundary 或下一步假设。

升级记录，仅在以下情况保存 DOM/screenshot/console/network/timing/manifest：

- [ ] 出现失败、假成功或用户可见体验异常，需要交给 sub agents 复现。
- [ ] 修复前后需要对比。
- [ ] Web UI 与 workspace 产物、records 或 artifacts 不一致。
- [ ] milestone 准备提交/同步前，需要留下简短验收凭据。
- [ ] 问题涉及性能、stall、console error、network failure 或 reload/restore。

质量口径：

- `AnswerQuality=accurate`：具体回答当前问题，正确使用证据/selected refs/provider/tool/artifact，能被 DOM/record/artifact 检查。
- `AnswerQuality=partial`：有有用部分但缺关键结论、证据或交付物。
- `AnswerQuality=diagnostic-only`：只解释系统状态、refs、错误或 recover action，没有完成用户任务。
- `AnswerQuality=fake-success`：网页主回复有完整段落或看似有报告，但没有完成用户 hard requirements，例如未搜索当天来源、未下载/阅读全文、未运行代码、未生成要求的 artifact、未验证结论或只写“未验证”。`fake-success` 必须对应 `TaskSuccess=false`。
- `AnswerQuality=failed`：答非所问、空泛、不可读 ref、failed/repair-needed 污染主结果或 raw leak。

速度目标：

- `T_first_progress <= 3s`。
- `T_first_backend_event <= 15s`；超过必须有 visible waiting reason。
- 普通 fresh/continue `T_terminal_projection <= 60s`。
- provider/tool/repair `T_terminal_projection <= 120s`。
- terminal 时 `ProjectionWaitAtTerminal=0`。

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

- 2026-05-17 - P4 - 完成 `P4 Human Developer - SciForge Coding / Self-improvement` strict-eval/fix/browser-recheck 闭环：真实 Browser 在 `http://127.0.0.1:5473/` 提交 SciForge self-improvement coding 任务，run `project-literature-evidence-review-mp8tl06x-50de0d` / session `session-literature-evidence-review-mp8tjlyj-zuo9g4` 因 AgentServer generation convergence guard 停止而严格判 `TaskSuccess=false` / `AnswerQuality=failed`，reload 后仍显示 `failed` / `运行需要恢复` 而非 fake satisfied。P4 owner 实现通用 `codingDeliverySummary` contract，TaskAttempt/TaskRunCard 可保留 readFiles、planned/modified files、patchRefs、verificationCommands、riskChecklist 与 generalityStatement，并从 output payload hydrate。验证 `npx tsx src/runtime/task-attempt-history.test.ts`、`npx tsx packages/contracts/runtime/task-run-card.test.ts`、`npm run typecheck` 通过。追加 `DISC-20260517-P4-002` 与 `DISC-20260517-P4-003`。
- 2026-05-17 - P1 - 完成 `P1-TASK-20260517-agentic-rl-arxiv-fulltext` strict-eval 闭环：真实 Browser 请求最近 48 小时 arXiv agentic RL 全文/PDF 中文报告，首轮判 `TaskSuccess=false` / `AnswerQuality=fake-success`，因为 provider-first recovery 只产出 metadata/unverified 仍被标 `satisfied`；修复 `generated-task-runner-generation-lifecycle` 的 deterministic provider-route recovery adapter，使 metadata-only recovery 输出 `failed-with-reason` 诊断而非完成态，并去除旧领域默认字段。复验 run `run:task-card:23z332` / session `session-literature-evidence-review-mp8tqrn8-hj97yf` / task `generated-literature-24bfd7f7036b` 在 Web UI 和 reload 后均为 `repair-needed` / recoverable。验证 `node --import tsx --test src/runtime/gateway/generated-task-runner-generation-lifecycle.test.ts`、`node --import tsx --test src/runtime/gateway/generated-task-runner-output-lifecycle.test.ts src/runtime/gateway/generated-task-runner-execution-lifecycle.test.ts` 通过；`npm run typecheck` 当前失败在既有/并行 TS 问题，非 P1 修改边界。关闭 `DISC-20260517-P1-001`。
- 2026-05-17 - Orchestrator - 按用户要求将 Browser E2E / evidence 规则改为轻量策略：worker 默认像真实人类一样直接在 Web UI 和 workspace 查证据，`PROJECT.md` 只记录结论级任务管理信息；只有失败、假成功、修复对比、UI/workspace 不一致或提交验收时才升级保存截图/DOM/console/network/manifest。
- 2026-05-17 - Orchestrator - 按用户要求将 P1-P6 从固定剧本改为开放式人类使用者角色：只保留探索方向、严评重点和自主 milestone 闭环，允许 worker 主动探索、调整任务、发现新问题并用 sub agents 修复。
- 2026-05-17 - Orchestrator - 应用户要求重写 `PROJECT.md` 当前任务板：删除 P1-P6 历史 run/evidence/旧 discovered task 残余，只保留原则、协议、端口矩阵、统一 evidence schema 和验证口径；重建 P1-P6 strict user-proxy evaluation 任务。

## Current Handoff

P1 与 P4 已完成本轮 strict-eval/fix/reverify 闭环，下一步由 P2/P3/P5/P6 继续各自 strict-eval 批次，或由 P4 开启下一条 coding task 时优先覆盖 direct-answer coding evidence guard 与 workspace file containment discovered tasks。每个进程继续按对应人类角色自由探索 SciForge；不要把任务剧本定死，也不要为了通过验收而写提示词。Worker 默认直接在 Web UI 点击查看、选择 artifact、reload、继续追问，并从 workspace 产物/records 中查证据；不要为每轮维护第二份 evidence。只有失败、假成功、修复对比、UI/workspace 不一致或 milestone 提交验收时，才升级保存截图/DOM/console/network/manifest。每个 milestone 结束后更新本文件、提交并 push GitHub、关闭上一批 sub agents，再启动下一批。
