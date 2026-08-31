# SciForge Collaboration 场景落地审计报告

**审计日期：** 2026-08-31（Asia/Shanghai）
**审计对象：** `test_colab` 分支、本地 SciForge Desktop、`cloud-test.sciforge.cn` 及附件中的两个产品场景
**审计范围：** Coordinator–Cloud–Worker 协作闭环；暂不启用 OpenContent
**报告状态：** 已按“实验设计评审（不执行实验）”重新收敛；无 Content 文本 MVP 已完成本地迭代，真实外部多设备 Cloud E2E 待配置验收环境

## 1. 先给结论

初版报告把“设计评审”和“实验执行/反馈循环”混在一起，现按你的定义纠正：本次目标是让 Coordinator 组织 4/5 个 Worker 分析设计子课题，收回带专家/资料归属的结论、依据和建议，再形成一份设计决策包；Worker 不执行实验、模拟或湿实验。

按这个范围，SciForge 的现有状态机**可以承载基础文本设计协作闭环**：`Project.goal → 独立 Task → Worker summary → Coordinator review → final summary`。本轮补充了设计分析提示、归属标记约定、Coordinator 设计包模板和 4/5 Worker HTTP 验收夹具。夹具会回读 `project.coordination.read`，核对每个 Result 的真实 `submittedByUserId/AgentId`，并检查两场景设计包栏目；它仍是协议/模板验收，不是 4/5 个真实 Desktop runtime 或真实科学结论的证明。

- **场景一（深海生物制造产业创新中心）：** 可作为 4 Worker 的纯文本设计评审。四个角色分别提交产业/能力、产品/市场、天然产物/药物、技术投资/伙伴风险子题，Coordinator 汇总首个落地任务、整体方案、指标、约束、风险、人工确认点和行动项。
- **场景二（蛋白设计方案）：** 可作为 5 Worker 的设计方案评审，不执行蛋白设计、模拟或实验。首个任务、结构/生信、Agent/ML、指标基准、风险治理分别由 Worker 提供设计输入；若纪要需要写“设计—模拟—实验—反馈—再设计”，只能写成拟议、未运行的验证流程。
- **当前真正的能力边界：** Worker 的报告和 Coordinator 的设计包仍是自由文本模板，不是机器可查询的 `sourceRefs/metrics/constraints/actions` 字段；Coordinator 的最终综合目前由人审阅后填写/提交。若要求 Coordinator Agent 自动综合，还需要增加一次 summary-draft runtime turn。
- **按你的最新范围明确延期：** 单设备多用户隔离、OpenContent、实验执行/模拟反馈轮次、领域执行器和执行阶段 biosafety gate 不作为本次设计评审 MVP 的验收门槛；它们保留在报告后半部分作为后续能力或执行阶段风险。

原始完整产品审计仍列出 P0/P1/P2 问题，但这些严重度是针对更宽的“自动通知、文件、执行和安全”产品目标；第 13 节的修正版才是本次设计-only MVP 的有效验收定义。

## 2. 版本更新结果

用户所写的 `upstrea/test_colab` 在本地没有名为 `upstream` 的远程；唯一远程是 `origin`。已将本地 `test_colab` 同步到远程 `origin/test_colab` 的最新提交：

| 项目 | 值 |
|---|---|
| 分支 | `test_colab` |
| HEAD / `origin/test_colab` | `91283b80f8253fe7f16b991b8bc9ce52eeb2bdd1` |
| 提交时间 | 2026-08-31 00:05:09 +08:00 |
| 提交说明 | `Merge pull request #120 from AGI4Sci/codex/fix-cloud-project-sidebar-refresh` |
| 远程一致性 | `git ls-remote` 与 HEAD 相同 |

同步前原工作分支上已有的 sidebar 本地改动已放入 `stash@{0}`（`pre-collaboration-audit-local-sidebar-change`），没有覆盖或删除。基线审计阶段没有修改产品源码；随后按第 13 节收敛范围加入了最小 MVP 提示、UI 和验收测试改动。

本地协作包版本（来自源码 `package.json`）：

| 包 | 本地版本 |
|---|---:|
| `@sciforge/collaboration-contracts` | 5.1.0 |
| `@sciforge/collaboration-server` | 0.7.0 |
| `@sciforge/collaboration-provider-zulip` | 0.2.6 |
| `@sciforge/domain-sdk` | 0.2.13 |
| `@sciforge/domain-collaboration` | 6.1.0 |

## 3. 审计边界、方法与证据可信度

### 3.1 遵守的资料边界

我只读取了：

1. 本地源码、测试源码、配置和运行日志；
2. 用户指定的唯一附件：`/Users/ares/Downloads/sciforge-multiplayer-meeting-requirements.zh-CN.md`；
3. 通过用户给出的 SSH 命令读取 Cloud 主机上的运行容器、部署文件、源码构建产物和日志。

没有把本地既有产品说明或架构文档作为判断依据；结论来自源码、测试、配置、运行日志和用户指定附件，也没有启用 OpenContent 作为测试依赖。

### 3.2 动态验证

- 通过 Computer Use 以真实用户路径打开源 Electron，检查 Identity、Collaboration Center、Projects、My tasks、Reviews、Files、Connections 和 Settings；按 Coordinator 视角观察项目/计划/审核，按 Worker 视角观察任务、邀请、队列和恢复。
- 使用两个独立的临时 profile 做隔离检查；没有复制认证 profile 来伪造第二个设备作为产品结论。已有测试账号的浏览器登录回调成功，未提交新的外部注册表单，也没有创建或删除 Cloud 业务数据。
- 通过 SSH 访问 `47.76.230.118`，对 Cloud 做只读容器、版本、Caddy 配置、日志和 HTTP/WebSocket smoke probe。
- 对本地 Zod schema 和 Cloud REST schema 做同一 payload 的差分验证，确认 acceptance driver 的错误不是静态类型猜测。

### 3.3 证据等级

- **代码级：** 源码中的 schema、权限检查、状态机和 UI 分支，属于可重复的确定性证据。
- **Cloud 运行级：** 当前健康检查和容器版本是采样时状态；历史 503 来自 Cloud 日志，说明切换过程存在风险，不代表此刻每个请求都失败。
- **UI 级：** Computer Use 观察到的页面是实际 profile 的缓存/当前连接组合，因此用于证明用户可见性和操作路径，不把某个旧项目状态当成 Cloud 全量事实。
- **测试级：** 现有单元测试大量使用 in-memory/fake provider；通过只说明测试路径成立，不能替代真实 OIDC、Postgres、Zulip、Desktop runtime 闭环。

## 4. 阻断清单（按优先级）

严重度含义：**P0** 会直接使闭环断开、越权或违反安全要求；**P1** 真实用户大概率无法稳定完成，但有人工/旁路绕过；**P2** 主要影响可发现性、诊断和长期运维。

**范围修正：** 下表是此前按“完整协作产品（含文件、执行、安全和自动通知）”做的基线清单。对当前“设计分析、不执行实验、无 Content、文本报告”的 MVP，P0-4（执行阶段 biosafety）、P0-5（执行反馈轮次）、P0-7（文件/Artifact）、P0-1（单设备隔离）以及多数本地运行健壮性项均不是本次功能失败；它们在第 13 节标为范围外或后续工作。当前验收只保留身份/Agent provisioning、Cloud 版本一致、成员/Offer 状态顺序、Worker 在线、报告可达和 Coordinator 可见/可追溯等门槛。

### P0 — 必须先修

