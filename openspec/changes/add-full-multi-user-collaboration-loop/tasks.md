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
- [x] 3.3 实现每 Project 唯一且始终由 Project Owner 所有的 Coordinator Agent、动态 Worker User 选择、Owner-owned Agent 间 Coordinator transfer 和权限 fencing。
- [x] 3.4 实现 User-level offer broadcast、首台合格 Device/Agent 原子 claim 后创建 execution、timeout/withdraw/reassign、expected revision/idempotency 和旧 execution 全写入 fencing；不保留 User 级 reject 路径。
- [x] 3.5 实现 Project Membership lifecycle、Provider Membership Observation、derived Project Content Readiness、command-time Task Authority 四项独立事实及普通成员/Owner 失权降级规则。
- [x] 3.6 实现 provisioning intent/attestation verification/binding saga、dynamic add、removal pending、closed/degraded lifecycle 和 durable recovery journal。
- [x] 3.7 实现 Project plan、统一 `worker_execution | coordinator_project` HumanNeeded to explicit active Project member User、HumanAnswer → Coordinator Inbox、result review accept/request-revision、Coordinator-only observation/decision/summary/final completion 与 visible recovery actions。
- [x] 3.8 添加 forward-only PostgreSQL migrations、从所有受支持旧 schema 的升级测试、transactional Inbox/receipt 和 restart recovery。
- [x] 3.9 完成 REST/SDK/WSS contract、authorization matrix、rate/bounds/redaction、revision/idempotency 和运维恢复手册。

## 4. Content Space 与 OpenContent 真实系统通道

- [x] 4.1 从 E1 donor 重写 generic `system-download`/`system-upload-new` 合同、Content Space capability/service、Domain SDK system grant 和源/packaged composition。
- [x] 4.2 实现 execution-bound Workspace relative path、realpath/symlink/no-overwrite/bounds 和 exact operation/resource transfer receipts；逐文件 bytes/SHA-256 可保留为诊断，但不作为本 PoC 门禁。
- [x] 4.3 实现 portable Project root/file resolver，metadata 仅验证 locator/ancestry，不授予 ACL；资源绑定 caller/Principal/Workspace/execution。
- [x] 4.4 在 OpenContent download 中接入真实 DownloadCheck，并保证授权结果早于 Host 打开目标；增加 metadata-visible-but-unauthorized 测试；V4 readiness 保持 `poc_only` / `runtime_authorization_required`。
- [x] 4.5 在 OpenContent upload-new 中接入真实 Provider write、collision/unauthorized/outcome_unknown 分类和 exact write-after-observation；V4 readiness 保持 `poc_only` / `runtime_authorization_required`。
- [x] 4.6 复用真实 create/list/add/remove/list Team Administration 路径和 Provider Directory Principal Reference，不增加 Project/provider 特权端口或 identity inference。
- [x] 4.7 实现 confirmed full-plan digest 绑定、exact finite provisioning batch approval 与 one-use per-operation proofs；首次计划替换或任何 revision/operation drift 都拒绝复用同一确认。
- [x] 4.8 删除生产 Mock Content Space、fallback、metadata ACL helper 和重复传输入口；测试 mock 只从测试入口可达。
- [x] 4.9 删除静态 verification-profile 合同、组合、生成器与 Stage 4 门禁；以当前 Principal + Broker audience + Provider binding attestation + 实时 ACL/DownloadCheck 作为唯一运行授权路径。证明未安装 `opencontent-base` 时 Provider 普通能力正常，真实私有 ZIP 可经通用本地安装器进入标准 skill root 并被发现，且私有字节不进入 Git。

## 5. 本地 Collaboration Agent 执行

- [x] 5.1 将 domain-collaboration 改为只消费 Identity-owned token-free User/Agent transport；Agent machine credential 仅由 Identity 私有原生安全存储持有，collaboration 只保留 presence/WSS 状态消费与 durable Inbox/outbox。
- [x] 5.2 实现每 Agent Device 本地持久 `manual | automatic` 策略、统一 preflight、显式 claim/local-dismiss，确认 Cloud 无 acceptancePolicy 且本地忽略不会拒绝整个 User Offer。
- [x] 5.3 实现 Worker availability 发布、Runtime capability tags、active Task count、Provider identity/current Project readiness 与 heartbeat projection。
- [x] 5.4 从 B donor 重写 Worker runner，使用 runtime-neutral AgentRuntime、当前 execution journal 和真实 Content Space system channel。
- [x] 5.5 实现 accept 后重启恢复、WSS reconnect/inbox refill、duplicate offer/ACK 幂等、Device/membership/execution fencing 和迟到外部结果 journal。
- [x] 5.6 实现 Worker HumanNeeded、真实 Runtime transformation、结果/file reference submission 和 provider_not_ready fail-closed。

