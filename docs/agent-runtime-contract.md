# AgentRuntime 中性接口设计

本文记录 SciForge 的运行时中性接口设计。当前可执行 adapter 只有 **Codex** 和
**Claude Code**；旧 `sciforge` ID 仅用于读取和迁移历史数据。两者都接入同一个
`AgentRuntime` contract，Renderer 只消费中性线程、turn、event 和 capability。

> 说明：后文的 “SciForge Runtime 能力审计” 是删除 Kun/custom runtime 前留下的
> 历史设计输入，不表示当前安装包仍包含该 runtime。

## 设计目标

- Codex 和 Claude 共用同一条产品链路：Code、Write、连接手机和定时任务都通过
  AgentRuntimeHost 选择当前 runtime。
- 保留 runtime 差异：Codex 与 Claude Code 的 thread 物化、reasoning 可见性及
  approval/user input 支持情况必须如实暴露。
- 提升可诊断性：Codex backend 慢时，UI 能区分慢在启动、initialize、thread
  创建、首 token、模型响应或工具执行。
- 保持模块化：Codex app-server 细节继续集中在 `src/main/runtime/codex/`；
  SciForge Runtime HTTP/SSE 细节继续留在 SciForge Runtime adapter / mapper 内。

## Codexia 复用范围

本项目选择复用 `codexia` 的 **Codex app-server capsule + 通用事件总线思想**，
不搬迁其完整平台外壳。

复用范围：

- app-server stdio JSON-RPC client：request/response、pending map、initialize
  single-flight、stderr/closed/error 处理。
- server-originated JSON-RPC request：approval、file change approval、tool
  user input、elicitation 等请求暂存，然后用同一 request id 写回 response。
- raw app-server event normalizer：把 Codex 原生通知映射成中性
  `AgentRuntimeEvent`。
- reasoning 参数经验：在 `thread/start` config 和 `turn/start` params 中显式声明
  reasoning effort / summary / raw reasoning 可见性。
- EventSink 形状：runtime 只向一个中性 event sink 发布事件，sink 决定分发到
  IPC、SSE、测试 harness 或未来其他客户端。

不复用范围：

- 不搬 `codexia` 的 Tauri runtime、Axum REST/WS headless server、P2P/tunnel、
  automation 外壳或 Claude Code session UI。
- 不把 SciForge 变成“多 agent CLI 控制台”。未来需要多个 agent CLI 时，
  优先通过 A2A、MCP、外部 CLI bridge 或一个独立 runtime adapter 接入，而不是把
  每个 agent 的完整管理代码塞进核心产品。

因此中性接口的责任边界是：**本项目内部只抽象当前产品需要的 runtime 语义；多
agent 编排是边界外能力，可以通过协议接进来。**

## 已确认实现决策

- 优先级：先做 Codex approval / user input 双向交互，再做更大范围的中性
  event bus 收敛。这样先修真实阻塞点，再清理链路。
- 复制粒度：可以参考或复制 `codexia` 的协议形状和小段逻辑，但落地时改写成
  TypeScript / Electron 风格，不逐行翻译 Rust/Tauri 结构。
- Approval 默认行为：第一版所有 Codex command/file approval 都弹出中性审批卡片；
  未识别 request 一律 fail closed，并生成可见 recoverable error。
- User input UI：复用现有中性 user_input 卡片，不做 Codex 专用 UI。
- Reasoning 可见性：只显示 app-server 实际给出的 reasoning summary/trace/raw
  文本，不补写、不伪装 SciForge Runtime 式完整思考。
- 入口策略：renderer 专用 `codex:*` IPC 已删除；应用代码统一走中性
  `agentRuntime:*` IPC，不再保留 `runtimeRequest` / `startSse` / `stopSse`
  旁路。
- E2E 验收：Codex 和 Claude Code 都至少做一次真实 assistant 回复 smoke；recoverable
  error 作为单独错误路径验证，不替代正常路径。

## SciForge Runtime 当前能力审计

SciForge Runtime 已有 runtime event 很丰富，新的中性接口不能比它更薄：

- 生命周期：`thread_created`、`thread_updated`、`turn_started`、
  `turn_completed`、`turn_failed`、`turn_aborted`、`turn_steered`。
