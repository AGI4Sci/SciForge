# Protein Grounder：蛋白模态翻译模型的 Formulation、数据来源与构建策略

> 飞书兼容说明：行内公式统一使用 `$...$`，独立公式统一使用 `$$...$$`。建议通过飞书的「导入 Markdown」导入本文件；若直接粘贴为纯文本，请在飞书输入 `/公式`，再粘贴对应公式内容。

## 1. 目标与边界

### 1.1 目标

Protein Grounder 的目标不是直接预测一个全局功能标签，而是把当前蛋白的序列—结构模态翻译成**可定位、可验证、带条件的局部分子能力描述**：

> 在给定 instruction 和 context 下，指出哪些氨基酸区域支持哪些分子交互或状态转换，并说明这些区域在局部结构中的作用。

模型输出应该能够回答：

- 哪些区域支持配体、底物、蛋白、DNA/RNA 或金属的识别；
- 哪些区域支持化学、构象、组装或空间状态转换；
- 哪些区域把两个分子事件或结构状态耦合起来；
- 当前序列—结构对这些判断的支持程度如何。

### 1.2 非目标

除非 instruction 或 context 明确提供，否则模型不应主动生成：

- 细胞通路、组织功能和疾病表型；
- 未被当前蛋白模态支持的具体生理底物；
- 仅凭同源名称推断的功能结论；
- 没有残基或结构依据的机制叙述。

模型应区分“结构上兼容某种能力”和“该能力已被实验确认”。

---

## 2. 统一模型定义

### 2.1 输入

当前版本的模型输入严格限定为单个蛋白的序列和结构：

$$
M_P = \{S, X\}
$$

其中：

- $S$：单条蛋白氨基酸序列；
- $X$：该蛋白的三维结构，包括坐标、链信息、残基可观测性和结构置信度。

如果同一个蛋白存在 apo/holo、active/inactive 或多个实验结构，它们应作为独立的结构样本或结构状态样本处理，而不是将 MSA、动态轨迹或额外生物信息作为当前模型的输入模态。

MSA、动态实验、PLM、突变和动力学数据只用于离线构建标签、生成教师信号和评估模型，不进入推理时的 $M_P$。

instruction 和 context 记为：

$$
Q=(I,C)
$$

其中 $I$ 指定查询类型和输出粒度，$C$ 指定相关分子、状态和条件，例如配体、底物、伙伴、辅因子、膜环境、pH、温度或寡聚状态。

### 2.2 潜在输出：残基锚定的分子能力声明

模型先预测一组结构化 claim：

$$
Z=\{z_1,z_2,\ldots,z_K\}
$$

每个 claim 定义为：

$$
z_k=(\tau_k,U_k,R_k,\rho_k,\kappa_k)
$$

其中：

- $\tau_k$：分子操作类型；
- $U_k$：相关分子实体或分子状态；
- $R_k$：实现该能力的残基集合，可为不连续区域；
- $\rho_k$：残基集合的局部结构作用；
- $\kappa_k$：适用条件、置信度和证据范围。

最小的分子操作类型为：

```text
ASSOCIATE   选择性识别、结合或稳定某个分子/状态
TRANSFORM   介导化学、构象、组装或空间状态转换
COUPLE      将两个分子事件或状态转换建立条件性联系
```

例如：

```yaml
type: ASSOCIATE
entity: ATP
residues: [20, 24, 27, 31]
local_role: nucleotide-recognition-geometry
```

```yaml
type: TRANSFORM
state_transition: substrate_S1 -> substrate_S2
residues: [110, 114]
local_role: catalytic-chemical-environment
```

```yaml
type: COUPLE
events: ATP_binding <-> domain_closing
residue_sets: [[20, 24, 27, 31], [170, 178, 190]]
local_role: conformational-coupling
```

`effect` 不作为独立的基础标签；它由状态转换方向、速率变化或耦合方向生成。`mechanistic grounding` 也不是独立任务，而是由 $R_k$ 和 $\rho_k$ 表示。

### 2.3 概率分解

Protein Grounder 可以形式化为：

$$
p_\theta(Y,Z\mid M_P,Q)
=
p_\theta(Z\mid M_P,Q)
p_\theta(Y\mid Z,Q)
$$

其中：

