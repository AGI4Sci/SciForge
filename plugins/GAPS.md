# 公共插件化协议缺口登记（版本化组）

> 依据《SciForge 原生域模块运行时插件化改造方案（阶段一）》：发现公共缺口时先登记并共同修改公共版本，不在各自模块中添加私有旁路。
> 登记人：版本化组（git-checkpoints / research-checkpoints / scientific-plotting / research-dossier / change-inspector）
> 基线：`main @ e975be58`；历史参考实现 `origin/feat/plugin-scientific-compute @ a2e948c4`（方案中的 `8c2ff1a1d` 不在该分支线上）。Scientific Compute 内置包与 DSH 插件均已 **retired**，源目录与专属 README 已退出；commit/工具身份仅保留历史证据，不作为源码或安装入口。见 [退役说明](../docs/operations/scientific-compute-retirement.zh-CN.md)。

每个缺口包含：现状证据、影响模块、最小复现/验证方法、接口需求建议。状态字段：已登记 / 已确认 / 公共版本已解决 / 有既定替代方案。

---

## G1 插件进程无法反向调用宿主能力（阻塞性）

**状态**：已登记（待公共版本维护者确认）

**现状证据**：`packages/plugin-sdk/src/process-extension-runner.mjs` 的命令分发只有父→子方向（`activate / invoke / managed-discover / managed-invoke / workflow-invoke / synthetic-session / renderer-contributions / deactivate / unregister / dispose`）。runner 安装的 Cordis 服务固定为 `SystemPrompt`、`ToolRuntime`、`Storage/StorageJson/StorageDomain`、`SessionStore/SessionProjectionRegistry`，没有通向宿主 CapabilityBroker 的服务。IPC 消息类型中子→父只有 `ready / capabilities / crash / response`，没有调用请求。

**影响模块**：
- git-checkpoints：Git 操作必须经宿主核心 `version-control.*` 能力（治理路径，不能在插件里直接 spawn git）。
- research-checkpoints：committed manifest 字节的 commit/read/list/restore 全部走 `artifact-versions.*` 能力。
- scientific-plotting：artifact commitV1/readV1 port 同样落在 `artifact-versions.*` 能力上。

**最小复现**：用 `ProcessExtensionHost` 激活任一需要在 `execute` 内调用宿主能力的插件：工具实现无处获得 `capabilities.invoke`，只能 fail。

**接口需求建议**：runner 增加一个 Cordis service（建议名 `hostCapabilities`），形状：

```text
hostCapabilities.invoke(actionId: string, input: unknown, options?: { workspaceId?: string }): Promise<unknown>
```

- 经 IPC 转发到宿主 `CapabilityBroker`，caller 为插件 principal（packageName + generation），workspace 由宿主按授权解析；
- 宿主侧在 `PluginDshAuthorization` 增加按 (plugin, actionId) 的调用许可表，fail-closed；
- 传输只过可序列化数据；错误、取消、超时语义与 `invoke` 命令一致。

**本组过渡策略**：上述受影响模块的 core/ports 拆分与 static 对照测试不依赖 G1；dsh-adapter 经注入获得 port 实现，未接通的宿主能力在加载测试中用 fixture port 验证注册/调用/生命周期通路，真实接线状态按各模块记录。

**Change Inspector 当前边界**：其会话读取已使用[通用 agentThreads Host service](<../src/main/extensions/agent-threads-host-service.ts>)，正式契约声明 `agent-threads.read`，生产入口注入 `tools` 与 `agentThreads`，不使用 fixture、`dshConfig.sessions` 或工具入参 `sessionDetail`。这是一条受控的当前会话只读代理，不是任意 `capabilities.invoke`：Host 从已认证 Agent ordinary Session、workspace 与 live package/version/generation grant 建立 authority，拒绝跨 workspace、同 workspace 的其他 session、其他 runtime、UI caller 和伪造身份。snapshot await 后、每个 artifact await 后及最终返回前均异步重新授权 workspace，authorizer await 前后均检查 lease/signal/owner/version/generation/精确批准 port；不能用 Principal lease 替代动态 workspace 授权。外置 detail 只按已授权 aggregate 的 canonical artifact ref 补全，保留 ref/response scope 与 reader fail-closed，Host 返回通用无损 thread 投影，diff 业务归插件。正式 0.1.2 已在标准构建应用、独立 profile 的真实 Agent 路径复验；follow-up已观察真实packaged workspace撤权返回authorization拒绝，但所有live档案hostAwaitBoundaryProven:false，精确snapshot/artifact await后的撤权及全部跨workspace/runtime负向仍由自动化覆盖，不能扩大live结论。此结果不代表其他插件 G1 缺口全部解决或全平台发布验收完成。

---

## G2 宿主 turn 生命周期与 artifact 事件流无法到达插件

**状态**：已登记

**现状证据**：
- `packages/domains/research-checkpoints/src/main.ts` 的 activate 要求 `context.turnEvents.subscribeRequiredBeforeTurn` 存在（缺失即抛错）；`runtime.ts` 还消费 `readDurableTurnBoundarySnapshot` 做重启对账。
- `packages/domains/git-checkpoints/src/runtime.ts` 订阅 `turnEvents`（before-turn / after-turn 终态）自动 capture。
- research-checkpoints 的 `main.artifact-consumer` 贡献消费宿主 `DomainArtifactEvent` 流（`src/main/modules/runtime-contributions.ts` 收集激活）。
- runner 侧没有任何事件推送通道（`capabilities` 消息只用于工具表变更）。

**影响模块**：research-checkpoints（必需）、git-checkpoints（自动快照）。

