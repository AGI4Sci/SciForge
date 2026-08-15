# `@sciforge/domain-collaboration`

SciForge 的统一用户—手机—Agent 协作领域包。

包通过标准 domain manifest 提供独立 main 与 renderer 入口。main 入口拥有 Agent
设备连接、本地 Session 投影、durable inbox/outbox、每 projection 顺序队列、receipt
ledger 和 Task adapter；renderer 只通过 Capability Broker 调用公开 capability，不使用
领域专用 IPC、MCP 或 Host 私有路径。

本地高频状态写入 `<userData>/domains/collaboration/state.json`，使用 0600 原子替换。
非敏感服务 URL 与稳定 installation ID 保存到 package-scoped settings；user/device
credential 与短期 pairing poll secret 只保存到 main-only package secret store。状态页、
日志和诊断不会返回这些 secret。

远端个人消息始终通过 Host 提供的 thread-targeted `agentExecution` 进入明确 thread，并
携带 durable `clientDirectiveId`。模型、workspace policy、工具、审批和审计仍由唯一的
AgentRuntime/Capability Broker 路径负责。普通手机身份不会生成桌面批准。