## 6. Project Coordinator 模块与 HCI

- [x] 6.1 新建独立 `@sciforge/domain-project-coordinator`，提供 main/renderer entrypoints、manifest/generated composition 和明确 public contracts。
- [x] 6.2 从 B donor 重写 Project create/focus、Runtime plan、从 Cloud 在线事实聚合的 Worker User Directory、User 选择和 Task dispatch UI；Agent/Device 只作可派发证据，不作选择值。
- [x] 6.3 实现 plan confirmation/edit、pending approval 默认可见、HumanNeeded target-User selection/answer、accept/request-revision 和 Project completion UI。
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
- [x] 7.4 candidate 全部门禁通过后切换现有 Caddy `cloud-test` upstream，保持 `login-test/realms/SciForge` issuer 不变；验证 source-app live 后再决定退役旧栈，期间必须能精确回滚旧 upstream/app/database。
  - 2026-08-26 经用户对 `743907e2` 包单独授权，首次 Edge 切换的 revision/mount/公网 200/200/401/issuer 门禁通过；随后 U0 packaged configure 因 bootstrap Identity 仍绑定隔离 loopback、与公网 HTTPS Collaboration origin 不一致而在写设置/建 Agent 前按设计 fail closed。已立即恢复原 Edge revision/Caddy SHA/公网门禁并撤下候选 Edge 网络，旧 DB v5 与候选 DB v14 聚合均未漂移。7.4 保持 unchecked；脱敏回执与需重新批准的启动顺序见 `docs/operations/full-collaboration-stage4-a-host-cutover-attempt-1.md`。
  - 2026-08-26 经用户对 `7d946636` 修订顺序单独授权，第二次先停 loopback U0，再完成同一 Edge 切换；公网 Identity 恢复同一 Device 且 candidate Device/Agent 聚合保持 23/15。HTTPS Collaboration 设置写入后，renderer 错把 active phone endpoint 作为首个 Agent 注册前置条件，真实 packaged 路径无法继续，遂先停公网 U0，再精确恢复旧 Edge、公网门禁、candidate 隔离/restart policy 和 loopback profile。无 Agent/endpoint/Project/Provider 写入；7.4 继续 unchecked。通用最小 UI 修复及新 artifact/再次审批边界见 `docs/operations/full-collaboration-stage4-a-host-cutover-attempt-2.md`。
  - 2026-08-27 经用户对 clean/pushed `ac5c9656` source-app 顺序单独授权，第三次切换通过 candidate revision/mount/公网 200/200/401/issuer、同一 OIDC User/Device、唯一 U0 Agent、Collaboration connected 和 7/7/24/16 无重复门禁。Coordinator 建 Project 随即因 renderer 未携带 main 声明的 confirmation approval 而在 Cloud 写入前 fail closed；只读复核 U0 Owner Project 仍为 0。已先停 U0，再精确恢复旧 Edge、公网门禁、candidate 隔离及 `restart=no`，旧栈/候选/审计证据均保留。通用 renderer/main 契约修复 `bc702433` 及新审批边界见 `docs/operations/full-collaboration-stage4-a-host-cutover-attempt-3.md`；7.4 继续 unchecked。
  - 2026-08-27 经用户对 origin `d59c6537` exact-source 顺序单独授权，第四次切换通过 candidate revision/mount/公网 200/200/401/issuer、同一 OIDC User/Device、唯一 U0 Agent、Collaboration connected 和无重复门禁。真实 UI 随后在 candidate durably 创建 Project `prj_5594a84705a34532b0dd50c3d16911f9`（Project 总数 13→14），但 main handler 在无 broker resource handle 的 global external-write 调用中返回 `changed: true`，Host 因而在 Cloud 写入后拒绝成功回执，HCI 未自动聚焦 Project，也未显示 Coordinator 在线 User/Agent 人数。已先停 U0，再精确恢复旧 Edge、公网门禁、candidate 隔离及 `restart=no`；新 Project、旧栈、候选和全部审计证据均保留。根因、通用修复边界和第五次新审批要求见 `docs/operations/full-collaboration-stage4-a-host-cutover-attempt-4.md`；7.4 继续 unchecked。
  - 2026-08-27 第五次授权先由 exact-source guard 在 U0 启动前拒绝 detached 隔离 clone 并完成一次精确回滚；只修正 clone 的个人 Fork/branch 元数据后，第二个受控窗口通过 candidate 公网门禁和 source preflight，真实 U0 OIDC 重新认证成功、同一 Device/Agent 无重复且 Agent heartbeat 被 candidate 接受到 revision 46。真实 Connect 随后先发送遗留 revision-45 offline availability，Cloud 以 `revision_conflict` 拒绝并使当前 revision-46 online fact 留在本地 pending，UI 因而未达到 connected/Coordinator counts。已先停 U0，再精确恢复旧 Edge、candidate 隔离及 `restart=no`。通用修复 `f89b8180` 使 availability 按 Agent revision/observation supersede，并把服务端既有的 `worker_availability_projection` 加入严格 REST entity union；完整 Collaboration/类型/架构门禁和 clean production build 通过。脱敏回执见 `docs/operations/full-collaboration-stage4-a-host-cutover-attempt-5.md`；7.4 继续 unchecked，下一次公网选择需要新授权。
  - 2026-08-27 第六次授权通过旧 candidate 公网门禁、同一 U0 Identity 和 revision-47 Agent heartbeat；当前 online availability 已在 candidate DB 成功提交，但旧 `763cc5a5` Cloud 镜像随后因 bundled REST entity union 缺少 `worker_availability_projection` 而把成功写入误回为 `validation_failed`。已先停 U0，再恢复 exact old Edge、公网 `200/200/401`/issuer，并撤下候选 Edge 网络与 `restart=no`。仅个人 Fork commit `94f6d89b` 新增真实 HTTP heartbeat→availability 200 regression；基于该 exact commit 的全新隔离 Cloud image/app 已通过 bundle/image/no-op migration/v14 fingerprint/安全聚合/identity count/`200/200/401`/issuer/Caddy/compose 门禁，旧 candidate 与全部证据保留。脱敏回执与新的未授权切换包见 `docs/operations/full-collaboration-stage4-a-host-cutover-attempt-6.md`、`docs/operations/full-collaboration-stage4-a-host-cutover-plan-94f6d89b.md`；7.4 继续 unchecked，刷新 candidate 从未连接公网 Edge，另需一次显式授权。
  - 2026-08-27 第七次授权包含两个受控窗口：首个窗口在 candidate 公网门禁通过后由 exact-source guard 因默认 Node 23 不受支持而在 U0 启动前终止并精确回滚；改用 Node `22.22.1` 后，第二个窗口通过 exact source/public Cloud/OIDC/Identity 门禁，refreshed `94f6d89b` Cloud 接受同一 U0 Agent revision-48 heartbeat 并提交当前 online availability，证明第六次 response-schema 缺陷已关闭。真实 UI 的 Connect 随后因 U0 将通用 `codex` 命令解析到缺失 vendor binary 的 Homebrew npm 安装而在本地 Runtime handler 失败，未达到 connected、Project focus 或 Coordinator 人数。已先停 U0，再恢复 exact old Edge、公网 `200/200/401`/issuer、candidate 隔离及 `restart=no`；通过真实 Settings 将 U0 固定到已验证的 `/usr/local/bin/codex`，离线 Electron Runtime 显示 Running/Ready。完整脱敏回执见 `docs/operations/full-collaboration-stage4-a-host-cutover-attempt-7.md`；7.4 继续 unchecked，下一次公网选择仍需新授权。
  - 2026-08-27 第八次授权通过 public/exact-source/Identity/Runtime/Agent/availability 门禁后，真实 U0 暴露了旧 Project 创建 Inbox 形态；当前生产写路径已收敛为 direct `project.started`，v15 只保留历史行规范化职责。脱敏回执见 `docs/operations/full-collaboration-stage4-a-host-cutover-attempt-8.md`。
  - 2026-08-27 第九次授权在公网前拦截并保留一份 stale-dist 候选，重建 exact `444722d3` v2 bundle/image 后完成 v15 migration（public-lineage fingerprint `c73f6bef...189d`）、安全聚合、隔离 `200/200/401/authentication_required`、Caddy/compose/approval/internal probe 全部门禁。公网 Edge 随后保持 exact revision/issuer；真实 U0 UI 显示 Collaboration `Connected`、Agent Online、既有 Project `prj_5594a84705a34532b0dd50c3d16911f9` 聚焦，以及 `1/1 members online`、`1/1 Agents online`。candidate 保持公网运行，旧栈与精确回滚资产全部保留，未操作 upstream。完整回执见 `docs/operations/full-collaboration-stage4-a-host-cutover-attempt-9.md`；7.4 完成。

