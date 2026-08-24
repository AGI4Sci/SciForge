## Purpose

定义 Project Task 在 Worker 本机通过真实 Provider 与 Workspace 传递文件、生成结果、提交精确引用并在权限变化或外部写不确定时安全恢复的唯一执行合同。

## ADDED Requirements

### Requirement: 文件 Task 使用结构化 Task File Intent

Cloud Task SHALL 以严格、版本化 `TaskFileIntent` 描述输入 portable references、目标 Project Content Directory、输出名称/类型、Task 与 `executionId`，而不得包含 Provider credential、Connection、endpoint、raw local path、可执行 Broker handle 或另一个 User 的身份材料。每次改派 SHALL 产生绑定新 `executionId` 的新 intent。

#### Scenario: Coordinator 尝试指定 Worker Provider Connection

- **WHEN** Task payload 包含 Connection ID、Token、endpoint 或 account hint
- **THEN** strict contract SHALL 在投递前拒绝 payload
- **AND** Worker 只能使用自己当前 Principal 的本机 Provider Connection。

### Requirement: Portable reference 在执行节点重新授权

Portable resource reference SHALL 是版本化、非秘密、非授权的资源描述。Worker 接受文件 Task 后 SHALL 在当前 User、ACTIVE Device、Project membership/content readiness、exact binding revision 和本机 Provider session 下解析并重新授权；Host SHALL 只签发 caller/Principal/Workspace/execution-bound process-local resource。

#### Scenario: 引用合法但 Worker 不再是 Provider member

- **WHEN** Worker 能解析 root/file identity 但 operation-time Provider authority 失败
- **THEN** Host SHALL 不签发或继续使用 executable resource
- **AND** execution SHALL 按 unauthorized/degraded 路径停止。

### Requirement: 下载在打开本地目标前执行真实 DownloadCheck

对 OpenContent 文件的 Project download SHALL 先验证 portable locator 与绑定 root 的 metadata ancestry，再通过当前 Worker Provider session 对精确文件执行真实 `DownloadCheck`。只有该检查明确授权且 execution/device/membership fence 仍有效时，Host 才 SHALL 创建 no-overwrite Workspace 临时目标并接收 bounded bytes。Metadata、folder-info、known ID、parent observation 或 Cloud Membership SHALL NOT 代替 DownloadCheck。

#### Scenario: Metadata 可见但 DownloadCheck 未授权

- **WHEN** Provider 返回 file metadata/parent 但 DownloadCheck 返回 unauthorized
- **THEN** Host SHALL 在打开目标前失败
- **AND** Workspace SHALL 不产生空文件、临时文件或部分结果。

### Requirement: 上传以真实 Provider operation 作为权限门禁

Project upload SHALL 从 execution-bound Workspace 的 validated relative path 读取有界 regular file，并仅通过当前 Worker Principal/Provider session 和已授权 Project directory resource 执行 no-overwrite upload-new。Provider 的真实写操作 SHALL 是最终 ACL enforcement；Cloud membership、attestation、metadata pre-read 或本地缓存 SHALL NOT 使未授权写入成功。

#### Scenario: Provider 在上传时拒绝成员

- **WHEN** Worker 在 metadata observation 后、upload 期间失去 Provider permission
- **THEN** upload SHALL 返回 unauthorized 或 `outcome_unknown` 的精确分类
- **AND** 系统 SHALL NOT 改用 Owner/Coordinator Connection 或其他 Provider。

### Requirement: 文件输出保持无覆盖和精确强核验

每个 execution SHALL 使用 Human/plan 批准且在 Project directory 内唯一的输出名称。成功 upload receipt SHALL 精确绑定 Provider Instance、root、parent、resource identity 和名称；系统 SHALL 重新观察 exact resource。名称冲突 SHALL 返回 typed conflict，系统不得覆盖、自动重命名或写入邻近目录。实现 MAY 额外记录 bytes/SHA-256，但它们不属于本 PoC 的完成条件。

#### Scenario: 输出名称已存在

- **WHEN** Worker 上传 `meeting-minutes.md` 而该 execution 目标已有同名 entry
- **THEN** Provider path SHALL 以 conflict 结束且零覆盖
- **AND** Coordinator SHALL 显式选择新的 execution/output name 或恢复既有 observed output。

### Requirement: 结果提交同时满足 execution fence 与内容 observation

Worker 只有在当前 `executionId` 仍 active、Task revision 匹配、Device/Agent/Membership 有效且所有声明文件已得到精确 observation 时，才 SHALL 提交 Task result、portable output references 和 provenance。Cloud SHALL 在同一权威提交中验证 fence、幂等、引用 root/binding revision 和 receipt digest，并拒绝旧 execution 的结果。

#### Scenario: 改派后旧 Worker 上传迟到结果

- **WHEN** 旧 execution 已 fenced 但 Provider 上传后来被观察为成功
- **THEN** Cloud SHALL 拒绝把该文件关联为当前 Task result
- **AND** recovery journal SHALL 保留该外部 observation 供 Human 处理而不覆盖新 execution。

### Requirement: outcome_unknown 必须进入持久人工恢复

任何无法证明外部写成功或失败的 timeout、cancellation、transport loss 或 receipt mismatch SHALL 记录 durable operation journal，并把 Task/execution 置为 `manual_recovery_required`。Coordinator HCI SHALL 允许 Owner/Coordinator 通过 canonical Content Space observation/reconcile 精确查找输出；只有观察到与原请求完全一致的资源时才能关联该输出，否则 SHALL abandon 旧 execution 并以新 `executionId` 和新输出名称重试。系统 SHALL NOT 提供无 observation 的“标记成功”。

#### Scenario: 上传响应丢失但文件实际存在

- **WHEN** Coordinator reconcile 观察到 exact Provider Instance、parent、name 和 resource identity 与 invocation receipt 一致，并由 Human 确认关联该 observed output
- **THEN** HCI MAY 将该 observed output 关联到原 execution 并继续审阅
- **AND** 关联动作 SHALL 记录 Human、observation 和 revision provenance。

### Requirement: 文件完整性是系统验收事实

系统 MAY 在 receipt 与自动测试中计算 bytes/SHA-256 作为非秘密诊断，但本次 Run-0 不要求逐文件 digest，也不以 `integrityVerified` 阻塞真实多用户会议闭环。验收仍 SHALL 记录 exact Project/Task/execution/resource identity、真实下载/上传 observation、Human review 和最终产物人工核对，且 SHALL NOT 包含秘密或真实敏感会议内容。

#### Scenario: 最终下载 digest 不匹配

- **WHEN** Project 结束前下载的任一文件与关联 upload receipt digest 不一致
- **THEN** Project SHALL NOT 通过完整性验收
- **AND** receipt SHALL 记录有界失败而不得把文件标为 verified。

### Requirement: 生产 Worker 不得注入 Mock Content Space

生产 source、packaged 和 isolated-live composition SHALL 只发现标准 Content Space 与安装的真实 Provider integration。Fake repository、Mock Content Space、fixture file result、直接数据库更新和测试-only bypass SHALL 只存在于测试入口，不得从 production manifest、runtime factory 或 fallback 被加载；缺少真实 binding 时执行 SHALL fail closed。

#### Scenario: Packaged Worker 未绑定 OpenContent

- **WHEN** packaged Worker 接收需要文件的 Task 但本机没有可用 Provider Connection
- **THEN** Worker SHALL 拒绝/暂停为 provider_not_ready
- **AND** SHALL NOT 生成 Mock 文件引用或伪造成功 receipt。
