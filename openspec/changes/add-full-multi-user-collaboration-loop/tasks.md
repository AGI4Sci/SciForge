## 1. 冻结架构与验收基线

- [x] 1.1 修正根 Context Map 的 OIDC/Device/Agent 当前事实、上下文关系和 Project Content provisioning ownership。
- [x] 1.2 更新 Identity、Cloud Collaboration、Content Space 和 Provider Integration 词汇，冻结 User/Device/Agent、三套 membership/authority 状态、attestation 与 operation-time ACL 术语。
- [x] 1.3 新增 ADR，记录 token-free Cloud transport、client-orchestrated provisioning saga、Device-signed fact attestation 和 metadata-not-ACL 决策。
- [x] 1.4 新增真实多用户会议验收文档，冻结角色、设备矩阵、会议脚本、恢复矩阵、状态门禁和脱敏回执 schema。
- [x] 1.5 记录 A/B/C/E donor commit 的逐项采纳/拒绝结论，确认当前公网部署不可变且新分支只基于个人 Fork 同步点。

## 2. Identity 与通用安全边界

- [ ] 2.1 在 Domain SDK 中定义 main-only、allowlisted、token-free authenticated Cloud transport contribution，并增加 manifest/composition/边界测试。
- [ ] 2.2 由 identity-access 实现唯一 OIDC request broker，私有注入 Token、重验 Device lease、严格返回 token-free response，并删除协作包 OIDC/session broker 路径。
- [ ] 2.3 增加 Device key enrollment、原生安全存储、canonical digest signing 和 Cloud verification metadata；禁止 domain 任意签名与私钥导出。
- [ ] 2.4 将 Agent bootstrap 改为 OIDC User → ACTIVE Device → Runtime configured → 每 Device 一个 active Agent，并覆盖 logout/revoke/refresh/ownership conflict。
- [ ] 2.5 扩展 secret audit，证明 Token、Device/Agent secret 和 Provider credential 不进入跨包合同、IPC、日志、Git 或回执。

## 3. Cloud 合同、状态机与数据库

- [ ] 3.1 升级 collaboration contracts，增加 Worker availability、Project Membership/content readiness、content provisioning intent/attestation/binding、Task execution/file intent/review/recovery 的 strict versioned schemas。
- [ ] 3.2 保持 OIDC JIT 为唯一 User 创建路径并使 pairing 仅绑定 endpoint；删除匿名 pairing 与 first-pairing user creation。
- [ ] 3.3 实现每 Project 唯一 Coordinator Agent、动态 User/精确 Worker Agent 选择、Coordinator transfer 和权限 fencing。
- [ ] 3.4 实现 offer/accept/reject/timeout/revoke/reassign、每次新 executionId、expected revision/idempotency 和旧 execution 全写入 fencing。
- [ ] 3.5 实现 Project Membership、Provider observation/content readiness、Task authority 三套独立状态及普通成员/Owner 失权降级规则。
- [ ] 3.6 实现 provisioning intent/attestation verification/binding saga、dynamic add、removal pending、closed/degraded lifecycle 和 durable recovery journal。
- [ ] 3.7 实现 Project plan、HumanNeeded to Owner、result review accept/request-revision、Project Record/final summary 与 visible recovery actions。
- [ ] 3.8 添加 forward-only PostgreSQL migrations、从所有受支持旧 schema 的升级测试、transactional Inbox/receipt 和 restart recovery。
- [ ] 3.9 完成 REST/SDK/WSS contract、authorization matrix、rate/bounds/redaction、revision/idempotency 和运维恢复手册。

## 4. Content Space 与 OpenContent 真实系统通道

- [ ] 4.1 从 E1 donor 重写 generic `system-download`/`system-upload-new` 合同、Content Space capability/service、Domain SDK system grant 和源/packaged composition。
- [ ] 4.2 实现 execution-bound Workspace relative path、realpath/symlink/no-overwrite/bounds、bytes/SHA-256 和 exact transfer receipts。
- [ ] 4.3 实现 portable Project root/file resolver，metadata 仅验证 locator/ancestry，不授予 ACL；资源绑定 caller/Principal/Workspace/execution。
- [ ] 4.4 在 OpenContent download 中接入真实 DownloadCheck，并保证授权结果早于 Host 打开目标；增加 metadata-visible-but-unauthorized 测试。
- [ ] 4.5 在 OpenContent upload-new 中接入真实 Provider write、collision/unauthorized/outcome_unknown 分类和 exact write-after-observation。
- [ ] 4.6 复用真实 create/list/add/remove/list Team Administration 路径和 Provider Directory Principal Reference，不增加 Project/provider 特权端口或 identity inference。
- [ ] 4.7 实现 exact finite provisioning batch approval 与 one-use per-operation proofs，任何 revision/operation drift 都要求重新确认。
- [ ] 4.8 删除生产 Mock Content Space、fallback、metadata ACL helper 和重复传输入口；测试 mock 只从测试入口可达。

