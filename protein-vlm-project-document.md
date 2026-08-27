# Protein VLM 项目文档（讨论版）

> 目标：把单个蛋白质的序列与结构，翻译成 LLM 可以读取、组合和继续推理的、忠实且带残基区域 grounding 的蛋白语义。
>
> 本文档是当前讨论的可读版 v0.1。它先固定研究目标和最小语义接口，再讨论模型和数据；后续实现细节可以在不改变这个接口的前提下迭代。

## 0. 先说结论

我们不是要训练一个“从蛋白质直接生成一个功能标签”的模型，而是要训练一个 **Protein VLM / Protein Grounder**：

$$
\text{Protein modality} \longrightarrow \text{faithful, grounded, compositional protein semantics}
$$

它接收：

- 一个蛋白质的氨基酸序列；
- 这个蛋白质的静态三维结构；
- 一段自由文本 instruction。

它返回：

- 与当前 instruction 相关的局部结构化语义；
- 每条语义都指向具体残基区域；
- 先输出“结构事实”和“分子能力”，把更高层的生物学功能、mechanistic grounding 和 effect 留给上层 LLM 推理。

因此，模型的核心职责不是替代 LLM 做完整的生物学解释，而是提供一个可验证的蛋白质语义接口。

---

## 1. 我们到底在解决什么问题？

### 1.1 类比图像描述，但不是普通 captioning

图像 VLM 通常回答：

> “图中有什么？”

蛋白 VLM 要回答的是：

> “在这个 instruction 指定的角度下，当前蛋白质有哪些可以被观察、定位和组合的分子语义？这些语义由哪些局部结构实现？”

蛋白质的“功能”不是单一标签。相同蛋白质可以从配体结合、催化、构象变化、复合物形成、定位、调控等很多角度被描述。如果让 Protein VLM 直接生成所有功能，模型很容易：

- 依赖训练语料中的功能名称，而不是当前结构；
- 把可能性说成已证实事实；
- 产生无法定位到残基的泛化描述；
- 把复杂的生物学推理和结构观察混在一起。

所以我们的分工是：

> Protein VLM 负责从蛋白模态中抽取最小、可定位、可组合的语义；LLM 负责根据 instruction 和这些语义，组合成更高层的解释。

### 1.2 研究目标

给定蛋白质模态 $M_P$ 和 instruction $I$，生成一个与问题相关的、稀疏的、可 grounding 的语义子图：

$$
Y = f_\theta(M_P, I)
$$

其中：

$$
M_P = (S, X)
$$

- $S$：氨基酸序列；
- $X$：静态结构信息，包括残基坐标、链信息、观测状态和可选的结构置信度；
- $I$：自由文本 instruction，可包含问题、关注对象、条件和输出要求。

模型应尽量回答“当前结构支持什么语义”，而不是回答“这个蛋白在数据库中通常被叫什么”。

### 1.3 明确不属于 Protein VLM 的事情

以下内容可以作为离线训练标签、教师信号或评估依据，但不作为推理时的输入：

- MSA 和序列数据库检索结果；
- 分子动力学轨迹、构象转变轨迹；
- 突变实验结果、动力学常数和文献检索结果；
- PLM 的 attention、masked prediction 或 embedding；
- 其他分子的三维结构。

推理时的主模态始终是 **单个蛋白的序列 + 静态结构**。如果需要 ATP、金属离子或另一个蛋白的信息，由上层 LLM 通过 instruction、外部知识或另一个分子模型提供。

---

## 2. 输出什么：三个语义层级

Protein VLM 同时输出 Level 1 和 Level 2。Level 3 不作为 Protein VLM 的核心输出，而是交给 LLM。

| 层级 | 名称 | 回答的问题 | 是否必须 grounding |
|---|---|---|---|
| Level 1 | `STRUCTURAL_FACT` | 这里有什么局部结构、几何和化学事实？ | 必须 |
| Level 2 | `MOLECULAR_AFFORDANCE` | 这些结构事实支持什么类型的分子作用？ | 必须，且链接到 Level 1 |
| Level 3 | `FUNCTIONAL_HYPOTHESIS` | 在具体生物学上下文中，这可能意味着什么功能或效应？ | 由 LLM 组合推理 |

