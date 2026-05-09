# SciForge Packages

该目录包含 SciForge 的可复用能力和运行时支持包。

在新增或修改 package 之前，请先遵循集成标准：
[`docs/Extending.md`](../docs/Extending.md)。

这份标准定义了 `observe`、`actions`、`verifiers`、`ui-components`、`skills` 以及其它能力应该如何暴露给 agent，避免 agent 因可用能力过多而分散注意力，同时保留灵活选择能力的空间。

`packages/senses` 和顶层 `packages/tools` 是迁移前历史名称。新增能力不要再放进这两个目录：

- 新增观察能力进入 `packages/observe`。
- 新增 `SKILL.md` 面向 agent 的能力进入 `packages/skills/{tool_skills,pipeline_skills,domain_skills,meta_skills}`。
- 真正会改变环境的执行 provider 进入 `packages/actions`。

## Package 边界

- `skills`：agent 可见的能力入口。凡是主要通过 `SKILL.md` 被 agent 使用的能力，都应进入这里，并按 skill kind 归档。
- `skills/tool_skills`：单步、窄功能、工具型 skill。旧顶层 `tools` 会迁移或 alias 到这里。
- `skills/pipeline_skills`：多步流程型 skill，例如检索、分析、生成报告、验证串起来的 workflow。
- `skills/domain_skills`：领域方法、科学协议、分析套路和 domain playbook。
- `skills/meta_skills`：skill 创建、调试、沉淀、自进化和能力选择工作流。
- `observe`：observe 层。输入是 `instruction + 其它模态`，输出是可审计 `text-response`，例如视觉摘要、OCR、区域描述、坐标、置信度和失败边界。Observe 不产生副作用。
- `actions`：action 层。对环境产生影响的执行 provider，例如 Computer Use、浏览器沙箱、远程桌面、文件编辑、notebook/kernel 或未来实验设备动作。
- `verifiers`：verify 层。输入是 result、trace、artifact、环境状态和验证 instruction，输出 verdict、reward、critique、evidence refs、repair hints 和 confidence；provider 可以是人类、其它 agent、规则测试、schema、环境观察或 simulator。
- `ui-components`：interactive views/renderers。面向用户和 agent 呈现 artifact 数据，并暴露鼠标、键盘、对象引用、事件和代码交互边界；它们不是 action provider。
- `runtime-contract`：运行时共享契约。
- `scenario-core`：scenario 编译与校验基础能力。
- `design-system`：可复用 UI primitives 和 tokens。
- `artifact-preview`：artifact 预览辅助能力。
- `object-references`：object reference 辅助能力。

## 单一真相源

- Computer Use 的 Python action loop、contract、safety 和 trace 实现保留在 `packages/computer-use`；`packages/actions/computer-use` 只保存 action provider manifest 和 safety/approval 发现信息。runtime 只能把它作为 action provider 接入，不应复制 loop 或 safety policy。
- Vision observe 的 provider 实现和 pytest 保留在 `packages/observe/vision`；`src/runtime/vision-sense` 只做 SciForge Gateway adapter、workspace refs、runtime event 和 guard 接入。能力 id 可继续兼容 `local.vision-sense`。
- Interactive renderer registry 的当前真相源仍是 `packages/ui-components`；`packages/interactive-views` 是语义化别名和未来迁移目标。`packages/design-system` 只提供低层 primitives/tokens，不承载 artifact renderer registry。
- Runtime/UI/Package 共享协议的真相源是 `packages/runtime-contract`。`packages/artifact-preview` 和 `packages/object-references` 只保留便捷 helper、normalizer 和转换函数；若发现纯 contract 类型，应上移到 `runtime-contract` 后再由 helper 消费。
- `SKILL.md` 面向 agent 的能力入口统一进入 `packages/skills/*_skills`；真实副作用执行器必须落在 `packages/actions` 或 runtime adapter 中，并通过 action contract 暴露 approval、trace、sandbox、rollback 和 safety guard。

正式长期组织方式是 contract-reason-skill-observe-action-verify-present 闭环：

```text
packages/runtime-contract/  stable shared contracts
packages/skills/            SKILL.md-facing abilities and catalogs
packages/observe/           observe: instruction + modality -> text-response
packages/actions/           environment-changing action providers
packages/verifiers/         result/trace/artifact/state -> verdict/reward/critique
packages/ui-components/ or packages/interactive-views/
                            artifact presentation and interactive data surfaces
```

Verify 是闭环的必要阶段，但 verifier 的类型和强度可按风险选择。低风险草稿可以使用轻量规则或标记为 `unverified`；高风险动作、科研结论、外部副作用和发布类任务必须有明确 verifier 或 human approval。

`packages/ui-components` 当前名称保留以兼容现有 registry。`packages/interactive-views` 已作为非破坏性别名和长期迁移目标加入；它重新导出同一批 manifests，不移动 renderer，也不改变 component registry 真相源。未来如真实迁移目录，必须继续保留 `packages/ui-components` 的 registry、componentId、alias 和 renderer 兼容导出。

## 集成原则

使用能保证可靠性的最低集成等级：

- 大多数新 skills 使用 Markdown-first package。
- 单步工具型能力如果主要通过 `SKILL.md` 暴露，放在 `skills/tool_skills`。
- 常用、稳定、可复用但不直接面向 `SKILL.md` 的只读能力，放在 `observe` 或相关 contract package。
- 会产生副作用的执行资源放在 `actions`，并带 approval、trace、sandbox、rollback 和 safety guard。
- 关键 observe provider、安全敏感 action、长时间 workflow 或高成本能力使用 native runtime adapter。

agent 应先接收紧凑的 capability brief，然后只懒加载被选中 package 的详细契约或 `SKILL.md`。

## Owner Note

`packages/*` 是跨 UI、runtime 和 workspace 复用的能力边界。新增 package 代码不能 import `src/ui/src/**` 或 `src/runtime/**` 私有文件；如果需要共享 domain、artifact、object reference、verification 或 UI manifest 类型，先把契约提升到 `packages/runtime-contract`、`packages/scenario-core` 或当前 package 的 public export。

`src/shared` 不是长期边界。共享协议进入 `packages/runtime-contract` 或后续 `packages/contracts`；执行逻辑进入 `src/runtime`；界面逻辑进入 `src/ui`。

UI app 侧也应通过 package root 或 package.json 明确 export 的 subpath 使用能力，避免相对路径深 import package `src` internals。边界检查命令：

```bash
npm run smoke:module-boundaries
```

## Scaffold

新增 package 或 skill 前先复制并裁剪模板：

```text
packages/templates/package-scaffold/
```

模板要求新增包显式声明 lifecycle layer、skill-facing 边界、副作用等级、public contract 和 runtime adapter 关系；这和 `npm run smoke:module-boundaries` 使用的是同一套组织原则。
