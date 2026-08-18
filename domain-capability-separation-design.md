# SciForge Provider 模块化接口设计

> 状态：部分实现并经 ADR-0025 调整，审计于 2026-08-17。Content Space、Portable Resource References 与 Provider Composition 已实现；Secure Provider Credentials 和 OpenContent Content Space 路径待实现；Shared Documents 与 Document adapter/port 延后。
> 本文定义接口边界和实现顺序，不授权实现 OpenContent 网络能力。规范性行为以对应 OpenSpec requirements 为准；领域词义以 `CONTEXT-MAP.md` 和各 Context glossary 为准；取舍理由以 ADR 为准。

## 1. 目标

SciForge 将“持续协作文档”和“云空间文件”设计为两个稳定业务模块，把 OpenContent、SciForge 自建服务或其他第三方系统设计为可替换的 Provider Integration Package。

稳定主线是：

```text
Shared Documents ── DocumentProvider SPI ── Document Provider integrations
Content Space    ── ContentSpaceProvider SPI ── Content Space Provider integrations
```

OpenContent 是独立、可暂停的 V1 Adapter track，不是 Host Core、Agent Runtime 或两个业务领域的架构前提。暂停 OpenContent 不得阻塞 Portable Resource Reference、Provider composition、两个 provider-neutral SPI 或 Content Space 统一 UI。

## 2. 不可合并的业务边界

### Shared Documents

拥有：

- 活文档身份和 DocumentReference；
- Provider 权威 revision；
- 结构化正文观察；
- 非副作用 prepare；
- operation-specific Human confirmation；
- 条件 apply、冲突、幂等结果和安全文档启动。

不拥有普通文件上传下载、固定 Task Artifact、Provider 登录、厂商 DTO 或编辑器实现。

### Content Space

拥有：

- Content Container、目录和普通文件语义；
- ContentContainerReference、ContentFileReference；
- 上传、下载和版本观察；
- Provider 保证不可变后才能发行的 ArtifactReference；
- provider-neutral 文件管理 UI。

不拥有协作文档正文、文档 revision、Project/Task 状态、Provider 登录或厂商 DTO。

## 3. 为什么不存在 Universal Provider

一个应用可以同时提供文档和云空间，但必须分别实现两个 Contract。禁止以下设计：

```ts
interface Provider {
  listFiles?(): unknown
  upload?(): unknown
  readDocument?(): unknown
  editDocument?(): unknown
  // 持续增长的 optional methods
}
```

原因：文件传输和协作文档具有不同权威对象、一致性模型、写入确认、readiness、UI 和替换路径。一个 OpenContent package 可以贡献两个实现，但两个 contribution 分别注册、验证、发现和测试。

## 4. 模块与包图

```text
packages/domains/shared-documents
  ├── DocumentProvider public SPI
  ├── Document Provider catalog
  ├── Shared Documents service/capabilities
  └── generic launcher command only

packages/domains/content-space
  ├── ContentSpaceProvider public SPI
  ├── Content Space Provider catalog
  ├── Content Space service/capabilities
  └── provider-neutral file manager UI

trusted integration packages
  ├── opencontent-connector                  (main-only, optional track)
  ├── opencontent-content-space-provider     (ContentSpaceProvider)
  ├── opencontent-document-provider          (DocumentProvider)
  ├── future sciforge-cloud-content-provider
  └── future sciforge-document-provider
```

V1 Provider 都随 SciForge 编译、审核和发布。运行时下载、签名、沙箱、权限声明、升级和隔离执行不在本设计中。

## 5. Provider composition

### 5.1 Contribution kinds

Domain SDK 新增两个通用 main contribution contract：

```text
main.document-provider-factory
main.content-space-provider-factory
```

Provider integration package 在 `sciforge.domain.json` 声明 contribution，并从精确 main entrypoint 返回匹配的 runtime value。Host Core 只把通用 contribution 加入 generated catalog；它不认识 OpenContent、SciForge Cloud、文件扩展名或业务 capability ID。

