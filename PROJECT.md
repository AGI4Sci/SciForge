# BioAgent - PROJECT.md

最后更新：2026-04-19

## 使用约定
- 本文档作为 BioAgent 工程任务板使用，只保留正在推进或待推进的任务。
- 产品与架构基准见 `docs/BioAgent_Project_Document.md`。
- 当前 Web UI 位于 `ui/`，本项目服务运行在 `http://localhost:5173/`。
- 优先复用 `/Applications/workspace/ailab/research/app/AgentServer` 快速开发 agent；当前 AgentServer 运行在 `http://127.0.0.1:18080`。
- Phase 1 优先目标：先做好单 Agent 独立运行，再做 Agent 间数据打通，最后再做多 Agent 编排。
- 代码路径必须尽量保持唯一真相源：引入新链路或发现冗余时必须删除、合并或明确降级旧链路，避免两个并行逻辑长期共存。
- 开发过程中发现新的 TODO，优先追加到本文档。

## 当前状态
- 已有 React + Vite Web UI，包含研究概览、单 Agent 工作台、对齐工作台、研究时间线。
- 已有 4 个 Agent profile mock：文献 Agent、结构 Agent、组学 Agent、知识库 Agent。
- 单 Agent 工作台已有真实对话入口：`ChatPanel` 可调用 AgentServer `POST /api/agent-server/runs`，支持 loading、取消、错误提示和清空会话。
- 对话、run、claim、UIManifest、ExecutionUnit、artifact、notebook 已建立前端运行时模型，并按 Agent 独立持久化到 `localStorage`。
- Agent profile 契约已集中到 `ui/src/agentProfiles.ts`：AgentServer id、native tools、fallback tools、输入契约、artifact schema、默认 UIManifest slots 和 ExecutionUnit defaults 统一从这里生成。
- 右侧结果区已接入 UIManifest component registry，可按 agent 返回的 slot 动态渲染 paper cards、结构查看器、组学图表、网络图、证据矩阵、ExecutionUnit 和 notebook timeline；结构/组学/网络组件已能消费 artifact payload，并对 artifact 缺失 / 未注册组件提供 fallback 诊断。
- ExecutionUnit 当前可从 agent 响应标准化生成 record-only/run 记录，支持当前会话 JSON bundle 导出，并已预留 code、seed、inputData、databaseVersions、outputArtifacts 等可复现字段；尚未对接后端真实工具执行状态和 pipeline 导出。
- 已新增 `npm run smoke:fixtures`，用 4 个 Agent 的标准 artifact fixture 回归验证 profile -> adapter -> UIManifest/ExecutionUnit 协议链路。

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
- [x] 支持 non-streaming 版本先跑通；如 AgentServer 支持 SSE / chunk，再追加流式渲染。
- [x] 增加 loading、disabled、retry、abort 和空输入校验。
- [x] 为请求失败、超时、服务未启动分别展示明确错误。
- [x] 本地验证：`npm run typecheck`、`npm run build`。
- [x] 直接调用 `/api/agent-server/runs` 完成一次文献 Agent smoke，并记录 AgentServer backend 实际响应质量。
- [ ] 浏览器手动发送至少 2 个 Agent 的问题。

### T002 标准化 Agent 响应协议

#### 目标说明
- 对齐设计文档中的“固定组件层 + 动态编排层”：agent 不生成 UI 代码，只返回结构化 JSON 指令驱动已有组件。
- 建立前后端共享的最小响应协议，让 agent 回复能被 ChatPanel、ResultsRenderer、EvidenceMatrix、ExecutionPanel、NotebookTimeline 同时消费。

#### 成功标准
- 单次 agent 响应可以包含：
  - `message`：面向用户的自然语言回答。
  - `claims`：事实 / 推断 / 假设，带 confidence 和 evidence level。
  - `reasoningTrace`：可展开的推理链摘要。
  - `uiManifest`：结果区应显示的组件、排序、输入参数。
  - `executionUnits`：工具、参数、环境、数据指纹、状态。
  - `artifacts`：文献、结构、组学图表、知识网络等结果数据。
