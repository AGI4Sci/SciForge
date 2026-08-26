## 1. 冻结架构与验收基线

- [x] 1.1 修正根 Context Map 的 OIDC/Device/Agent 当前事实、上下文关系和 Project Content provisioning ownership。
- [x] 1.2 更新 Identity、Cloud Collaboration、Content Space 和 Provider Integration 词汇，冻结 User/Device/Agent、四项 membership/observation/readiness/authority 事实、attestation 与 operation-time ACL 术语。
- [x] 1.3 新增 ADR，记录 token-free Cloud transport、client-orchestrated provisioning saga、Device-signed fact attestation 和 metadata-not-ACL 决策。
- [x] 1.4 新增真实多用户会议验收文档，冻结角色、设备矩阵、会议脚本、恢复矩阵、状态门禁和脱敏回执 schema。
- [x] 1.5 记录 A/B/C/E donor commit 的逐项采纳/拒绝结论，冻结现有 A 测试部署只通过备份、candidate migration、验证后 edge cutover 的蓝绿路径升级，且实现分支只基于个人 Fork 同步点。
- [x] 1.6 从个人 Fork `origin/gui@e0038b8c7109390445dccb691052fec74a153c09` 建立唯一 recovery integration mainline，冻结 Owner-owned Coordinator、初始 Owner-owned content、Shared Documents 延后和 changed-path gate；旧闭环分支/WIP 仅作 donor。
- [x] 1.7 冻结 Q27-R：Run-0 是沿用现有 `cloud-test`/`login-test` issuer 的第一次 live run，Cloud 只通过备份/恢复演练、独立 candidate migration 和可回滚 edge cutover 升级，不再等待新 DNS。

## 2. Identity 与通用安全边界

- [x] 2.1 复用 Domain SDK 的 main-only owner-scoped internal-service mediation，由 identity-access 定义 allowlisted、token-free authenticated Cloud transport public contract，并增加 manifest/composition/边界测试。
- [x] 2.2 由 identity-access 实现唯一 OIDC request broker，私有注入 Token、重验 Device lease、严格返回 token-free response，并删除协作包 OIDC/session broker 路径。
- [x] 2.3 增加 Device key enrollment、原生安全存储、canonical digest signing 和 Cloud verification metadata；禁止 domain 任意签名与私钥导出。
- [x] 2.4 将 Agent bootstrap 改为 OIDC User → ACTIVE Device → Runtime configured → 每 Device 一个 active Agent，并覆盖 logout/revoke/refresh/ownership conflict。
- [x] 2.5 扩展 secret audit，证明 Token、Device/Agent secret 和 Provider credential 不进入跨包合同、IPC、日志、Git 或回执。

## 3. Cloud 合同、状态机与数据库

- [x] 3.1 升级 collaboration contracts，增加 Worker availability、Project Membership/content readiness、content provisioning intent/attestation/binding、Task execution/file intent/review/recovery 的 strict versioned schemas。
- [x] 3.2 保持 OIDC JIT 为唯一 User 创建路径并使 pairing 仅绑定 endpoint；删除匿名 pairing 与 first-pairing user creation。
- [x] 3.3 实现每 Project 唯一且始终由 Project Owner 所有的 Coordinator Agent、动态 User/精确 Worker Agent 选择、Owner-owned Agent 间 Coordinator transfer 和权限 fencing。
- [x] 3.4 实现 offer/accept/reject/timeout/revoke/reassign、每次新 executionId、expected revision/idempotency 和旧 execution 全写入 fencing。
- [x] 3.5 实现 Project Membership lifecycle、Provider Membership Observation、derived Project Content Readiness、command-time Task Authority 四项独立事实及普通成员/Owner 失权降级规则。
- [x] 3.6 实现 provisioning intent/attestation verification/binding saga、dynamic add、removal pending、closed/degraded lifecycle 和 durable recovery journal。
- [x] 3.7 实现 Project plan、统一 `worker_execution | coordinator_project` HumanNeeded to Owner、HumanAnswer → Coordinator Inbox、result review accept/request-revision、Coordinator-only observation/decision/summary/final completion 与 visible recovery actions。
- [x] 3.8 添加 forward-only PostgreSQL migrations、从所有受支持旧 schema 的升级测试、transactional Inbox/receipt 和 restart recovery。
- [x] 3.9 完成 REST/SDK/WSS contract、authorization matrix、rate/bounds/redaction、revision/idempotency 和运维恢复手册。

