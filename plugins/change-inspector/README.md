# @sciforge/plugin-change-inspector

Change Inspector 域模块的运行时插件化改造（阶段一，版本化组第二个模块）。
静态对照实现位于 `packages/domains/change-inspector/`，本插件与其可观察行为逐字节一致（见 `tests/parity.test.ts`）。

## 盘点记录（方案 4.1）

| 项 | 内容 |
| --- | --- |
| 原功能 | `change-inspector.open-session`：读取一个 agent 会话的 `file_change` artifacts，投影为统一 diff 快照（纯字符串 diff / JSON 嵌套 `diff`/`patch`/`unified_diff`/`unifiedDiff`/`changes` 递归；5000 条截断、2MB patch 截断、watermark 超 256 字符走 FNV-1a `changes-<hex>` revision）；静态版经 `issueResource` 发行 Broker 只读可观察资源供 renderer 订阅 |
| 必须保留的行为 | 能力 id 与 zod 输入输出契约不变；资源 id = sha256(`JSON.stringify([runtimeId, sessionId])`) 前缀 `session-changes:`；跨工作区拒绝（`'The requested session belongs to another workspace.'` / `'Change Inspector requires an active workspace.'`）；投影与截断规则逐字节一致 |
| 静态入口 | `packages/domains/change-inspector/src/main.ts`（capability factory + runtime-lifecycle），经生成文件 `src/main/modules/installed-domain-main.ts` 组合；renderer 入口保留静态（右侧面板/命令/顶栏/i18n） |
| 宿主依赖 | `agentThreads.read` 会话详情（runtime-lifecycle context）；Broker `issueResource` 资源发行（含绑定键、lifecycleEpoch、512 上限）；`enablement` |
| 现有测试 | 静态包 1 个测试文件（`main.test.ts`，270 行）；本插件迁移并扩展为 32 项测试 |

## 分层

```text
src/contract.ts           # zod 契约（与静态包逐字节兼容；另加插件结果 schema，见 G3）
src/ports/agent-threads.ts  # 唯一环境接缝：ChangeInspectorAgentThreadsPort（read）
src/core/change-observation.ts  # 快照投影（与静态包逐字节一致，仅 import 路径不同）
src/core/service.ts       # ChangeInspectorService：读会话→工作区归属校验→投影；resourceId/normalizePath
src/core/operations.ts    # 能力编排层：输入校验、无工作区拒绝、结果 schema
src/fixture/config-agent-threads.ts  # dshConfig 驱动的会话夹具（非生产接线，见下文）
src/dsh-adapter/          # Cordis 入口 + 工具定义（defineTool 注入，可测）
```

core 不导入 SciForge 主程序、Electron、renderer 或静态 catalog；唯一第三方依赖是 zod（打包时内联）。

## 宿主依赖、权限与生命周期清单

**宿主依赖**：

1. `agentThreads.read` 会话详情 —— 插件侧是 `ChangeInspectorAgentThreadsPort`（形状为宿主 `DomainMainAgentThreadsHost.read` 的收窄，只保留投影消费的字段）。宿主能力桥（`plugins/GAPS.md` G1）落地前，DSH 环境使用插件自带的配置夹具 `createConfigAgentThreads()`（从 `dshConfig.sessions` 读录制的会话详情）；生产接线应由宿主把真实 agent-threads 服务注入插件。
2. Broker 资源发行/订阅 —— **G3 按方案 (a) 落地**：插件工具直接返回 `{ sessionId, resourceId, snapshot }` 快照数据与规范资源 id；`issueResource`、绑定 reservation、lifecycleEpoch、512 绑定上限、principal 绑定键全部留在宿主薄层，不接进插件。宿主薄层把本结果包装成静态 `changeInspectorOpenOutputSchema` 的资源句柄形状。
3. `sessions` 配置 —— 经宿主 `dshConfig` 注入（zod 校验，缺省 `{}`）。

**期望的宿主 grant 表**（宿主配置，插件不自带；见 `src/dsh-adapter/tools.ts` 的 `EXPECTED_HOST_GRANTS`）：

| DSH 工具 | capability id | effect |
| --- | --- | --- |
| `open_session` | `change-inspector.open-session` | `read` |

宿主投影差异（runner 固定规则，与静态定义的差别在此记录）：read → scope `resource` + resourceKinds `['dsh-session']`（静态为 scope `workspace`）；approval 一律 `none`；audiences 投影为 `['agent','ui']`（静态仅 `['ui']`）；tags 为 `dsh-tool`。

**生命周期**：`apply(ctx, config)` 注册 1 个工具后即就绪；插件无定时器/socket/全局状态/磁盘句柄（`tests/clean-state.test.ts` 举证），停用与 dispose 由宿主/runner 负责，重复 dispose 安全（`tests/host-loading.test.ts` 覆盖）。

**与静态入口的关系**：能力 id 完全一致，因此静态 renderer 无需改动；两者不能在同一宿主实例同时注册（重复 id 冲突）。静态包在阶段一保留为对照基准；迁移收尾时按 G5 的 manifest 方案摘除静态 main 入口（时机由维护者确认）。

## 构建、加载与测试复现命令

```bash
cd plugins/change-inspector
npm run typecheck   # 含 dsh-adapter（@deepseek-ai/* 类型取自仓库 node_modules）
npm run build       # esbuild 打出自包含 ESM dist/main.js，@deepseek-ai/* external
npm test            # pretest 自动构建；32 项：core 单元/parity/golden/clean-state/dsh 接线/真实宿主加载
node --import tsx tests/baseline/generate-baseline.ts   # 重新生成 golden 基线
```

宿主加载验证在 `tests/host-loading.test.ts`：真实 `ProcessExtensionHost` fork 隔离子进程，`dshConfig` 注入录制会话，验证 activate → 能力注册 → invoke（含授权信封逐次校验、JSON 嵌套 diff 端到端投影、跨工作区拒绝）→ dispose 幂等 → 退出后调用拒绝；另有无 grant fail-closed 用例。

## 已知边界

- **静态模块的 2MB 截断 off-by-one 原样保留**：`truncatePatch` 截到 `MAX_PATCH_BYTES - 30` 但截断标记实为 31 字符，>2MB 的 patch 截断后为 2,000,001 字符，被快照 schema 以 `too_big` 拒绝（整个投影抛错）。parity 测试钉住两侧一同抛错；修复它属于契约变更，不在本次运行时插件化范围内（已记录，建议上报静态包维护者）。
- 工具参数显式携带 `workspaceRoot`（宿主未向插件转发 caller 工作区身份，G1 相关）；核心对跨工作区访问的拒绝策略与静态一致，parity 测试覆盖。空 `workspaceRoot` 在适配层按 schema 拒绝；静态文案 `'Change Inspector requires an active workspace.'` 保留在 operation 层（service 直用时可达，unit 测试覆盖）。
- Broker 资源订阅（observe/subscribe）不在插件公共工具面上；插件返回的 `resourceId` 供宿主薄层做绑定去重（G3）。
- 配置夹具按 `sessionId` 索引会话（`dshConfig.sessions`），仅离线/测试语义；生产语义以宿主 agent-threads 服务为准。
- 巨型截断语料（5001 条 changes、>2MB patch）不进 golden 基线文件（避免 2MB JSON）；由 parity 测试在内存比对 + 单元测试以字面预期钉住。