**最小复现**：插件 activate 后无法获知 turn 边界，自动 checkpoint/提取队列完全不触发。

**接口需求建议**：由宿主把 turn 边界事件转换为对插件能力的普通调用（方向 宿主→插件，复用现有 invoke 通道，不需要子→父新通道），例如插件暴露 `record-turn-boundary` 工具（effect compute，input 为可序列化的 turn 边界快照）；宿主在插件启用期间订阅 `turnEvents` 并转发。artifact-consumer 事件流同理。这样 G2 可以在不改动 runner 的前提下由宿主侧（或宿主薄层）解决；请维护者确认该方向或提出 runner 级事件服务。

---

## G3 Broker 资源观察通道（observe/subscribe）无法用 DSH 工具表达

**状态**：Change Inspector 当前 MVP 使用工具请求/响应契约，不依赖旧面板的 observe/subscribe；通用插件订阅协议不因此宣称已实现。本机标准构建及真实macarm64 ad-hoc打包应用与正式安装插件 **0.1.2** 的真实链路已有验证；Developer ID、公证与全平台发布验收尚未完成。DSH durable runtime 的事件订阅 fence 是 Host 历史完整性契约，不是本节缺失的插件 observe/subscribe 协议。

**当前契约**：[独立插件](<./change-inspector/README.md>)是唯一生产实现，公开 `change-inspector.open-session` / `change-inspector.list-changes` 归插件声明与维护。`open-session` 直接返回 `{ sessionId, resourceId, snapshot }`，`list-changes` 返回分页摘要、revision 与截断说明；结果进入发起调用的 Agent 会话。结果中的 `resourceId` 是数据标识，不是旧面板的 Broker 观察句柄。没有静态 fallback、旧面板或 Change Inspector 专属薄层。

**Host 通用资源边界**：插件声明 **2 个 read 工具**；Host 另外按贡献命名空间派生 generic `dsh-session.open`，发行 caller/workspace/ordinary-session/generation 绑定的 `dsh-session` 资源，用于授权调用。opener 不计入插件声明工具，也不承担 diff 投影或旧面板订阅。

**有界结果**：plain/JSON patch 仅以 trim 判断非空，实际原文、尾空格、LF/CRLF、原始字节数与 revision hash 均保留。单 patch 64 KiB、序列化 snapshot 256 KiB、单条摘要 patch 1 KiB（UTF-8 bytes；snapshot 含 JSON escaping 与元数据），最多 5,000 条 changes，超限保留最新后缀。`patchBytes` 记录截断前原始大小，`patchTruncated` 标记缩短；快照原因包括 `patch-byte-limit` / `snapshot-byte-limit` / `change-count-limit`，摘要缩短另由逐条标记表达。revision 覆盖截断前完整内容，排除普通读取推进的 watermark；cursor 绑定 session + revision，跨 session、编辑后过期或畸形 cursor 拒绝。

**其他通用修复契约**：DSH durable 目录按 journal 排除明确的 `captureFailure`，不阻断健康工作区；失败线程 cold read page/status、startTurn、artifact read 及 subscribe（有/无 cursor）仍以 `runtime_history_capture_failed` 拒绝，损坏 JSON/header/tail 不被静默吞掉。canonical workspace receipt 的 diff header 使用 Git C-style quoting；控制字符、引号、反斜杠和 Unicode 的真实 Git decode 与 Broker reverse/apply 文件字节 roundtrip 已覆盖，不宣称任意非 UTF-8 path metadata 全链保真。

**验证范围（2026-11-03）**：正式 0.1.2 在同一真实应用 / 同一 session、官方 DSH `0.2.1-rc.4`、SciForge Router `yunshu/gpt-6.1-sol` 完成两回合。仅计本轮 seq > 297：[原始事件](<../../evidence/remediation-live-complete-events.json>)、[canonical snapshots](<../../evidence/remediation-live-canonical-snapshots.json>)及[最终 verifier](<../../evidence/remediation-live-byte-verification-final.json>)表明，首轮 `pending \n` → `reviewed \n` 保留一个尾空格/LF，次轮只增为两个尾空格/LF；275/277-byte 小 patch 逐字节匹配 executor `workspaceMutation.patchText`，两轮项目 `npm test` 均5/5。旧 cursor 场景出现 session/revision 不匹配的 handler 拒绝，新 revision 前两页稳定且相对首轮变化；未宣称遍历全部大历史或能从归档重新认证旧 cursor 原始参数的每个字节。

两轮 snapshot **200,622 / 201,162 bytes**，大 patch 原始 **162,327 bytes**、返回 **65,536 bytes**，同时报告 patch/snapshot byte limit。历史 **162,326 是 trim 缺陷的错误统计，不能当正确原始值**。历史五个 canonical 大 patch 仍能重建磁盘 after bytes；本轮没有重新计为五次 mutation。历史 watermark 分页失败、hydration 遗漏及其修复、停用/恢复与其他 session / strict handler 拒绝证据保留。[最新独立复审](<../../evidence/remediation-independent-review.md>)已确认四项修复和 cold live-only subscription 补修，未扩张为全部 live 安全或发布通过。

