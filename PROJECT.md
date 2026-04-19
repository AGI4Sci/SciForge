# BioAgent - PROJECT.md

最后更新：2026-04-20

## 使用约定
- 本文档作为 BioAgent 工程任务板使用，只保留正在推进或待推进的任务。
- 产品与架构基准见 `docs/BioAgent_Project_Document.md`。
- 当前 Web UI 位于 `ui/`，本项目服务运行在 `http://localhost:5173/`；本地 workspace writer 运行在 `http://127.0.0.1:5174/`。
- 优先复用 `/Applications/workspace/ailab/research/app/AgentServer` 快速开发 agent；当前 AgentServer 运行在 `http://127.0.0.1:18080`。
- 通过 Computer Use 做端到端探索时，优先验证用户能否在浏览器里完成真实研究动作，而不是只验证接口能返回；每个任务都需要留下可复现 prompt、点击路径、期望 artifact 和失败现象。
- AgentServer 是项目无关的通用“大脑”和 fallback backend；BioAgent profile 专属检索、结构查询、组学 CSV runner、运行时环境安装和工具执行默认放在 BioAgent 项目路径与 workspace service 中。
- 如果确实定位到 AgentServer 通用能力缺口，可以修改 `/Applications/workspace/ailab/research/app/AgentServer`；修改必须泛化到协议、配置、通用工具连接、网络环境或 backend 能力层，并在对应 TODO 标明影响的 API / backend / tool 约定。
- BioAgent 当前优先调用本项目 `npm run workspace:server` 提供的 `POST /api/bioagent/tools/run`：文献 Agent 使用 PubMed E-utilities，结构 Agent 使用 RCSB core entry API 和 AlphaFold DB prediction API，组学 Agent 读取 workspace CSV fixture 执行本地差异表达，知识库 Agent 使用 UniProt REST 查询 reviewed human gene entry；失败时才回退到 AgentServer 通用 autonomous run 路径。
- 外部数据库或模型下载失败时，优先排查本机网络、代理、DNS、证书和服务端工具配置；例如 PDB/CDN 访问问题应先确认 Clash/系统代理，而不是把特定下载源硬编码进 UI。
- Phase 1 优先目标：先做好单 Agent 独立运行，再做 Agent 间数据打通，最后再做多 Agent 编排。
- 代码路径必须尽量保持唯一真相源：引入新链路或发现冗余时必须删除、合并或明确降级旧链路，避免两个并行逻辑长期共存。
- 开发过程中发现新的 TODO，优先追加到本文档。

## 当前状态
- 已有 React + Vite Web UI，包含研究概览、单 Agent 工作台、对齐工作台、研究时间线。
- 已有 4 个 Agent profile mock：文献 Agent、结构 Agent、组学 Agent、知识库 Agent。


---

## P0 - Agent 对话闭环优先实现

### T001 接入 AgentServer 对话 API

#### 目标说明
- 将 `ChatPanel` 从静态 mock 升级为可发送研究问题、接收 agent 响应的真实对话入口。
- Phase 1 先保证单 Agent 独立可用：用户选择某个 Agent profile 后，请求携带 agent 类型、消息历史和当前上下文，只调用对应单 Agent。
- 对话响应需要能同时返回自然语言、置信度、证据标签、claim type、推理链摘要、UIManifest 更新和 ExecutionUnit 草案。

#### 成功标准
- 在文献 Agent 工作台输入问题后，可以通过 `http://127.0.0.1:18080` 获取真实 agent 回复并追加到当前消息流。
- 切换 Agent 后，每个 Agent 保持独立会话历史，不互相污染。
- 发送中有 loading 状态，失败时展示可读错误并允许重试。
- 前端不直接依赖 mock 响应结构；通过统一 adapter 将 AgentServer 响应标准化为 BioAgent 消息模型。
- 没有 AgentServer 或请求失败时，UI 保留清晰 fallback，不把 mock 当成真实结果。

