# 设计方案：以用户为中心的手机、SciForge 与云端协作

> **状态：已被 `openspec/changes/unify-user-device-collaboration` 取代。** 本文作为 ADR-0020 的历史依据保留，不是当前实现规范。Keycloak/OIDC 段落也已被当前 provider challenge pairing、UserPrincipal、HumanEndpointBinding 和 Agent device credential 路径取代。若本文与当前 OpenSpec、协作包合同或 ADR 审计冲突，以后者为准。
>
> 历史状态：曾作为 Cloud Collaboration PoC 的产品与架构基线。若本方案与
> `specs/001-team-research-continuity` 冲突，以本方案为准；旧规格中的决策只有在本方案中
> 重新确认后才能继续采用。
>
> 首期部署范围：只连接由团队控制的 `https://chat.sciforge.cn` 及其中的 `SciForge`
> 组织。该地址和组织属于部署配置，不得硬编码进 SciForge Host；首期不向普通用户提供
> 任意 Zulip Server 输入或多组织并行接入。

## 1. 设计原则

本方案先确定协作中最重要的边界，再展开具体功能。所有后续实现都应遵守以下原则。

### 1.1 人是协作主体，设备只是入口

协作系统中的基本个体是一名用户，而不是一部手机、一个聊天账号或一台电脑。

同一名用户可以从手机进入，也可以让自己的 SciForge 执行任务。手机和 SciForge 在产品逻辑上属于同一个人，但仍是两个独立端点：它们有不同的凭据、在线状态和权限强度。

### 1.2 沟通、协调和执行各司其职

- Zulip 负责人与人之间的消息、Topic、通知和聊天历史。
- 云端协作服务负责用户身份、Project、Task、消息路由、共享记录和离线信箱。
- SciForge 负责模型推理、工具使用、本地文件访问和任务执行。

三者相互连接，但不能互相冒充。Zulip 不是项目数据库，云端协作服务不是 Agent，SciForge 也不是多人共享状态的唯一存储。

### 1.3 每类事实只有一个权威来源

- 个人 Session 的上下文和完整对话，以所属 SciForge 的本地 Session 为准。
- Project、Task、成员、Coordinator 和共享结论，以云端协作服务为准。
- Zulip 消息和远端展示历史，以 Zulip Server 为准。

其他位置只能保存投影、引用或缓存，不能建立第二套可以独立修改的事实。

### 1.4 所有路由都必须明确，不能猜测

系统必须能够明确回答：谁发出了消息、代表哪个用户、目标是哪个 Project 或 Session、应由哪台 SciForge 执行。

系统不得根据当前桌面焦点、最近在线机器、Topic 文本、显示名或默认工作区猜测执行目标。无法唯一确定目标时，应停止并提示修复绑定。

### 1.5 身份相同不等于权限相同

手机和机器可以代表同一个用户，但普通聊天登录不自动获得本机高风险权限。文件写入、命令执行、外部发布、凭据使用等操作，仍由执行任务的 SciForge 按本地安全策略决定是否需要批准。

### 1.6 Project 面向多人，Session 面向具体执行上下文

Project 是多个用户及其 Agent 共同参与的协作空间；Session 是某台 SciForge 上连续的 Agent 上下文。

Project 可以包含多个 Session 和多个 Task。共享 Project Topic 不应被伪装成所有人共同拥有的某个私人 Session。

### 1.7 离线、重试和重启是正常状态

手机、桌面、Agent、Zulip 或云端都可能短暂离线。系统应保存未完成消息和任务，恢复后按顺序继续，并确保同一项工作不会因为重试而被执行两次。

### 1.8 人只接收真正需要关注的内容

手机应显示个人对话、需要本人回答的问题、重要异常、关键摘要和最终结果。机器心跳、普通进度、工具日志和 Agent 内部协作不应持续打扰用户。

### 1.9 首期保持简单

首期采用一个云端协作服务、一个独立的协作数据库和一个实时通知入口。暂不引入微服务、消息队列集群、自动选主、任意 Agent 群聊或复杂资源市场。

