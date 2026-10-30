# @sciforge/plugin-biology-room

Biology Room 原生域模块的运行时插件（24-1 阶段一，③可视化组）。core 是
`packages/domains/biology-room` 的 service/contract 移植副本（含 PR #47 的 0 字节锁修复），
dsh-adapter 走 named-runner 契约入口（2026-10-12 spike 实测可用的 workspace-write 声明路径）。

## 4.1 盘点记录（必须保留的行为）

| 项 | 结论 |
|---|---|
| 原功能 | 工作区内的基因组/分子可视化房间：创建、打开、修订化编辑（apply）、资产刷新、历史 |
| 持久化布局 | 调用方工作区 `.sciforge/biology/rooms/<roomId>/`：room.json + revisions/<n>.json + events.ndjson + transaction.json + .write.lock；**数据跟随项目目录，不迁入插件私有存储**（2026-10-12 复测结论，见组方案 §2） |
| 并发与恢复 | 进程内 promise 队列 + O_EXCL 文件锁（token 匹配释放）；不可解析锁 30 秒无主宽限回收、死 pid 锁 5 分钟崩溃恢复宽限；事务日志在 journal/revision/event 各故障点恢复 |
| 能力面 | 8 个能力（list/create/openOrCreate/load/open/apply/refresh/history），id 与静态入口完全一致 |
| 留在宿主的部分 | workspace 作用域门控与 workspaceRoot 绑定（宿主 broker 校验 caller workspaceId；扩展桥把 input.workspaceRoot 绑定为 caller 的工作区，静态路径同语义）；宿主资源句柄簿记（静态路径独有） |
| 依赖 | `@sciforge/domain-sdk`（workspace-paths，纯函数，随包打进 dist）、zod；无网络、无凭据、无进程外依赖 |

## 相对静态入口的折衷（真实宿主校验强制，非随意简化）

1. **descriptor.scope 全为 'workspace'**：宿主校验"仅 resource-scope 能力可声明
   resourceKinds"，named-runner 路径也未验证宿主资源句柄；apply/refresh/history 改为
   显式 roomId 入参（apply 另带 baseRevision 乐观并发令牌），乐观并发由
   service 的 baseRevision 检查保证（与静态路径同一行代码）。
2. **descriptor.concurrency.revision 全为 'none'**：宿主校验"optimistic revision 需要
   resource scope"。
3. **apply/refresh 不返回顶层 `changed`**：宿主校验"changed:true 必须有宿主资源句柄"。
   变更事实完整保留在 `output.changed` / `output.revision` 与顶层 `semanticRevision`。
4. **资源引用为可序列化对象**：`{resourceId, resourceKind, workspaceId, semanticRevision,
   audiences}`，替代宿主持久的句柄（含 observe/dispose 闭包）。调用方如需观察能力，
   用 `open` 重新读取。

## 复现命令

```bash
# 单元测试 + 静态对照（6 项，含 parity 与负向对照）
npm test

# 独立构建（esbuild 打包到 dist/，无开发机绝对路径）
npm run build

# 类型检查
npm run typecheck
```

真实宿主加载验证（§4.4）与真实应用端到端的运行器和证据在本机 `Claude outputs/插件改造_spike/`（bio-plugin-load-*.md、bio-plugin-real-app-20261014.md）；评审以 PR #48 评论中的完整输出为准（证据文件未入库，属评审期临时材料）。

## 阶段一完成标准对接

- 独立入口与构建产物：✅ dist/main.js（esbuild bundle）
- core 不依赖 SciForge 内部源码：✅ 只依赖 domain-sdk 公开入口与 zod
- 原静态入口不重复执行：本插件不注册静态 catalog；静态包保持原样直至阶段一收尾排除
- 对照测试：✅ tests/parity.test.ts（输出逐字段 + 房间目录树字节级，变异检查：core 一行改动即红）
