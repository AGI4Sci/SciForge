# 用户—设备统一身份需求

## ADDED Requirements

### Requirement: Desktop 使用系统浏览器完成 OIDC PKCE 登录

Desktop SHALL 作为无 client secret 的 public client，通过系统浏览器执行 Authorization Code with PKCE S256，并只在受控 loopback callback 接收授权响应。Desktop SHALL NOT 嵌入登录页、收集用户密码、使用 Password Grant、Implicit Flow 或与外部 provider 共用 client。

#### Scenario: 用户完成 Desktop 登录

- **WHEN** 用户在系统浏览器完成授权且 callback state 与 PKCE verifier 均有效
- **THEN** Desktop SHALL 交换并安全保存可轮换的会话凭据
- **AND** Renderer、日志、Trace 和普通配置 SHALL NOT 接收 Access Token、Refresh Token、授权码或用户密码。

### Requirement: Cloud Principal 必须通过严格 Token 与 Device 门禁

Desktop SHALL 在建立 `cloud-authenticated` Principal 前验证固定 issuer、JWKS 签名、RS256、非空 `kid`、目标 audience、authorized party，以及 `sub`、`exp`、`nbf`、`iat`、`auth_time` 的存在、类型和时间关系。验证失败、配置缺失或网络错误 SHALL fail closed，并保持本地功能可用但不得授予 Cloud authority。

#### Scenario: Access Token 不满足冻结合同

- **WHEN** Token 签名无效、issuer/audience/authorized party 不匹配，或必需时间 claim 缺失、类型错误或超出容忍范围
- **THEN** Desktop SHALL 拒绝 Cloud session
- **AND** SHALL NOT 调用受保护的 SciForge Cloud API 或建立 `cloud-authenticated` Principal。

### Requirement: Canonical Cloud User 与 Desktop Device 共同决定远端身份

Desktop SHALL 使用受验证的 Access Token 调用 `/v1/me` 获取 canonical Cloud User，并将当前安装注册为该用户的独立 Device。只有当前用户已登录且当前 Device 为 `ACTIVE` 时，Identity and Access 才 SHALL 发布 `cloud-authenticated` Principal；Device missing、revoked、ownership conflict 或网络失败 SHALL 降级为非 Cloud authority，而不得复用其他用户或安装的 Device。

#### Scenario: 当前 Device 被撤销或无法确认

- **WHEN** Cloud 返回 Device revoked、missing、ownership conflict 或无法确认的网络状态
- **THEN** Desktop SHALL 清除 active Device projection 并停止发布 `cloud-authenticated` Principal
- **AND** 本地 `local-selection` 功能 MAY 继续工作
- **AND** 恢复 Cloud authority SHALL 要求同一当前用户的 Device 再次被确认或注册为 `ACTIVE`。

### Requirement: 用户是唯一的人类协作主体

系统 SHALL 使用稳定 `userId` 表示一个协作个体，并以该身份表达 Project 成员关系、Agent 所有权、真人问题目标和审计主体。手机端点、provider 账号、安装实例、显示名和邮箱 SHALL NOT 各自创建隐式用户。

#### Scenario: 同一用户完成手机和机器绑定

- **WHEN** 用户验证一个 Zulip 身份并注册一台 SciForge
- **THEN** 两个端点 SHALL 引用同一 `userId`
- **AND** 手机端点 SHALL 拥有独立 `humanEndpointId`
- **AND** SciForge SHALL 拥有独立 `agentId`。

#### Scenario: 用户修改显示名

- **WHEN** 用户修改云端或 Zulip 显示名
- **THEN** `userId`、端点绑定和 Agent 所有权 SHALL 保持不变
- **AND** 系统 SHALL NOT 创建第二个用户。

### Requirement: 人类端点必须经过 provider 身份验证

`HumanEndpointBinding` SHALL 使用 `(provider, realmId, providerUserId)` 标识远端身份，并在创建前通过短期 challenge 验证实际控制者。显示名、topic、stream 或未经验证的邮箱 SHALL NOT 作为身份凭据。

