# BioAgent：面向生命科学的 AI4Science 研究智能体

> **一句话定位**：BioAgent 是一个面向生命科学研究者的 AI 研究智能体平台，通过多模态科学数据可视化、可复现的研究流程沉淀和跨领域价值对齐，将 AI 从"聊天助手"升级为"可信赖的科学研究伙伴"。

---

## 当前实现状态（2026-04-25）

BioAgent 已完成从“内置 Scenario preset + runtime override”到可组合 Scenario Package 系统的第一阶段迁移：

- Element Registry 已覆盖 skills、tools、artifact schemas、UI components、view presets、role policies 和 failure policies。
- Scenario/Skill/UI Compiler 已能从描述或手动 selection 生成 `ScenarioIR`、`SkillPlan`、`UIPlan`。
- Validation Gate、runtime smoke hook、Scenario Quality Report 和 workspace package API 已接入。
- Scenario Builder 可在 workbench 内选择 elements、预览 JSON contract、保存 draft、发布 workspace package。
- Scenario Library 可列出、打开、复制和归档 workspace packages。
- 官方预编译 packages 已作为 Package Catalog 暴露，默认不导入 workspace；用户按需导入后才进入 Scenario Library，也可直接导出为可分发 package JSON。
- 每次运行可记录 `scenarioPackageRef`、`skillPlanRef`、`uiPlanRef`、`runtimeProfileId` 和 route decision。

下一阶段重点是产品化硬化：浏览器端到端 smoke、workspace scenario 原生路由、build/code splitting、3Dmol 风险治理、quality gate UI 和 runtime diagnostics。

---

## 一、我们要解决什么问题

生命科学正在经历数据爆炸。PubMed 上有超过 3800 万篇论文，UniProt 收录了超过 2.5 亿条蛋白质序列，单细胞测序一次实验就能产生数十 GB 的数据。与此同时，研究者的时间和认知带宽并没有同步增长。

现有的 AI 工具——无论是通用聊天机器人还是 FutureHouse、Coscientist 等专业系统——已经证明了 AI 在文献检索、假设生成方面的能力。但它们普遍存在四个缺口：

**缺口一：交互界面与科学数据脱节。** 蛋白质结构需要 3D 交互查看器，基因组数据需要专业浏览器，通路分析需要网络图。然而大多数 AI agent 只能输出 markdown 文本和静态图片，研究者不得不在 agent 和各种专业软件之间反复切换。

**缺口二：结论不可复现。** LLM 的输出本质上是非确定性的，但科学结论必须可复现。现有 agent 很少将推理过程中调用的工具、参数、数据版本系统性地沉淀下来，导致"agent 说的结论"无法被独立验证。

**缺口三：计算与实验之间的断裂。** 生命科学不是纯计算学科。agent 生成的假设最终要回到湿实验室验证，实验结果又要反馈回计算分析。目前没有 agent 系统良好地支持这个"干-湿"闭环。

**缺口四：AI 专家与生物专家之间的认知鸿沟。** 这是被严重低估的瓶颈。AI 专家说"数据量不够训练一个稳健的模型"，生物学家理解为"AI 不行"；生物学家说"这个表型有 penetrance 问题"，AI 专家不知道这意味着标签噪声有多大。双方对 AI 的能力边界、数据的支撑力度、以及"什么样的结论才算有意义"缺乏共识。这种错位不是靠多开几次会就能解决的——它需要一个结构化的对齐工具。

BioAgent 的目标是同时弥合这四个缺口。

---

## 二、核心设计原则

### 2.1 Scenario-first 的产品形态

BioAgent 的最终形态不是“为每类 Agent 设计一个页面”，而是一个统一的 **Scenario workbench**。用户可以选择内置场景，也可以提供一份描述研究场景的 markdown。系统把场景描述编译成机器可读的 `ScenarioSpec`，再进入聊天、运行、展示和复现流程。

**Scenario 是一等公民**：它描述研究目标、输入契约、输出 artifact schema、可用 skill domain、默认 UI 组件集合、scope declaration、失败边界和权限策略。文献证据评估、结构探索、组学差异分析、生物医学知识图谱只是内置 Scenario preset，不是四套页面。

**UI 不跟 Agent 走，UI 跟 artifact 和 UIManifest 走**：所有场景共享同一个聊天工作台、结果区、证据区、ExecutionUnit 区和研究记录区。差异只来自 `ScenarioSpec.defaultSlots`、runtime artifact schema 和 LLM 输出的 `UIManifest`。结构场景可以选择 `molecule-viewer`，组学场景可以选择 `volcano-plot/heatmap-viewer/umap-viewer`，未知数据先进入 `unknown-artifact-inspector`。

**LLM 只生成结构化调用，不生成页面**：LLM 可以返回 `artifacts`、`claims`、`executionUnits` 和 `uiManifest`，并通过 `colorBy`、`splitBy`、`overlayBy`、`facetBy`、`compareWith`、`highlightSelection` 等 View Composition 参数调整展示。它不能直接污染主 UI 代码。只有标准组件、View Composition 和通用 inspector 都无法表达时，才允许生成 sandboxed UI plugin。

构建路径：

```text
Phase 1：内置 Scenario presets
  literature-evidence-review
  structure-exploration
  omics-differential-exploration
  biomedical-knowledge-graph

Phase 2：用户导入 scenario.md
  用户描述场景目标、输入输出、边界和期望视图
  BioAgent 编译 ScenarioSpec
  复用同一个 Scenario workbench

Phase 3：场景编排与沉淀
  多个 Scenario 通过 artifact handoff 串联
  高频成功任务沉淀为 skill
  高频展示模式沉淀为标准组件或 View Composition preset
```

核心链路：

```text
scenario.md / built-in preset
  → ScenarioSpec
  → skill registry / workspace task / AgentServer repair
  → Artifact + ExecutionUnit + claims + UIManifest
  → component registry 渲染
```

#### 从 Scenario preset 到可发布 Scenario Package

为了让 BioAgent 扩展到任意生命科学场景，Scenario 不能长期停留在“内置模板 + 少量覆盖配置”的形态。更合理的长期形态是：用户用自然语言描述研究服务，系统提供可组合元素（skills、tools、artifact schema、UI components、role views、scope policies），用户可以手动选择或让系统自动推荐，然后通过 **Scenario Compiler** 编译成一个可验证、可版本化、可发布的 Scenario Package。

Scenario Package 是一个稳定运行单元，而不是一次性聊天上下文：

```text
scenario/
  scenario.json        # 目标、输入契约、输出 artifact、scope、权限和失败边界
  skill-plan.json      # skills、tools、runtime、fallback 和自愈策略
  ui-plan.json         # artifact 到组件、布局、交互和角色视图的映射
  tests.json           # 最小 smoke cases 和 schema validation cases
  versions.json        # 发布历史、兼容性和迁移说明
```