1. `Protein encoder` 只融合序列和结构模态；
2. `Grounding module` 预测分子操作、分子对象、残基集合和局部角色；
3. `Text renderer` 将结构化 claim 渲染为 instruction-specific 文本。

即：

$$
M_P \rightarrow H_P \rightarrow Z \rightarrow Y
$$

文本 $Y$ 只是 $Z$ 的一种语言化，而不是唯一监督目标。

### 2.4 Instruction 是对同一个能力图的查询

不同 instruction 应查询同一个潜在结构，而不是触发互相独立的任务头：

```text
“它结合什么？”              -> ASSOCIATE
“哪些区域支持催化？”         -> TRANSFORM + residue grounding
“配体如何影响构象？”         -> COUPLE
“这个区域为什么重要？”       -> local_role + supporting evidence
“只报告结构直接支持的能力”   -> scope constraint + abstention
```

形式上：

$$
Y=\mathrm{Render}\left(\mathrm{Query}(Z,I),C\right)
$$

### 2.5 Scope constraint

所有生成的 claim 都必须满足：

$$
\mathrm{Claims}(Y)\subseteq \mathrm{Support}(M_P,C)
$$

如果 context 没有给出具体底物，模型应描述“兼容的分子特征”或输出未知，而不是凭空指定底物名称。

---

## 3. 统一数据单元

不要以“蛋白质—一段功能描述”作为基本样本，而应使用 atomic grounded claim：

```yaml
record_id:

protein:
  canonical_sequence_id:
  sequence:
  organism:
  isoform:
  construct:
  residue_numbering:

input_modalities:
  structures:
    - structure_id:
      chain_id:
      state: apo | holo | active | inactive | complex
      resolution_or_confidence:
      observed_residues:

label_construction_evidence:
  msa:
    alignment_id:
    depth:
    subfamily:
  dynamics:
    source:
    state_pair:
  plm:
    model:
    score_type:
  perturbation:
    dataset:

context:
  entities: [ligand, substrate, partner, nucleic_acid, ion]
  states: [conformation, oligomer, compartment]
  conditions: [pH, temperature, cofactor, membrane]

query:
  instruction:
  operation: ASSOCIATE | TRANSFORM | COUPLE

claim:
  entities_or_states:
  residue_sets:
    - positions:
      region_type:
  local_role:
  relation_to_other_regions:
  polarity: supports | opposes | unknown
  confidence:

intervention_or_measurement:
  mutation:
  measured_quantity:
  value:
  direction:
  assay_context:

evidence:
  source_type:
  source_id:
  method:
  directness: causal | observed | inferred
  provenance:
  evidence_confidence:

text:
  canonical_description:
  paraphrases:
```

### 3.1 推荐的局部角色本体

局部角色不应无限细分，建议采用层级标签：

```text
recognition
  direct-contact
  electrostatic-complementarity
  shape-complementarity
  motif-mediated

transition
  chemical-catalysis
  proton-transfer
  metal-coordination
  geometric-organization
  conformational-gating

coupling
  allosteric
  inter-domain
  inter-subunit
  mechanical
  membrane/translocation

structural-support
  fold-stabilization
  interface-organization
  disorder-mediated
```

---

## 4. 数据来源体系

不同数据源不是同一种标签，而是同一潜在 claim graph 的不同观测。

### 4.1 人工和细粒度位置注释：高精度种子

用于构建 residue、region 和 role 的高质量监督：

