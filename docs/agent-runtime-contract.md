# AgentRuntime 中性接口设计

SciForge 当前支持三个用户可选择的 Agent Runtime：**Codex**、**Claude
Code** 和 **DSH**（DeepSeek Harness，可独立配置，`dsh --profile acp`）。
三者接入同一个
`AgentRuntime` contract；Renderer 只消费中性
thread、turn、event、capability、discovery 和 recovery 结果，不直接调用 provider
专用执行链路。

历史上存在过的 `sciforge` runtime ID 已彻底移除：代码中不存在该 ID、适配器、HTTP/SSE 传输或可回退路径。
读取历史设置时，`sciforge` 等未知 runtime id 按历史迁移规则回退为 `codex`，不会恢复为可选择的 runtime。
任一 runtime 失败时，不得静默切换到另一个 runtime。

## 公共合同

权威共享类型位于：

- `src/shared/agent-runtime-contract.ts`
- `src/shared/sciforge-api.ts`
- `src/shared/runtime-error.ts`

`AgentRuntimeAdapter` 是 main process 的 provider-neutral 端口，定义于
`src/main/runtime/agent-runtime/adapter.ts`。`AgentRuntimeHost` 只负责 runtime 选择、
IPC 所需的中性调度和稳定错误边界，不包含 Codex、Claude 或 DSH 的命令、路径或协议分支。

Renderer 的权威端口是 `AgentProvider`，定义于
`src/renderer/src/agent/types.ts`。`AgentRuntimeProvider` 和 registry 实现该合同；
store、Workbench 与其他 UI 只能通过这个端口执行 probe、connect、thread、turn 和
control 操作。

新增或修改 Runtime 功能时，先扩展上述共享合同和 adapter，再分别在 Codex/Claude/DSH
adapter 中实现。第三方 runtime 可以拥有独立可发布包和命令配置，但必须接入同一中性合同。
不得新增并行的 provider 专用 preload、IPC、store 或 launcher
路径。

## Session admission 与持久化身份

生产 composition 将同一个已注册 adapter Map 传给 AgentRuntimeHost 和
RuntimeContextLedgerService。两者通过 `requireRegisteredRuntimeId` 校验 Session
身份，ledger 的保存、恢复和 evidence 来源校验也使用此集合；不得维护另一份 runtime
白名单。是否支持 admission 由注册决定，不借用其他 provider 的权限策略。

回合输出按“记录未验证输出 → 等待 required-output 观察器 → 标记验证完成”结算。
Worker 对失败、取消或无法解析的输出持久化本地错误并返回，允许 Host 完成结算；
本地失效状态或错误无法持久化时仍传播异常。失败输入继续遵守原有重试或显式放弃门禁。

Ledger 中的 `directives` 是持久化投递回执，用于去重、恢复、队列与历史展示；其累计
字节数不构成会话输入限额。开始新回合和中途追加消息都只投递当前输入，不把回执列表
重放给模型，尤其不能把排队、拒绝、放弃或结果不确定的输入变成新指令。
同一会话的连续性由 runtime 原生历史及现有压缩摘要维护。跨 runtime handoff 使用
结构化任务上下文和有界的原生会话摘录，不复制源会话的投递回执。

## Runtime 自动发现与恢复

Renderer 通过 `AgentProvider.probe()` 进入唯一的中性探测路径：

```text
Renderer AgentProvider.probe()
  -> AgentRuntimeProvider
  -> window.sciforge.agentRuntime.probe(runtimeId, command?)
  -> preload / IPC
  -> AgentRuntimeHost.probe(runtimeId, command?)
  -> selected adapter.probe(command?)
```

`AgentRuntimeDiscoveryResult` 包含 runtime ID、可用状态、规范化可执行路径、通用
来源分类、版本、稳定失败码和可选 `{ id, supported }` 协议能力。provider 专用协议
名称只能作为 adapter 返回的数据出现；shared contract 不定义 `appServerSupported`
一类 provider 专用字段。

不支持主动探测的 adapter 返回 `runtime_probe_unsupported`。Renderer 仍可沿同一
provider 合同尝试正常连接；其他不可用结果只阻断所选 runtime，不阻断 SciForge 或
另一个 runtime。

Codex 的探测顺序固定为：

1. 用户当前显式配置；
2. 当前进程 `PATH`；
3. 登录 Shell `PATH`；
4. 常见安装目录；
5. macOS `/Applications/ChatGPT.app` 与 `~/Applications/ChatGPT.app` 内置
   Codex；
6. Windows 已安装应用位置。

自动探测结果是易失运行状态，不写入 settings，也不修改系统 `PATH`。只有用户通过
本地程序选择器明确选择的路径可以持久化；connect/launch 前必须重新验证。仓库默认
配置和生成文件不得包含开发机绝对路径。

Windows `.cmd`/`.bat` shim 只能通过受控 `ComSpec`/`cmd.exe /d /s /c` 调用，必须
独立引用可执行路径并拒绝危险 shell 元字符；不得用 `shell: true` 拼接用户参数。

