# SciForge Middle Pane 任务板

最后更新：2026-06-01

本文档从 [`PROJECT.md`](PROJECT.md) 拆出，单独维护 SciForge 中间聊天栏 / Cursor-like Agent chat / Process stream / Composer / Chat actions 的任务和验收规则。

## 当前目标

- 中间聊天栏必须对齐 Cursor Agent desktop app 的 chat center：顶部是 chat title/actions；主体按用户消息、assistant 过程聚合、最终回答、可点击对象引用呈现；底部是 composer、context/tools menu、model/mode、voice/send、local environment 和 context meter。
- 聊天中间栏只展示用户消息、assistant 进度句、`Worked for ...` / `Explored ...` 聚合项、动作行和最终回答；旧 SciForge summary、重复 transcript、不可交互过程块、prompt echo、provider/debug 文案和占位 progress 必须删除或折叠。
- SciForge 特有的 scientific artifacts、claims、skills、Computer Use、BrowserRuntime、feedback repair、verifier evidence 可以保留，但必须 refs-first、可折叠、可聚焦右侧对象，不能把中间栏变成日志 dump 或内部 trace viewer。

## 不可变规则

- 所有修改必须通用，不能为当前页面、截图、URL、文件名或历史 run 写硬编码补丁。
- 代码路径保持唯一真相源；旧逻辑和最终方案冲突时删除或迁移旧逻辑，不做长期并行实现。
- GUI -> TUI 只发送终端等价文本、focus/confirmation 结果或只读 projection；TUI -> GUI 只通过 declared GUI intents。
- 聊天栏不得决定 provider route、capability ranking、workspace 写入、Computer Use execution、verifier verdict 或 completion 判断；它只呈现 Agent Host semantic stream 和收集用户输入/确认。
- 大 payload、截图、录屏、terminal transcript、DOM snapshot、artifact、audit 和 replay 必须 refs-first；不得内联 raw screenshot/base64/provider payload/secret。
- 涉及 provider URL、API key、model name、Authorization、token、secret、password、credential 的日志和 evidence 必须脱敏；ignored local config 不得提交。
- 业务代码单文件超过约 2000 行时必须拆分或登记拆分任务。
- 已完成 TODO 需要打勾，并补充日期、evidence refs、验证命令和最终状态。

## 大文件拆分登记

> 本节用于满足“业务代码单文件超过约 2000 行时必须拆分或登记拆分任务”的不可变规则。登记不是验收豁免；后续触碰对应文件时应优先把新增逻辑迁出到已登记 owner，并保持当前 Middle Pane 行为和测试不回退。

| 文件 | 当前行数 evidence | 拆分边界 | 登记状态 |
| --- | ---: | --- | --- |
| `src/ui/src/app/chat/cursorAgentProcess.ts` | 1982（`wc -l src/ui/src/app/chat/cursorAgentProcess.ts`，2026-06-01），接近阈值；approval/verifier/repair classifier 与 GUI command extraction 已迁出到 helper | 下一次继续扩展 chat process 语义前先拆分 sanitizer、row projection、folding model、object-ref action mapping 和 hidden audit accounting，避免越过 2000 行。 | registered-watch |
| `src/ui/src/app/ResultsRenderer.tsx` | 760（`wc -l src/ui/src/app/ResultsRenderer.tsx`，2026-06-01） | right-pane focus route 与 Browser/Screen/Terminal/Files/References package adapters 已拆到 `src/ui/src/app/results/` typed helpers；聊天栏继续只传 `onObjectFocus(reference)`，后续新增 pane adapter 不回填到中栏。 | resolved-watch |
| `src/ui/src/app/chat/ChatComposer.tsx` | 362（`wc -l src/ui/src/app/chat/ChatComposer.tsx`，2026-06-01） | 后续新增 modes/models/skills/MCP/tool menu 时应继续拆到 `composerToolMenu.ts`、`composerAgentHostCatalog.ts`、context chips 和 command boundary helpers，避免把 Cursor-like composer 语义塞进单组件。 | registered-watch |
| `src/ui/src/api/sciforgeToolsClient/runtimeEvents.ts` | 1867（`wc -l src/ui/src/api/sciforgeToolsClient/runtimeEvents.ts`，2026-06-01） | runtime event normalization 已接近阈值；后续继续扩展 BrowserRuntime/Computer Use/provider event folding 前，应优先迁出 transport body classifier、public detail projection 和 native-event adapters。 | registered-watch |
| `src/ui/src/app/ChatPanel.tsx` | 1533（`wc -l src/ui/src/app/ChatPanel.tsx`，2026-06-01） | 本轮只接入 live stream event boundary；后续新增 run lifecycle、Stop/queue 或 composer orchestration 时继续下沉到 `chat/` helpers，避免把状态机和 presentation 继续堆进面板。 | registered-watch |

## 模块化设计原则

- 公共函数只有四个：`module.describe`、`module.query`、`module.read`、`module.invoke`。
- `describe/query/read` 必须只读；只有 `invoke` 可以有副作用。未声明 module function、intent、facet 或 ref prefix 必须 fail closed。
- `list/search` 收敛为 `query`，`stat` 收敛为 `read({ includeMeta: true })`，`watch/subscribe/present/ask_user/apply_batch` 收敛为具体 `invoke` intent。
- Agent Host 负责编排 semantic pipeline；模块不得直接 import 或调用其它模块；GUI 可以展示 pipeline trace，但不决定 pipeline。
- trace-first 是默认要求：跨模块组合必须记录 step id、moduleId、function、intent/query/ref、input/result summary、refs、approval、operation、timing、status 和 parent/child relation。

## 体验对齐原则

- 中间聊天栏体验对齐必须反复、深度使用 SciForge web 和 Cursor Agent desktop app 双端验证：每轮实现前观察 Cursor 的稳定聊天 workflow，每轮实现后在 SciForge 中跑同类真实对话/工具/引用/右栏聚焦流程，并把差异沉淀为通用规则和测试，不以一次性截图/坐标/会话作为结论。
- Chat body 的稳定层级是：用户消息 -> live progress sentence -> `Worked for ...` / `Explored ...` folded process -> assistant final prose -> concise result/object refs；不能把旧 summary、raw audit、prompt echo 或 duplicated transcript 与最终回答并列。
- 过程聚合必须是三层：group summary、action row、action detail。完成态默认折叠，running/blocked/needs approval 可展开；再展开才显示命令、输出摘要、diff、transcript 或 result refs。
- 可点击对象引用必须打开或聚焦右侧 Browser/Screen/Terminal/Files/References；把引用插回 composer 只能通过显式引用/上下文菜单完成。
- Chat header 必须支持 Cursor-like chat actions：Split Right、Split Down、Fork Chat、Copy Messages、Copy Request ID、Archive；SciForge 可保留 Run/Feedback/Repair 相关入口，但必须位于 actions menu 或对象 refs 上。
- Composer 必须支持 Cursor-like Add agents/context/tools menu：Plan、Ask、Debug、Multitask、Image、Models、Skills、MCP Servers；SciForge 的 scientific skills、pipeline skills、tool skills 和 references 归入该 menu / chips，不额外制造并列工具栏。
- Composer 底部必须展示 local environment 和 context meter；model/mode picker、voice、send/stop 状态要清晰。运行中追加指令排队，不把队列状态伪装成已执行回答。

## Cursor Agent 对照摘要

