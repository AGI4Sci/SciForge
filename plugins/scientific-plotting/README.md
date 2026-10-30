# @sciforge/plugin-scientific-plotting

Scientific Plotting 域模块的运行时插件化改造（阶段一，版本化组第四个模块，含 G4 原生依赖验证与 MCP 形态对照）。
静态对照实现位于 `packages/domains/scientific-plotting/`；真实绘图引擎来自已发布工作包 `@sciforge/scientific-plotting`（`packages/workers/scientific-plotting`），本插件将其内联打包，把原生 `@napi-rs/canvas` 保持 external。

## 盘点记录（方案 4.1）

| 项 | 内容 |
| --- | --- |
| 原功能 | 5 个能力：`status`（global read）/ `map-data`（workspace compute）/ `render`（workspace-write，版本化 PNG + recipe/manifest/log）/ `rerun`（workspace-write，钉住 recipe 的精确重跑）/ `compare`（workspace read，版本对比）。域包 main 是薄壳：能力编排 + 按 workspace 缓存的 service 工厂，委托 `@sciforge/scientific-plotting/service` |
| 必须保留的行为 | 能力 id 与 zod 契约不变；caller 工作区覆盖 input 里的 spoof `workspaceRoot`（`requireWorkspace` 同文案 `'Scientific Plotting requires a workspace-scoped caller.'`）；`statusService` 全局共享、`serviceFor` 按 workspace 懒创建并缓存；engine 降级语义（无 artifact ports 时 render 降级为 unversioned + warning，rerun/compare 报 engine 自带能力错误） |
| 静态入口 | `packages/domains/scientific-plotting/src/main.ts`（capability factory + capability-eval + agent-routing 贡献），经生成文件组合；renderer 三件（右侧面板/资源导航/i18n）保留静态 |
| 宿主依赖 | `capabilities.invoke`（artifact-versions commitV1/readV1 ports）——**唯一**宿主接缝；无 agentThreads/turnEvents/enablement 依赖 |
| 现有测试 | 静态域包 1 个 main 测试文件（132 行，scripted service）；本插件扩展为 18 项测试，含真实引擎与真实宿主加载 |

## 分层

```text
src/contract.ts            # zod 契约（与静态包逐字节一致；re-export @sciforge/scientific-plotting/contract）
src/ports/capabilities.ts  # 唯一环境接缝：DomainMainSystemCapabilityInvoker（G1）
src/core/service-factory.ts  # statusService + serviceFor(workspace) 缓存；有 invoker 时构建 artifact ports（同静态构造）
src/core/operations.ts     # 5 个操作镜像静态 handler：strict parse、requireWorkspace 同文案、spoof 覆盖、错误直抛
src/fixture/config.ts      # dshConfig 模式（空对象；G1 落地前 engine 走自带降级模式）
src/dsh-adapter/           # Cordis 入口（同步 apply）+ 5 个工具定义（defineTool 注入，可测）
```

core 不导入 SciForge 主程序、Electron、renderer 或静态 catalog。`@sciforge/scientific-plotting` 与 `@sciforge/image-generation` 是 TS 源工作包，esbuild 内联编译进 dist；`@napi-rs/canvas` 是原生 addon 必须 external，由 runner 子进程从仓库 node_modules 解析。

## G4：原生依赖在隔离 runner 中的验证

`@napi-rs/canvas`（`.node` 二进制，经 `@napi-rs/canvas-darwin-arm64` 平台包加载）是本组唯一的原生依赖。验证链：

1. esbuild 打包：external 声明后 dist/main.js 保留对 `@napi-rs/canvas` 的运行时 import（自包含 ESM，966K）。
2. 主进程基线：`node -e` 直接渲染 PNG（探针验证）。
3. **决定性证据**：`tests/host-loading.test.ts` 用真实 `ProcessExtensionHost` fork 隔离子进程加载 dist，完成 status → map_data → **真实 render**（`{ ok: true, status: 'rendered' }`，PNG 落盘 `<workspace>/.sciforge/figures/`，含 engine 降级 warning）→ rerun fail-closed。

结论：原生 addon 与 Python matplotlib 渲染器在 DSH 隔离 runner 进程内均可工作，无需特殊打包开关。G4 登记为"已验证可行"。

## MCP 形态对照（方案要求）

`@sciforge/scientific-plotting` 自带 MCP server 形态（`./mcp-server` 入口，`scientific-plotting-mcp-server.ts`）。两种运行时形态的对照：

