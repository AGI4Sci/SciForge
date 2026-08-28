## Purpose

定义 Project Coordinator 在 renderer 未挂载、页面关闭或 Desktop 重启后，仍能依据 Cloud 权威事实幂等推进已确认 Plan 的确定性后续任务，并为未来 Agent 自动复审提供唯一事件入口。

## ADDED Requirements

### Requirement: Coordinator 续跑不依赖 Project 页面

当前 Coordinator Agent 所在 Desktop SHALL 在 Project Coordinator domain main runtime 中运行续跑逻辑；renderer 的挂载、聚焦 Project 或轮询 SHALL NOT 是派发后续 Task 的前提。运行时启动后 SHALL 对当前 Owner 可见的非终态 Project 执行一次 fresh-fact reconcile，相关 durable Coordinator Inbox 消息和已接受的结果复审 SHALL 触发同一个 reconcile 路径。

Coordinator Inbox handler SHALL 等待该 reconcile 达到当前 fresh facts 的安全不动点后再返回；若 reconcile 失败，handler SHALL 失败并让既有 Collaboration Inbox 层保留未 ACK 事件以供重放。已由直接 action 提交成功的 accepted review SHALL NOT 因后续后台 reconcile 失败而对调用者伪装成复审回滚。

#### Scenario: Owner 在依赖结果接受后关闭 Project 页面

- **WHEN** confirmed Plan 的一个依赖 Task 已通过权威复审进入 `completed`，且 Project 页面未挂载
- **THEN** 当前 Coordinator main SHALL 从 Cloud facts 推导并派发新解锁的 Plan item
- **AND** renderer SHALL 不参与该状态转换。

#### Scenario: Desktop 在复审提交后、后续派发前重启

- **WHEN** Cloud 已持久化 accepted review，但 Desktop 在创建后续 Offer 前停止
- **THEN** 下一次 runtime activation reconcile SHALL 从 Cloud 当前状态恢复该后续派发
- **AND** SHALL NOT 要求 Human 重复复审或重新确认 Plan。

#### Scenario: Inbox 唤醒后派生写入失败

- **WHEN** Coordinator 已收到 durable Inbox message，但 fresh reconcile 在安全收敛前失败
- **THEN** Inbox handler SHALL 不成功返回，消息 SHALL 不推进 ACK cursor
- **AND** 修复瞬时故障后的重放 SHALL 再次从 fresh Cloud facts reconcile。

### Requirement: Ready set 只由 confirmed Plan 和 fresh Cloud facts 推导

续跑器 SHALL 只考虑 active Project 的当前 confirmed Plan。一个尚无 canonical Task 的 Plan item 只有在其全部 `dependencyPlanItemIds` 对应 Task 均处于 `completed` 时才 SHALL 进入 ready set；无依赖 item SHALL 作为初始 ready set。Project status、Coordinator authority epoch、execution authority epoch、Plan revision、Plan digest、Worker User assignment 和当前 Worker eligibility SHALL 在每次外部写前重新验证。

#### Scenario: 两个依赖中仍有一个未完成

- **WHEN** Plan item 的一个 dependency Task 为 `completed`，另一个仍为 `awaiting_review`
- **THEN** reconcile SHALL 不创建该 item 的 Task 或 Offer
- **AND** 已完成依赖 SHALL 保持原有 provenance。

#### Scenario: 多个 item 同时变为 ready

- **WHEN** fresh Cloud facts 显示多个尚未创建的 Plan item 的全部依赖均已完成
- **THEN** reconcile SHALL 以稳定 Plan 顺序逐个通过 canonical offer command 派发
- **AND** 每次派发前 SHALL 重读最新 Project/Plan authority facts，避免沿用前一次写入前的 revision。

#### Scenario: 邀请或内容 readiness 尚未完成

- **WHEN** Project 尚未 active，或目标 Worker 的 Membership、Task Authority、Runtime capability 或 content readiness 不满足现有 Cloud 门禁
- **THEN** reconcile SHALL 零写入并保留 Project 当前状态
- **AND** SHALL NOT 绕过邀请接受、Team provisioning、Provider observation 或 Task claim 校验。

### Requirement: Plan item 与 Task 使用一个 canonical identity 规则

Plan item 到 Task ID 的确定性映射 SHALL 由 collaboration contracts 公开并由 Cloud server 与 Coordinator 共同消费。实现 SHALL NOT 在 domain package 复制哈希算法、通过 Task 标题猜测 identity、增加兼容别名，或新增第二个 Task 创建 API。

#### Scenario: Reconcile 重复观察同一 ready item

- **WHEN** 同一 Plan item 因 Inbox replay、并发触发或重启被再次 reconcile
- **THEN** Coordinator SHALL 识别已存在的 canonical Task 并不再创建 Offer
- **AND** Cloud 中 SHALL 只保留一个 Task identity 和一个初始创建结果。

### Requirement: 后续派发使用稳定幂等命令

每个 ready Plan item 的派发 SHALL 通过现有 Coordinator Agent command service 和 `task.offer.create` 执行，幂等 identity SHALL 绑定 Project、confirmed Plan identity/digest 和 Plan item identity。Cloud 返回 conflict、stale authority 或失去 eligibility 时 SHALL fail closed；续跑器 SHALL 通过之后的 fresh reconcile 决定是否重试，不得改走 User transport、renderer IPC、数据库写入或 fallback service。

#### Scenario: Cloud 已提交 Offer 但 Desktop 未观察到响应

- **WHEN** `task.offer.create` 已在 Cloud 提交而本地在读取响应前中断
- **THEN** 使用相同事实再次 reconcile SHALL 收敛到同一已存在 Task
- **AND** SHALL NOT 创建第二个 Task、Offer 或 execution。

#### Scenario: Coordinator 在 reconcile 期间被转交

- **WHEN** 当前 Agent 的 Coordinator authority epoch 在写入前已变化
- **THEN** Cloud SHALL 拒绝旧 Coordinator 命令
- **AND** 旧 Agent SHALL 停止该 Project 的续跑，新的当前 Coordinator SHALL 能从 fresh facts 恢复。

### Requirement: 确定性续跑不得伪造智能判断

本阶段续跑器 SHALL NOT 仅依据结果到达就自动 accept/request-revision，不得生成 HumanAnswer、decision 或 final summary，也不得跳过 `manual_recovery_required`。结果到达事件 SHALL 交给 Project Coordinator 的唯一 main owner 并保留为 pending review；只有已由 canonical review 路径接受的结果才能解锁依赖 Task。

#### Scenario: Worker 提交结果但尚未复审

- **WHEN** Cloud 投递 `task.result.submitted` 且对应 Task 为 `awaiting_review`
- **THEN** Project Coordinator main SHALL 消费并核验该 durable event，但 ready-set reconcile SHALL 不把该 Task视为完成
- **AND** SHALL 不通知 Human 为“必须处理”，除非后续 Agent review 或现有恢复规则判定确需 Human 判断。
