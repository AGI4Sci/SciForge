# Computer Use Runtime 设计

最后更新：2026-06-08

## 文档目的与约束

这份文档只记录 Computer Use 本身的最新设计原则和沟通口径，目标是让人类和 agent 读完后能快速理解 Computer Use 是什么、能做什么、不能做什么。

原则约束：

- 保持简洁，避免把文档写成 TypeScript contract、JSON schema 或测试用例。
- 文档只描述 Computer Use 自身的稳定边界、primitive、证据原则和迁移原则。
- 外部系统只在解释边界时短提，不展开外部编排、界面呈现、模型路由或产品工作流设计。
- 精确字段、schema、MCP tool definition、validator 和测试真相源放在 `packages/actions/computer-use`。
- 历史路径只保留必要迁移口径，不作为新设计的主叙事。
- 如果实现细节变复杂，优先更新 package contract 和测试；本文件只补能帮助沟通和理解需求的原则。

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
- 保存、提交、发送、上传、删除、支付等高风险副作用的最终决策。

## 模块化结构

Computer Use 长期保持小内核和可替换 adapter：

- Primitive Contract：schema、validator、result envelope、risk gate、refs-first 规则。
- Session Runtime：管理 `bind -> active -> paused -> released/stopped/cancelled` 生命周期。
- Input Adapter：每个 session 拥有独立 input adapter 和 cursor marker；共享系统鼠标 / 键盘只能作为全局独占 adapter，被串行 lease 管理。
- Platform Adapter：macOS Accessibility、远程桌面、未来 native sidecar 等平台实现。
- Acceptance Harness：TextEdit / demo app / 多 session live test，只用于验收，不进入 product core。

Product path 优先走 focus-free 或 session-local input adapter。如果某平台动作只能通过共享系统鼠标 / 键盘完成，必须按全局独占资源处理：一次只允许一个 Computer Use action 接管，记录 focus/input lease、可暂停 / 取消、执行后恢复焦点和鼠标位置，并明确该动作期间会短暂影响用户正常输入。

实现默认不启用共享系统输入。只有调用方显式选择 diagnostic 或 handoff 模式时，Computer Use primitive port 才能绑定 `system-input` adapter；此时同一进程内只能有一个 shared-system-input action 进入 executor，其它会话必须 blocked 或排队。

## 长期维护原则

Computer Use 的长期维护目标是能力完备但算法简单。优先把复杂度放进清晰边界，而不是在 core 里堆推理逻辑。

- 只保留一个 primitive core 和一个 MCP public surface；Host、runtime route 和平台实现都围绕这个 core 做 adapter。
- 新增能力走同一条路径：action table -> validator -> MCP schema -> service delegation -> evidence test -> live acceptance。
- Platform Adapter 只负责平台绑定、观察和执行；不能把 task planning、semantic locate、repair 或 completion truth 放进 adapter。
- Acceptance Harness 只证明能力成熟度和副作用清理；不能成为 product runtime，也不能把 diagnostic path 宣传为 product-ready。
- 旧逻辑与目标设计冲突时直接删除或迁移出 Computer Use；不为 `runTask` / operationKind / 历史 product claim 继续加兼容层。

## 能力成熟度

Computer Use 的每项能力都要标清成熟度，避免把 contract、fixture 或 diagnostic path 误认为产品能力。

- `contracted`：primitive schema、validator、result envelope 和风险边界已经定义。
- `unit-proven`：contract test 证明 validator、状态机、风险门和 evidence refs 正常。
- `live-diagnostic`：能在真实桌面上跑通，但仍可能依赖共享系统输入、测试专用窗口或诊断适配器。
- `product-ready`：走 session-local input adapter，真实桌面验收通过，执行后无窗口、进程、临时文稿或 artifact 残留。
- `blocked`：平台或 adapter 暂时不能满足隔离、证据或清理要求，必须说明缺口和恢复条件。

只有 `product-ready` 能作为 Computer Use 产品路径能力对外声明。其它状态只能用于开发、调试或风险说明。

## 外部边界

Computer Use 不直接面向用户表达的完整任务。调用方必须先给出明确 target、risk policy、budget、已选择的 action target 或 procedure steps。

