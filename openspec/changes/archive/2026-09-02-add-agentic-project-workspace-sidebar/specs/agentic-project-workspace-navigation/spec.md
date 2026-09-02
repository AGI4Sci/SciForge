## Purpose

定义 Cloud-authoritative Project 在 SciForge 左侧导航中的可发现入口，并把它与本地 Workspace/Thread 明确分层，同时保证创建、读取和聚焦仍只经过 Project Coordinator 的 canonical contracts。

## ADDED Requirements

### Requirement: Cloud Projects 与 Local Workspaces 在侧栏中保持不同对象

Workbench SHALL 把已安装 domain 贡献的 Cloud Project section 与本地代码 Workspace/Thread section 分别呈现，并把现有目录/Thread 树标记为 “Local Workspaces”。Cloud Project SHALL 来自当前 OIDC User 的 canonical Project Coordinator workspace projection；本地 Workspace SHALL 继续来自本地 Runtime/Thread 状态。系统 SHALL NOT 通过名称、目录、Thread 或本地缓存推断二者的对应关系。

#### Scenario: User 同时拥有 Cloud Project 和本地 Workspace

- **WHEN** 当前 User 的 Cloud projection 包含一个 Project，且 Desktop 已打开一个本地代码 Workspace
- **THEN** 侧栏 SHALL 在 “Cloud Projects” 中显示该 Project，并在 “Local Workspaces” 中独立显示代码 Workspace 与 Threads
- **AND** 任一对象的创建、删除、归档或重命名 SHALL NOT 隐式改变另一对象。

### Requirement: 左侧导航 section 由通用 renderer contribution 发现

Workbench SHALL 通过一个严格版本化、manifest-declared 的通用 renderer navigation-section contract 发现、校验和按稳定顺序组合 domain-owned section。Host SHALL 只向 section 提供当前 Workbench session、现有普通 Session 的有界 presentation catalog 与 canonical Session selection action，不得包含 Project/domain/provider ID 分支、私有 domain import 或中央 feature map。无效、重复或未安装的贡献 SHALL fail closed；安装或移除一个 domain package SHALL 只经过标准 manifest/generated composition 路径。

#### Scenario: Project Coordinator package 未安装

- **WHEN** 标准 composition 中不存在 Project Coordinator 的 navigation-section contribution
- **THEN** Host SHALL 不渲染 “Cloud Projects” section，并继续正常渲染 Local Workspaces
- **AND** Host SHALL NOT 通过硬编码 module ID 或 fallback 恢复该 section。

### Requirement: New Project 从侧栏进入 canonical Project Coordinator HCI

“Cloud Projects” section 的 New Project action SHALL 只打开当前 Workbench session 中由 Project Coordinator package 拥有的创建 HCI。实际 Project 写入 SHALL 继续由既有、需要 Human confirmation 的 canonical `project-coordinator.project.create` capability 执行；侧栏、Host 与 renderer contribution SHALL NOT 增加第二套 IPC、Cloud command、capability、数据库写入或 fallback。Project 创建 SHALL NOT 要求预先存在 Team-root；任何 Team-root SHALL 在 Project 创建后由 Project-scoped provisioning 流程产生。

#### Scenario: 空白 Workbench 中从侧栏创建 Project

- **WHEN** 当前没有已持久化 Thread，但 Workbench 已提供稳定 draft session，User 选择 “New Project”
- **THEN** Project Coordinator 创建 HCI SHALL 在该 session 打开并显示当前 canonical Project 创建表单
- **AND** 在 Human 确认表单前 SHALL 不产生 Cloud Project、Membership、Team-root 或 Provider 外部写。

### Requirement: canonical 创建后 Project 由同一 projection 出现在侧栏

Cloud Projects section SHALL 在 canonical create 成功后重新读取 Project Coordinator workspace projection，并仅在新 Project 已被该 projection 观察时显示它。该 section MAY 使用 package-owned invalidation、可见性恢复和有界定时刷新提高及时性，但这些机制 SHALL 只触发 canonical read，不得成为第二事实源。Identity logout、User 切换、Device invalid 或 Cloud unavailable SHALL 清除不再属于当前已确认 User 的可见 Project 数据，不得跨身份保留旧列表。

