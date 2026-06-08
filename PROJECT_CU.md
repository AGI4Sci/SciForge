# SciForge Computer Use 当前任务

最后更新：2026-06-09

## 当前目标

把 Computer Use 收敛成一个通用 refs-first GUI primitive runtime，并在它之上实现可插拔的 Host-side App Capability Module。第一个专门模块是 VSCode；目标是让 Agent Host 能和用户已打开的 VSCode 协作，但不衍生第二个 agent、聊天旁路或历史兼容包袱。

本文件是继续推进的任务路线图，不是旧任务存档。旧逻辑和新方案冲突时，删除旧逻辑或 fail closed，直接实现新版本；不做 legacy alias、compatibility wrapper、fallback shortcut 或历史 run 转译路径。

## 不可变原则

每个阶段打勾前都要重新确认这些原则仍成立：

- 旧逻辑代码和最终目标冲突时，删除旧逻辑，直接实现新版本，不做兼容，保持代码干净。
- 所有修改必须通用，不能为当前页面、截图、URL、文件名、agent id 或历史 run 写硬编码补丁。
- 大对象必须 refs-first；截图、图片、provider payload、trace、日志和 artifact 不得作为 raw/base64 长期进入聊天正文或主上下文。
- LLM API 配置使用 `/Applications/workspace/ailab/research/app/SciForge/config.local.json`。
- 在能提高时间效率的前提下，尽可能使用 sub agent 并行推进；并行任务必须拆清边界，避免不同 worker 修改同一文件造成冲突。
- SciForge 对话、工作链路需要统一，不要额外生出旁路。
- 符合 `docs/Architecture.md` 设计原则；如果继续推进会导致混乱、衍生旁路、设计方案不合理、有相互冲突的点，或有更简洁通用的实现方案，需要停下来和用户讨论。
- Computer Use core 只保留 `bind`、`observe`、`act`、`run_procedure`、`control`。
- `run_procedure` 只执行 Host 已明确给出的局部结构化步骤，不接受自然语言 task / goal / instruction。
- Host 根据 current-run observe refs 决定下一步单个 primitive；Computer Use core 不做 task planning、semantic locate、repair、verification 或 final answer。
- App module 不接受自然语言任务，不调用模型生成执行决策，不生成用户级 final answer。
- ordinary chat、native route、app module、terminal 和 command palette 不能直答；用户级 final answer 只能来自 Codex / Agent Host。
- raw screenshot、raw AX tree、raw visible text、raw command、raw path、provider payload、URL、base64、secret 不得进入 public result。
- 多窗口、目标不唯一、证据冲突或 observation stale 时必须 `needs-confirmation` / `blocked`。
- 不要求每一步都视觉验证；AX、text、title、image、file、editor、action、freshness 等证据足够即可。
- 当前 VSCode co-work session 采用 Agent full-access 口径；保存真实文件、批量替换、跨文件修改本身不作为 confirmation gate。
- full-access 不改变 refs-first：每一步仍必须绑定 current session、target window、editor / terminal / palette target、selected file 或 item refs、Host decision/action evidence。
- 运行后必须 release input lease / adapter / cursor，并恢复前台焦点和鼠标位置。
- 不杀用户 VSCode，不清用户 VSCode profile。
- 共享系统输入路径只能标 `live-diagnostic`，不能宣称 `product-ready`。

## 已验收基线

这里仅记录已经沉淀下来的事实，不再展开成继续执行的旧 checklist：

- Host-side App Capability Module contract / registry 已 unit-proven；Computer Use core 不 import VSCode module。
- VSCode stable concept model、sanitizer、readiness gate 和 atomic capability catalog 已 unit-proven。
- read-only、focus、editor mutation、terminal、command palette readiness 已 unit-proven。
- Agent Host dry-run materializer 已 unit-proven：它不会从裸 `commandText`、terminal output、palette item 或 act completed status 推断 completion。
- 普通聊天 / native route 入口审计已完成；裸 ordinary VSCode 文本不能直接启动 native live diagnostic。
- Native route final-answer gate 已 unit-proven：没有 Host-owned final-answer evidence 时只能 `partial` / `blocked`，不能 `done`。
- Shared public event sanitizer 已存在，并已接入第一批 native route / runtime gateway public projection。
- 无旁路静态护栏已 unit-proven：GUI completion surface、retired runtime `gui` module、legacy Computer Use public surface、ordinary/native direct import 和 readiness final-answer/raw payload 泄漏都会 fail closed。

这些基线如果后续和新方案冲突，按不可变原则处理：删除、收口或 fail closed，不保留兼容层。

