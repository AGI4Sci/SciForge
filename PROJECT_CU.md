# SciForge Computer Use 当前任务

最后更新：2026-06-09

## 当前目标

把 Computer Use 收敛成一个通用 refs-first GUI primitive runtime，并在它之上实现可插拔的 Host-side App Capability Module。当前第一个专门模块是 VSCode；目标是让 Agent Host 能和用户已打开的 VSCode 协作，但不衍生第二个 agent、聊天旁路或历史兼容包袱。

Computer Use core 只执行 Host 指定的 primitive。Agent Host 负责理解用户任务、选择目标、调用模型、选择 app module、决定下一步、判断 completion truth 和生成 final answer。

## 不可变架构原则

这些原则不是完成态 checkbox。每次阶段打勾前都要重新确认它们仍被满足。

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

## 新方案

采用 Host-side App Capability Module Registry。

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

模块职责：

- 注册 VSCode app / process / window / bundle identity refs。
- 把通用 observation refs 归一成 VSCode 稳定概念。
- 判断目标是否唯一，识别多窗口、多 editor group、多 terminal、未知 webview、stale observation。
- 暴露 allowlisted atomic capability catalog。
- 提供 primitive readiness：把 Host 已决定的 operation 转成一个 Computer Use primitive，或返回 `blocked` / `needs-confirmation`。
- 提供 Host-owned focused-editor、same-file、mutation、save、diagnostics、terminal、command palette evidence provider / verifier 的接入点。
- 只输出安全 tokenized refs，不输出 raw payload。

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

## 已验收基线

以下是当前代码和测试已经覆盖的事实摘要。旧任务展开不再保留为继续执行的 checklist。

- Host-side App Capability Module contract / registry 已 unit-proven；Computer Use core 不 import VSCode module。
- VSCode stable concept model、sanitizer、readiness gate 和 atomic capability catalog 已 unit-proven。
- read-only、focus、editor mutation、terminal、command palette readiness 已 unit-proven。
- Agent Host dry-run materializer 已 unit-proven：它不会从裸 `commandText`、terminal output、palette item 或 act completed status 推断 completion。
- 无旁路静态护栏已 unit-proven：GUI completion surface、retired runtime `gui` module、legacy Computer Use public surface、ordinary/native direct import 和 readiness final-answer/raw payload 泄漏都会 fail closed。
- 普通聊天 / native route P2 入口审计已完成；裸 ordinary VSCode 文本不能直接启动 native live diagnostic。
- public event sanitizer、VSCode live diagnostic、Host-owned preview / apply workflow 仍待实现。

## 新任务路线

路线原则：

- 每个阶段必须能独立验收；不能把“完整 VSCode co-work”作为早期验收目标。
- 每个 checkbox 都必须对应可证明的代码、测试、文档或 live diagnostic 证据。
- 旧路径只允许删除、fail closed 或迁入 Host-owned bridge；不做 legacy alias、compatibility wrapper、fallback shortcut 或历史 run 转译路径。
- Unit path 先行，env-gated live diagnostic 后置；真实桌面路径只能标 `live-diagnostic`。
- `blocked` / `needs-confirmation` 是有效验收结果，但必须保留 reason refs、evidence refs 和恢复路径。

### P3：Ordinary Chat Host-only 接线

目标：普通聊天只能进入 Agent Host。裸自然语言、terminal 输出、palette item 或 action completed status 不能在本地被推断成 VSCode operation 或多步 GUI workflow。

Build Tasks：

- [ ] 普通聊天 hook 只构造 Codex / Agent Host input envelope，不直接调用 VSCode module、Computer Use act 或 native live runner。
- [ ] 删除或 fail closed 通过 `message` / `commandText` / prompt 文本推断 VSCode operation 的旧逻辑。
- [ ] 只有 Host structured operation ref 可以调用 AppModuleRegistry / VSCode module readiness。
- [ ] terminal output、command palette item、action completed status 只能作为 evidence refs，不触发下一步 operation。
- [ ] 更新 `docs/ComputerUseEntryRouteAudit.md`，把 P3 迁移和删除项标清。

Acceptance Gates：

- [ ] Unit tests 证明 ordinary chat 裸文本不能绕过 Host 进入 VSCode module。
- [ ] Unit tests 证明裸 `message` / `commandText` 不能推断 `read-visible-text`、`focus-editor` 或 live diagnostic。
- [ ] Unit tests 证明 terminal / palette / action refs 只能作为 evidence，不会变成下一步 operation。
- [ ] Unit tests 证明 structured Host operation ref 可以走 dry-run，并且只返回 primitive candidate / readiness refs。

### P4：Native Route Final-answer Gate