### 5.2 独立注册

同一 package 可以贡献两项：

```text
opencontent.document-provider
opencontent.content-space-provider
```

但两项必须分别具有：

- contract version；
- Provider Kind；
- factory；
- capability/readiness 声明；
- package-owned tests；
- 独立缺失、禁用和失败行为。

一个 contribution 可用不能推导另一个可用。

### 5.3 Domain-owned catalogs

Shared Documents 只建立 Document Provider catalog；Content Space 只建立 Content Space Provider catalog。Catalog 使用标准 generated composition，必须：

- 稳定排序；
- 拒绝重复 Provider Kind；
- 拒绝 declaration/runtime contract 不一致；
- 拒绝未知 major contract version；
- Provider 缺失时返回 provider-neutral unavailable，不构造 fallback；
- package remove 后自动从 source 和 packaged catalog 消失。

Host 不提供中央 Provider map、Provider-ID switch 或 vendor configuration branch。

## 6. Provider identity 与路由

### 6.1 三种身份不可混用

```text
Provider Kind
  表示实现家族，例如 opencontent 或 sciforge-cloud。

Provider Instance Reference
  表示一个可信部署/租户；不含 endpoint、connection 或凭据。

Provider Resource Reference
  表示该 Instance 内的文档、容器、文件或固定版本。
```

Provider Instance Directory 是非秘密可信目录，将 ProviderInstanceRef 解析为 Provider Kind、安全显示名和可信 contribution owner。它不保存 endpoint、tenant policy、本地连接或凭据；Connector-private endpoint/tenant policy 只在对应 Connector 内按同一 ProviderInstanceRef 绑定。

### 6.2 引用固定 Provider

DocumentReference、ContentContainerReference、ContentFileReference 和 ArtifactReference 都固定 ProviderInstanceRef。运行时不得：

- 根据扩展名重新选 Provider；
- Provider 失败时尝试另一个 Provider；
- 采用任意默认连接或管理员账号；
- 静默复制资源并保留旧引用；
- 把 Broker `res_*` 当 portable identity。

跨 Provider 迁移是未来独立、显式、受治理的 import/export 或 migration operation，成功后产生新的 reference。

## 7. 公共接口形状

以下 TypeScript 仅说明规范性边界；实现 Session 应在对应 package public contract 中使用严格 runtime schema，并遵循仓库 exact exports。

### 7.1 共享基础值

```ts
type ProviderKind = string

// Opaque bounded authority ID. Provider Kind is resolved from the trusted
// Provider Instance Directory and is not caller-supplied routing data.
type ProviderInstanceRef = string & { readonly __brand: 'ProviderInstanceRef' }

type ProviderReadiness =
  | 'poc_only'
  | 'blocked_by_contract'
  | 'production_ready'

type ProviderCapabilityState = {
  capabilityId: string
  readiness: ProviderReadiness
  reasonCode?: string
}
```

所有标识符必须有固定长度、字符集和 contract version。`reasonCode` 是封闭的非秘密代码，不是厂商错误或自由文本。

### 7.2 Trusted operation context

Provider operation context 由 main composition/domain service 注入，而不是由 renderer、Agent、Task 或 portable reference 提供。它至少语义绑定：

- Host-asserted Human Principal；
- Agent Actor/caller attribution（若有）；
- ProviderInstanceRef；
- invocation/correlation identity；
- cancellation/deadline；
-当前 approval/authority context（只在领域操作需要时）。

Provider SPI 不接收密码、Token、Cookie、raw endpoint、Project、Task、Coordinator 或 Workspace 作为业务输入。

### 7.3 DocumentProvider

DocumentProvider 属于 Shared Documents public contract。最小能力族：

```text
describeCapabilities
searchDocuments
resolveDocument
resolveLaunchTarget
readStructured
validateCreatePlan
applyCreate
validateChangePlan
applyChange
recoverOperation
```

约束：