| 编号 | 问题与证据 | 真实影响 | 修复方向 |
|---|---|---|---|
| P0-1（范围外） | **没有受支持的单机多用户身份/设备隔离。** `src/main/index.ts:804` 使用 Electron single-instance lock；`packages/domains/collaboration/src/main/store.ts:657-673` 在已有协作状态时拒绝切换 User；`settings-store.ts:131-136` 每个 profile 只有一个 installationId。Cloud `service.ts:1061-1071` 将 Agent 绑定到 User/Device，device enrollment 又按 installationId 全局匹配；OIDC callback 还固定在 `127.0.0.1:43110`。 | 第二个角色不能在同一安装中安全登录；复制 profile 会复用 installation/device key，引发 `Desktop Device authority changed`、`could not confirm this Desktop Device`，不能模拟真实 Worker。**本次已有多台设备，故不作为设计-only MVP 门槛。** | 若以后恢复单机测试，再提供显式多租户测试/角色模式或真正隔离的多实例。 |
| P0-2（当前为 UX） | **Worker 用户收件箱没有接入 Desktop。** `connection.ts:551-606` 只 pull/ack Agent inbox；`contracts/protocol.ts:446-585` 将 membership/plan/final-summary 放在 user inbox，`runtime.ts:80-106` 也不消费这些 payload。 | Coordinator 发出的邀请、计划确认、最终摘要不会自动唤醒 Worker 窗口；**设计-only MVP 可由 Worker 手动刷新 Projects/Cloud 收件箱完成接受，故不阻断协议闭环。** | 后续增加 user inbox 拉取、通知和 session 入口。 |
| P0-3（顺序门槛；手工流程可绕过） | **受邀 Worker 的项目权限与 offer hydration 存在断点。** `service.ts:5519-5524,5642-5655` 对非 active membership 限制 task/project 读取；Worker offer handler 会先 `project.get`（`runtime.ts:853-906`），失败后可能 fence/ack。Cloud 的正常策略是先让 User 接受邀请、再激活成员和创建 offer。 | 若在 active membership 前投递旧 offer，可能因 `permission_denied` 被确认后丢失；按本报告的手工顺序（先接受邀请、再 active、再发 offer）不阻断设计-only 闭环。 | 保持验收顺序并提供可重放 inbox；若以后要求 Coordinator 自动推进，再补 invited/pending read model 和端到端 permission 测试。 |
| P0-4（执行阶段范围外） | **S2 的生物安全人工闸门未被强制。** `entities.ts:448-518` 的 `HumanNeeded` 只有可选 `confirmableAction`；`task-adapter.ts:1887-1923` 和 `project-coordinator/ports.ts:1124-1142` 固定为 `null`；Server 仅在 action 非空时才执行 OIDC approve/reject（`service.ts:1800-1844`）。 | 本次 Worker 只做设计分析，不执行蛋白设计或实验；因此不把该执行阶段安全闸门当作当前设计评审失败。设计包仍需**文本列出**人工确认点。 | 若未来开放真实执行，再将安全等级、审批动作和批准凭证纳入服务端强制状态机。 |
| P0-5（范围外） | **S2 没有生产可调用的迭代轮次/反馈闭环。** `project-review.ts:84-151` 强制 DAG 无环；`continuation.ts:44-129` 只按依赖完成后一次性发 offer。 | 本次只要求在设计包中提出未来流程，不运行模拟、实验或反馈轮次；因此不影响 design-only MVP。 | 若以后要做执行/自进化，再增加 round/iteration 和 feedback/replan 契约。 |
| P0-6 | **Cloud 部署与本地协议/包版本存在漂移，且没有单一可验证的活动 app provenance。** 当前本地 contracts/server/provider 为 5.1.0/0.7.0/0.2.6；SSH 只读采样看到多套可见部署 bundle（例如 stage4-postmerge contracts/server/provider 4.1.0/0.5.0/0.2.4、public-v19/closed-loop 5.0.0/0.6.0/0.2.5），另有 app/edge commit 采样值 `331da062…` / `55806664…`。这些采样路径和活动实例不能证明来自同一契约。远端旧 `task.offer.create` 还要求 `assigneeAgentId` 与 `expectedAvailabilityRevision`，而本地 5.1.0 契约改为由 Cloud 按 `planItemId` 选在线 Worker。 | 本地 Desktop、acceptance driver 和 Cloud 对严格 schema、错误响应、投影消息的理解不一致；修复本地代码不能保证线上闭环，offer 可能在命令入口就被拒绝。 | 构建时锁定单一 commit/lockfile，edge、app、provider 原子切换并暴露同一 contract commit；启动时做兼容性握手，漂移直接阻断而不是静默运行。 |
| P0-7（范围外） | **暂不启用 OpenContent 时，文件/Artifact 任务没有可用后端。** `task-adapter.ts:844-965` 对 fileIntent 要求 Content Space provider。 | 本次明确只返回文本设计报告，不产生文件或 Artifact；只要逐项保持 `fileIntent: null`，不影响设计-only MVP。 | 若以后需要图表、序列、输入文件或证据包，再引入明确的 Content/text provider。 |
| P0-8（自动化范围外） | **Cloud 发出的部分 Agent 事件在 Desktop router 中被静默 ACK。** 本地 `protocol.ts:446-539` 接受多类事件，但 `runtime.ts:80-106,184-235` 只分类少数事件，未知事件没有 default 处理，`connection.ts:573-605` 仍会 ack。 | 手工 Coordinator 可以直接生成/确认 Plan、按顺序激活、审核和提交 final summary，因此不阻断当前设计-only命令链；若要求完全自动的 Coordinator Agent，则 membership/结果事件不会自动触发下一轮工作。 | 本轮保留为自动化后续；未来需为事件建立显式 handler、幂等和重放策略，或由外部 Coordinator orchestrator 驱动。 |

### P1 — 真实外部验收前置与设计-only 已知限制

