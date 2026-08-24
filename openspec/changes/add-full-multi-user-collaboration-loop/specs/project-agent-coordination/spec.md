## Purpose

定义动态 SciForge User 与精确 Agent 围绕一个 Cloud-authoritative Project 完成计划、接单、执行、真人升级、复审、改派和恢复的单 Coordinator、多 Worker 协作合同。

## ADDED Requirements

### Requirement: Project 恰有一个精确 Coordinator Agent

每个非终态 Project SHALL 有且仅有一个 `coordinatorAgentId`，该 Agent SHALL 属于 Project Member User 且其 Device/Agent 状态满足当前 authority。Project Owner SHALL 是 User；Owner 与 Coordinator SHALL 是独立概念，Owner 可选择自己或其他合格 User 的精确 Agent 作为 Coordinator。

#### Scenario: Owner 创建 Project

- **WHEN** Owner 通过 HCI 创建 Project 并选择一个合格 Agent
- **THEN** Cloud SHALL 将该 Agent 记录为唯一 Coordinator
- **AND** SHALL NOT 根据最近在线、同一 User 的其他 Device 或显示名猜测 Agent。

### Requirement: Worker 由 Coordinator HCI 选择精确 Agent

Coordinator HCI SHALL 按 User 分组展示所有可见 Agent，并让 Human 为 Task 选择精确 `assigneeAgentId`。User 和 Worker 集合 SHALL 是动态的；Cloud SHALL NOT 固定角色账号、验收 fixture 用户或每 User 只有一个 Agent。

#### Scenario: 一个 User 有两台可用 Desktop

- **WHEN** Coordinator 展开该 User 的 Worker 候选
- **THEN** HCI SHALL 分别显示两个 Agent/Device 的状态
- **AND** Task offer SHALL 只投递到 Human 选中的 `assigneeAgentId`。

### Requirement: Worker Availability Projection 只描述当前事实

Cloud SHALL 为 Coordinator 提供包含 Agent/Device active 状态、online/offline、last heartbeat、runtime capability tags、是否接受新 offer、active Task count、Provider identity readiness 和当前 Project content readiness 的 Worker Availability Projection。该 projection SHALL 带 observation time/revision 且仅作选择辅助；它 SHALL NOT 自动接受 Task、保证未来可用或替代 Worker 本地检查。

#### Scenario: Projection 显示 Worker 可用但本机状态已变化

- **WHEN** offer 到达时 Worker 的 Runtime、Provider 或本地接单门禁已不可用
- **THEN** Worker SHALL 拒绝或保持未接受并返回有界原因
- **AND** Cloud SHALL NOT 因旧 projection 强制其执行。

### Requirement: 接单策略是每 Agent Device 的本地持久策略

每个 Agent Device SHALL 本地持久化 `manual` 或 `automatic` Task acceptance policy。Cloud Task 合同 SHALL NOT 包含 `acceptancePolicy`，策略 SHALL NOT 跨 Device 同步。自动接单仍 SHALL 在本机检查 Device、Runtime、Task capability、并发、Project membership 和内容 readiness 后明确发送 accept；手动模式 SHALL 要求 Human accept 或 reject 并可附有界原因。

#### Scenario: 同一 User 的两个 Agent 使用不同策略

- **WHEN** Agent A 配置为 manual 且 Agent B 配置为 automatic
- **THEN** 两个本地策略 SHALL 独立持久化和生效
- **AND** Cloud SHALL 只记录各 offer 的接受或拒绝事实，不记录策略来源。

### Requirement: 每次分派产生新的 fenced execution

Task SHALL 以 offer 开始，并允许目标 Agent accept、reject 或在超时/撤回后被重新分派。每次有效分派 SHALL 创建新的唯一 `executionId`；Cloud SHALL 将旧 execution fence 为不可写，并通过 expected revision、idempotency key 和 assignee identity 拒绝其 ACK、progress、HumanNeeded、result、record 或文件引用。

#### Scenario: Worker 拒绝后改派

- **WHEN** 第一个 Agent 拒绝 Task 且 Coordinator 选择替代 Agent
- **THEN** Cloud SHALL 创建新 `executionId` 并向替代 Agent 投递新 offer
- **AND** 第一个 Agent 对旧 execution 的任何迟到提交 SHALL 被确定性拒绝。

