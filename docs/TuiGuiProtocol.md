# TUI / GUI Protocol

最后更新：2026-05-19

## 结论

SciForge 不定义新的 TUI plugin/runtime 协议。最终协议只有两个方向：

> **GUI 给 TUI 的输入全部是文本；TUI 通过原生 tool/plugin/MCP 机制向 GUI 表达展示意图。**

Codex CLI、Claude Code CLI 或其他终端 TUI host 如何注册 plugin、skill、tool、MCP、slash command，全部使用各自原生机制。SciForge 不定义 `registerCommand`、`registerTool`、`registerPolicy` 这类 host API，也不要求独立 AgentServer。

## 数据方向

```text
User -> GUI
  GUI translates gestures/forms/files/selections into terminal-equivalent text
  -> TUI stdin / chat input / native command input

GUI internal state
  DOM/local events -> semantic GUI event bus -> projected GUI context
  -> exposed as compact context, gui.get_context, or read-only GUI resources

TUI agent
  parses text, reasons, uses native skills/plugins/tools
  reads GUI resources when it needs state
  calls injected gui.* tools with presentation intents
  -> GUI negotiates placement, timing, conflicts and rendering
```

## 唯一硬输入契约：GUI → TUI 是文本

GUI 所有输入都必须能还原成用户在终端里手敲的文本：

```text
普通输入          -> "请总结 artifacts/report.md 的证据强度"
删除按钮          -> "rm report.md"
重新运行按钮      -> "/rerun run-123"
带证据修复按钮    -> "/recover run-123 --with-evidence"
打开 artifact     -> "open artifacts/report.md"
能力偏好          -> "/capabilities prefer literature.search pdf.extract"
选中对象后追问    -> "ask --ref artifacts/table.csv \"这些异常点是什么？\""
```

GUI 可以通过 stdio、pty、WebSocket、HTTP 或本地进程 API 把文本送给 TUI，但这些只是传输细节。SciForge 不把传输方法上升为业务协议。

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

## Progressive GUI Context

TUI 不能看完整 GUI。GUI 应分级披露状态，默认只暴露 hot region。

```ts
type GuiContextLevel = 'shell' | 'hot-region' | 'region-detail' | 'debug';
```

### Level 0: shell

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

### Level 1: hot region

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

### Level 2: requested region detail

Only returned when TUI explicitly asks for a region:

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

### Level 3: debug

Debug snapshots are for audit/debug views only. They should not enter default agent context.

## Read-Only GUI Resource Tree

`gui.get_context` is the compact API. For richer state inspection, the preferred mental model is a read-only virtual resource tree. TUI reads it the same way it reads files or MCP resources: list first, read the small node, search within a scope, then request details only when needed.

Example tree:

```text
/gui/
  shell.json
  hot-region.json
  regions/
    results/
      summary.md
      refs.json
      actions.json
      viewport.json
    composer/
      summary.md
      draft.json
  debug/
    dom-summary.json
```

Stable read operations:

```ts
gui.list({ path: '/gui/regions' })

gui.read({
  path: '/gui/hot-region.json',
  maxBytes?: number
})

gui.search({
  query: 'report.md',
  scope?: '/gui' | '/gui/hot-region.json' | '/gui/regions/results',
  kinds?: Array<'ref' | 'title' | 'visible-text' | 'action' | 'status'>
})

gui.stat({ path: '/gui/regions/results/summary.md' })

gui.watch({
  path: '/gui/hot-region.json',
  events?: Array<'changed' | 'removed' | 'permission-changed'>
})
```

If the host supports MCP resources, LSP-like resource providers, or a native file/context API, these operations should map to that native mechanism. If it does not, expose them as read-only `gui.*` tools. Either way, they are GUI state reads only; they never mutate GUI state or workspace state.

Resource content must be semantic, bounded and progressively disclosed:

- `/gui/shell.json` gives layout, focused panel, modal summary, revision and available GUI tools.
- `/gui/hot-region.json` gives the currently relevant panel, selected refs, interaction mode, last change origin and available actions.
- `/gui/regions/<id>/summary.md` gives human-readable visible state for that region.
- `/gui/regions/<id>/refs.json` gives stable object refs visible in that region.
- `/gui/regions/<id>/actions.json` gives text-command affordances.
- `/gui/debug/*` is opt-in debug/audit material and should not be injected into default agent context.

`gui.search` searches this semantic projection, not raw DOM. This keeps the “grep-like” ergonomics without coupling TUI to CSS selectors, component internals or hidden page structure.

## State Perception Rules

TUI and GUI perceive each other asymmetrically:

- GUI perceives TUI/Core through app-server or JSONL event streams and renders streamed agent events.
- TUI perceives GUI through shell/hot-region context plus read-only resource operations.
- GUI pushes only semantic changes from its event bus; TUI does not poll the whole page.
- TUI reads deeper region detail only when the current task actually needs it.
- Any GUI state used for a view-mutating intent should be paired with revision/precondition checks.

This makes GUI state available enough for correct control, but not so complete that the TUI starts depending on layout internals.

## Intent-Based GUI Tools

TUI should express intent, not remotely command layout. The primary tool surface is:

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

`gui.list/read/search/stat/watch` are read-only state operations. `gui.present/ask_user/notify/set_status/apply_batch` are intent operations. Lower-level names such as `gui.show_table` or `gui.show_artifact` can exist as host-specific aliases, but the stable design uses intent tools.

