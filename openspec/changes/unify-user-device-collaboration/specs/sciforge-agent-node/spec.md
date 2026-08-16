# SciForge Agent 节点需求

## ADDED Requirements

### Requirement: 每台 SciForge 是所属用户的独立 Agent 节点

每个参与协作的 SciForge SHALL 使用稳定 `agentId`、`ownerUserId`、节点名称、节点类型、能力和在线状态注册。PoC 用户 SHALL 明确选择 primary Agent；同一用户的其他节点 SHALL NOT 被自动选为替代执行者。

#### Scenario: 同一用户注册桌面和服务器节点

- **WHEN** 用户注册两台 SciForge
- **THEN** 云端 SHALL 表示为两个不同 Agent，且 ownerUserId 相同
- **AND** 每个节点 SHALL 分别报告能力、状态和心跳
- **AND** 个人 Session SHALL 固定其中一个 agentId。

### Requirement: Agent 使用设备身份连接统一信箱

Agent SHALL 使用仅属于本节点的可撤销 device credential 连接云端，通过统一版本化合同读取 Inbox、确认 sequence、接受或拒绝 Task、报告状态并提交结果。

#### Scenario: Agent 接受 Task

- **WHEN** Agent 收到分配给自己的当前 revision TaskOffer
- **THEN** SHALL 发送 TaskAccepted receipt
- **AND** 只有云端确认 assignee 后才开始正式执行。

#### Scenario: Agent 收到其他节点的消息

- **WHEN** InboxMessage.recipientAgentId 与当前 Agent 不同
- **THEN** Agent SHALL 拒绝处理
- **AND** 云端 SHALL 记录路由一致性错误。

### Requirement: 任务和个人消息复用现有 AgentRuntime

远端个人消息和云端 Task SHALL 通过现有 runtime-neutral AgentRuntime Host 执行，并使用唯一 Capability Broker、secret、workspace 和审计路径。协作领域 SHALL NOT 增加 provider 专属 Runtime、工具旁路或第二套执行 facade。

#### Scenario: Task 访问本地 Workspace

- **WHEN** Task 需要读取用户已授权的 Workspace
- **THEN** Agent MAY 在现有 workspace/file policy 内读取
- **AND** 云端 SHALL 不获得本地路径 authority。

#### Scenario: Task 需要高风险工具

- **WHEN** 执行触发本地策略要求批准的动作
- **THEN** Agent SHALL 使用 canonical approval path
- **AND** Project membership 或手机身份 SHALL NOT 自动批准。

### Requirement: Agent 断线重连不重复执行

Agent SHALL 持久化或恢复正在处理的 projection/task identity、revision、local turn 和最后确认 sequence，并与云端 receipt 协调继续、刷新或终止。

#### Scenario: Task 执行中断线

- **WHEN** Agent 与云端断开但本地 Task 仍在运行
- **THEN** MAY 按本地策略继续
- **AND** 重连后 SHALL 报告实际状态而不是重新接受同一 revision。

#### Scenario: Task 已改派

- **WHEN** Agent 重连发现旧 revision 已取消或改派
- **THEN** SHALL 停止提交旧版本正式结果
- **AND** MAY 保存本地输出作为未接受诊断，但 SHALL NOT 覆盖当前 Task。

### Requirement: Agent 撤销立即阻止新工作

撤销 Agent 或轮换 device credential SHALL 阻止新 Inbox 和状态写入。正在执行的动作 SHALL 按 capability 和 Task cancellation policy 停止、完成隔离或等待人工处理。

#### Scenario: 用户报告机器丢失

- **WHEN** owner 撤销 Agent
- **THEN** 云端 SHALL 拒绝旧 credential
- **AND** SHALL 将未完成 Task 标记为需要 Coordinator 处理
- **AND** SHALL NOT 自动改派并重复执行。

### Requirement: 协作节点由一个领域包拥有

Agent 注册、Session projection、本地 receipt/queue、Task 适配和协作 UI SHALL 由同一个版本化 `@sciforge/domain-collaboration` 包通过独立 main/renderer 入口拥有，并经 manifest/generated composition 安装。

#### Scenario: 安装或移除协作领域

- **WHEN** generated composition 增加或移除领域 manifest
- **THEN** Host SHALL 无需修改领域 ID switch 或 feature map
- **AND** 领域 SHALL 不导入 Host-private main、renderer 或 shared 路径。
