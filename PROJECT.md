# BioAgent - PROJECT.md

最后更新：2026-04-20

## 使用约定
- 本文档作为 BioAgent 工程任务板使用，正文只保留正在推进或待推进的任务；已完成任务压缩到归档摘要。
- 产品与架构基准见 `docs/BioAgent_Project_Document.md`。
- 当前 Web UI 位于 `ui/`，本项目服务运行在 `http://localhost:5173/`；本地 workspace writer 运行在 `http://127.0.0.1:5174/`。
- AgentServer 是项目无关的通用“大脑”和 fallback backend；BioAgent profile 专属检索、结构查询、组学 runner、运行时环境安装和工具执行默认放在 BioAgent 项目路径与 workspace service 中。
- 如果确实定位到 AgentServer 通用能力缺口，可以修改 `/Applications/workspace/ailab/research/app/AgentServer`；修改必须泛化到协议、配置、通用工具连接、网络环境或 backend 能力层，并在对应 TODO 标明影响的 API / backend / tool 约定。
- BioAgent 当前优先调用本项目 `npm run workspace:server` 提供的 `POST /api/bioagent/tools/run`；失败时才回退到 AgentServer 通用 autonomous run 路径。
- 语言边界必须显式：TypeScript 主要用于 Web UI、workspace writer、artifact/session 协议、组件 registry 和轻量编排壳；科学任务执行代码优先生成到 workspace 内的 Python 脚本 / notebook / package 中，并作为 artifact 的一部分沉淀。只有在性能、生态或既有科学工具要求时，才使用 R、C/C++、Rust、Julia、Shell、WASM 或其它语言；选择非 Python 语言必须在 ExecutionUnit 中记录原因、环境和可复现入口。
- BioAgent 不应把具体科学任务长期写死在 TypeScript backend 分支里。内置 project tool 只能作为通用能力原语、任务引导器或兼容 fallback；真实任务应尽量表现为 workspace-local code artifact，例如 `.bioagent/tasks/*.py`、`.bioagent/tasks/*.ipynb`、`.bioagent/tasks/*.R`，并输出标准 artifact JSON、日志和 ExecutionUnit。
- 自愈机制必须优先复用 AgentServer 的通用“大脑”能力：任务失败后，BioAgent 应把 prompt、任务代码、stderr/stdout、artifact schema、用户反馈和失败现象交给 AgentServer，让其修改 workspace 任务代码并重跑；如果仍无法完成，必须返回明确失败原因和下一步所需条件，不能用 demo、默认结构、默认数据或 record-only 结果冒充成功。
- 通过 Computer Use 做端到端探索时，优先验证用户能否在浏览器里完成真实研究动作，而不是只验证接口能返回；每个任务都需要留下可复现 prompt、点击路径、期望 artifact 和失败现象。
- 外部数据库或模型下载失败时，优先排查本机网络、代理、DNS、证书和服务端工具配置；不要把特定下载源硬编码进 UI。
- 代码路径必须尽量保持唯一真相源：引入新链路或发现冗余时必须删除、合并或明确降级旧链路，避免两个并行逻辑长期共存。

## 当前状态
- 已有 React + Vite Web UI，包含研究概览、单 Agent 工作台、对齐工作台、研究时间线。
- 文献、结构、组学、知识库四个 Agent 已能通过 BioAgent project tool 返回真实 runtime artifact；AgentServer 保留为通用 fallback。
- workspace writer 已能落盘 `.bioagent/workspace-state.json`、`sessions/`、`artifacts/`、`versions/`、`config.json`，并提供 Resource Explorer 文件操作。
- 已完成的 Agent 对话、project tool、handoff、workspace、ExecutionUnit 导出等任务见本文末尾归档摘要。

---

## P0 - 当前阻塞
- 暂无。T018 真实 runner 安装与 smoke 已完成；后续任务待新增。

---

## P1 - 后续能力增强

### T021 Python-first 科学任务运行时与 AgentServer 自愈闭环

#### 目标说明
- 将 BioAgent 的科学任务执行层从 TypeScript 写死分支迁移为 workspace-local code artifact：优先由 AgentServer 生成/修改 Python 任务代码，BioAgent workspace service 负责执行、收集 artifact、渲染 UI，并在失败后把错误与用户反馈交还 AgentServer 自愈重试。

