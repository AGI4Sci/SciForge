# 人类 IM 需求

## Requirement: 手机 IM 只承载人类注意力事项

手机/响应式网页 SHALL 只展示需要用户行动的问题、审批、重要摘要和最终结果，SHALL NOT 把
Agent 工具日志、内部推理、心跳、普通进度或机器间消息暴露为用户通知。

### Scenario: Worker 正常汇报进度

- **WHEN** Worker 发送普通 TaskProgress
- **THEN** 桌面 Project UI MAY 更新状态
- **AND** 手机 SHALL NOT产生真人通知。

### Scenario: Agent 需要用户决定

- **WHEN** HumanNeeded 指向当前用户
- **THEN** 手机 SHALL 创建可操作通知
- **AND** 展示问题、原因、已确认事实、建议和关联 Project/Task。

## Requirement: 真人回答可追溯并恢复项目

HumanAnswer SHALL 记录回答用户、Project、Task、HumanNeeded、时间和内容，并通过云端信箱通知
Coordinator。

### Scenario: 用户在手机回答

- **WHEN** 用户提交文本或结构化选择
- **THEN** 云端 SHALL 持久化一次回答 receipt
- **AND** Coordinator SHALL 收到 HumanAnswerAvailable
- **AND** 重复提交 SHALL NOT产生第二个逻辑回答。

### Scenario: 请求已经关闭

- **WHEN** 用户回答已经取消、完成或被新 revision 替代的 HumanNeeded
- **THEN** 手机 SHALL 显示请求已过期
- **AND** 云端 SHALL NOT修改当前 Task。

## Requirement: 手机不是 PoC AgentRuntime

PoC 手机端 SHALL 是响应式 IM 界面，不运行完整 SciForge Agent、模型、工具或本地任务执行。

### Scenario: 项目需要执行计算

- **WHEN** 用户从手机查看需要计算的 Task
- **THEN** 手机 SHALL 只显示状态或允许转给已注册 SciForge Agent
- **AND** SHALL NOT在浏览器内隐式执行 AgentRuntime。

## Requirement: 会议问题便于快速决定

会议场景中的 HumanNeeded SHALL 优先提供结构化选项和 Agent 建议，同时允许用户选择仍需多人
讨论。

### Scenario: 用户接受 Agent 建议

- **WHEN** 用户选择 Agent 推荐方案
- **THEN** 回答 SHALL 作为正式人类 Decision 来源返回 Coordinator
- **AND** Coordinator MAY 据此创建后续 Task 或完成 Project。

### Scenario: 用户要求多人讨论

- **WHEN** 用户选择仍需多人同步
- **THEN** Coordinator SHALL 把议题归入多人讨论清单
- **AND** 最终摘要 SHALL 给出必要参与人和待讨论内容。
