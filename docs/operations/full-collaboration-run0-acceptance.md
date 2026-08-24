# Run-0 真实多用户会议闭环验收

本文件是 `add-full-multi-user-collaboration-loop` 的人工与自动验收基线。它冻结证据要求，不是产品中的硬编码角色、用户数量、文件名或 Provider 限制；产品本身必须支持动态 User、Device、Agent、Project Member 和 Task。

## 完成状态

| 状态 | 含义 |
| --- | --- |
| `awaiting_dns` | `cloud-run0.sciforge.cn` 或 `login-run0.sciforge.cn` 的 DNS/TLS/issuer 尚不满足冻结合同；不得借用旧 issuer。 |
| `awaiting_real_devices` | 代码、source 和 packaged 自动门禁可通过，但尚未提供至少三台物理机或独立 VM 上的五个独立 packaged Desktop profile。 |
| `incomplete` | 必需步骤尚未执行或证据不足；回执必须逐项标记 `not_run`/`blocked`。 |
| `failed` | 一个必需门禁执行后失败。 |
| `passed` | 部署隔离、source、packaged、五设备 happy path、恢复矩阵、完整性和秘密审计全部通过。 |

`passed` 不代表公网生产化，也不声称邮件验证、MFA、签名公证、完整灾备或公开发布门禁已完成。

## 冻结部署边界

- Cloud origin：`https://cloud-run0.sciforge.cn`
- OIDC issuer：`https://login-run0.sciforge.cn/realms/SciForge-Run0`
- Keycloak realm：`SciForge-Run0`
- Desktop：Authorization Code + PKCE S256 的 public client
- 身份：OIDC JIT 是唯一 User 创建/查找路径；pairing 只绑定通信端点
- 数据：独立 PostgreSQL database/role、Compose project、container、network、volume、credentials、backup directory 和 migration history
- 公网 A 部署：只读对照，不执行 migration、重启、配置写入、数据写入或凭据复用

Run-0 预检必须记录隔离资源的脱敏名称/digest，并证明它们与公网资源不相同。DNS 未就绪即停止在 `awaiting_dns`，不接受 `/etc/hosts`、issuer override、HTTP 或旧 realm 作为正式 live 证据。

## 设备与角色矩阵

五个 profile 必须安装同一 exact commit 生成的同一 packaged artifact，拥有不同 user-data directory、原生安全存储、Device、Agent、Agent machine credential、Runtime 配置和 OpenContent account。

| Fixture | Project 职责 | 接单策略 | 必需行为 | 设备要求 |
| --- | --- | --- | --- | --- |
| U0 | Project Owner + 初始 Coordinator Agent | 任意 | 创建/确认计划、provision、回答 HumanNeeded、复审、完成 Project | 独立 Desktop profile |
| U1 | Worker Agent | `manual` | 手动接受一个文件 Task 并提交真实结果 | 独立 Desktop profile |
| U2 | Worker Agent | `automatic` | 本地 preflight 后显式自动接受，并向 U0 发起 HumanNeeded | 独立 Desktop profile |
| U3 | 首选 Worker Agent | `manual` | 显式拒绝一个 offer 并给出有界原因 | 独立 Desktop profile |
| U4 | 替代 Worker Agent | 任意 | 接受 U3 被改派的全新 execution 并完成结果 | 独立 Desktop profile |

五个 profile 至少分布在三台物理机器或相互独立的 VM。一个物理机上的多个普通进程、共享 user-data、测试 harness 或 source renderer 不算独立设备。

## 合成会议输入

Project 名称固定为“多用户协作设计评审会”。输入只使用合成数据，并至少包含：

- `agenda.md`：会议目标、议题、时限、需要决策的架构问题；
- `requirements.md`：用户动态加入、单 Coordinator、精确 Worker Agent、真实 Content Space、拒绝改派、HumanNeeded、复审和恢复要求；
- 一个可公开的合成风险/约束列表，禁止真实组织秘密、个人信息、Token、密码或 Provider credential。