- [UniProt sequence features](https://www.uniprot.org/help/sequence_annotation)：active site、binding site、modified residue、motif、region、DNA-binding、transmembrane 等位置级特征；保留实验、人工传播和自动预测的 evidence code。
- [M-CSA](https://www.ebi.ac.uk/thornton-srv/m-csa/download/)：催化残基、辅因子、反应步骤和残基在反应机制中的角色。
- [InterPro](https://www.ebi.ac.uk/interpro/)、Pfam、PROSITE：结构域、家族、保守 motif 和部分功能位点。
- [DisProt](https://disprot.org/)：无序区、诱导折叠、无序相关功能和实验条件。
- ELM：真核短线性基序及其介导的交互。

这些数据适合作为 Gold/Silver seed，但要区分：

```text
直接实验定位 > 人工机制注释 > 同源传播 > 自动预测
```

### 4.2 实验结构：几何和状态观测

主要来源：

- [RCSB PDB](https://www.rcsb.org/) / wwPDB：蛋白—配体、蛋白—蛋白、蛋白—核酸、金属和水分子接触；生物组装体；多构象结构。
- [BioLiP2](https://pmc.ncbi.nlm.nih.gov/articles/PMC10767969/)：筛选具有生物相关性的蛋白—配体交互，提供结合残基、催化残基、亲和力和配体序列。
- [PDBe-KB](https://www.ebi.ac.uk/pdbe/pdbe-kb/)：结构上的 residue-level function annotations。
- [SIFTS](https://www.ebi.ac.uk/pdbe/docs/sifts/)：PDB 链、结构残基与 UniProt 规范序列的 residue-level mapping。
- AlphaFold DB 等预测结构：用于低覆盖蛋白的结构候选和弱监督，不与实验结构混作同一证据等级。

结构应产生以下标签：

1. 原子级接触及接触类型：氢键、盐桥、疏水、芳香、金属配位、水桥；
2. 配体或伙伴的 binding residue set；
3. 生物组装体中的接口 residue set；
4. 口袋、通道、隧道和几何约束；
5. apo/holo、active/inactive、monomer/complex 等状态差异；
6. 缺失残基、突变构建体、标签和非生理性配体标记。

距离接触本身只能监督 `ASSOCIATE` 的几何投影，不能自动证明催化或变构作用。

### 4.3 MSA 和进化数据：离线弱监督与候选生成

从 MSA 构建：

- 单残基保守性；
- 亚家族内保守、家族间变化的 specificity positions；
- direct coupling 和共进化残基对；
- 进化耦合 residue communities；
- 结构域边界、插入缺失和 motif islands；
- 对蛋白—蛋白或蛋白—核酸交互使用 paired MSA。

MSA 信号应经过：

- 序列去冗余；
- 子家族划分；
- 系统发育校正；
- paralog/ortholog 区分；
- 结构和实验标签交叉验证。

MSA 不作为推理输入，而是离线构建对 residue set 和 coupling edge 的 soft prior。

### 4.4 PLM：离线高覆盖的教师和先验来源

PLM 可以作为重要的数据构建渠道，但只在离线阶段使用；推理时不把 PLM embedding、attention 或 masked score 作为输入。也不应把 attention 直接当作功能真值。

建议从 PLM 提取：

- masked marginal / pseudo-likelihood score；
- 单残基和多残基突变的 log-likelihood drop；
- attention rollout 或 attention head 统计；
- residue-pair 条件依赖；
- 与结构、MSA 对齐的 probe 输出；
- 在 instruction 或候选分子条件下的 query-conditioned score。

可将 PLM 作为：

1. 候选区域和候选残基对生成器；
2. Silver soft labels；
3. grounder 预训练的教师模型；
4. active learning 的不确定性和采样信号；
5. student model 的蒸馏目标。

必须避免：

- `high attention = functional residue`；
- 使用同一个 PLM 产生标签再训练同一个 PLM 的解释头；
- 把家族识别能力误当成局部功能能力；
- 用 PLM 生成的伪标签覆盖直接突变或结构证据。

### 4.5 扰动和反事实数据：因果监督核心

这是 Protein Grounder 最重要的补充来源。

- [MaveDB](https://mavedb.org/docs/mavedb/index.html)：MAVE、DMS 和大规模 variant-effect 数据。
- [ProteinGym](https://proteingym.org/)：整理后的突变效应 benchmark 和 assay 任务。
- [SKEMPI 2.0](https://pmc.ncbi.nlm.nih.gov/articles/PMC6361233/)：结构化蛋白复合物中突变引起的结合自由能、动力学和热力学变化。
- 定点突变、alanine scanning、chemical rescue、补偿突变和 directed evolution 数据。
- 双突变、组合 DMS 和 double-mutant cycle：残基集合间 coupling 的直接监督。

需要保留原始 readout 和 assay context，区分：

```text
folding/stability
binding affinity
association kinetics
catalytic turnover
transport
cellular proxy
```

单点 DMS 主要告诉模型“哪里重要”；组合突变和分离的结合/催化 readout 才更能告诉模型“为什么重要”。

### 4.6 定量生化数据：区分局部作用类型

- [SABIO-RK](https://sabio.bioquant.uni-heidelberg.de/)：反应动力学、速率方程、实验条件、野生型/突变体。
- BRENDA：酶反应、底物、抑制剂、辅因子和动力学数据。
- BindingDB、ChEMBL、PDBbind：蛋白—小分子结合和活性数据。
- Rhea、EC 和 ChEBI：反应、底物、产物和化学实体标准化。

可用不同参数将局部角色拆开：

- (K_d/K_i)：结合和识别；
- (k_{on}/k_{off})：结合动力学；
- (k_{cat})：化学转换；
- 构象平衡：状态稳定化和门控；
- 条件依赖的参数变化：coupling 和调控。

### 4.7 分子交互、PTM 和无序区

- [IntAct](https://www.ebi.ac.uk/intact/documentation/user-guide)：蛋白—蛋白、蛋白—DNA/RNA、蛋白—小分子交互和实验方法。
- PTM 数据库，例如 iPTMnet、PhosphoSitePlus、dbPTM：修饰位点、writer/eraser/reader 和条件依赖。
- DisProt、ELM：无序区、短线性基序和诱导交互。
- GPCRdb、KLIFS、MEROPS、CAZy、TCDB 等领域数据库：适用于特定蛋白类别的局部位点和结构功能标签。

这一类数据可以防止 grounder 只学到“结构稳定酶的活性口袋”，而忽略膜蛋白、受体、支架蛋白和无序调控蛋白。

### 4.8 动态和生物物理实验

从论文、补充材料和专门数据库中提取：

- HDX-MS peptide protection/change；
- NMR chemical-shift perturbation；
- cross-link MS；
- FRET、DEER/EPR 和距离变化；
- limited proteolysis；
- footprinting 和 covalent labeling；
- cryo-EM 3D variability 和 state classification；
- 单分子轨迹、构象转换和离子/水通路。

这些数据主要监督：

- interaction-responsive regions；
- conformational gating；
- allosteric coupling；
- disorder-to-order transition；
- transient interface。

### 4.9 文献和补充材料

机制数据常常不在数据库主表，而在：

- 突变表格；
- figure caption；
- supplementary spreadsheet；
- 结构比较图；
- kinetic assay；
- alanine scan；
- HDX/NMR peptide map。

文献抽取流程应输出原始证据链：

```text
paper -> figure/table/sentence -> protein construct -> residue mapping
      -> assay context -> measured change -> normalized claim
```

LLM 可用于候选抽取和标准化，但自动抽取结果需要 evidence confidence，并与原文片段绑定。

### 4.10 物理模拟、结构预测和设计数据

可作为 Bronze 或合成监督：

- MD、动态交叉相关、残基 interaction network、community 和路径分析；
- QM/MM、反应坐标、质子转移和金属配位；
- electrostatics、pKa、pocket、tunnel 和 solvent accessibility；
- docking、FEP、mutation energy decomposition；
- 蛋白设计和 directed-evolution trajectory；
- 经过实验验证的设计蛋白和负设计。

这些数据适合用于离线候选生成、预训练和反事实增强，但必须与实验数据分开标记；它们不作为推理时的额外蛋白输入。

---

## 5. 多渠道知识蒸馏策略

### 5.1 统一到同一 claim schema

所有离线来源先转换成同一个结构：

```text
(protein, context, operation, molecular entity/state,
 residue set, local role, polarity, evidence, confidence)
```

不要在原始格式层面直接拼接 UniProt、PDB、MSA、PLM 和 DMS 标签；推理时的模型输入仍然只有单个蛋白的序列和结构。

### 5.2 证据层级

建议保留以下证据等级：

```text
E0  直接因果：定点突变、DMS、双突变、化学救援
E1  直接观测：生物相关复合物结构、状态对、HDX/NMR/XL-MS
E2  人工整合：机制数据库、人工 residue annotation、文献核验
E3  进化统计：MSA conservation、coevolution、subfamily signal
E4  物理/模型推断：MD、QM/MM、docking、PLM signal
```

证据等级不是标签的替代品，而是用于：

- soft-label 权重；
- 冲突解决；
- 输出置信度；
- 训练/验证分层；
- 防止低等级证据覆盖高等级证据。

### 5.3 从教师集合蒸馏到一个 student grounder

设第 (k) 个来源产生一个对 claim 的软后验：

$$
t_k(Z\mid P,C)
$$

Protein Grounder 学习一个统一后验：

$$
q_\theta(Z\mid M_P,C)
$$

训练目标可以写成：

$$
\mathcal{L}_{distill}
=
\sum_k w_k\,
\mathrm{KL}\big(t_k(Z\mid P,C)\;\|\;q_\theta(Z\mid M_P,C)\big)
$$

其中 (w_k) 由证据等级、来源可靠性、数据质量和与当前 context 的匹配程度决定。

实际实现可采用：

1. 来源专属 teacher 产生 candidate claims；
2. 将 claims 映射到规范残基和统一 role ontology；
3. 通过证据加权和冲突检测形成 soft posterior；
4. 训练一个 student grounder；
5. 在 Gold 数据和全新蛋白家族上校准；
6. 迭代加入主动实验数据。

### 5.4 冲突处理

不应对冲突来源简单多数投票。建议：

- 保留所有互相冲突的 claims；
- 记录适用 context；
- 用证据等级和直接性加权；
- 对不同构象分别建图；
- 将 unresolved conflict 作为模型输出的不确定性；
- 不把“未观察到”自动转换为“没有功能”。

---

## 6. 数据构建流水线

### Step 1：规范化蛋白和残基坐标

统一到 canonical sequence，同时保留：

- isoform；
- construct；
- engineered mutation；
- PDB chain 和 insertion code；
- 缺失残基和未观察区域；
- residue mapping 置信度。

### Step 2：构建高精度 Gold claims

优先收集：

- 人工 active/binding site；
- M-CSA catalytic residue；
- 生物相关 ligand/complex 结构；
- 已有实验突变和动力学；
- 经过文献核验的局部机制。

### Step 3：从结构提取 Silver claims

自动提取：

- contact map；
- binding/interface residue sets；
- pocket 和 metal coordination；
- biological assembly；
- apo/holo 或 active/inactive 差异；
- 局部几何和水桥。

同时过滤：

- crystallization additives；
- crystal packing contacts；
- 低质量区域；
- 不相关链；
- 预测结构低置信度区域。

### Step 4：离线加入 MSA 和 PLM 软证据

对每个候选 claim 离线计算：

- conservation；
- subfamily specificity；
- coevolution；
- PLM mutation/masking score；
- attention 或 pairwise dependency；
- 与结构区域的重叠。

这些信号只改变离线 posterior、teacher target 或采样优先级，不直接决定正负标签，也不进入推理时的模型输入。

### Step 5：加入干预和定量数据

将突变效果映射到 claim：

```text
突变 -> readout change -> affected operation -> affected residue set
```

同时区分稳定性、结合、催化、运输和细胞 proxy assay。

### Step 6：构造 instruction 和文本

先从结构化 claim graph 生成 instruction，再生成文本：

```text
claim graph -> query templates -> instruction variants -> canonical text
```

instruction 变体可以包括：

- 一句话概括；
- 指出局部区域；
- 解释区域作用；
- 解释两个区域之间的耦合；
- 给定 ligand/partner/context 的条件化分析；
- 只报告高置信度结论；
- 输出结构支持与未知项。

不要从自由文本反向猜残基标签作为主要构建方式。

### Step 7：质量控制和人工审核

每条 claim 至少进行：

- 序列—结构坐标核验；
- construct/isoform 核验；
- ligand/partner 生物相关性核验；
- context 一致性核验；
- evidence provenance 核验；
- 与相关突变数据的一致性检查。

---

## 7. 负样本、硬负样本和反事实

只有正样本会让 grounder 过度标记所有保守或接触残基。

应构造：

- 同一结构中接触但不具功能证据的区域；
- 晶体接触和非生理配体接触；
- 同一 fold 但功能不同的蛋白；
- 同一蛋白不同构象下不活跃的区域；
- pseudoenzyme 或失活同源蛋白；
- 结合但不催化的 ligand analog；
- context 不匹配的配体或伙伴；
- DMS 中中性突变；
- 破坏局部结构但不改变特定功能的突变；
- 双突变中接近独立效应的 residue pair。

反事实样本包括：

```text
mutation / residue masking
ligand removal
apo <-> holo swap
active <-> inactive state swap
partner removal
context swap
```

模型应学习能力如何改变，而不仅是静态地标记某个区域。

---

## 8. 训练目标

建议联合优化：

$$
\mathcal{L}
=
\mathcal{L}_{op}
+\lambda_1\mathcal{L}_{entity}
+\lambda_2\mathcal{L}_{residue}
+\lambda_3\mathcal{L}_{role}
+\lambda_4\mathcal{L}_{text}
+\lambda_5\mathcal{L}_{intervention}
+\lambda_6\mathcal{L}_{consistency}
+\lambda_7\mathcal{L}_{abstention}
$$

- $\mathcal{L}_{op}$：ASSOCIATE/TRANSFORM/COUPLE 类型；
- $\mathcal{L}_{entity}$：分子实体和状态；
- $\mathcal{L}_{residue}$：残基集合或区域 grounding；
- $\mathcal{L}_{role}$：局部结构作用；
- $\mathcal{L}_{text}$：grounded text generation；
- $\mathcal{L}_{intervention}$：突变或 context 改变后的能力变化；
- $\mathcal{L}_{consistency}$：不同模态、结构状态和 instruction 的一致性；
- $\mathcal{L}_{abstention}$：对证据不足的内容拒答或降级表达。

建议先进行结构化 claim 预训练，再加入文本渲染；不要让语言损失主导 residue grounding。

---

## 9. 数据切分与评测

### 9.1 防止信息泄漏

至少使用：

- sequence-identity split；
- protein-family split；
- fold split；
- structure-state split；
- time split；
- source-held-out split。

不能把同一蛋白的同源结构、DMS 和 PLM 派生样本随机分散到 train/test。

### 9.2 Grounding 评测

- residue-level AUROC/AUPRC；
- region IoU 或 residue-set F1；
- binding/interface contact precision；
- catalytic-role accuracy；
- coupling-pair/community precision；
- 构象状态之间的 grounding consistency；
- mutation-effect rank correlation；
- uncertainty calibration。

### 9.3 文本评测

不要只用 BLEU/ROUGE。应评价：

- 每个文本 claim 是否可回指到 residue set；
- 是否引入 context 之外的对象；
- 是否把“结构兼容”夸大为“功能确认”；
- 不同 instruction 下是否保持底层 claim 一致；
- 是否正确表达冲突和未知；
- 文本改写后是否保持同一结构化语义。

---

## 10. 推荐的最小可行版本

第一版可以限定为：

### 输入

```text
single-protein sequence + single-protein structure
instruction + ligand/partner/state context
```

### 输出

```text
1. molecular operation: ASSOCIATE / TRANSFORM / COUPLE
2. involved entity or state
3. residue set(s)
4. local structural role
5. evidence level and uncertainty
6. concise grounded text
```

### 首批数据

优先构建小而高质量的 Gold set：

1. UniProt/M-CSA 的人工位点和机制注释；
2. BioLiP2/PDB 的生物相关配体和复合物结构；
3. apo/holo 或 active/inactive 状态对；
4. DMS、定点突变、SKEMPI 和定量动力学；
5. MSA/PLM 仅作为离线候选和 soft supervision，不作为模型输入；
6. 文献补充材料作为高价值增量。

之后再用大规模 PLM、结构预测和模拟数据扩展覆盖。

---

## 11. 核心结论

Protein Grounder 的统一目标不是学习若干孤立的 residue-level 任务，而是学习：

$$
\boxed{
(\text{sequence},\text{structure},\text{context})
\rightarrow
\text{residue-grounded molecular operator graph}
\rightarrow
\text{functional text}
}
$$

其中，模型推理时只接收单个蛋白的序列、结构以及 instruction/context；MSA、动态实验和其他渠道仅用于离线监督与蒸馏。

其中：

- 结构数据提供几何观测；
- MSA 提供离线进化先验；
- PLM 提供离线高覆盖候选和教师信号；
- 突变和动力学提供离线因果约束；
- 动态实验提供离线状态转换和耦合证据；
- 文献提供局部角色和实验语义。

最终蒸馏出的不是“数据库标签的平均值”，而是一个能够回答以下问题的统一模型：

> 在当前 protein 和 context 下，哪些氨基酸区域支持哪种分子能力，它们各自承担什么局部结构作用，以及当前证据支持到什么程度。
