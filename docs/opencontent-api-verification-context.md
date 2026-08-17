# OpenContent API 核验上下文

> **迁移状态：历史验证证据，2026-08-17 重新纳入当前仓库。** 本文中的接口观察仍可用于设计测试，但不能覆盖 ADR-0025 的交付顺序，也不能把任何操作从 `blocked_by_contract` 自动提升为可执行。当前规范以 `add-opencontent-connector`、`add-opencontent-content-space-provider-v1` 和后续专用 PoC Gate 为准。
>
> 更新时间：2026-08-17（Asia/Shanghai）
> 用途：帮助后续 Agent 分别判断 OpenContent 能否支持 SciForge 的 Shared Documents 与 Content Space，并了解已经验证的能力、尚未满足的合同和安全边界。
> 测试环境：`https://test1.edoc2.com`
> 证据等级：本文严格区分“真实 API 调用已验证”“SDK 候选合同”和“厂商口头说明”。2026-08-13 会议内容仅是待书面确认、待交付物验证的线索，不能单独关闭 production Gate。

## 1. 当前结论

当前证据覆盖两条彼此独立的能力线：

- **Content Space PoC**：已经真实调用逐用户 RSA 登录、团队库、目录、普通文件上传/列表/下载及成员撤权接口。这些能力属于云空间和固定 Task 附件，不属于 Shared Documents 正文语义。
- **Shared Documents**：已经真实验证 OpenContent 原生网页可供 Human 协作，并可通过 API 创建空白 `.mdoc`。厂商在 2026-08-13 会议中口头确认 `.mdoc` Agent 编辑将通过待交付的“轻文档编辑 Skill 包”提供；包尚未交付，不能据此认定正文能力可用。
- **Office 格式**：厂商口头确认不支持局部语义编辑，只能下载、修改、再上传文件版本。该路径不得作为 Shared Documents 的结构化编辑 fallback；未来如采用，应由 Content Space 定义独立的文件版本写入合同。

OpenContent 目前还不能被认定为完整满足 Shared Documents V1。最关键的未决合同是：

- 待交付 Skill 包尚未证明 Agent 可以通过正式、版本化、typed contract 结构化读取 `.mdoc` 正文；
- 尚未证明 Agent 可以按稳定区块 ID 插入、修改或删除正文；
- 尚未证明正文 API 提供 authoritative revision、条件写入和冲突检测；
- 尚未证明 Agent 写入支持幂等恢复和可关联的审计 operation ID；
- 厂商仅口头说明 Token 默认一天、使用时续期且新登录使旧 Token 立即失效；具体 TTL、续期、并发会话、API/浏览器/Skill 互踢、注销和管理员撤销合同仍不明确；
- 团队成员撤销后，文件内容下载和写入会立即失效，但已知 ID 的文件夹和文件元数据仍可被查询。

因此当前应采用分阶段结论：

1. **Content Space 文件空间：可在隔离环境继续 PoC，readiness 与 Shared Documents 分开。**
2. **Human 原生网页协作：可用于 PoC。**
3. **外部核验脚本创建空白 `.mdoc`：已验证；受 Broker 治理的 Agent create 仍缺创建前置条件、幂等和回执合同。**
4. **Agent 结构化读写共享正文：Skill 包待交付且外部合同未满足，不能宣称已经打通。**
5. **生产权限、身份与会话：存在阻塞项，不能直接按测试方案上线。**

## 2. SciForge 与 OpenContent 的边界

OpenContent 同时是 Shared Documents 的首个 Document Provider 和 Content Space 的首个文件空间 Provider，但这两个 SciForge bounded context 保持独立；OpenContent 也不是 SciForge 云端协作服务本身。

### SciForge 云端协作服务负责

- User 与 SciForge Agent/节点注册；
- 节点能力、在线状态和心跳；
- Project、ProjectMember 和 Coordinator；
- Task 分配、状态、revision 和 TaskResult；
- Project Record（observation、decision、summary）；
- 持久信箱、WebSocket 通知和离线恢复；
- HumanNeeded 与 HumanAnswer；
- 消息幂等、任务状态机和项目完成状态。

