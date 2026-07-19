# SciForge 使用 Wiki

SciForge 是一个面向科学研究的本地 AI 工作台。它的长期定位不是“替人做完所有事情的黑盒 Agent”，而是一个**人机协同的干预面板 + 研究状态与证据采集器**：runtime 负责执行，研究者在关键节点确认目标、权限、证据和产物，SciForge 把这些决策与结果留下来。

模型能力会越来越强，面板会越来越薄，但“让机器的行动符合人的期待”始终需要一个可见、可暂停、可审阅的界面。SciForge 直接复用成熟的 Codex、Claude Code 等 runtime，在科学场景上补齐工作区、论文、科学对象、Evidence DAG、图表、写作和 artifact review；它与这些 runtime 是合作关系，而不是替代品。

## 三分钟理解价值

- **接入**：在一个桌面工作区里选择 SciForge Runtime、Codex 或 Claude Code。
- **干预**：在计划、工具调用、文件变更、外部副作用和最终证据处审批、拒绝、追问、暂停或修改。
- **沉淀**：把会话、trace、批注、图表、证据和 review packet 组织成可复盘的研究记录。

## 从这里开始

| 目标 | 入口 |
| --- | --- |
| 第一次运行 | [快速开始](./Getting-Started.zh-CN.md) |
| 选择 runtime、接模型 | [运行时与模型](./Runtimes-and-Models.zh-CN.md) |
| 用于论文、实验和图表 | [科研工作流](./Scientific-Workflows.zh-CN.md) |
| 审批、数据和证据如何保存 | [干预与数据](./Intervention-and-Data.zh-CN.md) |
| 连接失败或模型无响应 | [故障排查](./Troubleshooting.zh-CN.md) |
| 常见问题、提交改动 | [FAQ 与贡献](./FAQ-and-Contributing.zh-CN.md) |

## 最小心智模型

```text
研究者目标与约束
        ↓
SciForge GUI：计划 / 审批 / 批注 / 证据审阅
        ↓
Codex、Claude Code 或 SciForge Runtime：执行工具与任务
        ↓
Model Router：统一模型出口与科学多模态 worker
        ↓
工作区文件、artifact、trace、Evidence DAG
```

## 约定

- SciForge Runtime 默认启用；Codex 和 Claude Code 必须由用户显式配置与选择，运行时失败时不会静默切换。
- 上游 provider 的 API key 只应配置在 Model Router；runtime token 是本地边界凭据，两者不要混用。
- 高影响操作先审阅再提交。科学翻译、自动绘图和模型生成的内容都应视为草稿或证据线索，最终结论由研究者确认。

更完整的产品能力列表见仓库根目录的 [README](../../README.md)，运行时边界见 [`docs/agent-runtime-contract.md`](../agent-runtime-contract.md)。
