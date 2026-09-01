# 既有 A 蓝绿升级上的 Run-0 真实多用户会议闭环验收

本文件是 `add-full-multi-user-collaboration-loop` 的人工与自动验收基线。此处 Run-0 指基于现有 A 测试环境完成蓝绿升级后的第一次 live acceptance run，不代表一套新的 DNS/issuer。它冻结证据要求，不是产品中的硬编码角色、用户数量、文件名或 Provider 限制；产品本身必须支持动态 User、Device、Agent、Project Member 和 Task。

## 完成状态

| 状态 | 含义 |
| --- | --- |
| `awaiting_candidate` | 现有 A 的备份/恢复、candidate migration/health、edge cutover 或旧 upstream 回滚尚未满足冻结合同。 |
| `awaiting_real_devices` | 代码和 source 自动门禁可通过，但尚未提供至少三台物理机或独立 VM 上的五个独立 source-app profile。 |
| `incomplete` | 必需步骤尚未执行或证据不足；回执必须逐项标记 `not_run`/`blocked`。 |
| `failed` | 一个必需门禁执行后失败。 |
| `passed` | 部署隔离、source、五 User/六 Device happy path、恢复矩阵、完整性和秘密审计全部通过。 |

`passed` 不代表公网生产化，也不声称邮件验证、MFA、签名公证、完整灾备或公开发布门禁已完成。

## 冻结部署边界

- 唯一集成分支：个人 Fork `codex/full-collaboration-loop-recovery`，从 `origin/gui@e0038b8c7109390445dccb691052fec74a153c09` 创建
- 旧 `codex/full-collaboration-loop` 与本地 WIP snapshot：只读审计/donor，不普通合并、不继承 checkbox 或验收结论
- Cloud origin：`https://cloud-test.sciforge.cn`
- OIDC issuer：`https://login-test.sciforge.cn/realms/SciForge`
- Keycloak realm：`SciForge`
- Desktop：Authorization Code + PKCE S256 的 public client
- 身份：OIDC JIT 是唯一 User 创建/查找路径；pairing 只绑定通信端点
- 数据：现有 A Cloud DB 只作为 clone source；migration 仅在独立命名的 candidate database/volume/container/network 上执行
- 现有 A：切换前先备份 Cloud DB、Keycloak DB/realm、edge 配置和 image metadata，并通过隔离 restore rehearsal；旧 Cloud app/database 保留为回滚目标
- 入口：复用现有 TLS/443 Caddy；只有 candidate 门禁通过后才能切换 `cloud-test` upstream，不新增第二个 443 listener

预检必须重新记录现有 image/schema/issuer/upstream 及 candidate 资源的脱敏名称/digest。备份、restore rehearsal、candidate migration/health 或回滚任一项缺失即停止在 `awaiting_candidate`；不接受直接迁移旧数据库、覆盖旧容器、issuer override、HTTP fallback 或未经验证的 Caddy cutover。

## 设备与角色矩阵

六个 profile 必须 checkout 同一 exact commit，并通过 canonical source build/start path 启动；U3-A/U3-B 登录同一 U3 OIDC User，其余 profile 各属独立 User。每个 profile 拥有不同 user-data directory、原生安全存储、Device、Agent、Identity-owned Agent Cloud Session、Runtime 配置和 OpenContent account。Agent machine credential 只能存在于各 profile 的 Identity 私有原生安全存储中，不得进入 collaboration package、回执或 profile 间传递。DMG、安装包和发布 artifact 不属于本次 Run-0 前置条件。