#### TODO
- [x] 调研 AgentServer 当前 API 路径、请求体、响应体和流式能力。
- [x] 新增 `ui/src/api/agentClient.ts`，封装 base URL、超时、错误解析、AbortController。
- [x] 定义 `AgentMessage`、`AgentRequest`、`AgentResponse`、`AgentRunState` 类型，避免继续把 mock 数据当运行时状态。
- [x] 将 `messagesByAgent` 改为初始示例数据或 demo seed，真实会话状态放到 `ChatPanel` / 上层 store。
- [x] 发送请求时携带 `agentId`、用户输入、历史消息、当前 role view、当前结果 tab 和必要 project context。
- [x] 支持 streaming 版本：读取 `/api/agent-server/runs/stream` NDJSON 事件并实时渲染。
- [x] 增加 loading、disabled、retry、abort 和空输入校验。
- [x] 运行中 composer 保持可输入；新消息作为引导进入队列，当前 run 结束后自动继续发送。
- [x] 为请求失败、超时、服务未启动分别展示明确错误。
- [x] 本地验证：`npm run typecheck`、`npm run build`。
- [x] 直接调用 `/api/agent-server/runs` 完成一次文献 Agent smoke，并记录 AgentServer backend 实际响应质量。
- [x] 使用 Computer Use 在浏览器手动发送至少 2 个 Agent 的问题，并记录点击路径、prompt、响应质量和失败截图/现象。记录见 `docs/ComputerUseSmoke.md`。

---

## P0 - Computer Use 真实可用性探索

### T002 建立浏览器端到端验收脚本

#### 目标说明
- 用 Computer Use 以真实用户方式探索 BioAgent：打开 UI、配置 AgentServer / workspace、切换 Agent、发送 prompt、检查结果区、导出 ExecutionUnit、查看 Resource Explorer。
- 形成可重复的 smoke 路线，后续每次修改都能快速判断「功能是否真的可用」。

#### 成功标准
- `npm run dev`、`npm run workspace:server` 和 AgentServer 启动后，浏览器可访问 `http://localhost:5173/`。
- 能通过 Settings 设置 AgentServer Base URL、workspace writer URL、workspace path、模型连接，并在刷新后保持。
- Computer Use 能完成一次从「选择 Agent -> 发送问题 -> 查看 streaming 事件 -> 查看 artifact -> 查看 ExecutionUnit -> 导出 bundle」的完整路径。
- 失败时能区分前端交互问题、workspace writer 问题、AgentServer 运行问题和模型配置问题。

#### TODO
- [x] 记录本地启动顺序：AgentServer、BioAgent dev server、workspace writer。记录见 `docs/ComputerUseSmoke.md`。
- [x] 用 Computer Use 打开首页，验证首屏、导航、Settings、Agent Profiles、Workbench、Alignment、Timeline 均可进入。
- [x] 用 Settings 配置 workspace path 为一个临时研究目录，并验证状态栏显示同步到 `.bioagent`。
- [x] 发送一个文献 Agent prompt，验证 loading、streaming event、取消请求、失败消息和证据矩阵 fallback。
- [x] BioAgent project tool 与浏览器复验均已验证结构 Agent 能返回 RCSB `structure-summary` artifact / ExecutionUnit，并驱动 molecule-viewer。
- [x] 测试停止生成；运行中 guidance 输入框可见，队列 follow-up 尚待完整成功 run 验证。
- [x] 导出当前 Agent 会话 JSON，检查 messages、claims、artifacts、executionUnits、notebook 是否齐全。
- [x] 输出一份 `docs/` 下的 Computer Use smoke 记录模板或把固定步骤沉淀回本文档。

### T003 文献 Agent 真实检索闭环

#### 目标说明
- 让文献 Agent 不只是通用聊天，而是能围绕生命科学问题返回可追溯论文、证据等级、claim type、结构化 `paper-list` artifact 和可复现检索 ExecutionUnit。

#### 成功标准
- 在浏览器输入如「KRAS G12D 胰腺癌靶向治疗近三年证据」后，能得到真实论文引用、URL/DOI/PubMed 标识、证据等级和矛盾证据提示。
- 结果区展示 `paper-card-list` 和 `evidence-matrix`，artifact 标记为 agent/runtime 数据而非 demo。
- ExecutionUnit 记录检索 query、数据库、时间范围、maxResults、数据库版本或访问日期。
- PubMed / Semantic Scholar / Crossref 等 BioAgent 专属工具默认接在 BioAgent workspace service；AgentServer 只做通用 agent fallback。