## 4. Content Space 与 OpenContent 真实系统通道

- [x] 4.1 从 E1 donor 重写 generic `system-download`/`system-upload-new` 合同、Content Space capability/service、Domain SDK system grant 和源/packaged composition。
- [x] 4.2 实现 execution-bound Workspace relative path、realpath/symlink/no-overwrite/bounds 和 exact operation/resource transfer receipts；逐文件 bytes/SHA-256 可保留为诊断，但不作为本 PoC 门禁。
- [x] 4.3 实现 portable Project root/file resolver，metadata 仅验证 locator/ancestry，不授予 ACL；资源绑定 caller/Principal/Workspace/execution。
- [x] 4.4 在 OpenContent download 中接入真实 DownloadCheck，并保证授权结果早于 Host 打开目标；增加 metadata-visible-but-unauthorized 测试；V4 readiness 保持 `poc_only` / `verification_profile_required`。
- [x] 4.5 在 OpenContent upload-new 中接入真实 Provider write、collision/unauthorized/outcome_unknown 分类和 exact write-after-observation；V4 readiness 保持 `poc_only` / `verification_profile_required`。
- [x] 4.6 复用真实 create/list/add/remove/list Team Administration 路径和 Provider Directory Principal Reference，不增加 Project/provider 特权端口或 identity inference。
- [x] 4.7 实现 confirmed full-plan digest 绑定、exact finite provisioning batch approval 与 one-use per-operation proofs；首次计划替换或任何 revision/operation drift 都拒绝复用同一确认。
- [x] 4.8 删除生产 Mock Content Space、fallback、metadata ACL helper 和重复传输入口；测试 mock 只从测试入口可达。

## 5. 本地 Collaboration Agent 执行

- [x] 5.1 将 domain-collaboration 改为只消费 Identity-owned token-free User/Agent transport；Agent machine credential 仅由 Identity 私有原生安全存储持有，collaboration 只保留 presence/WSS 状态消费与 durable Inbox/outbox。
- [x] 5.2 实现每 Agent Device 本地持久 `manual | automatic` 策略、统一 preflight、显式 accept/reject reason，确认 Cloud 无 acceptancePolicy。
- [x] 5.3 实现 Worker availability 发布、Runtime capability tags、active Task count、Provider identity/current Project readiness 与 heartbeat projection。
- [x] 5.4 从 B donor 重写 Worker runner，使用 runtime-neutral AgentRuntime、当前 execution journal 和真实 Content Space system channel。
- [x] 5.5 实现 accept 后重启恢复、WSS reconnect/inbox refill、duplicate offer/ACK 幂等、Device/membership/execution fencing 和迟到外部结果 journal。
- [x] 5.6 实现 Worker HumanNeeded、真实 Runtime transformation、结果/file reference submission 和 provider_not_ready fail-closed。

## 6. Project Coordinator 模块与 HCI

- [x] 6.1 新建独立 `@sciforge/domain-project-coordinator`，提供 main/renderer entrypoints、manifest/generated composition 和明确 public contracts。
- [x] 6.2 从 B donor 重写 Project create/focus、Runtime plan、按 User 分组的 Worker availability、精确 Agent 选择和 Task dispatch UI。
- [x] 6.3 实现 plan confirmation/edit、pending approval 默认可见、HumanNeeded Owner answer、accept/request-revision 和 Project completion UI。
- [x] 6.4 实现 Owner Desktop provisioning/reconcile orchestrator、Device-signed attestation、dynamic add/removal pending 和 Owner root loss recovery HCI。
- [x] 6.5 实现 outcome_unknown exact observation/link-or-abandon 流程，禁止无 observation 的 mark-success。
- [x] 6.6 实现 Coordinator transfer HCI 和旧 Coordinator fencing 反馈；与 identity/collaboration/content-space 只通过标准 contracts/contributions 组合。

## 7. 既有 A 测试环境蓝绿升级