| Fixture | Project 职责 | 接单策略 | 必需行为 | 设备要求 |
| --- | --- | --- | --- | --- |
| U0 | Project Owner + 该 Owner 所有的 Coordinator Agent | 任意 | 创建/确认计划、provision、回答 HumanNeeded、复审、完成 Project | 独立 Desktop profile |
| U1 | Worker User | `manual` | 在一个 Device 上手动认领文件 Task 并提交真实结果 | 独立 Desktop profile |
| U2 | Worker User | `automatic` | 本地 preflight 后由一个 Device 自动认领并提交真实结果 | 独立 Desktop profile |
| U3-A | Worker User U3 的 Device A | `manual` | 仅在本机忽略 User Offer，不产生 Cloud reject | 独立 Desktop profile |
| U3-B | Worker User U3 的 Device B | `manual` | 收到同一广播 Offer 并赢得 claim，完成风险结果 | 额外独立 Desktop profile |
| U4 | 替代 Worker User | 任意 | 用于验证 Coordinator withdraw/reassign 后的新 User Offer | 独立 Desktop profile |

六个 profile 至少分布在三台物理机器或相互独立的 VM。一个物理机上的多个普通进程、共享 user-data、测试 harness 或 source renderer 不算独立设备。

明早的 cold-clone、exact-commit 前检、独立 profile 启动和现场停线条件见
[五人现场执行单](./full-collaboration-run0-five-person-field-guide.zh-CN.md)。五人基线不得安装
`opencontent-base.zip`；先证明公开 Provider 在无 Skill 时可用，Skill 只允许在基线回执完成后
作为独立可选验收安装。

## 合成会议输入

Project 名称固定为“多用户协作设计评审会”。输入只使用合成数据，并至少包含：

- `agenda.md`：会议目标、议题、时限、需要决策的架构问题；
- `requirements.md`：用户动态加入、Project 级单 Coordinator、Worker User 广播与首 Device claim、真实 Content Space、HumanNeeded、复审和恢复要求；
- 一个可公开的合成风险/约束列表，禁止真实组织秘密、个人信息、Token、密码或 Provider credential。

Coordinator 与 Worker 必须使用各自 Desktop 当前配置的真实 AgentRuntime/模型。回执记录 Runtime/模型 ID 和版本，不记录完整 prompt、隐藏 reasoning、API key 或登录材料。

## Happy path

### 1. 身份、Device 与 Agent

1. U0–U4 分别通过现有 `login-test/realms/SciForge` system-browser OIDC 注册/登录；U3-A/U3-B 必须是同一 U3 User 的两个独立 Device。
2. Cloud 只通过 OIDC JIT 创建/找到五个 Canonical User。
3. 每个 Desktop 注册独立 `ACTIVE` Device。
4. 每个 Human 配置至少一个真实 AgentRuntime；Runtime ready 后 Identity 自动 ensure 或复用当前 Device 的唯一 active Agent。
5. 每个 Device 建立 Agent-authenticated presence/WSS，renderer 不显示手工注册或 primary 选择。
6. 每个 Human 在自己的 Desktop 输入真实 OpenContent credential、绑定自己的 Provider account，并发布 Device/Principal 证明的非秘密 Provider Directory Principal Reference。

证据包括脱敏 User/Device/Agent 对应关系、Device 状态、Runtime readiness、Provider identity readiness 和无秘密审计结果。

### 2. Project 与 Content provisioning

1. U0 从当前 Device 创建 Project；该 Device 的认证 Agent 自动成为且只成为此 Project 的唯一 Coordinator。
2. Cloud 原子保存 Project、Member、`contentOwnerUserId = ownerUserId`、Owner-owned Coordinator、exact Provider members 和 provisioning intent；Project lifecycle 为 `paused`，Content Binding lifecycle 独立为 `provisioning`。
3. U0 HCI 展示 exact revision 的有限操作计划，并由 Human 确认一次。
4. U0 Desktop 通过标准 Content Space path 创建恰好一个 shared Content Container，逐个添加 exact Provider members，并重新读取完整成员列表。
5. Content Space 返回 exact root/member receipts；Identity/Host 以 U0 当前 Device key 签署 canonical provisioning digest。
6. Cloud 验证 Owner、Device、signature、intent revision、root/member digests 后建立 binding 并激活 Project。