| 编号 | 问题与证据 | 影响 |
|---|---|---|
| P1-1（文本限制，不阻断） | **协作计划没有独立的 role/domain 字段。** `project-review.ts:40-76` 的 Task 只有 title/objective/completionCriteria/deps/capabilityTags/fileIntent；角色和子议题需写入 title/objective。 | 当前 4/5 Task 可以按文本约定完成分工；系统不能机器查询角色覆盖率、负责人/截止时间。若要结构化查询再扩 schema，不是本次闭环门槛。 |
| P1-2（文本限制，不阻断） | **Worker runtime 能力标签是通用的，且任务 capability 必须是 readiness 标签子集。** `src/main/domain-agent-execution.ts:21-47` 发布的是 `agent-runtime.<runtime>`/`model-access.<mode>`，没有领域能力目录。 | 设计-only MVP 使用 `requiredCapabilityTags: []`，验证的是报告路由而非专家资质；领域能力路由属于后续增强。 |
| P1-3（文本限制，不阻断） | **结果与会议纪要不是结构化字段。** `TaskResultSubmission` 保存提交 User/Agent、runtime provenance、Task/Result ID，但正文只有 `summary`；final summary 也是自由文本 + accepted IDs。 | `[expert:*]`/`[source:*]`、指标、约束、风险和行动项可以写入文本并由 Coordinator 人工复核，不能被服务端自动校验；这不阻断本次设计包交付。 |
| P1-4 | **计划确认要求每个 item 先有 Worker assignment，邀请又依赖确认后的计划。** `ports.ts:747-775` 和 `service.ts:4367-4512` 强制 assignment；`service.ts:2626-2864` 的 membership/invite 状态又要求后续接受。 | 新用户还没进项目时，Coordinator 不能自然地“先邀请、再共同规划”；临时顺序容易造成 pending/active 权限断点。 |
| P1-5 | **offer 是短 TTL、手动领取、无可靠重试。** `service.ts:2457-2526` 要求 exact active Agent/device/heartbeat，TTL 约 90 秒；`task-adapter.ts:793-842` 默认 manual policy；自动 preflight 失败不重试（测试 `task-adapter.test.ts:597-620`）。 | 登录、模型启动或 heartbeat 延迟时可能过期；Worker 需要在页面手动接受 offer。设计-only MVP 可按顺序操作并延长/刷新 offer。 |
| P1-6 | **runtime readiness 是假阳性。** `domain-agent-execution.ts:35-63` 主要依据 policy/runtime allowed 标记 ready；实际 Codex service（`src/main/runtime/codex/codex-service.ts:1598-1648`）还要求 managed ChatGPT account。实测新 profile 日志出现 “Model access setup is required”；Plan Gateway 还出现 3893 EADDRINUSE。 | UI 可能显示 Runtime Ready/Agent Online，Coordinator 因此投递任务，但 Worker 执行才发现没有模型或端口服务。 |
| P1-7（本轮不适用） | **双 profile 默认共享本地工作区和运行时。** `settings-store.ts:64,86-105,185-202` 默认 workspace、Codex home、auth 和 MCP 配置存在固定路径。 | 只影响单机多用户模拟；本需求使用多台设备，故不作为设计-only MVP 门槛。 |
| P1-8（本轮不适用） | **本地服务端口固定或默认碰撞。** Plan Gateway/Model Router 有固定默认端口。 | 只影响单机并发 profile；多设备验收不受此项直接阻断。 |
| P1-9（已修正，待线上验证） | **旧 acceptance driver 曾与严格 schema 不匹配。** 本轮已补 `agentId`、`createIntentId`、`item_*`/`workerUserId`、移除多余 `workerUserId`，并使用 Coordinator Agent review token。 | 本地 driver 的旧形状不再是当前代码故障；仍需在对齐版本的 Cloud 上运行一次真实配置验收。 |
| P1-10 | **产品和 driver 都没有从零注册/设备/Agent provisioning。** `IdentityAccountOverlay` 创建的只是 display-only local account；`CloudIdentitySection` 没有 Cloud sign-up，driver 依赖预先设置的 USER_ID/DEVICE_ID/OIDC 环境变量。Cloud 只有 OIDC 首次解析的 JIT user，无 production impersonation/mock API；已有 Agent 的 ensure 分支也不一定返回 driver 期待的 sealedCredential。 | 真实外部验收环境必须预先准备 Coordinator 与 4/5 个 Worker 的 User/Device/Agent；这不是多设备协议缺陷，但目前没有从零可重复的 provisioning 入口。 |
| P1-11（本轮不适用） | **浏览器/Portal 传输路径不完整。** HTTP CORS 和原生浏览器 WebSocket 认证仍有限制。 | 本轮验收使用 Electron/Node HTTP transport 和 Cloud Agent inbox，不要求 Web/Mobile Worker。 |
| P1-12 | **Cloud 曾发生可重复的切换期 503。** edge 日志 47 次 503，集中在 `/v1/me`、`/v1/me/devices`、`/v1/commands`、`/v1/events`，每次约 5.0 s；原因为动态 upstream DNS `no such host` / `no upstreams available`。当前 `/healthz`、`/readyz` 为 200，但这只能证明采样时恢复。 | 登录、设备确认、offer/result 提交会在切换窗口整体中断；客户端没有把“部署切换”与业务失败区分开。 |
| P1-13 | **状态读取和权限反馈不一致。** CollaborationPanel 每 3 秒只轮询 tasks，connection/projects/participants 错误被吞掉；ProjectCoordinatorPanel 另有独立 `readWorkspace`。实测同名项目在 Coordinator 视图显示 Completed/revision 11，而 My tasks 显示 Paused/revision 5/no tasks；Connections 仍显示 disconnected。 | 用户无法判断哪个状态可信，重复点击/重试可能制造重复 command 或错误恢复。 |
| P1-14（分析上下文限制） | **Worker prompt 只注入当前 Task。** `task-adapter.ts:1294-1323` 传入 title/objective/completionCriteria/fileIntent，不自动注入 Project goal、附件或其他 Worker 结果。 | 设计-only MVP 必须把必要 brief、角色、子问题和 `[source:*]` 标签写入每个 objective/criteria；跨专家共享上下文属于后续增强。 |
| P1-15 | **远端 Agent policy 控件可操作但必失败。** `CollaborationPanel.tsx:1433-1446` 为 otherAgents 显示 enabled policy select，回调会发送任意 agentId；后端 `runtime.ts:761-769` 只允许 exact localAgentId。 | Coordinator 会看到一个看似可用的远端策略编辑器，点击后必然报错；角色权限和操作边界不可信。 |
| P1-16 | **关键变更没有跨 pane invalidation。** `project-coordinator-capability-client.ts:295-301` 的 workspace invalidation 只被少数 create/delete/ack/reassign/recovery 使用；plan edit/submit/confirm、membership add/accept/remove、human answer、review/complete 不 publish，其他 pane 依赖 15–30 秒轮询。 | 邀请、offer、审核和完成状态在侧栏/导航/主面板长时间不一致，用户会重复提交或以旧状态作决定。 |
| P1-17（本轮不适用） | **OIDC 并发登录回调固定且 Cloud 身份可见性不足。** `identity-access/main/oidc-service.ts:20,314-382` 固定回调端口。 | 只影响同机并发登录；本轮使用多台设备和已配置身份。 |
| P1-18（执行阶段范围外） | **没有场景所需的专业执行器/工具边界。** 当前 collaboration 任务没有真实结构预测、模拟、实验或 biosafety executor。 | 本轮只验收设计分析报告；领域工具和执行器属于后续产品，不影响文本设计评审。 |
| P1-19（执行阶段范围外） | **没有公共 coordination round/feedback API。** | 本轮只做一次 4/5 子课题设计汇总，不要求 round/replan；若未来做自进化执行再补。 |
| P1-20（既有 profile 恢复范围外） | **持久化的 malformed Project DAG outbox 可以阻断启动。** `handoff-outbox.ts:403-406` 对版本仍为当前值但字段缺失的记录直接抛错，启动捕获后弹出 `Project DAG handoff outbox has an unsupported schema`。 | 可能影响已有坏 profile，但不属于本轮新建纯文本设计报告链路；若遇到应先清理/换用干净 profile。 |
| P1-21（Topic/Session 后续能力） | **协作 Topic/Projection 默认只允许创建者发言，分享能力未接到 UI。** `collaboration/src/main/runtime.ts:508-519` 固定 `allowedSenderUserIds: [user.userId]`；虽然 runtime/client 有 `shareProjection`，`CollaborationPanel` 没有成员 allowlist 或分享动作。 | 影响共享讨论会话，但本轮 Coordinator↔Worker 只通过 Cloud Project/Task/Result 报告协作，不需要共享 Topic；不阻断设计报告链路。 |
| P1-22 | **Collaboration 与 Project Coordinator 是两个未联动的 UI 入口。** 两个 domain manifest 分别只暴露 My Work/Connections 与 Project/right panel/topbar；没有 TaskRow→Project/Session 或 Coordinator task→Worker offer/session 的跳转。 | 用户必须手动切换页面和 session，容易在“已派发但未领取”“结果已提交但未审核”时迷路；一台设备扮演两种角色时尤其明显。 |
| P1-23 | **无 Content 模式没有在生成契约层硬锁 `fileIntent: null`。** `ports.ts:325-374,577` 只用提示要求模型在没有输入/Artifact 时返回 `null`；模型若生成“只输出文件”的非空声明，后续 `initialTeam.mode='none'` 会在确认时转入 Content-required 分支并等待 OpenContent。 | 文本 MVP 可能在计划确认阶段才被拦住；验收前必须逐项检查并清除非空 `fileIntent`。后续若要完全确定性，应增加显式 `textOnly` 输入并让输出 schema 强制 `null`，不能按空输入列表隐式改变合法 file-mode。 |

### P2 — 不修会显著降低可用性/诊断效率

