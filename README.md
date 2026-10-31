

> 素材说明 / Asset note: 未确认权属的文档素材不随本源码候选分发；操作文字保留。Unconfirmed documentation media are omitted. See [asset status](docs/ASSET-PUBLICATION-STATUS.md).



# SciForge · 科研 Agent 的人类控制面与证据层

<p align="center">
  <strong>机器越强，界面越薄；人的目标、判断与责任始终在线。</strong>
</p>

<p align="center">
  让成熟 Agent runtime 在后台执行，让研究者在关键节点判断、纠偏和验收；同时把论文、数据、工具调用、证据、决策与产物沉淀为可追踪的研究记录。
</p>

<p align="center">
  <a href="./README.en.md">English</a> ·
  <a href="https://sciforge.ai">官网</a> ·
  <a href="https://github.com/AGI4Sci/SciForge/releases">下载</a> ·
  <span>论文（PDF 不包含在本源码候选中）</span> ·
  <a href="./docs/wiki/README.md">使用 Wiki</a> ·
  <a href="https://agi4sci.github.io/SciForge/submit/">提交科研需求</a>
</p>

<p align="center">
  <a href="https://github.com/AGI4Sci/SciForge/releases"><img src="https://img.shields.io/github/v/release/AGI4Sci/SciForge?label=release" alt="GitHub release"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/AGI4Sci/SciForge" alt="License"></a>
</p>