#### TODO
- [x] 用 Computer Use 跑一次文献 Agent 真实 prompt，并记录返回是否包含真实可点击来源。结果：AgentServer streaming 持续 usage-update，取消前未返回稳定 `paper-list`。
- [x] 检查 `paper-list` artifact 是否符合 `ui/src/agentProfiles.ts` schema。BioAgent project tool 返回 `id=paper-list`、`type=paper-list`、`schemaVersion=1`、`data.query`、`data.papers[]`。
- [x] 检查每条 claim 是否有 evidenceLevel、claimType、confidence 和 supportingRefs。direct smoke 返回 PMID supportingRefs。
- [x] 检查 AgentServer 返回的 JSON 是否稳定可被 `normalizeAgentResponse` 解析。返回体为 `run.output.result` 内单一 JSON object，保留 `message/claims/uiManifest/executionUnits/artifacts`。
- [x] BioAgent 侧：文献 Agent 结构化长 prompt 不能依赖通用 AgentServer 自由生成；已通过 `POST /api/bioagent/tools/run` 在项目服务内提供有边界结构化协议。
- [x] BioAgent 侧：若通用 AgentServer 只返回自然语言，前端仍优先消费项目工具返回的标准 JSON；AgentServer 保留为 fallback。
- [x] BioAgent 侧：已接入 PubMed E-utilities；Semantic Scholar / Crossref 可作为后续增强。
- [x] 用 Computer Use 重新跑文献 Agent 浏览器路径，确认 PubMed `paper-list` 在 UI 的 paper cards、evidence matrix 和 JSON export 中完整展示。Prompt: `KRAS G12D 胰腺癌靶向治疗近三年证据，请返回 paper-list JSON artifact、claims、ExecutionUnit。`；结果：PubMed 返回 5 条记录，paper cards 展示 PMID 链接，evidence matrix 显示 5 条支持，ExecutionUnit 为 `PubMed.eutils.esearch+esummary` / `done`，已下载 `execution-units-literature-*.json`。
- [x] BioAgent 侧：修复 Web UI 包装 prompt 会污染 PubMed query 的问题。项目工具现在直接接收原始 `prompt` 和 artifact 摘要，不再把整段 AgentServer 包装 prompt 当检索词。

### T004 结构 Agent 真实结构分析闭环

#### 目标说明
- 让结构 Agent 能从 PDB ID / UniProt ID / mutation / ligand 输入生成结构摘要、坐标来源、残基高亮、质量指标和结构 ExecutionUnit。

#### 成功标准
- 在浏览器输入如「分析 PDB 7BZ5，关注 ligand pocket 和 142-158 残基」后，能得到真实 PDB/RCSB 来源、结构元数据、可视化 artifact 和分析说明。
- `molecule-viewer` 使用 runtime artifact 渲染，不仅显示 fallback 占位。
- 结构 Agent 失败时，前端展示 AgentServer / 网络 / 工具错误，不用 case-specific UI fallback 伪装成功。
- ExecutionUnit 记录 PDB ID、下载 URL、解析步骤、参数、数据指纹和输出 artifact。

#### TODO
- [x] BioAgent project tool 跑一次指定 PDB ID 的结构 Agent prompt：`7BZ5` 返回 RCSB metadata、`dataRef=https://files.rcsb.org/download/7BZ5.cif`、ExecutionUnit `RCSB.core.entry`。
- [x] 验证 `structure-summary` artifact 包含 pdbId、highlightResidues、metrics、dataRef。已补齐 `142-158` 这类残基范围解析。
- [x] 验证结构下载失败时错误信息能指向网络/代理/项目工具配置，而不是静默回退到 demo。
- [x] 测试一个 UniProt ID prompt，确认能力由 BioAgent project tool 承载。`UniProt P04637` 返回 AlphaFold DB dataRef 与 `AlphaFoldDB.prediction` / `done` ExecutionUnit。
- [x] BioAgent 侧：已接入 RCSB core entry API 与 AlphaFold DB prediction API；AlphaFold API 请求使用显式 `User-Agent`。
- [x] BioAgent 侧：当前 PDB 返回 RCSB `.cif` dataRef；UniProt accession 返回 AlphaFold `.cif` dataRef。
- [x] 用 Computer Use 重新跑结构 Agent 浏览器路径，确认 molecule-viewer / structure-summary / ExecutionUnit 在 UI 中完整展示。Prompt: `分析 PDB 7BZ5，关注 ligand pocket 和 142-158 残基，返回 structure-summary artifact 和 ExecutionUnit。`；结果：流式事件包含 `RCSB.core.entry`，结果区展示 `PDB=7BZ5`、`residues=142-158`、resolution `1.84 A`，ExecutionUnit 为 `EU-structure-*` / `RCSB.core.entry` / `done`。