这意味着 BioAgent 的可扩展性来自“编译出稳定契约”，而不是为每个新场景写一套页面。内置四个 Scenario 只是官方预编译 package catalog 中的示例包；它们不应该默认占用用户 workspace，而应像真实 package 一样支持按需导入、导出、复制、版本化和归档。用户自定义 Scenario、团队共享 Scenario 和未来 marketplace 中的 Scenario 都应遵守同一套 package contract。

编译链路应明确分层：

```text
用户需求描述
  → Scenario Compiler
      生成 ScenarioIR：研究目标、输入输出、scope、角色、权限
  → Skill Compiler
      生成 SkillIR / SkillPlan：skills、tools、执行图、capability requirements、fallback
  → UI Compiler
      生成 UIIR / UIPlan：artifact schema、组件 slots、layout、interactions、role views
  → Validation Gate
      校验输入、schema、producer/consumer、runtime、fallback、smoke test
  → Published Scenario Package
      以固定版本稳定运行
```

关键原则是：**动态发生在编译期，稳定发生在运行期**。用户可以自由描述任何场景，但发布后的服务页面必须绑定到某个已验证版本，例如 `crispr-base-editing-review@1.0.0`。后续修改输入契约、skill 选择、UI layout 或权限策略时，应生成新版本，旧 run 继续按旧 contract 复现。

### 2.2 固定模板为主，动态生成为辅的混合 UI 架构

我们借鉴 A2UI（Agent-to-User Interface）的核心理念——让 agent 根据研究上下文动态编排界面，但拒绝让 LLM 从零生成 UI 代码。具体做法是：

**固定组件层（~90%）**：预构建一套生命科学专用的可视化组件库，覆盖核心数据模态：

| 数据模态 | 组件 | 底层技术 |
|---------|------|---------|
| 蛋白质/小分子 3D 结构 | 分子查看器 | Mol* / 3Dmol.js |
| DNA/RNA/蛋白质序列 | 序列比对浏览器 | MSAViewer / IGV.js |
| 基因表达 / 组学数据 | 热图 / 火山图 / PCA | D3.js / Plotly |
| 蛋白互作 / 信号通路 | 网络图 | Cytoscape.js |
| 显微镜 / 病理影像 | 影像查看器 | OpenSeadragon |
| 实验数据 | 交互式数据表 | AG Grid |
| 科学文献 | 文献卡片 / PDF 预览 | PDF.js |
| 实验方案 | Protocol 编辑器 | 自研组件 |

这些组件是经过充分测试和优化的模板，agent 只需要发送一条轻量 JSON 指令（"调用分子查看器，传入 PDB ID: 7BZ5，高亮残基 142-158"），不消耗额外的 LLM token。

由于所有 Scenario 的界面框架高度一致（对话区 + 参数区 + 结果区 + 记录区），新增一个 Scenario 的 UI 成本极低——只需要注册该 Scenario 需要的数据展示组件到组件库中，其余框架代码完全复用。

**View Composition 层（~8%）**：展示层的“无穷性”和工具层不同。许多新需求不是新计算，而是已有组件的新组合，例如 `colorBy`、`splitBy`、`overlayBy`、`facetBy`、`compareWith`、`highlightSelection`、`syncViewport`。BioAgent 应优先用声明式 View Composition 描述这些变化，而不是立刻生成新 UI 代码。agent 根据当前研究阶段和数据类型，决定调用哪些组件、如何排列、传入什么参数。这部分的 token 消耗极低，本质上是 JSON 组件编排和参数配置。

**动态生成层（~2%）**：仅当标准组件、View Composition 和通用 inspector 都无法表达需求时，才允许生成临时 UI plugin。触发条件必须显式记录：为什么现有组件不能满足、需要哪些输入 artifact、输出 UI contract 是什么、如何 sandbox、如何回滚。动态生成不是默认路径，也不能成为绕过组件设计的捷径。

#### UI Compiler：UI as Plan, not UI as Code

UI 也应该像 skill 一样被编译，但常规产物不是 React 代码，而是稳定的 `UIPlan` / `UIManifest`。UI Compiler 的输入包括用户展示意图、Skill 输出的 artifact schema、已注册组件能力、View Composition 参数、角色视图、权限和稳定服务页面要求。输出是一份可校验的展示计划：

```json
{
  "slots": [
    {
      "componentId": "paper-card-list",
      "artifactRef": "paper-list",
      "layout": { "mode": "stacked" },
      "roleVisibility": ["experimental-biologist", "pi"]
    },
    {
      "componentId": "molecule-viewer",
      "artifactRef": "structure-summary",
      "encoding": {
        "colorBy": "plddt",
        "highlightSelection": "active-site"
      }
    }
  ],
  "interactions": [
    {
      "from": "paper-card-list",
      "event": "select-target",
      "to": "molecule-viewer",
      "action": "highlight"
    }
  ],
  "fallbacks": {
    "unknownArtifact": "unknown-artifact-inspector",
    "missingData": "empty-state-with-reason"
  }
}
```

每个 UI component 都应有 manifest，而不是只存在于 React registry 中：

- `componentId` / `label` / `description`
- `acceptsArtifactTypes`：可渲染哪些 artifact schema
- `requiredFields`：最小字段要求，例如 `points.gene`、`points.logFC`、`points.fdr`
- `viewParams`：支持哪些 View Composition 参数
- `interactionEvents`：能发出和接收哪些交互事件
- `roleDefaults`：不同角色下的默认可见性和优先级
- `fallback`：不能满足字段或数据为空时的降级组件

UI Compiler 必须有 fallback ladder：

```text
specialized scientific component
  → generic visualization component
  → data-table
  → JSON/file/log inspector
  → empty state with explicit reason
```

稳定 UI 的标准不是“所有情况都渲染成精美图表”，而是任何合法 artifact 都有可解释的展示路径，任何缺失字段都能给出明确原因，不把空数据、demo 数据或错误状态伪装成科学结论。

### 2.3 科学推理的可溯源性与置信度量化

科学不接受"因为 AI 说的"作为论据。BioAgent 的每一个输出都必须可追溯到具体的证据来源，并附带显式的置信度标注。

**文献溯源**：agent 的每个事实性陈述都关联到具体的论文、图表和段落。UI 支持一键跳转到原文。

**推理链透明**：agent 的思考过程——从文献检索到假设形成到工具调用——以可展开的步骤链形式呈现。用户可以在任意节点追问"为什么这么判断"或"还有其他可能性吗"。

**矛盾证据并排展示**：当文献中存在相互矛盾的结论时，agent 不会只给出一个"综合判断"，而是将正反证据结构化地呈现出来，让研究者自行权衡。

**置信度量化**：BioAgent 对自身输出的每一层结论都附带显式的置信度标注，而非让研究者自行猜测"这个结论有多靠谱"。具体分为三个维度：