### 1.10 统一身份不等于复用 Zulip 凭据

Canonical SciForge User 由 SciForge Cloud 在 Keycloak OIDC 认证成功后建立，并获得一个由
Cloud 生成、不透明、永久不变且永不重新分配的 canonical user ID。Keycloak 的不可变
`issuer + subject` 只形成唯一的认证绑定，不直接成为业务实体主键。

Keycloak 是统一身份提供方，只负责身份认证，不负责 Project、Task、Agent、消息或本机权限。
Zulip 与 SciForge Desktop 使用不同的 OIDC Client；Desktop 是不能持有 client secret 的
public client。只有 Cloud 以后提供独立 Web 登录界面时，才增加 Cloud Web confidential
client。

SciForge Desktop 通过系统浏览器执行 Authorization Code + PKCE 登录；应用不得嵌入
Keycloak 登录页、收集用户密码或使用 implicit flow。

Zulip Account 只是与 Canonical SciForge User 显式绑定的外部账号；显示名、邮箱和 Zulip
昵称均不能自动创建、匹配、合并或替换 SciForge User。SciForge 不收集成员个人的 Zulip
密码或 API key。

未完成云端认证时，SciForge 仍可在 Local Mode 使用本地聊天、Workspace、模型和工具；
云 Project、远程 Session、跨用户 Task 和 Agent 注册只在 Connected Mode 开放。

云端部署拓扑不属于登录模块范围，由独立工作流负责。Identity and Access 的公开合同不得
依赖 Keycloak、SciForge Cloud、数据库或 Zulip 是否部署在同一主机。

## 2. 总体结构

系统由五类参与者组成。

| 参与者 | 主要职责 | 不负责的内容 |
| --- | --- | --- |
| 用户 | 提出目标、查看状态、作出决定和批准 | 不手工转发所有机器状态 |
| 手机端 | 远程进入个人 Session，接收 Project 通知和回答问题 | 不运行完整 Agent，不直接持有本机工具权限 |
| Zulip Server | 登录、聊天、Stream、Topic、历史和通知 | 不管理 Agent、Project、Task 或执行权限 |
| 云端协作服务 | 统一身份、路由、Project、Task、共享记录和离线信箱 | 不运行模型，不访问用户本地文件 |
| SciForge | 运行 Agent、访问本地资源、执行 Task 和提交结果 | 不独自决定整个多人 Project 的共同状态 |

从用户视角看，消息路径有两种。

第一种是个人远程操作：用户从手机发消息，经过 Zulip 和云端协作服务，进入自己指定 SciForge 上的固定 Session，最终回复再返回手机。

第二种是多人 Project 协作：用户从手机或桌面向 Project 提交目标、问题或意见，云端协作服务把它交给明确的 Coordinator，由 Coordinator 创建 Task 并分配给不同用户的 SciForge。

## 3. 协作个体的定义

### 3.1 一个协作个体由三部分组成

一个完整的协作个体包括：

1. 一个稳定的用户身份，用来表达“这个人是谁”。
2. 一个主要手机端点，用来表达“如何在 IM 中找到这个人”。
3. 一个主要 SciForge Agent，用来表达“默认由哪台机器代表这个人工作”。

这三者组成同一个参与者档案。系统在成员列表中应把它们组合展示，而不是把手机账号和 Agent 节点显示成两个互不相关的成员。

### 3.2 用户身份保持稳定

用户修改显示名、Zulip 昵称或邮箱后，仍然是同一个用户。内部身份不能由这些可变字段生成。

Project 成员、真人问题、审计记录和 Agent 所有权都引用稳定用户身份。

PoC 采用邀请制。管理员在 Keycloak 中预先创建或邀请六名参与者，不开放公开自助注册。
用户首次成功完成 OIDC 登录时，SciForge Cloud 根据不可变的 `issuer + subject` 幂等建立
Canonical SciForge User；Zulip Account、Project Membership、Device 和 Agent 必须通过
后续显式流程建立，不随用户创建自动授予。

