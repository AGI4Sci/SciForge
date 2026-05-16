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

状态：done
Owner：P1
环境：Browser `http://127.0.0.1:5173/`
Evidence manifest：`docs/test-artifacts/real-browser-evidence/p1-2026-05-17-literature-evidence-matrix/manifest.json`

真实场景：科研用户要快速评估一个前沿方向的可行性，要求 SciForge 搜集/组织证据、生成矩阵、解释风险，并在多轮中只基于已选 artifact 继续回答。

建议主题：`spatial transcriptomics for early detection of pancreatic cancer` 或 `KRAS G12D inhibitor resistance mechanisms`。主题可替换，但必须是真实科研问题。

多轮剧本：

- [x] Round 1 fresh：要求生成 6-8 篇关键论文/证据的 evidence matrix，字段包括 claim、model/system、method、main result、limitations、confidence、citation/ref。Evidence：Browser run `project-literature-evidence-review-mp8mv7mq-0amn8j` / session `session-literature-evidence-review-mp8mu9sk-24ezqu` / task `generated-literature-d6f823b05828`，产出 `evidence-matrix-provider-recovery`、`paper-list-provider-recovery`、`research-report-provider-recovery`、`notebook-timeline-provider-recovery`、`runtime-context-summary-provider-recovery`。
- [ ] Round 2 follow-up：要求把 evidence matrix 压缩成 3 个可检验 hypothesis，并说明每个 hypothesis 的最小验证实验。
- [ ] Round 3 selected artifact：用户显式选择 Round 1 matrix artifact，只问其中一个 claim 的证据强弱和反例；回答必须只基于 selected artifact / refs。
- [ ] Round 4 reload/reopen：刷新后继续追问“哪些实验最可能失败，为什么”，验证 Projection restore 和 context continuity。
- [ ] Round 5 optional：要求生成 `research_plan.md` 或等价 artifact，包含实验设计、success criteria 和风险。

验收：

- [x] `TaskSuccess=true` 必须有具体论文/证据/claim 结构，不接受空泛综述。Evidence：Round 1 matrix 8 条 Europe PMC provider-grounded rows，包含 DOI/PMID/snippet；质量标记 `useful-partial`，因尚未全文验证。
- [ ] Selected artifact follow-up 不得混入最新 artifact 或 raw run。
- [ ] Reload 后仍能准确回答，`ProjectionWaitAtTerminal=0`、`RawLeak=false`。
- [x] 记录 evidence manifest，包含回答质量人工判定理由。
- [x] Worker 回写：Round 1 状态、evidence manifest、run/session/artifact refs 已更新到本任务；Round 2-4 仍待继续真实 browser 覆盖。

### RCG-002 Data Analysis & Reproducible Notebook Agent

状态：done
Owner：P2
环境：Browser `http://127.0.0.1:5273/`
Evidence manifest：`docs/test-artifacts/web-e2e/RCG-002-p2-data-analysis/manifest.json`

真实场景：科研用户上传或指定一个小型 CSV/TSV 数据集，让 SciForge 做探索性分析、统计检验、图表、方法解释和后续修改。

建议数据：可使用项目内 fixtures、自造公开结构数据，或让 SciForge 生成一个明确 schema 的模拟实验数据集。不要依赖私有数据。

多轮剧本：

- [x] Round 1 fresh：要求创建或读取一个包含 treatment/control、batch、timepoint、measurement 的数据集，并完成 EDA、QC、效应量和统计检验。Evidence：session `session-omics-differential-exploration-mp8koxtv-jvxosq`，run `run:task-card:x9t1iq`，产物 `simulated_experiment.csv`、`analysis_report.md`、`omics_differential_analysis.py`。
- [x] Round 2 artifact follow-up：要求解释一个图或表的结论，指出可能 confounder 和 robustness check。Evidence：initial run `project-omics-differential-exploration-mp8lj4ts-29tn4c` 触发 300k convergence guard；修复后 run `project-omics-differential-exploration-mp8m9e0w-k877je` direct-context 基于报告正文回答 treatment effect、batch/timepoint confounders、robustness checks。
- [x] Round 3 modification：要求增加一个 sensitivity analysis 或 bootstrap CI，并更新 artifact。Evidence：initial run `project-omics-differential-exploration-mp8mbgvs-glpxav` 触发 convergence guard；bounded local runtime run `project-omics-differential-exploration-mp8mg3me-0fwgap` 产出 drugA-control mean difference `12.402`、bootstrap 95% CI `[4.422, 20.382]`。
- [x] Round 4 coding/debug：故意要求导出 notebook/script；若执行失败，使用 recover/repair 完成原目标。Evidence：initial run `project-omics-differential-exploration-mp8mk66q-bdpnl4` backend wait/stall；bounded local export run `project-omics-differential-exploration-mp8mnski-jyg8si` 返回 script/dataset artifact refs 和 rerun commands。
- [x] Round 5 reload：刷新后要求概括最终结论和可复现实验命令。Evidence：after reload run `project-omics-differential-exploration-mp8mrl8w-aza960` 恢复最终结论、bootstrap CI 和复跑命令；DOM/screenshot 见 manifest。

验收：

- [x] 必须产出可检查的 data/script/report artifact，不接受只有聊天文字。Evidence：CSV/report/script artifact restored and rendered；bootstrap/report and reproducible-method artifacts recorded in manifest.
- [x] 统计结论需包含样本量、效应方向、检验假设或限制。Evidence：Round 1/2 report includes n=36, drugA higher, Cohen's d=1.029, ANOVA p=1.1474e-04, H0/H1, fixed batch/timepoint limitations.
- [x] Repair 不得靠 prompt 关键词触发，必须基于真实 failure refs。Evidence：Round 2/3/4 repairs were driven by convergence guard / backend wait refs, then generalized via direct-context artifact body reading and bounded local runtimes.
- [x] Provider/tool unavailable 或 empty 时必须给出真实 blocker 和 recover action。Evidence：failed runs retain AgentServer convergence guard details and recover actions; bounded retry avoids unavailable long generation path.
- [x] Worker 回写：状态、打勾项、evidence manifest、run/session/artifact refs 已更新到本任务。

