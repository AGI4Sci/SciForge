# 旧链路收口清单

最后更新：2026-05-10

本文是 `smoke:no-legacy-paths` 的人工可读说明，记录 backend-first capability architecture cutover 期间被删除的旧链路类型、当前新真相源和未来如果回归时的处理规则。

当前状态：T120/T122 cutover 已完成，`smoke:no-legacy-paths` 扫描结果为 0 tracked findings。本文不是待办清单；它是已关闭清单。只有未来某个旧链路 guard 面被重新打开时，才需要在这里新增 owner、删除条件和证据。

## 使用方式

1. 如果 `npm run smoke:no-legacy-paths` 失败，先定位失败属于下面哪一类旧链路。
2. 把行为迁回对应的新真相源，不要再新增 prompt、scenario、provider、fallback、compat 或 legacy 分支。
3. 运行 `npm run smoke:no-legacy-paths` 和触及区域的 focused smoke。
4. 只有在同一变更中写清 owner、删除条件、baseline 变化和验证证据时，才允许新增临时 baseline。
5. PROJECT 只能在代码迁移、baseline 更新和相关 smoke 都完成后更新；文档说明本身不能关闭任务。

## 已关闭旧链路类型

| 类型 | 已删除表面 | 新真相源 | 规则 |
| --- | --- | --- | --- |
| UI 语义 fallback | UI response normalization、result view planning、workbench fallback display、scenario builder fallback hints | Backend response、object refs、UIManifest、package-owned view manifests | UI 可以解释缺失 binding，但不能根据 prompt、artifact type 或硬编码领域词推断用户意图、artifact 类型或 renderer 选择。 |
| Provider / scenario / prompt 特例 | Gateway prompt text、runtime UI manifest prompt parsing、skill registry prompt matching、skill catalog provider normalization | Capability manifest、package catalog metadata、broker policy、runtime transport contracts | Runtime 可以执行 transport 和 safety policy；provider、scenario、prompt、domain 选择必须 manifest/catalog/broker 驱动。 |
| Legacy package facade re-export | `src/ui/src/scenarioCompiler/*` 和 `src/ui/src/scenarioSpecs.ts` facade | 稳定 `@sciforge/scenario-core/*` package entrypoints | UI 调用稳定 package entrypoints；不再保留 UI facade 作为并行真相源。 |
| Legacy adapter / compat re-export | package 或 `src` 中导出的 adapter/compat 路径 | 稳定 runtime entrypoints 或 package public exports | 新代码必须使用稳定入口；compat export 只能带 owner、删除条件和 baseline 证据短期存在。 |
| 旧 payload normalizer / repair fallback | 早于 `ContractValidationFailure` 的 repair-needed assembly 和 direct payload fallback | `ContractValidationFailure`、backend repair contract、validation-to-repair pipeline | 失败必须携带结构化 validation failure、recover actions 和 related refs，不能只给 free-text repair prompt。 |
| 旧 preview resolver / object ref inference | UI preview 和 artifact helper 从 artifact/domain 名称推断 display 行为 | Backend artifact tools、stable object refs、package-owned view policy | Preview 跟随 object refs 和 manifest bindings；临时 `agentserver://` preview 不能作为最终 UI 真相源。 |

## 当前 Guard 状态

`tools/check-no-legacy-paths.ts` 目前只保留历史 guard surface 的 0-count tracked entries。一个通过的 smoke 表示扫描源码中没有被容忍的 UI semantic fallback、provider/scenario/prompt 特例、legacy scenario facade re-export、legacy adapter/compat re-export 或旧 validation failure assembly。

以下仍然合法，因为它们是 package/runtime contract 的正常安全边界，不属于旧 UI/runtime semantic fallback：

- package-owned manifest fallback。
- primitive compatibility alias。
- `unknown-artifact-inspector` safety renderer。
- 用于证明 legacy full catalog 不会进入 backend handoff 的 smoke fixture sentinel。

