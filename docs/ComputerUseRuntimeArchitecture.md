# Computer Use Runtime 设计

最后更新：2026-06-09

## 文档目的

这份文档记录 Computer Use 的稳定边界、primitive 设计、refs-first 证据原则，以及 Host-side App Capability Module 的最新决策。

目标是让人类和 agent 读完后能快速判断：

- 什么属于 Computer Use core。
- 什么属于 Agent Host。
- 每个软件的专门优化应该放在哪里。
- VSCode co-work v1 应该如何推进。

字段、schema、MCP tool definition、validator 和测试真相源仍放在 `packages/actions/computer-use`。本文件只保留架构原则和沟通口径。

## 定位

Computer Use 是 Codex backend 可调用的桌面 / GUI primitive runtime，不是 Computer Use agent，也不是跨应用 workflow engine。

Computer Use 只负责：

- 绑定 Host 指定的真实窗口、应用、显示器或局部 target scope。
- 观察已绑定 target 的当前状态，并产出 refs-first evidence。
- 在已绑定 target 上执行 Host 指定的单个原子 GUI action。
- 执行 Host 指定的无智能局部 procedure，以减少 Host 往返成本。
- 维护 WindowActionSession、input adapter、actor cursor、scoped input lease、stop / cancel / release 控制 refs。
- 对越界、陈旧、未授权、未确认或证据不足的请求 fail closed，并返回 blocked reason / repair hints。

Computer Use 不负责：

- 理解完整用户任务。
- 选择跨模块下一步。
- 改写用户目标。
- 语义 locate / 自动选择控件。
- 自动 repair。
- 判断用户级 completion truth。
- 生成 final answer。
- 保存、提交、发送、上传、删除、支付等副作用的最终决策。

## 职责边界

```text
Agent Host owns:
  task understanding
  target selection
  next-action reasoning
  model calls
  app module selection
  risk / confirmation policy
  verifier selection
  artifact validation request
  completion truth
  final answer

Computer Use owns:
  target-bound session refs
  current observation refs
  scoped executor event refs
  local primitive execution refs
  stale invalidation
  fail-closed diagnostics
  stop / cancel / release controls
```

判断原则：

- 如果某段逻辑需要理解“用户到底想完成什么”，它不属于 Computer Use。
- 如果某段逻辑只需要回答“这个 session 现在看到什么 / 这一个 Host 指定动作是否被安全执行并记录”，它属于 Computer Use。

## Core 模块结构

Computer Use 长期保持小内核和可替换 adapter：

- Primitive Contract：schema、validator、result envelope、risk gate、refs-first 规则。
- Session Runtime：管理 `bind -> active -> paused -> released/stopped/cancelled` 生命周期。
- Input Adapter：每个 session 拥有独立 input adapter 和 cursor marker；共享系统鼠标 / 键盘只能作为全局独占 adapter，被串行 lease 管理。
- Platform Adapter：macOS Accessibility、远程桌面、未来 native sidecar 等平台实现。
- Acceptance Harness：TextEdit / demo app / 多 session live test，只用于验收，不进入 product core。

Product path 优先走 focus-free 或 session-local input adapter。如果某平台动作只能通过共享系统鼠标 / 键盘完成，必须按全局独占资源处理：一次只允许一个 Computer Use action 接管，记录 focus/input lease、可暂停 / 取消、执行后恢复焦点和鼠标位置，并明确该动作期间会短暂影响用户正常输入。

实现默认不启用共享系统输入。只有调用方显式选择 diagnostic 或 handoff 模式时，Computer Use primitive port 才能绑定 `system-input` adapter；此时同一进程内只能有一个 shared-system-input action 进入 executor，其它会话必须 blocked 或排队。

## Primitive Surface

Computer Use MCP public surface 只暴露这些 primitive：

| primitive | 作用 | 边界 |
| --- | --- | --- |
| `computer_use.bind` | 绑定 Host 指定目标，建立 scoped session。 | 不判断目标是否足以完成用户任务；不规划下一步。 |
| `computer_use.observe` | 读取已绑定 target 的当前状态并物化 refs。 | 不选择 action；不把 observation 升级成 completion truth。 |
| `computer_use.act` | 执行 Host 指定的一个原子 GUI action。 | 不接受自然语言目标；只接受 Host 已选定的 element ref、point、key、text ref 或 app command。 |
| `computer_use.run_procedure` | 执行 Host 指定的局部结构化步骤序列，减少多次 primitive 往返。 | 不接受自然语言 task / instruction / goal；不 plan / locate / verify / repair；不判断用户任务完成。 |
| `computer_use.control` | 暂停、停止或释放 session。 | 不参与任务推理；不改变 completion truth。 |

