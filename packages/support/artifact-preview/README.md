# @sciforge-ui/artifact-preview

本包是 artifact/file 预览 contract 的轻量辅助边界，用来共享 `PreviewDescriptor` 类型和 descriptor 形状 helper。

源码位于 `packages/support/artifact-preview`；发布包名和 import alias 继续保持 `@sciforge-ui/artifact-preview`。

## Agent 使用契约

- `PreviewDescriptor`、derivative 和 preview action 类型的真相源是 `@sciforge-ui/runtime-contract`，本包只 re-export 这些 contract types。
- Runtime server 拥有 workspace file preview descriptor、file-kind、inline policy 和 default action 推断。
- UI results 拥有 artifact metadata fallback descriptor、hydration policy 和 inline rendering fallback。
- 不要把大文件内容内联到聊天上下文；使用 descriptor derivative、locator hint 和 workspace ref。

## 边界

App shell 可以继续拥有布局和 object focus state。Runtime/UI 不应从本包导入 preview inference、default action 或 hydration policy；本包只保留 descriptor merge、diagnostic append、derivative normalization 等 contract-adjacent helpers。