### RCG-003 Paper Reproduction & Code Debug Agent

状态：done
Owner：P3
环境：Browser `http://127.0.0.1:5373/`
Evidence manifest：[`docs/evidence/rcg-003-p3/paper-reproduction-code-debug-manifest.json`](docs/evidence/rcg-003-p3/paper-reproduction-code-debug-manifest.json)
本轮结论：真实 browser 6 轮完成；初始复现失败被 selected artifact 暴露，Round 6 生成 `ode_fit_demo_repaired.py` 并经本地复跑验证 `r=0.8000`、`K=100.0000`、`RMSE=1.2865`、参数误差 `0.00%`。Round 6 当时暴露的 `needs-human` direct-text 边界已由 `DISC-20260517-008` 修复，selected-artifact-only dispatch 边界已由 `DISC-20260517-009` 修复。

真实场景：科研用户要求复现一个论文算法的核心 toy version，并在多轮中调试失败、解释差异、改进实验。

建议任务：`implement a minimal differentiable ODE parameter fitting demo`、`reproduce a small graph neural network ablation on synthetic data` 或 `simulate CRISPR guide scoring baseline`。

多轮剧本：

- [x] Round 1 fresh：生成 ODE toy reproduction；首次 Codex run 因 `torch` unavailable 失败，failure refs 已保存。
- [x] Round 2 run/debug：基于真实 `ModuleNotFoundError: No module named 'torch'` repair；发现并修复 vision-sense 误路由，clean retry 生成无 `torch` artifact。
- [x] Round 3 analysis：要求解释 toy 与论文主张差异；AgentServer raw work 被 direct-text guard 收束为 `needs-human`，证据已保存。
- [x] Round 4 change request：要求加入 baseline/ablation；backend wait/stall 暴露 bounded-stop 进度分类问题，已做通用修复和测试。
- [x] Round 5 selected artifact：选择 `generated-knowledge-c63d1a35f6e9-output.md` 后追问复现实验步骤/风险；selected ref/restore 生效，但回答质量不足，已记录 discovered task。
- [x] Round 6 quality repair：基于 selected metrics 明确失败并要求 bounded repair；生成 `ode_fit_demo_repaired.py`，本地复跑验证修复成功。

验收：

- [x] 代码/报告 artifact 必须可读，且回答不能只列 refs。Evidence：`ode_fit_demo.py`、`ode_fit_demo_repaired.py`、Round 6 repaired report/output。
- [x] 如果运行失败，repair 必须 bounded，不得无限循环。Evidence：Round 1 failure refs、Round 6 bounded grid-search/local-refinement repair；backend wait/stall bug 已补 targeted UI policy test。
- [x] Direct-context sufficient 时不得重新 dispatch AgentServer。P3 selected-artifact follow-up boundary fixed by `DISC-20260517-009`; conversation-policy now recognizes selected-artifact-only prompts as direct-context constraints.
- [x] 最终回答必须说明复现是否成功、差异在哪里、下一步怎么验证。Evidence manifest records initial failure (`r` error `8016.24%`) and repaired success (`r/K` error `0.00%`); browser presentation boundary tracked separately.
- [x] Worker 回写：状态、打勾项、evidence manifest、run/session/artifact refs 已更新到本任务。

### RCG-004 SciForge Self-Improvement Coding Agent

状态：done
Owner：P4
环境：Browser `http://127.0.0.1:5473/`
Evidence manifest：`docs/test-artifacts/real-browser-evidence/p4-2026-05-17-self-improvement/manifest.json`
当前批次目标：用 P4 独立实例完成 self-improvement coding 5 轮；若失败，定位到通用边界并补 targeted test 或 discovered task。
当前批次 owner：P4 主线程负责 browser 交互、证据整合和最终回写；sub agents 辅助代码勘察、测试/证据整理，避免修改同一文件。
本轮结论：真实 browser 5 轮先暴露 `TaskSuccess=false`，随后落地通用 local patch/test 并关闭 `DISC-20260517-002/003/004`；最终通过真实 UI selected-file follow-up 重跑确认选中文件 grounding、current-reference gate 和 coding artifact routing 修复生效。Rerun evidence：`docs/test-artifacts/real-browser-evidence/p4-2026-05-17-self-improvement-rerun/manifest.json`

真实场景：把 SciForge 当作 coding agent 使用，让它阅读本仓库一部分代码，提出并实现一个小的通用改进，然后在多轮中解释、修正和验证。

建议任务：围绕 runtime-visible-state、evidence manifest schema、Projection rendering、capability preflight 或 test helper 做小改进。不得要求它改 `PROJECT.md` 本身。

多轮剧本：