> **遇到真实科研痛点？** 请通过[科研 Agent 需求采集网页](https://agi4sci.github.io/SciForge/submit/)说明需求、人类必须参与的环节和验收标准。提交内容将在 GitHub 确认后保存为公开 Issue。

> Demo imagery is omitted from this source-only candidate; product features are retained.

## 一眼看懂 SciForge

未来 Agent 会自动完成越来越多研究工作，但它做的事仍需符合人的目标、约束和判断。SciForge 保留一层会随模型能力增强而不断变薄、却长期必要的 GUI：人负责提出目标、检查证据、干预关键步骤和批准结果，机器负责搜索、解析、执行、分析与生成。

| SciForge 提供什么 | 你得到什么 |
| --- | --- |
| **干预面板** | 在计划、权限、工具调用、文件改动、证据冲突和最终发布等关键节点审阅与纠偏。 |
| **研究状态与证据采集器** | 自动归集论文、科学对象、命令与工具结果、图表、批注、claims、provenance 和决策记录。 |
| **科学场景增强层** | 为通用 Agent 增加科学多模态路由、文献检索、Evidence / Project DAG、受控绘图、写作、汇报和可复跑工作流。 |
| **长期研究工作区** | 让跨会话、跨角色、跨工具的研究过程可继续、可复盘、可交接。 |

SciForge **不重新发明、也不替代** Codex、Claude Code 等成熟 runtime。它与这些 runtime 是合作关系：runtime 负责通用 Agent 执行，SciForge 提供科学对象、研究上下文、人类审阅界面和证据治理。**Codex 是默认 runtime，Claude Code 可在 Settings 中显式选择。**

```text
研究目标与材料
      ↓
Codex / Claude Code 执行
      ↓
科学检索 · 多模态翻译 · 分析 · 绘图 · 写作 · 工作流
      ↓
SciForge 归集证据与产物 ──→ 人类审阅、干预、批准
      ↓
可追踪、可复现、可继续的研究状态
```

## 工作台实景（prototype showcase）

下表保留工作台能力说明。对应会话截图与论文 PDF 未包含在本源码候选中，不提供失效链接，也不从私有材料恢复。

<table>
  <tr>
    <td width="50%" align="center">
      <em>插图未包含在本源码候选中。</em><br>
      <strong>会话级 Evidence DAG</strong><br>
      从对话回到 claim、来源、支持/矛盾关系与节点 provenance。
    </td>
    <td width="50%" align="center">
      <em>插图未包含在本源码候选中。</em><br>
      <strong>项目级 Project DAG</strong><br>
      聚合多次会话中的证据、结论、审查状态与项目决策。
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <em>插图未包含在本源码候选中。</em><br>
      <strong>PDF 审阅到修订</strong><br>
      把页内批注、Agent 修改、编译验证和未解决问题放在同一界面。
    </td>
    <td width="50%" align="center">
      <em>插图未包含在本源码候选中。</em><br>
      <strong>结构选区驱动的科学对话</strong><br>
      将结构查看器中的 residue 选择连同文件哈希和定位信息送入对话。
    </td>
  </tr>
</table>

## 公开 Showcase

四个旗舰案例展示了 SciForge 如何把 Agent 执行、人类 PI 干预与可审计研究记录连成闭环：

| 案例 | 一句话价值 | 可复查材料 |
| --- | --- | --- |
| **多日 Agentic Research Sprint** | 面向减数分裂基因发现的 PI-controlled 长程研究循环，覆盖 132 个阶段与 199+ 次 Git 提交。 | [公开仓库](https://github.com/AGI4Sci/scenario-01-research-sprint) |
| **AI 引导的蛋白设计** | ProteinMPNN 序列设计，结合 Boltz-2 / ESMFold 结构验证和明确的后续实验标准。 | [公开仓库](https://github.com/kaiwinYao1/sciforge-de-novo-protein-demo) |
| **AI 引导的分子优化** | 围绕 EGFR scaffold 完成可追踪 SAR 迭代：135 个过滤候选、36 次 docking evaluation。 | [公开仓库](https://github.com/AGI4Sci/molclaw) |
| **Genome-to-BGC Discovery** | 串联 antiSMASH、MIBiG、BiG-SCAPE 与多 Agent 分析，对 430 个 BGC region 做证据化优先级排序。 | [公开仓库](https://github.com/wenne-kwj/scenario-bgc-genome-discovery) |

<details>
<summary><strong>查看论文中的全部 8 个端到端案例</strong></summary>

| # | 案例 | 仓库 |
| --- | --- | --- |
| 1 | Agentic Research Sprint：多日、PI-controlled 的基因发现研究循环 | [AGI4Sci/scenario-01-research-sprint](https://github.com/AGI4Sci/scenario-01-research-sprint) |
| 2 | AI4AI：ESMC-6B ContactProbe 接触预测与超参数搜索 | [BruthYU/autoresearch_base](https://github.com/BruthYU/autoresearch_base) |
| 3 | Reviewer / Rebuttal：证据治理的同行评审与回复流程 | [maoxinjie/scenario-05-reviewer-rebuttal-vcbench](https://github.com/maoxinjie/scenario-05-reviewer-rebuttal-vcbench) |
| 4 | Guided Paper Reproduction：MCFST 空间转录组论文复现 | [Winshion/sciforge-ai4ai-spacial-trans](https://github.com/Winshion/sciforge-ai4ai-spacial-trans) |
| 5 | Cross-Scale Cell Atlas：跨数据库整合与引导式分析 | [ShaysXIA/cross-scale-data-demo](https://github.com/ShaysXIA/cross-scale-data-demo) |
| 6 | AI-Guided Protein Design：从序列生成到结构验证 | [kaiwinYao1/sciforge-de-novo-protein-demo](https://github.com/kaiwinYao1/sciforge-de-novo-protein-demo) |
| 7 | AI-Guided Molecular Design：可追踪的 scaffold SAR 优化 | [AGI4Sci/molclaw](https://github.com/AGI4Sci/molclaw) |
| 8 | Genome-to-BGC Discovery：从基因组到候选 BGC 卡片与优先级 | [wenne-kwj/scenario-bgc-genome-discovery](https://github.com/wenne-kwj/scenario-bgc-genome-discovery) |

</details>

## 能做什么

- **阅读与综述**：检索 arXiv、bioRxiv、Europe PMC 和 Semantic Scholar；解析 PDF；做页内批注、选区问答和研究写作。
- **理解科学对象**：将蛋白序列、蛋白结构、小分子和单细胞表达交给专用 translator，再把可审计文本证据交给主 Agent 推理。
- **复现与实验**：让 Agent 在真实 workspace 中读写文件、运行命令、连接 SSH / HPC 或科学工具，并保留运行与变更记录。
- **证据与决策**：用 Evidence DAG 审查单次会话，用 Project DAG 维护跨会话目标、证据、review 与 release 状态。
- **科研表达**：从数据和论文参考图生成受控图表，在 Canvas 审改，再进入论文、报告和 PPTX 产出。
- **自动化与协作**：把重复步骤做成 Workflow 或 Schedule，通过桌面、手机与团队入口监督长期任务。

SciForge 默认本地优先；模型、远程执行和科学专家服务由用户或机构显式配置。Evidence / Project DAG 中的节点是可审阅的**证据候选**，不是自动生成的真理；科学结论仍需领域专家判断，Showcase 中的计算结果也不等同于实验验证。

> **如何阅读 Showcase：** 这些是论文中记录的 prototype demonstrations 和公开审计材料，不是已完成的临床/实验验证或全面 benchmark。论文还记录了明确的边界：蛋白设计案例存在 provenance mismatch，MCFST 复现的运行计数与选择规则仍需修订，分子优化的预注册主指标未达标且处于 docking 噪声范围内。请把它们当作可复查的研究轨迹，而不是自动生成的科学结论。

## 快速开始

本仓库是 SciForge 客户端源码；云端服务保持闭源，不包含 remote-ssh、服务端、Zulip 服务端适配及部署运维材料。

```bash
git clone https://github.com/AGI4Sci/SciForge.git
cd SciForge
npm ci
npm run dev
```

环境与完整步骤见 [INSTALL.md](./INSTALL.md)。无需配置私有云服务即可启动本地客户端；模型执行需要用户自行配置受支持的 runtime/provider。可选云端连接需由服务管理方提供地址和账号，仓库不提供默认生产地址。

## 文档

- [安装与最小使用](./INSTALL.md)
- [详细功能手册（文档站）](https://agi4sci.github.io/sciforge-docs-v2/)
- [贡献指南](./CONTRIBUTING.md)
- [安全策略](./SECURITY.md)

客户端源码和共享协议在本仓维护；云端源码、数据库迁移和部署材料不随本仓公开。尚未发布本轮安装包，源码构建不代表 macOS/Windows/Linux 安装包均已验收。

## 贡献与许可证

欢迎提交 Issue、Showcase、科学 worker、Skill、runtime adapter、文档和 UI 改进。提交 PR 前请运行与改动范围相符的 typecheck、test 和 build；协作约定见[贡献指南](./docs/CONTRIBUTING.zh-CN.md)。

客户端主体使用 [Apache License 2.0](./LICENSE)。内置域与插件分别采用 MIT 或 Apache-2.0，以各包 package.json 和 LICENSE 为准。第三方依赖、参考项目与资产来源见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)，其中区分纯源码、网站和安装包义务。tldraw 保功能但适用授权未确认，源码与素材权利证据仍待负责人提供，公开发布继续阻断；文档修复不构成法律放行。

<a href="https://github.com/AGI4Sci/SciForge/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=AGI4Sci/SciForge" alt="SciForge contributors">
</a>