Computer Use 返回 refs-first observation、action evidence、diagnostics、blocked reason 和 repair hints；调用方负责继续推理、修复、验证和生成最终答复。

`/computer-use` 只能作为 debug / diagnostic 入口，不能成为 Computer Use 的产品语义入口。

## Primitive Surface

Computer Use 新 MCP public surface 只暴露这些 primitive：

| primitive | 作用 | 边界 |
| --- | --- | --- |
| `computer_use.bind` | 绑定 Host 指定目标，建立 scoped session。 | 不判断目标是否足以完成用户任务；不规划下一步。 |
| `computer_use.observe` | 读取已绑定 target 的当前状态并物化 refs。 | 不选择 action；不把 observation 升级成 completion truth。 |
| `computer_use.act` | 执行 Host 指定的一个原子 GUI action。 | 不接受自然语言目标；只接受 Host 已选定的 element ref、point、key、text ref 或 app command。 |
| `computer_use.run_procedure` | 执行 Host 指定的局部结构化步骤序列，减少多次 primitive 往返。 | 不接受自然语言 task / instruction / goal；不 plan / locate / verify / repair；不判断用户任务完成。 |
| `computer_use.control` | 暂停、停止或释放 session。 | 不参与任务推理；不改变 completion truth。 |

所有 primitive 都必须使用 refs-first envelope。未知字段默认拒绝或进入 diagnostics，不能静默改变语义。

`bind` 成功必须产出 session-scoped `inputAdapterRef`、`cursorRef` 和 `scopedInputLeaseRef`。这些 refs 在同一进程内必须唯一；`act` 和 `control` 只能在对应 session scope 内使用它们。

`act` 的原子动作覆盖 click、double_click、type、key、scroll、wait、app_command 和 drag；这些动作只描述一次明确输入事件或应用命令，不承载智能。

`run_procedure` 是性能和时延优化，不是旧 `runTask` 的改名。它只执行 Host 已经决定好的局部步骤序列。`run_procedure.status=completed` 只表示这段局部 procedure 执行完了，不能证明用户目标完成。

## 算法简化原则

Computer Use 尽量用 contract 和状态约束替代复杂算法：

- 用 action table 声明每种 action 的 required fields、risk rule、handler name 和 evidence requirement。
- 用有限状态机管理 session 生命周期，不做隐式 repair。
- 用 discriminated union 表达 action，不接受自由 JSON。
- 坐标只做 screen / window / element 之间的机械转换，不做语义 locate。
- 共享系统输入不做并行隔离；只做全局 focus/input lease 串行化，并把接管、恢复和用户影响写入 evidence。
- `run_procedure` 只是顺序执行 primitive；遇到 `blocked`、`needs-confirmation` 或 `failed` 立即停止。
- 不在 Computer Use core 内实现 retry planner、目标搜索器、结果 verifier 或跨 app workflow；需要这些能力时交给调用方或独立模块。
- 任何含糊输入默认 `blocked`，并返回可理解的 reason 和 repair hint，而不是猜测执行。

## 最小执行管线

所有 primitive 尽量复用同一条短管线，新增能力优先补 table、validator、adapter handler 和 evidence，而不是加分支算法。

- `bind`：校验 target scope -> platform bind -> 分配 session / input adapter / cursor / lease refs -> 进入 active。
- `observe`：校验 session active -> platform observe -> 物化 screenshot / AX / element / text refs -> 返回 current observation。
- `act`：校验 action payload -> 校验 session / lease / risk / confirmation -> 读取 before observation -> 调 input adapter handler -> 记录 executor / input event -> 读取 after observation -> invalidated stale refs。
- `run_procedure`：按顺序调用 primitive 管线；任何 step `blocked`、`needs-confirmation` 或 `failed` 就停止并保留已产生 refs。
- `control`：校验 session -> 状态转移 -> release / stop / cancel 时释放 lease、adapter 和 cursor refs。

如果某个功能不能放进这条管线，默认判断为 Host 编排、Platform Adapter 能力或 Acceptance Harness，而不是扩大 Computer Use core。

## 当前推进顺序

近期实现按 P3 / P4 / P6 收敛，并把 P8 / P9 作为复杂真实软件验收与 co-work 边界：

