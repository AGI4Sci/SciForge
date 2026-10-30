# `@sciforge/domain-collaboration`

SciForge 的统一用户—手机—Agent 协作领域包。

包通过标准 domain manifest 提供独立 main 与 renderer 入口。main 入口拥有 Agent
设备连接、本地 Session 投影、durable inbox/outbox、每 projection 顺序队列、receipt
ledger 和 Task adapter；renderer 只通过 Capability Broker 调用公开 capability，不使用
领域专用 IPC、MCP 或 Host 私有路径。

会话正文通过只读 `renderer.chat-message` 贡献显示包内中文卡片。协作注入的规范任务
输入按标题、目标、完成标准排版，系统协议默认折叠；同一精确任务轮次的完整 Worker
结果显示说明，原始 JSON 可展开。普通输入、无效或未完成结果保留标准正文。只有现有
`readWorkerDelivery` 证实相同 Project/Task/Execution、`sourceTurnId` 与接收的说明，
才显示“已更新交付草稿”；最终消息早于 Adapter 收尾时，读取会限时重查。复制、编辑、
模型输入、附件和 queue/steer 仍使用标准会话的原始数据与能力。语义结果校验由 main
和 renderer 复用同一个包内 `worker-runtime-result.ts`，协议没有另建分支。

renderer 通过通用 `workbench.main-area` 贡献一个整页 Collaboration 入口，Host 左侧栏负责
切换页面；旧的 `collaboration.workbench-right-panel`、`collaboration.open` 命令和顶栏按钮已删除。
shell 内左侧为
项目切换（按 “协作小组” 我负责的 / 我参与的 分组，仅为 UI 分组）、我的工作、收件箱、公共动态、
云盘、成员、Agent 与设备和设置；中间是同一 Dashboard 查询上的 Board/Table/Calendar/Gantt；
右侧是公共检查器。Coordinator 与 Worker 只是 shell 内按角色出现的操作，不是独立面板。其他领域包
只能通过通用 `workbench.workspace-section` 合同（`sciforge.collaboration-center`）向 shell
的云盘或设置路由追加分区。

本地高频状态写入 `<userData>/domains/collaboration/state.json`，使用 0600 原子替换。
文件存储遇到不受当前版本支持的 schema 时，会先把原始字节原子移动到同目录的
`state.json.unsupported-*` 恢复副本，再写入当前空状态并要求重新连接 Cloud；它不会迁移、
重放或静默丢弃旧 outbox。没有显式隔离能力的自定义存储仍然 fail closed。
非敏感 Cloud URL 保存到 package-scoped settings。User 请求只通过 identity-access
提供的 token-free authenticated Cloud transport，OIDC Token 始终留在 Identity 私有边界。
每台 ACTIVE Device 由 Identity 自动确保一个以 Device 名称显示的 active Agent；ensure、轮换、撤销、Agent-authenticated HTTP/WSS
以及私有 authority 的存取都由 identity-access 的 owner-scoped internal service 完成。本包只
观察非秘密的 Agent facts、authority readiness 与 Cloud events，不接收 bootstrap key、Token、
私有 authority 或任何通用秘密存储句柄。renderer 不提供 Agent 注册、命名、权限恢复或 primary
选择入口；个人 Session 始终使用当前 Device 的本机 Agent。heartbeat 仅投影
Identity 从 AgentRuntime readiness 观察得到的 capability tags；Runtime 不可用时为空。OIDC、Device
或 Agent authority 丢失时连接 fail closed，先停止 outbox/WSS 并 fence 本地 execution，再允许
连接恢复；Agent authority 缺失或过期由 Identity 的同一 ensure 路径自动恢复。
暂时无法向 Cloud 确认 Device 时保留待同步意图和已领取 journal；恢复后仍须重新验证身份，
未知状态不会放行执行，也不会被当作已撤销设备而永久关闭本地任务。

启动、配置及手动恢复共用完整的 Cloud 资料同步流程，依次刷新 provider catalog、本机
Agent、participant、active endpoint locators 及受支持的 managed containers。同步失败记录
`collaboration.cloud_sync_error`，只有完整同步成功才清除；心跳和 inbox 恢复成功只清除
`collaboration.connection_error`，保留尚未恢复的资料同步、projection 和 Task 诊断。

Worker availability 只发布本机事实：它复用最近一次成功 heartbeat 返回的精确 Agent revision、
last-seen 与完整 Runtime capability tags，并从 durable execution journal 计算 active Task count。
User-level offer 通过现有 Inbox 保存到本地 pending journal。接单只能由 Human 手动触发，
不需要在线 heartbeat 或就绪 Runtime。完全离线时先持久化接受意图，经原有 Outbox 重放，
显示“接受待同步”；WS 断开但 REST 可用时照常尝试。Cloud 原子 claim 成功前不创建本地
Execution、不运行 Runtime。旧 automatic 配置由现有存储升级清除，未确认的自动领取意图
恢复为待接受；新的人为点击使用原幂等键核对可能已成功的 Cloud 回执。