### 2.1 Level 1：结构事实

Level 1 只描述序列和静态结构能够直接支持的事实。例如：

- 一组连续或不连续残基形成一个凹陷 pocket；
- 该 pocket 的内壁富含带电、极性或芳香残基；
- 某些残基位于表面 patch，某些残基被埋藏在核心；
- 两个区域空间接触，或者一个区域连接两个结构域；
- 一个通道具有狭窄入口和较深内部空间。

Level 1 不直接说“这是 ATP 结合位点”或“这是催化位点”。这些已经包含了功能解释，应留在 Level 2 或 Level 3。

### 2.2 Level 2：分子能力 / affordance

Level 2 描述结构可能支持的分子事件类型，使用保守的 `supports_*` 表述：

1. `supports_association(target)`  
   该区域支持与某类分子特征、某个分子或某个分子伙伴发生选择性关联。

2. `supports_state_transition(state_change)`  
   该区域支持某类化学、构象、寡聚、空间位置或修饰状态发生改变。

3. `supports_coupling(event_a, event_b)`  
   两个结构区域或分子事件之间存在可被结构解释的条件依赖或耦合。

这三个谓词是目前建议的最小 Level 2 元能力。`recognition`、`catalysis`、`transport`、`allostery`、`activation` 等可以作为它们的细分类型或由 LLM 推导出的高层表达，不必再增加一套互相重叠的一级原语。

`supports_*` 很重要：Protein VLM 说的是“当前蛋白结构提供了什么分子能力”，不是无条件断言某个具体生物学功能已经被实验确认。

### 2.3 Level 3：交给 LLM 的推理结果

LLM 可以把 Level 1/2 与外部上下文组合起来，生成：

- 具体配体或底物的名称；
- 可能的反应机制；
- 对细胞通路、表型或疾病的影响；
- 对突变、药物或环境变化的预测；
- 更完整的自然语言功能描述。

这些内容不应被硬编码进 Protein VLM 的最小语义本体。Protein VLM 要提供的是“可供推理的结构化证据”。

### 2.4 三个 Level 的输入/输出示例

下面用同一个假想蛋白和同一个问题，展示三层之间的数据流。数值只是示意，重点是字段和语义边界。

#### Level 1：`STRUCTURAL_FACT`

**输入**：单个蛋白的序列、静态结构和 instruction。

```json
{
  "protein_id": "P_demo",
  "sequence": "...KLVVAGDST...",
  "structure": {
    "format": "mmcif",
    "chains": ["A"],
    "observed_residues": "A:1-180",
    "coordinates": "residue_atom_coordinates",
    "confidence": "per_residue_optional"
  },
  "instruction": "找出支持带磷酸基团分子结合的局部结构，并说明结构依据。"
}
```

**输出**：只描述当前结构可以直接支持的局部事实，不命名具体功能位点。

```json
{
  "level": 1,
  "regions": [
    {
      "id": "R1",
      "anchors": ["A:20-31", "A:87", "A:114-119"],
      "type": "pocket",
      "properties": {
        "geometry": ["concave", "partially_enclosed"],
        "chemistry": ["polar", "positively_lined"],
        "accessibility": "partially_accessible",
        "topology": "discontinuous"
      }
    }
  ],
  "relations": [
    {
      "predicate": "contacts",
      "source": "A:87",
      "target": "A:114-119",
      "distance_angstrom": 4.2
    }
  ]
}
```

对应的文本可以是：

> R1（A:20–31、A:87、A:114–119）形成一个部分封闭的凹陷区域。其内壁偏极性并带正电，区域内部残基在空间上彼此接近。

#### Level 2：`MOLECULAR_AFFORDANCE`

**输入**：蛋白编码 $H_P$、instruction，以及 Level 1 的结构事实 $Z_1$。Level 2 可以直接访问 $H_P$，但必须引用 $Z_1$ 的区域或关系。

```json
{
  "protein_id": "P_demo",
  "instruction": "检查哪些局部结构支持与带磷酸基团分子特征的关联。",
  "level_1_facts": [
    "R1 is a partially enclosed concave pocket",
    "R1 is polar and positively lined",
    "R1 contains spatially contacting residues"
  ]
}
```