- 2026-06-01 只读观察 Cursor Agents 中间栏：顶部有 Chat title 和 Chat actions；actions menu 包含 Split Right、Split Down、Fork Chat、Copy Messages、Copy Request ID、Archive。
- 2026-06-01 只读观察 Cursor chat body：用户消息按轮次显示；assistant 过程以 `Worked for ...` 聚合按钮呈现；回答正文可含可点击文件/code refs；过程和最终回答不混成 raw log。
- 2026-06-01 只读观察 Cursor composer：输入框上方保留 slash/context chips；Add agents/context/tools menu 包含 Plan、Debug、Multitask、Ask、Image、Models、Skills、MCP Servers；model picker 显示 model + speed；右侧有 voice 和 send；底部显示 Local environment 与 Context percentage。
- 2026-06-01 只读复查 Cursor capability/catalog 边界：GUI 不直接做能力 ranking；能力查询应由 TUI/Agent Host 通过 `module.query/read` 或终端等价 `/capabilities search|plan` 返回，GUI 只展示目录、写入显式 directive 或 declared intent，不把 provider route/config 暴露进 composer。
- 2026-06-01 只读复查 Cursor model picker：model menu 含搜索框、Auto、MAX Mode、当前模型和多个公开模型名 + speed；这是 public model/mode intent surface，不展示 provider URL/API key/local config。
- 2026-06-01 只读观察 Cursor object refs：点击回答中的文件/code ref（例如项目文件名 chip）会聚焦右侧 editor/tab；聊天滚动位置和 composer draft 不被改写，引用不会隐式插回 composer。
- 2026-06-01 只读复查 Cursor object refs：完成态回答和过程上下文里的文件/code refs 仍以 button/chip 呈现，意图是聚焦右侧 editor/tab，而不是回填 composer；该行为抽象为 SciForge refs-first/right-pane focus contract。
- 2026-06-01 只读复查 Cursor process refs：过程层 `Worked for ...` 下的文件/代码 ref 仍是右侧 editor/tab focus affordance；terminal/diff/transcript 细节留在展开层，不自动抢占右侧 pane；该行为抽象为 SciForge clicked ref -> route-to-pane，composer 不隐式插入。
- 2026-06-01 深度复查 Cursor context inspector：点击 composer 底部 `Context 35%` 打开贴近输入框的只读浮层，包含 Context 标题、Close、`35% Full`、`~70.5K / 200K Tokens`、分段用量条和 System prompt / Tool definitions / Rules / Skills / MCP / Subagent definitions / Conversation 分类；Local environment 与 Context usage 是相邻但分离的底部状态。
- 2026-06-01 只读观察 Cursor chat title：顶部 `Chat title.` 是可聚焦/打开 thread/history 的 button；点击和双击没有进入内联编辑；左栏选中 thread 与 header 展示同一标题语义。
- 2026-06-01 只读观察 Cursor process/composer queue baseline：当前安全可观察状态没有 running turn；完成态 process 继续以 `Worked for ...` 折叠按钮展示，composer 空闲态显示 Add、model picker、voice、send 和底部 Local/Context，不显示 Stop/Queue。
- 2026-06-01 只读复查 Cursor live/process 信息层级：历史回答明确描述并呈现稳定顺序：运行中只显示自然语言进度句，transport/backend 生命周期文案被过滤；过程以 `Worked for ...` / `Explored ...` 聚合，最终回答不与过程日志并列。
- 2026-06-01 只读复查 Cursor action row 层级：完成态过程仍以 `Worked for ...` 折叠按钮呈现，回答中的文件/code refs 是可点击 button/chip；失败/过程诊断不与最终回答正文并列，稳定抽象为 group summary -> action row -> expandable detail。
- 2026-06-01 只读复查 Cursor long-process 层级：长过程保留 `Worked for ...` 聚合与关键 refs，动作细节继续藏在可展开层；更早动作/audit 只作为静音活动入口，不把中栏变成整页日志。
- 2026-06-01 只读复查 Cursor file/diff/terminal preview 层级：回答中的文件/code refs 保持 button/chip 语义并指向右侧 editor/tab；shell 命令与 diff 说明保留在中栏过程/正文层级，terminal transcript 不自动抢占右侧 pane。
- 2026-06-01 只读复查 Cursor failure/final answer 层级：失败态回答先给可读结论与下一步，traceback、transport、provider、stdout/stderr 和内部 refs 继续留在可展开诊断/过程层；主回答不承载 raw provider dump。
- 2026-06-01 只读复查 Cursor approval/verifier/repair 层级：当前安全可观察状态没有活跃 approval，但可见历史中的 `Worked for ...`、action row 和折叠详情稳定承载 approval/sub-agent/blocked 边界；需要确认/阻塞类状态应展开在过程层，最终回答不替代确认按钮或 raw 诊断。
- 2026-06-01 只读复查 Cursor result/file refs 层级：回答里的文件/code ref 继续以 button/chip 聚焦右侧 editor/tab；抽象到 SciForge 时，scientific artifact/claim evidence 也应是 refs-first result affordance，而不是把 artifact payload、表格、raw evidence 路径铺进主回答。
- 2026-06-01 Cursor Agent 多轮 Markdown/process baseline：真实多轮研究聊天中可见中文/英文混排最终回答、H2 标题、GFM 表格、嵌套列表、链接、数学符号和长段落自然换行；过程层以 `Explored ...` / `Worked for ...` 聚合搜索、读取、fetch、command 和 thought rows，raw stdout/stderr/provider/debug 文案不进入最终回答；screenshot evidence：`docs/test-artifacts/middle-chat-parity/cursor-agent-multiturn-markdown-baseline-2026-06-01.png`。
- 对照结论只沉淀稳定信息架构和交互规则；不得记录具体 prompt、个人账号、坐标、截图路径或本地绝对路径作为产品逻辑。
- 2026-06-01 SciForge web 对照验证：中栏 header/actions、Split Right/Down presentation-only preview、composer Add menu、Plan directive、Models menu、public model labels、context meter 和 provider/model/local-path redaction 已在 `http://localhost:5174/` 验证；screenshot evidence：`docs/test-artifacts/middle-pane-parity/2026-06-01-sciforge-middle-pane-verified.png`。
- 2026-06-01 SciForge web object-ref smoke：`http://localhost:5174/` 中栏/右栏可加载，References pane 保持 refs-first empty state，scoped leak check 不含 API key/Authorization/provider URL；当前 live 会话没有 clickable object refs，实际 click-to-right-pane 语义通过 DOM/route/UIAction focused tests 覆盖；screenshot evidence：`docs/test-artifacts/middle-pane-parity/2026-06-01-sciforge-object-ref-focus-smoke.png`。
- 2026-06-01 SciForge web context inspector：`Context` meter 已改为点击打开/关闭的只读 inspector，显示百分比、已用/总 tokens、用量条、公开用量分类和状态详情；Browser 发现并修复了 composer clipping，最终 popover 未被左右裁剪，scoped leak check 不含 provider/model/API/local path；screenshot evidence：`docs/test-artifacts/middle-pane-parity/2026-06-01-sciforge-context-inspector-fixed.png`。
- 2026-06-01 SciForge web context inspector Cursor categories：`http://localhost:5174/` 展开 composer 后点击 Context，inspector 暴露 Cursor-like usage rows（System prompt / Tool definitions / Rules / Skills / MCP / Subagent definitions / Conversation）、multi-segment usage bar、`data-context-retention=selected-objects-preserved`，Local environment 单独显示；scoped leak check 不含 provider/model/API/local path；screenshot evidence：`docs/test-artifacts/middle-pane-parity/2026-06-01-sciforge-context-inspector-cursor-categories-smoke.png`。
- 2026-06-01 SciForge web title/thread sync：`http://localhost:5174/` 中栏 header title 与左栏 active thread 同为当前 `session.title`，Browser DOM assertion `titleMatchesSidebar=true`；scoped leak check 不含 Authorization/API key/provider/model config/local path；screenshot evidence：`docs/test-artifacts/middle-pane-parity/2026-06-01-sciforge-title-sidebar-sync.png`。
- 2026-06-01 SciForge composer queue smoke：`http://localhost:5174/` 空闲 composer 展开后显示 Add menu、Send 和 context meter；不显示 Stop、Queue 或 queued status；scoped leak check 不含 Authorization/API key/provider/model config/local path；screenshot evidence：`docs/test-artifacts/middle-pane-parity/2026-06-01-sciforge-composer-queue-idle-smoke.png`。
- 2026-06-01 SciForge composer declared intent projection smoke：`http://localhost:5174/` model menu 在窄中栏内完整展开，公开 option ids 为 `auto/max/assistant-auto/assistant-fast/assistant-balanced/assistant-deep`；选择 public intent 后菜单关闭，scoped leak check 不含 Authorization/API key/provider URL/model config/local path；screenshot evidence：`docs/test-artifacts/middle-pane-parity/2026-06-01-sciforge-composer-declared-intent-projection-smoke.png`。
- 2026-06-01 SciForge composer declared intent ack live smoke：`http://localhost:5174/` 通过真实 composer 选择 `assistant-deep` 并发送轻量 prompt；`Worked for 15s · 3 actions` 展开后出现公开 message action `Shared Assistant Deep preference with Agent Host.`，停止请求后进入 cancelled/stop 路径；scoped leak check 不含 provider URL/API key/modelName/local path；screenshot evidence：`docs/test-artifacts/middle-pane-parity/2026-06-01-sciforge-composer-declared-intent-ack-live-smoke.png`。
- 2026-06-01 SciForge generic object-ref smoke：`http://localhost:5174/` 中栏、composer 和右侧 References/Results 正常加载；当前 live 会话没有过程 ref button（`refButtonCount=0`），未造假注入会话；scoped leak check 不含 Authorization/API key/provider URL/local path；screenshot evidence：`docs/test-artifacts/middle-pane-parity/2026-06-01-sciforge-generic-object-ref-smoke.png`。
- 2026-06-01 SciForge object-ref live run attempt：`http://localhost:5174/` 用真实 composer 发送只读文件阅读请求以尝试产生 process refs；本轮 Runtime Codex WebSocket error / Assistant connection needs setup，未产生 clickable refs（`refButtons=0`），因此不记为 live click-flow passed；scoped leak check 不含 API key/provider/model/local path；screenshot evidence：`docs/test-artifacts/middle-pane-parity/2026-06-01-sciforge-object-ref-live-run-websocket-blocked.png`。
- 2026-06-01 SciForge live-progress idle smoke：`http://localhost:5174/` reload 后中栏、composer、右侧 Results/References 正常加载；空闲态 `liveProgressCount=0`、`runningBadgeCount=0`，不误显示 running progress；scoped leak check 不含 Authorization/API key/provider URL/local path；screenshot evidence：`docs/test-artifacts/middle-pane-parity/2026-06-01-sciforge-live-progress-idle-smoke.png`。
- 2026-06-01 SciForge action-row contract smoke：`http://localhost:5174/` 中栏和 composer 可加载，右侧 References 空态正常，当前 live 会话没有 native process/action rows（`actionRowCount=0`），未注入假数据；尝试触发只读 live prompt 时 in-app Browser virtual clipboard 阻断输入，已清空 draft；scoped leak check 不含 Authorization/API key/provider URL/local path；screenshot evidence：`docs/test-artifacts/middle-pane-parity/2026-06-01-sciforge-action-row-contract-composer-open-smoke.png`。
- 2026-06-01 SciForge long-process fold idle smoke：`http://localhost:5174/` 中栏正常加载；当前真实 live 会话没有 native process/audit fold（`nativeEventStreamCount=0`、`auditFoldCount=0`），未注入假数据；scoped leak check 不含 Authorization/API key/provider URL/local path；screenshot evidence：`docs/test-artifacts/middle-pane-parity/2026-06-01-sciforge-long-process-fold-idle-smoke.png`。
- 2026-06-01 SciForge file/diff/terminal ref smoke：`http://localhost:5174/` reload 后中栏、composer 正常加载；当前真实 live 会话没有 action/ref/diff rows（`actionFocusCount=0`、`refButtonCount=0`、`diffBlockCount=0`），未注入假数据；右侧未被 terminal transcript 自动占用（`terminalPaneVisible=false`）；scoped leak check 不含 Authorization/API key/provider URL/local path；screenshot evidence：`docs/test-artifacts/middle-pane-parity/2026-06-01-sciforge-file-diff-terminal-ref-smoke.png`。
- 2026-06-01 SciForge approval/verifier/repair smoke：`http://localhost:5174/` 中栏和 composer 正常加载；当前真实 live 会话没有 approval/verifier/repair rows（`approvalActionCount=0`、`verifierActionCount=0`、`repairActionCount=0`），未注入假数据；visible text 未出现 internal channel/provider/runtime command 泄漏；screenshot evidence：`docs/test-artifacts/middle-pane-parity/2026-06-01-sciforge-approval-verifier-repair-smoke.png`。
- 2026-06-01 SciForge scientific artifact/claim refs smoke：`http://localhost:5174/` 中栏可加载；当前真实 live 会话没有 result/claim rows（`resultFoldCount=0`、`scientificClaimRowCount=0`），未注入假数据；scoped leak check 不含 provider/runtime command/`.sciforge` internal path；screenshot evidence：`docs/test-artifacts/middle-pane-parity/2026-06-01-sciforge-scientific-artifact-refs-smoke.png`。
- 2026-06-01 SciForge Markdown stress queued/failure live attempt：真实 composer 发送多轮 Markdown 压力任务并在 running 中追加 follow-up；预修复 evidence 显示 queued guidance 可见，但 process detail 暴露 `Phase/Status/Reason/Interaction`，用户原文中的 provider/model/stdout/stderr 被误脱敏，Runtime WebSocket failure raw 文案进入界面；screenshots：`docs/test-artifacts/middle-chat-parity/sciforge-markdown-stress-queued-2026-06-01.png`、`docs/test-artifacts/middle-chat-parity/sciforge-markdown-stress-websocket-failed-2026-06-01.png`。
- 2026-06-01 SciForge Markdown stress after-fix live verification：同一真实会话 reload 后保留用户原文，不再显示 `Phase/Status/Reason/Interaction`、raw WebSocket 文案或 `Action + prompt` live echo；失败态显示 `assistant connection was interrupted` 的用户可读恢复说明，queued guidance 仍作为用户消息/队列状态存在；screenshot evidence：`docs/test-artifacts/middle-chat-parity/sciforge-markdown-stress-after-fix-2026-06-01.png`。

## 当前任务板：Middle Pane / Chat Parity

### P0：聊天信息层级收敛

- [x] 建立独立 Middle Pane 计划，覆盖 chat header、message stream、process folding、composer 和 chat actions。
  完成：2026-06-01；evidence：`PROJECT_middle.md` 已从 `PROJECT.md` 拆出，聚焦中间聊天栏；验证：`git diff --check`；状态：passed。
- [x] 对照 Cursor Agent 中间聊天栏并抽象为通用 SciForge chat 行为。
  完成：2026-06-01；evidence：Computer Use 只读观察 Cursor Agents 的 Chat title/actions、`Worked for ...` 聚合、clickable refs、Add agents/context/tools menu、model picker、voice/send、Local environment、Context meter；验证：只读 UI 观察，无坐标/截图/历史会话硬编码；状态：documented。
- [ ] 建立反复、深度双端使用的 chat parity loop。
  验收：每个中间栏改动至少完成一轮 Cursor Agent baseline 观察、一轮 SciForge 同类真实 workflow 操作、一轮差异记录、一轮 focused test/visual check；覆盖 chat actions、message stream、process folding、composer tools/models/skills/MCP、refs 聚焦右栏、失败/approval/subagent；记录只保留通用行为和 evidence refs。
  状态：in_progress；evidence：2026-06-01 已完成 Cursor Agent 只读 baseline + SciForge Browser 同类交互验证 + focused tests；refs 聚焦右栏已完成 Cursor baseline、SciForge smoke、DOM/route/UIAction focused tests；失败 final answer 诊断下沉已完成 Cursor baseline、focused tests 和 SciForge smoke；approval/verifier/repair action-row contract 已完成 Cursor baseline、focused tests 和 SciForge smoke（当前真实会话没有活跃 approval/repair row，未注入假数据）；scientific artifact/claim refs-first summary 已完成 Cursor baseline、focused tests 和 SciForge smoke（当前真实会话没有 result/claim rows，未注入假数据）；composer model intent 已完成 Cursor baseline、Runtime projection policy、Browser projection smoke 和真实 composer ack live smoke；本轮补做 Cursor 多轮 Markdown/process baseline 与 SciForge Markdown stress queued/failure live loop，发现并通用修复 structured progress field leakage、用户消息误脱敏、runtime connection raw failure、live `Action + prompt` echo、unsafe Markdown link protocol 和 legitimate scientific `model` wording 被过度替换问题；仍需 runtime connection 恢复后补真实 live artifact/browser/screen/subagent refs 点击流，以及 approval/subagent/scientific artifact live workflow 后续轮次。
- [x] 当前 SciForge chat process 已有 Cursor-like folding 基线。
  完成：2026-05-31；evidence：`RunExecutionProcess.test.ts` 覆盖 native stream、`Worked for ...` / `Explored ...`、running terminal deltas、完成态 folding、动作行、命令输出、diff/file preview、approval/sub-agent、failed/cancelled terminal targets；验证：`node --import tsx --test src/ui/src/app/chat/RunExecutionProcess.test.ts src/ui/src/app/sciforgeApp/SciForgeWorkbench.test.ts src/ui/src/app/ResultsRenderer.test.ts`；状态：passed。

### P1：Chat Header / Actions

- [x] Chat title 和 actions menu 严格对齐 Cursor Agent。
  验收：chat title 可聚焦/选择当前 thread；actions menu 包含 Split Right、Split Down、Fork Chat、Copy Messages、Copy Request ID、Archive；每个动作有 typed effect、disabled state、shortcut label 和 audit boundary。
  完成：2026-06-01；evidence：`ChatPanelHeader.tsx` 使用 Cursor-like title/actions menu；`chatPanelActions.ts` 定义 typed effect/shortcut/command/audit boundary；Browser 验证 actions menu 顺序与 Split Right/Down；验证：`node --import tsx --test src/ui/src/app/chat/ChatPanelHeader.test.ts src/ui/src/app/chat/chatPanelActions.test.ts src/ui/src/app/ChatPanel.test.ts src/ui/src/app/uiActionBoundary.test.ts`；状态：passed。
- [x] Split / Fork / Archive 的 command boundary 明确。
  验收：Split Right/Down 和 Fork Chat 只改变 presentation 或创建 Agent Host thread intent；Archive 只发 terminal-equivalent command/declared invoke；Copy Messages/Request ID 不泄露 raw provider request、secret、local config 或 hidden audit。
  完成：2026-06-01；evidence：`ChatPanel.tsx` 的 Split Right/Down 为 `data-chat-split-layout` presentation-only preview；`sessionWorkspace.ts` 新增 `forkActiveSession` 保留 source 并创建 fork；Copy Messages/Request ID 走 `chatPanelActions.ts` redaction/public-id helpers；验证：Browser Split Right/Down passed，`node --import tsx --test src/ui/src/workspace/sessionWorkspace.test.ts src/ui/src/app/chat/chatPanelActions.test.ts src/ui/src/app/ChatPanel.test.ts` passed；状态：passed。
- [ ] Chat title 更新和 thread selection 与左栏同步。
  验收：标题、左栏 selected thread、URL/history state、right-pane focused object 不互相覆盖；archive/discard/restore 后中间栏有明确 empty/selected/restored state。
  状态：in_progress；evidence：Fork/Archive lifecycle helpers 已覆盖；Cursor baseline 证明 title button 不做内联编辑；SciForge `createOptimisticUserTurnSession` 现在用通用 first-user-turn 策略派生安全标题，清理 slash command、secret、本地路径和 URL；sidebar projection 测试证明左栏 selected thread 与中栏 header 使用同一 active `session.title`；Browser smoke 证明当前 live header title 与左栏 active thread 同步。URL/history state 与更多 restore/right-pane focus 交叉 workflow 仍需后续 live 验收。

### P1：Message Stream / Process Folding

