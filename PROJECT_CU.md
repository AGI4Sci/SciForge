# SciForge Computer Use 当前任务

最后更新：2026-06-10

## 当前目标

把 Computer Use 收敛成一个通用 refs-first GUI primitive runtime，并在它之上实现可插拔的 Host-side App Capability Module。第一个专门模块是 VSCode；当前重点不是继续堆 command palette 特例，而是实现通用 VSCode 操纵能力，让 Agent Host 可以通过同一套能力完成真实复杂任务。

近期验收场景：通过 VSCode 完成一次真实论文润色协作，例如“润色当前论文选区 / 当前论文文件的一段内容”。论文润色只能作为 generic VSCode capability composition 的 dogfood，不能做成 `paper-polish` 专用 runner、硬编码 prompt、硬编码文件名、硬编码 VSCode 命令或聊天旁路。

本文件是继续推进的唯一任务路线图，不是旧任务存档。旧任务已删除；后续发现旧实现、旧测试或旧文档和当前方案冲突时，直接删除、收口或 fail closed，不做 legacy alias、compatibility wrapper、fallback shortcut、历史 run 转译或旁路保留。

## 不可变原则

每个阶段打勾前都要重新确认这些原则仍成立：

- [x] 旧逻辑代码和最终目标冲突时，删除旧逻辑，直接实现新版本，不做兼容，保持代码干净。
- [x] 所有修改必须通用，不能为当前页面、截图、URL、文件名、agent id、历史 run、当前论文文本或单个 VSCode 命令写硬编码补丁。
- [x] 大对象必须 refs-first；截图、图片、provider payload、trace、日志和 artifact 不得作为 raw/base64 长期进入聊天正文或主上下文。
- [x] LLM API 配置使用 `/Applications/workspace/ailab/research/app/SciForge/config.local.json`。
- [x] 在能提高时间效率的前提下，尽可能使用 sub agent 并行推进；并行任务必须拆清边界，避免不同 worker 修改同一文件造成冲突。
- [x] SciForge 对话、工作链路需要统一，不要额外生出旁路。
- [x] 符合 `docs/Architecture.md` 和 `docs/ComputerUseRuntimeArchitecture.md` 设计原则；如果继续推进会导致混乱、衍生旁路、设计方案不合理、有相互冲突的点，或有更简洁通用的实现方案，需要停下来和用户讨论。
- [x] Computer Use core 只保留 `bind`、`observe`、`act`、`run_procedure`、`control`。
- [x] `run_procedure` 只执行 Host 已明确给出的局部结构化步骤，不接受自然语言 task / goal / instruction。
- [x] Host 根据 current-run observe refs 决定下一步单个 primitive；Computer Use core 不做 task planning、semantic locate、repair、verification 或 final answer。
- [x] App module 不接受自然语言任务，不调用模型生成执行决策，不生成用户级 final answer。
- [x] ordinary chat、native route、app module、terminal 和 command palette 不能直答；用户级 final answer 只能来自 Codex / Agent Host。
- [x] raw screenshot、raw AX tree、raw visible text、raw selected text、raw command、raw path、provider payload、URL、base64、secret 不得进入 public result。
- [x] 多窗口、目标不唯一、证据冲突或 observation stale 时必须 `needs-confirmation` / `blocked`；多窗口 UI confirmation 暂不作为当前阶段重点，但不能猜窗口。
- [x] 不要求每一步都视觉验证；AX、text、title、image、file、editor、action、freshness 等证据足够即可。
- [x] 当前 VSCode co-work session 采用 Agent full-access 口径；保存真实文件、批量替换、跨文件修改本身不作为 confirmation gate。
- [x] full-access 不改变 refs-first：每一步仍必须绑定 current session、target window、editor / terminal / palette target、selected file 或 item refs、Host decision/action evidence。
- [x] 批量或跨文件修改必须由 Host 拆成多次 single primitive / observe / verify，不得交给 Computer Use core 或 VSCode module 做任务规划。
- [x] 运行后必须 release input lease / adapter / cursor，并恢复前台焦点和鼠标位置。
- [x] 不杀用户 VSCode，不清用户 VSCode profile。
- [x] 共享系统输入路径只能标 `live-diagnostic`，不能宣称 `product-ready`。

