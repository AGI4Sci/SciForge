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

## 当前已验收基线

本节只记录已经证明过的事实，不再展开成旧任务 checklist。后续如果发现基线和新方案冲突，直接删除或 fail closed 旧逻辑，不做兼容层。

- Host-side App Capability Module contract / registry 已 unit-proven；Computer Use core 不 import VSCode module。
- VSCode stable concept model、sanitizer、readiness gate 和 atomic capability catalog 已 unit-proven。
- read-only、focus、editor mutation、terminal、command palette readiness 已 unit-proven。
- Agent Host dry-run materializer 已 unit-proven：它不会从裸 `commandText`、terminal output、palette item 或 act completed status 推断 completion。
- 无旁路静态护栏已 unit-proven：GUI completion surface、retired runtime `gui` module、legacy Computer Use public surface、ordinary/native direct import 和 readiness final-answer/raw payload 泄漏都会 fail closed。
- 普通聊天 / native route P2 入口审计已完成；裸 ordinary VSCode 文本不能直接启动 native live diagnostic。
- Native route final-answer gate 已 unit-proven：没有 Host-owned final-answer evidence 时只能 `partial` / `blocked`，不能 `done`。
- public event sanitizer、真实 VSCode live diagnostic、Host-owned preview / narrow apply workflow 仍待实现。

## 新方案边界

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

## 新任务路线

路线原则：

- 每个阶段必须能独立验收；不能把“完整 VSCode co-work”作为早期验收目标。
- 每个 checkbox 都必须对应可证明的代码、测试、文档或 live diagnostic 证据。
- 旧路径只允许删除、fail closed 或迁入 Host-owned bridge；不做 legacy alias、compatibility wrapper、fallback shortcut 或历史 run 转译路径。
- Unit path 先行，env-gated live diagnostic 后置；真实桌面路径只能标 `live-diagnostic`。
- `blocked` / `needs-confirmation` 是有效验收结果，但必须保留 reason refs、evidence refs 和恢复路径。

### P0：任务路线重置

目标：删掉旧展开任务，把继续推进的路线改成新方案的递进 checklist。

- [x] `PROJECT_CU.md` 不再保留旧 P3-P9 的展开执行项。
- [x] 已完成工作只作为“当前已验收基线”记录，不作为继续执行任务。
- [x] 新任务从小闭环开始：先 surface inventory，再 sanitizer，再 live diagnostic，再写入与 apply。
- [x] 每个阶段都有可打勾的 Build / Acceptance 项，不设置一步到完整 co-work 的巨大任务。
- [x] 文档明确旧逻辑和新方案冲突时删除旧逻辑，不做兼容。

### P1：Public Projection Surface Inventory

目标：先找全 public projection 出口，避免 sanitizer 只接住一两个显眼路径。

- [ ] 列出 ordinary chat events、native route events、runtime gateway events、app module readiness、Computer Use result 的 public projection 文件和函数。
- [ ] 对每个 surface 标注允许输出：status、safe summary、reason refs、evidence refs、artifact refs、compact observation refs、Host final-answer envelope。
- [ ] 对每个 surface 标注禁止输出：raw screenshot、image/base64、AX tree、visible text、provider payload、trace、日志、raw artifact body、URL、raw path、raw command、secret。
- [ ] 写一个最小红测，证明当前至少一个 nested raw/base64/provider payload 会泄漏或未被统一处理。
- [ ] 更新 `npm run smoke:computer-use-no-bypass` 的扫描范围草案，覆盖新增 public projection surface。

验收：

- [ ] Inventory 能对应到具体文件和函数，不只写概念。
- [ ] 红测在实现 sanitizer 前失败，失败原因和 raw payload 泄漏相关。
- [ ] 没有新增 final-answer、completion truth 或 native message 旁路。

### P2：Shared Public Event Sanitizer

目标：实现一个共享、递归、refs-first 的 public sanitizer，再接入最小 surface。

- [ ] 新增共享 sanitizer 模块，递归处理 object、array、metadata、diagnostic payload、error payload 和 action payload。
- [ ] sanitizer 对 forbidden key 和 forbidden value 都 fail closed 或 redacted，覆盖 camelCase、snake_case、kebab-case alias。
- [ ] sanitizer 保留 tokenized refs，丢弃或替换 unsafe raw 值，不把大对象压进聊天正文或主上下文。
- [ ] Unit tests 覆盖 top-level raw、nested raw、base64/data URL、provider payload、logs、raw path、raw command、secret。
- [ ] Unit tests 覆盖 blocked / partial / error path 也不会泄漏 raw evidence。