- [x] 7.1 只读重验 `47.76.230.118` 上现有 A 的 exact image、schema、`cloud-test` origin、`login-test/realms/SciForge` issuer、Keycloak/Cloud 数据库和 Caddy upstream，并记录不含秘密的基线回执。
  - 2026-08-26 用户授权的两阶段只读审计确认 DNS/443 当前栈、精确 image ID/manifest、Cloud `public-v5` catalog fingerprint、Keycloak realm/client、Caddyfile SHA-256/动态 upstream 和完整 rollback identity；数据库会话强制 read-only，未执行容器、数据库、Caddy 或文件写入。脱敏证据见 `docs/operations/full-collaboration-stage4-a-host-baseline.md`。
- [x] 7.2 对 Cloud DB、Keycloak DB/realm、edge 配置和当前 image metadata 完成备份与隔离 restore rehearsal；任何 migration/cutover 前必须证明旧栈可恢复。
  - 2026-08-26 用户授权的 session-prefixed 演练完成 Cloud DB 行级快照恢复、public-v5 catalog 复核、Keycloak DB 恢复、Realm 导出后向全新数据库导入、edge 归档安全解包和现网不变性复查；全部隔离资源无公开端口并已停止保留。脱敏证据见 `docs/operations/full-collaboration-stage4-a-host-backup-restore.md`。
- [x] 7.3 从旧 Cloud DB 复制独立 candidate database/volume/container/network，candidate-only 执行 forward migration、目标 image health 和合成账号 smoke；不得直接迁移运行中的旧数据库或新增 issuer fallback。
  - 2026-08-26 使用 session 前缀隔离数据库/卷/双网络/loopback app，从 7.2 public-v5 dump 续跑真实 v12 中断点至 ready v14，完成 no-op migration、聚合安全审计、重复启动、健康/401/唯一 issuer 验证，并由 Human 通过 system-browser PKCE 注册一个新合成账号，证明 candidate 重启前后 JIT User/OIDC identity 与 revision 持久稳定；旧 Cloud/DB/Caddy 未变。脱敏证据见 `docs/operations/full-collaboration-stage4-a-host-candidate.md`。
- [ ] 7.4 candidate 全部门禁通过后切换现有 Caddy `cloud-test` upstream，保持 `login-test/realms/SciForge` issuer 不变；验证 packaged/live 后再决定退役旧栈，期间必须能精确回滚旧 upstream/app/database。
  - 2026-08-26 经用户对 `743907e2` 包单独授权，首次 Edge 切换的 revision/mount/公网 200/200/401/issuer 门禁通过；随后 U0 packaged configure 因 bootstrap Identity 仍绑定隔离 loopback、与公网 HTTPS Collaboration origin 不一致而在写设置/建 Agent 前按设计 fail closed。已立即恢复原 Edge revision/Caddy SHA/公网门禁并撤下候选 Edge 网络，旧 DB v5 与候选 DB v14 聚合均未漂移。7.4 保持 unchecked；脱敏回执与需重新批准的启动顺序见 `docs/operations/full-collaboration-stage4-a-host-cutover-attempt-1.md`。
  - 2026-08-26 经用户对 `7d946636` 修订顺序单独授权，第二次先停 loopback U0，再完成同一 Edge 切换；公网 Identity 恢复同一 Device 且 candidate Device/Agent 聚合保持 23/15。HTTPS Collaboration 设置写入后，renderer 错把 active phone endpoint 作为首个 Agent 注册前置条件，真实 packaged 路径无法继续，遂先停公网 U0，再精确恢复旧 Edge、公网门禁、candidate 隔离/restart policy 和 loopback profile。无 Agent/endpoint/Project/Provider 写入；7.4 继续 unchecked。通用最小 UI 修复及新 artifact/再次审批边界见 `docs/operations/full-collaboration-stage4-a-host-cutover-attempt-2.md`。

## 8. 自动化、packaged 与真机验收