- [ ] Live progress sentence 与 process groups 分离。
  验收：running 时顶部只显示一句自然语言进度；process group 使用 `Worked for ...` / `Explored ...`；完成后 progress sentence 不重复进入最终回答；transport/backend lifecycle placeholder 不可见。
  状态：in_progress；evidence：`cursorAgentProcess.ts` 已过滤 prompt echo、audit、raw_jsonl、stderr 和 runtime placeholder，并扩展通用用户指令 echo 识别，覆盖 `reply in ...`、`do not repeat/mention/include`、`no local paths`、中文“不要复述/提及/最终回答包含”等无真实工具证据的 prompt-like progress title；`LiveProgressSentence.tsx` 新增 `role=status` / `aria-live=polite` 的单句运行进度槽；`liveProgressSentenceFromStream` 优先使用结构化 progress title 或 Cursor-style process action，assistant draft 只显示 “Drafting the response.” / “正在整理回答。”，不把最终正文提前渲染到 running answer slot；transport/backend/provider/local path 文案 fail closed 为通用进度句；focused tests passed；Browser live markdown stress after-fix smoke 证明主栏不再出现 `Action + prompt` echo。真实 backend running success acceptance 仍需 runtime connection 恢复后补验。
- [ ] Action row kind/status 覆盖 Cursor Agent 常见动作。
  验收：read/search/fetch/shell_command/file_edit/write/diff/thought/approval/subagent/validate/artifact/message/folded/other 均有 icon/label/status/title/summary；running/completed/failed/blocked/cancelled 状态可读；failed 不把 traceback 刷进主回答。
  状态：in_progress；evidence：`RunningWorkProcess.tsx` 为每个 action row/summary 暴露 `data-action-kind`、`data-action-status` 和稳定 `aria-label`，completed/running/failed/blocked/cancelled 均可读；action icons 现在真实渲染，running dot 与 failed/blocked/cancelled 状态色可见；`cursorAgentProcess.ts` 支持显式 `operationKind` 映射 fetch/write/artifact/message 等通用语义，并让 folded placeholder 继承被折叠动作状态；`runtimeInteractionProgressPresentation` 现在把 guidance/approval/cancel/progress detail 投影为公开句子，不再把 `Phase/Status/Reason/Interaction/Cancellation` 作为 action detail；focused tests 覆盖 read/search/fetch/shell_command/file_edit/write/diff/thought/approval/subagent/validate/artifact/message/folded/other 与 running/completed/failed/blocked/cancelled，失败 traceback 不进入 summary；Browser live markdown stress 验证 queued guidance 不再暴露结构字段。真实 backend action-row refs workflow 仍需后续验收。
- [ ] Long process 压缩为 anchors + folded placeholder。
  验收：长任务保留首项、关键 action kinds 和尾部；中间折叠成 “more activity” / folded row；hiddenActionCount/hiddenAuditCount 有可展开入口但默认不占满聊天。
  状态：in_progress；evidence：`NativeEventStream` 的 `More activity` 现在是默认收起的 `<details>`，带 `data-guidance-count`、`data-hidden-action-count`、`data-hidden-audit-count` 稳定 contract；summary 只展示轻量计数，展开后只展示脱敏数量分类，不内联 raw audit/transcript；focused tests 证明长任务保留 search/read/write 等关键 anchors、尾部命令、folded placeholder，并且 `More activity` 默认不 open。当前 Browser smoke 的真实 live 会话没有长过程，仍需后续 backend long-run live 验收。
- [ ] Final answer 保持正文干净，诊断下沉。
  验收：final prose 不含 raw JSON、provider dump、traceback、execution audit、prompt assembly、local private path；诊断进入 More activity / audit fold；失败态给用户可理解结论和可执行恢复入口。
  状态：in_progress；evidence：Cursor baseline 确认失败/过程诊断不与最终回答正文并列；`finalMessagePresentation.ts` 现在优先识别失败 raw payload / traceback / execution diagnostic，把 provider URL、workspace credential、agentserver、stdout/stderr/trace/runtime refs、本地路径和 `.sciforge` 细节折入 audit fold；`compactFailureNotice` 对 runtime connection/WebSocket failure 输出通用 `assistant connection was interrupted` 恢复文案，主回答只保留 `The task did not finish` 与脱敏 `Next step`；成功 raw payload 即使带后续建议也继续提升 human answer，不误判失败；`FinalMessageContent` 保持 `.final-message-audit-fold` 默认收起且 object refs 可点击；focused tests passed；Browser live failure after-fix smoke passed（无 raw WebSocket / structured fields / provider debug）。真实 backend successful Markdown final acceptance 仍需 runtime connection 恢复后补验。

### P1：Object References / Right Pane Coordination

- [ ] 中间栏 refs-first 点击语义稳定。
  验收：文件、artifact、url、terminal transcript、browser、screen、subagent result refs 点击后只 focus right pane；不会插入 composer；copy/add-to-context 必须通过显式 menu/chip。
  状态：in_progress；evidence：Cursor file/code ref baseline confirmed click-to-right-pane/no composer insertion；SciForge `MessageContent.tsx`/`InlineObjectReferences` 继续只调用 `onObjectFocus(reference)`；`SciForgeWorkbench.tsx` 现在把 object focus 记录为 typed `select-object`/`inspect` UIAction 后聚焦 right pane；`workbenchObjectFocus.ts` 对 audit refs 做 local path/secret redaction；`cursorProcessObjectReferences.ts` 将 chat process refs 通用映射为 `file` / `artifact` / `url` / `execution-unit` / `run` / `scenario-package` ObjectReference，并把 `browser:`、`screen:`、`terminal-transcript:`、`execution-unit:`、`subagent:` 路由到 Browser/Screen/Terminal/References；`ResultsRenderer.tsx` 现在在收到 focused object 时复用 `focusResultPaneRouteForObjectReference` 自动切到对应 right-pane tab，初始 focused ref、后续点击和目标 tab 曾被关闭后的恢复同一路径，不只停留在 object banner；Screen pane payload adapter 迁到 `currentFrameRef`、`actorCursorRefs`、`annotationOverlayRefs`、`annotationProposalRefs`、`inputLeaseRef`、`actionAdapterRef`、`adapterReadinessRef`、`evidenceLedgerRef`、`verificationRefs` 等 package refs-first 字段，不再把 legacy `frameRefs` / `runSummary` / permission raw control fields 当 presentation 合同；unsafe provider URL、本地路径、trace/raw/stdout/stderr refs fail closed；focused tests、完整 right-pane regression 与 Browser smoke/attempt documented；仍需 runtime connection 恢复后补真实 live artifact/browser/screen/subagent refs 点击流。
- [ ] 文件和 diff 预览策略对齐 Cursor。
  验收：read/file refs 可点击打开右侧 Files；diff 优先在聊天动作行内展开，必要时可聚焦 right pane comparison/file view；shell transcript 不自动占用右 pane，除非用户点击 terminal ref。
  状态：in_progress；evidence：Cursor baseline 复查确认文件/code chip 指向右侧 editor/tab，shell/diff 留在中栏过程层级；`cursorProcessObjectReferences.ts` 现在把 `.diff/.patch` 和 `diff:` / `patch:` refs 归入 `workspace-diff-viewer` / compare-capable right-pane Files 路由；`RunningWorkProcess.tsx` 让 diff ref/file ref 只在动作详情中作为显式 `cursor-agent-ref-button` 出现，diff 正文继续内联在 `cursor-agent-diff`；shell/validate summary 不再把 terminal transcript 当默认 focus target，只有展开后的 terminal ref button 可聚焦 Terminal；focused tests passed；Browser smoke passed 但当前 live 会话没有真实 diff/terminal action rows，真实 backend diff/terminal click flow 仍需后续验收。
- [ ] SciForge scientific artifacts 保持可预览但不污染主回答。
  验收：artifact/claim/evidence refs 以 concise chips 或 result summary 出现；大型图像、表格、结构、报告都走 right pane/object renderer；主回答只做摘要和引用。
  状态：in_progress；evidence：Cursor baseline 确认文件/code refs 是 button/chip 并聚焦右侧，而不是把对象内容铺进回答；`RunKeyInfo` 现在只在折叠 Results 区展示 scientific artifact/claim 摘要，claim supporting/opposing/dependency refs 会转成安全 `artifact:` / `file:` evidence chips，点击只走 `onObjectFocus`；`.sciforge` delivery path、stderr/raw/provider refs 会在 RunKeyInfo DOM 中 fail closed；同一 artifact 先脱敏再 dedupe，避免 run objectRef + artifact delivery 双来源重复。focused tests 与 Browser smoke passed；真实 backend scientific artifact/claim click flow 仍需后续验收。

### P1：Composer / Context / Tools

- [ ] Composer tool menu 对齐 Cursor Agent。
  验收：Add agents/context/tools menu 支持 Plan、Ask、Debug、Multitask、Image、Models、Skills、MCP Servers；SciForge domain skills、pipeline skills、tool skills 和 connectors 从 Agent Host `module.query/read` 返回，只做 presentation selection。
  状态：in_progress；evidence：`composerToolMenu.ts` 已提供 Cursor-like menu taxonomy；`ChatComposer.tsx` 已把 Pick/Attach 合入 Add agents/context/tools menu，并支持 Plan/Debug/Multitask/Ask slash directive、Image/Attach file、Models menu open、Skills/MCP Servers directive；`composerAgentHostCatalog.ts` 现在从 session/run 的 `module.query` / `module.read` / capability discovery 只读结果抽取公开 skill/MCP/connector catalog，合并进同一个 Add menu，选择后仍只产生 `/skills ...` / `/mcp ...` directive；provider URL、token、本地路径和 raw schema fail closed。focused tests、typecheck 与 Browser Add menu smoke passed；当前真实 live session 没有动态 module catalog result，Agent Host live query/read catalog workflow 仍需后续验收。
- [ ] Model/mode picker 与 Agent Host provider boundary 对齐。
  验收：model picker 可显示 public model label/speed/capability tier；选择只发 declared intent，不直接写 provider config；不得展示 provider URL/API key/local config path；默认 fallback 必须可审计。
  状态：in_progress；evidence：`publicComposerModel` / `publicModelChoices` 仅显示 public label/speed；`composerModelSelectionIntents` 现在给 Auto、MAX、Assistant Auto/Fast/Balanced/Deep 输出稳定 public intent id、mode 和 capability tier；`ChatComposer` 点击模型项只回调 declared intent，`ChatPanel` 记录 `update-capability-preference` UIAction，不直接修改 provider/model config；`composerDeclaredIntentsForSession` 会从 UIAction audit log 提取最近一次 public model intent，并经 `runOrchestrator` / `SendAgentMessageInput.composerDeclaredIntents` 进入 Runtime Codex request 的 `auditMetadata.guiLocalProjection.composerDeclaredIntents`，不进入 `commandText`、顶层 request、provider route 或具体 model name；`sciforgeToolsClient` 再做一次 fail-closed sanitization，并在 Runtime bridge preflight 后发出脱敏 public projection receipt event；`cursorProcessActionSemantics.ts` 将 `composer_declared_intent_ack` / projection 等 backend ack 映射成 Cursor-like message action row；`uiActionBoundary` 会剔除 provider/model/baseUrl/API key 等配置字段；`app-04.css` 修复 model menu 在窄中栏中左侧裁剪和 label/speed 两列布局。focused tests、runtime policy tests、typecheck、Browser declared-intent projection smoke 与真实 composer ack live smoke passed；后续仍需由后端 Agent Host 发出原生语义 ack 的更完整长流程验收。
- [ ] Context meter 和 local environment 可解释。
  验收：底部显示 Local/remote environment、context percentage、workspace/context warning；点击 Context 打开只读 context inspector；超限/接近超限有清晰 warning，不自动丢失用户 references。
  状态：in_progress；evidence：Cursor baseline confirmed click-to-open Context usage preview with close, percent, token total, multi-segment bar and System prompt / Tool definitions / Rules / Skills / MCP / Subagent definitions / Conversation rows；`AgentContextWindowBreakdown` 与 runtime telemetry normalizers 支持通用 public category tokens；`ContextWindowMeter.tsx` 渲染 Cursor-like usage rows、segmented usage bar、`data-context-retention=selected-objects-preserved` 和 watch/near-limit/blocked/exceeded warning；`contextWindow.ts` 在无后端 breakdown 时把估算值收敛到 Conversation，不展示 provider/model/local path；`ChatComposer.tsx` 将底部 runtime row 明确标记为 Local environment，继续与 Context inspector 分离；focused tests、typecheck、Browser Cursor-category smoke passed；仍需后续真实 live near-limit/compaction warning workflow 验收。
- [ ] Running 中追加指令排队。
  验收：发送中 composer 显示 Stop/Queue；追加指令作为 queued guidance，不立即混入已完成回答；abort/stop 只发 Agent Host cancel intent 并呈现 cancelled state。
  状态：in_progress；evidence：Cursor baseline 观察到空闲 composer 不显示 Stop/Queue；`ChatComposer.tsx` 运行中保留 Stop/Queue，并新增 `queuedGuidanceCount` 可见状态（如 `2 queued`）和 `aria-live` status；`ChatPanel.tsx` 传入当前 guidance queue 数量；`sessionGuidanceQueue.ts` 现在把追加指令保留为用户原话，使用 `guidanceQueue` metadata/badge 表达 queued/merged/deferred/rejected，不把“运行中引导”前缀混进下一轮 prompt；`ChatPanel.tsx` 用户消息渲染不再走 assistant projection sanitizer，避免把用户原文里的 provider/model/stdout/stderr 改写；focused tests 覆盖 queue button/count、queued message、cancel rejects、failed defers、successful run only merges queued guidance；Browser live markdown stress 证明 queued follow-up 作为用户消息/队列状态存在且不污染 assistant action detail。仍需后续真实 successful running backend workflow 做 acceptance。

### P2：SciForge 特有功能保留

