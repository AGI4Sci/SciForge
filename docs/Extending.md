# SciForge 扩展契约

最后更新：2026-05-09

本文合并原能力集成、scenario package、view schema 和 skill promotion 文档。具体字段以源码为准。

## Scenario Package

Scenario package 的主类型在 [`../packages/scenarios/core/src/scenarioPackage.ts`](../packages/scenarios/core/src/scenarioPackage.ts)：

```ts
interface ScenarioPackage {
  schemaVersion: '1';
  id: string;
  version: string;
  status: 'draft' | 'validated' | 'published' | 'archived';
  scenario: ScenarioIR;
  skillPlan: SkillPlan;
  uiPlan: UIPlan;
  validationReport?: ValidationReport;
  qualityReport?: ScenarioQualityReport;
  tests: Array<{ id: string; prompt: string; expectedArtifactTypes: string[] }>;
  versions: ScenarioPackageVersion[];
}
```

Workspace package 位置：

```text
<workspace>/.sciforge/scenarios/<safe-id>/
```

writer 支持两种读取格式：

- 单文件：`package.json`
- 拆分文件：`scenario.json`、`skill-plan.json`、`ui-plan.json`、`tests.json`、`versions.json`，可选 `validation-report.json`、`quality-report.json`

写入时当前实现会同时写 split files 和 `package.json`。读取与发布逻辑在 [`../src/runtime/workspace-server.ts`](../src/runtime/workspace-server.ts) 的 scenario endpoints。

## Scenario Authoring Flow

1. 从内置 scenario 或空包生成 `ScenarioPackage`。
2. 明确 `scenario.skillDomain`：`literature`、`structure`、`omics` 或 `knowledge`。
3. 写 `inputContract`、`outputArtifacts`、`scopeDeclaration`。
4. 编译或指定 `skillPlan` 与 `uiPlan`。
5. 加至少一个 smoke test。
6. 运行 validation 和 quality gate。
7. 只有无 blocking issue 时发布。

相关实现：

- 内置 specs：[`../packages/scenarios/core/src/scenarioSpecs.ts`](../packages/scenarios/core/src/scenarioSpecs.ts)
- Skill plan compiler：[`../packages/scenarios/core/src/skillPlanCompiler.ts`](../packages/scenarios/core/src/skillPlanCompiler.ts)
- UI plan compiler：[`../packages/scenarios/core/src/uiPlanCompiler.ts`](../packages/scenarios/core/src/uiPlanCompiler.ts)
- Validation gate：[`../packages/scenarios/core/src/validationGate.ts`](../packages/scenarios/core/src/validationGate.ts)
- Quality gate：[`../packages/scenarios/core/src/scenarioQualityGate.ts`](../packages/scenarios/core/src/scenarioQualityGate.ts)

发布会被以下情况阻止：

- `qualityReport.items` 中存在 `severity: "blocking"`。
- `qualityReport.ok === false`。
- `validationReport.ok === false`。

## Capability Brief

能力分为 5 类，类型真相源在 `packages/contracts/runtime/capabilities.ts`：

- `observe`：只读观察能力，例如 vision、OCR、网页/文件观察。
- `reasoning`：确定性策略或 planner，例如 conversation policy。
- `action`：会改变环境的动作，例如 workspace task。
- `verify`：schema、agent rubric、environment diff、人类确认。
- `interactive-view`：artifact renderer。

主 agent 默认只消费 compact brief：

- `summary` 包含 id、kind、category、oneLine、domains、triggers、risk、cost、reliability、sideEffects。
- `contract` 懒加载，只在选中能力后读取。
- `capabilityBrief` 有候选预算，避免把完整 registry 塞进上下文。

当前 UI handoff 会把 scenario override 中的 `selectedSkillIds`、`selectedToolIds`、`selectedSenseIds`、`selectedActionIds`、`selectedVerifierIds`、`selectedComponentIds` 传给 runtime；Python conversation-policy 会进一步生成能力摘要和 handoff plan。迁移完成后新增能力应使用 `skills/tool_skills` 和 `observe` 命名，旧 `tool` / `sense` 字段只作为兼容输入存在。

## Observe Contract