## 已关闭 Cutover 记录

| 优先级 | Guard surface | Owner 边界 | 已完成迁移 | 关闭证据 |
| --- | --- | --- | --- | --- |
| P0 | `src/ui/src/api/agentClient/responseNormalization.ts#ui-semantic-fallback` | UI display only | 保留 failure/object-ref projection；artifact/view intent inference 迁到 backend payload refs 和 UIManifest bindings。 | no tracked finding；response normalization tests 断言不从 artifact 语义发明 UIManifest component choices 或 preferred views。 |
| P0 | `src/ui/src/app/results/viewPlanResolver.ts#ui-semantic-fallback` | Package view manifests | 本地 fallback ranking 被 package component manifests、accepted artifact types 和 compatibility aliases 替代。 | no tracked finding；view resolver tests 覆盖 manifest-driven fallback display。 |
| P0 | `src/runtime/runtime-ui-manifest.ts#provider-scenario-prompt-special-case` | Runtime binding shell + package view policy | runtime 只做 slot validation/binding，prompt-driven component defaults 迁到 scenario/view package policy。 | no tracked finding；`smoke:runtime-ui-manifest` 仍在 `smoke:all`。 |
| P1 | `src/runtime/gateway/agentserver-prompts.ts#provider-scenario-prompt-special-case` | Backend handoff contract | provider-specific prompt text 被 capability brief、policy refs 和 validation contract refs 替代。 | no tracked finding；`smoke-agentserver-broker-payload` 断言只暴露 compact broker brief。 |
| P1 | `src/runtime/skill-registry/runtime-matching.ts#provider-scenario-prompt-special-case` | Skill package manifests/catalog | prompt/provider matching hints 迁到 generated skill catalog metadata。 | no tracked finding；`packages:check` 重新生成并验证 package catalog metadata。 |
| P1 | `src/runtime/skill-markdown-catalog.ts#provider-scenario-prompt-special-case` | Skill package metadata | provider normalization 迁到 package metadata，runtime 不维护字符串分支。 | no tracked finding；skill catalog generation 属于 `packages:check`。 |
| P2 | `src/ui/src/scenarioCompiler/*#legacy-package-facade-reexport` | `@sciforge/scenario-core/*` public exports | UI caller 改用 package entrypoints，facade 文件删除。 | facade files deleted；`typecheck` 通过。 |
| P2 | `src/ui/src/scenarioSpecs.ts#legacy-package-facade-reexport` | `@sciforge/scenario-core/*` public exports | UI caller 改用 stable scenario-core entrypoints，UI facade 删除。 | facade file deleted；`typecheck` 通过。 |
| P2 | package/src `adapter` / `compat` re-export | Stable package/runtime entrypoints | 稳定 entrypoint 已补齐，caller 已迁移，T120 guard surface 无剩余 warning。 | no tracked re-export warning。 |

## Baseline 规则

- 降低或新增 `tools/check-no-legacy-paths.ts` baseline 必须和对应源码迁移在同一个 commit。
- 新增 tolerated baseline entry 必须写明 owner、迁移任务、删除条件、具体符号/路径和 focused smoke。
- 优先补 capability manifest、broker rule、runtime contract 或 backend tool；不要补 UI/runtime 特例。
- 删除旧路径时，同步更新本文、smoke baseline 和相关 PROJECT 证据。
- 文档只能说明事实，不能代替代码迁移或 smoke 通过。

## 目标状态

目标状态已经达成并由 guard 维护：

- Backend-first request handling 是唯一成功回答路径。
- Capability registry、broker、validation loop、artifact tools 和 object refs 是 routing/continuation 真相源。
- UI 渲染 state、refs、artifacts、validation failures 和 recover actions；不合成语义答案。
- Packages 拥有 capability semantics；`src/` 拥有 transport、safety、workspace refs、validation、repair、persistence 和 ledger writing。
