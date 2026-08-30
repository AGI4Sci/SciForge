# `@sciforge/domain-collaboration`

SciForge 的统一用户—手机—Agent 协作领域包。

包通过标准 domain manifest 提供独立 main 与 renderer 入口。main 入口拥有 Agent
设备连接、本地 Session 投影、durable inbox/outbox、每 projection 顺序队列、receipt
ledger 和 Task adapter；renderer 只通过 Capability Broker 调用公开 capability，不使用
领域专用 IPC、MCP 或 Host 私有路径。

renderer 通过通用 `workbench.workspace-section` 合同把 `我的任务` 导航和
`连接与设置` 抽屉贡献给 Collaboration Center。它不注册独立顶栏按钮；原有 command、
right-panel surface 与同一 capability client 继续服务命令调用和精确深链，因此 UI 合并不会
产生第二条 Cloud、Task 或恢复路径。Project Coordinator 不导入本包 renderer，也不识别本包
domain ID。

本地高频状态写入 `<userData>/domains/collaboration/state.json`，使用 0600 原子替换。
非敏感 Cloud URL 保存到 package-scoped settings。User 请求只通过 identity-access
提供的 token-free authenticated Cloud transport，OIDC Token 始终留在 Identity 私有边界。
每台 ACTIVE Device 由 Identity 自动确保一个以 Device 名称显示的 active Agent；ensure、轮换、撤销、Agent-authenticated HTTP/WSS
以及私有 authority 的存取都由 identity-access 的 owner-scoped internal service 完成。本包只
观察非秘密的 Agent facts、authority readiness 与 Cloud events，不接收 bootstrap key、Token、
私有 authority 或任何通用秘密存储句柄。renderer 不提供 Agent 注册、命名、权限恢复或 primary
选择入口；个人 Session 始终使用当前 Device 的本机 Agent。heartbeat 仅投影
Identity 从当前可执行 AgentRuntime readiness 派生的 capability tags。OIDC、Device、Runtime
或 Agent authority 丢失时连接 fail closed，先停止 outbox/WSS 并 fence 本地 execution，再允许
连接恢复；Agent authority 缺失或过期由 Identity 的同一 ensure 路径自动恢复。

Worker availability 只发布本机事实：它复用最近一次成功 heartbeat 返回的精确 Agent revision、
last-seen 与完整 Runtime capability tags，并从 durable execution journal 计算 active Task count。
User-level offer 会保存到独立的本地 pending journal，但只有本机原子 claim 成功并创建 execution
后才改变 active Task count。automatic preflight 还会直接观察 canonical AgentRuntime readiness；
不可用或观察失败只会让本 Device 保持未认领，不会代表 User 全局拒绝。manual “忽略”同样只关闭
本 Device 的展示，其他同 User Device 仍可 claim。Provider identity、Project Membership 和 content
readiness 不在本地伪造，而由 Cloud 的 Project-scoped availability view 从独立事实组合。

Endpoint challenge 由当前 OIDC User 发起并绑定精确 provider/realm/providerUserId；`/bind`
只证明 provider endpoint 事实，不创建 User、不签发第二种 User credential，也没有匿名 poll
secret。Agent presence、WSS、Inbox 与 durable outbox 使用 Identity 持有的独立、可撤销
Agent authority，不把 OIDC authority 或 Agent 私密材料复制到本包。

远端个人消息始终通过 Host 提供的 thread-targeted `agentExecution` 进入明确 thread，并
携带 durable `clientDirectiveId`。模型、workspace policy、工具、审批和审计仍由唯一的
AgentRuntime/Capability Broker 路径负责。普通手机身份不会生成桌面批准。Worker 的手动/
自动接单、本地 journal、execution fence 与重启恢复继续由本包拥有，不形成第二条 Cloud
认证或 Task 执行路径。

本包还发布唯一的 main-only `sciforge.collaboration.coordinator-cloud-command@6.1.0`
internal service，仅授权 `sciforge.project-coordinator` 消费。其闭集包含 Plan/Offer、统一
HumanNeeded、TaskResult review、Project decision 与 final summary 命令；不包含 target User
`human.answer`，调用者也不能传入 Agent、route、header 或 credential。服务把命令绑定到当前
本机 Agent，并复用同一个 durable outbox 和 Identity Agent Cloud Runtime。它还提供唯一、
严格的 Coordinator Agent Inbox package-owner subscription：`project.started` 与
`coordinator_project` HumanAnswer
只投递给 Project Coordinator，`worker_execution` HumanAnswer 仍只进入 Worker adapter；没有
owner 时 Inbox 处理 fail closed，消息不会被静默 ACK。严格 Cloud revision/fence 错误会随该
outbox entry 持久化并幂等返回；同一调用可按 exact idempotency key 恢复原命令及其严格
response，且 consumer 必须在 failed entry 被重试前校验原命令仍匹配本次调用；该路径不派生
第二个写入或幂等域，非严格 upstream body 也不会写入 journal。

Task 派发的 canonical 路径是：Coordinator 只提交 `workerUserId`，Cloud 创建一个尚无
`executionId` 的 User-level Task Offer 并广播给该 User 当前 eligible 的 Device Agent；第一台成功
CAS claim 的 Device 才在同一 Cloud transaction 中生成不可变 Task Execution、绑定真实
User/Device/Agent 并准备 execution resources。`task.offer.claimed`/`task.offer.closed` 会关闭其他
Device 的本地候选。不存在第二条 Agent 直派、renderer revision 注入或 Device 全局 reject 路径。
