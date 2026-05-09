# @sciforge-ui/model-eval-viewer

该包是 SciForge UI component registry 中的一个可发布 renderer。它负责把结构化 artifact 渲染为可读、可交互、可引用的视图；它不是 action provider，也不是 verifier provider。

## Agent quick contract / Agent 快速契约
- componentId：`model-eval-viewer`
- accepts：`model-artifact`, `model-evaluation`, `classification-metrics`, `regression-metrics`, `model-report`
- requires：以下之一：`model`, `metrics`, `roc`, `pr`, `confusionMatrix`, `evaluation`, 或 `predictionsRef`
- outputs：`model-artifact`, `statistical-result`, `plot-spec`
- events：`select-threshold`, `select-class`, `hover-curve-point`, `open-model-ref`
- fallback：`scientific-plot-viewer`, `generic-data-table`, `generic-artifact-inspector`
- safety：不执行代码; checkpoint、config 和 prediction 文件必须使用声明过的 refs
- demo fixtures：`fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts`
- primitive/preset：`model-artifact` evaluation profile，并可投影为 `statistical-result` 与 Plotly-compatible `plot-spec`

## Human notes / 维护说明

## 数据契约
该组件优先接收 `model-artifact`, `model-evaluation`, `classification-metrics`, `regression-metrics`, `model-report` 类型或兼容 alias 的 artifact。大型数据、图像、结构文件、日志和外部资源应通过 workspace refs、`dataRef`、`filePath` 或 manifest 声明资源传递，避免把完整 payload 塞进 agent 上下文。

## 交互语义
组件只发出已声明事件：`select-threshold`, `select-class`, `hover-curve-point`, `open-model-ref`。事件 payload 应携带稳定 artifact/object refs，例如 row id、node id、sequence range、plot point id、file ref 或 trace ref。屏幕坐标只能作为辅助证据，不能作为长期事实。

## 安全边界
该组件的安全约束是：不执行代码; checkpoint、config 和 prediction 文件必须使用声明过的 refs。renderer 不应执行任意代码、不应绕过 manifest 访问外部资源、不应直接写 workspace，也不应自行给出 pass/fail/reward verdict。需要改变环境时交给 action provider；需要验证结论时交给 verifier。

## 何时不要使用该组件
当 artifact 有更精确的领域 renderer 时，不要用 `model-eval-viewer` 作为泛化替代。该组件也不应用于装饰性内容、隐藏命令入口、未声明网络访问，或任何会把用户交互直接变成外部副作用的流程。

## 测试与发布
发布前保持 `fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts` 与 manifest 的 `workbenchDemo` 对齐，并运行 `npm run packages:check`、`npm run typecheck` 和相关 renderer 测试。
