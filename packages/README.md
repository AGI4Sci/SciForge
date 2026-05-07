# SciForge Packages

该目录包含 SciForge 的可复用能力和运行时支持包。

在新增或修改 package 之前，请先遵循集成标准：
[`docs/CapabilityIntegrationStandard.md`](../docs/CapabilityIntegrationStandard.md)。

这份标准定义了 `senses`、`actions`、`verifiers`、`ui-components`、`skills`、`tools` 以及其它能力应该如何暴露给 agent，避免 agent 因可用能力过多而分散注意力，同时保留灵活选择能力的空间。

## Package 边界

- `skills`：agent 可选择的工作策略。
- `tools`：skill 可以调用的执行资源。
- `senses`：observe 层。输入是 `instruction + 其它模态`，输出是可审计 `text-response`，例如视觉摘要、OCR、区域描述、坐标、置信度和失败边界。
- `actions`：action 层。对环境产生影响的执行 provider，例如 Computer Use、浏览器沙箱、远程桌面、文件编辑、notebook/kernel 或未来实验设备动作。
- `verifiers`：verify 层。输入是 result、trace、artifact、环境状态和验证 instruction，输出 verdict、reward、critique、evidence refs、repair hints 和 confidence；provider 可以是人类、其它 agent、规则测试、schema、环境观察或 simulator。
- `ui-components`：interactive views/renderers。面向用户和 agent 呈现 artifact 数据，并暴露鼠标、键盘、对象引用、事件和代码交互边界；它们不是 action provider。
- `runtime-contract`：运行时共享契约。
- `scenario-core`：scenario 编译与校验基础能力。
- `design-system`：可复用 UI primitives 和 tokens。
- `artifact-preview`：artifact 预览辅助能力。
- `object-references`：object reference 辅助能力。

推荐长期组织方式是 observe-reason-action-verify 闭环：

```text
packages/senses/     observe: instruction + modality -> text-response
packages/skills/     reasoning/task strategy
packages/actions/    environment-changing action providers
packages/verifiers/  result/trace/artifact/state -> verdict/reward/critique
packages/ui-components/ or packages/interactive-views/
                     artifact presentation and interactive data surfaces
```

Verify 是闭环的必要阶段，但 verifier 的类型和强度可按风险选择。低风险草稿可以使用轻量规则或标记为 `unverified`；高风险动作、科研结论、外部副作用和发布类任务必须有明确 verifier 或 human approval。

`packages/ui-components` 当前名称保留以兼容现有 registry。若未来改名，应把 `interactive-views` 作为别名/迁移目标，而不是把 UI components 放进 `actions`。

## 集成原则

使用能保证可靠性的最低集成等级：

- 大多数新 skills 和简单 tools 使用 Markdown-first package。
- 常用 tools 和稳定可复用执行资源使用 schema adapter。
- 关键 senses、安全敏感动作、长时间 workflow 或高成本能力使用 native runtime adapter。

agent 应先接收紧凑的 capability brief，然后只懒加载被选中 package 的详细契约或 `SKILL.md`。
