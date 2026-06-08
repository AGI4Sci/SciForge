# SciForge Computer Use 当前任务

最后更新：2026-06-09

## 当前目标

把 Computer Use 收敛成一个通用 refs-first GUI primitive runtime，并在它之上实现可插拔的 Host-side App Capability Module。第一个专门模块是 VSCode；目标是让 Agent Host 能和用户已打开的 VSCode 协作，但不衍生第二个 agent、聊天旁路、旧版本兼容层或历史包袱。

本文件是继续推进的唯一任务路线图，不是旧任务存档。旧任务可以删除；旧逻辑如果和新方案冲突，直接删除、收口或 fail closed，不做 legacy alias、compatibility wrapper、fallback shortcut、历史 run 转译或旁路保留。

## 不可变原则

每个阶段打勾前都要重新确认这些原则仍成立：

- [x] 旧逻辑代码和最终目标冲突时，删除旧逻辑，直接实现新版本，不做兼容，保持代码干净。
- [x] 所有修改必须通用，不能为当前页面、截图、URL、文件名、agent id 或历史 run 写硬编码补丁。
- [x] 大对象必须 refs-first；截图、图片、provider payload、trace、日志和 artifact 不得作为 raw/base64 长期进入聊天正文或主上下文。
- [x] LLM API 配置使用 `/Applications/workspace/ailab/research/app/SciForge/config.local.json`。
- [x] 在能提高时间效率的前提下，尽可能使用 sub agent 并行推进；并行任务必须拆清边界，避免不同 worker 修改同一文件造成冲突。
- [x] SciForge 对话、工作链路需要统一，不要额外生出旁路。
- [x] 符合 `docs/Architecture.md` 设计原则；如果继续推进会导致混乱、衍生旁路、设计方案不合理、有相互冲突的点，或有更简洁通用的实现方案，需要停下来和用户讨论。
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

## 新方案工作链路

```text
SciForge UI
  -> Codex / Agent Host
      -> App Capability Registry
          -> VSCode App Module
              -> stable concept refs
              -> atomic capability readiness
              -> evidence provider / verifier refs
      -> Computer Use Core
          -> bind
          -> observe
          -> act 或 run_procedure
          -> control release
      -> Host-owned verifier
      -> Host-owned final answer
```

执行规则：

- Computer Use 是 Host 可多次调用的工具能力面。
- 每一步只给 Computer Use 一个 primitive，Computer Use 返回 refs，Host 再决定下一步。
- `run_procedure` 只是 Host 已经决定好的局部步骤批处理，不是旧 `runTask`。
- VSCode module 是软件状态模型、能力目录和证据门，不是第二个 agent。
- 智能载体仍然是 Agent Host；需要模型能力时由 Host 调 Model Router 或 Host-owned verifier/provider。
- App module 只回答 Host 已决定的一个 operation 在当前 refs 下是否 ready，或应 `blocked` / `needs-confirmation`。

## 打勾规则

- 单个 `[x]` 只表示该 checkbox 对应的 Build Task 或 Acceptance Gate 已被当前证据覆盖。
- 一个阶段只有在该阶段任务和验收项全部为 `[x]` 时才算完成。
- 每个实现型任务默认按“红测 -> 最小实现 -> 相关测试通过 -> 静态护栏或文档更新”推进。
- 新任务必须是小台阶：一个勾应能被单个红测、一个窄实现或一个明确验收证据覆盖，不能把完整 VSCode co-work、论文编辑或跨文件工作流塞进一个勾。
- 新任务按 `Unit contract -> Code gate -> materializer/static guard -> env-gated skip path -> mocked/live diagnostic -> Verify` 递进；前一层未闭合时不跳到真实桌面或复杂用户工作流。
- Unit path 先行，env-gated live diagnostic 后置。
- 单元测试通过但没有 live diagnostic，不能打真实桌面完成勾。
- live diagnostic 通过但留下窗口、进程、临时文件、artifacts、input lease、cursor 或 adapter，不能打勾。
- shared-system-input 路径不能打 `product-ready`。
- `blocked` / `needs-confirmation` 可以作为验收结果，但必须保留 reason refs、evidence refs 和恢复路径。

## 已完成基线

这些只记录事实，不再展开为继续执行的旧 checklist。后续如果发现它们和新方案冲突，按不可变原则删除、收口或 fail closed。