它是“项目账本 + 任务系统 + 持久信箱”。它不运行科研 Agent，也不保存 OpenContent 正文或用户密码、Token。

### OpenContent 负责

- `.mdoc` 和普通文件的权威内容；
- 文档版本、权限和浏览器协作体验；
- 团队库和项目资料文件夹；
- 报告、Office 文件、PDF、图片和结果文件；
- OpenContent 自身的成员权限与内容审计。

### 各上下文通过 provider-neutral 资源引用关联

SciForge 只保存不含凭据的 Provider Reference，例如：

```text
Project.contentSpaceRef -> OpenContent 团队库下的项目文件夹
Task.evidenceRefs       -> OpenContent 中的证据文档或文件
Task.artifactRefs       -> OpenContent 中的授权结果文件
```

引用不得复制 endpoint、路径、名称、团队层级、凭据或本地 `ProviderConnectionId`。跨节点使用版本化、非授权的 Portable Resource Reference Envelope；逻辑 `DocumentReference` 只标识 Provider Instance 与活文档资源，`ArtifactReference` 固定到经过正式合同证明不可变的 Provider 版本，目录使用独立的 `ContentContainerReference`。接收节点必须先解析可信的非秘密 Provider Instance Directory，再按当前 Human Principal 解析本地 Provider Connection、重新鉴权并发行进程内 Broker resource reference。不得以 `teamId + folderId + GUID + fileId` 的 provider-specific 元组提前冻结协议。

这些引用都不是权限。每次操作仍必须由实际执行节点解析当前 Human Principal 的本地 Provider Connection，并通过 OpenContent 的当前授权重新校验。

## 3. 已验证能力矩阵

| 核验事项 | 状态 | 实际证据 |
|---|---|---|
| RSA 用户登录 | 已验证 | `GetLoginRsaPublicKey` 返回 RSA、OAEP-SHA256；`UserLogin` 成功返回 36 位 Token |
| Token 短期重复使用 | 已验证 | 同一 Token 可以连续调用多个受保护接口 |
| Token 生命周期 | 厂商口头说明，未通过 Gate | 厂商称默认一天、有效期内使用会续期、新 Token 立即使旧 Token 失效；TTL 类型、续期方式、互踢作用域、错误码和撤销仍待书面合同与实测 |
| 查询个人库根目录 | 已验证 | `GetTopPersonalFolderId` 返回成功 |
| 创建 `.mdoc` | 已验证 | `CreateDocFlowFile` 返回“文档创建成功”，文档真实出现在个人库 |
| 查询团队库 | 已验证 | test3 能查询到 `sciforge test`；授权前 test2 查询结果为空 |
| 添加团队成员 | 已验证 | test3 将 test2 加入团队后，test2 无需重新登录即可看到团队 |
| 移除团队成员 | 已验证 | test3 移除 test2 后，test2 的团队列表立即归零 |
| 创建团队项目文件夹 | 已验证 | test2 作为内部成员在团队根目录成功创建专用测试子目录 |
| 上传普通文件 | 已验证 | 两阶段上传成功，文件流状态 `End`、进度 100% |
| 查询目录文件列表 | 已验证 | `GetChildFilePageListByFolderId` 返回上传文件 |
| V800 GUID 目录分页 | 已验证 | `GetFolderChildren` 接受稳定 `folderGuid`，`argsXml` 使用 URL 编码的 `GetListArgs`，响应区分 `foldersInfo`/`filesInfo` 并返回严格分页计数 |
| 查询文件详情 | 已验证 | 可按文件 ID 返回文件名、GUID 和父目录等信息 |
| 下载文件 | 已验证 | `DownloadCheck` 和 `/downLoad/index` 成功；下载文件与源文件 SHA-256 一致 |
| 稳定文件夹引用 | 基本验证 | 重新登录后原 folder ID 仍能查询，并返回稳定 folder GUID |
| 稳定文件引用 | 基本验证 | 重新登录后原 file ID/file GUID 仍可用于查询或下载校验 |
| 跨用户个人库共享 | 已验证但非首选 | `SaveShare` 可产生 share ID；接收者必须带 share context 访问 |
| 撤权后阻止下载 | 已验证 | test2 被移出团队后，原 Token 和新 Token 的下载均返回 `result=5` |
| 撤权后阻止写入 | 已验证 | test2 被移出团队后创建文件夹返回 `result=5` |
| 撤权后隐藏元数据 | 不满足 | test2 被移出团队并重新登录后，已知 ID 的目录、列表和文件详情仍返回成功 |
| `.mdoc` 结构化正文读取 | 待交付、未验证 | 厂商宣布将交付“轻文档编辑 Skill 包”，但包、schema 和结构化读取合同尚未取得 |
| `.mdoc` 语义级编辑 | 待交付、未验证 | 会议演示了自然语言修改，但未证明冻结 typed operations、稳定区块、revision、条件写或无部分写 |
| Office 局部语义编辑 | 厂商确认不支持 | 只能下载、本地修改和上传文件版本；不得映射为 Shared Documents structured edit |
| authoritative revision | 未验证 | 未证明 Provider 返回可用于条件写入的正文 revision |
| 冲突检测 | 未验证 | 未证明 stale revision 会被拒绝而不是静默覆盖 |
| 幂等写入与恢复 | 未验证 | 未证明重复 apply 可返回同一结果或恢复未知结果 |
| 内容操作审计关联 | 未验证 | 未证明响应提供可关联的 operation/audit ID |
| 稳定浏览器 deep link | 未完整验证 | 页面可使用，但尚未形成经过验证的 provider-neutral deep-link 合同 |
| 项目归档 | 未验证 | SDK 中未找到明确的项目归档/封存接口 |