目标：native route 只能投影 Host events / `FinalAnswerEnvelope`。没有 same-run Host final-answer evidence 时，只能 `blocked` / `partial`，不能 `done`。

Build Tasks：

- [ ] 定义 native route 可接受的 Host-owned final-answer evidence marker。
- [ ] native route result 只接受 Codex / Agent Host 的 final answer envelope。
- [ ] Computer Use / app module / runtime local result 只能作为 refs-first evidence。
- [ ] 删除 runtime-local answer synthesis、completion ack 或 fallback answer。
- [ ] runtime gateway / slash command 的本地 completion fallback 同步 fail closed 或迁入 Host-owned event projection。

Acceptance Gates：

- [ ] Unit tests 证明 live diagnostic runner 返回 `completed` 但没有 Host final-answer evidence 时，native route 不能 `done`。
- [ ] Unit tests 证明 app module readiness、single action completed、`run_procedure.status=completed` 都不能成为 final answer。
- [ ] Unit tests 证明 runtime gateway 空响应不会合成本地 fallback answer。
- [ ] Unit tests 证明 public events 只包含 tokenized refs、blocked / partial 状态和 Host-owned final answer envelope。

### P5：公共事件与大对象 Sanitizer

目标：把 ordinary chat、native route、Computer Use result 和 app module readiness 的 public projection 统一成 refs-first 输出。

Build Tasks：

- [ ] 列出所有 public projection surface：ordinary chat events、native route events、runtime gateway events、app module readiness、Computer Use result。
- [ ] 实现共享 public event sanitizer，递归覆盖 action payload、metadata、diagnostic payload 和 error payload。
- [ ] sanitizer 拒绝 screenshot、image、AX tree、visible text、provider payload、trace、日志、artifact raw body、URL、raw path、raw command、base64、secret。
- [ ] 大对象只保留 artifact refs / evidence refs / compact observation refs，不进入聊天正文或主上下文。
- [ ] blocked / partial / error 路径也只输出 reason refs 和安全摘要。

Acceptance Gates：

- [ ] Unit tests 覆盖 top-level 和 nested raw/base64/provider payload 泄漏。
- [ ] Unit tests 覆盖 blocked / partial / error 路径不泄漏 raw 证据。
- [ ] Static tests 覆盖 public event 不能包含 raw screenshot path、data URL、raw command、raw path。
- [ ] `npm run smoke:computer-use-no-bypass` 覆盖新增 public projection surface。

### P6：VSCode Read-only Live Diagnostic 基线

目标：先跑真实 VSCode 的无写入 live diagnostic，证明目标识别、观察、focus 和 cleanup 能在真实桌面上闭环。

Build Tasks：

- [ ] unit dry-run 覆盖 `read-visible-text` current-window readiness。
- [ ] unit dry-run 覆盖 `focus-editor` current-window readiness。
- [ ] unit dry-run 覆盖 `show-problems` / `read-diagnostics` blocked-safe readiness。
- [ ] env-gated live diagnostic harness 默认关闭，显式 env 才运行。
- [ ] live run 记录 before refs、after refs、action refs、release refs 和 cleanup refs。

Acceptance Gates：

- [ ] 每个 manifest 都是 `live-diagnostic` / `productReady=false`。
- [ ] read-only current-window live diagnostic 通过或 blocked-safe，并保留 reason refs。
- [ ] focus-editor current-window live diagnostic 通过或 blocked-safe，并保留 before/after focus refs。
- [ ] 每个 run 都 release input lease / adapter / cursor，恢复前台 app 和鼠标位置。
- [ ] stdout、manifest、public events 不泄漏 raw text、raw path、raw screenshot、provider payload、base64。

### P7：VSCode Terminal / Command Palette 分步 Diagnostic

目标：在 P6 通过后验证 terminal 和 command palette 的单步能力；submit/select 必须和 observe 分离，不做软件级任务。

Build Tasks：

- [ ] `focus-terminal` live diagnostic。
- [ ] `send-terminal-text` live diagnostic，只发送 Host 提供的 text ref，不提交。
- [ ] `observe-terminal` live diagnostic，输出 terminal evidence refs。
- [ ] `submit-terminal-command` 单独 gate，只提交 current input ref，不携带 raw command。
- [ ] `open-command-palette` / `send-command-palette-query` / `observe-command-palette-items` live diagnostic。
- [ ] `select-command-palette-item` 只接受 current observe item ref，目标不唯一时 blocked / needs-confirmation。
- [ ] `close-command-palette` cleanup diagnostic。

Acceptance Gates：

