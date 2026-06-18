# 同类工作如何 evaluate —— 文献综述与本项目采用的评测协议

> 目的:让证据 DAG 引擎的评测**可信、可比、对得上 reviewer 预期**。本文综合三块文献
> (科学声明验证 + 归因/引用忠实度、推理链忠实度 + 结构抽取质量、provenance + 论证 + 对抗性
> NLI),给出每个指标的 (a) 定义 (b) 出处 (c) 需要什么 gold,最后落到我们**实际采用**的协议。
> 决策前提:**不做模型微调**,用现成 NLI-judge,靠**严酷/对抗评测**而非微调来保证可信。

---

## 0. 一句话结论

- 我们的核心主张是"**用 NLI 验证 supports 边比余弦相似更 sound**",这在文献里属于**对验证器本身的
  meta-evaluation**(像 TRUE / ALCE),不是单个 fact-checker。
- reviewer 期望看到:**ROC-AUC(threshold-free 头条)+ PR-AUC + dev 调阈的 F1 + 校准 ECE/Brier**,
  在**同一批边**上对比 {lexical、BM25、cosine、NLI};并且**必须有 hard negatives**(同主题不蕴含),
  否则 cosine 会被高估。
- 抽取质量按 **EntailmentBank 分解**(节点集 F1 / 节点类型准确率 / 按边类型的边 F1 / 严格 AllCorrect)+
  **抽样人工审计 + Wilson 置信区间 + Krippendorff α**(gold 稀缺时的标准做法)。
- 两个**真空地带可当贡献**:① 文献里没有现成的 "provenance soundness/coverage" 指标;② 论证强度分的
  **校准(ECE)几乎无人做**。

---

## 1. 科学声明验证 + 归因/引用忠实度

共同范式:**检索证据 → 选 rationale 句 → 判标签**,且**联合评分**(标签对但证据错不给分)——
正好对应我们"验证一条 supports 边"。

| 指标 | (a) 定义 | (b) 出处 | (c) gold |
|---|---|---|---|
| **FEVER Label Accuracy** | 3 类标签(SUP/REF/NEI)准确率,不管证据对错 | Thorne 2018 | 标签 |
| **FEVER score(strict)** | 标签对 **且** 完整 gold 证据组 ⊆ 预测证据(前 5 句);头条指标 | 同上 | 标签 + 证据组 |
| **Evidence P/R/F1** | 检索句 vs gold 证据的宏 P/R/F1 | 同上 | 证据组 |
| **SciFact 两粒度 ×{label / label+rationale}** | abstract 级 & sentence 级 P/R/F1;"+rationale" 要求 gold rationale 出现在预测前 3 句 | Wadden 2020 | 标签 + rationale |
| **SciFact-Open** | 开放域(50 万摘要),报 **oracle 证据 vs 全流程的落差(≥15 F1)** | Wadden 2022 | 标签 + 证据,oracle 喂 gold |
| **AIS(归因)** | 人工判"According to [源],[陈述]"是否成立;报 %AIS | Rashkin 2023 | 人工(它本身是 gold) |
| **ALCE Citation P/R/F1** | 用 NLI 当判官:Recall=被引文本是否蕴含句子;Precision=每个引用是否"必要"(删了就不蕴含) | Gao 2023 | 无需 gold 引用 |
| **RAGAS Faithfulness** | 答案拆成原子陈述,被上下文蕴含的比例 | Es 2024 | 无(仅上下文) |
| **TRUE** | meta-eval:11 数据集二元一致性标签,用 **ROC-AUC** 比各种一致性度量 | Honovich 2022 | 二元一致性标签 |

**为什么 ROC-AUC 是头条**:TRUE 明确——不同度量量纲不同,在手挑阈值上比 accuracy/F1 不公平且可被 game;
ROC-AUC 衡量**排序**能力,阈值无关。**NLI 通常要打败的弱基线**:词重叠(ROUGE/Jaccard)、BERTScore、
**BM25 / cosine-embedding**。

---

## 2. 推理链忠实度 + 结构抽取质量