- [x] P0 路线图与架构收口：PROJECT_CU 成为唯一继续路线图，旧 P3-P9 展开项不再作为任务来源。
- [x] P1 Public Projection 收口：app module readiness、Computer Use result、package bridge presentation 和 runtime projection 已接入共享 sanitizer / forbidden raw detector。
- [x] P2 旧旁路删除与 fail-closed：GUI completion surface、legacy Computer Use public surface、ordinary/native text inference、本地 runtime visible answer 和 response normalization 旧投影已 fail closed。
- [x] P3 Computer Use lifecycle contract：`bind -> observe -> act/run_procedure -> control release` 已收口为 refs-first lifecycle；release / cleanup / live-diagnostic maturity 已有 unit 和 smoke 证据。
- [x] P4 VSCode module entry gate：registry、module surface、operation 输入、no-bypass 静态护栏已证明 VSCode module 不能被 ordinary chat、terminal 文本、palette 文本或历史 run 当作隐式 agent 调起。
- [x] P5 VSCode identity 与 concept normalization：identity / freshness / editor / workspace / panel / unknown webview 已归一化为 tokenized concept refs，不依赖固定坐标、固定布局、固定插件或文件名。

## 当前执行路线

### P6：VSCode Ambiguity 与 Read-only Diagnostic

目标：先把“不确定时不猜”和只读能力做通；可以进入 env-gated live diagnostic，但仍不写入用户文件。

Build Tasks：

- [x] [P6.1 Unit] 多窗口 / 多 frontmost 红测：多个 VSCode target refs 冲突时必须 `needs-confirmation` 或 `blocked`。
- [x] [P6.1 Code] 实现 window uniqueness gate；唯一窗口只输出下一步 primitive 需要的 target refs。
- [x] [P6.1 Materializer] 默认 act materializer 传播 VSCode ambiguity，不回退到 WindowAction fallback。
- [x] [P6.2 Unit] editor group / terminal / palette item 多目标红测：区域目标不唯一时 blocked-safe。
- [x] [P6.2 Code] 实现 editor / terminal / palette target uniqueness gate。
- [x] [P6.2 Unit] unknown webview 红测：unknown webview 与 editor / terminal 并存时不能猜测真实目标。
- [x] [P6.2 Code] 实现 unknown webview ambiguity gate；只返回 reason refs 和 evidence refs。
- [x] [P6.3 Unit] `read-visible-text` dry-run 红测：只输出 `text:vscode:visible:*` refs，不输出 raw text。
- [x] [P6.3 Code] 实现 `read-visible-text` readiness；证据不足或目标冲突时 blocked-safe。
- [x] [P6.3 Materializer] app-module dry-run result 保持 refs-first，不产生 completion truth 或 final answer。
- [x] [P6.4 Unit] `focus-editor` dry-run 红测：唯一 editor target 才 ready；多 editor target 需要 `needs-confirmation` / `blocked`。
- [x] [P6.4 Code] 实现 `focus-editor` primitive candidate；只携带 target/editor/action refs。
- [x] [P6.5 Unit] `show-problems` / `read-diagnostics` dry-run 红测：只输出 diagnostics refs，不输出 raw diagnostics text。
- [x] [P6.5 Code] 实现 diagnostics readiness；diagnostics 多目标或 stale 时 blocked-safe。
- [x] [P6.6 Live] env-gated current read / focus harness 默认关闭；无 env 时返回 blocked skip manifest，且不调用真实 runner。
- [x] [P6.6 Live] diagnostics 保持 app-module dry-run refs-only；不新增共享输入 diagnostics 旁路。
- [x] [P6.6 Live] mocked env-on run 记录 before refs、after refs、action refs、release refs 和 cleanup refs。
- [x] [P6.7 Verify] 跑 VSCode read-only unit tests、materializer tests、live skip path、typecheck、cleanup/no-bypass smoke。

验收：

- [x] 多窗口或目标不明确时不会猜测。
- [x] read-only / focus live diagnostic 通过或 blocked-safe；diagnostics dry-run refs-only，并保留 reason refs。
- [x] 每个 manifest 都是 `live-diagnostic` / `productReady=false`。
- [x] 每个 live run 都 release input lease / adapter / cursor，恢复前台 app 和鼠标位置。
- [x] stdout、manifest、public events 不泄漏 raw text、raw path、raw screenshot、provider payload、base64。

