# Computer Use Runtime 设计

最后更新：2026-06-09

## 文档目的

这份文档记录 Computer Use 的稳定边界、primitive 设计、refs-first 证据原则，以及 Host-side App Capability Module 的最新决策。

目标是让人类和 agent 读完后能快速判断：

- 什么属于 Computer Use core。
- 什么属于 Agent Host。
- 每个软件的专门优化应该放在哪里。
- VSCode co-work v1 应该如何推进。

字段、schema、MCP tool definition、validator 和测试真相源仍放在 `packages/actions/computer-use`。本文件只保留架构原则和沟通口径。

## 定位

Computer Use 是 Codex backend 可调用的桌面 / GUI primitive runtime，不是 Computer Use agent，也不是跨应用 workflow engine。

Computer Use 只负责：

- 绑定 Host 指定的真实窗口、应用、显示器或局部 target scope。
- 观察已绑定 target 的当前状态，并产出 refs-first evidence。
- 在已绑定 target 上执行 Host 指定的单个原子 GUI action。
- 执行 Host 指定的无智能局部 procedure，以减少 Host 往返成本。
- 维护 WindowActionSession、input adapter、actor cursor、scoped input lease、stop / cancel / release 控制 refs。
- 对越界、陈旧、未授权、未确认或证据不足的请求 fail closed，并返回 blocked reason / repair hints。

Computer Use 不负责：

- 理解完整用户任务。
- 选择跨模块下一步。
- 改写用户目标。
- 语义 locate / 自动选择控件。
- 自动 repair。
- 判断用户级 completion truth。
- 生成 final answer。
- 保存、提交、发送、上传、删除、支付等副作用的最终决策。

## 职责边界

```text
Agent Host owns:
  task understanding
  target selection
  next-action reasoning
  model calls
  app module selection
  risk / confirmation policy
  verifier selection
  artifact validation request
  completion truth
  final answer

Computer Use owns:
  target-bound session refs
  current observation refs
  scoped executor event refs
  local primitive execution refs
  stale invalidation
  fail-closed diagnostics
  stop / cancel / release controls
```

判断原则：

- 如果某段逻辑需要理解“用户到底想完成什么”，它不属于 Computer Use。
- 如果某段逻辑只需要回答“这个 session 现在看到什么 / 这一个 Host 指定动作是否被安全执行并记录”，它属于 Computer Use。

## Core 模块结构

Computer Use 长期保持小内核和可替换 adapter：

- Primitive Contract：schema、validator、result envelope、risk gate、refs-first 规则。
- Session Runtime：管理 `bind -> active -> paused -> released/stopped/cancelled` 生命周期。
- Input Adapter：每个 session 拥有独立 input adapter 和 cursor marker；共享系统鼠标 / 键盘只能作为全局独占 adapter，被串行 lease 管理。
- Platform Adapter：macOS Accessibility、远程桌面、未来 native sidecar 等平台实现。
- Acceptance Harness：TextEdit / demo app / 多 session live test，只用于验收，不进入 product core。

Product path 优先走 focus-free 或 session-local input adapter。如果某平台动作只能通过共享系统鼠标 / 键盘完成，必须按全局独占资源处理：一次只允许一个 Computer Use action 接管，记录 focus/input lease、可暂停 / 取消、执行后恢复焦点和鼠标位置，并明确该动作期间会短暂影响用户正常输入。

实现默认不启用共享系统输入。只有调用方显式选择 diagnostic 或 handoff 模式时，Computer Use primitive port 才能绑定 `system-input` adapter；此时同一进程内只能有一个 shared-system-input action 进入 executor，其它会话必须 blocked 或排队。

## Primitive Surface

Computer Use MCP public surface 只暴露这些 primitive：