1. **Worker 看不到足够的任务上下文。** `CollaborationPanel.tsx:1883-1947` 的 TaskRow 只有标题、状态、assignee、revision、preflight 和 Claim/Reject/Dismiss；底层的 objective、completionCriteria、fileIntent、outputs、expiresAt 没有展示。用户无法在知情基础上接受任务。
2. **操作语义危险。** Reject 是全局状态变更，Dismiss 只是本地隐藏，但 UI 没有确认对话框、理由或到期倒计时；3 秒轮询没有 aria-live/toast。
3. **邀请不可发现。** attention summary 不计用户邀请；邀请卡只在 Projects 视图、特定 `invited + current user + confirmed plan` 条件下显示；没有用户搜索、批量邀请、重发/取消，添加成员只能输入精确 opaque User ID。
3a. **多个 Worker 同时接受邀请会遇到 Project revision CAS。** `acceptProjectMembership` 每次成功都会推进 Project revision；并行点击会让后续请求收到 `revision_conflict`，当前 UI 没有自动重读/重试。最小验收应串行接受，失败后刷新再试。
4. **权限 UI 与后端不一致。** 普通 Worker 仍看到 New Project、Generate/Save/Submit Plan 等 Coordinator 控件（`ProjectCoordinatorPanel.tsx:1160-1380,2290-2536`），点击后才被后端拒绝，且没有清楚的原因。
5. **恢复中心不可诊断。** 9 条以上 `invalid JSON response`、`Device authority changed`、`could not confirm` 会堆在队列；每条只有通用 Recover，没有按 task 重试、清理、详情、Identity 跳转。projection failure 还会错误地调用 connection retry。
6. **无 session 时 Worker 无法进入 Collaboration。** `collaboration/index.tsx:68-84` 和 `project-coordinator/index.tsx:125-145` 要求 `sessionId`；Workbench 没有 active thread 时不注入导航。Cloud offer 不会自动创建/打开 Worker side session。
7. **连接设置难以自救。** Cloud URL 没有 HTTPS/环境说明；pairing 在没有 verified phone endpoint 时只是 disabled，没有解释下一步；已有 revoked/suspended endpoint 没有 re-pair/add/primary/revoke。
8. **跨页面身份/项目标识不充分。** 以 displayName 而非 projectId 为主，重复项目或跨用户时很难确认对象；侧栏在 disconnected 时清空项目但仍启用 New Project。
8a. **角色和待办摘要不完整。** Project Coordinator 面板不显示当前 User 的 coordinator/worker/read-only access；AttentionDeck 只统计 plan/human/result/revision/recovery，遗漏 invitation、pending offer 和 execution waiting，可能显示“No blocking decision”而 Worker 实际有待处理任务。
9. **审核表单有绕过必填提示的路径。** Accept 使用 `formNoValidate`，即使 instruction/next-worker 的说明字段未填写也可能提交；Worker 看到 review 只是 waiting，不知道原因或预计时间。
10. **人审 UI 依赖精确 active Session。** 只有 exact active binding + current user 才能回答 human-needed；否则静默只读，没有把待审批任务导向可用 session。
11. **窄屏可读性差。** `ProjectCoordinatorPanel.css:19-28,1843-1897` 的最小宽度和 6.5–10px 字号，在单台笔记本窗口并排模拟两个角色时尤其难以阅读。
12. **共享/个人语义冲突。** `collaboration-messages.ts` 和 Sessions UI 仍以 “Personal Sessions/Share current” 为中心，没有创建团队 session、转交、关闭、恢复、命名或角色标识。
13. **新 Topic 路径未接线。** 合同支持 `projection link mode='new'`，但 `CollaborationPanel.tsx:762-790` 只渲染“绑定当前 Session”；第一次协作或没有既有 Topic 的用户没有创建入口。
14. **Locator 安全过滤可疑。** `CollaborationPanel.tsx:112-118` 在存在 human endpoint 时会忽略 managed-container 过滤，可能展示未 attested 或跨用户 Topic；需要在服务端和 UI 双重约束。
15. **状态文本未完整本地化。** `CollaborationPanel.tsx:2057-2086` 只映射少数状态，其余 `awaiting-manual`、`needs-human`、`claimed-elsewhere`、`fenced` 等直接显示 kebab-case 英文，无法给出下一步。
16. **接受邀请后不创建/打开 Worker session。** `ProjectCoordinatorPanel.tsx:1098-1100` 只更新 membership；`session-binding.ts:6-17` 要求已有 runtime/thread binding。Worker 即使接受邀请，也可能在 HumanNeeded/Review 页面停留只读状态。
17. **当前测试与产品目标互相矛盾。** `CollaborationPanel.test.tsx:244-370` 明确断言 personal-only、没有 sharing/rename/relink/restore 控件，另一些用例又期待跨 Session relink；测试对“团队协作”没有单一规范。
18. **handoff 与团队角色不匹配。** `service.ts:2242-2244`/`project-coordinator/src/ports.ts:1057-1075` 的 successor 只允许 Owner 自己的 Agent；六用户 driver 期望转给另一 User，生产服务会拒绝，脚本把拒绝当成成功，掩盖了需求缺口。
19. **单个全局 busy 状态阻塞并行协作。** `CollaborationPanel.tsx:364-384,682-705,856-877` 用一个 `busyKey` 禁用所有任务、端点和恢复控件；五个 Worker 同时回报或需要安全处理时只能串行操作。
20. **提交成功但刷新失败会被显示成操作失败。** `CollaborationPanel.tsx:364-386` 把 mutation 和后续 refresh 放进同一个 catch；用户无法区分“已写入、状态未知”和“未写入”，容易重复接受/配对。
21. **Worker 看不到结果是否已提交。** completed/failed TaskRow 只显示状态/error，`runtime.ts:1102-1127` 的 task view 不返回 result summary、submission、outputs 或 Cloud receipt/revision；Worker 无法确认 Coordinator 是否收到或需要修订。
22. **派发阶段会把“已发布 offer”误标为完成。** `ProjectCoordinatorPanel.tsx:324-389` 仅以 task 不再是 planned 判定 dispatched，未领取 offer 不计入 execution/attention；Coordinator 看不到“等待 Worker 接受”这一关键阻塞。
23. **没有邀请/offer 的主动通知。** Collaboration 只每 3 秒轮询 tasks，Coordinator 视图约 15–30 秒轮询，没有 desktop notification、toast 或 activation event；Worker 必须主动打开 My Work 才可能看到 offer。
24. **刷新响应可能把用户切到另一个项目。** `ProjectCoordinatorPanel.tsx:684-688,1029-1033` 在 mutation 返回 `focusedProjectId` 时会无条件 `selectProjectId`；用户在项目 A 做邀请/审核后，界面可能跳到项目 B，看起来像操作消失。
25. **没有 UI 级真实闭环测试。** `project-coordinator/src/renderer/index.test.tsx:1454-1508,1724-1789` 直接注入 invitation/session fixture；没有覆盖“创建→Cloud offer→Worker 接收/运行→提交→Coordinator 审核”的端到端 UI 流程。

## 5. 两个场景逐项验收（按“设计分析、不执行实验”定义）

### 5.1 场景一：深海生物制造产业创新中心

本场景的最小目标是：Coordinator 组织 4 个 Worker，各自完成一个明确子课题；每个 Worker 返回带专家/资料归属的结论、依据和建议；Coordinator 再汇总成设计决策包。这里的“会议纪要”就是最终设计包的文本交付，不要求 Worker 执行产业行动或实验。

| 需求 | 当前能否做 | 具体边界 |
|---|---|---|
| 建 Project、写主题/最终问题、提交 4 个 Task | **可做（需人工核对）** | `Project.goal`、Task `title/objective/completionCriteria` 足以承载文本设计题；需要已 provision 的身份、在线 Worker、串行 revision。当前 schema 不强制“恰好 4 个”或每个 Worker 唯一，Coordinator 在提交前必须核对。 |
| 四个 Worker 各自承担一个明确职责 | **可做（文本层）** | role/子议题写入 Task 标题和 objective，并在后续 `workerUserId` 绑定；当前没有独立 role/domain 字段，不能做机器级角色查询。 |
| Worker 分析并返回结论、依据、建议 | **可做（文本层）** | 无文件任务使用 `fileIntent: null`；Worker summary 约定 `Expert/Role`、`Conclusion`、`Evidence or basis`、`Recommendation`，Cloud 同时记录提交者、Task、Execution、Result ID。来源标签是文本约定，当前不读取或校验 Content locator；若要求专家打开附件并逐条引用，必须把相关摘要/事实手工写入 Task objective/criteria，不能把标签当作真实 citation。 |
| Coordinator 审阅每位专家并形成整体方案 | **可做（协议已验证，UI 人审未完成）** | 现有 `project.coordination.read` 可拉取全部 result submissions，`task.result.review` 可逐项接受；本轮文本夹具通过 Cloud HTTP 读取/整合并提交 final summary，未完成真实 Desktop 人审 E2E。Agent turn 具备读取/提交合约但没有自动触发；UI 最终提交仍是人工 textarea。 |
| 交付首个落地任务、指标、硬约束、风险/人工确认、行动项 | **可做（最终 summary 文本）** | 这些字段放在 Coordinator 的 final summary 模板中，保留 `[expert:*]`、`[source:*]`、Task/Result ID；不是独立可查询字段，也不做服务端结构化校验。 |
| 不使用 OpenContent 完成这条链路 | **可做** | 所有 Task 保持 `fileIntent: null`、`requiredCapabilityTags: []`；不产生文件或 Artifact。 |