## 8. 自动化、源码应用与真机验收

- [x] 8.1 完成 contracts、server、identity、collaboration、coordinator、Content Space/OpenContent focused tests 和 changed-file lint/typecheck。
- [x] 8.2 对本变更新增/修改的生产路径执行 `Repository architecture principles gate`：不得编辑 central feature map、Host 只能依赖通用 SDK、不得保留兼容 shim/双注册、不得写 showcase/provider/domain 硬编码、backend/UI 同包版本，并验证标准 source composition；全仓历史发现只报告，不扩展本任务。
  - 2026-08-26 按用户明确的 source-app 纵向范围重跑：架构/组合测试 `25/25`、通用私有 Skill 安装器 `3/3`，changed-path gate 审计 419 个路径、144 个生产源码和 27 个 domain package，零 finding；真实 Electron `source/out` 使用冻结 Cloud/OIDC 组合 256 个能力，Identity/Device 正常停在 `signed-out`，Coordinator 精确停在 `identity_required`，OpenContent Provider 在无静态 profile 前提下可发现。该证据不完成 live 7.4/8.6–8.8，也不冒充已暂缓的 8.4。
- [x] 8.3 运行与 changed collaboration path 相关的 package boundary、private-import、generated composition freshness、capability governance、secret audit 和 full regression tests；只有直接阻断该路径的既有问题才允许最小通用适配。
  - Stage 4 使用 arm64 Node `22.22.1`、FTS5-capable SQLite、arm64 Python `3.13` 和两个隔离的 loopback PostgreSQL 17 数据库完成最终回归：root Vitest `366/366` files、`3389/3389` tests 通过且 root aggregate 无 skip；全部 domain/package/tarball/internal-overlay/public-release 前置门禁、root typecheck 和全量 lint 也通过。Computer Use 4 项和 Scientific Plotting 2 项既有硬件/可选依赖 package-level skip 被单独保留，没有冒充真机证据或计入 root aggregate。
