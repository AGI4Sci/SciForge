# BioAgent Computer Use Smoke

最后更新：2026-04-20

## 启动顺序
- AgentServer: `/Applications/workspace/ailab/research/app/AgentServer`，监听 `http://127.0.0.1:18080`。
- BioAgent Web UI: `npm run dev`，监听 `http://localhost:5173/`。
- Workspace writer: `npm run workspace:server`，监听 `http://127.0.0.1:5174/`。

## 本次环境
- Browser: Microsoft Edge
- UI URL: `http://127.0.0.1:5173/`
- Workspace path: `/tmp/bioagent-computer-use-smoke`
- Workspace writer check: `GET /api/bioagent/workspace/list?path=/tmp/bioagent-computer-use-smoke` 返回 `ok: true`
- AgentServer smoke: `POST /api/agent-server/runs` 在携带 `agent.workspace` 和 `agent.workingDirectory` 后返回成功；仅作为通用 fallback。
- BioAgent project tool smoke: `POST /api/bioagent/tools/run` 由 workspace service 执行 profile-specific 工具，文献返回 PubMed `paper-list`，结构返回 RCSB / AlphaFold DB `structure-summary`。
- Omics fixture: `/tmp/bioagent-computer-use-smoke/fixtures/omics/matrix.csv` 与 `metadata.csv`，用于 `omics.local-csv-differential` smoke。

## 路线
- 打开 BioAgent 首页，确认研究概览、Agent Profiles、Settings、单 Agent 工作台可访问。
- 在 Settings 中设置 workspace path 为 `/tmp/bioagent-computer-use-smoke`，确认 `.bioagent` 目录与 config/state/session 文件写入。
- 进入文献 Agent，新建聊天，发送 prompt: `KRAS G12D 胰腺癌靶向治疗近三年证据，请返回 paper-list JSON artifact、claims、ExecutionUnit。`
- 观察到 streaming event 面板、取消请求按钮、运行中引导输入框可用；取消后 UI 写入 failed system message: `AgentServer 流式请求已取消或超时。`
- 进入知识库 Agent，新建聊天，发送 prompt: `TP53 gene include clinical trials，返回 knowledge-graph、来源链接、数据库访问日期和 ExecutionUnit。`
- 确认 BioAgent project tool 通过 UniProt REST 生成 `knowledge-graph` artifact，包含 `nodes`、`edges`、`rows`，结果区渲染 network graph / data table / evidence matrix。
- 打开 ExecutionUnit tab，确认 `UniProt.uniprotkb.search` 记录 entity、query、status、hash。
- 点击导出 JSON Bundle，下载文件 `execution-units-knowledge-session-knowledge-*.json`。
- 在知识库 Agent 结果区点击 `发送 ARTIFACT 到 文献 Agent`，确认文献 Agent 收到 handoff message，并在 notebook timeline 记录 `接收 knowledge-graph`。
- 确认 handoff 后目标 Agent 自动触发 BioAgent project tool run：知识库 `knowledge-graph` -> 文献 Agent 自动提交 `TP53 clinical trials，返回 paper-list JSON artifact、claims、ExecutionUnit。`，并返回 PubMed 5 条记录与 `done` ExecutionUnit。

