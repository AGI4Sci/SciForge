# Scenario Package 编写规范

SciForge 的 scenario 不是一次性聊天模板，而是可编译、可验证、可复用的科研服务包。发布后的 scenario package 是 workbench、runtime router、UI renderer、validation gate 和 export bundle 共同遵守的稳定契约。

## 包结构

```text
scenario.json
skill-plan.json
ui-plan.json
validation-report.json
quality-report.json
tests.json
versions.json
package.json
```

`package.json` 是完整打包表示；拆分文件用于人类审阅、自动校验和版本 diff。每个文件都应能独立说明自己的 contract，不依赖隐式 UI 状态。

## 编写流程

1. 在 Scenario Builder 中描述科研服务目标。
2. 选择组合元素：skills、tools、senses、actions、verifiers、artifact schemas、UI components 和 failure policies。
3. 编译为 `ScenarioIR`、`SkillPlan`、`UIPlan` 和 verification policy。
4. 执行静态验证、dry-run smoke 和必要的 artifact/view 检查。
5. 只有 quality report 没有 blocking item 时才能发布。

发布前可以动态推荐能力；发布后的 runtime 必须稳定。每次运行都应记录 `scenarioPackageRef`、`skillPlanRef`、`uiPlanRef`、`runtimeProfileId`、route decision 和 selected senses/actions/verifiers。

## 元素规则

- 每个输出 artifact 至少要有一个 producer skill 或 task。
- 每个 artifact 必须有 UI consumer、interactive view 或 fallback inspector。
- 需要观察外部模态时，显式声明 sense，例如 `vision-sense`。
- 会改变外部环境时，显式声明 action provider，例如 Computer Use。
- 影响结论、文件、外部系统或用户决策的任务必须声明 verifier 或 human review policy。
- 未知 tools 是 warning；未知 skills、artifact schemas、UI components、failure policies、senses/actions/verifiers 是 blocking。
- 失败状态必须显式且可恢复，不能用 demo success data 覆盖真实失败。

## 版本规则

以下变化应产生新的 package 版本：

- 输入 contract、输出 artifact 或 artifact schema 变化。
- 选择的 skills、senses、actions、verifiers、UI components 或 failure policies 变化。
- runtime profile、环境要求、验证策略或导出策略变化。
- 对已有结果解释方式有影响的 view composition 或 primitive schema 变化。

已有 run 始终绑定原始 package 版本，不应被新版本静默重解释。

## 质量门禁

Quality gate 综合以下信息：

- 静态 validation report。
- runtime smoke 结果。
- artifact schema 与 UI manifest 检查。
- verifier 或 human review policy 覆盖情况。
- export policy 决策。
- 与上一版本的 version diff。

Blocking item 阻止发布；warning 可以发布，但必须在 report 中保留可见。

## 推荐模块边界

```text
Scenario Package
  -> skills: 推理策略与领域任务
  -> senses: 观察输入模态
  -> actions: 改变环境的执行能力
  -> verifiers: 结果、trace、artifact 和状态验证
  -> ui-components / interactive-views: artifact 展示与对象引用
```

Scenario 只声明组合关系和稳定策略，不把模块实现复制进包内。模块实现应留在对应 package，并通过 manifest、schema 和版本引用进入 scenario。