不得出现 Cloud 直接调用 OpenContent、共享管理员 credential、Project DTO 进入 Content Space、生产 Mock 或“数据库写入即 ACL 成功”的表述。

### 3. 真实计划与并行 Task

1. U0 Coordinator Agent 从 Project Content Directory 真实下载合成 agenda/requirements。
2. U0 的 AgentRuntime 生成可编辑 Project plan；Human 在 HCI 中确认或修改。
3. Coordinator 从 Cloud 全局在线目录选择 Worker User，并创建三个并行最终产物 Task：
   - `architecture-review.md`
   - `meeting-minutes.md`
   - `risk-register.md`
4. U1 的一个 Device 手动 claim；U2 的一个 Device 经本地 preflight 自动 claim。风险 Task 广播到 U3-A/U3-B：U3-A 仅本机忽略，U3-B claim。
5. 每次 claim 的同一 Cloud 事务才创建并绑定实际 User/Device/Agent `executionId`；其他 Device 收到 claimed 关闭提示。
6. U1/U2/U3-B 分别真实下载输入、使用本机真实 Runtime/模型转换、通过 OpenContent real upload-new 提交各自输出。
7. 另以一个未认领 Offer 验证 U0 withdraw 后向 U4 User reassign；两者都不预创建 Execution。`architecture-review.md` 与 `meeting-minutes.md` 的两个当前 Execution 必须在时间线上真实重叠。

每个文件 transfer 的 evidence 必须含 exact resource/root、execution 和真实 operation observation。实现可保留 bytes/SHA-256 作为诊断，但它们以及汇总 `integrityVerified` 暂不作为本 PoC 完成门禁。

### 4. 复审与完成

1. U0 Coordinator HCI 默认可见计划确认和结果审阅卡。
2. U0 至少对一个结果执行 `accept`，对另一个结果执行一次 `request_revision`。
3. 被要求修订的 Worker 接受新 revision/execution，真实修改并上传新的 no-overwrite 输出名称或按冻结合同关联精确 observed output。
4. U0 接受三个当前结果后，Coordinator 仅以 `coordinator_project` scope 发起一次真人决策 HumanNeeded；live happy path 不使用 `worker_execution` HumanNeeded。
5. 只有 U0 的 OIDC Human 可提交 HumanAnswer；Coordinator 收到答案后写入 decision、带 User/Agent/Task/execution/revision provenance 的 Project Record 和 final summary。
6. 由授权 Desktop 重新下载并人工核对三个最终文件；逐文件 bytes/SHA-256 暂不作为本 PoC 门禁。
7. U0 显式完成 Project；Cloud 关闭业务写入，而 OpenContent Team/目录和内容继续存在。

## 恢复矩阵

每项必须在 production composition 上执行并给出 before/action/after 的脱敏 timeline：

| ID | 故障注入 | 必须观察到的结果 |
| --- | --- | --- |
| R1 | Worker accept 后重启 | 同一 `executionId` 从本地 journal 与 Cloud 状态恢复，不重复 Runtime turn 或外部写。 |
| R2 | WSS 断开后 Cloud 写入 Inbox | 重连只提示可用；客户端按 sequence refill/ACK，不丢失、不重复执行。 |
| R3 | 重复 offer 与 ACK | 相同 idempotency key 返回同一事实，revision 不重复推进。 |
| R4 | U3-A 本机忽略后 U3-B claim | U3-A 不发送 Cloud 写；U3-B 获得唯一 Execution；任何第二次 claim 都不创建 Execution。 |
| R5 | Worker Device revoke | Principal/Agent/file operations 停止，Cloud 拒绝新接单与旧 execution 写。 |
| R6 | Owner 在自己拥有的 Agent 间显式 transfer Coordinator | 新 Owner-owned Agent 成为唯一 Coordinator，旧 Agent 的 coordinator-only 写立即 fenced；其他 User 的 Agent 不可被选中。 |
| R7 | 普通成员在 OpenContent Team 中被移除 | metadata 可见不算通过；真实 DownloadCheck/upload denied，该 User degraded，其他成员继续。 |
| R8 | 初始 content owner（即 Project Owner）对 Project root 失权 | binding degraded，所有文件 Task 暂停；纯文本 Task 按类型决定，等待 Owner rebind/reprovision。本 Run-0 不以 content-owner transfer 规避失权。 |
| R9 | 外部 upload 响应不确定 | execution 进入 `manual_recovery_required`；先 exact observe，可关联 exact output，否则 abandon 并用新 execution/output name。 |
| R10 | Owner 发起 Cloud Member removal 且 Provider 暂不可用 | 先 `membership_removal_pending` 并 fence 该 User；状态不回滚，之后由 Owner Desktop 恢复精确 Provider removal。 |