所有 probe、connect、selectThread 等异步结果必须同时受 request generation、
runtime identity 和 client/session identity 保护。迟到响应不得覆盖已切换 runtime、
新 command 或新 session 的状态。

## 错误和用户恢复

Main process 只返回稳定错误码、结构化字段及有界技术详情，不返回中英文 UI 文案。
普通提示、探测来源、按钮和安装指引统一由 Renderer 的 zh/en i18n 资源生成。

`ENOENT`、底层 spawn 文本和原始系统错误只允许出现在技术详情中。普通提示不得暴露
它们。认证失败、未发现、路径无效、不可执行、架构不兼容、版本/协议不支持、探测
失败和启动失败必须保持可区分的稳定错误类别。

恢复入口包括：

- 重新检测；
- 选择本地程序；
- 打开安装指引；
- 展开有界技术详情。

恢复操作由用户触发，不得自动安装、自动修改配置、自动重试有副作用的 turn，或静默
切换 runtime。

Codex 动态工具在派发前被 Principal 租约校验拒绝时，也必须上报无参数、无业务结果的
`executor_result` 失败事实。模型可见结果和执行治理均保留 `principal_changed`、
`authorization_changed`、`retryable: false` 及恢复指引，不能降为普通可重试错误。
账号和设备验证恢复后，由用户在原 conversation 发起新 turn 获取新租约；不得复活
旧 turn 的授权。若变更发生于写操作完成之后，保留 `outcome_unknown`，在新 turn
检查实际结果后再决定是否重试写入。

## Thread、turn 与事件

公共模型保持 provider-neutral：

- `AgentRuntimeThread` 表示 thread 身份、标题、更新时间、运行状态和关系；
- `AgentRuntimeTurn` 表示一次 turn 的状态与 items；
- `AgentRuntimeEvent` 是带单调 `seq` 的离散联合；
- capability 描述 control、tool、storage、context、memory 与 auxiliary 支持情况；
- tool artifact、workspace reference、usage、goal、todo 和 GUI plan 都通过共享结构跨
  边界。

Adapter 必须保留真实 provider 语义，不得把未知事件伪装成已支持能力，也不得让
Renderer 解析 Codex JSON-RPC、Claude CLI 或 DSH ACP 原始 payload。

## 模块边界

- Codex app-server、版本/协议探测、Windows shim 与启动逻辑：
  `src/main/runtime/codex/`
- Claude Code CLI 生命周期：`src/main/runtime/claude-code/`
- DSH ACP 协议引擎、部署闭包校验、release pin 与安全 patch：
  `packages/workers/dsh-runtime/`（`@sciforge/dsh-runtime`，唯一权威实现）；
  Host 侧工具归属、MCP session endpoint 与中性映射：
  `src/main/runtime/agent-runtime/dsh-agent-runtime-adapter.ts`
- Provider-neutral host 与 adapter：`src/main/runtime/agent-runtime/`
- 共享 IPC/错误/contract：`src/shared/`
- preload 转发：`src/preload/`
- Renderer provider 与事件映射：`src/renderer/src/agent/`
- Renderer 连接状态和竞态围栏：`src/renderer/src/store/`
- 用户恢复 UI 与 i18n：`src/renderer/src/components/`、
  `src/renderer/src/locales/{en,zh}/`

Main process 不得导入 Renderer；Renderer 不得导入 main process 私有实现；任一
provider 的细节不得进入另一个 provider 的 adapter。

## 验证要求

Runtime 修改至少验证：

1. provider-neutral host/adapter/preload/renderer focused tests；
2. Codex discovery、版本/协议、Windows shim 和安全参数测试；
3. probe/connect/runtime-switch/session 的迟到响应竞态测试；
4. zh/en 恢复 UI 与普通提示不暴露 `ENOENT` 的测试；
5. `npm run typecheck`、changed-file lint、architecture gate、`npm test` 和
   `npm run build`；
6. 支持打包工具时验证 packaged application 路径；真实 runtime 可用时分别验证正常
   assistant reply 和 recoverable error 路径。

测试、mock 和文档必须调用与生产相同的 provider-neutral 公共路径，不得保留旧
launcher、第二套 transport 或仅测试使用的兼容旁路。


### Runtime handoff and preview continuity

The trusted IPC boundary captures the submitting surface for both ordinary turns
and runtime handoffs. A handoff transfers that prepared binding to the newly
allocated target session before starting its turn. It does not recapture a later
window state; failed captures remain explicitly unavailable. The source transcript
and structured task ledger provide history, while the latest user request remains
the current instruction. Starting an independent chat does not import another
chat's history.

Retained chat components publish their actual DOM visibility at each surface
refresh. Hidden tabs cannot consume the context budget or advertise stale chat
state. Preview source reads use the canonical `workspace-preview.read-range`
capability: binary consumers request `{offset,length}`, while text consumers use
`{start:{line,column},maxCharacters}`. Text ranges return plain UTF-8 source with
one-based lines and UTF-16 columns matching `text.replaceRange`; `nextStart`
continues a bounded read. Each response is limited to 16,000 characters, with a
32 MiB source scan limit. Edits still use the observed resource revision through
the capability broker. Document contents and annotations remain task data.