#### Scenario: 重复 offer 或 ACK

- **WHEN** 断线恢复导致相同消息或 idempotency key 被重复提交
- **THEN** Cloud 与 Agent SHALL 返回同一已提交事实而不重复执行或推进 revision。

### Requirement: Cloud 是协作状态的唯一事实源

Cloud SHALL 权威保存 Project、Membership、Task、execution fence、Project Record、Inbox sequence、receipt、revision 和 idempotency 结果；本地 AgentRuntime SHALL 权威执行本机工作并持久化其 execution journal。WebSocket SHALL 只提示 Inbox 可用，离线或重连后客户端 SHALL 从持久 sequence 补拉并幂等 ACK，而不得以 socket 事件本身推进业务状态。

#### Scenario: Worker 接单后重启

- **WHEN** Worker 在 accept 后、result 前重启
- **THEN** 它 SHALL 从本地 journal 与 Cloud Task 状态恢复同一 `executionId`
- **AND** SHALL NOT 创建第二次 execution 或重复提交已确认的外部写。

### Requirement: Coordinator 计划和 Worker 工作使用真实 AgentRuntime

Coordinator 的 Project plan 与 Worker 的 Task transformation SHALL 通过 runtime-neutral AgentRuntime 使用当前 Device 配置的真实 Runtime/模型完成。生产路径 SHALL NOT 使用预计算计划、脚本输出、fixture response、Cloud-hosted 特殊 LLM 或协作专属 Runtime；Cloud MAY 记录 runtime/model ID 和结果 provenance，但不得记录秘密或隐藏 prompt material。

#### Scenario: Coordinator 生成会议任务计划

- **WHEN** Human 提供真实合成议程与需求文件
- **THEN** Coordinator Agent SHALL 调用本机选定 Runtime 生成可编辑计划
- **AND** Human SHALL 能在 HCI 中确认或修改后再创建 Task。

### Requirement: HumanNeeded 的权威回答者是 Project Owner

Run-0 中 Worker `HumanNeeded` SHALL 定向 Project Owner 的 OIDC User。Cloud SHALL 持久化 question、targetUserId、expiry、answer receipt 和对应 execution；只有当前 Project Owner 的认证 Human 操作可提交答案，不引入 Reviewer 系统角色。

#### Scenario: 非 Owner 尝试回答

- **WHEN** 其他 Member 或 Agent 对一个 pending HumanNeeded 提交答案
- **THEN** Cloud SHALL 拒绝该请求而不改变 question 状态
- **AND** Owner HCI SHALL 保持该问题可见且不默认折叠隐藏。

### Requirement: Coordinator 复审显式接受或要求修订

Coordinator SHALL 在 HCI 中审阅 Worker result 与关联文件，并对每个提交执行 `accept` 或 `request_revision`；修订 SHALL 创建新的有界 execution/revision，旧提交保持 provenance 但不再可覆盖当前结果。新 Project 创建成功后 HCI SHALL 自动聚焦该 Project，pending plan 与审批卡 SHALL 默认可见。

#### Scenario: Coordinator 要求一次修订

- **WHEN** Coordinator 对 Worker 结果选择 request revision 并给出要求
- **THEN** Cloud SHALL 记录审阅决定和新 revision/execution
- **AND** Worker SHALL 只在接受新的 offer 后继续修改。

### Requirement: Coordinator 转交由 Owner 显式执行并立即 fencing

Project Owner SHALL 能把 Coordinator 转交给一个合格的精确 Agent。Cloud SHALL 在同一权威提交中更新 Coordinator revision、立即 fence 旧 Coordinator 的 coordinator-only 写权限并通知双方；系统 SHALL NOT 自动选主或因心跳离线转交。

#### Scenario: 旧 Coordinator 在转交后提交计划

- **WHEN** 旧 Coordinator 使用转交前 revision 更新 plan 或创建 Task
- **THEN** Cloud SHALL 返回 fenced/conflict
- **AND** 只有新 Coordinator Agent 可执行后续 Coordinator 写入。