### T005 Artifact 跨 Agent 手动流转

#### 目标说明
- Phase 2 之前先做好手动串联：用户能把一个 Agent 的 artifact 发送给另一个 Agent，后者基于该 artifact 继续分析，而不是重新从空上下文开始。

#### 成功标准
- 文献 Agent 产生 `paper-list` 后，结果区出现「发送 artifact 到结构 Agent / 知识库 Agent」操作。
- 目标 Agent 会话收到 handoff 消息，包含 artifact id、type、producerAgent 和下一步目标。
- 目标 Agent 后续请求携带该 artifact 上下文，并产出符合自身 schema 的 claims、ExecutionUnit 和 UIManifest。
- 原 Agent 与目标 Agent 的历史、artifact 列表、notebook 记录互不污染。

#### TODO
- [x] 用 Computer Use 从文献 Agent 发送 `paper-list` 到知识库 Agent，并确认目标会话出现 `接收 paper-list` handoff 消息。
- [x] 用 Computer Use 从结构 Agent 发送 `structure-summary` 到知识库 Agent，并确认目标会话出现 `接收 structure-summary` handoff 消息。
- [x] 用 Computer Use 从组学 Agent 发送 `omics-differential-expression` 到知识库 Agent，并验证目标 Agent 消息流、artifact 列表、notebook 和 workspace session 文件同步。
- [x] 验证目标 Agent 的输入框、消息流、notebook timeline 和 artifact 列表同步更新。本次从知识库 Agent 发送 `knowledge-graph` 到文献 Agent。
- [x] 验证 handoff 状态写入 workspace `.bioagent` session 文件；刷新恢复仍待浏览器手动确认。
- [x] BioAgent 侧：定义 handoff 后请求携带 artifact 摘要和 dataPreview，目标 Agent 可从 prompt 与项目工具 request 两处读取。
- [x] 后续增强：handoff 后自动触发目标 Agent run，而不只是把 artifact 上下文放入目标 Agent 会话。已实现 `handoffAutoRun`：目标 Agent 收到 handoff message 后自动生成面向目标 profile 的 prompt；Computer Use 复验知识库 `knowledge-graph` -> 文献 Agent 自动运行 `TP53 clinical trials`，PubMed 返回 5 条记录，ExecutionUnit `PubMed.eutils.esearch+esummary` / `done`。

### T006 Workspace 与 Resource Explorer 真实文件闭环

#### 目标说明
- 让 BioAgent 选定 workspace 后，聊天记录、artifact、版本快照和用户文件操作都能真实落盘，并能被 Resource Explorer 探索。

#### 成功标准
- 选择 workspace path 后，`.bioagent/workspace-state.json`、`sessions/`、`artifacts/`、`versions/`、`config.json` 被创建或更新。
- Resource Explorer 能列目录、双击进入文件夹、创建文件/文件夹、重命名、删除、刷新、复制路径。
- 浏览器刷新或重启 dev server 后，会话和配置可以恢复。
- workspace writer 未启动时，UI 给出明确错误，不影响本地浏览器状态。

#### TODO
- [x] 用 Computer Use 设置一个干净 workspace path。
- [x] 发送一次 Agent 消息后检查 `.bioagent` 文件是否更新。
- [x] 在 Resource Explorer 创建并重命名一个测试文件夹。Computer Use: 新建 `cu-smoke-folder`，右键菜单重命名为 `cu-smoke-renamed`，shell 确认 `/tmp/bioagent-computer-use-smoke/cu-smoke-renamed` 已落盘。
- [x] 删除 Resource Explorer 测试文件夹。已在用户确认后删除 `/tmp/bioagent-computer-use-smoke/cu-smoke-renamed`，并确认路径不存在。
- [x] 打开 Resource Explorer 并验证 workspace path、`.bioagent` 列表和刷新入口可见。
- [x] 双击进入子目录后刷新列表，验证路径与面包屑/输入框行为。Computer Use: 双击 `cu-smoke-renamed` 后工作目录输入框更新为 `/tmp/bioagent-computer-use-smoke/cu-smoke-renamed`，同步提示指向该目录下 `.bioagent`。
- [x] 关闭 workspace writer 后重复一次操作，验证错误提示可读。已在 `workspaceClient` 包装 fetch 错误；Computer Use 复验停掉 writer 后刷新显示：`Workspace writer unavailable at http://127.0.0.1:5174 while trying to list workspace ... Start npm run workspace:server and retry.`
- [x] 检查版本快照是否记录 new-chat、delete-chat、message edit/delete 等原因。workspace 中已观察到 `new chat archived previous session`、`handoff artifact ...`、`session update` 版本文件与 checksum；代码路径中 delete chat 使用 `deleted current chat`，message edit/delete 使用 `edit message ...` / `delete message ...`。