**自动化与限制**：插件 **75/75**；Host focused **14 suites / 495 pass**；provider **79**、durable + DSH **22**、receipt **45** + preview **3** + model-visible **6** = **54** 为重叠定向覆盖，不能重复累加。full typecheck、标准 build、改动 lint、composition / capability governance 通过；含 subscription 补修的[最终全量 Vitest](<../../evidence/remediation-full-vitest-final.txt>) **5,805 pass / 8 skip / 0 fail**，最终标准 build 亦完成。旧4 fail 通过标准 dist build 与严格 manifest/serviceIds 测试修正解决，没有放宽契约。follow-up从同一AGI4Sci origin恢复真实历史，任务Git指针独立，未改共享仓库；初始全局GIT_DIR污染fixture私有元数据已恢复，不再使用全局覆盖。[最终root npm test](<../../evidence/followup-full-npm-test-final.txt>)退出0，EvidenceDAG Python279OK及Vitest5805pass/8skip/0fail；旧identity构建脚本exact期望严格对齐root heap wrapper。[changed-path gate](<../../evidence/followup-architecture-gate-final.txt>)实际baseline祖先成立，787生产源码/20域/0findings通过，架构测试/fulltypecheck通过。formal Stage4需clean/指定codex分支/private overlay，不在本任务通过声明内。

candidate/late-completion等自动化仍区分于live。follow-up旧packaged已真实workspace撤权authorization拒绝、disable No live grant、精确child crash runtime_crashed且17域healthy；cancel同一itemaborted/turninterrupted不等于handlerreject或观察实际迟到reply。最终fixed包新模型回合[authenticated读取完成](<../../evidence/followup-live-faults-healthy-2026-11-03T09-51-44.762Z.json>)并保留seal，四fault未在final包再全跑。[故障索引](<../../evidence/followup-live-fault-status.md>)所有hostAwaitBoundaryProven:false；精确artifact await后撤权、capture-failed、特殊路径及全部跨workspace/runtime负向、完整旧资源清理仍未全live演练。

真实包Python写pycache破坏seal已用SDK ownedPythonLaunch的-B/env策略统一2个desktop DAG sidecar修复，RED真实缓存/GREEN18focused、SDK165、DAG225及类型/lint；不称wheel/plugin全Python修复。source/fixedpackaged/zip展开smoke均0且运行前后codesign0；基础smoke严格installedPluginsVerified:false、17项回归，不把未安装plotting要求为静态贡献。[制品](<../../evidence/followup-release-verification.json>)macarm64 ad-hoc zip463486384bytes/SHA256 d15042724781115163cc79e210a5817fdda48074da11446e2f7188ac44a3de3f，无Developer ID/公证/发布/全平台结论，DSH为用户配置官方安装而非pinned自包含closure。[独立follow-up复审](<../../evidence/followup-independent-review.md>)已完成，补修与证据成立、独立35项轻量测试通过；完整入口exit0来自主执行日志交叉核验，不称独立重跑全库。完整边界见插件README；历史A4和旧面板smoke不作为当前通过证据。

---

## G4 原生依赖（@napi-rs/canvas .node 二进制）在隔离 runner 中的加载未验证

**状态**：已验证可行（2026-10-13，本组实验）

**验证结果**：`packages/domains/scientific-plotting` 的 host-loading 测试在隔离目录用 `ProcessExtensionHost` 真实 fork 子进程激活插件，并完成一次真实 render：runner 通过默认模块解析在插件目录的 `node_modules` 中找到 external 的 `@napi-rs/canvas`，原生 `.node` 加载成功，PNG 落盘 `<workspace>/.sciforge/figures/`。esbuild 产物（`dist/main.js`，约 966K）将 `@napi-rs/canvas` 保持为 external 即可工作，无需渲染器 port 抽象。

**现状证据**：`process-extension-runner.mjs` 的 `registerHooks` 把 `@deepseek-ai/*` 白名单包与 `zod` 的模块解析固定到 SDK 部署位置；其余 import 的解析行为未钉死。`packages/domains/scientific-plotting` 的渲染引擎依赖 `@napi-rs/canvas`（napi `.node` 二进制），无法用 esbuild 内联进单文件 ESM 产物。

**影响模块**：scientific-plotting（render/rerun 路径）。

**验证方法（Phase 4 第一步）**：最小插件 import `@napi-rs/canvas`，esbuild 打包（该包 external），在隔离目录用 `ProcessExtensionHost` 真实激活并调用一次渲染，观察模块解析与原生加载结果。

**接口需求建议**（若实验失败）：把渲染器抽象为 port（`RasterRendererPort`），插件 core 只编排；dsh 环境下渲染实现由公共版本支持（宿主提供或批准插件自带 node_modules 解析）。在此之前 render/rerun 的 dsh 真实路径标记为受阻。

---

## G5 没有「排除单个静态域包 main 贡献」的现有开关

**状态**：本节原静态 main 摘除议题保留给仍有静态对应面的模块；Change Inspector 已采用独立插件唯一实现，不再等待接管判定或摘除时机。本机标准构建及macarm64 ad-hoc安装包的真实验证见G3；Developer ID/公证与全平台发布验收仍待完成。

**Change Inspector 当前边界**：不保留静态域执行入口、renderer 旧面板或专属公开能力薄层；插件未安装、未启用、未授权或调用失败时 fail-closed，不恢复静态提供者。公开 id 由插件拥有，Host 仅提供通用 session opener 与 `agentThreads` 授权服务。以下是其他仍有静态对应面模块的原问题记录，不作为 Change Inspector 的装配说明。

**原现状证据**：`src/main/index.ts:1965-1968` 中 `enablement.isEnabled = (moduleId) => catalog.hasModule(moduleId)`，即启用状态就是目录成员关系；subscribe 是 no-op。`scripts/domain-packages.mjs` 没有任何 exclude/disable 过滤。CapabilityRegistry 对重复 actionId 的注册视为冲突，因此插件与静态包同名能力不能同时注册。