- 内容流：`item_created`、`item_updated`、`item_completed`、
  `assistant_text_delta`、`assistant_reasoning_delta`。
- 工具：`tool_call_started`、`tool_call_finished`、`tool_call_ready`、
  `tool_result_upload_wait`、`tool_storm_suppressed`、`tool_catalog_changed`。
- 交互：`approval_requested`、`approval_resolved`、`user_input_requested`、
  `user_input_resolved`。
- 面板数据：`compaction_started`、`compaction_completed`、`goal_updated`、
  `goal_cleared`、`todos_updated`、`todos_cleared`。
- 诊断：`pipeline_stage`、`usage`、`error`、`heartbeat`。

SciForge Runtime capability manifest 已覆盖 model、CLI、MCP、web、skills、subagents、
attachments、memory、runtime info 和 tool diagnostics。中性 capability 应吸收
这些字段，同时补上 Codex 所需的 transport、thread materialization、reasoning
visibility 和 latency metric 描述。

## 中性 Adapter 形状

```ts
type AgentRuntimeAdapter = {
  id: 'sciforge' | 'codex' | 'claude'
  transport: 'http_sse' | 'jsonrpc_stdio' | 'cli_process'
  subagents?: {
    spawn(context, input): Promise<AgentRuntimeSubagentResult>
    inspect(context, input): Promise<AgentRuntimeSubagentLiveness>
    message(context, input): Promise<AgentRuntimeSubagentMessageReceipt>
    cancel(context, input): Promise<void>
  }

  connect(context): Promise<void>
  capabilities(context): Promise<AgentRuntimeCapabilities>

  listThreads(context, input): Promise<AgentRuntimeThread[]>
  startThread(context, input): Promise<AgentRuntimeThread>
  readThread(context, input): Promise<AgentRuntimeThreadDetail>

  startTurn(context, input): Promise<AgentRuntimeTurnHandle>
  interruptTurn(context, input): Promise<void>
  steerTurn(context, input): Promise<void>
  renameThread(context, input): Promise<void>
  deleteThread(context, input): Promise<void>

  subscribeEvents(context, input): AsyncIterable<AgentRuntimeEvent>

  resolveApproval?(context, input): Promise<void>
  resolveUserInput?(context, input): Promise<void>
  compactThread?(context, input): Promise<void>
  forkThread?(context, input): Promise<AgentRuntimeThread>
  resumeSession?(context, input): Promise<AgentRuntimeSessionResumeHandle>
  updateThreadRelation?(context, input): Promise<void>
  usage(context, input): Promise<AgentRuntimeUsageResponse>
  auxiliary?(context, input): Promise<unknown>
}
```

可选能力如 `forkThread`、`resumeSession`、`compactThread`、
`updateThreadRelation`、attachments、memory、review、goals/todos 等不应变成
必填方法；由 capability 声明决定 UI 是否展示入口。`usage` 是必填方法，但
不支持时必须返回 `supported: false`。

## Domain execution Session 请求

Domain package 通过 Host 所有的 `DomainMainAgentExecutionHost` 进入同一条
runtime-neutral 执行链。需要在派发 turn 前持久化 Session 绑定的调用方使用
`prepareSession(request)`；Host 再把该请求映射到所选 adapter 的 canonical
`startThread`，不得为后台任务建立第二条 runtime 或 IPC 路径。

`DomainMainAgentExecutionSessionRequest.title` 是可选的人类可读 Session 标题。
它在 trim 后必须为单行、长度为 1–200，只能在 Host 新建 Session 时传给
adapter。继续已有 `runtimeId + threadId` 时，`title` 不得重命名、重绑定或
重新路由该 Session。标题不是身份、安全或恢复字段；路由、授权、持久恢复和
幂等仍只能使用 canonical runtime/thread/turn 与 client directive 标识。调用方
若从外部文本生成标题，必须先归一换行，并确保截断不会产生孤立 UTF-16
surrogate。

## 工作区文件引用契约

`AgentRuntimeTurnStartInput.fileReferences` 只携带工作区相对定位元数据：

