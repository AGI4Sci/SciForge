# SciForge - PROJECT.md

最后更新：2026-05-11

## 当前目标

用真实科学论文复现任务拉通 SciForge 的复杂问题解决能力。Codex 代替人类研究者，从网页端打开 `http://localhost:5173/`，通过 Computer Use 模仿人的鼠标、键盘、阅读、追问、纠错和继续分析行为，交互式多轮提示 SciForge 复现论文主要结论，或形成有证据的反驳。

最终产物不是单篇论文的 demo，而是一套可泛化到任意科研场景的能力：论文理解、数据发现、计算分析、证据组织、负结果处理、复现质量验证、轨迹数据导出和自我提示式研究流程。

## 开工前必读

任何 agent 在执行本项目任务前，必须先读本文件和与任务相关的设计文档，避免凭局部代码印象破坏系统边界。

- [`docs/Architecture.md`](docs/Architecture.md)：SciForge 总体架构、Backend-first / Contract-enforced / Capability-driven / Harness-governed 方向、`src` 与 `packages` 边界。
- [`docs/AgentHarnessStandard.md`](docs/AgentHarnessStandard.md)：harness runtime、profile、stage hook、contract、trace、merge 规则和行为治理入口。
- [`docs/Usage.md`](docs/Usage.md)：网页端使用流程、多 backend、论文复现/自我进化/Computer Use 操作路径。
- [`docs/Extending.md`](docs/Extending.md)：新增 capability、artifact、view、scenario、package 时的扩展方式。
- [`README.md`](README.md)：产品定位、快速启动、核心概念和当前能力范围。

执行规则：

- 做网页端复现任务前，至少阅读 `README.md`、`docs/Usage.md` 和本文件。
- 做架构、runtime、harness、capability、schema、view 或 verifier 修改前，必须阅读 `docs/Architecture.md`、`docs/AgentHarnessStandard.md`、`docs/Extending.md` 和本文件。
- 主 agent 负责阅读全局文档并给 sub agent 提供任务 briefing；sub agent 不需要反复通读全部设计文档，只读取 briefing、相关文件和与其职责直接相关的文档片段。
- 如果 sub agent 的任务会改变架构边界、harness 策略、capability contract、schema/view/verifier 或 validation/repair/audit 行为，主 agent 必须在 briefing 中附上对应设计文档约束；必要时再要求 sub agent 阅读相关章节。
- 如果文档与代码不一致，先记录差异并做通用修复或文档更新，不要绕过设计边界临时补丁。

## 不变原则

### 科研复现原则

- 所有修改必须通用、可泛化，不能为特定论文、文件名、figure、gene、accession、网页或数据库写硬编码分支。
- 优先从 SciForge 网页端完成任务：Codex 使用 Computer Use 像人一样点击、输入、上传、查看结果、继续追问和记录失败。
- 只有在 SciForge 当前能力阻塞时，才回到代码层做通用修复；修复必须进入 capability manifest、schema、verifier、harness、artifact view 或通用 UI 交互，而不是特例补丁。
- 真实失败是资产。数据不可得、工具失败、统计不支持论文结论时，应输出 structured partial/failure/negative result，不能伪造成功。
- 每轮交互都要沉淀训练数据：prompt、屏幕状态、选择的 refs、工具调用、生成代码、stdout/stderr、artifact、验证结果、repair attempt、最终判断。
- 推进项目时尽可能并行：论文阅读、数据发现、UI 操作、schema/verifier 设计、负结果检查可以由不同 agent 或不同任务线并行推进。

### 架构护栏

- 以设计文档为准，不在 `PROJECT.md` 重复维护完整架构说明；本文件只保存当前目标、任务板和不能破坏的少量护栏。
- 新增功能必须符合 **Backend-first, Contract-enforced, Capability-driven, Harness-governed**，不能新增第二套 agent、第二套路由或第二套策略系统。
- UI 不根据 prompt、scenario、论文标题、artifact 名称或自然语言关键词做语义猜测；UI 只消费 runtime contract、artifact schema、view manifest 和结构化事件。
- 探索预算、上下文选择、tool-use policy、skill hints、验证强度、repair policy、进度展示和后台/取消策略必须进入 harness profile、stage hook 或 capability manifest。
- 可被选择、组合、计预算、验证、修复、渲染或审计的能力必须走 capability manifest；普通 internal helper 不强行 manifest 化。
- 所有 capability 输出都必须可代码校验；失败进入 validation/repair/audit pipeline，不能静默改写成成功。
- PDF 全文、测序数据、日志、notebook、表格和大型 artifact 坚持 refs-first：workspace 保存大对象，prompt 只携带 bounded summary 与 locator。
- `src/` 与 `packages/` 边界以 `docs/Architecture.md` 为准；科研领域 schema、view、verifier、skills、actions 优先进入 packages。
- Prompt builder 不是策略真相源；新增策略必须来自 runtime contract、harness rendered entries 或可信 policy provider，并能从 refs/trace 重建。
- 胶水代码、执行 trace、validation failure、repair attempts、negative results 和 capability 下钻记录都是训练与审计资产，必须沉淀为可引用 artifact、ledger 或 trajectory record。
- 代码路径保持唯一真相源；临时兼容层必须有删除条件和 smoke guard。
- 代码膨胀必须治理；手写长文件按职责拆分，不能机械切 `part1/part2`。
- 算法相关代码优先用 Python 实现，方便科研用户检查、复现和修改。

## 种子论文