- P3 先把真实桌面验收做扎实：live test 默认 skip，显式 env 才运行；运行前后清理测试窗口、文稿、进程和 artifacts；多 session 要证明 adapter / cursor 独立。
- P4 再接 Host / MCP：MCP schema 必须与 TS validator 一致；Host port adapter 提供真实 `bind` / `observe` / `act` / `control`；Agent Host 继续拥有用户任务理解和 final answer。
- P6 持续清理迁移路径：旧 `runTask`、`perform_local_action`、`fill_fields`、`executeBoundedOperation` 和 VirtualAppScreen / noVNC product claim 不能回流到新 public surface。
- P8 用 VSCode / IDE 复杂桌面窗口补齐视觉验收：真实 `observe` 必须看到文件树、编辑区、窗口标题或等价 AX/text 证据；Host-side acceptance controller 可以基于 observation refs 选择下一步原子动作，但 Computer Use core 仍不做规划；真实 `act` 必须改变当前测试窗口；after observe 必须用视觉/AX/text refs 验证变化，文件内容只能作为补充 validator；验收后必须清理测试文件 tab、临时 workspace、input lease、cursor 和 artifacts。
- P9 面向用户已打开的 VSCode / IDE co-work：Host 可以根据当前 run 的 observe refs、用户选择的 window refs 和风险 envelope 决定下一步原子 primitive；observe/text/element/visible file evidence 必须保持 refs-first，合法 refs 与 raw payload 混用时必须 `blocked`，不能 silent-drop raw 项后继续；多窗口、目标文件不明确、编辑区不可见或 observation stale 必须 `needs-confirmation` / `blocked`；保存用户真实文件、撤销用户编辑、批量替换和跨文件修改必须有 Host-collected confirmationRef，且该确认必须绑定 `risk:` 形态 riskActionHash。Computer Use core 仍只接受 Host 指定的 primitive，不接受 task plan。

完成顺序以验收成熟度为准：`contracted` 和 `unit-proven` 只能说明 contract 正确；只有 session-local adapter 通过真实桌面验收且无副作用残留，才能升为 `product-ready`。

当前 P3 状态是 `live-diagnostic`：TextEdit live acceptance 已在真实桌面跑通原子动作链、双 session adapter / cursor 隔离，以及 shared-system-input 并发冲突 blocked；并验证运行后没有测试窗口、进程、临时文稿或默认 artifact 残留。该路径仍使用 System Events / CGEvent 共享系统输入，所以不能声明 `product-ready`。

当前 P4 状态是 `unit-proven`：Agent Host 默认 WindowAction materializer 已通过 `computer_use.bind -> computer_use.observe -> computer_use.act -> computer_use.control(release)` 执行单步低风险 GUI action，turn-loop 普通聊天路径基于 action evidence 生成答复，并把 action / artifact validator / release evidence 保留到 final result；workflow loop blocked 时也保留已完成原子步骤 refs。这个状态不等于完整用户 workflow 完成，也不等于真实桌面 `product-ready`。

当前 P1 状态是 `live-diagnostic`：8 个 action type 的 validator、MCP schema、service delegation 和 evidence refs 已有 package test 覆盖，TextEdit live acceptance 覆盖低风险原子动作子集。该状态不代表每个 `app_command` 值、快捷键组合或平台 adapter 都已 product-ready。

当前 P5 状态是 `unit-proven`：内置高风险 `app_command` 列表默认 needs-confirmation；Host 标记的 cross-app、cross-window、cross-account、irreversible risk categories 默认 needs-confirmation；approvalRef 必须绑定当前 risk envelope；单步 `act` 和 `run_procedure` blocked 时不会调用 executor。Computer Use core 只执行 risk envelope 规则，不做跨 app / 跨账号语义推断。

当前 P7 状态是 `unit-proven`：普通聊天入口已能触发 Host 选择 target，并走 `bind -> observe -> act -> control(release)`；final answer 只基于 action evidence 和 release evidence 表达局部动作结果。TextEdit chat bridge 和 live acceptance runner 已证明 save 目标、artifact validator refs、release refs 和 product completion gate 能保留到 blocked answer；真实桌面 TextEdit primitive live 仍是 `live-diagnostic`，普通聊天到真实 TextEdit/Appium 的完整 live 验收还不能声明 `product-ready`。

