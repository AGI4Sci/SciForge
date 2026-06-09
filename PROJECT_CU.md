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

## 关闭里程碑

这些是新方案已经闭合的里程碑摘要，不是继续执行的旧任务列表。后续发现旧实现、旧测试或旧文档和当前方案冲突时，直接删除、改写或 fail closed。

- [x] P0-P5：路线图、public projection、旧旁路删除、Computer Use lifecycle、VSCode entry gate、VSCode identity / concept normalization 已收口到 refs-first Host/App Module/Core 边界。
- [x] P6：VSCode ambiguity 与 read-only diagnostic 已闭合；多窗口、多区域、unknown webview、stale observation 均 blocked-safe，只读 readiness 和 env-gated live diagnostic 保持 refs-only。
- [x] P7：VSCode terminal 原子能力已闭合；`focus-terminal`、`send-terminal-text`、`observe-terminal`、`submit-terminal-command` 分离，raw command 被拒绝，terminal drift blocked-safe，live path 仅 `live-diagnostic`。

## 当前执行路线

### P8：VSCode Command Palette Atomic Capabilities

目标：Command Palette 只选择 current observe 产生的 item ref；raw command id / raw label 不能成为执行旁路。

当前 P8 已推进到 app-module unit / materializer / static guard：`open-command-palette`、`send-command-palette-query`、`observe-command-palette-items`、`select-command-palette-item` 已按 refs-first 单步 readiness 接入。P8 尚未进入真实桌面 live diagnostic；P8.9-P8.12 必须先补 env-gated skip、mocked live、mocked select、cleanup 和验证链路，不能把当前 unit-proven 状态宣称为 live 完成。

Build Tasks：

- [x] [P8.0 Unit] 旧 palette ready path 红测：raw command id / raw label / direct command operation 必须 blocked。
- [x] [P8.0 Code] 删除旧 palette readiness；P8 未完成前 `open/send/observe/select/close-command-palette` fail closed。
- [x] [P8.1 Unit] palette concept 红测：无 palette、多 palette、palette refs stale 时 blocked-safe。
- [x] [P8.1 Code] 实现 palette root / query input / item list / freshness concept refs；不依赖固定坐标、固定插件或固定语言。
- [x] [P8.2 Unit] `open-command-palette` 红测：唯一 VSCode window 才 ready，只输出 action / target refs。
- [x] [P8.2 Code] 实现 `open-command-palette` primitive candidate；不选择命令。
- [x] [P8.3 Unit] `send-command-palette-query` 红测：只接受 Host `text-ref:`，不暴露 raw query，不按 Enter。
- [x] [P8.3 Code] 实现 `send-command-palette-query` primitive candidate。
- [x] [P8.4 Unit] `observe-command-palette-items` 红测：只基于 current palette / input refs 发起 observe；后续 observation 只能投影 item refs、rank refs、hash refs，不输出 raw label 或 raw command id。
- [x] [P8.4 Code] 实现 palette observe readiness 与 item refs-first projection。
- [x] [P8.5 Unit] `select-command-palette-item` 红测：只接受 current observe item ref；raw label / raw id / stale item ref 都 blocked。
- [x] [P8.5 Code] 实现 `select-command-palette-item` primitive candidate。
- [x] [P8.6 Unit] palette ambiguity / drift 红测：item 不唯一、palette 未打开、window / palette / item observation 漂移时 blocked-safe。
- [x] [P8.6 Code] 实现 palette current-observation / same-window / same-item verifier refs。
- [x] [P8.7 Materializer] Host materializer 只从 structured operation ref 进入 palette readiness；ordinary chat、terminal output、history 和 completed action 不能触发。
- [x] [P8.8 Static] 扩展 no-bypass guard：palette 不能新增 raw command id、raw label、runtime final-answer 或 direct desktop bypass。
- [ ] [P8.9 Live Skip] env-gated palette live 默认关闭；无 env 时返回 blocked skip manifest，且不构造 runner / adapter。
- [ ] [P8.10 Mocked Live] mock `open -> send query -> observe items -> close/release`；不选择命令，验证 cleanup refs。
- [ ] [P8.11 Mocked Select] mock `open -> send query -> observe items -> select item -> observe -> release`；只证明 current item ref 链路，不触碰真实 VSCode。
- [ ] [P8.12 Verify] 跑 palette unit tests、materializer tests、live skip path、typecheck、cleanup/no-bypass smoke。

验收：

