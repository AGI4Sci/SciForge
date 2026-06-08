# SciForge Computer Use 当前任务

最后更新：2026-06-09

## 当前目标

把 Computer Use 收敛成一个通用 refs-first GUI primitive runtime，并在它之上实现可插拔的 Host-side App Capability Module。当前第一个专门模块是 VSCode；目标是让 Agent Host 能和用户已打开的 VSCode 协作，但不衍生第二个 agent、聊天旁路或历史兼容包袱。

Computer Use core 只执行 Host 指定的 primitive。Agent Host 负责理解用户任务、选择目标、调用模型、选择 app module、决定下一步、判断 completion truth 和生成 final answer。

## Invariant Audit

每次阶段打勾前都要重新确认这些原则。

- [x] 旧逻辑代码和最终目标冲突时，删除旧逻辑，直接实现新版本，不做兼容，保持代码干净。
- [x] 所有修改必须通用，不能为当前页面、截图、URL、文件名、agent id 或历史 run 写硬编码补丁。
- [x] 大对象必须 refs-first；截图、图片、provider payload、trace、日志和 artifact 不得作为 raw/base64 长期进入聊天正文或主上下文。
- [x] LLM API 配置使用 `/Applications/workspace/ailab/research/app/SciForge/config.local.json`。
- [x] 在能提高时间效率的前提下，尽可能使用 sub agent 并行推进；并行任务必须拆清边界，避免不同 worker 修改同一文件造成冲突。
- [x] SciForge对话、工作链路需要统一，不要额外生出旁路。
- [x] **符合docs/Architecture.md设计原则, 如果继续推进会导致混乱、衍生旁路、设计方案不合理、有相互冲突的点、有更简洁通用的实现方案，需要停下来和用户讨论，澄清需求。**
- [x] Computer Use core 只保留 `bind`、`observe`、`act`、`run_procedure`、`control`。
- [x] `run_procedure` 只执行 Host 已明确给出的局部结构化步骤，不接受自然语言 task / goal / instruction。
- [x] Host 根据 current-run observe refs 决定下一步单个 primitive；Computer Use core 不做 task planning、semantic locate、repair、verification 或 final answer。
- [x] App module 不接受自然语言任务，不调用模型生成执行决策，不生成用户级 final answer。
- [x] ordinary chat、native route、app module、terminal 和 command palette 不能直答；用户级 final answer 只能来自 Codex / Agent Host。
- [x] raw screenshot、raw AX tree、raw visible text、raw command、raw path、provider payload、URL、base64、secret 不得进入 public result。
- [x] 多窗口、目标不唯一、证据冲突或 observation stale 时必须 `needs-confirmation` / `blocked`。
- [x] 不要求每一步都视觉验证；AX、text、title、image、file、editor、action、freshness 等证据足够即可。
- [x] 当前 VSCode co-work session 采用 Agent full-access 口径；保存真实文件、批量替换、跨文件修改本身不作为 confirmation gate。
- [x] full-access 不改变 refs-first：每一步仍必须绑定 current session、target window、editor / terminal / palette target、selected file 或 item refs、Host decision/action evidence。
- [x] 运行后必须 release input lease / adapter / cursor，并恢复前台焦点和鼠标位置。
- [x] 不杀用户 VSCode，不清用户 VSCode profile。
- [x] 共享系统输入路径只能标 `live-diagnostic`，不能宣称 `product-ready`。

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

- [x] 每个软件的专门优化做成可插拔 App Capability Module。
- [x] App module 属于 Agent Host 能力层，不是 Computer Use core plugin。
- [x] App module 是软件状态模型、能力目录和证据门，不是第二个 agent。
- [x] 智能载体仍然是 Agent Host；需要模型能力时由 Host 调 Model Router 或 Host-owned verifier/provider。
- [x] App module 只回答 Host 已决定的一个 operation 在当前 refs 下是否 ready，或应 `blocked` / `needs-confirmation`。

## VSCode App Module v1

VSCode v1 聚焦用户已打开 VSCode 的 co-work，不依赖固定坐标、固定布局或固定插件集合。

模块职责：

- [x] 注册 VSCode app / process / window / bundle identity refs。
- [x] 把通用 observation refs 归一成 VSCode 稳定概念。
- [x] 判断目标是否唯一，识别多窗口、多 editor group、多 terminal、未知 webview、stale observation。
- [x] 暴露 allowlisted atomic capability catalog。
- [x] 提供 primitive readiness：把 Host 已决定的 operation 转成一个 Computer Use primitive，或返回 `blocked` / `needs-confirmation`。
- [x] 提供 Host-owned focused-editor、same-file、mutation、save、diagnostics、terminal、command palette evidence provider / verifier 的接入点。
- [x] 只输出安全 tokenized refs，不输出 raw payload。

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

### R0：文档和任务看板收敛

