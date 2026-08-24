## Purpose

定义一个 SciForge User 从真实 OIDC 登录，经 ACTIVE Desktop Device 和已配置 Agent Runtime 建立可撤销 Agent 的唯一安全路径，并保证协作模块只消费无 Token 的认证传输。

## ADDED Requirements

### Requirement: OIDC 是 Connected Mode User 的唯一创建路径

SciForge Cloud SHALL 只通过固定 Keycloak issuer 的有效 OIDC Principal 执行 JIT User 创建或查找。Pairing、Device 注册、Agent 注册、Provider enrollment、邮箱、用户名和显示名 SHALL NOT 创建、合并或替换 SciForge User。

#### Scenario: 未登录 Desktop 尝试 pairing

- **WHEN** 未持有有效 OIDC session 的 Desktop 提交 pairing 或 endpoint challenge
- **THEN** Cloud SHALL NOT 创建 User、Device 或 Agent
- **AND** pairing MAY 仅在已有 OIDC User 的认证上下文中绑定通信端点。

### Requirement: OIDC 秘密只存在于 Identity 私有边界

Identity and Access SHALL 通过系统浏览器 Authorization Code with PKCE 登录，并在原生安全存储中保管授权码交换结果和 refresh material。Renderer、domain-collaboration、domain-project-coordinator、Content Space、IPC payload、日志、Git、诊断和验收回执 SHALL NOT 接收 Access Token、Refresh Token、授权码、PKCE verifier 或用户密码。

#### Scenario: 协作包调用 Cloud

- **WHEN** collaboration 或 coordinator 包需要执行一个用户认证的 Cloud 请求
- **THEN** 它 SHALL 只调用 Identity 提供的 token-free authenticated transport
- **AND** 请求调用方 SHALL NOT 读取、复制或持久化 OIDC Token。

### Requirement: Device、Runtime 和 Agent 按严格顺序建立

Desktop SHALL 在 OIDC User 已确认后注册或恢复该安装的 Device；只有当前 Device 为 `ACTIVE` 且至少一个受支持 Agent Runtime 已完成配置时，用户才可在该 Device 上创建 Agent。Run-0 中每个 Desktop Device SHALL 最多有一个 active Agent；同一 User MAY 在多个 Device 上各拥有一个不同 Agent。

#### Scenario: Runtime 尚未配置

- **WHEN** 当前 OIDC User 和 ACTIVE Device 已存在但没有可用 Runtime 配置
- **THEN** Desktop SHALL 显示 Runtime 配置门禁
- **AND** SHALL NOT 创建默认 Agent 或宣告可接收 Task。

#### Scenario: 同一 User 登录第二台 Desktop

- **WHEN** 同一 OIDC User 在另一独立安装上完成 Device 注册和 Runtime 配置
- **THEN** Cloud SHALL 保留两个不同 Device 和两个不同 Agent identity
- **AND** Project SHALL 能按精确 `agentId` 区分它们。

### Requirement: Agent 角色来自 Project 和 Task 关系

Agent SHALL 是一个 User 所有且绑定一个 Agent Host Device 的执行 identity。Coordinator 或 Worker SHALL NOT 是账号、全局 Agent 类型或登录角色；一个 Agent MAY 在一个 Project 中担任 Coordinator，并同时在另一 Project 或 Task 中作为 Worker。

#### Scenario: 同一 Agent 承担不同协作职责

- **WHEN** 一个 Agent 是 Project A 的 `coordinatorAgentId` 且是 Project B Task 的 `assigneeAgentId`
- **THEN** Cloud SHALL 根据各自 Project/Task 关系分别授权
- **AND** SHALL NOT 要求第二个账号、Device 或 Runtime。

### Requirement: Device 撤销即时终止远端 Agent authority

Cloud 和 Desktop SHALL 在每次认证恢复、Token refresh 后和关键远端操作前重新确认当前 Device 状态。Device 被撤销、ownership 冲突或状态不可确认时，Desktop SHALL 停止发布 `cloud-authenticated` Principal、断开 Agent 协作连接并禁止新 Task 与 Project 文件操作；Cloud SHALL 拒绝该 Device/Agent 后续请求并 fence 其 live executions。

#### Scenario: Worker Device 在执行中被撤销

- **WHEN** Project 文件 Task 的 Worker Device 被撤销
- **THEN** Agent SHALL 停止 execution 和 Content Space 调用
- **AND** Cloud SHALL 拒绝该 execution 的后续 ACK、progress、result 和文件引用。

### Requirement: 设备与服务器秘密不得越过所有权边界

Device 私钥、Agent machine credential 和 OIDC material SHALL 只由 Identity 私有运行边界持有并持久化到其原生安全存储；Provider credential SHALL 只由对应 Connector 私有运行边界持有并持久化到其原生安全存储；服务器 secret SHALL 只由 owning server/provider runtime 直接读取专用 secret file。跨包合同、IPC、日志、Trace、数据库业务字段、Git 和验收回执 SHALL 只携带公钥、非授权 opaque ID、签名、哈希或脱敏状态，不得携带秘密。`domain-collaboration` SHALL NOT 解封、读取、写入或接收可重放 Agent machine credential，只能调用 Identity-owned token-free Agent transport。

#### Scenario: 生成验收回执

- **WHEN** Run-0 汇总身份、Device 和 Agent 证据
- **THEN** 回执 MAY 记录脱敏 ID、公钥指纹和验证状态
- **AND** SHALL NOT 记录私钥、Token、密码、Provider credential 或可重放 machine credential。

#### Scenario: Agent 注册与 WSS 恢复

- **WHEN** Desktop 注册/旋转 Agent 或在重启后恢复 Agent-authenticated command、Inbox 或 WSS
- **THEN** Identity SHALL 在私有边界完成 ephemeral bootstrap、credential 解封、ACTIVE Device/Agent 绑定复核和 authorization 注入
- **AND** collaboration SHALL 只收到严格的 Agent facts、事件、响应与非秘密状态，不得收到 credential、Authorization header 或可用于恢复 credential 的 bearer locator。