领取成功但 Runtime/能力/本地 Provider 暂未就绪时显示“已领取 · 等待 Runtime”。恢复后仅原绑定
User/Agent/Device 在最新授权、能力与真实 Provider ACL 检查通过后启动；重试、异步 Session
绑定、durable ownership 和 fence 继续走原路径。全局拒绝关闭 User Offer，本地忽略只隐藏本
Device 的卡片。Provider identity、Project Membership 和 content readiness 由 Cloud 从独立事实组合。

Endpoint challenge 由当前 OIDC User 发起并绑定精确 provider/realm/providerUserId；`/bind`
只证明 provider endpoint 事实，不创建 User、不签发第二种 User credential，也没有匿名 poll
secret。Agent presence、WSS、Inbox 与 durable outbox 使用 Identity 持有的独立、可撤销
Agent authority，不把 OIDC authority 或 Agent 私密材料复制到本包。

远端个人消息始终通过 Host 提供的 thread-targeted `agentExecution` 进入明确 thread，并
携带 durable `clientDirectiveId`。模型、workspace policy、工具、审批和审计仍由唯一的
AgentRuntime/Capability Broker 路径负责。普通手机身份不会生成桌面批准。Worker 的手动
接单、本地 journal、execution fence 与重启恢复继续由本包拥有，不形成第二条 Cloud
认证或 Task 执行路径。

本包还发布唯一的 main-only `sciforge.collaboration.coordinator-cloud-command@6.3.0`
internal service，仅授权 `sciforge.collaboration` 消费。其闭集包含 Plan/Offer、统一
HumanNeeded、TaskResult review、Project decision 与 final summary 命令；不包含 target User
`human.answer`，调用者也不能传入 Agent、route、header 或 credential。服务把命令绑定到当前
本机 Agent，并复用同一个 durable outbox 和 Identity Agent Cloud Runtime。它还提供唯一、
严格的 Coordinator Agent Inbox package-owner subscription：`project.started` 与
`coordinator_project` HumanAnswer
只投递给 Project Coordinator，`worker_execution` HumanAnswer 仍只进入 Worker adapter；没有
owner 时 Inbox 处理 fail closed，消息不会被静默 ACK。严格 Cloud revision/fence 错误会随该
outbox entry 持久化并幂等返回；同一调用可按 exact idempotency key 恢复原命令及其严格
response，且 consumer 必须在 failed entry 被重试前校验原命令仍匹配本次调用；该路径不派生
第二个写入或幂等域，非严格 upstream body 也不会写入 journal。

Task 派发的 canonical 路径是：Coordinator 只提交 `workerUserId`，Cloud 创建一个尚无
`executionId` 的 User-level Task Offer 并广播给该 User 所有有效已注册的 Device Agent；第一台成功
CAS claim 的 Device 才在同一 Cloud transaction 中生成不可变 Task Execution、绑定真实
User/Device/Agent 并准备 execution resources。`task.offer.claimed`/`task.offer.closed` 会关闭其他
Device 的本地候选。有效期内新注册的有效设备也通过同一持久 Inbox 收到 Offer。默认有效期为
24h，只允许 Coordinator 通过 `task.offer.extend` 显式延期；重连、投递或领取重试保留原截止时间。
Cloud 到期边界拒绝接受，已领取 Execution 不随原 Offer 到期取消。不存在第二条 Agent 直派、renderer revision 注入或 Device 全局 reject 路径。

Worker Session navigation ownership is read asynchronously through the single
`sciforge.collaboration.worker-session-projection@2.0.0` internal service. It opens
the same local journal used by the runtime, without waiting for network activation.
Fenced runs and runs whose Project is no longer visible retain their local Session
identities. These identities do not grant Project access; coordinator commands
still require an activated runtime and current authorization.

Worker Runtime turns share one execution-authority check before dispatch, including
manual retries and result-format repair. Member input uses only the standard
Session composer and Host queue/steer receipts. Each check refreshes
Cloud membership, execution fence, and resource readiness; a denied check fences
the local run, and an unavailable check prevents dispatch. A retry reuses the exact
Worker Session but creates a new, durable invocation only after authorization.

## Coordinator module

`@sciforge/domain-collaboration` is the independently installable
Desktop domain package for Project coordination HCI. Its backend contract and
renderer surface ship at one package version through separate `./main` and
`./renderer` entrypoints. The standard SciForge domain manifest is its only
composition declaration; the application Host does not contain a
Project-Coordinator feature switch.

Its renderer owns the single Collaboration Dashboard shell as a generic main-area
page. Requirements, Plan, Members, My Work and reviews are routes of that shell;
Coordinator and Worker responsibilities appear only as role-aware actions.
Independently installed domain packages add Drive or Settings sections only
through the generic `workbench.workspace-section` renderer-extension contract.
The shell never imports another domain renderer or maps domain IDs, and removing
a contributor removes only its declared section.

