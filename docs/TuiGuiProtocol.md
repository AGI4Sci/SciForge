# TUI / GUI 协议

最后更新：2026-06-01

## 结论

SciForge 不定义新的 TUI plugin/runtime 协议。最终协议只有两个方向：

> **GUI 给 TUI 的输入全部是文本；TUI 通过原生 tool/plugin/MCP 机制向 GUI 表达展示意图。**

Codex CLI / app-server 如何注册 tool、plugin、skill、MCP、slash command 和 custom model provider，全部使用 Codex 原生机制。SciForge 不定义 `registerCommand`、`registerTool`、`registerPolicy` 这类 host API，也不要求独立 AgentServer。

跨 GUI、skills、memory、capabilities、verifier、browser 和 actions 的通用模块边界见 [`Architecture.md`](Architecture.md#agent-host-semantic-pipeline)：canonical 函数是 `module.describe/query/read/invoke`。本文件中的 `gui.*` 是 GUI 模块的 host-specific adapter alias，用于说明当前 GUI-TUI 迁移语义；稳定范式中等价于 `module.*` 调用。

## 数据方向

```text
用户 -> GUI
  GUI 将手势、表单、文件和选择翻译成终端等价文本
  -> TUI stdin / chat input / 原生命令输入

GUI 内部状态
  DOM/local events -> 语义 GUI event bus -> 投影后的 GUI context
  -> 通过 compact context、gui.get_context 或只读 GUI resources 暴露

TUI agent
  解析文本、推理，并使用原生 skills/plugins/tools
  需要界面状态时读取 GUI resources
  通过注入的 gui.* tools 表达展示意图
  -> GUI 协商 placement、timing、conflict 和 rendering
```

## 唯一硬输入契约：GUI → TUI 是文本

GUI 所有输入都必须能还原成用户在终端里手敲的文本：

```text
普通输入          -> "请总结 artifacts/report.md 的证据强度"
删除按钮          -> "rm report.md"
重新运行按钮      -> "/rerun run-123"
带证据修复按钮    -> "/recover run-123 --with-evidence"
打开 artifact     -> "open artifacts/report.md"
能力偏好          -> "/capabilities plan --prefer literature.search pdf.extract"
选中对象后追问    -> "ask --ref artifacts/table.csv \"这些异常点是什么？\""
打开内置浏览器    -> "/browser open https://example.com"
请求浏览器截图    -> "/browser snapshot --tab current --screenshot --dom"
浏览器人工接管    -> "/browser takeover browser-session-1"
```

GUI 可以通过 stdio、pty、WebSocket、HTTP 或本地进程 API 把文本送给 TUI，但这些只是传输细节。SciForge 不把传输方法上升为业务协议。

## Built-in Browser 输入边界

`browser_runtime` 属于 TUI/Codex runtime capability，host-owned `BrowserHostSession` 是 live browser owner。GUI 可以展示 session/tabs/snapshot refs 和 Desktop Electron `WebContentsView` native surface，也可以把用户点击翻译成 `/browser ...` 文本命令；它不能自己选择 `playwright_browser_automation`、`playwright_edge_browser` 或其它 provider。

浏览器截图、DOM snapshot、console logs、network logs 和下载文件必须通过 refs 进入 GUI projection。GUI state 不保存 `data:image/...;base64,...`、完整 DOM 或完整日志。截图、PDF、document、proxy materialization、旧 frame 和旧 replay 只能是 evidence/artifact，不得作为 Browser pane 的第二套交互真相源或交互 fallback。`localhost:5173` / Web shell 只能验证 React UI、blocked/error/handoff 诊断和 toolbar 状态；真实网页打开、输入、focus、resize 和 navigation 必须在 Desktop Electron native host 中验证。`/frame` HTTP route 只作 evidence/manual inspection，不能接管 live view。登录、上传、下载、外部提交、授权、支付、删除、发送、写剪贴板和 visible takeover 都必须先由 TUI 发起 confirmation/handoff。

模块边界：`@sciforge-ui/runtime-contract/browser-runtime` 是 GUI/TUI 共享的纯契约；`packages/observe/web` 只拥有 TUI capability/provider wrapper；`packages/presentation/components/browser-workbench` 只拥有右侧 browser projection renderer。GUI app 不直接 import observe/web 的 browser runtime wrapper。

## Computer Use 输入边界

Computer Use 属于 TUI/Codex native action provider。GUI 可以把用户意图翻译成终端等价文本，例如：

```text
/computer-use observe --screen current
/computer-use run "在演示文稿里创建一页摘要并保存"
/computer-use replay computer-use:replay/bundle-123
```

这些文本只是用户输入，不是 GUI 调用 executor。正式执行路径必须是：

```text
GUI text
  -> Codex app-server production path
  -> Codex native Computer Use tool/plugin/MCP
  -> packages/actions/computer-use L1 resource adapter
  -> L0 capture/ground/execute/verify/trace handlers
  -> refs-first result / approval request / replay refs
  -> Agent Host
  -> module.invoke({ moduleId: 'gui', intent: 'present' | 'ask_user' | 'notify' | 'set_status' })
```

GUI 对 Computer Use / Window Action 的合法职责：

- 展示 WindowActionSession actor cursor overlay、proposal 状态、lease owner、before/after evidence refs、Image/Evidence refs 和 validator diagnostics。
- 收集 `needs-confirmation` 或 `approvalRequest` 的用户确认，并把确认结果作为文本发回 TUI。
- 聚焦已有 replay/artifact/ref，或显示缺失 renderer、缺失 evidence 的展示错误。
- 暴露只读 GUI resource，说明当前 replay viewer、selection 和 confirmation state。

GUI 禁止做的事：

- 直接调用 click/type/drag/scroll/hotkey/save/open-menu executor。
- 传入 executor lease、裸全局坐标、desktop bridge policy、provider route 或 scheduler 参数。
- 把 cursor move/point/annotate 当成真实 GUI mutating action。
- 把 placeholder viewer frame、旧截图、replay、GUI 私有状态或 shared system input trace 当成用户级完成证据，或把它们作为第二交互真相源 / 交互 fallback。
- import `packages/actions/computer-use`、`packages/observe/vision` provider implementation、`src/runtime/computer-use` bridge 或任何 desktop bridge implementation。

Actor cursor 是 presentation 和 collaboration state；真正改变桌面/窗口状态的动作必须由 TUI Host 通过 WindowActionSession 和 scoped scheduler lease 串行进入 executor adapter。agent 操作真实 app/window，不要求隔离虚拟屏幕；缺少独立 input adapter 时，只能生成 diagnostic/blocked/handoff 或 `shared-system-input` evidence，不能自动切到 replay/snapshot/shared system input 继续通过最终用户级验收。

`/computer-use` Workspace Gateway、AgentServer、runtime gateway、exec-MCP 和 `codex exec --json` 路径只能是 legacy/test-only/diagnostic adapter。它们可以帮助读取旧 trace、运行 fixture 或做迁移 smoke，但新增协议、按钮和 public surface 不能依赖这些路径作为产品 fallback。

## 右侧结果区 package renderer 边界

右侧结果区通过 UI manifest slot 选择 package renderer。`browser-workbench`、`image-evidence-viewer`、`terminal-session-viewer`、`workspace-file-viewer` 都属于 GUI presentation module：它们可以渲染 refs、owner-owned Browser surface、图片证据、buffer、tree、draft、selection 和 view-local event data，也可以提供终端等价文本建议；它们不得启动 provider、PTY/process、workspace write 或跨域读取。

TUI/Host 对这些 view-local event 的处理必须重新进入协议边界：浏览器动作用 `/browser ...` 或 BrowserHostSession/browser runtime intent，Window Action 动作进入 Computer Use scoped executor lease，终端输入进入 Host-owned terminal adapter，文件保存进入 workspace adapter。GUI 只显示 Host/TUI 返回的新 projection、refs、draft 状态或错误。Browser 不能用 iframe/proxy/snapshot/replay/旧 frame 建立第二个可交互真相源；Image/Evidence 不能被升级成交互 fallback。

## AnnotationSidebar 连续反馈输入

全局 `AnnotationSidebar` 是 GUI Shell input/presentation surface，不是独立聊天系统。顶部 `注释` 入口在工作台和非工作台页面都打开这个侧栏；旧的“点选对象后把注释讨论写入工作台主 composer”不再是协议路径。主 composer 继续处理执行、研究和普通对话。

侧栏输入仍复用主 conversation kernel 的 session、reference token、structured stream/event 和 GUI-TUI 对话能力。无副作用的整理、预览和保存反馈使用显式 `annotation-plan-only` envelope；低风险即时小改动使用独立 `annotation-quick-action` envelope，不能伪装成 plan-only。

```ts
type AnnotationPlanOnlyEnvelope = {
  schemaVersion: 'sciforge.annotation-plan-only-envelope.v1';
  kind: 'annotation-plan-only';
  source: 'annotation-plan';
  draftId: string;
  page: PageId;
  scenarioId: ScenarioInstanceId;
  sessionId: string;
  currentUrl: string;
  references: Array<{
    id: string;
    marker: string;
    kind: SciForgeReference['kind'];
    title: string;
    ref: string;
    targetSelector: string;
    selectedText?: string;
  }>;
  allowedOutputs: Array<'clarifying-question' | 'plan-summary' | 'feedback-draft' | 'acceptance-criteria'>;
  forbiddenSideEffects: Array<'workspace-write' | 'repair-start' | 'runtime-execution' | 'github-sync' | 'code-change'>;
  repairStartAllowed: false;
  runtimeExecutionAllowed: false;
  githubSyncAllowed: false;
  workspaceWriteAllowed: false;
};
```

`annotation-plan-only` projection 只能产出澄清问题、2-3 个选择项、摘要和 feedback draft。它不能启动 repair、修改文件、运行代码、提交 GitHub issue、改变 provider/tool route，或把隐藏 guidance 注入 Runtime Codex。用户可以跳过澄清直接保存。

实现边界必须是双层 fail-closed：`runPromptOrchestrator` 先识别 `turnMode: 'annotation-plan-only'` 或 structural envelope，在主 conversation kernel 内生成本地 plan draft event/message/run，并跳过 target lookup、context compaction、runtime transport 和 repair stage；如果该请求漏到 `sendSciForgeToolMessage`，transport 层必须直接拒绝，不能构造 Codex Runtime stream request。

`annotation-quick-action` 只允许单对象、局部、可解释、可回退的小范围 copy/style 类请求。它可以进入 Runtime Codex text-command path，但必须禁止 GitHub sync、repair handoff、commit、push、PR 和 merge；如果请求范围不清、跨对象、跨文件、需要外部同步或高风险写入，侧栏必须转入收件箱。

保存动作写入反馈收件箱的本地 `annotation-plan` record。record 应包含引用对象列表、原始描述、澄清问答摘要、action log、修改建议、验收标准、页面 URL/route、selector/DOM path、截图和 evidence refs。复杂 repair/code/GitHub sync 只能从反馈收件箱中的显式按钮和确认边界开始。

## GUI 内部语义事件总线

GUI 可以有自己的 internal event bus。它收集 DOM、鼠标、键盘、滚动、选择、modal、layout 等低级事件，但不把这些原样暴露给 TUI。

```ts
internalBus.emit('scrolled', { panel: 'results', offset: 1200 });
internalBus.emit('hover', { ref: 'cell-3-7' });
internalBus.emit('selection-changed', { refs: ['artifacts/report.md'] });
```

GUI projector 只把会影响 TUI 决策的语义变化投影出去：

```ts
guiSemanticBus.emit('hot-region-changed', { panel: 'results', selectedRefs: ['artifacts/report.md'] });
guiSemanticBus.emit('interaction-mode-changed', { mode: 'editing' });
guiSemanticBus.emit('modal-dismissed', { modalId: 'confirm-delete' });
```

判断“什么值得投影”属于 GUI presentation behavior。TUI 不轮询 DOM，也不订阅低级 UI 事件。

## Progressive GUI Context / 分级 GUI 上下文

TUI 不能看完整 GUI。GUI 应分级披露状态，默认只暴露 hot region。

```ts
type GuiContextLevel = 'shell' | 'hot-region' | 'region-detail' | 'debug';
```

### Level 0：shell

```ts
type GuiShellContext = {
  schemaVersion: 'sciforge.gui-context.v1';
  revision: number;
  focusedPanel: string;
  layoutMode: 'desktop' | 'tablet' | 'mobile';
  pendingModal?: { id: string; kind: 'confirmation' | 'input' };
  availableGuiTools: string[];
};
```

### Level 1：hot region

```ts
type GuiHotRegionContext = GuiShellContext & {
  hotRegion: {
    panel: string;
    viewId?: string;
    primaryRef?: string;
    selectedRefs: string[];
    interactionMode: 'idle' | 'reading' | 'editing' | 'selecting' | 'dragging' | 'modal';
    lastChangeOrigin: 'user' | 'agent' | 'system';
    lastChangeAt: string;
    availableActions: GuiAction[];
  };
};
```

### Level 2：按需 region detail

只有当 TUI 明确请求某个 region 时才返回：

```ts
type GuiRegionDetail = {
  regionId: string;
  viewId?: string;
  visibleRefs: string[];
  selectionSummary?: string;
  rendererState?: unknown;
  affordances: GuiAction[];
};
```

### Level 3：debug

Debug snapshot 只用于 audit/debug 视图，不应进入默认 agent context。

## Read-Only GUI Resource Tree / 只读 GUI 资源树

`gui.get_context` 是紧凑 API。需要更丰富的状态探测时，首选心智模型是只读虚拟资源树。TUI 像读取文件或 MCP resources 一样读取它：先 list，再 read 小节点，在限定 scope 内 search，只有需要时再请求 detail。

示例资源树：

```text
/gui/
  shell.json
  hot-region.json
  capabilities/
    presentation.json
  renderers/
    report-viewer.json
    evidence-matrix.json
  regions/
    results/
      summary.md
      refs.json
      actions.json
      viewport.json
    composer/
      summary.md
      draft.json
    annotation-sidebar/
      summary.md
      refs.json
      draft.json
      plan-only-state.json
  debug/
    dom-summary.json
```

稳定读取操作：

```ts
module.query({ moduleId: 'gui', scope: 'gui:/regions' })

module.read({
  ref: 'gui:/hot-region.json',
  maxBytes?: number
})

module.query({
  moduleId: 'gui',
  query: 'report.md',
  scope?: 'gui:/' | 'gui:/hot-region.json' | 'gui:/regions/results',
  kinds?: Array<'ref' | 'title' | 'visible-text' | 'action' | 'status'>
})

module.read({ ref: 'gui:/regions/results/summary.md', includeMeta: true })

module.invoke({
  moduleId: 'gui',
  intent: 'subscribe',
  input: {
    ref: 'gui:/hot-region.json',
    events?: Array<'changed' | 'removed' | 'permission-changed'>
  }
})
```

如果 host 支持 MCP resources、LSP-like resource providers 或原生 file/context API，这些操作应映射到原生机制。否则只能通过 adapter shim 作为只读 `gui.*` tools 暴露。无论采用哪种方式，它们都只是 GUI state read，不会修改 GUI state 或 workspace state。

Resource 内容必须是语义化、有边界、分级披露的：

- `/gui/shell.json` 给出 layout、focused panel、modal summary、revision 和 available GUI tools。
- `/gui/hot-region.json` 给出当前相关 panel、selected refs、interaction mode、last change origin 和 available actions。
- `/gui/capabilities/presentation.json` 给出 GUI 当前可用的展示组件目录。
- `/gui/renderers/<componentId>.json` 给出单个展示组件的可渲染 artifact 类型、预览类型、安全边界和给 TUI 的简短说明。
- `/gui/regions/<id>/summary.md` 给出该 region 的可读 visible state。
- `/gui/regions/<id>/refs.json` 给出该 region 中可见的 stable object refs。
- `/gui/regions/<id>/actions.json` 给出 text-command affordances。
- `/gui/regions/annotation-sidebar/*` 只披露侧栏的 visible state、引用对象、草稿摘要和 action log，不披露 raw DOM；复杂执行命令必须经过收件箱确认。
- `/gui/debug/*` 是 opt-in debug/audit material，不应注入默认 agent context。

`gui.search` 搜索的是这个语义投影，而不是 raw DOM。这样保留了 grep-like 的使用体验，同时避免 TUI 依赖 CSS selector、组件内部结构或隐藏页面结构。

## GUI 展示能力目录

`packages/presentation/components` 是 GUI 侧的展示能力目录。它只描述 GUI 能渲染什么，不描述 TUI 应该调用什么任务工具。TUI 通过只读资源发现这个目录：

```ts
type GuiPresentationCatalog = {
  schemaVersion: 'sciforge.gui-presentation-catalog.v1';
  source: 'packages/presentation/components';
  updatedAt: string;
  components: GuiPresentationComponentSummary[];
};

type GuiPresentationComponentSummary = {
  componentId: string;
  title: string;
  description?: string;
  acceptsArtifactTypes: string[];
  previewKinds: Array<'markdown' | 'table' | 'diff' | 'image' | 'json' | 'notebook' | 'custom'>;
  lifecycleLayer: 'presentation';
  safety?: {
    readsWorkspace?: boolean;
    writesWorkspace?: false;
    executesCode?: false;
    requiresConfirmation?: boolean;
  };
  agentSummary?: string;
};
```

单个 renderer 资源可以包含更详细的 props contract、空状态、推荐 artifact metadata 和 fallback renderer：

```ts
gui.read({ path: '/gui/renderers/report-viewer.json' })
```

发现规则：

- TUI 可以 `module.query({ moduleId: 'gui', scope: 'gui:/capabilities' })`、`module.read({ ref: 'gui:/capabilities/presentation.json' })` 或 `module.query({ moduleId: 'gui', scope: 'gui:/capabilities', query })`。迁移期 `gui.list/read/search` alias 只能在 adapter shim 中继续存在。
- TUI 不能 import React 组件，也不能把 GUI component 当成 task skill/tool。
- GUI 不能把展示组件注册成 TUI capability，也不能用组件目录做算法、provider 或 skill ranking。
- GUI 组件只通过 `gui.present`、右侧预览和 GUI-local renderer negotiation 发挥作用。
- 任务 skills/tools/plugins 仍由 Codex 原生目录发现；GUI 若要触发任务能力发现，只发送 `/capabilities search|expand|plan|explain` 文本。

## 状态感知规则

TUI 和 GUI 对彼此的感知是非对称的：

- GUI 通过 app-server rich-client event stream 感知 TUI/Core，并渲染 streamed agent events；legacy JSONL event stream 只用于 fixture/replay/test-only 兼容。
- TUI 通过 shell/hot-region context 加只读 resource operations 感知 GUI。
- GUI 只推送 semantic event bus 的语义变化；TUI 不轮询整页。
- TUI 只有在当前任务真正需要时才读取更深的 region detail。
- 任何用于 view-mutating intent 的 GUI state，都应配套 revision/precondition 检查。

这样 GUI state 足够支持正确控制，但又不完整到让 TUI 依赖 layout internals。

## Intent-Based GUI Tools / 基于意图的 GUI 工具

TUI 应表达意图，而不是远程命令布局。canonical surface 是：

```ts
module.invoke({
  moduleId: 'gui',
  intent: 'present' | 'ask_user' | 'notify' | 'set_status' | 'apply_batch' | 'subscribe',
  input: Record<string, unknown>
})

module.read({
  ref: 'gui:/...',
  includeMeta?: boolean
})

module.query({
  moduleId: 'gui',
  query?: string,
  scope?: string
})
```

迁移期或 host-specific tool surface 可以继续暴露：

```ts
type GuiTool =
  | gui.present
  | gui.ask_user
  | gui.notify
  | gui.set_status
  | gui.apply_batch
  | gui.get_context
  | gui.list
  | gui.read
  | gui.search
  | gui.stat
  | gui.watch;
```

`gui.list/read/search/stat/watch` 是只读 state operations 的 alias。`gui.present/ask_user/notify/set_status/apply_batch` 是 `module.invoke({ moduleId: 'gui', intent })` 的 alias。`gui.show_table` 或 `gui.show_artifact` 这类低层名称只能作为 host-specific alias 存在，稳定设计使用 intent。

## `gui.present`

展示或更新某个内容。GUI 负责选择 panel、renderer、queueing、focus 和 conflict behavior。

```ts
gui.present({
  intent:
    | 'show-result'
    | 'show-artifact'
    | 'show-diff'
    | 'show-debug'
    | 'show-progress-detail'
    | 'focus-existing';
  ref?: string;
  content?: { kind: 'markdown' | 'table' | 'diff' | 'image' | 'json'; value: unknown };
  title?: string;
  hint?: 'markdown' | 'table' | 'diff' | 'image' | 'notebook' | 'auto';
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  target?: { panel?: string; viewId?: string };
  precondition?: GuiPrecondition;
  actions?: GuiAction[];
})
```

示例：

```ts
gui.present({
  intent: 'show-result',
  ref: 'artifacts/report.md',
  hint: 'markdown',
  priority: 'normal'
})
```

```ts
gui.present({
  intent: 'show-diff',
  content: { kind: 'diff', value: diffText },
  precondition: { avoidIfUserEditing: true }
})
```

## 对象引用与右侧预览

消息、报告和工具结果中的对象引用应优先使用结构化 refs，而不是只把路径写成普通文本。支持的核心 ref 类型包括 artifact、file、folder、run、execution unit、URL 和 future GUI-local view refs。

显式引用示例：

```text
artifact:artifacts/report.md
file:workspace/results/table.csv
run:run-123
```

裸文件名也可以升级为对象引用，但必须先解析到当前 session 的真实 artifact 或 workspace file。例如 `arxiv_multi_agent_report_20260521.md` 只有在能匹配到现有 artifact/file 时，才渲染为可点击引用；否则仍保留为普通 inline code。

右侧预览规则：

- 点击可解析 object reference 时，GUI 聚焦右侧面板并选择合适 renderer。
- renderer 选择来自 `/gui/capabilities/presentation.json` 与 `/gui/renderers/<componentId>.json`，例如 Markdown 文件优先进入 report/markdown viewer。
- TUI 可以显式调用 `gui.present({ intent: 'focus-existing', ref, hint })`，也可以只提供结构化 refs，由 GUI 本地处理点击和焦点。
- 预览只改变 GUI view state，不读取或修改任务状态。预览失败不能被 GUI 当作任务失败；只能作为展示错误或缺失引用提示。

## `gui.ask_user`

请求确认或输入。用户响应必须作为文本发回 TUI。

```ts
gui.ask_user({
  kind: 'confirmation' | 'input' | 'choice';
  title: string;
  message?: string;
  precondition?: GuiPrecondition;
  submitCommandTemplate?: string;
  choices?: Array<{ label: string; commandText: string; style?: 'primary' | 'secondary' | 'danger' }>;
})
```

确认示例：

```ts
gui.ask_user({
  kind: 'confirmation',
  title: 'Delete report.md?',
  choices: [
    { label: 'Delete', commandText: '/approve approval-456', style: 'danger' },
    { label: 'Cancel', commandText: '/reject approval-456' }
  ]
})
```

## `gui.notify`

展示非阻塞通知。

```ts
gui.notify({
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
})
```

## `gui.set_status`

设置 shell 或 run status。这是 presentation state，不是 task truth。

```ts
gui.set_status({
  text: string;
  tone?: 'neutral' | 'running' | 'success' | 'warning' | 'error';
})
```

`gui.set_status` 只设置展示状态，不代表结果真伪。结果可信度必须通过独立的 `confidence` / `confidenceExplanation` 字段表达。

## Confidence / 置信度

`confidence` 属于 TUI/verifier/harness 输出。GUI 不计算、不补默认值、不从 stdout/stderr 或措辞中推断可信度。

推荐 payload：

```ts
type ResultConfidence = {
  confidence?: number; // 0..1；缺失表示未评分
  confidenceExplanation?: {
    evidenceLevel:
      | 'verified'
      | 'tool-backed'
      | 'reference-backed'
      | 'model-inference'
      | 'blocked'
      | 'no-result';
    sourceScore?: number;
    evidenceDefault?: number;
    evidenceCap?: number;
    penalties?: Array<{ reason: string; delta: number }>;
    summary: string;
  };
};
```

推荐公式：

```text
effectiveConfidence = clamp(min(sourceScore ?? evidenceDefault, evidenceCap) - sum(penalties), 0, 1)
```

证据等级建议：

| evidenceLevel | evidenceDefault | evidenceCap | 使用场景 |
|---|---:|---:|---|
| `verified` | 0.90 | 0.95 | verifier 通过、复现成功或有可审计输出 refs。 |
| `tool-backed` | 0.75 | 0.85 | 工具/provider 执行有 audit refs，但未完整复现。 |
| `reference-backed` | 0.65 | 0.75 | 文献、网页、文件引用支撑，但没有执行验证。 |
| `model-inference` | 0.45 | 0.55 | 主要来自模型推断或弱证据解释。 |
| `blocked` | 0.20 | 0.35 | 任务被阻断、验证失败、证据缺失或 claim 冲突。 |
| `no-result` | 0.00 | 0.00 | 没有结果，不应展示为可信结论。 |

常见扣分项：

- 缺少直接 evidence ref：`0.15`
- 来源过期或未验证：`0.10`
- verifier 失败：`0.25`
- partial/zero-result：`0.20`
- 关键 claim 冲突未解决：`0.20`

GUI 展示规则：

- `confidence` 缺失时不显示百分比，或显示“未评分”。
- `confidence` 为 `0` 时可以显示低可信，但必须有解释。
- 任何百分比都必须能追溯到 `confidenceExplanation` 或同等 verifier/harness 记录。
- claim-level confidence、run status 和 GUI status 是三个不同概念，不得互相替代。

## `gui.apply_batch`

把多个 presentation operations 作为事务应用。它只作用于 GUI view state，绝不作用于 workspace state。

```ts
gui.apply_batch({
  precondition?: GuiPrecondition;
  atomicity: 'all-or-nothing' | 'best-effort';
  ops: Array<
    | { tool: 'present'; args: Parameters<typeof gui.present>[0] }
    | { tool: 'notify'; args: Parameters<typeof gui.notify>[0] }
    | { tool: 'set_status'; args: Parameters<typeof gui.set_status>[0] }
  >;
})
```

当“关闭当前视图、打开 diff、聚焦 diff”这类操作不应部分应用时使用。

## `gui.get_context`

请求一个分级 GUI context snapshot。

```ts
gui.get_context({
  level: 'shell' | 'hot-region' | 'region-detail' | 'debug';
  regionId?: string;
})
```

默认 agent context 只应包含 shell + hot-region。Region detail 和 debug 都是按需读取。

小 snapshot 优先用 `gui.get_context`；当 TUI 想像文件系统一样探测 GUI state 时，优先用 `gui.list/read/search/stat/watch`。

## Preconditions / 前置条件

会改变视图或打断用户的调用应携带 preconditions。如果用户状态已经变化，GUI 可以拒绝或延迟执行。

```ts
type GuiPrecondition = {
  expectedRevision?: number;
  ifFocusedPanel?: string;
  ifSelectedRef?: string;
  avoidIfUserEditing?: boolean;
  avoidIfUserDragging?: boolean;
  requireNoModal?: boolean;
  maxSnapshotAgeMs?: number;
};
```

建议规则：

- `notify` 和 `set_status` 通常是安全的，一般不需要 precondition。
- `present` 会改变视图；当它目标指向 hot region 时应包含 preconditions。
- `ask_user` 和看起来具有破坏性的 batch changes 是 interruptive 的，应包含 preconditions。

## Tool Results and Negotiation / 工具结果与协商

GUI tool call 不是 fire-and-forget。GUI 必须返回 intent 是否已应用、是否延迟，或是否建议替代方案。

```ts
type GuiToolResult = {
  ok: boolean;
  appliedRevision?: number;
  placement?: { panel: string; viewId?: string };
  deferred?: boolean;
  reason?:
    | 'state-conflict'
    | 'user-editing'
    | 'user-dragging'
    | 'modal-open'
    | 'panel-occupied'
    | 'unsupported-renderer'
    | 'stale-precondition';
  currentRevision?: number;
  currentHotRegion?: GuiHotRegionContext['hotRegion'];
  suggestions?: GuiSuggestion[];
};

type GuiSuggestion =
  | { action: 'retry-with-context'; level: GuiContextLevel; regionId?: string }
  | { action: 'defer'; until: 'editing-complete' | 'modal-dismissed' | 'user-idle' }
  | { action: 'present'; target: { panel: 'new-tab' | 'side-panel' | string }; hint?: string }
  | { action: 'notify-only' };
```

这会把 GUI 控制变成协商，而不是盲目的远程控制。

## GUI Action

按钮和 affordances 仍然只包含文本命令：

```ts
type GuiAction = {
  label: string;
  commandText: string;
  style?: 'primary' | 'secondary' | 'danger';
};
```

用户点击后把 `commandText` 发回 TUI。GUI 不调用业务函数。

## GUI Presentation Autonomy / GUI 展示自治

GUI 可以包含确定性的 presentation logic，但这不会让它变成 task agent。

允许的 GUI logic：

- 为 `gui.present` 选择 renderer 和 placement。
- 保护正在 editing、selecting 或 dragging 的用户。
- 把 interruptive intent 排到已打开 modal 后面。
- 将低层 UI events 转成 semantic hot-region updates。
- 暴露有边界的 resource summaries 和 search indexes。
- 执行 GUI-local all-or-nothing batches。
- 当 intent 无法安全应用时返回 suggestions。

禁止的 GUI logic：

- 用 LLM 推断用户的任务目标。
- 决定应该运行哪个科学算法、provider、plugin 或 capability。
- 修复失败的 workspace execution。
- 判断 user-level task 是否完成。
- 读取 workspace 文件来选择业务下一步。
- 除了发回 TUI 的文本命令或显式 TUI-owned tools 之外，直接修改 workspace state。

一句话规则：GUI 对展示聪明，对任务无知。

## 禁止事项

- GUI 不定义 TUI plugin API。
- GUI 不注册算法、policy、provider、repair、capability ranking。
- GUI 不用 LLM 猜应该调用什么 GUI 函数；由 TUI agent 调 `gui.*` tools。
- GUI 不把低级 DOM 事件直接暴露给 TUI。
- GUI 不把 raw DOM 当作默认 agent context。
- GUI 不从 stdout/stderr/raw payload 判断任务完成态。
- GUI tools 只能做 presentation、confirmation、input、focus 和 GUI-local transaction。
- 任何真实任务操作都必须回到 TUI 文本命令或 TUI 原生 tools。
- `AnnotationSidebar` 可以发送 `annotation-plan-only` 整理/预览输入和低风险 `annotation-quick-action` 输入；不能把注释写入主 composer，不能触发 repair/GitHub/commit/push/PR/merge side effects。
- GUI 不直接调用飞书、微信、企业微信、CLI、SDK、AppleScript 或桌面自动化；这些都是 TUI 侧 external connector 能力。

## 外部软件连接器

第三方 app 接入沿用 TUI 资产模型，不扩展 GUI 协议。飞书 CLI、飞书 API、微信/企业微信 bridge 等能力通过 Codex 原生 tool / plugin / MCP / worker 暴露；repo 内 adapter 可放在 `packages/connectors`。

可插拔 channel plugin、`ChannelMessageEnvelope`、Web 聊天端投影和 Feishu CLI provider 的详细设计见 [`ChannelPluginArchitecture.md`](ChannelPluginArchitecture.md)。

通讯工具有两种入口形态，不能混为一谈：

- **输入型 intake**：外部消息、mention、群聊指令、webhook 或附件进入 connector 后，被规范化成 Agent Host 的输入 envelope，相当于 Web/GUI 输入栏提交了一条带 provenance 的用户消息。它可以直接进入 TUI thread/input queue，不需要 GUI 参与，也不需要先走 `gui.*`。
- **资源/动作型 connector**：Agent Host 主动搜索文档、读取聊天、起草回复、上传文件、发送消息或同步外部系统。读操作返回 refs；写、发送、删除、同步等外部副作用必须 draft / dry-run / approval。

输入型 intake 写入 Agent Host thread ledger 后，Web 聊天端必须渲染成普通用户消息 bubble，并带 channel badge、sender、source refs、attachments 和 delivery/audit 状态。GUI 不直接读飞书/微信 SDK 或 CLI；它只消费 thread events。

GUI 侧交互仍然只发送文本：

```text
/connectors feishu search-docs "实验记录"
/connectors feishu draft-message --to feishu:chat:xxx --from artifact:artifacts/report.md
/connectors wechat draft-message --to wechat:chat:xxx --text "请看这份报告"
```

外部通道触发 agent 时，推荐转换成同一类 input envelope，而不是模拟 GUI click：

```text
feishu mention "请根据这个 CSV 做质控报告"
  -> connector intake
  -> input: "请根据这个 CSV 做质控报告"
  -> refs: feishu:message:..., feishu:file:..., audit:...
  -> TUI Agent Host thread
```

TUI 调用 connector 后，应优先返回 refs-first 结果：`feishu:*`、`wechat:*`、`artifact:*`、`audit:*`。读操作可以映射为 MCP resources 或 `list/read/search/stat/watch` 风格资源；写、发送、删除、同步等外部副作用操作必须先 draft / dry-run，再通过 TUI approval、`gui.ask_user` 或外部通道中的明确用户确认收集确认，并携带 idempotency / audit refs。

## 适配策略

| Host | 适配方式 |
|---|---|
| Codex app-server | 首选原生后端。注入 `module.*` dynamic tools 或 MCP tools，消费 thread/turn/item/approval 富客户端事件流。 |
| Codex CLI / `codex exec --json` | Legacy/test-only 兼容和历史证据。不得作为产品默认 fallback；legacy host 需要时由 adapter shim 额外暴露 `gui.*` alias，并消费 JSONL event stream。 |
| `AgentCliAdapter` | 迁移抽象层。隔离 Codex 进程启动、profile、workspace、JSONL parsing、stderr audit 和 exit code handling。 |
| Claude Code stream-json | 可选兼容后端。通过 MCP 暴露 `module.*`，stdout NDJSON 映射为 SciForge event/trace，`control_request/control_response` 映射为 approval/input。 |
| Codex custom provider / proxy | 默认成本路径。Codex backend 使用 DeepSeek `deepseek-v4-flash` 或本地 provider proxy；SciForge 不直接维护第二个 agent backend。 |

AgentServer 不属于最终协议层。若当前实现仍存在 AgentServer adapter，它只是迁移期兼容层，目标是被 Codex app-server 取代；CLI bridge、exec-MCP 和 `codex exec --json` 只能作为 legacy/test-only adapter、fixture 或历史 evidence。新增协议和 adapter 不得继续扩展 AgentServer public surface。

## 最小实现

1. GUI 把用户输入和所有按钮都转成文本发给 TUI。
2. GUI 内部建立 semantic event bus 和 hot-region projector。
3. 把 shell、hot-region、region detail 和 debug material 暴露为只读 GUI resource tree。
4. 通过目标 TUI 的原生方式注入 `module.describe/query/read/invoke`；迁移期 legacy host 可通过 adapter shim 同时注入 `gui.present`、`gui.ask_user`、`gui.notify`、`gui.set_status`、`gui.apply_batch`、`gui.get_context` 和只读 `gui.list/read/search/stat/watch` alias。
5. GUI 直接连接 Codex backend；Codex 默认 model provider 走 DeepSeek `deepseek-v4-flash` 或用户配置的低成本 provider/proxy，OpenAI provider 仅在显式选择时使用。
6. TUI agent 先读 GUI resources/context，再调 `module.invoke({ moduleId: 'gui', intent })` 表达视图意图；legacy `gui.*` 调用由 shim 转发。
7. GUI 基于 revision、interaction mode、lastChangeOrigin 和 precondition 执行、延迟、拒绝或建议替代方案。
8. 算法、capability discovery、harness、provider 都留在 TUI 原生扩展生态。
9. 全局 `AnnotationSidebar` 复用主 conversation kernel：整理/预览走 `annotation-plan-only`，低风险小改动走 `annotation-quick-action`，复杂改动保存到反馈收件箱 `annotation-plan` record。
10. Web UI smoke 可以用 Codex in-app browser 覆盖工作台和至少一个非工作台页面；真实 Browser Pane、窗口捕获、全局 overlay 或 native input 的产品验收必须用 Desktop Electron native host。