## 工作链路

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
      -> Host-owned model / verifier / preview provider
      -> Host-owned final answer
```

执行规则：

- Computer Use 是 Host 可多次调用的工具能力面。
- 每一步只给 Computer Use 一个 primitive，Computer Use 返回 refs，Host 再决定下一步。
- `run_procedure` 只是 Host 已经决定好的局部步骤批处理，不是旧 `runTask`。
- VSCode module 是软件状态模型、能力目录和证据门，不是第二个 agent。
- 智能载体仍然是 Agent Host；需要润色、总结、翻译、诊断解释等模型能力时，由 Host 调 Model Router 或 Host-owned provider。
- App module 只回答 Host 已决定的一个 operation 在当前 refs 下是否 ready，或应 `blocked` / `needs-confirmation`。

## VSCode 通用能力契约

如果一个真实任务不能用下面的能力组合表达，应先新增通用能力族或通用 operation，而不是新增任务专用 runner。

- `target/session`：绑定当前 VSCode、观察当前窗口、刷新 observation、释放 session。
- `read/context`：读取当前 editor scope、selection、visible text、opened file identity、diagnostics、terminal output，并只公开 refs / safe summary。
- `navigation/search`：command palette、quick open、workspace search、go to symbol、tab / editor focus；目标必须来自 Host refs 或 `text-ref:`。
- `terminal`：focus terminal、send terminal text、submit command、observe output；raw command 不进 public result。
- `editor-edit`：preview current selection、insert draft、replace selection、save current file；apply 必须是 Host 明确决定的单个 primitive。
- `verifier/cleanup`：same-window、same-editor、same-file、same-selection、after-observe、save/mutation verifier、release cleanup refs。

通用 operation 必须满足：

- 输入是 structured Host operation、`operationRef`、`targetRef`、`text-ref:`、`artifactRef` 或 verifier refs。
- public result 只包含 tokenized refs、safe summary、blocked reason refs 和 Host final-answer envelope。
- 任何裸自然语言、历史 run、terminal output、command palette item、raw visible text 或 completed action 都不能直接触发 VSCode operation。

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

- [x] 2026-06-10 在删除旧任务前，已把当前项目状态同步到 GitHub：`ab3467c9` pushed to `origin/dev`。
- [x] P0-P5：路线图、public projection、旧旁路删除、Computer Use lifecycle、VSCode entry gate、VSCode identity / concept normalization 已收口到 refs-first Host/App Module/Core 边界。
- [x] P6-P8：VSCode ambiguity、read-only diagnostic、terminal 原子能力、command palette 原子能力已闭合；live path 仍只允许 `live-diagnostic`。
- [x] P9：editor scope、preview no-write、scratch mutation、narrow apply、save / batch decomposition unit path 已闭合；旧 editor mutation / save readiness 已 fail closed。
- [x] P10-P11：SciForge UI dogfood 已证明 ordinary chat -> Host bridge -> native route -> current VSCode command palette live diagnostic -> Host final answer 的可见闭环；open/query/close 与 open/query/select-current-item 能从 UI 跑通，仍只标 `live-diagnostic`。

## 当前执行路线

### P12：通用 VSCode Operation Layer

目标：把 P10 的 command palette special-case 收敛为通用 current VSCode operation bridge。Host 识别用户意图后只生成 structured operation；VSCode module 只做 readiness 和 refs 映射；Computer Use core 只执行 primitive。

- [x] [P12.0 Design] 定义 VSCode capability families 与 operation registry：`target/session`、`read/context`、`navigation/search`、`terminal`、`editor-edit`、`verifier/cleanup`。
- [x] [P12.1 Unit] explicit VSCode Computer Use ordinary chat 只生成 structured Host input；覆盖读取、导航、palette、terminal、diagnostics、preview/apply/save prompt 变体。
- [x] [P12.2 Code] 将 P10 bridge 改为 current VSCode operation bridge factory：输出 `target.vscodeCoWork.operation` / `operationRef` / `text-ref:`，不泄漏 raw label、raw command、raw path。
- [x] [P12.3 Static] no-bypass guard 覆盖新增入口：ordinary chat、native route、terminal output、history、completed action 都不能直接触发 app module operation 或 final answer。
- [x] [P12.4 Verify] 跑 VSCode bridge/native route/app module focused tests、UI event tests、typecheck、Computer Use no-bypass smoke。

验收：

- [x] 新增 VSCode 场景不需要改 native route special-case。
- [x] bridge factory 可以表达至少 5 类 operation，但 public result 仍只有 refs / safe summary / Host envelope。
- [x] 旧 command palette path 仍通过同一套 factory 工作。

### P13：通用观察、读取与导航

目标：先让 Host 能稳定知道 VSCode 当前看到了什么、当前 editor / file / selection 是什么，并能用通用导航能力改变当前上下文。

- [x] [P13.0 Unit] `observe-current-vscode` / `read-editor-context` 只产出 editor / file / selection / cursor / range / visible-text refs，不公开 raw visible text。
- [x] [P13.1 Code] 实现 read/context materializer；Host 可通过 refs 取得内部文本证据，public 只显示 safe summary 和 refs。
- [x] [P13.2 Unit] command palette 不再内置 `Help: About`；任意 palette query 必须来自 Host `text-ref:`。
- [x] [P13.3 Unit] `quick-open` / `workspace-search` 只接受 Host `text-ref:`、workspace resource ref 或 file ref；不能从 raw path / URL / 截图文字直接推断目标。
- [x] [P13.4 Live] 在单窗口 VSCode 上从 SciForge UI 跑一个无写入导航 dogfood：observe current editor -> open palette / quick open -> observe after -> release。

验收：

- [x] Host 能从 current VSCode 获得足够 context refs，为后续编辑任务选择目标。
- [x] navigation 能覆盖 palette 和至少一种非 palette 导航方式。
- [x] 每次 live dogfood 都 release input lease / adapter / cursor，并恢复焦点和鼠标位置。

### P14：通用编辑 Preview / Apply / Save

目标：让 Host 能把模型生成的草稿安全地变成 VSCode 中的一次明确编辑，而不是让 VSCode module 或 Computer Use core 理解“润色”。

- [x] [P14.0 Unit] `preview-current-selection`：Host-owned provider 根据 selection/text refs 生成 draft / diff artifact refs；不写 VSCode。
- [x] [P14.1 Code] `apply-current-selection`：只从 structured Host operation + current scope refs + draft `text-ref:` 生成一个 `replace-selection` 或 `insert-draft` primitive candidate。
- [x] [P14.2 Unit] apply verifier 要求 same-window、same-editor、same-file、same-selection、after-observe、mutation verifier 和 cleanup refs。
- [x] [P14.3 Unit] `save-current-file` 只在已有 same-file + mutation verifier + Host action evidence 时生成一个 `Meta+S` primitive。
- [x] [P14.4 Mocked] UI 入口跑 preview -> apply -> observe -> verify -> save -> release，确认 public 不泄漏 raw selected text、raw diff、raw path 或 provider payload。
- [x] [P14.5 Live] 单窗口 VSCode 上跑一次真实编辑 live diagnostic；可使用当前用户文件或 scratch buffer，full-access 不额外请求类别确认，但目标不明确时必须 blocked。

验收：

- [x] “润色当前选区 / 应用当前草稿 / 保存当前文件”都是通用 operation composition。
- [x] apply 一次只执行一个 editor primitive，批量或全文改写必须由 Host 分解为多次 observe / apply / verify。
- [x] 保存真实文件不需要类别确认，但必须有 current refs、mutation verifier 和 Host action evidence。

### P15：VSCode 真实复杂任务 Dogfood：论文润色

目标：证明 VSCode co-work 可以完成一个真实、有价值、非特例的复杂任务。论文润色必须使用 P12-P14 的通用能力组合，不允许新增 `polish-paper` 桌面 runner。

推荐用户故事：

```text
用户：用 Computer Use 操纵当前 VSCode，润色当前论文选区并保存。
Host：bind/observe current VSCode -> read editor context refs -> call Model Router for polish draft
      -> preview diff artifact refs -> apply one selection edit -> observe/verify -> save -> release
      -> final answer with refs/safe summary