**输出**：描述结构支持的分子能力，使用保守的 `supports_*` 谓词。

```json
{
  "level": 2,
  "claims": [
    {
      "id": "A1",
      "predicate": "supports_association",
      "target": {
        "kind": "molecular_feature",
        "name": "phosphate-bearing / negatively charged group"
      },
      "anchors": ["R1"],
      "basis": [
        "concave_partially_enclosed_geometry",
        "positive_and_polar_lining",
        "partial_accessibility"
      ],
      "confidence": 0.78
    }
  ]
}
```

对应的文本可以是：

> R1 支持与带磷酸基团、带负电的分子特征发生选择性关联。依据是该区域的凹陷几何、部分封闭性以及正/极性内壁。仅凭此结果不能断言已经确认结合 ATP。

#### Level 3：`FUNCTIONAL_HYPOTHESIS`

**输入**：Level 1/2 语义、用户上下文，以及 LLM 对外部对象的知识。Level 3 不要求 Protein VLM 接收 ATP 的三维结构。

```json
{
  "protein_semantics": [
    {
      "claim_id": "A1",
      "predicate": "supports_association",
      "target_feature": "phosphate-bearing / negatively charged group",
      "anchors": ["A:20-31", "A:87", "A:114-119"]
    }
  ],
  "external_context": {
    "molecule": "ATP",
    "known_feature": "contains a negatively charged phosphate group"
  },
  "instruction": "结合 ATP 的化学特征，给出谨慎的功能解释。"
}
```

**输出**：由 LLM 将抽象分子特征映射到具体对象，并明确证据边界。

```json
{
  "level": 3,
  "hypothesis": "该蛋白的 R1 区域在几何和电荷上适合与 ATP 所含的带负电磷酸基团发生关联，因此可能参与 ATP 相关分子的识别或定位。当前结构证据支持的是这种分子特征匹配，而不是单独证明 ATP 结合或 ATP 水解。",
  "grounding": {
    "supporting_claims": ["A1"],
    "residue_anchors": ["A:20-31", "A:87", "A:114-119"]
  }
}
```

三层的边界可以概括为：

```text
Level 1：结构上看到了什么？
        ↓
Level 2：这些结构支持什么类型的分子作用？
        ↓
Level 3：结合外部上下文，这可能意味着什么生物学功能？
```

---

## 3. 最小的原子语义单元

### 3.1 为什么采用事件中心，而不是残基中心

一个残基本身通常不是一个完整语义。真正有意义的对象往往是：

- 一组残基形成的 pocket；
- 两个区域之间的接触或几何关系；
- 一个局部结构对某类分子事件的支持。

因此，原子单元应以“分子事件或分子能力”为中心，同时携带残基 grounding：

$$
z = (p,\; a,\; q,\; R,\; c,\; e)
$$

- $p$：谓词，例如 `encloses`、`supports_association`；
- $a$：参与者，例如区域、分子特征、状态；
- $q$：状态或属性，例如电荷、可及性、构象状态；
- $R$：残基区域锚点；
- $c$：上下文条件；
- $e$：置信度与证据来源。

### 3.2 一个语义单元的推荐表示

```json
{
  "id": "aff_001",
  "level": 2,
  "predicate": "supports_association",
  "target": {
    "kind": "molecular_feature",
    "name": "phosphate-bearing / negatively charged group"
  },
  "anchors": ["A:20-31", "A:87", "A:114-119"],
  "region_types": ["pocket", "surface_patch"],
  "basis": [
    "enclosed_concave_geometry",
    "polar_and_positive_lining",
    "spatial_contact_between_anchors"
  ],
  "confidence": 0.78,
  "evidence": ["structure", "curated_annotation", "PLM_teacher"]
}
```

这条记录可以被渲染成自然语言，也可以作为 LLM 的结构化上下文。`anchors` 是硬约束：任何 Level 2 语义都必须能回指到至少一个 Level 1 区域或关系。

---

## 4. Level 1 的最小本体

Level 1 不是完整的蛋白知识图谱，而是一个足够支撑 Level 2 的局部结构图：

$$
G_1(P) = \{\text{REGION},\; \text{PROPERTY},\; \text{RELATION}\}
$$

