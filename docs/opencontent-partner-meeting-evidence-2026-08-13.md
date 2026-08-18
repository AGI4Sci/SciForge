# OpenContent 技术沟通证据记录（2026-08-13）

> **迁移状态：历史外部证据。** 该记录只用于形成待验证假设，不改变当前 OpenSpec readiness，也不授权提前开展 Shared Documents 或 Document adapter 工作。
>
> 证据类型：厂商会议口头说明与现场演示摘要。
> 原始纪要：`/Users/ares/Desktop/Meeting_with_opencontent_tech.md`。
> 使用限制：本记录可以缩小核验范围、提出合同测试，但不能单独使任何 production Gate 通过。

## 厂商口头说明

- Agent 在线正文编辑仅面向 OpenContent 轻文档 `.mdoc`；Office 文件不支持局部语义编辑，只能下载、修改并上传新文件版本。
- `.mdoc` 正文读取和回写不通过当前离线 SDK，而通过尚待交付的“轻文档编辑 Skill 包”。会议演示了把文档中的 Python 内容改成 Java；Skill 包尚未交付 SciForge 审计。
- OpenContent 不支持用户自助注册；账号由管理员创建或通过组织同步导入。厂商表示可以结合第三方身份调用账号创建接口进行自动创建和绑定。
- Token 默认有效期为一天，在有效期内持续使用会续期；同一账号产生新 Token 后，旧 Token 会立即失效。

## 当前证据判断

- Skill 包是候选 Provider 实现，不是已验证的 Shared Documents 能力。演示没有证明结构化 snapshot、稳定语义 ID、authoritative revision、原子条件写、冲突、幂等、结果查询或审计合同。
- Office 的下载—修改—上传属于未来 Content Space 文件版本操作候选，不能冒充 Shared Documents 的结构化编辑。
- Token 的“一天、续期、互踢”只是口头规则。idle/absolute TTL、最大寿命、续期机制、API/浏览器/Skill/不同节点之间的失效作用域和错误码均未明确。
- 账号创建、组织同步和第三方身份绑定属于未来身份 provisioning/账号生命周期能力，不属于 Shared Documents 或 Content Space V1 的内容操作合同。

## Skill 包到件后的强制验收

1. 记录交付形态、版本、hash/签名、许可证、支持与升级策略、OS/架构/runtime、网络依赖及数据处理位置。
2. 确认 Skill 可作为 main-only OpenContent adapter 的内部依赖；不得注册独立 Agent Tool、MCP、IPC、审批或凭据路径。
3. 确认它不使用 DOM 自动化、私有网页协议、浏览器 Cookie、管理员账号、integration key、raw CRDT 或整篇覆盖。
4. 取得版本化 structured snapshot schema、稳定语义 ID、支持/只读节点类型和 authoritative revision。
5. 取得确定性的 typed insert/replace/delete 操作。prepare 必须无副作用并冻结操作、预览与 digest；apply 必须原样提交已确认的操作，不能再次执行自然语言规划。
6. 证明服务端将 `expectedRevision` 与写入原子比较，stale revision 返回 typed conflict 且没有部分写入。
7. 证明 durable idempotency、operation status lookup、resulting revision 和 bounded audit reference。
8. 证明调用使用当前逐用户 Provider Connection，不保存、记录、回显或在 URL 中传输 Token。
9. 说明 Skill 是否调用自带或第三方模型、正文处理区域、retention/training、telemetry 和 crash dump；未通过 SciForge 模型数据出境策略前不得启用正文能力。
10. 运行端到端验收：读 R1 → Human 浏览器改为 R2 → apply(expected R1) 冲突 → 重新读取/准备/确认 → 成功 R3；随后覆盖重复提交、响应丢失、撤权和 Token 被另一会话替换。

## 仍需厂商书面确认和实测

- 同一用户在 API 节点 A、系统浏览器、API 节点 B 和轻文档 Skill 中依次登录/调用时，哪些 Token 或 Cookie 被替换。
- 一天是 idle、fixed 还是 absolute TTL；哪些调用触发续期，是否产生新 Token，是否有 absolute maximum 和 refresh rotation。
- `expired`、`superseded`、`revoked`、`disabled` 是否有稳定可区分错误，以及 introspection、logout、revoke-current、revoke-all 合同。
- “第三方认证”具体是 OIDC/OAuth2、SAML、SCIM 还是私有 provisioning；稳定 tenant + immutable subject、whoami/introspection、link/unlink、防账号接管、停用和审计合同是什么。
- 纪要中的“设备级独立账号”究竟指每设备独立 session，还是每设备创建不同用户。SciForge 生产身份必须代表具体 Human，不能用设备账号替代用户身份。

## 对当前方案的影响

- Shared Documents V1 的完成定义不变：`.mdoc` 结构化读取和安全语义编辑仍是硬条件。
- Q16/Q19 的跨节点引用与节点本地 Provider Connection 边界不变；不得为绕过互踢而转发 Token、共享管理员账号或静默自动重登。
- 同一 Human 的 API/API、API/浏览器和 API/Skill 会话共存是 production V1 的硬门槛；在厂商合同和实测通过前不得宣称这些组合可并发使用。
- 本次会议不产生新 ADR，也不改变已确认的 bounded-context 决策；是否接受单活节点限制，必须另行作出显式产品决策。

## 已确认的产品决策（Q46）

PoC 可以在显著标记为 `poc_only` 的前提下临时限制为每位 Human 一个活动 API 节点。Production V1 必须取得并验证 API/API、API/浏览器和 API/Skill 的会话共存合同。不得通过共享 Token、管理员账号、设备独立用户或静默重新登录规避限制。只有产品未来明确接受永久单活限制时，才另建 ADR 记录可用性、故障切换和用户体验代价。
