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

## 已闭合基线

这些只保留新方案已经闭合的摘要，不再展开旧任务 checklist。后续发现旧实现、旧测试或旧文档和当前方案冲突时，直接删除、改写或 fail closed；不要为历史 run、旧 API、旧 GUI completion 或旧 Computer Use task surface 留兼容层。

- [x] P0-P5：路线图、public projection、旧旁路删除、Computer Use lifecycle、VSCode entry gate、VSCode identity / concept normalization 已收口到 refs-first Host/App Module/Core 边界。
- [x] P6：VSCode ambiguity 与 read-only diagnostic 已闭合；多窗口、多区域、unknown webview、stale observation 均 blocked-safe，只读 readiness 和 env-gated live diagnostic 保持 refs-only。
- [x] P7：VSCode terminal 原子能力已闭合；`focus-terminal`、`send-terminal-text`、`observe-terminal`、`submit-terminal-command` 分离，raw command 被拒绝，terminal drift blocked-safe，live path 仅 `live-diagnostic`。
- [x] P8：VSCode Command Palette 原子能力已闭合；palette 只从 structured Host operation 进入，只选择 current observe 产生的 item ref，raw command id / raw label / history / completed action 不能触发执行；mocked diagnostic 已覆盖 cleanup，live path 仍只允许 `live-diagnostic`。
- [x] P9.0：旧 editor mutation / save readiness 已 fail closed；旧直接写入、undo / redo、save shortcut 不能作为新方案兼容路径保留。
- [x] P9.1：`editor-scope` readiness 已实现；只输出 editor / file / selection / cursor / range refs，不写入。
- [x] P9.2：Host materializer 只从 structured `editor-scope` operation 进入 scope readiness；ordinary chat、commandText、terminal output、history 和 completed action 不触发；selection / cursor / range refs 保持 tokenized public refs。
- [x] P9.3：scope public projection 已补最终 Host/public 窄化；safe editor / file / selection / cursor / range / freshness / reason refs 保留，宽 window / observation / operation / module / terminal / history refs、payload-shaped scope refs、raw selected text、raw visible text、raw diff、raw path、URL alias 和 provider payload 被拒绝或清洗。
- [x] P9.4：editor-scope live diagnostic 默认 env-gated blocked；无 env 时返回 skip/block manifest，不构造 runner / adapter，不申请 input lease / cursor。
- [x] P9.5-P9.6：mocked editor-scope diagnostic 与 focused verify 已闭合；env-on mock 跑 `bind -> observe -> host-decision -> observe -> control(release)`，只投影 scope / freshness / reason / cleanup refs，并释放 input lease / adapter / cursor、恢复焦点和鼠标位置。
- [x] P9.7-P9.12：Preview No-write 已闭合；Host-owned preview provider 只生成 draft / preview / diff artifact refs 和 refs-only verifier ref，materializer 只从 structured `preview-current-selection` operation + current scope refs 进入，ordinary chat / selected text / terminal output / history / completed action 不触发；env-gated mocked diagnostic 跑 `bind -> observe -> host-decision -> control(release)`，不写 VSCode、不写用户文件、不宣称 `product-ready`。
- [x] P9.13-P9.15：Scratch Mutation unit path 已闭合；`insert-draft` / `replace-selection` 只从 structured Host operation refs、current scope refs 和 Host `text-ref:` 生成单个 `computer_use.act` primitive candidate；public projection 只保留 scope / text-ref / verifier refs；mutation verifier 要求 action evidence、same-file、same-window、same-editor、same-selection 和 after-observe refs，漂移 blocked-safe。
- [x] P9.16-P9.18：Scratch Mutation live skip / mocked diagnostic 已闭合；独立 `SCIFORGE_COMPUTER_USE_VSCODE_COWORK_SCRATCH_MUTATION_LIVE_DIAGNOSTIC=1` gate 默认 blocked，generic live env 不能解锁 scratch writer；env-on mock 只允许非用户 scratch buffer，跑 `bind -> observe -> host-decision -> act -> observe -> control(release)`，验证 mutation verifier 与 cleanup refs，不写用户文件、不宣称 `product-ready`。
- [x] P9.19-P9.20：Narrow Apply unit path 已闭合；`apply-current-selection` 是 Host-owned bridge，不是 VSCode module capability，只能从 structured Host operation + current scope refs + Host `text-ref:` 映射为一个 `replace-selection` / `insert-draft` primitive candidate；apply verifier 要求 same-file、same-window、same-editor、same-selection、after-observe、release 与 cleanup refs，不能把 Computer Use `completed` 当作用户任务完成。
- [x] P9.21-P9.22：Save / batch unit path 已闭合；`save-current-file` 只从 structured Host operation、current editor/file refs、same-file + mutation verifier 和 Host action evidence 生成一个 `Meta+S` `computer_use.act` candidate；`bulk-replace` / `cross-file-modify` 由 Host-owned decomposition guard blocked-safe，不会生成单个 Computer Use task、`act` 或 `run_procedure`。
- [x] P10.0-P10.6：显式 VSCode + Computer Use ordinary chat 已进入 Host-owned P10 bridge；入口只生成 refs-first `sciforge.codex-agent-host-input.v1`，native route 可在无预绑定 window candidates 时启动 current VSCode command palette live diagnostic runner；默认 macOS adapter 支持菜单方式打开 command palette、action-backed palette refs、palette `text-ref:` 输入、`Escape` 关闭和 release cleanup；Host 已有多窗口或 selected/observed 冲突证据时 direct live route 先返回 `needs-confirmation` / `blocked`，不会启动 live runner 猜窗口。