## 4. 团队库完整验证记录

### 4.1 测试对象

本次只使用测试账号和专用测试资源：

```text
团队名称：sciforge test
团队 ID：19
团队根文件夹 ID：2213
团队根文件夹 GUID：7031fd44-2a4a-4c3c-9c74-121104b4324a

测试项目文件夹：sciforge-team-project-test-20260812-174249
测试项目文件夹 ID：2214
测试项目文件夹 GUID：5cbbe39d-e54a-4c14-9b42-69f2ea6bcff7

测试文件：sciforge-team-upload-test-20260812-174249.txt
测试文件 ID：10522
测试文件 GUID：952c0345-4349-4c42-9f5f-3360d2df11ac
```

云端测试文件夹和测试文件按授权保留。本地密码、Token、响应文件和测试副本已清理。

### 4.2 授权前基线

test2 在加入团队前：

- `GetMyTeamList` 中没有 `sciforge test`；
- 无权直接访问此前位于 test3 个人库中的测试目录和文件；
- 文件夹、文件详情和下载校验的业务结果均为 `result=5`。

### 4.3 加入团队

test3 通过 `Team/SaveTeamUserList` 将 test2 加入团队 19。

服务端实际接受的新增成员模型是：

```json
{
  "teamId": 19,
  "addUserInfo": [
    {
      "userId": 41,
      "userType": 3
    }
  ]
}
```

其中：

- `userId` 实际使用用户的 `identityId`；
- `userType: 3` 表示内部人员；
- SDK 文档把 `addUserInfo` 写成整数数组，但服务端真实模型要求对象数组。

授权后无需重新登录，test2 立即：

- 在团队列表中看到 `sciforge test`；
- 读取团队根文件夹；
- 以普通内部成员身份出现在团队成员列表；
- 创建项目子文件夹；
- 上传、查询和下载文件。

### 4.4 文件上传和下载

上传使用两阶段流程：

1. `Transport/Upload/CheckAndCreateDocInfo` 创建文件和上传上下文；
2. `/document/upload` 传输文件流。

结果：

```text
CheckAndCreateDocInfo: result=0
upload status: End
percent: 100
```

下载使用：