Observe ABI 真相源是 `packages/contracts/runtime/observe.ts`。稳定字段：

- observe provider capability brief
- observe request
- observe response
- observe invocation plan/record

原则：

- 输入模态通过 refs 传递，不把大图、大表或截图字节塞进长期上下文。
- 输出是 bounded text response、artifact refs、trace ref、diagnostics 和 confidence。
- 高风险或隐私输入应 require confirmation 或 fail-closed。
- Observe 可以被主 agent 多次窄化调用。
- Observe 不产生副作用；如果需要改变外部环境，应拆到 action provider。

`vision-sense` 样板包位于 [`../packages/observe/vision/README.md`](../packages/observe/vision/README.md)。旧 `packages/senses` 不再作为新增能力落点。

## Action Contract

Action 是会改变外部环境的能力。当前主要落地：

- workspace task runner：[`../src/runtime/workspace-task-runner.ts`](../src/runtime/workspace-task-runner.ts)
- workspace writer file/open APIs：[`../src/runtime/workspace-server.ts`](../src/runtime/workspace-server.ts)
- repair handoff runner：[`../src/runtime/repair-handoff-runner.ts`](../src/runtime/repair-handoff-runner.ts)
- Computer Use action loop：[`../packages/actions/computer-use/README.md`](../packages/actions/computer-use/README.md)

Action 必须记录副作用边界、输入输出 refs、stdout/stderr、失败原因、可恢复动作和 verifier 需要的证据。

## Verifier Contract

Verifier runtime ABI 真相源是 [`../src/runtime/runtime-types.ts`](../src/runtime/runtime-types.ts)，runtime gate 与 normalization 真相源分别是 [`../src/runtime/gateway/verification-policy.ts`](../src/runtime/gateway/verification-policy.ts) 和 [`../src/runtime/gateway/verification-results.ts`](../src/runtime/gateway/verification-results.ts)。handoff payload 里只保留轻量 policy snapshot，目标真相源是 `packages/contracts/runtime/handoff-payload.ts`。

- `VerificationPolicy`
- `VerificationResult`
- `VerificationVerdict`
- `VerificationMode`
- `VerificationRiskLevel`

稳定 verdict：

- `pass`
- `fail`
- `uncertain`
- `needs-human`
- `unverified`

Provider kind 包括 `human`、`agent`、`rule`、`schema`、`test`、`environment`、`simulator`、`reward-model`。高风险、外部副作用、人工要求或科学 claim 应显式选择 verifier 或标记未验证原因。

## Module Boundaries

新增代码默认落点：

- `packages/*` 放可复用 capability、renderer、contract 和 skill。它们不能 import `src/ui/src/**`、`src/runtime/**` 或 `src/shared/**` 私有文件；共享类型先放到 `packages/contracts/runtime`、`packages/scenarios/core` 或包自己的 public export。
- `packages/skills/**` 放 `SKILL.md` 面向 agent 的能力入口。单步工具型 skill 放 `packages/skills/tool_skills`，多步流程放 `pipeline_skills`，领域方法放 `domain_skills`，skill 自进化/调试放 `meta_skills`。
- `packages/observe/**` 放只读观察能力；旧 `packages/senses/**` 不再作为新增能力落点。
- `packages/actions/**` 放有副作用的真实执行 provider，必须承载 approval、trace、sandbox、rollback 和 safety guard。
- `src/runtime/**` 放 workspace server、gateway、task runner、policy 和 runtime-only adapters。需要暴露给 package 或 UI 的稳定契约应提升到 package contract，不让 package 反向依赖 runtime 私有模块。
- `src/ui/src/app/**` 放 app shell、页面组合和用户交互 orchestration。UI 代码应 import package root 或 package.json 明确 export 的 subpath，不直接深 import package `src` internals。
- `src/shared/**` 不作为长期目录。共享协议进 packages contract，执行逻辑进 runtime，界面逻辑进 ui。

边界 smoke：

```bash
npm run smoke:module-boundaries
```

当前少量历史例外由 [`../tools/check-module-boundaries.ts`](../tools/check-module-boundaries.ts) 以 warning 打印，并在 T099 后续迁移中收敛；新增未登记的 package -> app/runtime 私有 import 或 UI -> package internal deep import 会失败。

