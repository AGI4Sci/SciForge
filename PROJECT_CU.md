# SciForge Computer Use 当前任务

最后更新：2026-06-09

## 用户真正要什么

用户希望 Codex 能在本地桌面 / GUI 上可靠完成低风险和开发协作类操作，并给出可验证的动作证据。

Computer Use 不是独立 agent。它只提供可迁移、可验收、可清理的 GUI primitive runtime。Agent Host 负责理解用户任务、选择目标、决定下一步、调用模型、判断 completion truth 和生成 final answer。

当前重点是 P9 / P10：让 Codex 能和用户已经打开的 VSCode 协作，并在通用 Computer Use 能力之上沉淀可插拔的软件专门优化模块。

## 不可变原则

- [x] SciForge 是 Codex / Agent Host 的 GUI / Browser / Desktop 能力面，不是第二条智能链路。
- [x] Computer Use core 只保留 primitive：`bind`、`observe`、`act`、`run_procedure`、`control`。
- [x] `run_procedure` 只执行 Host 已明确给出的局部结构化步骤，不接受自然语言 task / goal / instruction。
- [x] Host 根据 current-run observe refs 决定下一步单个 primitive；Computer Use core 不做 task planning、semantic locate、repair、verification 或 final answer。
- [x] 所有大对象 refs-first；raw screenshot、raw AX tree、raw visible text、raw command、raw path、provider payload、URL、base64、secret 不得进入 public result。
- [x] 多窗口、目标不唯一、证据冲突或 observation stale 时必须 `needs-confirmation` / `blocked`。
- [x] 不要求每一步都视觉验证；AX、text、title、image、file、editor、action、freshness 等证据足够即可。
- [x] 当前 VSCode co-work session 采用 Agent full-access 口径；保存真实文件、批量替换、跨文件修改本身不作为 confirmation gate。
- [x] full-access 不改变 refs-first：每一步仍必须绑定 current session、target window、editor / terminal / palette target、selected file 或 item refs、Host decision/action evidence。
- [x] 运行后必须 release input lease / adapter / cursor，并恢复前台焦点和鼠标位置。
- [x] 不杀用户 VSCode，不清用户 VSCode profile。
- [x] 共享系统输入路径只能标 `live-diagnostic`，不能宣称 `product-ready`。
- [x] 如果设计继续推进会产生旁路、职责混乱或更复杂的 core，先停下来和用户讨论。

## 当前架构决策

用户已选择方案 C：**Host-side App Capability Module Registry**。

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
- [x] App module 不接受自然语言任务，不循环，不 retry，不 repair，不自己决定多步计划，不生成 final answer。
- [x] App module 只回答 Host 已决定的一个 operation 在当前 refs 下是否 ready，或应 `blocked` / `needs-confirmation`。

## VSCode App Module v1 设计

VSCode 是第一个专门优化模块。v1 聚焦用户已打开 VSCode 的 co-work。

### 模块职责

- [x] 注册 VSCode app / process / window / bundle identity refs。
- [x] 把通用 observation refs 归一成 VSCode 稳定概念。
- [x] 判断目标是否唯一，识别多窗口、多 editor group、多 terminal、未知 webview、stale observation。
- [x] 暴露 allowlisted atomic capability catalog。
- [x] 提供 primitive readiness：把 Host 已决定的 operation 转成一个 Computer Use primitive，或返回 `blocked` / `needs-confirmation`。
- [x] 提供 Host-owned focused-editor、same-file、mutation、save、diagnostics、terminal、command palette evidence provider / verifier 的接入点。
- [x] 只输出安全 tokenized refs，不输出 raw payload。

### 模块非职责

- [x] 不理解完整用户任务。
- [x] 不从自然语言决定 operation。
- [x] 不决定下一步多步计划。
- [x] 不拥有 LLM。
- [x] 不直接操作桌面绕过 primitive。
- [x] 不判断用户级完成。
- [x] 不生成用户可见 final answer。
- [x] v1 不做 permission / confirmation gate；当前 co-work session 内按 Agent full-access 处理。

### 稳定概念模型

VSCode module 不依赖固定坐标、固定布局或固定插件集合。它只建模稳定概念：

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

泛化策略：

- [x] 不假设 explorer、editor、terminal、problems panel 的固定位置。
- [x] 组合 app/process/window/title/frontmost、AX、visible text、image、file、editor、terminal、palette item、action 和 freshness refs。
- [x] 未知插件 webview 默认未知；只有 refs 足够时才能作为明确目标。
- [x] 证据不足或冲突时 fail closed。