当前 P8 状态是 `live-diagnostic`：VSCode live acceptance runner 默认 skip，显式 `SCIFORGE_COMPUTER_USE_VSCODE_PRIMITIVE_ACCEPTANCE=1` 才运行；用户要求它复用用户 VSCode profile / 当前权限以贴近真实 co-work，所以 manifest 明确标记 `userProfileUsed=true`。该 runner 在临时 workspace / test file 上走 `bind -> observe -> act -> observe -> control(release)`，记录 screenshotRef、accessibilityRef、visible text refs、target window/session refs、input adapter / cursor / lease release refs，并用补充文件 validator 交叉确认保存结果。不带 keep-artifacts 运行后会删除临时 workspace 和 evidence artifacts，但不会杀用户 VSCode 进程，也不会清理用户 profile。该能力仍使用共享系统输入和用户 profile，因此不能声明 `product-ready` 或 profile-isolated cleanup。

当前 P9 状态是 `unit-proven`：`packages/actions/computer-use/vscode-cowork-acceptance.ts` 记录了 Host-side current VSCode co-work 的 acceptance controller contract，并登记 `CU-NEXT-09 current-vscode-cowork`。该 contract 只根据 Host 提供的窗口候选、选定 windowRef、selectedFileRef、fresh observe refs、cursorMoveRef、draftTextRef、riskActionHash 和 confirmationRef 返回一个下一步原子 primitive，或返回 `needs-confirmation` / `blocked`；window/app/process/title/frontmost refs 与 observation/image/AX/text/element/freshness refs 必须是 tokenized refs，raw VSCode title、raw AX/text、截图路径或自然语言 observation 不能作为 bind/observe evidence；如果 Host 输入同时包含合法 window refs 和 raw window 候选，controller / native bridge 会返回 `blocked` / `vscode_cowork_window_candidate_refs_invalid`，不能静默丢弃 raw 候选后把目标误收敛成单窗口 ready；如果 `textRefs` / `elementRefs` 同时包含合法 refs 与 raw visible text、raw AX/element label，或 visible file refs 同时包含 `file-ref:` 与 raw path / 裸文件名，controller / native bridge 会返回 `blocked` / `vscode_cowork_observe_refs_invalid` 或 `vscode_cowork_visible_file_refs_invalid`，且 public events 只保留 tokenized refs；selectedWindowRef / selectedFileRef 必须来自当前 window/observe refs，raw VSCode title、raw path 或裸文件名会返回 `vscode_cowork_selected_window_ref_invalid` / `vscode_cowork_selected_file_ref_invalid`，不能被 sanitizer 当作未选择后自动绑定唯一候选；selectedFileRef 必须来自当前 window/observe refs 中的 `file-ref:` 形态 visible file refs，不能复用 stale 或外部文件 ref，raw path / 裸文件名也不能作为目标文件 ref；`move-cursor` 缺少 refs-first `cursor-move:` 形态 cursorMoveRef 时会 `blocked`，只允许 Host 基于 observe refs 选择一个明确 arrow-key movement，不能把 raw 自然语言方向或多步移动计划塞入 Computer Use decision；`insert-draft` 缺少 refs-first `text-ref:` 形态 `draftTextRef` 时会 `blocked`，不能把 raw draft text、clipboard payload 或 provider payload 嵌入 Computer Use decision；`read-visible-text` 只返回 `primitive=observe` 和当前 observation/text/AX refs，不产生 `act` action 或 visible text 原文；只有 `risk:` 形态 riskActionHash 和 `approval:` 形态 approvalRef 能作为 evidence refs 保留，保存、撤销、批量替换或跨文件修改等真实文件操作缺少 `risk:` riskActionHash 时即使出现 approvalRef 也会 `blocked`，raw path / 裸文件名 / 自然语言 risk 描述不会进入 public events，且 confirmationRef 必须精确绑定为 `approval:<riskActionHash>:` 前缀，不能只在字符串中包含 risk hash；`bulk-replace` / `cross-file-modify` 即使带匹配 approval，也会 `blocked` / `vscode_cowork_non_atomic_operation_requires_host_decomposition`，要求 Host 基于当前 observe refs 拆成单步原子 editor primitive，不能把确认后的批量或跨文件修改计划交给 Computer Use core。它不新增 MCP public surface，不进入 Computer Use primitive core，也不产生用户级 completion truth。Runtime Codex native route 现在有一个 VSCode co-work Host bridge：只有 schema/kind/source 均为 Host-owned native route、taskId 为 `CU-NEXT-09` 且带 `current-vscode-cowork` + `refs-first` semantic markers 的 intent 会被路由到该 bridge；bridge 只消费 sanitized refs / operation / confirmationRef，并在多窗口、目标文件不明确或目标不明确时返回 refs-first `needs-confirmation` / `blocked`，不回落到 broader runtime 猜测窗口。P9 cleanup / live manifest validator 要求 manifest 明确 `userProfileUsed=true` 和 `sharedSystemInputUsed=true`；standalone cleanup 和 live manifest 都要求 release input lease / cursor / adapter refs、front app 与 mouse position restoration refs，拒绝 raw payload、URL、token/password/secret-like 值和本地路径形态，并禁止杀用户 VSCode 或清理用户 profile；live manifest 还要求 `bind -> observe -> act -> observe -> control(release)`、before/after observe refs、Host decision/action/control refs，真实文件操作必须带 tokenized `risk:` riskActionHash 与 `approval:` approvalRef evidence refs。该状态仍不代表真实用户 VSCode co-work live gate 已完成，也不能声明 `product-ready`。