**影响**：方案要求「迁移完成后必须能明确排除原静态执行路径」；本组 UI 保留静态（renderer 入口不动），只需排除 main 入口。

**候选落法**（不新增开关系统，走现有 manifest + 生成器）：
- 迁移收尾时，从该包的 `sciforge.domain.json` 移除 `main` entrypoint（保留 `renderer` entrypoint），`npm run domain-packages:generate` 重新生成组合；静态 `src/main.ts` 代码保留在包内供 parity 测试相对路径 import（与参考插件的测试豁免一致）。
- 移除时机影响生产行为（移除后该能力只能由插件提供，而插件加载目前是开发态路径），因此具体摘除时机需维护者确认；摘除前本组用不带静态组合的 harness 测试（参照 `src/main/extensions/development-plugin-broker-chain.test.ts` 的接线）验证插件链路，避免双注册。

---

## G6 一个插件只能声明一种贡献面（正式通用契约）

**状态**：已实现，宿主 + SDK 通用机制，不依赖生物功能或生物 runtime 插件。

一个实际插件可以同时提供能力面与预览面，不需要多值 `kinds`：

- `sciforge.adapter.json` 使用单 `kind`（schemaVersion 1）；`kind: "workspace-preview"` 的
  `previewSlots` 必须非空且槽 id 不重复。
- 能力面通过原生 Cordis `apply(ctx)` + `ctx.tools.register` 提供，工具意图由
  `sciforge.dsh.json` 声明；安装器要求制品声明的工具全量显式批准。
- 宿主精确版本 `PluginDshAuthorization` 决定工具授权；预览面需要已批准的
  exact-version adapter 契约及包内槽白名单。声明本身不产生权限。
- 运行时缺 grant 的工具不注册；后续调用仍复核授权与 generation。发布失败不能留下
  半注册贡献，停用、卸载与撤权遵守公共生命周期。
- `scope: "workspace"` 授权让宿主在每次调用绑定已认证的工作区；模型提供的
  `workspaceRoot` 不构成授权，不需要只为满足注册门槛而配置空 service client。

公共原生工具与预览同包机制由 [中性真实子进程测试](<../packages/plugin-sdk/src/native-preview-entry.test.ts>)
固定，通用插件机制继续保留。

**生物功能边界**：Biology Room 与 Life Science Preview 均由内置
`@sciforge/domain-biology-workbench` 的两个子模块提供。它们使用标准域清单、
CapabilityBroker 与 Workspace Preview，不参与本节的插件安装、grant 或启停流程；
不配置生物插件接管或内置/插件备用路径。见 [内置设计说明](<../docs/operations/biology-workbench-built-in.zh-CN.md>)。

以下仍是通用插件问题，不因生物功能内置而宣称解决：

- DSH 工具结果没有 `changed` / `semanticRevision` 顶层字段；变化事实保留在输出中。
- 拒绝 drain 的插件在失败后重新启用时的预览恢复、安装目录内容与 policy 的 integrity
  绑定，仍需公共生命周期与制品完整性验证。
- 在途调用撤权会通知取消；子进程内部副作用的停止取决于插件对取消的响应。
- `sciforge.dsh.json` 的 packaging 与 discovery 解析实现尚未共享。

通用市场准入保留：只贡献预览槽的制品可按已声明槽、宿主激活、可信签名与无 ID 冲突
准入；既无工具也无槽的制品拒绝。生物功能不作为市场安装条目或该机制的安装证据。

---

## G7 非 compute effect 的工具在宿主侧被静默跳过（未配置 service clients 时）

**状态**：公共版本已解决（#134）

**解决记录（#134）**：四处执行点（注册 `continue`、调用 `throw`、workspace 读 opener、dsh-session 读 opener）
删除「非 compute 工具必须有 service clients」子句；注册改由精确版本的 grant 决定，其余 fail-closed 条件
（approved / packageName / packageVersion / dshRuntimeVersion / grant.id / grant.effect / readResource）原样保留。
注册路径的静默跳过改为 `logWarn`（package + tool id + 失败条件，不含 input）。`#serviceClientsFor` 与
`resolveServiceClients` 保留，仅用于装配 service clients。附带修复 scoped 包名的 session opener id
（改用贡献命名空间，原先 `@scope/name.dsh-session.open` 触犯能力 id 正则）。历史真机证据：
Scientific Compute 插件当时声明 2 注册 2，`compute_run_baseline` 经真实 Broker 调通。
该插件现已 retired；**G7 是通用宿主修复，不随参考模块退役回退**。

**历史现状证据（#134 修复前）**：
- `src/main/extensions/development-external-plugins.ts:1271` 的授权过滤条件是
  `!grant || grant.id !== remote.id || grant.effect !== remote.effect || !validReadResource(grant, remote) || (grant.effect !== 'compute' && !(hasHostServiceClients ??= this.#serviceClientsFor(...).length > 0))` 后 `continue`。
- 也就是说：`read` / `workspace-write` / `external-write` / `destructive` 工具要进宿主注册表，
  该插件必须已经配置了 Host service clients；没有 clients 的插件只会有 `compute` 工具被注册，
  其余工具**不报错、不告警、直接消失**。
- 同一分支 `:1290` 与 `:1353`（workspace read opener）重复了同一条件，`sciforge.dsh.json`
  里声明了也无济于事——声明只决定"授权是否存在"，不决定"是否注册"。

