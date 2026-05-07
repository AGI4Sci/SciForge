# SciForge

SciForge 是面向生命科学研究的 scenario-first AI4Science workbench。

产品形态不再是“一个 agent 对应一个页面”。用户进入一个研究场景，或从内置 Scenario preset 开始，在同一个聊天驱动的 workspace 中工作。Scenario contract 决定：

- 用户想完成什么事情
- 可用的 skill domain 和 seed/workspace skills
- 预期的 input contract 和 artifact schemas
- 哪些已注册 UI components 可以渲染结果
- 真实能力边界和失败状态

UI 通过 component registry 渲染结构化 runtime artifacts。LLM 可以通过 JSON 选择 components 和 View Composition 参数，但不能生成任意 UI 代码。
Workspace-generated tasks 和 evolved skills 也经过同一个 UIManifest composition 层：任务请求的组件和用户编辑的 Scenario 设置可以在 React 渲染 component registry 前重排或替换默认 slots。

SciForge 将扩展能力分为两类：

- **Tools**：确定性的 MCP tools、database connectors、workspace runners 和 repair flows。
- **Skills**：capability contracts、Markdown task knowledge，以及用户确认后沉淀的 evolved workspace skills。`skills/seed` 中的 seed skills 描述能力和 artifact contracts；runtime task code 会在当前 workspace 中生成，之后可经用户确认提升为稳定 skill。

## 仓库结构

- `src/ui/`：React + Vite Scenario workbench。
- `src/runtime/`：workspace server、runtime gateway、task runner、skill registry 和 shared runtime types。
- `tests/smoke/`：端到端与 contract smoke scripts。
- `skills/seed/`：带 `skill.json` 的内置 capability contracts。
- `skills/installed/scp/`：从 SCP skill library 复制安装的 SCP Markdown skills。
- `docs/`：产品和架构文档。
- `docs/templates/scenario.md`：提出新 scenario case 的模板。
- `workspace/`：默认忽略的 runtime workspace；SciForge 将生成文件写入 `workspace/.sciforge/`。

## 产品模型

核心链路：

```text
scenario.md or built-in preset
  -> ScenarioSpec
  -> skill registry / AgentServer-generated workspace task / evolved skill repair
  -> Artifact + ExecutionUnit + claims + UIManifest
  -> registered scientific UI components
```

当前内置 Scenario presets 包括：

- `literature-evidence-review`
- `structure-exploration`
- `omics-differential-exploration`
- `biomedical-knowledge-graph`

它们位于 `src/ui/src/scenarioSpecs.ts`。每个 preset 声明自己的 `skillDomain`、input contract、output artifacts、scope declaration、默认 UIManifest slots 和 component policy。这些 presets 不是独立页面，而是加载到同一个 Scenario workbench 的 contracts。

## Scenario Builder 与 Library

SciForge 现在可以编译可组合的 Scenario Packages。在 workbench 中，Scenario Builder 允许用户选择 skills、tools、artifact schemas、UI components 和 failure policies，并预览：

- `ScenarioIR`
- `SkillPlan`
- `UIPlan`
- validation / quality reports

Draft 和 published packages 会写入：

```text
<workspace>/.sciforge/scenarios/<scenario-id>/
```

拆分后的 package 文件包括：

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

Dashboard Scenario Library 会列出 workspace packages，并支持打开、复制和归档流程。Published runs 会保留 `scenarioPackageRef`、`skillPlanRef`、`uiPlanRef`、runtime profile 和 route decision，因此 package 变化后旧结果仍可复现。

编写参考位于 `docs/ScenarioPackageAuthoring.md`；最小 fixture 位于 `docs/examples/workspace-scenario/`。

## 运行 UI

```bash
npm install
npm run dev
```

打开：

```text
http://localhost:5173/
```

`npm run dev` 会同时启动 Vite UI 和 scenario chat 使用的 workspace runtime。若只运行 UI，使用：

```bash
npm run dev:ui
```