## UIManifest 与 View Composition

UIManifest slot 类型在 [`../packages/scenarios/core/src/contracts.ts`](../packages/scenarios/core/src/contracts.ts)。核心字段：

```ts
interface UIManifestSlot {
  componentId: string;
  title?: string;
  props?: Record<string, unknown>;
  artifactRef?: string;
  priority?: number;
  encoding?: ViewEncoding;
  layout?: ViewLayout;
  selection?: ViewSelection;
  sync?: ViewSync;
  transform?: ViewTransform[];
  compare?: ViewCompare;
}
```

runtime 会在 [`../src/runtime/runtime-ui-manifest.ts`](../src/runtime/runtime-ui-manifest.ts) 中做组件选择：

- scenario override 默认组件优先。
- 当前 turn 显式选择组件其次。
- prompt 中明确要求的组件再次。
- AgentServer 返回的 incoming slots 可作为补充。
- 都没有时使用 domain default components。
- `execution-unit-table` 默认会加入，除非 prompt 明确否定。

Renderer 真相源在 [`../packages/presentation/components/README.md`](../packages/presentation/components/README.md)。新增或修改 renderer 时：

- 每个组件包至少有 `package.json`、`manifest.ts`、`README.md`。
- 推荐有 `render.tsx`、`fixtures/`、`render.test.tsx`。
- `manifest.ts` 声明 accepted artifact types、required fields、events、fallback 和 safety。
- renderer 只渲染和发事件，不直接写 workspace、不调用 AgentServer、不承担 verifier provider。
- 大 payload 使用 `dataRef`、workspace ref 或 object ref。

## Skill 与 Promotion

Package skill 真相源在 [`../packages/skills/README.md`](../packages/skills/README.md)。新增 package skill 时，在 `packages/skills/**/SKILL.md` 写 agent-facing contract，然后运行：

```bash
npm run skills:generate
npm run packages:check
```

Workspace task 晋升逻辑在 [`../src/runtime/skill-promotion.ts`](../src/runtime/skill-promotion.ts)。触发条件包括：

- 当前 skill 是 `agentserver-generation`。
- skill id 以 `agentserver.generate.` 开头。
- task 路径包含 `/generated-`。
- 或任务经历 self-healed。

Proposal 写入：

```text
<workspace>/.sciforge/skill-proposals/<proposal-id>/proposal.json
<workspace>/.sciforge/skill-proposals/<proposal-id>/README.md
```

接受 proposal 时会：

1. 读取源 task code。
2. 运行安全门，检查硬编码用户数据、绝对路径、凭证文本、私有文件引用、可复现入口和显式失败模式。
3. 复制 task 到 `.sciforge/evolved-skills/<skill-id>/`。
4. 写入 workspace skill manifest。
5. 标记 proposal 为 `accepted`。

安全门未通过时不能 accept。验证 accepted skill 会根据 manifest 的 validation smoke 再跑一次 workspace task。

## 安全与晋升

新增 capability、scenario、view 或 skill 时，默认遵守：

- 不把 demo/空结果伪装成成功。
- 不把 secret、token、私有路径和大文件内容 inline 到长期上下文。
- 任何外部副作用都必须有 action boundary、trace 和 verifier 证据。
- 高风险任务要有人类确认或明确 `unverified` 暴露。
- UI component 不能直接执行文件写入、远程调用或环境动作。
- 只有通过验证、人工确认和安全门的 workspace task 才能晋升为 skill。

## 新扩展检查表

- [ ] 找到源码真相源，避免复制旧文档里的字段。
- [ ] 写清楚输入 refs、输出 artifact、失败模式和 side effects。
- [ ] 如果是 scenario，补 `tests`、validation report 和 quality report。
- [ ] 如果是 UI component，补 manifest、fixtures、README 和 renderer test。
- [ ] 如果是 sense/action/verifier，补 brief、request/response 或 result contract。
- [ ] 如果会被 agent 选择，只给主 agent brief，把大说明放在懒加载 README/contract。
- [ ] 跑 `npm run typecheck`、`npm run test`、`npm run smoke:module-boundaries` 和相关 smoke。