- `searchDocuments`、`resolveDocument`、`resolveLaunchTarget` 和正文能力分别声明 readiness；
- `readStructured` 必须返回 typed snapshot 和 AuthoritativeRevision；
- validate/plan 阶段无远程副作用；
- apply 接收同一组 frozen typed operations、expectedRevision/precondition 和 durable operation ID；
- Provider 不能重新解释自然语言、整篇覆盖或返回 raw CRDT/DTO；
- Shared Documents service，而不是 Provider，拥有 prepared-handle store、Human confirmation 和 Broker capability。

### 7.4 ContentSpaceProvider

ContentSpaceProvider 属于 Content Space public contract。最小能力族：

```text
describeCapabilities
listContainers
listEntries
observeEntry
createFolder
uploadNewFile
downloadFile
resolvePortalTarget
observeImmutableVersion
```

约束：

- UI 只调用 Content Space public capability，不直接调用 Provider；
- upload V1 是 create-only，不得自动 overwrite/update；
- download 通过 main/Host canonical destination path，不返回 bearer URL；
- ArtifactReference 只有在 `observeImmutableVersion` 证明版本不可变、可保留且可按版本取回后发行；
- Provider 不接收 Project/Task，也不拥有 Task Artifact Association。

### 7.5 Factory contracts

Provider factory contribution 的 runtime value 语义包含：

```text
contractVersion
providerKind
createProvider(hostView)
```

`hostView` 由 composition 绑定 package owner，包含最小通用端口；factory 不能让调用者自报 package/provider identity。Catalog 构造期不得联网、登录、读取正文或创建远程资源。实例解析和网络依赖在实际 operation 时 lazy 获取；生命周期失败不得阻止 SciForge 其他 Provider 或领域启动。

## 8. Access 与 Connector

Provider Contract 不规定所有 Provider 必须采用同一种登录模型。

- 外部 Provider 可以使用节点本地、逐 Human 的 Provider Connection；
- 未来第一方 SciForge Cloud Provider 可以使用 Host-asserted Human Principal 对应的 SciForge Cloud Session；
- 两者都实现 provider-owned access resolution，且引用不携带 access binding。

当同一厂商的两个 Provider adapters 需要共享认证和 Client 时，可使用 provider-specific main-only Connector：

```text
opencontent-content-space-provider ─┐
                                   ├─ opencontent-connector
opencontent-document-provider ─────┘
```

Connector 只向明确 allowlist 的 adapters 提供 composition-bound token-free typed ports。业务领域、Renderer、Agent Runtime 和云端不能调用 Connector。

## 9. UI 边界

### Content Space UI

Content Space package 拥有一套 provider-neutral 文件管理 UI：

- Provider Instance/Container 选择；
- 目录和文件列表；
- 上传、下载、选择；
- ContentFileReference/ArtifactReference 展示；
- capability/readiness 和 bounded error 呈现。

UI 不出现 vendor DTO、permission bit、endpoint 或 Token；Unsupported/blocked operation 不通过厂商特判隐藏，而由统一 capability matrix 驱动。

### Shared Documents UI

Shared Documents 桌面端只提供通用选择、引用和启动入口，不嵌入厂商编辑器。DocumentProvider 返回 main 验证并签发的短时 opaque DocumentLaunchTarget，最终打开 Provider 拥有的 Web UI。

未来 SciForge 自研在线文档 Web 编辑器也属于对应 Document Provider 的 UI，不进入 Shared Documents 核心。

## 10. Readiness 合并规则

每项 operation 的 effective readiness 取以下约束中最严格者：

```text
Provider contribution contract
Provider Instance policy
当前资源 capability
平台安全 Gate
Provider-specific evidence profile
调用者 audience/approval policy
```

只有受信 composition 和通过验证的合同证据可以提升 readiness。Renderer、Agent、Task、环境字符串、文件扩展名、成功 demo 或 Provider 自报自由文本不能提升。

`blocked_by_contract` 在 Provider contact 前失败；`poc_only` 只能在明确隔离 profile 中执行；`production_ready` 必须逐 operation 验证，不能由 package 整体状态推导。

