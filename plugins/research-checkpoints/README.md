# @sciforge/plugin-research-checkpoints

Research Checkpoints 域模块的运行时插件化改造（阶段一，版本化组第三个模块）。
静态对照实现位于 `packages/domains/research-checkpoints/`，本插件与其可观察行为逐字节一致（迁移护栏见下文「测试」）。

## 盘点记录（方案 4.1）

| 项 | 内容 |
| --- | --- |
| 原功能 | 10 个能力：`start`/`stop`/`status`/`read`/`list`/`turn-status`/`resolve`/`restore-as-new`/`legacy.preview`/`legacy.import`；`ResearchCheckpointRuntime` 经宿主必需 before-turn 边界自动录制 turn（consume turn-artifact 事件 → 提取 checkpoint → 经 artifact-versions `commit-v2` 原子提交输出快照与 checkpoint → durable journal 落盘），支持 response-loss 幂等重放、stale-base CAS 重试、重启恢复、restore-as-new 链、legacy 选择导入 |
| 必须保留的行为 | 能力 id 与 zod 契约不变；handler 把所有错误（含 zod parse）包成 `{ ok: false, issue }` 而不抛出；store 持久化布局 `<userDataDir>/research-checkpoints/workspaces/<workspaceBindingDigest>.json` 整文档原子写；recordingId/operationId/versionId 全部 digest 绑定；commit 路径幂等键语义 |
| 静态入口 | `packages/domains/research-checkpoints/src/main.ts`（capability factory + runtime-lifecycle + artifact consumer），经生成文件 `src/main/modules/installed-domain-main.ts` 组合；renderer 入口保留静态 |
| 宿主依赖 | `agentThreads.read`、`turnEvents`（subscribe/subscribeRequiredBeforeTurn/readDurableTurnBoundarySnapshot，激活时必需否则 fail-closed）、`capabilities.invoke`（artifact-versions commitV2/read/listV2/restoreAsNew + git-checkpoints list）、`enablement`、`signal` |
| 现有测试 | 静态包 5 个测试文件（atomic-store/unified-file-patch/extract/store/runtime，共 71 项，其中 runtime.test.ts 2412 行 26 场景）；本插件全部直移并扩展为 97 项测试 |

## 分层

```text
src/contract.ts            # zod 契约（与静态包逐字节一致，含对 @sciforge/domain-artifact-versions/contract 的公共契约 import）
src/ports/context.ts       # 唯一环境接缝：ResearchCheckpointRuntimeContext（宿主 lifecycle context 的收窄，恰好 5 个成员）
src/core/crypto.ts         # canonicalJson / sha256 / workspaceBindingDigest（逐字节）
src/core/atomic-store.ts   # 原子 JSON 写（逐字节）
src/core/unified-file-patch.ts  # strict patch 链重放（逐字节）
src/core/extract.ts        # turn 事件 → checkpoint manifest 提取（逐字节）
src/core/store.ts          # durable journal store（逐字节）
src/core/runtime.ts        # ResearchCheckpointRuntime（逐字节，仅 context 类型收窄为 ports 接缝）
src/core/operations.ts     # 能力编排层：镜像静态 handler 的 readResult/mutationResult 包装与同文案 scope 报错
src/fixture/config-runtime-context.ts  # dshConfig 驱动的夹具 context（非生产接线，见下文）
src/dsh-adapter/           # Cordis 入口（async apply）+ 10 个工具定义（defineTool 注入，可测）
```

core 不导入 SciForge 主程序、Electron、renderer 或静态 catalog；第三方依赖只有 zod（打包内联）与对 `@sciforge/domain-artifact-versions/contract`、`@sciforge/domain-sdk/{contract,host}` 公共契约的类型/值 import（esbuild 内联进 dist，保持单一权威路径，不 vendor 复制）。

## 宿主依赖、权限与生命周期清单

**宿主依赖**：

1. `capabilities.invoke` 系统能力调用 —— **G1 未落地**：宿主能力桥（子进程 → 宿主反调）尚不存在，DSH 环境下插件自带 fail-closed 夹具（任何 invoke 抛 G1 文案）。因此 commit/read artifact、restore、git list 等真实提交链路在 DSH 环境不可用；这些链路的行为等价性由 in-process parity（直移的 runtime.test.ts 26 场景 + capability-parity）举证。生产接线应由宿主把系统能力 invoker 桥接进插件。
2. `turnEvents` turn 生命周期事件流 —— **G2 未落地**：runner 无事件推送通道，夹具提供必需 before-turn 订阅（满足激活 fail-closed 契约）但不投递事件；自动录制链路同理由 in-process 测试举证。
3. `agentThreads.read` 会话详情 —— 夹具经 `dshConfig.sessions`（`{ [threadId]: detail }`）注入录制会话；生产语义以宿主 agent-threads 服务为准。
4. `enablement` / `signal` —— 夹具为静态-on + 外部 AbortController。
5. `dataDir` 配置 —— 经宿主 `dshConfig.dataDir` 注入，作为 store 的 userDataDir 根（磁盘布局与静态一致）。

**期望的宿主 grant 表**（宿主配置，插件不自带；见 `src/dsh-adapter/tools.ts` 的 `EXPECTED_HOST_GRANTS`）：