- [ ] Human approval / verifier / repair 在聊天中间栏以 Cursor-like action row 呈现。
  验收：needs-human、approval requested、verifier blocked、repair needed 都是 action row + clear buttons；用户点击 approval 才产生 confirmation intent；repair evidence refs 打开右侧 pane。
  状态：in_progress；evidence：Cursor baseline 只读复查确认 approval/sub-agent/blocked 等边界仍属于 `Worked for ...` 过程层而不是最终回答 raw dump；`cursorProcessActionSemantics.ts` 新增通用 semantic classifier，把 `needs-human` / `approval_requested` / `gui_ask_user` 映射为 approval，把 `needs-human-verification` / verifier blocked 映射为 verifier，把 `repair-needed` / acceptance repair 映射为 repair；`RunningWorkProcess.tsx` 在 action detail 渲染确认 choices，按钮只保存 terminal-equivalent commandText 到 click handler，不把 `/approve` / `/reject` 或 unsafe legacy command 暴露在 DOM 文本；`RuntimeGuiPanel.tsx` 把安全 `artifact::` / `file::` repair evidence refs 渲染为右栏 focus buttons，`.sciforge`、stdout/stderr、provider/internal refs fail closed；`cursorAgentProcess.ts` 仍为 1982 行，分类/command 抽到 helper，未越过 2000 行。focused tests 与 Browser smoke passed；真实 backend approval/verifier/repair live workflow 仍需后续验收。
- [ ] Computer Use / BrowserRuntime 活动只作为 observation/action refs 呈现。
  验收：Screen/Browser observation refs 可聚焦右侧；DOM/AX hints 不替代 executor lease、artifact validation 或 completion；中间栏不直接执行 UI action。
  状态：in_progress；evidence：`resultPaneContract.ts` 已有 VirtualAppScreen refs-first attach contract；`cursorProcessObjectReferences.ts` 将 `browser:*` / `browser-session:*` 映射到 Browser pane，将 `screen:*` / `virtual-app-screen:*` / `computer-use:*` 映射到 Screen pane，点击只产生 object focus，不在聊天栏执行 UI action；`ResultsRenderer.tsx` 已把这些 focused refs 自动路由到 Browser/Screen/Terminal/References 对应 pane，避免右栏停在旧 tab；`rightPaneVirtualScreenPayload` / `virtualScreenPayloadFromArtifact` 已迁移到 package-owned `currentFrameRef` / `frameStreamRef` / refs-first adapter，并把 legacy screen/cursor/lease/proposal/validation/sidecar refs 归入对应 package 字段；focused route tests、Screen focused tests、完整 right-pane regression 和 Browser Screen tab smoke passed；Browser 真实只读 run 尝试被 Runtime Codex WebSocket error 阻断，当前真实会话也没有 Screen frame refs，仍需真实 BrowserRuntime/Computer Use live refs 点击验收。
- [ ] Multi-agent / subagent 过程对齐 Cursor。
  验收：subagent start/result/failure 有折叠 row、agent id/title、parent relation、result refs；不展示 raw child transcript，除非用户展开或点击 transcript ref。
  状态：in_progress；evidence：`RunExecutionProcess.test.ts` 已覆盖 sub-agent lifecycle merge、transcript/result refs、unsafe trace folding；`cursorProcessObjectReferences.ts` 新增 `subagent:` / `agent-result:` / `agent-transcript:` right-pane References route；`ResultsRenderer` focused-ref routing 会将 `subagent:` / `agent-result:` / `agent-transcript:` 聚焦到 References/evidence pane；仍需真实 subagent live workflow 验收。

## 本轮验证记录

- [x] 2026-06-01 纯文档验证。
  evidence：`git diff --check` passed。
  验证命令：`git diff --check`。
  状态：passed。
- [x] 2026-06-01 Cursor Agent baseline 只读观察。
  evidence：Computer Use 观察 Cursor chat title/actions menu、`Worked for ...` process fold、Add agents/context/tools menu、model picker、voice/send、Local environment 与 Context meter；没有记录账号、坐标或会话硬编码。
  验证命令：N/A（只读 UI 观察）。
  状态：documented。
- [x] 2026-06-01 SciForge Browser 交互验收。
  evidence：`http://localhost:5174/`；Chat actions menu 顺序正确；Split Right/Down 切换 `data-chat-split-layout` 并出现 `Chat split preview`；Add menu 包含 Plan/Debug/Multitask/Ask/Image/Models/Skills/MCP Servers/Pick visible context/Attach file；Plan 写入 `/plan` 且菜单收起；Models 打开 public model menu；中栏/composer scoped leak check 不含 raw backend/model/url/local path；screenshot：`docs/test-artifacts/middle-pane-parity/2026-06-01-sciforge-middle-pane-verified.png`。
  验证命令：Browser/Playwright locator click + DOM assertions。
  状态：passed；备注：Copy Messages 纯函数和 UI action 已通过单测，in-app Browser 剪贴板权限会拦截 `navigator.clipboard` / `execCommand`，页面按失败路径提示。
- [x] 2026-06-01 Middle Pane focused tests。
  evidence：150/150 passing。
  验证命令：`node --import tsx --test src/ui/src/app/chat/RunExecutionProcess.test.ts src/ui/src/app/chat/runStatusPresentation.test.ts src/ui/src/app/chat/finalMessagePresentation.test.tsx src/ui/src/app/chat/MessageContent.test.tsx src/ui/src/app/chat/ChatComposer.test.tsx src/ui/src/app/chat/ChatPanelHeader.test.ts src/ui/src/app/chat/chatPanelActions.test.ts src/ui/src/app/chat/composerToolMenu.test.ts src/ui/src/app/ChatPanel.test.ts src/ui/src/workspace/sessionWorkspace.test.ts src/ui/src/app/uiActionBoundary.test.ts`。
  状态：passed。
- [x] 2026-06-01 Object ref / right-pane focused tests。
  evidence：25/25 passing；object focus typed UIAction、audit ref redaction、message object refs、right-pane contract 和 Workbench no-composer-insertion source guard 均通过。
  验证命令：`node --import tsx --test src/ui/src/app/sciforgeApp/workbenchObjectFocus.test.ts src/ui/src/app/sciforgeApp/SciForgeWorkbench.test.ts src/ui/src/app/chat/MessageContent.test.tsx src/ui/src/app/results/resultPaneContract.test.ts`。
  状态：passed。
- [x] 2026-06-01 ResultsRenderer object ref scoped tests。
  evidence：6/6 passing；References tab、object action helper、object reference focus route、selection UserActionApi、URL open/copy commands 和 route helper 均通过。
  验证命令：`node --import tsx --test --test-name-pattern "object reference|references tab|result pane route" src/ui/src/app/ResultsRenderer.test.ts src/ui/src/app/results/resultPaneContract.test.ts`。
  状态：passed。
- [x] 2026-06-01 SciForge Browser object-ref smoke。
  evidence：`http://localhost:5174/`；中栏和右侧 References pane 加载成功；References pane 显示 refs-first empty state；scoped leak check 未发现 API key、Authorization、provider URL；当前 live session 没有 clickable object refs，未污染会话造假；screenshot：`docs/test-artifacts/middle-pane-parity/2026-06-01-sciforge-object-ref-focus-smoke.png`。
  验证命令：Browser DOM assertions + screenshot。
  状态：passed-smoke。
- [x] 2026-06-01 Context inspector focused tests。
  evidence：34/34 passing；Context meter inspector markup、公开 usage rows、provider/model/local path redaction、composer Add menu 和 context compaction model 均通过。
  验证命令：`node --import tsx --test src/ui/src/app/chat/ContextWindowMeter.test.tsx src/ui/src/app/chat/ChatComposer.test.tsx src/ui/src/app/ChatPanel.test.ts src/ui/src/contextCompaction.test.ts`。
  状态：passed。
- [x] 2026-06-01 SciForge Browser context inspector 验收。
  evidence：`http://localhost:5174/`；展开 composer 后点击 Context meter 打开只读 dialog；Close 按钮可关闭；显示 `0% Full`、`2 / 200k Tokens`、Conversation、Status/Used/Remaining/Compaction；popover 左右未被 chat panel 裁剪；scoped leak check 未发现 provider/model/API/local path；screenshot：`docs/test-artifacts/middle-pane-parity/2026-06-01-sciforge-context-inspector-fixed.png`。
  验证命令：Browser locator click + DOM/layout assertions + screenshot。
  状态：passed。
- [x] 2026-06-01 Context inspector Cursor-category focused tests。
  evidence：54/54 passing；Runtime context telemetry 可归一化 public category breakdown；Context meter inspector 渲染 Cursor-like usage rows、segmented bar、selected-object retention marker 和 near-limit warning；Local environment 与 Context inspector 在 composer 中分离；ChatPanel 既有 provider/model/local path redaction 未回退。
  验证命令：`node --import tsx --test src/ui/src/app/chat/ContextWindowMeter.test.tsx src/ui/src/contextCompaction.test.ts src/ui/src/app/chat/ChatComposer.test.tsx src/ui/src/api/sciforgeToolsClient/runtimeEvents.test.ts src/ui/src/app/ChatPanel.test.ts`。
  状态：passed。
- [x] 2026-06-01 SciForge Browser context inspector Cursor-category smoke。
  evidence：`http://localhost:5174/`；展开 composer 后打开 Context inspector，DOM assertions：`contextMeterOpen=true`、`usageLabels=[System prompt,Tool definitions,Rules,Skills,MCP,Subagent definitions,Conversation]`、`contextRetention=selected-objects-preserved`、`localEnvironmentCount=1`、`popoverWithinChat=true`、`leakCount=0`；screenshot：`docs/test-artifacts/middle-pane-parity/2026-06-01-sciforge-context-inspector-cursor-categories-smoke.png`。
  验证命令：Browser reload + composer expand + context summary click + DOM assertions + screenshot。
  状态：passed-smoke。
- [x] 2026-06-01 Chat title / sidebar sync focused tests。
  evidence：88/88 passing；first-turn title derivation 不覆盖已有用户 thread；上传后首个 prompt 可更新标题；title source 清理 slash command、secret、本地路径、URL 和 provider/model config；sidebar selected thread 与 active session title 同步；header 继续不展示 provider/model/profile。
  验证命令：`node --import tsx --test src/ui/src/app/chat/sessionTransforms.test.ts src/ui/src/app/appShell/ShellPanels.sidebarModel.test.ts src/ui/src/app/chat/ChatPanelHeader.test.ts src/ui/src/app/ChatPanel.test.ts src/ui/src/workspace/sessionWorkspace.test.ts`。
  状态：passed。
- [x] 2026-06-01 SciForge Browser title/thread sync 验收。
  evidence：`http://localhost:5174/`；header title 与左栏 active thread 同步，DOM assertion `titleMatchesSidebar=true`；右栏仍为 refs-first References empty state；scoped leak check 未发现 Authorization/API key/provider/model config/local path；screenshot：`docs/test-artifacts/middle-pane-parity/2026-06-01-sciforge-title-sidebar-sync.png`。
  验证命令：Browser DOM assertions + screenshot。
  状态：passed-smoke。
- [x] 2026-06-01 Running queue focused tests。
  evidence：53/53 passing；composer 运行态可呈现 Stop/Queue 与 queued count；queued guidance 作为用户原话保存，状态走 metadata/badge；cancel/reject、failed defer、success merge 和 explicit refs preservation 均通过。
  验证命令：`node --import tsx --test src/ui/src/app/chat/ChatComposer.test.tsx src/ui/src/app/chat/sessionTransforms.test.ts src/ui/src/app/ChatPanel.test.ts`。
  状态：passed。
- [x] 2026-06-01 SciForge Browser composer queue idle smoke。
  evidence：`http://localhost:5174/`；空闲 composer 展开后 `idleQueueStatusCount=0`、`hasStopInIdle=false`、`hasQueueButtonInIdle=false`、`hasSendInIdle=true`、`hasAddMenu=true`；scoped leak check 未发现 Authorization/API key/provider/model config/local path；screenshot：`docs/test-artifacts/middle-pane-parity/2026-06-01-sciforge-composer-queue-idle-smoke.png`。
  验证命令：Browser DOM assertions + screenshot。
  状态：passed-smoke；备注：本轮未触发真实 backend generation 来造 running 状态，running queue 的执行语义由 focused tests 覆盖，live running acceptance 留到后续专门轮次。
- [x] 2026-06-01 Generic process object-ref focused tests。
  evidence：82/82 passing；chat process refs beyond files（`browser:`、`screen:`、`terminal-transcript:`、`execution-unit:`、`subagent:`、`run:`）映射为 typed ObjectReference；native stream ref list 渲染为 `cursor-agent-ref-button` 而不是 inert `<code>`；right-pane route `composerInsertion=false`；unsafe provider URL、本地路径、trace/raw/stdout/stderr refs fail closed。
  验证命令：`node --import tsx --test src/ui/src/app/chat/RunExecutionProcess.test.ts src/ui/src/app/results/resultPaneContract.test.ts src/ui/src/app/chat/MessageContent.test.tsx src/ui/src/app/sciforgeApp/workbenchObjectFocus.test.ts src/ui/src/app/sciforgeApp/SciForgeWorkbench.test.ts`。
  状态：passed。
- [x] 2026-06-01 Focused object refs route right pane tab tests。
  evidence：10/10 passing；focused chat object refs 会把 `browser:` 路由到 Browser、`screen:` 到 Screen、`terminal-transcript:` 到 Terminal、`subagent:` 到 References/evidence；目标 right-pane tab 曾被关闭时会恢复匹配 pane；object focus 仍只记录 typed `select-object`/`inspect` UIAction，不产生 composer insertion；Virtual Screen empty state 文案同步为当前 refs-first package copy。
  验证命令：`node --import tsx --test --test-name-pattern "focused chat object refs|focused refs reopen|result pane route|tool tabs render|right-pane references tab|object reference" src/ui/src/app/ResultsRenderer.test.ts src/ui/src/app/results/resultPaneContract.test.ts src/ui/src/app/sciforgeApp/workbenchObjectFocus.test.ts src/ui/src/app/sciforgeApp/SciForgeWorkbench.test.ts`。
  状态：passed。
- [x] 2026-06-01 SciForge Browser generic object-ref smoke。
  evidence：`http://localhost:5174/`；中栏、composer、右侧 References/Results 正常加载；当前 live 会话没有过程 ref button（`refButtonCount=0`），未注入假数据；scoped leak check 未发现 Authorization/API key/provider URL/local path；screenshot：`docs/test-artifacts/middle-pane-parity/2026-06-01-sciforge-generic-object-ref-smoke.png`。
  验证命令：Browser DOM assertions + screenshot。
  状态：passed-smoke；备注：本轮通用映射已由 focused tests 覆盖，真实 artifact/browser/screen/subagent live click flow 仍保留为后续验收项。
