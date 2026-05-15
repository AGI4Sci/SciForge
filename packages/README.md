# SciForge Packages

该目录包含 SciForge 的可复用能力、共享契约、worker/provider 和运行时支持包。

新增或修改 package 前，先对照 [`../docs/Architecture.md`](../docs/Architecture.md) 的 Capability、Provider、Runtime Resolver 和 `src`/`packages` 边界。这里的核心原则是两条轴同时成立：

- 行为边界回答“能力在 agent loop 中扮演什么角色”：`observe`、`actions`、`verifiers`、`presentation`、`skills`。
- 执行边界回答“在哪里运行、怎么运行”：每个可搬运执行包必须声明 worker/provider manifest；worker 可以内嵌在 1:1 能力包中，也可以在 `packages/workers` 中独立发布。

`packages/senses` 和顶层 `packages/tools` 是迁移前历史名称。新增能力不要再放进这些目录：

- 新增只读观察能力进入 `packages/observe`。
- 新增会改变环境的执行能力进入 `packages/actions`。
- 新增验证能力进入 `packages/verifiers`。
- 新增呈现能力进入 `packages/presentation`。
- 新增 `SKILL.md` 面向 agent 的方法和工作流进入 `packages/skills/{tool_skills,pipeline_skills,domain_skills,meta_skills}`。
- 跨多个 capability、需要独立部署生命周期的执行包进入 `packages/workers`。
- 共享 capability/worker 协议进入 `packages/contracts`。

如果迁移旧目录中的能力，先给目标 package 补 capability manifest、schema、validator、README 和 worker/provider manifest，再把调用方切到稳定 package entrypoint。只有旧 facade 或 adapter 真的删除后，才降低 `smoke:no-legacy-paths` baseline，并在 [`../docs/legacy-cutover-inventory.md`](../docs/legacy-cutover-inventory.md) 记录证据。

## Package 边界

新增模块先判断边界：

当前 `src` 固定平台与 `packages` 插拔能力清单见 [`../docs/boundary-inventory.md`](../docs/boundary-inventory.md)，机器可读来源是 [`../tools/check-boundary-inventory.ts`](../tools/check-boundary-inventory.ts)。package 新增或迁移前先确认 inventory 中已有对应能力类别；如果没有，先补清单和对应 checks，再扩展实现。

- 属于平台秩序的逻辑进入 `src/`：lifecycle、loading、routing shell、provider dispatch、validation/repair loop、workspace refs、artifact persistence、global safety 和 app/runtime orchestration。
- 属于能力语义的逻辑进入 `packages/`：capability manifest、schema、validator、examples、repair hints、scenario/view/skill policy 和 composed capability。
- 属于执行位置的逻辑进入对应能力包或 `packages/workers/`：worker manifest、healthcheck、invoke server/CLI、provider route、权限、依赖、smoke test 和部署说明。
- `src` 可以固定系统运行方式，但不能写死 package 的领域语义；`packages` 可以扩展能力，但不能绕过 runtime 的 refs、validation、persistence、permission 和 safety。

- `skills`：agent 可见的能力入口。凡是主要通过 `SKILL.md` 被 agent 使用的能力，都应进入这里，并按 skill kind 归档。
- `skills/tool_skills`：单步、窄功能、工具型 skill。旧顶层 `tools` 会迁移或 alias 到这里。
- `skills/pipeline_skills`：多步流程型 skill，例如检索、分析、生成报告、验证串起来的 workflow。
- `skills/domain_skills`：领域方法、科学协议、分析套路和 domain playbook。
- `skills/meta_skills`：skill 创建、调试、沉淀、自进化和能力选择工作流。
- `observe`：observe 层。输入是 `instruction + 其它模态`，输出是可审计 `text-response`，例如视觉摘要、OCR、区域描述、坐标、置信度和失败边界。Observe 不产生副作用。
- `actions`：action 层。对环境产生影响的执行 provider，例如 Computer Use、浏览器沙箱、远程桌面、文件编辑、notebook/kernel 或未来实验设备动作。
- `verifiers`：verify 层。输入是 result、trace、artifact、环境状态和验证 instruction，输出 verdict、reward、critique、evidence refs、repair hints 和 confidence；provider 可以是人类、其它 agent、规则测试、schema、环境观察或 simulator。
- `presentation/components`：interactive views/renderers。面向用户和 agent 呈现 artifact 数据，并暴露鼠标、键盘、对象引用、事件和代码交互边界；它们不是 action provider。
- `contracts/runtime`：运行时共享契约。
- `contracts/tool-worker`：独立 worker 的 manifest、health、invoke 和 HTTP helper contract。
- `workers`：独立可搬运 worker/provider 包。只在 worker 横跨多个 capability、多个行为类型，或需要独立部署生命周期时使用；1:1 capability/provider 默认合并在能力包内。
- `scenarios/core`：scenario 编译与校验基础能力。
- `presentation/design-system`：可复用 UI primitives 和 tokens。
- `artifact-preview`：artifact 预览辅助能力。
- `object-references`：object reference 辅助能力。

