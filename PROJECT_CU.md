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

## 新任务路线

### P4：VSCode Module Entry Gate

目标：只证明 VSCode module 的入口、选择条件和导出边界正确；不观察真实 VSCode，不做输入动作。

Build Tasks：

- [x] [Unit] 写 registry 红测：VSCode module 不能被裸 `message`、`commandText`、terminal output、palette label、历史 run 或 completed action 触发。
- [x] [Code] 收口 registry 选择条件：VSCode module 只能从 Host 提供的 app / process / window refs 候选中进入 `canHandle`。
- [x] [Unit] 写 module surface 红测：VSCode module 只允许暴露 `canHandle`、`normalizeObservation`、`getCapabilities`、`checkReadiness`。
- [x] [Code] 收口 VSCode module skeleton：删除或 fail closed 与新 surface 冲突的旧 helper / fallback entry。
- [x] [Unit] 写 operation 输入红测：`checkReadiness` 只接受 Host structured operation ref，不接受自然语言 task / goal / instruction。
- [x] [Static] VSCode module 不得 import Computer Use executor、desktop controller、MCP adapter 或直接操作桌面。
- [x] [Verify] 跑 registry / module surface / no-bypass 相关测试和 smoke。

验收：

- [x] ordinary chat、terminal 文本、palette 文本不能把 VSCode module 当作隐式 agent 调起。
- [x] VSCode module public API 足够小，不能形成第二条执行入口。
- [x] readiness 输出仍走 refs-first sanitizer / forbidden raw detector。

### P5：VSCode Identity 与 Concept Normalization

目标：把 current observe refs 归一化为稳定 VSCode concept refs；只做状态模型，不产生命令或输入动作。

Build Tasks：

- [x] [Unit] 写 identity 红测：app / process / window / title / frontmost refs 任一关键证据缺失时 readiness 不能 ready。
- [x] [Code] 实现 identity readiness：只返回 identity refs、safe summary、reason refs 和 evidence refs。
- [x] [Unit] 写 freshness 红测：缺失 current observation ref 或 observation stale 时必须 `blocked`。
- [x] [Code] 把 normalizeObservation 绑定 current observation / freshness refs。
- [x] [Unit] 写 editor concept 红测：active editor、editor group、selection / cursor、selected file 必须映射为 tokenized concept refs。
- [x] [Code] 实现 editor concept normalization；不依赖固定坐标、固定布局、固定插件或当前文件名。
- [x] [Unit] 写 workspace / panel concept 红测：workspace、problems panel、terminal、command palette、unknown webview 映射为稳定 concept refs 或 blocked reason refs。
- [x] [Code] 实现 workspace / panel concept normalization；未知 webview 默认 unknown，不猜测。
- [x] [Unit] 写 raw 泄漏红测：raw visible text、raw path、raw URL、provider payload、base64 不得出现在 normalize/readiness public result。
- [x] [Verify] 跑 VSCode module normalization tests、typecheck 和 no-bypass smoke。

验收：

- [x] 不同 VSCode 布局 / 插件缺失不会触发坐标硬编码或文件名硬编码。
- [x] concept result 只包含 refs、safe summaries 和 reason/evidence refs。
- [x] stale observation 不能被当成 current state 使用。

### P6：VSCode Ambiguity 与 Read-only Diagnostic

目标：先把“不确定时不猜”和只读能力做通；可以进入 env-gated live diagnostic，但仍不写入用户文件。

Build Tasks：