### v1 能力目录

Editor：

- `read-visible-text`
- `focus-editor`
- `move-cursor`
- `insert-draft`
- `replace-selection`
- `save-current-file`
- `undo-last-action`
- `redo-last-action`

Diagnostics：

- `show-problems`
- `read-diagnostics`

Terminal：

- `focus-terminal`
- `send-terminal-text`
- `observe-terminal`
- `submit-terminal-command`
- `interrupt-terminal-command`
- `clear-terminal`
- `focus-editor-from-terminal`

Command Palette：

- `open-command-palette`
- `send-command-palette-query`
- `observe-command-palette-items`
- `select-command-palette-item`
- `close-command-palette`

### Terminal 分步规则

Terminal v1 采用分步优先：

```text
focus-terminal
  -> send-terminal-text
  -> observe-terminal
  -> submit-terminal-command
  -> observe-terminal
```

- `send-terminal-text` 只输入 `text-ref:`，不按 Enter。
- `submit-terminal-command` 只提交当前 terminal 输入，不携带 raw command。
- Host 可以在 submit 前根据 observe refs 确认文本进入了唯一 terminal。
- VSCode module 不理解 shell 命令语义，不判断测试是否通过，不决定下一步修复。
- 命令输出和后续修复由 Agent Host 根据 terminal output refs、file refs、test refs 判断。

### Command Palette 分步规则

Command Palette v1 也采用分步：

```text
open-command-palette
  -> send-command-palette-query
  -> observe-command-palette-items
  -> select-command-palette-item
  -> observe
```

- VSCode module 不接受模型随意传入的 raw command id。
- Command Catalog 是稳定性目录，不是权限系统。
- Host 可以选择 allowlisted capability，或选择 current observe 返回的 command palette item ref。
- VSCode module 只验证 item ref 来自 current observe，并把选择映射成一个原子 primitive。

## 成熟度地图

| 阶段 | 当前状态 | 结论 |
| --- | --- | --- |
| P0 Session 输入隔离 | done / live-diagnostic | input lease、adapter、cursor、release、shared-system-input 串行化已验收。 |
| P1 原子操作完备性 | done / live-diagnostic | 8 个 action type contract、MCP schema、service delegation 和 TextEdit live 子集已覆盖。 |
| P2 Observation 与 Evidence | done | before/after observation、action refs、stale invalidation、refs-first evidence 已固化。 |
| P3 真实桌面验收 | done / live-diagnostic | TextEdit live acceptance 通过；共享系统输入仍不能 product-ready。 |
| P4 Host / MCP 集成 | done / unit-proven | Agent Host 可走 primitive chain，final answer 基于 evidence。 |
| P5 安全与确认 | done / unit-proven | 高风险 confirmation policy 已在 core 层 fail closed；P9 full-access 不把真实文件修改本身当作 gate。 |
| P6 迁移与清理 | done | 旧 `runTask` / `perform_local_action` / `fill_fields` 不回流为 public surface。 |
| P7 用户级验收链路 | done / unit-proven | 普通聊天能触发低风险 GUI action，但 completion truth 仍归 Host。 |
| P8 VSCode 临时 workspace 诊断 | done / live-diagnostic | 真实 VSCode 临时 workspace primitive chain 通过；复用用户 profile，不能 product-ready。 |
| P9 当前 VSCode co-work | partial | P9a/P9b 与 focus-editor live-diagnostic 完成；P9c 写入 live-diagnostic 和 App Module 化未完成。 |
| P10 论文修改 / 润色 GUI 协作 | not started | 依赖 P9 当前文件 / 选区 mutation 能力。 |

## P9 当前状态

已完成：

- [x] P9a current VSCode co-work controller contract：window/file target、operation allowlist、fresh observe refs、editor visibility、editor element、real-file target/session/full-access evidence。
- [x] Native route bridge 只接受 `CU-NEXT-09` + `current-vscode-cowork` + `refs-first` intent，不让 Computer Use core 做 task planning。
- [x] raw/refs 混用、raw title、raw path、raw AX/text、raw screenshot path、provider payload 都 fail closed。
- [x] Read-only ordinary/native route live-diagnostic 已通过当前 VSCode。
- [x] Runtime Codex HTTP/SSE read-only live-diagnostic 已通过当前 VSCode。
- [x] focused-editor Host verifier/provider adapter 已接入。
- [x] 默认 focused-editor provider 已完成一次真实 current VSCode focus live-diagnostic。
- [x] `act.contextRefs` 已能把 Host focused-editor evidence 带到下一步 primitive。
- [x] `insert-draft` primitive/Host runner、private draft resolver、mutation verifier gate 和 live acceptance writer 已达到 `unit-proven`。