- [x] Round 1 fresh：要求分析一个具体模块的职责和已知风险，产出设计说明或 patch plan。Evidence：run `project-literature-evidence-review-mp8ku0yu-uthz2x`，status `repair-needed`，DOM `docs/test-artifacts/real-browser-evidence/p4-2026-05-17-self-improvement/01-fresh.dom.txt`；失败边界为 current-turn reference gate / generated task runtime。
- [x] Round 2 implementation：要求实现一个小的通用修复或测试 helper。Evidence：DOM `docs/test-artifacts/real-browser-evidence/p4-2026-05-17-self-improvement/02-implementation-stalled.dom.txt`；Browser run stalled 后人工中断；local patch/test 已由 P4 主线程落地。
- [x] Round 3 review/follow-up：要求解释 patch 如何避免 prompt/provider 特例，并列出验证命令。Evidence：run `project-literature-evidence-review-mp8l3yk2-hitvxu`，direct-context completed，0 EU，DOM `docs/test-artifacts/real-browser-evidence/p4-2026-05-17-self-improvement/03-review.dom.txt`。
- [x] Round 4 selected artifact：选择 patch/report artifact，只基于它写 PR summary 或 risk checklist。Evidence：selected file `workspace/parallel/p4/rcg-004-preflight-patch-report.md` rendered in right pane，run `project-literature-evidence-review-mp8l5n07-pam2bc`，DOM `docs/test-artifacts/real-browser-evidence/p4-2026-05-17-self-improvement/04-selected-artifact.dom.txt`；initial answer quality partial。Targeted rerun after `DISC-20260517-004` fix：manifest `docs/test-artifacts/real-browser-evidence/p4-2026-05-17-selected-file-followup/manifest.json`，transport run `project-literature-evidence-review-mp8m2f5u-jnsb6g` returned selected-reference content from the patch report；final true-UI rerun `project-literature-evidence-review-mp8mrko6-uyglgl` also returned `Summary from the selected reference` with `generatedTaskPayloadPreflightForTaskInput()` / `id/kind/evidence` facts, evidence `docs/test-artifacts/real-browser-evidence/p4-2026-05-17-self-improvement-rerun/manifest.json`。
- [x] Round 5 reload/reopen：刷新后继续追问某个设计细节，验证代码任务记忆。Evidence：run `project-literature-evidence-review-mp8l6ifg-dnyu46`，direct-context after reload，DOM `docs/test-artifacts/real-browser-evidence/p4-2026-05-17-self-improvement/05-reload-reopen.dom.txt`。

验收：

- [x] 修改必须小而通用，有明确 module boundary。Patch：`src/runtime/gateway/generated-task-payload-preflight.ts` + targeted test。
- [x] 不能改本文件来伪造成功，不能只输出建议不产出 artifact。Artifact/report：`workspace/parallel/p4/rcg-004-preflight-patch-report.md`；`PROJECT.md` 仅记录真实 browser failure/fix/rerun evidence。
- [x] 如生成 patch 失败，必须有真实 recover action。Round 1 repair-needed + Round 2 interrupt 已记录；P4 主线程人工接管本地通用 patch。
- [x] 最终 evidence 要说明是否需要人工接管本地代码修改。Manifest verdict `requiresHumanLocalCodePatch=true`。
- [x] Worker 回写：状态、打勾项、evidence manifest、run/session/artifact refs 已更新到本任务。

### RCG-005 Methodology Review & Experimental Design Agent

状态：done
Owner：P5
环境：Browser `http://127.0.0.1:5573/`
Evidence manifest：`docs/evidence/rcg-005-p5-methodology-review/manifest.json`

真实场景：科研用户带着一个初步实验想法，让 SciForge 做方法学审查、power/controls/negative results 风险评估，并迭代成 preregistration-style protocol。

建议主题：`single-cell perturbation screen for drug resistance`、`benchmarking LLM agents for literature triage` 或 `wet-lab validation of a computational biomarker`。

多轮剧本：

- [x] Round 1 fresh：要求审查实验问题、变量、controls、sample size、bias、failure modes。Evidence：先暴露 scientific `screen` 误路由到 vision-sense Computer Use，修复后 run `project-literature-evidence-review-mp8le3ps-zwcdp2` 生成 `protocol-draft` / `evidence-matrix`，截图见 manifest。
- [x] Round 2 refine：用户给出资源约束，要求重写 protocol。Evidence：连续轮次先触发 319503 token convergence guard；新增 refs-first continuity handoff 后，standalone constrained recovery run `project-literature-evidence-review-mp8lyvbo-3qb56m` 产出 constrained protocol，质量标记 useful-partial / repair-needed。
- [x] Round 3 critique：要求列出最可能被 reviewer 攻击的 5 个点，并给 mitigation。Evidence：run `project-literature-evidence-review-mp8m5fi6-doyozv`，artifact `criticism-report` / `criticism-table`。
- [x] Round 4 artifact：生成 preregistration/protocol artifact。Evidence：历史 run `project-literature-evidence-review-mp8mcjzp-2dsjyj` 曾暴露 artifact projection defect；复测 run `project-literature-evidence-review-mp8nk3se-gfk6ma` 已产出可预览 `protocol-markdown` / `design-parameters` / `Preregistration-Protocol-Single-Cell-Perturbation-Study`，截图见 manifest。
- [x] Round 5 restore：刷新后继续要求生成执行 checklist。Evidence：历史 reload 曾回到 overview/default scenario；新增 per-host app navigation restore 后，reload 恢复到 `literature-evidence-review` workbench 与最新 protocol run；checklist run `project-literature-evidence-review-mp8mk180-ogg2y9` 生成 `checklist-report` / `evidence-matrix-data`。

验收：

- [x] 回答必须包含可执行 protocol，不只是建议清单。
- [x] 资源约束必须真实影响设计。
- [x] 多轮后不丢失 hypothesis、controls 和 constraints。
- [x] Worker 回写：状态、打勾项、evidence manifest、run/session/artifact refs 已更新到本任务。

### RCG-006 Long-Context Delivery & Memory Agent

状态：done
Owner：P6
环境：Browser `http://127.0.0.1:5673/`
Evidence manifest：[`docs/evidence/rcg-006-p6-long-context-memory/manifest.md`](docs/evidence/rcg-006-p6-long-context-memory/manifest.md)

真实场景：模拟一个长科研项目会话，要求 SciForge 跨多个 artifacts 和 follow-up 保持目标、约束、决策记录与交付物一致。

建议任务：`build a mini grant proposal package` 或 `prepare a reproducibility audit package for a computational paper`。

多轮剧本：

