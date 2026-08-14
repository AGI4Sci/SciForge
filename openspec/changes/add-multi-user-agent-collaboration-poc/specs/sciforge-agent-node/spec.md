# SciForge Agent 节点需求

## Requirement: 每个 SciForge 安装实例是独立 Agent 节点

每个参与协作的 SciForge SHALL 使用稳定 agent ID、owner 用户、节点名称、节点类型和能力集合
注册到云端，同一用户 MAY 注册多个节点。

### Scenario: 用户同时注册桌面和服务器

- **WHEN** 同一用户的桌面 SciForge 和服务器 SciForge 连接云端
- **THEN** 云端 SHALL 将它们表示为两个独立 Agent
- **AND** 每个节点 SHALL 分别报告能力、在线状态和最后心跳。

### Scenario: 节点重新启动

- **WHEN** 已绑定设备上的 SciForge 重启
- **THEN** SHALL 恢复同一 agent ID
- **AND** SHALL NOT 静默注册为第二个新 Agent。

## Requirement: Agent 通过统一信箱接收和回报 Task

SciForge Agent SHALL 通过同一版本化合同接收 TaskOffer、接受或拒绝、汇报进度、提交结果、失败
或 HumanNeeded，并确认已消费消息序号。

### Scenario: Agent 接受 Task

- **WHEN** Agent 在线且接受当前 revision 的 TaskOffer
- **THEN** SHALL 发送 TaskAccepted receipt
- **AND** 只有云端确认 assignee 后才开始正式执行。

### Scenario: Agent 拒绝 Task

- **WHEN** Agent 缺少能力、权限或用户不同意执行
- **THEN** SHALL 返回 bounded TaskRejected reason
- **AND** SHALL NOT在本地启动 AgentRuntime 工作。

## Requirement: 任务执行复用现有 AgentRuntime 和权限路径

远端 Task SHALL 通过 SciForge 的 runtime-neutral AgentRuntime Host 和现有 Capability Broker 执行，
SHALL NOT 新增云端专属模型 Runtime、工具旁路或权限豁免。

### Scenario: Task 读取已授权 Workspace

- **WHEN** 用户已经允许当前 Project 使用某个 Workspace
- **THEN** Agent MAY 在现有 workspace/file policy 内读取
- **AND** 云端 SHALL NOT获得本地路径或文件 authority。

### Scenario: Task 需要高风险工具

- **WHEN** 执行触发本地文件写入、命令、外部发布或其它需审批动作
- **THEN** SHALL 使用现有本地治理和用户审批
- **AND** Project 授权 SHALL NOT 自动等价于该工具批准。

## Requirement: Agent 断线重连不重复执行

Agent SHALL 持久化或能够恢复正在处理的 Task identity、revision 和最后确认事件，并用云端 receipt
判断是否需要继续、刷新或终止。

### Scenario: Agent 执行中断线

- **WHEN** Agent 与云端断开但本地 Task 仍在运行
- **THEN** MAY 按本地策略继续
- **AND** 重连后 SHALL 报告当前实际状态而不是重新接受同一 Task。

### Scenario: Task 已被改派

- **WHEN** Agent 重连后发现其旧 Task revision 已被取消或改派
- **THEN** SHALL 停止提交旧版本正式结果
- **AND** MAY 保留本地输出作为未接受诊断，不得覆盖当前 Task。

## Requirement: Project 角色约束清晰

Coordinator 和 Worker SHALL 使用同一 SciForge 软件与 Agent 合同，但根据 Project role 获得不同
状态变更权限。

### Scenario: Worker 提议新工作

- **WHEN** Worker 发现需要新增子任务
- **THEN** SHALL 向 Coordinator 提交建议或问题
- **AND** SHALL NOT直接创建全局 Project Task。
