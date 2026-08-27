# 实施任务：统一用户、手机与 SciForge 多人协作

## 1. 合同与包边界

- [x] 1.1 在 `@sciforge/collaboration-contracts` 中定义 strict UserPrincipal、HumanEndpointBinding、AgentNode、ParticipantProfile、RemoteSessionProjection、ProjectInput、Project、Task、ProjectRecord、InboxMessage、receipt 和 typed error schema。
- [x] 1.2 为所有 REST、WebSocket、provider event、Agent inbox 和 capability input/output 建立判别联合与共享 fixtures；未知字段必须拒绝。
- [x] 1.3 建立 `@sciforge/collaboration-server`、`@sciforge/domain-collaboration` 和 provider adapter 的明确公共入口；领域包分别提供 main/renderer entrypoint。
- [x] 1.4 通过 `sciforge.domain.json` 和生成式 composition 安装领域与 adapter；增加架构测试，禁止 Host 私有导入、中央领域/provider map、provider ID 分支和重复执行/镜像路径。
- [x] 1.5 冻结 ID、revision、idempotency、状态机、错误码、credential redaction 和版本兼容规则。

## 2. 统一用户与端点身份

- [x] 2.1 实现 UserPrincipal 生命周期、登录主体和 suspended/revoked 行为，使 Project 成员、Agent owner 和 HumanNeeded 都引用稳定 userId。
- [x] 2.2 实现 Human Endpoint 短期 challenge、provider sender 验证、唯一绑定、assurance、暂停、撤销和显式转移。
- [x] 2.3 实现 SciForge device registration、稳定 agentId、ownerUserId、device credential secret、心跳、撤销和凭据轮换。
- [x] 2.4 实现 ParticipantProfile，允许用户从自己拥有的端点和 Agent 中显式选择 primary，禁止最近在线或跨用户回退。
- [x] 2.5 增加身份冲突、显示名修改、重复 challenge、端点被盗、Agent 被盗、owner 转移和撤销后的安全测试。
- [x] 2.6 审计 settings、日志、诊断、二维码、测试 fixture、导出和 Git 文件，确保不存在长期 token、API key、challenge、密码或私钥。

## 3. 云端协作内核

- [x] 3.1 使用一个服务和一个 PostgreSQL schema 实现 User、Endpoint、Agent、Participant、Project、Task、ProjectRecord、Inbox 和 Receipt repository。
- [x] 3.2 实现统一 authentication context，区分 user credential、human endpoint identity 和 agent device identity，并执行 owner/member/role/assignee/assurance 授权。
- [x] 3.3 实现 Project/Task 状态机、Coordinator 唯一性、expected revision、idempotency key 和 typed conflict/error。
- [x] 3.4 在同一数据库事务中提交状态变化、审计和 InboxMessage；WebSocket 只发送 `inbox.available`，客户端通过 sequence 拉取并 ack。
- [x] 3.5 实现服务重启恢复、离线信箱、cursor、bounded retention、重复请求 reconciliation 和被撤销凭据的即时拒绝。
- [x] 3.6 实现 Project Record 访问控制与接受流程，禁止个人 transcript、凭据、本地路径或完整工具日志自动进入云端共享记忆。

## 4. Zulip 与 Human Gateway

- [x] 4.1 定义通用 Human Endpoint Provider 合同，覆盖身份验证、事件游标、locator、发送、topic rename/move、重试、自回声过滤和 redacted diagnostics。
- [x] 4.2 把 Zulip realm、bot、stream/topic lookup、event queue 和 send 逻辑迁入 provider adapter；通用 server core 和 Host 不出现 Zulip 分支。
- [x] 4.3 实现 locator 到稳定 personal projection 或 Project binding 的唯一解析；歧义、缺失和 revision 不一致必须失败关闭。
- [x] 4.4 实现 ProjectInput 创建、member/role 验证、provider message dedupe 和 Coordinator inbox 路由。
- [x] 4.5 实现 targetUserId HumanNeeded、primary endpoint 路由、HumanAnswer receipt、过期回答和无端点 pending 行为。
- [x] 4.6 增加通知过滤，只向手机发送个人 Session、人类问题、允许的审批、重要失败/摘要和最终结果。

## 5. SciForge 协作领域包

- [x] 5.1 新建 `@sciforge/domain-collaboration`，由 main 入口拥有 Agent 注册、云端连接、durable inbox/outbox、Task 执行和 Session projection service，由 renderer 入口贡献统一协作 UI。
- [x] 5.2 只通过 domain SDK 的通用 AgentRuntime、Capability Broker、secret store、settings 和 UI contributions 接入 Host。
- [x] 5.3 实现 Participant 状态页，组合显示同一 userId 下的手机端点与 Agent，同时分别显示验证、assurance、在线和撤销状态。
- [x] 5.4 实现 Agent/primary Agent 选择、云端连接状态、Project/Task 列表、错误诊断和显式恢复操作。
- [x] 5.5 确保个人消息和协作 Task 使用同一 canonical Agent execution host 与审批路径，不增加 provider IPC、MCP 或测试旁路。