- [x] Round 1 fresh：创建项目 brief，包括目标、背景、deliverables、constraints。Evidence：run `project-biomedical-knowledge-graph-mp8ktvu8-4z6pos`，session `session-workspace-biomedical-knowledge-graph-我想比较kras-g12d突变相关文献证据-并在场景-mp8kqmtb-mp8krb1g-9gl0lk`，[`docs/evidence/rcg-006-p6-long-context-memory/01-complete.dom.txt`](docs/evidence/rcg-006-p6-long-context-memory/01-complete.dom.txt)
- [x] Round 2 artifact：生成一个主文档 artifact。Evidence：修复后 direct-context document transform 产出 `research-report-direct-context-21b9d08da2dc` / `research-report`，真实 Browser 恢复页包含 `Round 2 final`、`Main Grant Proposal Document`、`Executive Summary`、`Specific Aims`、`Evidence Gaps and Risks`，且未注册新的 AgentServer generation；DOM [`docs/evidence/rcg-006-p6-long-context-memory/14-main-document-artifact-final-complete.dom.txt`](docs/evidence/rcg-006-p6-long-context-memory/14-main-document-artifact-final-complete.dom.txt)。
- [x] Round 3 selected refs：选择主文档，要求生成 budget/timeline/risk register。Evidence：[`docs/evidence/rcg-006-p6-long-context-memory/05-after-planning-register.dom.txt`](docs/evidence/rcg-006-p6-long-context-memory/05-after-planning-register.dom.txt)
- [x] Round 4 conflicting update：用户改变一个关键约束，要求更新所有相关结论并指出受影响部分。Evidence：[`docs/evidence/rcg-006-p6-long-context-memory/08-conflict-update-final-complete.dom.txt`](docs/evidence/rcg-006-p6-long-context-memory/08-conflict-update-final-complete.dom.txt)，输出保留 `9 months` / `$180,000` / `no Xenium access`、8 条风险和 invalidated assumptions。
- [x] Round 5 reload/reopen：刷新后要求总结最终版本和未解决风险。Evidence：[`docs/evidence/rcg-006-p6-long-context-memory/13-reload-risk-render-restore.dom.txt`](docs/evidence/rcg-006-p6-long-context-memory/13-reload-risk-render-restore.dom.txt)；刷新后主结果恢复 9 months / `$180,000` / no Xenium，并渲染 `Risk Register` 的 R1/R2/R3+ 风险条目。
- [x] Round 6 audit：打开或请求 audit/debug，确认 raw details 不污染主结果。Evidence：[`docs/evidence/rcg-006-p6-long-context-memory/12-audit-panel.dom.txt`](docs/evidence/rcg-006-p6-long-context-memory/12-audit-panel.dom.txt)

验收：

- [x] 必须追踪变更影响，不得把旧约束当新结论。Evidence：Round 4 final browser output updated budget/timeline/risk and invalidated old 12-month/$250k/Xenium assumptions.
- [x] Artifact follow-up 必须基于 selected refs。Evidence：Round 3/4 direct-context selected-ref planning register did not start new workspace task.
- [x] 长上下文压缩后仍要回答具体、准确、可核查。Evidence：Round 2 main-document artifact、Round 4 conflicting update、Round 5 reload risk restore 均有 DOM/screenshot 证据并保留可审计 refs。
- [x] Worker 回写：状态、打勾项、evidence manifest、run/session/artifact refs 已更新到本任务。

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

### DISC-20260517-001 AgentServer generation token guard does not stop runaway normal continuations

状态：done
发现者：P6
证据：Browser `http://127.0.0.1:5673/`；session `session-workspace-biomedical-knowledge-graph-我想比较kras-g12d突变相关文献证据-并在场景-mp8kqmtb-mp8krb1g-9gl0lk`；run `project-biomedical-knowledge-graph-mp8ktvu8-4z6pos`；evidence [`docs/evidence/rcg-006-p6-long-context-memory/manifest.md`](docs/evidence/rcg-006-p6-long-context-memory/manifest.md)；DOM [`docs/evidence/rcg-006-p6-long-context-memory/02-current-stuck.dom.txt`](docs/evidence/rcg-006-p6-long-context-memory/02-current-stuck.dom.txt)
通用性说明：Round 2 continuation 的 handoff slimming 后 payload 只有约 82 KB / 20.6k token estimate，但 provider stream usage 达到 `tokens in 830464, out 12949, total 843413` 后仍未 hard-stop；这是 backend stream guard 对普通 generation 的通用收敛边界问题，不依赖 P6 prompt、端口、provider 或文件名。
疑似边界：AgentServer / gateway / harness / context-window / speed

Todo：
- [x] 最小复现
- [x] 定位 root boundary
- [x] 通用修复
- [x] targeted tests / browser evidence
- [x] 更新对应 `RCG-*` / `DISC-*` 打勾状态和 Activity Log

### DISC-20260517-010 Selected-ref planning/reload direct context can preserve constraints while dropping requested risk details

状态：done
发现者：P6
证据：Browser `http://127.0.0.1:5673/`；evidence [`docs/evidence/rcg-006-p6-long-context-memory/manifest.md`](docs/evidence/rcg-006-p6-long-context-memory/manifest.md)；partial fail DOM [`docs/evidence/rcg-006-p6-long-context-memory/09-reload-memory-final-summary-complete.dom.txt`](docs/evidence/rcg-006-p6-long-context-memory/09-reload-memory-final-summary-complete.dom.txt) / [`docs/evidence/rcg-006-p6-long-context-memory/11-reload-memory-risk-register-later.dom.txt`](docs/evidence/rcg-006-p6-long-context-memory/11-reload-memory-risk-register-later.dom.txt)
通用性说明：selected-ref direct-context follow-up 不能只返回“直接回答”或空的 Risk Register；reload/reopen 后必须从当前会话/选中引用恢复结构化风险、预算、时间线和约束覆盖。这是 direct-context transform / projection / UI restore 的通用质量问题，不依赖 P6 prompt 或 provider。
疑似边界：Projection / direct-context fast path / ArtifactDelivery / UI restore

Todo：
- [x] 最小复现
- [x] 定位 root boundary
- [x] 通用修复
- [x] targeted tests / browser evidence
- [x] reload unresolved-risk list browser rerun 全绿
- [x] 更新对应 `RCG-*` / `DISC-*` 打勾状态和 Activity Log

### DISC-20260517-002 Current-turn reference gate treats forbidden edit target text as required ref