#### 成功标准
- TypeScript 只保留 UI、协议、workspace I/O、artifact registry、任务调度和兼容 fallback；文献、结构、组学、知识库等具体科学任务优先以 workspace Python 代码表达。
- 每次科学任务至少沉淀一个可复验任务代码 artifact、一个标准结果 artifact、一个执行日志和一个 ExecutionUnit；ExecutionUnit 记录代码路径、语言、依赖、输入、输出、失败/成功状态。
- 当任务失败或用户反馈指出结果不真实时，BioAgent 能把任务代码、日志、artifact schema、浏览器反馈交给 AgentServer，让 AgentServer 修改代码并重跑；重试次数、diff、失败原因都要写入 artifact/log。
- 允许为了性能或生态使用 R、C/C++、Rust、Julia、Shell、WASM 或其它语言，但必须由任务代码显式声明选择理由、环境和可复现入口；不能因为 Web UI 是 TypeScript 就把科学分析逻辑默认写进 TypeScript。
- 若 AgentServer 或本地环境无法完成任务，UI 必须展示明确原因和缺失条件，不得 fallback 到 demo/default/record-only 结果并标记为成功。

#### TODO
- [ ] 定义 workspace 任务目录与 artifact 规范：`.bioagent/tasks/`、`.bioagent/artifacts/`、`.bioagent/logs/`、`.bioagent/runs/` 的命名、schema、版本和引用关系。
- [ ] 定义 Python-first ExecutionUnit schema：记录 `language`、`codeRef`、`entrypoint`、`environmentRef`、`inputs`、`outputs`、`stdoutRef`、`stderrRef`、`attempt`、`parentAttempt`、`selfHealReason`。
- [ ] 在 workspace service 增加通用 task runner：执行 workspace-local Python/R/其它语言脚本，捕获日志、退出码、产物路径和数据指纹；不要把具体科学逻辑写进 runner。
- [ ] 接入 AgentServer 自愈协议：失败时把 prompt、codeRef、日志、artifact schema、用户反馈和 UI 状态发给 AgentServer，请其生成 patch 或新 attempt，再由 BioAgent 执行。
- [ ] 先迁移结构 Agent 的 RCSB/AlphaFold 任务：把最新 PDB 搜索、坐标下载、mmCIF/PDB 解析、atomCoordinates 输出放到 workspace Python task 中；TypeScript 只负责调用 runner 和渲染结果。
- [ ] 再迁移组学 Agent：将 Scanpy/DESeq2/edgeR 调用表达为 workspace task code，保留 Python/R 环境约定和真实 runner smoke。
- [ ] 更新动态结果区：展示 `taskCodeRef`、attempt history、自愈 diff 摘要、失败原因；没有真实 artifact 时保持 empty/failed state。
- [ ] 用 Computer Use 验证失败-反馈-自愈闭环：构造一个下载失败或 schema 缺字段场景，确认 AgentServer 能修改 task code 重跑并在右侧显示真实 artifact。