## 发现
- 修复前通用 AgentServer 直接 smoke 成功，但 BioAgent 文献 Agent 的结构化长 prompt 会持续输出大量 `usage-update`，取消前 usage 超过 `135k` total tokens，未稳定收束为 `paper-list` artifact。
- 已将 BioAgent 专属有边界结构化执行迁回 BioAgent workspace service：前端优先调用 `POST /api/bioagent/tools/run`，失败时才 fallback 到 AgentServer 通用 run。
- 浏览器文献复验曾暴露包装 prompt 污染 PubMed query 的问题；现在项目工具直接接收原始用户 prompt 与 artifact 摘要。复验后 paper cards 展示 PubMed 链接，evidence matrix 显示支持证据，ExecutionUnit 为 `PubMed.eutils.esearch+esummary` / `done`。
- 结构 project tool smoke `PDB 7BZ5` 返回 RCSB title、resolution、`.cif` dataRef 和 `RCSB.core.entry` ExecutionUnit；浏览器 prompt `分析 PDB 7BZ5，关注 ligand pocket 和 142-158 残基，返回 structure-summary artifact 和 ExecutionUnit。` 返回 runtime `structure-summary`，结果区 molecule-viewer 展示 `PDB=7BZ5`、`residues=142-158`，ExecutionUnit tab 展示 `RCSB.core.entry` / `done`。
- 结构 project tool smoke `UniProt P04637` 返回 AlphaFold DB dataRef 与 ExecutionUnit `AlphaFoldDB.prediction` / `done`。AlphaFold API 对 Node 默认 fetch 曾返回 403，已通过显式 `User-Agent` 修复。
- 组学 Agent 已从前端 local adapter 路径切到 BioAgent project tool 优先。浏览器 prompt `matrixRef=fixtures/omics/matrix.csv metadataRef=fixtures/omics/metadata.csv groupColumn=condition caseGroup=treated controlGroup=control alpha=0.2` 返回 `omics.local-csv-differential` ExecutionUnit，状态 `done`，结果区使用 runtime `omics-differential-expression` artifact 渲染 volcano/heatmap/UMAP。
- BioAgent omics runner 已补齐审计 metadata：artifact metadata 记录 `designMatrix`、`normalizationMethod`、`statisticalModel`、`outputRef`、`logRef`；workspace `.bioagent/omics/` 会写入输出 JSON 与日志 JSON。DESeq2 / edgeR / Scanpy 后续必须安装并接入 BioAgent 项目环境，不放入 AgentServer。
- 文献 `paper-list`、结构 `structure-summary`、组学 `omics-differential-expression` handoff 到知识库 Agent 成功，目标会话分别出现 `接收 paper-list`、`接收 structure-summary`、`接收 omics-differential-expression` 消息。
- handoff 自动运行已接入：`handleArtifactHandoff` 写入目标会话后设置 `handoffAutoRun`，ChatPanel 在目标 Agent 激活后消费请求并触发 BioAgent project tool，失败时再回退 AgentServer stream。复验后文献 Agent 显示 `PubMed returned 5 paper records for: TP53 clinical trials`，ExecutionUnit params 包含 query/retmax，状态 `done`。
- 知识库 Agent 已从 demo-ready 升级为 BioAgent project tool 优先；浏览器 prompt `TP53 gene include clinical trials...` 返回 UniProt reviewed human accession `P04637`、source URL、访问日期、节点与边，ExecutionUnit 为 `UniProt.uniprotkb.search` / `done`。ChEMBL / OpenTargets 仍待真实 native tool 接入。
- workspace 版本快照检查：`/tmp/bioagent-computer-use-smoke/.bioagent/versions/` 已记录 `new chat archived previous session`、`handoff artifact ...`、`session update` 等原因与 checksum；delete / edit 原因由前端对应操作路径生成，未在本次 smoke 中执行删除。
- 修复前 stream events 会跨 Agent 残留；已调整 ChatPanel 在切换 agent/session 时清空 stream events、错误和引导队列。
- Resource Explorer smoke: 新建文件夹 `cu-smoke-folder`，右键菜单重命名为 `cu-smoke-renamed`，shell 确认目录已落盘；双击进入后工作目录输入框更新为 `/tmp/bioagent-computer-use-smoke/cu-smoke-renamed`。停掉 workspace writer 后点击刷新曾只显示 `Failed to fetch`；已改为显示 writer URL、操作名和重试建议：`Workspace writer unavailable at http://127.0.0.1:5174 while trying to list workspace ... Start npm run workspace:server and retry.`
- 用户确认后已删除 Resource Explorer 测试目录 `/tmp/bioagent-computer-use-smoke/cu-smoke-renamed`。
- ExecutionUnit 导出格式评估：Phase 1 继续以 JSON Bundle 作为规范审计产物；Snakemake / Nextflow 后续只适合真实多步骤文件型 pipeline DAG，Notebook 导出可作为 JSON Bundle 的只读展示层。

## 后续固定检查
- 每次真实 BioAgent project tool 能力变更后，至少跑文献 Agent 和结构 Agent 各一次浏览器 prompt。
- 每次 workspace writer 变更后，检查 `.bioagent/workspace-state.json`、`sessions/`、`artifacts/`、`versions/`。
- 每次 handoff 变更后，检查源 Agent artifact、目标 Agent handoff message、目标 notebook record、刷新恢复。