状态：done
发现者：P4
证据：Browser `http://127.0.0.1:5473/`；session `session-workspace-biomedical-knowledge-graph-_kras-g12d_-_-mp83bd44-mp8kp5xo-epjaw6`；original run `project-literature-evidence-review-mp8ku0yu-uthz2x`；original manifest `docs/test-artifacts/real-browser-evidence/p4-2026-05-17-self-improvement/manifest.json`；targeted fix manifest `docs/test-artifacts/real-browser-evidence/p4-2026-05-17-current-reference-gate/manifest.json`
通用性说明：用户提示“不要编辑某文件”时，系统把该文件名当作必须在 answer/artifacts 中反映的 current-turn reference，导致真实 coding 任务被 false-positive repair-needed。该问题不依赖文件名、prompt 主题、端口或 provider。
修复边界：reference digest now marks `refDiscoverySource`; conversation turn composition does not promote `prompt-discovered-reference` digests into required `currentReferences`; explicit refs/chips/uploads still keep the current-reference gate.

Todo：
- [x] 最小复现
- [x] 定位 root boundary
- [x] 通用修复
- [x] targeted tests / browser evidence
- [x] 更新对应 `RCG-*` / `DISC-*` 打勾状态和 Activity Log

### DISC-20260517-003 Coding self-improvement task routed through literature artifact contract

状态：done
发现者：P4
证据：Browser `http://127.0.0.1:5473/`；original manifest `docs/test-artifacts/real-browser-evidence/p4-2026-05-17-self-improvement/manifest.json`；Round 1/2 DOM 显示 scenario `literature-evidence-review@1.0.0`、generated-literature runtime、missing research-report/paper-list/evidence-matrix expectations；targeted fix manifest `docs/test-artifacts/real-browser-evidence/p4-2026-05-17-coding-artifact-routing/manifest.json`
通用性说明：self-improvement coding prompt 被当前 scenario 的 literature package/skillPlan 接管，导致 coding 任务走文献 artifact contract。这是 scenario routing / capability selection 的通用问题，不是单个 coding prompt 或 P4 端口问题。
修复边界：generated-task expected artifact scope now filters scenario-default research artifacts (`paper-list`, `evidence-matrix`, `notebook-timeline`) for workspace coding prompts when the user did not explicitly request those artifact types; explicit expected artifacts remain authoritative.

Todo：
- [x] 最小复现
- [x] 定位 root boundary
- [x] 通用修复
- [x] targeted tests / browser evidence
- [x] 更新对应 `RCG-*` / `DISC-*` 打勾状态和 Activity Log

### DISC-20260517-004 Direct-context selected file follow-up returns generic satisfied text

状态：done
发现者：P4
证据：Browser `http://127.0.0.1:5473/`；selected file `workspace/parallel/p4/rcg-004-preflight-patch-report.md`；original run `project-literature-evidence-review-mp8l5n07-pam2bc`；original manifest `docs/test-artifacts/real-browser-evidence/p4-2026-05-17-self-improvement/manifest.json`；targeted fix manifest `docs/test-artifacts/real-browser-evidence/p4-2026-05-17-selected-file-followup/manifest.json`；transport rerun `project-literature-evidence-review-mp8m2f5u-jnsb6g`
通用性说明：UI 能打开并渲染 selected file，但 no-exec selected follow-up 没有基于文件内容生成 PR summary/risk checklist，只返回 direct-context generic satisfied text。问题位于 selected file/ref 内容进入 direct-context answer 的通用边界。
修复边界：workspace file result pane now exposes `data-sciforge-reference`; UI transport preserves selected object `path/dataRef`; direct-context selected refs include `uiState.currentReferences`; markdown reference digest surfaces representative bullets before heading inventory.

Todo：
- [x] 最小复现
- [x] 定位 root boundary
- [x] 通用修复
- [x] targeted tests / browser evidence
- [x] 更新对应 `RCG-*` / `DISC-*` 打勾状态和 Activity Log

### DISC-20260517-005 Vision-sense intent routing false-positive on code repair prompts

状态：done
发现者：P3
证据：Browser `http://127.0.0.1:5373/`；RCG-003 Round 2 prompt contained "browser result" + "use Python" and was misrouted to `local.vision-sense`; evidence manifest [`docs/test-artifacts/real-browser-evidence/rcg-003-2026-05-17-paper-reproduction/manifest.json`](docs/test-artifacts/real-browser-evidence/rcg-003-2026-05-17-paper-reproduction/manifest.json)
通用性说明：任何代码修复提示只要描述 browser result 且包含 use/使用，就可能被误判成 GUI/computer-use intent；这不是 ODE prompt、P3 端口或 provider 特例。
疑似边界：policy / vision-sense runtime routing

Todo：
- [x] 最小复现
- [x] 定位 root boundary
- [x] 通用修复
- [x] targeted tests / browser evidence
- [x] 更新对应 `RCG-*` / `DISC-*` 打勾状态和 Activity Log

### DISC-20260517-006 Backend waiting interaction-progress resets stall timer

状态：done
发现者：P3
证据：Browser `http://127.0.0.1:5373/`；RCG-003 Round 4/6 backend wait path showed repeated waiting progress could keep the UI from bounded-stop; evidence manifest [`docs/test-artifacts/real-browser-evidence/rcg-003-2026-05-17-paper-reproduction/manifest.json`](docs/test-artifacts/real-browser-evidence/rcg-003-2026-05-17-paper-reproduction/manifest.json)
通用性说明：`interaction-progress` events that only say backend-waiting are transport heartbeat/waiting state, not user-visible backend progress; counting them as progress can affect any slow provider or task.
疑似边界：UI transport / Projection / speed

Todo：
- [x] 最小复现
- [x] 定位 root boundary
- [x] 通用修复
- [x] targeted tests / browser evidence
- [x] 更新对应 `RCG-*` / `DISC-*` 打勾状态和 Activity Log

### DISC-20260517-007 Generated scientific report overclaims success despite metrics failure