所有 primitive 都必须使用 refs-first envelope。未知字段默认拒绝或进入 diagnostics，不能静默改变语义。

`bind` 成功必须产出 session-scoped `inputAdapterRef`、`cursorRef` 和 `scopedInputLeaseRef`。这些 refs 在同一进程内必须唯一；`act` 和 `control` 只能在对应 session scope 内使用它们。

`act` 的原子动作覆盖 click、double_click、type、key、scroll、wait、app_command 和 drag。这些动作只描述一次明确输入事件或应用命令，不承载智能。

`run_procedure` 是性能和时延优化，不是旧 `runTask` 的改名。它只执行 Host 已经决定好的局部步骤序列。`run_procedure.status=completed` 只表示这段局部 procedure 执行完了，不能证明用户目标完成。

## Host-side App Capability Modules

每个软件的专门优化不进入 Computer Use core。长期采用 Host-side App Capability Module Registry：Agent Host 根据 app / window / observation refs 选择合适的 app module，再由该 module 把软件专门知识压成 refs-first 的状态模型、能力目录和单步 readiness 结果。

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

App module 可以提供：

- app / window / process / bundle identity refs 的识别规则。
- 软件稳定概念模型，例如 window、editor、file、selection、terminal、panel、command palette、diagnostics。
- observation refs 归一化，把通用 screenshot / AX / text / image / title refs 映射成 app-specific tokenized refs。
- target uniqueness 和 ambiguity 检查，例如多窗口、多 editor group、多 terminal、未知 webview 或 stale observation。
- atomic capability catalog，例如 `focus-editor`、`insert-draft`、`save-current-file`、`focus-terminal`、`open-command-palette`。
- primitive readiness：只回答 Host 已决定的一个 operation 是否能在当前 refs 下转成一个 Computer Use primitive，或应 `blocked` / `needs-confirmation`。
- Host-owned evidence provider / verifier，例如 focused-editor、same-file、mutation、save、diagnostics、terminal output 或 command palette item verifier。
- public evidence sanitizer 规则，确保 raw screenshot、raw AX、raw visible text、raw command、raw path、provider payload、URL、base64 或 secret 不进入 public result。

App module 不可以：

- 接受自然语言 task / goal / instruction。
- 自己选择多步计划、自动 repair、循环 retry 或跨模块下一步。
- 直接调用模型并把模型输出作为执行决策。
- 直接操作桌面绕过 `bind -> observe -> act -> control` primitive。
- 改变 risk / confirmation policy。
- 判断用户级 completion truth。
- 生成 final answer。

App module 是懂某个软件的“状态模型、能力目录和证据门”，不是第二个 agent。智能载体仍然是 Agent Host；需要模型能力时由 Host 调 Model Router 或 Host-owned verifier/provider，并把结果压成安全 refs 后再进入下一步。

## VSCode App Module v1

VSCode 是第一个 app module 目标。v1 聚焦用户已打开 VSCode 的 co-work，不要求固定布局或固定插件集合。泛化策略是稳定概念、能力探测和多证据确认，而不是坐标脚本。

### 设计口径

- 不假设 editor、terminal、explorer、problems panel 或插件 webview 的固定位置。
- 用 app/process/window/title/frontmost refs、AX refs、visible text refs、image refs、file refs、editor/terminal/palette element refs、action refs 和 freshness refs 组合证明目标。
- 只要证据足够即可；不要求每一步都视觉验证。
- 证据冲突或不足时返回 `needs-confirmation` / `blocked`，不能猜测。
- 未知插件 webview 默认是未知区域，除非 refs 足以证明它就是 Host 选择的目标。
- 当前 co-work session 采用 Agent full-access 口径。
- VSCode App Module v1 自身不做 permission / confirmation gate；它只做 refs-first、目标唯一性、原子性、evidence 和 cleanup gate。
- 若未来存在全局 Host hard-confirm policy，它仍属于 Agent Host 风险层，不属于 VSCode module。

### v1 能力目录

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

Terminal 必须按 refs-first 分步优先：

```text
focus-terminal
  -> send-terminal-text
  -> observe-terminal
  -> submit-terminal-command
  -> observe-terminal
```