## Capability 契约

核心 package capability 应同时提供：

- `capability manifest`：id、version、owner package、brief、routing tags、side effects、safety、lifecycle layer 和 provider variants。
- `schema`：输入、输出、artifact refs、evidence refs、失败形态和 fallback policy。
- `validator`：校验 output、refs、artifact、evidence、side effects 和 provider diagnostics。
- `repair hints`：结构化失败原因、可恢复动作、相关 refs、stdout/stderr/log refs 和下一步建议。

每个可独立搬运的执行包还必须提供：

- `worker/provider manifest`：worker id/version/protocol、provider ids、capability ids、transport、endpoint/command、auth、permissions、workspace roots、fallback eligibility 和 release channel。
- `health`：liveness/readiness、依赖、授权、quota/rate-limit 和最近失败。
- `invoke`：结构化 request/result envelope，失败必须带 provider-neutral failure code、recover actions 和 diagnostics。
- `smoke`：manifest discovery、health、invoke、permission denied、rate-limit、empty-result 和 fallback route trace。
- `README`：本机运行、复制到远程机器、环境变量、端口、权限和版本兼容说明。

package 只能声明能力和 provider 变体，不能声明自己拥有 runtime lifecycle。以下 ownership 留在 `src/`：

- backend run lifecycle、stream resume/poll、global routing shell。
- workspace ref resolution、artifact persistence、materialization、ledger 写入。
- global permission/safety policy、sandbox policy、approval gate。
- contract validation / repair loop 主编排、provider dispatch 主流程。
- app shell、session state、UI orchestration 和 workspace writer 生命周期。

## 单一真相源

- Computer Use 的 Python action loop、contract、safety、trace 和 action provider manifest 都保留在 `packages/actions/computer-use`。runtime 只能把它作为 action provider 接入，不应复制 loop 或 safety policy。
- Vision observe 的 provider 实现和 pytest 保留在 `packages/observe/vision`；`src/runtime/vision-sense` 只做 SciForge Gateway adapter、workspace refs、runtime event 和 guard 接入。能力 id 可继续兼容 `local.vision-sense`。
- Interactive renderer registry 的当前真相源仍是 `packages/presentation/components`；`packages/presentation/interactive-views` 是语义化别名和未来迁移目标。`packages/presentation/design-system` 只提供低层 primitives/tokens，不承载 artifact renderer registry。
- Runtime/UI/Package 共享协议的真相源是 `packages/contracts/runtime`。`packages/support/artifact-preview` 和 `packages/support/object-references` 只保留便捷 helper、normalizer 和转换函数；若发现纯 contract 类型，应上移到 `runtime-contract` 后再由 helper 消费。
- `SKILL.md` 面向 agent 的能力入口统一进入 `packages/skills/*_skills`；真实副作用执行器必须落在 `packages/actions` 或 runtime adapter 中，并通过 action contract 暴露 approval、trace、sandbox、rollback 和 safety guard。
- Web observe capability contract 的当前真相源是 `packages/observe/web`；默认独立执行包是 `packages/workers/web-worker`。二者通过 `web_search` / `web_fetch` capability id 和 `sciforge.web-worker.*` provider id 连接，不能再回到泛名 `packages/tools`。

正式长期组织方式是 contract-reason-skill-observe-action-verify-present 闭环：

```text
packages/contracts/runtime/  stable shared runtime contracts
packages/contracts/tool-worker/
                            standalone worker protocol contracts
packages/skills/            SKILL.md-facing abilities and catalogs
packages/observe/           observe: instruction + modality -> text-response
packages/actions/           environment-changing action providers
packages/verifiers/         result/trace/artifact/state -> verdict/reward/critique
packages/presentation/components/ or packages/presentation/interactive-views/
                            artifact presentation and interactive data surfaces
packages/workers/           independently deployable provider/worker packages
```

Verify 是闭环的必要阶段，但 verifier 的类型和强度可按风险选择。低风险草稿可以使用轻量规则或标记为 `unverified`；高风险动作、科研结论、外部副作用和发布类任务必须有明确 verifier 或 human approval。