## Owned boundary and canonical workflow

The Collaboration package owns its Coordinator and Worker runtime, durable Inbox/outbox,
Project workspace, requirements completion, invitations, Task dispatch, Delivery review,
adoption and completion. Identity owns OIDC, Device enrollment, credentials and signing.
All Cloud operations use the existing authenticated transport and command service.

The Owner saves a requirements draft through the UI. The Coordinator completes its work
modules and acceptance criteria in the Project-bound Session. The Owner confirms the
exact document revision and digest through the UI. Explicit invitations use the same
membership port; only the invited User accepts after a confirmed requirements version
exists. Requirements dispatch activates an eligible Project and promotes its ready
modules through `task.offer.create`. A completed Task with an adopted Delivery unlocks
its dependents. Project completion pins the confirmed requirements version and every
adopted Task identity, with the existing Owner signature and transaction checks.

The seven legacy Plan/workflow capabilities and the Cloud Plan submit/confirm commands
are retired. Old clients receive an explicit unsupported-command error. Old local Plan
drafts and generation records are discarded by the single state projection while live
Coordinator bindings, create/delete intents and requirements completion attempts remain.
Confirmed Plan projects receive no startup or Inbox-driven continuation. Historical
Plans, receipts, Inbox payloads and Task lineage remain readable; migrations are unchanged.
No compatibility alias or forwarding write path exists.

Coordinator HumanAnswer still becomes one exact audited decision. Transfer feedback,
execution fences and validated Inbox ACK remain on the same runtime boundary. The Host
provides generic discovery instructions; the Collaboration composer describes the
requirements workflow and grants no authority. Agent requirements draft writing remains
unapproved (D3); requirements save/confirm are UI-only. The Agent capability set contains
16 operations; generated capability documentation is authoritative for their schemas.

Requirements completion retains the existing CAS recovery, bounded Runtime error reasons,
durable retry identity and Coordinator Session binding. A saved draft survives generation
failures. The canonical requirements port never creates a separate Plan generation
Session. Project creation names its Session `<Project display name> · 项目协调`.

### Cloud Session navigation ownership

Cloud Project sessions have exclusive navigation ownership derived from durable
Coordinator bindings and Worker execution journals. The navigation contribution
reads those opaque runtime/thread identities through the UI-only
`collaboration.session-ownership.read` capability, then publishes them through
the generic SDK context. This query uses only durable local bindings; it never
waits for Cloud reachability, sign-in, Project metadata, or permission checks.
The separate authorization projection remains authoritative for Project access. The
Host uses the same catalog for opening conversations, but excludes owned sessions
and their automatically derived empty workspace groups from Local Workspaces.
Explicitly added folders and ordinary local conversations sharing a folder remain
visible. Paths are not used to infer Project ownership.

Clicking a Project restores its last selected available Session, or its most
recent non-archived Session, falling back to archived history when only archived
Sessions remain. Sessions is an accessible accordion with a count, newest-first
history, and archived labels. Completed Projects keep their locally available
conversations; missing local history is explained explicitly rather than implying
that transcripts from other devices have been synchronized. A Project with no
available Session opens a navigation empty state without an unrelated conversation.
Session rows retain their titles
and selected state; the conversation header identifies the Project rather than
its internal execution directory. Pending activation acknowledgements can retry
without replaying navigation during a refresh.

Signed-out and fenced projections retain opaque local Session ownership without
revealing Project names. Transient projection failures retain exclusion claims;
they do not reclassify Sessions as local or grant permission to operate them.

Local Workspaces search filters only its own view. Unarchived sessions and archived
history are read with separate budgets through the same runtime listing API, so
archived Cloud history cannot evict ordinary unarchived conversations. An archive
read failure retains the previous archived catalog while current sessions refresh.

### 有界刷新

前台页面将 timer/focus 触发合并为单飞读取；选择新项目、操作后的显式重读、
页面失活及 30 秒超时会取消旧读取，迟到结果不能覆盖当前页面。取消信号沿现有
capability 和 Identity 请求路径传递。Dashboard 查询在同一刷新路径内最多并发
读取四个项目，全部通过当前权限与连接代际检查后按项目列表顺序原子发布。
WebSocket 通知会先触发该刷新，再处理 Inbox；定时查询用于恢复遗漏的通知。
Device 在线校验没有正向 TTL 缓存，仅复用 Identity 已有的在途校验。

受控 source 基准：`node --import tsx packages/domains/collaboration/scripts/sync-benchmark.mjs --baseline=<commit>`。
真实 source 应用的只读重放：`node scripts/measure-collaboration-sync.mjs --ports=<独立 source 调试端口> --output=artifacts/<结果>.json`。
重放器拒绝 A–E 演示端口及其他 worktree/打包应用。受控 HTTP 基准不等于真实云端或物理设备性能。
