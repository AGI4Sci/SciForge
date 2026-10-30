# @sciforge/plugin-visual-review

Visual Review 原生域模块的运行时插件（24-1 阶段一，③可视化组；HOST-PORTS 桥已随
#62 交付、热替换代际桥接线修复随 #64 交付，artifact 绑定能力经合同 `ports` 白名单启用）。
core 是 `packages/domains/visual-review` 的 service/contract 移植副本，dsh-adapter 走
named-runner 契约入口（2026-10-12 spike 实测可用的 workspace-write 声明路径；
2026-10-15 de-risk spike 实测 canvas 原生依赖与 destructive 决策空间）。

## 与 bundled 域共存的过渡规则

本插件与 `@sciforge/domain-visual-review` 注册**相同的能力 ID**。两者同载会触发
`duplicate_capability` 启动失败（fail-closed，属预期行为）。在插件替代 bundled 域的
过渡期，加载本插件的宿主必须显式交接静态面：

```bash
SCIFORGE_EXCLUDED_DOMAIN_PACKAGES=@sciforge/domain-visual-review
```

（该开关是 #48 引入的通用机制，biology-room 迁移走同一路径。）插件不随宿主自动加载，
仅经开发接缝/正式安装进入，因此正常宿主不受此约束。

这是 **Host 的可信启动组合决定**，不是插件 manifest 的替代授权；包声明
`replacesCapabilities` 不会取得任何现有能力的所有权。未排除静态域时，启用插件必须拒绝，
不能吞冲突或临时挪走 native/其他插件的注册。排除后，插件仍须单独通过 Host 合同审批并
显式启用；禁用/失败后能力保持缺席，不恢复 native，也不隐式启用另一路径。需要恢复静态域时，
由 Host 明确撤销排除配置并重新启动组合，而不是插件 cleanup 决定。

## 桥前形态：现在就能用什么

**非 artifact 能力（7 个，完整可用）**——真实读写调用方工作区
`.sciforge/visual-documents/<documentId>/`（document.json + assets/ + revisions/ +
backups/ + review-packets/ + acceptance-outbox/），数据跟随项目目录：

| 能力 | 说明 |
|---|---|
| `visual-review.open` | 打开/创建评审文档，可暂存一个源 artifact（工作区拷贝 + 哈希簿记） |
| `visual-review.read-document` | 读取已存在的评审文档（不存在即拒） |
| `visual-review.read-image` | 读取工作区内有界 raster 图片为 dataURL |
| `visual-review.update-context` | 更新节点、truth locks、样式引用 |
| `visual-review.apply-style-reference` | 从参考图提取 manuscript 视觉样式并落盘默认样式档 |
| `visual-review.save-annotations` | 整体替换标注集（几何 + 修改指令 + 目标节点） |
| `visual-review.reject-candidate` | 拒绝当前候选（不替换源图） |

**artifact 绑定能力（3 个，桥已接通）**——`export-review-packet`、
`create-candidate`、`accept-candidate`（以及 `open` 显式携带
`artifact.versionRef` 的校验路径）。#62 交付宿主桥后，合同在 `dshAuthorization.ports`
声明 `artifacts.commit/read/listEvents` 白名单即启用（runner 注入
`globalThis.__sciforgeHostPorts`，本插件经 `src/dsh-adapter/host-ports-autowire.ts`
自动接线，无需宿主侧逐插件代码；桥缺失时仍保持 fail-closed，错误信息为
`Host ports bridge is not connected (…#53 HOST-PORTS).`）：

- 热替换代际不再断线：#64 修复了候选换代路径丢失桥授权回调的缺陷（`PluginUpdateCoordinator`
  现在透传宿主钩子；回归测试 `keeps the ports bridge wired across a candidate hot-swap
  generation change`）。
- 另需环境前提：`create-candidate` 要先经 image-edit 模型产出候选图（语义编辑
  不静默回退为拷贝源图，未配置时 `provider_not_configured` fail-closed）。
- 宿主端口协议形状已对齐 #53 的 HOST-PORTS（`src/ports/visual-review-ports.ts`，
  与 evidence-dag 的 ports.ts 同构，只留 `artifacts.commit/read/listEvents`
  最小 operation 集）。#53 对齐评论已把 visual-review 并入公共桥线；宿主泛化桥
  交付时通过 `setVisualReviewPorts(ports)` 注入，`commitArtifactVersion` /
  `readArtifactVersion` 适配层已按静态端口形状 `(input, workspaceRoot)` 就位。
- 桥接通后的语义：`export-review-packet` 写出 packet 后将其作为不可变 artifact
  version 提交（编排层可寻址的修订交接物，intent `publish`）；
  `create-candidate` 暂存候选前校验已绑定基线 artifact version 仍为 current；
  `accept-candidate` 复刻静态编排（preflight 回执 → 字节核验 → 提交评审字节 →
  原子接受 + 源图备份）。单测里用假 ports 完整跑通了这条端到端链路。

## 评审环路的 audience 协作模型

完整评审环路的各个步骤按静态入口原样映射 audience，**刻意由 UI 与 Agent 协作完成，
单一角色无法独立跑通**：

