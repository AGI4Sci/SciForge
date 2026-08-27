# 云端协作内核需求

## ADDED Requirements

### Requirement: 云端拥有统一身份和协作事实

Collaboration Server SHALL 是 User、Human Endpoint Binding、Agent ownership、Participant Profile、Project、Task、Project Record、Inbox 和协作 receipt 的 canonical owner。Zulip 和本地客户端 SHALL NOT 维护可独立冲突的第二套协作状态。

#### Scenario: 用户从手机和桌面查看 Project

- **WHEN** 两端查询同一 Project revision
- **THEN** 两端 SHALL 读取同一云端 Project/Task 状态
- **AND** Zulip 历史 SHALL NOT 覆盖云端状态。

### Requirement: 云端不拥有 Agent 智能或本地权限

云端 SHALL 提供确定性身份、Project/Task 账本、共享记录、信箱、消息中转、授权和并发控制，SHALL NOT 内置负责研究判断、模型推理或本地工具执行的特殊 Agent。

#### Scenario: 创建 Project

- **WHEN** 用户在已登录且已建立当前 Device Agent 的 Desktop 创建 Project
- **THEN** 云端 SHALL 持久化 Project、成员、目标和 Coordinator
- **AND** SHALL 投递 `project.started`
- **AND** SHALL NOT 自行生成项目计划。

### Requirement: Project 和 Task 有唯一权威状态

Project SHALL 记录 member user IDs、唯一 active Coordinator Agent 和 revision；Task SHALL 记录 Worker User、required capability tags 和 revision。User-level Offer 被原子 claim 后，当前 Task Execution SHALL 记录唯一 assignee User/Device/Agent 和 fence。所有写入 SHALL 验证 actor user/agent、所有权、Project role、expected revision 和状态机。

#### Scenario: 非 Coordinator 修改计划

- **WHEN** Worker 或普通成员尝试创建全局 Task、改写正式计划或完成 Project
- **THEN** 云端 SHALL 拒绝并返回 typed permission error
- **AND** Project revision SHALL 保持不变。

#### Scenario: 非 assignee 提交结果

- **WHEN** 非当前 assignee Agent 提交 TaskResult
- **THEN** 云端 SHALL 拒绝结果
- **AND** 当前 Task SHALL 保持不变。

#### Scenario: Agent owner 不是 Project 成员

- **WHEN** Coordinator 尝试把 Task 分配给未授权的 Worker User
- **THEN** 云端 SHALL 拒绝分配
- **AND** 不得通过选择该 User 的某个 Agent 绕过 Membership 或 Task Authority。

### Requirement: 状态变化和信箱消息原子持久化

所有协作写操作 SHALL 带 idempotency key；实体状态变化和对应 InboxMessage SHALL 在同一事务中持久化。WebSocket SHALL 只通知 inbox 可用，不能作为事实源。

#### Scenario: Worker 离线

- **WHEN** 一个 Worker User 的合格 Agent 在 Offer 创建后断线
- **THEN** User-level Task Offer 与已产生的 Agent Inbox 通知 SHALL 持久化
- **AND** 该 Agent 重连后 SHALL 从最后确认 sequence 按序读取，并在 claim 时重验当前可派发事实。

#### Scenario: 请求重试

- **WHEN** 云端收到相同 actor 和 idempotency key 的相同请求
- **THEN** SHALL 返回已有 receipt
- **AND** SHALL NOT 第二次改变状态或投递消息。

### Requirement: 云端共享记忆严格分区

云端 SHALL 保存 Project 正式 observation、decision、summary 和被接受的 TaskResult 摘要，并按成员和角色控制访问。完整个人 Session、本地工具日志、凭据和原始数据 SHALL NOT 自动进入 Project Record。

#### Scenario: Worker 提交观察

- **WHEN** 当前 assignee 提交 TaskResult 或 observation
- **THEN** 云端 SHALL 保留作者 user/agent、Task、revision 和时间
- **AND** Coordinator SHALL 决定是否接受为正式 Project Record。

#### Scenario: 其他用户读取私人 Session

- **WHEN** Project 成员请求另一用户的完整本地 transcript
- **THEN** 云端 SHALL 无此默认数据或 authority
- **AND** SHALL NOT 通过摘要或搜索泄漏私人内容。

### Requirement: 云端保持简单且可恢复

PoC SHALL 使用一个服务、一个 PostgreSQL 事实库和一个 WebSocket 入口，并从数据库恢复身份、绑定、Project、Task、Record、Inbox、cursor 和 receipt。

#### Scenario: 云端进程重启

- **WHEN** 服务在 active Project 中重启
- **THEN** 已提交状态和未确认信箱 SHALL 保持可恢复
- **AND** 客户端重连 SHALL NOT 导致重复 Task 或 HumanAnswer。
