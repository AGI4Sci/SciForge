# @sciforge/plugin-life-science-preview

Life Science Preview 原生域模块的运行时插件（24-1 阶段一，③可视化组）。core 是
`packages/domains/life-science-preview` 的 `src/backend/providers.ts`（六个
workspace-preview 槽位，全部 17 个数据服务调用）+ `src/wire.ts` 后端子集的
core/ports/adapter 移植，数据面（五个 zod-only 自包含 `@sciforge/workspace-*` 纯包）
整体随插件进程走——不需要宿主桥（缺口②的修正框定，见
`Claude outputs/插件改造_spike/lsp-interface-requirements-20261016.md`）。

**与 biology-room / visual-review 不同，本插件声明零能力**：它的 payload 是六个
workspace-preview provider（`main.workspace-preview-plugin` 槽），经 SDK
workspace-preview 贡献通道（缺口①b，`sciforge-preview.v1`，参考实现见
`packages/plugin-sdk/src/workspace-preview-channel.ts` 与 PR-A）注册进宿主预览链。

## 通道接线（DONE，随 PR-B 交付）

- **插件自有声明** `sciforge.adapter.json`：kind `workspace-preview` + 六槽
  `previewSlots` 白名单（slotId == manifest.id；bioimaging 声明 `tile`/`thumbnail`
  字节 artifact，其余槽空）。
- **命名导出** `getWorkspacePreviewProviders()`（`src/dsh-adapter/register-preview-contributions.ts`，
  入口 re-export）：runner activate 时缓存六槽 `{slotId, artifactKinds, manifest, provider}`，
  严格形状校验 fail-closed。
- **宿主调用**：渲染期五回调经 runner 派发到插件子进程；三层授权（契约槽位白名单 /
  runtime 绑定 identity / 逐调用显式 workspaceRoot 双侧一致性）在 SDK 参考实现中；
  字节走 `bytesBase64`（runner 编码，8MiB 线上限），插件侧只产出进程内
  `Uint8Array`。编解码 seam 落在 runner（PR-A 的设计决策，插件 README 原计划的
  "dispatch 唯一施加点"相应上移）；原 `preview-dispatch.ts` 派发层随之成为
  test-only 死代码（槽位派发由 runner 按 slotId 完成），已按 AGENTS.md 死代码
  准则删除，applyEdit 的 `null` fall-through 由 runner 原样透传、宿主代理 reify。
- **与静态域共存**：槽位同 id 双注册 fail-closed（宿主注册表唯一性校验）；过渡期
  宿主用 `SCIFORGE_EXCLUDED_DOMAIN_PACKAGES=@sciforge/domain-life-science-preview`
  交接静态面（同 biology-room/visual-review 惯例）。
- 运行验证：`tests/channel.test.ts` 以真实 runner + 构建产物 dist/main.js 做端到端
  往返（observe/artifact 字节/workspace 负向），并与测试进程内的同一 provider
  逐字段/逐字节对照。

## 三层形状

| 层 | 内容 | 依赖边界 |
|---|---|---|
| `src/core/` | 六槽 provider 全量移植（observe / invokeAction / prepareArtifact / applyEdit / exportPreview）+ wire v2 编解码 | 只依赖 `@sciforge/domain-sdk/workspace-preview`、zod、`node:path`、`../ports/*`。**无 node:fs、无宿主私有 import**（已机械核验闭包） |
| `src/ports/` | 文件读/写端口（≤2MiB 文本 / ≤4MiB 二进制，stat 先行超限零读取）、五个数据服务端口（按纯函数签名类型化）、贡献元数据类型 | 数据端口对 workspace-* 包仅 type-only import |
| `src/dsh-adapter/` | 六槽声明装配（manifest 表逐字镜像 `sciforge.domain.json`，有防漂移测试）、node:fs 端口实现（读侧 realpath 含容；写侧词法逃逸检查后委托 domain-sdk `resolveSafeWorkspaceWriteTarget`）、真实数据端口接线、provider 分发（槽位→core 调用→响应整形）、named-runner 入口 | 唯一允许 node:fs 与 workspace-* 运行时 import 的层 |

## DONE（本阶段交付，全部有测试）

- 六槽 provider 逻辑整体下沉到 core，行为与 trusted 域包逐字段一致
  （`tests/parity.test.ts` 直接驱动 `@sciforge/domain-life-science-preview/main`
  的 provider 对照：sequence 观察/搜索、spectra 观察、molecular 观察 +
  applyEdit 会话更新、bioimaging 缩略图 **PNG 字节逐字节一致**）。
- 文件读写收口为端口：路径逃逸拒绝（内存 fake 与 node:fs 双实现）、
  4MiB 二进制超限在 stat 阶段拒绝且零读取（调用记录断言）、2MiB 文本
  观察截断不拒绝。
- bioimaging tile/thumbnail 真实二进制解码路径插件侧彩排完成：测试内构造
  最小 baseline RGB TIFF（引擎自含 `encodePngRgba`，无需任何宿主设施），
  经端口 → `decodeTile`/`decodeThumbnail` → 真实 PNG 字节（magic + 非空 +
  与静态 provider 字节级一致）。spike README §3.4 的"未彩排"到此消解。