- [ ] [Unit] 写多窗口 ambiguity 红测：多个 VSCode window / frontmost 冲突时必须 `needs-confirmation` 或 `blocked`。
- [ ] [Code] 实现 window uniqueness gate；唯一窗口时只返回下一步 primitive candidate 所需 refs。
- [ ] [Unit] 写区域 ambiguity 红测：多 editor group、多 terminal、多 palette item、unknown webview 目标不唯一时必须 blocked-safe。
- [ ] [Code] 实现 editor / terminal / palette / webview ambiguity gate。
- [ ] [Unit] 写 `read-visible-text` dry-run 红测：只输出 visible-text refs，不输出 raw text。
- [ ] [Code] 实现 `read-visible-text` readiness；证据不足时 blocked-safe。
- [ ] [Unit] 写 `focus-editor` dry-run 红测：目标唯一才 ready，目标不唯一 `needs-confirmation` / `blocked`。
- [ ] [Code] 实现 `focus-editor` primitive candidate；只携带 target/editor refs。
- [ ] [Unit] 写 `show-problems` / `read-diagnostics` dry-run 红测：只输出 diagnostics refs。
- [ ] [Code] 实现 diagnostics readiness；不把 diagnostics raw text 写入 public result。
- [ ] [Live] 新增 env-gated current VSCode read-only harness，默认关闭，显式 env 才运行。
- [ ] [Live] live run 记录 before refs、after refs、action refs、release refs 和 cleanup refs。
- [ ] [Verify] 跑 read-only unit tests、env-gated harness skip path、typecheck、cleanup/no-bypass smoke。

验收：

- [ ] 多窗口或目标不明确时不会猜测。
- [ ] read-only / focus / diagnostics diagnostic 通过或 blocked-safe，并保留 reason refs。
- [ ] 每个 manifest 都是 `live-diagnostic` / `productReady=false`。
- [ ] 每个 live run 都 release input lease / adapter / cursor，恢复前台 app 和鼠标位置。
- [ ] stdout、manifest、public events 不泄漏 raw text、raw path、raw screenshot、provider payload、base64。

### P7：VSCode Terminal Atomic Capabilities

目标：Terminal 只做分步 primitive，focus / send / observe / submit 分离；不能把 raw command 变成执行旁路。

Build Tasks：

- [ ] [Unit] 写 terminal target 红测：多 terminal、terminal 未定位、terminal refs stale 时 `blocked` / `needs-confirmation`。
- [ ] [Code] 实现 terminal concept refs 和 `focus-terminal` readiness。
- [ ] [Unit] 写 `send-terminal-text` 红测：只接受 Host 提供的 `text-ref:`，不按 Enter，不携带 raw command。
- [ ] [Code] 实现 `send-terminal-text` primitive candidate。
- [ ] [Unit] 写 `observe-terminal` 红测：只输出 terminal evidence refs，不输出 raw output。
- [ ] [Code] 实现 `observe-terminal` refs-first projection。
- [ ] [Unit] 写 `submit-terminal-command` 红测：只提交 current terminal input ref，不从 raw string 推断命令。
- [ ] [Code] 实现 `submit-terminal-command` primitive candidate。
- [ ] [Unit] 写 terminal drift 红测：submit 前 terminal window / session / input ref 漂移时 blocked-safe。
- [ ] [Live] env-gated live 按 `focus -> send -> observe` 先跑不提交诊断。
- [ ] [Live] env-gated live 再按 `focus -> send -> observe -> submit -> observe -> cleanup` 跑显式安全探针或 blocked-safe。
- [ ] [Verify] 跑 terminal unit tests、live skip path、typecheck、cleanup/no-bypass smoke。

验收：

- [ ] Unit tests 证明 raw command 被拒绝。
- [ ] Live diagnostic 证明 terminal focus / send / observe / submit 分离，或 blocked-safe。
- [ ] terminal 目标漂移或多 terminal 不唯一时 `needs-confirmation` / `blocked`。
- [ ] cleanup refs 完整，不杀 VSCode，不清 profile。

### P8：VSCode Command Palette Atomic Capabilities

目标：Command Palette 只选择 current observe 产生的 item ref；raw command id / raw label 不能成为执行旁路。

Build Tasks：