1. `Transport/Download/DownloadCheck`；
2. `/downLoad/index` 拉取文件流。

测试文件下载大小为 98 字节，源文件与下载文件的 SHA-256 完全一致。

### 4.5 移除成员和即时失效

test3 通过 `Team/SaveTeamUserList` 的 `deleteUserInfo: [41]` 移除 test2。

移除后使用 test2 原 Token 立即验证：

- 团队列表变为 0；
- 下载校验返回 `result=5`；
- 新建文件夹返回 `result=5`。

随后 test2 重新登录取得新 Token，结论保持不变。因此下载和写入失效不是旧会话偶然结果。

### 4.6 撤权后的元数据越权风险

移除团队成员以后，即使 test2 重新登录，只要提前知道 ID，以下接口仍返回 `result=0`：

```text
DocList/GetFolderInfoById
DocList/GetChildFilePageListByFolderId
DocList/GetFileInfoById
```

能够继续看到的信息包括：

- 团队根目录和项目目录名称；
- 文件夹路径；
- 文件夹 GUID；
- 文件名；
- 文件 GUID；
- 父文件夹 ID；
- 目录中的文件数量和列表。

内容下载和写入已被拒绝，但元数据仍可见。这说明相关读取接口缺少完整的对象级权限校验，或权限策略没有覆盖元数据读取。

在厂商修复或提供经过验证的对象级 permission oracle 前，生产环境中的 catalog、metadata 和任意已知 ID reference resolution 必须 fail closed。SciForge 不得用 ProjectMember、缓存的团队成员表或本地 allowlist 冒充 OpenContent ACL；这些信息最多是隔离 PoC 的额外收窄措施，不能关闭生产权限 Gate。

### 4.7 Change 1 写传输合同复核（2026-08-17）

本轮严格只使用 `test3`，未使用管理员账号，也未创建、邀请或修改 Team 成员。先确认已有 Team `sciforge test` 的 Team ID 为 19，根文件夹 ID 为 2213，稳定根 GUID 为 `7031fd44-2a4a-4c3c-9c74-121104b4324a`。随后在该根下创建并按授权保留专用验证资源：

```text
测试文件夹：sciforge-change1-20260817-1619
测试文件夹 ID：2247

测试文件：sciforge-change1-transfer-20260817-1621.txt
测试文件 ID：10802
测试文件 GUID：e084fefb-b4d2-4d82-9d77-9c5d912f61f7
测试文件大小：63 字节
下载 SHA-256：d823bb3333b1623b3f55b3df4b3798d82fb2395fdc74e2791436665046c14540
```

复核得到的实现合同：

- `CreateFolder` 的同名业务结果为 `806`，映射为 `conflict`；
- `CheckAndCreateDocInfo` 必须使用 multipart `FormData`，响应给出 `FileId`、`FileVerId`、`ParentFolderId` 和仅限 main process 的 region 数据；
- `/document/upload` 使用分块 multipart，末块成功状态为 `End` 且 `percent=100`，实际 `tag` 可能是字符串布尔值；
- 下载仍是 `DownloadCheck` 后访问 `/downLoad/index`，63 字节下载结果与源内容散列完全一致；
- 两阶段上传的第一阶段一旦成功，后续 schema、region 或传输结果不明确均必须返回 `outcome_unknown`，不得自动重试；
- 本地浏览器会话、Token、region 数据、控制台记录和临时测试副本已清理；仓库只保留不含凭据的合同事实。

## 5. 个人库和个人共享验证

### 5.1 个人库

已经验证：

- 查询个人库根目录；
- 在个人库创建普通项目测试文件夹；
- 上传、查询和下载普通文件；
- 创建 `.mdoc` 轻文档。

### 5.2 个人共享

个人库使用 `Share/SaveShare` 和 share ID 上下文，不等同于团队成员权限。

服务端实际接受的 `member` 格式为：

```json
{
  "member": "41,0"
}
```

SDK 文档中的 `[28,0;29,0]` 方括号是说明符号；把方括号作为字符串提交会导致服务器 500。

