# 云端协作内核需求

## Requirement: 云端不拥有 Agent 智能

云端 SHALL 只提供身份、Project/Task 账本、长期记忆、Agent 信箱、消息中转和最小并发控制，
SHALL NOT 内置负责拆任务、研究判断或工具执行的特殊 Agent。

### Scenario: 创建 Project

- **WHEN** 用户创建 Project 并指定一台 SciForge 为 Coordinator
- **THEN** 云端 SHALL 持久化 Project、成员、Goal 和 Coordinator 身份
- **AND** SHALL 把 Project 激活事件投递给该 SciForge
- **AND** SHALL NOT 自行生成项目计划。

### Scenario: 普通云机器参与协作

- **WHEN** 一台云机器上的 SciForge 作为 Worker 或 Coordinator 加入 Project
- **THEN** 它 SHALL 使用与桌面和服务器 SciForge 相同的 Agent 合同
- **AND** 云端协作内核 SHALL NOT 为其提供额外的隐式智能权限。

## Requirement: Project 和 Task 有唯一权威状态

云端 SHALL 作为 Project、Task、Coordinator、assignee、revision 和状态的 canonical owner，
并根据调用者身份拒绝越权或过期状态修改。

### Scenario: 非 Coordinator 修改计划

- **WHEN** 普通 Worker 尝试创建全局 Task、修改 Project 计划或完成 Project
- **THEN** 云端 SHALL 拒绝请求并返回稳定权限错误。

### Scenario: 非 assignee 提交 Task 结果

- **WHEN** 一个不是当前 Task assignee 的 Agent 提交完成结果
- **THEN** 云端 SHALL 拒绝结果
- **AND** 当前 Task 状态 SHALL 保持不变。

### Scenario: 过期 revision 提交结果

- **WHEN** Agent 使用旧 Task revision 提交状态或结果
- **THEN** 云端 SHALL 返回 typed revision conflict
- **AND** SHALL NOT 覆盖新版本 Task。

## Requirement: 消息先持久化再投递

所有 Project 和 Task 消息 SHALL 带稳定 message ID，在状态变更和实时投递前持久化，并支持
离线保留、确认和重连补发。

### Scenario: Worker 离线

- **WHEN** Coordinator 向离线 Worker 创建 TaskOffer
- **THEN** 云端 SHALL 保留消息
- **AND** 在 Worker 重连并确认最后序号后按序补发。

### Scenario: 重复消息

- **WHEN** 云端收到相同 message ID 的重复请求
- **THEN** SHALL 返回已有 receipt
- **AND** SHALL NOT 再次改变 Task 状态或投递第二份逻辑消息。

## Requirement: 云端长期记忆严格分区

云端 SHALL 至少提供用户私有和 Project 共享两个记忆命名空间，并根据 owner、成员和记录类型
执行访问控制。

### Scenario: 另一个用户读取私有记忆

- **WHEN** 非 owner 用户或其 Agent 请求读取 User Memory
- **THEN** 云端 SHALL 拒绝访问
- **AND** SHALL NOT通过搜索或摘要泄漏记录内容。

### Scenario: Worker 发布项目观察

- **WHEN** 当前 Task assignee 提交 observation 或 TaskResult
- **THEN** 云端 MAY 将其追加到 Project Memory
- **AND** SHALL 保留作者、Task、时间和 revision 来源。

### Scenario: Worker 写入正式 Decision

- **WHEN** 普通 Worker 尝试直接写入 Project `decision`
- **THEN** 云端 SHALL 拒绝或按合同把它降为 proposal/observation
- **AND** 只有 Coordinator 或有权真人可以提交正式 Decision。

## Requirement: 云端保持简单可恢复

PoC 云端 SHALL 使用一个服务进程、一个 PostgreSQL 事实库和一个 WebSocket 通道，并从数据库
恢复 Project、Task、消息和记忆状态。

### Scenario: 云端进程重启

- **WHEN** 云端在活跃 Project 中重启
- **THEN** 已提交的 Project、Task、result、HumanNeeded 和消息 SHALL 保持可恢复
- **AND** 客户端重连 SHALL NOT 导致重复 Task 执行。
