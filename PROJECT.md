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
- [ ] 设计一套网页端操作 runbook：打开应用、选择 workspace、上传/引用论文、输入 topic、追问、检查 artifact、继续分析、导出结果。
- [ ] 记录每轮网页交互的 screen state、mouse/keyboard action、prompt、response、artifact refs 和失败点。
- [ ] 区分“产品能力失败”和“研究结论失败”：前者进入通用修复，后者进入 negative result。
- [ ] 建立最小复测流程：每次通用修复后都回到网页端用同类操作复测。

验收：
- [ ] 至少完成一次全程网页端 attempt，不依赖直接调用内部脚本来绕过 SciForge UI。

### R002 论文理解与 Claim Graph

职责：让 SciForge 从 PDF 中抽取可复现的科学主张，而不是只做摘要。

Todo：
- [ ] 对 3 篇 PDF 生成 `paper-claim-graph`：main claims、subclaims、key figures、实验设计、数据类型、物种、细胞阶段、变量和统计方法。
- [ ] 生成 `figure-to-claim-map`：每个关键 figure 支撑哪些 claim，需要哪些数据和分析步骤。
- [ ] 标注复现风险：数据缺失、方法不完整、统计描述不足、外部依赖、结论超出证据。
- [ ] 阅读过程采用 refs-first：大段 PDF 内容保存在 artifact，只把 bounded summary 和 page/section locator 交给模型。

验收：
- [ ] 每篇论文至少有 5 个可检查 claim，并能追溯到 PDF 页码或章节。

### R003 数据与代码发现

职责：定位真实复现所需数据、代码和 supplementary material。

Todo：
- [ ] 从论文正文、methods、data availability、supplementary information 中抽取 accession、链接、数据表和代码线索。
- [ ] 用通用检索能力查询 GEO/SRA/ENA/ArrayExpress/figshare/GitHub/期刊 supplement。
- [ ] 输出 `dataset-inventory`：数据源、样本、assay、物种、基因组版本、下载大小、许可、可用性。
- [ ] 输出 `missing-data-report`：缺失什么、为什么缺失、是否可用 proxy 或 public alternative。

验收：
- [ ] 找不到数据时必须 structured partial/failure，不能把论文文字当作真实数据。

### R004 通用 Bioinformatics 执行环境

职责：为论文复现建立可复用执行 profile，而不是为单篇论文临时拼命令。

Todo：
- [ ] 声明常用工具能力：FASTQ/BAM/BED/bigWig 处理、peak calling、overlap、signal matrix、gene annotation、统计检验、plot。
- [ ] 声明 Python/R package、命令行工具、基因组 annotation/cache、CPU/内存/时间/下载预算。
- [ ] 建立降级策略：无原始数据时使用 processed table；无完整 genome cache 时用小样本 fixture；无网络时输出 missing-data。
- [ ] 所有工具选择进入 capability manifest/broker/harness，不在论文任务里写死命令。

验收：
- [ ] 同一执行 profile 可服务 2020 和 2025 两篇论文。

### R005 2020 PRDM9/DSB Fate 复现 Attempt

职责：复现或质疑“PRDM9-mediated H3K4me3 与 DSB fate 有内在联系，早形成 DSB 更开放且更倾向 CO fate”。

Todo：
- [ ] 用网页端多轮提示 SciForge 制定最小复现计划。
- [ ] 尝试复现 stage-specific H3K4me3 peak、PRDM9 binding overlap、SPO11/DMC1 hotspot association。
- [ ] 尝试复现 open chromatin/NOMe signal 与早晚 DSB、CO/NCO proxy 的关系。
- [ ] 做 threshold/peak caller/replicate/stage confounding 敏感性检查。
- [ ] 输出 `figure-reproduction-report`、`evidence-matrix`、`claim-verdict`。

验收：
- [ ] verdict 明确为 reproduced、partially-reproduced、not-reproduced 或 contradicted，并附证据链。

### R006 2025 SETD1B/Broad H3K4me3 复现 Attempt

职责：复现或质疑“SETD1B-RFX2 介导 spermatid-specific broad H3K4me3，并控制表达强度和时间模式”。

Todo：
- [ ] 用网页端多轮提示 SciForge 制定最小复现计划。
- [ ] 尝试复现 broad-vs-sharp H3K4me3 domain calling。
- [ ] 尝试复现 broad H3K4me3 与 H3K27ac enhancer/promoter overlap。
- [ ] 尝试复现 stage temporal expression pattern 与 Setd1b/Rfx2 perturbation 证据。
- [ ] 做 gene length、baseline expression、annotation version、batch/stage confounding 检查。

验收：
- [ ] 产出与 R005 同一 schema 的通用 artifact，而不是 2025 论文专属格式。

### R007 2022 Review 到因果证据 Rubric

职责：把综述中的 cause/consequence 框架变成可检查标准，用于评估研究论文结论强度。

Todo：
- [ ] 抽取 histone PTM 作为 cause、consequence、reinforcement、memory mark 的判据。
- [ ] 生成 `causal-evidence-rubric`：必要证据、增强证据、反证、常见混杂。
- [ ] 用 rubric 评估 2020 和 2025 的主张，区分相关性、时间顺序、扰动证据和机制证据。

