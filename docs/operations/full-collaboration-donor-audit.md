# A/B/C/E 与 Cloud donor 审计

本审计冻结 `add-full-multi-user-collaboration-loop` 的代码来源决策。它记录可复核行为，不评价个人；donor commit 只用于选择性重写，不是合并基线，也不构成已通过的端到端证据。

## 基线与分支

- 个人 Fork：`SCU-areszhang/SciForge_Loop`
- 实现分支：`codex/full-collaboration-loop`
- 创建基线：同步后的个人 Fork `origin/gui@3f5527d1ddd2ad6f56ae294197e137ae6bdd061c`
- 同步时 `origin/gui` 与 `upstream/gui` 完全相同；分支创建后冻结基线，后续 upstream 变化逐项审查，不自动漂移
- A `292560506896c31900a43339338ef32dc8767212`：未进入基线
- B `543042e9cd3bbad66f48d8962b49d9a45c6d9033`：未进入基线
- C `15a45319`：已由 upstream PR #84 进入基线 merge `3f5527d1`
- E1 `0d3704641f46434b79f92c36302da074060eebea`：本地 donor-only，未进入基线

任何实现都不得整分支 cherry-pick 后再叠加兼容层。应先建立当前 public contract/test，再移植满足该合同的最小行为，并删除旧的重复路径。

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
- 把 A 的迁移号或 0.1/0.2 合同直接视为当前 schema。新 Run-0 使用一条从同步基线出发的 forward-only lineage，并完整测试升级。

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
- 公网 realm/部署存在与目标不同的配置漂移和生产安全缺口，但本次不在其上修复、迁移或“顺手生产化”。

## 最终采纳规则

1. C 当前身份路径为起点；A/B 任何匿名 pairing 或 Token duplication 都不得回归。
2. A 提供 Cloud 数据形状灵感，B 提供 Coordinator/Worker 行为灵感，E1 提供 transfer/Workspace 灵感；最终公共合同由本变更 OpenSpec 决定。
3. Cloud Project Membership、Provider Membership observation 和 Task authority 分表/分状态，不互相推断。
4. Cloud 与 Content Space 是并列模块：Cloud 保存 intent/state，Owner Desktop 编排 Provider 外部写，Content Space 不导入 Project。
5. source、packaged 和 isolated-live 都必须走 manifest/generated composition 的唯一生产路径；测试 mock 不构成 donor 采纳理由。
6. 现有公网 A 部署保持不变；所有 deployment/migration/live mutation 只允许指向独立 Run-0 资源。
