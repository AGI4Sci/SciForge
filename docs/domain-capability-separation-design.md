# SciForge 中按 Domain Capability 拆分 OpenContent 能力的设计说明

## 1. 背景

SciForge 计划接入 OpenContent，用于承载项目共享资料、普通文件、Office 文件以及在线协作文档。

从用户视角看，这些操作都可能发生在同一个 OpenContent 网页中；从物理部署看，它们也可能使用同一套 OpenContent 服务、账号体系和 API。

但在 SciForge 的领域架构中，不应按“同一个供应商”或“同一个网页”把所有能力合并成一个 `OpenContent Integration`。更合理的做法是按业务能力拆分为独立的 domain package：

- `content-space`：项目内容空间与普通文件/产物管理；
- `shared-documents`：持续协作文档与 Human-Agent 正文协作。

核心原则是：

> Domain package 按业务能力、数据语义、生命周期和替换边界划分，而不是按供应商、页面、开发负责人或底层服务器划分。

---

## 2. 核心结论

即使以下能力都由 OpenContent 提供：

- 团队库；
- 项目文件夹；
- 文件上传下载；
- `.docx`、`.xlsx`、`.pptx`、`.mdoc` 在线打开；
- 浏览器多人协作；

SciForge 仍应在逻辑上将它们拆分为两个独立 domain capability：

```text
OpenContent Provider Platform
        │
        ├── Content Space Capability
        │
        └── Shared Documents Capability
```

物理实现可以共用，领域契约必须分开。

---

## 3. 两个 Domain 的职责边界

### 3.1 Content Space

`content-space` 解决的问题是：

> 一个 SciForge Project 的文件、证据和任务产物放在哪里，以及如何上传、下载和稳定引用。

主要能力包括：

```text
selectSpace
createProjectFolder
listEntries
getFileMetadata
uploadFile
downloadFile
renameFile
createEvidenceRef
createArtifactRef
```

核心对象包括：

```text
ContentSpaceRef
FolderRef
FileRef
EvidenceRef
ArtifactRef
```

典型资源包括：

- 普通任务附件；
- PDF；
- 图片；
- 数据文件；
- Office 文件；
- Agent 生成的结果文件；
- Task 验收时需要固定版本的产物。

它关注的是文件空间、传输、引用和版本固定，而不是正文协同编辑。

---

### 3.2 Shared Documents

`shared-documents` 解决的问题是：

> Human 和 Agent 如何围绕同一篇持续变化的文档进行协作。

主要能力包括：

```text
createDocument
openInBrowser
readStructuredContent
prepareEdit
applyEdit
getRevision
resolveConflict
subscribeChanges
```

核心对象包括：

```text
SharedDocumentRef
DocumentSnapshot
DocumentBlock
DocumentRevision
DocumentEdit
DocumentConflict
```

典型资源包括：

- 项目总结；
- 持续更新的研究报告；
- Human-Agent 共同维护的正文；
- 需要结构化读取和区块级修改的 `.mdoc`；
- 需要 revision 和并发冲突处理的在线文档。

它关注的是正文结构、持续编辑、并发一致性和浏览器协作，而不是普通文件上传下载。

---

## 4. 为什么必须拆分

### 4.1 业务语义不同

Content Space 管理的是“项目文件和固定产物”；Shared Documents 管理的是“持续变化的协作文档”。

例如：

```text
Task.artifactRef
    → 表示 Worker 完成任务时提交的那个固定版本

SharedDocumentRef
    → 表示仍可能被 Human 和 Agent 持续修改的当前文档
```

如果二者不区分，Coordinator 验收某个 Task 后，协作者继续修改同一文档，可能导致以后看到的内容与验收时不一致。

---

### 4.2 一致性模型不同

Content Space 通常按完整文件工作，主要关心：

- 文件 ID；
- 文件版本；
- 上传状态；
- 文件大小；
- 校验值；
- 下载与归档。

Shared Documents 则需要：

- 稳定的 block/paragraph ID；
- structured snapshot；
- authoritative revision；
- `expectedRevision` 条件写入；
- stale revision 冲突；
- 幂等操作；
- Human-Agent 并发编辑语义。