未完成：

- [ ] 把现有 VSCode co-work logic 收束成 Host-side VSCode App Module skeleton。
- [ ] 定义 App Capability Registry contract，供未来其它软件模块复用。
- [ ] 把 focused-editor provider、current file verifier、mutation verifier、save verifier 归入 VSCode module 边界。
- [ ] 完成 P9c 当前 VSCode 小范围写入 live-diagnostic：`focus-editor -> insert-draft/replace-selection -> observe -> optional save -> control(release)`。
- [ ] 写入 live-diagnostic 必须保留 before/after refs、action refs、mutation verifier refs、same-file refs、cleanup refs，并且不泄漏 raw draft。
- [ ] Terminal v1 分步能力进入 VSCode module：focus、send text、observe、submit、observe。
- [ ] Command Palette v1 分步能力进入 VSCode module：open、send query、observe items、select item、observe。
- [ ] 当前仍使用共享系统输入，P9 不能声明 `product-ready`。

## P10 当前状态

目标：用户在 VSCode / IDE 中打开论文草稿时，Codex 能基于当前文件、当前选区或用户指定范围生成可审阅修改，并在 full-access co-work session 内通过 GUI primitive 落到编辑器。

未开始：

- [ ] Host 识别论文编辑范围：当前选区、可见段落、用户指定章节或全文 artifact。
- [ ] 范围不明确时 `needs-confirmation`。
- [ ] Host 生成 draft / diff artifact refs，Computer Use 每次只执行一个 primitive。
- [ ] 支持 LaTeX、Markdown、纯文本论文草稿，保留引用、公式、代码块、表格和术语。
- [ ] 对事实性改写、引用补全、实验结果解释、作者贡献等高影响内容必须降级为建议或需要明确用户意图。
- [ ] 修改结果必须有 source refs、draft/diff refs、GUI before/after refs、action refs、可选 file validator refs 和 final answer 变更摘要。

## 下一阶段建议

当前只做文档，不改代码。文档批准后，建议按这个顺序推进：

1. [ ] 定义 Host-side `ComputerUseAppModule` / registry contract。
2. [ ] 建立 VSCode App Module skeleton，只迁入现有 focused-editor / read-only / insert-draft readiness 边界，不扩大能力。
3. [ ] 把 P9c 当前 VSCode 小范围写入 live-diagnostic 跑通。
4. [ ] 把 terminal 分步能力加入 VSCode module v1。
5. [ ] 把 command palette 分步能力加入 VSCode module v1。
6. [ ] 再进入 P10 论文编辑场景。

## 非目标

- [ ] 不做 Computer Use agent。
- [ ] 不做 VSCode agent。
- [ ] 不做跨应用 workflow engine。
- [ ] 不在 Computer Use core 内做 task planning、semantic locate、repair、verification 或 final answer。
- [ ] 不让 VSCode module 接受自然语言任务。
- [ ] 不让 VSCode module 拥有 LLM 或 completion truth。
- [ ] 不用 GUI projection、screenshot replay、fixture、历史 run 或 package probe 替代真实验收。
- [ ] 不把 shared-system-input 路径宣传成 product-ready。

## 打勾规则

- [ ] `[x]` 只能表示该阶段的 Build Tasks、Acceptance Gates 和 Invariant Audit 都通过。
- [ ] 单元测试通过但没有 live acceptance，不能打真实桌面完成勾。
- [ ] live acceptance 通过但留下窗口、进程、临时文件、artifacts、input lease、cursor 或 adapter，不能打勾。
- [ ] 共享系统鼠标 / 键盘路径不能打 product-ready。
- [ ] blocked 也可以作为验收结果，但必须说明缺失条件、保留 refs，并给出恢复路径。

## 文档地图

- [`docs/Architecture.md`](docs/Architecture.md)：SciForge 总体架构和唯一 Agent Host 边界。
- [`docs/ComputerUseRuntimeArchitecture.md`](docs/ComputerUseRuntimeArchitecture.md)：Computer Use runtime 与 Host-side App Module 最新设计原则。
- [`packages/actions/computer-use`](packages/actions/computer-use)：Computer Use contract、MCP adapter、tests 和 package metadata。