### EntailmentBank(典范:带类型节点 + 类型边 对 gold 评分)
先**对齐节点**(叶子按句 id;中间节点按"祖先叶句集合的 Jaccard 最大"对齐),再分四项:
**Leaves F1**(节点集)、**Steps F1**(边/结构:该步输入节点标签完全匹配 gold)、**Intermediates F1**
(中间结论文本,BLEURT>0.28 算对)、**Overall AllCorrect**(三项全对才 1)。出处 Dalvi 2021。
→ 我们抽取质量直接套这个分解。

### 无 gold 的推理链忠实度
- **ROSCOE**(Golovneva 2023):基于句向量+NLI,无需 gold。Faithfulness-Step(每步对源的对齐)、
  Repetition(冗余)、Self/Source-consistency(NLI 最大矛盾概率)。
- **ReCEval**(Prasad 2023):把步骤拆成 RCU,**Intra-step entailment**(前提→结论的 NLI,= 我们 supports 边的天然检查)、
  **Inter-step contradiction**(= 我们 contradicts 边检查)、PVI 信息增益;链分=**各步 min**。
- **Lanham 2023**(因果/反事实忠实度,无需 gold):**early answering**(截断 CoT 看答案是否已定)、
  **adding mistakes**(注入错误看是否传播)、paraphrase、filler。→ "改一个节点重跑,看下游 supports/claim 是否按 DAG 预测变化"。

### 结构抽取 vs gold(及 gold 稀缺时)
- 三元组/节点级 **P/R/F1**(实体/类型/关系分开报)、**节点/边类型准确率**、**GED**(次要,昂贵)。
- 论证结构:**component P/R/F1 + relation F1(span≥75% 重叠)+ Krippendorff α**(典型 α≈0.79–0.89 组件、0.57–0.63 关系)。
- **gold 稀缺的标准做法**:**抽样三元组人工标 + 置信区间**(Gao 2019),用 **cluster sampling**(抽一个节点审它所有边)、
  **Wilson 区间**(非 Wald)、迭代到 CI 半宽 < 阈值停(Marchesin 2024)。→ 这是我们抽取 Gate 的可信度核心动作。

---

## 3. Provenance / 论证 / 对抗性 NLI

### Provenance(诚实结论:没有现成"对不对"的准确率指标)
- **W3C PROV / PROV-JSON**:评测 = **PROV-CONSTRAINTS 合法率**(类型/顺序/唯一性约束),不是准确率。
- **Nanopublication**:质量 = **provenance 完整性检查**(每条 assertion 必须有非空、良型的 provenance 图)。
- **PROV-AGENT**(Souza 2025,最接近本项目的前作):provenance 质量**工具性地**衡量——构造一组
  provenance 查询类,看消费方能否在图上正确回答。→ 我们可定义"trace 重建查询准确率"。
- **可当贡献的真空**:无现成 "provenance soundness/coverage" 指标,我们自定义(合法率 + 覆盖率 + 查询准确率)。

### 定量论证(QBAF / 渐进语义 / ArgRAG)
- 强度分的"可信"主要靠**公理性质满足**(monotonicity / anonymity / continuity / directionality 等,无需 gold)
  + **下游任务准确率**(ArgRAG 在 PubHealth/RAGuard 报 accuracy)+ **方向/反事实检查**(扰动一条边,预测分数变向)。
- **校准基本没人做** → 又一个可当贡献的真空(对 QBAF 强度做 ECE/可靠性分析)。

### 对抗性 / 鲁棒性 NLI(最重要,本项目重点)
| 方法 | (a) 定义 | (b) 出处 | (c) gold |
|---|---|---|---|
| **ANLI** | 人机回环写能骗过模型的假设,3 轮递增难度;报 fooling rate | Nie 2020 | 人写+人验(贵) |
| **Contrast sets** | 最小扰动翻转 gold 标签;报 **contrast consistency**(整组全对) | Gardner 2020 | 专家扰动样本 |
| **VitaminC** | 措辞几乎相同但事实改动→标签翻转的**对照证据对**(本项目 hard neg 的范本) | Schuster 2021 | 最小事实改动对 |
| **Stress tests** | 每集一个语言现象(否定/反义/数值/词重叠);报 per-phenomenon 准确率 | Naik 2018 | 模板,无需人标 |
| **CheckList** | MFT/INV/DIR 行为测试;报 per-test 失败率 | Ribeiro 2020 | 模板+期望行为 |
| **AIS/AutoAIS** | "源真实且同主题但不蕴含"=典型 AIS 负例;**AutoAIS(LLM 判官)本身不可靠**(recall 低至 16–17%)→ 正是要对抗验证、别盲信判官 | Rashkin 2023 / Bohnet 2022 | (claim, 引文) 二元归因标 |
| **ECE / Brier** | 置信分箱,|置信−准确| 加权;分布漂移下报 ΔECE | Guo 2017 | 标签 + 置信 |