Coordinator 与 Worker 必须使用各自 Desktop 当前配置的真实 AgentRuntime/模型。回执记录 Runtime/模型 ID 和版本，不记录完整 prompt、隐藏 reasoning、API key 或登录材料。

## Happy path

### 1. 身份、Device 与 Agent

1. U0–U4 分别通过 Run-0 system-browser OIDC 注册/登录。
2. Cloud 只通过 OIDC JIT 创建/找到五个 Canonical User。
3. 每个 Desktop 注册独立 `ACTIVE` Device。
4. 每个 Human 配置至少一个真实 AgentRuntime；在这之前不得创建 Agent。
5. 每个 Device 创建一个 active Agent，并建立 Agent-authenticated presence/WSS。
6. 每个 Human 在自己的 Desktop 输入真实 OpenContent credential、绑定自己的 Provider account，并发布 Device/Principal 证明的非秘密 Provider Directory Principal Reference。

证据包括脱敏 User/Device/Agent 对应关系、Device 状态、Runtime readiness、Provider identity readiness 和无秘密审计结果。

### 2. Project 与 Content provisioning

1. U0 选择自己当前 Device 上的精确 Agent 作为唯一 Coordinator，创建 Project。
2. Cloud 原子保存 Project、Member、content owner、exact Provider members 和 provisioning intent；Project 为 `provisioning/paused`。
3. U0 HCI 展示 exact revision 的有限操作计划，并由 Human 确认一次。
4. U0 Desktop 通过标准 Content Space path 创建恰好一个 shared Content Container，逐个添加 exact Provider members，并重新读取完整成员列表。
5. Content Space 返回 exact root/member receipts；Identity/Host 以 U0 当前 Device key 签署 canonical provisioning digest。
6. Cloud 验证 Owner、Device、signature、intent revision、root/member digests 后建立 binding 并激活 Project。

不得出现 Cloud 直接调用 OpenContent、共享管理员 credential、Project DTO 进入 Content Space、生产 Mock 或“数据库写入即 ACL 成功”的表述。

### 3. 真实计划与并行 Task

1. U0 Coordinator Agent 从 Project Content Directory 真实下载合成 agenda/requirements。
2. U0 的 AgentRuntime 生成可编辑 Project plan；Human 在 HCI 中确认或修改。
3. Coordinator 从按 User 分组的 availability projection 选择精确 Agent，并创建三个并行最终产物 Task：
   - `architecture-review.md`
   - `meeting-minutes.md`
   - `risk-register.md`
4. U1 手动接受其 offer；U2 经本地 preflight 自动发送 accept；U3 显式 reject。
5. Coordinator 选择 U4 的精确 Agent 重新分派 U3 Task；Cloud 创建新的 `executionId` 并 fence U3 旧 execution。
6. U1/U2/U4 分别真实下载输入、使用本机真实 Runtime/模型转换、通过 OpenContent real upload-new 提交各自输出。
7. U2 在执行中创建 HumanNeeded；只有 U0 的 OIDC Human 可回答，答案回到同一 execution。

每个文件 transfer 的底层 evidence 必须含 exact resource/root、bytes、SHA-256、execution 和 operation observation；最终 Human 回执可只投影 `integrityVerified: true`。

### 4. 复审与完成

1. U0 Coordinator HCI 默认可见 pending HumanNeeded、计划确认和结果审阅卡。
2. U0 至少对一个结果执行 `accept`，对另一个结果执行一次 `request_revision`。
3. 被要求修订的 Worker 接受新 revision/execution，真实修改并上传新的 no-overwrite 输出名称或按冻结合同关联精确 observed output。
4. U0 接受三个当前结果，形成带 User/Agent/Task/execution/revision provenance 的 Project Record 和 final summary。
5. 由授权 Desktop 重新下载三个最终文件，验证底层 bytes/SHA-256。
6. U0 显式完成 Project；Cloud 关闭业务写入，而 OpenContent Team/目录和内容继续存在。

## 恢复矩阵

每项必须在 production composition 上执行并给出 before/action/after 的脱敏 timeline：