- [x] 2026-06-01 SciForge Browser object-ref live run attempt。
  evidence：`http://localhost:5174/`；真实 composer 发送只读文件阅读请求后，页面返回 `Runtime Codex WebSocket error` / `Assistant connection needs setup`，未产生 clickable refs（`refButtons=0`）；scoped leak check 未发现 API key/provider/model/local path；screenshot：`docs/test-artifacts/middle-pane-parity/2026-06-01-sciforge-object-ref-live-run-websocket-blocked.png`。
  验证命令：Browser composer typing + send + wait for process refs + DOM assertions + screenshot。
  状态：blocked-smoke-runtime-connection；备注：该项不是 live click-flow 验收通过；runtime connection 恢复后需要重跑真实 artifact/browser/screen/subagent refs 点击流。
- [x] 2026-06-01 Live progress sentence focused tests。
  evidence：87/87 passing；`LiveProgressSentence` 渲染为单个 aria-live status line；running shell/read 进度来自 Cursor-style process action；structured progress 使用 progress title，不把 reading/next details 升到主回答；assistant draft/final prose 不进入 running answer slot；transport/backend/provider/local path 文案不会外露；recorded process 与 final answer 顺序不回退。
  验证命令：`node --import tsx --test src/ui/src/app/chat/LiveProgressSentence.test.tsx src/ui/src/app/chat/runStatusPresentation.test.ts src/ui/src/app/chat/RunExecutionProcess.test.ts src/ui/src/app/ChatPanel.test.ts`。
  状态：passed。
- [x] 2026-06-01 SciForge Browser live-progress idle smoke。
  evidence：`http://localhost:5174/` reload 后 `hasChatPanel=true`、`hasComposer=true`、`liveProgressCount=0`、`runningBadgeCount=0`；空闲态不误显示 running progress；scoped leak check 未发现 Authorization/API key/provider URL/local path；screenshot：`docs/test-artifacts/middle-pane-parity/2026-06-01-sciforge-live-progress-idle-smoke.png`。
  验证命令：Browser reload + DOM assertions + screenshot。
  状态：passed-smoke；备注：本轮未触发真实 backend generation，running live acceptance 留到后续专门轮次。
- [x] 2026-06-01 Action row kind/status focused tests。
  evidence：117/117 passing；native stream action rows 覆盖 read/search/fetch/shell_command/file_edit/write/diff/thought/approval/subagent/validate/artifact/message/folded/other，状态覆盖 running/completed/failed/blocked/cancelled；row/summary 均有 stable `data-action-kind` / `data-action-status` / `aria-label`；folded placeholder 继承隐藏动作聚合状态；failed traceback 不进入 action summary；final answer diagnostics 继续折叠。
  验证命令：`node --import tsx --test src/ui/src/app/chat/RunExecutionProcess.test.ts src/ui/src/app/chat/runStatusPresentation.test.ts src/ui/src/app/chat/finalMessagePresentation.test.tsx src/ui/src/app/chat/MessageContent.test.tsx src/ui/src/app/chat/ChatComposer.test.tsx src/ui/src/app/chat/LiveProgressSentence.test.tsx`。
  状态：passed。
- [x] 2026-06-01 SciForge Browser action-row contract smoke。
  evidence：`http://localhost:5174/`；中栏、展开 composer 和右侧 References pane 正常加载；当前真实 live 会话没有 native process/action row（`actionRowCount=0`、`nativeEventStreamCount=0`），未注入假数据；尝试用 Browser 触发只读 live prompt 时 virtual clipboard/input bridge 阻断，已清空 draft（`draftLength=0`）；scoped leak check 未发现 Authorization/API key/provider URL/local path；screenshot：`docs/test-artifacts/middle-pane-parity/2026-06-01-sciforge-action-row-contract-composer-open-smoke.png`。
  验证命令：Browser DOM assertions + screenshot。
  状态：passed-smoke；备注：真实 backend action-row workflow 仍需后续专门验收，当前通用 contract 由 focused tests 覆盖。
- [x] 2026-06-01 Long process fold focused tests。
  evidence：117/117 passing；长 native stream 保留 search/read/write anchors、尾部命令和 folded placeholder；`More activity` 渲染为默认收起的 details，带 hidden action/audit count data contract；raw transport/audit 文案仍被过滤。
  验证命令：`node --import tsx --test src/ui/src/app/chat/RunExecutionProcess.test.ts src/ui/src/app/chat/runStatusPresentation.test.ts src/ui/src/app/chat/finalMessagePresentation.test.tsx src/ui/src/app/chat/MessageContent.test.tsx src/ui/src/app/chat/ChatComposer.test.tsx src/ui/src/app/chat/LiveProgressSentence.test.tsx`。
  状态：passed。
- [x] 2026-06-01 SciForge Browser long-process fold idle smoke。
  evidence：`http://localhost:5174/`；中栏正常加载；当前真实 live 会话没有 native process/audit fold（`nativeEventStreamCount=0`、`auditFoldCount=0`），未注入假数据；scoped leak check 未发现 Authorization/API key/provider URL/local path；screenshot：`docs/test-artifacts/middle-pane-parity/2026-06-01-sciforge-long-process-fold-idle-smoke.png`。
  验证命令：Browser DOM assertions + screenshot。
  状态：passed-smoke；备注：backend long-run live acceptance 仍保留为后续验收项。
- [x] 2026-06-01 File/diff/terminal ref focused tests。
  evidence：125/125 passing；`.diff/.patch`、`diff:` / `patch:` refs 解析为 `workspace-diff-viewer` / Files route，`composerInsertion=false`；diff action summary 不抢焦点，inline `cursor-agent-diff` 保留，展开详情提供显式 compare/file ref buttons；shell/validate summary 不聚焦 terminal transcript，terminal transcript 只通过展开后的 ref button 打开 Terminal；unsafe provider/local/internal refs 继续 fail closed。
  验证命令：`node --import tsx --test src/ui/src/app/chat/RunExecutionProcess.test.ts src/ui/src/app/chat/runStatusPresentation.test.ts src/ui/src/app/chat/finalMessagePresentation.test.tsx src/ui/src/app/chat/MessageContent.test.tsx src/ui/src/app/chat/ChatComposer.test.tsx src/ui/src/app/chat/LiveProgressSentence.test.tsx src/ui/src/app/results/resultPaneContract.test.ts`。
  状态：passed。
- [x] 2026-06-01 SciForge Browser file/diff/terminal ref smoke。
  evidence：`http://localhost:5174/`；中栏和 composer 正常加载；当前真实 live 会话没有 action/ref/diff rows（`actionFocusCount=0`、`refButtonCount=0`、`diffBlockCount=0`），未注入假数据；右侧未被 terminal transcript 自动占用（`terminalPaneVisible=false`）；scoped leak check 未发现 Authorization/API key/provider URL/local path；screenshot：`docs/test-artifacts/middle-pane-parity/2026-06-01-sciforge-file-diff-terminal-ref-smoke.png`。
  验证命令：Browser reload + DOM assertions + screenshot。
  状态：passed-smoke；备注：真实 backend diff/terminal action click flow 仍需后续专门验收。
- [x] 2026-06-01 Final answer failure/recovery focused tests。
  evidence：126/126 passing；失败 diagnostic / raw JSON payload 只在主回答显示简洁失败结论和脱敏 `Next step`，provider URL、HTTP 401、API token、agentserver、stdout/stderr/runtime refs、本地路径和 `.sciforge` 不进 primary content；traceback 和 timeout work-process transcript 保持折叠；成功 raw payload 即使包含后续建议也继续展示 human answer，不误判为失败。
  验证命令：`node --import tsx --test src/ui/src/app/chat/finalMessagePresentation.test.tsx src/ui/src/app/chat/RunExecutionProcess.test.ts src/ui/src/app/chat/runStatusPresentation.test.ts src/ui/src/app/chat/MessageContent.test.tsx src/ui/src/app/chat/ChatComposer.test.tsx src/ui/src/app/chat/LiveProgressSentence.test.tsx src/ui/src/app/results/resultPaneContract.test.ts`。
  状态：passed。
- [x] 2026-06-01 SciForge Browser final-answer recovery smoke。
  evidence：`http://localhost:5174/`；中栏加载成功（`hasChatPanel=true`），composer surface / Add-or-context control 可见；当前真实 live 会话没有失败 final/audit rows（`finalAuditFoldCount=0`、`finalProseCount=0`），未注入假数据；可见文本没有 traceback、stdoutRef、stderrRef、runtimeEventsRef 或 agentserver 泄漏；scoped leak check 未发现 Authorization/API key/provider URL/local path；screenshot：`docs/test-artifacts/middle-pane-parity/2026-06-01-sciforge-final-answer-recovery-smoke.png`。
  验证命令：Browser reload + DOM assertions + screenshot。
  状态：passed-smoke；备注：真实 backend failure final row 仍需后续专门验收，当前通用 contract 由 focused tests 覆盖。
- [x] 2026-06-01 Human approval / verifier / repair focused tests。
  evidence：143/143 passing；approval choices 渲染为 action-row 按钮且 DOM 文本不泄露 terminal command；verifier/repair 有 stable action kind/status；repair evidence 只暴露安全 `artifact:` / `file:` refs 并 focus 右侧 pane；provider/stdout/stderr/`.sciforge`/unsafe legacy command fail closed。
  验证命令：`node --import tsx --test src/ui/src/app/chat/RunExecutionProcess.test.ts src/ui/src/app/chat/RuntimeGuiPanel.test.tsx src/ui/src/app/chat/runStatusPresentation.test.ts src/ui/src/app/chat/finalMessagePresentation.test.tsx src/ui/src/app/chat/MessageContent.test.tsx src/ui/src/app/chat/ChatComposer.test.tsx src/ui/src/app/chat/LiveProgressSentence.test.tsx src/ui/src/app/results/resultPaneContract.test.ts src/ui/src/app/ChatPanel.test.ts`。
  状态：passed。
- [x] 2026-06-01 SciForge Browser approval/verifier/repair smoke。
  evidence：`http://localhost:5174/`；中栏、composer 正常加载（`hasChatPanel=true`、`hasComposerSurface=true`）；当前真实 live 会话没有 approval/verifier/repair rows（`approvalActionCount=0`、`verifierActionCount=0`、`repairActionCount=0`），未注入假数据；`commandChoiceCount=0`、`runtimeGuiRefButtonCount=0` 符合 idle 会话；visible/internal scoped leak check 未发现 provider/runtime command/channel 泄漏；screenshot：`docs/test-artifacts/middle-pane-parity/2026-06-01-sciforge-approval-verifier-repair-smoke.png`。
  验证命令：Browser reload + DOM assertions + screenshot。
  状态：passed-smoke；备注：真实 backend approval/verifier/repair workflow 仍需后续专门验收，当前通用 contract 由 focused tests 覆盖。
- [x] 2026-06-01 Scientific artifact / claim refs focused tests。
  evidence：139/139 passing；`RunKeyInfo` 中 scientific claims 只出现在折叠 Results 摘要，claim evidence refs 渲染为安全 artifact/file chips；`.sciforge` delivery path、stderr/raw/provider evidence ref 不进入 DOM；同一 artifact 先脱敏再 dedupe，避免重复 result 对象；既有 final answer、message refs、process refs 和 right-pane contract 不回退。
  验证命令：`node --import tsx --test src/ui/src/app/ChatPanel.test.ts src/ui/src/app/chat/RunExecutionProcess.test.ts src/ui/src/app/chat/MessageContent.test.tsx src/ui/src/app/chat/finalMessagePresentation.test.tsx src/ui/src/app/chat/runStatusPresentation.test.ts src/ui/src/app/results/resultPaneContract.test.ts`。
  状态：passed。
- [x] 2026-06-01 SciForge Browser scientific artifact / claim refs smoke。
  evidence：`http://localhost:5174/`；中栏可加载（`hasChatPanel=true`），当前真实 live 会话没有 result/claim rows（`resultFoldCount=0`、`scientificClaimRowCount=0`、`objectRefButtonCount=0`），未注入假数据；`finalAuditOpen=false`；scoped leak check 未发现 provider/runtime command 或 `.sciforge` internal path；screenshot：`docs/test-artifacts/middle-pane-parity/2026-06-01-sciforge-scientific-artifact-refs-smoke.png`。
  验证命令：Browser reload + DOM assertions + screenshot。
  状态：passed-smoke；备注：真实 backend scientific artifact/claim click flow 仍需后续专门验收，当前通用 contract 由 focused tests 覆盖。
- [x] 2026-06-01 Composer Agent Host catalog focused tests。
  evidence：31/31 passing；`composerAgentHostCatalogForSession` 从 `module.query` / `module.read` 结果抽取 public skills、MCP servers 和 connectors；Add menu 合并动态 catalog 与 SciForge fallback taxonomy；选择仍是 `/skills` / `/mcp` directive，不展示 provider URL、token、secret、本地路径或 raw schema。
  验证命令：`node --import tsx --test src/ui/src/app/chat/composerToolMenu.test.ts src/ui/src/app/chat/composerAgentHostCatalog.test.ts src/ui/src/app/chat/ChatComposer.test.tsx src/ui/src/app/ChatPanel.test.ts src/ui/src/app/uiActionBoundary.test.ts`。
  状态：passed。
- [x] 2026-06-01 SciForge Browser composer Agent Host catalog smoke。
  evidence：`http://localhost:5174/`；Add menu 可打开（`addMenuOpen=true`），Cursor 核心项 Plan/Debug/Multitask/Ask/Image/Models/Skills/MCP Servers 与 SciForge Pick visible context/Attach file 均可见；catalog capability buttons 正常呈现；当前真实 live session 未注入动态 module catalog result；scoped leak check 未发现 Authorization/API key/provider URL/token/local path/runtime command；screenshot：`docs/test-artifacts/middle-pane-parity/2026-06-01-sciforge-composer-agenthost-catalog-smoke.png`。
  验证命令：Browser reload + Add menu click + DOM assertions + screenshot。
  状态：passed-smoke；备注：Agent Host `module.query/read` live catalog workflow 仍需后续专门验收，当前通用 parser/renderer contract 由 focused tests 覆盖。