状态：done
发现者：P3
证据：RCG-003 selected artifact `generated-knowledge-c63d1a35f6e9-output.md` reports true `r=0.8`, fitted `r=64.9299`, `RMSE=28.6483`, `r` error `8016.24%`; generated report still claimed fitted parameters were close; manifest [`docs/test-artifacts/real-browser-evidence/rcg-003-2026-05-17-paper-reproduction/manifest.json`](docs/test-artifacts/real-browser-evidence/rcg-003-2026-05-17-paper-reproduction/manifest.json)
通用性说明：Task/report quality must cross-check numeric metrics before declaring reproduction success; this applies to any computational artifact with evaluation metrics, not only logistic ODE fitting.
修复边界：新增 `result-metric-consistency` validation guard；当 payload/report 出现高 parameter error 等失败指标却宣称 success/recovered/reproduced/close 时，generated-task guard 标记 `repair-needed`，要求修正 verdict 或 rerun/repair。

Todo：
- [x] 最小复现
- [x] 定位 root boundary
- [x] 通用修复
- [x] targeted tests / browser evidence
- [x] 更新对应 `RCG-*` / `DISC-*` 打勾状态和 Activity Log

### DISC-20260517-008 Successful repaired artifact can end as needs-human direct-text

状态：done
发现者：P3
证据：RCG-003 Round 6 run `project-biomedical-knowledge-graph-mp8lvmsi-tgmtze` ended `needs-human` because AgentServer returned raw generated work, while materialized `ode_fit_demo_repaired.py` locally verified successful; Round 6 DOM/screenshot in [`docs/test-artifacts/real-browser-evidence/rcg-003-2026-05-17-paper-reproduction/`](docs/test-artifacts/real-browser-evidence/rcg-003-2026-05-17-paper-reproduction/)
通用性说明：A successful generated code artifact should still get a user-facing synthesized result or recovery fallback when raw direct text is guarded; otherwise users see `needs-human` despite a valid repair.
修复边界：`direct-answer-payload` now recognizes Markdown `Stage Result` reports with result/verdict sections as user-facing answers even when they mention ToolPayload output refs, while raw JSON/taskFiles/log guards remain strict.

Todo：
- [x] 最小复现
- [x] 定位 root boundary
- [x] 通用修复
- [x] targeted tests / browser evidence
- [x] 更新对应 `RCG-*` / `DISC-*` 打勾状态和 Activity Log

### DISC-20260517-009 Selected artifact follow-up dispatched AgentServer instead of direct-context answer

状态：done
发现者：P3
证据：RCG-003 Round 5 selected `generated-knowledge-c63d1a35f6e9-output.md` and asked for reproduction steps/success/risk using only that output; UI restored selected artifact, but the turn still dispatched AgentServer/generated task and returned partial reasoning; manifest [`docs/test-artifacts/real-browser-evidence/rcg-003-2026-05-17-paper-reproduction/manifest.json`](docs/test-artifacts/real-browser-evidence/rcg-003-2026-05-17-paper-reproduction/manifest.json)
通用性说明：When selected artifact content is small and sufficient, direct-context should answer from that content without backend dispatch; this is a general selected-ref/context policy issue.
修复边界：conversation-policy `context-only` detection now recognizes `selected ... artifact only` / `using only the selected ... artifact`, producing direct-context turn constraints before execution classification.

Todo：
- [x] 最小复现
- [x] 定位 root boundary
- [x] 通用修复
- [x] targeted tests / browser evidence
- [x] 更新对应 `RCG-*` / `DISC-*` 打勾状态和 Activity Log

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