**影响（G7 时期；参考模块现已 retired）**：Scientific Compute 插件当时声明两个工具，宿主只注册
`scientific-compute.run-baseline`；`scientific-compute.status`（effect: read）在真实
`DevelopmentExternalPluginService` + `CapabilityRegistry` 路径下不可发现、不可调用。
当时的 hotplug-activation 用例「the read tool is not projected without host service clients (G7)」
记录修复前行为；该专属用例随模块删除，不再作为当前源码入口。
该插件当时是纯计算模块，加空 Host service 属制造旁路，故未采用。

**历史最小复现（#134 修复前）**：任意 `sciforge.dsh.json` 同时声明一个 `compute` 与一个 `read` 工具、且断点
`pkg/main` 没有 `./host-services` 导出的插件，经真实宿主激活后比对
`CapabilityRegistry.list()`：只有 compute id 出现。

**接口需求建议**（二选一）：
- 将"非 compute 工具需要 service clients"从注册前置条件改为运行期授权条件（注册但调用时
  fail-closed），或
- 若保留前置条件，宿主必须在注册阶段给出可见诊断（summary 增加 `skippedTools` 字段并写明
  原因），而不是静默 `continue`。

**本 PR 的增量**：#134 已删除注册门槛；本 PR 保留宿主契约里的 `hostServices: 'none'` 作为
**调用通道标记**（G9 用它把无 Host 服务的插件固定到会话信封通道），不再参与注册判定。

**Anchored Comments 当前路径（2026-11-03）**：实现仅在 `plugins/anchored-comments`，
声明八个 workspace-scoped 工具；Host 回归测试要求全部声明能力注册，不能再以 G7 为由静默
跳过。`tests/harness.ts` 从插件期望 grants 推导 `EXPECTED_IDS`。需要截图时应申请真实的通用
受控 Host 服务，不添加空服务以绕过注册门槛。注册数量与真实 Agent 可见数量、实际任务完成
必须分别验收；此前 G7 的零注册仅为历史故障。

---

## G8 workspace-write 操作无法表达 `approval: confirmation`

**状态**：公共版本已解决（本 PR #138）。`sciforge.dsh.json` 的 tool 条目新增可选
`approval: 'none' | 'confirmation'`，宿主投影采用"声明可上调、不可下调"。

**当前合同**：`sciforge.dsh.json` 与实际 Host grants 可声明 `approval: confirmation`，
runner 投影取 effect 审批下限与声明要求的较高者。Anchored Comments 的删除和外部反馈提交
均显式声明 confirmation，聚焦 Host 测试逐项核对；旧内置域已退出，不存在静态 UI 确认兜底。
真实应用验收仍须观察实际审批事件与拒绝后的无副作用，不能用 full-access 自动批准代替。

以下为 G8 修复前的历史复现与设计讨论，不表示当前投影仍会降级：

**影响（G8 时期）**：`plugins/anchored-comments` 的 `anchored_comments_delete` 在 DSH 形态下拿到
`approval: none`，宿主不会弹确认。也就是说同一个删除操作，静态路径要确认，插件路径不要，
属于**降级**（不是扩权，但违反 C1 的逐字段一致）。`tests/capability-parity.test.ts`
的 approval 用例把静态值锁成 `confirmation`，README 已知差异表写明投影为 `none`。

**最小复现**：任意 `sciforge.dsh.json` 声明一个 `effect: workspace-write` 的工具，静态对应能力
声明 `approval: 'confirmation'`；经 `ProcessExtensionHost` 激活后读 descriptor：
`approval === 'none'`。

**接口需求建议**（二选一）：
- `sciforge.dsh.json` 的 tool 条目增加可选 `approval`（仅允许把默认值**调高**到
  `confirmation`，宿主按 grant 校验并在调用前要求确认）；
- 或在 plugin-sdk 文档里显式写明"workspace-write 不支持确认"，由需要确认的域改用
  `destructive`/`external-write`（会改变 effect 语义，需逐域评审）。

在公共版本给出结论前：不得把 `workspace-write` 的 effect 改成 `destructive` 来绕过，
也不得在插件里自造确认 UI。

---

## G9 普通会话的工具调用缺少 DSH invocation 信封（宿主从未转发）

**状态**：公共版本已解决（本 PR #138）

**症状**：`DevelopmentExternalPluginService` + 真实 `CapabilityBroker` 下，
`anchored-comments.upsert` 等非 compute 工具一律失败：

```
Handler for anchored-comments.upsert failed: request_failed:
DSH ordinary Session invocation envelope is required.
```

**判定原文**（`packages/plugin-sdk/src/process-extension-runner.mjs:631`）：

```js
if (definition.tool && (definition.descriptor.effect !== 'compute' || definition.descriptor.scope !== 'global') && payload.invocation === undefined && !payload.hostServices) {
  throw new Error('DSH ordinary Session invocation envelope is required.')
}
```

**根因**（三处叠加，均不在插件内）：
- `src/main/extensions/development-external-plugins.ts` 调 `runtime.invoke(...)` 时第 6 参固定
  传 `undefined`，从不转发 ordinary Session 信封；
- `packages/domain-sdk/src/host.ts` 的 `invokeOrdinarySession` 只提供
  `{ runtimeId, threadId }`，runner 要求 `{ runtimeId, threadId, sessionId }`，缺会话身份桥接；
- runner 的 `synthetic-session` 命令原先无条件写 `sessionProjectionCache`，而该服务只随
  `dshStorage`（`storageDomain`）组合，纯函数/文件类插件开不出会话。

**修法**：
- 宿主新增 `DshSessionEnvelopeCache`：按 `(插件, generation, runtimeId, threadId)` 缓存
  `synthetic-session` 返回的 `sessionId`，后续 `runtime.invoke` 第 6 参传完整信封
  （`caller` / `ordinarySession` / `context`）。
