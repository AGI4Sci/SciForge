# 用户—设备统一身份需求

## ADDED Requirements

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

### Requirement: Participant 明确组合手机与 primary Agent

PoC SHALL 为每个 active 用户维护一个 `ParticipantProfile`，其中包含一个 primary human endpoint 和一个 primary Agent。缺少任一端点时 SHALL 显示 incomplete，系统 SHALL NOT 猜测或借用其他用户端点。

#### Scenario: 用户选择 primary Agent

- **WHEN** 用户从自己拥有的 Agent 中选择 primary Agent
- **THEN** 系统 SHALL 原子更新 Participant revision
- **AND** 后续未指定 Agent 的个人创建请求 SHALL 使用新的 primary Agent。

#### Scenario: Primary Agent 离线

- **WHEN** 手机请求需要执行但 primary Agent 离线
- **THEN** 系统 SHALL 保留 bounded pending 或明确返回离线状态
- **AND** SHALL NOT 路由到最近在线或另一用户的 Agent。

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
