# A/B/C/E 与 Cloud donor 审计

本审计冻结 `add-full-multi-user-collaboration-loop` 的代码来源决策。它记录可复核行为，不评价个人；donor commit 只用于选择性重写，不是合并基线，也不构成已通过的端到端证据。

## 基线与分支

- 个人 Fork：`SCU-areszhang/SciForge_Loop`
- 唯一集成分支：`codex/full-collaboration-loop-recovery`
- clean recovery 基线：个人 Fork `origin/gui@e0038b8c7109390445dccb691052fec74a153c09`
- 旧 `codex/full-collaboration-loop@ac6858110a01cea3bddc9eecd7c2c2762b9a8689` 与本地 WIP snapshot `codex/wip/full-collaboration-loop-snapshot-20260825T064142Z@72c090d58ed030c39bac80012e58efea0b707343` 仅供只读审计和逐文件 donor；不参与普通合并，不继承实现 checkbox 或验收结论
- recovery 基线创建后冻结；后续 upstream 变化逐项审查，不自动漂移
- A `292560506896c31900a43339338ef32dc8767212`：未进入基线
- B `543042e9cd3bbad66f48d8962b49d9a45c6d9033`：未进入基线
- C `15a45319`：已由 upstream PR #84 进入基线 merge `3f5527d1`
- E1 `0d3704641f46434b79f92c36302da074060eebea`：本地 donor-only，未进入基线

任何实现都不得普通合并旧闭环/WIP/donor 分支，也不得整分支 cherry-pick 后再叠加兼容层。应先建立当前 public contract/test，再逐文件移植满足该合同的最小行为，并删除 changed path 上的旧重复路径。

## A：Cloud donor

审计 commit：`29256050`，分支引用 `a/project-contentspace-task-intent` / upstream PR #83。

### 采纳并重写

- `executionId` 与 Task execution fence 的基本方向；每次改派必须生成新 execution。
- `TaskFileIntent`、portable locator、Cloud resource reference 与 Project Content Space Binding 的严格 schema 思路。
- expected revision、idempotency、旧 execution 资源引用失效和 PostgreSQL forward migration 的测试形态。
- OIDC verifier、Device/identity repository 与 server-side authorization 的局部实现可作为测试样例。

### 拒绝或替换

- 匿名 `pairing.begin/redeem` 和“首次 pairing 创建 User/user credential”。冻结合同要求 OIDC JIT 是唯一 User 创建/查找路径，pairing 只绑定 endpoint。
- `VerifiedContentSpaceAuthorization.scopes = [read, upload-new]` 及 binding 中持久化 authorization proof。最终模型使用 Device-signed provisioning observation，任何后续 Provider permission 都在 operation time 重新判断。
- 仅 `active | closed` 的 binding。最终还需要 `provisioning | active | degraded | closed`、provisioning revision 和 durable saga/recovery。
- production bootstrap 未注入 `verifyContentSpaceAuthorization`：`CollaborationService` 有可选 verifier，但 `createCollaborationServerRuntime` 未传入，实际 bind 会 fail closed。最终 verifier 必须是可组成且生产已绑定的 canonical path，不允许测试-only injection。
- 把 A 的迁移号或 0.1/0.2 合同直接视为目标 schema。最终 migration lineage 必须从只读重验的现有 A schema 出发，在复制出的 candidate DB 上完整测试后才允许 edge cutover。

## B：Agent 拆解、Worker 与 Coordinator donor

审计 commit：`543042e9`，分支 `codex/bc-cloud-gui`。贡献者报告 B tests `62/62`、C tests `82/82`；该数字只证明分支自测，不替代当前基线/Run-0 集成门禁。贡献者同时报告 A Server 与 0.2 合同有三项不匹配，审计确认其 package 依赖 `@sciforge/collaboration-contracts@0.2.0`，而同步基线为 0.1 线。

### 采纳并重写

- 独立 `domain-project-coordinator` 的包/manifest/main/renderer 形态。
- Coordinator plan store/planner、Worker runner、execution journal/outbox、fence 和 result finalization/recovery 的行为分解。
- 每 Agent Device 本地持久 manual/automatic acceptance、共同 preflight 和拒绝后 replan。
- Project create/plan/Worker selection/Task/review 的 HCI 骨架与测试布局。
- Project 成功创建后自动聚焦、pending plan/HumanNeeded/review 卡默认可见的修正目标。