#### Scenario: Project 创建回执成功但 projection 尚未包含它

- **WHEN** canonical create 返回后的一次 read 尚未观察到新 Project
- **THEN** 侧栏 SHALL 保持刷新/同步状态而不得合成本地 Project 行
- **AND** 只有后续 canonical projection 包含精确 Project ID 时才 SHALL 显示该 Project。

#### Scenario: User 登出

- **WHEN** canonical workspace read 返回 `identity_required` 或确认了不同 User
- **THEN** Cloud Projects section SHALL 清除上一身份的 Project 行
- **AND** Local Workspaces 与 Threads SHALL 保持独立可用。

### Requirement: Project tree 只聚焦同一个 Agentic Project Workspace

每个可见 Cloud Project row SHALL 显示可识别名称、Cloud lifecycle status、本机绑定的普通 Agent Runtime Sessions，以及由 Project Coordinator package 拥有的 Tasks、Files、Decisions、Activity/Recovery 入口。选择 Session SHALL 委托既有左栏 canonical Session selection，不复制 transcript、不创建新的会话实现；选择 Project 工具 SHALL 只使用精确 Project ID 激活同一个 Project Coordinator workspace。不可用的可选 view SHALL 回退到该 Project 的安全 overview，而不是调用另一条实现路径。

#### Scenario: User 从 Files 子入口打开 Project

- **WHEN** User 展开一个 Cloud Project 并选择 Files
- **THEN** Workbench SHALL 打开同一个 Project Coordinator surface、聚焦该精确 Project，并在已安装 Content Space section 时显示 Files view
- **AND** 文件读取或下载 SHALL 继续经过 Content Space 的 canonical resource navigation 与 Provider authorization。

### Requirement: 当前 Project 上下文可供自然语言介入

Project Coordinator package SHALL 通过标准 composer-context contribution，把当前普通 Agent Runtime Session 的 canonical Project collaboration scope 与有界摘要提供给 SciForgeAgent。Coordinator scope SHALL 只在当前本机 Agent 仍持有该 Project coordinator authority 时成立，并可包含有界 Project 全局摘要；Worker scope SHALL 绑定到当前 User/Device/Agent 的 exact Task execution/fence，并且只包含该 exact Task/execution 及与它精确关联的 review、accepted evidence、recovery 和 HumanNeeded，不得包含 sibling Tasks、成员 readiness、assignee identity 或 Project 全局成员目录。所有自由文本 SHALL 使用确定性字符预算，完整 contribution SHALL 明确低于 48,000 字符；transient read failure、abort、parse failure 或 oversize SHALL 返回空 context，不得阻断普通聊天。该上下文 SHALL NOT 包含 secret、credential、authority token 或把 prompt role 当作写授权。自然语言提出的 Project 读取、执行、复审、恢复或完成操作 SHALL 只通过 Host 的 canonical Agent capability discovery/invocation/event surface 到达与 UI 相同的 Project capability、approval、idempotency、receipt 与状态机；系统 SHALL NOT 增加 renderer method call、私有 IPC、文本命令 parser 或 fallback 写路径。

一个尚未绑定 Cloud Project 的普通持久 Session SHALL 可以基于当前 authenticated Principal 发现 readiness、通过同一 Agent capability surface 调用唯一 canonical `project-coordinator.project.create`。系统 SHALL 只在该调用成功、校验 canonical receipt 且 receipt 返回精确 Project ID 后，把当前 `runtimeId`/`threadId` 持久绑定到该 Project；失败、取消、超时或无效 receipt SHALL 保持 Session unbound。绑定存在本身 SHALL NOT 授予 Membership、Coordinator authority、Task execution fence 或任何写权限。

#### Scenario: 未绑定 Session 通过自然语言创建并绑定 Project