- `workspace/cell_papers/2020 Refined spatial temporal epigenomic profiling reveals intrinsic__connection between PRDM9-mediated H3K4me3 and__the fate of double-stranded breaks.pdf`
  关注：PRDM9-mediated H3K4me3、DSB hotspot fate、CO/NCO、meiotic prophase I、ChIP-seq、NOMe-seq、SPO11、DMC1。
- `workspace/cell_papers/2022_NRG_Histone post-translational__modifications — cause and__consequence of genome function.pdf`
  关注：histone PTM 的 cause/consequence 框架，作为因果证据评估 rubric 的背景来源。
- `workspace/cell_papers/2025_Cell Research_SETD1B-mediated broad H3K4me3 controls proper temporal patterns of gene expression critical for spermatid development.pdf`
  关注：SETD1B-RFX2 axis、broad H3K4me3、H3K27ac enhancer/promoter overlap、temporal gene expression、spermatid development。

## 操作方式

1. Codex 先用 Computer Use 打开 SciForge 网页端，像研究者一样上传/选择论文、输入研究 topic、查看返回结果、继续追问。
2. SciForge 必须通过自身 workspace runtime、AgentServer、capability broker、artifact renderer 和 verifier 产出结果。
3. 如果网页端流程卡住，Codex 记录卡点，再做通用修复任务；修复后回到网页端复测。
4. 每次 attempt 结束后更新本文件的任务状态和学到的通用缺口。

## 任务板

### R001 网页端人类式操作协议

职责：定义 Codex 如何使用 Computer Use 从网页端操作 SciForge，确保训练轨迹接近真实人类研究者。

Todo：
- [x] 设计一套网页端操作 runbook：打开应用、选择 workspace、上传/引用论文、输入 topic、追问、检查 artifact、继续分析、导出结果。
- [x] 记录每轮网页交互的 screen state、mouse/keyboard action、prompt、response、artifact refs 和失败点。（2026-05-11 首轮真实 UI attempt 已记录为 failure fixture。）
- [x] 区分“产品能力失败”和“研究结论失败”：前者进入通用修复，后者进入 negative result。
- [x] 建立最小复测流程：每次通用修复后都回到网页端用同类操作复测。（见 `docs/runbooks/sciforge-web-reproduction.md` 的 Generic Web Retest Packet。）

验收：
- [x] 至少完成一次全程网页端 attempt，不依赖直接调用内部脚本来绕过 SciForge UI。

### R002 论文理解与 Claim Graph

职责：让 SciForge 从 PDF 中抽取可复现的科学主张，而不是只做摘要。

Todo：
- [x] 对 2020/2025 两篇研究论文生成 `paper-claim-graph`：main claims、subclaims、key figures、实验设计、数据类型、物种、细胞阶段、变量和统计方法。（真实产物已沉淀到 `tests/fixtures/scientific-reproduction/real-paper-understanding/`。）
- [x] 对 2022 review 生成 review/rubric 专用 claim graph，连接 cause/consequence 背景判据与研究论文评估。
- [x] 为 2020/2025 生成 `figure-to-claim-map`：每个关键 figure 支撑哪些 claim，需要哪些数据和分析步骤。
- [x] 标注复现风险：数据缺失、方法不完整、统计描述不足、外部依赖、结论超出证据。（seed fixtures 和 verifier 已覆盖风险字段。）
- [x] 阅读过程采用 refs-first：大段 PDF 内容保存在 artifact，只把 bounded summary 和 page/section locator 交给模型。

验收：
- [x] 每篇研究论文至少有 5 个可检查 claim，并能追溯到 PDF 页码或章节。

### R003 数据与代码发现

职责：定位真实复现所需数据、代码和 supplementary material。

Todo：
- [x] 从论文正文、methods、data availability、supplementary information 中抽取 accession、链接、数据表和代码线索。（2020/2025 草案已进入 `tests/fixtures/scientific-reproduction/real-paper-evidence/`。）
- [x] 用通用检索能力查询 GEO/SRA/ENA/ArrayExpress/figshare/GitHub/期刊 supplement。（已核到 GEO GSE132446/GSE84689/GSE35498/GSE61613、GSE242515 与 KAS-Analyzer 代码线索。）
- [x] 输出 `dataset-inventory`：数据源、样本、assay、物种、基因组版本、下载大小、许可、可用性。（contract/mock fixture 已完成。）
- [x] 通过 `dataset-inventory.missingDatasets`、`claim-verdict.missingEvidence` 和 `negative-result-report` 表达缺失数据；`missing-data-report` 只作为 human-facing derived draft/export note，不进入正式 runtime artifact type set。

验收：
- [x] 找不到数据时必须 structured partial/failure，不能把论文文字当作真实数据。

### R004 通用 Bioinformatics 执行环境

职责：为论文复现建立可复用执行 profile，而不是为单篇论文临时拼命令。

Todo：
- [x] 声明常用工具能力：FASTQ/BAM/BED/bigWig 处理、peak calling、overlap、signal matrix、gene annotation、统计检验、plot。
- [x] 声明 Python/R package、命令行工具、基因组 annotation/cache、CPU/内存/时间/下载预算。
- [x] 建立降级策略：无原始数据时使用 processed table；无完整 genome cache 时用小样本 fixture；无网络时输出 missing-data。
- [x] 所有工具选择进入 capability manifest/broker/harness，不在论文任务里写死命令。

验收：
- [x] 同一执行 profile 可服务 2020 和 2025 两篇论文。

### R005 2020 PRDM9/DSB Fate 复现 Attempt

职责：复现或质疑“PRDM9-mediated H3K4me3 与 DSB fate 有内在联系，早形成 DSB 更开放且更倾向 CO fate”。

