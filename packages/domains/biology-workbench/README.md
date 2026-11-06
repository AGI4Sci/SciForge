# @sciforge/domain-biology-workbench

SciForge **内置**生物科研工作区：一个域包、两个职责独立的内部子模块。

- Biology Room：持久化房间状态与八个 `biology-room.*` 能力。
- Life Science Preview：六个生命科学预览槽、五个 Viewer 与 headless 预览服务。

二者通过标准域组合随应用提供，不需要市场安装、DSH 插件启用或批准；没有运行时插件替代或接管路径。

## 子模块边界

| 子模块 | 内容 | 依赖边界 |
| --- | --- | --- |
| `src/workbench/` | `contract.ts`（zod schema/路径与容量规则）、`service.ts`（房间状态、修订、事件、事务恢复、写锁）、`capabilities.ts`（8 个 descriptor 与 handler）、`capability-eval.ts` | 只依赖 `@sciforge/domain-sdk`、`zod`、`node:*`。**禁止** import `react`/`molstar`/`@sciforge/workspace-*`/`../preview/**` |
| `src/preview/` | `contract.ts`（6 槽契约）、`wire.ts`（v2 编解码）、`backend/`（provider）、`renderer/`（5 个 Viewer + actions + inspector + transport + molstar + prewarm）、`workspace-server/`、`main/` | 只依赖 `@sciforge/domain-sdk`、`zod`、`react`、`molstar`、`@sciforge/workspace-*`。**禁止** import `../workbench/service.js` 或 `../workbench/capabilities.js` |

`src/definition.ts` 是唯一 manifest 解析点；两个子模块都从它取声明，避免声明/实现漂移。

## 保持不变（兼容性硬约束）

- 8 个能力 ID：`biology-room.list|create|open-or-create|load|open|apply|refresh|history`，scope/effect/audience/approval 逐字段不变。
- 6 个预览槽短 ID：`molecular` / `sequence-genomics` / `biology-index-transport` / `omics-matrix` / `bioimaging` / `proteomics-spectra`。
- wire 标识 `sciforge.life-science-preview.*`（含 `*.selection`）不变。
- 数据目录 `.sciforge/biology/rooms/<roomId>/`（`room.json`、`revisions/<n>.json`、`events.ndjson`、`transaction.json`、`.write.lock`）与 `schemaVersion: 1` 不变。

## 数据与读取保护

房间状态使用唯一 service，保留修订冲突、事务恢复与写锁；内置不绕过 Broker 的权限和资源治理。
预览通过通用 SDK 校验读取路径位于已授权工作区，拒绝软链逃逸、非文件及不完整的制品读取；读取失败返回结构化错误。
文本前缀上限 2,000,000 字节，二进制前缀上限 4 MiB；完整图像制品超过上限时在打开读取前拒绝。

详细设计与验证边界见 [内置设计说明](<../../../docs/operations/biology-workbench-built-in.zh-CN.md>)。

## 验证

```bash
npm run typecheck -w @sciforge/domain-biology-workbench
npm run test -w @sciforge/domain-biology-workbench
```

本包不新增 UI 入口：生物界面仍是 6 个 workspace-preview 槽，房间状态仍通过 `biology-room.*`
broker 能力访问，与合并前一致。