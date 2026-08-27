# 变更提案：统一用户、手机与 SciForge 的多人协作身份

## 为什么要做

SciForge 需要同时支持两个场景：用户可以在手机上继续操作自己电脑中的 Session；多个用户也可以让各自的 SciForge 围绕同一个 Project 分工协作。此前这两个场景由两套提案分别描述：手机配对以 SciForge 安装实例为主体，多用户协作则以云端 User 和 Agent 节点为主体。两者没有定义同一个稳定的人类身份，也没有规定 Zulip 发送者如何映射到云端 User、如何找到该用户拥有的 SciForge，以及群聊消息究竟应进入谁的 Session。

这种缺口会造成危险的歧义：用户 A 在手机发出的消息可能由用户 B 的机器执行；同一个 Zulip topic 中的六个人可能被当成一个本地 Session 的共同操作者；手机身份也可能被误认为拥有本机工具审批权。仅记录 `senderId` 不能满足多人协作中的身份、路由和授权要求。

本变更把“协作个体”定义为稳定的 `UserPrincipal`。手机是该用户的人类交互端点，SciForge 安装实例是该用户拥有的 Agent 节点。两者不是两个用户，也不互相冒充，而是用不同凭据、不同信任级别代表同一个 `userId`。Project 以用户为成员；Coordinator 是 Project 级的精确 Agent，Worker 派发则指向 User，并在该 User 的设备领取后才确定执行 Agent。个人 Session 消息路由到该用户明确选择的 Agent，Project 群聊则路由到云端 Project 和显式 Coordinator，绝不根据当前在线机器或桌面焦点猜测 Coordinator 或个人 Session 执行目标。

## 变更内容

- 新增统一 `UserPrincipal`，作为 Project 成员、手机身份、Agent 所有权、真人问题和审计记录的唯一人类主体。
- 新增 `HumanEndpointBinding`，把经过验证的 Zulip 用户等 IM 身份绑定到一个 `userId`；provider 显示名、邮箱、topic 和 stream 不作为内部身份。
- 新增 `AgentNode` 所有权模型，每台 SciForge 使用稳定 `agentId` 注册，并明确记录 `ownerUserId`；PoC 中每个用户选择一个 primary Agent 作为手机默认执行端。
- 新增 `ParticipantProfile`，把一个用户、其 primary 人类端点和 primary Agent 组合成一个逻辑协作个体，同时保留端点各自的凭据、在线状态和保证级别。
- 区分两类远端会话：个人 Session topic 与一个用户所拥有 Agent 上的一个本地 thread 一一对应；Project topic 对应云端 Project 协作入口，由显式 Coordinator 处理，不直接冒充任何成员的私人 Session。
- 建立稳定路由规则：个人消息按 `userId + projectionId` 路由；Project 消息按 `projectId + senderUserId` 鉴权后写入 Project 信箱；Task Offer 按 `workerUserId` 广播到该 User 的合格 Agent/Device，并在原子 claim 后绑定 Execution。
- 让桌面与手机共享同一条个人 Session 逻辑消息流，使用 receipt、去重、每 Session 顺序队列和重启恢复保证幂等。
- 让多个用户各自的 Agent 通过一个云端协作内核共享 Project、Task、Project Record 和持久信箱；云端不运行特殊 LLM Agent。
- 明确身份与授权分离：手机和机器属于同一用户，不代表 Zulip 登录具备本机高风险能力的批准强度；远程批准必须由 capability policy 显式允许，否则保持桌面待审批。
- 新建一个统一协作领域包拥有桌面端身份、节点、Session 投影、同步和协作 UI；Host 只依赖通用 SDK 合同，不保留旧 remote-channel、Zulip Host runtime 或第二套镜像路径。
- 以本提案作为手机远程 Session 与多用户 Agent 协作的唯一目标方案，后续实现只使用这一套身份、路由和状态合同。

## 能力

### 新增能力

- `user-device-identity`：统一用户主体、人类端点、Agent 节点、所有权、验证、默认路由和撤销语义。
- `remote-session-projection`：将个人本地 Session 稳定投影到手机 IM，并维护双向、幂等、顺序一致的消息流。
- `human-im-routing`：把个人 Session、Project 协作、真人问题和通知按明确目标路由到经过验证的人类端点。
- `cloud-collaboration-kernel`：提供 User/Agent/Project/Task/Project Record/Inbox 的确定性事实库、权限、幂等和离线恢复。
- `sciforge-agent-node`：让每台 SciForge 以所属用户的独立 Agent 节点注册、收取 Task、执行并回传结果。
- `project-agent-collaboration`：定义单 Coordinator、多 Worker、结构化 Task、共享项目记忆和真人升级的星形协作模式。

### 修改能力

- `agent-runtime`：个人远端消息和云端 Task 都复用现有 runtime-neutral AgentRuntime Host，不增加 IM 或云端专属 Runtime。
- `capability-broker`：所有手机、Project 和 Task 触发的能力继续通过唯一审批、审计和外部写入路径；身份绑定不自动升级权限。
- `shared-memory`：个人完整对话和私有记忆留在所属 Agent，本变更只把 Project 正式记录及必要结果摘要保存到云端共享命名空间。
- `domain-module-catalog`：统一协作领域及 provider adapter 通过 manifest 和生成式 composition 发现，不在 Host 添加 provider ID 或领域 ID 分支。

## 影响

- 新增 `@sciforge/collaboration-contracts`、`@sciforge/collaboration-server` 和 `@sciforge/domain-collaboration`；Zulip 支持作为可安装的 provider adapter contribution 接入统一合同。
- 云端服务保存用户、端点绑定、Agent、个人 Session projection 的非敏感远端映射、Project、Task、Project Record、信箱和 receipt；不保存本地工作区、模型/API 凭据、完整私人对话或任意本地文件。
- Provider service credential 保存在云端 secret manager；本地 SciForge 只保存本机 Agent 设备凭据、projection 到本地 thread 的映射、个人 Session、工作区、工具权限、运行状态和详细执行日志。
- Zulip Server 仍是消息服务，不成为 Project、Task 或 Agent 上下文的事实源；云端 PostgreSQL 是协作状态的事实源，本地 AgentRuntime thread 是个人 Session 的事实源。
- PoC 默认一名用户绑定一个主要手机 IM 身份和一个 primary SciForge Agent；数据模型允许后续增加辅助端点或节点，但所有路由仍必须显式选择目标，不使用“最近在线”猜测。
- 第一阶段同步文本 user message、最终 assistant reply、结构化状态、HumanNeeded 和 HumanAnswer；不同步流式 token、编辑、删除、reaction、完整工具日志和任意附件。
- 这是目标架构重写，不保留旧 workspace-channel binding、topic 派生 ID、topic 静默换 Session 或两套 provider runtime 的兼容路径。
