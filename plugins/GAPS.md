# 公共插件化协议缺口登记（版本化组）

> 依据《SciForge 原生域模块运行时插件化改造方案（阶段一）》：发现公共缺口时先登记并共同修改公共版本，不在各自模块中添加私有旁路。
> 登记人：版本化组（git-checkpoints / research-checkpoints / scientific-plotting / research-dossier / change-inspector）
> 基线：`main @ e975be58`；参考实现 `origin/feat/plugin-scientific-compute @ a2e948c4`（方案中的 `8c2ff1a1d` 不在该分支线上，待维护者确认）。

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

**本组过渡策略**：core/ports 拆分与 static 对照测试不依赖 G1；dsh-adapter 经注入获得 port 实现，G1 未落地前 dsh 加载测试用 fixture port 验证注册/调用/生命周期通路，真实宿主能力接线标记为待公共版本。

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

**状态**：已登记

**现状证据**：`packages/domains/change-inspector/src/main.ts` 的 `open-session` 不直接返回数据，而是 `context.issueResource({ resourceKind: 'agent-session-changes', observe, dispose, retireAfterLastHandleExpires: true })` 向 Broker 注册只读可观察资源；renderer 侧 `invoker.observe(...)` 拉快照、`invoker.subscribe(resourceRef, listener)` 订阅变更。DSH 工具是请求/响应模型，descriptor 投影（contractVersion 3）没有资源/订阅语义。

**影响模块**：change-inspector。

**接口需求建议**（二选一，待维护者裁定）：
- a) 插件能力返回完整快照数据（含 5000 条 / 2MB 截断规则），资源的发行、绑定键、lifecycleEpoch 失效与订阅分发保留在宿主薄层；
- b) 公共协议增加资源观察通道（descriptor 扩展 + runner 支持）。

阶段一本组按 (a) 实施：插件 core 产出快照，宿主薄层只做资源包装，不含业务逻辑。

---

## G4 原生依赖（@napi-rs/canvas .node 二进制）在隔离 runner 中的加载未验证

**状态**：已验证可行（2026-10-13，本组实验）

**验证结果**：`plugins/scientific-plotting` 的 host-loading 测试在隔离目录用 `ProcessExtensionHost` 真实 fork 子进程激活插件，并完成一次真实 render：runner 通过默认模块解析在插件目录的 `node_modules` 中找到 external 的 `@napi-rs/canvas`，原生 `.node` 加载成功，PNG 落盘 `<workspace>/.sciforge/figures/`。esbuild 产物（`dist/main.js`，约 966K）将 `@napi-rs/canvas` 保持为 external 即可工作，无需渲染器 port 抽象。

**现状证据**：`process-extension-runner.mjs` 的 `registerHooks` 把 `@deepseek-ai/*` 白名单包与 `zod` 的模块解析固定到 SDK 部署位置；其余 import 的解析行为未钉死。`packages/workers/scientific-plotting` 的渲染引擎依赖 `@napi-rs/canvas`（napi `.node` 二进制），无法用 esbuild 内联进单文件 ESM 产物。

**影响模块**：scientific-plotting（render/rerun 路径）。

**验证方法（Phase 4 第一步）**：最小插件 import `@napi-rs/canvas`，esbuild 打包（该包 external），在隔离目录用 `ProcessExtensionHost` 真实激活并调用一次渲染，观察模块解析与原生加载结果。

**接口需求建议**（若实验失败）：把渲染器抽象为 port（`RasterRendererPort`），插件 core 只编排；dsh 环境下渲染实现由公共版本支持（宿主提供或批准插件自带 node_modules 解析）。在此之前 render/rerun 的 dsh 真实路径标记为受阻。

---

## G5 没有「排除单个静态域包 main 贡献」的现有开关

**状态**：已登记（已有候选落法，待维护者确认时机）

**现状证据**：`src/main/index.ts:1965-1968` 中 `enablement.isEnabled = (moduleId) => catalog.hasModule(moduleId)`，即启用状态就是目录成员关系；subscribe 是 no-op。`scripts/domain-packages.mjs` 没有任何 exclude/disable 过滤。CapabilityRegistry 对重复 actionId 的注册视为冲突，因此插件与静态包同名能力不能同时注册。

**影响**：方案要求「迁移完成后必须能明确排除原静态执行路径」；本组 UI 保留静态（renderer 入口不动），只需排除 main 入口。

**候选落法**（不新增开关系统，走现有 manifest + 生成器）：
- 迁移收尾时，从该包的 `sciforge.domain.json` 移除 `main` entrypoint（保留 `renderer` entrypoint），`npm run domain-packages:generate` 重新生成组合；静态 `src/main.ts` 代码保留在包内供 parity 测试相对路径 import（与参考插件的测试豁免一致）。
- 移除时机影响生产行为（移除后该能力只能由插件提供，而插件加载目前是开发态路径），因此具体摘除时机需维护者确认；摘除前本组用不带静态组合的 harness 测试（参照 `src/main/extensions/development-plugin-broker-chain.test.ts` 的接线）验证插件链路，避免双注册。

---

## 附：环境基线验证记录（2026-10-13）

- `plugins/scientific-compute @ a2e948c4` 在本机（Node v22.22.1，根 node_modules 的 tsx 4.22.4）测试通过：60 项，57 通过、3 跳过、0 失败。
- esbuild 0.25.12 可用（`node_modules/.bin/esbuild`），用于插件 dist 自包含 ESM 打包。