- *文献证据分级*：采用类似循证医学的证据金字塔，将支撑每个结论的文献自动分级——Meta 分析/系统综述 > RCT > 队列研究 > 病例对照 > 案例报告 > 专家意见/计算预测。UI 中以可视化标签（如彩色徽标或星级）直观呈现，研究者一眼即知某个结论背后的证据有多"硬"。
- *计算结果的统计置信度*：工具链产出的数值结果（p-value、FDR、结合亲和力预测、结构预测的 pLDDT 分数等）以原始数值+置信区间的形式展示，而非被 agent 消化为模糊的自然语言描述。例如，AlphaFold 的预测不会只说"结构可信"，而是展示逐残基的 pLDDT 色谱图，让研究者自己判断哪些区域可信、哪些是低置信度的无序区。
- *假设 vs 事实的显式区分*：agent 输出中，已被实验验证的事实、有文献支撑但未经当前实验验证的推断、以及 agent 基于模式推理提出的纯假设，在 UI 层面以不同的视觉标记（如颜色编码或边框样式）明确区分。研究者永远不会把 agent 的一个猜测误认为是已证实的结论。

置信度不是一个静态标签，但也不能靠全局重算或模糊直觉更新。BioAgent 需要维护显式的 **belief dependency graph**：每个结论记录它依赖的文献、实验结果、计算 artifact、参数、前提假设和反证。当新的实验结果或文献进入系统时，只更新受依赖边影响的结论，并在研究时间线中记录传播路径、更新原因和未更新的边界。

### 2.4 可复现性：从聊天记录到可执行 Pipeline

这是 BioAgent 与通用 AI agent 最根本的差异。我们的核心原则是：**LLM 负责决策（可追溯），工具执行负责计算（可复现）。**

架构上，agent 的每次科学操作不是直接执行，而是先生成一个确定性的**执行单元（Execution Unit）**，再交给运行时执行：

```
研究者提问 → LLM 推理决策 → 生成 Execution Unit → 执行引擎运行 → 结果归档
                (可追溯)     (代码+参数+环境)      (确定性)      (版本化)
```

每个 Execution Unit 是自包含的，包含：

- **完整代码**：可独立运行的脚本或 notebook cell
- **参数锁定**：所有参数（含随机种子）的精确记录
- **环境定义**：软件版本、依赖关系的锁定（Docker 镜像哈希或 conda environment.yml）
- **数据指纹**：输入数据的校验和（SHA-256）及数据库版本号（如 UniProt 2026.03）

一个完整的研究过程最终沉淀为三份制品：

1. **决策链日志**：LLM 推理的完整记录（模型版本、prompt、temperature、输出），可追溯但不可精确重放
2. **执行 Pipeline**：有序的 Execution Units 组成的 DAG（有向无环图），任何人拿到就能独立运行并得到相同结果
3. **数据版本清单**：所有引用的数据库、文件及其版本的完整清单

研究者可以一键将整个研究过程导出为可执行的 Snakemake / Nextflow pipeline 或 Jupyter notebook，附带完整的环境定义，供同行审稿或合作者验证。

### 2.5 Python-first 科学任务运行时与自愈边界

BioAgent 的实现语言边界必须服务于科学可复现性，而不是被 Web 技术栈牵着走。**TypeScript 是产品壳和协议层，不是默认的科学任务语言。** 生命科学任务代码应尽量生成在 workspace 内，并以研究者和 AI scientist 更容易理解、修改、复现的形式存在。

明确分层如下：

| 层级 | 首选语言/形态 | 职责边界 |
|------|--------------|---------|
| Web UI / 动态结果区 | TypeScript / React | 组件 registry、UIManifest 渲染、交互、状态展示 |
| Workspace writer / 协议壳 | TypeScript | 文件 I/O、session/artifact snapshot、task runner 调度、AgentServer bridge |
| 科学任务代码 | Python 优先 | 数据下载、解析、统计分析、结构/组学/知识库任务、artifact JSON 写出 |
| 生态或高性能任务 | R / C/C++ / Rust / Julia / Shell / WASM 等 | 当科学生态或性能确实需要时使用，并在 ExecutionUnit 中记录选择理由 |
| 通用智能与自愈 | AgentServer | 生成任务代码、读取失败日志、修改代码、重跑、在无法完成时解释原因 |

这意味着：结构探索 Scenario 不应该把“查最新 PDB、下载 mmCIF、解析原子坐标”长期写死在 TypeScript 分支里；组学差异分析 Scenario 不应该把 Scanpy/DESeq2/edgeR 的完整分析流程长期藏在 workspace server 源码里。正确形态是：

```
用户问题
  → BioAgent 选择 ScenarioSpec、skill domain 与 artifact schema
  → AgentServer / task generator 在 workspace 写入任务代码
  → workspace runner 执行任务代码
  → 任务代码写出 artifact、日志、ExecutionUnit
  → UI 根据 artifact 渲染专业组件
  → 若失败，AgentServer 读取代码+日志+反馈并修改任务代码重跑
```

任务代码必须成为研究产物的一部分，例如：

```
.bioagent/tasks/structure-<run>.py
.bioagent/task-inputs/structure-<run>.json
.bioagent/task-results/structure-<run>.json
.bioagent/tasks/omics_differential_scanpy.py
.bioagent/artifacts/structure-summary.json
.bioagent/logs/structure-<run>.stdout.log
.bioagent/logs/structure-<run>.stderr.log
.bioagent/runs/run-*.json
```

当前结构探索 Scenario 已按此边界实现第一阶段：BioAgent workspace service 只负责把结构任务模板复制为 workspace-local Python artifact、传入 input JSON、执行 Python、读取 output JSON；RCSB 最新结构搜索、RCSB/AlphaFold 下载、PDB/mmCIF 原子坐标解析、`atomCoordinates` 生成均在 `.bioagent/tasks/structure-<run>.py` 内完成。后续文献、知识库和组学任务应沿用同一模式迁移，避免把新的科学逻辑继续写入 TypeScript 分支。

每个 Execution Unit 至少记录：

- `language`：Python / R / Rust / Shell 等
- `codeRef`：workspace 内任务代码路径
- `entrypoint`：可执行入口
- `environmentRef`：conda/venv/container/系统依赖定义
- `inputs` 与 `outputs`：输入文件、数据库 URL、输出 artifact 路径
- `stdoutRef` / `stderrRef`：完整执行日志
- `attempt` / `parentAttempt`：自愈重试关系
- `selfHealReason`：为什么修改代码或重跑

**失败语义必须诚实。** 如果数据库不可访问、依赖缺失、任务代码报错、artifact schema 不满足 UI 需要，BioAgent 必须展示 failed/empty state 和明确原因，而不是用 demo、默认 PDB、默认基因集、record-only 草案冒充成功。record-only 只允许作为明确标注的草稿或离线占位，不能驱动“已完成”的科学结论。