个人共享验证中：

- 创建共享成功并返回 share ID；
- test2 可以通过 share ID 读取共享文件夹及分页内容；
- 下载必须携带对应 `shareCode`；
- 不携带共享上下文时，不能直接访问个人库原始资源；
- 测试 share ID 已删除。

SciForge Project 的默认内容空间应优先使用团队库，而不是依赖个人共享链接。个人共享只适合临时、明确有期限的补充场景。

## 6. `.mdoc` 与 Shared Documents 正文能力

### 已经证明

- `CreateDocFlowFile` 接口真实部署；
- 匿名访问返回 401；
- 有效 Token 但参数不完整时进入业务校验；
- 参数正确时能够创建 `.mdoc`；
- 创建结果会真实出现在 OpenContent 网页个人库中。
- 厂商在 2026-08-13 会议中口头表示 `.mdoc` Agent 编辑通过待交付的“轻文档编辑 Skill 包”实现，并现场演示过自然语言内容替换。
- 厂商口头确认 Office 文件不支持局部语义编辑，只能下载、修改、再上传文件版本。

### 尚未证明

创建 `.mdoc` 或看到一次 Skill 演示都不等于 Agent 可以安全协作正文。Skill 到件后仍需 OpenContent 团队提供并实际验证：

1. 结构化正文读取接口；
2. 稳定的段落或区块 ID；
3. 指定区块插入、替换和删除；
4. Provider 颁发的 authoritative revision；
5. `expectedRevision` 或等价条件写入；
6. stale revision 的明确冲突响应；
7. 幂等键及重复写入结果恢复；
8. 写入操作与用户、Agent、Project 关联的审计 ID；
9. 多人同时编辑时的可靠一致性语义；
10. Skill 的版本、hash/签名、许可、runtime、网络、支持周期和数据出境/日志行为；
11. Skill 可以被 main-only adapter 封装，不注册独立 Agent tool/MCP/IPC，不自行持久化凭据或发起审批；
12. prepare 返回冻结的 typed operations、preview 与 digest，apply 原样提交该操作，不能在 Human 确认后重新执行自然语言规划。

在这些合同完成前，Shared Documents 只能把已经分别通过对应权限、身份和 launch Gate 的能力标为 `poc_only`；结构化读取和所有 Agent create/change apply 继续 `blocked_by_contract`。Human 可以在 OpenContent 页面编辑正文。普通文件上传下载属于 Content Space，不得借此扩大 Shared Documents。

不得把“能创建 `.mdoc`”、一次自然语言演示或“Skill”这个名称描述成“Agent 已能安全编辑共享正文”。如果 Skill 只有 `edit(fileId, instructionText)`，或者 dry-run 与 apply 会分别重新推理，它不满足 operation-specific Human confirmation。

## 7. 认证与凭据边界

SDK 文档声明两种登录方式：

1. `Auth/UserLogin`：用户名密码登录；
2. `Auth/UserLoginIntegrationByUserLoginName`：集成密钥登录。

目前只验证了 RSA 用户名密码登录。Token 可以在短期会话内重复使用，但测试中也观察到旧 Token 返回 401。厂商在 2026-08-13 会议中口头说明：Token 默认一天、有效期内持续使用会续期，同一账号新登录产生的 Token 会立即使旧 Token 失效。

这组口头说明没有通过生产 Gate。若互踢覆盖所有 API client，则同一 Human 的两个 SciForge 节点会互相使连接失效；若还覆盖系统浏览器或 Skill 会话，则 Human 浏览器协作与 Agent API 也可能无法共存。Q46 已确认：PoC 只能显著标记为 `poc_only` 并限制每位 Human 一个活动 API 节点；production V1 必须取得并验证 API/API、API/浏览器和 API/Skill 会话共存合同。不得用自动重新登录、跨节点转发 Token、共享管理员账号或设备独立用户规避。

生产接入仍需厂商明确：