## 当前执行路线

### P10：VSCode 真实绑定与 Command Palette 操纵闭环

目标：最快打通用户已打开 VSCode 的真实 Computer Use 绑定/操纵闭环。P10 只做一个很窄的 live-diagnostic：显式用户请求使用 Computer Use 操纵当前 VSCode 时，由 Agent Host 包装成 structured Host input，然后跑 `bind -> observe -> host-decision(open-command-palette) -> act -> observe -> host-decision(send-command-palette-query) -> act -> observe -> host-decision(close-command-palette) -> act -> observe -> control(release)`。Computer Use core 不做 task planning；VSCode module 只提供 readiness / evidence gate；用户级 final answer 仍由 Agent Host envelope 产生。

当前状态：P10 单元、mocked/native route、真实 VSCode command palette live diagnostic 和 direct route 多窗口/冲突 UX gate 已闭合；真实桌面仍是 env-gated `live-diagnostic`，不能宣称 `product-ready`。

- [x] [P10.0 Unit] 显式 VSCode + Computer Use ordinary chat 不 spawn 通用 app-server，而是生成 refs-first Host input。
- [x] [P10.0 Code] `CodexAppServerClient` 只在文本同时明确指向 VSCode 与 Computer Use / 桌面操纵 / 命令面板时包装 Host input；普通 VSCode 问答不路由。
- [x] [P10.1 Unit] P10 command palette Host input 即使没有预绑定 window candidates，也能进入 current VSCode live diagnostic runner。
- [x] [P10.1 Code] `computer-use-native-route` 对 `open-command-palette` structured Host operation 直接启动 live diagnostic runner；没有 Host final-answer envelope 时仍 blocked / partial，不本地铸造最终回答。
- [x] [P10.2 Code] 默认 current VSCode live runner 可选择 command palette diagnostic；query 只通过 `text-ref:` 解析，public result 不泄漏 raw command / raw label / provider payload。
- [x] [P10.3 Code] 默认 macOS shared-system-input adapter 支持 command palette open / query / close：菜单方式打开 command palette、action-backed palette refs、palette input `text-ref:`、`Escape`。
- [x] [P10.4 Verify] focused tests 覆盖 ordinary chat bridge、P10 native route、command palette adapter context。
- [x] [P10.5 Live] 在本机显式开启 `SCIFORGE_COMPUTER_USE_VSCODE_COWORK_PALETTE_LIVE_DIAGNOSTIC=1` 后，验证真实 VSCode `bind -> observe -> open -> observe -> query -> observe -> close -> observe -> release`，并确认 input lease / adapter / cursor / focus / mouse cleanup refs。
- [x] [P10.6 UX] 如果 Host 已有多个 VSCode window/frontmost candidates、live bind 发现多个非 frontmost VSCode 窗口，或 selected window 与 latest observation 冲突，Host public answer 必须给出 `needs-confirmation` / `blocked`，不能启动 direct live runner 猜窗口。

验收：

- [x] 普通用户在 SciForge 里明确说“用 Computer Use 操纵当前 VSCode / 打开命令面板”时，进入 Host-owned native route，而不是长时间卡在 app-server tool discovery。
- [x] public events 只包含 refs、safe summary、Host final answer envelope；不出现 raw screenshot、raw AX、raw command、raw label、raw path、provider payload、URL、base64 或 secret。
- [x] shared-system-input 路径只标 `live-diagnostic`，不杀 VSCode、不清 profile、不宣称 `product-ready`。