## 职责边界

```text
Caller owns:
  task understanding
  target selection
  semantic locate
  next-action reasoning
  cross-module repair
  approval decision
  artifact validation request
  completion truth
  final answer

Computer Use owns:
  target-bound session refs
  current observation refs
  scoped executor event refs
  host-specified local procedure execution refs
  stale invalidation
  fail-closed diagnostics
  stop / cancel / release controls
```

判断原则：

- 如果某段逻辑需要理解“用户到底想完成什么”，它不属于 Computer Use。
- 如果某段逻辑只需要回答“这个 session 现在看到什么 / 这一个动作或 Host 指定局部 procedure 是否被安全执行并记录”，它属于 Computer Use。

## 风险与确认

Computer Use 可以识别动作风险并返回 `needs-confirmation`，但不能自己决定高风险动作是否应该执行。

必须返回 `needs-confirmation` 的典型情况：

- submit / send / publish / upload / delete / pay / authorize。
- 改变外部账号、安全、法律、财务或不可逆状态。
- 跨 app / 跨窗口副作用超出当前 session scope。
- Host 没有提供有效 approval ref。

确认由调用方收集。Computer Use 只验证 approval ref 是否匹配当前 action risk envelope。

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

raw screenshot、raw AX tree、raw provider payload、data URL、base64、API key 和 secret 不得进入 primitive body 或 public diagnostics。

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

调用方可以读取 Computer Use refs 后自行调用模型或 verifier；这不属于 Computer Use primitive 内部职责。

## 迁移口径

当前旧路径包括 `executeBoundedOperation`、`computer_use.perform_local_action`、`computer_use.fill_fields`、`computer_use.runTask(request, hostPorts)`、`plan`、`locate`、`verify` 等。

迁移目标：

- `perform_local_action` 拆为 `bind` / `observe` / `act`。
- `fill_fields` 由调用方多次调用 `act(type/key/click)` 表达，或在调用方已明确步骤后使用 `run_procedure` 降低往返。
- `runTask` 不进入新 MCP public surface，也不新增内部 legacy alias 或 compatibility wrapper。
- 无智能局部组合能力进入 `run_procedure`；它只执行 Host 指定的结构化步骤序列。
- `plan` 移到调用方。
- `locate` 变成调用方对 observation refs 的选择；Computer Use 只接受 element ref / point。
- `verify` 移到调用方 / verifier / artifact validator。

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

本文件只保留设计原则和迁移口径。

## 相关文档

- [`Architecture.md`](Architecture.md)：总架构和 Computer Use 上下游边界。
- [`BrowserRuntimeArchitecture.md`](BrowserRuntimeArchitecture.md)：Browser primitive runtime 的同构设计。