任何 recovery 未执行都必须记录为 `not_run` 或 `blocked`，不得用单元测试或推理代替 live 证据。

## 自动与源码应用门禁

在 live 前至少记录：

- changed packages 的 focused tests、typecheck 和 lint；
- collaboration contracts/server/identity/coordinator/Content Space/OpenContent tests；
- package boundary、Host private import、domain/provider hard-code 和 duplicate path audit；
- manifest/generated composition freshness 和 capability governance；
- secret audit；
- full regression；
- source production-composition smoke；
- 冻结 Cloud/OIDC 的 source-app online pre-login smoke；
- exact source commit 与每个 live profile 的脱敏运行映射。

测试入口可用 Fake/Mock；source production composition 和 live 路径不得发现或调用它们。

### Repository architecture principles gate

该门禁对本变更新增或修改的生产路径逐字执行以下冻结要求：**不得编辑 central feature map、Host 只能依赖通用 SDK、不得保留兼容 shim/双注册、不得写 showcase/provider/domain 硬编码、backend/UI 同包版本，并验证标准 source composition。** 它直接运行 changed-path generated byte-freshness、capability governance、Host/package 静态边界以及 source Electron smoke；不会接受调用方提供的“已通过”JSON。全仓模式只输出历史债务报告；除非某项直接阻断 changed collaboration path，否则不阻塞本交付，也不授权顺手重构。

```bash
npm run architecture-principles:test
npm run build
npm run smoke:electron:source:cloud
```

正式证据要求 clean exact commit 与同 commit 的 `origin` 远端分支、由该提交生成的
source `out/`，并通过 canonical Electron source launcher 运行。Cloud online smoke 必须精确
选择冻结的 origin/issuer，验证真实生产 composition 与 pre-login fail-closed 边界；它不执行
Human 登录，也不替代 7.4、8.6–8.8 的 live 证据。正式安装包/发布 artifact 验证保留在
OpenSpec 8.4，按用户指示暂缓且不阻塞当前纵向 source-app 闭环。

### Secret boundary gate

A-upgrade PoC 的秘密门禁不是关键字搜索。`scripts/collaboration-secret-audit.mjs` 会解析 package export/re-export 图和 JavaScript/TypeScript 语法树，并检查以下可解释边界：

- 公开 package contract 不得声明 OIDC Token、User/Device/Agent/Provider credential、poll secret、私钥、密码或 Authorization header；
- renderer/capability/IPC/message 不得携带这些字段；
- log/telemetry、普通文件或数据库持久化、Git 跟踪文件、operation receipt 和验收 evidence 不得接收这些值；
- Identity/Connector 私有运行代码可以在内存中使用秘密，并只可由所属 runtime 同进程写入原生 secret store，或由所属 server/provider runtime 直接读取服务器 secret file；公开跨 package port 不得提供 raw secret 的 `read`/`write`/`replace`/callback 能力，即使调用方当前都位于 trusted main process；
- redacted 值、digest、expiry metadata 和 sealed/encrypted credential 不是明文秘密。`opaque`/`handle`/`reference`/`ref`/`id` 只有在持有它不能授权读取、恢复或使用秘密时才是非秘密 locator；仅凭持有即可授权的 capability/reference 仍按秘密处理；
- 把字段改成 `credentialBytes`/`credentialPayload`、编码成 `Buffer`/`Uint8Array`、通过别名或解构转交，或经 child argv/environment/stdin/stdout/stderr、exec callback、临时文件转交，都不改变其秘密属性；
- 明确的 `.test.*`、`test-fixtures/` 合成值可以用于负向测试，但测试路径不是 production contract 的兼容豁免。本变更新增/修改的 production export graph 出现 secret-bearing 类型必须失败；无关旧 package 的发现仅报告，只有直接阻断 changed collaboration path 时才允许最小通用适配。

