# SciForge 科研 Benchmark 调研报告

调研日期：2026-10-11。范围：16 个科研、机器学习与生命科学 Benchmark。

本文整理已经核查的论文、官方研究报告、任务定义、数据卡、评测实现与官方实验结果。每张卡片包括定位、任务构建、能力覆盖、输入输出、指标与裁判、运行环境、Baseline、轨迹、开放范围和项目适用性，并给出至少三个官方任务或论文案例。**本文是资料调研报告；没有运行 SciForge Baseline，也没有声称复现官方成绩。**

项目相关性依据 [SciForge README](../../README.md) 和 [AgentRuntime 契约](../agent-runtime-contract.md)：SciForge 使用 Codex、Claude Code 等成熟 runtime，提供科研上下文、科学能力、对象与产物管理、人工审阅和证据归集。下文的“建议”“接入难度”和“项目价值”属于调研判断，官方事实及成绩另附来源。所有代码引用固定到本次核查的 commit，见文末。

完整卡片导航：

[ResearchClawBench](#2-researchclawbench) · [ResearchGym](#3-researchgym) · [PaperBench](#4-paperbench) · [AIRS-Bench](#5-airs-bench) · [MLGym](#6-mlgym) · [ScienceAgentBench](#7-scienceagentbench) · [DiscoveryBench](#8-discoverybench) · [DiscoveryWorld](#9-discoveryworld)

[MLE-Bench](#10-mle-bench) · [LABBench2](#11-labbench2) · [NatureBench](#12-naturebench) · [LifeSciBench](#13-lifescibench) · [GeneBench-Pro](#14-genebench-pro) · [ProteinGym](#15-proteingym) · [BioMysteryBench](#16-biomysterybench) · [CompBioBench](#17-compbiobench)

## 1. 调研结论与横向比较

这些 Benchmark 评价的对象不同，不能把任务数或原始分数直接排成一个科研能力排行榜。ResearchClawBench 关注从原始数据到研究产物的再发现；PaperBench 关注已知论文的复现；ResearchGym、AIRS-Bench、MLGym、NatureBench 关注迭代研究或模型优化；ScienceAgentBench、CompBioBench、BioMysteryBench、GeneBench-Pro 关注可验证的科研分析；DiscoveryBench 与 DiscoveryWorld 分别关注数据发现和仿真实验；LABBench2、LifeSciBench 关注研究辅助与专业判断；ProteinGym 的原始评价对象则是蛋白质预测方法。

| Benchmark | 规模与计数单位 | 核心评价对象 | 主要评分 | 当前开放与运行条件 | 对 SciForge 的建议 |
| --- | --- | --- | --- | --- | --- |
| ResearchClawBench | 40 任务，10 学科 | 自主研究、论文级再发现 | 多模态加权 Rubric | 任务、代码开放；依赖与裁判服务按任务配置 | 核心候选；周期性端到端评测 |
| ResearchGym | 论文集 5 环境、39 子任务 | 新方法提出与实验迭代 | 客观指标、超 Baseline 比率 | 代码、任务开放；单 A100、12–24 小时 | 高成本研究能力专项 |
| PaperBench | 20 论文、8,316 叶子评分项 | 论文实现、运行与结果复现 | 分层 Rubric、复现执行、模型裁判 | 代码与 Rubric 公开；GPU 与评分成本较高 | 长程交付专项 |
| AIRS-Bench | 20 任务、7 类问题 | 前沿 ML 研究优化 | VSR、Normalized Score、Elo | 任务与转换工具开放；官方单 H200、24 小时 | 跨任务优化能力专项 |
| MLGym | 论文 Benchmark 13 任务 | ML 研究 Agent | 原始指标、Performance Profile/AUP | 框架开放；依赖与训练预算按任务定义 | ML 工程与实验管理补充 |
| ScienceAgentBench | 102 任务、44 论文 | 科研程序与分析产物 | VER、SR、CodeBERTScore、成本 | verified 数据与代码公开；完整产物另下载 | 首批可执行科研分析集 |
| DiscoveryBench | 264 真实任务＋903 合成任务 | 数据驱动假设发现 | Hypothesis Matching Score | 数据与裁判脚本公开；需模型裁判 | 假设与证据整合专项 |
| DiscoveryWorld | 120 实例＝8 主题×3 难度×5 seeds | 实验、探索与规律发现 | 完成、过程、知识分数 | 仿真器开放；需专用 API 适配 | 仿真实验研究，优先级较低 |
| MLE-Bench | 75 Kaggle 竞赛；Lite 22 | ML 竞赛工程 | 竞赛指标与奖牌率 | 代码开放；Kaggle 账户、竞赛数据许可与 GPU | ML 工程回归补充 |
| LABBench2 | 论文计数 1,912，含输入模式变体 | 检索、读图、数据库、分子生物学辅助 | 正确率；模型裁判＋程序验证 | 代码公开；当前完整数据下载要求授权 | 科研检索与对象处理核心补充 |
| NatureBench | Full 90、轻量轨道 25 | 跨科学领域 ML 编程与 SOTA 对比 | SOTA gap、Match/Surpass、有效性审查 | 容器、任务、运行器公开；4 小时/任务 | 首选科学 ML 端到端候选 |
| LifeSciBench | 750 任务、19,020 Rubric 条目 | 生命科学专业判断 | 归一化 Rubric 分、70% 通过阈值 | 论文与案例公开；未定位完整可运行包 | 参考专业质量维度，暂不列可运行主集 |
| GeneBench-Pro | 129 完整评测；公开 10 案例 | 多阶段统计与基因组推断 | 所有答案字段同时通过 | 公开案例含答案与 grader；其余保留 | 高难统计诊断集，不能代替完整榜单 |
| ProteinGym | 当前 DMS：217 替换、74 indel assays | 蛋白质变异效应预测方法 | Spearman、NDCG、AUC 等 | 数据、预测、结构、MSA、评分代码开放 | 蛋白质能力模块专项 |
| BioMysteryBench | 报告 99；当前 full 90、preview 5 | 匿名生物数据分析 | 最终答案正确率 | 数据 gated、仅限评测；工具与数据库可用 | 授权后纳入生物分析专项 |
| CompBioBench | 100 任务 | 真实计算生物学工具工作流 | 最终答案准确率 | 问题、输入、CLI runner 开放；参考答案由评测侧掌握 | 首批生物分析候选，runtime 对齐度高 |

**建议的组合**：先以 ScienceAgentBench verified 和 CompBioBench 建立可执行分析评测，再以 NatureBench-25 和 ResearchClawBench 检验跨学科工作流与研究产物。LABBench2 获得数据访问后补充检索、图表、序列和克隆设计。PaperBench、ResearchGym、AIRS-Bench 用作定期高成本评测。这个排序依据任务相关性、评分可解释性及公开运行材料，不代表已测得 SciForge 在其中的优劣。

各 Benchmark 都没有直接完整评价 SciForge 的人工审阅、研究对象关系、证据归集和跨会话交接。正式分数应保留官方定义；这些产品能力可以结合任务产物另行检查，不能混入官方分数。自主协议下的运行也不能经过人工纠偏后继续与自主 Baseline 对比。

## 2. ResearchClawBench

**文献**：[ResearchClawBench: A Benchmark for End-to-End Autonomous Scientific Research，2026](https://arxiv.org/abs/2606.07591)。核查论文全文、v5 摘要及[官方仓库][rc-repo]；任务数据入口为 [Hugging Face](https://huggingface.co/datasets/InternScience/ResearchClawBench)。

| 卡片项目 | 调研结果 |
| --- | --- |
| 定位与评价对象 | 测量 Agent 从研究目标、原始数据和相关文献出发，独立形成分析、实验和研究产物的能力。目标论文在执行阶段隐藏，区别于提供完整论文的复现任务。 |
| 任务构建与规模 | 40 个任务，来自真实已发表论文；覆盖天文、化学、地球、能源、信息、生命、材料、数学、神经科学、物理 10 学科。领域专家筛选论文、整理输入并制定多模态评分项；任务来源与参考产物公开，污染风险仍存在。 |
| 能力覆盖 | 数据理解、专业方法选择、科研编程、实验与验证、图表、证据组织、报告；工作流长度和资源差异较大。分数主要刻画对目标论文关键产物的恢复，不足以证明全新发现得到独立科学验证。 |
| 输入与输出 | 输入任务说明、数据、相关文献；目标论文及评分材料隔离。交付工作区中的代码、图像、结果与研究报告；评分器读取这些产物，不能仅提交一段自然语言摘要。 |
| 指标与计算 | 主分为 0–100 的加权 Rubric 得分，50 对应目标论文级再发现的标尺；逐项给分并保留理由。论文与当前 README 对“超越”区间表述存在差异：论文讨论超过 50 的发现空间，README 标注 70+；不应把二者当作通用二元成功阈值。 |
| Evaluator 与参考答案 | 领域专家依据目标论文拆分评价标准，模型裁判同时读文本与图像。论文使用 GPT-5.1；当前代码要求显式配置 `JUDGE_MODEL_NAME` 与裁判端点。代码可执行、图中有结果和科学证据真实成立仍需区别；模型裁判不是独立湿实验验证。 |
| 环境与预算 | 当前运行器以 CLI 启动不同 Agent，支持工作区、实时输出和后续评分；不是所有任务都有统一容器。Python/R/科学库、数据规模及 GPU 需求按任务变化。公开入口没有足够清晰的全系统统一预算表，不能从某个 CLI preset 的超时推断整篇论文的共同时间预算。 |
| 可观测性 | [运行器][rc-run]保留 run ID、工作区、日志和耗时；[评分器][rc-score]给出评分项及理由。可诊断实验协议不匹配、证据不匹配和遗漏核心科学分析，需回查代码与实际结果。 |
| 开放与维护 | 仓库 MIT；输入数据与原论文仍需按各自授权使用。当前快照含社区新增成绩，说明评测入口仍在更新；要同时冻结任务、Rubric、裁判、Agent 版本与预算。 |
| 项目适用性 | **高相关，接入难度中高**。适合评测科学能力组合、长程执行、研究报告与产物归集。适合周期性评测；LLM 评分波动及任务资源差异使其不适合作为唯一的快速回归指标。 |

代表性任务，依据[官方任务目录][rc-tasks]：

1. `Astronomy_000`：利用黑洞质量与自旋数据进行超轻玻色子约束，要求相应贝叶斯推断与后验分析；核心是物理假设和统计方法。
2. `Life_000`：从天然黏附蛋白序列特征对应的单体组成及实验表格，设计具有较强水下黏附性能的合成水凝胶；涉及性质预测、配方优化和验证。
3. `Physics_002`：分析量子电路 cross-entropy benchmarking 数据与保真度，要求相应深度、误差和物理模型分析，而不仅绘制趋势。

**官方 Baseline**：论文比较 7 个自主研究 Agent 和 17 个通过 ResearchHarness 执行的原生 LLM；Claude Code 平均 21.5，ResearchHarness 中 Claude Opus 4.7 平均 20.7。26.5 是按任务挑选最佳 LLM 的 frontier 均值，不是一个可直接部署的 Agent 成绩。仓库 2026-09 更新另列 InnoClaw 2.0＋GPT-5.5 为 34.89；它属于后续社区结果，配置不同，不能替代论文对照。上述分数均为平均 Rubric 分，不是成功率。[论文](https://arxiv.org/abs/2606.07591)、[当前结果及配置][rc-repo]。

**局限与结论**：在本次列表中，它对“数据到完整研究交付”最直接。应保留评分项对应的证据文件和可运行脚本，对报告中声称的实验做抽查；高分报告不自动意味着新发现成立。当前首选用途是研究产物质量和失败链条分析。

## 3. ResearchGym

**文献**：[ResearchGym: Evaluating Language Model Agents on Real-World AI Research，2026](https://arxiv.org/abs/2602.15112)。官方实现：[ResearchGym][rg-repo]。

| 卡片项目 | 调研结果 |
| --- | --- |
| 定位与评价对象 | 评价开放式 AI 研究：在问题、数据、评测机制和强 Baseline 已知，但原论文方法被隐藏的情况下，提出和验证更好的方法。主要是视觉、NLP、RL 与持续学习研究。 |
| 任务构建与规模 | 论文正式测试集来自 ACL/ICML/ICLR 2025 的 5 篇研究，形成 5 个环境、39 个子任务；保留代码基础、数据与评分，移除目标创新。当前仓库还有额外任务目录，不能全部算入论文的 5 环境统计。 |
| 能力覆盖 | 研究计划、算法修改、训练、对照实验、资源分配、反馈迭代与恢复。真正难点是从正确运行走向稳定超越强 Baseline。 |
| 输入与输出 | 输入研究目标、任务说明、代码库、数据、参考 Baseline 与评测入口。输出可执行方法、训练/实验代码、日志与指标；任务的 `grade.sh` 按表格和数据集评分。 |
| 指标与计算 | 完成率统计获得有效评分的子任务；改进率统计超越规定 Baseline 的运行；Normalized Performance 以相应任务的 SOTA 为参照。必须同时报告子任务覆盖和指标，不能把一个最佳子任务当成完整环境成功。 |
| Evaluator 与参考答案 | 主要使用任务专属程序与数值指标，例如 F1、检索 Recall、持续学习准确率、RL return。InspectionAgent 检查作弊与不当评测操作；它不替代主指标。多解允许，只要遵守规定数据、骨干模型及评测协议。 |
| 环境与预算 | Docker 环境和任务依赖；论文主实验单张 A100 80GB，12 小时与 10 美元 API 预算。最佳运行追加 12 小时与 10 美元的恢复实验单独报告，不能与基本预算混用。 |
| 可观测性 | RGAgent 保存动作、观察、运行状态和代码版本；支持恢复运行，可分析训练配置、预算浪费、方案切换及不可靠提升。[运行实现][rg-run]。 |
| 开放与维护 | 任务、运行器、参考 Agent 公开；不同任务继承不同上游代码/数据/模型许可。核查快照未定位覆盖全部仓库的统一根许可证，不能因为内置 inspect-ai 使用 MIT 就认定整个 Benchmark 均为 MIT。 |
| 项目适用性 | **研究相关性高，接入难度高**。适合检验实验管理、记忆、恢复和科研方法探索；单次耗时长，适合作为定期专项而非每次提交必跑。 |

代表性环境，均有[官方任务说明][rg-tasks]：

1. `materials-tokenization`：在 SciBERT 和指定词表约束下改进材料科学 tokenization，评测 SOFC、MatScholar 等任务的 Micro/Macro F1。
2. `cross-modal-retrieval`：设计图像—文本跨模态检索方法，分别评测两个方向的 Recall。
3. `continual-learning`：在数据流和指定持续学习设置下改进分类方法，关注最终准确率及 Average Anytime Accuracy；还包含 replay buffer 和时间序列解释研究环境。

**官方 Baseline**：主实验 RGAgent＋GPT-5 high，5 环境各 3 个 seed，共 15 次。平均子任务完成率 26.5%，仅 1/15 次超越强 Baseline，改进率 6.7%。时间序列环境中一个最佳运行的 CPD 为 0.589，对照 SOTA 为 0.463；这说明存在局部突破，但不代表整体研究可靠。其他系统及延长预算结果见论文实验与消融部分。[论文](https://arxiv.org/abs/2602.15112)、[任务评分脚本][rg-grade]。

**局限与结论**：5 个环境对科研领域覆盖有限，39 个子任务也不是 39 个独立研究问题。训练随机性、子任务选择和延长预算影响成绩。适合检验“完成实验—选择方法—验证改进”的环节，尤其关注没有成功提交、做了很多实验却没有可靠提升的运行。

## 4. PaperBench

**文献**：[PaperBench: Evaluating AI’s Ability to Replicate AI Research，2025](https://arxiv.org/abs/2504.01848)。核查 v3；官方代码：[frontier-evals / paperbench][pb-repo]。

| 卡片项目 | 调研结果 |
| --- | --- |
| 定位与评价对象 | 让 Agent 复现已提供的 ML 论文，评价代码开发、实际执行及实验结果恢复。研究目标已知，主要衡量复现能力与长程工程交付。 |
| 任务构建与规模 | 20 篇 ICML 2024 oral/spotlight 论文，覆盖 12 个主题；作者参与制定分层 Rubric，总计 8,316 个可评分叶子项。不是 8,316 个独立 Agent 任务。 |
| 能力覆盖 | 读论文、补足实现细节、编写训练/分析代码、调试、实验与复现、环境和时间管理。不能直接等同于自主提出科学问题或创新。 |
| 输入与输出 | 输入论文及补充说明 addendum，隐藏评分 Rubric；协议限制使用论文作者的原始实现。输出代码仓库与 `reproduce.sh`，用于从干净环境重新执行复现。 |
| 指标与计算 | 叶子项按是否满足要求评分，父节点按权重聚合，最终为 Replication Score。分别观察代码开发、执行和结果匹配；Code-Dev 变体只测部分环节，不能与完整复现分混用。 |
| Evaluator 与参考答案 | 独立 Reproduction 阶段执行代码，然后 SimpleJudge 对层级节点检查证据。作者参与确保科学目标与评分项对应；JudgeEval 校验裁判可靠性。仍存在模型对代码/日志理解的错误及结果证据不足。 |
| 环境与预算 | 论文第 5.2 节的 BasicAgent 主实验为 12 小时；仓库榜单把 IterativeAgent o1-high 标为 24 小时，另有 36 小时扩展。独立复跑环境 Ubuntu 24.04、A10 GPU、最长 12 小时。部分任务需要模型访问、ImageNet 等数据权限和大量训练。仓库示例的短时间默认设置仅用于运行入口演示。 |
| 可观测性 | 保存 Agent 代码和轨迹、复跑日志、节点评分及裁判理由；可区分代码未完成、复跑失败和指标未达到要求。[裁判实现][pb-judge]。 |
| 开放与维护 | 论文、任务、addenda、Rubric、评测代码公开，部分文件用 Git LFS。核查快照没有发现统一根 LICENSE，且论文/第三方数据/模型授权分别适用；“能 clone”不能推导可任意再分发。 |
| 项目适用性 | **长程交付相关性高，接入难度高**。很适合检查研究工作区、可复跑产物、环境和证据交接；高耗时与裁判成本不适合短周期全量回归。 |

代表性论文实例，依据[官方论文配置][pb-papers]：

1. `pinn`，*Challenges in Training PINNs: A Loss Landscape Perspective*：实现与研究 PINN 的训练、损失景观及相应实验。
2. `robust-clip`，*Robust CLIP: Unsupervised Adversarial Fine-Tuning of Vision Embeddings for Robust Large Vision-Language Models*：复现视觉嵌入的无监督对抗微调及鲁棒性评估。
3. `semantic-self-consistency`，*Semantic Self-Consistency: Enhancing Language Model Reasoning via Semantic Weighting*：实现语义加权推理方法并恢复实验结果。

**官方 Baseline**：BasicAgent＋Claude 3.5 Sonnet 为 21.0±0.8%，BasicAgent＋o1-high 为 13.2±0.3%；IterativeAgent＋o1-high 为 24.4±0.7%（仓库榜单注明 24 小时），36 小时扩展为 26.0±0.3%。主要实验重复 3 次，误差为均值标准误。SimpleJudge＋o3-mini-high 在 JudgeEval 的 F1 为 0.83，它是评分器可靠性指标。人类最佳组在 3 篇论文、48 小时协议下为 41.4%，不能作为全 20 篇的人类成绩。论文估计 o1 的 12 小时 rollout 平均约 400 美元/论文，o3-mini 评分另约 66 美元/论文；这是当时的开销估计，未含全部算力，也不是当前 API 报价。见[论文表 4–6、成本及人类对照](https://arxiv.org/abs/2504.01848v3)及[仓库榜单的预算标注][pb-repo]。两种 Agent 的时间标签应分别记录，不能合并为同一预算实验。

**局限与结论**：Replication Score 是加权要求完成度，不是“复现成功的论文比例”。实际结果必须通过干净环境重跑。建议将完整复现评分与 Code-Dev 分开，使用节点失败证据定位问题，不凭一个总分认定科学结果被复现。

## 5. AIRS-Bench

**文献**：[AIRS-Bench: a Suite of Tasks for Frontier AI Research Science Agents，2026](https://arxiv.org/abs/2602.06855)。核查 v2 全文及当前[官方仓库][airs-repo]。

| 卡片项目 | 调研结果 |
| --- | --- |
| 定位与评价对象 | 衡量 Agent 在多种 ML 研究任务中迭代设计方案、训练并接近或超越人类研究结果的能力；Agent 定义为 scaffold 与基础模型的组合。 |
| 任务构建与规模 | 从更大的约 100 任务候选池筛选 20 任务，覆盖 7 类 ML 问题，并分析精简集合对总体能力排序的保留。每任务定义研究问题、数据、主指标及文献 SOTA。 |
| 能力覆盖 | 方案探索、预训练模型选择、训练/特征工程、搜索策略、实验反馈与算力管理。科学“发现”的主要操作化定义是标准数据集指标改进。 |
| 输入与输出 | 输入 `project_description.md`、训练/验证数据与提交规范；输出约定的预测文件或模型产物，提交测试评测。各任务格式不同，不能统一假定都是自然语言报告。 |
| 指标与计算 | VSR 是各任务有效提交率的平均；NS 用任务特定变换后的得分相对最差值和 SOTA 归一化；另报 Elo。失败和无有效数值提交按 0 NS 纳入。NS 的最差参照来自被评测组合，改变比较集合会影响归一化基准。 |
| Evaluator 与参考答案 | 执行任务评分程序，使用隐藏测试标签及原指标；不是 LLM 判断论文好坏。SOTA 来自文献，但其训练硬件和数据条件不一定与统一 Agent 设置相同，超过分数不能自动证明方法创新。 |
| 环境与预算 | AIRA-dojo 支持 one-shot/greedy 搜索，MLGym 以顺序 ReAct 执行。官方每次 24 小时、单 H200，每任务每组合至少 10 次运行；可访问受约束、缓存的 Hugging Face 预训练模型。 |
| 可观测性 | 可分析候选实验、有效/无效提交、最终得分与不同搜索策略；必须保留搜索树或线性轨迹以及实际选中的提交。 |
| 开放与维护 | 任务、环境准备脚本、AIRA-dojo→MLGym 转换公开。仓库许可证 CC BY-NC 4.0，上游数据和 checkpoint 仍有独立条款。全量参考预算很高。 |
| 项目适用性 | **ML 研究相关性高，接入难度高**。用于验证实验搜索、算力调度和结果选择；任务规范可以迁入运行平台，但直接替换 scaffold 后需要重新解释比较条件。 |

代表性实例，见[任务规范][airs-tasks]：

1. `GMolecularPropertyPredictionQm9MeanAbsoluteError`：从分子结构预测 QM9 分子性质，按 MAE 评价，验证数据处理、表征与模型训练。
2. `CodeRetrievalCodeXGlueMRR`：在 CodeXGLUE 代码检索任务中优化检索，按 MRR 评价。
3. `CoreferenceResolution-WinograndeAccuracy`：解决 WinoGrande 指代问题，按准确率评价；论文记录 greedy gpt-oss-20b 某次达到 0.88，对照 SOTA 0.85。

**官方 Baseline**：论文图 4 比较 14 个 scaffold/model 组合。在 20 任务聚合口径下，One-Shot GPT-4o 的 VSR/NS/Elo 为 18%/0.06/756，Greedy GPT-4o 为 83%/0.33/1056，Greedy gpt-oss-120b 为 97%/0.52/1247；图中 SOTA 的 NS=1、Elo=1690 是参照。只有约 1.55% 的 Agent×任务×运行结果超过 SOTA，集中于 greedy 策略。数字依据[论文 v2 图 4及第 6 节](https://arxiv.org/html/2602.06855v2#S6)，不是当前实时榜单。

**局限与结论**：NS 不是简单的“Agent 分/SOTA 分”，也不是成功率。其定义为 `NS=(φ(s_agent)-φ(s_min))/(φ(s_SOTA)-φ(s_min))`，其中变换依据与理想分的距离。比较 SciForge 配置时需要固定任务、参照值、预算与提交选择，否则聚合分变化未必来自能力变化。

## 6. MLGym

**文献**：[MLGym: A New Framework and Benchmark for Advancing AI Research Agents，2025](https://arxiv.org/abs/2502.14499)。官方实现：[facebookresearch/MLGym][mlgym-repo]。

| 卡片项目 | 调研结果 |
| --- | --- |
| 定位与评价对象 | 一套 ML 研究 Agent 环境及配套 MLGym-Bench。评价从 Baseline 出发，通过代码修改、训练和实验反馈改进性能的能力。 |
| 任务构建与规模 | 论文集 13 任务，覆盖图像、语言、回归、强化学习、博弈和算法优化。当前仓库的配置数量与论文集不完全相同；框架可自定义任务，不等于新配置已经经过正式 Benchmark 校验。 |
| 能力覆盖 | 编程、调试、模型训练、算法优化、实验记录与记忆；既包含标准预测，也包含策略及 3-SAT 启发式。 |
| 输入与输出 | YAML 定义数据、依赖、starter code、评测器及训练限制。Agent 修改工作区代码，通过 `validate` 获取反馈，最终 `submit` 提交；提交结果和过程中的最佳尝试不是同一统计量。 |
| 指标与计算 | 任务有准确率、R²、BLEU、loss、return、运行时间等不同方向的指标。通过 Performance Profile 与 AUP 聚合；Best Attempt@4 包含中间有效尝试，Best Submission@4 仅看最终提交。 |
| Evaluator 与参考答案 | 任务专属执行脚本与只读评分逻辑；主分不依赖 LLM Judge。必须保护测试数据、避免修改评分程序，合理使用验证反馈。 |
| 环境与预算 | 容器/Conda、GPU 与任务数据；论文每次最多 50 次环境交互，训练命令另有任务级超时，例如 CIFAR-10 配置为 1,800 秒。50 steps 不是固定 50 次训练，也不是固定 50 秒。 |
| 可观测性 | 动作、验证、提交、代码及成本；Memory Module 保留有效配置与研究日志。适合检查模型是否忘记历史最佳结果、最后提交是否劣于中间尝试。[环境实现][mlgym-env]。 |
| 开放与维护 | 框架、任务配置、基线和评分逻辑公开；仓库 CC BY-NC 4.0，具体数据/模型分别授权。大型任务下载、RL 编译与训练环境会增加复现成本。 |
| 项目适用性 | **ML 工程相关性高，接入难度中高**。适合科学 ML、实验状态和记忆评测；通用论文阅读、证据引用和报告质量覆盖较弱。 |

代表性任务，见[官方配置][mlgym-tasks]：

1. `imageClassificationCifar10`：从基线 CNN 改进 CIFAR-10 分类；关注训练、准确率和资源限制。
2. `regressionKaggleHousePrice`：处理房屋表格数据，做特征与回归模型改进，评估 R²/RMSE。
3. `rlBreakoutMinAtar`：训练 MinAtar Breakout 策略，按平均回报评分；另有 3-SAT 变量选择启发式任务按求解时间评分。

**官方 Baseline**：5 个基础模型配合相同框架，每任务 4 次。论文表 4 的 Best Submission AUP@4：Llama-3.1-405B 1.039、GPT-4o 1.029、Claude 3.5 Sonnet 1.135、Gemini 1.5 Pro 1.125、o1-preview 1.176。例：CIFAR-10 最终提交 best-of-4 中 Claude 为 0.894、o1 为 0.854，参考 Baseline 0.497；房价任务 o1 的 R² 为 0.931，Baseline 0.88。AUP 大于 1 不代表“超过 100% 成功”。来源：[论文表 4–6](https://arxiv.org/abs/2502.14499)。

**局限与结论**：既有任务规模较小，也有较重训练任务。应以相同任务配置比较，并保留所有有效尝试与最后提交，否则无法区分实验探索能力和结果选择能力。适合补充 ML 工程链路，不宜单独代表完整科研能力。

## 7. ScienceAgentBench

**文献**：[ScienceAgentBench: Toward Rigorous Assessment of Language Agents for Data-Driven Scientific Discovery，2024/ICLR 2025](https://arxiv.org/abs/2410.05080)。官方：[代码及版本公告][sab-repo]、[数据集与 verified split](https://huggingface.co/datasets/osunlp/ScienceAgentBench)。

| 卡片项目 | 调研结果 |
| --- | --- |
| 定位与评价对象 | 评价 Agent 为真实科学分析需求生成自包含 Python 程序，并获得正确输出的能力。任务一般是论文工作流中的明确分析环节。 |
| 任务构建与规模 | 从 44 篇论文整理 102 个任务，9 位专家参与验证；覆盖生物信息、计算化学、GIS、神经科学。任务包含特征工程、数据处理、建模和可视化等标签。 |
| 能力覆盖 | 文件理解、领域方法、Python 科研编程、执行反馈与纠错、数值/图像产物。对开放式问题提出、长期研究管理和报告写作覆盖有限。 |
| 输入与输出 | 输入自然语言任务、数据目录/预览，部分实验额外提供 domain knowledge。统一提交自包含 Python 程序，执行后生成规定文件；输出路径与列名是任务契约的一部分。 |
| 指标与计算 | VER 衡量有效执行；SR 衡量任务成功，不能只凭无报错确定成功；CodeBERTScore 衡量与参考程序的相似性，属于辅助指标；另报 API 成本。执行成功、科学正确、代码相似应分开报告。 |
| Evaluator 与参考答案 | 依据参考程序和任务专属检查评估文件、数值、模型结果，部分可视化由视觉裁判检查。参考实现是已验证路径，但不能仅以代码不相似判错误。 |
| 环境与预算 | 科学 Python 依赖与 benchmark artifacts；`run_eval.py` 执行程序，任务评分脚本检查产物；需配对下载任务数据与完整输入/参考产物。不是 102 个无依赖单元测试。 |
| 可观测性 | 程序、执行日志、输出、失败和成本；[评分实现][sab-score]与[执行入口][sab-eval]可将程序错误、输出格式问题及科学结果失败区分。 |
| 开放与维护 | 2026-04-30 发布 verified 版以减轻 false negatives，必须使用 verified split 和 `benchmark_verified.zip` 配套产物。代码 MIT；多数任务 CC BY 4.0，少数继承 rasterio/matminer 等上游许可。 |
| 项目适用性 | **高相关，接入难度中**。输出契约清晰，适合首批科研分析与产物回归；verified 更新意味着历史论文分不能自动当成新版本对照。 |

三个真实任务，依据[官方原始任务表](https://huggingface.co/datasets/osunlp/ScienceAgentBench/blob/main/ScienceAgentBench.csv)；字段可能在 verified 中修订，正式运行以 verified 行为准：

1. `instance_id=1`：对 ClinTox 训练多任务模型，预测毒性与 FDA 批准状态，输出 `pred_results/clintox_test_pred.csv`，包含 SMILES 与预测概率。
2. `instance_id=2`：根据材料组成构造扩散数据特征，用 SHAP 选取 20 项，输出 `pred_results/mat_diffusion_features.csv`。
3. `instance_id=5`：使用 DKPES 数据训练随机森林预测化学物质信号抑制，选择适当二值阈值，保存 `pred_results/dkpes_test_pred.csv`。

**官方 Baseline**：论文比较直接生成、Self-Debug 和 OpenHands CodeAct，并控制是否提供专家知识。Claude 3.5 Sonnet 的 Self-Debug 在不提供专家知识时 best-of-3 SR 为 32.4%，提供时 34.3%；o1-preview Self-Debug 为 42.2%，成本显著更高。它们是原始论文协议下的结果，**不是 verified 版的新 Baseline，也不是单次 Pass@1**。出处：[论文实验](https://arxiv.org/abs/2410.05080)、[指标聚合][sab-metrics]。

**局限与结论**：任务来源真实，但大多预设了分析目标与格式。可视化裁判和严格检查曾带来误判，因此推荐 verified 作为正式起点；保留失败产物，遇到边界案例先检查评分器再归因于 Agent。首批价值是把“可执行”与“科学分析正确”分开测量。

## 8. DiscoveryBench

**文献**：[DiscoveryBench: Towards Data-Driven Discovery with Large Language Models，2024](https://arxiv.org/abs/2407.01725)。官方数据与评测：[allenai/discoverybench][db-repo]。

| 卡片项目 | 调研结果 |
| --- | --- |
| 定位与评价对象 | Agent 根据科研数据和探索目标生成自然语言发现/假设；核心是恢复数据支持的变量关系及适用条件。 |
| 任务构建与规模 | 264 个真实任务，25 train、239 test；涉及 6 领域，包括生物、经济、社会、人文、工程、元科学。另有 903 个 DB-Synth 合成任务。真实任务提取自论文；相同原始研究可能形成多个上下文/问题，非完全独立。 |
| 能力覆盖 | 数据清洗、匹配与整合、统计检验、回归/混合模型、领域分析，以及结论中的条件和关系表达。114 个真实任务需要不止一个数据集。 |
| 输入与输出 | 输入问题、数据文件和列描述/metadata；输出自然语言 hypothesis，通常附分析工作流。Gold hypothesis 和评测字段应留在评测侧。 |
| 指标与计算 | HMS：上下文匹配 F1 乘以匹配子假设中“变量 F1×关系准确率”的均值；无上下文匹配时不能凭关键词相似得高分。它是语义匹配分，不是程序执行成功率。 |
| Evaluator 与参考答案 | Gold 来自研究论文结论；GPT-4-0125-preview 分解子假设、匹配上下文、变量和关系。程序实现及 prompt 公开；同一数据支持参考结论之外的合理发现，可能得不到相应 credit。 |
| 环境与预算 | 代码执行与统计库，评分另需模型 API；论文比较 CodeGen、ReAct、DataVoyager 及最多 3 次 oracle-feedback Reflexion。不同 Agent 的交互机制不能按相同原始分直接归因为模型差异。 |
| 可观测性 | 可保存执行过程、分析结果和生成的假设；HMS 子分有助识别条件遗漏、变量错误与关系错误。[评测代码][db-eval]。 |
| 开放与维护 | 数据、任务 metadata、评测 prompt 与脚本公开；仓库 ODC-By，源数据保持独立许可。真实论文结论可被记忆，NoDataGuess 对照用于检查不读数据的表现。 |
| 项目适用性 | **发现与证据相关性高，接入难度中**。适合检查跨数据整合、科学结论表达和条件限定；应补看实际计算证据，不能仅凭 HMS 认定统计方法正确。 |

真实任务实例，均取自[官方 test metadata][db-tasks]：

1. `archaeology/metadata_0.json`：将花粉/景观开放度与考古社会、经济和文化指标关联，做时间序列及数据处理，形成条件明确的结论。
2. `introduction_pathways_non-native_plants/metadata_0.json`：分析外来植物的引入途径、时期与入侵成功，需统计检验并处理多份相关数据。
3. `worldbank_education_gdp/metadata_0.json`：分析世界银行面板数据中的教育支出与经济增长关系，涉及国家组、时间范围和计量建模。

**官方 Baseline**：真实集平均 HMS，CodeGen 的 GPT-4o/GPT-4p/Llama-3-70B 为 15.5/16.3/12.1；ReAct 为 15.4/15.6/13.5；Reflexion Oracle 为 24.5/19.5/22.5。合成集 CodeGen 为 14.1/8.7/10.9，Oracle 为 15.7/12.9/23.2。表中为 HMS×100，**Oracle 运行能看到真实评分反馈，不是普通隐藏测试条件**。出处：[论文图 4、第 5 节](https://arxiv.org/html/2407.01725v1#S5)。

**局限与结论**：假设匹配与数据分析可靠性之间仍有距离；知识记忆、模型裁判偏好和参考结论覆盖会影响成绩。适合作为发现表述与证据专项，建议同时保留代码、统计输出及结论—证据关联供审阅。

## 9. DiscoveryWorld

**文献**：[DiscoveryWorld: A Virtual Environment for Developing and Evaluating Automated Scientific Discovery Agents，2024](https://arxiv.org/abs/2406.06769)。官方：[仿真器、API 与 Agent][dw-repo]。

| 卡片项目 | 调研结果 |
| --- | --- |
| 定位与评价对象 | 在二维虚拟科学环境中观察、操作工具、提出和检验假设、发现隐藏规律。测互动式科学探索，环境不等同于真实实验室。 |
| 任务构建与规模 | 8 个发现主题×3 难度×5 随机种子，共 120 实例；24 个主题—难度配置不是 24 个独立领域。另有操作 unit tests，不应加入主要发现任务计数。 |
| 能力覆盖 | 导航、仪器使用、实验设计、数据采集、相关/回归分析、知识积累与反馈迭代。科学规律由仿真器设计，真实噪声和实验外部有效性有限。 |
| 输入与输出 | Agent 通过 API 获取文本、可选图像、物品和任务信息并执行动作；交付实际环境目标与发现的知识表述。不是单次问答，也不是普通文件分析。 |
| 指标与计算 | Task Completion 为是否完成目标；Procedural Score 为细粒度操作评分；Explanatory Knowledge 为是否解释正确规律。三者分开，一个任务操作完成不意味着 Agent 理解原因。 |
| Evaluator 与参考答案 | 仿真状态和 TaskScorer 对操作与完成客观计分；知识问题由模型裁判判断是否恢复预置规律。参考答案由环境机制确定。 |
| 环境与预算 | Python 仿真器、专用动作空间和图像资源。论文 Easy 最多 100 steps，Normal/Challenge 最多 1,000；比较 ReAct、Plan+Execute、Hypothesizer，主要使用 GPT-4o。 |
| 可观测性 | 完整动作/世界状态、实验记录、过程 checklist 与知识答复；对失败环节定位较好。[API][dw-api]、[任务评分][dw-score]。 |
| 开放与维护 | 仿真器、场景、Agent 示例公开，Apache 2.0；需要为文件/CLI 型 runtime 增加环境 API 调用方式。冻结场景、seed、动作与知识裁判即可复跑。 |
| 项目适用性 | **探索推理相关，当前工作台直接相关性中低，接入难度中高**。适合实验策略研究；它对真实论文、研究对象和产物管理的测试很弱，不宜作为 SciForge 主集。 |

真实场景实例，见[场景构建][dw-scenarios]及论文表 2：

1. Proteomics：测量多个物种的蛋白浓度，以聚类异常识别近期迁入物种；难度增加时数据维度增加。
2. Archaeology：先用已知年代物品校准放射性同位素信号，再推断未知物品年代并寻找最古老者。
3. Reactor Lab：发现晶体属性与共振频率之间的线性/二次关系，用规律调节并激活反应堆。

**官方 Baseline**：论文各主题、难度分别对 5 seeds 统计。Proteomics Easy 中 ReAct 完成率 0.20、Hypothesizer 0.40；Hypothesizer 知识分 1.00，ReAct 为 0.20。Chemistry Normal 中 ReAct 完成率 0，Hypothesizer 0.60；Reactor Lab Normal 三种方法完成率均为 0。它们是子集实例，不能当作整个 120 实例的总成功率。出处：[论文主要实验表](https://arxiv.org/html/2406.06769)。

**局限与结论**：过程评分往往能获得较高分，但关键规律与完成率仍低；部分动作奖励的是环境规定操作。对 SciForge 有价值的是实验—证据—知识链条的诊断思想，直接选型应排在真实文件型任务之后。

## 10. MLE-Bench

**文献**：[MLE-bench: Evaluating Machine Learning Agents on Machine Learning Engineering，2024/ICLR 2025](https://arxiv.org/abs/2410.07095)。官方：[openai/mle-bench][mle-repo]。

| 卡片项目 | 调研结果 |
| --- | --- |
| 定位与评价对象 | 评价 Agent 完成 Kaggle ML 竞赛的工程能力：数据处理、建模训练、验证、调参与生成提交。 |
| 任务构建与规模 | 75 个 Kaggle 竞赛，覆盖领域及难度；官方 Lite 含 22 个较轻量竞赛。将原竞赛数据重新组织为离线训练/测试集，用竞赛评分与历史奖牌阈值校准。 |
| 能力覆盖 | ML 全流程、代码调试、验证设计、资源管理和最终提交。主要目标是预测效果，不直接测科研假设、文献论证或新方法价值。 |
| 输入与输出 | 竞赛描述、训练数据和允许可见的信息；输出 `submission.csv`，行、列与预测类型须符合竞赛规范。私有标签和历史解决方案不得进入工作区。 |
| 指标与计算 | 先按每个竞赛的原始指标评分，再判断是否达到 bronze/silver/gold 阈值；主聚合常为获至少铜牌的竞赛比例。格式合法率、任意牌率和金牌率不是同一指标。 |
| Evaluator 与参考答案 | 竞赛专属执行评分器，隐藏离线标签；查重/污染检查用于识别利用现成方案。重划分后奖牌阈值是估计参照，不能当作真实 Kaggle 在线排名。 |
| 环境与预算 | 主实验每次 24 小时，36 vCPU、440GB RAM、约 4TB SSD、单 A10 GPU；不同竞赛仍有数据容量和环境差异。下载需要 Kaggle 凭据与接受竞赛规则。 |
| 可观测性 | Agent 日志、训练/验证结果和最终提交；CLI 支持准备、评分与验证格式。[竞赛评分与指标][mle-score]。 |
| 开放与维护 | 代码 MIT；数据不是统一 MIT，需要遵守各 Kaggle 竞赛条款。已公开竞赛代码和排行榜存在污染风险；断网与来源审计重要。 |
| 项目适用性 | **ML 工程相关性高，科研发现相关性中，接入难度中高**。适合数据/训练/交付回归，轻量集更适合成本受控运行；不能作为科研能力完整代表。 |

真实竞赛实例，见[官方竞赛定义][mle-tasks]：

1. `aerial-cactus-identification`：从航拍图像识别仙人掌，输出测试图像概率，按 ROC-AUC 评分。
2. `bms-molecular-translation`：将化学结构图转换为分子字符串，考查图像—结构表示与模型训练。
3. `nomad2018-predict-transparent-conductors`：预测透明导体形成能与带隙等材料性质，涉及科学表征与回归。

**官方 Baseline**：AIDE＋o1-preview 在主设置下获至少铜牌的比例 16.9%；AIDE＋GPT-4o 为 8.7%。主要按 3 seeds 汇总；o1-preview 的 pass@8 为 34.1%，不能当作单次成绩。GPT-4o 延长至 100 小时的实验为 11.8%，预算不同。出处：[论文实验与扩展预算分析](https://arxiv.org/abs/2410.07095)。

**局限与结论**：竞赛成绩可以由成熟套路提升，不能单独证明科学创新。已有任务难度和数据规模跨度大。建议在选定竞赛上记录实际训练与验证证据，检查数据泄漏和最后提交，并以 Lite 或固定子集做工程回归。

## 11. LABBench2

**文献**：[LABBench2: An Improved Benchmark for AI Systems Performing Biology Research，2026](https://arxiv.org/abs/2604.09554)。核查 v2；官方：[EdisonScientific/labbench2][lab-repo]、[当前数据入口](https://huggingface.co/datasets/EdisonScientific/labbench2)。论文旧链接使用 FutureHouse namespace，当前 README 已指向 EdisonScientific。

| 卡片项目 | 调研结果 |
| --- | --- |
| 定位与评价对象 | 评估生命科学研究辅助：检索论文、专利、临床试验和数据库；理解图表/补充材料；评估来源；序列处理、克隆及协议推理。 |
| 任务构建与规模 | 论文表 1 共 1,912 条：LitQA3 168、PatentQA 121、TrialQA 120、SourceQuality 150、DbQA2 86、SuppQA2 125、ProtocolQA2 125、SeqQA2 400、CloningQA 14、FigQA2 303、TableQA2 300。后三位计数中的图表题包含同题不同输入模式，不能全部解释为独立科学问题。 |
| 能力覆盖 | 文献/网页检索、来源判断、PDF/图表、多模态输入、数据库、序列计算、克隆计划与程序执行。研究功能覆盖广，但多数是边界较清晰的独立任务。 |
| 输入与输出 | 开放回答，不再只做选择题。图表有 image-provided、paper-provided、retrieval 三模式；序列有 prompt/file/retrieval 模式。答案或结构化参数按题目格式提交，分子生物学题可能需要多步设计。 |
| 指标与计算 | 每题正确/错误并聚合准确率；输入模式、工具和推理配置分开报告。不能将 retrieval 题分与直接给图题分混用，工具条件本身会大幅改变结果。 |
| Evaluator 与参考答案 | 检索/知识型题使用语义裁判；序列与克隆题调用 `VALIDATORS`/`cloning_reward`。当前默认语义裁判为 Claude Sonnet 4.5；不确定和 API 异常在实现中均返回 0，应回查失败理由，避免把裁判故障算作科学失败。[代码][lab-eval]。 |
| 环境与预算 | 官方提供原生模型接口与 Pydantic runner；Python 3.11–3.13、uv，克隆校验还需 Go 1.21+。工具增强条件涉及搜索/执行/文件，不能仅接一个聊天模型声称复现。 |
| 可观测性 | evaluator 输出分数及理由；任务 metadata 标明 tag、输入文件和判定器。应额外保留检索来源与工具输出，才能解释找错论文、读错图、序列计算错误等失败。 |
| 开放与维护 | 代码 CC BY-SA 4.0。当前 HF API 可见数据文件清单，但未经授权下载 README/样本返回 401；本次未获得完整数据访问。不能将公开仓库等同于全部任务数据可直接匿名下载。 |
| 项目适用性 | **高相关，接入难度中，存在数据访问阻塞**。适合评测 SciForge 的文献、文件/图像、科学对象和生物工具能力。建议先解决授权，再固定输入与工具模式。 |

论文和官方代码中的三个真实任务形态（当前受访问限制，未读取完整行级 Prompt，因此不虚构样本 UUID）：

1. `FigQA2`：在相同科学问题上分别直接提供图、提供整篇 PDF 或要求 Agent 自行找到论文，检查图中具体结论；三个模式能区分检索失败与读图失败。
2. `SeqQA2`：20 类序列任务、各 20 变体，包括序列计算及分子操作；允许合法多解的题由程序检查结果，不能只精确匹配参考字符串。
3. `CloningQA`：根据目标构建计划设计 PCR、限制酶/Gibson/Golden Gate 等步骤，通过体外操作的计算模拟检查最终序列与构建是否符合目标。[序列 validators][lab-seq]、[克隆校验][lab-clone]。

**官方 Baseline**：论文比较 Gemini 3 Pro、Claude Opus 4.6、GPT-5.2、GPT-5.2 Pro 的 base 和 tools/high 条件。图 2 中，LitQA3 工具增强的准确率约为 0.75/0.76/0.82/0.85，而 base 约 0.19–0.20；DbQA2 的 Gemini 工具增强约 0.45，GPT-5.2 Pro 约 0.11。**这些是读取图柱高度的近似值，不是公开逐题结果重新计算的精确表格，也不是跨子集总分。**图表任务和克隆任务对工具/输入模式敏感。出处：[论文 v2 图 2–4](https://arxiv.org/html/2604.09554v2)。

**局限与结论**：工具能力、输入交付与底层模型会共同影响分数；语义裁判与生物程序判定有不同错误模式。它对研究辅助最全面，值得纳入，但应按子集及输入模式评价，避免将 1,912 条混成不解释权重的单一产品分。

## 12. NatureBench

**文献**：[NatureBench: Can Coding Agents Match the Published SOTA of Nature-Family Papers?，2026](https://arxiv.org/abs/2606.24530)。核查论文 v1、[官方仓库][nature-repo]、[任务数据](https://huggingface.co/datasets/FrontisAI/NatureBench)。

| 卡片项目 | 调研结果 |
| --- | --- |
| 定位与评价对象 | 测试 coding Agent 在 Nature 系列论文所对应的科学 ML 任务上，能否匹配或超过发表结果；NatureGym 是任务构造与容器环境流程，NatureBench 是评测集。 |
| 任务构建与规模 | Full 90 任务，6 领域为 Protein Biology、Cellular Omics、Molecular Design、Biomedical Modeling、Physical Modeling、Relational Reasoning；来自真实论文，经数据获取、任务提取、环境审查和质量校准。当前另有 NatureBench-25；Full 由 3 CPU、70 gpu_low、17 gpu_high 任务组成。 |
| 能力覆盖 | 专业问题转译、科学数据处理、ML 建模、实验迭代与结果交付。分数反映给定任务及数据设置中的指标提升，不自动证明原创方法或完整论文级复现。 |
| 输入与输出 | Agent 读取 `problem/`，修改 `workspace/`；评测器、GT 和 SOTA 保留在宿主侧。提交约定预测/结果，评测服务反馈指标。当前任务包有 metadata、环境及单独许可证目录。 |
| 指标与计算 | 每实例 `g_i=dir_i×(m_i-m_i_SOTA)/abs(m_i_SOTA)`，任务内平均。Match-SOTA 为有效任务中 g≥0 的数量除以全部任务数；Surpass-SOTA 为 g>0.1。无分/无效任务在 all-task gap 统计中为 -1。另外区分 Score Rate 与 Completion Rate。 |
| Evaluator 与参考答案 | 任务专属程序测原始科学指标；另用轨迹有效性 judge 审查泄漏、评分绕过等。模型裁判主要负责合规有效性，不直接代替数值评测。[当前提交规范][nature-spec]。 |
| 环境与预算 | Docker，Agent solve 4 小时；setup 默认另有 4 小时上限，不计入 solve。低资源 GPU 单 3090/4090 24GB，高资源单 A800 80GB；正式参考设置禁用 web search。 |
| 可观测性 | 提交日志、`result.json`、judge verdict、完整轨迹；当前支持官方管线与 Harbor 格式，公开轨迹入口。可定位方法错误、算力不足、无效提交和作弊。[运行指南][nature-usage]。 |
| 开放与维护 | 仓库 MIT，各 task licenses 与源数据独立；任务和容器材料公开。2026-07 更新有效性 judge，8 月新增轻量轨道与 Harbor 支持，需冻结协议避免版本混用。 |
| 项目适用性 | **高相关，接入难度中高**。与 Codex/Claude Code 运行方式对齐，评价科研 ML 对象、代码、实验和产物较直接；NatureBench-25 适合作为首批科学 ML 轨道。 |

三个真实实例，来自官方任务包 metadata：

1. `s41467-025-63412-3`，Lasso Peptide Property Prediction：预测套索肽性质与酶—底物兼容性，相关目标包括分类准确率。[任务 metadata](https://huggingface.co/datasets/FrontisAI/NatureBench/blob/main/tasks/s41467-025-63412-3/metadata.json)。
2. `s41467-025-63418-x`，Spatial Multi-Omics Domain Identification：整合空间多组学并识别区域/簇，用 ARI 等评价。[任务 metadata](https://huggingface.co/datasets/FrontisAI/NatureBench/blob/main/tasks/s41467-025-63418-x/metadata.json)。
3. `s41467-025-64512-w`，Protein-Protein Interaction Prediction：跨物种/病毒—人蛋白互作预测，涉及 AUPR 等；metadata 中原论文硬件需求不能当作统一 Benchmark 给 Agent 的硬件。[任务 metadata](https://huggingface.co/datasets/FrontisAI/NatureBench/blob/main/tasks/s41467-025-64512-w/metadata.json)。

**官方 Baseline**：论文 10 模型共 900 次任务—Agent 运行；Claude Opus 4.7＋Claude Code 的 Surpass-SOTA 17.8%、Match-SOTA 47.8%。当前仓库首页描述 16 配置、最佳 23.3%/57.8%，属于扩充后的结果集合。后续外部提交不能与初版直接混为同一实验；当前分母、有效性 verdict 及 g 阈值见[评分程序][nature-score]。原论文： [第 4 节](https://arxiv.org/abs/2606.24530)。

**局限与结论**：原论文 SOTA 的算力、模型及数据条件可能与 4 小时单卡不等价；多次请求反馈也可能产生测试适应。g>0.1 是相对提升阈值，不是提升 0.1 个原指标点。优先使用官方轻量轨道并固定提交/反馈策略，正式自主成绩下保持禁搜索协议。

## 13. LifeSciBench

**文献**：[LifeSciBench: Evaluating Language Models on Realistic, Expert-Level Tasks in the Life Sciences，2026，论文 PDF](https://cdn.openai.com/pdf/b4299379-0a97-4ffa-8b9b-c3fbb299caa9/lifescibench_preprint.pdf)。官方发布：[Introducing LifeSciBench，2026-06-17](https://openai.com/index/introducing-life-sci-bench/)。

| 卡片项目 | 调研结果 |
| --- | --- |
| 定位与评价对象 | 评价专业生命科学研究工作中的判断、分析、设计、证据和沟通。官方评测是单轮任务到最终答复，允许工具/浏览；不是持续多轮项目管理测试。 |
| 任务构建与规模 | 750 任务、7 工作流与 7 生物领域；领域为基因组、化学/药化、蛋白/结构、分子/细胞、测定/筛选、生信/计算生物、临床/转化。不是每个领域—工作流组合都有相同数量。173 专家贡献者、453 独立验证专家、1,062 附件与 19,020 Rubric 条目。53% 任务需要附件，79% 涉及多个推理/决策步骤。 |
| 能力覆盖 | Evidence handling、Analysis、Design/optimization、Scientific reasoning、Validation/operations、Translation、Scientific communication；特别测不完整证据、歧义与专业判断。 |
| 输入与输出 | 专业自然语言任务与图/PDF/表格/序列/结构/化学文件等附件；输出自由文本回答，要求合适的方法、解释、限制与决策建议。一次最终答复不意味着执行中只能调用一次工具。 |
| 指标与计算 | 每题 Rubric 得分/满分，再按任务等权平均；Pass Rate 定义为归一化得分≥70%的任务比例。不是所有关键项都通过才算成功；总分与关键科学错误要共同解释。 |
| Evaluator 与参考答案 | 专家写 Rubric，经过多轮一致性、科学事实和可评价性审查。论文描述自动/模型辅助评分及专家抽样复核，但没有提供足以独立重建全套 grader 的公开代码、固定裁判 prompt/model 与完整逐题材料。不能自行填成某个已知 Judge。 |
| 环境与预算 | 所有模型获得任务及相关附件；不限互联网浏览。模型/接口能力影响文件和工具使用；公开材料未给出一套可直接下载、包含完整环境与统一资源预算的 750 题运行包。 |
| 可观测性 | 论文按工作流、领域、附件与 Rubric 类别分析，并公开若干案例；未定位全量执行轨迹及评分明细下载，难以独立开展全面失败复盘。 |
| 开放与维护 | 本次定位到官方论文/发布页与案例，未定位完整 750 任务、附件、Rubric、grader 的公开下载。论文 A.5 说明发布受许可、隐私、专有信息等约束；不能标为已开源可运行。 |
| 项目适用性 | **专业质量相关性高，当前实际接入受阻**。可用于对照产品目标和研究报告质量；没有评测材料时不能宣称已经接入 LifeSciBench。 |

论文附录 C 中的三个真实案例：

1. Analysis，图 15：处理 FFPE 宫颈癌切片的 Visium 数据，聚成 4 组、注释主要细胞类型，并提出 1–2 个潜在 ADC 靶点；要求区分数据支持与临床推荐。
2. Design，图 16：依据 NDC80、linker、HaloTag 和载体序列，设计无额外氨基酸的 BsmBI Golden Gate 组装及引物/overhang。
3. Evidence handling，图 17：从 `plasmid_reads.fastq` 确定质粒表达构建、标记和启动子，并提出适合哺乳动物可溶表达的修改。来源：[完整论文案例与 Rubric](https://cdn.openai.com/pdf/b4299379-0a97-4ffa-8b9b-c3fbb299caa9/lifescibench_preprint.pdf)。

**官方 Baseline**：论文总体归一化分/通过率：GPT-Rosalind 0.576/36.1%，GPT-5.5 0.519/25.7%，Gemini 3.1 Pro 0.515/23.6%，GPT-5.4 0.479/20.7%，Grok 4.3 0.399/13.0%。GPT-Rosalind 在纯文本与附件任务的通过率分别为 44.5% 和 28.6%；附件是明显短板。它们属于官方单轮、允许浏览设置，不能直接作为同预算的 Codex/Claude Code 对照。[论文第 5–6 节](https://cdn.openai.com/pdf/b4299379-0a97-4ffa-8b9b-c3fbb299caa9/lifescibench_preprint.pdf)。

**局限与结论**：领域与专业判断覆盖突出，但完整材料和裁判公开度不足。专家审查任务质量不等同于所有自动评分都准确。当前适合作为需求与质量参考；正式运行必须先获得可用任务、附件及评分协议。

## 14. GeneBench-Pro

**文献**：[GeneBench-Pro: Evaluating Multistage Statistical Reasoning in Genomics, Quantitative Biology, and Translational Biomedicine，2026，bioRxiv v4](https://www.biorxiv.org/content/10.64898/2026.06.29.735386v4.full)。官方：[发布页](https://openai.com/index/introducing-genebench-pro/)、[公开案例包](https://huggingface.co/datasets/openai/genebench-pro-public-package)。

| 卡片项目 | 调研结果 |
| --- | --- |
| 定位与评价对象 | 评测 Agent 在多阶段统计推断中，从带陷阱或不确定来源的数据估计科学目标量，作出会影响后续决策的方法选择。 |
| 任务构建与规模 | 完整集 129 评测、10 主领域、21 子领域；82 题经外部专家审查。公开 10 案例，另 50 题提供 Artificial Analysis，剩余 69 为内部 holdout；三个集合不可互换。 |
| 能力覆盖 | 统计遗传、群体遗传、组学、临床/转化、因果和统计建模；核心是辨识正确 estimand、发现混杂/误差后采取恰当修正，并让修正传递到最终估计。 |
| 输入与输出 | 简短任务、分题数据文件、目标答案 schema；提交 `eval_answer.json`，形如 `answer` 字段对象＋简短 `reasoning`。公开配置同时含 GT 和容差，运行时只能给 Agent task 与 data，不能暴露答案。 |
| 指标与计算 | 每题所有被评分字段都满足要求才 pass，主分不采用部分正确；先计算每题重复运行通过率，再按题平均。论文通过层级 bootstrap 给置信区间；reasoning 用于诊断而不参与主分。 |
| Evaluator 与参考答案 | Python 自动评分数值、类别、字段及容差；已知生成结构/构造目标支持 Ground Truth。公开 `reference_grader.py` 可独立验证字段契约，允许符合容差的等价答案。 |
| 环境与预算 | Linux、Python/科学计算与工具执行；公开 grader 支持 Python 3.10+。论文没有额外施加统一 wall-clock 上限，仍受模型服务/平台影响，模型时间预算不能假定完全一致。 |
| 可观测性 | 多阶段分析及 reasoning 可揭示“注意到问题却没改变计算”的失败；公开案例 PDF 解释参考分析。完整 129 题的轨迹与内部任务不在公开包内。 |
| 开放与维护 | 公开包 MIT，含 checksum、manifest、数据、答案、参考 grader 与案例报告；明确用于案例复现和模型分析，**不是隐藏答案排行榜集**。v4 模型与结果更新，历史版本成绩应分别记录。 |
| 项目适用性 | **统计分析相关性高，公开子集接入难度中**。10 题适合科学计算纠错、专业方法与失败诊断，但不能拿其分数声称 129 题整体能力，也不宜作为不泄漏的长期盲测。 |

三个真实公开案例，见[公开包任务目录](https://huggingface.co/datasets/openai/genebench-pro-public-package/tree/main/problems)：

1. `multiparent_qtl_hmm_lmm`：多亲本 QTL 定位，先做 founder reconstruction，再构造合适的混合模型。
2. `wf_selection`：从等位基因频率轨迹推断 Wright–Fisher 选择参数，处理采样、漂变及估计目标。
3. `statgen_scrna_ambient_state_eqtl`：处理 ambient RNA 和细胞状态对单细胞 eQTL 的影响，恢复相应效应估计。

**官方 Baseline**：v4 完整 129 题：GPT-5.6 Sol max 28.7%，GPT-5.5 12.0%，GPT-5.4 8.9%，Claude Opus 4.8 16.0%；GPT-5.6 Sol Pro 31.5% 为单独报告的 Pro 设置。该论文版本的模型行、不同推理配置和 provider 行为均须记录；不能直接套用到公开 10 题。[v4 实验与 Methods](https://www.biorxiv.org/content/10.64898/2026.06.29.735386v4.full)、[公开评分契约](https://huggingface.co/datasets/openai/genebench-pro-public-package/blob/main/reference_grader.py)。

**局限与结论**：可辨识性来自构造与专家验证，仍不等同于真实数据中的所有推断问题。公开答案带来污染，模型调用栈及无统一时间上限影响比较。建议将公开案例定位为高难方法诊断与 grader 校验，完整正式成绩需通过官方保留集渠道获取。

## 15. ProteinGym

**文献**：[ProteinGym: Large-Scale Benchmarks for Protein Fitness Prediction and Design，NeurIPS 2023](https://proceedings.neurips.cc/paper_files/paper/2023/file/cac723e5ff29f65e3fcbb0739ae91bee-Paper-Datasets_and_Benchmarks.pdf)。官方：[ProteinGym][protein-repo]、[数据与排行榜](https://proteingym.org/)、[版本化数据 DOI](https://doi.org/10.5281/zenodo.15293562)。

| 卡片项目 | 调研结果 |
| --- | --- |
| 定位与评价对象 | 比较蛋白质 mutation effect/fitness 预测方法；包含 zero-shot 和 supervised、替换与 indel、DMS 与临床变异。原 Benchmark 没有通用 Agent 任务 Prompt。 |
| 任务构建与规模 | 当前 README：替换约 270 万 missense variants、217 DMS assays、临床 2,525 蛋白；indel 约 30 万 mutants、74 DMS assays、临床 1,555 蛋白。DMS assay、临床蛋白与变异行数是不同计数单位，不能相加成 Agent 任务数。 |
| 能力覆盖 | 序列/结构/MSA 表征、蛋白语言模型和变异效应预测。若改造成 Agent 工作流，可测方法选择、数据获取、批量推断及结果分析，但这属于新增评测层。 |
| 输入与输出 | 参考序列、突变序列/记号、可选 MSA/结构；模型对每变异输出分数。DMS_score 经统一方向处理，越高适应度越高；Agent 运行时要将测试标签隔离。 |
| 指标与计算 | DMS zero-shot：Spearman、NDCG、AUC、MCC、Top-K recall；supervised：Spearman/MSE；clinical：AUC。先按 UniProt 聚合，避免多 assay 蛋白被过度加权，再按功能类别汇总，附 bootstrap 标准误。 |
| Evaluator 与参考答案 | Ground Truth 来自实验 DMS 测量和临床注释；程序比较预测与标签，无 LLM Judge。监督任务使用不同 mutation split，随机/位置等划分含义不同，必须保持官方协议。 |
| 环境与预算 | Python 评分；预测计算因方法而异：可用现成 prediction CSV，也可运行序列模型、结构方法或 MSA 模型，GPU/内存、模型权重和特征准备成本差异大。没有统一“Agent 24 小时”协议。 |
| 可观测性 | 分 assay、蛋白、功能、taxa、MSA 深度及突变深度的结果详尽；没有原生 Agent 工具轨迹，需另行采集调用和数据加工记录。 |
| 开放与维护 | 代码 MIT；数据、MSA、结构、方法预测及参考表公开并有 DOI。某些内置模型有单独许可证，不能把 MIT 外推到所有 checkpoint 和上游数据。 |
| 项目适用性 | **蛋白质能力专项相关，通用科研 Agent 相关性有限**。适合评测蛋白分析能力模块的科学数值正确性；若包装成 Agent 任务，应明确报告新增任务设计及固定预测方法。 |

三个真实 assay，依据[官方 DMS 参考表][protein-assays]：

1. `A4_HUMAN_Seuma_2022`：APP/amyloid-beta 变异与纤维成核/聚集效应，含组合突变，属于稳定性相关实验评价。
2. `A0A192B1T2_9HIV1_Haddox_2018`：HIV envelope 变异对病毒生长的影响，检验模型对病毒蛋白适应度的预测。
3. `A0A1I9GEU1_NEIME_Kennouche_2019`：脑膜炎奈瑟菌主要 pilin 变异，涉及菌毛/黏附相关效应。

**官方 Baseline**：当前固定快照的 DMS 替换 zero-shot Spearman 汇总中，AIDO Protein-RAG 16B 和 VenusREM 均为 0.518，ProSST K=2048 为 0.507。这是预测方法分，不是 Agent 成功率；也不是声称实时网站最高分。原论文包含 70 多个方法，序列、MSA、结构的输入不相同。[汇总 CSV][protein-results]、[评分实现][protein-score]。

**局限与结论**：DMS 测量存在实验噪声、条件差异与分布偏差，fitness 不等于所有应用中的真实效用。更适合验证一个科学预测能力是否正确运行；科研 Agent 的检索、规划、解释和证据需要另外测试。

## 16. BioMysteryBench

**文献类型**：本次定位到[Anthropic 官方研究报告：Evaluating Claude’s bioinformatics research capabilities with BioMysteryBench](https://www.anthropic.com/research/Evaluating-Claude-For-Bioinformatics-With-BioMysteryBench)，未定位独立论文。官方数据：[full](https://huggingface.co/datasets/Anthropic/BioMysteryBench-full)、[preview](https://huggingface.co/datasets/Anthropic/BioMysteryBench-preview)。

| 卡片项目 | 调研结果 |
| --- | --- |
| 定位与评价对象 | 给 Agent 匿名生物数据，要求通过真实分析恢复具有客观答案的生物属性；评价生物信息工具、方法与多证据推断。 |
| 任务构建与规模 | 官方报告讨论 99 题；当前数据卡 full 为 90，preview 为 5，v11（2026-07）删除/替换过任务。preview 不是额外独立集，不能算 90+5。专家基于可验证数据属性构题，区分 human-solvable/human-difficult。 |
| 能力覆盖 | 序列/结构、组学、注释、模式识别、多数据库证据与方法组合；无固定单一路径，正确终点优先。任务边界明确，不等同于原创研究项目。 |
| 输入与输出 | `question`、分题匿名数据、allowed_domains 等；提交最终生物答案，`answer_rubric` 属于评测侧。禁止追查 GEO/SRA/ENA/BioProject accession 以识别来源研究；允许 BLAST、基因查询和参考基因组等标准数据库操作。 |
| 指标与计算 | 最终答案正确率，按人类可解与困难子集分开；报告中每题尝试 5 次，可观察稳定解出与偶然解出。公开数据卡提供 Rubric，但完整 evaluator 代码/一致性协议未在本次未授权读取范围内核实。 |
| Evaluator 与参考答案 | 目标是控制/确认数据的客观性质，尽量绕开生物分析多解释带来的不确定性。不能凭“只看最终答案”推断必然精确字符串比较，也不能凭 Rubric 字段推断一定用某个 LLM Judge。 |
| 环境与预算 | Agent 进入有基本生物信息工具的容器，可用 pip/conda 安装工具、访问许可的数据库。官方报告没有提供足够完整的统一 CPU/GPU、时间、token 上限以独立重建全部实验。 |
| 可观测性 | 报告基于 transcripts 分析不同方法及多证据策略；本次未获得全量轨迹与执行系统。公开问题 ID 可用于后续挂接任务和评分记录。 |
| 开放与维护 | full 与 preview 使用 gated/evaluation-only 条款，禁止用问题、Rubric 或任务构造训练、微调、强化或蒸馏模型；有 CC BY 4.0 标签也不能忽略访问协议。须先申请数据访问，本次没有绕过 gate。 |
| 项目适用性 | **生物分析相关性高，访问与评分协议尚有阻塞**。适合评价数据到答案和多证据交叉验证；暂不能列为已经可匿名全量运行的集合。 |

三个当前 preview 中的真实 ID，依据[官方 preview 数据卡](https://huggingface.co/datasets/Anthropic/BioMysteryBench-preview)：

1. `hb020`：根据晶体结构判断所属生物，输出二名法学名。
2. `hb002`：从测序数据识别细菌，给出科学名称。
3. `recqgsfxqqodhjens`：从 binding peaks 数据识别转录因子；另有 `hb024` 的组织微生物群分析和 `hb035` 的 microRNA 关联任务。

**官方 Baseline**：报告覆盖多代 Claude。其 reliability 分析给出 Opus 4.6 在 human-solvable/human-difficult 的 headline accuracy 为 77.4%/23.5%；每题 5 次尝试的统计显示，困难题中正确结果的稳定性明显更低。Claude Mythos Preview 在 human-difficult 子集约 30%。这些成绩属于报告的 99 题版本，不能直接对应当前 v11 的 90 题数据。人类专家未解决某题也不是证明模型有普遍超人类科研能力。[官方研究报告](https://www.anthropic.com/research/Evaluating-Claude-For-Bioinformatics-With-BioMysteryBench)。

**局限与结论**：原始数据匿名化、禁止来源追踪是防捷径的重要条件，但数据库更新和题目更换影响复现。应先获得授权、核实 grader 和预算，再做版本内比较。仅限评测的数据使用方式与训练型能力改进要分开。

## 17. CompBioBench

**文献**：[Agentic systems are adept at solving well-scoped, verifiable problems in computational biology，2026，bioRxiv v1](https://www.biorxiv.org/content/10.64898/2026.04.06.716850v1.full)。官方：[runner][compbio-repo]、[100 题数据包](https://huggingface.co/datasets/Genentech/compbiobench-data-v1)、[Zenodo](https://zenodo.org/records/19443186)、[评测入口](https://huggingface.co/spaces/Genentech/compbiobench-leaderboard-v1)。

| 卡片项目 | 调研结果 |
| --- | --- |
| 定位与评价对象 | 评价通用 CLI Agent 是否能完成范围明确、可验证但非平凡的计算生物学工作，包含本地数据和真实外部资源。 |
| 任务构建与规模 | 100 题，7 位贡献者；基因组、转录组、表观组、单细胞、人类遗传、ML 等。真实数据通过 metadata 擦除/打乱，或用合成/增强数据，形成明确答案；难度 1–5 为专家近似判断，未充分跨题校准。 |
| 能力覆盖 | 数据格式判断、比对、质控、注释、统计推断、单细胞、公共资源检索、工具安装及模型部署；突出真实 shell 和生物工具工作流。 |
| 输入与输出 | `compbiobench.v1.tsv` 中题目、question ID、文件、domain、skills 与互联网/GPU 标记。输入可能含 BAM、FASTQ、MTX、H5AD、BED；输出题目要求的单行最终答案，保留全部代码和中间产物。 |
| 指标与计算 | 最终答案准确率、按难度/任务类型拆分，并观察时间与成本。主 Prompt 要求 exact string match；论文允许人工将内容正确但格式违规的少量答案记为正确，因此论文准确率不是严格机器匹配的纯自动结果。 |
| Evaluator 与参考答案 | 合成/增强数据 Ground Truth 按构造确定；检索/实际分析题由贡献者求解验证。公开 TSV 未含答案，runner 主要负责执行和提取结果；完整评分通过官方入口，不应将 runner 等同于自带全部 GT 的本地 grader。 |
| 环境与预算 | Python 3.11、Conda/bioconda、Node CLI；每题 clone 基础环境并复制文件，网络允许。初次 120 分钟，除 Haiku 外超时题以新工作区重跑至 240 分钟；论文运行于 DGX A100。按题工作区是行为约束，runner 没有强文件系统隔离。 |
| 可观测性 | 每题 Markdown 轨迹、机器可读 JSON、shell/web/file 事件、token/成本、断点续跑；官方 runner 与 Codex/Claude Code 直接对齐。[执行实现][compbio-run]。 |
| 开放与维护 | runner MIT，公开数据 CC BY 4.0；GT 不在 TSV 中，外部数据库/软件许可单独适用。源资源和版本在题目中指定，部分题需要较大下载或 GPU。 |
| 项目适用性 | **高相关，接入难度中**。与当前 runtime 和科研文件/工具匹配度很高，适合作为生物分析首批候选；先确认可用官方评分方式，若本地补 grader 要明确其与官方人工纠正的差异。 |

三个真实题目，来自[公开 TSV](https://huggingface.co/datasets/Genentech/compbiobench-data-v1/blob/main/compbiobench.v1.tsv)：

1. `ensembl-grab-q1`：将 RefSeq、符号、转录本、基因组区间和其他标识统一为不含版本号的 Ensembl gene ID，输出规定分隔格式。
2. `bam-infer-read-length-q1`：读取 `mt.sorted.bam`，判断 paired/single-ended 以及读长，输出约定形式。
3. `differential-composition-q1`：比较两位个体视网膜 scRNA counts，识别严重减少的细胞类型，必须考虑基因列表、矩阵方向、注释及组成分析。

**官方 Baseline**：Claude Code v2.1.87＋Opus 4.6 与 Codex CLI v0.115.0＋GPT-5.4 各 3 次，整体 81% 和 83%；最难组分别 69% 和 59%。Sonnet 4.6 整体 70%，Haiku 4.5 为 34%。Opus 使用 max、GPT-5.4 使用 xhigh，且存在 120→240 分钟重跑。非 Agent/no-file 对照 Opus 4.6 约 3.7%、GPT-5.2 约 5.3%；它同时改变文件和工具可用性，不能用来单独量化 Agent 架构贡献。出处：[论文 Results 与 Methods](https://www.biorxiv.org/content/10.64898/2026.04.06.716850v1.full)。

**局限与结论**：论文困难题中的代表性错误是多重比对处理不足、motif 背景未匹配 GC、过早结束等，适合专业诊断；高总分也存在不稳定题。运行预算与硬件不能简化成“每题 2 小时单卡”。官方图对时间/成本截断是展示规则，不是 API 开销的硬上限。

## 18. 对当前项目的选型结论

| 用途 | 推荐 Benchmark | 原因 | 已确认的主要限制 |
| --- | --- | --- | --- |
| 可执行科研分析主集 | ScienceAgentBench verified | 明确程序/产物契约，任务及评分可定位 | 必须成对获取 verified 数据和 artifacts；旧成绩不同版本 |
| 生物信息工具与 runtime 主集 | CompBioBench | 真实科学格式、外部工具、Codex/Claude Code 官方对照 | 完整 GT/官方评测入口、网络和时间重跑条件 |
| 跨学科科学 ML | NatureBench-25，再扩大至 Full | 容器、隐藏评测服务、客观原指标、轨迹规范 | 禁搜索协议、GPU 成本、SOTA 条件差异 |
| 完整研究产物 | ResearchClawBench | 数据、实验、图像、报告与细粒度科学要求 | 裁判波动、任务依赖、统一预算信息不足 |
| 文献/图表/数据库/序列能力 | LABBench2 | 能区分检索、文件交付和工具模式 | 数据 gate、模式必须固定、裁判故障可能被记 0 |
| 长程论文复现 | PaperBench | 干净环境复跑和分层证据 | 主实验 12 小时 Agent＋独立复跑与裁判成本、数据权限 |
| 研究方法迭代与实验管理 | ResearchGym、AIRS-Bench、MLGym | 提案、训练、反馈、强 Baseline 比较 | 高成本，实验选择/反馈协议影响结果 |
| 科学发现表述 | DiscoveryBench | 将上下文、变量、关系分开诊断 | 模型裁判与参考假设覆盖，须验证计算证据 |
| 专业判断与高难统计 | LifeSciBench、GeneBench-Pro | 判断、统计方法选择与歧义 | 前者完整包未公开，后者公开 10 题含答案 |
| 蛋白质能力 | ProteinGym | 实验 Ground Truth、分层预测指标 | 原生评价对象为预测模型，需要独立 Agent 层 |
| 生物匿名分析 | BioMysteryBench | 客观属性、匿名数据、多证据分析 | evaluation-only gate、99/90 题版本差异 |
| 互动实验策略 | DiscoveryWorld | 可控机制和实验过程记录 | 专用仿真 API，与真实科研工作台直接相关性较低 |

从当前资料可确认，ScienceAgentBench、NatureBench、CompBioBench 和 ResearchClawBench 对项目的直接评价价值最强，但它们覆盖的环节互补。首次结果应按各自官方定义分别报告，不能生成未经校准的混合总分。选定任务子集后的分数，也要明确标记子集名称和数量，不能沿用完整官方 Benchmark 的整体成绩标签。

**尚未消除的实际运行阻塞**：LifeSciBench 缺完整公开评测包；LABBench2/BioMysteryBench 数据访问需要授权；CompBioBench 需要确认官方评分入口的可用流程；PaperBench/MLGym/AIRS-Bench/ResearchGym 的完整运行需要额外数据与算力。其余“材料可获取”的判断也只依据公开入口和源码，不代表本地环境已复现。

## 19. 核查版本与证据索引

本次阅读包括论文全文、仓库 README、任务配置和核心评分文件；没有执行科学实验，也没有逐题审计数千个 Rubric。论文引用记录的是相应实验版本：PaperBench v3，AIRS-Bench v2，MLGym v1，DiscoveryBench v1，LABBench2 v2，NatureBench v1，GeneBench-Pro v4，CompBioBench v1；ResearchClawBench 同时核对早期全文与 v5 摘要。未写明固定版本的论文链接可查看官方版本历史，后续更新不自动覆盖本报告的实验结果。

以下为实际核查的仓库 commit；点击链接可查看固定快照。日期为仓库最后一次提交日期，不等同于论文发表日期。

| Benchmark | 核查 commit | 提交日期 |
| --- | --- | --- |
| ResearchClawBench | [01bc2371f698](https://github.com/InternScience/ResearchClawBench/tree/01bc2371f698f755892935ef2965a95a790ff0db) | 2026-09-17 |
| ResearchGym | [0adc08e93754](https://github.com/Anikethh/ResearchGym/tree/0adc08e93754b606d8a76055ed2f1c9574504312) | 2026-05-31 |
| PaperBench | [51052cede8cc](https://github.com/openai/frontier-evals/tree/51052cede8cc608f95bb00346635e03759013e5a) | 2026-04-21 |
| AIRS-Bench | [18e4f1d50106](https://github.com/facebookresearch/airs-bench/tree/18e4f1d501069cf7d7e2740d81c2ca748c56a6a1) | 2026-05-05 |
| MLGym | [9d40c1b50352](https://github.com/facebookresearch/MLGym/tree/9d40c1b5035202018cd7091fb4e83a9c68b377c0) | 2025-08-10 |
| ScienceAgentBench | [c26e151ed601](https://github.com/OSU-NLP-Group/ScienceAgentBench/tree/c26e151ed601ba109dc4d35e057ff8e73fec469d) | 2026-07-17 |
| DiscoveryBench | [c31fcf011e07](https://github.com/allenai/discoverybench/tree/c31fcf011e070f021a5f5b906896d0821f6880e8) | 2025-06-08 |
| DiscoveryWorld | [fd591323920b](https://github.com/allenai/discoveryworld/tree/fd591323920be0d3786ef350955de1945aa571e5) | 2025-03-10 |
| MLE-Bench | [507f92e1138b](https://github.com/openai/mle-bench/tree/507f92e1138bb6e40dac5c6ee7a6758e6424bf97) | 2026-04-24 |
| LABBench2 | [4ef83d373b1e](https://github.com/EdisonScientific/labbench2/tree/4ef83d373b1ea020fd34bb5c696039514578da27) | 2026-10-07 |
| NatureBench | [0f80a67d47a5](https://github.com/FrontisAI/NatureBench/tree/0f80a67d47a56fcd08ab3f1f586159d264616e2f) | 2026-09-30 |
| ProteinGym | [144fe22b07df](https://github.com/OATML-Markslab/ProteinGym/tree/144fe22b07dfaeec2b366f2346203a9838a55b4c) | 2026-03-24 |
| CompBioBench | [dc350ed37ccd](https://github.com/Genentech/compbiobench-runner/tree/dc350ed37ccd7d7ce96347d139f06dc4bf283f26) | 2026-04-06 |

代码与任务证据链接（固定到上述快照）：

[rc-repo]: https://github.com/InternScience/ResearchClawBench/tree/01bc2371f698f755892935ef2965a95a790ff0db
[rc-tasks]: https://github.com/InternScience/ResearchClawBench/tree/01bc2371f698f755892935ef2965a95a790ff0db/tasks
[rc-run]: https://github.com/InternScience/ResearchClawBench/blob/01bc2371f698f755892935ef2965a95a790ff0db/evaluation/run_task.py
[rc-score]: https://github.com/InternScience/ResearchClawBench/blob/01bc2371f698f755892935ef2965a95a790ff0db/evaluation/score.py
[rg-repo]: https://github.com/Anikethh/ResearchGym/tree/0adc08e93754b606d8a76055ed2f1c9574504312
[rg-run]: https://github.com/Anikethh/ResearchGym/blob/0adc08e93754b606d8a76055ed2f1c9574504312/run_agent.py
[rg-tasks]: https://github.com/Anikethh/ResearchGym/tree/0adc08e93754b606d8a76055ed2f1c9574504312/tasks/test
[rg-grade]: https://github.com/Anikethh/ResearchGym/blob/0adc08e93754b606d8a76055ed2f1c9574504312/tasks/test/continual-learning/grading/grade.sh
[pb-repo]: https://github.com/openai/frontier-evals/tree/51052cede8cc608f95bb00346635e03759013e5a/project/paperbench
[pb-judge]: https://github.com/openai/frontier-evals/blob/51052cede8cc608f95bb00346635e03759013e5a/project/paperbench/paperbench/judge/simple.py
[pb-papers]: https://github.com/openai/frontier-evals/tree/51052cede8cc608f95bb00346635e03759013e5a/project/paperbench/data/papers
[airs-repo]: https://github.com/facebookresearch/airs-bench/tree/18e4f1d501069cf7d7e2740d81c2ca748c56a6a1
[airs-tasks]: https://github.com/facebookresearch/airs-bench/tree/18e4f1d501069cf7d7e2740d81c2ca748c56a6a1/airsbench/tasks/rad
[mlgym-repo]: https://github.com/facebookresearch/MLGym/tree/9d40c1b5035202018cd7091fb4e83a9c68b377c0
[mlgym-env]: https://github.com/facebookresearch/MLGym/blob/9d40c1b5035202018cd7091fb4e83a9c68b377c0/mlgym/environment/env.py
[mlgym-tasks]: https://github.com/facebookresearch/MLGym/tree/9d40c1b5035202018cd7091fb4e83a9c68b377c0/configs/tasks
[sab-repo]: https://github.com/OSU-NLP-Group/ScienceAgentBench/tree/c26e151ed601ba109dc4d35e057ff8e73fec469d
[sab-score]: https://github.com/OSU-NLP-Group/ScienceAgentBench/blob/c26e151ed601ba109dc4d35e057ff8e73fec469d/compute_scores.py
[sab-eval]: https://github.com/OSU-NLP-Group/ScienceAgentBench/blob/c26e151ed601ba109dc4d35e057ff8e73fec469d/run_eval.py
[sab-metrics]: https://github.com/OSU-NLP-Group/ScienceAgentBench/blob/c26e151ed601ba109dc4d35e057ff8e73fec469d/calculate_metrics.py
[db-repo]: https://github.com/allenai/discoverybench/tree/c31fcf011e070f021a5f5b906896d0821f6880e8
[db-eval]: https://github.com/allenai/discoverybench/blob/c31fcf011e070f021a5f5b906896d0821f6880e8/eval/new_eval.py
[db-tasks]: https://github.com/allenai/discoverybench/tree/c31fcf011e070f021a5f5b906896d0821f6880e8/discoverybench/real/test
[dw-repo]: https://github.com/allenai/discoveryworld/tree/fd591323920be0d3786ef350955de1945aa571e5
[dw-api]: https://github.com/allenai/discoveryworld/blob/fd591323920be0d3786ef350955de1945aa571e5/discoveryworld/DiscoveryWorldAPI.py
[dw-score]: https://github.com/allenai/discoveryworld/blob/fd591323920be0d3786ef350955de1945aa571e5/discoveryworld/TaskScorer.py
[dw-scenarios]: https://github.com/allenai/discoveryworld/blob/fd591323920be0d3786ef350955de1945aa571e5/discoveryworld/ScenarioMaker.py
[mle-repo]: https://github.com/openai/mle-bench/tree/507f92e1138bb6e40dac5c6ee7a6758e6424bf97
[mle-score]: https://github.com/openai/mle-bench/blob/507f92e1138bb6e40dac5c6ee7a6758e6424bf97/mlebench/metrics.py
[mle-tasks]: https://github.com/openai/mle-bench/tree/507f92e1138bb6e40dac5c6ee7a6758e6424bf97/mlebench/competitions
[lab-repo]: https://github.com/EdisonScientific/labbench2/tree/4ef83d373b1ea020fd34bb5c696039514578da27
[lab-eval]: https://github.com/EdisonScientific/labbench2/blob/4ef83d373b1ea020fd34bb5c696039514578da27/evals/evaluators.py
[lab-seq]: https://github.com/EdisonScientific/labbench2/blob/4ef83d373b1ea020fd34bb5c696039514578da27/src/labbench2/seqqa2/registry.py
[lab-clone]: https://github.com/EdisonScientific/labbench2/blob/4ef83d373b1ea020fd34bb5c696039514578da27/src/labbench2/cloning/rewards.py
[nature-repo]: https://github.com/FrontisAI/NatureBench/tree/0f80a67d47a56fcd08ab3f1f586159d264616e2f
[nature-spec]: https://github.com/FrontisAI/NatureBench/blob/0f80a67d47a56fcd08ab3f1f586159d264616e2f/submit-results/SUBMISSION_SPEC.md
[nature-usage]: https://github.com/FrontisAI/NatureBench/blob/0f80a67d47a56fcd08ab3f1f586159d264616e2f/docs/usage.md
[nature-score]: https://github.com/FrontisAI/NatureBench/blob/0f80a67d47a56fcd08ab3f1f586159d264616e2f/submit-results/compute_scores.py
[protein-repo]: https://github.com/OATML-Markslab/ProteinGym/tree/144fe22b07dfaeec2b366f2346203a9838a55b4c
[protein-assays]: https://github.com/OATML-Markslab/ProteinGym/blob/144fe22b07dfaeec2b366f2346203a9838a55b4c/reference_files/DMS_substitutions.csv
[protein-results]: https://github.com/OATML-Markslab/ProteinGym/blob/144fe22b07dfaeec2b366f2346203a9838a55b4c/benchmarks/DMS_zero_shot/substitutions/Spearman/Summary_performance_DMS_substitutions_Spearman.csv
[protein-score]: https://github.com/OATML-Markslab/ProteinGym/blob/144fe22b07dfaeec2b366f2346203a9838a55b4c/proteingym/performance_DMS_benchmarks.py
[compbio-repo]: https://github.com/Genentech/compbiobench-runner/tree/dc350ed37ccd7d7ce96347d139f06dc4bf283f26
[compbio-run]: https://github.com/Genentech/compbiobench-runner/blob/dc350ed37ccd7d7ce96347d139f06dc4bf283f26/run_benchmark.py