| primitive | 作用 | 边界 |
| --- | --- | --- |
| `computer_use.bind` | 绑定 Host 指定目标，建立 scoped session。 | 不判断目标是否足以完成用户任务；不规划下一步。 |
| `computer_use.observe` | 读取已绑定 target 的当前状态并物化 refs。 | 不选择 action；不把 observation 升级成 completion truth。 |
| `computer_use.act` | 执行 Host 指定的一个原子 GUI action。 | 不接受自然语言目标；只接受 Host 已选定的 element ref、point、key、text ref 或 app command。 |
| `computer_use.run_procedure` | 执行 Host 指定的局部结构化步骤序列，减少多次 primitive 往返。 | 不接受自然语言 task / instruction / goal；不 plan / locate / verify / repair；不判断用户任务完成。 |
| `computer_use.control` | 暂停、停止或释放 session。 | 不参与任务推理；不改变 completion truth。 |

所有 primitive 都必须使用 refs-first envelope。未知字段默认拒绝或进入 diagnostics，不能静默改变语义。

`bind` 成功必须产出 session-scoped `inputAdapterRef`、`cursorRef` 和 `scopedInputLeaseRef`。这些 refs 在同一进程内必须唯一；`act` 和 `control` 只能在对应 session scope 内使用它们。

`act` 的原子动作覆盖 click、double_click、type、key、scroll、wait、app_command 和 drag。这些动作只描述一次明确输入事件或应用命令，不承载智能。

`run_procedure` 是性能和时延优化，不是旧 `runTask` 的改名。它只执行 Host 已经决定好的局部步骤序列。`run_procedure.status=completed` 只表示这段局部 procedure 执行完了，不能证明用户目标完成。

## Host-side App Capability Modules

每个软件的专门优化不进入 Computer Use core。长期采用 Host-side App Capability Module Registry：Agent Host 根据 app / window / observation refs 选择合适的 app module，再由该 module 把软件专门知识压成 refs-first 的状态模型、能力目录和单步 readiness 结果。

```text
Agent Host
  -> App Capability Registry
      -> VSCode App Module
          -> stable concept model
          -> evidence providers / verifiers
          -> atomic capability catalog
          -> primitive readiness
  -> Computer Use Core
      -> bind / observe / act / run_procedure / control
```

App module 可以提供：

- app / window / process / bundle identity refs 的识别规则。
- 软件稳定概念模型，例如 window、editor、file、selection、terminal、panel、command palette、diagnostics。
- observation refs 归一化，把通用 screenshot / AX / text / image / title refs 映射成 app-specific tokenized refs。
- target uniqueness 和 ambiguity 检查，例如多窗口、多 editor group、多 terminal、未知 webview 或 stale observation。
- atomic capability catalog，例如 `focus-editor`、`insert-draft`、`save-current-file`、`focus-terminal`、`open-command-palette`。
- primitive readiness：只回答 Host 已决定的一个 operation 是否能在当前 refs 下转成一个 Computer Use primitive，或应 `blocked` / `needs-confirmation`。
- Host-owned evidence provider / verifier，例如 focused-editor、same-file、mutation、save、diagnostics、terminal output 或 command palette item verifier。
- public evidence sanitizer 规则，确保 raw screenshot、raw AX、raw visible text、raw command、raw path、provider payload、URL、base64 或 secret 不进入 public result。

App module 不可以：

- 接受自然语言 task / goal / instruction。
- 自己选择多步计划、自动 repair、循环 retry 或跨模块下一步。
- 直接调用模型并把模型输出作为执行决策。
- 直接操作桌面绕过 `bind -> observe -> act -> control` primitive。
- 改变 risk / confirmation policy。
- 判断用户级 completion truth。
- 生成 final answer。

App module 是懂某个软件的“状态模型、能力目录和证据门”，不是第二个 agent。智能载体仍然是 Agent Host；需要模型能力时由 Host 调 Model Router 或 Host-owned verifier/provider，并把结果压成安全 refs 后再进入下一步。

## Ordinary Chat 与 Native Route 边界

ordinary chat 只是进入 Codex / Agent Host 的用户输入桥，不是 VSCode module、Computer Use runtime 或 native route 的直接调用入口。裸 `message`、`commandText`、terminal output、command palette item、completed action 或历史 run 记录只能作为 Host 可见 evidence refs，不能被本地 runtime 推断成 app module operation、多步 GUI workflow、completion truth 或 final answer。

即使输入已经被包装成 `sciforge.codex-agent-host-input.v1`，`intentText` / `commandText` / prompt 文本仍不能作为 VSCode operation fallback。只有 Host 写入 structured target operation ref，例如 `target.vscodeCoWork.operation` 或等价 Host operation ref，才能触发 VSCode module readiness 或 live diagnostic Host producer。