- 前端对未知字段容错，对未知组件显示“未注册组件”占位，而不是崩溃。
- 协议能覆盖当前 4 个 Agent 的 mock 场景。

#### TODO
- [x] 在 `ui/src/types.ts` 或 `ui/src/domain.ts` 建立 BioAgent 运行时类型。
- [x] 明确 `AgentId` 与 AgentServer agent 名称之间的映射表。
- [x] 定义 `UIManifestSlot`：`componentId`、`title`、`props`、`artifactRef`、`priority`。
- [x] 定义 `EvidenceClaim`：`text`、`type`、`confidence`、`evidenceLevel`、`supportingRefs`、`opposingRefs`。
- [x] 定义 `ExecutionUnit`：`id`、`tool`、`params`、`status`、`environment`、`dataFingerprint`、`artifacts`。
- [x] 写一个 `normalizeAgentResponse` adapter，兼容 AgentServer 当前响应和未来标准协议。
- [x] 给 adapter 补充基础单测或最小 fixture 验证。

### T003 对话驱动结果区动态更新

#### 目标说明
- 让 agent 回复不只停留在聊天气泡中，还能更新右侧结果区：文献卡片、分子查看器、火山图、网络图、证据矩阵、ExecutionUnit、研究记录。
- 保持设计文档原则：固定组件复用，动态 JSON 编排。

#### 成功标准
- 文献 Agent 回复可更新 PaperCardList / EvidenceMatrix。
- 结构 Agent 回复可更新 MoleculeViewer 参数，例如 PDB ID、ligand、highlight residues。
- 组学 Agent 回复可更新 volcano / heatmap / UMAP 的 artifact 数据或占位状态。
- 知识库 Agent 回复可更新 NetworkGraph 节点和边。
- 每次 agent 回复自动追加一条 NotebookTimeline 记录。

#### TODO
- [x] 将 `ResultsRenderer` 输入从 `agentId` 扩展为 `agentId + currentRunState`。
- [x] 将 `paperCards`、`executionUnits`、`timeline` 从纯 mock 数据迁移为可被运行时覆盖的数据源。
- [x] 建立 component registry：`paper-card-list`、`molecule-viewer`、`volcano-plot`、`heatmap-viewer`、`umap-viewer`、`network-graph`、`evidence-matrix`、`execution-unit-table`、`notebook-timeline`。
- [x] 对每个组件定义最小 props schema 和 fallback empty state。
- [x] 当 agent 返回多个 manifest slot 时，按 priority 和当前 tab 渲染。
- [x] 对 artifactRef 找不到、组件未注册、数据格式错误提供诊断 UI。

### T004 会话与研究记录持久化

#### 目标说明
- 将对话、agent 回复、证据、ExecutionUnit 和 UIManifest 沉淀为本地可恢复研究记录，符合“从聊天记录到可执行 Pipeline”的方向。

#### 成功标准
- 刷新页面后可以恢复最近的会话。
- 每个 Agent 的会话、结果和 timeline 独立保存。
- 用户可以清空当前 Agent 会话，不影响其他 Agent。
- 后续可平滑替换为后端项目存储。

#### TODO
- [x] 先用 localStorage 实现 `bioagent.sessions.v1`。
- [x] 定义 session schema：`sessionId`、`agentId`、`messages`、`runs`、`artifacts`、`updatedAt`。
- [x] 增加 schema version，未来迁移时不破坏旧数据。
- [x] 在 UI 增加清空会话、导出 JSON 的入口。
- [x] 避免保存超大 artifact；大对象只保存 metadata 或 artifactRef。

---

## P1 - Phase 1 单 Agent 能力补齐

### T005 文献 Agent MVP

#### 目标说明
- 优先做成第一个可用单 Agent：支持生命科学文献问题、证据分级、矛盾证据并排展示。