## 新方案边界

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

结论：

- 每个软件的专门优化做成可插拔 App Capability Module。
- App module 属于 Agent Host 能力层，不是 Computer Use core plugin。
- App module 是软件状态模型、能力目录和证据门，不是第二个 agent。
- 智能载体仍然是 Agent Host；需要模型能力时由 Host 调 Model Router 或 Host-owned verifier/provider。
- App module 只回答 Host 已决定的一个 operation 在当前 refs 下是否 ready，或应 `blocked` / `needs-confirmation`。

## VSCode App Module v1

VSCode v1 聚焦用户已打开 VSCode 的 co-work，不依赖固定坐标、固定布局或固定插件集合。

模块提供：

- VSCode app / process / window / bundle identity refs。
- 通用 observation refs 到 VSCode 稳定概念的归一化。
- 多窗口、多 editor group、多 terminal、未知 webview、stale observation 的 ambiguity gate。
- allowlisted atomic capability catalog。
- primitive readiness：把 Host 已决定的 operation 转成一个 Computer Use primitive candidate，或返回 `blocked` / `needs-confirmation`。
- focused-editor、same-file、mutation、save、diagnostics、terminal、command palette 的 Host-owned evidence provider / verifier 接入点。
- refs-first public projection；不输出 raw payload。

稳定概念：

- VSCode window。
- workspace / folder。
- active editor。
- editor group。
- active file。
- selection / cursor。
- terminal。
- command palette。
- explorer / search / source control / problems panel。
- diagnostics。
- unknown extension webview。
- observation freshness。

能力目录：

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

Terminal 分步：

```text
focus-terminal
  -> send-terminal-text
  -> observe-terminal
  -> submit-terminal-command
  -> observe-terminal
```

Command Palette 分步：

```text
open-command-palette
  -> send-command-palette-query
  -> observe-command-palette-items
  -> select-command-palette-item
  -> observe
```

## 新任务路线

路线原则：

- 从当前状态继续，不保留旧 P3-P9 的展开执行项。
- 每个 checkbox 必须对应可证明的代码、测试、文档、静态扫描或 live diagnostic manifest。
- 一个阶段不能以“完整 VSCode co-work”作为验收目标。
- 旧路径只允许删除或 fail closed；需要的能力直接按新 primitive / Host-owned bridge 实现，不做 compatibility wrapper、legacy alias 或历史 run 转译。
- Unit path 先行，env-gated live diagnostic 后置。
- `blocked` / `needs-confirmation` 是有效验收结果，但必须保留 reason refs、evidence refs 和恢复路径。
- 新阶段按“红测 -> 最小实现 -> 静态护栏 -> 文档/验收”递进；不把一个阶段写成没有中间验收的完整产品目标。

### P0：路线图与架构收口

目标：把任务文件改成新方案的唯一执行路线，删除旧任务包袱。

- [x] `PROJECT_CU.md` 不再保留旧 P3-P9 的展开执行项。
- [x] 已完成工作只作为“已验收基线”记录，不作为继续执行任务。
- [x] 新路线从小闭环开始，按 public projection、旁路删除、lifecycle、VSCode read-only、terminal、palette、mutation、preview/apply 递进。
- [x] 文档明确旧逻辑冲突时删除或 fail closed，不做兼容。

验收：

- [x] 本文件中的继续任务均可单独打勾。
- [x] 没有一步把“完整 VSCode co-work”作为早期验收目标。

### P1：Public Projection 收口

目标：先把会进入聊天、runtime event、TUI/GUI projection、artifact metadata 的结果面收干净。

- [x] 写 app module readiness 红测：nested `stdout` / `commandText` / `requestBody` / `workspacePath` 不能进入 readiness public result。
- [x] app module readiness validator 使用共享 sanitizer 或共享 forbidden raw detector。
- [x] 写 Computer Use action/procedure result 红测：`approvalRequest`、host action metadata、package presentation event 不能泄漏 raw prompt、token、URL、raw path、base64、provider payload。
- [x] Computer Use action/procedure public projection 白名单化：只保留 status、safe summary、reason refs、evidence refs、artifact refs、action refs、approval refs。
- [x] `npm run smoke:computer-use-no-bypass` 覆盖 app module readiness、Computer Use package result、package bridge presentation。

验收：

- [x] app module readiness 单测证明 nested raw action payload 被拒绝或 sanitized。
- [x] Computer Use result 单测证明 objectReferences、logs、runtime event detail 三个出口都无 raw payload。
- [x] static guard 证明新增 public projection surface 不能绕过共享 sanitizer / detector。

