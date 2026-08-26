## Why

SciForge 已分别具备 OIDC/Device 身份、云端 Project/Task、OpenContent Content Space 与 Agent Runtime 的局部能力，但这些能力尚未通过一个权威、无凭据泄漏且可恢复的合同组成真实多用户闭环。A/B/E donor 与此前局部集成仍暴露匿名 pairing、重复 Token 通道、Mock Content Space、Project 内容目录未 provisioning、旧 execution 可回写及真机证据不足等冲突；clean recovery 基线不把这些 donor 行为视为已实现，因此尚不能证明多台真实设备上运行同一精确源码提交的 SciForge 能像一次真实会议那样完成分工、文件交付、复审和恢复。

## What Changes

- 以 Keycloak OIDC JIT User、当前 ACTIVE Desktop Device 和其本地 Runtime 为唯一 Agent 建立链；pairing 只绑定通信端点，任何协作包都不得接触 OIDC Token。
- 让每个 Project 保持一个始终由 Project Owner 所有的精确 Coordinator Agent，并允许 Owner 通过 Coordinator HCI 按 User 分组查看云端 Worker Availability Projection、选择精确 Worker Agent、动态增员、派发、拒绝后改派、复审，以及在自己的多个 Agent 间显式转交 Coordinator。
- 将手动/自动接单保留为每台 Agent Device 的本地持久策略；Cloud 只保存 Task offer/accept/reject、execution fence、revision、幂等、Inbox、Project Record 与恢复事实。
- 新增 Project Owner 驱动的内容 provisioning saga：Run-0 初始 content owner 固定为 Project Owner；Cloud 保存 intent，Owner Desktop 通过 Content Space 创建一个共享目录、精确维护 Provider 成员、写后核验，并提交由当前 Device 签名的无秘密 provisioning attestation 后激活 Project。未来更换 content owner 必须由新 content owner Desktop 执行独立 saga，不属于本次验收。
- 建立唯一的真实文件任务通道：portable reference 在 Worker 本机重新授权；download 在打开本地目标前执行 Provider `DownloadCheck`，upload 使用 Provider 的真实写入授权；元数据仅验证 locator/ancestry，不充当 ACL 事实源。
- 删除 Content Space 静态 verification profile 与授权包门禁，改由当前 Principal、Broker audience/authority、pinned Provider 的 live Binding Attestation 和真实 Provider ACL 在每次调用时授权；OpenContent Provider 在没有 `opencontent-base` Agent 技能包时仍可正常使用，私有技能 ZIP 只通过通用本地校验/安装器作为可选增强进入标准 Workspace skill root。
- 对成员移除、Owner 失权、Device 撤销、断线重连、重复消息、改派 fencing 和 `outcome_unknown` 定义 fail-closed、可人工恢复的状态机。
- 基于现有 A 测试环境执行可回滚蓝绿升级和真机会议验收：沿用 `cloud-test`/`login-test` 与现有 issuer，先完成备份/恢复演练和独立 candidate migration，再切换现有 edge 上游；五个动态 User fixture、至少三台物理机或独立 VM 上的五个独立源码应用 profile 使用同一精确提交、真实 Runtime/模型、真实 OpenContent 账号与可脱敏验证回执。本项目验收不要求 DMG、安装包或发布 artifact。
- 本次只交付 Content Space 文件传递、复审和 Provider-native 操作；provider-neutral Shared Documents 与实时共同编辑明确延后。
- **BREAKING** 删除匿名 pairing 创建 User、协作包保存 OIDC Token、生产 Mock Content Space、Cloud 持久化 `acceptancePolicy`、把 Project binding 当 Provider ACL、旧 execution 回写以及 domain-specific Host 路由等并行路径。

## Capabilities

### New Capabilities

- `connected-desktop-agent`: OIDC User、ACTIVE Device、本地 Runtime 与每 Device 一个 active Agent 的安全建立、撤销和 token-free Cloud transport。
- `project-agent-coordination`: 单 Coordinator Agent、精确 Worker Agent 选择、availability projection、本地接单策略、Task execution fencing、真人升级、复审、改派和 Coordinator 转交。
- `project-content-provisioning`: Cloud intent 与 Owner Desktop Content Space 外部写组成的可恢复 saga、Provider principal readiness、Device-signed attestation、成员增删，以及 Project Membership、Provider Observation、Content Readiness、Task Authority 四项独立事实。
- `project-content-execution`: Project 文件意图、portable reference、本机 Provider reauthorization、operation-time ACL、Workspace transfer、完整性、结果提交和 `outcome_unknown` 恢复。
- `multi-user-meeting-acceptance`: A 测试环境蓝绿 candidate/cutover、源码应用多设备角色脚本、真实 Runtime/OpenContent 闭环、恢复矩阵和脱敏验证回执。

### Modified Capabilities

- `content-space`: 增加 Project-owned 系统执行通道、下载前 Provider 检查、写后强核验和不以元数据推断授权的行为要求；移除静态 verification-profile 合同并统一为当前绑定的运行时授权。
- `opencontent-content-space-provider`: 增加 Project provisioning 所需的真实共享目录、成员、DownloadCheck、上传与精确 observation 语义，同时保持凭据和 vendor 细节在 Connector 私有边界内，并明确 Provider 能力不依赖可选 Agent 技能包。

## Impact

- 影响 `@sciforge/collaboration-contracts`、`@sciforge/collaboration-server`、`@sciforge/domain-identity-access`、`@sciforge/domain-collaboration`、新的 `@sciforge/domain-project-coordinator`、Content Space/OpenContent 集成、通用 Domain SDK、AgentRuntime 接入和标准 source composition；旧 `@sciforge/collaboration-identity` 并行凭据包被删除。
- Cloud 数据库需要向前迁移 Project membership/readiness、content provisioning、Task execution、Inbox/receipt、revision/idempotency 和 recovery journal；migration 只在从现有 A 数据库复制出的 candidate 上执行，运行中的旧数据库保持不变并保留回滚。
- 沿用 `https://cloud-test.sciforge.cn`、`https://login-test.sciforge.cn/realms/SciForge`、现有 TLS/443 edge 和服务器 `47.76.230.118`；不再等待新 Run-0 DNS。任何切换前必须证明备份、恢复、candidate health/migration 和旧上游回滚均可用。
- source 自动门禁与隔离 live 验收都必须走标准 manifest/generated composition 和真实生产路径；验收不得使用 Fake provider、Mock Content Space、fixture runtime、直接数据库写入或秘密回执。
- 唯一集成主线为个人 Fork 的 `codex/full-collaboration-loop-recovery`，基线是 `origin/gui@e0038b8c7109390445dccb691052fec74a153c09`；旧闭环分支与 WIP snapshot 仅作逐文件 donor，不参与普通合并。