| 步骤 | audience | 驱动方 |
|---|---|---|
| open / read-document / update-context / export-review-packet | ui + agent + system | 双方 |
| read-image / apply-style-reference / save-annotations / accept-candidate / reject-candidate | 仅 ui | 界面（看图、人审标注、接受/拒绝决策） |
| create-candidate | 仅 agent + system | 编排/Agent |

也就是说：Agent 可以自助完成「打开 → 导出评审包」，但「标注 → 建候选 → 接受」
必须由 UI 完成标注与接受动作；反过来 UI 用户也不能自行触发候选创建。这不是
缺失的授权，而是评审环路的职责划分（标注是人审输入，接受是人工决策点）。

## 盘点记录（相对静态入口的折衷，全部有实测依据）

| 项 | 结论 |
|---|---|
| descriptor.scope | 全 'workspace'（宿主校验：仅 resource-scope 可声明 resourceKinds；named-runner 未验证宿主资源句柄） |
| descriptor.concurrency.revision | 全 'none'（宿主校验：optimistic revision 需要 resource scope）；并发由 service 的 baseRevision/expectedBaseHash/接受回执保证（与静态路径同一行代码） |
| acceptCandidate effect | **'workspace-write' + approval 'none'**，替代静态 'destructive' + 'confirmation'。2026-10-15 de-risk：宿主拒绝 destructive+approval:none；destructive+confirmation 可激活但调用被拒不达子进程（审批未接插件路径）。接受回执写入本就是 workspace-write 语义；候选的 artifact 退役/版本提交留在编排层。SDK 接通确认审批后可恢复 destructive |
| 无顶层 `changed` | 宿主校验 changed:true 需宿主资源句柄；变更事实保留在 output 内 |
| createCandidate reviewedAt | wire schema 用等价 ISO-8601 offset 正则替代 `z.string().datetime({offset:true})`：宿主 broker 用 `z.fromJSONSchema` 重建输入校验，其 format:date-time 映射丢失 offset 支持会误拒合法入参；pattern 可无损往返（单测覆盖） |
| 资源引用 | 可序列化文档对象（service 为事实源），无宿主 observe/dispose 句柄 |
| audiences | 照静态映射（readImage/applyStyleReference/saveAnnotations/acceptCandidate 为 ui-only；broker 按 audience 门控） |

## canvas 打包

`@napi-rs/canvas` 是原生依赖，esbuild 标 **external**（`build.mjs`），作为唯一的
运行时 dependency 由 npm 安装到插件环境，并解析对应平台的 optional native binding；
tarball 不内嵌开发机 `node_modules`。其余依赖
（`@sciforge/domain-artifact-versions/contract`、`@sciforge/scientific-plotting/visual-style-extractor`、
`@sciforge/domain-sdk`、`zod`）由 esbuild 从仓库 workspace 打包进 dist，无运行时包解析。

## 复现命令

```bash
# 单元测试（6 项：descriptor 对照 / JSON Schema 往返 / 非 artifact 回路 /
# artifact 绑定 fail-closed / 假 ports 端到端 / 负向校验），全部用临时目录
npm test

# 类型检查
npm run typecheck

# 独立构建（esbuild bundle 到 dist/，无开发机绝对路径）
npm run build
```

真实包验收与源码单测分离；普通单测不要求先 build。下列命令在仓库根运行，
`ARTIFACTS`、`INSTALL` 指向调用者批准的独立临时目录（须先创建），不发布、不启动应用：

```bash
# private:true 不妨碍本地 pack；prepack 会生成 dist/main.js
npm pack ./plugins/visual-review --pack-destination "$ARTIFACTS"
npm install --prefix "$INSTALL" --omit=dev --ignore-scripts --no-audit --no-fund \
  "$ARTIFACTS/sciforge-plugin-visual-review-0.1.0.tgz"
SCIFORGE_VISUAL_PACKAGE_DIRECTORY="$INSTALL/node_modules/@sciforge/plugin-visual-review" \
  node node_modules/vitest/vitest.mjs run \
    src/main/extensions/visual-review-package.acceptance.test.ts --configLoader runner
```

验收通过真实 `DevelopmentExternalPluginService` 与默认 Child loader 激活 npm 安装的
bundle（空 `cordis.patch.yml` 与 named activate 入口），核对 10 个 definitions，读写临时工作区，
确认未获端口授权时拒绝 artifact 操作，禁用后删除插件能力且不恢复 native。
无 `SCIFORGE_VISUAL_PACKAGE_DIRECTORY` 时仅跳过此专用验收，不影响源码单测。

## 阶段一完成标准对接

- 独立入口与构建产物：✅ dist/main.js（esbuild bundle，canvas external）
- core 不依赖 SciForge 内部源码：✅ 只依赖 domain-sdk 公开入口、artifact-versions 公开 contract、scientific-plotting 公开 visual-style-extractor、zod、@napi-rs/canvas
- 原静态入口不重复执行：本插件不注册静态 catalog；静态包保持原样直至阶段一收尾排除
- 对照测试：✅ tests/adapter.test.ts（descriptor 与 VISUAL_REVIEW_CAPABILITY_IDS 逐一对照；假 ports 驱动 commit/read 适配层断言）