- [ ] Terminal live 证明 focus / send / observe / submit 分离。
- [ ] Command palette live 证明 item ref 来自 current observe。
- [ ] terminal / palette / focus 漂移时 blocked / needs-confirmation。
- [ ] 所有 manifest 都是 `live-diagnostic` / `productReady=false`，且 cleanup refs 完整。
- [ ] 不杀 VSCode，不清 profile，不保留未说明的临时窗口 / artifact。

### P8：VSCode Editor Mutation Diagnostic

目标：在 P6/P7 的目标识别和 cleanup 可靠后，再验证 editor 写入类单步 primitive。先 unit，再 scratch / explicit live，不做论文级改写。

Build Tasks：

- [ ] unit dry-run 覆盖 `insert-draft` current-selection primitive candidate。
- [ ] unit dry-run 覆盖 `replace-selection` current-selection primitive candidate。
- [ ] unit dry-run 覆盖 `save-current-file` same-file / mutation readiness。
- [ ] live diagnostic 优先使用 scratch 或用户显式选择的当前选区；文件、选区或目标漂移时 blocked / needs-confirmation。
- [ ] `save-current-file` live diagnostic 单独 env gate，必须绑定 same-file、mutation 和 Host action refs。
- [ ] 每次写入后执行 observe，记录 before/after/action/mutation/cleanup refs。

Acceptance Gates：

- [ ] Unit tests 证明 insert / replace / save 都只生成一个 primitive candidate。
- [ ] Unit tests 证明文件、选区或目标漂移时 blocked / needs-confirmation。
- [ ] explicit live diagnostic 通过或 blocked-safe，并保留 before/after/action/mutation refs。
- [ ] save live diagnostic 不默认运行；显式运行时保留 same-file 和 cleanup refs。
- [ ] public events 不泄漏 raw selected text、raw path、raw command 或 provider payload。

### P9：Host-owned Preview 与 Narrow Apply

目标：最后才进入论文/文本协作。先 preview，不写文件；再 narrow apply，只应用当前选区或单个明确范围。

Build Tasks：

- [ ] preview v1 只支持当前选区或 Host 明确选择的单个范围；范围不明确时 `needs-confirmation`。
- [ ] preview 输出 draft / diff artifact refs，不调用 VSCode 写入 primitive。
- [ ] preview v1 先覆盖 plain text / Markdown；LaTeX 命令、引用、公式、代码块和表格默认保留或 blocked-safe。
- [ ] 用户明确要求 apply 时，Host 把 patch 拆成 observe -> one primitive -> observe 的多次单步流程。
- [ ] narrow apply v1 只应用当前选区或单个明确范围；多章节、全文、跨文件修改继续拆分，不交给 Computer Use core planning。
- [ ] apply 后必须有 same-file、mutation、cleanup refs。

Acceptance Gates：

- [ ] “润色当前选区”先返回 diff preview，不写文件。
- [ ] preview final answer 只能来自 Agent Host，并包含 artifact refs 和 evidence refs。
- [ ] Unit tests 证明明确应用当前选区会生成 replace-selection primitive candidate。
- [ ] Unit tests 证明多章节、全文、跨文件修改不会变成单个 Computer Use task。
- [ ] explicit live diagnostic 证明 apply 当前选区后有 before/after/action/mutation/cleanup refs。
- [ ] final answer 只能来自 Agent Host，并包含变更摘要和 evidence refs。

## 验收规则

- 单个 `[x]` 只表示该 checkbox 对应的 Build Task 或 Acceptance Gate 已被当前证据覆盖。
- 一个阶段只有在该阶段 Build Tasks 和 Acceptance Gates 全部为 `[x]` 时才算完成。
- 单元测试通过但没有 live acceptance，不能打真实桌面完成勾。
- live acceptance 通过但留下窗口、进程、临时文件、artifacts、input lease、cursor 或 adapter，不能打勾。
- 共享系统鼠标 / 键盘路径不能打 `product-ready`。
- blocked 也可以作为验收结果，但必须说明缺失条件、保留 refs，并给出恢复路径。

## 文档地图

- [`docs/Architecture.md`](docs/Architecture.md)：SciForge 总体架构和唯一 Agent Host 边界。
- [`docs/ComputerUseRuntimeArchitecture.md`](docs/ComputerUseRuntimeArchitecture.md)：Computer Use runtime 与 Host-side App Module 最新设计原则。
- [`docs/ComputerUseEntryRouteAudit.md`](docs/ComputerUseEntryRouteAudit.md)：ordinary chat、native route、runtime gateway、slash command 和旧 VSCode co-work hook 的入口审计。
- [`packages/actions/computer-use`](packages/actions/computer-use)：Computer Use contract、MCP adapter、tests 和 package metadata。