Todo：
- [x] 用网页端多轮提示 SciForge 制定最小复现计划。（首轮 attempt 生成了任务代码，但 ToolPayload schema failure 阻止展示。）
- [x] 尝试复现 stage-specific H3K4me3 peak、PRDM9 binding overlap、SPO11/DMC1 hotspot association。（Supplementary Table S3 支持 stage/de novo H3K4me3 与 DSB hotspot 表格级 partial reproduction；PRDM9 affinity overlap 仍是 missing evidence。）
- [x] 尝试复现 open chromatin/NOMe signal 与早晚 DSB、CO/NCO proxy 的关系。（当前无 raw NOMe/CO-NCO 可运行证据，作为 structured insufficient-evidence 保留。）
- [x] 做 threshold/peak caller/replicate/stage confounding 敏感性检查。（本阶段仅能做 missing-method/raw-data boundary 检查；完整 peak caller/replicate 敏感性需要 raw FASTQ/BAM，不纳入当前 bounded benchmark。）
- [x] 输出 `figure-reproduction-report`。
- [x] 输出第一版 `evidence-matrix`、`claim-verdict` 草案，verdict 保持 `insufficient-evidence`，不把访问/工具缺口伪装成科学复现成功。

验收：
- [x] verdict 明确为 reproduced、partially-reproduced、not-reproduced 或 contradicted，并附证据链。

### R006 2025 SETD1B/Broad H3K4me3 复现 Attempt

职责：复现或质疑“SETD1B-RFX2 介导 spermatid-specific broad H3K4me3，并控制表达强度和时间模式”。

Todo：
- [x] 用网页端多轮提示 SciForge 制定最小复现计划。（当前以 self-prompt shadow 和 refs-first analysis-plan fixture 形式保留；自动提交仍需人工审阅。）
- [x] 尝试复现 broad-vs-sharp H3K4me3 domain calling。（Supplementary Table S5 支持 broad-domain 表格级 partial reproduction；独立 peak/domain calling 需要 raw ChIP-seq，不纳入当前 bounded benchmark。）
- [x] 尝试复现 broad H3K4me3 与 H3K27ac enhancer/promoter overlap。（S5/S8 支持部分 overlap/annotation 证据；完整 enhancer/promoter overlap 作为 insufficient-evidence 保留。）
- [x] 尝试复现 stage temporal expression pattern 与 Setd1b/Rfx2 perturbation 证据。（S8 支持 early/late temporal expression 表格级检查；Setd1b/Rfx2 perturbation 原始重算仍缺 raw inputs。）
- [x] 做 gene length、baseline expression、annotation version、batch/stage confounding 检查。（作为 structured missing-evidence/confounding checklist 纳入 evidence matrix。）

验收：
- [x] 产出与 R005 同一 schema 的通用 artifact，而不是 2025 论文专属格式。

### R007 2022 Review 到因果证据 Rubric

职责：把综述中的 cause/consequence 框架变成可检查标准，用于评估研究论文结论强度。

Todo：
- [x] 抽取 histone PTM 作为 cause、consequence、reinforcement、memory mark 的判据。
- [x] 生成 `causal-evidence-rubric`：必要证据、增强证据、反证、常见混杂。
- [x] 用 rubric 评估 2020 和 2025 的主张，区分相关性、时间顺序、扰动证据和机制证据。

验收：
- [x] rubric 可用于其他 histone/PTM 论文，不包含这 3 篇论文的特例逻辑。

### R008 负结果与强质疑机制

职责：让 SciForge 能合理反驳论文，而不是默认支持论文。

Todo：
- [x] 为每篇研究论文至少设计 3 个反证检查。
- [x] 负结果机制输出 `negative-result-report`，包含检查动机、数据、代码、统计、结论影响；本轮真实论文结论主要是 partial/insufficient-evidence，不强造 contradicted negative result。
- [x] UI 中清楚显示 not-reproduced/contradicted，不把它包装成普通失败。（view manifest 已接收 negative-result-report。）
- [x] 验证 repair pipeline 不会把科学负结果强行修成正结果。（verifier 区分 negative result 与 operational failure。）

验收：
- [x] 至少一个 attempt 产生可审计的 partial 或 negative conclusion。

### R009 科学复现 Artifact Schema 与 View

职责：沉淀通用 artifact，不让结果散成聊天文本。

Todo：
- [x] 定义 `paper-claim-graph`、`dataset-inventory`、`analysis-plan`、`analysis-notebook`。
- [x] 定义 `figure-reproduction-report`、`evidence-matrix`、`claim-verdict`、`negative-result-report`。
- [x] 定义 `trajectory-training-record`，用于导出训练数据。
- [x] 每个 schema 配 validator、repair hints、view manifest 和 refs-first 大对象策略。

验收：
- [x] 2020 和 2025 attempts 使用同一套 schema。

### R010 复现质量 Verifier

职责：判断 SciForge 的复现结果是否可信、可追溯、可训练。

Todo：
- [x] 检查每个 claim 是否有 evidence 或明确 missing evidence。
- [x] 检查每个 figure reproduction 是否有代码、输入数据、参数、stdout/stderr、统计方法。
- [x] 检查 accession/DOI/PMID/title/year/journal 是否核验。
- [x] 检查 verdict 是否区分 reproduced/partial/not-reproduced/contradicted。
- [x] Verifier 失败进入 validation/repair/audit pipeline。（scientific-reproduction runtime verifier 已接入 runtime verification gate。）

验收：
- [x] Verifier 能阻止“看起来像报告但没有证据链”的结果被标为成功。

### R011 轨迹训练数据导出

职责：把人类式复现过程变成训练科学研究自动化模型的数据。