**允许非 Python，但必须有理由。** 例如 DESeq2/edgeR 使用 R 是因为生态原生；结构解析中的高性能几何计算可以使用 C++/Rust；大规模矩阵或 GPU 任务可以使用专门二进制、CUDA 或 WASM。选择这些语言时，任务代码仍必须在 workspace 中有清晰入口，ExecutionUnit 必须说明语言选择、环境与复现方式。

### 2.6 Skill-growing Runtime：从写死工具到会生长的工具系统

BioAgent 面向的生命科学工具空间几乎是无限的：数据库会更新，分析流程会变化，研究者会不断提出新的任务。如果把每个工具、每个数据库、每个分析分支都写进一个 TypeScript 文件，系统很快会变成不可维护的固定工具箱。因此 BioAgent 的长期目标不是“内置更多工具”，而是成为一个会发现、生成、复用和沉淀工具的科学工作台。

当前前端场景契约入口是 `ui/src/scenarioSpecs.ts`，workspace runtime 入口是 `scripts/workspace-runtime-gateway.ts`。文献证据评估、结构探索、组学差异分析和生物医学知识图谱 Scenario 的可执行能力通过 seed skills 与 workspace-local task code 表达；gateway 只负责 skill matching、任务调度、artifact/log 收集、schema 校验和 AgentServer 自愈桥接，不承载具体科学逻辑。

需要区分两类“无穷性”：

- **工具/计算的无穷性**：通过 seed skills、用户安装 skills、workspace task code、AgentServer 自愈和 skill promotion 解决。
- **展示/交互的无穷性**：通过标准组件、View Composition、通用 inspector 和少量 sandboxed UI plugin 解决。

两者不能混在一个机制里。新增计算能力不应要求新增 UI 代码；新增展示组合也不应强行生成新科学任务。

#### 种子 skill 库与用户生成 skill 库

Skill-growing 不能从空白开始。系统需要显式区分：

- **Seed Skill Library**：由团队预构建、测试和维护，覆盖高频任务的 80%，例如 PubMed 检索、RCSB/AlphaFold 结构下载、基础差异表达、UniProt/ChEMBL 查询、常见图表导出。seed skill 是冷启动体验和安全边界的基础。
- **Stable Workspace Skill Library**：用户或团队明确安装到当前 workspace 的稳定 skill，位于 `.bioagent/skills/`，可以参与常规 skill matching，但仍不修改 seed/preinstalled 库。
- **Evolved Workspace Skill Library**：Agent 在完成工作、自愈和反思过程中产生的 skill，先进入 `.bioagent/skill-proposals/`，用户确认后才安装到 `.bioagent/evolved-skills/`。它必须与 seed skills、preinstalled skills 和 stable workspace skills 物理隔离，避免一次任务生成的代码污染原本稳定能力。

AgentServer 不是每次都从头写代码的万能兜底。它优先补齐 seed skills 覆盖不到的任务，或修复/泛化已有 task。

理想请求路径如下：

```
用户请求
  → BioAgent 收集当前 Scenario、workspace artifacts、历史上下文和 UI 状态
  → Skill Registry 检索 seed skills 与用户安装 skills
  → 若 skill 匹配：实例化 workspace task 并运行
  → 若无合适 skill：调用 AgentServer 探索、写代码、运行调试
  → task 输出 Artifact / ExecutionUnit / UIManifest / 日志
  → UI 按 artifact schema 动态展示
  → 若失败：AgentServer 读取 codeRef + logs + schema + 用户反馈并自愈重跑
  → 若任务成功或自愈成功：生成隔离的 skill proposal
  → 若任务高频成功且通过 review gate：用户确认后注册到 evolved skill 库
```

#### 自愈与自进化边界

自愈不是开发者手工修一个具体场景分支，而是 Agent 运行闭环的一部分。当 artifact contract、外部 API、依赖、schema 校验或用户目标暴露能力缺口时，系统应执行以下闭环：

1. 记录失败的 task code、input、output、stdout/stderr、schema errors 和 route decision。
2. 让 AgentServer 或等价 self-healing backend 读取这些证据，修改 workspace-local task code，而不是修改 seed/preinstalled skill。
3. 重跑任务并产出新的 ExecutionUnit，使用 `parentAttempt`、`selfHealReason`、`patchSummary`、`diffRef` 串联尝试历史。
4. 如果自愈后成功，生成 `SkillPromotionProposal`，但默认仍处于 `needs-user-confirmation`，安全 checklist 不自动通过。
5. 用户确认后，才把代码复制到 `.bioagent/evolved-skills/<skill-id>/`，并写入 promotion history。seed/preinstalled/stable skill 根目录不被修改。

这条边界保护了两件事：稳定能力不被动态代码污染；动态生成的能力仍能被复用、审计和逐步沉淀。

#### Skill 的定义

Skill 是被验证和泛化后的可复用任务能力。它可以是 Python 包、脚本模板、notebook、R pipeline、CLI wrapper、数据库 connector，也可以是一组 prompt、环境和 runner 约定。每个 skill 至少包含：

- `id` / `name` / `description`：它能解决什么研究问题
- `inputContract`：需要哪些参数、文件、artifact 或数据库
- `outputArtifactSchema`：会产出什么 artifact，UI 应如何理解
- `entrypoint`：实际运行入口，可以是 Python/R/Shell/CLI/API
- `environment`：依赖、venv/conda/container、外部工具和数据库要求
- `validationSmoke`：最小可验证任务，防止 skill 只是声明可用
- `examplePrompts`：可匹配的自然语言请求
- `promotionHistory`：这个 skill 是从哪些成功 workspace tasks 提炼而来

#### Skill Compiler：Skills as Code, Runtimes as Processors

受 SkVM “Skills as Code, LLMs as Processors” 思路启发，BioAgent 不应把 skill 仅仅看作 prompt、markdown 或脚本清单。Skill 应该先被编译成中间表示，再根据当前 runtime、模型、工具连接器和 workspace 环境生成可执行计划。

Skill 编译至少包含两阶段：

1. **AOT 编译（发布/安装阶段）**：分析 skill 的输入契约、输出 artifact、依赖工具、失败模式和可并行结构；绑定默认 runtime；生成 validation smoke；确定可降级路径。
2. **JIT 优化（运行阶段）**：根据实际运行日志、失败原因、耗时、token 成本和用户反馈，固化高频成功路径，重编译低效或易失败路径，并把稳定 task 提升为 reusable skill。

SkillIR 可以采用如下形态：

```json
{
  "skillId": "literature.pubmed_search",
  "intent": "Retrieve biomedical papers and emit paper-list artifact",
  "inputs": ["query", "retmax", "species"],
  "requiredCapabilities": [
    { "capability": "http-fetch", "level": "basic" },
    { "capability": "json-transform", "level": "deterministic" },
    { "capability": "artifact-emission", "level": "schema-checked" }
  ],
  "executionGraph": [
    { "node": "query-pubmed", "tool": "PubMed.eutils.esearch" },
    { "node": "fetch-summaries", "tool": "PubMed.eutils.esummary", "dependsOn": ["query-pubmed"] },
    { "node": "emit-artifact", "artifactType": "paper-list", "dependsOn": ["fetch-summaries"] }
  ],
  "artifactOutputs": ["paper-list"],
  "uiContracts": ["paper-card-list", "evidence-matrix"],
  "failureModes": ["network-unavailable", "empty-result", "schema-mismatch"]
}
```

