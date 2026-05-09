# @sciforge-ui/artifact-preview

本包是 artifact/file 预览逻辑的迁移边界，用来把 SciForge 的 artifact、file ref、dataRef 和 metadata 规范化成 `PreviewDescriptor`。

源码真相源位于 `packages/support/artifact-preview`；发布包名和 import alias 继续保持 `@sciforge-ui/artifact-preview`。

## Agent 使用契约

- 渲染预览前先使用本包生成 `PreviewDescriptor`。
- `normalizeArtifactPreviewDescriptor` 会保留显式 descriptor，并从 path、dataRef、metadata 和 artifact type 推断 fallback preview。
- PDF/image 优先使用可流式或 inline descriptor；text/table/json/html 优先使用 extract descriptor；office/structure/binary 保留 system-open/copy-ref fallback。
- 不要把大文件内容内联到聊天上下文；使用 descriptor derivative、locator hint 和 workspace ref。

## 边界

App shell 可以继续拥有布局和 object focus state，但 descriptor 规范化、action 选择、derivative 合并和 hydration policy 应留在本包，方便独立测试和发布。