验收：

- [ ] shared sanitizer 单测通过。
- [ ] `publicProjectionHasForbiddenRaw(sanitized)` 或等价断言证明 sanitized output 干净。
- [ ] 测试证明 artifact refs / evidence refs / observation refs 被保留。

### P3：Public Projection Integration

目标：把 P2 sanitizer 接到第一批真实 public surface，先覆盖结果投影，不碰真实桌面。

- [ ] native route `workspaceRuntimeEvent` / `done` / `failed` 投影使用 shared sanitizer。
- [ ] runtime gateway 的 blocked / partial / empty-response / error payload 使用 shared sanitizer。
- [ ] app module readiness 的 public result 使用 shared sanitizer 或共享 forbidden raw detector。
- [ ] Computer Use action/procedure result 的 public projection 只保留 refs 和 safe summary。
- [ ] static guard 禁止新增 public raw screenshot path、data URL、raw command、raw path、provider payload。

验收：

- [ ] Native route 单测证明无 Host final answer 时仍 `partial` / `blocked`，且 payload sanitized。
- [ ] Runtime gateway 单测证明 missing-final-answer / error 不泄漏 raw logs 或 raw provider payload。
- [ ] App module readiness 单测证明 nested raw action payload 被拒绝或 sanitized。
- [ ] `npm run smoke:computer-use-no-bypass` 覆盖 P3 新 surface。

### P4：Legacy Bypass Deletion Pass

目标：在 sanitizer 接入后，集中删除或 fail closed 剩余历史旁路，不做 compatibility wrapper。

- [ ] 用静态扫描列出仍能从 native `message`、`message_delta`、`done.finalText`、runtime ack 或 tool local completion 生成用户可见回答的路径。
- [ ] 删除或 fail closed 剩余 `gui.present` / `gui.ask_user` / runtime `gui` module completion surface。
- [ ] 删除或 fail closed 从裸 `message` / `commandText` / terminal output / palette item 推断 VSCode operation 的残留路径。
- [ ] 删除或 fail closed 历史 run、fixture、package probe、fallback text 参与 completion truth 的残留路径。
- [ ] 更新 no-bypass smoke，确保新 surface 进入扫描。

验收：

- [ ] 单测证明 unsupported legacy GUI completion request fail closed。
- [ ] 单测证明 native text / runtime ack / tool completion 不能铸造 `FinalAnswerEnvelope`。
- [ ] `npm run smoke:computer-use-no-bypass`、`npm run smoke:no-legacy-paths` 通过；若有既存 warning，必须记录为非本阶段引入。

### P5：Lifecycle Cleanup Contract

目标：先把 bind / observe / act / release 的生命周期证据固化，再进入真实 VSCode。

- [ ] Unit tests 覆盖 `bind` 产生 session-scoped input lease / adapter / cursor refs。
- [ ] Unit tests 覆盖 `act` 后产生 executor event refs、after observation refs 或 blocked reason refs。
- [ ] Unit tests 覆盖 `control release` 释放 input lease / adapter / cursor。
- [ ] Unit tests 覆盖 shared-system-input 路径只能 `live-diagnostic`，不能 `product-ready`。
- [ ] Cleanup manifest 记录 front app、focus、mouse position restoration refs。

验收：

- [ ] 所有 lifecycle public output 经过 P2 sanitizer。
- [ ] release 缺失时 run 不能被标记为完成。
- [ ] 不杀 VSCode，不清 profile，不依赖用户固定布局。

### P6：VSCode Read-only Diagnostic

目标：只验证目标识别、观察、focus 和 diagnostics，不做写入。

- [ ] dry-run 覆盖 `read-visible-text` readiness，只输出 visible-text refs，不输出 raw visible text。
- [ ] dry-run 覆盖 `focus-editor` readiness，目标不唯一时 `needs-confirmation` / `blocked`。
- [ ] dry-run 覆盖 `show-problems` / `read-diagnostics` readiness，问题面板不可识别时 blocked-safe。
- [ ] env-gated live harness 默认关闭，显式 env 才运行。
- [ ] live run 记录 before refs、after refs、action refs、release refs 和 cleanup refs。

