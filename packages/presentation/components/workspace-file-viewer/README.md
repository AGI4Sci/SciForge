# @sciforge-ui/workspace-file-viewer

该包是 SciForge UI component registry 中的右侧 workspace file renderer。它负责展示目录树、文件草稿和保存请求入口；它不是 workspace action provider，也不直接读写文件。

## Agent quick contract / Agent 快速契约
- componentId：`workspace-file-viewer`
- accepts：`workspace-file`, `workspace-file-view`, `workspace-tree`
- requires：`rootPath`, `entriesByFolder`; 编辑态还需要 `file` 与 `draft`
- outputs：`workspace-file-view`
- events：`open-file-request`, `save-draft-request`, `refresh-tree-request`, `toggle-folder`, `draft-change`, `close-file`, `copy-path-request`, `copy-contents-request`, `load-more-folder-request`
- fallback：`generic-artifact-inspector`
- safety：不执行代码; 不访问外部资源; 不直接写 workspace; host helper owns list/read/write
- demo fixtures：`fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts`
- primitive/preset：`document` primitive with workspace tree chrome

## Human notes / 维护说明

## 数据契约
该组件接收由 GUI host 装配好的 workspace tree snapshot：`entriesByFolder` 以文件夹路径为 key，值为当前已加载的直接 children；`expandedFolderPaths` 决定可见层级；`file` 与 `draft` 是当前编辑对象和草稿。组件不 import workspace client，不自行读取路径，也不绕过 host 的安全路径规则。

大目录由 host 继续拥有读取与分页策略。renderer 只按 `treePageSize` 展示当前已给出的 children，并通过 `folderContinuations[path]`、`onLoadMoreFolder({ folderPath, offset, limit })` 表达“加载下一页”意图；`entriesByFolder[path] === undefined` 只表示该目录正在由 host 懒加载。

大文件由 host 继续拥有分段读取策略。renderer 会把超过 `inlineTextLimitBytes`、`contentUnavailable`、`encoding: "base64"` 或非文本 `mimeType` 的文件降级为 typed read-only state；二进制文件不显示 raw/base64 内容。对于可文本预览的大文件，host 可传 `previewContent` 与 `previewSegment`，renderer 只展示该只读片段，不把完整 payload 当成编辑草稿。

## 交互语义
组件只通过 props callbacks 或已声明事件表达用户意图：打开文件、展开文件夹、刷新、折叠、编辑草稿、请求保存、复制路径/内容、关闭视图。保存是 `save-draft-request`，真正的 `writeWorkspaceFile` 由 app/host 层决定并执行。

## 安全边界
该组件的安全约束是：不执行代码; 不访问外部资源; 不直接写 workspace。路径校验、敏感路径拦截、绝对路径策略、workspace 读写和保存错误归 host adapter 所有。renderer 只显示已给出的安全数据和 view-local draft。

## 何时不要使用该组件
不要用它展示远程 URL、二进制 artifact、图片/PDF 的富预览、terminal transcript 或 verifier verdict。那些对象应使用更精确的 renderer 或 `unknown-artifact-inspector` fallback。

## 测试与发布
发布前保持 `fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts` 与 manifest 的 `workbenchDemo` 对齐，并运行 `npm --workspace @sciforge-ui/components run packages:check`、`npm run typecheck` 和相关 renderer 测试。