### 3.3 手机端点必须验证

系统通过一次性验证流程确认用户确实控制目标 Zulip 账号。验证结果绑定 Zulip 所在组织和该组织中的用户身份，而不是只相信昵称或用户填写的邮箱。

PoC 使用短期、一次性 Bot 私聊挑战完成验证。OIDC 登录只证明 Canonical SciForge User
身份，挑战只证明该用户控制具体 Zulip Provider Instance 中的不可变 Zulip user ID；两项
证据缺一不可。

同一个 Zulip 身份在同一组织内不能同时属于两个活跃用户。如需转移，必须先由有权用户解除旧绑定。

### 3.3.1 Local Account 迁移

用户首次成功完成 OIDC 登录后，SciForge 只在用户明确确认时把当前选中的本地随机 user ID
关联到云端签发的 canonical user ID。云端 user ID 随即成为 Connected Mode 的权威身份，
本地 user ID 仅作为不可授权的迁移别名保留。

迁移只更新明确列入迁移合同的可变身份引用，不重新归属 Workspace、聊天、文件、设置或凭据，
不改写历史审计记录，也不重新绑定运行中的 Agent turn。用户名、邮箱、显示名和任何 Zulip
属性都不能触发自动匹配或合并。

### 3.4 SciForge 必须有明确所有者

每台参与协作的 SciForge 都注册为独立 Agent，并记录其所有者、名称、节点类型、能力和在线状态。

SciForge 重启后应恢复原 Agent 身份，不能每次重启都产生一台“新机器”。Agent 所有权变更必须显式进行，并同时轮换设备凭据。

### 3.5 主要 Agent 由用户选择

首期允许同一用户注册多台 SciForge，但必须明确选择一台主要 Agent，作为手机创建个人 Session 时的默认目标。

主要 Agent 离线时，系统应显示离线并等待、取消或让用户显式选择另一台机器。不得自动把工作交给最近在线机器，更不能交给另一个用户的机器。

## 4. 两种消息空间

个人 Session 和多人 Project 的语义不同，必须使用不同的路由规则。

### 4.1 个人 Session Topic

个人 Session Topic 是某个本地 Session 的远端入口。

它固定绑定：

- Session 的所有者；
- 执行该 Session 的 SciForge；
- 本地 Session；
- 一个经过验证的手机端点；
- Zulip 中的具体 Topic。

绑定建立后，切换桌面焦点、打开其他 Project 或修改 Topic 名称，都不会改变它所指向的 Session。

个人 Session 默认只有所有者可以发送可执行消息。用户可以显式邀请其他成员进入共享 Session，但界面必须清楚显示：“该 Session 由谁的 SciForge 执行”。其他成员加入后不会自动改用自己的机器，也不会为每个人暗中创建新的 Session。

### 4.2 Project Topic

Project Topic 是多人 Project 的沟通入口，不是某个人的私人 Session。

成员在其中发送的内容，先作为带有真实发送者身份的 Project 输入保存到云端。Coordinator 可以：

- 回答问题；
- 请求澄清；
- 创建或调整 Task；
- 把内容记录为候选观察；
- 拒绝越权或与 Project 无关的指令。

Project Topic 中的一句话不会直接广播给所有 Agent。Worker 只有收到明确分配给自己的 Task 才会执行。

### 4.3 为什么必须区分两者

如果 Project Topic 直接对应某个人的私人 Session，就会出现以下问题：

- 其他成员的消息都由该人的机器执行；
- 其他人的 Agent 无法形成清晰的任务边界；
- Project 状态隐藏在一个本地对话中；
- 机器离线后整个 Project 失去共同状态；
- 成员容易误以为自己的本地权限正在被使用。

因此，个人 Session 解决“我从手机继续自己的工作”，Project Topic 解决“多人如何围绕共同目标协作”。

## 5. 个人 Session 的交互流程

### 5.1 手机发起消息