```ts
type AgentRuntimeFileReference = {
  path: string
  relativePath: string
  name: string
  kind?: 'file' | 'directory' | 'image' | 'pdf' | 'text'
  mimeType?: string
}
```

`path` 和 `relativePath` 在 adapter 调用前必须由 `AgentRuntimeHost` 归一为同一个
安全的工作区相对路径。Host 必须拒绝绝对路径、越界路径和其他无法安全
归一的定位符，不得在归一过程中静默丢弃引用。

Composer 和 Host 不得为构造 turn 读取引用文件内容，也不得将文件或
目录内容嵌入 `text`。每个 runtime adapter 必须把每个已接受引用转换为
provider 能实际看到的定位信息：优先使用 provider 原生的文件输入；若
provider 没有普通文件或目录输入，则可发送只包含工作区相对路径与类型的
安全文本定位块，让 agent 通过工作区工具按需读取。引用不得被冒充为其他
协议对象（例如 app/plugin mention）。无法转换或材料化时必须返回可见错误，
不得忽略引用或回退到文件内容内联。

Codex app-server 的 stdio JSON-RPC 边界必须把所有出站字符串归一为合法
Unicode 标量序列，避免历史持久化数据中的孤立 UTF-16 surrogate 破坏整条
JSONL 请求。`turn/start` 的 provider acknowledgement 必须有界等待；超时后
该连接应被销毁，并把交付保持为可审计的 uncertain 状态，不得无限挂起或
在同一连接上盲目重发。

## 中性事件模型

Host 边界所有权出现前遗留的 artifact-only 记录只做有界材料化重试；
耗尽后必须写入与 delivered receipt 明确区分的持久 quarantine receipt 并
解除后续回合阻塞，不得静默丢弃或伪装成交付成功。

`AgentRuntimeEvent` 以 UI 语义为中心：

- `thread_lifecycle`
- `turn_lifecycle`
- `runtime_status`
- `user_message`
- `assistant_delta`
- `reasoning_delta`
- `item_snapshot`
- `tool_event`
- `approval_requested` / `approval_resolved`
- `user_input_requested` / `user_input_resolved`
- `compaction_event`
- `review_event`
- `goal_event`
- `todo_event`
- `child_event`
- `usage`
- `error`
- `heartbeat`

事件必须带 `threadId`、可选 `turnId`、可选 `itemId`、可选 `seq` 和
`createdAt`。SciForge Runtime 的 SSE event 与 Codex app-server raw event 都先在 main side
归一化成该事件，再进入 renderer。

`reasoning_delta` 必须声明 `visibility`，并可声明 `source`：

- `visibility = 'none'` 的内容不能进入可见 chat/process block。
- `source = 'model'` 表示 provider/runtime 明确暴露的模型 reasoning 或 thinking
  流，例如 SciForge Runtime 的 `assistant_reasoning_delta` 和 Claude Code SDK
  thinking content。
- `source = 'runtime_summary'` 表示 runtime/backend 提供的 summary，不承诺完整
  隐藏思考，例如 Codex app-server reasoning summary。
- Renderer 只展示这些显式字段，不补写、不推断隐藏 reasoning。

`child_event` 只作为实时刷新信号。Renderer 的 `ThreadEventSink.onChild` 不维护第二份
children 缓存；sidebar 收到信号后重新调用 runtime 的 children endpoint 或 adapter
canonical projection。所有 runtime child 必须归一到 `AgentRuntimeChild`，transcript
必须归一到 `AgentRuntimeChildTranscript`。raw provider 字段可以进入 `metadata`，
不能以 `child_id`、`thread_id` 等 alias 混入 canonical 顶层字段。

## Capability 关键字段

