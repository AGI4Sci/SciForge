# 多用户 Project Agent 协作需求

## ADDED Requirements

### Requirement: Project 成员与 Worker 目标是 User，Execution 执行者是 Agent

Project SHALL 使用 `memberUserIds` 表达参与者，使用 `coordinatorAgentId` 表达 Project Coordinator，并使用 Task Offer `workerUserId` 表达 Worker 目标。只有成功 claim 后的 Task Execution SHALL 记录 `assigneeAgentId`/Device。系统 SHALL 通过 Agent `ownerUserId` 验证成员、Offer 目标与执行者关系，不能把 userId 和 agentId 当成可互换身份。

#### Scenario: 六名用户加入 Project

- **WHEN** 六个 UserPrincipal 成为成员且各自的一台或多台 Agent/Device 运行时上线
- **THEN** Project SHALL 记录六个 userId
- **AND** Agent registry SHALL 分别记录其 owner
- **AND** 手机与机器 SHALL 在 UI 中组合显示为六个协作个体。

### Requirement: 每个 Project 只有一个活跃 Coordinator

Project SHALL 同时记录一个 active Coordinator Agent。只有该 Agent 能维护正式计划、创建或改派 Task、接受结果和完成 Project；Coordinator 的 owner SHALL 是 Project 成员或显式服务角色。

#### Scenario: 发起人指定 Coordinator

- **WHEN** 用户创建 Project 并选择一台有权 Agent
- **THEN** 云端 SHALL 原子记录 Coordinator 和 Project revision
- **AND** 向该 Agent 投递 `project.started`。

#### Scenario: 手动转交 Coordinator

- **WHEN** 有权用户将 Coordinator 转交给另一台 Agent
- **THEN** 云端 SHALL 原子更新 coordinatorAgentId 和 revision
- **AND** 旧 Coordinator 后续计划写入 SHALL 被拒绝。

### Requirement: Project 使用星形结构化任务协作

Coordinator SHALL 通过云端为 Worker User 创建独立 Task Offer；Cloud SHALL 向该 User 的合格 Agent/Device Runtime 广播，但只有首个原子 claim 成功的 Agent SHALL 更新其 Execution、提交结果或提出子任务建议，不得自由修改计划或向其他 Agent 广播可执行指令。

#### Scenario: 两个 Worker 并行执行

- **WHEN** Coordinator 创建两个无依赖 Task 并分配给两个 Worker User
- **THEN** 两个 User 中各自首个领取的 Agent MAY 并行执行
- **AND** 各自 SHALL 只能更新已绑定自己 Agent/Device 的 Task Execution。

#### Scenario: Worker 需要其他能力

- **WHEN** Worker 判断需要另一 Agent 帮助
- **THEN** SHALL 向 Coordinator 提交结构化建议
- **AND** Coordinator SHALL 决定是否创建新 Task。

### Requirement: Project topic 不等于共享私人 Session

Project topic SHALL 是 ProjectInput 和人类通知的远端投影。Coordinator MAY 在自己的本地 thread 中处理输入，但该 thread SHALL NOT 被表示为所有成员共同拥有的 Session，其他成员消息也 SHALL NOT 自动路由到各自 Agent。

#### Scenario: 两名成员同时在 Project topic 发言

- **WHEN** A 和 B 提交 ProjectInput
- **THEN** 云端 SHALL 分别保存其 senderUserId 和顺序
- **AND** Coordinator SHALL 按 Project queue 处理
- **AND** A、B 的 Worker SHALL 只在收到 Task 时执行。

### Requirement: Coordinator 循环有明确预算

PoC SHALL 限制每 Project Task 数、每轮新增 Task、重试次数和协调轮数。超出预算 SHALL 生成失败、当前总结或 HumanNeeded，而不是无限创建工作。

#### Scenario: Task 重复失败

- **WHEN** Task 达到最大自动重试次数
- **THEN** Coordinator SHALL 停止相同重试
- **AND** 选择改派、重新规划、创建 HumanNeeded 或保留明确失败。

### Requirement: HumanNeeded 定向到用户并恢复 Project

Agent 无法可靠继续时 SHALL 创建绑定 Project/Task 和 `targetUserId` 的 HumanNeeded。有效 HumanAnswer SHALL 记录回答 endpoint 和 assurance，并通知 Coordinator；无关用户的回答 SHALL 被拒绝。

#### Scenario: B 回答自己的问题

- **WHEN** B 通过 active endpoint 回答目标为 B 的请求
- **THEN** 云端 SHALL 持久化一次回答 receipt
- **AND** Coordinator SHALL 收到 `human.answered`
- **AND** MAY 基于回答继续 Task 或创建新 revision。

#### Scenario: A 尝试代答 B 的私人决定

- **WHEN** A 没有委托角色却回答目标为 B 的请求
- **THEN** 云端 SHALL 拒绝
- **AND** Task SHALL 保持 `needs_human`。

### Requirement: Project 共享记录有明确作者和接受者

Worker SHALL 提交 TaskResult、observation 或 proposal；只有 Coordinator 或有权真人 SHALL 把内容接受为正式 decision/summary。每条 Project Record SHALL 保留 authorUserId、authorAgentId、sourceTaskId 和 revision。

#### Scenario: Worker 直接写正式 Decision

- **WHEN** 普通 Worker 尝试写正式 decision
- **THEN** 云端 SHALL 拒绝或降为 proposal
- **AND** Project 正式状态 SHALL 不被越权修改。