- [ ] 8.4 正式安装包/发布 artifact 的 production-composition 验证。
  - 2026-08-26 用户明确暂缓 8.4：当前首要目标是从源码纵向完成并进行真实闭环测试，不追求 DMG、安装包或发布 artifact。8.4 保持 unchecked，且不作为当前 source-app live 闭环的前置；源码 composition 由 8.2 约束，真实 Cloud/设备路径由 7.4、8.6–8.8 约束。
- [x] 8.5 准备 U0-U4 合成账号/议程/需求、三文件 Task、HumanNeeded、Device-local dismiss 后 Coordinator withdraw/reassign、review/revision 和 completion 验收脚本。
- [ ] 8.6 在至少三台机器/独立 VM 的五个独立 source-app profiles 上，以同一 exact commit 完成真实 OIDC、Device/Agent、OpenContent provisioning 与并发会议 happy path。
- [ ] 8.7 完成 restart、WSS refill、duplicate、old execution fence、Device revoke、Coordinator transfer、Provider removal 和 outcome_unknown recovery matrix。
- [ ] 8.8 从授权 Desktop 下载并人工核对最终产物，生成不含秘密的 verification receipt；逐文件 bytes/SHA-256 不作为本 PoC 门禁，candidate/cutover 或设备门禁未满足时精确标记 `awaiting_candidate`/`awaiting_real_devices`。

## 9. 清理与交付

- [x] 9.1 审计并删除旧 anonymous pairing、Token duplication、0.2 parallel contract、mock/fallback、private cross-boundary import、domain/provider hard-code、dead file/export/dependency。
  - Stage 4 changed-path gate 从基线 `e0038b8c7109390445dccb691052fec74a153c09` 审计 419 个变更路径、144 个生产源码和 27 个 domain package，零 finding；当前 Collaboration secret audit 417 个候选文件通过，OpenContent 旧 Provider migration/compatibility 路径已删除。正式安装包验证已按用户指示移出当前纵向闭环范围并保留在未完成的 8.4，未被本项冒充为已完成。
- [x] 9.2 按 docs、identity、cloud、content-space、collaboration/coordinator、deployment/E2E 的逻辑系列提交 commits，并在每次提交后保持 OpenSpec checkbox 与真实进度一致。
  - Stage 4 依次提交 OpenContent compatibility 清理 `ea4903c9`、团队附件信任/安装器 `ff80c4a5`、封闭打包/验收门禁 `c52b7d1b`、团队部署与 readiness 文档 `d86b8e15`、通用本地授权包生成器 `aa81f88e`；没有把真实环境缺口伪装为完成。
- [x] 9.3 持续推送唯一集成主线 `codex/full-collaboration-loop-recovery` 到个人 Fork；只在所有必需门禁通过并经 User 确认后准备 upstream PR。
  - `2026-08-26T06:49:29Z` 前，以上系列已仅推送到 `origin` `https://github.com/SCU-areszhang/SciForge_Loop.git`；独立 `ls-remote` 返回 `d86b8e15dc4305c3eb26899d2bdc833d06a008e0`，与本地 HEAD 相同。未创建 upstream PR，也未执行 A 环境变更、cutover 或 artifact 发布。
