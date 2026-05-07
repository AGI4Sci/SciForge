# @sciforge-ui/schema-form-editor

该包是 SciForge UI component registry 中的一个可发布 renderer。它负责把结构化 artifact 渲染为可读、可交互、可引用的视图；它不是 action provider，也不是 verifier provider。

## Agent quick contract / Agent 快速契约
- componentId：`schema-form-editor`
- accepts：`editable-design`, `schema-form`, `json-schema`, `form-artifact`, `parameter-set`
- requires：以下之一：`schema`, `jsonSchema`, `uiSchema`, `formData`, `body`, 或 `designType`
- outputs：`editable-design`, `schema-form`, `record-set`
- events：`change-field`, `validate-form`, `submit-form`, `open-schema-ref`
- fallback：`generic-artifact-inspector`, `generic-data-table`
- safety：sandboxed; 不执行代码; remote schemas 或 assets must be declared refs
- demo fixtures：`fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts`
- primitive/preset：`editable-design` schema-form profile

## Human notes / 维护说明

## 数据契约
该组件优先接收 `editable-design`, `schema-form`, `json-schema`, `form-artifact`, `parameter-set` 类型或兼容 alias 的 artifact。大型数据、图像、结构文件、日志和外部资源应通过 workspace refs、`dataRef`、`filePath` 或 manifest 声明资源传递，避免把完整 payload 塞进 agent 上下文。

## 交互语义
组件只发出已声明事件：`change-field`, `validate-form`, `submit-form`, `open-schema-ref`。事件 payload 应携带稳定 artifact/object refs，例如 row id、node id、sequence range、plot point id、file ref 或 trace ref。屏幕坐标只能作为辅助证据，不能作为长期事实。

## 安全边界
该组件的安全约束是：sandboxed; 不执行代码; remote schemas 或 assets must be declared refs。renderer 不应执行任意代码、不应绕过 manifest 访问外部资源、不应直接写 workspace，也不应自行给出 pass/fail/reward verdict。需要改变环境时交给 action provider；需要验证结论时交给 verifier。

## 何时不要使用该组件
当 artifact 有更精确的领域 renderer 时，不要用 `schema-form-editor` 作为泛化替代。该组件也不应用于装饰性内容、隐藏命令入口、未声明网络访问，或任何会把用户交互直接变成外部副作用的流程。

## 测试与发布
发布前保持 `fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts` 与 manifest 的 `workbenchDemo` 对齐，并运行 `npm run packages:check`、`npm run typecheck` 和相关 renderer 测试。