- [ ] [Unit] 写 `open-command-palette` 红测：唯一 VSCode window 才 ready。
- [ ] [Code] 实现 `open-command-palette` readiness。
- [ ] [Unit] 写 `send-command-palette-query` 红测：只接受 `text-ref:`，不暴露 raw query。
- [ ] [Code] 实现 `send-command-palette-query` primitive candidate。
- [ ] [Unit] 写 `observe-command-palette-items` 红测：只输出 item refs，不输出 raw label / raw command id。
- [ ] [Code] 实现 `observe-command-palette-items` refs-first projection。
- [ ] [Unit] 写 `select-command-palette-item` 红测：只接受 current observe item ref；stale item ref 被拒绝。
- [ ] [Code] 实现 `select-command-palette-item` primitive candidate。
- [ ] [Unit] 写 palette ambiguity 红测：item 不唯一、palette 未打开、palette 目标漂移时 blocked-safe。
- [ ] [Live] env-gated live 按 `open -> send query -> observe items` 先跑不选择诊断。
- [ ] [Live] env-gated live 再按 `open -> send query -> observe items -> select item -> observe -> close/cleanup` 跑显式安全探针或 blocked-safe。
- [ ] [Verify] 跑 palette unit tests、live skip path、typecheck、cleanup/no-bypass smoke。

验收：

- [ ] Unit tests 证明 raw command id / raw palette label 不能直接执行。
- [ ] Live diagnostic 证明 item ref 来自 current observe，或 blocked-safe。
- [ ] palette 目标漂移、item 不唯一或 observation stale 时 `needs-confirmation` / `blocked`。
- [ ] cleanup refs 完整，不留下 palette 或焦点漂移。

### P9：VSCode Editor Mutation 与 Host-owned Narrow Apply

目标：最后才进入写入 primitive；先 preview，再由 Host 明确拆成 `observe -> one primitive -> observe`，Computer Use core 仍不做 planning。

Build Tasks：

- [ ] [Unit] 写 preview scope 红测：只支持当前选区或 Host 明确选择的单个范围；范围不明确时 `needs-confirmation`。
- [ ] [Code] 实现 preview v1：输出 draft / diff artifact refs，不调用 VSCode 写入 primitive。
- [ ] [Unit] 写 `insert-draft` 红测：只能基于 current selection / cursor refs 和 `text-ref:`。
- [ ] [Code] 实现 `insert-draft` primitive candidate；不从 raw selected text 或 raw path 推断目标。
- [ ] [Unit] 写 `replace-selection` 红测：只能基于 current selection refs 和 `text-ref:`。
- [ ] [Code] 实现 `replace-selection` primitive candidate。
- [ ] [Unit] 写 `save-current-file` 红测：需要 same-file、mutation、current editor refs 和 Host decision/action evidence。
- [ ] [Code] 实现 `save-current-file` readiness；full-access 文件操作不走类别式 confirmation gate。
- [ ] [Unit] 写 editor drift 红测：文件、选区、editor group 或目标窗口漂移时 blocked-safe。
- [ ] [Unit] 写 narrow apply 红测：明确 apply 时只能生成一个 `replace-selection` 或 `insert-draft` primitive candidate。
- [ ] [Code] 实现 narrow apply Host bridge：拆成 `observe -> one primitive -> observe`。
- [ ] [Unit] 写 apply verification 红测：apply 后必须有 same-file、mutation、cleanup refs。
- [ ] [Code] 实现 apply verification projection；不从 Computer Use `completed` 推断用户任务完成。
- [ ] [Code] 实现 final projection：final answer 只能来自 Agent Host，并引用 artifact refs / evidence refs。
- [ ] [Static] 扩展 no-bypass guard：preview / apply 不能新增 runtime final-answer、raw diff、raw selected text 或 raw path 旁路。
- [ ] [Live] env-gated mutation 先只跑 scratch / temporary editor probe。
- [ ] [Live] env-gated mutation 再跑用户当前选区场景；证据不足时 blocked-safe。
- [ ] [Verify] 跑 editor mutation / preview / apply unit tests、live skip path、typecheck、cleanup/no-bypass smoke。

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