### 4.1 `REGION`：带结构类型的残基集合

Region 是残基集合，不要求覆盖整个蛋白，也不要求彼此互斥。同一个残基可以属于多个有意义的区域。

每个 Region 至少包含：

- 蛋白链和残基编号；
- 是否连续；
- 几何/结构类型；
- 与其他区域的空间关系；
- 置信度。

推荐的几何/结构类型：

- `core`：内部核心；
- `surface_patch`：表面斑块；
- `pocket`：局部凹陷或口袋；
- `groove`：沟槽；
- `channel`：通道或孔道；
- `interface`：分子界面；
- `connector`：连接两个结构单元的区域；
- `disordered_region`：结构中未解析、低置信度或明显无序的区域。

`active_site`、`binding_site`、`allosteric_site` 不建议作为 Region 类型，因为它们已经是功能解释，而不是纯结构事实。

### 4.2 `PROPERTY`：四个最小属性轴

1. `geometry`：凹/凸、深/浅、封闭/开放、狭长/宽阔等；
2. `chemistry`：电荷、极性、疏水性、芳香性、酸碱性、金属配位倾向等；
3. `accessibility`：暴露、部分埋藏、埋藏、可进入性、空间门控等；
4. `topology`：连续/不连续、域边界、内部/末端、连接关系等。

二级结构、局部柔性和结构置信度可以作为属性字段，但不必增加新的顶层语义类别。由于推理输入不包含动态信息，模型不应把静态结构代理直接说成“该区域一定高度柔性”。

### 4.3 `RELATION`：只保留五种结构关系

- `contacts(R_i, R_j)`：空间接触；
- `adjacent_to(R_i, R_j)`：几何上相邻；
- `encloses(R_i, R_j)`：一个区域包围或形成另一个区域的边界；
- `part_of(R_i, R_j)`：区域从属于更大的结构单元；
- `connects(R_i, R_j)`：连接两个结构单元。

距离、接触面积、方向性、残基重叠等作为数值或属性字段，不额外扩张谓词集合。`couples` 属于功能/动态解释，不放入 Level 1。

---

## 5. Instruction 如何决定输出

### 5.1 Instruction 是自由文本接口

用户不需要学习固定查询语言，例如：

- “找出支持带磷酸基团分子结合的局部结构，并说明依据。”
- “哪些区域可能参与两个构象状态之间的转换？”
- “描述这个蛋白最主要的局部结构和分子能力。”
- “只返回与表面相互作用有关的语义。”

模型内部可以隐式地把 instruction 解析成查询，但对外仍保留自然语言接口。

### 5.2 输出是稀疏语义子图

模型只返回当前问题相关的局部语义，而不是默认描述整个蛋白。

- 具体 instruction：只返回匹配的 Region、Level 1 事实和 Level 2 affordance；
- 开放 instruction：自动发现一组主要的 Level 1/Level 2 语义，并按重要性排序；
- “描述完备”指对当前 query 完备，不指列出蛋白的全部知识。

### 5.3 可以多次调用 Protein VLM

上层 LLM 可以针对同一个蛋白发起多次、互补的查询：

1. 第一次：概览蛋白的主要结构区域和分子能力；
2. 第二次：围绕 ATP、磷酸基团、金属离子或另一个蛋白伙伴，查询对应的结构特征；
3. 第三次：查询可能的区域耦合或状态转换线索。

每次返回的 Region ID 和残基坐标保持稳定，LLM 可以合并多次结果。若要真正理解 ATP 本身的结构或化学，应由 LLM 调用分子知识/分子模型；Protein VLM 只判断当前蛋白是否提供与该特征匹配的局部 affordance。

例如，Protein VLM 应返回：

> “Region R1 支持与带磷酸基团、带负电的分子特征发生关联。”

而不是在没有直接证据时直接返回：

> “该蛋白结合 ATP。”

---

## 6. 模型 formulation

### 6.1 推荐的分解

```text
single protein sequence + structure
              │
              ▼
        Protein Encoder
              │ H_P
              ├──────────────┐
              ▼              │
     Level 1 Structural      │
         Grounder            │
              │ Z1           │
              └──────┬───────┘
                     ▼
       Level 2 Affordance Grounder
             (direct access to H_P
              and interpretable Z1)
                     │ Z2
                     ▼
           instruction-conditioned
             text / structured renderer
                     │
                     ▼
                   output
```

