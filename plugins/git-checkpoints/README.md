# @sciforge/plugin-git-checkpoints

Git Checkpoints 域模块的运行时插件化改造（阶段一，版本化组首个打样模块）。
静态对照实现位于 `packages/domains/git-checkpoints/`，本插件与其逐字节行为一致（见 `tests/parity.test.ts`）。

## 盘点记录（方案 4.1）

| 项 | 内容 |
| --- | --- |
| 原功能 | 工作区 Git 检查点：list / create / preview / restore；restore 前先建 rescue 检查点；包私有元数据存储；turn 边界自动快照 |
| 必须保留的行为 | 能力 id 与 zod 输入输出契约不变；元数据磁盘布局 `<root>/domain-data/git-checkpoints/<id>/metadata.json` 不变；原子写、防 symlink/越界；失败映射（dirty_worktree / branch_changed / not_git_repo / git_unavailable / rescue_failed）；跨工作区访问拒绝 |
| 静态入口 | `packages/domains/git-checkpoints/src/main.ts`（capability factory + runtime-lifecycle + capability-eval），经生成文件 `src/main/modules/installed-domain-main.ts` 组合；renderer 入口保留静态（右侧面板/命令/顶栏/i18n） |
| 宿主依赖 | 核心 `version-control.*` 能力（open-workspace/status/create-snapshot/preview-restore/restore）；`turnEvents` 自动快照；`enablement`；`userDataDir` |
| 现有测试 | 静态包 6 个测试文件；本插件迁移并扩展为 21 项测试 |

## 分层

```text
src/contract.ts        # zod 契约（与静态包逐字节兼容；JSON value schema 本地化）
src/ports/vcs.ts       # 唯一环境接缝：GitCheckpointVcsPort（capture/preview/restore）
src/core/service.ts    # GitCheckpointService：元数据、原子写、rescue、幂等队列、失败映射
src/core/auto-capture.ts  # turn 边界自动快照决策（去重、不支持工作区黑名单）
src/core/operations.ts    # 能力编排层：caller 工作区校验、manual-only create 策略
src/fixture/local-git-vcs.ts  # 本地 Git CLI 夹具（非生产接线，见下文）
src/dsh-adapter/       # Cordis 入口 + 工具定义（defineTool 注入，可测）
```

core 不导入 SciForge 主程序、Electron、renderer 或静态 catalog；唯一第三方依赖是 zod（打包时内联）。

## 宿主依赖、权限与生命周期清单

**宿主依赖**：

1. `version-control.*` 能力 —— **当前被 G1 阻塞**（插件进程无法反向调用宿主能力，见 `../GAPS.md`）。G1 落地前，DSH 环境使用插件自带的本地 Git 夹具 `createLocalGitVcs()`；生产接线应由宿主把 `createVersionControlCheckpointPort` 等价物注入插件。
2. turn 生命周期事件 —— **G2**。核心决策逻辑已在 `core/auto-capture.ts`，等待宿主把 turn 边界事件转发进插件；静态 runtime-lifecycle 贡献在此之前保留。
3. `dataDir` 配置 —— 经宿主 `dshConfig` 注入（必填，zod 校验）。

**期望的宿主 grant 表**（宿主配置，插件不自带；见 `src/dsh-adapter/tools.ts` 的 `EXPECTED_HOST_GRANTS`）：

| DSH 工具 | capability id | effect |
| --- | --- | --- |
| `list` | `git-checkpoints.list` | `read` |
| `create` | `git-checkpoints.create` | `workspace-write` |
| `preview` | `git-checkpoints.preview` | `read` |
| `restore` | `git-checkpoints.restore` | `destructive` |

宿主投影差异（runner 固定规则，与静态定义的差别在此记录）：read → scope `resource`，其余 → scope `global`；approval 一律 `none`（静态 restore 为 `confirmation`，审批由宿主/UI 层承担）；非 read 工具幂等 `required`；tags 为 `dsh-tool`。

**生命周期**：`apply(ctx, config)` 注册 4 个工具后即就绪；插件无定时器/socket/全局状态（`tests/clean-state.test.ts` 举证），停用与 dispose 由宿主/runner 负责，重复 dispose 安全（`tests/host-loading.test.ts` 覆盖）。

**与静态入口的关系**：能力 id 完全一致，因此静态 renderer 无需改动；两者不能在同一宿主实例同时注册（重复 id 冲突）。静态包在阶段一保留为对照基准；迁移收尾时按 G5 的 manifest 方案摘除静态 main 入口（时机由维护者确认）。

## 构建、加载与测试复现命令

```bash
cd plugins/git-checkpoints
npm run typecheck   # 含 dsh-adapter（@deepseek-ai/* 类型取自仓库 node_modules）
npm run build       # esbuild 打出自包含 ESM dist/main.js，@deepseek-ai/* external
npm test            # pretest 自动构建；21 项：core/parity/golden/clean-state/dsh 接线/真实宿主加载
node --import tsx tests/baseline/generate-baseline.ts   # 重新生成 golden 基线
```

宿主加载验证在 `tests/host-loading.test.ts`：真实 `ProcessExtensionHost` fork 隔离子进程，验证 activate → 4 个能力注册 → invoke（含授权信封逐次校验）→ 输入 schema 生效 → dispose 幂等 → 退出后调用拒绝；另有无 grant fail-closed 用例。子进程不继承环境变量，Git 夹具依赖系统默认命令查找（本机 `/usr/bin/git`）。

## 已知边界

- 工具参数显式携带 `workspaceRoot`（宿主未向插件转发 caller 工作区身份，G1 相关）；核心对跨工作区访问的拒绝策略与静态一致，parity 测试覆盖。
- 夹具 VCS 的 restore 不删除未跟踪文件、preview 为 worktree↔snapshot 的 diff —— 仅离线/测试语义；生产语义以宿主 version-control 能力为准。
- 自动快照（turn 事件）不在插件公共工具面上；`GitCheckpointAutoCapture` 从 `src/index.ts` 导出，供未来宿主桥接（G2）与测试使用。