---

## P1 - 单 Agent 能力补齐

### T007 组学 Agent 从 demo-ready 升级为真实分析

#### 目标说明
- 将组学 Agent 从 record-only/demo 数据推进到能读取用户 workspace 中表达矩阵和 metadata，并通过 BioAgent project tool 执行差异表达或单细胞基础分析。

#### 成功标准
- 用户能在 prompt 中指定 matrixRef、metadataRef、groupColumn、designFormula、alpha。
- BioAgent project tool 运行 DESeq2 / edgeR / Scanpy 或等价工具，返回 `omics-differential-expression` artifact。
- 结果区的 volcano、heatmap、UMAP 由真实 artifact 驱动。
- ExecutionUnit 记录输入文件、数据指纹、参数、软件版本和输出文件。

#### TODO
- [x] 准备一个最小 RNA-seq fixture 放入 workspace：`/tmp/bioagent-computer-use-smoke/fixtures/omics/matrix.csv` 与 `metadata.csv`。
- [x] 用组学 Agent prompt 指定 fixture 路径并验证返回 artifact。Computer Use prompt: `matrixRef=fixtures/omics/matrix.csv metadataRef=fixtures/omics/metadata.csv groupColumn=condition caseGroup=treated controlGroup=control alpha=0.2`。
- [x] 验证 points、heatmap、umap payload 能分别驱动当前注册组件。浏览器结果区显示 5 volcano points、4 UMAP points、5x4 heatmap。
- [x] 将 `BIOAGENT_PROFILES.omics.mode` 从 demo 升级的前置条件列清楚。已切换为 `agent-server`，UI 状态改为 active。
- [x] BioAgent 侧：接入可替代的 bounded local CSV differential runner：读 matrix/metadata、计算 group mean、logFC、pValue、BH FDR。
- [x] BioAgent 侧：定义大文件输入、输出 artifact 文件路径和错误日志返回约定。当前约定为 workspace 内相对路径 `matrixRef/metadataRef`，禁止逃逸 workspace。
- [x] 后续增强：将统计模型版本、设计矩阵、标准化方法和日志文件写入 artifact metadata。BioAgent local CSV runner 现在写入 `designMatrix`、`normalizationMethod`、`statisticalModel`、`outputRef` 和 `logRef`；同时在 workspace `.bioagent/omics/` 写入可审计输出 JSON 与日志 JSON。
- [ ] 可选运行时增强：在 BioAgent 项目路径内安装并接入 DESeq2 / edgeR / Scanpy 真实 runner；不要安装到 AgentServer。

### T008 知识库 Agent 从 demo-ready 升级为真实知识查询

#### 目标说明
- 让知识库 Agent 能围绕 gene/protein/disease/compound 查询 UniProt、PDB、ChEMBL、OpenTargets、ClinicalTrials 等来源，并返回可视化知识图谱。

#### 成功标准
- 输入如「TP53 gene include clinical trials」后，返回真实节点、边、来源、置信度和知识卡片。
- `network-graph` 和 `data-table` 使用 `knowledge-graph` artifact 渲染。
- 每条边具备 relation、evidenceLevel、supportingRefs。
- 能消费文献或结构 Agent handoff 过来的 artifact。

#### TODO
- [x] 用 Computer Use 跑一个 gene 查询。compound 查询待真实 AgentServer tool 接入后再跑。
- [x] 验证 `knowledge-graph` artifact 的 nodes、edges、rows 完整性。
- [x] 验证来源链接、数据库版本或访问日期显示在 claim / ExecutionUnit 中。Computer Use prompt: `TP53 gene include clinical trials，返回 knowledge-graph、来源链接、数据库访问日期和 ExecutionUnit。`；结果：UI 显示 UniProt URL、`accessed_at`、claim supportingRefs、ExecutionUnit `UniProt.uniprotkb.search` / `done`。
- [x] BioAgent 侧：接入 UniProt REST `uniprotkb/search`，返回 accession、protein name、function、source URL 和访问日期；ChEMBL / OpenTargets 仍属后续增强。
- [x] BioAgent 侧：定义跨数据库实体消歧策略，如 gene symbol、UniProt accession、ChEMBL id。当前策略：`(gene_exact:<symbol>) AND (organism_id:9606) AND (reviewed:true)`，优先 reviewed human exact gene symbol。