如果你单独启动了 UI，并且需要 workspace-backed runs 或持久化聊天记录，还需要启动：

```bash
npm run workspace:server
```

当前选中的 workspace 可在 Resource Explorer 或 Settings 对话框中配置。SciForge 会将结构化状态写入：

```text
<workspace>/.sciforge/
```

默认情况下，本仓库指向：

```text
./workspace/
```

## Runtime

UI 聊天和 CLI/终端执行应共享同一套 Agent handoff contract。当前共享 contract 位于：

```text
src/shared/agentHandoff.ts
```

UI 聊天发送 `handoffSource=ui-chat`；终端/CLI 执行默认使用 `handoffSource=cli`。两条路径应复用相同的 scenario、skill-domain、artifact、reference、sense、action 和 failure contract，只在呈现方式上不同：UI 使用 React components，CLI 使用紧凑日志、JSON 或 Markdown。

共享边界和后续修改规则见 [`docs/CLI_UI_Shared_Agent_Usage.md`](docs/CLI_UI_Shared_Agent_Usage.md)。

Workbench 会先调用 SciForge workspace runtime：

```text
POST http://127.0.0.1:5174/api/sciforge/tools/run
```

请求以 scenario 为入口：UI 发送 `scenarioId` 和 scenario 内部的 `skillDomain`。Runtime 使用 skill domain 匹配 seed capability contracts、workspace/evolved skills 和已安装的 Markdown skills。Seed 和 Markdown skills 不指向固定源码脚本；需要执行时，SciForge 会请求 AgentServer 生成或修复 workspace-local task code。

如果没有已验证的本地 skill 能满足请求，runtime 可以请求 AgentServer 生成或修复 workspace-local task code：

```text
POST http://127.0.0.1:18080/api/agent-server/runs
```

UI 也可以直接使用 AgentServer 作为结构化聊天响应的 fallback：

```text
POST http://127.0.0.1:18080/api/agent-server/runs/stream
```

如果 workspace runtime 和 AgentServer 都不可用，SciForge 会记录用户消息并显示明确的连接错误，不会合成用于驱动图表的 demo artifacts。

## 结构化输出契约

Scenario 响应可以同时包含自然语言和结构化 JSON：

```json
{
  "message": "...",
  "confidence": 0.86,
  "claimType": "inference",
  "evidenceLevel": "database",
  "claims": [],
  "artifacts": [],
  "executionUnits": [],
  "uiManifest": []
}
```

`uiManifest` 只能引用已注册组件，例如 `molecule-viewer`、`paper-card-list`、`volcano-plot`、`heatmap-viewer`、`umap-viewer`、`network-graph`、`data-table`、`evidence-matrix`、`execution-unit-table`、`notebook-timeline` 或 `unknown-artifact-inspector`。

未知组件会回退到 `UnknownArtifactInspector`；生成式 UI plugins 默认禁用，使用前必须经过 sandbox 隔离。

对于 workspace-backed runs，SciForge 会结合当前任务 prompt 和可编辑 Scenario 设置规范化返回的 `uiManifest`。这样 generated/evolved skills 可以保持稳定，同时仍允许用户用类似“只显示 data table + evidence matrix + execution unit”或“UMAP colorBy cellCycle splitBy batch”的 prompt，让同一 artifact 生成不同格式的 JSON manifest。

## Workspace 记录

聊天状态存储在 localStorage 中；当 workspace writer 可用时，会同步镜像到 workspace：

```text
workspace/.sciforge/workspace-state.json
workspace/.sciforge/sessions/*.json
workspace/.sciforge/artifacts/*.json
workspace/.sciforge/versions/*.json
workspace/.sciforge/config.json
```

状态模型按 Scenario 保存 sessions、archived sessions、artifacts、ExecutionUnits、alignment contracts、timeline records，以及 collaboration/export policy 字段。

## 验证

```bash
npm run verify
```

`npm run verify` 会运行 typecheck、unit tests、smoke checks 和 production build。日常开发中可以使用：

```bash
npm run typecheck
npm run test
npm run build
```