- 一天究竟是 idle、fixed 还是 absolute TTL，哪些调用触发续期、是否返回新 Token、是否有 absolute maximum；
- access/refresh 或等价 Token 的刷新、rotation、reuse detection 和并发 single-flight 规则；
- API 节点 A、系统浏览器、API 节点 B、轻文档 Skill 之间的完整互踢矩阵；
- 是否支持按 client/device 独立的逐用户 Token，以及同账号并发会话上限；
- `expired`、`superseded`、`revoked`、`disabled` 的稳定可区分错误；
- API 注销、浏览器注销和管理员撤销；
- 用户退出团队或离职后的会话失效；
- OAuth、SSO、设备授权或其他委托方式；
- 服务端审计身份和 operation correlation。

厂商还口头说明 OpenContent 不支持自助注册，账号由管理员或组织同步创建，并可结合第三方身份调用账号创建接口绑定。该说明没有定义 OIDC/OAuth2、SAML、SCIM 或私有 provisioning 的边界，也没有提供稳定 tenant/subject、whoami、link/unlink、防账号接管、停用/删除和审计合同。账号 provisioning 属于未来独立身份能力；Shared Documents、Content Space 和云端 A 都不得因此获得账号管理员凭据或内容访问代理权。

SciForge 必须遵守：

- 不把密码、Token、Cookie 或集成密钥写入仓库、Project、Task、日志或资源引用；
- 不让云端 Coordinator 保存或转发各节点的 OpenContent 凭据；
- 每个执行节点使用当前 Human Principal 对应的本地 Provider Connection；
- 凭据只进入主进程控制的操作系统安全存储；
- 浏览器 Cookie 与 Agent API Token 分离；
- 缺少当前用户的 Provider Connection 或权限时返回 provider-neutral `human_action_required`；云协作模块可映射为自己的 `needs_human`；
- 不回退到共享管理员账号或全局集成密钥。

持久化的安全凭据只表示本地 connection 已 enrollment，不证明当前 Token 仍有效。另一会话替换 Token、账号停用或 provider 拒绝时必须 fail closed，返回 `reauthentication_required`/`human_action_required`；禁止在后台静默重新登录并踢掉其他节点。纪要中的“设备级独立账号”必须向厂商澄清为 session 还是 user account：SciForge 的 Provider Account 必须代表具体 Human，不能把每台设备建成不同用户来规避会话限制。

测试密码曾经出现在对话中，测试结束后应轮换相关测试账号密码。

## 8. 两个 Provider Adapter 的分阶段要求

### Content Space 可继续推进的 PoC 核验

- 团队库 catalog；
- 团队项目文件夹创建；
- 普通文件上传、列表、详情和下载；
- Content Container/File/Artifact Reference 候选；
- test3/test2 类似的跨用户权限集成测试。

这些是 Content Space 的非生产 PoC 证据，不自动满足生产认证、metadata authorization、不可变版本或安全下载合同，也不阻塞或解锁 Shared Documents。

### Shared Documents 当前可推进的工作

- provider-neutral contract、Broker capability、mock、blocked readiness 和包边界测试；
- 接收并离线审计轻文档 Skill 包；
- 在隔离 verification harness 继续验证空白 `.mdoc` 创建和 Human 原生页面协作；
- 在正式 structured snapshot、revision、条件写、幂等和审计合同通过前，保持 Agent 正文能力 unavailable。

### 必须加的 SciForge 保护层

- 所有 Provider 操作经过通用 Capability Broker；
- renderer 和云端不能直接调用 OpenContent 原始接口；
- metadata/catalog/reference resolution 必须依赖 provider 当前对象级授权；缺少可靠授权证明时生产 fail closed，不得用 Project/团队成员关系模拟 ACL；
- 引用解析必须绑定 provider instance、Human Principal 和权限上下文；
- 对 401 返回重新认证，不假设 Token 永久有效；
- 对 `result != 0` 按业务失败处理，不能只检查 HTTP 200；
- 日志中只记录引用、操作类型、revision、结果码和脱敏 correlation ID；
- 不记录正文、搜索文本、密码或 Token；
- 轻文档 Skill 只能是 adapter-private main-only 依赖，不能形成第二条 Agent Tool、MCP、IPC、审批或凭据路径；
- connection 被另一登录替换时停止操作并要求 Human 处理，不能自动重新登录或盲重试外部写入。