- [x] Unit tests 证明 raw command id / raw palette label 不能直接执行。
- [ ] Mocked select 证明 item ref 来自 current observe；真实桌面 live 只做 open/query/observe/close 或 blocked-safe。
- [x] palette 目标漂移、item 不唯一或 observation stale 时 `needs-confirmation` / `blocked`。
- [ ] cleanup refs 完整，不留下 palette 或焦点漂移。

### P9：VSCode Editor Mutation 与 Host-owned Narrow Apply

目标：最后才进入写入 primitive；先 preview，再由 Host 明确拆成 `observe -> one primitive -> observe`，Computer Use core 仍不做 planning。

当前 P9 只有旧 mutation / save path fail-closed 基线完成；editor mutation / save readiness 在 P9 scope、preview 和 verifier 完成前必须继续 fail-closed，不能复用旧直接写入路径。P9 拆成 scope、preview、scratch mutation、narrow apply、save / batch decomposition 五个小阶段，不能从 fail-closed 或 preview 直接跳到真实用户文件写入。

Build Tasks：

- [x] [P9.0 Unit] 旧 mutation / save ready path 红测：旧 `insert-draft`、`replace-selection`、`save-current-file`、undo / redo readiness 必须 blocked。
- [x] [P9.0 Code] 删除旧 app-module editor mutation readiness；P9 未完成前 app-module 写入 readiness fail closed。
- [ ] [P9.1 Unit] editor scope 红测：当前 selection / cursor / single range 缺失或不唯一时 `needs-confirmation`。
- [ ] [P9.1 Code] 实现 scope readiness；只输出 editor / selection / cursor / range refs，不写入。
- [ ] [P9.2 Unit] preview provider 红测：draft / diff 只能作为 artifact refs，不进入 Computer Use primitive。
- [ ] [P9.2 Code] 实现 preview v1；由 Host-owned provider 生成 artifact refs，不调用 VSCode 写入 primitive。
- [ ] [P9.3 Static] preview / scope public projection 不能泄漏 raw selected text、raw path、raw diff 或 provider payload。
- [ ] [P9.4 Live Skip] env-gated preview diagnostic 默认关闭；无 env 时不构造 writer / adapter。
- [ ] [P9.5 Mocked Preview] mock 当前选区 preview：只返回 scope refs、artifact refs、verifier refs 和 blocked/preview 状态，不写文件。
- [ ] [P9.6 Unit] `insert-draft` 红测：只能基于 current cursor / selection refs 和 Host `text-ref:`。
- [ ] [P9.6 Code] 实现 `insert-draft` primitive candidate；不从 raw selected text、raw path 或历史 run 推断目标。
- [ ] [P9.7 Unit] `replace-selection` 红测：只能基于 current selection refs 和 Host `text-ref:`。
- [ ] [P9.7 Code] 实现 `replace-selection` primitive candidate。
- [ ] [P9.8 Unit] editor drift 红测：file / editor group / selection / target window / observation 漂移时 blocked-safe。
- [ ] [P9.8 Code] 实现 same-file / same-editor / same-selection / same-window verifier refs。
- [ ] [P9.9 Live Scratch] env-gated scratch / temporary buffer mutation diagnostic；默认关闭，失败 blocked-safe，cleanup 不影响用户文件。
- [ ] [P9.10 Unit] narrow apply 红测：明确 apply 时只能生成一个 `replace-selection` 或 `insert-draft` primitive candidate。
- [ ] [P9.10 Code] 实现 narrow apply Host bridge：严格拆成 `observe -> one primitive -> observe`。
- [ ] [P9.11 Unit] apply verification 红测：apply 后必须有 same-file、mutation、after-observe、release 和 cleanup refs。
- [ ] [P9.11 Code] 实现 apply verification projection；不从 Computer Use `completed` 推断用户任务完成。
- [ ] [P9.12 Unit] `save-current-file` 红测：需要 same-file、mutation、current editor refs 和 Host decision/action evidence。
- [ ] [P9.12 Code] 实现 `save-current-file` readiness；full-access 文件操作不走类别式 confirmation gate。
- [ ] [P9.13 Unit] batch / cross-file 红测：批量或跨文件修改必须由 Host 分解为多次 single primitive，不生成单个 Computer Use task。
- [ ] [P9.13 Code] 实现 batch / cross-file decomposition guard；只输出下一步 refs 和 blocked/partial evidence。
- [ ] [P9.14 Live Current Selection] env-gated 用户当前选区诊断：先 preview，不写；明确 apply 时单 primitive；证据不足 blocked-safe。
- [ ] [P9.15 Verify] 跑 editor scope / preview / mutation / apply / save unit tests、live skip path、typecheck、cleanup/no-bypass smoke。

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
