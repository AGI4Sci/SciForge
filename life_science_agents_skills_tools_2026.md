# 国内外生命科学领域知名 Agent、Skills 与 Tools 梳理

> 更新时间：2026-07-13
> 范围：生命科学、生物医学、药物发现、组学分析、蛋白设计与实验室自动化。
> 注：分类依据项目的**主要产品形态**，部分项目同时横跨 Agent、Skills 和 Tool Infrastructure 多层。

## 分类口径

| 类别 | 定义 |
|---|---|
| **Agent** | 能理解科研目标，自主规划并调用多个工具，执行多步任务并检查结果的系统 |
| **Skills / Workflows** | 可被 Agent 复用的领域知识、标准操作、分析流程或工具调用说明 |
| **Tool Infrastructure** | 负责工具注册、发现、调用、权限、异步执行、环境管理或设备连接的基础设施 |
| **Domain Tools / Models** | 完成结构预测、分子建模、组学分析、文献检索等具体任务的软件、数据库或模型 |

---

## 一、生命科学科研 Agent

| 地区 | 项目 | 团队/机构 | 主要场景 | 核心特点 | 开放情况 | 链接 |
|---|---|---|---|---|---|---|
| 国内 | **MolClaw** | 北京大学、上海人工智能实验室等 | 药物分子评估、筛选与优化 | 通过工具级、工作流级、方法论级和研究级的分层 Skills 编排 30+ 专业资源，面向长链路分子研发任务 | 开源/论文 | [GitHub](https://github.com/InternScience/MolClaw) · [论文](https://arxiv.org/abs/2604.21937) |
| 国内 | **OpenBioMed Agent / ChatDD** | 清华大学 AIR、PharMolix | 药物发现、分子、蛋白质、单细胞与生物医学问答 | 集成领域模型、数据结构、工具和科研 Skills，适合作为生物医学 Agent 开发底座 | 开源核心+商业产品 | [GitHub](https://github.com/PharMolix/OpenBioMed) |
| 国内 | **BioMedAgent** | 中国科学院计算技术研究所、澳门科技大学等 | 跨组学、机器学习与病理图像分析 | 自进化多 Agent 数据科学框架，通过交互探索学习工具使用，再把经验写入记忆；在 BioMed-AQA 327 个任务上报告 77% 成功率 | 开源+论文+公开基准 | [GitHub](https://github.com/BOBQWERA/BioMedAgent) · [论文](https://www.nature.com/articles/s41551-026-01634-6) · [中科院介绍](https://english.cas.cn/newsroom/research-news/202606/t20260624_1174789.shtml) |
| 国内 | **CellAgent** | 西北工业大学、天津大学 | 单细胞与空间转录组分析 | Planner、Executor、Evaluator 多 Agent 协作，可自动选择分析方法、参数并迭代检查结果 | 研究原型/在线平台 | [论文](https://arxiv.org/abs/2407.09811) · [平台](http://cell.agent4science.cn/) |
| 国内 | **BioMaster** | 香港科技大学（广州） | 通用生物信息学工作流 | 以多 Agent 分工完成需求理解、流程规划、代码生成、执行与结果解释，面向端到端生信分析 | 开源/预印本 | [GitHub](https://github.com/ai4nucleome/BioMaster) · [论文](https://www.biorxiv.org/content/10.1101/2025.01.23.634608v1) |
| 国内 | **BioInformatics Agent（BIA）** | 华大研究院、阿里云智能等 | 单细胞与通用生信分析 | 在自然语言驱动下完成环境配置、软件安装、代码生成、执行和结果交互，是较早的端到端生信 Agent 原型 | Apache-2.0/研究原型 | [GitHub](https://github.com/biagent-dev/bia) · [论文](https://www.biorxiv.org/content/10.1101/2024.05.22.595240v2) |
| 国内 | **BioManus** | BioinfoMCP 团队 | 生物信息学分析 | MCP-native 生物医学 Agent，以工具、操作、数据类型和工作流阶段构成能力图，再检索任务相关子图进行规划与执行 | 研究项目/预印本 | [论文](https://arxiv.org/abs/2606.04494) |
| 国内 | **InnoClaw** | SpectrAI Initiative | 通用科研工作区 | 自托管科研 Agent 工作区，支持论文研读、知识检索、科学 Skills 和研究执行 | 开源 | [GitHub](https://github.com/SpectrAI-Initiative/InnoClaw) |
| 国内 | **ClinicalAgent** | 南京大学等 | 临床试验结果预测与循证推理 | 以多 Agent、Least-to-Most 和 ReAct 分解临床试验问题，并调用外部知识完成可解释预测 | 论文/研究原型 | [论文](https://arxiv.org/abs/2404.14777) · [南京大学项目页](https://cs.nju.edu.cn/lm/research/science/index.html) |
| 国内 | **DrugAgent（药物再利用版）** | 南京大学等 | 药物—靶点相互作用与药物重定位 | Coordinator 协调预测模型、知识图谱、文献搜索与推理 Agent，融合多源证据输出候选和解释 | 论文/研究原型 | [论文](https://arxiv.org/abs/2408.13378) · [OpenReview](https://openreview.net/forum?id=PQrkWvQSL0) |
| 国内 | **Agent Hospital / MedAgent-Zero** | 清华大学 AIR、清华大学计算机系 | 虚拟医院与医学 Agent 自进化 | 将患者、护士、医生和医院流程建模为 Agent 环境，并从成功/失败病例中自进化；属于训练与评测研究，不是临床产品 | 论文/研究原型 | [清华 AIR](https://air.tsinghua.edu.cn/info/1007/2246.htm) · [论文](https://arxiv.org/abs/2405.02957) |
| 国内 | **DeepRare** | 上海交通大学、新华医院等 | 罕见病循证推理 | 中央 Agent 协同多个专业工具 Agent，通过假设—验证—反思循环生成可回溯证据链 | 闭源/临床验证中 | [上海交通大学介绍](https://news.sjtu.edu.cn/jdyw/20260305/220083.html) |
| 国内 | **SciMaster / PharmMaster** | 深势科技 | 科研检索、药物化学与计算—实验闭环 | 将文献与专利检索、Uni-Mol/Uni-Fold 等计算模型及 Uni-Lab-OS 实验执行连接成“读—算—做”研发链 | 商业平台+部分组件开源 | [产品矩阵](https://www.bohrium.com/intro/about) · [Uni-Lab-OS](https://github.com/deepmodeling/Uni-Lab-OS) |
| 国外 | **Biomni** | Stanford SNAP 等 | 通用生物医学研究 | 结合检索增强规划和代码执行，覆盖文献、组学、遗传学、药物与实验设计；内置大量工具、数据库和软件 | 开源+在线平台 | [GitHub](https://github.com/snap-stanford/biomni) · [官网](https://biomni.stanford.edu/) |
| 国外 | **Robin** | FutureHouse | 生物学端到端研究、药物重定位 | 编排文献、数据分析与实验策略 Agent，在连续流程中完成假设生成、数据分析、候选优选和后续洞察 | Apache-2.0 代码+平台+论文 | [GitHub](https://github.com/Future-House/robin) · [Nature](https://www.nature.com/articles/s41586-026-10652-y) |
| 国外 | **Kosmos** | FutureHouse / Edison Scientific | 长时自主科学发现 | 在结构化世界模型中循环执行文献搜索、假设生成和数据分析，适合开放式数据驱动研究 | 商业平台+技术报告 | [介绍](https://edisonscientific.com/news/announcing-kosmos) · [论文](https://arxiv.org/abs/2511.02824) |
| 国外 | **TxAgent** | Harvard Medical School Zitnik Lab | 治疗方案与药物推理 | 基于 ToolUniverse 调用大规模生物医学工具，处理药物相互作用、禁忌和精准治疗问题 | 开源 | [GitHub](https://github.com/mims-harvard/TxAgent) |
| 国外 | **Medea** | Harvard Medical School Zitnik Lab | 多组学驱动的治疗发现 | 多个专门模块协作整合多组学数据、科学知识和计算资源，并与 ToolUniverse 兼容 | 开源 | [GitHub](https://github.com/mims-harvard/MEDEA) |
| 国外 | **AutoScientists** | Harvard Medical School Zitnik Lab | 长时计算科研实验 | 自组织、多 Agent 科研团队，面向长时间运行的计算实验和迭代研究 | 开源 | [GitHub](https://github.com/mims-harvard/AutoScientists) |
| 国外 | **Google AI Co-Scientist** | Google Research / Google DeepMind | 文献综合、假设生成和实验建议 | 通过生成、反思、辩论、排名与演化等多 Agent 机制形成和优化科研假设 | 闭源研究系统/受限试用 | [Nature](https://www.nature.com/articles/s41586-026-10644-y) · [官方介绍](https://deepmind.google/blog/co-scientist-a-multi-agent-ai-partner-to-accelerate-research/) |
| 国外 | **CRISPR-GPT** | Stanford 等 | CRISPR 实验设计 | 辅助选择编辑系统、设计 gRNA、递送方案、实验步骤和验证策略 | 开源/论文 | [GitHub](https://github.com/IDEA-Research/CRISPR-GPT) |
| 国外 | **GeneAgent** | NIH/NLM 等 | 基因集合解释与验证 | 对基因列表进行功能解释，并利用专业数据库对结论进行自校验 | 研究项目 | [论文](https://www.nature.com/articles/s41592-025-02748-6) |
| 国外 | **ChemCrow** | EPFL 等 | 化学推理与合成规划 | 早期代表性化学 Agent，通过 LLM 调用搜索、计算、反应预测和合成工具 | 开源/论文 | [GitHub](https://github.com/ur-whitelab/chemcrow-public) |
| 国外 | **Virtual Lab** | Stanford Zou Group | 蛋白质与抗体设计 | PI Agent 组织计算生物学、机器学习、免疫学专家 Agent 和 Critic，构建并讨论 ESM、AlphaFold-Multimer、Rosetta 等设计流程；已有湿实验验证 | 代码、讨论记录与论文公开 | [Nature](https://www.nature.com/articles/s41586-025-09442-9) · [GitHub](https://github.com/zou-group/virtual-lab) |
| 国外 | **BioDiscoveryAgent** | Stanford SNAP 等 | CRISPR 遗传扰动实验设计 | 结合文献、基因检索、Reactome 和 AI critique 逐轮选择扰动实验，并依据实验结果更新下一轮设计 | MIT 开源/预印本 | [GitHub](https://github.com/snap-stanford/BioDiscoveryAgent) · [论文](https://arxiv.org/abs/2405.17631) |
| 国外 | **AutoBA** | KAUST | 多组学与通用生信分析 | 从数据路径、数据描述和研究目标出发，自动规划、写代码、执行和修复 WGS/WES、RNA-seq、scRNA-seq、ChIP/ATAC 等流程 | 开源/正式论文 | [GitHub](https://github.com/JoshuaChou2018/AutoBA) · [Advanced Science](https://repository.kaust.edu.sa/items/ee86c3d5-27c1-4964-86b5-0c84e73ebd65) |
| 国外 | **CellVoyager** | Stanford 等 | 单细胞数据自主探索 | 在 Jupyter 环境中自主提出并实现 scRNA-seq 分析；以 76 篇已发表研究构成 CellBench，并报告多个专家认可的新分析线索 | 论文/研究系统 | [Nature Methods](https://www.nature.com/articles/s41592-026-03029-6) |
| 国外 | **SPARK** | University Hospital Cologne / University of Cologne 等 | 数字病理与癌症标志物发现 | 由想法生成、细化、编码和验证 Agent 串联，在病理图像与空间单细胞大队列中提出、实现并检验研究假设 | 开源/论文 | [GitHub](https://github.com/cpath-ukk/SPARK) · [Nature Medicine](https://www.nature.com/articles/s41591-026-04357-y) |
| 国外 | **SpatialAgent** | Genentech 等 | 空间组学研究 | 结合多模态输入、专业数据库、代码执行与人机协作，面向空间转录组的完整研究流程 | 开源/预印本 | [GitHub](https://github.com/Genentech/SpatialAgent) |
| 国外 | **LIDDiA** | Ohio State University 等 | 自主计算药物发现 | 围绕目标检索、分子生成、筛选与迭代优化进行自主导航，强调探索与利用之间的平衡 | 研究代码/预印本 | [论文](https://arxiv.org/abs/2502.13959) |
| 国外 | **ProtAgents** | MIT 等 | 蛋白质设计与分析 | 多 Agent 协作调用知识检索、结构分析、机器学习与物理模拟，执行多目标从头蛋白设计 | 开源/论文 | [论文](https://pubs.rsc.org/en/content/articlelanding/2024/dd/d4dd00013g) |
| 国外 | **FutureHouse Crow / Falcon / Owl / Phoenix** | FutureHouse | 文献检索、证据综述、新颖性检索与化学规划 | 四个面向科学的专用 Agent；分别服务快速检索、深度综述、“是否有人做过”判断和化学实验规划 | 平台/API；部分底层组件开源 | [平台介绍](https://www.futurehouse.org/news/launching-futurehouse-platform-ai-agents) |
| 国外 | **BioAgents** | Microsoft Research 等 | 生信方案设计与故障排查 | 多个小型领域模型分别负责概念生物学、工作流文档检索和综合推理，强调本地化和私有数据适配 | 论文/研究原型 | [Scientific Reports](https://www.nature.com/articles/s41598-025-25919-z) |
| 国外 | **CellMaster** | UCSD、CMU 等 | 单细胞类型注释 | 利用 LLM 知识和多轮协作完成零样本细胞类型注释，支持人工反馈 | 研究项目 | [论文](https://arxiv.org/abs/2602.13346) |

---

## 二、实验室 Agent 与具身科研系统

| 地区 | 项目 | 团队/机构 | 主要定位 | 核心特点 | 开放情况 | 链接 |
|---|---|---|---|---|---|---|
| 国外 | **LabOS** | Stanford、Princeton 等 | AI-XR 实验室操作系统 | 连接多模态 Agent、智能眼镜、视觉感知、机器人和科研工具，使 Agent 能感知并辅助真实实验操作 | 开源/研究平台 | [GitHub](https://github.com/zaixizhang/LabOS) |
| 国内 | **Uni-Lab-OS** | DeepModeling 社区 | 实验室自动化平台 | 连接和控制不同实验设备，支持实验流程的自动化、标准化和设备编排 | 开源 | [GitHub](https://github.com/deepmodeling/Uni-Lab-OS) |
| 国内 | **BioMARS** | 中国科学技术大学 | 自主生物实验多机器人系统 | 以 Biologist、Technician、Inspector 等专用 Agent 协调协议生成、机器人执行和视觉异常检测，面向动态、长时、易失败的生物实验 | 研究原型/预印本+简化代码 | [GitHub](https://github.com/AlexandreQ27/BioMARS) · [论文](https://arxiv.org/abs/2507.01485) |
| 国外 | **Coscientist** | Carnegie Mellon University | 化学实验规划与自动执行 | 检索文献和设备文档、规划合成、生成并执行设备指令，控制液体工作站完成反应优化 | 简化代码公开；真实硬件需实验室 | [Nature](https://www.nature.com/articles/s41586-023-06792-0) · [GitHub](https://github.com/gomesgroup/coscientist) |
| 国外 | **SAMPLE** | University of Wisconsin–Madison | 闭环蛋白工程 | 决策 Agent 学习序列—功能景观，驱动自动基因组装、表达和生化测量，再用结果迭代设计；属于经典闭环优化 Agent，不是 LLM Agent | 论文/源数据/伪代码公开 | [Nature Chemical Engineering](https://www.nature.com/articles/s44286-023-00002-4) |
| 国外 | **ORGANA** | University of Toronto / Vector Institute 等 | 自然语言实验机器人 | 通过自然语言消歧、任务与运动规划、视觉反馈和排程控制机器人，演示多类化学实验 | 代码公开；需要实体硬件 | [项目页](https://ac-rad.github.io/organa/) · [GitHub](https://github.com/ac-rad/organa) |
| 国外 | **A-Lab** | Lawrence Berkeley National Laboratory / UC Berkeley | 自驱动材料实验室 | 将机器学习、机器人、实验设备与闭环优化连接起来；虽以材料为主，但对生命科学自动实验室具有参考价值 | 研究设施 | [项目介绍](https://newscenter.lbl.gov/2023/04/17/a-lab/) |
| 国外 | **Autonomous Lab（ANL）** | 日本科研团队 | 生物技术自主实验 | 机器人与 AI 闭环执行培养、测量、结果分析和假设更新，展示生物生产研究的自动实验系统 | 论文/研究设施 | [Scientific Reports](https://www.nature.com/articles/s41598-025-89069-y) |
| 国外 | **RoboCulture** | Carnegie Mellon University 等 | 长周期细胞培养自动化 | 机器人完成液体处理和仪器交互，并用计算机视觉监控生长状态、触发实时决策 | 开源研究平台/预印本 | [论文](https://arxiv.org/abs/2505.14941) |
| 国外 | **Emerald Cloud Lab** | Emerald Cloud Lab | 云端远程实验室 | 将生物和化学实验设备云端化，通过标准化协议远程执行实验 | 商业平台 | [官网](https://www.emeraldcloudlab.com/) |
| 国外 | **Strateos** | Strateos | 云实验室与实验自动化 | 提供远程实验执行、自动化设备、实验协议和数据管理能力 | 商业平台 | [官网](https://strateos.com/) |

---

## 三、生命科学 Skills 与 Workflow 生态

| 地区 | 项目 | 团队/机构 | 覆盖范围 | 核心特点 | 开放情况 | 链接 |
|---|---|---|---|---|---|---|
| 国内/国际社区 | **LabClaw** | LabClaw 社区 | 生物学、实验自动化、药物发现、医学、文献、数据科学和科学可视化 | 面向 OpenClaw/LabOS-compatible Agent 的大规模 `SKILL.md` 技能库，负责说明何时及如何调用工具 | 开源 | [GitHub](https://github.com/wu-yc/LabClaw) · [官网](https://labclaw-ai.github.io/) |
| 国内 | **OpenBioMed Skills** | PharMolix、清华 AIR | 分子、蛋白质、药物发现、单细胞与生物医学分析 | 将模型、数据库和分析方法封装为可组合的端到端科研技能 | 开源 | [GitHub](https://github.com/PharMolix/OpenBioMed) |
| 国内 | **MolClaw Hierarchical Skills** | MolClaw 团队 | 分子检索、性质预测、ADMET、对接、模拟、筛选和优化 | 分层技能体系：原子工具、验证工作流、学科方法论和文献研究，并可从执行轨迹沉淀新技能 | 开源 | [GitHub](https://github.com/InternScience/MolClaw) |
| 国内/国际社区 | **Awesome Scientific Skills** | InternScience 社区 | 通用科研与湿实验相关 Skills | 汇集文献、模拟、数据分析、实验和学科专用 Skills，适合作为科研 Agent 的社区技能目录 | 开源 | [GitHub](https://github.com/InternScience/Awesome-Scientific-Skills) |
| 国外 | **ToolUniverse Agent Skills** | Harvard Medical School Zitnik Lab | 创药、精准肿瘤学、罕见病、药物警戒、组学与文献研究 | 在统一工具生态之上提供预构建的科研工作流，兼容多种 LLM 和 MCP | 开源 | [GitHub](https://github.com/mims-harvard/ToolUniverse) |
| 国外 | **Scientific Agent Skills** | K-Dense | 生物医学数据库、科学 Python、文献、统计和数据分析 | 面向 Claude Code、Codex 等 Agent 环境的通用科学技能集合 | MIT 开源 | [GitHub](https://github.com/K-Dense-AI/scientific-agent-skills) |
| 国外 | **Google DeepMind Science Skills** | Google DeepMind | 基因组学、结构生物学、化学信息学和文献 | 通过 Skills 封装 AlphaGenome、AlphaFold DB、UniProt、InterPro 等 30+ 数据库和工具，强调可追溯、低上下文开销的科研工作流 | 开源/预览产品 | [GitHub](https://github.com/google-deepmind/science-skills) · [官方介绍](https://blog.google/innovation-and-ai/technology/research/gemini-for-science-io-2026/) |
| 国外 | **BioMCP Investigation Skills** | GenomOncology 社区 | 基因、变异、药物、疾病、通路和论文调查 | 在 BioMCP 统一命令面之上提供引导式调查流程，可安装到支持 Skills 的 Agent 环境 | MIT 开源 | [GitHub](https://github.com/genomoncology/biomcp) · [文档](https://biomcp.org/) |
| 国际社区 | **SciAgent-Skills** | jaechang-hits 社区 | 生信、单细胞、蛋白、创药和统计 | 大规模生命科学 Skill 集；项目方报告了 BixBench 改进，但尚需独立复现 | 社区开源 | [GitHub](https://github.com/jaechang-hits/SciAgent-Skills) |
| 国外 | **Claude Life Sciences Skills** | Anthropic | 文献、组学、结构生物学、化学信息学和研发工作流 | 将生命科学方法、代码模板和连接器封装进 Claude 工作环境 | 商业产品 | [介绍](https://www.anthropic.com/news/claude-for-life-sciences) |
| 国外 | **NVIDIA BioNeMo Agent Toolkit / Blueprints** | NVIDIA | 生成式药物发现和蛋白质设计 | 将 BioNeMo 模型、NIM 服务、检索和工作流包装为可编排的 AI 应用组件 | 商业+部分开源 | [官网](https://www.nvidia.com/en-us/clara/bionemo/) |
| 国际社区 | **nf-core Pipelines** | nf-core / Seqera 社区 | RNA-seq、变异、宏基因组、表观组等标准流程 | 社区审阅的 Nextflow 流程，不是 `SKILL.md`，但很适合被 Agent 作为高可信、可复现的复合 Workflow 调用 | 开源；各流程许可证独立 | [官网](https://nf-co.re/pipelines/) · [GitHub](https://github.com/nf-core) |
| 国际社区 | **LabOP** | Bioprotocols 社区 | 机器可读实验协议 | 用语义对象表达步骤、样品、仪器和数据流，可作为湿实验 Skills/协议的交换格式 | 开源 | [GitHub](https://github.com/Bioprotocols/labop) |

---

## 四、Tool Infrastructure：工具注册、发现与执行层

| 地区 | 项目 | 团队/机构 | 核心定位 | 关键能力 | 开放情况 | 链接 |
|---|---|---|---|---|---|---|
| 国外 | **ToolUniverse** | Harvard Medical School Zitnik Lab | AI Scientist 工具生态与交互协议 | 集成 1000+ 模型、数据库、API 和科学软件；支持工具发现、组合、MCP、异步长任务、缓存和多模型接入 | 开源 | [GitHub](https://github.com/mims-harvard/ToolUniverse) |
| 国外 | **Biomni Environment（E1）** | Stanford SNAP | 生物医学 Agent 执行环境 | 标准化接入生物医学工具、数据库、软件和数据资源，为 Agent 提供可执行环境 | 开源 | [GitHub](https://github.com/snap-stanford/biomni) |
| 国内 | **BioinfoMCP** | 国内研究团队 | 生物信息学 MCP 工具平台 | 将传统生信软件和分析流程转换为 Agent 可发现、可调用的 MCP 服务 | 研究/开源项目 | [论文](https://arxiv.org/abs/2510.02139) |
| 国外 | **BioMCP** | GenomOncology 社区 | 生物医学 CLI 与 MCP Server | 用统一命令查询论文、基因、变异、药物、疾病、试验、通路、蛋白和药物警戒资源，并支持实体间跳转与本地队列分析 | MIT 开源；上游数据条款各异 | [GitHub](https://github.com/genomoncology/biomcp) · [文档](https://biomcp.org/) |
| 国外 | **BioContextAI Knowledgebase MCP / Registry** | BioContextAI 社区 | 生物医学 MCP 数据层与注册表 | 通过本地或远程 MCP 统一访问常用知识库；Registry 负责发现和分发社区生物医学 MCP Server | 开源+公共远程服务 | [文档](https://docs.kb.biocontext.ai/latest/) · [Registry](https://biocontext.ai/registry) |
| 国际 | **Model Context Protocol（MCP）** | 开放协议生态 | 通用 Agent—工具协议 | 标准化工具、资源、提示以及 stdio/HTTP 通信，是 BioMCP、BioContextAI 和 ToolUniverse 等互操作的协议基础 | 开放规范与 SDK | [规范](https://modelcontextprotocol.io/specification/) |
| 国外 | **BioThings APIs** | Scripps Research | 生物实体 API 基础设施 | MyGene.info、MyVariant.info、MyChem.info 等提供一致的 JSON API，适合实体解析、标准化与批量注释 | 公共 API；继承上游数据条款 | [官网](https://biothings.io/) |
| 国外 | **BioChatter** | BioCypher 社区 | 生物医学对话/Agent 应用框架 | 提供可替换模型、知识图谱连接、RAG、模型链和领域评测组件，用于搭建受约束的生物医学助手 | 开源 | [官网](https://biochatter.org/) · [GitHub](https://github.com/biocypher/biochatter) |
| 国外 | **Aviary** | FutureHouse | 科学 Agent 训练与工具环境 | 提供文献、DNA 构建设计、蛋白工程等可交互环境，用于训练和评测工具调用 Agent | 开源 | [GitHub](https://github.com/Future-House/aviary) · [介绍](https://www.futurehouse.org/research/aviary) |
| 国际 | **Galaxy** | Galaxy Project | 可复现生物信息学工作流平台 | 大规模生信工具注册、数据管理、工作流编排和可复现执行，可作为 Agent 后端 | 开源+公共服务 | [官网](https://galaxyproject.org/) |
| 国际 | **Nextflow** | Seqera / 开源社区 | 计算生物学工作流引擎 | 容器化、可移植、可扩展的生信流水线执行；nf-core 提供大量标准化流程 | 开源+商业平台 | [官网](https://www.nextflow.io/) |
| 国际 | **Snakemake** | 开源社区 | 可复现科学工作流引擎 | 基于依赖图组织数据分析任务，广泛用于组学和计算生物学 | 开源 | [官网](https://snakemake.github.io/) |
| 国际 | **Dockstore** | OICR、Broad Institute 等 | 科学 Workflow 注册与分发 | 发现、版本化和调用 CWL、WDL、Nextflow、Galaxy 工作流，可作为 Agent 的可信工作流目录 | 开源+托管服务 | [官网](https://dockstore.org/) · [GitHub](https://github.com/dockstore) |
| 国际 | **GA4GH WES / TES** | GA4GH | 云工作流与任务执行标准 | WES 提交和监控工作流，TES 提交容器化任务，使 Agent 能跨兼容后端编排基因组计算 | 开放标准；计算后端另行授权/计费 | [WES](https://www.ga4gh.org/product/workflow-execution-service-wes/) · [TES](https://www.ga4gh.org/product/task-execution-service-tes/) |
| 国际 | **SiLA 2** | SiLA Consortium | 实验设备通信标准 | 以 gRPC/Protocol Buffers 描述设备能力，标准化仪器、LIMS 和调度系统之间的控制与数据交换 | 开放规范 | [官网](https://sila-standard.com/) |
| 国际 | **PyLabRobot** | MIT 等/开源社区 | 硬件无关实验自动化 SDK | 统一控制液体工作站、读板机、泵、天平和加热振荡设备，可作为实验 Agent 的执行层 | MIT 开源 | [GitHub](https://github.com/PyLabRobot/pylabrobot) · [论文](https://pmc.ncbi.nlm.nih.gov/articles/PMC10369895/) |
| 国外 | **Opentrons Protocol API** | Opentrons | 液体工作站 API | 用 Python 生成、验证并运行 OT-2/Flex 协议，控制移液器、模块和耗材布局 | 软件开源+商业硬件 | [文档](https://docs.opentrons.com/v2/) · [GitHub](https://github.com/Opentrons/opentrons) |
| 国外 | **IBM RoboRXN** | IBM Research Europe | 云端自主合成平台 | 将反应预测和结构化合成步骤转为机器指令，远程驱动自动化化学硬件 | 云服务可访问；后端与机器人未完整开源 | [平台](https://rxn.res.ibm.com/rxn/robo-rxn/welcome) · [IBM Research](https://research.ibm.com/blog/roborxn-automating-chemical-synthesis) |
| 国际 | **Benchling** | Benchling | ELN、注册表与研发数据平台 | 管理序列、样品、实验记录、工作流和研发数据，常作为实验 Agent 的企业数据入口 | 商业平台 | [官网](https://www.benchling.com/) |
| 国际 | **DNAnexus** | DNAnexus | 生物医学云计算与数据平台 | 面向基因组和临床数据的安全存储、分析、工作流与协作环境 | 商业平台 | [官网](https://www.dnanexus.com/) |
| 国际 | **Terra** | Broad Institute、Microsoft、Verily | 生物医学云分析平台 | 支持大规模基因组数据、工作流、Notebook 和协作分析 | 平台 | [官网](https://terra.bio/) |
| 国际 | **Seven Bridges** | Velsera | 生物医学数据与工作流平台 | 面向基因组学、药物研发和多组学计算的云端工作流与数据环境 | 商业平台 | [官网](https://www.sevenbridges.com/) |

### Agent 评测与验证基础设施

| Benchmark | 团队/机构 | 主要评测内容 | 形式与规模 | 开放情况 | 链接 |
|---|---|---|---|---|---|
| **LAB-Bench / LABBench2** | FutureHouse / Edison Scientific | 文献、数据库、图表、序列、协议和克隆等真实生物科研能力 | LAB-Bench 含 2,457 题、8 大类；LABBench2 进一步修订题目质量和污染问题 | 大部分数据与代码开放，保留私测集 | [LAB-Bench](https://github.com/Future-House/LAB-Bench) · [LABBench2](https://github.com/EdisonScientific/labbench2) |
| **BixBench** | FutureHouse、ScienceMachine 等 | 开放式计算生物学分析、长链路代码执行和科学解释 | 真实分析场景与开放问答，要求 Python/R/Bash 和数据文件操作 | Apache-2.0/公开数据 | [GitHub](https://github.com/Future-House/BixBench) · [论文](https://arxiv.org/abs/2503.00096) |
| **BioMed-AQA** | BioMedAgent 团队 | 跨组学、机器学习、统计、可视化和病理图像等生物医学数据任务 | 327 个自然语言开放任务，含参考步骤和里程碑 | 数据集公开 | [Hugging Face](https://huggingface.co/datasets/BOBQWERA/biomed-aqa-dataset) · [论文](https://www.nature.com/articles/s41551-026-01634-6) |
| **ScienceAgentBench** | Ohio State University 等 | 生信、化学信息学、地学与认知神经科学的数据驱动研究 | 102 个真实科研任务，评估程序、执行结果和成本 | 开源 | [GitHub](https://github.com/OSU-NLP-Group/ScienceAgentBench) · [论文](https://arxiv.org/abs/2410.05080) |
| **BioAgent Bench** | 国际研究团队 | RNA-seq、变异、宏基因组等端到端生信执行及扰动鲁棒性 | 真实文件、容器、目标产物和受控错误注入 | 公开；仍属早期基准 | [GitHub](https://github.com/bioagent-bench/bioagent-bench) · [论文](https://arxiv.org/abs/2601.21800) |
| **MolBench** | MolClaw 团队 | 分子筛选、优化和端到端药物发现 Agent | 覆盖 8 至 50+ 次连续工具调用的长链路任务 | 随 MolClaw 开源 | [GitHub](https://github.com/InternScience/MolClaw) · [论文](https://arxiv.org/abs/2604.21937) |
| **CellBench** | CellVoyager 团队 | Agent 能否重建并扩展已发表单细胞分析 | 来自 76 篇 scRNA-seq 研究的分析决策与数据任务 | 随项目公开 | [GitHub](https://github.com/zou-group/CellVoyager) · [论文](https://www.nature.com/articles/s41592-026-03029-6) |

---

## 五、常被 Agent 调用的生命科学专业 Tools / Models

| 地区 | 工具/模型 | 团队/机构 | 主要任务 | 类型 | 开放情况 | 链接 |
|---|---|---|---|---|---|---|
| 国内 | **Uni-Mol** | DP Technology / DeepModeling | 三维分子表征、性质预测、构象与药物设计 | 分子基础模型 | 开源 | [GitHub](https://github.com/deepmodeling/Uni-Mol) |
| 国内 | **Uni-Fold** | DP Technology / DeepModeling | 蛋白单体与复合物结构预测 | 结构预测模型 | 开源 | [GitHub](https://github.com/dptech-corp/Uni-Fold) |
| 国内 | **Protenix** | 字节跳动 | 蛋白质、核酸、配体等复合物结构预测 | 结构预测模型 | 开源 | [GitHub](https://github.com/bytedance/Protenix) |
| 国内 | **HelixFold3** | 百度 PaddleHelix | 生物分子复合物结构预测 | 结构预测模型 | 开源 | [GitHub](https://github.com/PaddlePaddle/PaddleHelix) |
| 国内 | **BioMedGPT-Mol** | PharMolix、清华 AIR | 分子理解、生成、性质预测、反应和分子优化 | 多模态分子模型 | 开源权重/工具 | [Hugging Face](https://huggingface.co/PharMolix/BioMedGPT-Mol) |
| 国外 | **AlphaFold 3** | Google DeepMind / Isomorphic Labs | 蛋白质、核酸、配体、离子等复合物结构预测 | 结构预测模型 | 服务器可用；源码为非商业许可证，权重需申请且受限 | [GitHub](https://github.com/google-deepmind/alphafold3) · [论文](https://www.nature.com/articles/s41586-024-07487-w) |
| 国外 | **Boltz** | MIT 等 | 生物分子复合物结构与结合性质预测 | 结构/亲和力模型 | 开源 | [GitHub](https://github.com/jwohlwend/boltz) |
| 国外 | **Chai-1** | Chai Discovery | 蛋白质、小分子、核酸和抗体复合物结构预测 | 多模态结构模型 | 研究代码与权重可用；许可证需核对 | [GitHub](https://github.com/chaidiscovery/chai-lab) |
| 国外 | **RFdiffusion** | University of Washington / Baker Lab | 从头蛋白骨架和功能蛋白设计 | 生成式蛋白设计模型 | 开源 | [GitHub](https://github.com/RosettaCommons/RFdiffusion) |
| 国外 | **ProteinMPNN** | Baker Lab | 给定蛋白骨架的氨基酸序列设计 | 蛋白序列设计模型 | 开源 | [GitHub](https://github.com/dauparas/ProteinMPNN) |
| 国外 | **ESM** | Meta FAIR / EvolutionaryScale | 蛋白质语言建模、表征与生成 | 蛋白基础模型 | 开源/商业并存 | [GitHub](https://github.com/facebookresearch/esm) |
| 国外 | **Evo 2** | Arc Institute、NVIDIA 等 | 基因组序列建模、生成和变异效应 | 基因组基础模型 | 开放模型/代码，具体权重与使用条款依版本 | [GitHub](https://github.com/ArcInstitute/evo2) |
| 国外 | **AlphaGenome** | Google DeepMind | 长 DNA 序列的调控效应和变异预测 | 基因组基础模型/API | 研究 API；访问与用途受条款限制 | [官方介绍](https://deepmind.google/discover/blog/alphagenome-ai-for-better-understanding-the-genome/) |
| 国外 | **ChatNT** | InstaDeep / BioNTech 等 | DNA、RNA、蛋白序列的多任务自然语言交互 | 生物序列对话模型 | 论文/研究模型 | [Nature Machine Intelligence](https://www.nature.com/articles/s42256-025-01047-1) |
| 国外 | **RDKit** | 开源社区 | 化学信息学、分子描述符、子结构与构象处理 | 化学软件库 | 开源 | [官网](https://www.rdkit.org/) |
| 国外 | **OpenMM** | Stanford 等 | 分子动力学模拟 | 模拟引擎 | 开源 | [GitHub](https://github.com/openmm/openmm) |
| 国外 | **AutoDock Vina** | Scripps Research 等 | 分子对接 | 对接软件 | 开源 | [GitHub](https://github.com/ccsb-scripps/AutoDock-Vina) |
| 国外 | **DiffDock** | MIT 等 | 蛋白—配体盲对接与构象预测 | 生成式对接模型 | 开源 | [GitHub](https://github.com/gcorso/DiffDock) |
| 国外 | **ADMET-AI** | Harvard Medical School 等 | 分子 ADMET 性质批量预测 | 药物性质模型/软件 | MIT 开源+在线服务 | [GitHub](https://github.com/swansonk14/admet_ai) |
| 国外 | **Scanpy** | scverse | 单细胞 RNA 测序分析 | 组学软件库 | 开源 | [官网](https://scanpy.readthedocs.io/) |
| 国外 | **scvi-tools** | Yosef Lab / scverse | 单细胞与空间组学概率建模 | 组学模型库 | 开源 | [官网](https://scvi-tools.org/) |
| 国外 | **Seurat** | Satija Lab | 单细胞与空间组学分析 | R 工具包 | 开源 | [官网](https://satijalab.org/seurat/) |
| 国外 | **Bioconductor** | 开源社区 | 基因组学、转录组学和生物统计分析 | R 软件生态 | 开源 | [官网](https://www.bioconductor.org/) |
| 国外 | **Cellpose** | Howard Hughes Medical Institute 等 | 显微图像细胞与细胞核分割 | 生物图像分析模型/软件 | 开源 | [GitHub](https://github.com/MouseLand/cellpose) |
| 国外 | **DeepVariant / DeepSomatic** | Google Research | 胚系与肿瘤体细胞变异检测 | 基因组分析模型 | 开源 | [DeepVariant](https://github.com/google/deepvariant) · [DeepSomatic](https://github.com/google/deepsomatic) |
| 国外 | **PaperQA2** | FutureHouse | 科学文献检索、证据综合和带引用问答 | 文献工具 | 开源 | [GitHub](https://github.com/Future-House/paper-qa) |

---

## 六、关键数据库与知识工具

> 对 Agent 而言，“数据库”和“可调用接口”不是一回事。下表同时列出资源及常用程序化入口；API 的速率、认证、商业使用和数据再分发条款需逐项核对。

| 类别 | 代表资源 | 主要用途 | 常用 Agent 调用入口 |
|---|---|---|---|
| 文献 | PubMed、PMC、Europe PMC、Semantic Scholar、bioRxiv、medRxiv | 文献检索、证据综合、引用追踪和实体抽取 | [NCBI E-utilities](https://www.ncbi.nlm.nih.gov/home/develop/api/)、[Europe PMC REST/Annotations](https://europepmc.org/RestfulWebService)、BioMCP、PaperQA2 |
| 基因与蛋白 | NCBI Gene、UniProt、Ensembl、Gene Ontology、STRING、Human Protein Atlas | 基因功能、蛋白信息、ID 映射、表达、互作和本体注释 | [UniProt REST](https://rest.uniprot.org/)、Ensembl REST、BioThings/MyGene、BioContextAI MCP |
| 结构 | RCSB PDB、AlphaFold DB、InterPro | 实验结构、预测结构、结构域和复合物信息 | [RCSB Data/Search API](https://data.rcsb.org/)、AlphaFold DB API、BioMCP |
| 化合物与药物 | PubChem、ChEMBL、DrugBank、BindingDB、ZINC | 化合物、靶点、活性、机制、药物和筛选库 | [PubChem PUG-REST](https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest-tutorial)、[ChEMBL Web Services](https://www.ebi.ac.uk/chembl/api/data/docs)、ToolUniverse |
| 疾病与靶点 | Open Targets、DisGeNET、OMIM、GWAS Catalog、DGIdb | 疾病关联、遗传证据、已知药物和靶点评估 | [Open Targets GraphQL](https://platform-docs.opentargets.org/data-access/graphql-api)、GWAS Catalog REST、BioMCP |
| 变异与肿瘤 | ClinVar、gnomAD、CIViC、OncoKB、cBioPortal、COSMIC | 变异致病性、群体频率、癌症证据、治疗关联和队列分析 | NCBI Variation API、MyVariant.info、cBioPortal API、BioMCP；部分资源需令牌或限制再利用 |
| 表型与罕见病 | Human Phenotype Ontology、MONDO、Monarch Initiative、Orphanet | 症状—疾病—基因匹配、表型相似度和罕见病推理 | Monarch API、OLS、BioMCP；OMIM/Orphanet 需遵守专门条款 |
| 通路 | Reactome、KEGG、WikiPathways、g:Profiler | 通路富集、机制解释和网络分析 | Reactome Content Service、WikiPathways API、g:Profiler API；KEGG 商业使用需特别核对 |
| 临床与监管 | ClinicalTrials.gov、openFDA、Drugs@FDA、EMA | 临床试验、药物安全、器械、审批与监管数据 | ClinicalTrials.gov API v2、openFDA API、BioMCP |
| 单细胞与空间组学 | CELLxGENE、Human Cell Atlas、GEO、Single Cell Portal | 单细胞数据发现、表达矩阵查询和参考图谱 | [CELLxGENE Census API](https://chanzuckerberg.github.io/cellxgene-census/)、NCBI GEO/SRA 接口 |
| 功能基因组与表达 | ENCODE、GTEx、GEO、SRA | 表观组、组织表达、测序原始数据和调控元件 | ENCODE REST、GTEx Portal、NCBI Datasets/SRA、云端公开数据集 |
| 蛋白组与代谢组 | PRIDE、MassIVE、MetaboLights、Metabolomics Workbench | 质谱数据、蛋白鉴定和代谢物研究数据 | PRIDE API、MetaboLights API、批量下载/FTP |
| 国内公共资源 | NGDC、CNGBdb、国家人口健康科学数据中心等 | 国内基因组、组学与健康数据发现和归档 | REST/FTP/批量下载或项目申请；敏感人类数据通常需要审批 |

---

## 七、推荐的技术栈分层

| 层级 | 主要职责 | 代表项目 |
|---|---|---|
| **科研交互与自主规划层** | 理解目标、分解任务、反思、协作和生成报告 | Biomni、BioMedAgent、MolClaw、Robin、Virtual Lab、CellAgent、SPARK |
| **领域 Skills 层** | 固化领域知识、SOP、工具调用规范和质量检查 | LabClaw、OpenBioMed Skills、MolClaw Skills、ToolUniverse Skills、Google Science Skills |
| **工具发现与协议层** | 注册、检索、权限控制、上下文压缩和跨 Agent 互操作 | ToolUniverse、BioMCP、BioContextAI、BioinfoMCP、MCP |
| **计算工作流与执行层** | 可复现运行组学、模拟和数据处理流水线 | Galaxy、Nextflow/nf-core、Snakemake、Dockstore、GA4GH WES/TES |
| **专业模型与软件层** | 完成结构、分子、蛋白、基因组、单细胞和成像等原子任务 | AlphaFold、Boltz、Uni-Mol、RDKit、Scanpy、Cellpose、OpenMM |
| **数据与知识层** | 提供论文、数据库、知识图谱、队列和实验数据 | PubMed、UniProt、ChEMBL、Open Targets、PDB、CELLxGENE |
| **实验执行层** | 连接 ELN/LIMS、仪器、机器人、云实验室和人类实验员 | LabOS、Uni-Lab-OS、SiLA 2、PyLabRobot、Opentrons、Emerald Cloud Lab |
| **评测、审计与治理层** | 验证任务完成度、科学正确性、复现性、鲁棒性、成本和安全边界 | LAB-Bench、BixBench、BioMed-AQA、BioAgent Bench、MolBench、人工/湿实验复核 |

---

## 八、简要结论

1. **通用生物医学 Agent**：Biomni 是开源通用型代表；BioMedAgent 是国内 2026 年值得重点关注的自进化生物医学数据 Agent。
2. **端到端科学发现**：Robin、Google Co-Scientist、Virtual Lab 已从“问答/代码助手”推进到假设、数据分析或实验验证，但三者的开放程度和人类参与方式不同。
3. **垂直领域 Agent**：MolClaw/DrugAgent 面向创药，CellAgent/CellVoyager 面向单细胞，SPARK 面向数字病理，GeneAgent 面向基因集解释，CRISPR-GPT/BioDiscoveryAgent 面向基因编辑。
4. **工具基础设施**：ToolUniverse 强在大规模工具统一接入，BioMCP 强在低开销、证据导向的生物医学查询，BioContextAI 强在 MCP 知识库与注册发现，三者并非互斥。
5. **Skills 与高可信 Workflows**：LabClaw、OpenBioMed、MolClaw、ToolUniverse、Google Science Skills 属 Agent Skills；nf-core、Galaxy Workflow、Dockstore 虽不是 `SKILL.md`，却是可复现执行的重要“复合能力”。
6. **真实实验闭环**：Coscientist、SAMPLE、BioMARS、ORGANA、LabOS 和 Uni-Lab-OS 展示了从自然语言/算法决策到仪器执行的不同路线；真正跨实验室泛化仍受硬件、协议标准化和安全约束。
7. **成熟度判断应分层**：正式论文和开源代码不等于生产可用；更强证据依次来自可复现实验、外部基准、前瞻性湿实验验证、多中心/真实场景验证。
8. 行业技术路线正在从“单一生物大模型”转向：

> **科研 Agent + 领域 Skills + 工具执行基础设施 + 专业模型/数据库 + 实验室连接器**

## 注意事项

- 项目的工具数、Skills 数和开放状态变化较快，应以项目官网或 GitHub 最新版本为准。
- “知名”综合考虑了论文影响、机构背景、开源活跃度、产品成熟度和行业讨论度，并非严格排名。
- 表中的 benchmark 成绩若无第三方复现，均应理解为项目方报告；不同基准、任务集和工具权限下的数字不可直接横向排名。
- 商业平台能否被 Agent 调用，取决于 API、账户、数据权限、审计和计费合同；“有网页产品”不等于“开放机器接口”。
- 人类基因组、临床和队列数据可能涉及知情同意、隐私、跨境、用途限制和数据主权，部署前需单独完成合规审查。
- 医疗诊断和治疗类 Agent 输出不能直接作为临床决策依据。
- 结构预测、分子对接、ADMET 和生成模型结果均需要实验验证。
- A-Lab 主要属于材料科学，本文仅作为跨领域自驱动实验室的参考案例，不计入生命科学核心 Agent 名单。