目标：把 `PROJECT_CU.md` 变成新方案执行看板，只保留后续实现需要遵守和验收的内容。

Build Tasks：

- [x] 删除旧阶段流水账、历史兼容任务和历史补充堆叠。
- [x] 保留不可变原则和唯一 Agent Host 链路。
- [x] 写清 Host-side App Capability Module Registry。
- [x] 写清 VSCode App Module v1 能力范围。
- [x] 把后续任务改成可阶段性打勾的递进路线。

Acceptance Gates：

- [x] `PROJECT_CU.md` 不再保留旧路径兼容任务。
- [x] `PROJECT_CU.md` 不再把旧验收流水账作为下一步任务。
- [x] 任何新阶段都能独立验收，不需要一步跳到完整 VSCode / 论文协作。

### R1：App Module Registry Contract

目标：定义 Host-side app module 的最小 contract，让未来 VSCode、浏览器、文档编辑器等软件优化都能走同一种插件边界。

Build Tasks：

- [x] 定义 `ComputerUseAppModule` contract：`moduleId`、`canHandle`、`normalizeObservation`、`getCapabilities`、`checkReadiness`。
- [x] 定义 `AppModuleRegistry`：根据 app/window/observe refs 选择一个 module。
- [x] 定义 readiness result：`ready`、`blocked`、`needs-confirmation`。
- [x] readiness input 只接受 Host 已决定的 operation 和 current-run refs，不接受自然语言 task。
- [x] readiness output 只返回 primitive candidate、evidence refs、reason refs，不返回 final answer。
- [x] readiness validator 递归拒绝 nested final-answer 字段和 raw/base64/provider payload。

Acceptance Gates：

- [x] Unit tests 证明 registry 能按 refs 选择 VSCode module。
- [x] Unit tests 证明 unknown app 返回 blocked / unsupported，不 fallback 到自然语言执行。
- [x] Unit tests 证明 module 不能返回用户可见 final answer，包括 nested action payload。
- [x] Computer Use core 不 import VSCode module。

### R2：VSCode Module Skeleton

目标：建立 VSCode module 文件边界，先迁入最小可用的状态模型和 sanitizer，不扩大行为。

Build Tasks：

- [x] 新建 VSCode App Module skeleton。
- [x] 注册 VSCode app/process/window/title/frontmost identity refs。
- [x] 定义 VSCode stable concept refs：window、editor、file、terminal、palette、diagnostics、unknown webview、freshness。
- [x] 迁入 refs sanitizer：拒绝 raw title、raw path、raw AX/text、raw screenshot path、provider payload、base64、URL。
- [x] 保留现有 current VSCode co-work runner 行为，不把 module 放进 Computer Use core。

Acceptance Gates：

- [x] Unit tests 证明 raw/refs 混用 fail closed。
- [x] Unit tests 证明多窗口候选无法唯一确认时 `needs-confirmation`。
- [x] Unit tests 证明 unknown webview 不会被误判为 editor / terminal。
- [x] 现有 read-only / focus / insert-draft unit tests 仍通过。

### R3：VSCode Read-only Observation

目标：让 VSCode module 稳定提供只读观察能力，证明当前窗口、当前文件、编辑区和 freshness refs。

Build Tasks：

- [x] `read-visible-text` readiness 进入 VSCode module。
- [x] `show-problems` / `read-diagnostics` 做 refs-only readiness，不执行写入动作。
- [x] current observe 必须绑定 active session、window identity、editor element、file refs 和 freshness refs。
- [x] visible text 只以 `text:` / observation refs 暴露，不公开 raw visible text。

Acceptance Gates：

- [x] Unit tests 覆盖 editor 可见、editor 不可见、文件不唯一、session 缺失和 observation stale。
- [x] 默认 / env-gated read-only diagnostic 保持 blocked-safe，不宣称 product-ready。
- [x] Live manifest 保持 `live-diagnostic` / `productReady=false`。
- [x] cleanup refs 覆盖 input lease、adapter、cursor、front app、mouse position。
- [ ] 真实当前 VSCode 前台窗口 read-only env-gated live run。

### R4：VSCode Focus 与当前文件证据

目标：把 focused-editor、same-file 和 current-file evidence 正式归入 VSCode module 边界。

Build Tasks：

- [x] focused-editor verifier 进入 VSCode module。
- [x] same-file verifier 绑定 before / after observe 中同一个 `file-ref:`。
- [x] focus-editor readiness 只允许 Host 已决定的单步 operation。
- [x] focus 后 evidence 必须来自 action refs + after observe refs，不允许只靠 editorVisible。

Acceptance Gates：