native route 只做确定性投影：它可以投影 sanitized refs、blocked / partial 状态和 Host-owned final answer envelope。没有 same-run Host final-answer evidence 时，native route 必须返回 `blocked` / `partial`，不能用 Computer Use action result、app module readiness、`run_procedure.status=completed`、runtime ack 或 fallback text 自行 `done`。

P4 后 Host-owned final answer evidence 的最小 marker 是：

- `agentHostFinalAnswer.schemaVersion = sciforge.codex-agent-host.current-vscode-cowork-final-answer.v1`。
- `agentHostFinalAnswer.source` 必须来自 `codex-agent-host-*` Host producer。
- `agentHostFinalAnswer.hostOwnsFinalAnswer = true`。
- `agentHostFinalAnswer.computerUseCorePlanning = false`。
- `agentHostFinalAnswer.text` 必须通过 public projection 安全检查。
- `agentHostFinalAnswer.evidenceRefs` 必须和 current-run native route / Runtime Codex done evidence 有交集。

UI / runtime projection 不能从 native `message`、`message_delta`、`done.finalText`、`answer`、`text`、completion ack 或 runtime gateway 空响应本地铸造 `FinalAnswerEnvelope`。这些内容没有 Host marker 时只能进入 missing-final-answer / blocked / partial 路径；`nativeCodexMessage` 旧旁路不得在产品代码中恢复。已有 `FinalAnswerEnvelope` 或 Host-owned marker 可以被 UI 确定性投影为 conversation visible answer。

Runtime `gui` module 已退役。`gui_present` / `gui_ask_user` 只能作为 Agent Host public event projection 或 refs-first evidence metadata 出现，不能作为 `module.invoke gui.present` / `module.invoke gui.ask_user` 的 runtime module surface、dynamic tool surface 或 completion surface。

普通聊天接线必须满足：

- Host bridge 只构造 Agent Host input envelope。
- 只有 Host 产出的 structured app module operation ref 可以调用 app module readiness。
- public events 只包含 tokenized refs、safe summaries 和 Host final answer envelope。
- 任何 `gui.present` / `gui.ask_user` / `gui_present` / `gui_ask_user` / `moduleId=gui` completion surface 都必须作为 unsupported dynamic tool fail closed。

### App Module Contract 约束

最小 contract 是 `moduleId`、`canHandle(refs)`、`normalizeObservation(refs)`、`getCapabilities()` 和 `checkReadiness(operation, refs)`。`checkReadiness` 的输入只能是 Agent Host 已决定的一个 operation 和 current-run refs；contract 不暴露自然语言 task 字段。

默认 Agent Host materializer 只在 structured Host target 里出现 app module operation 时调用 registry；裸 `commandText`、terminal output、command palette item 或 act completed status 都不能触发 app module operation 推断。

`checkReadiness` 的输出只能是：

- `ready` + 一个 Computer Use primitive candidate + evidence refs。
- `blocked` + reason ref + evidence refs。
- `needs-confirmation` + reason ref + evidence refs。

readiness validator 必须拒绝 top-level 或 nested action payload 中的 final-answer 字段、completion truth 字段、raw/base64/provider payload、raw command、raw path、URL、raw screenshot path。key 检测必须覆盖 camelCase、snake_case 和 kebab-case alias；value 检测必须覆盖裸 base64、HTML/DOM、本地绝对路径等 raw payload。即使 action payload 不会直接展示给用户，也不能成为隐藏聊天旁路或大对象旁路。

阶段推进必须递进，不能一步跳到完整 VSCode co-work 或论文编辑。P0/P1/P2 的旧任务展开不再作为继续执行的 checklist 保留，只保留已验收基线；新的可执行路线从 P3 开始：