Todo：
- [x] 导出 state/action/observation 序列：网页状态、用户式 prompt、工具结果、artifact lineage。（contract 与 sample trajectory 已完成。）
- [x] 导出 decision rationale：为什么追问、为什么换参数、为什么判定失败或质疑论文。（contract 与 sample trajectory 已完成。）
- [x] 导出 repair history：失败、诊断、修复、复测。（contract 与 sample trajectory 已完成。）
- [x] 脱敏本地绝对路径、API key、临时文件名，用 workspace refs 替代。

验收：
- [x] 单个 attempt 可重放或审计，不依赖聊天上下文记忆。

### R012 UI/交互能力缺口修复

职责：通过真实网页操作发现 SciForge 产品能力问题，并只做通用修复。

Todo：
- [x] 记录长任务进度是否清楚：当前阶段、下一步、卡点、可取消/继续操作。
- [x] 记录 artifact 是否容易打开、比较、引用、追问和导出。（artifact card/inspector 已补通用引用、追问和 JSON 导出入口。）
- [x] 记录 evidence matrix、claim verdict、negative result 是否有清晰视图。
- [x] 发现 UI 问题后新增通用 issue，不做论文专属展示。
- [x] 修复 terminal backend failure 后结果区空等的问题：runtime 现在产出 `runtime-diagnostic` artifact，failed run 结果面板允许展示结构化诊断。

验收：
- [x] 每个 UI 修复都能被非 cell/epigenomics 任务复用。

### R013 自我提示式复现 Agent

职责：从“Codex 代替人类多轮提示”逐步过渡到“SciForge 自己根据论文多轮提示自己”。

Todo：
- [x] 从 R001/R011 的人类式轨迹中抽象 prompt strategy：阅读、规划、取数、计算、检查、反证、总结。
- [x] 定义 self-prompt loop contract：下一轮问题、需要的 refs、停止条件、质量门槛。
- [x] 先 shadow 运行，只建议下一轮 prompt；通过验证后再允许自动提交下一轮。
- [x] 防止无限循环：预算、最大轮次、失败停止、人类确认点。

验收：
- [x] SciForge 能基于一篇新论文自动提出下一轮高质量复现提示，但仍可被人类审阅。

### R014 小样本/Mock Benchmark

职责：让通用能力可测试，不依赖 live 数据源和大规模下载。

Todo：
- [x] 为 claim graph、dataset inventory、negative result、trajectory export 建立小样本 fixture。
- [x] 为 GEO/SRA/GitHub/provider timeout/missing data 建立 mock provider。
- [x] 建立 smoke：验证 schema、verifier、failure semantics、refs-first、trajectory export。

验收：
- [x] CI 可验证通用 contract，不需要真的下载大型测序数据。

## 当前里程碑

- [x] M1：用网页端 Computer Use 完成一次 2020 或 2025 论文的人工式多轮 attempt。
- [x] M2：产出第一版 `paper-claim-graph`、`dataset-inventory`、`evidence-matrix`、`claim-verdict`。
- [x] M3：发现至少 3 个通用产品/能力缺口，并写成可实现任务。
- [x] M4：完成一个通用修复后回到网页端复测。
- [x] M5：导出一份可审计的 `trajectory-training-record`。
- [x] M6：产出 2020/2025 第一版 bounded figure reproduction artifacts，并明确 partial/insufficient-evidence 边界。
- [x] M7：产出 self-prompt shadow fixture，能提出下一轮高质量复现提示且要求人工确认。

## 后续候选里程碑

N1-N8 已在本轮完成为通用 gate/contract/smoke。N4 在用户明确批准下载/计算后只执行 one-claim、bounded、refs-first raw BED domain pilot，避免把通用能力验证误读成单论文全量 raw-data 重算工程。N5 收束此前暴露的 src capability-semantics guard 漏洞，使 0 baseline 恢复为可执行验收。N6 将 FASTQ/BAM/CRAM/SRA 级 raw reanalysis 升级为 metadata-only preflight，不默认触发下载或计算。N7 约束 execute-approved raw reanalysis：ready dossier 不能当万能通行证，执行任务必须绑定 approved scope，成功 verdict 必须有 completed execution attestation。N8 进一步把 raw reanalysis 推进到 offline fixture dry-run readiness：可验证命令 wiring、环境探测和输出 contract，但仍不能声称科学成功。