### P11：SciForge UI Dogfood 与用户可见闭环

目标：把 P10 的真实 VSCode command palette live-diagnostic 从 native route 证据闭环推进到 SciForge 对话 UI 的可见闭环。P11 仍然不扩大 Computer Use core，不做 task planning；只验证用户在 SciForge UI 中提出明确 VSCode Computer Use 请求时，Host bridge、native route、live runner、public event、final answer 和 cleanup 能稳定串起来。

当前状态：P11.0 已闭合；P10 已提供可复用的 direct live route、ambiguity blocker 和真实桌面验收测试，UI runtime event reader 现在能把 Host final answer 的 `completed` / `needs-confirmation` / `blocked` 三态稳定投影为用户可见结果并结束等待。

- [x] [P11.0 Unit] SciForge UI / client runtime event 投影测试：P10 `completed`、`needs-confirmation`、`blocked` 三类 Host final answer 都能在对话中终止等待，不显示“长期 worked / 无回复”；`needs-confirmation` 会在 message provenance 标记 `requiresUserConfirmation`，`blocked` / `needs-confirmation` 不可被当作 live acceptance。
- [ ] [P11.1 Code] 对 explicit VSCode Computer Use ordinary chat，前端只消费 unified native route public events；不新增 chat bypass、不把 runner result 当作独立旁路消息。
- [ ] [P11.2 Dogfood] 在本机 `localhost:5173` 通过 SciForge UI 发起“用 Computer Use 操纵当前 VSCode，打开命令面板”，验证不再卡在 unavailable / app-server discovery，最终只显示 `live-diagnostic` safe answer。
- [ ] [P11.3 UX] 多 VSCode 窗口或证据冲突时，SciForge UI dogfood 显示 Host `needs-confirmation` / `blocked`，不自动选择窗口；用户确认后的下一步仍由 Host 重新发一个 primitive。
- [ ] [P11.4 Verify] 跑 UI event tests、P10 native route tests、typecheck、Computer Use no-bypass / no-legacy smoke，并确认没有 raw screenshot/base64/provider payload 进入 chat context。

### P9：VSCode Editor Mutation 与 Host-owned Narrow Apply

目标：最后才进入写入 primitive；先 scope，再 preview，再 scratch mutation，最后由 Host 明确拆成 `observe -> one primitive -> observe`。Computer Use core 始终不做 planning、verification、repair 或 final answer。

当前状态：P9-A scope projection 与 diagnostic、P9-B Preview No-write、P9-C Scratch Mutation，以及 P9-D 的 Narrow Apply / Apply Verification / Save / Batch Decomposition unit bridge 已闭合。当前推进重心已经转到 P10 VSCode 真实绑定与 command palette live-diagnostic。

#### P9-A：Scope Projection 与 Diagnostic

- [x] [P9.3 Unit] scope public projection 红测：raw selected text、raw path、URL、provider payload、raw visible text 必须被拒绝或清洗。
- [x] [P9.3 Code] scope projection 只保留 editor / file / selection / cursor / range / freshness / reason refs。
- [x] [P9.4 Unit] env-gated scope diagnostic 默认关闭；无 env 时必须返回 blocked skip manifest。
- [x] [P9.4 Code] 无 env 时不构造 runner / adapter，不申请 input lease。
- [x] [P9.5 Mocked Scope] mock 当前 selection / cursor / range scope；只返回 scope refs、freshness refs、reason refs 和 cleanup refs。
- [x] [P9.6 Verify Scope] 跑 scope unit、materializer、live skip、no-bypass focused tests。

#### P9-B：Preview No-write

- [x] [P9.7 Unit] preview provider 红测：draft / diff 只能作为 artifact refs，不进入 Computer Use primitive。
- [x] [P9.7 Code] 实现 preview v1；由 Host-owned provider 生成 artifact refs，不调用 VSCode 写入 primitive。
- [x] [P9.8 Unit] preview materializer 红测：只从 structured Host operation ref + current scope refs 进入。
- [x] [P9.8 Code] preview 不从 ordinary chat、selected text、history、terminal output 或 completed action 推断。
- [x] [P9.9 Static] preview public projection 不能泄漏 raw selected text、raw diff、raw path、URL 或 provider payload。
- [x] [P9.10 Live Skip] env-gated preview diagnostic 默认关闭；无 env 时不构造 writer / adapter。
- [x] [P9.11 Mocked Preview] mock 当前选区 preview：只返回 scope refs、artifact refs、verifier refs 和 preview 状态，不写文件。
- [x] [P9.12 Verify Preview] 跑 preview provider、projection、live skip、cleanup/no-bypass focused tests。

