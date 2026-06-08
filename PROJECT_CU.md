# SciForge Computer Use 当前任务

最后更新：2026-06-09

## 当前目标

把 Computer Use 收敛成一个通用 refs-first GUI primitive runtime，并在它之上实现可插拔的 Host-side App Capability Module。当前第一个专门模块是 VSCode；目标是让 Agent Host 能和用户已打开的 VSCode 协作，但不衍生第二个 agent、聊天旁路或历史兼容包袱。

Computer Use core 只执行 Host 指定的 primitive。Agent Host 负责理解用户任务、选择目标、调用模型、选择 app module、决定下一步、判断 completion truth 和生成 final answer。

## 不可变架构原则

每次阶段打勾前都要重新确认这些原则。它们不是任务完成状态。

- 旧逻辑代码和最终目标冲突时，删除旧逻辑，直接实现新版本，不做兼容，保持代码干净。
- 所有修改必须通用，不能为当前页面、截图、URL、文件名、agent id 或历史 run 写硬编码补丁。
- 大对象必须 refs-first；截图、图片、provider payload、trace、日志和 artifact 不得作为 raw/base64 长期进入聊天正文或主上下文。
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

## 执行约束

- LLM API 配置使用 `/Applications/workspace/ailab/research/app/SciForge/config.local.json`。
- 在能提高时间效率的前提下，尽可能使用 sub agent 并行推进；并行任务必须拆清边界，避免不同 worker 修改同一文件造成冲突。

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

## 当前状态摘要

- Host-side App Capability Module contract / registry 已 unit-proven；Computer Use core 不 import VSCode module。
- VSCode stable concept model、sanitizer、readiness gate 和 atomic capability catalog 已 unit-proven。
- read-only、focus、editor mutation、terminal、command palette readiness 已 unit-proven。
- Agent Host dry-run materializer 已 unit-proven：它不会从裸 `commandText`、terminal output、palette item 或 act completed status 推断 operation / completion。
- 无旁路静态护栏已 unit-proven：GUI completion surface、retired runtime `gui` module、legacy Computer Use public surface、ordinary/native direct import 和 readiness final-answer/raw payload 泄漏都会 fail closed。
- 普通聊天 / native route P2 入口审计已完成；裸 ordinary VSCode 文本不能直接启动 native live diagnostic。
- public event sanitizer、VSCode live diagnostic、Host-owned preview / apply workflow 仍待实现。

## 新任务路线

原则：旧逻辑和新目标冲突时直接删除旧逻辑，不做 legacy alias、compatibility wrapper、fallback shortcut 或历史 run 转译路径。后续任务只保留能独立验收的递进阶段；早期 unit path 不再夹带真实桌面 live 尾巴。

### P0：看板收敛

目标：删除旧任务流水账，把 `PROJECT_CU.md` 改成只表达当前架构原则、当前状态和可递进验收的新路线。

Build Tasks：

- [x] 删除 R0-R9 的历史任务展开，只保留当前状态摘要。
- [x] 不可变原则改为非 checkbox，避免把原则误读成已完成任务。
- [x] 明确旧路径只允许删除、fail closed 或迁移审计，不允许 compat / fallback。
- [x] 文档中不再出现“保留旧 runner 行为”类任务。

Acceptance Gates：

- [x] `PROJECT_CU.md` 不再保留旧路径兼容任务。
- [x] 后续任务从静态护栏到 live diagnostic 再到 preview / apply，难度递进。
- [x] 只有真正任务使用 checkbox；原则和状态摘要不用 checkbox。

### P1：无旁路静态护栏

目标：先用静态护栏堵住最危险的聊天旁路和旧 public surface，暂不改变用户工作流。

Build Tasks：

- [x] 静态检查禁止 `gui.present` / `gui.ask_user` / `gui_present` / `gui_ask_user` completion surface。
- [x] 删除 retired runtime `gui` module handler；默认 registry 不再列出 `gui`，外部注入 `gui` handler 也会忽略。
- [x] 静态检查禁止 runtime modules 重新暴露 `moduleId=gui` / `RUNTIME_MODULE_IDS=['gui']`。
- [x] 静态检查禁止 `runTask` / `perform_local_action` / `fill_fields` / `executeBoundedOperation` 进入 Computer Use public surface。
- [x] 静态检查禁止 ordinary chat / native route 直接 import VSCode module 或直接调用 Computer Use act materializer。
- [x] readiness validator 递归拒绝 final-answer、completion truth、raw/base64/provider payload，并覆盖 snake_case / kebab-case alias。
- [x] readiness validator 拒绝裸 base64、HTML/DOM、本地绝对路径等 raw value。

Acceptance Gates：