- [x] Unit tests 证明 terminal/search/explorer 不会生成 focused-editor ref。
- [x] Unit tests 证明 Monaco-like editor context 可生成 focused-editor ref。
- [x] Unit tests 证明 file ref 漂移会 blocked。
- [x] Focus diagnostic unit/default path 仍保持 `live-diagnostic` / `productReady=false`。
- [ ] 真实当前 VSCode 前台窗口 focus env-gated live run。

### R5：Editor 小范围修改 Unit Path

目标：先在单元层打通 editor 写入 readiness，不碰真实桌面写入。

Build Tasks：

- [x] `insert-draft` readiness 进入 VSCode module。
- [x] `replace-selection` readiness 进入 VSCode module。
- [x] `save-current-file` readiness 进入 VSCode module。
- [x] 写入内容只接受 `text-ref:`，不接受 raw draft / raw replacement。
- [x] 写入前必须有 focused-editor 或等价 verifier refs。
- [x] 写入后必须生成 mutation verifier refs，否则 Host completion truth blocked。

Acceptance Gates：

- [x] Unit tests 证明缺 focused-editor ref 时不解析 text ref、不 typing。
- [x] Unit tests 证明 raw draft / raw replacement fail closed。
- [x] Unit tests 证明 mutation verifier 缺失时不能完成。
- [x] Unit tests 证明 save-current-file 不因真实文件本身要求 confirmation，但必须绑定 current session/window/file/action refs。

### R6：当前 VSCode 单文件写入 Diagnostic Path

目标：把真实桌面写入限制在显式 env-gated `live-diagnostic` 路径；默认路径只能 blocked-safe。

Build Tasks：

- [x] CLI 默认 blocked，不触发桌面。
- [x] 显式 env + 私有 draft resolver 才允许进入写入 runner。
- [x] 链路固定为 `bind -> observe -> host-decision -> act -> observe -> optional save -> control(release)`。
- [x] `act` 必须绑定同一个 session、window、editor、file 和 focused-editor context refs。
- [x] after observe 必须绑定同一个 file-ref，并有 mutation verifier refs。

Acceptance Gates：

- [x] 默认 CLI blocked manifest 通过 cleanup / readiness 验收。
- [x] 私有 draft resolver path 不泄漏 raw draft text。
- [x] stdout、manifest、public events 不泄漏 raw draft、raw path、raw screenshot、provider payload、base64。
- [x] 不杀 VSCode，不清 profile，release input lease / adapter / cursor，恢复前台 app 和鼠标位置。
- [x] manifest 固定 `live-diagnostic` / `productReady=false`。
- [ ] 显式真实 VSCode live run 通过，并保留 before/after/action/mutation/same-file/cleanup refs。

### R7：Terminal 分步能力 Unit Path

目标：让 VSCode module 支持 terminal，但按分步 refs-first 方式推进，避免一上来直接执行复杂 shell workflow。

Build Tasks：

- [x] `focus-terminal` readiness。
- [x] `send-terminal-text` readiness，只输入 `text-ref:`，不按 Enter。
- [x] `observe-terminal` readiness，只读 terminal output refs。
- [x] `submit-terminal-command` readiness，只提交当前 terminal 输入，不携带 raw command。
- [x] `interrupt-terminal-command` / `clear-terminal` readiness。
- [x] `focus-editor-from-terminal` readiness 与 `focus-terminal` 分开。

Acceptance Gates：

- [x] Unit tests 证明多个 terminal 不唯一时 `needs-confirmation`。
- [x] Unit tests 证明 raw shell command fail closed。
- [x] Unit tests 证明 submit 不能和 raw command 合并成一个绕过步骤。
- [x] Unit tests 证明 terminal action 只返回 primitive/evidence refs，不产生 completion truth。
- [ ] Terminal live diagnostic 先只覆盖 focus/send/observe；submit live 单独 gate。

### R8：Command Palette 分步能力 Unit Path

目标：让 VSCode module 支持 command palette，但只通过 allowlisted capability 或 current observe item refs 操作。

Build Tasks：

- [x] `open-command-palette` readiness。
- [x] `send-command-palette-query` readiness，只接受 `text-ref:`。
- [x] `observe-command-palette-items` readiness，生成 item refs。
- [x] `select-command-palette-item` readiness，只接受 current observe item ref。
- [x] `close-command-palette` readiness。

Acceptance Gates：

- [x] Unit tests 证明 raw command id fail closed。
- [x] Unit tests 证明 stale item ref fail closed。
- [x] Unit tests 证明 unknown command palette item 不会被自动解释成 task plan。
- [ ] Command palette live diagnostic 先覆盖 open/query/observe/select harmless item/close。

### R9：Host Integration Dry-run

目标：把 app module 接进 Agent Host 的 Computer Use act materializer，但先只做 dry-run / unit path，不接普通聊天。

Build Tasks：

