## Why

SciForge 已分别具备 OIDC/Device 身份、云端 Project/Task、OpenContent Content Space 与 Agent Runtime 的局部能力，但这些能力尚未通过一个权威、无凭据泄漏且可恢复的合同组成真实多用户闭环。当前分支与部署还存在匿名 pairing、重复 Token 通道、Mock Content Space、Project 内容目录未 provisioning、旧 execution 可回写及真机证据不足等冲突，因此不能证明多台 packaged Desktop 能像一次真实会议那样完成分工、文件交付、复审和恢复。

## What Changes

- 以 Keycloak OIDC JIT User、当前 ACTIVE Desktop Device 和其本地 Runtime 为唯一 Agent 建立链；pairing 只绑定通信端点，任何协作包都不得接触 OIDC Token。
- 让每个 Project 保持一个精确 Coordinator Agent，并允许 Coordinator 通过 HCI 按 User 分组查看云端 Worker Availability Projection、选择精确 Worker Agent、动态增员、派发、拒绝后改派、复审和显式转交 Coordinator。
- 将手动/自动接单保留为每台 Agent Device 的本地持久策略；Cloud 只保存 Task offer/accept/reject、execution fence、revision、幂等、Inbox、Project Record 与恢复事实。
- 新增 Project Owner 驱动的内容 provisioning saga：Cloud 保存 intent，Owner Desktop 通过 Content Space 创建一个共享目录、精确维护 Provider 成员、写后核验，并提交由当前 Device 签名的无秘密 provisioning attestation 后激活 Project。
- 建立唯一的真实文件任务通道：portable reference 在 Worker 本机重新授权；download 在打开本地目标前执行 Provider `DownloadCheck`，upload 使用 Provider 的真实写入授权；元数据仅验证 locator/ancestry，不充当 ACL 事实源。
- 对成员移除、Owner 失权、Device 撤销、断线重连、重复消息、改派 fencing 和 `outcome_unknown` 定义 fail-closed、可人工恢复的状态机。
- 新增隔离 Run-0 部署和真机会议验收：五个动态 User fixture、至少三台物理机或独立 VM 上的五个独立 packaged Desktop profile、真实 Runtime/模型、真实 OpenContent 账号与可脱敏验证回执；公网既有部署保持不变。
- **BREAKING** 删除匿名 pairing 创建 User、协作包保存 OIDC Token、生产 Mock Content Space、Cloud 持久化 `acceptancePolicy`、把 Project binding 当 Provider ACL、旧 execution 回写以及 domain-specific Host 路由等并行路径。

## Capabilities

### New Capabilities

- `connected-desktop-agent`: OIDC User、ACTIVE Device、本地 Runtime 与每 Device 一个 active Agent 的安全建立、撤销和 token-free Cloud transport。
- `project-agent-coordination`: 单 Coordinator Agent、精确 Worker Agent 选择、availability projection、本地接单策略、Task execution fencing、真人升级、复审、改派和 Coordinator 转交。
- `project-content-provisioning`: Cloud intent 与 Owner Desktop Content Space 外部写组成的可恢复 saga、Provider principal readiness、Device-signed attestation、成员增删与三套独立状态。
- `project-content-execution`: Project 文件意图、portable reference、本机 Provider reauthorization、operation-time ACL、Workspace transfer、完整性、结果提交和 `outcome_unknown` 恢复。
- `multi-user-meeting-acceptance`: 隔离 Run-0、packaged 多设备角色脚本、真实 Runtime/OpenContent 闭环、恢复矩阵和脱敏验证回执。

### Modified Capabilities

- `content-space`: 增加 Project-owned 系统执行通道、下载前 Provider 检查、写后强核验和不以元数据推断授权的行为要求。
- `opencontent-content-space-provider`: 增加 Project provisioning 所需的真实共享目录、成员、DownloadCheck、上传与精确 observation 语义，同时保持凭据和 vendor 细节在 Connector 私有边界内。

## Impact

- 影响 `@sciforge/collaboration-contracts`、`@sciforge/collaboration-server`、`@sciforge/collaboration-identity`、`@sciforge/domain-collaboration`、新的 `@sciforge/domain-project-coordinator`、Content Space/OpenContent 集成、通用 Domain SDK、AgentRuntime 接入和 packaged composition。
- Cloud 数据库需要向前迁移 Project membership/readiness、content provisioning、Task execution、Inbox/receipt、revision/idempotency 和 recovery journal；既有公网数据库不执行本变更迁移。
- 新增同机隔离的 `cloud-run0.sciforge.cn`、`login-run0.sciforge.cn`、`SciForge-Run0` realm、独立数据库/角色/Compose/凭据/备份目录；DNS 未完成时验收停在 `awaiting_dns`。
- source、packaged、隔离 live 三层测试都必须走标准 manifest/generated composition 和真实生产路径；验收不得使用 Fake provider、Mock Content Space、fixture runtime、直接数据库写入或秘密回执。