- P3：接 ordinary chat Host-only bridge，要求裸自然语言只能进入 Agent Host，不能直接成为 app module operation。
- P4：接 native route final-answer gate，要求只有 Host-owned final answer envelope 可以让 route `done`。
- P5：统一 public event / readiness / runtime result sanitizer，确保大对象和 raw payload 只能以 refs 暴露。
- P6：进入 VSCode read-only / focus / diagnostics live diagnostic 基线。
- P7：进入 VSCode terminal 和 command palette 分步 live diagnostic，submit/select 必须和 observe 分离。
- P8：进入 VSCode editor mutation diagnostic，先 unit，再 scratch / explicit live，不做论文级改写。
- P9：进入 Host-owned preview 与 narrow apply，先 diff preview，不写文件，再由 Host 拆成 observe -> one primitive -> observe。

P2 入口清单的当前真相源是 [`ComputerUseEntryRouteAudit.md`](ComputerUseEntryRouteAudit.md)。后续 P3/P4/P5 必须在这份清单上迁移、删除或 fail close，不能新增未登记旁路。

## VSCode App Module v1

VSCode 是第一个 app module 目标。v1 聚焦用户已打开 VSCode 的 co-work，不要求固定布局或固定插件集合。泛化策略是稳定概念、能力探测和多证据确认，而不是坐标脚本。

### 设计口径

- 不假设 editor、terminal、explorer、problems panel 或插件 webview 的固定位置。
- 用 app/process/window/title/frontmost refs、AX refs、visible text refs、image refs、file refs、editor/terminal/palette element refs、action refs 和 freshness refs 组合证明目标。
- 只要证据足够即可；不要求每一步都视觉验证。
- 证据冲突或不足时返回 `needs-confirmation` / `blocked`，不能猜测。
- 未知插件 webview 默认是未知区域，除非 refs 足以证明它就是 Host 选择的目标。
- 当前 co-work session 采用 Agent full-access 口径。
- VSCode App Module v1 自身不做 permission / confirmation gate；它只做 refs-first、目标唯一性、原子性、evidence 和 cleanup gate。
- 若未来存在全局 Host hard-confirm policy，它仍属于 Agent Host 风险层，不属于 VSCode module。

### v1 能力目录

```text
Editor:
  read-visible-text
  focus-editor
  move-cursor
  insert-draft
  replace-selection
  save-current-file
  undo-last-action
  redo-last-action

Diagnostics:
  show-problems
  read-diagnostics

Terminal:
  focus-terminal
  send-terminal-text
  observe-terminal
  submit-terminal-command
  interrupt-terminal-command
  clear-terminal
  focus-editor-from-terminal

Command Palette:
  open-command-palette
  send-command-palette-query
  observe-command-palette-items
  select-command-palette-item
  close-command-palette
```

Terminal 必须按 refs-first 分步优先：

```text
focus-terminal
  -> send-terminal-text
  -> observe-terminal
  -> submit-terminal-command
  -> observe-terminal
```

`send-terminal-text` 只把 `text-ref:` 输入到唯一 terminal，不按 Enter；`submit-terminal-command` 只提交当前 terminal 输入，不携带 raw command。命令语义、运行结果和下一步修复由 Agent Host 基于后续 observe refs 判断。

Command Palette 也必须分步：

```text
open-command-palette
  -> send-command-palette-query
  -> observe-command-palette-items
  -> select-command-palette-item
  -> observe
```

Command Catalog 是稳定性目录，不是权限系统。VSCode module 不接受模型随意传入的 raw command id；Host 必须基于 allowlisted capability 或当前 observe 产生的 command palette item refs 选择下一步。VSCode module 只验证 item ref 来自 current observe，并把选择映射为一个原子 primitive。

### v1 Readiness Gate

每个 VSCode operation 至少要检查：

- active session ref。
- selected window ref。
- app/process/window/title/frontmost identity refs。
- current observe ref 与 freshness ref。
- 目标区域 refs，例如 editor element、terminal element、command palette item。
- 需要文件目标时，selected `file-ref:` 必须来自 current observe。
- 需要输入内容时，只接受 `text-ref:`，不接受 raw text / raw command。
- Host decision/action evidence 必须绑定同一个 session、window 和目标 refs。
- before/after evidence 必须能证明动作没有漂移到其它窗口、文件、terminal 或 palette。
- release evidence 必须包含 input lease、adapter、cursor、front app 和 mouse restoration refs。

