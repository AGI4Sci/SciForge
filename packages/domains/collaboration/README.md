# `@sciforge/domain-collaboration`

SciForge 的统一用户—手机—Agent 协作领域包。

包通过标准 domain manifest 提供独立 main 与 renderer 入口。main 入口拥有 Agent
设备连接、本地 Session 投影、durable inbox/outbox、每 projection 顺序队列、receipt
ledger 和 Task adapter；renderer 只通过 Capability Broker 调用公开 capability，不使用
领域专用 IPC、MCP 或 Host 私有路径。

本地高频状态写入 `<userData>/domains/collaboration/state.json`，使用 0600 原子替换。
非敏感 Cloud URL 保存到 package-scoped settings。User 请求只通过 identity-access
提供的 token-free authenticated Cloud transport，OIDC Token 始终留在 Identity 私有边界。
每台 ACTIVE Device 注册一个 active Agent；注册、轮换、撤销、Agent-authenticated HTTP/WSS
以及私有 authority 的存取都由 identity-access 的 owner-scoped internal service 完成。本包只
观察非秘密的 Agent facts、authority readiness 与 Cloud events，不接收 bootstrap key、Token、
私有 authority 或任何通用秘密存储句柄。

Endpoint challenge 由当前 OIDC User 发起并绑定精确 provider/realm/providerUserId；`/bind`
只证明 provider endpoint 事实，不创建 User、不签发第二种 User credential，也没有匿名 poll
secret。Agent presence、WSS、Inbox 与 durable outbox 使用 Identity 持有的独立、可撤销
Agent authority，不把 OIDC authority 或 Agent 私密材料复制到本包。

远端个人消息始终通过 Host 提供的 thread-targeted `agentExecution` 进入明确 thread，并
携带 durable `clientDirectiveId`。模型、workspace policy、工具、审批和审计仍由唯一的
AgentRuntime/Capability Broker 路径负责。普通手机身份不会生成桌面批准。Worker 的手动/
自动接单、本地 journal、execution fence 与重启恢复继续由本包拥有，不形成第二条 Cloud
认证或 Task 执行路径。

本包还发布唯一的 main-only `sciforge.collaboration.coordinator-cloud-command@1.0.0`
internal service，仅授权 `sciforge.project-coordinator` 消费。它的闭集只有
`project.plan.submit`、`task.offer.create`、`task.offer.withdraw` 与
`task.offer.reassign` 四类 Coordinator Agent 命令；调用者不能传入 Agent、route、header
或 credential。服务把命令绑定到当前本机 Agent，并复用同一个 durable outbox 和 Identity
Agent Cloud Runtime。严格 Cloud revision/fence 错误会随该 outbox entry 持久化并幂等返回；
非严格 upstream body 不会写入 journal。
