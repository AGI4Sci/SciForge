## Purpose

定义动态 SciForge User 与其 Agent/Device Runtime 围绕一个 Cloud-authoritative Project 完成计划、User 级派发、设备领取、执行、真人升级、复审、改派和恢复的单 Coordinator、多 Worker 协作合同。

## ADDED Requirements

### Requirement: Project 恰有一个精确 Coordinator Agent

每个非终态 Project SHALL 有且仅有一个 `coordinatorAgentId`，且该 Agent SHALL 始终由 `ownerUserId` 指向的 Project Owner 所有，并满足当前 Device/Agent authority。Project Owner SHALL 是 User；Coordinator SHALL 是该 Owner 的精确 Agent，而不是另一个账号、全局角色或其他 Member 的 Agent。

#### Scenario: Owner 创建 Project

- **WHEN** Owner 在已登录且 Identity 已自动确保 canonical Agent 的当前 Cloud Device 上通过 HCI 创建 Project
- **THEN** Desktop main SHALL 通过当前 Device 的 Agent-authenticated canonical command path 创建 Project，Cloud SHALL 从该认证 Agent 派生 Owner User、Device 与唯一 Coordinator
- **AND** renderer SHALL NOT 接收或提交 `coordinatorAgentId`、Agent revision 或手工注册输入
- **AND** 该身份 SHALL 仅建立此 Project 的 Coordinator 关系，不得把 User、Device 或 Agent 标记为账号级 Coordinator
- **AND** Cloud Device ID SHALL 与 Host installation/execution node ID 保持不同语义，不得通过令二者相等来建立绑定。

### Requirement: Worker 由 Coordinator HCI 选择 User

Coordinator HCI SHALL 从 Cloud-global online Worker directory 中聚合 Worker User；在 Plan 中 Human SHALL 为每个 Task 选择精确 `workerUserId`，不得选择 Agent 或 Device。候选 SHALL NOT 限于当前 Project Member 或当前 OIDC User 的 `participant.get` self-Agent 列表。User 和 Worker 集合 SHALL 是动态的；Cloud SHALL NOT 固定角色账号、验收 fixture 用户或每 User 只有一个 Agent。创建与派发选择合约 SHALL 只向 renderer 下发 User ID 与显示名；Agent/Device/revision 仅保留在 Cloud/Main 的资格与投递证据中。

#### Scenario: 一个 User 有两台可用 Desktop

- **WHEN** Coordinator 选择该 User 为 Worker
- **THEN** HCI SHALL 只显示并提交该 `workerUserId`，不得暴露或选择两个 Agent/Device
- **AND** Cloud SHALL 向该 User 所有满足 Task capability/authority/readiness 的在线 Agent/Device Runtime 广播同一个 User-level Task Offer。

### Requirement: Worker Availability Projection 只描述当前事实

Cloud SHALL 为 Coordinator 提供包含 Agent/Device active 状态、online/offline、last heartbeat、runtime capability tags、是否接受新 offer、active Task count、Provider identity readiness 和当前 Project content readiness 的 Worker Availability Projection。Agent heartbeat SHALL 使用 Identity 从 canonical Host Runtime readiness 观察到的完整 capability tags；Worker availability 发布 SHALL 绑定该精确 Agent revision、connection status、last heartbeat 和 capability-tag set，Cloud SHALL 拒绝调用方声明与当前 heartbeat 不一致的事实。全局 availability SHALL 保持 Project-independent；Project-scoped view SHALL 嵌套组合独立的 Membership、Task Authority、当前 Provider principal fact 和 Project content readiness，并显式标记 Provider principal snapshot 为 match、missing 或 stale，而不得复制一套 Project 授权字段到全局 availability。该 projection SHALL 带 observation time/revision 且仅作选择辅助；它 SHALL NOT 自动接受 Task、保证未来可用或替代 Worker 本地检查。

#### Scenario: Projection 显示 Worker 可用但本机状态已变化

- **WHEN** offer 到达时 Worker 的 Runtime、Provider 或本地接单门禁已不可用
- **THEN** 该 Device SHALL 保持未领取或在本地忽略，并记录有界原因
- **AND** Cloud SHALL NOT 因旧 projection 强制其执行。

#### Scenario: Coordinator 查看 Cloud 全局在线候选

- **WHEN** Desktop main 读取包含多个 User 和多个 Agent/Device 的 Cloud-global availability page
- **THEN** Cloud SHALL 向 main 返回资格判定所需的安全 Agent/Device 事实，但不得返回凭据或 Runtime 配置
- **AND** main SHALL 向创建 HCI 只投影至少有一个 `online` Agent 的唯一 User ID 与显示名
- **AND** HCI SHALL 不显示 Agent 数、Agent ID、Device ID 或 availability revision，使同一 User 的多个 Device 不会虚增或泄漏选择维度
- **AND** 所有候选与计数 SHALL 直接派生自本次 Cloud projection，不得使用 Project Member 列表、本地窗口、轮询旁路或猜测的 heartbeat 统计。