1. 用户在个人 Session Topic 中发送消息。
2. Zulip 将消息事件交给云端的人类消息入口。
3. 云端确认发送者属于哪个用户，并确认该用户有权访问目标 Session。
4. 云端根据稳定的 Session 映射，把消息投递给指定的 SciForge。
5. SciForge 在原本地 Session 中记录消息并运行 Agent。
6. SciForge 将最终回复交回云端。
7. 云端通过 Zulip 把最终回复发送到原 Topic。

整个过程中，本地 Session 是 Agent 上下文的权威来源。云端和 Zulip 只保存投递状态及远端展示所需信息。

### 5.2 桌面发起消息

1. 用户在桌面 Session 中提交消息。
2. SciForge 先把消息写入本地 Session。
3. 已绑定的个人 Topic 收到同一条用户消息。
4. Agent 完成回复后，最终回复同时出现在桌面和手机。

首期只同步完整文本消息和最终回复，不同步逐字生成过程。

### 5.3 消息顺序

同一个 Session 在任意时刻只执行一条用户消息。如果手机和桌面同时发来消息，后到的消息排队等待。

不同 Session 可以并行运行，因此一个 Project 中的多个独立工作不会互相阻塞。

### 5.4 消息去重

系统为每条入站和出站消息保留投递记录。即使 Zulip 重发事件、网络请求超时、SciForge 重启或云端重新连接，同一条逻辑消息也只能创建一个本地 Agent 回合。

如果无法确认消息是否已成功发送，系统先对账，再决定是否重试，不能简单发送第二份。

## 6. 多人 Project 的协作方式

### 6.1 Project 以用户为成员

Project 成员列表记录参与的用户，而不是只记录机器。界面把每名用户的手机状态和 Agent 状态组合展示，例如：

- 用户在线，Agent 在线；
- 用户可通过手机联系，Agent 离线；
- Agent 正在执行，用户暂时不可联系；
- 手机端点或 Agent 已撤销。

### 6.2 每个 Project 有一个 Coordinator

每个 Project 同时只有一台 SciForge 担任 Coordinator。Coordinator 负责：

- 理解 Project 目标；
- 维护正式计划；
- 创建和分配 Task；
- 检查 Worker 返回的结果；
- 接受正式 Project 记录；
- 把无法自动解决的问题交给目标用户；
- 形成最终总结。

Coordinator 是一种 Project 角色，不是一种特殊版本的 SciForge。同一台 SciForge 可以在自己的 Project 中担任 Coordinator，也可以在其他 Project 中担任 Worker。

### 6.3 Worker 只处理明确 Task

Worker 收到的每个 Task 都明确包含目标、执行者、当前版本、完成条件和状态。

Worker 可以接受、拒绝、执行、报告失败、提交结果或请求真人帮助，但不能直接修改全局计划，也不能向其他 Worker 广播新的执行指令。如果需要其他能力，Worker 向 Coordinator 提出建议，由 Coordinator 决定是否创建新 Task。

### 6.4 使用星形协作而不是自由群聊

所有正式任务都由 Coordinator 分配，Worker 把结果返回 Coordinator。这种结构能避免：

- 多个 Agent 重复执行同一工作；
- Worker 相互创建无界任务；
- 多台机器同时改写 Project 计划；
- 无法判断哪个结果已经被正式接受。

不同 Worker 可以并行执行互不依赖的 Task。

### 6.5 Coordinator 转交

Coordinator 离线时，首期 Project 暂停创建新 Task。具有权限的用户可以显式把 Coordinator 转交给另一台 Agent。

转交完成后，旧 Coordinator 不能继续写入计划。首期不进行自动选主，以免两台机器同时认为自己是 Coordinator。

## 7. 云端协作服务的职责

### 7.1 身份与设备目录

云端保存用户、已验证手机端点、Agent 所有权、主要 Agent 和在线状态。这一目录负责回答“这个手机账号是谁”和“这个用户的工作由哪台机器执行”。

### 7.2 Project 与 Task 账本

云端保存 Project 目标、成员、Coordinator、Task、执行者、状态和版本。任何越权或过期修改都会被拒绝。