- fail-closed：开会话失败、返回空 id、运行时缺失一律抛错，不降级为无信封调用。
- 生命周期：插件停用/卸载、宿主 dispose 时清空对应缓存；key 含 generation，代际变化不会复用旧会话。
- 宿主为带信封的调用接上 `authorizeDshTool`（按 live generation + 精确版本 grant 复核），
  dev seam 由 `loadDevelopmentPluginOptions` 提供 `dshAgentResolver`。
- runner 的 `synthetic-session` 允许投影缓存缺席（`persisted: false`），不要求插件私有存储。

**覆盖范围**：agent 工具面与 renderer IPC 两个调用面。renderer IPC 身份是 `ui`、不带
Session，宿主按 `(callerId, workspaceId)` 派生稳定的 `runtimeId: 'sciforge-ui'` 身份；
4 个读工具的 grant 显式声明 `readResource: 'workspace'`，由 workspace opener 发行 caller
绑定的资源，agent-only 的 `dsh-session` opener 不向 UI 开放（其安全测试未改）。

---

**补充（2026-11-02，visual-review 批次 3 接入后的 UI lane）**：除上面的 Agent 信封外，宿主再增加一条
**Host 服务授权**通道——`ProcessExtensionHost` 与 runner 的门禁对齐为「ordinary Session 信封 **或**
在途 Host 服务授权」二选一；`DevelopmentExternalPluginService` 组合了 Host service providers 时，
UI caller 的调用会带上 host-services 准入。读工具另按 `readResource: 'workspace'` 投影到
`dsh-workspace` 资源（opener 的 audiences 含 `ui`），所以渲染面板不需要 Agent 会话也能读。真机：
UI caller `read-document.open` → handle → `read-document` ok（nodes 1）、`read-image` 返回 dataUrl。
`dsh-session` opener 仍只发 agent。


---

## G10 插件子进程没有通往 artifact-versions 的正式通道（visual-review 旁路转正后暴露）

**状态**：已登记（visual-review 批次 3 转正实测；待维护者裁定）

**现状证据**：
- 正式 DSH 契约（`sciforge.dsh.json` + `defineTool`）能表达工具名、effect、tags 与参数，
  但**不能表达「插件在 handler 里回调宿主能力」**。runner 子进程里公开的只有两条通道：
  1. `globalThis.__sciforgeHostPorts.request()`（`process-extension-runner.mjs:190`）——它是
     *插件→宿主 capability* 的唯一 sanctioned 传输，但宿主侧要同时满足三件事：adapter 合同的
     `dshAuthorization.ports` 白名单、`DevelopmentExternalPluginService` 构造时传入
     `portsExecutor`、以及一次 workspace 绑定的在途调用；
  2. `globalThis.__sciforgeHostServices.request()`（`:249`）——需要宿主侧 HostServiceProvider。
- **`portsExecutor` 在仓库里只有测试传入**：`src/main/extensions/development-external-plugins.ts:294`
  是构造参数，唯一非测试赋值不存在；`#authorizeHostPort`（`:1925`）在 `!executor` 时返回
  `ports_unavailable`「Host ports executor is not configured.」。也就是说，即使 adapter 形态
  在合同里声明了 `dshAuthorization.ports`，真实应用里的 artifact 请求也拿不到结果。
- `artifact-versions` 的 HostServiceProvider 尚不存在（§4.1 的 CapabilityBroker provider + 按
  action 许可表仍在计划中，即 G1 未收尾）。

**影响面**：`plugins/visual-review`
- `accept-candidate` 在任何路径 fail-closed，错误文案沿用静态 factory：
  `Artifact Versions capability is unavailable; refusing to accept an unversioned candidate.`
- `open` 携带 `artifact.versionRef` 时 fail-closed：
  `Artifact Versions read capability is unavailable; refusing an unverified version binding.`
- 其余 8 个能力的落盘行为不受影响（评审文档、标注、样式参考、候选暂存、packet 导出）。

**转正时删除的私有旁路（逐条，等维护者裁定是否允许别的表达方式）**：
1. `src/dsh-adapter/host-ports-autowire.ts`：模块导入即读 `globalThis.__sciforgeHostPorts`，
   用**硬编码 identity**（`pluginId`/`version`/`profileId`）自建 `VisualReviewPorts` 并
   `setVisualReviewPorts()`。它绕过了合同声明（插件自报身份），且宿主从来不认这个身份。
   已删除，改为 `src/core/operations.ts` 的构造参数注入。
2. `src/ports/visual-review-ports.ts` 的 `sciforge-visual-review-ports.v1` 私有 wire
   （`protocol`/`requestId`/`identity`/`caller`/`scope` 信封 + `cancel`）：与 #53 HOST-PORTS
   同构，但从未成为公共契约；宿主按 operation 白名单授权，这个信封的字段一个都没被读。
   已删除，改成静态 adapter 自己的两函数端口 `src/ports/artifacts.ts`
   （`commit(input, workspaceRoot)` / `read(input, workspaceRoot)`）。
3. `export-review-packet` 的 packet 版本提交（`kind: 'review-packet'`、`intent: 'publish'`，
   返回值额外附加 `versionRef`）与 `create-candidate` 的「基线 artifact 仍为 current」校验：
   都是旧 adapter 在旁路可用时**追加**的行为，静态 capability 面没有这两步。已随旁路删除，
   插件行为回到静态面（packet 只写工作区文件，候选只做 QA 形状校验）。