- [ ] Agent Host 根据 current-run refs 调用 `AppModuleRegistry.resolve`。
- [ ] Host 把自己已决定的单个 operation 交给 module `checkReadiness`。
- [ ] module 只返回一个 primitive candidate 或 `blocked` / `needs-confirmation`。
- [ ] materializer 不从裸 `commandText` 推断 operation、目标或多步计划。
- [ ] Computer Use core 仍不 import Host-side app module。

Acceptance Gates：

- [ ] Unit tests 证明 VSCode refs 会选择 VSCode module 并返回一个 primitive candidate。
- [ ] Unit tests 证明 unknown app / ambiguous app blocked。
- [ ] Unit tests 证明 readiness result 不能直接成为 final answer。
- [ ] Unit tests 证明 terminal output、palette item、act completed status 不会被升级成 completion truth。

### R10：普通聊天接线且无旁路

目标：把 R9 dry-run 接入普通聊天入口，但所有用户级 completion 仍由 Agent Host 产生。

Build Tasks：

- [ ] ordinary chat hook 只作为进入 Agent Host 的桥，不直接调用 VSCode module。
- [ ] native route 只投影 sanitized refs 和 Host final answer envelope，不直答。
- [ ] 没有 Host final-answer evidence 时返回 blocked / partial。
- [ ] 删除与新链路冲突的旧 fallback / shortcut / local completion 逻辑，不做兼容。

Acceptance Gates：

- [ ] Unit tests 证明 ordinary chat 裸文本不能绕过 Host 进入 VSCode module 多步执行。
- [ ] Unit tests 证明 native route 没有 Host final-answer evidence 时不能 done。
- [ ] Unit tests 证明 public events 只包含 tokenized refs 和 Host-owned final answer envelope。
- [ ] Static tests 证明没有 `gui.present` / local Computer Use finalization 旁路。

### R11：VSCode Live Diagnostic Matrix

目标：把真实桌面验收拆成小的 env-gated matrix，每个只测一条无歧义能力。

Build Tasks：

- [ ] read-only current-window live diagnostic。
- [ ] focus-editor current-window live diagnostic。
- [ ] insert-draft current-selection live diagnostic。
- [ ] terminal focus/send/observe live diagnostic，不默认 submit。
- [ ] command palette open/query/observe/select harmless item/close live diagnostic。

Acceptance Gates：

- [ ] 每个 live diagnostic 都默认 blocked，只有显式 env 才运行。
- [ ] 每个 manifest 都是 `live-diagnostic` / `productReady=false`。
- [ ] 每个 run 都保留 before/after/action/release refs。
- [ ] 每个 run 都 release input lease / adapter / cursor，恢复前台 app 和鼠标位置。
- [ ] stdout、manifest、public events 不泄漏 raw text、raw path、raw screenshot、provider payload、base64。

### R12：论文编辑 Preview

目标：先实现论文修改的 draft / diff preview，不写入用户文件。

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

### R13：论文编辑 Apply Narrow Scope

目标：在 R12 preview 可靠后，只应用当前选区或单个明确范围。

Build Tasks：

- [ ] 用户明确要求应用时，Host 把 patch 拆成多次 VSCode primitive。
- [ ] 每次 apply 都走 observe -> Host decision -> one primitive -> observe。
- [ ] 多章节 / 全文修改必须拆成多个 R13 小步骤，不能交给 Computer Use core planning。
- [ ] apply 后必须有 same-file、mutation、cleanup refs。

Acceptance Gates：

- [ ] 明确应用当前选区后，通过 GUI primitive 替换当前选区，并有 before/after/action/mutation refs。
- [ ] 文件或目标漂移时 blocked / needs-confirmation。
- [ ] final answer 只能来自 Agent Host，并包含变更摘要和 evidence refs。

## 打勾规则

- [x] 单个 `[x]` 只表示该 checkbox 对应的 Build Task 或 Acceptance Gate 已被当前证据覆盖。
- [x] 一个阶段只有在该阶段 Build Tasks 和 Acceptance Gates 全部为 `[x]` 时才算完成。
- [ ] 单元测试通过但没有 live acceptance，不能打真实桌面完成勾。
- [ ] live acceptance 通过但留下窗口、进程、临时文件、artifacts、input lease、cursor 或 adapter，不能打勾。
- [ ] 共享系统鼠标 / 键盘路径不能打 product-ready。
- [ ] blocked 也可以作为验收结果，但必须说明缺失条件、保留 refs，并给出恢复路径。

## 文档地图

- [`docs/Architecture.md`](docs/Architecture.md)：SciForge 总体架构和唯一 Agent Host 边界。
- [`docs/ComputerUseRuntimeArchitecture.md`](docs/ComputerUseRuntimeArchitecture.md)：Computer Use runtime 与 Host-side App Module 最新设计原则。
- [`packages/actions/computer-use`](packages/actions/computer-use)：Computer Use contract、MCP adapter、tests 和 package metadata。