数学形式为：

$$
H_P = \operatorname{ProteinEncoder}_\theta(S, X)
$$

$$
Z_1 = \operatorname{StructuralGrounder}_\theta(H_P, I)
$$

$$
Z_2 = \operatorname{AffordanceGrounder}_\theta(H_P, Z_1, I)
$$

$$
Y = \operatorname{Renderer}_\theta(Z_1, Z_2, I)
$$

这里的 $I$ 是自由文本 instruction。Level 2 同时依赖 Level 1 和蛋白表示 $H_P$：

- 依赖 $Z_1$，保证每条能力声明都有可解释的结构依据；
- 直接访问 $H_P$，避免 Level 1 的离散化造成信息瓶颈。

### 6.2 训练目标的最小分解

可以把训练目标写成几类约束的组合：

$$
\mathcal{L} =
\lambda_1\mathcal{L}_{\text{region}}
+\lambda_2\mathcal{L}_{\text{fact}}
+\lambda_3\mathcal{L}_{\text{affordance}}
+\lambda_4\mathcal{L}_{\text{faithfulness}}
+\lambda_5\mathcal{L}_{\text{instruction}}
+\lambda_6\mathcal{L}_{\text{sparsity}}
$$

- `region`：残基区域识别、边界和结构类型；
- `fact`：Level 1 几何、化学、可及性和拓扑事实；
- `affordance`：Level 2 三类 `supports_*` 语义；
- `faithfulness`：文本中的每条声明都能回指结构证据；
- `instruction`：只响应 instruction 要求的内容；
- `sparsity`：减少无关区域和无关语义。

这不是要求每一项都必须使用独立 head，而是明确训练时必须同时约束“说什么”“指哪里”“为什么能这么说”和“哪些内容不要说”。

### 6.3 文本不是唯一监督形式

最稳妥的训练样本包含两部分：

1. 规范化的结构化语义图；
2. 根据 instruction 渲染出的自然语言文本。

结构化图用于 grounding、组合和一致性训练；文本用于对接 LLM、学习表达方式和处理开放式 instruction。模型可以最终只暴露文本接口，但内部应保留结构化中间表示。

---

## 7. 数据如何构建：把不同知识渠道蒸馏到同一套原子语义

### 7.1 统一标签记录

所有来源最终都转成同一种 claim 记录，而不是为每个数据库保留一套特殊标签：

```text
protein_id
structure_id / state_id
level: 1 or 2
predicate
participants / target feature
residue anchors
region geometry type
attributes
condition / context
evidence tier
confidence
provenance
conflict group
```

这样可以把实验注释、结构计算、进化信号和 PLM 教师放在同一个蒸馏框架中，同时保留它们的可信度差异。

### 7.2 数据来源与用途