```ts
type AgentRuntimeCapabilities = {
  contractVersion: 1
  runtimeId: 'sciforge' | 'codex' | 'claude'
  transport: 'http_sse' | 'jsonrpc_stdio' | 'cli_process'
  events: {
    live: boolean
    replayable: boolean
    sequenced: boolean
    delivery: 'sse' | 'ipc' | 'async_iterable'
  }
  threadMaterialization: 'immediate' | 'after_first_user_message'
  latency: {
    phaseEvents: boolean
    firstTokenMetric: boolean
    turnDurationMetric: boolean
    supportedPhases?: Array<
      | 'process_start'
      | 'initialize_start'
      | 'initialize_done'
      | 'thread_start_done'
      | 'turn_start_sent'
      | 'first_delta'
      | 'turn_done'
      | 'tool_running'
    >
  }
  reasoning: {
    available: boolean
    streaming: boolean
    visibility: 'none' | 'summary' | 'trace' | 'full_runtime_text'
    source: 'model' | 'runtime_summary' | 'backend_redacted' | 'unknown'
  }
  model: {
    id?: string
    inputModalities: Array<'text' | 'image'>
    outputModalities: Array<'text' | 'image'>
    supportsToolCalling: boolean
    contextWindowTokens?: number
  }
  tools: {
    toolCalling: boolean
    commandExecution: CapabilityState
    fileChange: CapabilityState
    mcp: CapabilityState & { search?: CapabilityState; toolCount?: number }
    web: CapabilityState & { fetch?: CapabilityState; search?: CapabilityState }
    skills: CapabilityState
    subagents: CapabilityState & { maxParallel?: number }
    diagnostics: CapabilityState
  }
  controls: {
    interrupt: boolean
    steer: boolean
    approval: 'unsupported' | 'sync' | 'async' | 'fail_closed'
    userInput: 'unsupported' | 'sync' | 'async' | 'fail_closed'
    compact: 'unsupported' | 'native' | 'noop'
    fork: boolean
    review: boolean
    goals: boolean
    todos: boolean
    resumeSession: boolean
  }
  storage: {
    guiOwnedThreads: boolean
    backendThreadIdStable: boolean
    usage: boolean
    attachments: CapabilityState
    memory: CapabilityState
  }
}
```

`CapabilityState` 的共享形状是
`{ available: boolean; reason?: string; degraded?: boolean }`。默认 capability
只能把未实现功能声明为 unavailable，不能通过省略字段让 renderer 猜测为可用。

`tools.subagents.available` 表示当前 runtime 可以在统一 children/transcript UI 中展示
child/subagent 工作，并按 runtime 能力使用 multi-agent 链路。`maxParallel` 和
共享 agent capability settings 共同决定同时运行容量。父 turn 没有额外的 child-run 总量预算；完成一批
child 后可在同一 turn 继续委派。`AgentRuntimeHost` 是
`delegate_task`、`subagent_status`、`subagent_wait`、`subagent_send`、
`subagent_cancel`、`subagent_resume` 和 `subagent_delete` 的唯一工具所有者，并使用
`packages/workers/multi-agent` 保存和调度
child run。Codex、Claude Code 以及后续 runtime 适配器只实现统一的
`spawn/resume/inspect/message/cancel/delete` provider 契约；不得在 runtime 私有目录再注册另一套
delegation 工具或状态机。Provider 原生 child/workflow/subagent 事件仍可解析，但输出
必须归一为同一 `AgentRuntimeChild` 形状。

SciForge Runtime 初始值大致为：

- `transport = 'http_sse'`
- `threadMaterialization = 'immediate'`
- `reasoning.visibility = 'full_runtime_text'`
- approval/userInput 为可交互能力
- events 支持 live、replayable、sequenced

Codex 初始值大致为：

- `transport = 'jsonrpc_stdio'`
- `threadMaterialization = 'after_first_user_message'`
- `reasoning.visibility` 按 app-server 实际事件声明，不能承诺完整思考
- approval/userInput 通过 server request registry 暂存 app-server
  server-originated request，并在用户操作后用同一 JSON-RPC request id 回写；
  capability 声明为 `async`
- usage、attachments、memory、fork、resumeSession 初期不可用

## 模块化边界

Codex app-server 相关代码收拢成一个可独立更新的小胶囊：

```text
src/main/runtime/codex/app-server/
  protocol.ts
    app-server request/notification/response 的薄 TypeScript 类型。

  json-rpc-client.ts
    stdio JSON-RPC、pending client requests、server request dispatch、
    sendResponse(requestId, result)。

  server-requests.ts
    server-originated request -> 中性 approval/user-input/elicitation 语义。

  request-registry.ts
    pending approval/user-input 生命周期、超时、turn/thread 校验。

  event-normalizer.ts
    app-server notification -> AgentRuntimeEvent。

  reasoning-config.ts
    thread/start config 与 turn/start reasoning 参数生成。

  README.md
    记录来自 codexia 的参考点、更新步骤和边界约束。
```