### P2：旧旁路删除与 fail-closed

目标：删除会让 SciForge、native route、runtime gateway、GUI module 或 Computer Use 自行回答用户的历史路径。

Build Tasks：

- [x] 写 GUI projection 红测：`gui.present` / `gui.ask_user` / `computer-use.tui-host-actions` 只能保留 metadata、artifact refs、confirmation refs，不能写 `message` 或 `visibleAnswer.text`。
- [x] 实现 GUI projection metadata-only：保留 `guiPresentation` / `guiAskUser` / artifact refs / verification metadata，删除本地 completion text 与 `liveAcceptanceEligible`。
- [x] 写 response normalization 红测：旧 GUI / Computer Use projection text 没有 Host-owned `FinalAnswerEnvelope` 时不能进入 `message.content` / `run.response`。
- [x] 实现 response normalization fail-closed：只信任 Host final answer envelope；legacy GUI / Computer Use projection text 返回 backend failure / missing final-answer summary。
- [x] 写 structured runtime `done` 红测：structured artifacts 可以投影，native `message`、runtime ack 和 fallback summary 不能进入 `visibleAnswer.text`。
- [x] 实现 structured runtime `done` artifacts-only projection：只输出 artifact refs、uiManifest refs、audit refs 和 partial / blocked status。
- [x] 写旧 VSCode operation 推断红测：裸 `message` / `commandText` / terminal output / palette label 不能触发 VSCode operation。
- [x] 保持旧 VSCode operation 推断 fail-closed：只有 Host structured operation ref 能进入 app module readiness。
- [x] 写旧 Computer Use public surface 红测：`runTask` / `perform_local_action` / `fill_fields` / `executeBoundedOperation` 不能重新暴露。
- [x] 保持旧 Computer Use public surface 删除态；需要的局部组合只进入 `run_procedure`。
- [x] 扩展 static guard：覆盖 GUI visible-answer、本地 runtime message completion、legacy public surface、ordinary/native operation text inference。
- [x] 更新 `docs/ComputerUseRuntimeArchitecture.md` 的旧路径清理口径，确保没有兼容层叙述。

验收：

- [x] 单测证明 unsupported legacy GUI completion request fail closed。
- [x] 单测证明 native text / runtime ack / tool local completion 不能铸造 `FinalAnswerEnvelope` 或 visible final answer。
- [x] 单测证明旧 VSCode operation text inference 仍被拒绝。
- [x] 单测证明旧 Computer Use public surface 仍被拒绝。
- [x] `npm run smoke:computer-use-no-bypass` 通过。
- [x] `npm run smoke:no-legacy-paths` 通过；当前仅有既存 T120/T122 warning，非本阶段引入。

### P3：Computer Use Lifecycle Contract

目标：先固化 `bind -> observe -> act/run_procedure -> control release` 的证据和 cleanup 契约，再碰真实 VSCode。

Build Tasks：

- [ ] 写 `bind` 红测：成功时必须产生 session-scoped `inputAdapterRef`、`cursorRef`、`scopedInputLeaseRef`。
- [ ] 实现 / 收口 `bind` refs envelope，未知 target 或多 target 返回 `blocked` / `needs-confirmation`。
- [ ] 写 `observe` 红测：只返回 current target observation refs，不返回 raw screenshot / AX / visible text。
- [ ] 实现 / 收口 `observe` refs-first output 和 stale invalidation。
- [ ] 写 `act` 红测：每次 action 必须产生 executor event refs、after observation refs 或 blocked reason refs。
- [ ] 实现 / 收口 `act` 单 primitive result，不生成 task completion truth。
- [ ] 写 `run_procedure` 红测：每个 step 都保留 primitive refs、executor event refs 和 invalidation refs。
- [ ] 实现 / 收口 `run_procedure` 局部结构化执行；`completed` 只代表 procedure 完成。
- [ ] 写 `control release` 红测：release 必须释放 input lease / adapter / cursor。
- [ ] 实现 cleanup manifest：记录 front app、focus、mouse position restoration refs。

验收：

- [ ] release 缺失时 run 不能被标记为完成。
- [ ] shared-system-input 路径只能标 `live-diagnostic`，不能宣称 `product-ready`。
- [ ] public lifecycle output 经过 shared sanitizer。

### P4：VSCode Target Binding 与 Ambiguity Gate

目标：先只证明能识别当前 VSCode 目标和不确定性，不做输入动作。

Build Tasks：

