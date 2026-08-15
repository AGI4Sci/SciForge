# SciForge 使用 Wiki

SciForge 是面向科学研究的本地 AI 工作台：它把 GUI 做成**人机协同的干预面板 + 研究过程数据采集器**。Codex 或 Claude Code 负责执行，SciForge 负责科学工作区、论文与数据、证据、artifact 以及人的确认。

模型会越来越强，面板会越来越薄，但研究者仍需要在关键节点确认目标、权限、证据和结果。SciForge 与成熟 runtime 是合作关系，不替代它们的执行引擎。

## 先看这几页

普通用户无需选择 Git 分支。手机协作的最短入口是：安装或启动 SciForge 桌面端，安装并登录官方
Zulip 手机 App，在桌面“协作”面板填写管理员提供的云端地址，然后复制配对指令到手机 Zulip Topic
原样发送。当前没有需要用户从仓库构建的 SciForge 自研手机 App。

| 你想做什么 | 页面 |
| --- | --- |
| 安装并跑通第一个任务 | [快速开始](./Getting-Started.zh-CN.md) |
| 选择 Codex / Claude Code，接入模型 | [运行时与模型](./Runtimes-and-Models.zh-CN.md) |
| 普通用户：用官方 Zulip App 绑定个人 Session、参与多人 Project | [手机与多人协作最短入口](../collaboration-user-guide.zh-CN.md) |
| 管理员：部署、升级或维护独立发布的云端协作服务 | [协作服务开发与香港 ECS 部署](../operations/zulip-aliyun-deployment.zh-CN.md) |
| 论文、实验、科学对象、图表和写作 | [科研工作流](./Scientific-Workflows.zh-CN.md) |
| 审批、批注、trace、`.sciforge` 和 Evidence DAG | [干预与数据](./Intervention-and-Data.zh-CN.md) |
| 连接失败、模型无响应、worker 异常 | [故障排查](./Troubleshooting.zh-CN.md) |
| 常见问题与贡献规范 | [FAQ 与贡献](./FAQ-and-Contributing.zh-CN.md) |

## 最小心智模型

```text
研究目标 → SciForge GUI（计划 / 审批 / 批注 / 证据）
         → Codex / Claude Code（执行）
         → Model Router（统一模型与科学多模态出口）
         → workspace、artifact、trace、Evidence DAG（可复盘记录）
```

建议先从一个只读的小任务开始，再逐步开放文件写入、网络和外部副作用。更完整的能力总览见 [README](../../README.md)；runtime contract 见 [`docs/agent-runtime-contract.md`](../agent-runtime-contract.md)。

> GitHub Wiki 用户也可以从 [`Home.md`](./Home.md) 进入；本目录是随仓库版本化的 Wiki 源文件。

桌面协作实现与云端协作服务的源码可追溯到同一个 `gui` commit，但桌面安装包和云端服务独立发布；
普通用户只需使用管理员提供的桌面版本与服务地址，不需要拉取、切换或部署任何 Git 分支。