这两套一致性模型不应塞进同一个巨大接口。

---

### 4.3 当前交付成熟度不同

OpenContent 已经基本验证可用于 Content Space PoC：

- 用户登录；
- 团队库；
- 项目文件夹；
- 普通文件上传、列表、详情和下载；
- 稳定的 folder/file 引用；
- `.mdoc` 创建；
- 浏览器人工协作。

但 Shared Documents 的 Agent 正文能力仍缺少正式合同：

- `.mdoc` 结构化正文读取；
- 稳定区块 ID；
- 区块插入、替换和删除；
- authoritative revision；
- 条件写入和冲突检测；
- 幂等写入与恢复；
- 正文操作审计 ID。

因此：

```text
content-space        可以先开发和交付 PoC
shared-documents     正文读写仍受厂商接口阻塞
```

拆分后，Content Space 的交付不会被正文 API 阻塞。

---

### 4.4 供应商替换路径不同

当前两个能力都可以由 OpenContent 实现：

```text
Shared Documents → OpenContent
Content Space    → OpenContent
```

未来可能变成：

```text
Shared Documents → Yjs / OnlyOffice / Collabora
Content Space    → OpenContent
```

或者：

```text
Shared Documents → OpenContent
Content Space    → S3 / Google Drive / 其他对象存储
```

如果做成一个 `OpenContent Integration`，替换其中一项能力时会牵连另一项；按 domain capability 拆分后，可以独立替换 Provider。

---

### 4.5 调用方和 UI 不同

Content Space 的主要调用方包括：

- Project 创建流程；
- TaskResult 提交流程；
- Evidence/Artifact 上传流程；
- 文件选择器；
- 上传进度和附件展示。

Shared Documents 的主要调用方包括：

- Agent 写作流程；
- Human-Agent 协作文档流程；
- 打开浏览器编辑命令；
- 正文读取、编辑和冲突处理流程。

即使最终都打开 OpenContent 网页，它们在 SciForge 内部的入口和使用场景仍然不同。

---

## 5. 物理复用与逻辑隔离

拆分 domain package 不意味着复制两套 OpenContent 接入代码。

建议共用一个底层 OpenContent Connector：

```text
OpenContent Connector
├── authentication
├── provider connection
├── token storage
├── HTTP client
├── request/response schema
├── error mapping
└── audit/correlation handling

        ↑                       ↑
        │                       │
content-space            shared-documents
 domain package            domain package
```

共同复用：

- OpenContent URL 配置；
- 用户登录与 Token；
- 本地安全存储；
- HTTP 请求封装；
- `result != 0` 业务错误处理；
- 401 重认证；
- 日志脱敏；
- Provider instance 配置。

保持独立：

- capability contract；
- 领域对象；
- readiness；
- 测试；
- 版本；
- Agent Tool；
- 供应商替换路径。

换句话说：

> 共用底层连接，不共用领域语义。

---

## 6. 推荐的数据模型

### 6.1 SciForge 一侧

```text
SciForge Project
├── contentSpaceRef
├── sharedDocumentRefs[]
└── Tasks[]
    ├── evidenceRefs[]
    └── artifactRefs[]
```

含义：

- `contentSpaceRef`：指向项目在 Provider 中的内容空间；
- `sharedDocumentRefs`：指向持续变化的协作文档；
- `evidenceRefs`：指向任务证据；
- `artifactRefs`：指向任务完成时提交并可固定版本的产物。

### 6.2 OpenContent 一侧

```text
OpenContent Team Library
└── Project Folder
    ├── shared-documents/
    ├── evidence/
    ├── artifacts/
    └── assets/
```

这些子文件夹可以是约定，不一定需要强制创建。

OpenContent 保存真实文件和正文；SciForge 保存 Provider Reference。

---

## 7. Reference 不是权限

建议的 `ContentSpaceRef`：

```typescript
type ContentSpaceRef = {
  providerInstanceId: string
  containerId: string
  folderId: string
  folderGuid: string
}
```

建议的 `SharedDocumentRef`：

```typescript
type SharedDocumentRef = {
  providerInstanceId: string
  containerId: string
  fileId: string
  fileGuid: string
}
```