### Requirement: 接单策略是每 Agent Device 的本地持久策略

每个 Agent Device SHALL 本地持久化 `manual` 或 `automatic` Task acceptance policy。Cloud Task 合同 SHALL NOT 包含 `acceptancePolicy`，策略 SHALL NOT 跨 Device 同步。自动与手动接单 SHALL 在 claim 前共享本机 Runtime、精确 Task 与 Provider/content preflight；Cloud SHALL 在唯一原子 claim 路径权威检查 Device/Agent、Project Membership、Task Authority、capability、并发与当前 revision。手动模式 SHALL 要求 Human 选择 claim 或 local dismiss。local dismiss 只影响当前 Device，不得产生 Cloud User-level reject。

#### Scenario: 同一 User 的两个 Agent 使用不同策略

- **WHEN** Agent A 配置为 manual 且 Agent B 配置为 automatic
- **THEN** 两个本地策略 SHALL 独立持久化和生效
- **AND** Cloud SHALL 只记录首个成功 claim 及其确定的 Agent/Device Execution，不记录策略来源或其他 Device 的本地忽略。

### Requirement: User Offer 领取时才产生 fenced execution

Task SHALL 以指向 `workerUserId` 的 pending Offer 开始，此时 SHALL NOT 存在预选的 Agent/Device 或 `executionId`。该 User 的合格 Agent/Device 可使用 compare-and-set 领取；首个成功 claim SHALL 在同一事务中创建唯一 `executionId`、绑定认证的 Worker User/Device/Agent 并关闭其他 Device 的 Offer 视图。Offer 可超时、被 Coordinator 撤回或改派到另一 Worker User；Cloud SHALL NOT 提供 User-level reject 命令。Cloud SHALL 将旧 execution fence 为不可写，并通过 expected revision、idempotency key 和 assignee identity 拒绝其 ACK、progress、HumanNeeded、result、record 或文件引用。

#### Scenario: Coordinator 撤回后改派

- **WHEN** pending User Offer 未被领取，Coordinator 撤回并选择替代 Worker User
- **THEN** Cloud SHALL 关闭旧 Offer，且不得为它伪造 execution
- **AND** Cloud SHALL 创建指向替代 User 的新 Offer，并仅在后者被合格 Device 领取时创建 execution。

#### Scenario: 同一 User 的两台 Device 竞态领取

- **WHEN** 两台合格 Device 同时对同一 Offer 提交 claim
- **THEN** Cloud SHALL 仅允许一个 compare-and-set 成功，并只创建一个 Execution
- **AND** 败者 SHALL 收到已被其他 Device 领取的确定事实，不得执行 Task。

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

#### Scenario: Owner 确认 Plan 后派发初始 Task

- **WHEN** Owner 确认 Plan 且 Project 激活
- **THEN** Coordinator main SHALL 为每个无依赖的初始 Plan item 创建一个指向所选 Worker User 的 Task Offer
- **AND** Cloud SHALL 在创建 Offer 时确认该 User 至少有一个当前合格运行时，并将 Task 的 required capability tags 作为权威事实保存
- **AND** 每台 Device SHALL 在 claim 事务中重验当前 User/Device/Agent authority、online/ready、接单状态、Task capability 与 content readiness；任一事实过期或不合格 SHALL fail closed。

### Requirement: HumanNeeded 使用统一 scope 合同且权威回答者是 Project Owner

`HumanNeeded` SHALL 使用一套带显式 scope discriminator 的严格合同。`worker_execution` SHALL 绑定一个当前、未 fenced 的 Task/execution 及其 expected revisions；`coordinator_project` SHALL 只绑定 Project、当前 Coordinator Agent 和 expected Coordinator authority epoch，不得伪造 Task/execution。两种 scope 都 SHALL 定向当前 Project Owner。Cloud SHALL 持久化 question、scope、targetUserId、expiry 和 answer receipt；HumanAnswer SHALL 由当前 Project Owner 的 OIDC 操作提交，或由 Cloud 将 verified Human Endpoint 精确解析到同一个已存在 OIDC Owner 且核验当前 Project endpoint 后提交。Pairing SHALL 只绑定 endpoint，不得创建 User；未经验证的 IM 文本 SHALL NOT 直接生成 HumanAnswer。

Cloud SHALL 把持久化后的 HumanAnswer 投递到当前 Coordinator Agent Inbox；`worker_execution` 还 SHALL 通知对应的当前 Worker execution。只有当前 Coordinator Agent 可把精确 HumanAnswer 写成正式 `decision`，并在后续写 `summary` 和完成 Project；Owner HCI、Human Endpoint 与 Worker 均不得成为第二条 ProjectRecord 写路径。

#### Scenario: Coordinator 在复审结果后请求 Project 决策