**场景一结论：** 对“设计评审包”这个目标，SciForge 在协议层可以承载基础文本闭环；本轮夹具只覆盖通用设计包栏目和场景文本占位项，附件专属内容/事实未逐项验收，不证明资料引用已经机器验证，也不证明任何产业或实验结论为实测事实。

### 5.2 场景二：蛋白设计方案评审

本场景当前只取附件中与“设计方案”有关的部分：Coordinator 组织 5 个 Worker，分别分析首个任务、结构/生信、Agent/ML、指标/基准、风险治理/人工确认，并返回一份设计提案。可以在纪要中描述“设计—模拟—实验—反馈—再设计”的拟议验证流程，但不运行模拟、实验或反馈轮次。

| 需求 | 当前能否做 | 具体边界 |
|---|---|---|
| 明确首个蛋白工程 Agent 任务和 1–2 个 pilot 设计 | **契约可承载（文本层）** | 可写入 Project goal、Task objective 和 Coordinator final summary；本轮夹具仅检查场景文本占位描述，未断言两个候选任务或选择理由，也没有独立 target/constraint 数据实体。 |
| 五类 Worker 分工并各自回报 | **可做（需人工核对）** | 5 个独立 Task、5 个不同 Worker User、每个 Task 一个子问题；role/domain 仍靠标题、objective 和 summary 标记。当前 schema 不强制任务数或 Worker 唯一，提交前需由 Coordinator 核对。 |
| 形成整体设计、量化指标/阈值/基准、硬约束、风险和人工确认点 | **可做（Coordinator 汇总）** | 由最终 summary 按固定标题记录；指标是“拟定目标与测量方法”，不得写成已测结果。 |
| 追溯每条关键结论的专家和资料 | **部分可做** | `[expert:*]`、`[source:*]` 加上 Worker/Task/Result ID 可在文本和 Cloud 记录中追溯；没有 citations/sourceRefs 的机器字段，Worker 也不会自动读取附件。必要的附件摘要/事实必须放进 Task objective/criteria 并由 Coordinator 人工核对。 |
| 提出未来的设计→模拟→实验→反馈→再设计流程 | **可做（文本层，需标 proposed/未运行）** | Coordinator 写明每一步的设计意图、输入/输出和确认门；这是一项方案设计，不是本轮执行。 |
| 实际运行模拟、实验或反馈轮次 | **范围外 / 本轮不验收** | 当前只验收一次 `offer → report → review → final summary`，不把真实 round API 或实验执行当作本次门槛。 |
| 生物安全执行审批 | **本次不要求** | 设计包必须文字列出人工确认点，但本轮不生成、提交或执行任何实验/序列/模拟副作用；真正执行阶段仍需另行安全闸门。 |

**场景二结论：** 可以做“单轮、无副作用的蛋白设计方案评审”；这验证的是设计提案的协作载荷和回报路径，不能把它表述为蛋白设计执行能力、实验结果或自进化闭环。

## 6. 设计评审闭环与当前主要断点

```text
Project 主题/最终问题/约束（纯文本 brief）
  └─> Coordinator 生成并人工核对 4/5 个带角色+子问题的 Task
       └─> Cloud 确认 Plan、成员按顺序接受 invitation、Project active
            └─> Coordinator 创建 offer（fileIntent=null、无业务 capability tag）
                 └─> Worker 接受 offer → 只做 design analysis
                      └─> Worker summary：专家/子问题 → 结论 → [expert]/[source] 依据 → 建议
                           └─> Cloud 保存 summary + submittedByUser/Agent + Task/Result IDs
                                └─> Coordinator 读取全部 reports，逐项 review/accept
                                     └─> Coordinator final_summary：
                                          首个 Agent 任务 / 整体方案 / 量化指标
                                          硬约束 / 风险与人工确认 / 下一步行动项
```

按当前最小协议夹具，这条设计链路的主要前置门槛是：Cloud 与本地 schema 版本必须一致（P0-6）、Coordinator/Worker 身份和 Agent 必须已 provision 且在线、Coordinator 在提交 Plan 前人工核对 4/5 个任务及唯一 Worker 分工、membership/offer/revision 必须按顺序完成、每个 Task 必须是纯文本、Coordinator 必须能读取并接受全部报告。User inbox 自动通知、结构化来源字段、自动综合、OpenContent 和执行阶段安全/轮次都不是这条最小链路的必要条件；真实多设备验收还要在外部 Cloud 上复核这些门槛。

## 7. Cloud 与协议实证

### 7.1 当前健康状态

只读 probe 结果：

| 请求 | 结果 |
|---|---|
| `GET https://cloud-test.sciforge.cn/healthz` | 200 `{"ok":true}` |
| `GET https://cloud-test.sciforge.cn/readyz` | 200 `{"ok":true}` |
| 未认证 `GET /v1/me` | 401 `authentication_required`（预期） |
| 未认证 WebSocket `/v1/events` | 401（预期） |

当前 edge header 是 revision `5580666432da02bb18c1ff77af0162c8ef20957f`；SSH 进入的实际 private app 使用的 contract commit 是 `331da06248be7afe84e2c8118043e5a279615dba`。这两个值不一致，不能把 edge 健康当作应用契约一致的证明。

### 7.2 历史切换故障

Cloud edge 过去 48 小时日志中有 47 个 503：

- `/v1/me` 33 次；`/v1/me/devices` 8 次；`/v1/commands` 4 次；`/v1/events` 2 次；
- 每次约 5.016 秒；
- Caddy 报 `lookup sciforge-stage4-postmerge-55806664 ... no such host`、`no upstreams available`。

当前已恢复，但部署 cutover 仍缺少原子 DNS/upstream 交换和客户端可理解的维护状态。

### 7.3 严格 schema 差分

同一组错误 payload 在 Cloud 的结果：

1. `endpoint.locator.list` 不带 `agentId` → 400 validation error；加上后才进入认证层（401）。
2. `project.create` 不带 `createIntentId` → 400；补上后进入认证层。
3. `task.offer.create` 带多余 `workerUserId` → 400；去掉后进入认证层。

旧版 acceptance driver 曾使用这三种旧形状，故当时失败是确定的生产接口不匹配，不是账号或网络偶发错误；本轮已修正 driver，本地 schema 差分为 fixed PASS，仍需在版本对齐的 Cloud 上线上验证。Cloud 还要求投影进度消息携带 `assistant_progress/final localTurnId` 和 `presentation`，本地 outbox 当前没有相同字段；大型请求还受 Caddy 64 KB body 上限约束，而本地契约允许更大内容。

### 7.4 Cloud 后端已有的正向证据（边界要说清）

SSH 只读检查还发现 Cloud 数据库中有两条**审计前已存在**的 content-free mock 闭环记录：一条 Coordinator-facing、一条 Worker-facing。两条都包含 2 个 active members、confirmed plan、1 个 task/offer/execution/result/review/final summary；对应的 Agent inbox 与 User inbox 也持久化了 invitation、plan confirmation、offer、result 和 final summary 消息。另有一个 `content_mode=none` 的中文会议纪要任务已完成。

这证明 **Cloud 服务端的基本状态转换在预置身份和直接 Cloud 操作下是可行的**，本报告并不是说所有 server transition 都不存在。它不能证明以下三件事：