### 拒绝或替换

- `productionMockContentSpace()`：production `main.ts` 直接注入 mock，真实文件 Task 会产生伪成功。最终 production composition 缺少真实 Provider 时必须 fail closed。
- collaboration 包中的 `oidc-access-token` secret 与 accessToken 输入/持久化。OIDC Token 只留在 identity-access，其他包只消费 token-free authenticated transport。
- B 的 0.2 Cloud facade 与兼容映射。最终只有一套当前 contracts/server/SDK，不保留双版本或 fallback。
- 把 Coordinator 与 Worker 全部留在同一大包。Worker registration/presence/Inbox/local execution 留在 `domain-collaboration`；计划/选择/复审/provisioning HCI 留在 `domain-project-coordinator`。
- 生产 subscriber 没有 publisher、UI 默认折叠审批、创建后不聚焦等“测试通过但用户闭环不可见”的路径。

### B 精确 commits 的 Stage 2 处置

- `79200c70` 的 Coordinator workbench、`f23c6788` 的 Cloud finalization、`32be3a74` 的 Coordinator approval recovery 分别归属 Coordinator HCI/完成/恢复工作，不作为 Worker runner 实现移植。
- `4a48efa7` 中旧 `project-coordinator/worker-runner` 的 Runtime 终态失败、execution fence 和恢复测试按行为拆分：Runtime 终态失败迁移到 5.4；accept 后恢复、即时 fencing 与 Runtime/Provider 迟到结果 journal-only 语义迁移到 5.5；Worker HumanNeeded、Runtime transformation、portable output submission 和 Provider fail-closed 行为迁移到 5.6 的当前 `domain-collaboration` tests/runner。旧 `sourceKind`/`targetUserId` HumanNeeded、`task.transition` 与 `resource.create` 均不迁移。
- `0b1e8043` 的 Agent outbox/WSS recovery characterization 已适配到 5.5 的 token-free Agent Inbox：WSS 只提示，connect/reconnect 有界 drain durable sequence；handler 完成后，cursor 与稳定 ACK 在同一本地事务落盘，崩溃前未提交的消息由幂等 handler 重放，重复页不产生重复业务事实或 ACK；其中 Coordinator planner characterization 由当前 Coordinator package 独立承接。
- `42d1d9ee` 新增的 `collaboration-identity` Token/session ownership 与最终 Identity 合同冲突，已拒绝；它不作为 Worker runner 的认证入口。
- 当前唯一 Worker runner 是 recovery commit `b9e34cf7` 写入 `domain-collaboration` 的 canonical task adapter。它消费 runtime-neutral Agent execution Host、当前 execution journal 和 generic Content Space system contracts。旧 `task.transition`、`resource.create`、专用 ContentSpacePort 与 `project-coordinator/worker-runner` 均不迁移，也不保留 shim。
- Stage 2 / 6.3 选择性适配 `79200c70` 的默认可见 Coordinator workbench 行为、`f23c6788` 的完成入口和 `32be3a74` 的 approval recovery 意图：当前 renderer 只调用 governed capability，支持完整 Plan 内容编辑、精确 Agent 选择、Owner HumanAnswer、accept/request-revision 与原子 `project.final_summary.submit`；Collaboration durable Agent Inbox 依据 `coordinator_project` scope 投递到唯一 Project Coordinator package owner，并以已存在的 decision ProjectRecord 作为重放恢复证据。donor 的旧 `sourceKind`/`targetUserId`、直接 Owner ProjectRecord 写入、legacy `project.transition completed`、旧 store/runtime 路径均拒绝且未保留 shim。
- Stage 2 / 6.4 未迁移 donor 的 Project/provider 特权端口。当前 Project Coordinator 读取 Cloud 当前 provisioning intent，以 Host-canonical full-plan digest 绑定一次 Human 确认，并只通过 Content Space ordinary authorize/create-or-reauthorize/observe/list/add/remove/list capabilities 执行。每个 Provider 操作由 Cloud prepare/dispatch/observe journal 包围，最终完整 roster 由当前 Device purpose-locked signer 签署后提交 Cloud；`pending_membership`、`membership_removal_pending`、Owner root-loss 与 crash-window create reconcile 均有 characterization tests。Content Space 不接收 Project DTO、Provider credential 或 Cloud authority，也未保留立即 active/removed 的兼容路径。

