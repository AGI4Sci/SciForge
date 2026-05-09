# @sciforge-ui/object-references

本包负责 SciForge 的 object reference 规范化和转换。Object reference 是聊天、结果区、反馈批注、Workbench、Notebook/Timeline 和未来 CLI 共享的长期记忆指针。

源码真相源位于 `packages/support/object-references`；发布包名和 import alias 继续保持 `@sciforge-ui/object-references`。

它只负责“如何表达引用”，不负责渲染 chip、打开文件、执行任务，也不决定 agent 应该做什么。

## Agent 使用契约

- runtime artifact 需要在右侧结果区聚焦时，使用 `objectReferenceForArtifactSummary`。
- 上传文件持久化成 `RuntimeArtifact` 后，使用 `referenceForUploadedArtifact` 和 `objectReferenceForUploadedArtifact`。
- 把 object/file/artifact 转成聊天上下文引用时，使用 `referenceForObjectReference`、`referenceForArtifact` 和 `referenceForWorkspaceFileLike`。
- 预览区不要猜路径，使用 `artifactForObjectReference`、`pathForObjectReference` 和 `referenceToPreviewTarget`。
- 引用 chip 排序和隐藏计数使用 `objectReferenceChipModel`，优先展示可信引用。
- DOM/反馈引用使用 `referenceForUiElement`、`referenceForTextSelection` 和 `stableElementSelector`。

## 设计原则

Object reference 应尽量小、稳定、可跨 UI/CLI/AgentServer 解释。优先使用 workspace path、artifact id、run id、hash 和 producer metadata，不依赖短暂 DOM 文案或当前页面状态。

可信引用应指向已存在 artifact/url，或包含后续可检查的 provenance。只有 AgentServer 临时生成、缺少 workspace provenance 的引用，应保持 untrusted，直到用户聚焦、确认或 runtime 验证它。