验收：

- [ ] 每个 manifest 都是 `live-diagnostic` / `productReady=false`。
- [ ] read-only current-window live diagnostic 通过或 blocked-safe，并保留 reason refs。
- [ ] focus-editor current-window live diagnostic 通过或 blocked-safe，并保留 before/after focus refs。
- [ ] 每个 run 都 release input lease / adapter / cursor，恢复前台 app 和鼠标位置。
- [ ] stdout、manifest、public events 不泄漏 raw text、raw path、raw screenshot、provider payload、base64。

### P7：VSCode Terminal 分步 Diagnostic

目标：验证 terminal 的单步能力，send 和 submit 必须分离。

- [ ] dry-run 覆盖 `focus-terminal` readiness。
- [ ] dry-run 覆盖 `send-terminal-text`，只接受 Host 提供的 `text-ref:`，不提交。
- [ ] dry-run 覆盖 `observe-terminal`，只输出 terminal evidence refs。
- [ ] dry-run 覆盖 `submit-terminal-command`，只提交 current terminal input ref，不携带 raw command。
- [ ] env-gated live 按 `focus -> send -> observe -> submit -> observe -> cleanup` 分步运行。

验收：

- [ ] Unit tests 证明 raw command 被拒绝。
- [ ] Live diagnostic 证明 terminal focus / send / observe / submit 分离，或 blocked-safe。
- [ ] terminal 目标漂移或多 terminal 不唯一时 `needs-confirmation` / `blocked`。
- [ ] cleanup refs 完整，不杀 VSCode，不清 profile。

### P8：VSCode Command Palette 分步 Diagnostic

目标：验证 command palette 的单步能力，item 选择必须来自 current observe refs。

- [ ] dry-run 覆盖 `open-command-palette` readiness。
- [ ] dry-run 覆盖 `send-command-palette-query`，只接受 `text-ref:`。
- [ ] dry-run 覆盖 `observe-command-palette-items`，只输出 item refs。
- [ ] dry-run 覆盖 `select-command-palette-item`，只接受 current observe item ref。
- [ ] env-gated live 按 `open -> send query -> observe items -> select item -> observe -> close/cleanup` 分步运行。

验收：

- [ ] Unit tests 证明 raw command id / raw palette label 不能直接执行。
- [ ] Live diagnostic 证明 item ref 来自 current observe，或 blocked-safe。
- [ ] palette 目标漂移、item 不唯一或 observation stale 时 `needs-confirmation` / `blocked`。
- [ ] cleanup refs 完整，不留下 palette 或焦点漂移。

### P9：Editor Mutation 与 Host-owned Preview / Narrow Apply

目标：最后才进入写入与文本协作。先 preview，不写文件；再 narrow apply，只应用当前选区或单个明确范围。

- [ ] dry-run 覆盖 `insert-draft` current-selection primitive candidate。
- [ ] dry-run 覆盖 `replace-selection` current-selection primitive candidate。
- [ ] dry-run 覆盖 `save-current-file` same-file / mutation readiness。
- [ ] preview v1 只支持当前选区或 Host 明确选择的单个范围；范围不明确时 `needs-confirmation`。
- [ ] preview 输出 draft / diff artifact refs，不调用 VSCode 写入 primitive。
- [ ] explicit live mutation 优先使用 scratch 或用户明确选择的当前选区；文件、选区或目标漂移时 blocked-safe。
- [ ] 用户明确要求 apply 时，Host 拆成 observe -> one primitive -> observe；多章节、全文、跨文件修改继续拆分。
- [ ] apply 后必须有 same-file、mutation、cleanup refs，final answer 只能来自 Agent Host。

验收：

- [ ] “润色当前选区”先返回 diff preview，不写文件。
- [ ] preview final answer 只能来自 Agent Host，并包含 artifact refs 和 evidence refs。
- [ ] Unit tests 证明明确应用当前选区会生成 replace-selection primitive candidate。
- [ ] Unit tests 证明多章节、全文、跨文件修改不会变成单个 Computer Use task。
- [ ] explicit live diagnostic 证明 apply 当前选区后有 before/after/action/mutation/cleanup refs，或 blocked-safe。
- [ ] public events 不泄漏 raw selected text、raw path、raw command 或 provider payload。

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