## 归档摘要
- T001 Agent 对话 API：已完成 AgentServer run/stream 接入、错误处理、排队 follow-up、响应 normalize。
- T002 Computer Use 真实可用性探索：已完成首页、设置、workspace、Agent prompt、导出、Resource Explorer smoke；记录见 `docs/ComputerUseSmoke.md`。
- T003 文献真实检索闭环：已迁回 BioAgent project tool，PubMed E-utilities 可返回真实 `paper-list`。
- T004 结构真实分析闭环：已迁回 BioAgent project tool，RCSB / AlphaFold DB 可返回真实 `structure-summary`。
- T005 Artifact 跨 Agent 手动流转：已完成 handoff message、artifact context、自动触发目标 Agent run。
- T006 Workspace 与 Resource Explorer 文件闭环：已完成 `.bioagent` 落盘、文件夹创建/重命名/删除、writer 错误提示。
- T007 组学真实分析 MVP：已完成 workspace CSV fixture、bounded local CSV differential runner、`.bioagent/omics` 输出与日志。
- T008 知识库真实查询 MVP：已完成 UniProt reviewed human gene 查询与 `knowledge-graph` artifact。
- T009 对齐工作台契约设计：已定义 `alignment-contract` schema，后续进入可编辑保存实现。
- T010 ExecutionUnit 导出与可复现性检查：已完成 JSON Bundle 为 Phase 1 规范审计产物，真实 project tool 返回 ExecutionUnit 字段。
- T011 动态结果区数据来源去 demo 化：已移除 paper cards、molecule viewer、volcano、heatmap、UMAP、network、data table、evidence matrix、ExecutionUnit、notebook 的无条件 demo fallback；右侧组件现在展示 `project-tool` / `record-only` / `empty` 来源条、artifact metadata、dataRef 和 producing tool。
- T012 文献 Agent 结果区真实 `paper-list` 渲染：已通过 Safari Computer Use 验证 `TP53 tumor suppressor reviews` 由 BioAgent project tool 完成，右侧展示真实 PubMed paper cards、PubMed URL、`PubMed.eutils.esearch+esummary` ExecutionUnit。
- T013 结构 Agent 结果区真实 `structure-summary` 渲染：已通过 Safari Computer Use 验证 `PDB 7BZ5 residues 142-158` 返回 RCSB `.cif` dataRef、residue range、molecule viewer 和 `RCSB.core.entry` ExecutionUnit；无 artifact 时不再加载默认 7BZ5。
- T014 组学 Agent 结果区真实 omics artifact 渲染：已通过 Safari Computer Use 验证固定 CSV fixture 生成 `.bioagent/omics/...json`、`omics.local-csv-differential` ExecutionUnit，并驱动 volcano、heatmap、UMAP。
- T015 知识库 Agent 结果区真实 `knowledge-graph` 渲染：已通过 Safari Computer Use 验证 `TP53 gene` 返回 UniProt reviewed human entry `P04637`、3 个节点、2 条边和 `UniProt.uniprotkb.search` ExecutionUnit；demo drug/pathway fallback 已从动态表格/网络中移除。
- T016 ExecutionUnit 与结果区一致性检查：已建立 artifact 到 ExecutionUnit 的 resolver，结果区 source badge 展示 producing tool/status；缺引用时显示审计 warning。
- T017 Browser Smoke 四 Agent 动态结果区真实数据回归：已用 Safari 覆盖 Literature、Structure、Omics、Knowledge；记录见 `docs/ComputerUseSmoke.md`。
- T018 组学真实统计运行时接入：已定义 BioAgent workspace-local Python/R runtime 路径，接入 Scanpy `rank_genes_groups`、DESeq2、edgeR 三条真实 runner；artifact/log 记录 requested/effective runner、runtime availability、软件版本、统计模型、输入指纹、outputRef、logRef，失败时回退到 `omics.local-csv-differential`。用户确认安装后，已在 `/tmp/bioagent-results-smoke` 安装 workspace-local Scanpy 1.12.1、R 4.4.3、DESeq2 1.46.0、edgeR 4.4.0；direct smoke 覆盖三条 runner，Safari Computer Use 覆盖 Scanpy 与 edgeR 大矩阵动态结果区。
- T020 对齐工作台真实编辑与版本恢复：已将 Alignment Workspace 从静态卡片升级为可编辑表单；保存生成 `alignment-contract` artifact，workspace writer 会落盘到 `.bioagent/artifacts/` 和 `.bioagent/versions/`；版本列表支持恢复，研究时间线显示保存/恢复事件；Safari Computer Use 已完成保存、刷新恢复和版本恢复 smoke。
- T019 知识库真实数据源扩展：已定义 gene/protein/compound/disease/clinical-trial disambiguation；gene/protein 走 UniProt，compound 已接入真实 ChEMBL molecule search + mechanism + drug indication；未接入的 disease/clinical-trial 仍返回明确 unsupported artifact；`knowledge-graph` 节点/边补充 sourceRefs/supportingRefs；Safari Computer Use 已验证 `sotorasib compound ChEMBL` 返回 ChEMBL compound graph、4 nodes、3 edges、`ChEMBL.molecule.search+mechanism+indication` / `done`。