### 7.3 持久信箱

每个用户和 Agent 都有持久信箱。实时连接只负责通知“有新消息”，真正的消息在数据库中保存。

Agent 离线时，Task 不会丢失；重新连接后从上次确认的位置继续读取。

### 7.4 Project 共享记录

云端只保存对 Project 有共同价值的正式信息：

- 已确认的观察；
- 已接受的 Task 结果摘要；
- 正式决定；
- 阶段总结和最终总结。

Worker 可以提交候选内容，但只有 Coordinator 或有权限的真人能把它接受为正式决定或总结。

### 7.5 人类消息入口

云端的人类消息入口负责连接 Zulip，验证远端用户身份，解析 Topic 对应的目标，过滤重复事件，并把回复送回正确位置。

Provider 专有逻辑应封装在独立适配器中。以后增加其他 IM 时，不应修改 SciForge Host 或云端核心的业务分支。

### 7.6 云端明确不做什么

云端协作服务不运行模型，不调用用户本地工具，不保存完整私人对话，不读取本地工作区，也不持有用户的 SSH、VPN 或模型凭据。

## 8. Zulip Server 的职责与边界

Zulip 提供成熟的手机和网页聊天体验，包括用户登录、组织、Stream、Topic、历史、未读状态和通知。

Zulip 不理解以下 SciForge 概念：

- 一名用户拥有哪些 Agent；
- 哪台 Agent 是主要执行机器；
- Project 当前由谁协调；
- Task 分配给谁以及执行到哪一步；
- 某个 Task 是否已经执行过；
- 哪条结果已经成为正式 Project 结论。

因此，Zulip Topic 名只是显示和定位信息，不是稳定业务身份。修改 Topic 名不能创建新 Session 或改变 Project。

云端协作服务只能通过 Zulip 的公开 API 和事件接口交互，不能直接读写 Zulip 的内部数据库。

## 9. SciForge 客户端的职责

每台 SciForge 负责：

- 保存本机 Agent 身份和设备凭据；
- 维护与云端的连接和信箱位置；
- 保存个人 Session 与本地工作区之间的关系；
- 接收个人远端消息和 Project Task；
- 通过现有 AgentRuntime 执行；
- 通过现有权限系统处理文件、命令和外部写入；
- 回传状态、结果摘要和允许共享的产物引用；
- 在断线重连后恢复真实执行状态。

个人远端消息和多人 Task 必须复用现有 AgentRuntime 与权限路径，不能新增一套只服务于 Zulip 或云端的模型、工具或审批旁路。

## 10. 真人问题与通知

### 10.1 问题必须指定目标用户

Agent 需要真人决定时，必须明确问题要交给哪名用户。云端只向该用户已验证的手机端点发送。

如果目标用户没有可用手机端点，问题保留在该用户信箱，并在其桌面显示。系统不能因为其他成员在线，就把问题转给其他人。

### 10.2 回答必须可追溯

系统记录谁回答、从哪个端点回答、关联哪个 Project 和 Task、回答时间以及当时请求的版本。

已经取消、完成或被新版本取代的问题不能再改变当前 Task。

### 10.3 控制通知噪声

手机通知包括：

- 个人 Session 新消息和最终回复；
- 需要本人回答的问题；
- 策略允许从手机处理的批准；
- 重要失败或阻塞；
- 阶段摘要和最终结果。

以下内容默认只在桌面或 Project 状态页显示：

- Agent 心跳；
- 普通 Task 进度；
- 工具调用日志；
- Agent 内部推理；
- 机器之间的协调消息。

## 11. 权限与安全

### 11.1 四个问题分别判断

每次操作都要分别回答：

1. 发起者是谁？
2. 使用了哪个手机或 Agent 端点？
3. 发起者在目标 Project 或 Session 中有什么角色？
4. 当前操作需要多高的批准强度？

四项全部满足后，操作才能继续。

### 11.2 手机不自动成为本机管理员