- [x] 2026-06-01 Composer model / declared intent focused tests。
  evidence：35/35 passing；model menu 暴露 Auto/MAX/Assistant tier public intent id；model picker preference 记录为 declared `update-capability-preference` UIAction，provider/model/base URL/API key/token 不进入 preference；`composerDeclaredIntentsForSession` 提取最近一次 public model intent，私有 label/malformed intent fail closed；既有 ChatPanel、Composer catalog 和 UIAction tests 不回退。
  验证命令：`node --import tsx --test src/ui/src/app/chat/composerDeclaredIntents.test.ts src/ui/src/app/chat/composerToolMenu.test.ts src/ui/src/app/chat/composerAgentHostCatalog.test.ts src/ui/src/app/chat/ChatComposer.test.tsx src/ui/src/app/ChatPanel.test.ts src/ui/src/app/uiActionBoundary.test.ts`。
  状态：passed。
- [x] 2026-06-01 Composer declared intent Runtime projection policy tests。
  evidence：2/2 passing；Runtime Codex request 保持 `commandText` 纯 terminal-equivalent text，`composerDeclaredIntents` 不出现在顶层 request；只读 declared intent 只位于 `auditMetadata.guiLocalProjection.composerDeclaredIntents`，private provider/model URL/API key/token/modelName 再次脱敏/fallback；Runtime bridge 同步发出 public projection receipt event，raw native 只含公开 intent id、mode、capability tier 和 action id。
  验证命令：`node --import tsx --test --test-name-pattern "composer model picker declared intent|聊天流式请求连接到 Codex Runtime bridge" src/ui/src/api/sciforgeToolsClient.policy.test.ts`。
  状态：passed。
- [x] 2026-06-01 Composer declared intent ack/action-row focused tests。
  evidence：3/3 passing；projection receipt event 保持 public message detail；backend `composer_declared_intent_ack` / projection ack 渲染为 `data-action-kind="message"` 的 Cursor-like action row；provider URL、API key、private modelName 不进入 DOM 或 event evidence。
  验证命令：`node --import tsx --test --test-name-pattern "composer declared intent ack|composer model picker declared intent|聊天流式请求连接到 Codex Runtime bridge" src/ui/src/app/chat/RunExecutionProcess.test.ts src/ui/src/api/sciforgeToolsClient.policy.test.ts`。
  状态：passed。
- [x] 2026-06-01 Middle Pane process ack regression suite。
  evidence：128/128 passing；ack message action、Cursor-like process folding、refs-first object buttons、final diagnostic folding、live progress sentence 和 result pane routing 均未回退。
  验证命令：`node --import tsx --test src/ui/src/app/chat/RunExecutionProcess.test.ts src/ui/src/app/chat/runStatusPresentation.test.ts src/ui/src/app/chat/finalMessagePresentation.test.tsx src/ui/src/app/chat/MessageContent.test.tsx src/ui/src/app/chat/ChatComposer.test.tsx src/ui/src/app/chat/LiveProgressSentence.test.tsx src/ui/src/app/results/resultPaneContract.test.ts`。
  状态：passed。
- [x] 2026-06-01 SciForge Browser composer model intent smoke。
  evidence：`http://localhost:5174/`；model menu 可打开（`modelMenuOpen=true`），`optionIds=[auto,max,assistant-auto,assistant-fast,assistant-balanced,assistant-deep]`，`assistantIntentCount=4`，Auto/MAX 与 public Assistant tiers 均可见；scoped leak check 未发现 Authorization/API key/provider URL/token/local path/runtime command；screenshot：`docs/test-artifacts/middle-pane-parity/2026-06-01-sciforge-composer-model-intent-smoke.png`。
  验证命令：Browser reload + model menu click + model intent click + DOM assertions + screenshot。
  状态：passed-smoke；备注：真实 Agent Host model intent consumption/ack workflow 仍需后续专门验收，当前 GUI declared-intent boundary 由 focused tests 覆盖。
- [x] 2026-06-01 SciForge Browser composer declared intent projection smoke。
  evidence：`http://localhost:5174/`；model menu 在窄中栏内完整展开（`panelRect.x=369` 在 chat rect 内，`width=270`），`optionIds=[auto,max,assistant-auto,assistant-fast,assistant-balanced,assistant-deep]`，public labels/speeds 完整可见；点击 `assistant-deep` 后 `modelMenuOpenAfterSelect=false`；scoped leak check 未发现 Authorization/API key/provider URL/token/local path/runtime command；screenshot：`docs/test-artifacts/middle-pane-parity/2026-06-01-sciforge-composer-declared-intent-projection-smoke.png`。
  验证命令：Browser reload + composer expand + model menu click + model intent click + DOM/layout assertions + screenshot。
  状态：passed-smoke；备注：该 smoke 只覆盖菜单/布局与 selection projection，真实 composer ack workflow 见下一条。
- [x] 2026-06-01 SciForge Browser composer declared intent ack live smoke。
  evidence：`http://localhost:5174/`；通过真实 composer 选择 `assistant-deep` 并发送轻量 prompt 后，中栏出现 `Worked for 15s · 3 actions`；展开 process group 可见 `Shared Assistant Deep preference with Agent Host.`，`messageActionCount=2`，停止请求后进入 stopped/cancelled 路径；scoped leak check 未发现 provider URL、API key、private modelName 或 local path；screenshot：`docs/test-artifacts/middle-pane-parity/2026-06-01-sciforge-composer-declared-intent-ack-live-smoke.png`。
  验证命令：Browser reload + composer typing + model menu click + send/stop + DOM assertions + screenshot。
  状态：passed-live-smoke；备注：当前为 Runtime bridge projection receipt + backend ack parser 的真实 composer workflow；完整后端 Agent Host 原生 ack 仍需后续长流程验收。
- [x] 2026-06-01 Virtual Screen adapter focused tests。
  evidence：5/5 passing；Screen pane 现在从 Computer Use artifacts 输出 package-owned `currentFrameRef` 并 materialize `virtual-screen-frame-image`；legacy frame data、screen/cursor/lease/proposal/permission/sidecar/validation refs 被映射为 `artifactRefs`、`actorCursorRefs`、`annotationOverlayRefs`、`annotationProposalRefs`、`inputLeaseRef`、`actionAdapterRef`、`adapterReadinessRef`、`evidenceLedgerRef` 和 `verificationRefs`；空态使用 package no-session copy，且 active run 无 screen artifact 时不会复用旧 run screen。
  验证命令：`node --import tsx --test --test-name-pattern "screen pane renders active|screen tab derives|screen tab does not reuse|tool tabs render|focused chat object refs" src/ui/src/app/ResultsRenderer.test.ts`。
  状态：passed。
- [x] 2026-06-01 Broad right-pane regression tests。
  evidence：85/85 passing；之前阻塞的 2 个 Virtual Screen frame materialization failures 已通过迁移 ResultsRenderer legacy `frameRef/frameRefs` adapter 到 package `currentFrameRef/frameStreamRef` / refs-first contract 解决；Browser、Screen、Terminal、Files、References、object-focus routing、workspace file tab state、support/audit 和 result-pane contract 均未回退。
  验证命令：`node --import tsx --test src/ui/src/app/ResultsRenderer.test.ts src/ui/src/app/results/resultPaneContract.test.ts src/ui/src/app/sciforgeApp/workbenchObjectFocus.test.ts src/ui/src/app/sciforgeApp/SciForgeWorkbench.test.ts`。
  状态：passed。
- [x] 2026-06-01 SciForge Browser Screen pane adapter smoke。
  evidence：`http://localhost:5174/`；页面右栏可加载并点击 Screen tab，`activeResultTab=screen`、`virtualScreenViewerCount=1`、`noSessionCopyCount=1`、`packageBoundaryCount=1`、`virtualScreenImageCount=0`（当前真实会话没有 Screen frame refs）、`leakCount=0`、`runtimeSetupCopyCount=0`；screenshot：`docs/test-artifacts/middle-pane-parity/2026-06-01-sciforge-screen-pane-adapter-tab-smoke.png`。
  验证命令：Browser reload + Screen tab click + DOM assertions + screenshot。
  状态：passed-smoke；备注：该项只验证 package Screen pane/empty refs-first state，不是 live Computer Use frame click-flow。
- [x] 2026-06-01 静态 whitespace 验证。
  evidence：Composer Agent Host catalog、model/declared intent projection/ack、object-focus tab routing、Virtual Screen package payload adapter、scientific artifact/claim refs-first 与 context inspector Cursor-category 改动后 `git diff --check` passed。
  验证命令：`git diff --check`。
  状态：passed。
- [x] 2026-06-01 全量 TypeScript 验证。
  evidence：本轮 Composer Agent Host catalog、model/declared intent projection/ack、object-focus tab routing、Virtual Screen package payload adapter、scientific artifact/claim refs-first 与 context inspector Cursor-category 改动后 `npm run typecheck` passed；`cursorAgentProcess.ts` 为 1982 行，仍低于 2000 行并保持 registered-watch；`ResultsRenderer.tsx` 为 3837 行，继续 registered，后续 right-pane adapters 需迁出到 typed helpers；`ChatComposer.tsx` 为 362 行，Context/Local environment 本轮只做轻量标记，后续新增 composer 能力继续迁出到 typed helpers；本轮 context category 逻辑主要落在 `contextWindow.ts`、runtime telemetry normalizers、contract 类型和 focused tests，不继续堆入 process 文件；顺手修正 `ShellPanels.sidebarModel.test.ts` 的 partial session map 类型断言以恢复全量 typecheck。
  验证命令：`npm run typecheck`。
  状态：passed。
- [x] 2026-06-01 深度 live parity loop 任务拆解与执行。
  evidence：本轮按“先 Cursor/SciForge 真实使用，再抽象成通用实现”执行：1）确认 `PROJECT_middle.md` 不可变规则；2）用 SciForge web 和 Cursor Agent 分别跑一轮精确 echo；3）用 SciForge 跑 agentic RL 论文检索长任务，暴露 raw webpage dump / runtime id 泄漏 / live-acceptance eligibility 问题；4）用 SciForge 和 Cursor Agent 跑同类 single-cell foundation / perturbation-response 最新论文长任务；5）把差异收敛为通用 final answer folding、native message live-acceptance、runtime id redaction、sidebar preview cleanup；6）回到 SciForge 热更新页面确认侧栏不再显示 `<title>` / Quick links dump。
  验证命令：Computer Use live observation + Edge input fallback + in-app Browser read-only observation + focused Node tests + `npm run typecheck` + `git diff --check`。
  状态：passed-live-loop；备注：in-app Browser 可打开/观察/截图本地 SciForge，但当前输入路径被 `Browser Use virtual clipboard is not installed` 阻断，因此只把 Edge 用作真实键盘输入 fallback，不作为首选观察工具。
- [x] 2026-06-01 SciForge / Cursor live echo smoke。
  evidence：SciForge 真实 composer 发送 `Reply exactly: SciForge live chat ok...`，完成态显示 `Worked for 4s 1 action` 和最终 `SciForge live chat ok`；Cursor Agent 真实 composer 发送 `Reply exactly: Cursor live chat ok...` 并完成。screenshots：`docs/test-artifacts/middle-chat-parity/sciforge-live-running-2026-06-01.png`、`docs/test-artifacts/middle-chat-parity/sciforge-live-final-2026-06-01.png`、`docs/test-artifacts/middle-chat-parity/cursor-live-running-2026-06-01.png`、`docs/test-artifacts/middle-chat-parity/cursor-live-final-2026-06-01.png`。
  验证命令：Computer Use / Browser live UI observation。
  状态：passed-live-smoke。
- [x] 2026-06-01 SciForge complex paper run：agentic RL。
  evidence：SciForge 跑真实 web/arXiv 长任务，完成态显示 `Worked for 1m 8s 10 commands run`、`Explored 1 file`、`More activity 10 earlier 54 supporting events`；运行截图：`docs/test-artifacts/middle-chat-parity/sciforge-paper-round1-running-2026-06-01.png`。本轮暴露并修复通用问题：raw HTML/search dump 不进入主回答；失败/原始工具输出折叠到 `More activity`；右栏 terminal/runtime ids 脱敏。
  验证命令：Edge/SciForge live UI observation；`node --import tsx --test src/ui/src/app/chat/finalMessagePresentation.test.tsx ...` focused suite。
  状态：passed-after-generic-fix。
- [x] 2026-06-01 SciForge / Cursor complex paper run：single-cell foundation / perturbation-response。
  evidence：SciForge 真实长任务完成态显示 `Worked for 1m 3s 7 commands run`、`More activity 67 supporting events`，返回候选表、读取范围、3 个发现、证据缺口和下一步；screenshots：`docs/test-artifacts/middle-chat-parity/sciforge-singlecell-round1-running-2026-06-01.png`、`docs/test-artifacts/middle-chat-parity/sciforge-singlecell-round1-final-2026-06-01.png`、`docs/test-artifacts/middle-chat-parity/sciforge-singlecell-round1-final-sidebar-fixed-2026-06-01.png`。Cursor Agent 同类长任务完成态显示 `Explored 5 files, 12 searches, 7 fetches, ran 1 command` + `Explored 2 files, 4 searches, 2 fetches, ran 4 commands`，最终选出 Chreode 并明确 PDF 未读；screenshots：`docs/test-artifacts/middle-chat-parity/cursor-singlecell-round1-running-2026-06-01.png`、`docs/test-artifacts/middle-chat-parity/cursor-singlecell-round1-final-2026-06-01.png`。
  验证命令：Computer Use live observation + screenshots。
  状态：passed-live-comparison；结论：Cursor 的稳定层级是自然语言进度句 -> `Explored/Worked` 聚合 -> 最终研究回答；SciForge 已对齐过程聚合和最终回答层，SciForge 特有结果/refs 继续保留在折叠详情与右栏。
