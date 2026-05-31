# @sciforge-ui/browser-workbench

该包是 SciForge GUI component registry 中的内置浏览器右侧工作台 renderer。它展示 TUI `browser_runtime` 已产出的 session、tab、snapshot、trace refs 和终端等价命令；它不是网页 agent，也不选择 Playwright provider。

## Agent quick contract / Agent 快速契约
- componentId：`browser-workbench`
- accepts：`browser-runtime-projection`, `browser-session`, `browser-snapshot`, `browser-feedback-bundle`
- requires：`session` 或 `projection`; 可选 `snapshot`, `traceRefs`, `commands`, `previewUrl`
- outputs：`browser-workbench`
- events：`browser-command-request`, `open-url-request`, `snapshot-request`, `takeover-request`, `focus-tab`, `copy-ref-request`
- fallback：`generic-artifact-inspector`
- safety：不执行代码; 不选择 provider; 不读取跨域 DOM; 不保存 screenshot/base64/full DOM/logs; host owns iframe preview policy
- demo fixtures：`fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts`
- primitive/preset：browser session right-pane primitive with tabs, refs, and command bar

## Human notes / 维护说明

## 数据契约
该组件接收 `@sciforge-ui/runtime-contract/browser-runtime` 中的 projection 或同形 payload。大对象必须以 refs 传入：`screenshotRef`, `domSnapshotRef`, `consoleLogRef`, `networkLogRef` 和 `traceRefs`。组件只显示 ref 和摘要，不接收也不保存 `data:image/...;base64,...`、完整 DOM 或完整日志。

## 交互语义
按钮只表达终端等价文本，例如 `/browser open ...`、`/browser snapshot ...` 和 `/browser takeover ...`。真实导航、截图、DOM/AX 抽取、console/network 读取、下载、上传、登录和人工接管由 TUI Host 解析文本后调用 `browser_runtime` 或确认流程。

## 安全边界
该组件可以展示 host 声明的 `previewUrl`，但这只是 presentation。跨域 DOM、console、network、截图和下载证据必须来自 TUI browser runtime 的 refs-first 输出。高风险动作必须先返回 approval request 或 terminal-equivalent confirmation text。

## 何时不要使用该组件
不要用它展示普通 Markdown 报告、workspace 文件编辑器、terminal session 或 verifier verdict。文件用 `workspace-file-viewer`，终端用 `terminal-session-viewer`，验证结论用 verifier/evidence 对应组件。

## 测试与发布
发布前保持 fixtures 与 manifest workbenchDemo 对齐，并运行 `npm --workspace @sciforge-ui/components run packages:check`、`npm run typecheck` 和 renderer 测试。