允许依赖方向：

```text
CodexRuntimeService
  -> codex/app-server/*
  -> CodexThreadStore / CodexEventStore
  -> AgentRuntimeEvent sink

CodexAgentRuntimeAdapter
  -> CodexRuntimeService
  -> shared AgentRuntime contract

Renderer / AgentRuntimeHost / SciForge Runtime adapter
  不直接 import codex/app-server/*
```

这个边界保证 app-server 协议变化时，只需要更新 `codex/app-server/` 和少量
service glue，不会扩散到 SciForge Runtime、renderer 或后台任务代码。

## Codex 慢和 reasoning 不完整的处理

中性接口要新增 `runtime_status` 阶段事件：

- `process_start`
- `initialize_start`
- `initialize_done`
- `thread_start_done`
- `turn_start_sent`
- `first_delta`
- `turn_done`
- `tool_running`

这些事件记录 `latencyMs` 和必要的 debug metadata。UI 据此展示“正在启动
Codex”“等待模型首 token”“工具执行中”等状态，而不是只显示笼统的处理中。

reasoning 不能被补写或伪装。Codex normalizer 只把 app-server 实际发出的
reasoning text/summary delta 转成 `reasoning_delta`，并设置对应
`visibility`。如果 backend 没发完整 reasoning，UI 应显示 summary 或不显示，
同时 capability 里说明原因。

## 模块落点

```text
src/shared/agent-runtime-contract.ts
  中性 DTO、event、capability、result/failure 类型。

src/main/runtime/agent-runtime/
  adapter.ts
  host.ts
  event-bus.ts

src/main/runtime/local-runtime-agent-runtime-adapter.ts
  SciForge Runtime HTTP/SSE -> AgentRuntimeAdapter。

src/main/runtime/codex/codex-agent-runtime-adapter.ts
  Codex service -> AgentRuntimeAdapter。

src/main/runtime/codex/app-server/
  Codex app-server JSON-RPC、server request、event normalizer、reasoning config。

src/renderer/src/agent/agent-runtime-client.ts
  Renderer 只调用中性 preload IPC。

src/renderer/src/agent/agent-runtime-event-dispatcher.ts
  AgentRuntimeEvent -> ThreadEventSink / ChatBlock。
```

## 迁移步骤

1. 新增 `src/shared/agent-runtime-contract.ts`，先只定义类型和测试 fixture。
2. 为 SciForge Runtime 增加 main-side `local-runtime-agent-runtime-adapter`，复用现有 HTTP/SSE，
   并把 SciForge Runtime DTO 映射为中性 AgentRuntime，不移动 SciForge Runtime internals。
3. 从 `codexia` 复制并改写 Codex app-server capsule：JSON-RPC、
   sendResponse、server request normalizer、reasoning config、README。
4. 为 Codex 增加 `codex-agent-runtime-adapter`，复用 `CodexRuntimeService`、
   app-server capsule 和 GUI-owned store。
5. `AgentRuntimeHost` 统一暴露默认运行时与 Codex 的中性 request/event 路径。
6. Renderer 使用 `AgentRuntimeProvider` 作为唯一业务 provider；旧
   SciForge Runtime/Codex renderer provider 分叉已删除。
7. Codex 专用 renderer IPC 已删除，main-side Codex 模块化边界保留。

## 验收标准

- SciForge Runtime 和 Codex 都能通过同一个 renderer provider 创建 thread、发送消息、流式显示
  assistant 回复、停止 turn。
- SciForge Runtime reasoning 仍能完整显示；Codex reasoning 按 capability 诚实显示 summary /
  trace / none。
- Codex 慢时 UI 能显示阶段状态，并能记录 first token / turn duration 指标。
- Codex 空 thread / 未物化 thread 不再导致 GUI thread id 与 app-server thread id
  混淆。
- 连接手机、定时任务、Write 的运行时选择继续只依赖 active runtime，不写入错误
  runtime 的 thread mapping。
