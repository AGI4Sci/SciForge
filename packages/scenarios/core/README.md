# @sciforge/scenario-core

`scenario-core` 是不依赖 UI 的 Scenario Package 编译核心。它接收 scenario selection、skill/tool/component manifests 和内置 specs，输出稳定 runtime contracts。

## 输入

- `packages/skills` 中的 skill manifests
- `packages/skills/tool_skills` 中的 tool skill manifests
- `packages/presentation/components` 中的 UI component manifests
- 内置 scenario specs
- 用户 draft 或 element selection

## 输出

- `ScenarioPackage`
- `ScenarioIR`
- `SkillPlan`
- `UIPlan`
- `ValidationReport`
- `ScenarioQualityReport`
- `ElementRegistry`

## 常用 API

```ts
import { buildBuiltInScenarioPackage, validateScenarioPackage } from '@sciforge/scenario-core';

const pkg = buildBuiltInScenarioPackage('literature-evidence-review');
const validation = validateScenarioPackage(pkg);
```

## 边界

Compiler core 不应依赖 React、浏览器 API 或页面局部状态。Scenario Builder 可以保留交互状态，但 contract 编译、校验和 quality report 应调用本包。

新增 artifact、component、failure policy 或角色规则时，优先建模为 package/compiler data，再让 UI 渲染它，不要把页面专用能力硬编码进 compiler。