- [x] 8.1 完成 contracts、server、identity、collaboration、coordinator、Content Space/OpenContent focused tests 和 changed-file lint/typecheck。
- [ ] 8.2 对本变更新增/修改的生产路径执行 `Repository architecture principles gate`：不得编辑 central feature map、Host 只能依赖通用 SDK、不得保留兼容 shim/双注册、不得写 showcase/provider/domain 硬编码、backend/UI 同包版本，以及 source/packaged 两条 composition 都必须验证；全仓历史发现只报告，不扩展本任务。
- [x] 8.3 运行与 changed collaboration path 相关的 package boundary、private-import、generated composition freshness、capability governance、secret audit 和 full regression tests；只有直接阻断该路径的既有问题才允许最小通用适配。
  - Stage 4 使用 arm64 Node `22.22.1`、FTS5-capable SQLite、arm64 Python `3.13` 和两个隔离的 loopback PostgreSQL 17 数据库完成最终回归：root Vitest `366/366` files、`3389/3389` tests 通过且 root aggregate 无 skip；全部 domain/package/tarball/internal-overlay/public-release 前置门禁、root typecheck 和全量 lint 也通过。Computer Use 4 项和 Scientific Plotting 2 项既有硬件/可选依赖 package-level skip 被单独保留，没有冒充真机证据或计入 root aggregate。
- [ ] 8.4 验证 source app 的真实生产 composition，并构建同一 exact commit 的 packaged artifact；验证 packaged app 无 mock/fallback，且只指向冻结的 A-upgrade PoC origin/issuer。
  - Source 半程已在 pushed commit `d86b8e15dc4305c3eb26899d2bdc833d06a008e0` 由 canonical `npm run build` 和真实 Electron `source/out` smoke 验证：固定 Cloud/OIDC 被精确注入，Cloud Identity/Device 均为 `signed-out` 且无配置错误，真实 OpenContent Provider 可发现，Project Coordinator 精确停在 `identity_required`。正式 artifact 入口在 builder 启动前因缺少 reviewed private verification-profile contribution 而 fail closed；packaged 半程未运行，因此 8.4 保持 unchecked。
- [x] 8.5 准备 U0-U4 合成账号/议程/需求、三文件 Task、HumanNeeded、reject/reassign、review/revision 和 completion 验收脚本。
- [ ] 8.6 在至少三台机器/独立 VM 的五个 packaged profiles 上完成真实 OIDC、Device/Agent、OpenContent provisioning 与并发会议 happy path。
- [ ] 8.7 完成 restart、WSS refill、duplicate、old execution fence、Device revoke、Coordinator transfer、Provider removal 和 outcome_unknown recovery matrix。
- [ ] 8.8 从授权 Desktop 下载并人工核对最终产物，生成不含秘密的 verification receipt；逐文件 bytes/SHA-256 不作为本 PoC 门禁，candidate/cutover 或设备门禁未满足时精确标记 `awaiting_candidate`/`awaiting_real_devices`。

## 9. 清理与交付

- [x] 9.1 审计并删除旧 anonymous pairing、Token duplication、0.2 parallel contract、mock/fallback、private cross-boundary import、domain/provider hard-code、dead file/export/dependency。
  - Stage 4 changed-path gate 从基线 `e0038b8c7109390445dccb691052fec74a153c09` 审计 403 个变更路径、143 个生产源码和 27 个 domain package，零 finding；416 个公开候选文件 secret audit 通过，OpenContent 旧 Provider migration/compatibility 路径已删除。packaged reachability 仍由未完成的 8.2 exact-artifact formal gate 独立约束，未被本项冒充为已完成。
- [x] 9.2 按 docs、identity、cloud、content-space、collaboration/coordinator、deployment/E2E 的逻辑系列提交 commits，并在每次提交后保持 OpenSpec checkbox 与真实进度一致。
  - Stage 4 依次提交 OpenContent compatibility 清理 `ea4903c9`、团队附件信任/安装器 `ff80c4a5`、封闭打包/验收门禁 `c52b7d1b`、团队部署与 readiness 文档 `d86b8e15`、通用本地授权包生成器 `aa81f88e`；没有把真实环境缺口伪装为完成。
- [x] 9.3 持续推送唯一集成主线 `codex/full-collaboration-loop-recovery` 到个人 Fork；只在所有必需门禁通过并经 User 确认后准备 upstream PR。
  - `2026-08-26T06:49:29Z` 前，以上系列已仅推送到 `origin` `https://github.com/SCU-areszhang/SciForge_Loop.git`；独立 `ls-remote` 返回 `d86b8e15dc4305c3eb26899d2bdc833d06a008e0`，与本地 HEAD 相同。未创建 upstream PR，也未执行 A 环境变更、cutover 或 artifact 发布。