- **WHEN** 当前 Coordinator Agent 使用 `coordinator_project` 在已接受结果后向 Owner 提交 HumanNeeded
- **THEN** Cloud SHALL 校验 Project revision 和 Coordinator authority epoch，并持久化一个不含 Task/execution 的请求
- **AND** Owner 的精确 HumanAnswer SHALL 进入当前 Coordinator Agent Inbox，且只有该 Coordinator 可据此写 decision。

#### Scenario: Worker execution 请求 Human 判断

- **WHEN** 当前 Worker Agent 使用 `worker_execution` 为一个 running execution 提交 HumanNeeded
- **THEN** Cloud SHALL 校验 Task/execution revisions、assignee 和 fence，并把 execution 置为 needs_human
- **AND** Owner 回答后 Cloud SHALL 恢复同一 execution，并同时通知该 Worker 与当前 Coordinator。

#### Scenario: 非 Owner 尝试回答

- **WHEN** 其他 Member 或 Agent 对一个 pending HumanNeeded 提交答案
- **THEN** Cloud SHALL 拒绝该请求而不改变 question 状态
- **AND** Owner HCI SHALL 保持该问题可见且不默认折叠隐藏。

#### Scenario: 未绑定 IM 文本尝试回答

- **WHEN** Provider 收到包含 HumanAnswer 形态文本、但发送者不能解析为当前 Owner 的 active verified Human Endpoint，或消息不属于精确 Project endpoint
- **THEN** Cloud SHALL 不创建 HumanAnswer，也 SHALL 不改变 HumanNeeded 状态
- **AND** Provider event MAY 作为普通消息处理或被拒绝，但不得绕过统一 HumanAnswer 服务。

### Requirement: Coordinator 复审显式接受或要求修订

Coordinator SHALL 在 HCI 中审阅 Worker result 与关联文件，并对每个提交执行 `accept` 或 `request_revision`；结果卡打开关联文件时，Project Coordinator main SHALL 从 fresh Cloud snapshot 重新验证当前 Owner、current Task/execution/submission、active binding revision、root/locator digest，再由 Host 在当前 Principal/Workspace 下 materialize process-local opaque resource。公开 capability output 与 domain-neutral resource navigation SHALL 只携带非授权 `resourceRef`；Content Space 使用前 SHALL 通过 Host rebind 重验 current caller/audience/Workspace/Principal lease/semantic revision。Renderer SHALL NOT 接收 materialized handle、解码 portable locator、直接调用 Provider 或把 locator/binding/execution context 当作调用方声明的权限；Content Space 的真实 download 仍 SHALL 是最终 Provider ACL 门禁。修订 SHALL 创建新的有界 execution/revision，旧提交保持 provenance 但不再可覆盖当前结果。新 Project 创建成功后 HCI SHALL 自动聚焦该 Project，pending plan 与审批卡 SHALL 默认可见。

每个 `accept` SHALL 由当前 Coordinator Agent 原子写入一个引用精确 TaskResult submission 的正式 `observation`。HumanAnswer 本身 SHALL NOT 写 ProjectRecord；当前 Coordinator Agent SHALL 使用精确 HumanAnswer 写 `decision`。最终 `summary` 和 Project completion 同样 SHALL 只由当前 Coordinator Agent 写入，并且三类 ProjectRecord 之外不得存在 candidate/proposed/accept 的并行记录路径。

#### Scenario: Coordinator 要求一次修订

- **WHEN** Coordinator 对 Worker 结果选择 request revision 并给出要求
- **THEN** Cloud SHALL 记录审阅决定和新 revision/execution
- **AND** Worker SHALL 只在接受新的 offer 后继续修改。

#### Scenario: Coordinator 从结果卡下载审核产物

- **WHEN** 当前 Owner 在 pending result 卡中选择一个精确 output
- **THEN** Project Coordinator SHALL 只提交 Project/Task/execution/submission/output 的不可变选择事实，并从 fresh Cloud facts 派生 portable locator 与 binding authority
- **AND** Host SHALL 向 Content Space 导航传递 non-authorizing materialized `resourceRef`，并仅在 Content Space 使用前完成 current-scope rebind；任何 stale submission、binding/root drift、wrong caller/Workspace/Principal、session/materialization authorization 失败 SHALL fail closed，且不得返回或继续使用 executable resource；后续真实 download ACL 失败 SHALL 不写出文件或产生成功审核结果。

### Requirement: Coordinator 转交由 Owner 显式执行并立即 fencing

Project Owner SHALL 能把 Coordinator 转交给自己拥有的另一个合格精确 Agent。Cloud SHALL 在同一权威提交中验证新 Agent 的 `ownerUserId`、更新 Coordinator revision、立即 fence 旧 Coordinator 的 coordinator-only 写权限并通知相关 Device；系统 SHALL NOT 转交给其他 User 的 Agent、自动选主或因心跳离线转交。

#### Scenario: 旧 Coordinator 在转交后提交计划

- **WHEN** 旧 Coordinator 使用转交前 revision 更新 plan 或创建 Task
- **THEN** Cloud SHALL 返回 fenced/conflict
- **AND** 只有新 Coordinator Agent 可执行后续 Coordinator 写入。