验收：
- [ ] rubric 可用于其他 histone/PTM 论文，不包含这 3 篇论文的特例逻辑。

### R008 负结果与强质疑机制

职责：让 SciForge 能合理反驳论文，而不是默认支持论文。

Todo：
- [ ] 为每篇研究论文至少设计 3 个反证检查。
- [ ] 负结果输出 `negative-result-report`，包含检查动机、数据、代码、统计、结论影响。
- [ ] UI 中清楚显示 not-reproduced/contradicted，不把它包装成普通失败。
- [ ] 验证 repair pipeline 不会把科学负结果强行修成正结果。

验收：
- [ ] 至少一个 attempt 产生可审计的 partial 或 negative conclusion。

### R009 科学复现 Artifact Schema 与 View

职责：沉淀通用 artifact，不让结果散成聊天文本。

Todo：
- [ ] 定义 `paper-claim-graph`、`dataset-inventory`、`analysis-plan`、`analysis-notebook`。
- [ ] 定义 `figure-reproduction-report`、`evidence-matrix`、`claim-verdict`、`negative-result-report`。
- [ ] 定义 `trajectory-training-record`，用于导出训练数据。
- [ ] 每个 schema 配 validator、repair hints、view manifest 和 refs-first 大对象策略。

验收：
- [ ] 2020 和 2025 attempts 使用同一套 schema。

### R010 复现质量 Verifier

职责：判断 SciForge 的复现结果是否可信、可追溯、可训练。

Todo：
- [ ] 检查每个 claim 是否有 evidence 或明确 missing evidence。
- [ ] 检查每个 figure reproduction 是否有代码、输入数据、参数、stdout/stderr、统计方法。
- [ ] 检查 accession/DOI/PMID/title/year/journal 是否核验。
- [ ] 检查 verdict 是否区分 reproduced/partial/not-reproduced/contradicted。
- [ ] Verifier 失败进入 validation/repair/audit pipeline。

验收：
- [ ] Verifier 能阻止“看起来像报告但没有证据链”的结果被标为成功。

### R011 轨迹训练数据导出

职责：把人类式复现过程变成训练科学研究自动化模型的数据。

Todo：
- [ ] 导出 state/action/observation 序列：网页状态、用户式 prompt、工具结果、artifact lineage。
- [ ] 导出 decision rationale：为什么追问、为什么换参数、为什么判定失败或质疑论文。
- [ ] 导出 repair history：失败、诊断、修复、复测。
- [ ] 脱敏本地绝对路径、API key、临时文件名，用 workspace refs 替代。

验收：
- [ ] 单个 attempt 可重放或审计，不依赖聊天上下文记忆。

### R012 UI/交互能力缺口修复

职责：通过真实网页操作发现 SciForge 产品能力问题，并只做通用修复。

Todo：
- [ ] 记录长任务进度是否清楚：当前阶段、下一步、卡点、可取消/继续操作。
- [ ] 记录 artifact 是否容易打开、比较、引用、追问和导出。
- [ ] 记录 evidence matrix、claim verdict、negative result 是否有清晰视图。
- [ ] 发现 UI 问题后新增通用 issue，不做论文专属展示。

验收：
- [ ] 每个 UI 修复都能被非 cell/epigenomics 任务复用。

### R013 自我提示式复现 Agent

职责：从“Codex 代替人类多轮提示”逐步过渡到“SciForge 自己根据论文多轮提示自己”。

Todo：
- [ ] 从 R001/R011 的人类式轨迹中抽象 prompt strategy：阅读、规划、取数、计算、检查、反证、总结。
- [ ] 定义 self-prompt loop contract：下一轮问题、需要的 refs、停止条件、质量门槛。
- [ ] 先 shadow 运行，只建议下一轮 prompt；通过验证后再允许自动提交下一轮。
- [ ] 防止无限循环：预算、最大轮次、失败停止、人类确认点。

验收：
- [ ] SciForge 能基于一篇新论文自动提出下一轮高质量复现提示，但仍可被人类审阅。

### R014 小样本/Mock Benchmark

职责：让通用能力可测试，不依赖 live 数据源和大规模下载。

Todo：
- [ ] 为 claim graph、dataset inventory、negative result、trajectory export 建立小样本 fixture。
- [ ] 为 GEO/SRA/GitHub/provider timeout/missing data 建立 mock provider。
- [ ] 建立 smoke：验证 schema、verifier、failure semantics、refs-first、trajectory export。

验收：
- [ ] CI 可验证通用 contract，不需要真的下载大型测序数据。

## 当前里程碑

- [ ] M1：用网页端 Computer Use 完成一次 2020 或 2025 论文的人工式多轮 attempt。
- [ ] M2：产出第一版 `paper-claim-graph`、`dataset-inventory`、`evidence-matrix`、`claim-verdict`。
- [ ] M3：发现至少 3 个通用产品/能力缺口，并写成可实现任务。
- [ ] M4：完成一个通用修复后回到网页端复测。
- [ ] M5：导出一份可审计的 `trajectory-training-record`。