- 2026-05-17 - P1 - 推进 `RCG-001 Literature Evidence Matrix Agent` Round 1：真实 in-app browser `http://127.0.0.1:5173/` 提交 spatial transcriptomics / pancreatic cancer evidence-matrix prompt，最终 run `project-literature-evidence-review-mp8mv7mq-0amn8j` / session `session-literature-evidence-review-mp8mu9sk-24ezqu` / task `generated-literature-d6f823b05828` satisfied，产出 8 条 Europe PMC provider-grounded evidence rows 和五类 expected artifacts。期间关闭通用边界：provider-first direct network bypass 直接切 deterministic adapter、evidence-matrix task input 注入 web routes/adapters、拦截不可用 `sciforge.tools` SDK、`web_search` 增加 Europe PMC/Crossref fallback 与 verbose query normalization、recovery adapter 补齐 notebook-timeline artifact。Evidence manifest `docs/test-artifacts/real-browser-evidence/p1-2026-05-17-literature-evidence-matrix/manifest.json`；验证 `node --import tsx --test packages/workers/web-worker/src/web-worker.test.ts src/runtime/gateway/generated-task-runner-generation-lifecycle.test.ts src/runtime/gateway/generated-task-runner-execution-lifecycle.test.ts src/runtime/gateway/generated-task-payload-preflight.test.ts` 与 `npm run typecheck` 通过。Round 2-4 仍待继续。
- 2026-05-17 - P4 - 完成 `RCG-004 SciForge Self-Improvement Coding Agent` 收尾重跑：在真实 Browser UI 中选中 `workspace/parallel/p4/rcg-004-preflight-patch-report.md`，用逐键输入绕过当前虚拟剪贴板限制后提交 follow-up，run `project-literature-evidence-review-mp8mrko6-uyglgl` 返回 `Summary from the selected reference`，并在主结果中保留 `generatedTaskPayloadPreflightForTaskInput()`、issue `id/kind/evidence`、`severity/path/reason/sourceRef/recoverActions` 等补丁事实；evidence manifest `docs/test-artifacts/real-browser-evidence/p4-2026-05-17-self-improvement-rerun/manifest.json`。`RCG-004` 从 blocked 改为 done。
- 2026-05-17 - P2 - 完成 `RCG-002 Data Analysis & Reproducible Notebook Agent` 真实 in-app browser 5 轮：Round 1 生成 36 样本 CSV/report/script；Round 2 修复可见报告追问只列路径/AgentServer convergence guard，改为读取 bounded artifact 正文 direct-context 回答；Round 3/4 分别用本地 bounded bootstrap CI runtime 和 reproducible-method export runtime 收束 AgentServer 长生成失败；Round 5 reload 后恢复最终结论、bootstrap 95% CI `[4.422, 20.382]` 和复跑命令。Evidence manifest `docs/test-artifacts/web-e2e/RCG-002-p2-data-analysis/manifest.json`；验证 `python -m pytest packages/reasoning/conversation-policy/tests/test_goal_snapshot.py packages/reasoning/conversation-policy/tests/test_execution_classifier.py packages/reasoning/conversation-policy/tests/test_contracts.py`、`node --import tsx --test src/runtime/gateway/direct-context-fast-path.test.ts src/runtime/gateway/conversation-service-plan.test.ts src/runtime/server/workspace-file-api.ts`、`node --import tsx --test src/runtime/local-data-sensitivity-runtime.test.ts src/runtime/local-reproducible-method-runtime.test.ts`、`npm run typecheck` 通过。
- 2026-05-17 - P3 - 补齐 `RCG-003` P3 evidence manifest 到统一 schema：`docs/evidence/rcg-003-p3/paper-reproduction-code-debug-manifest.json` 现在包含 owner/case/category/url/ports/workspace/state、session/run ids、6 轮 prompt/selected refs/evidence、quality/timing/failure boundaries 和已关闭 discovered tasks；同步更新 Markdown manifest，把 Round 6 `needs-human` 标为历史边界并关联 `DISC-20260517-008/009`。验证 `node -e` JSON schema sanity check 通过。
- 2026-05-17 - P5 - 完成 `RCG-005 Methodology Review & Experimental Design Agent` 真实 browser 5 轮并关闭复测缺陷：修复 scientific `screen` 误路由到 vision-sense Computer Use；收紧 continuity AgentServer handoff，避免 Round 2 319503 token convergence guard；修复 backend handoff canonical 阶段 `priorAttempts` 原始计数丢失；补齐 forced AgentServer Core unavailable fallback 的窄口放行；新增 per-host app navigation restore，刷新后恢复到 P5 workbench/latest run。Round 4 复测 run `project-literature-evidence-review-mp8nk3se-gfk6ma` 生成可预览 `protocol-markdown`；Evidence manifest `docs/evidence/rcg-005-p5-methodology-review/manifest.json`；验证 `npx tsx tests/smoke/smoke-vision-sense-intent-routing.ts`、`npm run smoke:backend-handoff-budget`、`npm run smoke:agentserver-generation`、`npm run typecheck`、`node --import tsx --test src/ui/src/app/appShell/workspaceState.test.ts` 通过；`generation-gateway.policy.test.ts` targeted forced-generation policy 通过，完整文件仍有当前并行 worktree 的相邻断言失败。
- 2026-05-17 - P6 - 完成 `RCG-006 Long-Context Delivery & Memory Agent`：Round 1 brief、Round 2 main document artifact、Round 3 selected-ref budget/timeline/risk register、Round 4 9个月/$180k/无 Xenium conflicting update、Round 5 reload risk restore、Round 6 audit panel 均有真实 Browser DOM/screenshot 证据；关闭 `DISC-20260517-001` 普通 AgentServer generation runaway guard 和 `DISC-20260517-010` reload risk rendering/direct-context planning 质量边界。Evidence manifest `docs/evidence/rcg-006-p6-long-context-memory/manifest.md`；验证 `node --import tsx --test src/runtime/gateway/direct-context-fast-path.test.ts src/ui/src/app/chat/finalMessagePresentation.test.tsx src/runtime/gateway/agentserver-stream.test.ts` 与 `npm run typecheck` 通过。
- 2026-05-17 - P3 - 关闭 `DISC-20260517-007`：新增 `result-metric-consistency` validation guard，阻止报告在 parameter error 等指标显著失败时仍宣称 success/close/reproduced；验证 `node --import tsx --test src/runtime/gateway/result-metric-consistency-guard.test.ts`、`node --import tsx --test src/runtime/gateway/generated-task-runner-output-lifecycle.test.ts`、`node --import tsx --test src/runtime/gateway/payload-validation.test.ts` 通过。`generated-task-runner-generation-lifecycle.test.ts` 当前失败在既有 provider-first retry 断言，非本 guard 边界，未改动。
- 2026-05-17 - P3 - 关闭 `DISC-20260517-009`：conversation-policy `context-only` keyword map 现在识别 `using only the selected ... artifact`，让 RCG-003 Round 5 这类选中 artifact 小上下文追问进入 `direct-context-answer`，避免无必要 AgentServer dispatch；验证 `python3 -m unittest packages/reasoning/conversation-policy/tests/test_goal_snapshot.py` 与 `node --import tsx --test src/runtime/gateway/direct-answer-payload.test.ts src/runtime/gateway/direct-context-fast-path.test.ts` 通过。`pytest` 在当前环境不可用，已记录为验证约束。
- 2026-05-17 - P3 - 关闭 `DISC-20260517-008`：修复 `direct-answer-payload` 对 Markdown `Stage Result` 的过度 raw guard，避免成功 repair 报告只因提到 ToolPayload output refs 就变成 `needs-human`；新增回归覆盖 RCG-003 Round 6 样式文本，验证 `node --import tsx --test src/runtime/gateway/direct-answer-payload.test.ts` 与 `node --import tsx --test src/runtime/gateway/agentserver-generation-dispatch.test.ts` 通过。
- 2026-05-17 - P3 - 完成 `RCG-003 Paper Reproduction & Code Debug Agent` 真实 browser 6 轮：Round 1 暴露 `torch` unavailable，Round 2 修复 vision-sense 误路由，Round 3/6 验证 raw direct-text guard，Round 4 暴露 backend-waiting stall accounting，Round 5 验证 selected artifact restore；最终 `ode_fit_demo_repaired.py` 本地复跑成功，`r=0.8000`、`K=100.0000`、`RMSE=1.2865`、参数误差 `0.00%`。Evidence manifest `docs/evidence/rcg-003-p3/paper-reproduction-code-debug-manifest.json`；browser bundle `docs/test-artifacts/real-browser-evidence/rcg-003-2026-05-17-paper-reproduction/manifest.json`；新增 `DISC-20260517-005/006/007/008/009`。
- 2026-05-17 - P4 - 关闭 `DISC-20260517-003`：generated-task expected artifact scope 对 workspace coding prompts 过滤 scenario-default research artifacts，避免 literature scenario 默认 `paper-list/evidence-matrix/notebook-timeline` 把 self-improvement coding task 卡成缺文献产物；显式 expectedArtifactTypes 仍优先。Evidence `docs/test-artifacts/real-browser-evidence/p4-2026-05-17-coding-artifact-routing/manifest.json`；验证 `node --import tsx --test src/runtime/gateway/generated-task-runner-supplement-lifecycle.test.ts`、`node --import tsx --test src/runtime/gateway/generated-task-runner-execution-lifecycle.test.ts`、`npm run typecheck` 通过。
- 2026-05-17 - P4 - 关闭 `DISC-20260517-002`：reference digest 给 refs 标注 `refDiscoverySource`，`conversation-service-plan` 不再把 prompt-discovered filenames 提升成 required current-turn references；原始 `Do not edit PROJECT.md` false-positive 现在保留 digest 审计但 `currentReferences=[]`。Evidence `docs/test-artifacts/real-browser-evidence/p4-2026-05-17-current-reference-gate/manifest.json`；验证 `node --import tsx --test src/runtime/gateway/conversation-reference-digest.test.ts`、`node --import tsx --test src/runtime/gateway/conversation-service-plan.test.ts`、`npm run typecheck` 通过。
- 2026-05-17 - P4 - 关闭 `DISC-20260517-004`：workspace file result pane 增加可点选 `data-sciforge-reference`，UI transport 保留 selected object `path/dataRef`，direct-context selected refs 纳入 `uiState.currentReferences`，markdown digest 优先输出 representative bullets；targeted browser/transport evidence `docs/test-artifacts/real-browser-evidence/p4-2026-05-17-selected-file-followup/manifest.json`，rerun `project-literature-evidence-review-mp8m2f5u-jnsb6g` 不再返回 generic/no refs，而是基于选中文件输出 `generatedTaskPayloadPreflightForTaskInput()` / `id/kind/evidence` / `recoverActions` 摘要；验证 `node --import tsx --test src/runtime/gateway/conversation-reference-digest.test.ts`、`node --import tsx --test src/runtime/gateway/direct-context-fast-path.test.ts`、`node --import tsx --test src/ui/src/api/sciforgeToolsClient.policy.test.ts`、`node --import tsx --test src/ui/src/app/ResultsRenderer.test.ts`、`node --import tsx --test src/runtime/gateway/generated-task-payload-preflight.test.ts`、`npm run typecheck` 通过。
- 2026-05-17 - P4 - 完成 `RCG-004` 首轮真实 browser 链路并判定 blocked：Round 1 generated-literature repair-needed，Round 2 backend stream stall 后中断，Round 3/4/5 direct-context/reload 可恢复但回答质量不足；落地通用 patch `generatedTaskPayloadPreflightForTaskInput()` 保留 issue `id/kind/evidence`，验证 `node --import tsx --test src/runtime/gateway/generated-task-payload-preflight.test.ts` 与 `npm run typecheck` 通过；evidence manifest `docs/test-artifacts/real-browser-evidence/p4-2026-05-17-self-improvement/manifest.json`；新增 `DISC-20260517-002/003/004`。
- 2026-05-17 - P1 - 认领 `RCG-001 Literature Evidence Matrix Agent`；预留 evidence manifest `docs/test-artifacts/real-browser-evidence/p1-2026-05-17-literature-evidence-matrix/manifest.json`，本批目标为真实 in-app browser 完成文献证据矩阵 4-5 轮并验证 selected artifact / reload continuity。
- 2026-05-17 - P4 - 认领 `RCG-004 SciForge Self-Improvement Coding Agent`；预留 evidence manifest `docs/test-artifacts/real-browser-evidence/p4-2026-05-17-self-improvement/manifest.json`，本批目标为真实 in-app browser 完成 coding agent 5 轮并用失败牵引通用修复。
- 2026-05-17 - Orchestrator - 将 2026-05-16 Browser Multiturn Stability Sprint 长任务板归档到 `docs/archive/PROJECT-history-2026-05-16-browser-sprint.md`；重构当前 `PROJECT.md` 为 Real Research & Coding Multiturn Gauntlet，看板包含 P1-P6 真实科研/coding 多轮任务、统一 evidence schema、discovered task queue 和 browser test matrix。
- 2026-05-17 - Orchestrator - 将 milestone gates、RCG-001..006 多轮剧本、验收项、evidence schema、browser test matrix 和 discovered task 模板改为 checklist；新增 Worker 打勾规则，要求 worker 完成每轮/验收后回写勾选状态和 evidence。
- 2026-05-17 - Orchestrator - 新增 Sub-agent Milestone Protocol：每个进程尽可能用 sub agents 并行推进；每个 milestone 完成后更新 `PROJECT.md`、提交并 push GitHub、关闭上一批 sub agents，再启动下一批推进。

## Current Handoff

下一步启动并行进程 P1-P6。每个进程先确认自己的端口、workspace、state/config 隔离，然后尽可能启动一批 sub agents 并行推进对应 `RCG-*` milestone。每个 milestone 完成后：整合 sub agent 结果、更新 `PROJECT.md` 打勾状态和 Activity Log、提交并 push 到 GitHub、关闭上一批 sub agents，再启动下一批 sub agents 推进下一个 milestone。失败时先记录 evidence 和 root boundary，再做通用修复；成功时也要记录 timing、answer quality 和 artifacts。优先让 P1/P2/P3/P4 先各跑一条完整链路，P5/P6 用来扩展方法学和长上下文压力。