## `gui.present`

Display or update something. GUI chooses panel, renderer, queueing, focus and conflict behavior.

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

Examples:

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

## `gui.ask_user`

Ask for confirmation or input. User responses are sent back to TUI as text.

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

For confirmation:

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

Show a non-blocking notification.

```ts
gui.notify({
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
})
```

## `gui.set_status`

Set shell or run status. This is presentation state, not task truth.

```ts
gui.set_status({
  text: string;
  tone?: 'neutral' | 'running' | 'success' | 'warning' | 'error';
})
```

## `gui.apply_batch`

Apply multiple presentation operations as a transaction. This is only for GUI view state, never workspace state.

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

Use this when “close current view, open diff, focus diff” should not partially apply.

## `gui.get_context`

Request a progressive GUI context snapshot.

```ts
gui.get_context({
  level: 'shell' | 'hot-region' | 'region-detail' | 'debug';
  regionId?: string;
})
```

Default agent context should include shell + hot-region only. Region detail and debug are on-demand.

Prefer `gui.get_context` for small snapshots and `gui.list/read/search/stat/watch` when the TUI wants filesystem-like exploration of GUI state.

## Preconditions

View-mutating or interruptive calls should include preconditions. GUI may reject or defer if the user state changed.

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

Suggested rules:

- `notify` and `set_status` are safe and usually need no precondition.
- `present` is view-mutating and should include preconditions when targeting hot region.
- `ask_user` and destructive-looking batch changes are interruptive and should include preconditions.

## Tool Results and Negotiation

GUI tool calls are not fire-and-forget. GUI returns whether it applied the intent, deferred it, or suggests alternatives.

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

This turns GUI control into negotiation instead of blind remote control.

## GUI Action

Buttons and affordances still only contain text commands:

```ts
type GuiAction = {
  label: string;
  commandText: string;
  style?: 'primary' | 'secondary' | 'danger';
};
```

User clicks send `commandText` back to TUI. GUI does not call business functions.

## GUI Presentation Autonomy

GUI may contain deterministic presentation logic. This does not make it a task agent.

Allowed GUI logic:

- choose renderer and placement for `gui.present`;
- protect a user who is editing, selecting or dragging;
- queue an interruptive intent behind an open modal;
- convert low-level UI events into semantic hot-region updates;
- expose bounded resource summaries and search indexes;
- perform GUI-local all-or-nothing batches;
- return suggestions when an intent cannot be applied safely.

Forbidden GUI logic:

- infer the user's task goal with an LLM;
- decide which scientific algorithm, provider, plugin or capability should run;
- repair failed workspace execution;
- judge whether the user-level task is complete;
- read workspace files to choose business next steps;
- mutate workspace state except through text commands sent back to TUI or explicit TUI-owned tools.

The short rule is: GUI is smart about presentation, dumb about tasks.

## 禁止事项

- GUI 不定义 TUI plugin API。
- GUI 不注册算法、policy、provider、repair、capability ranking。
- GUI 不用 LLM 猜应该调用什么 GUI 函数；由 TUI agent 调 `gui.*` tools。
- GUI 不把低级 DOM 事件直接暴露给 TUI。
- GUI 不把 raw DOM 当作默认 agent context。
- GUI 不从 stdout/stderr/raw payload 判断任务完成态。
- GUI tools 只能做 presentation、confirmation、input、focus 和 GUI-local transaction。
- 任何真实任务操作都必须回到 TUI 文本命令或 TUI 原生 tools。

## 适配策略

| Host | 适配方式 |
|---|---|
| Codex CLI | GUI 连接 Codex CLI 终端进程；用 Codex 原生 plugin/skill/tool/MCP 机制声明 `gui.*` intent tools，并消费 app-server 或 JSONL event stream。 |
| Claude Code CLI | GUI 连接 Claude Code CLI 终端进程；用 Claude Code 原生 tool/MCP/skill 机制声明 `gui.*` intent tools，并消费其可用的结构化事件输出。 |
| 自研 TUI | 可以内部实现同名 tools，但不把内部 API 变成 SciForge 标准。 |

AgentServer 不属于最终协议层。若当前实现仍存在 AgentServer adapter，它只是迁移期兼容层，目标是被 Codex CLI / Claude Code CLI 进程连接取代。

## 最小实现

1. GUI 把用户输入和所有按钮都转成文本发给 TUI。
2. GUI 内部建立 semantic event bus 和 hot-region projector。
3. 把 shell、hot-region、region detail 和 debug material 暴露为只读 GUI resource tree。
4. 通过目标 TUI 的原生方式注入 `gui.present`、`gui.ask_user`、`gui.notify`、`gui.set_status`、`gui.apply_batch`、`gui.get_context` 和只读 `gui.list/read/search/stat/watch`。
5. GUI 直接连接 Codex CLI / Claude Code CLI 终端服务，不引入独立 AgentServer。
6. TUI agent 先读 GUI resources/context，再调 `gui.*` intent tools 表达视图意图。
7. GUI 基于 revision、interaction mode、lastChangeOrigin 和 precondition 执行、延迟、拒绝或建议替代方案。
8. 算法、capability discovery、harness、provider 都留在 TUI 原生扩展生态。