用户可以从手机向自己的 Session 发出任务，但任务执行时仍受本机权限约束。

如果某项操作要求桌面批准，手机只能看到“等待桌面批准”。只有未来某项具体能力明确支持远程批准，并且手机端点达到所需安全等级时，手机批准才有效。

### 11.3 凭据分开保存

- Zulip 服务凭据保存在云端的密钥管理位置。
- Agent 设备凭据保存在对应 SciForge 的本地密钥存储中。
- 模型密钥、SSH 私钥、VPN 凭据和工具凭据留在本地或机构信任域。
- 普通设置、日志、诊断、二维码、文档和 Git 文件中不得出现长期凭据。

### 11.4 数据最小化

| 数据 | 保存位置 |
| --- | --- |
| 用户、手机绑定、Agent 所有权和在线状态 | 云端协作数据库 |
| Project、Task、共享记录、信箱和投递状态 | 云端协作数据库 |
| Zulip 消息和展示历史 | Zulip Server |
| 本地 Session、完整对话和工作区关系 | 所属 SciForge |
| 本地文件、原始数据、模型与工具凭据 | 用户机器或机构信任域 |

云端只保存完成协作所需的最小信息，不自动上传完整对话、工作区或原始数据。

## 12. 可靠性与故障处理

### 12.1 手机离线

Zulip 保留消息和未读状态。需要用户处理的问题继续保存在云端用户信箱中。

### 12.2 Agent 离线

个人 Session 消息和 Task 保持等待状态。超过可接受时间后，系统提示用户确认是否继续，而不是在机器重新上线时一次性执行大量陈旧指令。

### 12.3 云端重启

Project、Task、绑定、信箱和投递状态从协作数据库恢复。实时连接恢复后从最后确认位置继续，不重复执行。

### 12.4 Zulip 重复投递

相同远端消息只被接受一次。系统过滤 Bot 自己发送后又收到的回声事件。

### 12.5 Topic 改名或移动

系统更新远端位置和显示名称，但保持原 Session 或 Project 身份。如果无法唯一确认新位置，绑定进入错误状态，等待人工修复。

### 12.6 Coordinator 离线

正在执行且已获得授权的 Task 可以按本地策略继续；新的计划变更和 Task 分配暂停，直到原 Coordinator 恢复或有权用户显式转交。

### 12.7 设备撤销

手机或 Agent 被撤销后，旧凭据立即不能创建新消息或状态变化。未完成工作进入可见的待处理状态，不自动改派并重复执行。

## 13. 用户界面

### 13.1 参与者页面

每名用户显示为一张统一参与者卡片，包括：

- 用户名称；
- 手机端点及最后验证时间；
- 主要 Agent 及在线状态；
- 当前 Project 角色；
- 重新验证、切换主要 Agent 和撤销入口。

界面不应要求用户从两个无关列表中猜测哪个手机属于哪台机器。

### 13.2 个人 Session 页面

用户可以选择一个本地 Session 分享到手机，并看到：

- 对应 Topic；
- 实际执行 Agent 和所有者；
- 最近同步状态；
- 排队消息；
- 失败和重试；
- 暂停、恢复、重命名和关闭。

切换桌面当前 Session 不会自动重绑远端 Topic。

### 13.3 Project 页面

Project 页面集中展示：

- 目标和当前状态；
- 成员及各自手机、Agent 状态；
- 当前 Coordinator；
- Task、执行者和依赖；
- 需要真人处理的问题；
- 已接受的观察、决定和总结。

用户应能一眼分辨“这是团队 Project 状态”还是“这是某个人的本地 Session”。

## 14. 软件边界

系统按职责分为四个可独立拥有和发布的部分。

### 14.1 共享合同

统一描述用户、端点、Agent、Project、Task、消息、状态、错误和权限规则。它不包含数据库、网络、界面或 Agent 执行逻辑。

### 14.2 云端协作服务

独立部署并拥有协作数据库，负责身份、账本、信箱、路由和确定性授权。

### 14.3 SciForge 协作领域