## C：Identity donor

审计 commit：`15a45319`，已在当前基线。

### 直接保留的权威行为

- system-browser OIDC/PKCE、严格 Token 验证、canonical `/v1/me`、Device enrollment 和 `cloud-authenticated` Principal。
- Token refresh 后重新验证 Device，保持同一 Device lease/identity continuity，并在撤销或冲突时 fail closed。
- Renderer 与普通 domain contract 不暴露 Token。

### 仍需扩展

- 给其他 domain 的 main-only token-free authenticated Cloud transport；不能让 collaboration 自己复制 Token。
- Device key enrollment/canonical fact digest signing，且私钥不可导出。
- Runtime configured 之后才建立每 Device 一个 active Agent 的 bootstrap projection。

## E1：Content Space 真实任务通道 donor

审计 commit：`0d370464`，本地工作树 `codex/content-space-task-execution-run0`。

### 采纳并重写

- `content-space.system-download` / `content-space.system-upload-new` 的 generic system-only capability 方向。
- Workspace-relative path、realpath/symlink/no-overwrite/byte bounds、Host-owned transfer、bytes/SHA-256 和 exact receipt。
- Content Space contract 4.0 / Domain SDK system grant / packaged composition 的边界测试思路。
- portable root/child identity、Provider/Principal/Workspace/caller 绑定和写后 observation。

### 必须纠正

- `observeEntryParent` hierarchy walk 只能证明 identity/ancestry/containment。OpenContent 已知资源 metadata 在 Team removal 后仍可能可见，不能作为 ACL oracle。
- download 必须在 Host 打开本地目标前运行真实 OpenContent `DownloadCheck`；upload 必须以真实 Provider write 为权限门禁。
- 旧 E1 OpenSpec checkbox 曾全部勾选但 live 权限语义并未闭合；本变更只在实际实现与验证后逐项勾选。

## 服务器只读事实

2026-08-24 对共享 Cloud 实例的只读检查用于解释现状，不授权写入：

- 公网边缘使用 Caddy，已部署的 Cloud image/commit 前缀为 `eaf992…`，collaboration contracts 处于 0.1 线，数据库 schema 为 v5，Keycloak 为 26.7。
- 公网 Cloud 的实际身份语义优于 A/B donor：User 由 OIDC JIT 建立，pairing 在认证 User 下绑定 endpoint；没有匿名 first-pairing User 创建。
- 公网实例尚无 Project Content Space binding、Cloud ResourceRef 或真实文件 Task 通道；已存在的跨 User Project 只证明无文件协作状态机。
- 该测试 realm/部署存在与目标不同的配置漂移和生产安全缺口；本次只修复真实会议闭环直接依赖的部分，不“顺手生产化”或扩展安全范围。

## 最终采纳规则

1. C 当前身份路径为起点；A/B 任何匿名 pairing 或 Token duplication 都不得回归。
2. A 提供 Cloud 数据形状灵感，B 提供 Coordinator/Worker 行为灵感，E1 提供 transfer/Workspace 灵感；最终公共合同由本变更 OpenSpec 决定。
3. Cloud Project Membership lifecycle、Provider Membership Observation、derived Project Content Readiness 和 command-time Task Authority 分表/分状态，不互相推断。
4. Cloud 与 Content Space 是并列模块：Cloud 保存 intent/state，Owner Desktop 编排 Provider 外部写，Content Space 不导入 Project。
5. source、packaged 和 A-upgrade live 都必须走 manifest/generated composition 的唯一生产路径；测试 mock 不构成 donor 采纳理由。
6. 现有 A 测试部署是 live PoC 的蓝绿升级源：先完成 Cloud/Keycloak/edge 备份与 restore rehearsal，再从旧 Cloud DB 建立独立 candidate 并只在 candidate 上 migration；验证后切换现有 `cloud-test` upstream，旧 app/database 保留回滚。
7. Coordinator Agent 始终由 Project Owner 所有；Run-0 初始 content owner 同样固定为 Project Owner。Shared Documents/实时共同编辑不在本 PoC。
8. Architecture/secret 扫描对全仓历史问题仅报告；本次只阻塞新增或修改的闭环生产路径及其最小直接依赖，不扩展为无关模块重构。