- [x] N1：Harness-governed Scientific Reproduction。把科研复现每轮 context、capability、budget、verification、repair、progress 收敛进 `HarnessContract`/trace；验收以 harness trace、budget exhaustion、validation/repair/audit 和现有 2020/2025 bounded fixtures 通过为准。
- [x] N2：Self-prompt Auto-submit Gating。只在 required refs、schema、verifier、预算、停止条件和人工确认点满足时自动提交下一轮；遇到 missing evidence、raw download、许可/算力未定义或重复失败时停在 structured needs-human/failed-with-reason。
- [x] N3：Raw-data Reanalysis Readiness。先产出 refs-first readiness dossier，列明 accession、数据许可、下载字节数、存储/CPU/内存/时间预算、工具版本、环境锁、genome cache、checksum 和降级策略；verifier 必须阻止未满足许可/预算/环境的 raw execution。
- [x] N4：One-claim Raw-data Pilot。只能在 N3 通过且用户批准下载/计算后，选择一个 claim、最小样本集和一条明确 pipeline 运行；输出仍使用通用 `analysis-notebook`、`figure-reproduction-report`、`evidence-matrix`、`claim-verdict`，不能因 pipeline 跑通就标成科学成功。
- [x] N5：Capability Semantics Boundary Hygiene。把真实 package-owned capability 语义迁出 `src/**`，把误判的平台 contract vocabulary 与 package-owned ids 分开检查；验收以 `smoke:no-src-capability-semantics` 0 tracked findings、typecheck、package checks 和相关 capability smokes 通过为准。
- [x] N6：Raw FASTQ/BAM Reanalysis Preflight。把全量 raw reanalysis 推进到通用 preflight：记录 requested file classes、reanalysis intent、最小 runnable plan refs、downsample/region fixture refs、环境/预算/checksum/许可 gate；默认 `rawExecutionGate.allowed=false`，没有执行证据不得声称 `reproduced`。
- [x] N7：Raw Execution Attestation & Scope Binding。允许 raw execution 之前，generated task 的 raw targets 必须落在 ready dossier 的 approved scope 内；如果 raw reanalysis 输出声称 `reproduced`/`partially-reproduced`，必须有 completed `executionAttestations`，绑定 plan、execution unit、code、stdout/stderr、output、checksum、environment、budget debit refs，并证明 observed download/storage 没超批准预算。
- [x] N8：Offline Fixture Dry-run Readiness。在不触发 live download 的前提下，用 tiny fixture dry-run 证明 command wiring、schema compatibility、environment probe 和 expected output contracts；`rawExecutionGate.allowed=false`、`downloadedBytes=0`、`stopBeforeLiveDownload=true`，dry-run 结果只能支持 `insufficient-evidence`/`not-tested`。

## 2026-05-11 阶段记录