## 6. 个人 Session 投影与同步

- [x] 6.1 实现稳定 projection persistence：云端只保存 ownerUserId、agentId、endpoint 和 provider locator，本地 Agent 单独保存 projectionId 到 runtime/thread/workspace 的唯一映射。
- [x] 6.2 实现 share/link existing Session、new Session、rename、pause/resume、close、relink 和 status；桌面焦点不得重定向 projection。
- [x] 6.3 实现每 projection durable ordered queue 和 receipt ledger，覆盖 local/remote origin、sender identity、local item/turn、remote message、hash、attempt 和终态。
- [x] 6.4 实现手机入站一次写入本地 thread、桌面 user message 镜像、最终 assistant reply 镜像、provider retry、自回声过滤和启动恢复。
- [x] 6.5 实现默认 owner-only 和显式 shared allowlist；shared UI 必须显示实际执行 Agent owner，sender 不得隐式分叉 Session。
- [x] 6.6 限制首期为 append-only 文本和最终回复；编辑、删除、reaction、流式 delta 和任意附件不改变本地历史。

## 7. 多用户 Project 协作

- [x] 7.1 实现 Project 创建、member user、Coordinator Agent、手动转交和 role/owner 校验。
- [x] 7.2 实现结构化 User-level Task offer/claim/withdraw/timeout/progress/result/failure/needs-human 状态，向 workerUserId 的合格运行时广播，首个原子 claim 绑定 Agent/Device Execution，并用 revision 防止过期结果。
- [x] 7.3 在本地记录 active taskId/revision/turn，Agent 断线重连后报告实际状态，不重复执行或覆盖已改派 Task。
- [x] 7.4 实现 Coordinator 单写者和星形协作；Worker 只能更新自己 Task、提交 observation/result 或提出子任务建议。
- [x] 7.5 实现每 Project Task/轮次/重试预算和明确终止；Coordinator 离线时暂停并允许有权用户显式转交，不自动选主。
- [x] 7.6 实现 Project topic 作为 ProjectInput/通知投影，禁止映射为全体成员共同拥有的私人 Session。
- [x] 7.7 实现 Project Record 的 observation/proposal/decision/summary 接受路径和作者、Agent、Task、revision provenance。

## 8. 权限与安全治理

- [x] 8.1 为 personal message、ProjectInput、Task、HumanNeeded、HumanAnswer 和 capability approval 建立 actor/target/role/assurance 权限矩阵。
- [x] 8.2 远端触发继续使用本地模型、模式、workspace policy 和 capability broker；没有显式 remote-approval policy 时手机只能查看 pending。
- [x] 8.3 增加越权测试：A 访问 B 私人 projection、A 代答 B、非成员写 Project、非 assignee 完成 Task、撤销 endpoint/Agent 后继续请求。
- [x] 8.4 对所有 API、WebSocket、provider 和日志路径执行 redaction、rate limit、bounded payload、audit 和 credential rotation 测试。

## 9. 删除旧路径与迁移

- [x] 9.1 删除旧 workspace-channel binding、topic-derived config ID、`/use project` 和 `/new` 静默 retarget 行为。
- [x] 9.2 删除 Host-owned Zulip/remote-channel runtime、provider IPC、Connect Phone provider 分支、renderer duplicate mirror tracking、陈旧 settings、tests、exports 和 dependencies。
- [x] 9.3 提供一次性升级流程：验证云端用户、绑定手机 endpoint、注册 Agent、选择 primary Agent、重新链接个人 Session；不得保留 runtime compatibility facade 或双 registration。
- [x] 9.4 重新生成 composition，并验证 source 和 packaged application 中只有统一协作领域生产路径。

## 10. 验证与文档

- [x] 10.1 合同测试覆盖稳定 ID、严格 schema、中文 locator、身份冲突、revision、幂等、redaction 和状态机。
- [x] 10.2 Fake provider/server/runtime 集成测试覆盖双向 Session、ProjectInput、Task、离线恢复、重复事件、撤销和审批治理。
- [ ] 10.3 Zulip 验收覆盖六个用户各自手机/Agent 绑定、两个个人 Session、一个 Project topic、两个并行 Worker、定向 HumanNeeded 和 Coordinator 转交。
- [x] 10.4 Renderer 测试覆盖 Participant 组合展示、无 Project 完成绑定、primary Agent 切换、Session 分享、Project 状态和显式错误。
- [x] 10.5 运行 package boundary、generated composition freshness、capability governance、typecheck、focused/full tests、changed-file lint 和 packaged smoke tests。
- [x] 10.6 更新中文用户及运维文档，区分 User、手机端点、Agent、个人 Session、Project topic、Task、在线依赖、权限保证和故障恢复。