| 渠道 | 代表来源 | 主要蒸馏内容 | 在训练中的角色 |
|---|---|---|---|
| 人工整理的功能注释 | [UniProt](https://www.uniprot.org/help/sequence_annotation)、[InterPro](https://www.ebi.ac.uk/interpro/)、Pfam、PROSITE | 已知功能区域、修饰位点、跨膜区、结构域 | 高价值 Level 1/2 标签，需映射到具体结构 |
| 催化与机制数据库 | [M-CSA](https://www.ebi.ac.uk/thornton-srv/m-csa/download/)、Catalytic Site Atlas | 催化残基、反应参与区域、机制证据 | 高可信机制标签 |
| 蛋白结构 | [PDB](https://www.rcsb.org/)、wwPDB、[PDBe-KB](https://www.ebi.ac.uk/pdbe/pdbe-kb/) | pocket、interface、channel、domain、几何和化学环境 | Level 1 主数据来源 |
| 结构-序列映射 | [SIFTS](https://www.ebi.ac.uk/pdbe/docs/sifts/) | UniProt、PDB 残基坐标和链映射 | 保证 grounding 坐标一致 |
| 配体与复合物 | BioLiP2、PDB ligand records、[ChEBI](https://www.ebi.ac.uk/chebi/) | 接触残基、配体化学特征、apo/holo 对比 | `supports_association` 的正例和上下文 |
| 无序与短线性基序 | [DisProt](https://disprot.org/)、ELM | 无序区域、短基序、条件依赖 | 表面/无序/调控相关语义 |
| MSA 和进化 | UniRef、UniClust、[MUSCLE/HH-suite 生态](https://www.ebi.ac.uk/Tools/msa/) | 保守性、亚家族特异性、协同变化 | 离线软标签或教师信号，不作输入 |
| PLM | ESM、ProtT5、Ankh 等 | masked marginal、残基重要性、pair dependency、attention rollout | 候选区域发现和弱监督，不视为真值 |
| 突变与扰动 | [MaveDB](https://mavedb.org/docs/mavedb/index.html)、[ProteinGym](https://proteingym.org/)、DMS、alanine scan | 残基对稳定性、结合、活性或表达的影响 | 反事实/因果验证和区域边界修正 |
| 结合与动力学 | [BindingDB](https://www.bindingdb.org/)、ChEMBL、PDBbind、[SABIO-RK](https://sabio.bioquant.uni-heidelberg.de/)、BRENDA | 亲和力、底物/抑制剂、速率、条件 | Level 2 证据和评估，不作推理输入 |
| 蛋白互作 | [IntAct](https://www.ebi.ac.uk/intact/)、BioGRID、文献复合物 | 界面、伙伴、条件性关联 | interface 与 association 标签 |
| 动态与生物物理实验 | HDX-MS、NMR、cryo-EM 多状态、FRET/DEER、交联质谱 | 状态变化、保护区、构象耦合 | `supports_state_transition/coupling` 的离线教师 |
| 文献和补充材料 | PubMed、文章图表、结构论文 | 机制描述、实验条件、负结果和冲突 | 通过人工/LLM 抽取后进入证据层 |
| 物理计算与设计 | docking、MD、能量分解、蛋白设计数据 | 几何候选、接触概率、反事实样本 | Bronze 级弱监督或 hard negative |

### 7.3 推荐的构建流水线

#### 第一步：统一蛋白和结构坐标

把序列、PDB/mmCIF 链、UniProt 编号、插入码、缺失残基和结构状态统一起来。所有最终样本都必须能把语义回指到明确的 `chain:residue` 集合。

#### 第二步：从结构生成候选 Region

结合表面暴露、二级结构、几何凹陷、残基接触图、局部化学环境和结构域边界，生成候选 `core`、`surface_patch`、`pocket`、`groove`、`channel`、`interface`、`connector` 等区域。

候选区域可以重叠，也可以不连续；不要强迫所有残基被分配到某个区域。

#### 第三步：生成 Level 1 标签

从结构计算和人工注释抽取：

- Region 的几何类型；
- 四个属性轴；
- 五种结构关系；
- 接触残基、距离、面积、方向和置信度。

#### 第四步：生成 Level 2 标签

将已知配体、复合物、催化注释、突变影响和状态对比，转成三类 `supports_*` claim。目标特征优先写成可泛化的分子特征，例如：

- 带磷酸基团/负电荷的分子特征；
- 金属离子配位特征；
- 疏水芳香基团；
- 蛋白-蛋白界面特征。

只有在证据足够直接、且 instruction 明确要求时，才把泛化特征提升为具体分子名称。

#### 第五步：用 MSA、PLM、动力学和突变做离线蒸馏

这些来源的正确用法是：

- 发现候选区域；
- 提供软标签或排序先验；
- 产生正负/反事实样本；
- 检查结构语义是否与进化、扰动和动态证据一致。

它们不应偷偷进入推理输入，否则模型不再是“序列 + 结构翻译器”，也难以判断语义究竟来自结构还是外部检索。

#### 第六步：处理证据、冲突和不确定性

建议使用证据等级：

- `E0`：直接因果实验，例如定点突变、机制实验；
- `E1`：直接结构/复合物观察；
- `E2`：人工整理数据库或专家注释；
- `E3`：进化、MSA、家族迁移；
- `E4`：PLM、物理计算或其他模型推断。

不同来源冲突时不要简单覆盖。保留条件、来源和冲突组，让模型学习“在什么证据下支持什么 claim”。

#### 第七步：由语义图生成 instruction 数据

同一个蛋白样本可以生成多种 instruction：

- 区域定位型：找出相关残基；
- 结构事实型：说明几何和化学依据；
- affordance 型：判断是否支持某类分子事件；
- 对比型：比较两个区域或两个结构状态；
- 开放发现型：列出主要 Level 1/2 语义；
- 负向型：说明没有足够结构证据支持的结论。

每条自然语言答案都应能还原到规范化语义图，避免只存一段不可验证的 caption。

---

## 8. 一个完整例子

### 输入

```text
Instruction:
找出支持带磷酸基团分子结合的局部结构，并说明结构依据。

Protein modality:
单个蛋白的序列 S + 静态结构 X
```

### Protein VLM 的理想输出

```text
Level 1
R1 = A:20-31, A:87, A:114-119
类型：pocket + surface_patch
事实：局部凹陷、部分封闭；内壁含多个极性/正电残基；R1 内部残基空间接近。

Level 2
supports_association(
  target = 带磷酸基团、带负电的分子特征,
  anchors = R1,
  basis = [凹陷几何, 正/极性化学环境, 可进入性]
)

边界：这些结构事实支持该类分子特征的关联可能性，不能仅凭此输出断言“已确认结合 ATP”。
```

### 上层 LLM 的组合方式

LLM 可以先查询蛋白的主要结构能力，再查询“哪些区域匹配磷酸基团特征”，最后结合 ATP 的外部化学知识进行解释。最终回答可以更高层，但每个结论都能回到 R1 和相应的结构事实。

这就是两层解耦的价值：

- Protein VLM 保持忠实、局部和可验证；
- LLM 获得灵活的对象映射、机制推理和自然语言表达能力。

---

## 9. 评估应该测什么

不要只测生成文本是否“像功能描述”，至少要分开测：

1. **Region grounding**：残基集合、边界、结构类型和空间关系是否正确；
2. **Level 1 factuality**：几何、化学、可及性和拓扑描述是否被输入结构支持；
3. **Level 2 calibration**：`supports_*` 是否过度断言，能否区分支持与证实；
4. **Instruction faithfulness**：是否只返回当前问题相关的语义；
5. **Compositionality**：不同 instruction、多次调用和不同分子特征能否组合；
6. **Counterfactual sensitivity**：局部突变或结构变化后，相关语义是否随之改变；
7. **Evidence consistency**：输出置信度是否与 E0-E4 证据等级一致。

文本相似度可以作为辅助指标，但不能替代 grounding 和结构忠实性评估。

---

## 10. 当前已经确定的设计边界

### 已确定

- 项目目标是 Protein VLM，而不是蛋白功能分类器；
- 推理输入只有单个蛋白的序列、静态结构和自由文本 instruction；
- 输出是 instruction 条件下的稀疏、结构化、可组合语义；
- Level 1 与 Level 2 同时输出；
- Level 2 采用 `supports_association`、`supports_state_transition`、`supports_coupling` 三类最小元能力；
- Region 必须带残基坐标和几何/结构类型；
- 每条 Level 2 语义必须能回指到 Level 1 区域；
- Level 3 的具体生物学功能和 effect 交给 LLM；
- MSA、动态、PLM、突变和动力学数据只用于离线构建标签、教师信号和评估；
- instruction 可以触发多次 Protein VLM 调用，结果通过稳定 Region ID 合并。

### 仍可单独讨论的实现问题

- Region 候选生成采用哪些几何算法和粒度；
- 三类 Level 2 下的二级标签词表；
- 结构化输出使用 JSON、图序列还是特殊 token；
- 不同证据等级的损失权重和冲突处理；
- 如何构造足够多的 hard negative 和反事实样本；
- 开放 instruction 下“主要语义”的排序标准。

这些问题影响训练和评估，但不需要改变项目的核心目标或最小语义接口。

---

## 11. 一句话版本

> Protein VLM 要做的不是替 LLM 说出蛋白“是什么功能”，而是把单个蛋白的序列—结构翻译成一组**只与当前问题相关、明确指向残基区域、描述结构事实及其分子 affordance、可被 LLM 继续组合推理的原子语义单元**。