### P7：VSCode Terminal Atomic Capabilities

目标：Terminal 只做分步 primitive，focus / send / observe / submit 分离；不能把 raw command 变成执行旁路。

Build Tasks：

- [ ] [P7.1 Unit] terminal concept 红测：无 terminal、多 terminal、terminal refs stale 时 blocked-safe。
- [ ] [P7.1 Code] 实现 terminal concept refs；不依赖 terminal panel 坐标或 shell prompt 文本。
- [ ] [P7.2 Unit] `focus-terminal` 红测：唯一 terminal target 才 ready。
- [ ] [P7.2 Code] 实现 `focus-terminal` primitive candidate；不发送文本。
- [ ] [P7.3 Unit] `send-terminal-text` 红测：只接受 Host `text-ref:`，不按 Enter，不携带 raw command。
- [ ] [P7.3 Code] 实现 `send-terminal-text` primitive candidate。
- [ ] [P7.4 Unit] `observe-terminal` 红测：只输出 terminal output refs / hash refs，不输出 raw terminal output。
- [ ] [P7.4 Code] 实现 `observe-terminal` refs-first projection。
- [ ] [P7.5 Unit] `submit-terminal-command` 红测：只提交 current terminal input ref，不从 raw string 推断命令。
- [ ] [P7.5 Code] 实现 `submit-terminal-command` primitive candidate。
- [ ] [P7.6 Unit] terminal drift 红测：submit 前 terminal window / session / input ref 漂移时 blocked-safe。
- [ ] [P7.6 Code] 实现 terminal same-session / same-input verifier refs。
- [ ] [P7.7 Live] env-gated live 先跑 `focus -> send -> observe` 不提交诊断。
- [ ] [P7.7 Live] env-gated live 再跑显式安全探针 `focus -> send -> observe -> submit -> observe -> cleanup` 或 blocked-safe。
- [ ] [P7.8 Verify] 跑 terminal unit tests、live skip path、typecheck、cleanup/no-bypass smoke。

验收：

- [ ] Unit tests 证明 raw command 被拒绝。
- [ ] Live diagnostic 证明 terminal focus / send / observe / submit 分离，或 blocked-safe。
- [ ] terminal 目标漂移或多 terminal 不唯一时 `needs-confirmation` / `blocked`。
- [ ] cleanup refs 完整，不杀 VSCode，不清 profile。

### P8：VSCode Command Palette Atomic Capabilities

目标：Command Palette 只选择 current observe 产生的 item ref；raw command id / raw label 不能成为执行旁路。

Build Tasks：

- [ ] [P8.1 Unit] `open-command-palette` 红测：唯一 VSCode window 才 ready。
- [ ] [P8.1 Code] 实现 `open-command-palette` primitive candidate。
- [ ] [P8.2 Unit] `send-command-palette-query` 红测：只接受 Host `text-ref:`，不暴露 raw query。
- [ ] [P8.2 Code] 实现 `send-command-palette-query` primitive candidate。
- [ ] [P8.3 Unit] `observe-command-palette-items` 红测：只输出 item refs / rank refs，不输出 raw label 或 raw command id。
- [ ] [P8.3 Code] 实现 `observe-command-palette-items` refs-first projection。
- [ ] [P8.4 Unit] `select-command-palette-item` 红测：只接受 current observe item ref。
- [ ] [P8.4 Code] 实现 `select-command-palette-item` primitive candidate。
- [ ] [P8.5 Unit] palette ambiguity / stale 红测：item 不唯一、palette 未打开、palette 目标漂移、item stale 时 blocked-safe。
- [ ] [P8.5 Code] 实现 palette current-observation / selected-item verifier refs。
- [ ] [P8.6 Live] env-gated live 先跑 `open -> send query -> observe items` 不选择诊断。
- [ ] [P8.6 Live] env-gated live 再跑显式安全探针 `open -> send query -> observe items -> select item -> observe -> close/cleanup` 或 blocked-safe。
- [ ] [P8.7 Verify] 跑 palette unit tests、live skip path、typecheck、cleanup/no-bypass smoke。

验收：

- [ ] Unit tests 证明 raw command id / raw palette label 不能直接执行。
- [ ] Live diagnostic 证明 item ref 来自 current observe，或 blocked-safe。
- [ ] palette 目标漂移、item 不唯一或 observation stale 时 `needs-confirmation` / `blocked`。
- [ ] cleanup refs 完整，不留下 palette 或焦点漂移。