**SciFact-Open 的 distractor 配方**(把四个 SOTA 系统的 top 预测汇集人工标→检索可混淆的同主题负例)
是分布漂移评测的范本;并指出"证据只支持 claim 的特例"这种**部分蕴含**hard neg。

---

## 4. 本项目**采用**的评测协议(已实现)

### 4.1 抽取(Gate 1A)
- **小 gold 集**上按 EntailmentBank 分解报:节点集 F1、节点类型准确率、**按边类型的边 F1**(两端对齐且类型匹配才算对)、**Overall AllCorrect**。
- **抽样人工审计 + Wilson 95% CI + Krippendorff α**(cluster sampling,抽节点审其所有边,CI 半宽<±X% 停)——gold 稀缺下的可信度主力。
- 现状:已在真实 LK-99 trace 上做了 21/21 全人工抽查(见 VALIDATION.md);上面这套是**做规模化时**的协议。

### 4.2 验证器(Gate 1B,核心门槛)—— 已升级为对抗评测
`benchmark/adversarial_soundness.py`(本仓库)严格按上面文献实现:
- **四个 hard-negative 层级,全从 SciFact 造**:`same_topic`(同篇非 rationale 句)、`scope`(给 claim 加限定词使其不再被蕴含)、`contrastive`(翻转 claim 极性,VitaminC 式)、外加 easy 的 `contradict` / `random`。
- **四个打分器同批对比**:lexical Jaccard、TF-IDF cosine、BM25、**NLI-judge**。
- **指标面板**:**ROC-AUC**(头条,threshold-free)、**PR-AUC**、**dev 调阈的 F1**(阈值只在 dev split 调,test 上报)、NLI 的 **ECE / Brier**(把 ν 当概率的校准)。
- **分两套报**:ALL pairs 与 **HARD-NEGATIVE 子集**;预期 NLI 的优势在 hard 子集**变大**(cosine 在同主题翻转上崩到接近随机)。
- 基础 `benchmark/soundness_benchmark.py` 保留(NLI vs cosine 的 ROC-AUC 快速版,n=120 已 0.920 vs 0.804)。

### 4.3 后续阶段(占位,已知该报什么)
- **Provenance 层**:PROV-CONSTRAINTS 合法率 + provenance 覆盖率 + PROV-AGENT 式查询准确率(三者都是文献真空,可当贡献)。
- **QBAF 层**:声明满足哪些渐进语义公理(公理性)+ ArgRAG 式下游 fact-verification 准确率 + 强度分 **ECE**(真空,可当贡献)。
- **忠实度**:ReCEval intra/inter-step + ROSCOE faithfulness(无 gold)+ **Lanham 反事实**(改节点重跑看 DAG 预测)——并做"分数与人工判断相关性"的 meta-eval。

---

## 最小引用集
SciFact (Wadden 2020) · SciFact-Open (Wadden 2022) · FEVER (Thorne 2018) · VitaminC (Schuster 2021) ·
ALCE (Gao 2023) · RAGAS (Es 2024) · TRUE (Honovich 2022) · AIS (Rashkin 2023) · AutoAIS (Bohnet 2022) ·
EntailmentBank (Dalvi 2021) · ROSCOE (Golovneva 2023) · ReCEval (Prasad 2023) · Lanham 2023 ·
ANLI (Nie 2020) · Contrast Sets (Gardner 2020) · Stress Tests (Naik 2018) · CheckList (Ribeiro 2020) ·
Gao KG-accuracy 2019 · Marchesin 2024 · ECE (Guo 2017) · ArgRAG (Zhu 2025) · PROV-AGENT (Souza 2025).