```

任务拆分：

- [x] [P15.0 Unit] 将“润色当前论文选区”分解为 generic operation transcript：observe -> read context -> preview draft -> apply selection -> observe -> verify -> save -> release。
- [x] [P15.1 Unit] Host polish provider 只消费 Host-owned text/artifact refs；public answer 不输出原文全文、raw draft、raw diff 或 provider payload。
- [x] [P15.2 Mocked] 使用 paper-like text fixture 跑完整 transcript；验证每一步都是 generic VSCode operation，不出现 paper-specific operation id。
- [x] [P15.3 Live] 在单窗口 VSCode 上对当前 active selection / active paper file 跑一次真实论文润色；如果没有明确 selection 或 active editable editor，则 blocked-safe，不猜目标。
- [x] [P15.4 Verify] 跑 bridge/native route/app module/editor apply/save focused tests、UI event tests、typecheck、Computer Use no-bypass smoke。
- [x] [P15.5 Cleanup] live dogfood 后确认 release refs、input lease / adapter / cursor、前台焦点和鼠标位置恢复；不杀 VSCode、不清 profile。

Live evidence（2026-06-10）：先复现 blocked-safe：单窗口 VSCode dogfood 可绑定 current file/editor/freshness refs，但未暴露 selection/cursor/range refs 时，`apply-current-selection` 在 Host decision 阶段返回 `needs-confirmation:vscode-editor-narrow-apply:vscode-app-module:editor-scope-selection-required`，未执行 `act`，并 release `scoped-input-lease` / `scoped-input-adapter` / `cursor-marker` / `front-app-restore` / `mouse-position-restore`。

Live evidence（2026-06-10）：修复后在单窗口 VSCode 当前文件 `tmp/current-vscode-p15-live/p15-paper-dogfood.md` 上完成真实 apply/save：scope diagnostic 产出同一 current token `d3d107e1ad4f284b` 下的 `file-ref:vscode:current:*`、`element:vscode:editor:*`、`focused-editor:vscode:current:*`、`selection-ref:vscode:current:*:menu`、`cursor-ref:vscode:current:*:menu`、`range-ref:vscode:current:*:menu-menu`；`apply-current-selection` live run `p15-current-selection-paper-polish-live-verified-file-write` 走 `bind -> observe -> host-decision -> act -> observe -> verify -> host-decision(save-current-file) -> act(save-current-file) -> control(release)`，包含 `verifier:vscode-app-module:same-file:*` / `same-window:*` / `same-editor:*` / `same-selection:*` / `mutation:*`、`action:vscode-app-module:save-current-file:meta-s`、`verifier:vscode-editor-narrow-apply:*:verified`，并 release `scoped-input-lease` / `scoped-input-adapter` / `cursor-marker` / `front-app-restore` / `mouse-position-restore`。磁盘文件内容已从 probe 文本变为 Host `text-ref:current-vscode-cowork:p15-selection-transform-draft` 对应的谨慎学术表述，未公开 raw selected text、raw draft、raw diff 或 provider payload。

验收：

- [x] SciForge UI 中一句自然请求可以触发 Host-owned VSCode co-work，最终由 Host 返回用户可见 final answer。
- [x] 真实编辑发生在 Host 已绑定且验证过的 current editor / selection / file refs 上。
- [x] 润色任务没有专用旁路；同一套 read / preview / apply / save 能服务其它编辑任务。
- [x] public events 只包含 refs、safe summary、artifact refs、verifier refs 和 Host final-answer envelope。
- [x] shared-system-input 路径仍只标 `live-diagnostic`，不能宣称 `product-ready`。