这个 IR 让同一个 skill 可以被不同 harness 执行：本地 Python seed task、workspace-installed skill、SCP tool adapter、AgentServer 生成脚本或远程服务。运行时不再问“LLM 能不能理解这段 skill 文档”，而是问“当前 runtime profile 是否覆盖这个 SkillIR 所需能力”。

#### Capability Profile 与稳定调度

BioAgent 应维护 runtime / model / harness 的 capability profile，用于指导 Scenario Compiler 和 Skill Compiler 做选择，而不是假设所有后端能力等价。例如：

```yaml
workspace-python:
  deterministicExecution: high
  scientificCompute: high
  codeGeneration: none
  repair: none
  latency: low

agentserver-codex:
  codeGeneration: high
  repair: high
  filesystemOps: high
  deterministicExecution: medium
  latency: medium

scp-hub:
  externalTools: high
  inputStrictness: high
  deterministicExecution: medium
  latency: variable
```

Skill Compiler 根据 profile 选择执行路径。稳定性优先级应固定为：

```text
validated seed skill
  → installed workspace skill
  → compiled reusable task
  → AgentServer generated task
  → explicit unsupported / failed-with-reason
```

AgentServer 是生成、修复和泛化能力，不应成为每次运行的默认自由发挥路径。一个可发布 Scenario 必须能说明：哪些 task 是确定性执行，哪些依赖生成式后端，哪些失败会触发自愈，哪些条件下必须诚实返回 unsupported。

#### 脚本即工具

BioAgent 不应先问“系统里有没有这个固定工具”，而应先问“当前 workspace 能不能生成一个可运行、可复现、可审计的 task 来完成它”。当 AgentServer 写出的 task 成功完成任务时，这个脚本本身就是临时工具；当它被多次复用、失败率低、输入输出边界清楚时，再提升为 skill。

这让 BioAgent 的工具能力从静态枚举变成动态生长：

```
临时 task code
  → 成功运行并产生 artifact
  → 多次复用和自愈
  → 写入 .bioagent/skill-proposals
  → 总结 input/output/环境/验证/安全 checklist
  → 用户确认
  → 注册为 .bioagent/evolved-skills 中的隔离 skill
```

#### UI 的动态边界

UI 页面只是交互、状态和展示承载层，不应内置科学任务逻辑。它的动态性优先来自 artifact schema、UIManifest 和 View Composition：

1. 已知 schema 使用标准科学组件，例如 molecule viewer、paper list、volcano plot、network graph、data table。
2. 新展示需求优先通过 View Composition 参数表达，例如 `colorBy`、`splitBy`、`overlayBy`、`facetBy`、`compareWith`、`highlightSelection`。
3. 未知 schema 先使用通用 inspector，例如 JSON tree、表格、文件预览、日志查看、图片/PDF/HTML viewer。
4. 常见未知 schema 被多次使用后，再沉淀为标准组件或 skill 的可视化 contract。
5. 只有标准组件、View Composition 和 inspector 都不足时，才允许生成临时 UI plugin；plugin 必须 sandbox、版本化、可回滚，不能直接污染主 UI。

#### 研究范围声明

科学问题本身也是开放的。Phase 1/2 的Scenario 能力不能假装已经覆盖跨领域研究编排。每个 Agent 必须有显式 scope declaration：当前能独立完成什么、需要什么输入、不能完成什么、什么情况需要跨 Agent 手动串联或等待 Phase 3 编排层。

当用户提出跨越多个领域的复杂问题时，BioAgent 应诚实返回计划和边界，例如“该问题需要序列保守性、文献证据和 CRISPR 效率数据三条链路；当前 Phase 1 可分别执行这些子任务，但不会生成一个未经验证的巨型脚本冒充完整结论”。这和失败语义诚实同等重要。

因此，BioAgent 的长期形态不是“写死工具的生物应用”，而是 **Python-first、skill-growing、artifact-native 的科学工作台**。

#### Validation Gate：动态系统的稳定边界

Scenario、Skill 和 UI 都允许动态组合，但发布前必须通过 validation gate。没有 validation gate，系统越灵活越容易产生不可运行的“漂亮契约”。最小发布检查包括：

- input contract 是否完整，required 输入是否有 UI 表达和默认校验
- 每个 required artifact 是否有 producer，producer 是否能输出对应 schema
- 每个 UI slot 是否能消费对应 artifact，字段缺失时是否有 fallback
- 每个 skill 是否有 runtime profile 覆盖，外部 connector 是否配置完整
- 每个失败模式是否有明确用户文案和 recover action
- 至少一个 smoke test 能在目标 workspace/runtime 中跑通
- 发布版本是否冻结，旧 run 是否能绑定旧 contract 复现

失败也必须是一等产物：

```json
{
  "status": "failed-with-reason",
  "reason": "metadataRef is missing",
  "requiredInputs": ["matrix.csv", "metadata.csv"],
  "recoverActions": ["upload-file", "edit-input-contract"]
}
```

稳定运行不等于永远成功；稳定运行意味着系统永远不假成功，永远给出可诊断、可恢复、可审计的状态。

### 2.7 湿实验闭环（Lab-in-the-Loop）

生命科学的独特之处在于：计算分析最终必须回到实验室验证。BioAgent 原生支持"干-湿"循环：

**正向：从假设到实验方案。** agent 不仅生成假设，还将假设转化为具体的实验方案（protocol）——包括试剂列表、操作步骤、预期结果和对照设计。方案以结构化格式输出，可直接交给湿实验团队执行。

**反向：从实验数据到证据呈现。** 湿实验完成后，研究者将原始数据（qPCR 结果、Western blot 图像、测序数据等）上传回 BioAgent。反向路径中 agent 的角色不是最终裁判，而是结构化证据呈现者：解析数据、检查质量、对齐原始假设、列出支持/反对/不确定证据、标注统计限制、提出可选解释和下一步验证建议。研究者保留“假设是否成立”的裁判权。

**决策边界**：agent 可以说“该实验结果支持/反对某个前提的证据强弱如何”，但不能把一次实验自动写成“假设成立/不成立”的最终结论，除非用户明确确认。UI 应把 agent 的证据摘要、研究者的裁决、后续行动分成不同层级记录。

**迭代记录**：每一轮“假设→实验方案→实验数据→证据呈现→研究者裁决→下一步行动”都被完整记录在研究时间线中，形成一个可回溯的科学发现过程。

### 2.8 研究时间线：研究记忆与分支历史