| DSH 工具 | capability id | effect |
| --- | --- | --- |
| `start` | `research-checkpoints.start` | `workspace-write` |
| `stop` | `research-checkpoints.stop` | `workspace-write` |
| `status` | `research-checkpoints.status` | `read` |
| `read` | `research-checkpoints.read` | `read` |
| `list` | `research-checkpoints.list` | `read` |
| `turn_status` | `research-checkpoints.turn-status` | `read` |
| `resolve` | `research-checkpoints.resolve` | `workspace-write` |
| `restore_as_new` | `research-checkpoints.restore-as-new` | `workspace-write` |
| `legacy_preview` | `research-checkpoints.legacy.preview` | `read` |
| `legacy_import` | `research-checkpoints.legacy.import` | `workspace-write` |

宿主投影差异（runner 固定规则，与静态定义的差别在此记录）：read → scope `resource` + resourceKinds `['dsh-session']`（静态为 scope `workspace`）；非 read → idempotency `required`（与静态一致）；approval 一律 `none`（静态 `resolve`/`restore-as-new`/`legacy.import` 为 `confirmation`）；audiences 投影为 `['agent','ui']`（静态写类仅 `['ui']`）；tags 为 `dsh-tool`。

**生命周期**：`apply(ctx, config)` 是 async 的——runtime 激活（durable journal  reconcil­iation）完成后才注册 10 个工具并返回 disposer（deactivate + abort）。重复 dispose 安全（`tests/host-loading.test.ts` 覆盖）；无残留定时器/句柄（`tests/clean-state.test.ts` 举证）。

**与静态入口的关系**：能力 id 完全一致，因此静态 renderer 无需改动；两者不能在同一宿主实例同时注册（重复 id 冲突）。静态包在阶段一保留为对照基准；迁移收尾时按 G5 的 manifest 方案摘除静态 main 入口（时机由维护者确认）。

## 构建、加载与测试复现命令

```bash
cd plugins/research-checkpoints
npm run typecheck   # 含 tests/（@sciforge/* 公共契约与 @deepseek-ai/* 类型取自仓库 node_modules）
npm run build       # esbuild 打出自包含 ESM dist/main.js，@deepseek-ai/* external
npm test            # pretest 自动构建；97 项测试
node --import tsx tests/baseline/generate-baseline.ts   # 重新生成 golden 基线
```

测试构成（97 项）：

- `tests/source-fidelity.test.ts`（8）— 迁移护栏：剥 import 块后插件 core 与静态源逐字节一致；runtime.ts 仅允许 `ResearchCheckpointRuntimeContext` ↔ `DomainMainRuntimeLifecycleContext` 一处 token 重映射（恰好 6 处出现）；core 不得 import 宿主私有路径或跳出包根
- 直移单测（45）— `atomic-store`/`unified-file-patch`/`extract`/`store` 与静态同源同断言
- `tests/runtime.test.ts`（26）— 静态 runtime 全部场景直移（自动录制、stop/start 策略、lease settle、重启恢复、response-loss 幂等重放、stale-base CAS、restore 链、legacy preview/import、真实 artifact-versions 域集成）
- `tests/capability-parity.test.ts`（6）— 10 能力 × 双侧面（静态 factory handler / 插件 operations）共享 scripted runtime：成功、域错误、无效输入、缺工作区四种路径输出与运行时转发参数逐字节一致；grant 表与静态治理元数据（effect/approval/audiences/concurrency）快照
- `tests/baseline.test.ts`（1）— 固定时钟 + 固定 recordingId 序列的确定性场景 golden（自动录制/显式 start-stop/legacy 导入 + 落盘 store 文档），静态包移除后的回归基线
- `tests/dsh-tools.test.ts`（5）— 工具名/参数/workspaceRoot 剥离/错误包装
- `tests/host-loading.test.ts`（2）— 真实 `ProcessExtensionHost` fork 子进程：无 grant fail-closed；start → status → stop 全链路（含授权信封、runner 参数边界、dispose 幂等、stale-generation 拒绝）
- `tests/clean-state.test.ts`（4）— 句柄不增长、并发一致、teardown 幂等、实例间确定性

## 已知边界

- **G1/G2 未落地导致的 DSH 环境功能面**：commit 类链路（turn 自动录制、restore-as-new、legacy import 的 artifact 提交）在 DSH 运行时抛 G1 夹具错误；阶段一这是预期行为，等价性证据全部来自 in-process parity。宿主桥落地后无需改插件代码，只需替换 `dshConfig` 夹具为真实桥。
- **静态源中的死代码旗标原样保留**：`runtime.ts` 的 `dedupeRefs`、`extract.ts` 的 `visit` 在静态包中即无调用方；为保持逐字节一致未做删除（source-fidelity 测试钉住）。清理属于静态包治理，不在本次范围内。
- **工具参数显式携带 `workspaceRoot`**（宿主未向插件转发 caller 工作区身份，G1 相关）；适配层剥离后再经 strict zod 契约解析，缺失/空白在适配层拒绝。静态 handler 的 `{ ok: false, issue }` 包装语义（含 zod 错误）完整保留。
- **runner 参数 DSL 先于插件 zod**：DSH 边界上类型错误（如 `expectedPolicyRevision` 非 integer）由 runner 以 `invalid arguments` 拒绝，不到插件；这与静态宿主直接调 capability handler 的可观察路径不同，属于宿主投影差异。
- 直移测试文件（`tests/{atomic-store,unified-file-patch,extract,store,runtime}.test.ts`）与静态源保持同步：静态包修订时必须重新直移，source-fidelity 只钉 src/core，不钉测试。
