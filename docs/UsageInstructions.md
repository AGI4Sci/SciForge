# SciForge 使用说明

这份文档面向第一次使用 SciForge 的研究者、开发者和团队试用者。README 负责讲清楚 SciForge 为什么值得看；这里负责讲清楚如何把它跑起来、怎么用它完成典型科研任务，以及后续截图应该放在哪里。

> 截图占位说明：你之后可以把截图放到 `docs/assets/`，并替换本文中的占位段落。建议文件名使用场景前缀，例如 `usage-paper-reproduction-01.png`。

## 1. 启动工作台

安装依赖并启动完整本地应用：

```bash
npm install
npm run dev
```

打开：

```text
http://localhost:5173/
```

`npm run dev` 会同时启动 UI 和 workspace runtime。只启动 UI：

```bash
npm run dev:ui
```

只启动 workspace runtime：

```bash
npm run workspace:server
```

启动后进入 Settings，至少确认：

- `Workspace Path` 指向你希望保存 `.sciforge/` 状态、任务、日志和 artifact 的目录。
- `AgentServer Base URL` 指向可用 AgentServer 或兼容 gateway。
- `Agent Backend` 选择当前要使用的后端，例如 Codex、Claude Code、Gemini、Hermes、OpenClaw 或其它已配置 backend。
- 如果 backend 需要鉴权，填写 provider、base URL、model、API key 和 timeout。

截图建议：

```text
[TODO screenshot] Settings 中 workspace、AgentServer 和 backend 配置区域。
```

## 2. 论文复现

目标：基于科学数据和论文蓝图，交互式提示 Agent 组合调用工具，复现论文中的图表、分析流程或核心结论。

适合场景：

- 学生理解一篇论文为什么得到某个结论。
- 研究者快速检查论文方法是否能在给定数据上复现。
- 团队积累“论文 -> 数据 -> 代码 -> artifact -> 结论”的轨迹数据。

推荐流程：

1. 准备输入：论文 PDF、补充材料、数据文件、仓库链接、关键图表或方法段落。
2. 在 workspace 中保存输入，或在聊天里提供文件/路径引用。
3. 选择合适 scenario，例如 literature evidence review、omics differential exploration、structure exploration，或自定义 scenario package。
4. 用自然语言描述复现目标，例如“复现 Figure 2 的差异表达分析，并解释每一步参数选择”。
5. 让 Agent 先生成计划：需要哪些数据、会运行哪些代码、预期产出哪些 artifact、如何验证。
6. 分步运行，并在每轮检查 ExecutionUnit、日志、图表和证据矩阵。
7. 对错误结果或不清楚的图表直接评论，让下一轮带着定位信息继续修复。
8. 稳定后，把可复用流程沉淀为 skill 或 scenario package candidate。

建议提示词：

```text
我想复现这篇论文中 Figure 2 的主要结论。请先读取论文和数据说明，列出需要的数据、分析步骤、可能缺失的信息，以及你计划生成的 artifact。不要直接给最终结论，先给一个可执行复现计划。
```

```text
基于刚才的计划，先运行最小可验证版本：读取数据、完成预处理、生成和论文 Figure 2 对应的图表，并把每个步骤记录为 ExecutionUnit。
```

```text
请比较复现图和论文图的差异，列出可能原因：数据版本、过滤阈值、统计方法、归一化方式或绘图参数。给出下一轮修复计划。
```

截图建议：

```text
[TODO screenshot] 上传论文和数据后的聊天区。
[TODO screenshot] Agent 生成复现计划。
[TODO screenshot] ExecutionUnit、图表 artifact 和 evidence matrix 并排展示。
```

## 3. 自我进化修复

目标：把人类对任意元素的评论转化为结构化修复任务，并由另一个稳定 SciForge 实例修复目标实例。

核心概念：

- **任何元素可评论**：artifact、结果视图、运行状态、页面元素、失败日志和执行单元都可以成为反馈对象。
- **双实例互修**：A 和 B 是两套完整 SciForge 实例，拥有独立端口、workspace、状态目录、日志、配置和 git worktree。
- **修复别人时自己稳定**：A 修 B 时，A 的运行代码不被本次任务修改；B 修 A 同理。
- **显式稳定同步**：修复通过测试和人工核验后，才生成稳定版本同步计划。

启动双实例：

```bash
npm run worktree:dual -- create
npm run dev:dual
```

默认地址：

```text
A  UI http://127.0.0.1:5173  writer http://127.0.0.1:5174
B  UI http://127.0.0.1:5273  writer http://127.0.0.1:5274
AgentServer shared http://127.0.0.1:18080
```

推荐流程：

1. 在目标实例中对问题元素添加评论，描述期望行为、当前错误和验收标准。
2. 在稳定实例的主聊天栏选择 Target Instance，例如选择 B。
3. 让稳定实例读取目标反馈，例如“修复 B 的反馈 #12，并先给出修复计划”。
4. 稳定实例通过目标实例 API 拉取 issue bundle、定位、截图证据和验收要求。
5. 修复 runner 在目标 repo 的隔离 repair worktree 中执行修改和测试。
6. 目标实例的反馈收件箱展示修复状态、changed files、diff、测试证据、人工核验和 GitHub 回写结果。
7. 双方都稳定后，生成显式 sync-plan，再决定是否同步较新版本。