## 5. 本地 Collaboration Agent 执行

- [ ] 5.1 将 domain-collaboration 改为只消费 token-free transport，并保留独立 Agent machine credential、presence/WSS、durable Inbox/outbox。
- [ ] 5.2 实现每 Agent Device 本地持久 `manual | automatic` 策略、统一 preflight、显式 accept/reject reason，确认 Cloud 无 acceptancePolicy。
- [ ] 5.3 实现 Worker availability 发布、Runtime capability tags、active Task count、Provider identity/current Project readiness 与 heartbeat projection。
- [ ] 5.4 从 B donor 重写 Worker runner，使用 runtime-neutral AgentRuntime、当前 execution journal 和真实 Content Space system channel。
- [ ] 5.5 实现 accept 后重启恢复、WSS reconnect/inbox refill、duplicate offer/ACK 幂等、Device/membership/execution fencing 和迟到外部结果 journal。
- [ ] 5.6 实现 Worker HumanNeeded、真实 Runtime transformation、结果/file reference submission 和 provider_not_ready fail-closed。

## 6. Project Coordinator 模块与 HCI

- [ ] 6.1 新建独立 `@sciforge/domain-project-coordinator`，提供 main/renderer entrypoints、manifest/generated composition 和明确 public contracts。
- [ ] 6.2 从 B donor 重写 Project create/focus、Runtime plan、按 User 分组的 Worker availability、精确 Agent 选择和 Task dispatch UI。
- [ ] 6.3 实现 plan confirmation/edit、pending approval 默认可见、HumanNeeded Owner answer、accept/request-revision 和 Project completion UI。
- [ ] 6.4 实现 Owner Desktop provisioning/reconcile orchestrator、Device-signed attestation、dynamic add/removal pending 和 Owner root loss recovery HCI。
- [ ] 6.5 实现 outcome_unknown exact observation/link-or-abandon 流程，禁止无 observation 的 mark-success。
- [ ] 6.6 实现 Coordinator transfer HCI 和旧 Coordinator fencing 反馈；与 identity/collaboration/content-space 只通过标准 contracts/contributions 组合。

## 7. 隔离 Run-0 部署

- [ ] 7.1 新增 `cloud-run0.sciforge.cn`/`login-run0.sciforge.cn`/`SciForge-Run0` 独立 Keycloak、Cloud、PostgreSQL、Compose、secret 和 backup artifacts。
- [ ] 7.2 增加安全 preflight，验证 database/role/container/network/volume/issuer 与公网部署完全不同，脚本无默认公网 mutation 目标。
- [ ] 7.3 配置 Run-0 self-registration/PKCE/JIT/Device 与固定 issuer/audience/TLS，DNS 缺失时返回 `awaiting_dns` 且无旧 issuer fallback。
- [ ] 7.4 部署新 stack、执行 migration/health/backup/restore smoke，并记录脱敏 image/schema receipt；既有 A 部署保持 byte/state 不变。

## 8. 自动化、packaged 与真机验收

- [ ] 8.1 完成 contracts、server、identity、collaboration、coordinator、Content Space/OpenContent focused tests 和 changed-file lint/typecheck。
- [ ] 8.2 运行 package boundary、private-import、generated composition freshness、capability governance、secret audit 和 full regression tests。
- [ ] 8.3 验证 source app 的真实生产 composition，并构建同一 exact commit 的 packaged artifact；验证 packaged app 无 mock/fallback 和 Run-0 配置漂移。
- [ ] 8.4 准备 U0-U4 合成账号/议程/需求、三文件 Task、HumanNeeded、reject/reassign、review/revision 和 completion 验收脚本。
- [ ] 8.5 在至少三台机器/独立 VM 的五个 packaged profiles 上完成真实 OIDC、Device/Agent、OpenContent provisioning 与并发会议 happy path。
- [ ] 8.6 完成 restart、WSS refill、duplicate、old execution fence、Device revoke、Coordinator transfer、Provider removal 和 outcome_unknown recovery matrix。
- [ ] 8.7 下载最终文件并验证底层 bytes/SHA-256，生成不含秘密的 verification receipt；未满足 DNS/设备门禁时精确标记 `awaiting_dns`/`awaiting_real_devices`。

## 9. 清理与交付

- [ ] 9.1 审计并删除旧 anonymous pairing、Token duplication、0.2 parallel contract、mock/fallback、private cross-boundary import、domain/provider hard-code、dead file/export/dependency。
- [ ] 9.2 按 docs、identity、cloud、content-space、collaboration/coordinator、deployment/E2E 的逻辑系列提交 commits，并在每次提交后保持 OpenSpec checkbox 与真实进度一致。
- [ ] 9.3 推送 `codex/full-collaboration-loop` 到个人 Fork；只在所有必需门禁通过并经 User 确认后准备 upstream PR。
