## Purpose

定义 Cloud Collaboration 与 Owner Desktop 上 Content Space 并列协作的 Project 内容目录 provisioning saga，使 Project 成员事实、Provider ACL 事实和 Task authority 始终独立且可恢复。

## ADDED Requirements

### Requirement: 每个成员显式发布 Provider Directory Principal Reference

需要参与文件 Task 的每个 Project Member User SHALL 在自己的 Desktop 上绑定 OpenContent，并发布由当前 Device/Principal 证明的非秘密 `ProviderDirectoryPrincipalReference`。该引用 SHALL 固定 Provider Instance、closed `user` kind 和 opaque Provider principal ID；Cloud、Coordinator 和 Content Space SHALL NOT 通过邮箱、用户名、显示名、OIDC subject、Cloud userId 或 Agent owner 推断 Provider identity。

#### Scenario: Worker 未发布 Provider identity

- **WHEN** Coordinator 将该 User 加入 Project 或选择其 Agent 执行文件 Task
- **THEN** Cloud SHALL 将其 content readiness 标记为 missing/pending
- **AND** SHALL NOT 允许其 Agent 接受文件 Task，直到精确引用被验证和 provisioned。

### Requirement: Cloud 创建 Project 和持久 provisioning intent

创建需要文件协作的 Project 时，Cloud SHALL 原子保存 Project、显式 Membership、唯一 Coordinator、目标 content owner、精确 Provider member references、provisioning revision 和 durable intent，并将 Project 置为 `provisioning/paused`。在 Device-signed provisioning attestation 被验证和绑定前，Cloud SHALL NOT 将 Project 标记为 active 或派发文件 Task。

#### Scenario: Project 创建成功但外部 Provider 尚未写入

- **WHEN** Cloud 已提交 Project 事实而 Owner Desktop 尚未执行 provisioning
- **THEN** Project SHALL 可由 Owner 恢复并重试同一 intent/revision
- **AND** Cloud SHALL NOT 声称共享目录或 Provider 成员已存在。

### Requirement: Owner Desktop 编排唯一 Content Space 外部写路径

Owner Desktop 上的 Project coordinator integration SHALL 读取 Cloud intent，并仅通过标准 Content Space capability、Broker、service、pinned Provider 和 Connector 路径完成：创建恰好一个 shared Content Container、解析其可移植 root、对精确 Provider user reference 执行成员变更、重新读取完整成员列表并收集逐步 receipt。编排层 SHALL NOT 向 Content Space 注入 Project DTO、credential、Provider endpoint 或另一个 User 的 Connection。

#### Scenario: provisioning 首次成功

- **WHEN** Owner Human 对当前 revision 进行一次确认且所有 Provider 操作返回精确写后 observation
- **THEN** Owner Desktop SHALL 生成可重放审计但不可重放授权的 provisioning report
- **AND** Provider Team/目录 SHALL 保持外部 Provider 所有和控制。

### Requirement: Provisioning attestation 由当前 Device 签署事实而非权限

Owner Desktop SHALL 把当前 OIDC User、ACTIVE Device、公钥/签名、当前 Provider binding attestation、精确 Project/content root、creation/member observation receipts、provisioning revision、时间与结构化 digest 组成 `ProjectContentProvisioningAttestation`。E/Content Space SHALL 提供 Provider 事实，Identity/Host SHALL 使用已注册 Device key 签署，Cloud SHALL 验证签名、Device ownership/status、Project Owner、revision、digest 与 intent 一致后才建立 Project Content Space Binding。Attestation SHALL NOT 包含 Token、credential、Provider Connection 或持久授权 scope，也 SHALL NOT 被解释为 Provider ACL。

#### Scenario: 合法签名但 provisioning revision 已过期

- **WHEN** Cloud 收到一个 Device 签名有效但成员 intent 已升级的 attestation
- **THEN** Cloud SHALL 拒绝绑定为 stale revision
- **AND** Owner Desktop SHALL 重新读取最新 intent 和 Provider 事实后再 reconcile。

### Requirement: Binding 激活 Project 但不授予 Provider permission

有效 binding SHALL 只证明 Cloud Project 与一个可移植 Project Content Directory 的权威关联及最近 provisioning 观察。Cloud Project Membership、Provider Membership 和 Task authority SHALL 作为三套独立状态保存和展示；数据库写入成功 SHALL NOT 被描述为 Provider ACL 已改变，Provider ACL SHALL 只由真实 Provider 操作与观察证明。

#### Scenario: Cloud Member 存在但 Provider member 缺失