- 六槽贡献装配 + 每槽 provider 面形状对照（biology-index-transport 仅 observe
  等）+ manifest 表与 `sciforge.domain.json` 的防漂移 diff 测试。
- 分发层响应整形：`tile`/`thumbnail` 判别字段透传；`applyEdit` 的生产契约
  `null`（宿主 fall-through）被显式 reify 为 `handled: false`，可过通道。
- 独立构建：esbuild bundle → `dist/main.js`（约 1MB，含五个纯包 + zod +
  domain-sdk 公共入口；无开发机绝对路径；plain node 可加载，入口导出
  activate/deactivate/unregister/dispose/getCapabilityDefinitions）。

## 与 spike 的偏差记录（相对 `lsp-core-spike`）

| 项 | spike | 本插件 |
|---|---|---|
| 槽位范围 | 2 个便宜槽（sequence/spectra） | 全部 6 槽；molecular applyEdit、biology-index 被动槽、bioimaging 七函数全量 |
| `prepareArtifact` 泛化 | 为 sequence/spectra 排练了 cache-artifact 字节超集（`LifeScienceCacheArtifactResult`） | **未移植**——非生产行为；SDK `WorkspacePreviewProviderArtifactResult` 成功变体仍只有 tile/thumbnail（union 缺口依旧，留给 SDK 通道一并设计）。测试相应改为 bioimaging tile/thumbnail 真实字节路径 |
| `metadataKind` 当格式提示 | spike 替身 | 未引入（随 cache-artifact 泛化一并去除） |
| bioimaging 字节出口 | 未彩排（README §3.4 头号风险） | 已彩排（真实 TIFF→PNG，双端口实现 + 静态字节级 parity + **跨进程通道字节级 parity**） |
| 写侧治理 | 测试替身近似 | 直接复用 domain-sdk `resolveSafeWorkspaceWriteTarget`（README §3.5 的建议落实） |
| 读失败语义 | 端口化后保留 | 同上；端口治理拒绝映射为 `worker-error`（code 在 message 内）——SDK 仍欠结构化 reason 席位（README §3.2） |
| 字节通道编码 seam | （当时未定） | 落在 **runner**（`encodeWorkspacePreviewWireResult`，PR-A 决策）；插件侧无 wire 代码，原 dispatch 层已删（见「通道接线」） |

## 移植忠实性说明（两处生产行为原样保留，非本插件缺陷）

- `sequence.exportSummary`：payload 原样携带 worker references 的
  `indexedRange`（`kind: 'sequence'`），触发 wire 编码器的 legacy-selection
  守卫而**抛错**——trusted 静态 provider 行为完全相同（parity 测试已核验并
  锁定该行为，防止"顺手修复"造成双轨）。
- `observe*` 的文件读失败在生产后端是直接抛 fs 异常；端口化后映射为结构化的
  `{ ok: false, reason: 'worker-error' }` 结果（spike 既定设计，渲染期更可恢复）。

## 复现命令

```bash
# 单元测试 + parity + 防漂移 + 通道往返（57 项：六槽行为 / 真实 TIFF→PNG 字节路径 /
# 有界读 / 路径逃逸 / 静态域对照 / 贡献装配与分发 / 注册面 / 真实 runner 端到端
# 与跨进程字节对照），全部用临时目录
npm test

# 类型检查
npm run typecheck

# 独立构建（esbuild bundle 到 dist/，无开发机绝对路径）
npm run build
```

本插件不在根 workspaces 内（与 biology-room / visual-review 一致，#61 / #48
未改根 package.json，能力治理脚本不扫描 plugins/）；依赖经仓库根
node_modules 软链解析，无 lockfile 变更。

## 阶段一完成标准对接

- 独立入口与构建产物：✅ dist/main.js（esbuild bundle，无 external）
- core 不依赖 SciForge 内部源码：✅ 只依赖 domain-sdk 公开入口、zod、
  node:path 与 ../ports（已核验 import 闭包）
- 原静态入口不重复执行：本插件不注册静态 catalog；静态包保持原样直至阶段一收尾
- 对照测试：✅ tests/parity.test.ts（内存端口 vs node:fs 端口逐字段一致 +
  与 `@sciforge/domain-life-science-preview/main` 静态 provider 逐字段/逐字节一致）
  + tests/channel.test.ts（真实 runner 子进程内同一 provider 逐字段/逐字节一致）
- **通道注册**：✅ 随 PR-A 参考实现落地（见上文「通道接线」）；SDK 维护者定夺
  期间的变体（开放贡献列表 / 双向 invocation 合并 / 二进制传输）只影响 SDK 侧，
  插件声明与导出面按本 README 契约保持。
- **未达标项（诚实标注）**：workspace-server 侧六个同名槽与 renderer 查看器随
  阶段二基建（前置③）另行处理，不在本插件范围。