- 已完成一次真实网页端 Computer Use attempt：在 `http://localhost:5173/` 导入文献证据评估场景，新建聊天，输入三篇 `workspace/cell_papers` 论文复现任务并发送。运行生成了 `tasks/paper-reproduction-round1/run_all_stages.py`，但最终被用户中断，因为多轮 repair 仍未产出可展示结果。
- 真实失败缺口 1：AgentServer 生成的任务输出不是有效 `ToolPayload`，缺少 `message`、`claims`、`uiManifest`，且 `artifacts` 是对象而不是数组；repair rerun 没有真正修正任务代码。
- 真实失败缺口 2：Stage 1 PDF extraction 失败只显示 `unknown error`，导致 claim graph 为空，结果区没有可展示 artifact。
- 真实失败缺口 3：UI 能显示等待、repair 和 token 进展，但 repair-needed partial scientific outputs 没有被保留成用户可打开的 structured artifact。
- 本阶段通用修复已完成：新增 scientific reproduction runtime contracts、refs-first validators、scientific reproduction verifier、bioinformatics reproduction profile/mock fixtures、Computer Use runbook、trajectory export contract、seed-paper generic fixtures、package-owned view manifest 接收规则、UI failure fixture 和 `npm run smoke:scientific-reproduction`。
- 已验证：`npm run typecheck` 和 `npm run smoke:scientific-reproduction` 通过。
- Worker P 补充了 M4 网页端复测准备：通用 retest checklist、baseline/follow-up prompt template、expected artifact gates，以及针对 2026-05-11 ToolPayload/PDF extraction/partial artifact 失败类的复测检查；后续复测 1/2/3 与第五阶段轻量 retest 已闭环。
- 第二阶段并行修复完成：scientific-reproduction verifier 已接入 runtime verification/validation/repair/audit；malformed ToolPayload 会 fail closed 并保留 object-map partial artifacts；PDF refs 具备 bounded `pdftotext` fallback 和结构化 extraction diagnostics；trajectory-training-record 可从 stored attempt/result/validation refs 导出；artifact UI 增加通用引用/追问/JSON 导出。
- M4 网页端复测 1：用 Computer Use 在文献证据评估场景新建聊天，提交 2020 PRDM9 PDF 的 refs-first 短复现任务。复测暴露新通用缺口：generated task 退出/repair 后没有 output JSON 时，repair rerun 可重复到 8+ 次，结果面板仍为空。
- 针对 M4 复测 1 的通用修复：AgentServer repair 默认预算从 12 降到 4；当 repair 没有修改任务代码且失败原因重复时立即 fail closed，防止同一坏任务无限修复。新增 `smoke:agentserver-repair-budget` 并纳入 `smoke:scientific-reproduction`。
- M4 网页端复测 2：再次通过 Computer Use 提交同类任务，最新 attempt `generated-literature-9ec76e6172e7` 在 2 次 attempt 后停止，状态为 `repair-needed` / `failed-with-reason`，验证 runaway repair loop 已被截断。剩余产品缺口：终态 product failure 仍没有在结果面板中形成可打开的失败 artifact，HTTP stream 仍可停留在等待状态，需要下一阶段修复“terminal backend failure -> visible result artifact/finalized stream”。
- 本阶段最终验证：`npm run typecheck`、`npm run smoke:scientific-reproduction`、`npm run smoke:runtime-gateway-modules`、`npm run smoke:validation-repair-audit-chain`、`npm run smoke:runtime-ui-manifest`、`npm run packages:check`、`python3 -m unittest packages/reasoning/conversation-policy/tests/test_reference_digest.py` 均通过。
- 第三阶段并行推进完成：修复 terminal backend failure 的可见诊断 artifact；trajectory export 可收集真实 partial artifacts、failure refs 和科学 verdict；从真实 PDF 产出 2020/2025 claim graph、figure-to-claim map、dataset inventory、evidence matrix、claim verdict 草案；2022 review 的 cause/consequence 框架已用于评估 2020/2025 主张。
- 真实论文 fixture 已同步到仓库路径：`tests/fixtures/scientific-reproduction/real-paper-understanding/` 与 `tests/fixtures/scientific-reproduction/real-paper-evidence/`。大体量 PDF 文本、supplement Excel 和 workspace 运行轨迹继续保留在 gitignored workspace，用 refs 记录，不提交原始大对象。
- 新增 `smoke:scientific-reproduction-real-paper-artifacts`，校验真实论文 artifact 的 refs-first、claim locator、dataset source、保守 verdict 和 unsupported `missing-data-report` 草案边界。
- M4 网页端复测 3：重启 dev 服务后，用 Computer Use 打开文献证据评估场景，查看失败 run `project-literature-evidence-review-mp034941-noj0lr`。结果面板不再为空，展示“运行需要处理”、`ContractValidationFailure`、execution unit、task/output/stdout/stderr refs、恢复动作和 `literature-runtime-result` 诊断 artifact，验证 terminal product failure 已成为可审计 UI 结果。
- 针对复测 3 的进一步通用修复：AgentServer repair 终止分支现在返回 `repairNeededPayload`，即使达到预算、repair 失败、无代码变化或 repair rerun 不可解析，也会给 stream 一个终态 ToolPayload，而不是只写 ledger 后返回 `undefined`。
- 第四阶段并行推进完成：新增 2022 review/rubric `paper-claim-graph`，补齐 cause/consequence/memory/reinforcement/writer-reader-eraser/perturbation/confounder 判据；新增 2020 PRDM9/DSB fate bounded reproduction artifact；新增 2025 SETD1B/broad H3K4me3 bounded reproduction artifact；新增 self-prompt shadow fixture；明确 `missing-data-report` 只是 derived draft，不进入正式 runtime artifact type set。
- 2020 bounded reproduction 结论：Supplementary Table S3 可支持 stage-specific de novo H3K4me3 与 DSB-hotspot 表格级 `partially-reproduced`；PRDM9 affinity overlap、NOMe/open chromatin、CO/NCO fate 与完整 peak-caller/replicate 敏感性仍是 structured missing evidence，不把缺数据写成科学反证。
- 2025 bounded reproduction 结论：Supplementary Table S5/S8 支持 broad-domain 与 temporal-expression 表格级 `partially-reproduced`；整体 `claim-verdict` 保持 `insufficient-evidence`，因为独立 broad-vs-sharp calling、Setd1b/Rfx2 perturbation、Pol II/TAF3、gene length/baseline/stage confounding 仍缺 raw-data 级复算。
- 并行收束审计补充：多个 sub agent 从任务板、验证脚本、网页端服务和下一阶段边界并行复核，确认 raw FASTQ/BAM 全量重算仍应另开 milestone；同时发现 R010 verifier 与正式 scientific-reproduction contract 有通用对齐缺口。本轮已补齐 verifier 对 `inputRefs`/`codeRefs`/`outputFigureRefs`/`statisticsRefs`/`stdoutRefs`/`stderrRefs`、`insufficient-evidence`/`not-tested` verdict、`figure-to-claim-map` 非复现记录边界、结构化 DOI/accession verification 的支持；并把 `smoke:scientific-reproduction` 纳入 `smoke:all`，使 `verify:fast` 默认覆盖科研复现 contracts、fixtures、verifier、UI failure 和 trajectory export。
- 第五阶段并行审计与轻量网页端复测：sub agents 复核任务板、verifier/contract、网页端服务和下一阶段边界；确认当前任务板可作为 bounded scientific reproduction milestone 收束，但需要澄清 `missing-data-report` derived draft、negative-result 机制边界和 raw-data 后续门槛。Computer Use 轻量 retest `generated-literature-74eb7212f46b` 验证 post-`repairNeededPayload` terminal failure 会在网页端显示 `repair-needed`/failed 终态、`literature-runtime-result` runtime-diagnostic artifact、execution unit、stdout/stderr/output refs 和恢复动作；引用 `artifact:literature-runtime-result` 的 follow-up 能进入下一轮上下文并读取相关 refs，但简单诊断追问仍可能等待过长，已作为 N1/N2 的 harness/budget gating 后续课题。
- 第五阶段通用修复：scientific reproduction contract 与 verifier 再次收紧。Contract 现在要求 figure reproduction 带参数或 parameter refs、statistics refs、stdout/stderr refs；negative-result checks 带 input/code/statistics/output refs；identifier verification 按 bibliographic/accession 强校验 DOI/PMID/title/year/journal 或 accession/database/status/checkedAt/evidence refs；refs-first 校验会拦截大段 `sourceText`/table/summary 等 inline payload。Verifier 现在先做 runtime contract compliance，支持 data-root `artifactType` fixtures，解析 `{ref}` object refs，聚合 nested `negative-result-report.checks[]`，并用真实 2020/2025 fixture 覆盖 figure reproduction 与 identifier verification。
- 第六阶段并行推进完成 N1/N2/N3，但没有触发 raw FASTQ/BAM 下载或 genome-cache 复算。新增 `scientific-reproduction-research` harness profile，把 required refs、scientific reproduction capability/verifier preference、strict verification、needs-human budget exhaustion、安全 side effects 和 progress milestones 写入 `HarnessContract`/trace，并把 `smoke:agent-harness-profile-coverage` 纳入 `smoke:all`。
- Self-prompt auto-submit gate 已进入 trajectory contract：`auto-submit-eligible` 必须具备 required refs、schema/verifier refs、预算、停止条件、人工确认点和 gate reason；missing evidence、raw download、license restriction、compute budget exceeded、repeated failure、unresolved refs、schema/verifier incomplete 等 blocker 会停在 needs-human/failed，不允许直接 allowed。
- Raw-data readiness 已成为正式 `raw-data-readiness-dossier` artifact，并暴露到 scientific reproduction skill/verifier manifest。Verifier 新增 `raw-data-readiness-gate`：没有 ready dossier 时禁止 raw execution；`rawExecutionGate.allowed=true` 只有在 approval、license、budget、environment、checksum/readiness checks 都满足时才可通过；blocked/needs-human dossier 可作为安全停住的 N3 产物通过 bounded verification。
- 本轮验证：`npm run typecheck`、`npm run smoke:agent-harness-profile-coverage`、`npm run smoke:scientific-reproduction`、`npx tsx tests/smoke/smoke-trajectory-training-record-export.ts`、`npx tsx tests/smoke/smoke-scientific-reproduction-trajectory.ts` 均通过。
- 第七阶段继续强化 N1/N2/N3 的执行性 gate，仍未触发 raw-data 下载或计算。Harness `VerificationPolicy` 支持 `selectedVerifierIds` 并通过 merge/trace 保留；`scientific-reproduction-research` profile 会选择 `verifier.scientific-reproduction`，让 runtime verifier registry 能从 harness contract 实际选中 scientific verifier。
- Self-prompt auto-submit gate 从字段校验升级为纯函数 `evaluateSelfPromptAutoSubmitGate`，输出 `auto-submit` / `needs-human` / `failed-with-reason` 决策，并把 missing refs、schema/verifier incomplete、budget/stop/human confirmation、missing evidence、raw download、license、compute 和 repeated failure 归一成结构化 blockers。
- Raw-data readiness gate 进一步收紧 ready 条件：ready dossier 必须有 `rawExecutionStatus=ready`、`approvalStatus=approved`、`rawExecutionGate.allowed=true`、全 checks pass、dataset source/checksum refs、verified/approved license、download/storage 估算不超过预算、正数 CPU/memory/wall budget 和 tool/env/genome refs。新增 ready pass、over-budget fail、missing-checksum fail smoke。
- 本轮追加验证：`npm run typecheck`、`npm run smoke:agent-harness-profile-coverage`、`npm run smoke:scientific-reproduction`、`npx tsx tests/smoke/smoke-scientific-reproduction-trajectory.ts`、`npx tsx tests/smoke/smoke-scientific-reproduction-verifier.ts` 均通过。
- 用户批准 raw-data 下载和计算后，第八阶段完成 N4 one-claim raw-data pilot，但仍保持通用实现：新增 package-owned `raw-data-execution-guard`，在 generated task 执行前检测 raw download/compute side-effect 信号；没有 ready `raw-data-readiness-dossier` 时直接返回 `repair-needed`，不启动下载任务。新增 `smoke:raw-data-preexecution-guard` 并纳入 `smoke:scientific-reproduction`。
- N4 实跑采用配置驱动的通用 BED interval-domain runner `tools/run-raw-bed-domain-pilot.py`，核心逻辑只接受 JSON config：下载公开 BED gzip refs、校验 checksum、按参数 merge intervals、按宽度阈值选 domain、输出 refs-first scientific reproduction artifacts。GSE242515 只是一个测试配置，不把论文、gene、figure 或 accession 写死在 runner 中。
- N4 真实下载/计算结果：从官方 NCBI GEO FTP 下载 `GSE242515_H3K4me3_RS4_WT_peaks.bed.gz`（313,162 bytes, sha256 `1bf74396000eae3bc4593b70882edc2b7d46a9bfeecf485524e69cc01d8f8e5f`）和 `GSE242515_H3K4me3_RS4_Setd1bKO_peaks.bed.gz`（206,123 bytes, sha256 `9e4bc9618a7a395565a70d2f8dcdc71bc661130b18b2db28532cdc82a222a143`），大对象保存在 gitignored `workspace/raw-data-pilot/gse242515-bed-domain/`，仓库只提交 refs-first artifact 和 config。
- N4 pilot 结论：使用配置参数 `mergeDistanceBp=500`、`domainWidthThresholdBp=5000`，RS4 WT 为 21,080 input intervals、20,613 merged domains、2,876 selected domains；RS4 Setd1bKO 为 13,810 input intervals、13,737 merged domains、83 selected domains，contrast/baseline ratio 0.02886。该结果作为 `partially-reproduced` 支持“Setd1bKO 下 broad H3K4me3 domain 大幅减少”的 bounded claim slice，但不升级为完整 FASTQ/BAM alignment、peak calling、replicate/stage 全量复现成功。
- N4 新增 artifact/smoke：`tests/fixtures/scientific-reproduction/raw-data-pilot-configs/` 保存通用 runner 配置；`tests/fixtures/scientific-reproduction/real-paper-raw-pilot/` 保存 `raw-data-readiness-dossier`、`analysis-notebook`、`figure-reproduction-report`、`evidence-matrix`、`claim-verdict`、`dataset-inventory`；`smoke:raw-bed-domain-pilot` 校验这些 artifact 通过 scientific reproduction contract、refs-first discipline、verifier raw readiness gate 和 bounded verdict semantics。
- 第九阶段完成 N5 capability semantics boundary hygiene：并行 sub agents 将 `smoke:no-src-capability-semantics` 输出拆成真实 package 语义泄漏与平台 contract vocabulary 误报；真实泄漏已迁移，误报已收敛成通用检查器分类。
- N5 真实迁移：`literature.retrieval` offline runner 从 `src/runtime` 移到 package-owned `packages/skills/literature/index.ts`，测试改从 package 入口读取；skill/tool projection fallback policy 移到 `packages/skills/capability-projection-policy.ts`；UI 的 selected tool contract 改从 `packages/skills/tool-skills-runtime.ts` 投影，不再在 UI 写死 `local.vision-sense` contract。
- N5 guard 修复：`tools/check-no-src-capability-semantics.ts` 继续阻止 package-owned artifact/component/provider/domain ids，但明确允许 runtime 自有 contract vocabulary、audit/provenance source、manifest schema version、runtime capability ids、interaction/progress/audit lifecycle terms 和 package export refs；不通过 baseline 掩盖真实 capability 语义。
- N5 验证：`npm run typecheck`、`npm run smoke:no-src-capability-semantics`、`npm run packages:check`、`npm run smoke:no-legacy-paths`、`npm run smoke:module-boundaries`、`npm run smoke:capability-default-callbacks`、`npx tsx tests/smoke/smoke-literature-retrieval-capability.ts`、`npx tsx tests/smoke/smoke-capability-budget-debits.ts` 均通过。
- 第十阶段完成 N6 raw reanalysis preflight：没有新增正式 artifact type，而是在 `raw-data-readiness-dossier` 上加入可选 `n6Escalation` metadata，记录 requested FASTQ/BAM/CRAM/SRA file classes、reanalysis intent、minimal runnable plan refs、downsample/region fixture refs 和 `stopBeforeExecutionUnlessReady=true`。该设计适配任何 raw sequencing/processed alignment 场景，不绑定论文、accession、provider 或工具。
- N6 package/fixture 更新：scientific reproduction skill 和 manifest 记录 N6 metadata-only preflight policy、允许的 preflight verdict、成功所需执行证据 refs；mock dataset discovery fixtures 新增 `raw-reanalysis-escalation-preflight`，网络 disabled、downloadedBytes=0、rawExecutionGate 默认 false。
- N6 guard/verifier 更新：raw-data pre-execution guard 覆盖更宽的 SRA/FASTQ/BAM/CRAM intent；新增 `smoke:scientific-reproduction-n6-raw-reanalysis-preflight`，证明 preflight artifacts 可通过 refs-first/readiness 验证，但没有 code/stdout/stderr/statistics/output figure 等执行证据时，提前声称 `reproduced` 会失败。
- N6 验证：`npm run typecheck`、`npm run smoke:scientific-reproduction`、`npm run packages:check`、`npm run smoke:no-src-capability-semantics`、`npx tsx tests/smoke/smoke-scientific-reproduction-n6-raw-reanalysis-preflight.ts`、`npx tsx tests/smoke/smoke-raw-data-preexecution-guard.ts` 均通过。
- 第十一阶段完成 N7 raw execution attestation 与 scope binding：`raw-data-readiness-dossier` 新增可选 `executionAttestations`，执行成功 evidence 必须绑定 plan/execution/code/stdout/stderr/output/checksum/environment/budget refs；verifier 新增 `raw-execution-attestation` blocking criterion，只有 `allowRawDataExecution=true` 且出现 raw success verdict 时才强制执行，不影响 blocked/preflight 或非 raw 场景。
- N7 guard 更新：pre-execution guard 不再因为存在任意 ready dossier 就放行 raw task；它会从 dossier datasets/accession/source/checksum/file-class 与 task files/side effects 提取通用 scope signals，目标不在 approved scope 内则返回 repair-needed，阻止 side effect。
- N7 fixture 更新：既有 bounded raw BED pilot 增加 completed execution attestation，继续证明 N4 的真实下载/计算也满足 N7；scientific reproduction skill、skill manifest、verifier manifest 记录 N7 policy 与 repair hints。
- N7 验证：`npm run typecheck`、`npm run smoke:scientific-reproduction`、`npm run packages:check`、`npm run smoke:no-src-capability-semantics`、`npx tsx tests/smoke/smoke-scientific-reproduction-verifier.ts`、`npx tsx tests/smoke/smoke-raw-data-preexecution-guard.ts`、`npx tsx tests/smoke/smoke-raw-bed-domain-pilot.ts` 均通过。
- 第十二阶段完成 N8 offline fixture dry-run readiness：`raw-data-readiness-dossier` 新增可选 `n8ExecutionReadiness`，记录 readiness mode、fixture execution gate、fixture input refs、command plan refs、environment probe refs、expected output contracts、dry-run stdout/stderr/output refs、promotion blockers 和 `stopBeforeLiveDownload=true`。
- N8 verifier/fixture 更新：verifier 新增 `offline-dry-run-boundary`，只要出现 N8 dry-run metadata，就禁止 `reproduced`/`partially-reproduced` verdict；mock dataset discovery fixtures 新增 `raw-reanalysis-execution-readiness-dry-run`，网络 disabled、downloadedBytes=0、rawExecutionGate false、fixtureExecutionGate true。
- N8 验证：`npm run typecheck`、`npm run smoke:scientific-reproduction`、`npm run packages:check`、`npm run smoke:no-src-capability-semantics`、`npx tsx tests/smoke/smoke-scientific-reproduction-n8-offline-dry-run.ts`、`npx tsx tests/smoke/smoke-scientific-reproduction-benchmark.ts` 均通过。
- 当前收束判断：本阶段“用真实例子拉通复杂科研问题解决能力”的目标已完成到 N8，且 src/package capability boundary guard 已恢复 0 baseline。继续做真实 FASTQ/BAM 下载、全量 peak calling 或 genome-cache 复算仍属于重型单论文重算工程；下一步若继续，应另建 execute-approved FASTQ/BAM milestone，先定义下载/存储/CPU/内存预算、环境锁、比对/peak-calling pipeline 和逐样本许可/checksum 策略。