Host broker 的 `cap_*` resource handle 若凭持有即可授权操作，就是 bearer capability，也属于 secret boundary；capability governance、过期和 Principal fence 不能替代跨 package、IPC、日志、Git/receipt 不携密的门禁。Canonical `resourceHandleId` 只有在 Host 每次使用时同时重验 caller、audience、workspace、Principal lease 和 semantic revision，且 wrong caller/Principal/workspace/audience、伪造 ID 和 stale revision 的真实 Broker/IPC 测试都 fail closed 时，才可作为 non-authorizing locator；该结论不得泛化为对 `token`/`handle`/`ref` 的命名豁免。

```bash
node --test scripts/collaboration-secret-audit.test.mjs
node scripts/collaboration-secret-audit.mjs
node scripts/collaboration-secret-audit.mjs --explain
```

默认命令覆盖本闭环实际新增/修改的 collaboration、Identity、Content Space、OpenContent、A candidate/cutover 生产路径，以及这些路径直接使用的 Domain SDK contract；`--all` 仅用于整个仓库的扩展诊断，不改变本次阻塞范围。任一 finding 只输出文件、行号和规则类型，不回显命中的秘密材料。

## Verification receipt schema

最终回执使用 JSON 或等价严格结构，至少包含：

```json
{
  "contractVersion": 1,
  "status": "awaiting_candidate | awaiting_real_devices | incomplete | failed | passed",
  "source": {
    "commit": "<40-hex>",
    "branch": "codex/full-collaboration-loop-recovery",
    "forkRemote": "SCU-areszhang/SciForge_Loop"
  },
  "sourceRuntime": {
    "platform": "<platform/arch>",
    "composition": "source/out"
  },
  "environment": {
    "kind": "existing-a-blue-green-upgrade",
    "cloudOrigin": "https://cloud-test.sciforge.cn",
    "issuer": "https://login-test.sciforge.cn/realms/SciForge",
    "imageDigests": ["sha256:<digest>"],
    "schemaVersion": "<version>",
    "backupRestoreVerified": true,
    "candidateMigrationVerified": true,
    "cutoverVerified": true,
    "rollbackTargetRetained": true
  },
  "devices": [{
    "fixture": "U0",
    "userRef": "redacted:<digest>",
    "deviceRef": "redacted:<digest>",
    "agentRef": "redacted:<digest>",
    "runtimeId": "<non-secret id>",
    "modelId": "<non-secret id>"
  }],
  "project": {
    "projectRef": "redacted:<digest>",
    "provisioningRevision": 1,
    "provisioningVerified": true,
    "completed": true
  },
  "gates": [{
    "id": "R1",
    "layer": "source | live",
    "status": "passed | failed | blocked | not_run | skipped",
    "evidenceRefs": ["redacted:<digest>"],
    "manualOperations": ["<bounded description>"],
    "failure": null
  }],
  "secretAuditPassed": true,
  "generatedAt": "<RFC3339>"
}
```

底层机器回执可保留逐文件 bytes/SHA-256 作为自动诊断，Human-facing receipt 可省略逐文件值及 `integrityVerified`；二者都不阻塞本 PoC。所有实体 ID 经过稳定脱敏，禁止写入 OIDC/Agent/Provider secret、私钥、密码、Authorization header、完整 prompt 或真实敏感会议数据。