#### TODO
- [x] 明确文献检索输入：query、时间范围、物种、疾病/靶点、最大结果数。
- [ ] 接入 AgentServer 文献工具或临时 search adapter。
- [x] 定义 paper-list artifact schema：title、authors、journal/source、year、url、abstract、evidenceLevel。
- [x] 生成 claim-evidence matrix，区分 supporting / opposing evidence。
- [x] 协议要求每个事实性陈述尽量带 source refs。
- [x] 支持“展开推理链”和“查看来源”。

### T006 结构 Agent MVP

#### 目标说明
- 支持 PDB / AlphaFold DB 查询、结构查看器参数更新、关键残基和口袋信息展示。

#### TODO
- [x] 定义结构输入：PDB ID、UniProt ID、mutation、ligand、residue range。
- [x] 将 MoleculeViewer 从纯示意升级为可接收结构参数。
- [x] 定义 structure-summary artifact schema：pLDDT、resolution、pocket volume、mutation risk 等 metrics。
- [x] 生成结构分析 ExecutionUnit 草案。
- [ ] 对无结构、低置信度结构、无法加载结构提供 fallback。

### T007 组学 Agent MVP

#### 目标说明
- 支持上传或引用示例表达矩阵，生成差异分析 ExecutionUnit 和可视化结果。

#### TODO
- [x] 定义输入数据契约：表达矩阵、metadata、分组、design formula。
- [x] 先支持 demo dataset / record-only ExecutionUnit。
- [x] 火山图、热图、UMAP 支持从 artifact 数据渲染。
- [x] 展示 p-value/log2FC 派生图形；FDR 和通路富集结果等待真实 omics backend artifact。
- [x] 区分真实计算结果和 mock / demo 数据。

### T008 知识库 Agent MVP

#### 目标说明
- 支持靶点、疾病、药物的知识库查询，生成成药性和通路网络视图。

#### TODO
- [x] 定义查询输入：gene / protein / disease / compound。
- [ ] 接入 UniProt、PDB、ChEMBL、OpenTargets 等可用工具或 AgentServer proxy。
- [ ] 返回知识卡片：功能、别名、疾病关联、药物、临床试验。
- [x] NetworkGraph 支持动态节点、边；证据来源和置信度等待真实 knowledge backend artifact。
- [x] 将知识库结果转换为可被其他 Agent 复用的标准 artifact schema。

---

## P1 - 可复现与证据基础设施

### T009 ExecutionUnit 数据模型与导出

#### 目标说明
- 把工具调用从聊天文本中抽离为确定性执行单元，为后续 Snakemake / Nextflow / Jupyter 导出打基础。

#### TODO
- [x] 建立 ExecutionUnit schema：代码/工具、参数、环境、随机种子、输入数据指纹、数据库版本、输出 artifact。
- [x] 前端 ExecutionPanel 渲染真实 ExecutionUnit 列表。
- [x] 支持导出当前会话 ExecutionUnit JSON bundle。
- [x] 标记状态：planned、running、done、failed、record-only。
- [ ] 后续对接 AgentServer 实际执行状态。

### T010 Evidence / Claim 统一模型

#### 目标说明
- 将设计文档中的“文献证据分级、统计置信度、假设 vs 事实区分”落成统一数据结构和 UI。

#### TODO
- [x] 统一 `EvidenceLevel`，补充 experimental、review、database、preprint 等生命科学常见来源类型。
- [x] 统一 `ClaimType`：fact、inference、hypothesis。
- [x] 给每个 claim 支持 `confidence`、`supportingRefs`、`opposingRefs`、`updatedAt`。
- [x] EvidenceMatrix 支持从 agent 响应渲染，不再写死 KRAS 示例。
- [x] 在消息气泡、结果区、时间线保持同一套标签语义。

---

## P2 - Web UI 体验完善

### T011 工作台交互打磨

