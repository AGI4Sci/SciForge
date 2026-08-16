# 个人 Session 远端投影需求

## ADDED Requirements

### Requirement: 一个个人 topic 固定投影一个本地 Session

每个 active `RemoteSessionProjection` SHALL 引用唯一 owner user、Agent、runtime 和 thread。普通远端消息、桌面焦点变化、Project 切换或 topic 重命名 SHALL NOT 静默改变这些引用。

#### Scenario: Owner 从手机发送消息

- **WHEN** owner 在投影 topic 中发送文本消息
- **THEN** 消息 SHALL 进入 projection 指定 Agent 的指定 thread 一次
- **AND** SHALL NOT 进入其他 Agent 或新建隐藏 thread。

#### Scenario: 用户切换桌面 Session

- **WHEN** 桌面焦点切换到其他 Project 或 Session
- **THEN** 已有 projection SHALL 保持原 agent/runtime/thread 引用。

### Requirement: Project 是 Session 属性而不是配对前提

Projection SHALL 从本地 thread 派生 workspace/Project。用户验证手机端点和注册 Agent SHALL NOT 要求预先选择 Project 或文件路径。

#### Scenario: 首次完成 Participant 绑定

- **WHEN** 用户尚未打开任何 Project
- **THEN** 手机与 Agent 绑定 SHALL 成功
- **AND** 系统 SHALL NOT 创建默认工作区或合成 Session。

#### Scenario: 一个 Project 有两个 Session

- **WHEN** 两个本地 thread 使用相同 workspaceRoot
- **THEN** 它们 MAY 各自拥有独立 projection 和 topic
- **AND** 两个 projection 的队列和身份 SHALL 相互独立。

### Requirement: Projection 身份独立于显示名称

系统 MUST 为 projection 分配稳定不透明 ID，并把 provider container/topic 仅保存为 locator 和显示元数据。中文标题、重命名和移动 SHALL NOT 改变 projection 身份。

#### Scenario: 两个纯中文 topic

- **WHEN** 用户创建两个不同的纯中文 Session topic
- **THEN** 两者 SHALL 获得不同 projection ID
- **AND** 名称规范化 SHALL NOT 导致碰撞。

### Requirement: 桌面与手机共享一个逻辑 transcript

Active projection SHALL 同步本地和远端 user message 及最终 assistant reply，使两端表示同一条逻辑消息流；本地 AgentRuntime thread SHALL 是上下文和 turn 的事实源。

#### Scenario: 消息从桌面开始

- **WHEN** 用户在已投影 thread 中提交消息
- **THEN** 本地 thread SHALL 先接受 user message
- **AND** 同一逻辑 user message SHALL 镜像到手机 topic
- **AND** 最终 assistant reply SHALL 在两端可见。

#### Scenario: 消息从手机开始

- **WHEN** owner 在个人 topic 中提交消息
- **THEN** 远端 sender user/endpoint metadata SHALL 与本地 user event 一起保存
- **AND** Agent SHALL 在同一 thread 中执行
- **AND** 最终回复 SHALL 镜像到手机。

### Requirement: 同步幂等且按 projection 排序

系统 SHALL 维护 durable receipt 和每 projection 顺序队列，防止 provider 重投、Bot 自回声、网络重试和应用重启产生重复 turn。一个 projection SHALL NOT 并发运行两个 turn，不同 projection MAY 并行。

#### Scenario: Provider 重复投递事件

- **WHEN** 相同 provider message ID 被接收多次
- **THEN** 最多创建一个本地 user event 和一个 Agent turn
- **AND** 后续投递 SHALL 返回已有 receipt 状态。

#### Scenario: 第二条消息在执行中到达

- **WHEN** 同一 projection 的第一条消息仍在运行
- **THEN** 第二条消息 SHALL 可见地排队
- **AND** 只在第一条达到终态后开始。

### Requirement: Shared Session 必须显式标示执行所有者

个人 Session 默认只允许 owner 发送可执行消息。若 owner 显式共享，系统 SHALL 维护用户 allowlist，并在手机和桌面明确显示所有消息都由 projection 指定 Agent 执行；其他发送者身份 SHALL NOT 导致隐式 Session 分叉。

#### Scenario: 被邀请用户在 shared Session 发言

- **WHEN** allowlist 中的用户发送消息
- **THEN** 消息 SHALL 记录其 `senderUserId`
- **AND** SHALL 由 projection 已指定的 Agent 执行
- **AND** UI SHALL 显示 Agent owner。

### Requirement: 首期同步是 append-only 文本

首期 SHALL 同步文本 user message、最终 assistant reply 和明确系统状态，SHALL NOT 用远端编辑、删除、reaction 或流式 delta 修改本地 Agent 历史。

#### Scenario: 远端消息被编辑

- **WHEN** 已接受的消息在 Zulip 中被编辑
- **THEN** 原本地消息和 turn SHALL 保持不变
- **AND** 用户 SHALL 通过新消息更正或由系统记录审计事件。