### 仍被外部合同阻塞

- structured read；
- semantic edit；
- prepare -> Human confirm -> conditional apply；
- authoritative revision；
- 冲突检测；
- 幂等 apply 与结果恢复；
- 正文级审计关联；
- 完整的正式 Token 生命周期；
- API/浏览器/Skill/双节点并发会话与互踢合同；
- 轻文档 Skill 的供应链、typed schema、确定性 prepare/apply 与数据处理合同；
- 厂商修复撤权后元数据仍可查询的问题。

## 9. SDK 文档与服务端差异

本次验证发现至少两处 SDK 描述与真实服务端模型不一致：

1. `Team/SaveTeamUserList.addUserInfo`
   - SDK：`array[integer]`；
   - 服务端：`array[TeamEditUserInfo]`；
   - 已验证可用值：`[{"userId":41,"userType":3}]`。

2. `Share/SaveShare.member`
   - SDK 示例写作 `[28,0;29,0]`；
   - 服务端实际接受不带方括号的字符串，例如 `41,0`；
   - 带方括号提交会触发服务器 500。

因此后续不能仅根据转换后的 Markdown 类型表生成客户端。需要把真实请求模型固化为 Provider Adapter 的受测 schema，并与厂商确认正式合同。

## 10. 已知失败与解释

### `GetFolderChildren` 返回 500

旧的 `GetFolderChildren` 调用因为 SDK 中 `argsXml` 示例不完整而返回内部错误。不能据此认定目录列表不可用。

已经验证可用的替代正式接口是：

```text
GET /flatsdk/api/services/DocList/GetChildFilePageListByFolderId
```

该接口已在个人库和团队库真实返回文件列表。

### `CheckDocflow` 返回 401

该次请求使用的 Token 已失效，因此不能据此判断 `CheckDocflow` 是否可用。后续应使用新 Token 立即复测。

### HTTP 200 不代表业务成功

OpenContent 多个接口在无权访问时仍返回 HTTP 200，并在 JSON 中使用：

```text
result=5
```

Provider Adapter 必须同时检查 HTTP 状态和业务 `result`。

## 11. 下一步核验顺序

所有写入测试继续只使用专用测试账号、专用团队和唯一命名的测试资源。

1. 接收轻文档 Skill 包，记录版本/hash/签名/许可/runtime，并完成离线供应链、网络、模型调用、日志、凭据和调用边界审计；
2. 索要 Skill 的正式 typed contract、结构化 snapshot、稳定区块 ID、revision、条件写和完整请求/响应/错误示例；
3. 证明 prepare 与 apply 使用同一组冻结 typed operations，不能在确认后重新规划；
4. 验证两个用户并发编辑同一 `.mdoc` 时 stale revision 的原子冲突和零部分写；
5. 验证幂等键、重复 apply、提交后丢响应、进程重启后的状态查询和审计关联；
6. 逐步实测 API 节点 A → 系统浏览器 → API 节点 B → Skill 的 Token 互踢矩阵，以及一天/续期/临界并发行为；
7. 索要正式逐用户身份、稳定 tenant/subject、whoami、logout/revoke 和账号 provisioning/deprovisioning 合同；
8. 向 OpenContent 团队提交撤权后元数据仍可读取的问题，并要求服务端对象级修复、受影响接口清单、版本和回归证据；
9. 验证稳定、无凭据的 portal/document deep link 与浏览器/API subject 对齐；
10. 将真实请求/响应 schema 和上述负向行为固化为 adapter 合同测试。

## 12. 后续 Agent 工作规则

后续 Agent 读取本文档后必须遵守：