#### TODO
- [x] 发送按钮绑定 click 和 Enter，Shift+Enter 换行或改为 textarea。
- [x] 消息列表自动滚到底部。
- [x] 用户手动上滚时不强制跳动。
- [x] 长推理链可折叠。
- [x] 长来源列表可折叠。
- [x] Agent 切换时保留各自滚动位置和输入草稿。
- [x] 顶部搜索框支持跳转到 Agent / timeline / alignment / workbench。

### T012 响应式与可访问性

#### TODO
- [ ] 检查 1440px、1024px、768px、390px 视口下工作台布局。
- [ ] 小屏下 ChatPanel 和 ResultsRenderer 改为 tabs 或上下布局。
- [x] 图表容器保持稳定尺寸，避免动态内容导致布局跳动。
- [x] 所有 icon button 补齐 tooltip / aria-label。
- [ ] 确保按钮文字、badge、tab 在中文长文本下不溢出。

### T013 Mock 数据降级策略

#### 目标说明
- 保留演示价值，但明确 mock 和真实运行的边界，避免误导。

#### TODO
- [x] 将 demo seed 数据移动到 `ui/src/demoData.ts`。
- [x] UI 明确标记 demo / agent artifact / record-only 状态。
- [ ] AgentServer 连接成功后默认隐藏 demo seed，或作为“加载示例”入口。
- [x] README 补充 demo 模式和真实 agent 模式的启动方式。

---

## P2 - 对齐工作台与多角色视图

### T014 对齐工作台从静态流程升级为可编辑流程

#### TODO
- [ ] 数据摸底表单支持输入样本量、模态、标签、批次、验证资源。
- [ ] 可行性矩阵支持 agent 生成建议后人工编辑。
- [ ] 项目契约支持导出 JSON / Markdown。
- [ ] 持续校准支持从新的模型结果或实验结果触发。

### T015 多角色视图真正影响输出

#### TODO
- [ ] role tabs 传入 AgentRequest。
- [ ] 同一 agent 响应按角色生成不同摘要：实验生物学家、生信分析师、PI、临床医生。
- [ ] 结果区根据角色调整默认 tab 和组件优先级。
- [ ] 时间线记录当前角色视图。

---

## P3 - Agent 间数据打通与编排预备

### T016 标准 Artifact 交换格式

#### TODO
- [x] 定义 `Artifact`：id、type、producerAgent、schemaVersion、metadata、dataRef。
- [x] 文献 Agent 输出靶点列表可作为结构 Agent / 知识库 Agent 输入的 schema consumers 已声明。
- [x] 组学 Agent 输出差异基因可作为文献 Agent / 知识库 Agent 输入的 schema consumers 已声明。
- [x] UI 提供“发送到另一个 Agent”操作。

### T017 编排层预研

#### TODO
- [ ] 只做协议预留，不急于实现多 Agent 自动编排。
- [ ] 定义跨 Agent run graph 的最小节点/边模型。
- [ ] 时间线能表达一个问题拆成多个 Agent run。
- [ ] 等 T001-T010 稳定后再进入 Phase 3。

---

## 近期推荐开发顺序
1. T001：先跑通真实 AgentServer 对话请求。
2. T002：固定响应协议和 adapter，避免 UI 直接耦合后端临时格式。
3. T003：让对话驱动右侧结果区，形成 BioAgent 区别于普通聊天的核心体验。
4. T004：持久化会话和研究记录，防止刷新丢失上下文。
5. T005：以文献 Agent 作为第一个完整单 Agent MVP。

## 最新验证记录
- 2026-04-19：`npm run test` 通过。
- 2026-04-19：`npm run smoke:fixtures` 通过，覆盖 literature、structure、omics、knowledge 的标准 artifact fixture。
- 2026-04-19：`npm run typecheck` 通过。
- 2026-04-19：`npm run build` 通过；Vite 提示主 chunk 超过 500 kB，暂不影响运行。
- 2026-04-19：`npm run dev` 可访问 `http://127.0.0.1:5173/`。
- 2026-04-19：AgentServer `GET http://127.0.0.1:18080/health` 连通。