研究时间线不是附属日志，而是 BioAgent 与研究者之间最持久的连接点。单次对话、单个 artifact 或一次分析都可能过期，但时间线承载了研究的长期记忆：问题如何演化、哪些证据进入过系统、哪些结论被推翻或强化、哪些分支被搁置、谁在什么时候做了什么判断。

时间线至少承担四个职责：

1. **研究记忆载体**：记录 prompt、任务代码、artifact、ExecutionUnit、实验数据、用户裁决、失败原因和恢复操作。
2. **可分支探索历史**：支持多个假设分支并行存在，记录分支来源、合并、废弃和恢复，而不是只有线性聊天历史。
3. **belief dependency graph 的时间投影**：belief graph 说明“结论依赖什么”，时间线说明“这些依赖何时产生、何时更新、由谁确认”。
4. **研究编排层的状态基底**：未来 Phase 3 编排 Agent 不应只看当前聊天，而应读取时间线上的目标、未完成任务、已验证/未验证假设、开放分支和权限边界。

因此，时间线中的事件需要结构化，而不仅是自然语言记录。每个事件应包含 actor、action、subject、artifactRefs、executionUnitRefs、beliefRefs、branchId、visibility、createdAt、decisionStatus 等字段。研究者可以从时间线回到任一分支，查看当时的证据、代码和 UI 状态。

#### 分支粒度

不是所有变化都应该创建时间线分支。BioAgent 需要区分三种粒度：

- **参数级变体**：例如换一个阈值、随机种子、排序方式或可视化参数重跑。它是某个 ExecutionUnit / run 的 attribute，不创建新 branch，避免时间线噪声。
- **方法级替代路径**：例如同一个问题定义下，用 DESeq2 和 edgeR 分别分析、用不同 docking 工具比较、用不同模型做同一预测。这类变化创建 method branch，共享同一个 question / hypothesis 定义。
- **假设级分叉**：例如研究问题本身改变，或从同一对齐契约版本下派生出不同生物学假设。这类变化创建 hypothesis branch，parent branch 应指向对应的 alignment contract / belief / decision 版本。

Phase 3 编排层在规划任务时必须尊重这个粒度：参数扫描不应污染分支树；方法替代需要可比较；假设级分叉需要记录为什么问题定义发生变化。

#### 裁决可修订但不可抹除

研究者裁决不是一次性、不可改变的盖章。科学结论会随着新证据进入而修订。BioAgent 应把裁决建模为 **decision revision sequence**：旧裁决不可删除，只能被 supersede、retract、amend 或 reaffirm。时间线展示的是裁决历史序列，而不是只展示当前状态。

当新数据推翻旧裁决时，belief dependency graph 不应覆盖原始节点，而应新增修订事件，保留“当时基于哪些证据认为成立，后来因为哪些证据改判”的完整链路。这让系统既保持可回溯，又符合科学认识不断修订的现实。

### 2.9 跨领域价值对齐（Cross-Domain Alignment）

这是 BioAgent 最具差异化的功能模块，直面生命科学研究中一个被长期忽视的核心痛点：**AI 专家与生物专家之间的系统性沟通失败。**

#### 问题的本质

这不是简单的"术语翻译"问题。两个领域的专家对同一个研究项目存在多层面的认知错位：

| 错位维度 | AI 专家的视角 | 生物专家的视角 | 真正的问题 |
|---------|-------------|-------------|----------|
| 数据 | "样本量太小，模型会过拟合" | "每个样本都是花三个月做出来的" | 双方对"够不够"的标准不在同一个坐标系 |
| 能力边界 | "这个任务可以做到 AUC 0.85" | "AUC 0.85 是什么意思？能用吗？" | AI 指标与生物学意义之间缺少翻译 |
| 结论标准 | "模型预测这个基因是关键靶点" | "预测不算数，要做 KO 验证" | 对"什么才算结论"的定义不同 |
| 噪声理解 | "标签噪声太大，需要清洗" | "这不是噪声，这是生物学变异" | 同一个现象在两个框架下的解读完全不同 |
| 预期管理 | "给我干净的数据我就能建模" | "我以为 AI 能处理脏数据" | 双方对彼此能力的预期都不准确 |

这种错位的代价是巨大的：项目启动几个月后才发现方向不可行，生物学家觉得"AI 没用"，AI 工程师觉得"数据太差"，双方都很沮丧。

#### BioAgent 的解决方案：结构化对齐工作台

BioAgent 提供一个专门的**对齐工作台（Alignment Workspace）**，让 AI 专家和生物专家围绕具体的数据和任务，在 AI 的辅助下达成共识。这不是一个聊天窗口——它是一个结构化的协商流程。

早期版本必须收敛边界：对齐工作台先以模板化问卷、检查清单和结构化整理为主，让 AI 负责翻译、归纳、指出缺失信息和组织讨论；不要让 AI 在证据不足时直接裁判数据质量或项目可行性。可行性矩阵中的判断应标注来源：用户填写、数据统计、已有 artifact、文献证据或 AI 推断。

**Step 1：数据现实摸底。** 双方（或各自独立）向 BioAgent 上传或描述现有的数据资产。agent 自动生成一份**数据能力报告**：有多少样本、什么模态、什么质量、缺失情况、已知的偏差来源。报告同时用 AI 语言（"特征维度 vs 样本量比、类别不平衡度"）和生物语言（"覆盖了哪些表型、哪些亚群缺失、批次效应来源"）双视角呈现。

**Step 2：目标可行性评估。** 生物专家描述研究目标（"我想找到驱动这个表型的关键通路"），AI 专家描述技术路线设想。BioAgent 基于数据现实，生成一份**可行性矩阵**：

- 这个目标在当前数据条件下能做到什么程度？（明确的能力边界）
- 需要补充什么数据才能做得更好？（具体的、可操作的建议）
- AI 指标（AUC、F1）对应的生物学含义是什么？（"AUC 0.85 意味着每 100 个预测中约有 15 个假阳性，对你的下游验证实验意味着额外 X 次无效实验"）
- 有哪些潜在陷阱？（如混杂因素、批次效应、标签定义模糊等）

**Step 3：方案共识形成。** 双方在对齐工作台上对可行性矩阵进行标注和讨论，agent 实时辅助翻译双方的关切。最终输出一份**双方签认的项目契约**，包含：明确的目标定义（用双方都理解的语言）、数据要求和数据获取计划、成功标准（AI 指标和生物学验证标准的对应关系）、已知风险和应对策略。

**Step 4：持续校准。** 项目推进过程中，当出现预期外的结果（模型性能不及预期、实验结果与预测不符），对齐工作台自动触发一轮**再校准讨论**——不是等到项目失败才复盘，而是在偏差出现的早期就让双方回到同一个认知框架中。

#### 为什么这必须是一个独立功能

很多人会说"这不就是项目管理吗"或者"开个会就能解决"。但实际情况是：