**退路**：G1 收尾后（CapabilityBroker HostServiceProvider + 按 action 的许可表），把
`VisualReviewArtifactPort` 接到 broker 上，`accept-candidate` 与 `open(versionRef)` 即可在插件
形态可用；`export`/`create` 是否需要版本化语义，请维护者单独裁定（静态面没有，倾向保持不提交）。

**最小复现**：任意非 compute 工具在 handler 内尝试 `artifact-versions.commit`。用真
`ProcessExtensionHost` 激活 `plugins/visual-review` 并调用 `visual_review_accept_candidate`，
得到 `Artifact Versions capability is unavailable…`；用 `DevelopmentExternalPluginService` +
`portsExecutor` 缺省组合调用 `globalThis.__sciforgeHostPorts.request()`，得到
`ports_unavailable`。

**裁定请求（二选一）**：
- (a) 认可「G1 收尾前，artifact 端口只在测试注入、生产 fail-closed」为当前标准，本插件按此
  交付（本 PR 的现状）；
- (b) 先把 §4.1 的 broker provider 落地，再回填 artifact 端口，本插件在批次 1 之后补一次
  parity 用例。

在裁定前：不得用空 Host service 或自造全局绕过 G7/G9，也不得把「已激活」写成「工具可用」。

**补充（2026-11-01，commit/read 已接通，G9 收敛为「已解决（commit/read）」）**：
按退路 (b) 落地了 `artifact-versions` 的 Host service provider，不做 broker 之外的任何旁路：
- 新增 `packages/domains/artifact-versions/src/host-services.ts`：`createDomainHostServiceResolver`
  产出 provider，`authorize` 只认宿主事实——exact package/version 合同的
  `dshAuthorization.ports`（`artifacts.commit` / `artifacts.read`）、owner 三元组一致、在途调用
  有效；`commit`/`read` 转发到真实 `artifact-versions.commit` / `.read` capability（action id、
  schema、访问策略、幂等键全部沿用域自身），caller 只从 Broker 认证过的
  `request.owner.authority` 取，子进程输入不含身份字段（合同 schema `.strict()` 会拒）。
- `src/main/index.ts` 在两处组合（dev seam 与 installed 路径）都传 `portsFor`，读同一份
  contract map；未声明 ports 的插件拿不到 provider（fail-closed）。
- 插件侧 `src/ports/artifacts.ts` 增加 `createHostServicesArtifactPort()`：走 SDK 的
  `globalThis.__sciforgeHostServices.request('artifact-versions', …)`，响应仍用真实合同 schema
  解析；宿主未组合该服务时端口为 `undefined`，维持静态 factory 的 fail-closed 文案。
- 证据：`packages/domains/artifact-versions/src/host-services.test.ts`（6 例：未授权不组合、
  未批 operation 拒绝、跨包 owner 拒绝、commit 转发 actionId/caller、read 透传错误、子进程夹带
  `workspaceId` 被 schema 拒绝）；`plugins/visual-review/tests/host-artifact-service.test.ts`
  （真 `DevelopmentExternalPluginService` + `CapabilityBroker.invokeOrdinarySession` + 子进程 +
  provider，`accept-candidate` 落库并回填 `versionRef`，caller/approvals 原样到达 provider）；
  `plugins/visual-review/tests/host-artifact-port.test.ts`（3 例，含畸形响应 fail-closed）。
- **仍未解决**：`open` 携带 `artifact.versionRef` 的读校验（静态面同样没有该路径，未做）；`export`
  的 packet 版本化仍按「不提交」处理，等维护者裁定。

---

---

## G11 DSH 工具参数无法携带嵌套 schema，模型只能靠描述猜结构

**状态**：已登记（visual-review 真实模型回合暴露；待维护者裁定）

**现状证据**：`defineTool` 接受的参数表是
`Readonly<{ type: 'string' | 'number' | 'boolean' | 'array' | 'json' | 'integer'; required?; items?; enum? }>`
（`plugins/visual-review/src/dsh-adapter/tools.ts` 里 `DshToolDefinition` 的类型推导即来自此处），
没有 `properties` / `$ref` / `description`，所以 `artifact`、`annotations`、`truthLocks`、
`reviewEvidence` 这类嵌套文档只能声明成 `type: 'json'`。模型拿到的是「任意 JSON」，
看不到字段名和枚举。

**实测代价**（同一轮真实模型回合里连续踩到）：
1. `visual_review_open` 的 `artifact` 传成字符串 → `expected object, received string`；
2. `visual_review_save_annotations` 把 `geometry` 摊平成 `{kind,targetId,bounds}` → `unrecognized_keys`；
3. `visual_review_create_candidate` 的 `reviewEvidence.tool` 写错枚举值；
4. `repairable` 写 `true`，而契约是 `literal(false)`。
全部靠工具**描述文字**补形状后通过（形状说明现写在每条工具 description 里）。

**影响面**：所有把嵌套对象作为参数的插件（visual-review、anchored-comments、scientific-plotting…）。
不是错误，是「模型可用性」缺口：能力面正确、报错也明确，但模型要多试几轮。

**建议**（二选一，维护者裁定）：
- 扩 `defineTool` 参数类型，允许 `properties`/`items` 的结构化 JSON Schema（首选，一次性收益）；
- 或在 SDK 侧支持「参数引用宿主已注册 capability 的 inputSchema」，避免插件重复描述。

在裁定前：插件继续用 `type: 'json'` + 描述文字兜底，不私改 SDK 类型。

---

---

## G12 正式 DSH 插件原本没有渲染通道（面板只能留在静态包）

