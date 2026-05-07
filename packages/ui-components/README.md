# @sciforge-ui/components

## Agent 快速契约
- This package aggregates published SciForge UI component manifests.
- 本包聚合已发布的 SciForge UI component manifests。
- 长期能力名称是 interactive artifact views/renderers；`packages/ui-components` 继续作为稳定 registry 兼容层。
- Agent 选择某个组件前，应先阅读该组件 README 中的 `Agent 快速契约` 或 `Agent quick contract`。
- `primitive-map.md` 是当前 component/artifact id 到稳定 data primitive 与未来 renderer 名称的兼容映射源。
- primitive schema 草案放在 `schemas/*.schema.json`；每个 schema 都包含可用于 agent 和 workbench smoke 的示例 payload。
- 每个组件 README 必须暴露同一组顶层契约字段：`componentId`、`accepts`、`requires`、`outputs`、`events`、`fallback`、`safety` 和 `demo fixtures`。
- `availableComponentIds` 是 allowlist，不是要求 agent 生成所有匹配 artifact 的命令。
- 如果已选组件都不能接收某个对象，使用 `unknown-artifact-inspector`，或走 preview/system-open fallback。
- 这些 renderer 不是 action provider，也不是 verifier provider。它们可以承载人工验证交互，但 verdict/reward 契约属于 verifier package。

## Interactive Artifact View 契约

`packages/ui-components` 的长期职责是把结构化 artifact 渲染成可读、可操作、可引用的 interactive surface：

```text
artifact data + schema + view props + refs -> visible view + events + object refs
```

### Data Schema

- 每个 renderer 必须通过 `manifest.ts` 声明 `acceptsArtifactTypes`、必要字段、可选 view params、fallback renderer 和安全限制。
- `artifact.data` 与 `slot.props` 都视为不可信 runtime payload；renderer 只能按声明 schema 读取，并为缺失字段提供空态或降级。
- 大型数据、文件、图像、notebook、trace 或外部对象应通过 `dataRef`、`path`、workspace ref 或 object reference 传递，不应把完整 payload 强塞进 agent 上下文。
- Schema 草案放在 `schemas/*.schema.json`，组件 README 应说明该组件使用的 primitive schema 或 preset schema。

### 可见 Affordance

- 可见 affordance 是用户和 agent 能观察到的操作入口，例如选择点/行/节点、展开详情、过滤、排序、缩放、重置视图、批注、导出、打开来源和查看 provenance。
- affordance 必须在 README 和 `interactionEvents` 中声明；隐藏热键、隐式副作用和未声明网络访问都不属于稳定 contract。
- 组件可以展示 human verification 控件，例如 accept、reject、revise、score、comment，但这些只是交互事件，不直接构成 verifier provider 的 verdict。

### Object References

- 组件输出的选择、批注和编辑意图应引用稳定 object refs，而不是只返回屏幕坐标或临时 DOM id。
- object refs 应指向 artifact id、schema path、row/node/point/sequence range、file ref、trace ref 或 workspace ref，并能被 CLI/agent 在没有浏览器状态时解释。
- 鼠标坐标和 viewport 状态只能作为辅助证据；长期事实必须落在 object/reference contract 上。

### Events

- 事件是 renderer 向上层表达用户意图的边界，例如 `select`、`inspect`、`filter-change`、`edit-proposal`、`annotation-add`、`export-request`、`verify-accept`、`verify-reject`、`verify-revise`、`verify-score`。
- 事件 payload 必须包含 componentId、artifact/object refs、可选 patch 或 comment，以及来源 affordance；不得直接执行文件写入、远程 API、GUI 操作或 verifier verdict 计算。
- 上层 runtime、action provider 或 verifier provider 可以订阅这些事件并决定是否执行动作或生成 `VerificationResult`。

### 鼠标、键盘与代码交互边界

- 鼠标和键盘交互只改变 view-local 状态或发出声明过的事件；任何外部环境改变都必须交给 action provider。
- keyboard contract 应优先服务 accessibility、导航和选择，不应成为隐藏命令接口。
- renderer 可以暴露代码级交互 API 给 workbench shell，例如 selection callback、render helpers、workspace file read helper；这些 API 仍只返回 refs/events/view state，不直接充当 action provider。
- renderer 不负责验证结果真伪、运行测试、操作实验设备、写入 workspace 或调用 AgentServer。

## 维护说明
每个子目录都刻意设计成可独立发布的 UI component package。`manifest.ts` 是机器可读契约；README 先提供 agent 可快速扫描的操作契约，再保留给人类维护的设计、测试和发布说明。

### 组件包结构
- `package.json`：可发布 package metadata。`private` 保持未设置或 `false`。
- `manifest.ts`：SciForge view planner 消费的机器可读模块契约。
- `render.tsx`：包内 renderer 入口。它接收 `UIComponentRendererProps`，并可使用 shell helpers 处理下载、source bar、empty state、Markdown 和 workspace file read 等 app-owned chrome。
- `fixtures/`：用于本地调试和回归测试的最小空 payload 与示例 payload。
- `render.test.tsx`：基于 fixtures 的轻量 renderer contract tests。
- `README.md`：agent-facing contract 与人类维护说明。

### Renderer 契约
Renderer 应把 `artifact.data` 和 `slot.props` 都视为不可信 runtime payload，提供有用空态，避免在 manifest 未声明时获取网络资源，并让交互事件与 `manifest.ts` 保持一致。新组件包应面向这个 renderer interface；legacy in-app adapters 只服务尚未迁移的组件。

`packages/interactive-views` 是本包的非破坏性别名和长期迁移目标。当前 registry 真相源仍是 `packages/ui-components`；别名只用于让新文档或新代码表达 interactive views/renderers 语义。未来如迁移目录，必须保留 `packages/ui-components` 的 manifest、componentId、alias 和 renderer 兼容导出。

### README 契约
每个组件 README 应先给出 `Agent 快速契约` 或 `Agent quick contract`，再给出维护说明。维护说明保持这些小节：data schema、interaction/edit output semantics、performance/resource limits、when not to use、testing/publishing notes。Preset 组件必须说明底层 primitive，例如 volcano 和 UMAP 是 `point-set` preset，heatmap 是 `matrix` preset，knowledge graph 是 `graph` preset。

科学绘图组件优先采用 Plotly-compatible spec。`scientific-plot-viewer`、model evaluation、time-series plotting、statistical result views、publication figure builders 和 export bundles 应把 `plot-spec`/`figure-spec` 作为可编辑 source of truth。Matplotlib artifacts 是从同一 spec 派生出的 fallback 或高级出版导出，不是主要编辑状态。

### 测试与发布
已发布组件包至少必须包含 `package.json`、`manifest.ts` 和 `README.md`。当前示例包还应包含 `render.tsx`、`fixtures/` 和 renderer tests。发布或修改包契约前，运行 `npm run packages:check`、`npm run typecheck` 和 `npm run test`。