- 会议中的共识往往是模糊的，两个人以为自己说的是同一件事，其实不是
- 没有具体数据锚定的讨论容易流于抽象，AI 专家和生物专家各说各话
- 项目中期的认知漂移（scope creep、预期膨胀）缺少结构化的检查机制

BioAgent 的对齐工作台用**数据驱动的结构化协商**取代**自由形式的会议讨论**，用 AI 作为双方之间的实时翻译官和现实检验者，确保每个关键决策点上两个领域的专家对"我们在做什么、能做到什么、如何判断成功"有一致的理解。

### 2.10 多角色视图

在对齐达成之后，研究过程中的每一份分析结果仍然需要面向不同角色以不同方式呈现。BioAgent 为同一份结果提供多角色视图：

| 角色 | 关注重点 | 呈现方式 |
|------|---------|---------|
| 实验生物学家 | 生物学意义、下一步实验 | 通路图高亮 + 可执行 protocol |
| 生物信息学家 | 算法细节、参数选择、代码 | 代码面板 + 参数配置 + 可复现 pipeline |
| 临床医生 | 临床相关性、患者分层 | 风险评分 + 生存曲线 + 通俗摘要 |
| PI / 项目负责人 | 全局进展、关键发现、资源分配 | 进度仪表盘 + 里程碑时间线 |

这不是简单的"换个模板"，而是 agent 在理解研究内容后，主动选择最适合当前角色的数据维度和表达方式。

### 2.11 协作与权限边界

生命科学项目通常不是单人工作。多人协作、数据边界和权限控制必须作为后续阶段的一等公民，而不是上线后再补。它们会影响 artifact、时间线、对齐工作台和实验数据回传的粒度。

早期设计至少应保留以下边界：

- **角色与权限**：PI、实验生物学家、生物信息学家、临床医生、外部合作者拥有不同的读写、评论、确认和导出权限。
- **artifact 共享粒度**：不是所有 artifact 都默认全员可见；原始患者数据、未发表实验结果、API key、受限数据库结果需要显式访问控制。
- **时间线可见性**：时间线事件应有 visibility / audience 字段，支持个人草稿、团队可见、项目正式记录等层级。
- **裁决权与审计**：关键结论、湿实验裁决、对齐契约签认需要记录确认人和确认时间，agent 的建议不能替代授权角色的决定。
- **数据出境与导出**：导出 notebook、bundle、pipeline 或分享给外部协作者时，必须检查敏感数据和权限边界。

---

## 三、专业工具链

BioAgent 不把专业能力理解为一组永久写死的内置工具，而把它们理解为可发现、可安装、可生成、可沉淀的 skills。每个 Scenario 管理的是研究语境、artifact contract 和展示方式；具体工具能力来自已安装 skill、workspace task code、外部数据库 connector 或 AgentServer 动态生成的脚本。

首批应该沉淀为 skills 的生命科学能力包括：

**结构探索 Scenario**：AlphaFold / RoseTTAFold（蛋白质结构预测）、AutoDock Vina / DiffDock（分子对接）、RDKit（小分子处理）。

**序列 Agent**：BLAST / Diamond（序列比对）、HMMER（结构域搜索）、MAFFT / ClustalOmega（多序列比对）、InterProScan（功能注释）。

**组学差异分析 Scenario**：DESeq2 / edgeR（差异表达）、GSEA / clusterProfiler（富集分析）、Scanpy / Seurat（单细胞分析）、WGCNA（共表达网络）。

**文献证据评估 Scenario**：PubMed / Semantic Scholar（文献检索与综述）、知识图谱构建与查询。

**生物医学知识图谱 Scenario**：UniProt / PDB / AlphaFold DB（蛋白质）、ChEMBL / DrugBank（药物）、OpenTargets（靶点-疾病关联）、ClinicalTrials.gov（临床试验）、KEGG / Reactome（通路）。

每个 Agent 独立可用。在 Phase 3 引入编排层后，上层编排 Agent 根据研究目标自动规划跨 Agent 的调用链和数据流转。每次 skill/task 调用都自动生成对应的 Execution Unit，确保可复现。

工具解析顺序必须保持开放：

1. 优先匹配已安装 skills。
2. 若无合适 skill，则由 AgentServer 探索并生成 workspace task code。
3. task 成功后以 artifact、日志和 ExecutionUnit 形式沉淀。
4. 高频成功 task 进入反思队列，整理为可安装 skill。
5. 任何失败都必须返回原因和缺失条件，而不是退回 demo 或默认数据。

---

## 四、与现有方案的差异化定位

| 维度 | 通用 AI 助手 | 科学文献证据评估 Scenario（FutureHouse 等） | BioAgent |
|------|------------|-------------------------------|----------|
| 科学数据可视化 | 仅 markdown / 静态图 | 有限（以文本为主） | 多模态原生组件库（3D 结构、序列、网络图等） |
| 可复现性 | 无 | 部分（文献检索可追溯） | 完整（代码+参数+环境+数据版本全链路沉淀） |
| 置信度量化 | 无 | 有限 | 三维度量化（文献分级 + 统计置信度 + 假设/事实区分） |
| 湿实验闭环 | 不支持 | 有限（Robin 支持实验数据分析） | 原生支持 protocol 生成→数据回传→假设修正 |
| 跨领域价值对齐 | 不支持 | 不支持 | 结构化对齐工作台（数据摸底→可行性评估→方案共识→持续校准） |
| UI 架构 | 纯聊天 | 纯聊天 / 简单 Web | UI Compiler（artifact schema → UIPlan → 稳定组件渲染） |
| 推理溯源 | 不透明 | 部分（文献引用） | 全链路（文献→推理→工具调用→结果） |
| 构建路径 | 单体应用 | 多 Agent 一体 | Scenario/Skill/UI 三层编译，发布为版本化 Scenario Package |

---

## 五、典型使用场景

### 场景一：项目启动——跨领域对齐

一个课题组想用机器学习从多组学数据中预测药物敏感性。PI 召集了生物信息学家和 AI 工程师。

1. **数据摸底**：双方将手头的数据（细胞系药敏数据、RNA-seq、突变谱）接入 BioAgent 的对齐工作台。agent 自动生成数据能力报告："共 200 个细胞系，覆盖 15 种药物，但 3 种药物的响应标签严重不平衡（阳性率 < 5%）"——同时用生物语言标注"这 3 种药物对应的是窄谱靶向药，预期响应率本身就很低"
2. **可行性评估**：AI 工程师提出用多任务学习，agent 评估并翻译："15 个药物联合建模可以缓解小样本问题，但前提假设是药物间存在共享的耐药机制——这在你的药物组合中是否成立？"——将技术假设转化为生物学家可以回答的问题
3. **方案共识**：经过几轮结构化讨论，双方达成一致：先聚焦于响应率合理的 12 种药物，用迁移学习从公共数据集（GDSC/CCLE）预训练，以 AUROC > 0.8 + 至少 3 个命中在独立细胞系中实验验证作为成功标准
4. **持续校准**：两个月后模型在 2 种药物上表现异常差，对齐工作台自动触发再校准："这 2 种药物的作用机制与其余 10 种完全不同（激酶抑制剂 vs 表观遗传调控），建议拆分为独立模型"

