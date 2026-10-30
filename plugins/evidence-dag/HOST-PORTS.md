# Evidence DAG 最小宿主接口需求

本接口描述插件与 Host 的公共边界。官方 Cordis + Tools 可执行本制品；SciForge 通过生成的安装域组合解析 Host service，插件实现归属 `packages/domains/evidence-dag/src/host/`，不再从插件私有源导入。

## 已实际使用的需求

DSH Context 需要 Host 扩展服务 `evidenceDagPorts`（不是官方内建服务）。公共类型位于 `@sciforge/domain-evidence-dag/host/ports`。批准的 Host 连接提供固定 `identity={pluginId,version,profileId}` 和仅属于该插件/版本迁移策略的持久 `storageRoot`；不得由工具参数指定或把完整 Host Context 传入 core。

统一 JSON 请求：`protocol=sciforge-evidence-ports.v1`、`requestId`、连接绑定 `identity`、调用 `caller`、`scope={runtimeId,threadId,workspaceRoot}`、`operation`、`input`。取消仅传 request ID，返回真实 `cancelled/quiescent`，不能把超时当取消。结构化错误须保留 code/message；Host 必须在效果前验证调用身份/批准/线程权限，不能信任输入里的 identity、workspaceRoot、callId。

| operation | 真实用途/返回 | Host 所有权 |
|---|---|---|
| `threads.read` | 返回精确匹配 scope 的 `{runtimeId,threadId,workspaceRoot,watermark,trace}`；trace 是现有 `evidenceTraceFromThread` 的受可见性过滤 artifact 投影，不含完整私有线程上下文 | AgentThreads 读权限及当前线程绑定 |
| `threads.list` | 生命周期消费者发现获准的 Scope[]；须限制在调用者获准线程/工作区 | 线程发现与过滤 |
| `artifacts.commit` | canonical ArtifactVersionCommitInputV1 -> ResultV1 | 不可变 Artifact Versions 权限/真实服务 |
| `artifacts.read` | canonical ArtifactVersionReadInputV1 -> ResultV1 | 读访问及脱敏 |
| `artifacts.listEvents` | canonical event list（afterSequence）-> ResultV1 | 持久事件日志与权限 |
| `sidecar.commitSnapshot` | `{threadId,trace,targetWatermark,workspaceRoot,idempotencyKey}` -> `{snapshot,...}`；formal closure 不发布 latest | 批准执行器、wheel 摘要、Python 进程与模型回调批准 |
| `sidecar.readSnapshot` | `{threadId,snapshotDigest,workspaceRoot}` -> 精确 `{snapshot,...}`，需验证持久内容摘要/投影 | 同一 Python owner，禁止重算替代恢复 |
| `sidecar.close` | 同一插件所有 worker 全部停止且 OS exit 后返回 `{exited:true}` | 必须追踪 preparing/active 子进程并可恢复失败停用 |

`sidecar.snapshotProducts` 已调用：`{threadId,snapshotDigest,workspaceRoot,datacite}` -> canonical 五种产品与精确 source refs 的投影；Python 重验持久 digest/访问范围，JS canonical exporter 重验字节摘要与 source ref 并执行单一真实 Artifact Versions 原子 commit。它仍需要未交付的批准执行器桥接。

## 仍缺的原生自动路径接口

当前 adapter 不承诺自动捕获 Agent/Scientific Plotting 事件。原生 `consume(DomainArtifactEvent)` 与科学 provenance consumer 依赖 Host 持久事件源及 enablement 通知；需要公共平台提供连接绑定的 JSON 订阅/取消订阅/重放 watermark（事件带真实 runtime/thread/workspace、稳定 event identity），停用要等待投递在途处理静默。不能用轮询 synthetic fixture 或另一工作线私有 hooks 冒充这一交付。尚未新增这些不存在的 API 到运行请求枚举。

旧 Python-only Snapshot 的 legacy root 导入还需要 Host 显式授予原生 Snapshot 存储路径和迁移所有权；当前 runtime 读取已有 delta/closure 绑定文件，不自动访问原生用户目录。生产目录迁移/composition 排除需维护者处理。

## 事实层边界

JS 复用 canonical Evidence delta store 与 Artifact Versions client/lifecycle，保存 `deltas.json`、`artifact-version-lifecycle.json`（outbox/cursor/receipts）。Python wheel 只拥有 canonical compiler 与不可变 Snapshot 文件，不创建另一套上游事实库。Project 仅可消费已有 Evidence refs，本文不改 Project。

`PythonEvidenceWorker` 是可由批准执行器复用的插件侧组件，不是 SciForge 跨进程 Host bridge。真实 wheel-only stdio 测试仅使用合成 reasoner，不调用模型/网络，不证明产品权限批准链。
