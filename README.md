# SciForge · 科研 Agent 的人类控制面与证据层

<p align="center">
  <strong>机器越强，界面越薄；人的目标、判断与责任始终在线。</strong>
</p>

<p align="center">
  让成熟 Agent runtime 在后台执行，研究者在关键节点判断、纠偏和验收；<br>
  论文、数据、工具调用、证据、决策与产物，都沉淀为可追踪的研究记录。
</p>

<p align="center">
  <a href="./README.en.md">English</a> ·
  <a href="https://agi4sci.github.io/sciforge-docs-v2/">使用文档站</a> ·
  <a href="./docs/wiki/README.md">使用 Wiki</a> ·
  <a href="https://agi4sci.github.io/SciForge/submit/">提交科研需求</a>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/AGI4Sci/SciForge" alt="License"></a>
</p>

> **遇到真实科研痛点？** 请通过[科研 Agent 需求采集网页](https://agi4sci.github.io/SciForge/submit/)说明需求、人类必须参与的环节和验收标准。提交内容将在 GitHub 确认后保存为公开 Issue。

## SciForge 是什么

SciForge 是一个**用户友好的科研 Agent 桌面客户端**：打开本地项目目录、选择执行 runtime，就能让 Agent 在清晰的权限边界里读文献、跑分析、出图表，每一步都留下来供你审阅。它**不重新发明、也不替代** Codex、Claude Code 等成熟 runtime，并**兼容 DeepSeek Harness（DSH）插件生态**——runtime 负责通用 Agent 执行，SciForge 负责科学对象、研究上下文、人类审阅界面和证据治理。

在此之上，SciForge 针对科研场景针对性增强了四类能力：

| 增强方向 | 你得到什么 |
| --- | --- |
| **云端笔记** | 接入你自备的思源笔记服务作为整页编辑器；任务结束后自动归档可追溯的 Markdown 总结。 |
| **团队协同** | 围绕 Project 分配任务、逐版评审、返修与采纳；支持从手机继续个人会话。 |
| **科研证据链审计** | Evidence DAG、Project DAG、产物版本、研究检查点与科研档案，让每个结论都能回到数据、方法与图表。 |
| **科学多模态理解与交互** | 蛋白序列与结构、小分子、组学矩阵、光谱、影像的专用预览与 translator，把可审计的文本证据交给 Agent 推理。 |

此外还内置：**22 个领域扩展**（受控绘图、可视化审改、锚定批注、变更检查、终端、浏览器预览、内容空间等）、**定时任务与 Create Loop** 多步流程编排，以及**本地优先的权限与审批治理**（只读沙箱、逐条审批、外部写入确认）。

## 一眼看懂 SciForge

| SciForge 提供什么 | 你得到什么 |
| --- | --- |
| **干预面板** | 在计划、权限、工具调用、文件改动、证据冲突和最终发布等关键节点审阅与纠偏。 |
| **研究状态与证据采集器** | 自动归集论文、科学对象、命令与工具结果、图表、批注、claims、provenance 和决策记录。 |
| **科学场景增强层** | 为通用 Agent 增加科学多模态路由、文献检索、Evidence / Project DAG、受控绘图、写作、汇报和可复跑工作流。 |
| **长期研究工作区** | 让跨会话、跨角色、跨工具的研究过程可继续、可复盘、可交接。 |

```text
研究目标与材料
      ↓
Codex / Claude Code / DSH 执行
      ↓
科学检索 · 多模态翻译 · 分析 · 绘图 · 写作 · 工作流
      ↓
SciForge 归集证据与产物 ──→ 人类审阅、干预、批准
      ↓
可追踪、可复现、可继续的研究状态
```

**Runtime**：Codex 是默认 runtime；Claude Code 与 DeepSeek Harness（DSH）可在「设置 → AI 助手」中显式选择。DSH 经 ACP 适配接入，模型与推理档位由 ACP 会话生效，其原生 shell 工具默认关闭、逐条批准。任一 runtime 失败都会显式报错，不会静默切换到另一个。

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

> **如何阅读 Showcase：** 这些是论文中记录的 prototype demonstrations 和公开审计材料，不是已完成的临床/实验验证或全面 benchmark。论文还记录了明确的边界：蛋白设计案例存在 provenance mismatch，MCFST 复现的运行计数与选择规则仍需修订，分子优化的预注册主指标未达标且处于 docking 噪声范围内。请把它们当作可复查的研究轨迹，而不是自动生成的科学结论。

## 快速开始

```bash
git clone https://github.com/AGI4Sci/SciForge.git
cd SciForge
npm ci
npm run dev
```

要求 Node.js 22.12+ 与平台原生构建工具；模型执行需要自行配置受支持的 runtime/provider。环境与完整步骤见 [INSTALL.md](./INSTALL.md)。

本轮尚未发布安装包，建议从源码运行；Releases 中的早期安装包与当前源码存在差异。无需配置私有云服务即可启动本地客户端；可选云端连接需由服务管理方提供地址和账号，仓库不提供默认生产地址。

## 文档

| 入口 | 内容 |
| --- | --- |
| [使用文档站](https://agi4sci.github.io/sciforge-docs-v2/) | 五分钟快速开始、端到端案例、22 个内置扩展的功能手册、视频导览 |
| [安装与最小使用](./INSTALL.md) | 本地客户端环境、步骤与验证 |
| [使用 Wiki](./docs/wiki/README.md) | 随仓版本化的中文使用手册 |
| [开发指南](./docs/DEVELOPMENT.md) | 本地开发、测试与构建 |
| [贡献指南](./CONTRIBUTING.md) · [安全策略](./SECURITY.md) | 协作约定与漏洞报告 |

## 仓库边界

客户端源码和共享协议在本仓维护；云端源码、数据库迁移、Zulip 服务端适配和部署材料在闭源的 SciForge-cloud 仓，不随本仓公开；remote-ssh 不在开源范围内。

## 贡献与许可证

欢迎提交 Issue、Showcase、科学 worker、Skill、runtime adapter、文档和 UI 改进。提交 PR 前请运行与改动范围相符的 typecheck、test 和 build；协作约定见[贡献指南](./docs/CONTRIBUTING.zh-CN.md)。

客户端主体使用 [Apache License 2.0](./LICENSE)。内置域与插件分别采用 MIT 或 Apache-2.0，以各包 package.json 和 LICENSE 为准。第三方依赖、参考项目与资产来源见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)，个别组件授权仍在确认中，以该文件为准。

<a href="https://github.com/AGI4Sci/SciForge/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=AGI4Sci/SciForge" alt="SciForge contributors">
</a>