- [x] Static tests 覆盖 forbidden completion surface。
- [x] Static tests 覆盖 forbidden retired runtime `gui` module surface。
- [x] Static tests 覆盖 forbidden legacy Computer Use public surface，包括 `executeBoundedOperation`。
- [x] Unit tests 证明 `module.invoke gui.present` fail closed。
- [x] Unit tests 证明 readiness result 和 app module materializer 不能直接携带 final answer 或 raw payload。

### P2：入口路由审计

目标：把 ordinary chat、native route、runtime gateway、slash command 和旧 VSCode co-work hook 的入口画清楚，为删除或迁移旧路径建立明确清单。

Build Tasks：

- [x] 列出普通聊天到 Codex / Agent Host 的唯一入口和事件边界。
- [x] 列出仍可能直接触发 VSCode module、Computer Use act 或 local completion 的旧入口。
- [x] 为每个旧入口决定删除、fail closed 或迁入 Host-owned bridge。
- [x] 旧入口清单没有“稍后兼容”项；每项只有删除、fail closed 或 Host bridge。

Acceptance Gates：

- [x] 文档和测试都能说明 ordinary chat 只能进入 Agent Host，不直接调用 VSCode module。
- [x] runtime gateway / slash command 入口已登记；gateway fallback synthesis / local final-answer 风险明确归属 P4/P5。
- [x] native route 本地 completion ack 风险已登记到入口清单，并明确归属 P4 final-answer gate；P2 不留下“稍后兼容”项。

### P3：Ordinary Chat Host-only 接线

目标：把普通聊天接到 Host-owned bridge；裸自然语言只能成为 Host input，不能成为 app module operation 或多步 GUI workflow。

Build Tasks：

- [ ] ordinary chat hook 只构造 Codex / Agent Host input envelope。
- [ ] Host structured operation ref 才能调用 AppModuleRegistry / VSCode module readiness。
- [ ] 裸 `commandText` / `message` / terminal output / palette item / act completed status 不能推断多步任务。
- [ ] 与新链路冲突的旧 VSCode co-work shortcut 直接删除或 fail closed。

Acceptance Gates：

- [ ] Unit tests 证明 ordinary chat 裸文本不能绕过 Host 进入 VSCode module。
- [ ] Unit tests 证明普通聊天中 terminal / palette / action refs 只能作为 evidence，不会变成下一步 operation。
- [ ] Unit tests 证明 structured Host operation ref 可以走 dry-run 并只返回 primitive candidate。

### P4：Native Route Final-answer Gate

目标：native route 只能投影 Host events / `FinalAnswerEnvelope`；没有 Host final-answer evidence 时必须 blocked / partial。

Build Tasks：

- [ ] native route result 只接受 Codex / Agent Host 的 final answer envelope。
- [ ] Computer Use / app module / runtime local result 只能作为 refs-first evidence。
- [ ] 没有 same-run Host final-answer evidence 时，route 返回 `blocked` / `partial`，不能 `done`。
- [ ] 删除 runtime-local answer synthesis、completion ack 或 fallback answer。

Acceptance Gates：

- [ ] Unit tests 证明 native route 没有 Host final-answer evidence 时不能 done。
- [ ] Unit tests 证明 app module readiness、single action completed、`run_procedure.status=completed` 都不能成为 final answer。
- [ ] Unit tests 证明 public events 只包含 tokenized refs 和 Host-owned final answer envelope。

### P5：公共事件与大对象 Sanitizer

目标：把普通聊天、native route、Computer Use result 和 app module readiness 的 public projection 统一成 refs-first 输出。

Build Tasks：

- [ ] public event sanitizer 覆盖 screenshot、image、AX tree、visible text、provider payload、trace、日志、artifact、URL、raw path、raw command、base64、secret。
- [ ] sanitizer 对 nested action payload / metadata / diagnostic payload 递归 fail closed。
- [ ] 大对象只保留 artifact refs / evidence refs / compact observation refs，不进入聊天正文或主上下文。
- [ ] 错误、blocked、partial 也只输出 reason refs 和安全摘要。

Acceptance Gates：

- [ ] Unit tests 覆盖 top-level 和 nested raw/base64/provider payload 泄漏。
- [ ] Unit tests 覆盖 blocked / partial 路径不泄漏 raw 证据。
- [ ] Static tests 覆盖 public event 不能包含 raw screenshot path、data URL、raw command、raw path。

### P6：VSCode Live Diagnostic 基线

目标：先跑真实 VSCode 的无写入 live diagnostic，证明目标识别、观察、focus 和 cleanup 能在真实桌面上闭环。

Build Tasks：

- [ ] read-only current-window live diagnostic。
- [ ] focus-editor current-window live diagnostic。
- [ ] show-problems / read-diagnostics live diagnostic，允许 blocked-safe。
- [ ] 每条 live run 默认 blocked，只有显式 env 才运行。

Acceptance Gates：