缺少关键 refs、refs 混用 raw payload、目标不唯一或 evidence 冲突时，返回 `blocked` / `needs-confirmation`，不能 silent-drop 后继续执行。

## 风险与确认

Computer Use 可以识别动作风险并返回 `needs-confirmation`，但不能自己决定高风险动作是否应该执行。确认由调用方收集；Computer Use 只在策略要求 confirmation 时验证 approval ref 是否匹配当前 action risk envelope。

当前 VSCode co-work 采用 Agent full-access 口径：本地文件系统、用户 VSCode profile 和用户已打开工作区属于正常协作范围。保存用户真实文件、撤销用户编辑、批量替换或跨文件修改不再因为真实文件 / 保存 / 批量 / 跨文件本身要求 confirmation。

full-access 不改变 refs-first：

- Host 仍必须绑定 current session、target window、editor / terminal / palette target、selected file 或 item refs、Host decision/action evidence。
- 批量 / 跨文件不能作为 Computer Use core batch plan 执行，必须由 Host 基于每次 observe refs 拆成多次单步 primitive。
- VSCode App Module v1 不做 permission / confirmation gate；若有全局 hard-confirm policy，仍由 Agent Host 风险层拥有。

## Evidence 原则

改变界面的 action 必须记录：

- current target-bound before observation ref。
- scoped executor event ref。
- session-scoped input adapter ref 和 cursor ref。
- input event ref，若 action 使用真实输入。
- after observation ref，若 action 会改变界面或 Host 要求 capture-after。
- stale invalidation refs。

`run_procedure` 必须保留每个 step 的 primitive refs、executor event refs 和 invalidated refs，不能只返回 procedure-level summary。

保存、导出和用户级产物必须额外由 artifact refs / validator refs 支撑。Computer Use 不拥有这些 validator；它只能产出 GUI action evidence。

raw screenshot、raw AX tree、raw visible text、raw command、raw path、raw provider payload、data URL、base64、API key 和 secret 不得进入 primitive body 或 public diagnostics。

## 局部感知原则

Computer Use primitive 默认不调用模型。

如果某个 adapter 需要模型或其它感知组件做局部辅助，它只能作为 observation provider 或 translator 输出 refs-first observation，例如截图 / crop 描述、AX / visible text compression、候选目标摘要或 before / after 差异摘要。

这类局部感知组件不能在 Computer Use 内部：

- 输出最终执行坐标。
- 改变 risk policy。
- 绕过 confirmation。
- 自动 repair。
- 产出 completion truth。
- 生成 final answer。

调用方可以读取 Computer Use refs 后自行调用模型或 verifier；这不属于 Computer Use primitive 内部职责。VSCode focused-editor、terminal、command palette 或 mutation 证明遵守同一原则：视觉、AX、文本、图像或其它观察能力都只能在 Host / verifier 边界消费 refs 并输出新的安全 evidence refs。

## 能力成熟度

每项能力都要标清成熟度，避免把 contract、fixture 或 diagnostic path 误认为产品能力。

- `contracted`：primitive schema、validator、result envelope 和风险边界已经定义。
- `unit-proven`：contract test 证明 validator、状态机、风险门和 evidence refs 正常。
- `live-diagnostic`：能在真实桌面上跑通，但仍可能依赖共享系统输入、测试专用窗口或诊断适配器。
- `product-ready`：走 session-local input adapter，真实桌面验收通过，执行后无窗口、进程、临时文稿或 artifact 残留。
- `blocked`：平台或 adapter 暂时不能满足隔离、证据或清理要求，必须说明缺口和恢复条件。

只有 `product-ready` 能作为 Computer Use 产品路径能力对外声明。其它状态只能用于开发、调试或风险说明。

当前状态摘要：