1. 当前本地 Desktop 能从零注册、隔离并同时承载多个用户；
2. Worker 用户能在真实 UI 中自动消费 User inbox、创建/选择 session 并完成 offer；
3. `[source:*]` 文本标签已经被服务端验证，或 Coordinator 已自动完成综合。

因此正向记录应作为 Cloud state-machine 的基线回归夹具，而不是两个产品场景的通过证明；报告没有创建、删除或改写这些记录。

## 8. Computer Use 的用户体验记录

以下是按真实操作路径观察到的结果，不是只读源码推断：

1. **Identity：** 可看到本地多个 local account，但 Cloud 连接是单一当前身份；切换 local account 不会完成 OIDC logout、设备重绑或数据隔离。界面还明确提示本地账号不隔离设置、聊天、API/tool data。
2. **Coordinator Center：** 页面可显示 `Live / Cloud Ready / Runtime Ready / Agent Online / Shared files Ready`，但 Connections 页面同时显示 `Cloud connection disconnected`；这是两套缓存造成的信任问题。
3. **项目与任务：** Coordinator 视图看到一个 Completed、revision 11 的项目和 accepted results；My tasks 对同名项目显示 Paused、revision 5、No Tasks。页面主要显示 display name，没有 projectId，用户很难确认是否是同一个实体。
4. **Worker 队列：** 看到了 `provider_not_ready`、`invalid JSON response`、`Desktop Device authority changed` 等历史错误；恢复入口只有泛化的 Recover，没有详情、按任务重试、清理或跳到身份设置。
5. **邀请：** 没有侧栏 badge/toast；必须手动进入 Projects，且只有特定 membership/plan 状态才出现 Accept invitation。
6. **任务接受：** TaskRow 没有 objective、完成标准、输入输出、过期时间；Claim/Reject/Dismiss 的影响范围和理由要求不清楚。
7. **Files：** Content source 选择器只有 OpenContent；在明确不启用 OpenContent 的条件下，文件结果和 Artifact 验收没有可用选项。
8. **新 Worker：** 没有 active session 时 Collaboration 导航不会注入；Cloud offer 不会自动打开或创建可工作的 session。
9. **连接/配对：** 没有 verified phone endpoint 时 Start pairing 是灰色，但没有解释如何获得 endpoint；重复/失效 endpoint 没有管理动作。
10. **启动恢复：** 在已有临时 profile 中可复现 `SciForge failed to start … Project DAG handoff outbox has an unsupported schema` 模态框；坏的 v3 outbox 记录没有用户可用的 quarantine/跳过入口，协作页面甚至无法打开。
11. **注册测试：** 浏览器注册页可打开并填写，但本次没有提交新的外部账号；使用了已有测试身份验证 Cloud 读路径，避免向测试 Cloud 留下未经确认的账号/业务数据。用户提供的设备钥匙串密码未被调用、未写入报告、未传给 Cloud。

## 9. 测试结果与证据边界

### 9.1 通过的检查

- `npm run build`：通过（仅有 h264 externalization warning）。
- `npm run collaboration:typecheck`：通过。
- `npm run collaboration:test`：通过：contracts 126、provider 45、server 186（15 skipped）、domain-collaboration 154、canonical scripts 34（含 4/5 Worker 文本 MVP 和 Worker runtime 集成验收）。
- `node --import tsx --test scripts/collaboration-worker-runtime-mvp.test.mjs`：1/1 通过；实际经过 `CollaborationConnection inbox.pull/ACK → CollaborationTaskAdapter → strict Worker JSON → DurableCloudOutbox → HTTP Cloud`，并观察到 Cloud `result_submitted` 与 Coordinator Agent inbox 通知。
- `node --import tsx --test scripts/collaboration-zulip-acceptance-driver.test.mjs scripts/collaboration-zulip-six-user-e2e.test.mjs`：3 pass、1 skip（真实外部链路默认跳过）。
- Cloud health/ready/auth boundary smoke：通过预期状态。

### 9.2 失败或未覆盖的检查

- 开启真实六用户 E2E：先因 driver 未指向 production acceptance adapter，修正后因 `ACCEPTANCE_CONFIGURATION_MISSING` 失败；说明从零 provisioning 和真实环境配置尚未形成可重复入口。
- 现有六用户测试默认 skip 真实外部 Cloud；in-memory/fake provider 不模拟 OIDC、Postgres、Zulip、device heartbeat、permission denial、固定端口或 UI session。
- `runtime-projection-routing` 的 worker hydration 测试 helper 对 `project.get` 无条件返回 fixture，不能发现生产中的 invited membership 403。
- 新增 Worker runtime 集成测试仍使用本地 fake Cloud 和 fake Agent Runtime；它实际经过了 `CollaborationConnection` 的 inbox pull/ACK，但没有启动完整 Electron notification loop、真实 Codex runtime 或远端 Cloud，也没有覆盖 4/5 个 Worker 同时运行。因此 4/5 Worker 测试中的平台文本分析 runtime/result 提交仍是直接 HTTP command，不能替代真实多设备 E2E。

### 9.3 本地 schema 复现摘要

动态调用当前 Zod schema 得到：

```text
endpoint.locator.list driver FAIL: agentId missing       fixed PASS
project.create driver FAIL: createIntentId missing      fixed PASS
plan.submit driver FAIL: item_* / workerUserId invalid  fixed PASS
offer.create driver FAIL: workerUserId unrecognized     fixed PASS
```

因此“单元测试全绿”与“两个产品场景真实闭环”之间存在明确的测试层级鸿沟。

**报告回传的协议语义：** `task.result.submitted` 的 Agent inbox 通知只携带 Project/Task/Execution/Result 的标识和 revision，不携带完整的报告正文；Coordinator 收到通知后必须再调用 `project.coordination.read` 读取 `result_submissions.summary`，再逐项审核。`project.final_summary.created` 给成员的通知同样主要是 Project/Record 标识，Worker 需要再读取 coordination projection 才能拿到纪要正文。这是当前“通知 + 读取”两步闭环，不是正文丢失；若产品要求通知本身直接带全文，才需要另行扩展协议。

## 10. 最小闭环的绝对必要工作与验收门槛

下面只列你当前要求的“设计分析→报告回传→Coordinator 汇总”，不把单机隔离、文件、实验执行、模拟反馈或执行期安全工作混进必做项。

### 10.1 需要完成的 5 个步骤

1. **对齐 Cloud 与本地版本。** Edge、Cloud app、contracts、provider 必须锁定同一兼容 release/schema，并能追溯到一致的构建 provenance；不要求字面上每个部署组件 commit 相同，但不能存在未声明的 schema 漂移，否则本地测试通过也不能作为线上闭环证据（当前版本漂移见 P0-6）。
2. **准备参与者。** Cloud 中准备 1 个 Coordinator User/Agent 和 4 个（场景一）或 5 个（场景二）不同 Worker User/Agent/Device，并让每个 Worker 的 Agent heartbeat、availability 和 runtime readiness 都有效。
3. **建立纯文本计划。** Coordinator 创建 Project，写入主题、最终问题和硬约束；多专家 design-review 请求生成 3–5 个（不超过 5 个）独立 Task，并在提交前人工核对任务数量、角色覆盖和每个 Worker 唯一分工（当前 schema 只承载这些文本/assignment，不强制这些约束）。Coordinator 生成提示现在明确要求“明确列出的 Worker role 恰好一角色一 Task”，并禁止为交付物、指标、风险、行动、阶段或报告章节另建 Task；没有明确角色时只生成一个有界 Task。每个 Task 的 title/objective 必须包含角色和子问题；由于 Worker 不会自动读取附件，若结论必须依据附件，须把相关摘要/事实与 `[source:*]` 标签一并写进 objective/criteria；`fileIntent: null`、`requiredCapabilityTags: []`。数量规则是模型提示而非硬校验，当前表单没有单独角色列表，因此要得到 S1=4/S2=5 需在 brief/Goal 中明确列出角色与子问题。
4. **按 Cloud 状态顺序回传报告。** `plan.confirm → membership.accept（逐个刷新 revision）→ project.active → offer → Worker accept/start 文本分析 runtime → result.submit`。每位 Worker 只返回 `Expert/Role + Sub-question`、`Conclusion`、带 `[expert:*]`/`[source:*]` 的 `Evidence or basis` 和 `Recommendation`；不执行或声称执行实验。
5. **Coordinator 审阅并汇总。** Coordinator 通过 workspace read 拉取所有报告，逐项 `task.result.review(accept)`，再提交 `project.final_summary.submit`。最终设计包必须写明：首个 Agent 落地任务、每位专家结论及归属、整体方案、量化指标（目标值/阈值/测量方法，标注 proposed 而非 measured）、硬约束、风险与人工确认点、下一步行动项（owner/due）和资料索引；若场景要求未来的设计—模拟—实验—反馈—再设计路径，也要写成 proposed/future、明确本轮未运行。