`send-terminal-text` 只把 `text-ref:` 输入到唯一 terminal，不按 Enter；`submit-terminal-command` 只提交当前 terminal 输入，不携带 raw command。命令语义、运行结果和下一步修复由 Agent Host 基于后续 observe refs 判断。

Command Palette 也必须分步：

```text
open-command-palette
  -> send-command-palette-query
  -> observe-command-palette-items
  -> select-command-palette-item
  -> observe
```

Command Catalog 是稳定性目录，不是权限系统。VSCode module 不接受模型随意传入的 raw command id；Host 必须基于 allowlisted capability 或当前 observe 产生的 command palette item refs 选择下一步。VSCode module 只验证 item ref 来自 current observe，并把选择映射为一个原子 primitive。

### v1 Readiness Gate

每个 VSCode operation 至少要检查：

- active session ref。
- selected window ref。
- app/process/window/title/frontmost identity refs。
- current observe ref 与 freshness ref。
- 目标区域 refs，例如 editor element、terminal element、command palette item。
- 需要文件目标时，selected `file-ref:` 必须来自 current observe。
- 需要输入内容时，只接受 `text-ref:`，不接受 raw text / raw command。
- Host decision/action evidence 必须绑定同一个 session、window 和目标 refs。
- before/after evidence 必须能证明动作没有漂移到其它窗口、文件、terminal 或 palette。
- release evidence 必须包含 input lease、adapter、cursor、front app 和 mouse restoration refs。

缺少关键 refs、refs 混用 raw payload、目标不唯一或 evidence 冲突时，返回 `blocked` / `needs-confirmation`，不能 silent-drop 后继续执行。

## 风险与确认

Computer Use 可以识别动作风险并返回 `needs-confirmation`，但不能自己决定高风险动作是否应该执行。确认由调用方收集；Computer Use 只在策略要求 confirmation 时验证 approval ref 是否匹配当前 action risk envelope。

当前 VSCode co-work 采用 Agent full-access 口径：本地文件系统、用户 VSCode profile 和用户已打开工作区属于正常协作范围。保存用户真实文件、撤销用户编辑、批量替换或跨文件修改不再因为真实文件 / 保存 / 批量 / 跨文件本身要求 confirmation。

full-access 不改变 refs-first：

- Host 仍必须绑定 current session、target window、editor / terminal / palette target、selected file 或 item refs、Host decision/action evidence。
- 批量 / 跨文件不能作为 Computer Use core batch plan 执行，必须由 Host 基于每次 observe refs 拆成多次单步 primitive。
- VSCode App Module v1 不做 permission / confirmation gate；若有全局 hard-confirm policy，仍由 Agent Host 风险层拥有。

## Evidence 原则

改变界面的 action 必须记录：

- current target-bound before observation ref。
- scoped executor event ref。
- session-scoped input adapter ref 和 cursor ref。
- input event ref，若 action 使用真实输入。
- after observation ref，若 action 会改变界面或 Host 要求 capture-after。
- stale invalidation refs。

`run_procedure` 必须保留每个 step 的 primitive refs、executor event refs 和 invalidated refs，不能只返回 procedure-level summary。

保存、导出和用户级产物必须额外由 artifact refs / validator refs 支撑。Computer Use 不拥有这些 validator；它只能产出 GUI action evidence。

raw screenshot、raw AX tree、raw visible text、raw command、raw path、raw provider payload、data URL、base64、API key 和 secret 不得进入 primitive body 或 public diagnostics。

## 局部感知原则

Computer Use primitive 默认不调用模型。

如果某个 adapter 需要模型或其它感知组件做局部辅助，它只能作为 observation provider 或 translator 输出 refs-first observation，例如截图 / crop 描述、AX / visible text compression、候选目标摘要或 before / after 差异摘要。

这类局部感知组件不能在 Computer Use 内部：

- 输出最终执行坐标。
- 改变 risk policy。
- 绕过 confirmation。
- 自动 repair。
- 产出 completion truth。
- 生成 final answer。

调用方可以读取 Computer Use refs 后自行调用模型或 verifier；这不属于 Computer Use primitive 内部职责。VSCode focused-editor、terminal、command palette 或 mutation 证明遵守同一原则：视觉、AX、文本、图像或其它观察能力都只能在 Host / verifier 边界消费 refs 并输出新的安全 evidence refs。

## 能力成熟度

每项能力都要标清成熟度，避免把 contract、fixture 或 diagnostic path 误认为产品能力。