- [x] 2026-06-01 Raw final answer / sidebar preview / runtime id 通用修复。
  evidence：`finalMessagePresentation.ts` 折叠 leading raw webpage/search dump；`runtimeNativeMessage.ts` 和 runtime event/gui presentation 只把成功非诊断 native answer 标记为 live-acceptance eligible；`previewSafety.ts` / terminal preview redacts `codex-command` / `runtime-codex` ids；`sidebarThreadPreview.ts` 复用 final-answer folding 生成 thread preview，避免左栏 `Last answer` 显示 `<title>`、Quick links 或 paper metadata dump。
  验证命令：`node --import tsx --test src/ui/src/app/chat/finalMessagePresentation.test.tsx src/ui/src/api/sciforgeToolsClient/runtimeEvents.test.ts src/ui/src/api/sciforgeToolsClient/runtimeEvents.client.test.ts src/ui/src/app/chat/RunExecutionProcess.test.ts src/ui/src/app/ChatPanel.test.ts src/ui/src/app/ResultsRenderer.test.ts src/ui/src/app/appShell/ShellPanels.sidebarModel.test.ts src/ui/src/app/appShell/sidebarCursorAgentModel.test.ts`。
  状态：passed；结果：258/258 passing。
- [x] 2026-06-01 并行 subagent audit：Markdown、process、refs。
  evidence：并行审计输出已合并为通用修复项：Markdown renderer 需要完整 GFM fixture 与 unsafe link protocol guard；process/action rows 需要隐藏 structured progress fields、runtime connection raw failure 和 live prompt-like progress echo；refs/right-pane 语义保持 refs-first，但 Runtime GUI/Browser/Screen/subagent live click-flow 仍需 runtime connection 恢复后补验。
  验证命令：subagent review summaries + 本轮 focused tests。
  状态：documented-and-implemented。
- [x] 2026-06-01 Markdown / queued guidance / failure focused tests。
  evidence：195/195 passing；覆盖完整 assistant Markdown（标题、段落、嵌套列表、ordered list、GFM 表格、blockquote、TypeScript code fence、安全链接、math-like symbols、raw HTML skip）、unsafe `javascript:`/`data:` link disable、legitimate scientific `model` wording 保留、queued guidance action row 公开文案、live prompt-like progress title 折叠、runtime connection failure compact notice、用户消息不误脱敏。
  验证命令：`node --import tsx --test packages/contracts/runtime/events.test.ts src/ui/src/streamEventPresentation.test.ts src/ui/src/processProgress.test.ts src/ui/src/app/chat/RunExecutionProcess.test.ts src/ui/src/app/chat/MessageContent.test.tsx src/ui/src/app/chat/finalMessagePresentation.test.tsx src/ui/src/app/ChatPanel.test.ts`。
  状态：passed。
- [x] 2026-06-01 SciForge Markdown stress queued/failure live verification。
  evidence：`http://localhost:5174/`；真实 multi-turn Markdown stress + queued follow-up workflow 先暴露问题，再热更新验证：`hasOriginalUserTerms=true`、`hasCorruptedUserTerms=false`、`hasGenericConnectionNotice=true`、`hasRawWebSocketError=false`、`hasStructuredFields=false`、`hasActionPromptEcho=false`、`hasQueuedGuidance=true`；screenshots：`docs/test-artifacts/middle-chat-parity/sciforge-markdown-stress-queued-2026-06-01.png`、`docs/test-artifacts/middle-chat-parity/sciforge-markdown-stress-websocket-failed-2026-06-01.png`、`docs/test-artifacts/middle-chat-parity/sciforge-markdown-stress-after-fix-2026-06-01.png`。
  验证命令：Browser reload + real composer send/follow-up + DOM assertions + screenshot。
  状态：passed-after-generic-fix；备注：runtime connection 当前仍中断，因此本轮验证到 queued/failure/diagnostic path，successful final Markdown live rendering 由 focused SSR tests 覆盖并需连接恢复后补真实 UI。
- [x] 2026-06-01 Runtime/browser-host type boundary focused tests。
  evidence：browser host search runtime payload refs-first tests 2/2 passing；runtime module dispatcher/files module tests 10/10 passing；本轮为恢复全量 typecheck 做了最小类型修复：artifact id 类型窄化、`files` default module description fallback、right-pane browser smoke nullable assertion message。
  验证命令：`node --import tsx --test src/runtime/browser-host-search-runtime.test.ts`；`node --import tsx --test src/runtime/modules/dispatcher.test.ts src/runtime/modules/files-module-handler.test.ts`。
  状态：passed。
- [x] 2026-06-01 当前静态/类型验证。
  evidence：`npm run typecheck` passed；`git diff --check` passed；typecheck 初轮暴露的 browser-host test、module dispatcher 和 right-pane smoke 类型边界已用最小通用修复关闭。
  验证命令：`npm run typecheck`；`git diff --check`。
  状态：passed。
- [x] 2026-06-01 Markdown math / KaTeX 通用补齐。
  evidence：统一 `MarkdownRenderer` 接入 `remark-math` + `rehype-katex`，保留 `skipHtml`、safe link transform 和 refs-first object reference 规则；CSS 引入 KaTeX 并限制 display math 横向滚动，避免长公式撑爆中栏；tests 覆盖 inline `$z_t = W_2 + \alpha$`、block `$$...$$`、literal `$5`、`p < 0.05`、inline code / fenced code 中的 `$...$` 不被误公式化，且 unsafe link / raw HTML 仍不渲染。
  验证命令：`node --import tsx --test src/ui/src/app/chat/MessageContent.test.tsx`；状态：19/19 passed。
  状态：passed。
- [x] 2026-06-01 Runtime GUI / health / right-pane refs 通用修复。
  evidence：并行 subagent 指出 `RuntimeGuiPanel` 可能直接显示 provider/stdout/local path/raw JSON，且 browser/screen/terminal/subagent refs 会被丢弃；本轮新增 `sanitizeRuntimeGuiText`，Runtime GUI text/title 不再暴露 provider URL、token、`.sciforge` log、本地绝对路径、stdout/stderr/raw JSON；Runtime GUI refs 改为经 `objectReferenceForCursorRef` 解析后才显示，可点击聚焦 browser/screen/terminal/subagent/file/artifact，unsafe refs fail-closed；`probeWorkspaceWriterHealthUrl` 要求 `/health` 返回 `{ ok:true, service:"sciforge-workspace-writer" }`，避免 Vite HTML 200 被误判为 writer online；`resultPaneContract` 增加 artifactType-aware route，`computer-use-virtual-screen` / `browser-runtime-snapshot` / `terminal-transcript` artifact 可直接路由到 Screen/Browser/Terminal 且 `composerInsertion=false`。
  验证命令：`node --import tsx --test src/ui/src/runtimeHealth.test.ts src/ui/src/app/runtimeHealthPanel.test.ts src/ui/src/app/chat/RuntimeGuiPanel.test.tsx src/ui/src/app/results/resultPaneContract.test.ts`；状态：18/18 passed。
  状态：passed。
- [x] 2026-06-01 SciForge runtime health / Markdown math live smoke。
  evidence：`curl http://127.0.0.1:6173/health` 返回 writer JSON：`ok=true`、`service=sciforge-workspace-writer`；`curl http://127.0.0.1:5173/health` 与 `5174/health` 仍为 Vite HTML，本轮 health probe 不再把这类 HTML 200 当 writer online；真实 Edge/SciForge 设置页显示 Workspace Writer 指向 `http://127.0.0.1:6173` 且 online，screenshot：`docs/test-artifacts/middle-chat-parity/sciforge-runtime-health-connections-after-fix-2026-06-01.png`。真实 composer 发送 Markdown/math stress prompt 后，用户消息中的 inline/block LaTeX 已渲染为 KaTeX，running 态显示 `Activity` 与 `A task is running. New guidance will be queued.`，screenshot：`docs/test-artifacts/middle-chat-parity/sciforge-live-markdown-math-running-2026-06-01.png`；刷新恢复后页面回到可用 composer，screenshot：`docs/test-artifacts/middle-chat-parity/sciforge-live-markdown-math-after-stop-reload-2026-06-01.png`。
  验证命令：Computer Use Edge input fallback + Browser read-only DOM checks + `screencapture` + `curl /health`。
  状态：passed-running-smoke；风险：该 live successful-final 没在合理时间内返回；点击 Stop 后 Edge tab 曾崩溃为 “此页存在问题 / 错误代码: 5”，刷新可恢复。successful assistant final Markdown 仍由 focused SSR/contract tests 覆盖，Stop crash 需要后续专门定位。
- [x] 2026-06-01 Middle chat expanded regression suite。
  evidence：214/214 passing；覆盖 contracts、stream/process presentation、Markdown/KaTeX、安全链接、Runtime GUI 脱敏/refs、artifactType right-pane route、runtime health JSON service 校验、queued/failure/running/final answer folding、raw stdout/stderr/provider/debug payload 隐藏、refs-first object focus、Computer Use approval/repair action rows。
  验证命令：`node --import tsx --test packages/contracts/runtime/events.test.ts src/ui/src/streamEventPresentation.test.ts src/ui/src/processProgress.test.ts src/ui/src/app/chat/RunExecutionProcess.test.ts src/ui/src/app/chat/MessageContent.test.tsx src/ui/src/app/chat/finalMessagePresentation.test.tsx src/ui/src/app/ChatPanel.test.ts src/ui/src/app/chat/RuntimeGuiPanel.test.tsx src/ui/src/app/results/resultPaneContract.test.ts src/ui/src/runtimeHealth.test.ts src/ui/src/app/runtimeHealthPanel.test.ts`。
  状态：passed。
- [x] 2026-06-01 当前静态/类型验证（Markdown math / Runtime GUI / health / route 后）。
  evidence：`npm run typecheck` passed；`git diff --check` passed。
  验证命令：`npm run typecheck`；`git diff --check`。
  状态：passed。
- [x] 2026-06-01 并行 subagent audit：Files/health、final/heartbeat/cancel、Markdown delta。
  evidence：并行 subagent 复核指出三类通用差异：1）Files 右栏会把 stale workspace writer 的 `module.query` 404 当作用户可见错误，影响 refs-first click-flow；2）backend 只发 terminal done 但不关闭 stream 时 UI 可能停在 running，heartbeat/waiting progress 还会延长 watchdog，Stop/cancel 存在长时间 pending；3）assistant streaming delta 被前后 trim/word-join 修复后会破坏 Markdown token 边界，真实结果中出现 `## Mark down`、````` typescript`、`greet (` 这类非 Cursor-like 渲染质量问题。
  验证命令：subagent review summaries + Edge/Safari/SciForge live observations + focused runtime endpoint checks。
  状态：documented-and-implemented。
- [x] 2026-06-01 Files pane module dispatcher / writer health 通用修复。
  evidence：`agentHostModuleClient` 现在先通过 writer `/health` 校验 `runtime-module-dispatcher` capability，stale writer/Vite HTML/缺 capability 都转成安全 UI 诊断；`filesPaneModulePort` 将 `SciForgeClientError` 映射为可读 title/reason/action，不再在右栏暴露 raw HTTP/module diagnostic ref；workspace writer `/health` 返回 `capabilities=["runtime-module-dispatcher"]` 与 endpoint map。真实 Files pane live screenshot：`docs/test-artifacts/middle-chat-parity/sciforge-files-pane-module-dispatcher-live-2026-06-01.png`。
  验证命令：`node --import tsx --test src/ui/src/api/agentHostModuleClient.test.ts src/ui/src/app/results/filesPaneModulePort.test.ts src/runtime/workspace-server-health.test.ts src/ui/src/runtimeHealth.test.ts src/ui/src/app/runtimeHealthPanel.test.ts src/runtime/workspace-server-modules.test.ts`。
  状态：passed；备注：旧 open risk 中的 Files pane `module.query` 404 文案已关闭。
- [x] 2026-06-01 Runtime final / heartbeat / Stop-cancel 通用修复。
  evidence：`codexRealtimeSession` 在 terminal done/failed/cancelled/error 后主动 close stream 并清理 pending controller；`item_completed status:completed` 不再误判 terminal；heartbeat/waiting progress 不重置 watchdog；server cancel 先 abort 再 adapter cancel，并为卡住的 cancel 设置 timeout；ChatPanel Stop 捕获当前 abort controller，避免重复点击时引用漂移。Edge live final smoke 已从 stuck running 恢复为 completed，screenshot：`docs/test-artifacts/middle-chat-parity/sciforge-edge-live-final-ok-after-terminal-fix-2026-06-01.png`。
  验证命令：`node --import tsx --test src/ui/src/api/sciforgeToolsClient/codexRealtimeSession.test.ts src/ui/src/api/sciforgeToolsClient/clientProgress.test.ts src/runtime/codex/codex-app-server-client.test.ts src/runtime/codex/codex-runtime-server.test.ts`。
  状态：passed。
- [x] 2026-06-01 Assistant final Markdown streaming delta exactness 通用修复。
  evidence：真实 Runtime endpoint 复现了 delta 边界被 trim/word-join 破坏的问题；修复后 backend normalization 对 text/delta/content 字段保留原始 whitespace，UI SSE reader 对真实 assistant delta 采用 exact concat，仅对非 delta fragment 保留旧的保守 join。修复后同一 live Runtime prompt 返回 `HAS_MD_BREAKS true true true true`、`NO_DELTA_SPACES true`，完整保留 h2、中文/英文混排、嵌套列表、GFM 表格、TypeScript fence、长中文段落和链接文本边界，不再生成 `## Mark down` / ````` typescript` / `greet (`。Edge crash 阻断 browser final 截图前，user-message Markdown/KaTeX 仍已在 UI 中真实渲染成功。
  验证命令：`node --import tsx --test --test-name-pattern "markdown structure|markdown whitespace|exactly instead" src/ui/src/api/sciforgeToolsClient/runtimeEvents.test.ts src/runtime/codex/backend-event-normalization.test.ts`；`node --import tsx --test src/ui/src/api/sciforgeToolsClient/runtimeEvents.test.ts src/runtime/codex/backend-event-normalization.test.ts src/ui/src/api/sciforgeToolsClient/codexRealtimeSession.test.ts src/ui/src/api/sciforgeToolsClient/clientProgress.test.ts src/runtime/codex/codex-app-server-client.test.ts src/runtime/codex/codex-runtime-server.test.ts src/ui/src/api/agentHostModuleClient.test.ts src/ui/src/app/results/filesPaneModulePort.test.ts src/ui/src/runtimeHealth.test.ts src/ui/src/app/runtimeHealthPanel.test.ts src/runtime/workspace-server-health.test.ts src/runtime/workspace-server-modules.test.ts`（82/82 passed）。
  状态：passed-contract-and-runtime-endpoint；备注：browser UI successful assistant final Markdown 截图仍被 Edge crash/Safari input 限制阻断，见 open risk。