- 把 SDK 文档声明与测试环境的实际可用性分开记录；
- 每项结论标记为文档证据、匿名探测、认证后只读验证或真实写入验证；
- 先读后写，优先使用低权限测试用户；
- 不遍历与 SciForge 测试无关的用户、团队或企业资料；
- 除非用户明确授权，不修改团队成员、权限、安全策略、已有文档或系统配置；
- 写入必须使用唯一命名的专用测试资源；
- 输出只保留脱敏状态、引用、字段结构和必要的 correlation ID；
- 不把 HTTP 200 直接等同于业务成功；
- 不把一次 401 解释成接口不存在；
- 不把一次 500 解释成整个能力不可用；
- 不使用 DOM 自动化、浏览器 Cookie、共享管理员账号或整篇覆盖来绕过缺失的正文合同；
- 不把厂商 Skill 直接暴露给 Agent，不让它在 Human 确认后重新规划写入；
- 不把 Token 互踢恢复实现为静默重新登录、跨节点凭据转发或管理员 fallback；
- 未获得并验证正式正文编辑合同前，不宣称 Shared Documents 已完整落地。

## 13. 证据来源

### 本地设计资料

- `gzy_sciforge_aim.txt`：多用户、多机器和机构服务器协作目标；
- `SciForge 多用户端—云 Agent 协同 PoC 设计.pdf`：Coordinator、Worker、云端和手机 IM 的最小闭环；
- `PROJECT_ARCHITECTURE.md`：Domain、Capability Broker、Agent Runtime 与 Worker 边界；
- `CONTEXT-MAP.md`：Shared Documents 与 Content Space 的上下文边界及关系；
- `docs/contexts/shared-documents/CONTEXT.md`：Shared Documents 领域词汇、Provider Authority 和 Human Principal；
- `docs/contexts/content-space/CONTEXT.md`：Content Space 和固定 Task Artifact 的领域词汇；
- `openspec/changes/add-shared-documents-v1/`：Shared Documents 设计、规格和外部实施 Gate；
- `docs/adr/0001-keep-document-authority-in-the-provider.md`；
- `docs/adr/0003-exclude-document-content-from-full-trace.md`；
- `docs/adr/0005-use-prepare-confirm-apply-for-agent-writes.md`；
- `docs/adr/0007-package-shared-documents-as-a-provider-neutral-compile-time-domain.md`。

### OpenContent SDK 文档

来源：`reference/Shared_docs/OpenContent SDK离线文档v9.0.0.0.md`。

### OpenContent 技术沟通

- `docs/opencontent-partner-meeting-evidence-2026-08-13.md`：2026-08-13 厂商口头说明、证据限制、Skill 到件验收与 Token/账号待确认问题。

### 本次实际涉及的 OpenContent 接口

```text
GET  /inbiz/org/api/auth/GetLoginRsaPublicKey
POST /flatsdk/api/services/Auth/UserLogin
POST /flatsdk/api/services/User/GetTopPersonalFolderId
POST /flatsdk/api/services/User/GetUserInfoByAccount
POST /flatsdk/api/services/User/GetUsers
POST /flatsdk/api/services/Team/GetMyTeamList
POST /flatsdk/api/services/Team/GetTeamUserByTeamIdPaging
POST /flatsdk/api/services/Team/SaveTeamUserList
POST /flatsdk/api/services/TemplateCreate/CreateFolder
POST /flatsdk/api/services/DocList/GetFolderInfoById
GET  /flatsdk/api/services/DocList/GetChildFilePageListByFolderId
GET  /flatsdk/api/services/DocList/GetFileInfoById
POST /flatsdk/api/services/Transport/Upload/CheckAndCreateDocInfo
POST /document/upload
POST /flatsdk/api/services/Transport/Download/DownloadCheck
GET  /downLoad/index
POST /flatsdk/api/services/Docflow/CreateDocFlowFile
POST /flatsdk/api/services/Share/SaveShare
POST /flatsdk/api/services/Share/GetDocByShareId
POST /flatsdk/api/services/ShareToMe/GetDocByShareIdPage
POST /flatsdk/api/services/Share/DeleteAllShare
```