## 11. OpenContent V1 Adapter track

OpenContent 保留为有效但可暂停的 V1 Provider 轨道：

```text
opencontent-connector
opencontent-content-space-provider
opencontent-document-provider
```

当前计划：

- Connector：只完成 package/contract/mock/schema/evidence Gate 时可推进；不因主线 Provider contracts 暂停；
- Content Space Provider：专用非生产租户中目录、列表、create-only folder、upload-once、download 和 ContentFileReference 可逐项成为 `poc_only`；
- ArtifactReference：等待正式不可变版本合同；
- Document Provider：检索、引用、metadata/capability 查询和安全启动逐项独立 gated；
- `.mdoc` structured read/create/change：继续 `blocked_by_contract`，直到正式 Skill/API 通过供应链、typed schema、revision、冲突、幂等和审计验收；
- remote Task、共享管理员、DOM 自动化、私有 API、Token URL、整篇覆盖和静默重新登录均禁止。

暂停这三个 OpenContent packages 时，Provider composition、两个 domain packages、统一 Content Space UI、mock providers 和未来 SciForge/第三方 adapters 继续工作。

## 12. 依赖方向与实施顺序

```text
1. add-portable-resource-references
2. add-provider-composition
3. add-secure-provider-credentials       (只为需要本地秘密的 Provider)
4. add-content-space-v1                  (contract/catalog/UI/mock)
5. add-shared-documents-v1               (contract/catalog/launcher/mock)
6. add-opencontent-connector              (可暂停)
7. add-opencontent-content-space-provider-v1  (可暂停)
8. add-opencontent-document-provider-v1       (可暂停且正文 blocked)
```

第 4、5 步不依赖 OpenContent。第 6–8 步可以暂停或替换。实现 Session 不得把第 6 步重新放进两个业务 domain 的 mandatory dependency。

## 13. 禁止实现形态

- 一个包含所有 optional methods 的 Universal Provider；
- Host Core 中的 provider kind/vendor/domain switch；
- Provider 专属 IPC、MCP、Agent Runtime 分支或 Agent Tool；
- Renderer 直接拿 Connector、Client、Token 或 raw URL；
- Domain package 直接 import integration package；
- Provider adapter import 另一个业务 domain；
- 通过包加载顺序、ESM singleton 或全局 mutable map 发现 Provider；
- 缺 Provider 时自动 fallback；
- 用扩展名推导 structured capability；
- 将 portable reference、Broker resource ref、Provider Connection 混为同一身份；
- OpenContent 成功 PoC 自动提升为 production readiness。

## 14. 实现 Session 验收清单

下一 Session 在写代码前必须确认：

1. 只从 public SDK/domain contract subpath import；
2. 两个 contribution kind 均有 declaration/runtime schema 和 contract version；
3. generated source 与 packaged composition 都能增加、移除、拒绝重复 Provider；
4. 同一 package 可贡献两个 factory，但两个 registry 完全独立；
5. Catalog 构造零网络、零登录、零远程副作用；
6. unknown Provider Kind/Instance 在网络前 fail closed；
7. refs 固定 Provider，无 fallback；
8. Content Space UI 只依赖 public Content Space contract；
9. Shared Documents launcher 只消费 opaque launch target；
10. OpenContent Connector 只被两个 OpenContent adapters 通过 composition-bound ports 使用；
11. package removal 不需修改 Host feature map；
12. package tests/typecheck、composition freshness、governance、边界、全量回归和 source/packaged smoke 均通过。

## 15. 外部条件

通用接口与 mock 不依赖 OpenContent。启用 OpenContent 网络能力仍需要：正式逐用户认证、Token 生命周期和撤销、API/API-browser-Skill 会话共存、元数据对象级鉴权修复、安全 deep link、不可变版本、typed `.mdoc` snapshot/revision/conditional write/idempotency/audit，以及专用非生产租户。

任何条件缺失只阻断对应 OpenContent Provider operation，不阻断 Provider architecture 或其他 Provider。