- **WHEN** Provider observation 不包含该 User 的精确 principal reference
- **THEN** 该 User 的 Project Membership MAY 仍为 active
- **AND** 其 content readiness SHALL degraded/pending 且其 Agent SHALL 不可接受文件 Task。

### Requirement: Provisioning 失败可重试且不回滚删除 Provider 内容

任何 Provider unavailable、typed conflict、partial observation 或 `outcome_unknown` SHALL 留下 durable saga journal 和可恢复状态。系统 SHALL 根据精确 receipt 继续、reconcile 或要求 Human 处理；不得盲重试 uncertain write，也不得通过删除 Provider Team/目录或内容回滚。Project archive/delete SHALL 只关闭 Cloud binding，并 SHALL NOT 删除 Provider Team、目录或文件。

#### Scenario: 创建目录后网络中断

- **WHEN** Cloud 未收到最终 attestation 且 createSpace 结果不确定
- **THEN** saga SHALL 进入 manual recovery/reconcile
- **AND** SHALL 先精确观察 Provider 事实而不得再创建同名或第二个目录。

### Requirement: 动态增加 Worker 先完成成员 provisioning

Coordinator 选择一个尚非 Project Member 的 Worker Agent 时，Cloud SHALL 先加入其 Owner User、要求其 Provider principal readiness、递增 provisioning revision 并生成精确 add-member intent。新 Member SHALL 保持 `pending_membership`，其 Agent SHALL 不可接受文件 Task，直到 Owner Desktop 对 Provider 成员写入、写后核验和新 attestation 全部成功。Task 完成、Worker 从候选集合移除或 Agent 离线 SHALL NOT 自动移除 Project/Provider Member。

#### Scenario: 动态 Worker 已是 Cloud Member 但 Provider 添加失败

- **WHEN** Provider 暂不可用导致 add-member 未核验
- **THEN** Cloud Membership SHALL 保留 pending content readiness
- **AND** 其他已就绪成员和纯文本 Task SHALL 不受影响。

### Requirement: 成员移除先撤销 Task authority 后完成 Provider 撤权

Owner 发起 Member 移除时，Cloud SHALL 先把 Project Membership 置为 `membership_removal_pending`，立即禁止该 User 所有 Agent 接受新 Project Task，并 fence/cancel 其现有 executions；该安全撤权 SHALL 不等待 Provider。Owner Desktop 随后 SHALL 用当前 Provider Connection 移除精确 Provider member 并重新读取成员列表。只有 Provider removal 被核验后 Cloud 才 SHALL 将 Membership 置为 `removed`；Provider 不可用时 SHALL 保持 pending，且不得恢复 Task authority或声称 Provider 已撤权。

#### Scenario: Provider 在 Cloud 安全撤权后离线

- **WHEN** remove-member 无法执行或无法核验
- **THEN** 被移除 User SHALL 继续无法接单或提交旧 execution
- **AND** saga SHALL 保持 `membership_removal_pending` 供 Owner 后续恢复。

### Requirement: 外部失权按真实 Provider 结果降级

如果成员在 Provider 外被人工移除，已知资源的 metadata MAY 仍可见；下一次真实 `DownloadCheck`、upload 或 Owner 显式 reconcile 返回 unauthorized 时，Worker SHALL 立即停止相关 execution，Cloud SHALL 将该 User 在当前 Project Content Directory 的 membership/readiness 标记为 `degraded` 并暂停其所有文件 Task。单个普通成员失权 SHALL 不关闭整个 binding 或阻止其他有效成员。

#### Scenario: 普通 Worker 被 Provider 外部移除

- **WHEN** 该 Worker 对已知 file ID 仍能读取 metadata 但 `DownloadCheck` 返回 unauthorized
- **THEN** 系统 SHALL 以真实 operation-time unauthorized 为准停止该 User 的文件 execution
- **AND** SHALL NOT 把 metadata 可见性当成权限继续工作。

### Requirement: Content Owner 失权降级整个文件 binding

如果 Project content owner 对 root 失权，Cloud SHALL 将 Project Content Space Binding 标记为 `degraded`，暂停所有新的和正在执行的文件 Task；纯文本协作 MAY 依据 Task 类型继续。恢复 SHALL 要求 Owner 显式 rebind、重新 provisioning 或更换 content owner，而不得选择其他成员的 Connection 作为隐式管理员。

#### Scenario: Owner 无法再观察 root

- **WHEN** Owner reconcile 或真实 root operation 返回 unauthorized
- **THEN** 所有文件 Task SHALL 暂停并显示 binding recovery action
- **AND** Provider Team/内容 SHALL 保持原状，等待 Human 选择恢复路径。