### 场景二：靶点发现与验证

一位研究者想为某种罕见遗传病寻找新的治疗靶点。

1. **文献扫描**：使用文献证据评估 Scenario 检索 PubMed 和 OpenTargets，综合数百篇论文，输出已知靶点列表及证据强度矩阵（每个靶点标注置信度等级）
2. **靶点优先级排序**：切换到生物医学知识图谱 Scenario 分析靶点的可成药性（druggability），查询 ChEMBL 中已有的化合物信息，在网络图中展示靶点在信号通路中的位置
3. **结构分析**：选中一个高优先级靶点，结构探索 Scenario 调取 AlphaFold 预测结构并在 3D 查看器中展示，高亮潜在结合口袋，pLDDT 色谱图显示结构可信度
4. **实验设计**：agent 生成 CRISPR 敲除验证方案，包括 sgRNA 设计、质粒构建步骤和表型检测方案
5. **结果回传**：湿实验团队完成敲除实验后上传表型数据，agent 分析表型变化，更新靶点验证状态，置信度从"计算预测"升级为"实验验证"
6. **全程可复现**：整个过程导出为带完整参数和环境定义的 pipeline

### 场景三：单细胞数据探索

一位博士生拿到了一份单细胞 RNA-seq 数据，需要从质控到生物学解读。

1. **数据质控**：上传 10x Genomics 数据，组学差异分析 Scenario 自动运行质控流程（cellranger → doublet detection → filtering），以交互式 violin plot 和散点图展示质控指标
2. **降维聚类**：agent 依次执行标准化、高变基因选择、PCA、UMAP、Leiden 聚类，在交互式 UMAP 图中展示结果，研究者可以点击任意 cluster 查看 marker 基因
3. **细胞类型注释**：agent 调用 CellTypist 或参考 atlas 自动注释，以热图展示各 cluster 的 marker 基因表达，同时提供不确定注释的备选方案及置信度
4. **差异分析与通路富集**：研究者选择两个感兴趣的 cluster 进行对比，agent 运行差异表达分析并展示火山图，自动进行 GO/KEGG 富集分析
5. **全程代码沉淀**：每一步分析都有对应的 Scanpy/Python 代码，可一键导出为完整的 Jupyter notebook

---

## 六、技术架构概览

```
┌──────────────────────────────────────────────────────────────────┐
│                       编排层（Phase 3 引入）                       │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ 研究编排 Agent：目标规划 / 多 Scenario 调用链 / 全局状态管理 │    │
│  └──────────────────────────────────────────────────────────┘    │
├──────────────────────────────────────────────────────────────────┤
│                       编译层（Phase 2/3）                          │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ Scenario Compiler                                         │    │
│  │ 用户目标 + 元素选择 → ScenarioIR / Scenario Package         │    │
│  └──────────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ Skill Compiler                                            │    │
│  │ skill manifests + capability profiles → SkillIR / SkillPlan│    │
│  └──────────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ UI Compiler                                               │    │
│  │ artifact schema + component manifests → UIPlan / UIManifest│    │
│  └──────────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ Validation Gate                                           │    │
│  │ schema / producer-consumer / runtime / fallback / smoke test│    │
│  └──────────────────────────────────────────────────────────┘    │
├──────────────────────────────────────────────────────────────────┤
│                    Published Scenario Package 层                  │
│  内置 preset · 用户自定义场景 · 团队共享场景 · marketplace 场景       │
│  scenario.json · skill-plan.json · ui-plan.json · tests.json       │
│  每个发布版本冻结 contract，旧 run 绑定旧版本复现                    │
├──────────────────────────────────────────────────────────────────┤
│                        稳定运行时层                                │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  Runtime Router                                           │    │
│  │  seed skill → installed skill → reusable task → AgentServer│    │
│  │  → explicit unsupported / failed-with-reason              │    │
│  └──────────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  Execution Engine                                         │    │
│  │  · 接收 Execution Unit（代码 + 参数 + 环境）               │    │
│  │  · 沙箱化执行（Docker / Conda）                           │    │
│  │  · 结果归档 + 数据指纹校验                                 │    │
│  │  · 一键导出 Snakemake / Nextflow / Jupyter Notebook       │    │
│  └──────────────────────────────────────────────────────────┘    │
├──────────────────────────────────────────────────────────────────┤
│                       元素 Registry 层                             │
│  Skill manifests · Tool manifests · Artifact schemas              │
│  UI component manifests · View Composition presets · Role policies │
│  Capability profiles · Failure/recovery policies                   │
├──────────────────────────────────────────────────────────────────┤
│                       共享 UI 组件库                               │
│  分子查看器 · 序列浏览器 · 热图 · 火山图 · 网络图 · 影像查看器       │
│  数据表 · 文献卡片 · Protocol 编辑器 · 实验记录本 · Inspector        │
│  UIPlan / UIManifest 驱动，跨 Scenario 复用                         │
├──────────────────────────────────────────────────────────────────┤
│                   版本化产物与知识层                               │
│  PubMed · UniProt · PDB · ChEMBL · OpenTargets                   │
│  KEGG · Reactome · ClinicalTrials.gov · GEO · SRA                │
│  workspace artifacts · ExecutionUnits · timelines · Scenario 版本 │
│  本地实验数据 · 项目历史 · Protocol 库                             │
└──────────────────────────────────────────────────────────────────┘
```

---

## 七、项目愿景

我们相信 AI 在科学研究中的角色正在从"工具"转向"协作者"。但真正的科学协作者不只是能回答问题——它需要理解你的数据形态并以合适的方式呈现，需要让每一步推理都经得起同行检验，需要连接计算分析与实验验证的完整循环，更需要帮助不同背景的研究者建立共同语言。

BioAgent 的目标不是替代研究者的判断力，而是**释放研究者的认知带宽**——让他们从繁琐的数据处理、工具切换和跨领域沟通摩擦中解放出来，将精力集中在真正需要人类创造力的地方：提出有洞察力的问题、设计巧妙的实验、做出关键的科学判断。

**可复现不是约束，而是信任的基础。** 当 agent 的每一个结论都能被独立验证时，研究者才会真正信任它、依赖它，并将它纳入严肃的科学工作流程中。

**对齐不是流程开销，而是成功的前提。** 当 AI 专家和生物专家在项目第一天就对"能做什么、不能做什么、怎样算成功"达成清晰共识时，那些原本耗时数月才暴露的方向性错误就不会发生。

---

*BioAgent — 让 AI 成为你实验室里最可靠的研究伙伴。*
