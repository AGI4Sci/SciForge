## Purpose

定义隔离 Run-0 中以真实 OIDC、Device/Agent、AgentRuntime、OpenContent 和多台 packaged Desktop 证明“像开会一样”的端到端多用户协作闭环及其可审计完成门禁。

## ADDED Requirements

### Requirement: Run-0 部署与既有公网部署完全隔离

Run-0 SHALL 复用同一服务器基础设施，但使用 `cloud-run0.sciforge.cn`、`login-run0.sciforge.cn`、Keycloak realm `SciForge-Run0`、独立 PostgreSQL database/role、Compose project、containers、credentials、backup directory 和 schema migration history。现有 A 公网部署 SHALL 保持不变；Run-0 SHALL NOT 读取、修改、迁移、借用或回退到旧 issuer、realm、database、credential 或 container。

#### Scenario: Run-0 DNS 尚未就绪

- **WHEN** 两个冻结 hostname 不能以正确 TLS/issuer 解析到隔离服务
- **THEN** live 验收状态 SHALL 为 `awaiting_dns`
- **AND** 系统 SHALL NOT 借用现有公网 issuer 或降低 OIDC 验证。

### Requirement: PoC 身份真实但不混入全部生产化门禁

Run-0 SHALL 使用真实 Keycloak OIDC/PKCE、JIT User、真实 Device/Agent 和 Provider account。Realm MAY 开启自助注册且无需邮件验证；本次验收 SHALL NOT 把邮件验证、MFA、签名公证、生产公网切换或完整灾备作为完成条件，也不得把其缺失误报为已生产化。

#### Scenario: 新参与者自助注册

- **WHEN** Human 在 Run-0 issuer 完成注册和 OIDC 登录
- **THEN** Cloud SHALL JIT 创建唯一 SciForge User 并进入 Device/Runtime/Agent 配置流程
- **AND** SHALL NOT 要求 pairing 创建 User。

### Requirement: 真机矩阵使用同一 commit 的五个独立 packaged Desktop

完整 live 验收 SHALL 使用至少三台物理机器或相互独立 VM 上的五个独立 Desktop installations/profiles。所有 Desktop SHALL 来自同一 exact commit 的 packaged artifact，并各自拥有唯一 native secret store、Device、Agent、Runtime configuration 和真实 OpenContent account；不得使用 acceptance harness、共享 profile、直接数据库操作、Mock provider 或 source-only renderer 代替。

#### Scenario: 只有两台真实设备可用

- **WHEN** source 和 packaged 自动测试通过但五个独立 profile/至少三台机器矩阵未满足
- **THEN** 交付状态 SHALL 为 `awaiting_real_devices`
- **AND** SHALL NOT 宣告完整多用户闭环完成。

### Requirement: 固定验收角色不限制产品动态性

Run-0 验收 SHALL 使用 U0 Owner+Coordinator、U1 manual Worker、U2 automatic Worker 且触发 HumanNeeded、U3 reject Worker、U4 replacement Worker 的固定角色脚本。U0-U4 SHALL 是本次证据中的脱敏 fixture label；产品合同和实现 SHALL 支持动态 User、Device、Agent、Membership 和 Worker 选择，不得硬编码这些 label 或数量。

#### Scenario: U3 拒绝并由 U4 接替

- **WHEN** U3 对精确 Task offer 手动拒绝
- **THEN** Coordinator HCI SHALL 从动态 availability 中选择 U4 的精确 Agent 并创建新 execution
- **AND** U3 的旧 execution SHALL 被 fenced。

### Requirement: 会议脚本产生三项真实协作产物

验收 Project SHALL 命名为“多用户协作设计评审会”。U0 Coordinator Agent SHALL 读取真实合成 agenda/requirements 文件，通过真实 AgentRuntime 生成由 Human 确认或编辑的 plan，并并行派发生成 `architecture-review.md`、`meeting-minutes.md`、`risk-register.md` 的三个最终 Task。U1 SHALL 手动接单，U2 SHALL 自动接单并向 U0 发起 HumanNeeded，U3 SHALL 拒绝且 U4 SHALL 接替；所有 Worker SHALL 真实下载输入、调用本机 Runtime/模型、上传结果。

#### Scenario: 三个输出完成初稿

- **WHEN** 当前 execution 的三个 Worker 都提交真实 Provider output references
- **THEN** Coordinator SHALL 在 HCI 中至少接受一个结果并对另一个要求一次修订
- **AND** 只有通过复审的当前 revisions 才 SHALL 进入最终 Project Record。

### Requirement: Project 完成保留 Provider 团队库和内容

所有最终文件 SHALL 通过另一授权路径下载并完成完整性核验，Coordinator SHALL 生成 final summary/Project Record 并显式完成 Project。完成、archive 或 delete Cloud Project SHALL 关闭业务 binding/authority，但 Provider Team、Project Content Directory、成员变更证据与文件 SHALL 保留，不得自动删除。

#### Scenario: Project 标记完成

- **WHEN** 计划、Task、复审、Project Record 和完整性门禁全部满足
- **THEN** Cloud SHALL 将 Project 进入完成态
- **AND** OpenContent 中的团队库和三项最终产物 SHALL 继续存在。

### Requirement: 恢复矩阵必须在真实路径上验证

Run-0 SHALL 至少验证：Worker accept 后重启并恢复同一 execution、WebSocket 断开重连和 Inbox refill、重复 offer/ACK 幂等、改派后旧 execution fenced、Device revoke 停止 Agent/文件操作、Coordinator transfer fencing、Provider membership removal 阻止内容传输，以及一次 `outcome_unknown` 人工恢复。每项 SHALL 使用 canonical production path 并产生脱敏 receipt；未执行项 SHALL 标记 skipped/blocked reason，而不得视为通过。

#### Scenario: WebSocket 断线期间产生 Task 事件

- **WHEN** Worker socket 离线后 Cloud 提交新的 InboxMessage
- **THEN** 重连 SHALL 只作为可用提示，Worker SHALL 按 sequence 补拉并幂等 ACK
- **AND** Task SHALL 不因丢失 socket event 而丢失或重复执行。

### Requirement: 验收回执可复核且不泄密

最终 verification receipt SHALL 记录 exact commit、packaged artifact、server image/schema、脱敏 User/Device/Agent/Project/Task/execution timeline、provisioning/member receipts、runtime/model IDs、source/packaged/isolated-live 结果、`integrityVerified`、失败、跳过项和 Human manual operations。会议输入 SHALL 为合成内容，实体 ID SHALL 脱敏，真实 credential SHALL 只由对应 Human 在自己的 Desktop 输入；回执 SHALL NOT 包含秘密、完整 prompt、真实敏感会议内容或可重放授权。

#### Scenario: 某一 live recovery 未完成

- **WHEN** 回执无法提供该 recovery 的 execution/receipt evidence
- **THEN** 该门禁 SHALL 明确为 not_run、blocked 或 failed
- **AND** 总体状态 SHALL 不得把它计算为通过。
