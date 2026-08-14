# Project Agent 协作需求

## Requirement: 每个 Project 只有一个活跃 Coordinator

Project SHALL 记录一个当前 Coordinator Agent，只有该 Agent 能维护正式计划、创建或改派 Task、
接受结果和完成 Project。

### Scenario: 发起人指定 Coordinator

- **WHEN** 用户创建 Project 并选择自己的桌面、服务器或云端 SciForge
- **THEN** 云端 SHALL 记录该 Agent 为 Coordinator
- **AND** 向其投递 ProjectActivated。

### Scenario: 手动转交 Coordinator

- **WHEN** 有权用户把 Coordinator 转交给另一台在线 SciForge
- **THEN** 云端 SHALL 原子更新 Coordinator identity 和 Project revision
- **AND** 旧 Coordinator 后续的计划写入 SHALL 被拒绝。

## Requirement: Project 采用星形任务协作

Coordinator SHALL 通过云端为 Worker 创建独立 Task；Worker SHALL 向 Coordinator 提交状态、结果
和问题，而不是自由修改计划或向其他 Worker 广播任务。

### Scenario: 两个 Worker 并行执行

- **WHEN** Coordinator 创建两个无依赖 Task 并分别分配给两个 Worker
- **THEN** 两个 Worker MAY 并行执行
- **AND** 各自只能更新自己的 Task。

### Scenario: Worker 需要另一个 Agent 帮助

- **WHEN** Worker 判断需要另一个能力
- **THEN** SHALL 向 Coordinator 提交子任务建议
- **AND** 由 Coordinator 决定是否创建和分配新 Task。

## Requirement: Coordinator 循环有明确预算

PoC Coordinator SHALL 限制每个 Project 的任务数、每轮新增任务数、重试次数和协调轮数，超出
预算时生成失败或 HumanNeeded，而不是无限自我扩张。

### Scenario: Task 重复失败

- **WHEN** Task 达到最大自动重试次数
- **THEN** Coordinator SHALL 停止相同重试
- **AND** 选择重新规划、改派、创建 HumanNeeded 或保留明确失败。

### Scenario: Project 达到协调轮数上限

- **WHEN** 仍有未解决议题但已达到最大轮数
- **THEN** Coordinator SHALL 生成当前结果、未解决项和真人建议
- **AND** SHALL NOT继续创建无界任务。

## Requirement: HumanNeeded 是显式暂停点

Agent 无法可靠继续时 SHALL 创建绑定 Project/Task 的 HumanNeeded，说明问题、已知事实、原因和
可选建议；相关 Task 保持等待，直到真人回答或明确取消。

### Scenario: 真人回答后恢复

- **WHEN** 有权用户提交 HumanAnswer
- **THEN** 云端 SHALL 记录回答并通知 Coordinator
- **AND** Coordinator SHALL 基于该回答继续原 Task、创建新 revision 或完成议题。

### Scenario: 无关用户回答

- **WHEN** 不在目标用户或批准角色中的用户尝试回答
- **THEN** 云端 SHALL 拒绝
- **AND** Task SHALL 保持 `needs_human`。

## Requirement: 会议准备结果按人类需求分类

会议场景完成时，Coordinator SHALL 把议题明确分为已自动解决、只需单人确认和确实需要多人
同步讨论，并为多人讨论提供最小参与人、未解决问题和已有材料。

### Scenario: 所有议题均解决

- **WHEN** Agent 结果和单人回答已经满足全部完成条件
- **THEN** Coordinator SHALL 完成 Project
- **AND** 输出不需要真人会议的理由和已确认结论。

### Scenario: 仍需多人讨论

- **WHEN** 剩余议题涉及多方价值判断或相互依赖的真实冲突
- **THEN** Coordinator SHALL 只建议必要人员
- **AND** SHALL 给出待讨论问题、已知事实、方案和建议时长
- **AND** PoC SHALL NOT自动创建日历或视频会议。