#### Scenario: 用户完成 Zulip challenge

- **WHEN** Gateway 收到由目标 Zulip 用户发送的有效未过期 challenge
- **THEN** 系统 SHALL 创建或确认该用户的 endpoint binding
- **AND** SHALL 记录验证时间和 assurance
- **AND** SHALL 立即使 challenge 失效。

#### Scenario: Provider 身份已绑定其他用户

- **WHEN** 同一 provider 身份尝试绑定第二个 active `userId`
- **THEN** 系统 SHALL 拒绝绑定
- **AND** SHALL 要求先由有权用户显式解除或转移。

### Requirement: 每个 Agent 有稳定身份和唯一所有者

每台参与协作的 SciForge SHALL 使用稳定 `agentId` 和 `ownerUserId` 注册。重启 SHALL 恢复同一 Agent；所有权转移 SHALL 使用显式、可审计且会轮换凭据的流程。

#### Scenario: SciForge 重启并重连

- **WHEN** 已注册安装使用有效设备凭据重连
- **THEN** 云端 SHALL 恢复原 `agentId`
- **AND** SHALL NOT 静默创建第二个 Agent。

#### Scenario: 另一个用户声明现有 Agent

- **WHEN** 不同 `userId` 尝试注册相同 installation 或 agent identity
- **THEN** 系统 SHALL 返回所有权冲突
- **AND** 原 owner 和 Agent 状态 SHALL 保持不变。

### Requirement: Participant 明确组合手机端点与所有 Device Agent

PoC SHALL 为每个 active 用户维护一个 `ParticipantProfile`，组合其已验证 human endpoint 与所有归属该 User 的 Device Agent。Identity SHALL 在每个已认证 ACTIVE Device 的 Runtime ready 后自动 ensure 并复用该 Device 的 canonical Agent；系统 SHALL NOT 要求或保存用户选择的 primary Agent，也不得借用其他 User 的端点或 Agent。

#### Scenario: 当前 Device 自动确保 Agent

- **WHEN** 用户在一个新的 ACTIVE Device 上完成登录且 Runtime ready
- **THEN** Identity SHALL 为该 Device 自动 ensure 或复用唯一 active Agent，并原子更新 Participant revision
- **AND** renderer SHALL NOT 提供 Agent 注册或 primary 选择控件。

#### Scenario: 固定 Session 的 Agent 离线

- **WHEN** 手机请求绑定的个人 Session Agent 离线
- **THEN** 系统 SHALL 保留 bounded pending 或明确返回离线状态
- **AND** SHALL NOT 路由到同一 User 最近在线的另一 Device 或另一 User 的 Agent。

### Requirement: 身份和授权保证级别分离

系统 SHALL 在每个操作中同时验证 `userId`、actor endpoint、assurance、资源角色和 capability policy。手机与机器属于同一用户 SHALL NOT 自动赋予手机本地高风险工具批准权。

#### Scenario: 手机请求触发高风险外部写入

- **WHEN** 个人 Session 或 Project Task 触发本地策略要求桌面批准的能力
- **THEN** canonical capability broker SHALL 保持操作 pending
- **AND** 手机 SHALL 只收到需要桌面批准的状态
- **AND** 系统 SHALL NOT 合成或推断批准。

### Requirement: 凭据只保存在合适的 secret store

Provider service credential、Agent device token、一次性 challenge 和本地工具凭据 MUST NOT 出现在普通设置、日志、诊断、二维码长期 payload、导出文档或 Git 文件中。

#### Scenario: Renderer 查询 Participant 状态

- **WHEN** UI 请求用户、端点和 Agent 状态
- **THEN** 返回值 SHALL 只包含非敏感 ID、显示信息、状态、assurance 和时间
- **AND** SHALL NOT 包含 credential 或可逆凭据片段。