`packages/presentation/components` 保留 `@sciforge-ui/components` package name、componentId、alias 和 renderer 兼容导出。`packages/presentation/interactive-views` 是语义化别名；它重新导出同一批 manifests，不改变 component registry 真相源。

## 集成原则

使用能保证可靠性的最低集成等级：

- 大多数新 skills 使用 Markdown-first package。
- 单步工具型能力如果主要通过 `SKILL.md` 暴露，放在 `skills/tool_skills`。
- 常用、稳定、可复用但不直接面向 `SKILL.md` 的只读能力，放在 `observe` 或相关 contract package。
- 会产生副作用的执行资源放在 `actions`，并带 approval、trace、sandbox、rollback 和 safety guard。
- 1:1 capability/provider 默认合并在对应能力包中；1:N worker 或 N:1 provider matrix 才拆到 `packages/workers`。
- 关键 observe provider、安全敏感 action、长时间 workflow 或高成本能力使用 native runtime adapter。

agent 应先接收紧凑的 capability brief，然后只懒加载被选中 package 的详细契约或 `SKILL.md`。

## Owner Note

`packages/*` 是跨 UI、runtime 和 workspace 复用的能力边界。新增 package 代码不能 import `src/ui/src/**` 或 `src/runtime/**` 私有文件；如果需要共享 domain、artifact、object reference、verification 或 UI manifest 类型，先把契约提升到 `packages/contracts/runtime`、`packages/scenarios/core` 或当前 package 的 public export。

`src/shared` 不是长期边界。共享协议进入 `packages/contracts/runtime` 或后续 `packages/contracts`；执行逻辑进入 `src/runtime`；界面逻辑进入 `src/ui`。

UI app 侧也应通过 package root 或 package.json 明确 export 的 subpath 使用能力，避免相对路径深 import package `src` internals。边界检查命令：

```bash
npm run smoke:module-boundaries
```

`smoke:module-boundaries` 只检查 import graph：package -> app/runtime 私有 import、UI -> package internal deep import、`src/shared` 扩散。Package manifest、workspace 覆盖和 runtime ownership claims 不在这个 smoke 中检查。

T122 把边界检查拆成更细的 smoke：

- `smoke:fixed-platform-boundary` 检查 `src` 固定平台与 `packages` 插拔能力边界。
- `smoke:no-src-capability-semantics` 扫描 `src/**`，阻止新增 package-owned artifact/component/provider/scenario/domain 语义；历史命中按 file/rule 计数基线追踪。
- `smoke:capability-manifest-registry` 要求 package capabilities 从 manifest/catalog 发现。
- `smoke:workspace-package-metadata` 覆盖嵌套 package name/version、workspace 覆盖和 SciForge metadata 声明或继承。
- `smoke:package-runtime-boundary` 禁止 package manifest、README 和 SKILL contract 声称 runtime lifecycle ownership。

Package 侧聚合命令：

```bash
npm run packages:check
```

`packages:check` 会刷新 `packages/skills` 生成索引，并顺序运行 capability manifest registry、workspace package metadata、package runtime boundary 和 `@sciforge-ui/components` publication checks。UI component 的 package.json exports、files、fixtures、README 和 sibling import 规则由 [`../scripts/check-ui-components-package-boundaries.ts`](../scripts/check-ui-components-package-boundaries.ts) 负责；generic catalog smoke 只负责 manifest/catalog discovery，不重复检查 UI component 发布面。

allowlist/baseline 只用于历史迁移项和短期 adapter。每条例外都要绑定 owner、迁移任务、删除条件和具体符号/路径；不要用宽泛 glob 给新增违规开口，迁移删除旧语义后同步降低基线。

对 package 作者来说，这意味着：

- 不新增 `adapter`、`compat`、`legacy` re-export 作为公开入口；需要兼容时在现有入口旁写明删除条件。
- 不在 README、manifest 或 SKILL contract 中声明自己拥有 stream lifecycle、workspace refs、artifact persistence、global safety 或 validation loop。
- 不把旧 `sense` / `tool` 名称扩散到新 package；只在 compatibility alias 表里保留映射。
- 不通过 UI fallback 或 prompt 关键词选择 package；把 routing tags、accepted artifacts 和 fallback policy 写进 manifest。

## Scaffold

新增 package 或 skill 前先复制并裁剪模板：

```text
packages/support/templates/package-scaffold/
```

模板要求新增包显式声明 lifecycle layer、skill-facing 边界、副作用等级、public contract 和 runtime adapter 关系；这些元数据由 `npm run packages:check` 覆盖，import topology 仍由 `npm run smoke:module-boundaries` 覆盖。