同一个领域包同时拥有桌面后端和界面，负责 Agent 注册、Session 投影、本地队列、Task 接入和协作页面。它通过标准领域清单安装，不修改 Host 中央功能表。

### 14.4 IM Provider 适配器

封装 Zulip 的认证、用户身份、事件、Topic 定位、发送和重试。以后支持其他 IM 时，实现同一适配合同即可，不在 Host 或云端核心增加特殊分支。

每项能力只有一条生产路径。旧的远端频道绑定、Host 内置 Zulip 运行时和重复消息镜像路径在迁移完成后删除。

## 15. 部署关系

Zulip Server 和云端协作服务可以部署在同一台阿里云 ECS 上，但逻辑上必须是两个独立服务。

它们使用独立进程、独立配置、独立权限边界和独立数据库。云端协作服务只能使用 Zulip 的公开接口，不能直接修改 Zulip 数据库。

如果现有香港 ECS 的资源不足，可以把云端协作服务迁到另一台实例，而不影响手机仍然通过同一个 Zulip 地址使用。服务地址和内部连接由配置管理，不写死在 SciForge Host 中。

## 16. 迁移原则

这是一次目标语义替换，不长期保留旧逻辑。

升级时用户依次完成：

1. 登录或创建统一用户身份。
2. 重新验证 Zulip 手机端点。
3. 注册自己的 SciForge Agent。
4. 选择主要 Agent。
5. 重新分享需要在手机访问的个人 Session。
6. 加入或创建多人 Project。
7. 分别验证手机到桌面、桌面到手机和多人 Task 流程。

旧的工作区—频道绑定、由 Topic 名生成身份、Topic 静默切换 Session、Host 内置 provider 分支和两套同步路径全部删除，不增加长期兼容层。

## 17. 分阶段落地

### 阶段一：统一身份

实现用户、手机端点、Agent 所有权、主要 Agent 和撤销流程。此阶段先回答清楚“谁是谁、哪台机器属于谁”。

### 阶段二：只读连接

手机和桌面可以查看身份、Agent、Project 和 Session 映射状态，但手机消息暂不触发执行。先验证路由正确性。

### 阶段三：个人 Session 双向同步

实现手机与桌面共享同一 Session、顺序队列、去重、离线恢复和最终回复同步。

### 阶段四：多人 Project 与 Task

实现成员、Coordinator、Worker、Task、Project 记录、并行执行和手动 Coordinator 转交。

### 阶段五：真人问题与 Project Topic

实现定向问题、回答、重要通知以及 Project Topic 到 Project 输入的稳定映射。

### 阶段六：删除旧路径并正式验收

删除旧实现，完成源代码和打包应用验证，并用六名用户进行端到端测试。

阶段用于安排开发顺序，不用于保留两套长期生产逻辑。

## 18. 最终验收标准

方案完成后，应满足以下可观察结果：

1. 六名用户分别绑定自己的手机和 SciForge，系统显示为六个协作个体。
2. 用户 A 从个人 Topic 发消息，只进入 A 明确选择的 Agent 和固定 Session。
3. 用户 B 的 Agent 不会因为在线或处于同一 Stream 而收到 A 的个人任务。
4. 桌面和手机看到同一个个人 Session 中相同顺序的用户消息与最终回复，且没有重复。
5. Project Topic 中 A、B、C 的消息保留各自身份，进入云端 Project，而不是任意一个人的私人 Session。
6. Coordinator 可以把两个独立 Task 分配给不同用户的 Agent，并行收集结果。
7. 用户 B 的 Task 需要决定时，只通知 B；无权成员不能代答。
8. 手机触发的高风险操作仍遵守本地权限策略。
9. Agent、云端或 Zulip 短暂断线后可以恢复，不重复执行消息或 Task。
10. 修改中文 Topic 名不会改变 Session 或 Project 的稳定身份。

当这十项同时成立时，才能认为“一个用户的手机和机器是同一个逻辑个体”以及“多个逻辑个体可以安全协作”已经真正实现。