### T009 对齐工作台从静态展示升级为可保存协商流程

#### 目标说明
- 让 Alignment Workspace 支持真实项目对齐：填写数据资产、目标、AI 指标、生物验证标准、风险和再校准记录，并保存为 workspace artifact。

#### 成功标准
- Computer Use 能完成四步：数据现实摸底、可行性矩阵、项目契约、再校准。
- 每一步的输入可编辑、可保存、可回看。
- 输出项目契约包含双方目标定义、数据要求、成功标准、风险和下一步行动。
- 相关记录进入研究时间线或 `.bioagent` workspace 状态。

#### TODO
- [x] 用 Computer Use 走完当前 Alignment 页面入口，确认当前四步为静态展示，缺少可编辑/保存流程。
- [x] 定义 alignment artifact schema：`alignment-contract` / schemaVersion `1`，顶层包含 `dataReality`、`feasibilityMatrix`、`projectContract`、`recalibrationEvents`。
  - `dataReality`: `{ datasets: [{ id, name, modality, size, owner, location, accessStatus, qualityRisks }], constraints: string[], missingInfo: string[] }`
  - `feasibilityMatrix`: `{ rows: [{ objective, aiMetric, bioValidation, requiredData, feasibility: "ready"|"needs-data"|"blocked", risks, nextAction }] }`
  - `projectContract`: `{ question, scope, successCriteria, dataRequirements, modelAssumptions, wetLabValidation, decisionLog, owners, dueDate }`
  - `recalibrationEvents`: `[{ at, trigger, observation, contractChange, owner, status }]`
- [x] 增加保存到 workspace 的 TODO，并决定是否由 AgentServer 生成初稿。Phase 1 实现 TODO：Alignment Workspace 表单保存为 `.bioagent/artifacts/alignment-contract-<session>.json`，同步写入 session notebook/timeline；AgentServer 可选生成初稿，但人工编辑后的 artifact 以 workspace 版本为准。
- [x] AgentServer 侧：若需要 AI 生成可行性矩阵，定义 alignment agent id 和输出 JSON 约定。约定 agent id 为 `bioagent-alignment`，`metadata.project=BioAgent` 且 `agent.metadata.bioAgentProfile=alignment`；输出必须为 `{ message, claims, uiManifest, executionUnits, artifacts: [alignment-contract] }`，ExecutionUnit tool 建议 `alignment.contract.draft`，status 可为 `done|record-only`。

### T010 ExecutionUnit 导出与可复现性检查

#### 目标说明
- 确保每次 Agent 回复都能沉淀为可审计、可导出的 ExecutionUnit，而不只是 UI 上的一行记录。

#### 成功标准
- 导出的 JSON Bundle 包含 session、messages、claims、artifacts、executionUnits、notebook 和版本信息。
- 每个 ExecutionUnit 至少包含 tool、params、status、hash；真实计算任务还需包含 environment、inputData、dataFingerprint、databaseVersions、outputArtifacts。
- 用户能从导出内容判断如何重放或审计该步骤。

#### TODO
- [x] 用 Computer Use 在知识库 Agent 导出一次 JSON Bundle；文献/结构真实导出待 AgentServer 成功产出 ExecutionUnit。
- [x] 检查 record-only 和 failed 两类运行结果；done/fallback 待真实工具 run 验证。
- [x] 验证导出文件名、内容和当前 Agent 会话一致。
- [x] BioAgent 侧：要求真实工具调用返回 tool name、params、environment、input/output artifact id。项目工具已为 PubMed/RCSB/AlphaFold/UniProt/omics CSV run 返回这些字段。
- [x] 后续评估 Snakemake / Nextflow / Notebook 导出格式，但 Phase 1 先保证 JSON Bundle 稳定。结论：Phase 1 保持 JSON Bundle 为唯一规范审计产物；Snakemake / Nextflow 只适合后续多步骤文件型 pipeline DAG，Notebook 导出可作为 JSON Bundle 的只读渲染层，不能替代 `executionUnits`、artifact id、hash 和 metadata。
