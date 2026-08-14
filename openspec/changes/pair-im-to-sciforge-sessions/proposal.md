## Why

SciForge 当前的“连接手机”把 Zulip、Discord 等 IM 目标绑定到一个手工选择的远端频道、topic 和工作区目录。这能完成远程指令，但没有表达用户真正需要的产品语义：手机配对的是一台 SciForge 客户端，手机与桌面只是同一客户端的两个入口；Project 和 Session 应在配对完成后作为这台客户端的内容被投影，而不是成为设备配对的前提。

现有模型还把可变的 Zulip topic 名用于生成绑定 ID，让纯中文 topic 存在碰撞风险；同一 topic 可以被 `/new` 或 `/use project` 静默改指向另一个本地 thread，导致远端消息历史与本地 Session 上下文不再一一对应；桌面消息镜像、远端入站执行、频道凭据和 UI 配置则分散在 Host 私有代码中，缺少一个可独立拥有、测试和演进的领域边界。

本变更把 IM 定义为 SciForge 客户端的远程 Session 投影：先配对客户端，再把一个本地 Session 明确链接到一个远端 topic，并让两端共享同一条逻辑消息流。

## What Changes

- 将 IM 配对主体从“provider channel + workspace”改为稳定的 SciForge 安装实例；一次配对不要求选择 Project 路径。
- 定义 Session Projection：一个远端 topic 只投影一个本地 AgentRuntime thread；Project 是该 thread 的工作区属性，同一 Project 可以拥有多个 topic/Session。
- 使用稳定随机 projection ID 和 provider locator 保存映射，不再由可变 topic 名生成内部 ID。
- 建立统一的双向消息 receipt：桌面或 IM 任一端提交的消息只进入本地 thread 一次，并将 user/assistant 最终消息幂等镜像到另一端。
- 保留远端发送者、来源、远端消息 ID、本地 item/turn ID、投递状态和失败信息，以支持去重、顺序队列、诊断和重试。
- 将 Project/Session 发现、链接、新建、重命名、解除和状态查询作为客户端级命令；`/new` 创建新的本地 Session 和新的 topic/projection，不再静默替换当前 topic 的 Session。
- 同一 topic 的多名 Zulip 成员共享同一个 Session；发送者身份进入消息来源元数据，但不创建隐式的个人 Session。
- 远端消息继续服从本地 capability broker、审批、模型和运行模式；配对不授予额外文件或工具权限。
- 新建独立领域包拥有配对、provider adapter、Session 投影、消息同步账本和连接管理 UI，并通过 manifest/generated composition 安装。删除 Host 中旧的 Zulip/remote-channel 并行实现和手工 workspace 绑定界面。
- 这是一次明确的产品语义替换：升级后用户重新配对客户端和链接 Session；不保留旧 workspace-channel 绑定兼容路径。

## Capabilities

### New Capabilities

- `remote-client-pairing`: 将一个经过认证的 IM provider 连接配对到一台稳定的 SciForge 安装实例，并管理所有权、凭据引用、租约和撤销。
- `remote-session-projection`: 将本地 AgentRuntime thread 及其 Project 工作区投影为远端 topic，并维护稳定身份和生命周期。
- `bidirectional-session-sync`: 在本地 thread 与远端 topic 之间幂等、顺序地同步用户消息、最终 Agent 回复和投递状态。

### Modified Capabilities

- `human-im`: 手机 IM 从仅承载人类注意力事项扩展为已配对 SciForge 客户端的远程 Session 界面；跨节点 Project/Task 协作仍属于原有多用户协作变更，不由本变更实现。

## Impact

- 新领域包：`@sciforge/domain-remote-client`，具有独立 `main`、`renderer` 和公共合同入口及 `sciforge.domain.json`。
- 扩展 domain SDK 的通用 AgentRuntime thread/message 观察、provider secret、设置页面和通知贡献点；Host 不感知 Zulip、topic 或其他 provider 专有字段。
- 迁移并删除 `src/main/remote-channel-runtime.ts`、`src/main/zulip-bot-runtime.ts`、Connect Phone 中 provider 专有实现及其重复 IPC。
- App settings 只保存非敏感 pairing/projection 状态；Bot API key 等凭据保存在本机 secret store，不进入 Git、二维码、日志或同步消息。
- 首期保证文本消息和最终回复同步；流式 token、消息编辑/删除、reaction、文件上传和远端审批不在本变更范围内。
- 与云端协作内核的边界保持不变：本变更连接一个人的手机与一台 SciForge；跨用户、跨客户端任务账本和 Coordinator/Worker 协作由独立能力负责。