- [ ] 每个 manifest 都是 `live-diagnostic` / `productReady=false`。
- [ ] 每个 run 都保留 before/after/action/release refs。
- [ ] 每个 run 都 release input lease / adapter / cursor，恢复前台 app 和鼠标位置。
- [ ] stdout、manifest、public events 不泄漏 raw text、raw path、raw screenshot、provider payload、base64。

### P7：VSCode Editor / Terminal / Palette Diagnostic

目标：在 P6 通过后，再验证当前明确目标上的写入、terminal 和 command palette 单步能力，不做论文级任务。

Build Tasks：

- [ ] insert-draft current-selection live diagnostic。
- [ ] replace-selection current-selection live diagnostic。
- [ ] optional save-current-file live diagnostic，必须绑定 same-file 和 mutation refs。
- [ ] terminal focus/send/observe live diagnostic，不默认 submit。
- [ ] terminal submit live diagnostic 单独 gate，只提交 Host 已准备好的 current input，不携带 raw command。
- [ ] command palette open/query/observe/select harmless item/close live diagnostic。
- [ ] file / editor / terminal / palette / focus / selection 漂移时 blocked / needs-confirmation。

Acceptance Gates：

- [ ] 显式真实 VSCode live run 通过，并保留 before/after/action/mutation/same-file/cleanup refs。
- [ ] Terminal live 证明 focus/send/observe 和 submit 分离。
- [ ] Command palette live 证明 item ref 来自 current observe。
- [ ] 所有 manifest 都是 `live-diagnostic` / `productReady=false`，且 cleanup refs 完整。
- [ ] 不杀 VSCode，不清 profile，不保留未说明的临时窗口 / artifact。

### P8：Host-owned Preview Workflow

目标：先实现论文修改的 preview contract，不写入用户文件，不调用 VSCode 写入 primitive。

Build Tasks：

- [ ] Host 识别编辑范围：当前选区、可见段落、用户指定章节或 artifact ref。
- [ ] 范围不明确时 `needs-confirmation`。
- [ ] 生成 draft / diff artifact refs，不默认应用到文件。
- [ ] 支持 LaTeX、Markdown、纯文本论文草稿，保留引用、公式、代码块、表格和术语。
- [ ] 高影响事实性改写、引用补全、实验结果解释、作者贡献等必须降级为建议或需要明确用户意图。

Acceptance Gates：

- [ ] “润色当前选区”先返回 diff preview，不写文件。
- [ ] LaTeX 命令、引用、公式不可验证时必须保留原文或 blocked。
- [ ] preview final answer 只能来自 Agent Host，并包含 artifact refs 和 evidence refs。
- [ ] VSCode module 不解析论文语义、不生成修改建议。

### P9：Narrow Apply Workflow

目标：在 P8 preview 可靠后，只应用当前选区或单个明确范围；unit path 先行，live diagnostic 后置。

Build Tasks：

- [ ] 用户明确要求应用时，Host 把 patch 拆成多次 VSCode primitive。
- [ ] 每次 apply 都走 observe -> Host decision -> one primitive -> observe。
- [ ] 多章节 / 全文修改必须拆成多个小步骤，不能交给 Computer Use core planning。
- [ ] apply 后必须有 same-file、mutation、cleanup refs。
- [ ] env-gated live diagnostic 应用当前选区 preview。

Acceptance Gates：

- [ ] Unit tests 证明明确应用当前选区会生成 replace-selection primitive candidate。
- [ ] Unit tests 证明文件、选区或目标漂移时 blocked / needs-confirmation。
- [ ] 明确应用当前选区后，通过 GUI primitive 替换当前选区，并有 before/after/action/mutation refs。
- [ ] 多章节、全文、跨文件论文修改继续拆成多个 Host-owned 小步骤。
- [ ] final answer 只能来自 Agent Host，并包含变更摘要和 evidence refs。

## 验收规则

- 单个 `[x]` 只表示该 checkbox 对应的 Build Task 或 Acceptance Gate 已被当前证据覆盖。
- 一个阶段只有在该阶段 Build Tasks 和 Acceptance Gates 全部为 `[x]` 时才算完成。
- 单元测试通过但没有 live acceptance，不能打真实桌面完成勾。
- live acceptance 通过但留下窗口、进程、临时文件、artifacts、input lease、cursor 或 adapter，不能打勾。
- 共享系统鼠标 / 键盘路径不能打 product-ready。
- blocked 也可以作为验收结果，但必须说明缺失条件、保留 refs，并给出恢复路径。

## 文档地图

- [`docs/Architecture.md`](docs/Architecture.md)：SciForge 总体架构和唯一 Agent Host 边界。
- [`docs/ComputerUseRuntimeArchitecture.md`](docs/ComputerUseRuntimeArchitecture.md)：Computer Use runtime 与 Host-side App Module 最新设计原则。
- [`packages/actions/computer-use`](packages/actions/computer-use)：Computer Use contract、MCP adapter、tests 和 package metadata。
