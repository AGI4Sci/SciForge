# 运行时与模型

## 谁负责什么

| 层 | 作用 | 典型配置 |
| --- | --- | --- |
| SciForge GUI | 研究工作区、干预、artifact 与证据审阅 | Settings、Code、Write、Workflow |
| Agent runtime | 计划、工具调用、文件操作和会话生命周期 | SciForge Runtime、Codex、Claude Code |
| Model Router | 统一 `/v1` 模型出口、provider profile 和科学多模态路由 | text / vision / scientific translator |

SciForge 不重新实现 Codex 或 Claude Code 的 agent loop，而是在它们之上提供科学工作区与治理界面。runtime 的原生能力保留在各自边界，GUI 通过中性的 `AgentRuntime` contract 与之协作。

## 选择 runtime

在 **Settings → Agents** 中显式选择：

- **SciForge Runtime**：默认、本地 HTTP/SSE runtime；适合希望由 SciForge 管理完整本地服务、工具审批和上下文治理的用户。
- **Codex**：配置 `codex` 命令、managed Codex home、profile/model 和 sandbox；首次使用按 Codex 的官方登录流程完成认证。
- **Claude Code**：配置 `claude` 命令、config dir、model 和 sandbox；认证与会话由 Claude Code 管理。

Codex / Claude Code 未配置时不会影响 SciForge Runtime；SciForge Runtime 出错也不会偷偷 fallback。切换 runtime 前先完成对应命令的安装、登录和最小只读测试。

## 配置 Model Router

默认值：

```text
Base URL:        http://127.0.0.1:3892/v1
Public alias:    sciforge-router
SciForge port:   8899
Runtime data dir: ~/.sciforge/runtime
```

在 Model Router 的 `default` profile 中分别配置：

- `textReasoner`：Code、Write 和普通 Agent 推理。
- `imageGenerator`：生成或编辑图像（仍需人工审阅）。
- `translators.vision`：图片、截图、图表的视觉证据。
- `translators.scientific`：蛋白序列/结构、小分子、单细胞等科学对象的 native-to-text 证据。

重要边界：

- `runtimeApiKey` 是 GUI 与本地 Model Router / runtime 之间的边界凭据；provider API key 是 Router 访问上游的凭据，二者分开保存。
- GUI 的 Router Base URL 应使用本机 loopback（`127.0.0.1`、`localhost` 或 `[::1]`）；需要远端服务时，先在本机建立受控转发或 sidecar。
- `publicModelAlias` 是 runtime 请求的模型 ID，例如 `sciforge-router`；真实 provider model name 留在 Router profile。
- 未配置科学 translator 时，安全可读的文本会按文本处理；二进制科学对象会明确降级或拒绝，不会假装读懂。

更细的 JSON 字段和上下文压缩阈值见 [`docs/local-runtime-config.md`](../local-runtime-config.md)。

## 安全与成本建议

1. 默认使用 `workspace-write` + `on-request` / `auto` 审批；涉及网络、删除、发布或外部系统时逐项确认。
2. 长任务可以开启 token economy、MCP progressive discovery 和上下文压缩；先观察 trace 和结果质量，再调低阈值。
3. 不要把 provider key 写进仓库、prompt、workflow 节点或 `config.json` 的示例中。
4. 若要使用 coding-plan 订阅，使用 Model Access / Plan Gateway 的显式模式；不要用 API key 路径冒充订阅，也不要让失败路径自动互换。