| 维度 | MCP server（现状） | DSH 插件（本改造） |
| --- | --- | --- |
| 进程模型 | 独立 stdio 进程，由 MCP 客户端拉起 | 宿主 `ProcessExtensionHost` fork 的隔离子进程，宿主托管生命周期 |
| 授权 | 无宿主授权层；工具调用即执行 | 每次调用经宿主授权信封（`authorizeDshTool`，host-loading 逐次校验）；grant 表宿主配置（`EXPECTED_HOST_GRANTS`），无 grant fail-closed |
| 能力治理 | MCP tool 名自由约定 | 能力 id 沿用静态契约（`scientific-plotting.*`），effect/audiences 快照钉死；runner 投影规则固定（read→resource scope；compute/write→global + idempotency required） |
| 输入校验 | MCP 层 JSON Schema | runner 参数 DSL 边界 + 插件内 strict zod 契约（双层，parity 钉住与静态宿主 parse 的等价性） |
| 降级语义 | engine 自带（无 artifact ports → unversioned render） | 同左——G1 落地前插件走同一条 engine 降级路径 |
| 工作区归属 | 参数自带 `workspaceRoot` | 显式 `workspaceRoot` 工具参数（G1：宿主暂不转发 caller 身份），operation 层覆盖 spoof 输入 |

MCP server 保留为技能/外部集成形态；DSH 插件是宿主内治理形态。两者共用同一 engine 实现，无代码复制。

## 宿主依赖、权限与生命周期清单

**宿主依赖**：

1. `capabilities.invoke`（artifact-versions `commit`/`read` ports）—— **G1 未落地**：DSH 环境下不传 invoker，engine 进入自带降级模式（render unversioned + warning；rerun/compare 返回 `{ ok:false, message: 'Exact plot rerun requires Artifact Versions read and commit capabilities.' }` 形态）。桥落地后仅需在 adapter 注入 invoker，无插件代码变更。
2. 无其他宿主依赖（不消费 agentThreads/turnEvents/enablement）。

**期望的宿主 grant 表**（宿主配置，插件不自带；见 `src/dsh-adapter/tools.ts` 的 `EXPECTED_HOST_GRANTS`）：

| DSH 工具 | capability id | effect |
| --- | --- | --- |
| `status` | `scientific-plotting.status` | `read` |
| `map_data` | `scientific-plotting.map-data` | `compute` |
| `render` | `scientific-plotting.render` | `workspace-write` |
| `rerun` | `scientific-plotting.rerun` | `workspace-write` |
| `compare` | `scientific-plotting.compare` | `read` |

宿主投影差异（runner 固定规则）：read → scope `resource` + resourceKinds `['dsh-session']`（静态 status 为 global scope）；compute/write → scope `global` + idempotency `required`（与静态非 read 能力一致）；approval 一律 `none`（与静态一致）；audiences 投影为 `['agent','ui']`（静态含 `system`）；tags 为 `dsh-tool`。

**生命周期**：`apply(ctx, config)` 同步注册 5 个工具；service 按 workspace 懒创建并缓存（进程内 Map），无定时器/socket/全局状态（`tests/clean-state.test.ts` 举证），停用与 dispose 由宿主/runner 负责，重复 dispose 安全（`tests/host-loading.test.ts` 覆盖）。

**不迁移的静态贡献**（宿主侧能力，不属于 DSH 工具面）：`main.capability-eval`（能力评估）、`main.agent-routing`（路由提示，静态值为 `null`）——两者是宿主框架贡献而非可调用能力，留在静态包；G5 摘除静态 main 入口时由宿主薄层承接。

**与静态入口的关系**：能力 id 完全一致，静态 renderer 无需改动；两者不能在同一宿主实例同时注册（重复 id 冲突）。静态包在阶段一保留为对照基准。

## 构建、加载与测试复现命令

```bash
cd plugins/scientific-plotting
npm run typecheck   # bundler moduleResolution（对齐引擎包自身的 TS 源形态）
npm run build       # esbuild 自包含 ESM；@deepseek-ai/* 与 @napi-rs/canvas external
npm test            # pretest 自动构建；18 项测试
node --import tsx tests/baseline/generate-baseline.ts   # 重新生成 golden 基线
```

测试构成（18 项）：source-fidelity（contract 逐字节 + 私有 import 扫描）/ capability-parity（5 能力双侧面：输出、service 转发参数、spoof 覆盖、scope 拒绝、无效输入、治理元数据快照）/ dsh-tools 接线 / clean-state（句柄、并发、实例确定性）/ baseline golden（mapData 确定性输出，workspace 路径归一化）/ host-loading（真实宿主 + 原生渲染）。

## 已知边界

- **G1 导致的降级面**：DSH 环境 render 产物不带 Artifact Version 溯源（engine 既有 warning 明示）；rerun/compare 不可用。等价性证据由 capability-parity（scripted service）与 engine 自带测试承担。
- **status 输出环境相关**：`renderer.version`、poppler 路径等字段随运行环境变化，不进 golden；结构由 dsh-tools/host-loading 钉住。
- **render 写盘副作用**：engine 在 `<workspace>/.sciforge/` 下写 PNG/recipe/manifest/render.py（静态既有行为）；`outputPolicy.writesOnlyInsideWorkspace` 由 engine 保证。
- **runner 参数 DSL 先于插件 zod**：类型错误（如 `expectedCurrentVersionId` 非 string）在 runner 边界以 `invalid arguments` 拒绝；深层契约错误由插件 strict parse 拒绝。与静态宿主直接调 handler 的可观察路径不同，属于宿主投影差异。
- 直移契约（`src/contract.ts`）与静态包保持同步：静态包修订时必须重新同步，source-fidelity 测试是护栏。