DSH ACP tool results are persisted without destructive detail truncation. Bounded
history and live UI projections use the shared artifact-reference path, allowing
`sciforge_read_history` to recover complete results when necessary. The Model
Router preserves public reasoning in assistant history and progressively delivers
it on the direct Chat Completions stream; it never substitutes encrypted reasoning
state or generated explanations for provider-supplied process output.

### Model-visible result budgets and schema recovery

The common delivery layer uses a 4 KiB default and a 16 KiB hard ceiling.
A single requested operation descriptor with its complete schema may use the
larger budget atomically. Other large results are persisted once and projected;
transport adapters preserve the prepared payload without another truncation.
Compact operation catalogs prioritize references and titles before inline schemas.
If an index cannot fit, its continuation explicitly reports the source array
pointer, total count and next index. Absence from a partial index is not absence
from the capability catalog.

An omitted schema carries `schemaPointer`, an RFC 6901 path into the **original
stored result**, including escaped object keys. A preview's `items` wrapper does
not alter that source path. Combine the pointer with `_delivery.nextRead.arguments`
to read exactly the schema, without executing discovery again. Artifact reads
accept `maxBytes` (1024–16384; default 4096), accounting for JSON escaping and
metadata; continue with `nextOffset` only when the selected value still exceeds
that budget. No provider-specific or domain-specific budget path exists.

Normal turns retain their provider session: Codex maps the GUI thread to a native
thread ID, Claude Code resumes its stored SDK session ID, and DSH prompts its ACP
session ID and resumes it after reconnect when the provider advertises support.
Codex routing-alias recovery first resumes the same native thread with current
routing settings. It creates a replacement only when that session cannot be
restored. Explicit history replacement/fork and unavailable native storage are
not ordinary continuation. Reusing a session retains native context but does not
guarantee that a model will avoid redundant exploration; accurate tool delivery
and the common execution guidance remain necessary.

### Continuation summaries and execution guidance

A `compaction_event.summary` is a lifecycle display label. Only the optional
`contextSummary` is continuation content and may update a context ledger or
observational context state. Events without it preserve existing semantic context.
The Host never summarizes or automatically re-injects conversation history or
ledger summaries. Runtimes retain their own conversation, compaction and resume
state; the ledger remains available for observation and explicit cross-runtime
handoffs. Manual compaction is offered only when the adapter exposes a native
control. Lack of a control does not imply lack of native automatic compaction.
There is no Host compactor, fallback summary model request, or fallback threshold
configuration. Adapters expose only controls actually supported by their provider.

Automatic subagent context uses the shared `subagent-context.ts` projection for
every runtime with subagent support. Its complete UTF-8 packet is at most 4096
bytes, including JSON escaping and recovery instructions. It contains child IDs,
bounded labels, status, update times, and a short progress preview for live work.
Completed output, summaries, errors and transcripts remain in the canonical
multi-agent store and are read explicitly through `subagent_status` (with
`includeTranscript` when needed). Automatic injection never replays those results.
The index is rebuilt each turn without an "already delivered" cache, so native
compaction and process restart cannot remove the discovery path. If the index is
partial, recovery starts at the canonical list operation and follows its cursors;
the projection never forwards a cursor that would skip omitted records. This
input budget does not change provider compaction thresholds, summaries, histories,
or native control dispatch, and does not claim manual compact support for a runtime
that only compacts automatically.

Task execution guidance is authored once in `task-execution-guidance.ts`.
Codex installs it as developer instructions, Claude Code appends it to its
native SDK system preset, and the ACP adapter includes it in the prompt because
that protocol path has no equivalent system-instruction field. It applies to
parents and children without domain IDs, MIME-specific task rules or fixed
reading line counts. It covers batched independent actions, evidence-gap reads,
source/version reuse, output ownership, acceptance criteria, distinct visual
and programmatic validation, and completion without redundant verification.
The guidance does not add an autonomous scheduler, alternate history store, or
implicit authority to restart children or repeat external writes.

### Completion requirements and operation failures

Only the caller's typed execution intent (including explicit steering) establishes
completion requirements. Tool arguments and tool failures do not add requirements.
A visual lookup requesting region grounding does not implicitly require capture
or final inspection. Required visual receipt chains remain validated at completion;
ordinary commands and child observation cannot satisfy or erase those requirements.
Pending completion receipts are not an execution permission policy and cannot ban
independent work or propagate such a ban to sibling agents. Owned-surface access
policy and capability allowlists still apply before execution.

A terminal operation failure or exhausted resource retry budget produces scoped
recovery guidance without interrupting the parent task. The resource circuit stays
closed: another attempt without qualifying new evidence still triggers enforcement.
Independent operations and children can continue, and the runtime can report missing
required evidence. No tool name or visual error code grants a special exception.