### P9：VSCode Editor Mutation 与 Host-owned Narrow Apply

目标：最后才进入写入 primitive；先 preview，再由 Host 明确拆成 `observe -> one primitive -> observe`，Computer Use core 仍不做 planning。

Build Tasks：

- [ ] [P9.1 Unit] editor scope 红测：当前 selection / cursor / single range 缺失或不唯一时 `needs-confirmation`。
- [ ] [P9.1 Code] 实现 scope readiness；只输出 selection / cursor / range refs，不写入。
- [ ] [P9.2 Unit] preview 红测：draft / diff 只能作为 artifact refs，不进入 Computer Use primitive。
- [ ] [P9.2 Code] 实现 preview v1；不调用 VSCode 写入 primitive。
- [ ] [P9.3 Unit] `insert-draft` 红测：只能基于 current cursor / selection refs 和 Host `text-ref:`。
- [ ] [P9.3 Code] 实现 `insert-draft` primitive candidate；不从 raw selected text 或 raw path 推断目标。
- [ ] [P9.4 Unit] `replace-selection` 红测：只能基于 current selection refs 和 Host `text-ref:`。
- [ ] [P9.4 Code] 实现 `replace-selection` primitive candidate。
- [ ] [P9.5 Unit] editor drift 红测：文件、选区、editor group、目标窗口或 observation 漂移时 blocked-safe。
- [ ] [P9.5 Code] 实现 same-file / same-selection / same-window verifier refs。
- [ ] [P9.6 Live] env-gated scratch editor mutation 诊断：只在 scratch / temporary buffer 运行，默认关闭，失败 blocked-safe。
- [ ] [P9.7 Unit] `save-current-file` 红测：需要 same-file、mutation、current editor refs 和 Host decision/action evidence。
- [ ] [P9.7 Code] 实现 `save-current-file` readiness；full-access 文件操作不走类别式 confirmation gate。
- [ ] [P9.8 Unit] narrow apply 红测：明确 apply 时只能生成一个 `replace-selection` 或 `insert-draft` primitive candidate。
- [ ] [P9.8 Code] 实现 narrow apply Host bridge：严格拆成 `observe -> one primitive -> observe`。
- [ ] [P9.9 Unit] apply verification 红测：apply 后必须有 same-file、mutation、after-observe、release 和 cleanup refs。
- [ ] [P9.9 Code] 实现 apply verification projection；不从 Computer Use `completed` 推断用户任务完成。
- [ ] [P9.10 Static] 扩展 no-bypass guard：preview / apply 不能新增 runtime final-answer、raw diff、raw selected text 或 raw path 旁路。
- [ ] [P9.11 Live] env-gated 用户当前选区场景：先 preview，不写；明确 apply 时单 primitive；证据不足 blocked-safe。
- [ ] [P9.12 Verify] 跑 editor mutation / preview / apply unit tests、live skip path、typecheck、cleanup/no-bypass smoke。

验收：

- [ ] “润色当前选区”先返回 diff preview，不写文件。
- [ ] 明确应用当前选区会生成一个 `replace-selection` primitive candidate。
- [ ] 保存、批量、跨文件修改不触发类别式 confirmation gate，但必须由 Host 基于 current refs 拆成多次单步 primitive。
- [ ] 多章节、全文、跨文件修改不会变成单个 Computer Use task。
- [ ] public events 不泄漏 raw selected text、raw path、raw command、raw diff 或 provider payload。
- [ ] 真实桌面路径只标 `live-diagnostic`，不能宣称 `product-ready`。

## 文档地图

- [`docs/Architecture.md`](docs/Architecture.md)：SciForge 总体架构和唯一 Agent Host 边界。
- [`docs/ComputerUseRuntimeArchitecture.md`](docs/ComputerUseRuntimeArchitecture.md)：Computer Use runtime 与 Host-side App Module 最新设计原则。
- [`docs/ComputerUseEntryRouteAudit.md`](docs/ComputerUseEntryRouteAudit.md)：ordinary chat、native route、runtime gateway、slash command 和旧 VSCode co-work hook 的入口审计。
- [`packages/actions/computer-use`](packages/actions/computer-use)：Computer Use contract、MCP adapter、tests 和 package metadata。