**最小通过标准：** 两个场景分别完成 4/5 个独立 Task；每个 Task 都有唯一 Worker、`fileIntent: null`、一个可读的 attributed summary、一个 accepted review；最终 summary 包含上述设计包栏目，并能用 Project/Plan/Task/Execution/Result/Review/Summary ID 与 revision 对齐。`task.execution.start` 在这里表示按 design-only prompt 启动一次 LLM 文本分析 runtime，不表示科学实验；当前没有服务端 tool-allowlist/textOnly 硬闸门，禁止外部执行是本 MVP 的任务约定而非强制安全保证。

### 10.2 当前已有的唯一语义选择

Coordinator 的“汇总”目前有两种合法用法：

| 用法 | 当前状态 |
|---|---|
| 人工 Coordinator 审阅报告并填写 final summary | **路径已有**：UI textarea 和现有 `project.final_summary.submit` 可完成；本轮只用协议夹具验证，没有把真实人审点击流程当作已通过。 |
| Coordinator Agent 在显式会话 turn 中读取全部报告、逐项 review、生成并提交设计包 | **合约/能力已有，但需要显式触发**：workspace read、review 和 submit 都有 audience=`agent` 的路径；本轮没有验证真实 Agent turn。事件驱动的“最后一个 result 到达后自动生成 draft”尚未实现；Composer 摘要只提供截断预览，必须让 Agent 显式调用 workspace read 取得完整正文。若只要求自动 draft、保留人工 review，可补一轮 bounded runtime，不需要先改 schema；若还要自动逐项 review，则需另做 review orchestration。 |

### 10.3 后续增强（不阻断本次设计 MVP）

- 结构化 `role/source/metric/constraint/risk/action` 字段、机器校验和真正的 Minutes entity；当前先用带标题和归属标记的文本。
- Worker directory 的专业能力/工具路由；当前只能使用实际 readiness tags 或空 capability。
- User inbox 自动通知、session 自动创建、offer badge 和跨 pane 刷新；当前可手动刷新并按步骤验收。
- round/replan、模拟/实验/反馈、安全审批和 OpenContent；这些属于后续执行产品，不是本轮设计报告闭环。

## 11. 产品决策建议

两场景均可按以下口径对外和内部演示：

> “在身份已预置、Cloud/本地版本对齐、协议夹具通过且由 Coordinator 人工核验内容的前提下，SciForge 支持无 Content 的最小设计评审：Coordinator 将场景拆成 4/5 个独立子课题，Worker 各自返回带专家/资料归属的文本结论、依据和建议，Coordinator 审阅后发布包含首个任务、整体方案、量化指标、硬约束、风险/人工确认和行动项的设计决策包。可以在设计包中提出未来的验证/迭代流程，但本轮不运行实验、模拟或反馈；Coordinator 自动综合、结构化字段和自动通知是明确的后续边界。”

不要把文本 `[source:*]` 标签描述成已经过机器 citation 校验，也不要把 `task.execution.start` 描述成科学实验执行。

## 12. 关键源码索引（便于复核）

以下均为源码定位，不依赖本地既有说明文档：

- 计划/Task/Result/Summary 契约：`packages/collaboration-contracts/src/project-review.ts:40-76,84-151,224-255,378-392`
- Coordinator 计划生成与 capability 限制：`packages/domains/project-coordinator/src/ports.ts:515-579,747-775`
- DAG continuation 与 handoff：`packages/domains/project-coordinator/src/continuation.ts:44-129`
- Worker result/HumanNeeded：`packages/domains/collaboration/src/main/worker-runtime-result.ts:1-150`、`packages/collaboration-server/src/entities.ts:448-518`
- offer、membership、review、round、human answer：`packages/collaboration-server/src/service.ts:1800-1908,2457-2864,4235-4640,5390-5670,6930-7000`
- Desktop inbox/runtime/identity：`packages/domains/collaboration/src/main/connection.ts:551-606`、`packages/domains/collaboration/src/main/runtime.ts:80-106,853-906`、`packages/domains/collaboration/src/main/store.ts:657-735`
- 单实例与本地隔离：`src/main/index.ts:580-620,804-820,1010-1035`、`src/main/settings-store.ts:55-110,125-145,175-210,235-285`
- Worker/Coordinator UI：`packages/domains/collaboration/src/renderer/CollaborationPanel.tsx:304-395,680-730,1880-2105`、`packages/domains/project-coordinator/src/renderer/ProjectCoordinatorPanel.tsx:650-720,1150-1390,2290-2550,2940-3260,3810-3997`
- Cloud HTTP/WS/auth：`packages/collaboration-server/src/api.ts:244-588`、`packages/collaboration-server/src/auth.ts:154-195`、`packages/collaboration-server/src/websocket.ts:30-35`
- acceptance driver：`scripts/collaboration-zulip-acceptance-driver.mjs:549-557,866-893,1094-1105,1210-1223`
- 最小文本验收：`scripts/collaboration-text-report-mvp.test.mjs`、`scripts/collaboration-worker-runtime-mvp.test.mjs`

---

## 13. 按最新产品范围定义的最小闭环（本轮已迭代）

### 13.1 这次实际交付的边界

- **参与者：** 一个 Coordinator User/Agent，加 4 个 Worker（场景一）或 5 个 Worker（场景二）；不做单设备多用户隔离，不引入 OpenContent。
- **任务载荷：** 所有计划项 `fileIntent: null`，Worker 只提交 `summary` 文本；没有伪造文件、引用或实验结果。
- **报告约定：** 对含 `design-analysis-only`（并明确“不执行”）标记的纯文本 Task，Worker prompt 要求 `Expert/Role + Sub-question`、`Conclusion/结论`、`Evidence or basis/依据（证据）`、`Recommendation or next action/建议（下一步）`（可选 `Uncertainty`）；Coordinator 的最终 summary 还必须记录首个 Agent 落地任务、整体方案、量化指标、硬约束、风险/人工确认点、下一步行动项和资料索引。Cloud/schema 不验证该标记，Coordinator 必须在提交 Plan 前人工检查。
- **评审范围：** 场景一是 4 个独立专家子议题；场景二是 5 个独立设计子课题的一次汇总。两者都只验证“派发→文本分析→回报→审核→设计包”，不宣称已经有动态 feedback/replan、自进化或实验执行。

### 13.2 已加入源码的最小改动

