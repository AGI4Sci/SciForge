<p align="center">
  <img src="src/asset/img/logo.png" width="96" alt="SciForge 图标">
</p>

# SciForge

[English](./README.en.md) | 简体中文

> SciForge 是面向科学研究与复杂工程的本地 AI 工作台。它把代码、论文、科学数据、图表、写作、自动化流程、证据链和多 runtime Agent 放在同一个桌面环境中，并通过统一的 Model Router 管理文本、视觉和科学多模态能力。

[官网](https://sciforge.ai) | [下载](https://sciforge.ai)

[![GitHub release](https://img.shields.io/github/v/release/XingYu-Zhong/SciForge?label=github)](https://github.com/XingYu-Zhong/SciForge/releases)
[![License](https://img.shields.io/github/license/XingYu-Zhong/SciForge)](./LICENSE)

<p align="center">
  <a href="src/asset/img/code.gif">
    <img src="src/asset/img/code.gif" width="720" alt="SciForge Code 工作台演示">
  </a>
</p>

## 为什么是 SciForge

科研任务很少只是一次问答。真实研究通常要同时处理论文、代码、实验脚本、蛋白序列、分子结构、单细胞表达、PDF 图表、运行日志、失败记录、研究笔记、协作汇报和后续计划。通用聊天窗口可以回答问题，但很难把这些对象组织成一个长期可追踪、可复盘、可交接的工作环境。

SciForge 的定位是 **research-native AI workbench**：

- 研究对象不只当作附件，而是进入科学多模态、证据、写作、图表和汇报链路。
- 模型调用不散落在应用各处，而是统一经过 Model Router 与用户配置的 provider。
- Agent 不只聊天，还能读写工作区、运行命令、调用 MCP worker、生成计划、审查改动和延续长期任务。
- 研究过程不只看最终回答，还保留 trace、artifact、decision、review packet 和 Evidence DAG。
- 桌面、Workflow、Write、Connect phone、Schedule 与多 runtime 共享同一套运行时治理边界。

一句话：SciForge 想成为研究人员桌面上的“可审计科研 Agent 操作系统”，而不是又一个聊天壳。

## 面向科研场景的特色

| 特色 | 说明 |
| --- | --- |
| 科学多模态 Router | 将蛋白序列、蛋白结构、小分子、单细胞表达等非文本科学输入路由到领域 translator，先生成文本证据，再交给主 Agent 推理。 |
| Evidence DAG | 将 Agent trace 转成 claim-evidence DAG，用 NLI judge 验证支持边，并提供 PROV-JSON、指标、脆弱性分析和 Workbench 内嵌视图。 |
| Paper Radar | 面向课题组的文献雷达：维护研究 profile，同步 arXiv / bioRxiv 元数据，按关键词、排除词、分类、来源和新近度生成每日 digest。 |
| Scientific Plotting | 从论文图、截图或 PDF 裁剪区域提取 `FigureStyleSpec`，用受控 Matplotlib 模板出图、评分和保守修复，服务论文图复现和风格统一。 |
| PPT Master | 把 SciForge 里的 figure、证据和研究叙事送入科研汇报输出阶段，生成可检查布局、可导出的 PPTX 项目。 |
| Canvas | 不是单独的“画图功能”，而是视觉 artifact 的审阅层：把 scientific plot、生成图、PPT slide/export 摆在同一张画布上批注，导出 review packet，再让 Agent 按批注意图修改。 |
| Write | 不是普通 Markdown 编辑器，而是论文阅读与研究写作台：PDF 文本/视觉锚点批注、批注包导入导出、选区问答、写作空间检索增强、inline completion 和多格式导出。 |

## 科学多模态能力

SciForge 的科学多模态设计不是“把所有东西都塞给一个通用大模型”。核心原则是：**先由专用领域模型把科学对象翻译成可审计文本证据，再由主 Agent 做任务推理**。

当前科学多模态 worker 覆盖四类原生输入：

| 科学输入 | 路由专家 | 典型任务 |
| --- | --- | --- |
| 蛋白序列 FASTA / raw sequence | `esm2text-protein` | 将序列转成可能的功能描述和不确定性证据 |
| 蛋白 3D 结构 PDB / mmCIF | `prot2text-structure` | 从结构输入生成函数描述证据 |
| 小分子 SMILES / SDF / MOL | `biot5-molecule` | 将分子表示翻译成结构/性质相关 caption |
| 单细胞表达 / marker list | `c2s-singlecell` | 将 cell sentence 或表达信号转成细胞类型文本线索 |

Model Router 会识别结构化 workspace ref 和科学文件扩展名，例如 `.fasta`、`.smi`、`.mol`、`.sdf`、`.pdb`、`.cif`、`.vcf`、`.bed`、`.seq`。当 `SCIFORGE_SCIMODALITY_SERVICE_URL` 与 token 配置好时，它会调用科学多模态 worker；未配置时，安全可读文本才会被按文本内联，二进制或不可理解输入会明确降级。

这条链路有几条硬边界：

- 专家模型需要用户或机构自行配置，桌面包不默认分发权重。
- 不用通用 LLM 假装读懂科学模态；没有合适 native-to-text 专家时宁可拒绝或降级。
- 每次翻译结果带 provenance、expert id、modality 和 raw output，最终回答中可透明展示。
- GPU 专家调用、重试、超时和 provider 凭据都留在 worker / Model Router 边界。

## 科研工作流

### 1. 发现与吸收论文

- `research_search` MCP worker 支持 arXiv、bioRxiv、Europe PMC、Semantic Scholar 和可选 CNS web search。
- Paper Radar 可以维护教授或课题组 topic profile，按关键词、排除词、分类、来源和新近度排名论文。
- 本地 SQLite 只保存元数据，不默认镜像 arXiv 或批量下载 PDF。
- Write 的 PDF 阅读、搜索、批注、导出包和选区问答适合把论文阅读变成可复用研究资料。

### 2. 理解科学对象

- 上传或引用科学文件后，Model Router 可把蛋白、结构、分子、单细胞等对象交给科学多模态 translator。
- 图片、截图、图表等视觉材料归 Model Router 的视觉输入链路处理；科学对象归科学多模态 Router 处理。
- Translation raw output 会保留给用户审阅，避免最终回答掩盖专家模型到底说了什么。

### 3. 复现、运行和验证

- Code 工作台围绕真实 workspace 工作：读文件、运行命令、修改代码、审查 diff、维护计划。
- Runtime Guard、审批、sandbox、tool storm 防护、上下文压缩和 usage telemetry 让长任务更可控。
- Runtime Inspector、workspace-intel、search、schedule 等 worker 提供项目理解、巡检、调度和自动化能力。

### 4. 形成证据链

- Evidence DAG 从 completed turn feed 中抽取 claim、source、observation、conclusion 与 supports / contradicts 边。
- 支持 NLI verify、metrics、load-bearing node、fragility、hidden shared-source 和 read-only reconcile what-if。
- Workbench 右侧面板可以直接查看当前 thread 对应的证据图。

### 5. 产出图表、写作和汇报

- Scientific Plotting 从参考图或论文 PDF 裁剪区域提取 `FigureStyleSpec`，再生成受控图表。
- Canvas 把图、PPT slide 和生成图片放进可批注的本地画布，并把人工批注整理成 Agent 可消费的 review packet。
- PPT Master worker 作为科研展示输出阶段，接收 SciForge figure assets，生成受控汇报项目并做布局 QA。
- Write 管理论文阅读批注、实验记录、综述草稿、报告写作和多格式导出。

## 工作台组成

### Code

Code 是主工作台。你可以选择本地工作目录，让 Agent 围绕真实项目读取文件、运行命令、修改代码、总结结构、排查错误、生成计划和审查改动。

适合：

- 复现论文代码、整理实验脚本、分析失败日志。
- 在同一线程中保留需求、计划、命令输出、文件改动和后续 Todo。
- 用 `/plan`、`/review`、side conversation、child agents 和会话压缩管理长周期任务。
- 在 diff 面板中检查 Agent 改动后再决定继续、修正或提交。

### Workflow

Workflow 把重复科研操作做成可复跑流程。它支持可视化节点、触发器、LLM、HTTP、代码执行、条件分支、循环、合并、人工审批和输出节点。

关键点：

- LLM 节点只使用 Model Router。
- 手动触发、计划触发、webhook 触发共享 workflow 数据结构。
- workflow 可以作为 MCP worker 暴露给 Agent 调用。
- 节点运行有日志、历史结果和错误状态，便于复盘。

### Write

Write 是研究写作空间，面向论文笔记、综述草稿、实验记录、技术文档和研究报告。

它的特色不在“能写 Markdown”，而在把论文阅读、批注和写作连续起来：

- Markdown 文件树、新建、重命名、删除和保存状态，适合把一个课题的笔记、草稿和材料放在同一写作空间里。
- Source / Rich / Live / Split / Preview 多种编辑模式。
- PDF 阅读、文本搜索、视觉选区锚点、批注线程、导入导出批注包，适合文献精读和协作审阅。
- 当前文档导出为 `HTML / PDF / DOC / DOCX`。
- 选区 inline agent、短补全、长补全、术语传播和写作空间检索增强，帮助草稿延续术语、事实和上下文。

### Connect phone 与 Schedule

Connect phone 让 Agent 不只等待桌面输入。你可以把飞书 / Lark / 微信等渠道接到后台线程，让研究助理在 IM 中接收任务、总结会话、切换项目或继续执行计划任务。

Schedule worker 支持一次性、每日、间隔或手动运行的任务。定时任务仍复用 AgentRuntime 和 Model Router 边界，而不是另开一套 provider 链路。

### Scientific Plotting、Canvas 与 PPT Master

这三个模块构成科研成果的视觉产出链：

1. Scientific Plotting 读取结构化数据和 `FigureStyleSpec`，生成受控 PNG artifact 与 manifest。
2. Canvas 导入 scientific plot、生成图、PPT slide/export，支持批注和 review packet。
3. PPT Master 接收 SciForge figure assets，生成科研汇报项目、做布局检查并导出 PPTX。

这条链路的目标不是让 Agent 任意执行绘图脚本，而是让出图、审阅和汇报都留在可控、可复查的 artifact 轨迹里。

## 解耦合设计

Model Router、AgentRuntimeHost、worker/MCP、本地数据和发布审计边界本身不是科研特色；它们更像 SciForge 能持续扩展科研能力的解耦合设计。核心思路是：GUI 负责交互，runtime 负责任务执行，Model Router 负责模型出口，多模态和科研能力由独立 worker 承载。

<p align="center">
  <a href="src/asset/img/framework.png">
    <img src="src/asset/img/framework.png" width="860" alt="SciForge 框架图">
  </a>
</p>

上图概览了 SciForge 从桌面工作台、运行时治理、Model Router 到科学 worker / MCP 插件的分层关系。交互层、Agent 执行层、模型出口和科研能力扩展被拆开，便于在保持本地可审计边界的同时持续接入新的科学工具链。

```text
Renderer (React + Workbench / Write / Workflow / Connect phone)
  -> preload: window.sciforge.*
  -> main: AgentRuntimeHost + Runtime Governance
  -> runtime adapter: SciForge Runtime | Codex | Claude Code
  -> native runtime service / app-server
  -> Model Router (/v1/responses compatible)
  -> user-configured providers and translator workers
```

Model Router 是模型出口和多模态入口：

```text
workspace refs / user input
  -> Model Router
    -> scientific modality translator (protein / structure / molecule / single-cell)
    -> vision translator
    -> text reasoner
  -> routed response + trace bundle
  -> AgentRuntime event stream + Evidence DAG feed
```

### SciForge Runtime

SciForge Runtime 是默认本地 Agent 运行时。它以本地 HTTP/SSE 服务连接 GUI 和 agent loop，负责线程、事件、工具调用、审批、缓存、上下文整理和长期会话状态。

它的重点是 **高 Token ROI**：

- 稳定 system prompt、工具 schema 和不可变前缀，让 provider 缓存更容易命中。
- 对超长工具结果、长参数、base64 payload 和重复工具循环做请求边界压缩。
- 用 MCP search / describe / call 渐进发现工具，避免每轮都塞入完整工具目录。
- 记录 cache hit/miss、token 用量、事件状态和错误原因。
- 让 Code、Write、Workflow、Connect phone 和 Schedule 共享运行时纪律。

### Model Router

Model Router 提供 Responses-compatible `/v1/responses` facade，负责：

- 管理 public model alias、provider profile、runtime API key 和能力声明。
- 处理图片、截图、图表和关键帧等视觉输入，将其转成自然语言 observation。
- 将科学对象交给科学多模态 worker，统一把 scientific evidence 注入主 Agent 上下文。
- 运行有界 supplement loop，让文本 reasoner 在需要时请求更多视觉信息。
- 写入 refs-first trace bundle，保存 role alias、hash、状态和脱敏摘要。
- 防止应用层到处硬编码 provider API key、base URL 或模型 slug。

### Worker 与插件边界

SciForge 将科研能力拆成可单独启动、测试和审计的 worker：

| Worker / 插件 | 作用 |
| --- | --- |
| `model-router` | 文本模型出口、视觉输入处理、科学多模态 worker 调度和 trace audit |
| `sci-modality-router` | 蛋白、结构、小分子、单细胞 native-to-text translator |
| `evidence-dag` | claim-evidence DAG、NLI verify、PROV-JSON、what-if reconcile |
| `paper-radar` | GUI / MCP 使用的论文 profile、同步、搜索、排名和 digest worker；共享 core 由 worker 包自身拥有 |
| `search` | arXiv、bioRxiv、Europe PMC、Semantic Scholar 与可选 CNS web search 的科研检索 |
| `scientific-plotting` | 参考图准备、风格识别、受控绘图、评分和修复建议 |
| `image-generation` | 受控图片生成、VisualDocument 审改包到编辑意图、artifact manifest |
| `visual-document` | workspace-local VisualDocument、artifact 插入、批注和候选版本验收 |
| `ppt-master` | 科研汇报输出阶段、figure intake、布局 QA 和 PPTX export |
| `write-assist` | 写作检索、PDF 文本提取和 bounded writing context |
| `workflow` | 可视化 workflow 执行与 Agent-facing MCP facade |
| `schedule` | 定时任务、手动运行和后台 Agent 调度 |
| `workspace-intel` / `runtime-inspector` | 工作区理解、运行时诊断和项目巡检 |
| `computer-use` | GUI-Owl computer-use service；经 Model Router 选择视觉模型，GUI 只暴露状态与人工确认 |
| `multi-agent` | child run contract、store、transcript 与 bounded delegation runtime |

共同原则：同类能力只有一条统一链路；能走 Model Router 的不绕过 Model Router；能写入 workspace 的能力都要有清晰的 side effect 分类和边界。

`computer-use` 当前指 GUI-Owl service path：本地 runtime 通过 `SCIFORGE_CUA_SERVICE_URL` 调用 GUI-Owl sidecar，模型调用只经 Model Router，真实鼠标/键盘动作必须由 GUI-Owl 的执行开关和人工确认控制。旧 GUI-managed `@sciforge/computer-use` primitive MCP path 已退休。

## 当前边界

SciForge 当前仍处于快速演进阶段。为避免误解，下面这些边界是有意设计：

- 桌面包不默认分发科学专家模型权重，也不内置第三方 provider 凭据。
- 科学多模态专家需要用户或机构配置 remote provider / GPU provider 后才启用。
- Paper Radar 默认同步元数据，不做批量 PDF 下载、全文解析或向量库。
- Evidence DAG phase 1 以 one thread == one graph 为主，`contradicts` 会暴露但不完全裁决。
- Scientific Plotting 使用受控模板和 Matplotlib renderer，不执行用户提供的任意 Python 绘图代码。

## 增强独特性的建议

下面这些不是简单加功能，而是让 SciForge 的科研辨识度更强的产品方向。

### Scientific Object Registry

现在 SciForge 已经能处理论文 PDF、figure crop、FASTA、PDB、SMILES、SDF、single-cell matrix、plot manifest 和 PPT artifact，但这些对象还分散在不同 worker 的结果里。Scientific Object Registry 可以把它们统一登记成项目内的科学对象：

- 每个对象都有类型、来源、hash、路径、生成工具、关联 thread、关联证据和可视化预览。
- Model Router 翻译科学文件时写入 object ref，而不是只把文本塞进上下文。
- Evidence DAG 可以引用对象节点，Canvas 可以按对象导入，Write 可以插入对象引用，PPT Master 可以追溯 figure 来源。

它解决的问题是：研究项目里“这个图、这个序列、这个结论、这个 slide 到底从哪来”不再靠人脑记忆。

目前对话层已经落地第一版结构化对象引用与展示：工具可返回带 hash、路径、来源、
`WorkspaceObservation` 和 selection 的 `ScientificObjectRef`；主对话会渲染分子、序列、
光谱、组学和生物成像卡片，并可进入完整工作区、按需展开 Mol*、引用当前选择继续提问、
比较对象和记录注释。工具输出格式见
[`docs/scientific-object-chat-contract.md`](./docs/scientific-object-chat-contract.md)。

### Experiment Notebook Ledger

科研实验不是只看最后结果，还要记录尝试过什么、环境是什么、失败在哪里、哪张图来自哪次运行。Notebook Ledger 可以自动把 Agent 的科研运行过程整理成结构化实验账本：

- 输入：命令、脚本、数据版本、环境摘要、参数、指标、生成图、失败日志和人工决策。
- 输出：每次实验一个 ledger entry，可导出 Markdown / JSON，并可链接到 Evidence DAG 和 Canvas artifact。
- 边界：不替代 Jupyter 或电子实验记录本，而是把 SciForge Agent 实际执行过的步骤变成可复盘记录。

它的价值是让“复现失败原因”和“为什么选择这版结果”有证据可查。

### Benchmark Gallery

如果要证明科学多模态 Router、Scientific Plotting、Evidence DAG 和 Write RAG 不是 demo，需要一组可公开分发的样例库。Benchmark Gallery 可以包含：

- FASTA、SMILES、PDB、single-cell marker、论文 PDF figure crop 等输入样例。
- 对应的 raw expert output、主 Agent 回答、trace audit、Evidence DAG、figure artifact 和 slide 输出。
- 回归检查：模型或 worker 更新后，确认对象识别、路由、manifest、图表评分和证据图结构没有明显退化。

它既是 README demo，也是测试资产，能让项目独特性更可信。

### Paper -> Figure -> Slide Demo Workflow

当前仓库已经有 Paper Radar、PDF crop、FigureStyleSpec、Scientific Plotting、Canvas 和 PPT Master。最能展示科研场景价值的方式，是把它们串成一条公开 workflow：

1. Paper Radar 根据课题 profile 找到新论文。
2. 用户从 PDF 中裁剪目标 figure panel。
3. Scientific Plotting 提取风格并生成本项目数据图。
4. Canvas 让用户圈出图表问题并生成 review packet。
5. Agent 根据批注重绘或调整。
6. PPT Master 把最终 figure 和证据摘要放进汇报 deck。

这条 demo 能清楚说明 SciForge 不是单点工具，而是科研产出链。

### GitHub Progress Sync Skill

不必把进展管理做成沉重的长期记忆系统。更轻量、更容易被学生使用的方向，是做一个 GitHub progress sync skill：

- 学生定期运行 skill，自动从最近线程、git diff、实验 ledger、figure manifest 和 TODO 中整理进展。
- 输出 GitHub issue comment、discussion update 或 PR summary，包含本周完成、证据链接、失败点、下周计划和需要导师确认的问题。
- 写入 GitHub 前必须预览，并由用户确认。

它解决的是导师/学生协作里的实际痛点：不是“永久记忆”，而是按周期把研究进展同步到团队已经使用的平台。

### Scientific Modality SDK

科学多模态 Router 的独特性会随着支持的模态扩展而增强。SDK 应该让新增模态有标准入口：

- 定义专家服务模板、输入检测规则、输出 schema、provenance、fingerprint 和错误码。
- 附 license checklist，避免把不能分发或不能商用的权重误放进桌面包。
- 附 evaluation harness，要求不同输入产生可区分输出，并能在无权重环境下跳过真实模型测试。

这能把“支持新科学模态”从一次性工程变成可重复扩展机制。

### Manifest 驱动插件市场

当前 worker/MCP 体系已经解耦，但插件生命周期还可以更产品化。Manifest 驱动插件市场应让每个科研扩展声明：

- 它需要哪些权限：读文件、写 workspace、联网、调用模型、启动 sidecar、访问 GitHub。
- 它提供哪些工具、资源、触发器和 artifact 类型。
- 它的版本、来源、健康检查、安装/卸载、升级和回滚策略。

这会把“能接 MCP”升级为“可治理的科研插件生态”。

### 本地优先审计面板

审计面板不是单纯工程仪表盘，而是给科研用户回答几个关键问题：

- 哪些数据留在本机，哪些请求发给了模型 provider。
- 哪些 sidecar 正在运行，监听什么端口，使用哪个 token。
- 某次回答引用了哪些文件、科学对象、模型翻译和工具结果。
- 当前项目有哪些 license / release / trace audit 风险。

它把解耦合架构转化成用户可理解的信任界面。

### 隐私与部署配方

科研团队常见部署形态差异很大：个人笔记本、实验室工作站、独立 GPU 服务器、内网环境甚至离线环境。SciForge 可以提供几套明确配方：

- 个人本地模式：桌面 + Model Router + 云端 provider。
- 实验室 GPU 模式：桌面在个人电脑，科学多模态专家在 GPU 服务器，通过私有网络访问。
- 内网/离线模式：trace、artifact、workspace 和专家模型都留在机构环境内。

这能把“本地优先”从口号变成可执行部署方案。

## 下载安装

### 预构建安装包

前往 [GitHub Releases](https://github.com/XingYu-Zhong/SciForge/releases) 下载：

| 平台 | 安装包 |
| --- | --- |
| macOS | `.dmg` 或 `.zip`，支持 Intel 与 Apple Silicon |
| Windows | `.exe`，NSIS 安装器，x64 |
| Linux | `.AppImage`，x64 |

首次启动建议先完成 Model Router 配置：设置本地 runtime API key、public model alias 和至少一个 provider profile。上游 provider 凭据只写入 Model Router 配置。

### 从源码运行

```bash
git clone https://github.com/XingYu-Zhong/SciForge.git
cd SciForge
npm install
npm run dev
```

环境要求：

- Node.js 20+
- 可用的上游模型 provider 或远端 Model Router 服务
- 首次安装依赖时需要联网
- 独立运行 Paper Radar service 时，Node.js 22.5+ 更合适，因为它使用 `node:sqlite`

中国大陆访问较慢时，可以使用 npm 镜像：

```bash
npm install --registry=https://registry.npmmirror.com
```

## 常用命令

```bash
npm run dev                    # 开发模式
npm run typecheck              # TypeScript 检查
npm run test                   # 单元测试
npm run build                  # 生产构建
npm run dist:mac               # macOS 安装包
npm run dist:win               # Windows 安装包
npm run dist:linux             # Linux AppImage
npm run license:package-audit  # 安装包发布边界审计
```

常用 worker：

```bash
npm run model-router:start
npm run sci-modality-router:start
npm run evidence-dag:start
npm run scientific-plotting:start
npm run workflow:start
npm run search:start
npm run write-assist:start
npm run schedule:start
npm run paper-radar-mcp:start
npm run image-generation:start
npm run visual-document:start
npm run ppt-master:start
npm run runtime-inspector:start
npm run workspace-intel:start
```

## 首次使用

1. 打开 SciForge。
2. 选择界面语言。
3. 在设置页配置 Model Router。
4. 选择默认工作目录。
5. 在 Code 工作台创建线程，描述你的研究任务。
6. 按需打开右侧 Evidence DAG、Paper Radar、图片审改、Plan、Files、Changes 或 Browser 面板。
7. 进入 Write、Workflow、Connect phone 或 Schedule 扩展工作链路。

设置页还可以管理主题、字体、通知、运行时端口、sandbox、approval policy、Skill、MCP、Webhook、Relay、定时任务和错误日志。

## 卸载与本地数据

卸载应用不会默认删除本地设置、会话、工作区或运行时数据。彻底清理前请确认没有需要保留的研究记录。

| 平台 | 应用数据位置 |
| --- | --- |
| macOS | `~/Library/Application Support/SciForge` |
| Windows | `%APPDATA%\SciForge` |
| Linux | `~/.config/SciForge` |

SciForge Runtime 数据通常位于 `~/.sciforge/runtime` 或设置中指定的 runtime data dir。研究产物通常写在当前 workspace 的 `.sciforge/`、`.agents/` 或用户选择的写作空间中。

macOS 本地未公证构建如果被系统拦截，可先运行：

```bash
npm run mac:unquarantine -- '/Applications/SciForge.app'
```

## 文档入口

| 文档 | 内容 |
| --- | --- |
| [docs/agent-runtime-contract.md](docs/agent-runtime-contract.md) | Runtime 中性 contract、事件、capability 和 adapter 边界 |
| [docs/local-runtime-architecture.md](docs/local-runtime-architecture.md) | SciForge Runtime 架构、HTTP/SSE 合约和 GUI 边界 |
| [docs/local-runtime-cache-optimization.md](docs/local-runtime-cache-optimization.md) | Token economy、缓存命中、MCP search 和工具输出压缩 |
| [docs/runtime-governance-design.zh-CN.md](docs/runtime-governance-design.zh-CN.md) | Runtime guard、公共治理层和多 runtime 接入原则 |
| [docs/kdense-scientific-skills-mcp.zh-CN.md](docs/kdense-scientific-skills-mcp.zh-CN.md) | K-Dense Scientific Agent Skills 的只读发现与规划接入 |
| [docs/paper-figure-style-transfer-v1.3.zh-CN.md](docs/paper-figure-style-transfer-v1.3.zh-CN.md) | 论文图风格识别、受控绘图和参考图准备 |
| [docs/WRITE_RETRIEVAL_RAG.zh-CN.md](docs/WRITE_RETRIEVAL_RAG.zh-CN.md) | Write 检索增强设计 |
| [docs/WRITE_INLINE_EDIT_RAG.zh-CN.md](docs/WRITE_INLINE_EDIT_RAG.zh-CN.md) | Write inline edit 检索增强 |
| [docs/license-risk-scan.md](docs/license-risk-scan.md) | 许可证风险 exact-hit 扫描流程 |
| [docs/commercial-release-boundary.md](docs/commercial-release-boundary.md) | 历史商业风险清理记录与当前发布边界 |
| [docs/CONTRIBUTING.zh-CN.md](docs/CONTRIBUTING.zh-CN.md) | 贡献说明 |
| [docs/DEVELOPMENT.zh-CN.md](docs/DEVELOPMENT.zh-CN.md) | 本地开发流程 |
| [SECURITY.md](SECURITY.md) | 安全漏洞披露方式 |

## 可审计发布边界

SciForge 当前仓库使用 MIT 许可证发布。发布前仍需要确认源码、历史来源、资产、依赖、模型权重、服务配置和打包产物都处在可解释边界内。

本仓库为这件事保留了几类材料：

- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)：第三方依赖、参考来源和资产来源说明。
- [docs/license-risk-scan.md](docs/license-risk-scan.md)：历史 blob exact-hit 扫描方法。
- [docs/commercial-release-boundary.md](docs/commercial-release-boundary.md)：历史商业风险清理记录与当前发布边界说明。
- [src/asset/img/README.md](src/asset/img/README.md)：项目内图片资产来源与生成关系。
- `scripts/license-risk-scan.mjs`：源码 exact-hit 检查工具。
- `npm run license:package-audit`：安装包发布审计入口。

默认发布策略：

- 不在应用包中默认夹带第三方模型权重。
- 不在应用层硬编码 provider API key、base URL 或默认闭源服务。
- 外部参考项目只作为 reference / inspiration 记录，不复制源码、测试或资产。
- 资产、二进制和安装包在发布前重新扫描。

这不是法律意见，但它让发布前需要确认的事实尽量变成可复查的工程证据。

## 贡献

欢迎提交 bug 修复、UI/UX 优化、文档改进、本地化内容、worker 能力、构建发布流程和运行时集成改动。

协作建议：

- 日常集成分支为 `develop`，稳定发布分支为 `master`。
- 新功能和修复从最新 `develop` 拉出短期分支。
- PR 默认提交到 `develop`。
- 高风险改动先说明范围、验证方式和回滚策略。
- 发起 PR 前运行 `npm run typecheck`、`npm run test` 和必要的构建命令。
- 改动影响使用方式时，同步更新相关 README 或 docs。

## 致谢

SciForge 从多个先行项目和产品形态中获得启发。相关来源只作为 reference / inspiration 记录；当前仓库不复制这些项目的源码、测试或资产。具体说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

感谢所有为 SciForge 提交 issue、建议、代码、测试、文档和研究反馈的人。

<a href="https://github.com/XingYu-Zhong/SciForge/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=XingYu-Zhong/SciForge" alt="SciForge contributors" />
</a>

## 许可证

[MIT](./LICENSE)