- [ ] 写 VSCode identity 红测：app / process / window / title / frontmost refs 缺失时不能 ready。
- [ ] 实现 VSCode identity readiness，只返回 refs 和 safe summary。
- [ ] 写 concept normalization 红测：active editor、workspace、selected file、terminal、palette 映射为稳定 concept refs。
- [ ] 实现 concept normalization，不依赖固定坐标、固定布局或固定插件。
- [ ] 写 ambiguity 红测：多 VSCode 窗口、多 editor group、多 terminal、unknown webview、stale observation 必须 blocked / needs-confirmation。
- [ ] 实现 ambiguity gate；唯一目标时只返回下一步 primitive candidate 所需 refs。

验收：

- [ ] 单测证明不同布局 / 插件缺失不会走坐标硬编码。
- [ ] 单测证明多窗口或目标不明确时不会猜测。
- [ ] readiness result 无 raw visible text、raw path、raw URL、provider payload。

### P5：VSCode Read-only / Focus / Diagnostics Diagnostic

目标：进入真实 VSCode 前台窗口的只读和 focus 诊断，不做写入。

Build Tasks：

- [ ] 写 `read-visible-text` dry-run 红测：只输出 visible-text refs，不输出 raw text。
- [ ] 实现 `read-visible-text` readiness。
- [ ] 写 `focus-editor` dry-run 红测：目标唯一才 ready，目标不唯一 blocked / needs-confirmation。
- [ ] 实现 `focus-editor` readiness。
- [ ] 写 `show-problems` / `read-diagnostics` dry-run 红测。
- [ ] 实现 diagnostics readiness，只输出 diagnostics refs。
- [ ] 新增 env-gated live harness，默认关闭，显式 env 才运行。
- [ ] live run 记录 before refs、after refs、action refs、release refs 和 cleanup refs。

验收：

- [ ] 每个 manifest 都是 `live-diagnostic` / `productReady=false`。
- [ ] read-only current-window live diagnostic 通过或 blocked-safe，并保留 reason refs。
- [ ] focus-editor current-window live diagnostic 通过或 blocked-safe，并保留 before/after focus refs。
- [ ] 每个 run 都 release input lease / adapter / cursor，恢复前台 app 和鼠标位置。
- [ ] stdout、manifest、public events 不泄漏 raw text、raw path、raw screenshot、provider payload、base64。

### P6：VSCode Terminal 原子能力

目标：Terminal 只做分步 primitive，send 和 submit 分离。

Build Tasks：

- [ ] 写 `focus-terminal` dry-run 红测：多 terminal 或 terminal 未定位时 blocked / needs-confirmation。
- [ ] 实现 `focus-terminal` readiness。
- [ ] 写 `send-terminal-text` dry-run 红测：只接受 Host 提供的 `text-ref:`，不按 Enter。
- [ ] 实现 `send-terminal-text` primitive candidate。
- [ ] 写 `observe-terminal` dry-run 红测：只输出 terminal evidence refs，不输出 raw output。
- [ ] 实现 `observe-terminal` refs-first projection。
- [ ] 写 `submit-terminal-command` dry-run 红测：只提交 current terminal input ref，不携带 raw command。
- [ ] 实现 `submit-terminal-command` primitive candidate。
- [ ] env-gated live 按 `focus -> send -> observe -> submit -> observe -> cleanup` 分步运行。

验收：

- [ ] Unit tests 证明 raw command 被拒绝。
- [ ] Live diagnostic 证明 terminal focus / send / observe / submit 分离，或 blocked-safe。
- [ ] terminal 目标漂移或多 terminal 不唯一时 `needs-confirmation` / `blocked`。
- [ ] cleanup refs 完整，不杀 VSCode，不清 profile。

### P7：VSCode Command Palette 原子能力

目标：Command Palette 只做 current observe item ref 的选择，不让 raw command id 变成执行旁路。

Build Tasks：

- [ ] 写 `open-command-palette` dry-run 红测：唯一 VSCode window 才 ready。
- [ ] 实现 `open-command-palette` readiness。
- [ ] 写 `send-command-palette-query` dry-run 红测：只接受 `text-ref:`。
- [ ] 实现 `send-command-palette-query` primitive candidate。
- [ ] 写 `observe-command-palette-items` dry-run 红测：只输出 item refs，不输出 raw label / raw command id。
- [ ] 实现 `observe-command-palette-items` refs-first projection。
- [ ] 写 `select-command-palette-item` dry-run 红测：只接受 current observe item ref。
- [ ] 实现 `select-command-palette-item` primitive candidate。
- [ ] env-gated live 按 `open -> send query -> observe items -> select item -> observe -> close/cleanup` 分步运行。