- `contracted`：primitive schema、validator、result envelope 和风险边界已经定义。
- `unit-proven`：contract test 证明 validator、状态机、风险门和 evidence refs 正常。
- `live-diagnostic`：能在真实桌面上跑通，但仍可能依赖共享系统输入、测试专用窗口或诊断适配器。
- `product-ready`：走 session-local input adapter，真实桌面验收通过，执行后无窗口、进程、临时文稿或 artifact 残留。
- `blocked`：平台或 adapter 暂时不能满足隔离、证据或清理要求，必须说明缺口和恢复条件。

只有 `product-ready` 能作为 Computer Use 产品路径能力对外声明。其它状态只能用于开发、调试或风险说明。

当前状态摘要：

- P0/P1/P3/P8 真实桌面路径均仍是 `live-diagnostic`，因为依赖共享系统输入或用户 profile。
- P4/P5/P7 主要是 `unit-proven`，证明 Host 能调用 primitive 并基于 evidence 生成答复。
- P9 已完成 current VSCode read-only ordinary/native route、HTTP/SSE route 和 focus-editor 默认 provider 的真实 `live-diagnostic`。
- P9c insert-draft、focused context handoff、private draft resolver 和 mutation verifier gate 仍是 `unit-proven`。
- P9 不能声明 `product-ready`。
- P10 论文修改 / 润色 GUI 协作尚未实现。

## 迁移口径

旧路径包括 `executeBoundedOperation`、`computer_use.perform_local_action`、`computer_use.fill_fields`、`computer_use.runTask(request, hostPorts)`、`plan`、`locate`、`verify` 等。

迁移目标：

- `perform_local_action` 拆为 `bind` / `observe` / `act`。
- `fill_fields` 由调用方多次调用 `act(type/key/click)` 表达，或在调用方已明确步骤后使用 `run_procedure` 降低往返。
- `runTask` 不进入新 MCP public surface，也不新增内部 legacy alias 或 compatibility wrapper。
- 无智能局部组合能力进入 `run_procedure`；它只执行 Host 指定的结构化步骤序列。
- `plan` 移到调用方。
- `locate` 变成调用方对 observation refs 的选择；Computer Use 只接受 element ref / point。
- `verify` 移到调用方 / verifier / artifact validator。
- 每个软件的专门优化迁移到 Host-side App Capability Module，不进入 Computer Use core。

历史或诊断引用只能用于拒绝、迁移审计或 evidence invalidation，不能作为执行路径、自动转译路径或 completion truth。

## 用户级验收

Computer Use 只能提供局部执行证据，不能单独提供用户级验收。

真实桌面验收可以操作本地应用，但必须默认去除自身副作用：关闭自己创建的临时窗口 / 文稿，释放 session / input lease，退出自己启动且无用户文稿的应用，并删除临时 evidence artifacts。只有显式 debug / keep 开关可以保留这些产物，且保留路径必须清晰标记。

可作为 Computer Use 局部证据的对象：

- current-run `bind` / `observe` / `act` / `run_procedure` evidence refs。
- scoped executor event refs。
- before / after observation refs。
- stale invalidation refs。
- 必要时由调用方关联的 artifact refs / validator refs。

禁止把这些对象当作产品 truth：

- GUI projection。
- Image / Evidence pane。
- screenshot replay。
- frame stream。
- fixture。
- package probe。
- legacy VirtualAppScreen / Docker / noVNC / RDP / Xpra。
- 历史 run。
- 单步 action ref。
- 历史 `runTask` 记录或 legacy 拒绝记录里的 `status=completed`。
- `run_procedure` 的 `status=completed`，除非调用方另有 current-run completion truth 和必要 artifact / validator refs。

## 契约真相源

长期 contract、MCP tool schema、validator 和测试应放在：

- `packages/actions/computer-use/index.ts`
- `packages/actions/computer-use/mcp.ts`
- `packages/actions/computer-use/action-provider.manifest.json`
- `packages/actions/computer-use/*.test.ts`

Host-side App Capability Module 的 contract / registry 落地后，应拥有独立的 Host-side contract 和 tests；Computer Use core contract 不因 VSCode module 扩大。

## 相关文档

- [`Architecture.md`](Architecture.md)：总架构和 Computer Use 上下游边界。
- [`BrowserRuntimeArchitecture.md`](BrowserRuntimeArchitecture.md)：Browser primitive runtime 的同构设计。
