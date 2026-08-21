# SciForge 手机与多人协作使用手册

本文说明统一协作功能的日常使用方式。运维部署、备份和故障恢复见
[香港 ECS 与 Zulip 运维手册](./operations/zulip-aliyun-deployment.zh-CN.md)。

> 普通用户不需要选择、切换或理解任何 Git 分支。管理员提供可安装的 SciForge 桌面版、协作服务
> 地址和个人 Zulip 账号后，按本文操作即可。只有从源码启动桌面端的开发者才需要接触 Git。

## 普通用户最短入口

开始前只向管理员确认三项信息：

1. SciForge 桌面安装包或已安装的桌面应用；
2. 协作服务地址，例如 `https://chat.sciforge.cn/collaboration`；
3. 自己的 Zulip 账号、Zulip Server 地址以及允许使用的 channel / Topic。

然后完成四步：安装并登录**官方 Zulip 手机 App** → 启动 SciForge 桌面端 → 在桌面“协作”面板连接
管理员提供的云端地址 → 点击“开始手机配对”，复制完整指令并从手机 Zulip 原样发送。

当前手机端就是官方 Zulip App，不是 SciForge 仓库内开发或打包的自研手机 App；用户无需编译、安装
仓库中的任何移动端工程。

启用“托管私人 Channel”的组织还可以由管理员为每位用户配置一个私人、受保护历史的 Channel。Channel
只有该用户与 SciForge Bot；用户在手机中手工创建项目 Topic，再在 Desktop 中分别把每个 Topic 连接到
不同的固定 Session。普通 Bot 私聊仍只用于 `/bind`，不能控制 Desktop Agent。

## 版本与发布关系

桌面协作域与云端协作服务的源码可追溯到同一个 `gui` commit，以保证通信契约一致；但桌面安装包与
云端服务是两个独立发布物：桌面端由用户安装或从源码启动，云端服务由管理员单独构建、部署和升级。
普通用户不要为了使用手机协作切换 Git 分支，也不要在个人电脑上启动云端服务。

管理员需要部署、升级或排障时，使用
[协作服务开发与香港 ECS 部署文档](./operations/zulip-aliyun-deployment.zh-CN.md)。

## 1. 先理解四个对象

| 对象 | 含义 | 权威来源 |
| --- | --- | --- |
| User | 稳定的人类身份；Project 成员、Agent 所有者和真人问题都引用它 | 云端协作服务 |
| 手机端点 | 已验证的个人 Zulip 账号；它代表用户发消息，但不是本机管理员 | 云端绑定 + Zulip 身份 |
| Agent | 一台明确属于某名用户的 SciForge；每台机器有独立、可撤销的设备身份 | 云端目录 + 本机 secret store |
| 个人 Session | 一台固定 Agent 上的固定 runtime/thread；可投影到一个手机 Topic | 本地 AgentRuntime thread |

Project 是多人共享的目标和任务账本。Project Topic 只把带真实发送者身份的输入交给唯一
Coordinator，不是任何成员的私人 Session，也不会广播唤醒全部 Agent。

## 2. 首次准备

管理员需要先为每人创建独立 Zulip 账号并把该账号加入允许的 channel。用户不得共用管理员
账号或他人的手机账号。

手机端（普通用户）：

1. 从手机应用商店安装官方 Zulip App；不要寻找名为“SciForge 手机端”的仓库内安装包。
2. Server 填写 `https://chat.sciforge.cn`。
3. 使用自己的 Zulip 邮箱和密码登录。
4. 确认能打开管理员指定的 SciForge channel。

桌面端（二选一启动）：

- 普通用户：安装管理员或正式发布渠道提供的 SciForge 桌面安装包并启动。
- 源码开发者：在管理员或开发负责人指定的源码版本中运行 `npm ci`，再运行 `npm run dev`。这不是
  普通用户的必需步骤，也不需要用户自行判断“GUI 分支”或“云端分支”。

启动后：

1. 启动新版 SciForge，并打开任意 Session；手机绑定本身不要求先选择 Project。
2. 点击工具栏的协作个体图标，打开右侧“协作”面板。
3. 在“协作服务地址”填写管理员提供的地址；当前部署示例为
   `https://chat.sciforge.cn/collaboration`。点击“保存并连接”。
4. 状态应从“连接中”变为“已连接”。如果显示“连接异常”，不要反复注册；先看“队列与恢复”的明确错误。

## 3. 绑定个人手机端点

1. 在“协作个体”中选择 Zulip，并填写界面要求的 Realm；当前 Realm 为
   `https://chat.sciforge.cn`。
