# @sciforge-ui/components

## Agent quick contract
- This package aggregates published SciForge UI component manifests.
- Long-term capability name: interactive artifact views/renderers. `packages/ui-components` remains the stable registry compatibility layer.
- Agents should read each selected component package's `README.md` `Agent quick contract` section first.
- `primitive-map.md` is the compatibility source for mapping current component/artifact IDs to stable data primitives and future renderer names.
- Schema drafts for primitives live in `schemas/*.schema.json`; each file includes an example payload for agent and workbench smoke usage.
- Every component README must expose the same top-level contract fields: `componentId`, `accepts`, `requires`, `outputs`, `events`, `fallback`, `safety`, and `demo fixtures`.
- `availableComponentIds` is an allowlist, not a command to generate every matching artifact.
- If no selected component accepts an object, use `unknown-artifact-inspector` or the preview/system-open fallback path.
- These renderers are not action providers and not verifier providers. They may host human verification interactions, but verifier packages own verdict/reward contracts.

## Interactive artifact view contract

`packages/ui-components` 的长期职责是把结构化 artifact 渲染成可读、可操作、可引用的 interactive surface：

```text
artifact data + schema + view props + refs -> visible view + events + object refs
```

### Data schema

- 每个 renderer 必须通过 `manifest.ts` 声明 `acceptsArtifactTypes`、必要字段、可选 view params、fallback renderer 和安全限制。
- `artifact.data` 与 `slot.props` 都视为不可信 runtime payload；renderer 只能按声明 schema 读取，并为缺失字段提供空态或降级。
- 大型数据、文件、图像、notebook、trace 或外部对象应通过 `dataRef`、`path`、workspace ref 或 object reference 传递，不应把完整 payload 强塞进 agent 上下文。
- Schema 草案放在 `schemas/*.schema.json`，组件 README 应说明该组件使用的 primitive schema 或 preset schema。

### Visible affordance

- 可见 affordance 是用户和 agent 能观察到的操作入口，例如选择点/行/节点、展开详情、过滤、排序、缩放、重置视图、批注、导出、打开来源和查看 provenance。
- affordance 必须在 README 和 `interactionEvents` 中声明；隐藏热键、隐式副作用和未声明网络访问都不属于稳定 contract。
- 组件可以展示 human verification 控件，例如 accept、reject、revise、score、comment，但这些只是交互事件，不直接构成 verifier provider 的 verdict。

### Object references

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

## Human notes
Each child directory is intentionally shaped like a publishable UI component package. The manifest is the machine-readable contract; the README is split so agents can scan a short operational section while humans can maintain richer design and testing notes below it.

### Component package structure
- `package.json`: publishable package metadata. Keep `private` unset or `false`.
- `manifest.ts`: machine-readable module contract consumed by the SciForge view planner.
- `render.tsx`: package-native renderer entry. It receives `UIComponentRendererProps` and may use explicit shell helpers for app-owned chrome such as downloads, source bars, empty states, markdown, and workspace file reads.
- `fixtures/`: minimal empty and populated payload examples for local debugging and regression tests.
- `render.test.tsx`: lightweight renderer contract tests using fixtures.
- `README.md`: agent-facing contract plus human maintenance notes.

### Renderer contract
Renderers should treat `artifact.data` and `slot.props` as untrusted runtime payloads, render useful empty states, avoid fetching network resources unless the manifest declares them, and keep interaction events aligned with `manifest.ts`. New component packages should target this renderer interface; legacy in-app adapters only exist for components that have not been migrated yet.

`packages/interactive-views` 是本包的非破坏性别名和长期迁移目标。当前 registry 真相源仍是 `packages/ui-components`；别名只用于让新文档或新代码表达 interactive views/renderers 语义。未来如迁移目录，必须保留 `packages/ui-components` 的 manifest、componentId、alias 和 renderer 兼容导出。

### README contract
Each component README has an `Agent quick contract` followed by `Human notes`. Human notes should keep the same maintenance subsections: data schema, interaction/edit output semantics, performance/resource limits, when not to use, and testing/publishing notes. Preset components must name their underlying primitive, for example volcano and UMAP as `point-set` presets, heatmap as a `matrix` preset, and knowledge graph as a `graph` preset.

Scientific plotting components are Plotly-first. `scientific-plot-viewer`, model evaluation, time-series plotting, statistical result views, publication figure builders, and export bundles should treat Plotly-compatible `plot-spec`/`figure-spec` as the editable source of truth. Matplotlib artifacts are fallback or advanced publication exports derived from the same spec, never the primary editing state.

### Testing and publishing
At minimum, published component packages must have `package.json`, `manifest.ts`, and `README.md`. The current sample packages, `report-viewer` and `data-table`, additionally require `render.tsx`, `fixtures/`, and renderer tests. Before publishing or changing a package contract, run `npm run packages:check`, `npm run typecheck`, and `npm run test`.