验收：

- [ ] Unit tests 证明 raw command id / raw palette label 不能直接执行。
- [ ] Live diagnostic 证明 item ref 来自 current observe，或 blocked-safe。
- [ ] palette 目标漂移、item 不唯一或 observation stale 时 `needs-confirmation` / `blocked`。
- [ ] cleanup refs 完整，不留下 palette 或焦点漂移。

### P8：VSCode Editor Mutation 原子能力

目标：最后才进入写入 primitive，但仍只做当前选区或 Host 明确范围的一步动作。

Build Tasks：

- [ ] 写 `insert-draft` dry-run 红测：只能基于 current selection / cursor refs 和 `text-ref:`。
- [ ] 实现 `insert-draft` primitive candidate。
- [ ] 写 `replace-selection` dry-run 红测：只能基于 current selection refs 和 `text-ref:`。
- [ ] 实现 `replace-selection` primitive candidate。
- [ ] 写 `save-current-file` dry-run 红测：需要 same-file、mutation 和 current editor refs。
- [ ] 实现 `save-current-file` readiness。
- [ ] 写 drift 红测：文件、选区、editor group 或目标窗口漂移时 blocked-safe。
- [ ] env-gated live mutation 优先使用 scratch 或用户明确选择的当前选区。

验收：

- [ ] Unit tests 证明 raw selected text / raw file path 不能进入 public result。
- [ ] Unit tests 证明多章节、全文、跨文件修改不会变成单个 Computer Use task。
- [ ] explicit live diagnostic 证明 before/after/action/mutation/cleanup refs 完整，或 blocked-safe。
- [ ] full-access 文件操作不触发类别式 confirmation gate，但仍要求 current refs 和 Host evidence。

### P9：Host-owned Preview / Narrow Apply

目标：把编辑协作变成 Host-owned preview 和窄范围 apply，而不是 Computer Use task planning。

Build Tasks：

- [ ] 写 preview scope 红测：只支持当前选区或 Host 明确选择的单个范围；范围不明确时 `needs-confirmation`。
- [ ] 实现 preview v1：输出 draft / diff artifact refs，不调用 VSCode 写入 primitive。
- [ ] 写 narrow apply 红测：明确 apply 时只能生成一个 `replace-selection` 或 `insert-draft` primitive candidate。
- [ ] 实现 narrow apply Host bridge：拆成 `observe -> one primitive -> observe`。
- [ ] 写 apply verification 红测：apply 后必须有 same-file、mutation、cleanup refs。
- [ ] 实现 final projection：final answer 只能来自 Agent Host，并引用 artifact refs / evidence refs。

验收：

- [ ] “润色当前选区”先返回 diff preview，不写文件。
- [ ] 明确应用当前选区会生成一个 `replace-selection` primitive candidate。
- [ ] 多章节、全文、跨文件修改被 Host 拆成多次单步 primitive，不进入 Computer Use core planning。
- [ ] public events 不泄漏 raw selected text、raw path、raw command 或 provider payload。
- [ ] 真实桌面路径只标 `live-diagnostic`，不能宣称 `product-ready`。

## 验收规则

- 单个 `[x]` 只表示该 checkbox 对应的 Build Task 或 Acceptance Gate 已被当前证据覆盖。
- 一个阶段只有在该阶段任务和验收项全部为 `[x]` 时才算完成。
- 单元测试通过但没有 live acceptance，不能打真实桌面完成勾。
- live acceptance 通过但留下窗口、进程、临时文件、artifacts、input lease、cursor 或 adapter，不能打勾。
- 共享系统鼠标 / 键盘路径不能打 `product-ready`。
- blocked 也可以作为验收结果，但必须说明缺失条件、保留 refs，并给出恢复路径。

## 文档地图

- [`docs/Architecture.md`](docs/Architecture.md)：SciForge 总体架构和唯一 Agent Host 边界。
- [`docs/ComputerUseRuntimeArchitecture.md`](docs/ComputerUseRuntimeArchitecture.md)：Computer Use runtime 与 Host-side App Module 最新设计原则。
- [`docs/ComputerUseEntryRouteAudit.md`](docs/ComputerUseEntryRouteAudit.md)：ordinary chat、native route、runtime gateway、slash command 和旧 VSCode co-work hook 的入口审计。
- [`packages/actions/computer-use`](packages/actions/computer-use)：Computer Use contract、MCP adapter、tests 和 package metadata。