- [x] 2026-06-01 Middle chat expanded regression suite（final-stream / Files / health 后）。
  evidence：216/216 passing；覆盖 runtime contracts、stream/process presentation、Markdown/KaTeX、安全链接、assistant delta exact concat、backend whitespace preservation、queued/failure/running/final folding、Runtime GUI 脱敏/refs、artifactType right-pane route、workspace writer capability health、Files pane safe diagnostics、refs-first object focus 与 Computer Use approval/repair action rows。
  验证命令：`node --import tsx --test packages/contracts/runtime/events.test.ts src/ui/src/streamEventPresentation.test.ts src/ui/src/processProgress.test.ts src/ui/src/app/chat/RunExecutionProcess.test.ts src/ui/src/app/chat/MessageContent.test.tsx src/ui/src/app/chat/finalMessagePresentation.test.tsx src/ui/src/app/ChatPanel.test.ts src/ui/src/app/chat/RuntimeGuiPanel.test.tsx src/ui/src/app/results/resultPaneContract.test.ts src/ui/src/runtimeHealth.test.ts src/ui/src/app/runtimeHealthPanel.test.ts`。
  状态：passed。
- [x] 2026-06-01 当前静态/类型验证（final-stream / Files / health 后）。
  evidence：`npm run typecheck` passed；`git diff --check` passed；writer live health `curl http://127.0.0.1:6173/health` 返回 `ok:true`、`service:"sciforge-workspace-writer"`、`capabilities:["runtime-module-dispatcher"]`。
  验证命令：`npm run typecheck`；`git diff --check`；`curl http://127.0.0.1:6173/health`。
  状态：passed。
- [x] 2026-06-01 Markdown autolink / CJK punctuation boundary 通用修复。
  evidence：`MarkdownRenderer` 对 remark-gfm autolink literal 增加统一 CJK 标点边界拆分，`safeMarkdownHref` 仍只允许 http/https/mailto/hash；explicit markdown link 不被改写；inline object refs 的 trailing punctuation 规则扩展到 `、，。；：！？）】》」』`，因此 `file:...，/）` 会渲染为 refs-first button 且标点留在按钮外。tests 覆盖裸 URL 后接 `、，；：！？）】`、explicit `[label](https://...)。`、unsafe `javascript:`/`data:` disabled、object ref punctuation outside button、raw HTML skip、KaTeX/math/code/table/list/blockquote。in-app Browser 只读打开既有 Markdown 会话，确认主聊天可加载且 scoped text 未出现 WebSocket/stdout/stderr/runtime id 泄漏；历史 screenshot evidence：`docs/test-artifacts/middle-chat-parity/sciforge-iab-cjk-link-boundary-2026-06-01.png`。
  验证命令：`node --import tsx --test src/ui/src/app/chat/MessageContent.test.tsx`（20/20 passed）；in-app Browser DOM read-only observation。
  状态：passed；备注：旧 open risk 中的 URL + 中文标点边界 fixture 已关闭。
- [x] 2026-06-01 Runtime provider preflight 到主聊天 readiness 的通用接入。
  evidence：`useRuntimeHealth` 在 Workspace Writer `/health` 声明 `runtime-provider-preflight-manifest` capability 后读取 `/api/sciforge/runtime-provider-preflight/manifest`；`modelHealth` 可由 preflight notice 投影为 `source:"runtime-provider-preflight"` 的 `Assistant Connection` health item，detail 使用通用 `Assistant connection preflight...`，不暴露 `SCIFORGE_RUNTIME_API_KEY`、provider URL、API key、模型名或 env/debug 文案；`runReadiness` 在 workspace/codex runtime 可用但 preflight 不 ready 时显示非阻塞 warning：`Assistant connection preflight needs attention. Check Settings before long runs.`。真实 writer evidence：`curl -s http://127.0.0.1:6173/health` 返回 `runtime-provider-preflight-manifest` capability；`curl -s http://127.0.0.1:6173/api/sciforge/runtime-provider-preflight/manifest` 返回 `category:"missing-runtime-env"`、`upstreamBaseUrlPresent:true`。in-app Browser 只读 reload `http://localhost:5173/` 可加载中栏和 composer，空输入态仍显示 Cursor-like idle tip；preflight notice 的可见 readiness 文案由 focused `runReadiness` test 覆盖。
  验证命令：`node --import tsx --test --test-name-pattern "provider preflight|provider setup|runtime checking|workspace writer" src/ui/src/runtimeHealth.test.ts src/ui/src/app/chat/runStatusPresentation.test.ts src/ui/src/app/runtimeHealthPanel.test.ts`（7/7 passed）；`curl -s .../health`；`curl -s .../runtime-provider-preflight/manifest`；in-app Browser DOM read-only observation。
  状态：passed-contract-and-live-manifest；备注：该 warning 只在有可发送输入时进入 composer readiness，不污染 idle/new-chat 空态。
- [x] 2026-06-01 Middle chat focused + expanded regression（CJK boundary / provider preflight 后）。
  evidence：focused affected suite 50/50 passing，覆盖 MessageContent Markdown/GFM/KaTeX/safe links/CJK autolink/object refs、run readiness/provider preflight、runtime health panel 与 ChatComposer 脱敏；expanded middle-chat suite 218/218 passing，覆盖 runtime contracts、stream/process presentation、Markdown/KaTeX、安全链接、assistant delta exact concat、backend whitespace preservation、queued/failure/running/final folding、Runtime GUI 脱敏/refs、artifactType right-pane route、workspace writer capability health、Files pane safe diagnostics、refs-first object focus 与 Computer Use approval/repair action rows。
  验证命令：`node --import tsx --test src/ui/src/app/chat/MessageContent.test.tsx src/ui/src/app/chat/runStatusPresentation.test.ts src/ui/src/runtimeHealth.test.ts src/ui/src/app/runtimeHealthPanel.test.ts src/ui/src/app/chat/ChatComposer.test.tsx`；`node --import tsx --test packages/contracts/runtime/events.test.ts src/ui/src/streamEventPresentation.test.ts src/ui/src/processProgress.test.ts src/ui/src/app/chat/RunExecutionProcess.test.ts src/ui/src/app/chat/MessageContent.test.tsx src/ui/src/app/chat/finalMessagePresentation.test.tsx src/ui/src/app/ChatPanel.test.ts src/ui/src/app/chat/RuntimeGuiPanel.test.tsx src/ui/src/app/results/resultPaneContract.test.ts src/ui/src/runtimeHealth.test.ts src/ui/src/app/runtimeHealthPanel.test.ts`。
  状态：passed。
- [x] 2026-06-01 当前静态/类型验证（CJK boundary / provider preflight 后）。
  evidence：`npm run typecheck` passed；`git diff --check` passed。
  验证命令：`npm run typecheck`；`git diff --check`。
  状态：passed。
- [x] 2026-06-01 Live stream / persisted streamProcess / request payload raw compaction 通用修复。
  evidence：先复查本文件不可变规则与 open risks；本轮明确三层边界：1）React live `streamEvents` 统一经 `appendLiveStreamEvent` / `boundLiveStreamEvents` 进入 state，count <= 160、总 JSON 预算 120k，并对 raw/debug/provider/stdout/stderr/HTML/secret/local path 做摘要或折叠；2）persisted `run.raw.streamProcess` 改为 refs-first + 摘要化，记录 `eventCount`、`retainedEventCount`、`truncated`、`summaryDigest`、`eventSummaries`、safe `refs`，保留 events <= 48 且受 80k JSON budget 约束；3）next-turn request payload 的 `compactRunRawForRequestPayload` 不再携带 `streamProcess.events` 或 raw transcript/debug body，只保留 digest summaries 和 safe refs。`runtimeEvents.ts` 对 raw HTML/JSON/RAW_* transport body 先折叠为 audit summary；`ChatPanel.tsx` 的 queued/request-accepted/live stream/waiting/guidance/Stop event 都走同一 live boundary。未硬编码当前 prompt、截图、URL、历史会话、论文或 run。
  验证命令：`node --import tsx --test src/ui/src/streamEventPresentation.test.ts src/ui/src/api/sciforgeToolsClient/runtimeEvents.test.ts src/ui/src/app/chat/RunExecutionProcess.test.ts`（124/124 passed）；`node --import tsx --test src/ui/src/streamEventPresentation.test.ts src/ui/src/api/sciforgeToolsClient/runtimeEvents.test.ts src/ui/src/app/chat/RunExecutionProcess.test.ts src/ui/src/app/chat/sessionTransforms.test.ts`（160/160 passed）。
  状态：passed；备注：旧 open risk “Stop 后 raw payload compaction 仍未实现为 bounded state/digest” 已关闭。
- [x] 2026-06-01 Request payload / process recovery compatibility regression。
  evidence：contract-level runtime events、process progress、MessageContent、run readiness、compact stream process recovery path 均保持兼容；compact history 能从 `eventSummaries` 恢复结构化 progress，但不会把 legacy raw stream transcript body 带回下一轮。
  验证命令：`node --import tsx --test packages/contracts/runtime/events.test.ts src/ui/src/processProgress.test.ts src/ui/src/app/chat/MessageContent.test.tsx src/ui/src/app/chat/runStatusPresentation.test.ts`（68/68 passed）。
  状态：passed。
- [x] 2026-06-01 in-app Browser middle-chat live observation after raw compaction。
  evidence：in-app Browser 打开 `http://127.0.0.1:5173/`，标题为 `SciForge`；DOM observation：`messageCount=2`、`hasChatProcess=false`，可见主聊天 scoped leak check 对 `RAW_`、`stdout`、`stderr`、`provider payload`、`native event`、`Authorization`、`api key` 返回空数组；composer textbox count 为 1，Browser fill/focus 输入一条通用验证草稿后可见并已用 keyboard clear 清空，清空后 `containsDraft=false`；再次 scoped leak check 仍为空。限制：本轮没有提交真实长任务或 double-stop acceptance；Browser 插件在一次 focus 操作时自身吐出外部 Statsig/Cloudflare HTML telemetry 日志，但该日志不在 SciForge DOM / chat visible text 内。
  验证命令：in-app Browser reload + DOM assertions + composer focus/fill/clear observation。
  状态：passed-smoke-with-limits。
- [x] 2026-06-01 当前静态/类型验证（raw payload compaction 后）。
  evidence：`npm run typecheck` passed；`git diff --check` passed；当前相关行数：`runtimeEvents.ts` 1867、`ChatPanel.tsx` 1533、`streamEventPresentation.ts` 953、`runPresentation.ts` 481、`runRawCompaction.ts` 188，已更新大文件登记。
  验证命令：`npm run typecheck`；`git diff --check`；`wc -l src/ui/src/streamEventPresentation.ts src/ui/src/api/sciforgeToolsClient/runtimeEvents.ts src/ui/src/app/chat/runPresentation.ts src/ui/src/app/ChatPanel.tsx src/ui/src/app/chat/runRawCompaction.ts`。
  状态：passed。
- [ ] 2026-06-01 未关闭风险。
  evidence：1）Edge 在长 Markdown live turn 中再次出现 “此页存在问题 / 错误代码: 5”，screenshot：`docs/test-artifacts/middle-chat-parity/sciforge-edge-markdown-live-crash-error5-2026-06-01.png`；本轮已关闭 raw payload bounded/digest 风险，但仍需专门定位 renderer、Edge、extension、Stop/abort 或长流式渲染交互；2）browser UI successful assistant final Markdown 截图仍未关闭：Runtime endpoint 与 focused tests 已证明最终内容保留 Markdown，但完整浏览器 final evidence 仍需稳定长任务环境补齐；3）Stop/cancel race 已有代码和 focused tests，本轮也限制 Stop event live state，但还需要真实 UI double-stop/long-run acceptance；4）in-app Browser 本轮可 reload/DOM/focus/fill/clear，但未提交真实长任务，且插件自身可能输出外部 telemetry HTML 日志；后续 live composer acceptance 仍需继续记录 Browser 限制并用可行路径补证据。
  状态：open。

## 验证规则

- 纯文档改动：运行 `git diff --check`。
- Chat process 改动：运行 `RunExecutionProcess.test.ts`、`runStatusPresentation.test.ts`、`finalMessagePresentation.test.tsx`、`MessageContent.test.tsx`、`ChatComposer.test.tsx` 和 `git diff --check`。
- Composer/tool menu 改动：覆盖 Plan/Ask/Debug/Multitask、Image、Models、Skills、MCP Servers、reference pick、file upload、queued guidance、stop/cancel、context meter 和 redaction。
- Object ref / right-pane focus 改动：运行 `ResultsRenderer.test.ts`、`resultPaneContract.test.ts`、`MessageContent.test.tsx`，确认点击 refs 只 focus right pane，不隐式插入 composer。
- 中间栏视觉/交互验收：反复、深度使用 Cursor Agent desktop app 和 SciForge web 做双端对照；每轮都用 Computer Use 只读观察 Cursor baseline，用 Browser/Playwright 检查 SciForge 同类 workflow，记录稳定行为、差异、evidence refs 和测试覆盖，不固化坐标、截图或当前会话。