2. 点击“开始手机配对”。桌面会显示一条短期、一次性的完整 `/bind SF1...` 命令。
3. 点击“复制指令”，在手机官方 Zulip App 中私聊 SciForge Bot，粘贴并原样发送整条命令。Bot 会在同一私聊中返回“绑定成功”或不泄漏 Challenge 细节的统一失败提示。
   不要只复制其中一段，不要截图转发给别人，也不要写入文档或工单。
4. 保持桌面在线，等待面板显示“手机端点已验证”。命令过期后应重新开始配对，不能复用旧命令。

同一 Zulip 身份不能同时绑定到两个 active User。手机丢失、账号异常或人员变更时，应立即断开本机
协作连接并联系管理员按端点管理流程撤销绑定；如 Bot 服务凭据也可能泄漏，再由管理员单独轮换。

### 3.1 私人 Channel 与多个固定 Session（启用后）

1. 在协作面板的“托管私人 Channel”中确认状态为 active，隐私、历史、成员、发言和 Topic 检查均通过。
2. 在手机 Zulip 的该 Channel 中手工创建项目 Topic；SciForge Bot 不会主动创建项目 Topic。
3. 回到 Desktop 点击“刷新手机 Topic”。下拉列表会标明每个 Topic 是“未绑定”还是已经绑定到某个
   Session；为每个未绑定 Topic 分别选择当前或新 Session。系统会阻止同一 Topic 重复绑定。
4. 在每个 Topic 发一条无敏感内容的测试消息，确认回复回到原 Topic；当前 Session 顶部应持续显示
   对应的 Channel / Topic。内部 runtimeId/threadId 仅在“技术详情”中提供给诊断人员。
5. “检查状态”执行真实只读核验；发现 drifted 时不要自行改权限，联系管理员使用受控的“修复”操作。

Topic 名称可以调整，但不要删除后以同名 Topic 代替原 Topic；路由依据稳定 locator，不是显示名称。私人
Channel 只隔离普通未授权用户，不是端到端加密。Channel 内所有 Topic 共享同一阅读权限；需要不同成员
权限的项目必须使用不同私人 Channel。详细管理员流程见
[每用户私人 Zulip Channel 运维说明](./operations/zulip-private-channel-provisioning.zh-CN.md)。

## 4. 注册并选择主要 Agent

手机端点验证后：

1. 点击“注册这台 SciForge”，输入便于识别的设备名称。
2. 确认参与者卡片中的 Agent owner 是自己。
3. 如果拥有多台 Agent，点击“设为主要 Agent”明确选择默认机器。

主要 Agent 离线时，消息会保持有界等待或返回明确离线状态。系统不会选择最近在线机器，也不会
把工作交给其他用户的 Agent。

## 5. 把现有 Session 绑定到手机 Topic

1. 切到要继续使用的本地 Session。
2. 先核对“当前 Session”摘要，再点击“绑定当前 Session”。也可以选择“新建并绑定 Session”。
3. 在“请选择容器 / Topic”中选择目标手机 Topic；发现多个 Topic 时必须显式选择，系统不会默认提交
   第一项。已绑定 Topic 会显示其目标 Session且不能重复选择；再核对卡片上的手机 Topic、执行 Agent
   和 Agent owner。内部 ID 默认折叠在“技术详情”中。
4. 默认保持“仅所有者”。只有确需共享时才编辑允许发送者 userId 列表。

绑定已有 Session 会同步其中已有的用户文本和 Agent 最终回复；工具过程、执行状态、附件和文件不会
因此同步。界面会在绑定前明确显示这一边界。

建立映射后，切换桌面焦点、打开其他 Project 或修改 Topic 中文标题，都不会改变该映射。一个 Topic
只投影一个固定 Session；需要另一个上下文时应建立另一个 projection。

可用操作：

- “修改映射名称”只改 SciForge 中的显示名，不会重命名手机 Topic或改变 projection ID；
- “暂停/恢复”控制新消息处理；
- “绑定到当前 Session”会明确显示目标手机 Topic和当前 Desktop Session，确认后才更新固定映射；
- “关闭”终止该远端入口，之后的消息不得继续触发执行；
- “编辑允许发送者”不会改变实际执行 Agent，界面会持续显示 Agent owner。

## 6. 双向消息规则

手机发消息时，云端先验证 User、手机端点和稳定 locator，再把消息加入 projection 顺序队列。同一
projection 同时只运行一个 turn，后到消息可见地排队；不同 projection 可以并行。