- **WHEN** authenticated User 在一个未绑定 Project 的普通 Agent Runtime Session 中要求创建 Project，Agent 完成 canonical discovery/approval 并收到 `project.create` 成功 receipt
- **THEN** 系统 SHALL 使用 receipt 返回的精确 Project ID 持久绑定当前 ordinary Session，并从 canonical projection 将它显示在该 Cloud Project 的 Sessions 下
- **AND** 后续 Project 上下文 SHALL 由该绑定与当前 Principal、Membership、Coordinator authority 或 exact execution fence 共同解析，不得从原始自然语言推断。

#### Scenario: 未绑定 Session 创建失败

- **WHEN** 同一 canonical create 被拒绝、取消、失败、超时，或返回无法验证的 receipt
- **THEN** 当前 ordinary Session SHALL 保持 unbound，Cloud Projects SHALL 不显示伪造 Project 或 Session alias
- **AND** User SHALL 可以继续保留该普通 Session 与私有 transcript，并重新发现 readiness 或再次发起受治理的 create。

#### Scenario: User 在选中的 Project 中要求复审阻塞任务

- **WHEN** User 已在当前 session 选择一个仍可见的 Cloud Project，并在 composer 中要求 SciForgeAgent 解释和复审阻塞任务
- **THEN** composer context SHALL 向 Runtime 提供该精确 Project 的最新 canonical 摘要
- **AND** Agent SHALL 通过已授权的 canonical Project capability 读取与介入，任何外部写仍 SHALL 遵循原 approval 与 revision/idempotency 约束，并把结果暴露为同一 Project 的可追溯事实。

#### Scenario: 选中的 Project 已不可见

- **WHEN** identity 改变、Project 不再出现在 canonical projection，或当前 session 进入 New Project intent
- **THEN** Project Coordinator SHALL 清除该 session 的 active-Project composer context
- **AND** 后续自然语言 turn SHALL NOT 携带旧 Project ID 或缓存摘要。

#### Scenario: Membership 被移除或进入 removal-pending

- **WHEN** 当前 Coordinator 或 Worker User 的 canonical Project Membership 不再是 active
- **THEN** public Session projection 与 composer context SHALL 清除该旧 Project scope，或仅保留不含 Project 数据的诊断状态
- **AND** Agent Project write SHALL 在触达任何 Cloud、Provider 或 package write port 前由 canonical main handler fail closed。

#### Scenario: Worker Session 读取 Project 上下文

- **WHEN** 当前 Session 由一个仍开放的 exact Worker execution journal 投影
- **THEN** composer context SHALL 只包含该 Task/execution 及与其精确关联的 review、accepted evidence、recovery 与 HumanNeeded
- **AND** sibling Task、其他 execution、成员 readiness 与 assignee 信息 SHALL 不出现在 context 中。

#### Scenario: Coordinator 与 Worker 在各自设备进入同一 Project

- **WHEN** Coordinator 选择其本机绑定的 Project Session，Worker 在另一设备选择由其 exact Task execution 创建的普通 Session
- **THEN** 两个 Session SHALL 分别继续使用各自设备的 Agent Runtime 与私有 transcript，并共享同一 Cloud Project facts
- **AND** Coordinator 的 operation scope SHALL 限于 coordinator-project authority，Worker 的 operation scope SHALL 限于其 membership 与 exact execution fence；任一 scope SHALL NOT 依靠 Session 标题或 prompt role 建立。

### Requirement: 侧栏状态是可访问、克制且可诊断的

Cloud Projects section SHALL 支持键盘操作、清晰 focus、折叠/展开、loading/empty/error/offline 状态和 reduced-motion。它 SHALL 使用现有 SciForge design tokens，并以一条窄的 Cloud lifecycle status rail 区分 Cloud workflow 与本地目录，而不得用动画、颜色或图标声称未被 projection 证明的执行、review、recovery 或 completion 状态。

#### Scenario: Cloud 暂时不可用

- **WHEN** canonical read 返回 `cloud_unavailable`
- **THEN** section SHALL 显示可重试的有界离线状态且不显示伪造的新状态
- **AND** Local Workspaces SHALL 继续可操作。