建议的固定任务产物引用：

```typescript
type ArtifactRef = {
  providerInstanceId: string
  containerId: string
  fileId: string
  fileGuid: string
  fileVersionId?: string
  checksum?: string
}
```

Reference 中不得保存：

- 用户密码；
- Token；
- Cookie；
- 集成密钥；
- 管理员凭据。

每次操作都必须结合当前 Human Principal 和本地 Provider Connection 重新鉴权。知道 `fileId` 或 `folderId` 不代表拥有访问权限。

---

## 8. 两个 Domain 的协作方式

### 8.1 创建 Project 内容空间

```text
Cloud Project Orchestration
        ↓
content-space.createProjectSpace()
        ↓
OpenContent 创建 Project Folder
        ↓
返回 ContentSpaceRef
        ↓
云端保存到 Project.contentSpaceRef
```

### 8.2 创建共享文档

```text
Workflow 获取 Project.contentSpaceRef
        ↓
shared-documents.createDocument(containerRef)
        ↓
OpenContent 创建 .mdoc / 协作文档
        ↓
返回 SharedDocumentRef
        ↓
Project 保存 sharedDocumentRefs[]
```

### 8.3 上传任务产物

```text
Worker 完成 Task
        ↓
content-space.uploadArtifact()
        ↓
OpenContent 保存文件
        ↓
返回 ArtifactRef
        ↓
TaskResult.artifactRefs[]
```

两个 domain 通过 Provider Reference 和上层 workflow 组合，不需要彼此直接依赖供应商内部实现。

---

## 9. 推荐包结构

```text
packages/domains/
├── content-space/
│   ├── sciforge.domain.json
│   └── src/
│       ├── contract/
│       ├── main/
│       └── renderer/
│
└── shared-documents/
    ├── sciforge.domain.json
    └── src/
        ├── contract/
        ├── main/
        └── renderer/
```

底层 OpenContent Connector 作为共享技术包存在，具体目录位置应根据仓库现有 package boundary 决定，但它不应被定义为面向 Agent 的业务 domain。

```text
shared OpenContent connector
├── auth
├── client
├── schemas
└── error mapping
```

---

## 10. 与云端模块的责任划分

### Domain/Provider 负责人

负责：

- `content-space` domain contract；
- `shared-documents` domain contract；
- OpenContent Connector；
- OpenContent Adapter；
- Provider Connection 与本地凭据；
- 文件和文档操作；
- Reference 生成；
- Provider 错误和权限保护。

### 云端负责人

负责：

- Project、Task、TaskResult；
- `Project.contentSpaceRef` 的保存；
- `Task.evidenceRefs` 和 `Task.artifactRefs` 的保存；
- Project 创建和 Task 完成时的能力编排；
- Agent 注册、信箱、WebSocket 和 Project Record；
- 不保存 OpenContent 用户密码或 Token。

原则是：

> “怎么访问 OpenContent”属于 Provider/domain；“Project 何时调用能力、如何保存引用和跨 Agent 流转”属于云端编排。

---

## 11. 非目标

V1 不应把 OpenContent 文档：

- 投影到 SciForge Workspace 文件树；
- 纳入 Git；
- 做本地与云端双向同步；
- 通过共享管理员账号统一访问；
- 通过 DOM 自动化绕过缺失的正文 API；
- 把普通文件版本误认为协作文档 revision。

Workspace、本地 Git、Content Space 和 Shared Documents 是不同的权威数据域。

---

## 12. 最终架构判断

推荐确认以下决策：

> 即使 Content Space 和 Shared Documents 都由同一位开发者负责、都使用 OpenContent、都在同一个网页中呈现，也应作为两个独立的 trusted compile-time domain package 交付。
>
> 两者可以复用同一个 OpenContent Connector、用户身份和底层 Client，但必须保持独立的 capability contract、领域对象、readiness、测试、版本和供应商替换路径。

最简洁的理解是：

> **Content Space 管理“项目文件放在哪里、如何稳定引用”；Shared Documents 管理“Human 和 Agent 如何持续协作编辑正文”。**

物理上共用 OpenContent，逻辑上按 domain capability 分开。