建议提示词：

```text
请读取 B 实例的反馈 #12。先总结问题、定位相关文件、给出修复计划和预期测试，不要马上改代码。
```

```text
按计划修复 B 的反馈 #12。要求所有改动发生在 B 的隔离 repair worktree 中，完成后写回 changed files、diffRef、测试结果和人工核验建议。
```

```text
基于刚才的修复结果，生成稳定版本同步计划：包含源实例、目标实例、测试证据、备份点、风险和回滚步骤。不要自动应用同步。
```

常用验证：

```bash
npm run smoke:dual-instance
npm run smoke:dual-worktree-instance
npm run smoke:repair-handoff-runner
npm run smoke:stable-version-registry
```

截图建议：

```text
[TODO screenshot] 对 UI 元素添加评论。
[TODO screenshot] Target Instance 选择器。
[TODO screenshot] 反馈收件箱中的 repair result、diff 和测试证据。
```

## 4. Computer Use

目标：让 Agent 通过视觉优先的方式观察电脑界面、定位目标、执行操作，并把 trace 和验证结果留在 workspace 中。

当前边界：

- `vision-sense` 负责 Observe：读取截图/图像，输出布局摘要、OCR、坐标候选或失败诊断。
- `computer-use` 负责 Action：消费 sense 输出，执行窗口绑定、grounding、点击、输入、滚动和验证。
- Trace 默认使用 file-ref-only，不把大图片内联进长期上下文。
- 高风险动作默认 fail closed，例如删除、支付、授权、发布、外部提交等，需要明确确认或 verifier/human approval。

推荐流程：

1. 明确目标窗口和任务，例如“在浏览器中打开本地 SciForge 并检查设置页”。
2. 让 Agent 先观察窗口，返回可点击区域、当前状态和风险。
3. 对低风险步骤允许执行；对高风险步骤要求先停下等待确认。
4. 每轮检查 trace、截图引用、动作结果和 verifier verdict。
5. 如果定位失败，缩小 focus region 或补充视觉线索。

建议提示词：

```text
请使用视觉优先的 computer use 检查当前 SciForge 设置页。先只观察并报告你看到了哪些可操作区域，不要点击。
```

```text
现在点击 Agent Backend 下拉框，确认有哪些可选 backend。只执行必要操作，并记录 trace。
```

截图建议：

```text
[TODO screenshot] Computer Use 观察结果和 grounding 标注。
[TODO screenshot] trace / action outcome / verifier verdict。
```

## 5. 多 Backend 切换

SciForge 的设计目标是让不同 Agent backend 共享同一个科研工作台、artifact contract 和轨迹数据。

切换流程：

1. 打开 Settings。
2. 设置 `AgentServer Base URL`。
3. 选择 `Agent Backend`。
4. 填写对应 provider、model、base URL、API key 和 timeout。
5. 运行一个小任务确认 backend 可用，例如让它总结当前 workspace 状态或生成一个简单 artifact。

建议最小测试：

```text
请用当前 backend 回答：当前 workspace 中有哪些可用 scenario？只返回结构化摘要，并说明是否连接到了真实 backend。
```

排障要点：

- 如果 workspace runtime 不可用，SciForge 应显示真实连接错误，不会伪造 demo artifact。
- 如果 backend 不可用，检查 AgentServer URL、backend 名称、API key、timeout 和网络环境。
- 如果 context window 压力过大，优先使用 workspace refs、artifact refs 和 compact trace，而不是把大文件直接塞进聊天。

截图建议：

```text
[TODO screenshot] backend 下拉选择。
[TODO screenshot] backend 连接失败诊断。
```

## 6. 常用命令

开发：

```bash
npm run dev
npm run dev:ui
npm run workspace:server
```

验证：

```bash
npm run typecheck
npm run test
npm run smoke:all
npm run build
npm run verify
```

双实例：

```bash
npm run worktree:dual -- create
npm run dev:dual
npm run worktree:dual
npm run worktree:dual -- clean
```

重点 smoke：

```bash
npm run smoke:vision-sense-runtime
npm run smoke:repair-handoff-runner
npm run smoke:dual-worktree-instance
npm run smoke:stable-version-registry
npm run smoke:long-file-budget
```

## 7. 产物位置

SciForge 默认把 workspace 状态写入：

```text
<workspace>/.sciforge/
```

常见路径：

```text
<workspace>/.sciforge/workspace-state.json
<workspace>/.sciforge/sessions/*.json
<workspace>/.sciforge/artifacts/*.json
<workspace>/.sciforge/tasks/*
<workspace>/.sciforge/task-results/*
<workspace>/.sciforge/logs/*
<workspace>/.sciforge/scenarios/*
```

这些文件是 SciForge 的长期记忆和审计基础：后续对话、复现、修复、skill promotion 和 scenario package 都应该优先引用 workspace refs，而不是依赖聊天上下文里的临时文本。