**状态**：已解决（批次 3 追加：`ui.entry` + 面板能力桥）；剩余限制见文末

**现状证据（改造前）**：
- `packages/plugin-sdk/src/discovery.ts:70` 只从 **adapter 声明**（`sciforge.adapter.json` 的
  `ui.entry`，且 `kind: 'renderer'`）读 `rendererEntry`，正式 DSH 插件没有这个字段，所以插件
  即使自带 UI 也永远不会被宿主发现；
- `src/main/extensions/development-external-plugins.ts` 里注册渲染贡献的分支写成
  `if (adapterKind === 'renderer')`，DSH 插件直接跳过；
- `DevelopmentPluginPanelHost` 的跨帧协议只有 `ready` / `ping` / `inventory.list`，
  **没有任何能力调用通道**——面板即使显示出来也点不动。

**改法**（三处宿主 + 插件侧）：
1. `sciforge.dsh.json` 支持 `ui: { entry, stateVersion? }`；`discovery.ts` 在无 adapter 时读它，
   仍走同一套路径逃逸校验（`safeRelative` + `realpath` 比对），越界即整插件被拒；
2. 注册与资产解析改为「有 `layout.rendererEntry` 即可」，不再要求 adapter `kind: 'renderer'`；
   IPC 结果 schema 增加宿主计算的 `capabilityIds` 白名单；
3. `DevelopmentPluginPanelHost` 新增 `capability.invoke` 消息：先校验 `event.source`、id 属于
   该插件合同授予的集合、input 体积上限，再走**普通渲染侧能力通道**（同一 caller、同一工作区、
   同一审批与审计），不新增任何权限；帧依旧 `sandbox="allow-scripts"`、无 Electron 桥。

**插件侧**：`getRendererContributions()` 返回 `visual-review.right-panel`；`dist/ui/` 由
`scripts/build-ui.mjs` 产出（React + 面板源码 + Tailwind + 主题变量兜底），
`sciforge.dsh.json` 的 `ui.entry` 指向 `dist/ui/index.html`。

**真机实测（dev 应用，2026-11-02）**：
```
extensions:renderer-contributions
→ [{ contributionId: 'visual-review.right-panel', kind: 'panel',
     entryUrl: 'sciforge-plugin://ui/%40sciforge%2Fplugin-visual-review/1/dist/ui/index.html',
     capabilityIds: [10 个 visual-review.* ] }]
在应用自己的渲染进程里挂 sandbox iframe
→ load 成功；帧内 bundle 执行并回发 ready（CDP 实测）
```
**补充（2026-11-02，帧内服务补齐）**：面板帧现在还能用两条宿主服务，语义与静态域一致——
- `workspace.pickFile` → `window.sciforge.pickFile`（宿主原生文件对话框），风格参考图选择可用；
- `composer.sendMessage` → Workbench 的 `sendDomainWorkbenchMessage`（与静态域同一个注入器），
  “请求修改”可用。
两者都由宿主校验来源帧后才转发，插件依旧拿不到 Electron 桥。

**仍未验 / 已知限制**：
- 未在 GUI 右侧面板里真实点按（需要人点面板切换；本轮只验到「帧加载 + bundle 运行 + 协议握手」）。
- **`accept-candidate` 在帧内仍然 `approval_denied`，这是刻意保留**：渲染侧 `capability:invoke`
  允许调用方自带 `approval: {mode:'confirmation'}` 并通过 `invocationId` 换到 grant（`src/main/
  capabilities/ipc.ts:378`）。若把这条能力开放给插件帧，等于让插件自证“用户已确认”，绕过人工确认。
  是否允许、以及是否改成宿主弹窗回填，属安全决策，本轮不擅自开。
- 面板的 `documentId` 目前由用户填一次并记住；工具条/命令激活（点图直达对应文档）仍在静态包，
  属批次 5。

---


## R1 数据位置：anchored-comments 按工作区隔离

**状态**：维护者已裁定：按工作区隔离，不提供导入工具。

**当前路径**：唯一实现 `plugins/anchored-comments` 使用宿主认证 caller 绑定的
`<workspaceRoot>/.sciforge/anchored-comments/`，持有 `comments.json` 与
`assets/<sha256>.png`。旧内置域及其 userData 执行入口、renderer 浮层、生成注册均已删除；
不存在按插件名排除静态域的启动兜底。模型自报路径不能产生授权，显式跨根和符号链接逃逸
必须拒绝。

**裁定**：插件形态按工作区隔离存储；**不提供**自动导入工具，也不做双向同步。
旧数据需要时由用户手动迁移：把旧 userData 下的 `anchored-comments/` 目录整体拷贝到
`<工作区>/.sciforge/anchored-comments/`。store 格式不变（`schemaVersion: 1`，
`comments.json` 与 `assets/<sha256>.png` 的相对结构一致），拷贝后插件可直接读取。

**影响**：静态路径里跨工作区可见的线程，在插件路径下按工作区各自独立；迁移只搬数据，
不改写内容，也不合并同名 `threadId`（同一线程请只保留一份）。

---

## 附：环境基线验证记录（2026-10-13）

- 历史 Scientific Compute 参考实现 `a2e948c4`（现已 retired）在当时本机环境（Node v22.22.1，tsx 4.22.4）测试通过：60 项，57 通过、3 跳过、0 失败。此数字只保留历史事实，不表示当前包可安装或专属测试仍存在。
- esbuild 0.25.12 可用（`node_modules/.bin/esbuild`），用于插件 dist 自包含 ESM 打包。