- App Module Registry contract 是 `unit-proven`。
- VSCode App Module skeleton、read-only、focus、editor mutation、terminal 和 command palette readiness 是 `unit-proven`。
- Agent Host app-module dry-run materializer 是 `unit-proven`：它能根据 current-run refs 选择 VSCode module 并返回 primitive candidate，也能对 unknown / ambiguous app fail closed。
- Computer Use no-bypass static guard 是 `unit-proven`：它禁止 GUI completion surface、retired runtime `gui` module surface、legacy Computer Use public surface，以及 ordinary/native direct app module 或 act materializer imports。
- Runtime `gui` module handler 已删除；默认 module registry 不列出 `gui`，外部注入 `gui` handler 也会 fail closed。
- VSCode default / env-gated diagnostics 只能标 `live-diagnostic`，不能声明 `product-ready`。
- 普通聊天 / native route 接线审计仍待完成，必须先于真实 VSCode live matrix。
- 真实当前 VSCode 前台窗口 live matrix 尚未全部跑完，未跑过的 env gate 不能打完成勾。
- 论文 preview、narrow apply unit path 和 narrow apply diagnostic 仍待实现。

## 旧路径清理口径

旧逻辑和最终目标冲突时，删除旧逻辑，直接实现新版本；不新增 legacy alias、compatibility wrapper、fallback shortcut 或历史 run 转译路径。

旧路径包括 runtime `gui` module / `module.invoke gui.*`、`executeBoundedOperation`、`computer_use.perform_local_action`、`computer_use.fill_fields`、`computer_use.runTask(request, hostPorts)`、`plan`、`locate`、`verify` 等。

清理目标：

- `perform_local_action` 拆为 `bind` / `observe` / `act`。
- `fill_fields` 由调用方多次调用 `act(type/key/click)` 表达，或在调用方已明确步骤后使用 `run_procedure` 降低往返。
- `runTask` 不进入新 MCP public surface，也不新增内部 legacy alias、compatibility wrapper 或自动转译。
- 无智能局部组合能力进入 `run_procedure`；它只执行 Host 指定的结构化步骤序列。
- `plan` 移到调用方。
- `locate` 变成调用方对 observation refs 的选择；Computer Use 只接受 element ref / point。
- `verify` 移到调用方 / verifier / artifact validator。
- 每个软件的专门优化迁移到 Host-side App Capability Module，不进入 Computer Use core。

历史或诊断引用只能用于拒绝、迁移审计或 evidence invalidation，不能作为执行路径、自动转译路径或 completion truth。

## 用户级验收

Computer Use 只能提供局部执行证据，不能单独提供用户级验收。

真实桌面验收可以操作本地应用，但必须默认去除自身副作用：关闭自己创建的临时窗口 / 文稿，释放 session / input lease，退出自己启动且无用户文稿的应用，并删除临时 evidence artifacts。只有显式 debug / keep 开关可以保留这些产物，且保留路径必须清晰标记。

可作为 Computer Use 局部证据的对象：

- current-run `bind` / `observe` / `act` / `run_procedure` evidence refs。
- scoped executor event refs。
- before / after observation refs。
- stale invalidation refs。
- 必要时由调用方关联的 artifact refs / validator refs。

禁止把这些对象当作产品 truth：

- GUI projection。
- Image / Evidence pane。
- screenshot replay。
- frame stream。
- fixture。
- package probe。
- legacy VirtualAppScreen / Docker / noVNC / RDP / Xpra。
- 历史 run。
- 单步 action ref。
- 历史 `runTask` 记录或 legacy 拒绝记录里的 `status=completed`。
- `run_procedure` 的 `status=completed`，除非调用方另有 current-run completion truth 和必要 artifact / validator refs。

## 契约真相源

长期 contract、MCP tool schema、validator 和测试应放在：

- `packages/actions/computer-use/index.ts`
- `packages/actions/computer-use/mcp.ts`
- `packages/actions/computer-use/action-provider.manifest.json`
- `packages/actions/computer-use/*.test.ts`

Host-side App Capability Module 的 contract / registry 落地后，应拥有独立的 Host-side contract 和 tests；Computer Use core contract 不因 VSCode module 扩大。

## 相关文档

- [`Architecture.md`](Architecture.md)：总架构和 Computer Use 上下游边界。
- [`BrowserRuntimeArchitecture.md`](BrowserRuntimeArchitecture.md)：Browser primitive runtime 的同构设计。
- [`ComputerUseEntryRouteAudit.md`](ComputerUseEntryRouteAudit.md)：ordinary chat、native route、slash command 和旧 hook 的入口清单。