| ID | 故障注入 | 必须观察到的结果 |
| --- | --- | --- |
| R1 | Worker accept 后重启 | 同一 `executionId` 从本地 journal 与 Cloud 状态恢复，不重复 Runtime turn 或外部写。 |
| R2 | WSS 断开后 Cloud 写入 Inbox | 重连只提示可用；客户端按 sequence refill/ACK，不丢失、不重复执行。 |
| R3 | 重复 offer 与 ACK | 相同 idempotency key 返回同一事实，revision 不重复推进。 |
| R4 | U3 reject 后迟到提交旧 execution | Cloud 以 fenced 拒绝 Task/result/file association；Provider late fact 只进 recovery journal。 |
| R5 | Worker Device revoke | Principal/Agent/file operations 停止，Cloud 拒绝新接单与旧 execution 写。 |
| R6 | Owner 显式 transfer Coordinator | 新 Agent 成为唯一 Coordinator，旧 Agent 的 coordinator-only 写立即 fenced。 |
| R7 | 普通成员在 OpenContent Team 中被移除 | metadata 可见不算通过；真实 DownloadCheck/upload denied，该 User degraded，其他成员继续。 |
| R8 | Owner 对 Project root 失权 | binding degraded，所有文件 Task 暂停；纯文本 Task按类型决定，等待 rebind/reprovision/change owner。 |
| R9 | 外部 upload 响应不确定 | execution 进入 `manual_recovery_required`；先 exact observe，可关联 exact output，否则 abandon 并用新 execution/output name。 |
| R10 | Owner 发起 Cloud Member removal 且 Provider 暂不可用 | 先 `membership_removal_pending` 并 fence 该 User；状态不回滚，之后由 Owner Desktop 恢复精确 Provider removal。 |

任何 recovery 未执行都必须记录为 `not_run` 或 `blocked`，不得用单元测试或推理代替 live 证据。

## 自动与 packaged 门禁

在 live 前至少记录：

- changed packages 的 focused tests、typecheck 和 lint；
- collaboration contracts/server/identity/coordinator/Content Space/OpenContent tests；
- package boundary、Host private import、domain/provider hard-code 和 duplicate path audit；
- manifest/generated composition freshness 和 capability governance；
- secret audit；
- full regression；
- source production-composition smoke；
- packaged production-composition smoke；
- exact packaged artifact digest、platform/arch 与 commit。

测试入口可用 Fake/Mock；source/packaged production composition 和 live 路径不得发现或调用它们。

## Verification receipt schema

最终回执使用 JSON 或等价严格结构，至少包含：

```json
{
  "contractVersion": 1,
  "status": "awaiting_dns | awaiting_real_devices | incomplete | failed | passed",
  "source": {
    "commit": "<40-hex>",
    "branch": "codex/full-collaboration-loop",
    "forkRemote": "SCU-areszhang/SciForge_Loop"
  },
  "artifacts": [{
    "platform": "<platform/arch>",
    "packageDigest": "sha256:<digest>"
  }],
  "run0": {
    "cloudOrigin": "https://cloud-run0.sciforge.cn",
    "issuer": "https://login-run0.sciforge.cn/realms/SciForge-Run0",
    "imageDigests": ["sha256:<digest>"],
    "schemaVersion": "<version>",
    "isolationVerified": true,
    "publicDeploymentMutated": false
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
    "integrityVerified": true,
    "completed": true
  },
  "gates": [{
    "id": "R1",
    "layer": "source | packaged | isolated-live",
    "status": "passed | failed | blocked | not_run | skipped",
    "evidenceRefs": ["redacted:<digest>"],
    "manualOperations": ["<bounded description>"],
    "failure": null
  }],
  "secretAuditPassed": true,
  "generatedAt": "<RFC3339>"
}
```

底层机器回执保留逐文件 bytes/SHA-256 供自动核验；Human-facing sealed receipt 可只保留 `integrityVerified`。所有实体 ID 经过稳定脱敏，禁止写入 OIDC/Agent/Provider secret、私钥、密码、Authorization header、完整 prompt 或真实敏感会议数据。