手机中由 Generic Bot 发送的投影文本会增加来源前缀：Desktop 用户文本显示为“【电脑端】”，Agent
可见的阶段性说明显示为“【SciForge Agent · 中间进展】”，最终回复显示为“【SciForge Agent · 最终报告】”。
中间进展使用 Zulip 原生可折叠 spoiler，默认只显示“中间进展”标题；最终报告保持直接展开。手机用户
本人发送的消息仍使用 Zulip 原生用户身份。Desktop
收到手机消息时会显示“手机 Zulip · Channel / Topic”来源标签。来源标签只用于展示；身份验证、权限
和路由始终使用结构化 User、Endpoint、Projection 与 locator，不解析这些文字前缀。

桌面发消息时，本地 Session 先接受消息，再将同一逻辑 user message、明确的 assistant 中间进展和最终
assistant reply 投影到手机。只同步 Agent 明确对用户可见的 append-only 文本；不会把模型推理、流式
token、原始工具日志、敏感命令参数、编辑、删除、reaction 或附件投影到手机。

如果网络超时，不要复制消息反复发送。系统会用 provider message ID、逻辑消息 ID 和 receipt 对账后
重试；“队列与恢复”会显示尝试次数和终态。

## 7. Project 与 Task

- Project 成员是 User；Coordinator 和 Task assignee 是 Agent，二者不可互换。
- 每个 Project 同时只有一个 active Coordinator。只有它能维护正式计划、创建或改派 Task、接受结果。
- Worker 只处理明确分配给自己的 Task，可提交结果、观察或子任务建议，不能直接改写全局计划。
- Coordinator 转交必须由有权用户显式完成；旧 Coordinator 随后写入会被拒绝。
- Project Topic 中每条输入都保留 senderUserId，并进入 Project 队列；它不会进入成员的私人 Session。

## 8. 真人问题与权限

HumanNeeded 必须指定 targetUserId，只投递给该用户的 active 手机端点。其他在线成员不能代答；过期
或已被新 revision 取代的问题不能改变当前 Task。

通知会附带完整回复格式：`sciforge-answer <humanRequestId> <revision> <answer>`。目标用户应保留前两个
标识不变，只把 `<answer>` 替换为自己的答案并从收到通知的同一 Topic 发送；不要手工猜测 request ID
或 revision，也不要让其他成员转发代答。

手机和 Agent 同属一名用户，不代表手机自动拥有本机高风险批准权。文件写入、命令执行、外部发布和
凭据使用始终由本地唯一 Capability Broker 持有最终状态。只有 Broker 明确标记为可远程一次性审批的
请求，才会在原 Channel / Topic 收到短期审批卡片；默认策略为不可远程审批。

审批时只能在原 Topic 严格回复卡片给出的 `1 AP1-…`（仅本次允许）或 `2 AP1-…`（仅本次拒绝）。
裸 `1`、`2`、`yes`、`allow`、`deny` 和普通 Bot 私聊都不会形成审批。短期编号只能使用一次且默认
5 分钟过期；Server 还会核对已认证发送者、Endpoint、Topic locator、Projection、固定 Session、turn
和 capability request。卡片终态会更新为已允许、已拒绝、已过期或需回到 Desktop 处理；消息更新失败
只会走持久重试或追加安全通知，不会重复执行决定。

## 9. 断线与恢复

| 现象 | 处理 |
| --- | --- |
| 手机离线 | Zulip 保留消息和未读状态；重新联网后正常查看 |
| Agent 离线 | 云端信箱保留消息；确认消息仍然适用后再让 Agent 连接 |
| 云端连接异常 | 在“云端连接”点击“重新连接”，再到“队列与恢复”恢复 inbox/outbox |
| 单条消息失败 | 查看安全错误码和尝试次数；只对 retryable 项点击“重试” |
| Topic 改名后异常 | 不新建隐藏 Session，也不要重新链接本地 thread；先刷新/重连，持续失败时由管理员检查 provider locator |
| Agent/手机被撤销 | 旧凭据立即失效；重新验证或重新注册，不复制旧 token |

## 10. 最小个人验收

1. 手机在个人 Topic 发送一条带唯一时间标记的无副作用消息。
2. 确认桌面固定 Session 只出现一个 user message 和一个 Agent turn。
3. 确认最终 Agent 回复只在原 Topic 出现一次。
4. 从桌面同一 Session 再发送一条唯一标记，确认手机看到 user message 和最终回复。
5. 让桌面暂时离线，手机再发一条消息；重新上线后确认只执行一次且顺序正确。
6. 触发一项测试 policy 明确允许远程一次性审批的无副作用能力，确认只有原 Topic 中带完整短期编号的
   owner 回复可以决定；再确认默认不可远程审批的能力仍要求回到 Desktop。
7. 触发一个包含可见中间进展的测试 turn，确认中间进展默认折叠、最终报告直接显示，且手机端没有模型
   推理或原始工具日志。

验收时不要使用真实密码、API key、token、私钥、敏感文件内容或破坏性命令。
