## Why

SciForge 的左侧栏把本地代码目录称为 “Projects”，但 Cloud-authoritative Project 只能从右侧 Collaboration Center 找到，导致用户创建 Project 后看不到一个稳定入口，也容易误把本地 Workspace、聊天 Thread 和 Cloud Project 当成同一种对象。现在需要把 Cloud Project 作为可恢复的 Agentic Project Workspace 显式呈现，同时继续复用唯一的 Project Coordinator 创建与操作路径。

## What Changes

- 增加一个通用、manifest-discovered 的 Workbench 左侧导航 section 合同；Host 只渲染通用贡献，不认识 Project ID、domain ID 或 Cloud 业务。
- 由 `@sciforge/domain-project-coordinator` 在该 slot 中贡献 “Cloud Projects”，通过现有只读 workspace projection 列出当前 User 可见的 Cloud Project、状态与工作流摘要。
- 侧栏 “New Project” 只打开 Project Coordinator 已有的创建 HCI；最终写入仍由 canonical `project-coordinator.project.create` 完成，不新增 IPC、capability、Cloud command 或 fallback。
- canonical 创建完成并被 workspace projection 观察后，Cloud Project 会出现在左侧栏；Project 节点复用并聚合本机已绑定的普通 Agent Runtime Sessions，点击 Session 走现有左栏选择路径，点击 Project 工具则聚焦同一个 Project Coordinator workspace。
- 普通左侧 Session 可以先保持未绑定，并通过自然语言让 SciForgeAgent 基于当前 authenticated Principal 发现前置条件、调用唯一 canonical `project.create`；仅在成功 receipt 后把返回的精确 Project ID 持久绑定到该 Session，失败不产生伪绑定。
- 当前 Project Session 的 Cloud Project 与 canonical collaboration scope 由 Project Coordinator package 通过既有 `renderer.composer-context-provider` 注入聊天上下文，使 Coordinator/Worker 各自的本机 SciForgeAgent 准确理解其 Project 范围；实际读取、介入与写入仍必须复用 Host 的 canonical capability agent tools 与同一 Project 状态机。
- 把当前 Thread/目录树的标题从含混的 “Projects” 改为 “Local Workspaces”，保留现有 Workspace 与 Thread 行为。
- Project 创建不要求预先存在 Team-root；本集成把现有 canonical lifecycle 收敛为 Owner-only draft create → successful Session bind → Plan/initial Team confirmation → invitation acceptance → Project-scoped Team-root provisioning/readiness → activation/dispatch → review/continuation，且不保留第二套状态机或 fallback。

## Capabilities

### New Capabilities

- `agentic-project-workspace-navigation`: 定义 Cloud Project 与本地 Workspace 的侧栏分层、通用 domain-contributed 导航 slot、canonical Project 创建入口和创建后可见性。

### Modified Capabilities

- Project Coordinator 的既有 capability definitions 同时服务 UI 与 Agent audience；Host 只增加可信 ordinary Runtime Session provenance，Project package 继续拥有 Principal、Membership、Coordinator authority epoch 与 Worker execution fence 的解释和授权。
- Collaboration contracts/server/provider 的既有 Cloud Project lifecycle 扩展为 Owner-only draft、首次 Plan 冻结 initial Team、邀请接受、Team provisioning/readiness 与唯一 continuation；create、dispatch、claim、review 均继续使用原 canonical command/receipt/state-machine 边界。

## Impact

- 影响 Domain SDK Host/renderer contracts、renderer contribution registry、Workbench/Sidebar 通用导航、Project Coordinator main/renderer/manifest/i18n、Collaboration contracts/server/domain/provider、membership migration、Team provisioning、Task dispatch/claim、review/continuation 与 package-owned composer context。
- Provider 外部写仍只经过既有 Content Space canonical path；本集成不新增 provider-specific Host 分支、第二套 Project 写路径或兼容 fallback。
- 新增/删除 domain package 继续只经过标准 manifest 与 generated composition；Host 不增加 Project 特例或中央 feature map。