#### P9-C：Scratch Mutation

- [x] [P9.13 Unit] `insert-draft` 红测：只能基于 current cursor / selection refs 和 Host `text-ref:`。
- [x] [P9.13 Code] 实现 `insert-draft` primitive candidate；不从 raw selected text、raw path 或历史 run 推断目标。
- [x] [P9.14 Unit] `replace-selection` 红测：只能基于 current selection refs 和 Host `text-ref:`。
- [x] [P9.14 Code] 实现 `replace-selection` primitive candidate。
- [x] [P9.15 Unit] editor drift 红测：file / editor group / selection / target window / observation 漂移时 blocked-safe。
- [x] [P9.15 Code] 实现 same-file / same-editor / same-selection / same-window verifier refs。
- [x] [P9.16 Live Skip] env-gated scratch / temporary buffer mutation diagnostic 默认关闭；无 env 时不构造 writer / adapter。
- [x] [P9.17 Mocked Scratch] mock 非用户 scratch buffer mutation；验证 after-observe、mutation verifier 和 cleanup，不影响用户文件。
- [x] [P9.18 Verify Scratch] 跑 mutation unit、drift、scratch live skip、cleanup/no-bypass focused tests。

#### P9-D：Narrow Apply / Save / Batch

- [x] [P9.19 Unit] narrow apply 红测：明确 apply 时只能生成一个 `replace-selection` 或 `insert-draft` primitive candidate。
- [x] [P9.19 Code] 实现 narrow apply Host bridge：严格拆成 `observe -> one primitive -> observe`。
- [x] [P9.20 Unit] apply verification 红测：apply 后必须有 same-file、mutation、after-observe、release 和 cleanup refs。
- [x] [P9.20 Code] 实现 apply verification projection；不从 Computer Use `completed` 推断用户任务完成。
- [x] [P9.21 Unit] `save-current-file` 红测：需要 same-file、mutation、current editor refs 和 Host decision/action evidence。
- [x] [P9.21 Code] 实现 `save-current-file` readiness；full-access 文件操作不走类别式 confirmation gate。
- [x] [P9.22 Unit] batch / cross-file 红测：批量或跨文件修改必须由 Host 分解为多次 single primitive，不生成单个 Computer Use task。
- [x] [P9.22 Code] 实现 batch / cross-file decomposition guard；只输出下一步 refs、partial evidence 或 blocked reason。
- [x] [P9.23 Live Skip] env-gated current selection diagnostic 默认关闭；无 env 时不构造 writer / adapter。
- [x] [P9.24 Mocked Current Selection Preview] mock 用户当前选区 preview；不写文件，证据不足 blocked-safe。
- [x] [P9.25 Mocked Current Selection Apply] mock explicit apply：只执行一个 primitive，随后 observe / verify / release。
- [x] [P9.26 Verify Apply] 跑 scope / preview / mutation / apply / save / batch tests、typecheck、cleanup/no-bypass smoke。

验收：

- [x] “润色当前选区”先返回 diff preview，不写文件。
- [x] 明确应用当前选区会生成一个 `replace-selection` primitive candidate。
- [x] 保存、批量、跨文件修改不触发类别式 confirmation gate，但必须由 Host 基于 current refs 拆成多次单步 primitive。
- [x] 多章节、全文、跨文件修改不会变成单个 Computer Use task。
- [x] public events 不泄漏 raw selected text、raw path、raw command、raw diff 或 provider payload。
- [x] 真实桌面路径只标 `live-diagnostic`，不能宣称 `product-ready`。

## 文档地图

- [`docs/Architecture.md`](docs/Architecture.md)：SciForge 总体架构和唯一 Agent Host 边界。
- [`docs/ComputerUseRuntimeArchitecture.md`](docs/ComputerUseRuntimeArchitecture.md)：Computer Use runtime 与 Host-side App Module 最新设计原则。
- [`docs/ComputerUseEntryRouteAudit.md`](docs/ComputerUseEntryRouteAudit.md)：ordinary chat、native route、runtime gateway、slash command 和旧 VSCode co-work hook 的入口审计。
- [`packages/actions/computer-use`](packages/actions/computer-use)：Computer Use contract、MCP adapter、tests 和 package metadata。