1. `worker-runtime-result.ts`：对带 `design-analysis-only` + “不执行”标记的无文件任务注入文本报告格式和不虚构证据的约束；普通无文件任务不受此设计-only提示影响。
2. `project-coordinator/ports.ts`：要求把 Budget 只当作 Cloud 上限；对多专家 design-review 请求把总数收敛到 3–5 个且不超过 5，按明确列出的 Worker role/sub-question 恰好一角色一 Task，禁止再为交付物、指标、风险、行动、阶段或报告章节另建 Task；仅在 design-analysis-only 请求没有明确角色时才生成一个有界 Task，普通请求保留正常分解行为，并将上述报告字段写入完成标准。该数量规则是生成提示约束（不是硬校验），通用 schema 仍保持可变任务数；要稳定得到 S1=4/S2=5，brief 中须明确列出对应角色/子问题并在草稿确认时人工核对。
3. `ProjectCoordinatorPanel.tsx` 与 `messages.ts`：创建 Project 时提示主题/最终问题/约束/决策；完成时提示完整设计包结构和归属格式。
4. `scripts/collaboration-text-report-mvp.test.mjs`：使用本地 Cloud HTTP server、真实 `/v1/commands`、独立 OIDC User/Device/Agent fixture，跑通两条无 Content 场景。
5. `scripts/collaboration-worker-runtime-mvp.test.mjs`：让一个 Worker 的实际 `CollaborationTaskAdapter`、`DurableCloudOutbox` 和严格 JSON runtime 经 HTTP Cloud 完成 offer→文本分析 runtime→result，并验证 Coordinator Agent 收到 `task.result.submitted`。
6. `collaboration-zulip-acceptance-driver.mjs`：修正当前 Cloud 严格 schema 所需的 `createIntentId`、`item_*`/`workerUserId`、`agentId` 和 Coordinator Agent review token；避免把旧 driver 的确定性 400 当成产品故障。

### 13.3 真实多设备验收前绝对必要的工作（按顺序）

1. **准备身份：** Cloud 中准备 1 个 Coordinator User + Coordinator Agent、4/5 个不同 Worker User + Worker Agent；每个 Worker 使用自己的设备和有效 OIDC 会话。当前代码不会从零自动注册这些账号，验收环境必须先完成 provisioning。
2. **确认在线：** 每个 Agent 先通过 `agent.heartbeat`，再发布 `worker.availability.publish`（`online`、`runtimeReadiness: ready`、接受新 offer）。每个 Worker 的 capability tags 必须是生产 readiness 实际发布的 `agent-runtime.<runtime>` / `model-access.<mode>`；本 MVP 没有领域能力契约，任务应使用 `requiredCapabilityTags: []`。Coordinator 和 Worker 两端都要保持 Cloud connection 与 runtime ready。
3. **按状态机执行：** `project.create → project.plan.submit → project.plan.confirm(initialTeam) → 每个 Worker membership.accept → project.transition(active) → task.offer.create → Worker task.offer.accept → task.execution.start（按 design-only prompt 启动文本分析 runtime）→ task.result.submit(summary) → Coordinator task.result.review(accept) → project.final_summary.submit`。不执行外部实验是本轮操作约定；服务端尚未提供通用 textOnly/tool-allowlist 强制。
4. **分工要求：** 计划中显式放 4/5 个 `workerUserId`，每个 Task 只对应一个子议题；Coordinator 人工检查每个 Worker 是否唯一。不要用一个 Agent 冒充多个专家，也不要把多个子议题合并成一个 Task；Cloud 当前不会替你强制“恰好 4/5 + 唯一”。
5. **锁定纯文本：** 生成草案后逐项检查并保持 `fileIntent: null`；当前模型提示会引导这一点，但没有独立的 `textOnly` 硬开关。若模型生成非空 `fileIntent`，先在 Plan 编辑器清除再提交；`initialTeam.mode='none'` 不会接受文件任务。
6. **传输验收：** 每一次 offer/result 都要在 Cloud Agent inbox 看到对应消息和 revision；收到 `task.result.submitted` 或 `project.final_summary.created` 后，再调用 coordination read 取得报告/纪要正文（通知本身主要是 ID）。当前 Desktop 对 User inbox 没有自动消费，因此 Worker 需要手动打开/刷新 Project 来接受邀请；这是 UX/操作步骤，不是报告协议不存在。多个 Worker 不要并行基于同一 revision 接受邀请：每次接受都会推进 Project revision，冲突后必须刷新并按最新 revision 重试。
7. **版本门槛：** 先把 Cloud app、edge、contracts、provider 对齐到同一兼容 release/schema，并保留可核验 provenance。当前只读采样显示 Cloud 与本地版本漂移（本地 contracts/server/provider 为 5.1.0/0.7.0/0.2.6；Cloud 可见部署存在多套历史 bundle，app/provider 另有 5.1.1/0.6.2/0.2.7 采样），所以本地绿灯不能替代线上验收。
8. **记录证据：** 保存 project/plan/task/offer/execution/result/review/final-summary 的 IDs、revision 和时间线；任一步 400/401/403/409/503 都按状态机断点记录，不通过手工改数据库补状态。

### 13.4 本轮验收证据

- `node --import tsx --test scripts/collaboration-text-report-mvp.test.mjs`：2/2 通过（S1 四 Worker、S2 五 Worker；包含场景清单的文本占位项、`project.coordination.read` 回读和 submittedBy User/Agent 对齐）。这些夹具验证的是人数、任务/报告标题、归属标记、状态转换和 final-summary 栏目；不验证附件中的专业事实、资料逐条引用或设计方案质量，仍需人工 checklist/真实 Coordinator 评审。
- `node --import tsx --test scripts/collaboration-worker-runtime-mvp.test.mjs`：1/1 通过（单 Worker；`CollaborationConnection` inbox pull/ACK → Adapter → strict JSON 文本分析 runtime → DurableCloudOutbox → HTTP Cloud）。S1/S2 的 4/5 Worker 结果仍由验收夹具直接提交 HTTP command；没有声称 4/5 个真实 Desktop runtime 已同时运行。final summary 也未经过真实 Desktop approval/broker 点击流程。该测试未启动完整 Electron notification loop 或远端 Cloud，因此仍需外部验收。
- `npm run collaboration:typecheck`：通过；Coordinator 与 collaboration domain focused tests 通过。
- `npm run build`：通过；仅有既有 h264 模块 externalization warning。
- `npm run collaboration:test`：通过；domain-collaboration 154 个测试、工作区 canonical 协作脚本 34 个子测试全部通过，新增两个 MVP 脚本已纳入命令（workspace server 有 15 个预期 skip）。
- 真实外部六用户 Cloud 测试仍为 skip/未执行：当前环境没有配置 acceptance credentials/provisioning，且没有对 Cloud 写入新业务数据。

### 13.5 明确不属于“最基础闭环”的工作

- 单设备多用户隔离、独立 profile/端口/workspace；本需求已明确暂不考虑。
- OpenContent、文件输入/输出、共享 Team root 和 artifact 传递。
- 结构化 citation/source/metric/risk/owner/deadline schema；MVP 只在文本 summary 中约定标题。
- 领域 capability/工具路由；MVP 不使用 `research.execute` 等无法由生产 readiness 发布的业务标签。
- 公共 `project.round.advance`、动态重规划，以及设计→模拟→实验→反馈的实际多轮运行；如果场景需要，该流程可以作为“拟议、未运行”的设计内容写入 final summary。
- 服务端强制 biosafety/human approval；因此场景二本轮只是无实验副作用的“蛋白设计方案评审报告”，不得据此宣称真实生物设计执行能力。
- 事件到达即自动触发 Coordinator Agent 读取全部 Worker 报告并生成 summary draft；当前可由人工 UI 或一个显式 Coordinator Agent session turn 完成 read→review→synthesis→submit，但没有自动触发器。若自动综合是硬要求，可先补一轮 bounded summary-draft runtime；若连逐项 review 也要自治，还需 review orchestration。
- Desktop User inbox 自动推送、自动创建 Worker session、邀请 badge/toast；这些是下一阶段 UI/传输工作。
- 多 Worker 并行接受邀请的 Project revision CAS 重试与明确 UI 提示；当前最小验收按串行人工操作规避。

**更新后的最终判断：** 以“无 Content 的文本设计报告”为验收定义，且由 Coordinator 人工核对任务数/唯一分工和内容的前提下，SciForge 可以承载两条最小 Coordinator–Cloud–Worker 设计评审线：场景一 4 个、场景二 5 个独立子课题，均可完成“报告回传→逐项审核→设计决策包”。真实多设备 Cloud 验收仍必须完成上面的 provisioning、版本对齐和按 revision 的人工操作；Coordinator 自动综合、结构化证据、动态迭代实际运行、实验执行和安全闸门不应在本 MVP 中被暗示为已解决。
